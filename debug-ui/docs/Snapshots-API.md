# Orderbook Snapshots API Documentation

This API provides access to historical orderbook data from Solana markets, capturing periodic snapshots of bids and asks with trader information.

## Base URL
```
https://mfx-orderbook-snapshots-mainnet.fly.dev
```

## Endpoints

### GET /snapshots

Retrieve raw orderbook snapshots with individual orders.

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `hours` | integer | 24 | Number of hours back from current time |
| `start` | integer | - | Start timestamp (Unix seconds) |
| `end` | integer | - | End timestamp (Unix seconds) |
| `market` | string | - | Filter by specific market address |
| `trader` | string | - | Filter by specific trader address |
| `limit` | integer | 1000 | Maximum number of results |

#### Example Requests

```bash
# Get last 24 hours of snapshots
GET /snapshots

# Get snapshots for last 6 hours
GET /snapshots?hours=6

# Get snapshots between specific timestamps
GET /snapshots?start=1717200000&end=1717286400

# Get snapshots for a specific market
GET /snapshots?market=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# Get orders from a specific trader
GET /snapshots?trader=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM

# Combined filters
GET /snapshots?hours=12&market=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&limit=500
```

#### Response Format

```json
{
  "data": [
    {
      "snapshot_id": 12345,
      "market": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "timestamp": 1717286400,
      "mid_price": "150.50",
      "best_bid": "150.25",
      "best_ask": "150.75",
      "volume_24h_usd": "25000.00",
      "side": "bid",
      "price": "150.25",
      "quantity": "100.0",
      "trader": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      "value_usd": "15025.00"
    }
  ],
  "meta": {
    "timeframe_hours": 24,
    "filters": {
      "market": null,
      "trader": null
    },
    "total_results": 1500,
    "query_timestamp": "2025-06-02T15:30:00.000Z"
  }
}
```

### GET /health

System health check and monitoring metrics.

#### Response Format

```json
{
  "status": "healthy",
  "timestamp": "2025-06-02T15:30:00.000Z",
  "metrics": {
    "recent_snapshots_1h": 120,
    "active_markets_1h": 15,
    "total_markets_monitored": 15,
    "expected_snapshots_per_hour": 180
  }
}
```

## Data Collection Rules

### Market Eligibility
- Minimum 24-hour volume: $1 USD
- USDC quote currency only
- Must have trading history (non-zero quote volume)

### Order Filtering
- **Guaranteed Orders**: First 10 orders on each side are always included
- **Spread Filter**: Orders beyond the first 10 are filtered to within 25% of reference price
- **Reference Price**: Mid-price when both bid/ask exist, otherwise best available price

### Snapshot Frequency
- Every 5 minutes
- Markets reloaded every hour

## Response Fields

### Snapshot Fields
- `snapshot_id`: Unique identifier for the snapshot
- `market`: Market address (Solana public key)
- `timestamp`: Unix timestamp of snapshot
- `mid_price`: Calculated mid-price between best bid/ask
- `best_bid`: Highest bid price
- `best_ask`: Lowest ask price  
- `volume_24h_usd`: 24-hour trading volume in USD

### Order Fields
- `side`: "bid" or "ask"
- `price`: Order price
- `quantity`: Order quantity in base tokens
- `trader`: Trader's public key
- `value_usd`: Calculated USD value (price × quantity)

## Error Responses

```json
{
  "error": "Internal server error"
}
```

## Rate Limits
No explicit rate limits currently implemented.

## CORS
Cross-origin requests are enabled for all domains.