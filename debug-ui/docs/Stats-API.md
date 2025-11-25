# Stats Server API Documentation

## Base URL
```
https://mfx-stats-mainnet.fly.dev
```

## Overview
The Stats Server provides comprehensive market data, trading analytics, and real-time fill information for the Manifest protocol. It aggregates data from WebSocket feeds and provides both CoinGecko-compatible and custom API endpoints.

---

## 📊 Market Data Endpoints

### `GET /tickers`
**CoinGecko-compatible endpoint** returning 24-hour market data for all active markets.

#### Response Format
```json
[
  {
    "ticker_id": "ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ",
    "base_currency": "So11111111111111111111111111111111111111112",
    "target_currency": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "last_price": 0.00004523,
    "base_volume": 1248765.50,
    "target_volume": 56475.25,
    "pool_id": "ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ",
    "liquidity_in_usd": 0
  }
]
```

#### Usage Examples
```bash
# Get all market tickers
curl "https://mfx-stats-mainnet.fly.dev/tickers"

# Filter in your application
curl "https://mfx-stats-mainnet.fly.dev/tickers" | jq '.[] | select(.base_volume > 10000)'
```

---

### `GET /metadata`
Returns token symbols and metadata for market display.

#### Response Format
```json  
{
  "ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ": ["SOL", "USDC"],
  "8BnEgHoWFysVcuFFX7QztDmzuH8r5ZFvyP3sYwn1XTh6": ["BTC", "USDC"]
}
```

#### Integration Example
```javascript
const tickers = await fetch('/tickers').then(r => r.json());
const metadata = await fetch('/metadata').then(r => r.json());

const enrichedTickers = tickers.map(ticker => ({
  ...ticker,
  baseSymbol: metadata[ticker.ticker_id]?.[0] || 'Unknown',
  quoteSymbol: metadata[ticker.ticker_id]?.[1] || 'Unknown'
}));
```

---

### `GET /orderbook`
Returns current orderbook state for a specific market.

#### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ticker_id` | string | Yes | Market address |
| `depth` | number | No | Max base tokens to include (0 = all) |

#### Examples
```bash
# Get full orderbook
curl "https://mfx-stats-mainnet.fly.dev/orderbook?ticker_id=ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ"

# Get orderbook with 1000 token depth
curl "https://mfx-stats-mainnet.fly.dev/orderbook?ticker_id=ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ&depth=1000"
```

#### Response Format
```json
{
  "ticker_id": "ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ",
  "bids": [
    [0.00004523, 1000.50],
    [0.00004522, 750.25]
  ],
  "asks": [
    [0.00004524, 500.75],
    [0.00004525, 250.10]
  ]
}
```

---

### `GET /volume`
**DefiLlama-compatible endpoint** returning volume data across all tokens.

#### Response Format
```json
{
  "totalVolume": {
    "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": 5847293.50
  },
  "dailyVolume": {
    "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": 284759.25,
    "solana:So11111111111111111111111111111111111111112": 6749.75
  }
}
```

#### Usage Notes
- Only includes USDC quote markets for `totalVolume`
- `dailyVolume` includes all tokens with 24h trading activity
- Volumes are in token units (not USD)

---

## 👤 Trading Analytics Endpoints

### `GET /traders`
Returns aggregated trading statistics for all active traders.

#### Query Parameters
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `debug` | boolean | false | Include detailed position data |

#### Examples
```bash
# Basic trader stats
curl "https://mfx-stats-mainnet.fly.dev/traders"

# Detailed stats with positions
curl "https://mfx-stats-mainnet.fly.dev/traders?debug=true"
```

#### Response Format (Basic)
```json
{
  "trader_address_1": {
    "taker": 45,
    "maker": 23,
    "takerNotionalVolume": 125847.50,
    "makerNotionalVolume": 89234.25,
    "pnl": 2847.75
  }
}
```

#### Response Format (Debug)
```json
{
  "trader_address_1": {
    "taker": 45,
    "maker": 23,
    "takerNotionalVolume": 125847.50,
    "makerNotionalVolume": 89234.25,
    "pnl": 2847.75,
    "_debug": {
      "totalPnL": 2847.75,
      "positions": {
        "So11111111111111111111111111111111111111112": {
          "tokenMint": "So11111111111111111111111111111111111111112",
          "marketKey": "ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ",
          "position": 125.50,
          "acquisitionValue": 5847.25,
          "currentPrice": 47.85,
          "marketValue": 6005.18,
          "pnl": 157.93
        }
      }
    }
  }
}
```

### `GET /traders/debug`
Shorthand for `/traders?debug=true`.

---

## 📈 Fill Data Endpoints

### `GET /recentFills`
Returns the most recent 1000 fills for a market (in-memory data).

#### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market` | string | Yes | Market address |

