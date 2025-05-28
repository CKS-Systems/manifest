# Liquidity Monitor API Guide

## Base URL
```
http://localhost:3001
```

## Authentication
No authentication required for current endpoints.

---

## Endpoints Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/market-makers` | GET | Market maker statistics with aggregated metrics |
| `/market-makers/raw` | GET | Raw timestamped market maker data points |
| `/markets` | GET | Market overview statistics |
| `/health` | GET | Health check |

---

## 📊 Market Maker Statistics

### `GET /market-makers`

Returns aggregated market maker statistics with uptime and depth averages.

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `market` | string | - | Filter by specific market address |
| `trader` | string | - | Filter by specific trader address |
| `hours` | number | 24 | Hours back to look (ignored if timestamps provided) |
| `start` | number | - | Start timestamp (Unix seconds) |
| `end` | number | - | End timestamp (Unix seconds) |
| `limit` | number | 100 | Maximum number of results |

#### Time Period Priority
1. **Unix timestamps** (if provided): `start` and/or `end` parameters
2. **Hours**: `hours` parameter (only used if no timestamps provided)

#### Example Requests

```bash
# Get daily market makers (default)
curl "http://localhost:3001/market-makers"

# Get market makers for last 6 hours
curl "http://localhost:3001/market-makers?hours=6"

# Get specific market's makers for last week
curl "http://localhost:3001/market-makers?market=ABC123&hours=168"

# Get specific trader's performance
curl "http://localhost:3001/market-makers?trader=XYZ789&hours=24"

# Use unix timestamps for precise time range
curl "http://localhost:3001/market-makers?start=1640995200&end=1641081600"

# Mixed: from timestamp to now
curl "http://localhost:3001/market-makers?start=1640995200"

# Limit results
curl "http://localhost:3001/market-makers?limit=20"
```

#### Response Format

```json
{
  "data": [
    {
      "market": "ABC123...",
      "trader": "XYZ789...",
      "last_active": "2025-01-15T10:30:00.000Z",
      "first_seen": "2025-01-14T08:00:00.000Z",
      "total_samples": 144,
      "active_samples": 128,
      "uptime_percentage": 88.89,
      "tracking_hours": 26.5,
      "avg_bid_depth": 1500.50,
      "avg_ask_depth": 1200.75,
      "avg_notional_usd": 2500.25,
      "avg_bid_depth_100_bps": 1500.50,
      "avg_ask_depth_100_bps": 1200.75,
      "total_avg_depth": 2701.25,
      "volume_24h_usd": 125000.00,
      "last_price": 0.95,
      "tracking_period": "1.1 days",
      "uptime_percent": 88.9,
      "first_seen_timestamp": 1642147200,
      "last_active_timestamp": 1642233000
    }
  ],
  "meta": {
    "timeframe_hours": 24,
    "start_timestamp": null,
    "end_timestamp": null,
    "total_results": 1,
    "query_timestamp": "2025-01-15T12:00:00.000Z"
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `market` | string | Market address |
| `trader` | string | Trader/market maker address |
| `last_active` | string | ISO timestamp of last activity |
| `first_seen` | string | ISO timestamp when first detected |
| `total_samples` | number | Total data points collected |
| `active_samples` | number | Data points where trader was active |
| `uptime_percentage` | number | Percentage of time active (0-100) |
| `tracking_hours` | number | Hours between first and last seen |
| `avg_bid_depth_100_bps` | number | Average bid depth at 100bps spread |
| `avg_ask_depth_100_bps` | number | Average ask depth at 100bps spread |
| `total_avg_depth` | number | Sum of avg bid + ask depth |
| `avg_notional_usd` | number | Average total notional in USD |
| `volume_24h_usd` | number | Market's 24h volume |
| `last_price` | number | Market's last price |
| `tracking_period` | string | Human readable tracking period |
| `uptime_percent` | number | Rounded uptime percentage |
| `first_seen_timestamp` | number | Unix timestamp of first seen |
| `last_active_timestamp` | number | Unix timestamp of last activity |

---

## 📈 Raw Market Maker Data

### `GET /market-makers/raw`

Returns raw, timestamped market maker data points. Perfect for building charts and detailed analysis.

#### Query Parameters

Same as `/market-makers` endpoint.

#### Example Requests

```bash
# Get raw data for charting
curl "http://localhost:3001/market-makers/raw?trader=XYZ789&hours=24"

# Get raw data for specific time period
curl "http://localhost:3001/market-makers/raw?start=1640995200&end=1641081600"

