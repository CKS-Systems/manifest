#!/usr/bin/env python3
"""Restore call metadata needed by Certora's disassembler for an sBPF v3 ELF.

The v3 linker must run with --emit-relocs: otherwise unresolved CVT calls lose
their identities. Static Solana syscalls also need named relocations because
Certora currently interprets every unrelocated call as a relative internal call.
Only non-loaded symbol/relocation tables change; program instructions and data
are checked byte-for-byte. This artifact is exclusively for the prover.
"""

import struct
import sys
from pathlib import Path

ELF = struct.Struct("<16sHHIQQQIHHHHHH")
SECTION = struct.Struct("<IIQQQQIIQQ")
SYMBOL = struct.Struct("<IBBHQQ")
RELOCATION = struct.Struct("<QQ")


def syscall_hash(name):
    """Murmur3 x86/32, seed 0, as used by solana-define-syscall."""
    def rotate(value, bits):
        return ((value << bits) | (value >> (32 - bits))) & 0xFFFFFFFF

    def mix(value):
        return (rotate((value * 0xCC9E2D51) & 0xFFFFFFFF, 15) * 0x1B873593) & 0xFFFFFFFF

    data = name.encode()
    value = 0
    end = len(data) // 4 * 4
    for offset in range(0, end, 4):
        value ^= mix(int.from_bytes(data[offset:offset + 4], "little"))
        value = (rotate(value, 13) * 5 + 0xE6546B64) & 0xFFFFFFFF
    value ^= mix(int.from_bytes(data[end:], "little"))
    value ^= len(data)
    value ^= value >> 16
    value = value * 0x85EBCA6B & 0xFFFFFFFF
    value ^= value >> 13
    value = value * 0xC2B2AE35 & 0xFFFFFFFF
    return value ^ (value >> 16)


# Fail closed on any newly introduced syscall until its identity is reviewed.
SYSCALLS = {syscall_hash(name): name for name in (
    "sol_invoke_signed_c", "sol_invoke_signed_rust", "sol_get_sysvar",
    "sol_get_clock_sysvar", "sol_get_rent_sysvar", "sol_alloc_free_",
    "sol_memcpy_", "sol_memmove_", "sol_memset_", "sol_memcmp_",
    "sol_log_", "sol_log_64_", "sol_log_compute_units_", "sol_panic_", "abort",
    "sol_create_program_address", "sol_try_find_program_address",
    "sol_set_return_data", "sol_get_return_data", "sol_get_stack_height",
)}