#### Example
```bash
curl "https://mfx-stats-mainnet.fly.dev/recentFills?market=ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ"
```

#### Response Format
```json
{
  "ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ": [
    {
      "market": "ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ",
      "baseAtoms": "125000000000",
      "quoteAtoms": "5847293",
      "priceAtoms": 0.00004678,
      "slot": 287459372,
      "taker": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      "maker": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      "originalSigner": "D5YqVMoSxnqeZAKAUUE1Dm3bmjtdxQ5DCF356ozqN9cM",
      "signature": "5shjRgGrup3tsbeVh5eqcwPLnDZEtytU95jJ9xmJz34bSmqrEe2WQPb69PFuenZWuL5QjdhEEGfEGFF8SuJ3vvJv",
      "takerSequenceNumber": "6347210",
      "makerSequenceNumber": "6347203"
    }
  ]
}
```

### `GET /completeFills` 🆕
**NEW:** Returns complete historical fill data with powerful filtering and pagination.

#### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market` | string | No | Filter by market address |
| `taker` | string | No | Filter by taker address |
| `maker` | string | No | Filter by maker address |
| `signature` | string | No | Find fills by transaction signature |
| `fromSlot` | number | No | Filter fills from this slot onwards |
| `toSlot` | number | No | Filter fills up to this slot |
| `limit` | number | No | Number of fills to return (default: 100, max: 1000) |
| `offset` | number | No | Number of fills to skip (default: 0) |

#### Examples

**Basic Market Query**
```bash
# Get latest 100 fills for SOL/USDC market
curl "https://mfx-stats-mainnet.fly.dev/completeFills?market=ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ&limit=100"
```

**Trader Analysis**
```bash
# Get all fills for a specific trader
curl "https://mfx-stats-mainnet.fly.dev/completeFills?taker=goLdsNm7gNrnHJ6dMu73ALm3y7ZK1Z2NFrqcsD2BR7y&limit=50"

# Get fills where trader was the maker
curl "https://mfx-stats-mainnet.fly.dev/completeFills?maker=CDY3cxDRUrcJp8DNhPS8X6CR3FGDjrErYv1PcgsEeNMV&limit=50"
```

**Transaction Lookup**
```bash
# Find fills by transaction signature
curl "https://mfx-stats-mainnet.fly.dev/completeFills?signature=2LHjKQ8DZpMCnUA1zMVvFoWHHdZ73Kg8rBQCj2kF74qhtCDyPpc64zygBuuvhfR6TndVM2JkhECMoagbCbJhXEwb"
```

**Time Range Analysis**
```bash
# Get fills in a specific slot range
curl "https://mfx-stats-mainnet.fly.dev/completeFills?market=ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ&fromSlot=345940000&toSlot=345942000"
```

**Pagination**
```bash
# Get fills with pagination
curl "https://mfx-stats-mainnet.fly.dev/completeFills?market=ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ&limit=25&offset=100"
```

**Complex Filtering**
```bash
# Combine multiple filters
curl "https://mfx-stats-mainnet.fly.dev/completeFills?market=ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ&taker=goLdsNm7gNrnHJ6dMu73ALm3y7ZK1Z2NFrqcsD2BR7y&fromSlot=345940000&limit=20"
```

#### Response Format
```json
{
  "fills": [
    {
      "slot": 345941709,
      "market": "ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ",
      "signature": "2LHjKQ8DZpMCnUA1zMVvFoWHHdZ73Kg8rBQCj2kF74qhtCDyPpc64zygBuuvhfR6TndVM2JkhECMoagbCbJhXEwb",
      "maker": "CDY3cxDRUrcJp8DNhPS8X6CR3FGDjrErYv1PcgsEeNMV",
      "taker": "goLdsNm7gNrnHJ6dMu73ALm3y7ZK1Z2NFrqcsD2BR7y",
      "baseAtoms": "153219783",
      "quoteAtoms": "24999999",
      "priceAtoms": 0.163164302,
      "takerIsBuy": true,
      "isMakerGlobal": false,
      "originalSigner": "goLdsNm7gNrnHJ6dMu73ALm3y7ZK1Z2NFrqcsD2BR7y",
      "makerSequenceNumber": "6347324",
      "takerSequenceNumber": "6347327"
    }
  ],
  "total": 7,
  "hasMore": false
}
```

#### JavaScript Integration Examples