# Get raw data for specific market
curl "http://localhost:3001/market-makers/raw?market=ABC123&limit=500"
```

#### Response Format

```json
{
  "data": [
    {
      "id": 12345,
      "market": "ABC123...",
      "trader": "XYZ789...",
      "timestamp": "2025-01-15T10:30:00.000Z",
      "timestamp_unix": 1642233000,
      "is_active": true,
      "total_notional_usd": 2500.25,
      "bid_depth_10_bps": 500.00,
      "bid_depth_50_bps": 1200.00,
      "bid_depth_100_bps": 1500.50,
      "bid_depth_200_bps": 2000.00,
      "ask_depth_10_bps": 400.00,
      "ask_depth_50_bps": 800.00,
      "ask_depth_100_bps": 1200.75,
      "ask_depth_200_bps": 1800.00
    }
  ],
  "meta": {
    "timeframe_hours": 24,
    "start_timestamp": null,
    "end_timestamp": null,
    "total_results": 1,
    "query_timestamp": "2025-01-15T12:00:00.000Z"
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Unique record ID |
| `market` | string | Market address |
| `trader` | string | Trader address |
| `timestamp` | string | ISO timestamp of data point |
| `timestamp_unix` | number | Unix timestamp |
| `is_active` | boolean | Whether trader was active at this time |
| `total_notional_usd` | number | Total notional value in USD |
| `bid_depth_*_bps` | number | Bid depth at various spreads (10, 50, 100, 200 bps) |
| `ask_depth_*_bps` | number | Ask depth at various spreads (10, 50, 100, 200 bps) |

---

## 🏪 Market Statistics

### `GET /markets`

Returns overview statistics for all monitored markets.

#### Example Request

```bash
curl "http://localhost:3001/markets"
```

#### Response Format

```json
[
  {
    "market": "ABC123...",
    "volume_24h_usd": 125000.00,
    "last_price": 0.95,
    "timestamp": "2025-01-15T12:00:00.000Z",
    "unique_makers_24h": 15,
    "unique_makers_current": 8
  }
]
```

---

## ❤️ Health Check

### `GET /health`

Simple health check endpoint.

#### Example Request

```bash
curl "http://localhost:3001/health"
```

#### Response Format

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T12:00:00.000Z"
}
```

---

## 🕒 Time Period Examples

### Common Use Cases

```bash
# Real-time dashboard (last hour)
/market-makers?hours=1

# Daily leaderboard
/market-makers?hours=24

# Weekly performance
/market-makers?hours=168

# Trading session analysis (8 hours)
/market-makers?hours=8

# Specific date range
/market-makers?start=1640995200&end=1641081600

# From specific time to now
/market-makers?start=1640995200

# Up to specific time
/market-makers?end=1641081600
```

### Converting Timestamps

```javascript
// JavaScript: Convert Date to Unix timestamp
const unixTimestamp = Math.floor(new Date('2025-01-15T00:00:00Z').getTime() / 1000);

// JavaScript: Convert Unix timestamp to Date
const date = new Date(unixTimestamp * 1000);
```

---

## 📊 Dashboard Integration Examples

### Market Maker Leaderboard

```javascript
// Get top 20 market makers by uptime
const response = await fetch('/market-makers?hours=24&limit=20');
const { data } = await response.json();

// Sort by uptime (already sorted by API)
const leaderboard = data.map(mm => ({
  trader: mm.trader,
  uptime: mm.uptime_percent,
  depth: mm.total_avg_depth,
  period: mm.tracking_period
}));
```

### Market Maker Activity Chart

```javascript
// Get raw data for charting specific trader
const response = await fetch('/market-makers/raw?trader=XYZ789&hours=24');
const { data } = await response.json();

// Format for chart library
const chartData = data.map(point => ({
  x: point.timestamp_unix * 1000, // Convert to milliseconds
  y: point.total_notional_usd,
  active: point.is_active
}));
```

### Market Overview Dashboard

```javascript
// Get market stats
const marketsResponse = await fetch('/markets');
const markets = await marketsResponse.json();

// Get active market makers count
const mmResponse = await fetch('/market-makers?hours=1&limit=1000');
const { data: activeMMs } = await mmResponse.json();

const dashboard = {
  totalMarkets: markets.length,
  totalVolume24h: markets.reduce((sum, m) => sum + m.volume_24h_usd, 0),
  activeMarketMakers: activeMMs.length,
  avgUptime: activeMMs.reduce((sum, mm) => sum + mm.uptime_percentage, 0) / activeMMs.length
};
```

---

## 🚀 Performance Tips

1. **Use appropriate time windows**: Shorter periods = faster queries
2. **Add limits**: Use `limit` parameter to prevent large responses
3. **Cache responses**: Market data doesn't change frequently
4. **Use raw endpoint for charts**: More efficient for time-series data
5. **Filter by market/trader**: Reduces query scope significantly

---

## 📝 Error Responses

All endpoints return appropriate HTTP status codes:

- `200 OK`: Success
- `400 Bad Request`: Invalid parameters
- `500 Internal Server Error`: Server error

Error response format:
```json
{
  "error": "Error description"
}
```

---

## 🔧 Configuration

Current configuration constants:
- `MIN_VOLUME_THRESHOLD_USD`: $10,000 (minimum market volume)
- `MIN_NOTIONAL_USD`: $10 (minimum trader notional)
- `MONITORING_INTERVAL_MS`: 60,000ms (1 minute)
- `SPREAD_BPS`: [10, 50, 100, 200] (0.1%, 0.5%, 1%, 2%)
- `PORT`: 3001