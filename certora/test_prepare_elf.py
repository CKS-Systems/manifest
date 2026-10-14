import struct
import unittest

from prepare_elf import ELF, RELOCATION, SECTION, SYMBOL, prepare, syscall_hash


def fixture(syscall=0x434371F8, internal_call=False, section_symbol=False, abort_wrapper=False,
            alloc_symbol=None):
    # One static memmove, one unresolved verification primitive, and an lddw
    # whose immediate word looks like a call. Only real calls get relocations.
    text = (struct.pack("<BBhI", 0x85, 0, 0, syscall)
            + struct.pack("<BBhI", 0x85, 0x10, 0, 0xFFFFFFFE if internal_call else 0xFFFFFFFF)
            + struct.pack("<BBhI", 0x18, 1, 0, 0)
            + struct.pack("<BBhI", 0x85, 0, 0, 0x12345678)
            + struct.pack("<BBhI", 0x95, 0, 0, 0))
    names = b"\0.text\0.rel.text\0.symtab\0.strtab\0.shstrtab\0"
    symbols = bytes(SYMBOL.size) + SYMBOL.pack(1, 0x12, 0, int(internal_call),
                                              0x100000000 if internal_call else 0, 0)
    strings = b"\0CVT_assert\0"
    if section_symbol:
        symbols += SYMBOL.pack(0, 3, 0, 1, 0x100000000, 0)
    if abort_wrapper:
        symbols += SYMBOL.pack(len(strings), 2, 0, 1, 0x100000000, 8)
        strings += b"abort\0"
    if alloc_symbol:
        symbols += SYMBOL.pack(len(strings), 0x12, 0, 1, 0x100000008, 8)
        strings += alloc_symbol + b"\0"
    payloads = [b"", text, RELOCATION.pack(0x100000008, 1 << 32 | 10), symbols, strings, names]
    sections = [[0] * 10]
    data = bytearray(ELF.size)
    for i, name in enumerate([b".text", b".rel.text", b".symtab", b".strtab", b".shstrtab"], 1):
        data.extend(bytes(-len(data) % 8))
        section = [names.index(name), {2: 9, 3: 2, 4: 3, 5: 3}.get(i, 1),
                   6 if i == 1 else 0, 0x100000000 if i == 1 else 0,
                   len(data), len(payloads[i]), 3 if i == 2 else 4 if i == 3 else 0,
                   1 if i in (2, 3) else 0, 8, 16 if i == 2 else 24 if i == 3 else 0]
        sections.append(section)
        data.extend(payloads[i])
    data.extend(bytes(-len(data) % 8))
    section_offset = len(data)
    for section in sections:
        data.extend(SECTION.pack(*section))
    ELF.pack_into(data, 0, b"\x7fELF\x02\x01" + bytes(10), 3, 247, 1, 0, 0,
                  section_offset, 3, ELF.size, 56, 0, SECTION.size, 6, 5)
    return bytes(data)


class PrepareElfTests(unittest.TestCase):
    def test_known_solana_hashes(self):
        self.assertEqual(syscall_hash("sol_memmove_"), 0x434371F8)
        self.assertEqual(syscall_hash("sol_invoke_signed_c"), 0xA22B9C85)
        self.assertEqual(syscall_hash("sol_get_sysvar"), 0x13C1B505)

    def test_preserves_instructions_and_verification_primitive(self):
        original = fixture()
        prepared, added = prepare(original)
        self.assertEqual(added, 1)
        header = ELF.unpack_from(prepared)
        sections = [SECTION.unpack_from(prepared, header[6] + i * SECTION.size) for i in range(6)]
        text = sections[1]
        self.assertEqual(prepared[text[4]:text[4] + text[5]], original[text[4]:text[4] + text[5]])
        rel = sections[2]
        calls = dict(RELOCATION.iter_unpack(prepared[rel[4]:rel[4] + rel[5]]))
        self.assertEqual(calls, {0x100000000: 2 << 32 | 10, 0x100000008: 1 << 32 | 10})
        symbols = sections[3]
        self.assertEqual(SYMBOL.unpack_from(prepared, symbols[4] + SYMBOL.size), (1, 0x12, 0, 0, 0, 0))
        self.assertEqual(prepare(prepared)[1], 0)

    def test_rejects_unknown_syscall(self):
        with self.assertRaisesRegex(ValueError, "unknown static syscall"):
            prepare(fixture(0x12345678))

    def test_rejects_wrong_architecture(self):
        data = bytearray(fixture())
        struct.pack_into("<I", data, 48, 2)
        with self.assertRaisesRegex(ValueError, "sBPF v3"):
            prepare(data)

    def test_internal_calls_keep_their_compiled_offsets(self):
        prepared, _ = prepare(fixture(internal_call=True))
        header = ELF.unpack_from(prepared)
        rel = SECTION.unpack_from(prepared, header[6] + 2 * SECTION.size)
        self.assertEqual(rel[5], RELOCATION.size)  # Only the external syscall.
        self.assertEqual(RELOCATION.unpack_from(prepared, rel[4])[0], 0x100000000)

    def test_section_symbols_get_their_section_name(self):
        prepared, _ = prepare(fixture(section_symbol=True))
        header = ELF.unpack_from(prepared)
        symbols = SECTION.unpack_from(prepared, header[6] + 3 * SECTION.size)
        strings = SECTION.unpack_from(prepared, header[6] + 4 * SECTION.size)
        symbol = SYMBOL.unpack_from(prepared, symbols[4] + 2 * SYMBOL.size)
        self.assertEqual(symbol[1:], (3, 0, 1, 0x100000000, 0))
        self.assertEqual(prepared[strings[4] + symbol[0]:][:6], b".text\0")

    def test_mangled_allocator_shims_get_classic_names(self):
        original = fixture(alloc_symbol=b"_RNvCscR3e5J6VSLN_7___rustc12___rust_alloc")
        prepared, _ = prepare(original)
        header = ELF.unpack_from(prepared)
        symbols = SECTION.unpack_from(prepared, header[6] + 3 * SECTION.size)
        strings = SECTION.unpack_from(prepared, header[6] + 4 * SECTION.size)
        symbol = SYMBOL.unpack_from(prepared, symbols[4] + 2 * SYMBOL.size)
        self.assertEqual(prepared[strings[4] + symbol[0]:][:13], b"__rust_alloc\0")
        self.assertEqual(symbol[1:], (0x12, 0, 1, 0x100000008, 8))

    def test_abort_wrapper_and_syscall_keep_distinct_symbols(self):
        prepared, _ = prepare(fixture(syscall_hash("abort"), abort_wrapper=True))
        header = ELF.unpack_from(prepared)
        symbols = SECTION.unpack_from(prepared, header[6] + 3 * SECTION.size)
        self.assertEqual(SYMBOL.unpack_from(prepared, symbols[4] + 2 * SYMBOL.size)[3], 1)
        self.assertEqual(SYMBOL.unpack_from(prepared, symbols[4] + 3 * SYMBOL.size)[3], 0)


if __name__ == "__main__":
    unittest.main()
