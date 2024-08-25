# ![Logo](assets/brown-contrast-split.png)
# <span style="font-family: 'Vollkorn', serif;">MANIFEST</span>
*The feeless orderbook exchange that supercharges your on-chain trading.*

Manifest is the next generation liquidity primitive on Solana.
No more permissioned markets. 
No more trading fees. 
No more expensive rent to start a market.
Capital efficiency built-in. 
Maximal freedom to exchange risk.

## Comparison


|  |    Openbook    | Phoenix  |Manifest              |
|--|----------------|-------------------|----------------------|
| Crankless |No |Yes |Yes |
| Feeless |No |No |Yes|
| Atomic lot sizes |No |No |Yes|
| Anchor |Yes |Yes |No|
| Rent|2 SOL |2 SOL |.002 SOL|
| License|GPL |Business |GPL|
| OpenOrders separation for read locking| Yes | No | Yes |
| Swap accounts| 10 | 8 | 7 |
| CU | | |
|Instruction size | | | |
|Silent failures | Yes| Yes| No|
|Token 22 | No| No| Yes|
|Customizable wrapper| No| No| Yes|

### Details:
- Cranks were originally used in serum to address the need for solana programs to identify all accounts before landing on chain. This has become obsolete now that orderbooks pack all data into a predictable account.
- No trading fees forever on Manifest.
- Lot sizes restrict expressable prices. This meaningfully matters to orderflow through routers that have non-standard sizes. Manifest reduces the min trade size to atomic and increases the the range of expressable prices to cover all that are needed.
- Anchor is great for starting on Solana, but more advanced programs should not take the compute tradeoff for the convenience.
- Rent is a critical cost savings for Manifest. This enables smaller value tokens with less volume to still have orderbooks.
- Manifest aims to be freedom maximizing, so is its open source GPL-3.0 License.
- Open orders separation was a necessary feature for margin trading. Read locks to get the open orders for a trader are frequent on a margin exchange. The default wrapper implementation of Manifest allows a margin exchange to read lock an account without significant contention and land its transactions more often.
- Number of accounts for a swap is a limiter for some routers. Manifest swaps that do not use global orders achieve the theoretical minimum number of accounts.
- CU is a major cost for market makers. Benchmarking demonstrates higher percentile CU improvements, significantly lessening the cost to actively trade.
- Silent failures are an unfortunate feature request from market makers because of how solana transactions work. Manifest rejects this at the infra level, but still allows those who need it to handle in the wrapper.
- Token 22 is the new version of token program. While it is not useful for defi and will make orderbooks less efficient, there are some notable tokens that will use it. Manifest only takes the performance hit to support token22 precisely when needed and moving token22 tokens, and only then.
- A new core vs. wrapper program architecture enables greater composability for traders and exchange interfaces. Customize feature sets and distribution for any market requirement.

## Design Overview
### Data Structure

The innovation that allows this next leap in onchain trading is the hypertree [`hypertree`](https://github.com/CKS-Systems/manifest/tree/main/lib). All data in the market account fits into graph nodes of the same size (80 bytes), which lets independent data structures grow without being fully initialized from the start by interleaving

The market account holds all relevant information. It begins with a header that stores all of the fixed information for the market like BaseMint, QuoteMint. All variable data (RestingOrders and ClaimedSeats) are in the dynamic
byte array after the header. There are 3 RedBlack trees for Bids, Asks,
ClaimedSeats and 1 LinkedList for FreeListNodes, overlapping across each other. All are graphs where each vertex along with adjacency list fits in 80 bytes, allowing them to use the same blocks.

<pre>
--------------------------------------------------------------------------------------------------------
|                   Header                    |                               Dynamic                   |
--------------------------------------------------------------------------------------------------------
| BaseMint, QuoteMint, BidsRootIndex, ...     | Bid | Ask | FreeListNode | Seat | Seat | Bid | Bid | Ask|
--------------------------------------------------------------------------------------------------------
</pre>

### Core vs Wrapper
Manifest implements the orderbook as an infrastructure layer primitive and creates the purest form of risk exchange possible. Other orderbooks get bogged down by special feature requests from trading teams that ultimately make the program bloated and confusing. Manifest strives to only include features that are absolutely necessary to be in the base layer. Anything that can be handled at layers above on the stack will not be done in manifest. This simplification makes formal verification of the program feasible.

Manifest should be interacted with though a wrapper program. Features like ClientOrderId, FillOrKill, PostOnlySlide, adjusting orders for insufficient funds, can and should be in a separate program that does a CPI into Manifest. A reference implementation and deployment of a wrapper are provided, showing what can be done outside the core of an orderbook without needing to be in the orderbook itself.

### Global Orders

Global orders are a new type of order for trading on Solana. When resting orders across many markets, cost of capital can be expensive. This is the problem that global orders look to address. A global order is an order that does not lock the tokens to support the order on the market. The same tokens that would have supported an order on one market, can now support orders across many markets, with the tokens moved just in time as there is a fill.

### Building

```
cargo build-sbf
```

### Testing

#### Program Test
```
cargo test-sbf
```

#### Typescript client test
```
sh local-validator-test.sh
```

