#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

args=(--tools-version v1.53 --arch v3)
while (( $# )); do
  case "$1" in
    -l) shift ;; # Certora's build-script protocol; this crate is already a library.
    --arch) test "$2" = v3; shift 2 ;;
    --cargo_features) args+=(--features "$2"); shift 2 ;;
    *) args+=("$1"); shift ;;
  esac
done
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-../../target}"
# v3 drops unresolved CVT call identities unless the linker retains relocations.
export CARGO_TARGET_SBPFV3_SOLANA_SOLANA_RUSTFLAGS="${CARGO_TARGET_SBPFV3_SOLANA_SOLANA_RUSTFLAGS:-} -C link-arg=--emit-relocs"
cargo certora-sbf "${args[@]}"

# Mutable mocks live in .data. LLVM's constant pointer tables leave SHF_WRITE
# on .rodata despite its read-only load segment; clear it with the bundled tool.
sysroot=$(rustup run certora-solana rustc --print sysroot)
"$sysroot/../llvm/bin/llvm-objcopy" \
  --remove-section=.rel.rodata --remove-section=.rel.data \
  --remove-section='.rel.debug*' \
  --set-section-flags .rodata=alloc,load,readonly,data,contents \
  "$CARGO_TARGET_DIR/sbpfv3-solana-solana/release/manifest.so"
python3 ../../certora/prepare_elf.py \
  "$CARGO_TARGET_DIR/sbpfv3-solana-solana/release/manifest.so" >&2
