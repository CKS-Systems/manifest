# Wrapper defragmentation

Wrapper `Defrag` (instruction 8) compacts a wrapper account in place and
shrinks it to what its entries need. The freed rent stays on the account as
excess lamports for the existing `Collect` instruction to sweep; composing
`[Defrag, Collect]` in one transaction recovers it immediately.

## What it does and does not do

Wrapper accounts only ever grow: cancelled and filled orders return their
blocks to a free list that is reused but never released, and `Collect` leaves
the balance the current size needs. Defrag:

- relinks every market info and open order into the lowest blocks, preserving
  list order and all payloads byte for byte;
- converts any pre-list market (legacy red-black orders layout) to the list
  layout, the same conversion `sync_fast` performs lazily;
- truncates the account to `64 + 96 * (market infos + open orders)` bytes and
  empties the free list. Every mutating wrapper path calls `ensure_free_slots`
  with its payer before inserting, so the next insert grows the account the
  normal way (four blocks at a time);
- moves no lamports itself.

Nothing is harvested: no market info or order entry is dropped, even for a
market with no balances and no orders. Node addresses are internal to the
wrapper account — open orders keep their core `market_data_index` hints, and
the market infos tree and per-market lists stay well formed — so no client or
wrapper instruction observes anything but a smaller account.

## Authority

The instruction takes the wrapper state (writable) and an authority (signer)
that must be either the wrapper's `trader` or the hardcoded collector
(`B6dmr2UAn2wgjdm3T4N1Vjd8oPYRRTguByW7AEngkeL6`, the `test` feature
substitutes the test collector). Because compaction only changes layout, a
collector-initiated run cannot cost the owner anything.

## Bounds

A wrapper larger than `MAX_WRAPPER_DEFRAG_BLOCKS` (65,536 blocks, a 6.3 MB
account) is rejected; the two heap bitmaps are one bit per block each, 16 KiB
of the 32 KiB heap at the cap. There is no relocation budget: unlike the
market, the wrapper has no unbounded heap term, and the largest mainnet
wrapper observed is about 4,100 blocks. Relocation rejects any node whose
neighbour links disagree, so a corrupt account fails the instruction instead
of being rearranged.

`wrapper::instruction_builders::defrag_instruction(wrapper_state, authority)`
builds the instruction.

## Mainnet estimate (October 9, 2026)

Live scan of all wrapper accounts at the observed rent schedule (650,240
lamports base + 5,080 lamports/byte):

| Program | Accounts | Excess sweepable today | Defrag adds | Total |
| --- | ---: | ---: | ---: | ---: |
| wrapper (`wMNFST…`) | 1,992 | 5.445 SOL | 4.683 SOL | 10.127 SOL |
| ui-wrapper (`UMnFSt…`) | 2,423 | — (no Collect ix) | — | (2.730 SOL potential) |

23.2% of regular-wrapper blocks are free-list holes. The ui-wrapper has
neither a `Collect` nor a `Defrag` instruction; porting both would recover
about 2.73 SOL more and is separate work, as is closing wrapper accounts
outright (this instruction never closes an account, since the owner may still
be using it).
