# Manifest Interface for OKX

This module implements the `Dex` trait defined [here](https://web3.okx.com/build/docs/waas/dex-integration).

## Quote units and metadata compatibility

`Dex::quote` takes input token units and returns output token units through an
`f64` API. It rounds input down to input atoms and computes fills in integer
atoms. The returned float cannot represent every large integer atom count.
This is an indicative quote: metadata holds rounded order totals, not original
prices, so Core's per-fill rounding can differ. Re-quote against Core or
simulate before using a value as an execution bound.

Fetched `bids` and `asks` levels have four fields:

```text
[baseAtomsApprox, quoteAtomsApprox, "baseAtomsExact", "quoteAtomsExact"]
```

The first two fields remain the same `Number` values used by older consumers.
The last two are decimal `u64` strings. They retain counts that `f64` cannot
represent exactly. The adapter still accepts legacy two-number levels.
Consumers that require an array of exactly two elements must be updated to
accept the extra fields, or explicitly project each level to its first two.

Keep all four fields from one snapshot. When changing either numeric field,
update both strings or remove both strings. A string pair is used only when
its values parse as `u64` and convert to the numeric prefix. This detects
inconsistent fields, but cannot detect stale strings in the same `f64`
rounding interval. Re-fetching a complete snapshot avoids that ambiguity.

When every filled level uses exact strings, output atom totals above `u64::MAX`
are rejected. If any filled level uses numeric fallback, the legacy or mixed
total remains approximate and has no `u64` cap. Validate the output range
before converting it into a transaction amount. A zero return can mean no
whole output atom, no liquidity, invalid input, or a rejected range; it is not
a separate error status.

## Regression tests

From the repository root, using its pinned host Rust toolchain:

```sh
cargo test --locked -p manifest-okx
```

`quote_precision` calls the real metadata encoder with RPC account responses,
checks the numeric prefix and exact strings, and compares legacy/exact quotes
with Core impact and IOC fills.

The SBF tests create mints, fund orders, read the actual market through
`fetch_pool_metadata`, simulate the swap, and check token balances after local
execution. Build the same test program used by CI, then run:

```sh
mkdir -p target/program-test-deploy
cargo build-sbf --manifest-path programs/manifest/Cargo.toml --arch v3 --tools-version v1.57 --features test --sbf-out-dir "$PWD/target/program-test-deploy"
SBF_OUT_DIR="$PWD/target/program-test-deploy" cargo test --locked -p manifest-okx --features test-sbf --test quote_sbf -- --test-threads 1
```

The existing Rust CI workspace test command enables `test-sbf` and builds these
program artifacts. Without `test-sbf`, this SBF-only test file is disabled.
The tests retain a known indicative rounding difference as a separate case;
passing them does not make the float quote an exact execution oracle.
