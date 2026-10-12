# Wrapper defragmentation

Wrapper `Defrag` (instruction 8) compacts a wrapper account in place and
shrinks it to what its entries need. The freed rent stays on the account as
excess lamports for the existing `Collect` instruction to sweep; composing
`[Defrag, Collect]` in one transaction recovers it immediately.

## What it does and does not do

Wrapper accounts only ever grow: cancelled and filled orders return their
blocks to a free list that is reused but never released, and `Collect` leaves
the balance the current size needs. Defrag:

- relinks market infos and open orders into the lowest blocks, preserving
  list order and all payloads byte for byte;
- converts any pre-list market (legacy red-black orders layout) to the list
  layout, the same conversion `sync_fast` performs lazily;
- truncates the account to what the surviving entries and any not yet
  compacted holes need (`WRAPPER_FIXED_SIZE` plus `WRAPPER_BLOCK_SIZE` per
  block), rebuilding the free list over the holes a bounded run leaves. A
  completed compaction leaves an empty free list; every mutating wrapper path
  calls `ensure_free_slots` with its payer before inserting, so the next
  insert grows the account the normal way (four blocks at a time);
- moves no lamports itself.

Nothing is harvested: no market info or order entry is dropped, even for a
market with no balances and no orders. Node addresses are internal to the
wrapper account — open orders keep their core `market_data_index` hints, and
the market infos tree and per-market lists stay well formed — so no client or
wrapper instruction observes anything but a smaller account.

## Bounded runs

The instruction data is empty or one little endian `u32`: the number of
blocks this run may relocate, clamped to
`MAX_WRAPPER_DEFRAG_RELOCATIONS_PER_RUN` (1,024, which is also what an empty
payload means). A bounded run slides the highest survivors into the lowest
holes, truncates everything above the highest survivor, and chains the
remaining holes back onto the free list, so each call shrinks the account by
at least the blocks it relocated and the account is valid in between. An
operator compacts a wrapper of any fragmentation by repeating the call until
the size stops changing; an explicit budget of zero relocates nothing but
still reclaims an already-free tail.

Relocation is constant work per moved block: neighbour links are rewritten in
place, and a moved list head's owning market info is repointed in one indexed
pass after the sweep rather than searched for per move. The marking pass
costs one walk over the live entries per call.

## Authority and economics

The instruction takes the wrapper state (writable) and an authority (signer)
that must be either the wrapper's `trader` or the hardcoded collector (the
core program's `DEFRAG_COLLECTOR`, which the wrapper re-exports as
`COLLECTOR`; the `test` feature substitutes the test collector).

Compaction keeps every entry, but it is not free for the owner: freed blocks
stop being reusable prepaid capacity and become excess lamports that
`Collect` sweeps to the collector, and the owner pays rent again when a later
insert grows the account. That transfer is the point of the instruction — it
is how the deployer recovers rent parked in abandoned wrapper layouts — and
it is why the owner may also run Defrag on their own wrapper, for example
ahead of a sweep they would rather capture themselves (`Collect` always pays
the collector, so an owner-run Defrag alone only shrinks the account).

## Bounds

A wrapper larger than `MAX_WRAPPER_DEFRAG_BLOCKS` (65,536 blocks, a 6.3 MB
account) is rejected. Heap use is fixed-size and reserved up front: the two
block bitmaps (16 KiB at the cap), the moved-heads fixup table (8 KiB at the
full relocation budget), and nothing that grows, which matters because the
SBF bump allocator never frees. Every index read out of the account — tree
edges, list links, roots, and relocation neighbours — is bounds checked and
cross checked (back links must agree, a parentless node must be the named
root, a list head must have no predecessor, a linked-to block must be a
survivor) before it is followed or rewritten, so a corrupt account fails the
instruction cleanly instead of panicking, looping, or being rearranged.

`wrapper::instruction_builders::defrag_instruction(wrapper_state, authority,
limit)` builds the instruction; `limit: None` requests the full per-run
budget.

## Mainnet estimate (October 9, 2026)

Live scan of all wrapper accounts at the observed rent schedule (650,240
lamports base + 5,080 lamports/byte):

| Program | Accounts | Excess sweepable today | Defrag adds | Total |
| --- | ---: | ---: | ---: | ---: |
| wrapper (`wMNFST…`) | 1,992 | 5.445 SOL | 4.683 SOL | 10.127 SOL |
| ui-wrapper (`UMnFSt…`) | 2,423 | — (no Collect ix) | — | (2.730 SOL potential) |

23.2% of regular-wrapper blocks are free-list holes, and the largest wrapper
observed is about 4,100 blocks — roughly four bounded runs. The ui-wrapper
has neither a `Collect` nor a `Defrag` instruction; porting both would
recover about 2.73 SOL more and is separate work, as is closing wrapper
accounts outright (this instruction never closes an account, since the owner
may still be using it).