**Trading History Component**
```javascript
async function getTradingHistory(trader, marketId, page = 0) {
  const limit = 50;
  const offset = page * limit;
  
  const response = await fetch(
    `/completeFills?taker=${trader}&market=${marketId}&limit=${limit}&offset=${offset}`
  );
  const data = await response.json();
  
  return {
    trades: data.fills.map(fill => ({
      txId: fill.signature,
      timestamp: fill.slot, // Convert to actual timestamp
      side: fill.takerIsBuy ? 'BUY' : 'SELL',
      amount: Number(fill.baseAtoms) / 1e9, // Adjust for decimals
      price: fill.priceAtoms,
      total: Number(fill.quoteAtoms) / 1e6  // USDC has 6 decimals
    })),
    pagination: {
      page,
      hasMore: data.hasMore,
      total: data.total
    }
  };
}
```

**Market Maker Analytics**
```javascript
async function getMarketMakerStats(makerAddress, days = 7) {
  // Calculate slot range for last N days (approximately)
  const currentSlot = 345942000; // Get from current block
  const slotsPerDay = 216000; // ~400ms per slot
  const fromSlot = currentSlot - (days * slotsPerDay);
  
  const response = await fetch(
    `/completeFills?maker=${makerAddress}&fromSlot=${fromSlot}&limit=1000`
  );
  const data = await response.json();
  
  const stats = data.fills.reduce((acc, fill) => {
    acc.totalTrades++;
    acc.totalVolume += Number(fill.quoteAtoms);
    if (fill.takerIsBuy) acc.buyTrades++;
    else acc.sellTrades++;
    return acc;
  }, { totalTrades: 0, totalVolume: 0, buyTrades: 0, sellTrades: 0 });
  
  return {
    ...stats,
    avgTradeSize: stats.totalVolume / stats.totalTrades,
    buyRatio: stats.buyTrades / stats.totalTrades
  };
}
```

**Transaction Verification**
```javascript
async function verifyTransaction(signature) {
  const response = await fetch(`/completeFills?signature=${signature}`);
  const data = await response.json();
  
  if (data.fills.length === 0) {
    return { found: false };
  }
  
  return {
    found: true,
    fill: data.fills[0],
    relatedFills: data.fills.length > 1 ? data.fills.slice(1) : []
  };
}
```

**Enhanced Chart Data**
```javascript
async function getChartData(marketId, timeRange = '24h') {
  const slotRanges = {
    '1h': 9000,   // ~1 hour in slots
    '24h': 216000, // ~24 hours in slots
    '7d': 1512000  // ~7 days in slots
  };
  
  const currentSlot = 345942000; // Get from current block
  const fromSlot = currentSlot - slotRanges[timeRange];
  
  const response = await fetch(
    `/completeFills?market=${marketId}&fromSlot=${fromSlot}&limit=1000`
  );
  const data = await response.json();
  
  return data.fills.map(fill => ({
    timestamp: fill.slot, // Convert to actual timestamp if needed
    price: fill.priceAtoms,
    volume: Number(fill.baseAtoms) / 1e9,
    side: fill.takerIsBuy ? 'buy' : 'sell',
    txId: fill.signature
  }));
}
```

---

## 🔧 Utility Endpoints

### `GET /alts`
Returns Address Lookup Table (ALT) mappings for transaction optimization.

#### Response Format
```json
[
  {
    "alt": "ALT4rDL7WGV7cHVmKNQBhwkdJWfqrMJjVMRHhNQo2T5s",
    "market": "ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ"
  }
]
```

### `GET /health`
Service health check endpoint.

#### Response Format
```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T14:30:00.000Z"
}
```

---

### `GET /checkpoints`
Returns volume checkpoint data for all markets including timestamps.

#### Response Format
```json
{
  "ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ": {
    "baseCheckpoints": [1248765, 989234, 1123456, ...],
    "quoteCheckpoints": [56475, 45234, 52134, ...],
    "timestamps": [1736946000, 1736946300, 1736946600, ...]
  }
}
```

#### Usage Notes
- Each checkpoint represents a 5-minute period
- Arrays contain up to 288 checkpoints (24 hours worth)
- Timestamps are Unix timestamps in seconds
- Only checkpoints from the last 24 hours are used for volume calculations

---

## 🎯 Common Use Cases

### Trading Interface
```javascript
// Get market data for trading interface
const [tickers, metadata] = await Promise.all([
  fetch('/tickers').then(r => r.json()),
  fetch('/metadata').then(r => r.json())
]);

// Enrich with symbols
const markets = tickers.map(ticker => ({
  address: ticker.ticker_id,
  baseSymbol: metadata[ticker.ticker_id]?.[0],
  quoteSymbol: metadata[ticker.ticker_id]?.[1],
  price: ticker.last_price,
  volume24h: ticker.base_volume
}));
```

### Trader Leaderboard
```javascript
// Get trader leaderboard by volume
const traders = await fetch('/traders').then(r => r.json());
const leaderboard = Object.entries(traders)
  .map(([address, stats]) => ({
    address,
    totalVolume: stats.takerNotionalVolume + stats.makerNotionalVolume,
    pnl: stats.pnl,
    trades: stats.taker + stats.maker
  }))
  .sort((a, b) => b.totalVolume - a.totalVolume)
  .slice(0, 10);
```

