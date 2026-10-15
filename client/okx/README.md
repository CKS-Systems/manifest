# Manifest Interface for OKX

This module implements the `Dex` trait defined [here](https://web3.okx.com/build/docs/waas/dex-integration).

## Integer Core quotes

For atom amounts, use the additive snapshot API instead of converting through
`f64` or the rounded order-total metadata:

```rust
use manifest_okx::{mfx::Manifest, SwapDirection};

let snapshot = Manifest.fetch_quote_snapshot(client, &market)?;
let output_atoms = Manifest.quote_atoms(1_000_000, &snapshot, SwapDirection::BaseToQuote)?;
println!("{} output atoms at slot {}", output_atoms, snapshot.slot());
```

Input and output are `u64` atom counts. This preserves every supported integer,
including `u64::MAX`. Core's impact methods use original order prices,
snapshot-slot expiration and Global backing checks. For example, buying from
an ask of 3 base atoms at price 1.5 with 3 quote atoms produces a Core quote of
2 base atoms; the legacy rounded-total estimate is 1.

`fetch_quote_snapshot` first discovers the market's immutable mint addresses,
then reads the market, mints and optional Globals together. Only that final
common-slot response is retained. For an existing account cache, construct a
`QuoteSnapshot::from_accounts(market, slot, &accounts)` from a coherent
`HashMap<Pubkey, Account>`. The snapshot validates account owners, discriminants,
tree links, trader references, mint decimals and Global mint relationships.
It checks order sides before comparison, requires the legacy SPL Token mint
layout, and decodes Token-2022 extension payloads, including variable-size
metadata. Duplicate or unrecognized extensions are rejected.
Its state is private and immutable; refresh it by constructing a new snapshot.

This API returns a **Core impact estimate**, not a transaction simulation or a
guaranteed minimum output. A partial book can leave input unspent. Shared
Global funding across several fills, changes after the snapshot, market
expansion and transaction checks can change or reject execution. Simulate the
constructed transaction before relying on an execution bound.

Transfer-fee mint configurations and active transfer hooks are explicitly
rejected. Supporting them needs a fee/hook-aware quote path. The supported
Token-2022 case is a mint without these transfer effects. A zero atom output is
valid; malformed data, unsupported mints and missing required Global state are
errors. The `Dex::quote(f64, ...)` API and its metadata format remain available
with their existing indicative behavior.

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