def prepare(original):
    data = bytearray(original)
    header = list(ELF.unpack_from(data))
    if header[0][:6] != b"\x7fELF\x02\x01" or header[7] != 3:
        raise ValueError("expected a little-endian ELF64 sBPF v3 program")
    if header[11] != SECTION.size:
        raise ValueError("unexpected ELF section-header size")
    sections = [list(SECTION.unpack_from(data, header[6] + i * SECTION.size))
                for i in range(header[12])]

    def contents(section):
        return bytes(data[section[4]:section[4] + section[5]])

    def string(table, offset):
        return table[offset:table.index(b"\0", offset)].decode()

    section_names = contents(sections[header[13]])
    named = {string(section_names, s[0]): i for i, s in enumerate(sections)}
    text = sections[named[".text"]]
    symbols_index = named[".symtab"]
    symbols = sections[symbols_index]
    strings = sections[symbols[6]]
    if ".rel.text" not in named:
        raise ValueError("missing .rel.text: build with -C link-arg=--emit-relocs")
    rel = sections[named[".rel.text"]]
    if rel[6] != symbols_index or rel[7] != named[".text"]:
        raise ValueError("unexpected call relocation symbol/target table")
    for i, section in enumerate(sections):
        if section[1] in (4, 9) and i != named[".rel.text"]:
            raise ValueError("remove non-text relocations before preparing the prover ELF")

    symdata, strdata = bytearray(contents(symbols)), bytearray(contents(strings))
    symnames = {}
    for offset in range(0, len(symdata), SYMBOL.size):
        sym = list(SYMBOL.unpack_from(symdata, offset))
        # --emit-relocs adds unnamed STT_SECTION symbols. Certora also treats
        # these as globals and requires a name; use the section's actual name.
        if sym[0] == 0 and sym[1] & 15 == 3 and 0 < sym[3] < len(sections):
            sym[0] = len(strdata)
            strdata.extend(string(section_names, sections[sym[3]][0]).encode() + b"\0")
            SYMBOL.pack_into(symdata, offset, *sym)
        name = string(strdata, sym[0])
        # This std mangles the allocator shims (v0, crate `__rustc`), which
        # hides them from Certora's built-in malloc/free interception. Without
        # it every heap pointer loses its provenance. Restore the classic
        # names the prover matches on.
        classic = next((shim for shim in ("__rust_alloc_zeroed", "__rust_realloc",
                                          "__rust_dealloc", "__rust_alloc")
                        if name.endswith(shim)), None)
        if sym[1] & 15 == 2 and classic is not None and name != classic:
            if classic in symnames:
                raise ValueError(f"both {name} and {classic} are defined")
            name = classic
            sym[0] = len(strdata)
            strdata.extend(classic.encode() + b"\0")
            SYMBOL.pack_into(symdata, offset, *sym)
        symnames[name] = offset // SYMBOL.size

    relocations = {}
    for address, info in RELOCATION.iter_unpack(contents(rel)):
        offset = address - text[3]
        if not 0 <= offset < text[5] or offset % 8:
            raise ValueError("call relocation outside .text")
        if info & 0xFFFFFFFF == 10:  # R_SBF_64_32, function call
            if data[text[4] + offset] != 0x85:
                raise ValueError("function relocation does not identify a call")
            # Internal calls already contain the correct relative offset.
            # Keeping their relocations makes Certora register function aliases
            # twice, which breaks its address-to-function mapping.
            symbol = SYMBOL.unpack_from(symdata, (info >> 32) * SYMBOL.size)
            if symbol[3] == 0:
                relocations[address] = info

    added = 0
    immediate_word = False
    for offset in range(0, text[5], 8):
        if immediate_word:
            immediate_word = False
            continue
        opcode, registers, _, immediate = struct.unpack_from("<BBhI", data, text[4] + offset)
        if opcode == 0x18:  # lddw has a second, non-instruction word
            immediate_word = True
            continue
        if opcode != 0x85 or registers >> 4 != 0:
            continue
        address = text[3] + offset
        if address in relocations:
            continue
        name = SYSCALLS.get(immediate)
        if name is None:
            raise ValueError(f"unknown static syscall 0x{immediate:08x} at 0x{address:x}")
        # std provides an `abort` wrapper which calls the identically named
        # syscall. Keep the wrapper's existing symbol and add an undefined one.
        if name not in symnames or SYMBOL.unpack_from(symdata, symnames[name] * SYMBOL.size)[3] != 0:
            symnames[name] = len(symdata) // SYMBOL.size
            symdata.extend(SYMBOL.pack(len(strdata), 0x12, 0, 0, 0, 0))
            strdata.extend(name.encode() + b"\0")
        relocations[address] = symnames[name] << 32 | 10
        added += 1

    def append(section, payload):
        data.extend(b"\0" * (-len(data) % 8))
        section[4], section[5] = len(data), len(payload)
        data.extend(payload)

    append(symbols, symdata)
    append(strings, strdata)
    append(rel, b"".join(RELOCATION.pack(*entry) for entry in sorted(relocations.items())))
    data.extend(b"\0" * (-len(data) % 8))
    header[6] = len(data)
    for section in sections:
        data.extend(SECTION.pack(*section))
    ELF.pack_into(data, 0, *header)
    for section in sections:
        if section[2] & 2:  # SHF_ALLOC: instructions and runtime data
            start, size = section[4], section[5]
            if data[start:start + size] != original[start:start + size]:
                raise ValueError("preparation changed loaded program bytes")
    return bytes(data), added


if __name__ == "__main__":
    path = Path(sys.argv[1])
    prepared, count = prepare(path.read_bytes())
    path.write_bytes(prepared)
    print(f"{path}: preserved call relocations; named {count} static syscalls")