### Enhanced Historical Analysis
```javascript
// Get complete trader history across all markets
const traders = await fetch('/traders').then(r => r.json());
const topTrader = Object.keys(traders)[0];

const completeHistory = await fetch(
  `/completeFills?taker=${topTrader}&limit=500`
).then(r => r.json());

const portfolioAnalysis = completeHistory.fills.reduce((acc, fill) => {
  const market = fill.market;
  if (!acc[market]) acc[market] = { trades: 0, volume: 0 };
  acc[market].trades++;
  acc[market].volume += Number(fill.quoteAtoms);
  return acc;
}, {});
```

### Market Maker Dashboard
```javascript
// Comprehensive market maker analytics
async function getMarketMakerDashboard(makerAddress) {
  const [recentActivity, allTimeStats] = await Promise.all([
    // Recent activity (last 1000 fills)
    fetch(`/completeFills?maker=${makerAddress}&limit=1000`).then(r => r.json()),
    // All-time stats from trader endpoint
    fetch('/traders').then(r => r.json())
  ]);
  
  const makerStats = allTimeStats[makerAddress] || {};
  const recentFills = recentActivity.fills;
  
  return {
    allTime: makerStats,
    recent: {
      trades: recentFills.length,
      markets: [...new Set(recentFills.map(f => f.market))],
      totalVolume: recentFills.reduce((sum, f) => sum + Number(f.quoteAtoms), 0)
    }
  };
}
```

### Real-time Price Feed
```javascript
// Combine with WebSocket for real-time updates
const wsUrl = 'wss://mfx-feed-mainnet.fly.dev';
const ws = new WebSocket(wsUrl);

ws.onmessage = (event) => {
  const fill = JSON.parse(event.data);
  updatePriceChart(fill.market, fill.priceAtoms);
};

// Fallback to polling for recent fills
setInterval(async () => {
  const fills = await fetch(`/recentFills?market=${marketId}`).then(r => r.json());
  // Process recent fills
}, 5000);
```

---

## ⚡ Performance & Rate Limiting

### Response Times
- `/tickers`: ~200ms (cached every 5 minutes)
- `/orderbook`: ~100ms (real-time)
- `/traders`: ~500ms (heavy computation)
- `/recentFills`: ~50ms (in-memory)
- `/completeFills`: ~100-500ms (database query, varies by filters)

### Caching Strategy
- Market data cached for 5 minutes
- Orderbook data refreshed on demand
- Recent fill data stored in memory (last 1000 per market)
- Complete fills stored permanently in database with efficient indexing

### Database Performance
- **Signature index**: Fast transaction lookups
- **Market + timestamp index**: Efficient time-range queries
- **Trader indexes**: Quick trader analysis
- **Pagination**: Optimized with COUNT queries and LIMIT/OFFSET

### Rate Limits
- No formal rate limits currently
- Recommend max 10 requests/second per client
- Use WebSocket feed for real-time updates instead of polling

---

## 🔍 Data Sources

### Real-time Data
- WebSocket feed from Solana transaction logs
- On-chain market account parsing
- Direct RPC calls for orderbook data

### Historical Data
- PostgreSQL database with 5-minute checkpoints
- Complete fill history stored permanently
- 24-hour rolling windows for volume calculations
- Position tracking for PnL calculations

### Data Quality
- Automatic reconnection on feed failures
- Data validation and error handling
- Graceful degradation on RPC failures
- Deduplication using signature + sequence numbers

---

## 🚨 Error Handling

### Common Error Responses
```json
{
  "error": "Market not found"
}
```

### HTTP Status Codes
- `200 OK`: Success
- `400 Bad Request`: Invalid parameters
- `404 Not Found`: Market/trader not found
- `500 Internal Server Error`: Server error
- `503 Service Unavailable`: Temporary outage

### Retry Strategy
```javascript
async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
}
```

---

## 📊 Monitoring

### Prometheus Metrics
Available at `https://mfx-stats-mainnet.fly.dev:9090/metrics`:
- `fills_total` - Total fills processed
- `volume_24h` - 24-hour volume by market
- `last_price` - Current prices
- `reconnects_total` - WebSocket reconnections

### Health Monitoring
```bash
# Simple health check
curl -f https://mfx-stats-mainnet.fly.dev/health || echo "Service down"

# Detailed monitoring
curl -s https://mfx-stats-mainnet.fly.dev/tickers | jq 'length' # Market count

# Database health
curl -s "https://mfx-stats-mainnet.fly.dev/completeFills?limit=1" | jq '.total' # Total fills
```