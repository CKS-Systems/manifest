# Manifest Developer UI

A comprehensive developer interface for the Manifest decentralized exchange protocol built with Next.js, featuring real-time market data, trading tools, and analytics.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and Yarn
- PostgreSQL database (for stats server persistence)
- Solana RPC endpoint

### Installation

1. **Clone and install dependencies**
   ```bash
   git clone <repository>
   cd debug-ui
   yarn install
   ```

2. **Configure environment variables**
   
   Create `.env.local` for the UI:
   ```bash
   cp .env.example .env.local
   ```
   
   Required variables in `.env.local`:
   ```env
   NEXT_PUBLIC_RPC_URL=https://api.mainnet-beta.solana.com
   NEXT_PUBLIC_READ_ONLY=false
   NEXT_PUBLIC_FEED_URL=wss://mfx-feed-mainnet.fly.dev
   ```

   Create `.env` for scripts:
   ```bash
   # RPC Configuration
   RPC_URL=https://api.mainnet-beta.solana.com
   
   # Database (for stats server)
   DATABASE_URL=postgresql://user:password@host:port/database
   
   # Trading Bot Keys (optional)
   MARKET_CREATOR_PRIVATE_KEY=1,2,3...
   ALICE_PRIVATE_KEY=1,2,3...
   BOB_PRIVATE_KEY=1,2,3...
   CHARLIE_PRIVATE_KEY=1,2,3...
   
   # Market Address (optional)
   MARKET_ADDRESS=ABC123...
   ```

### Development

```bash
# Start the development server
yarn dev

# Start the fill feed (in separate terminal)
yarn start:feed

# Optional: Run trading bot simulation
yarn run:rando-bot
```

The UI will be available at [http://localhost:3000](http://localhost:3000)

## 📊 Stats Server API

The stats server provides comprehensive market data and analytics for the Manifest protocol.

### Base URL
```
https://mfx-stats-mainnet.fly.dev
```

### Authentication
No authentication required for current endpoints.

---

## 📋 API Endpoints

### Market Data

#### `GET /tickers`
Returns market data compatible with CoinGecko API standards.

**Response:**
```json
[
  {
    "ticker_id": "ABC123...",
    "base_currency": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "target_currency": "So11111111111111111111111111111111111111112",
    "last_price": 0.00001234,
    "base_volume": 1000000.50,
    "target_volume": 12.34,
    "pool_id": "ABC123...",
    "liquidity_in_usd": 0
  }
]
```

#### `GET /orderbook`
Returns orderbook data for a specific market.

**Query Parameters:**
- `ticker_id` (required): Market address
- `depth` (optional): Number of base tokens to include (0 = all orders)

**Example:**
```bash
curl "https://mfx-stats-mainnet.fly.dev/orderbook?ticker_id=ABC123&depth=1000"
```

**Response:**
```json
{
  "ticker_id": "ABC123...",
  "bids": [
    [0.00001234, 1000.50],
    [0.00001233, 500.25]
  ],
  "asks": [
    [0.00001235, 750.75],
    [0.00001236, 250.10]
  ]
}
```

#### `GET /volume`
Returns volume data compatible with DefiLlama standards.

**Response:**
```json
{
  "totalVolume": {
    "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": 1000000.50
  },
  "dailyVolume": {
    "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": 50000.25,
    "solana:So11111111111111111111111111111111111111112": 1250.75
  }
}
```

#### `GET /metadata`
Returns token symbols and metadata for all markets.

**Response:**
```json
{
  "ABC123...": ["BTC", "USDC"],
  "DEF456...": ["ETH", "USDC"]
}
```

### Trading Data

#### `GET /traders`
Returns trading statistics and leaderboard data.

**Query Parameters:**
- `debug=true` (optional): Include detailed position information

**Response:**
```json
{
  "trader_address_1": {
    "taker": 25,
    "maker": 15,
    "takerNotionalVolume": 125000.50,
    "makerNotionalVolume": 75000.25,
    "pnl": 1250.75
  }
}
```

#### `GET /traders/debug`
Returns detailed trading data including position breakdowns.

**Response includes additional `_debug` field:**
```json
{
  "trader_address_1": {
    "taker": 25,
    "maker": 15,
    "takerNotionalVolume": 125000.50,
    "makerNotionalVolume": 75000.25,
    "pnl": 1250.75,
    "_debug": {
      "totalPnL": 1250.75,
      "positions": {
        "token_mint_1": {
          "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "marketKey": "ABC123...",
          "position": 1000.50,
          "acquisitionValue": 1000.00,
          "currentPrice": 1.0005,
          "marketValue": 1000.50,
          "pnl": 0.50
        }
      }
    }
  }
}
```

#### `GET /recentFills`
Returns recent fill data for a specific market.

**Query Parameters:**
- `market` (required): Market address

**Example:**
```bash
curl "https://mfx-stats-mainnet.fly.dev/recentFills?market=ABC123"
```

**Response:**
```json
{
  "ABC123...": [
    {
      "market": "ABC123...",
      "baseAtoms": "1000000",
      "quoteAtoms": "1234",
      "priceAtoms": 0.001234,
      "slot": 123456789,
      "taker": "trader1...",
      "maker": "trader2...",
      "originalSigner": "aggregator..."
    }
  ]
}
```

### Utility Endpoints

#### `GET /alts`
Returns Address Lookup Table mappings for markets.

**Response:**
```json
[
  {
    "alt": "ALT_ADDRESS_1",
    "market": "MARKET_ADDRESS_1"
  }
]
```

#### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T12:00:00.000Z"
}
```

---

## 🛠 Available Scripts

### Core Scripts

- `yarn dev` - Start development server
- `yarn build` - Build for production
- `yarn start` - Start production server
- `yarn lint` - Run ESLint

### Utility Scripts

- `yarn start:feed` - Start the fill feed server
- `yarn run:rando-bot` - Run trading bot simulation
- `yarn stats-server` - Start the stats server
- `yarn liquidity-monitoring` - Start liquidity monitoring

### Management Scripts

- `yarn balance-checker` - Check market balance integrity
- `yarn cancel-reverse` - Cancel reverse orders (admin only)
- `yarn update-alts` - Update Address Lookup Tables
- `yarn pk-solflare-to-phantom` - Convert private key formats

---

## 🏗 Architecture

### Frontend (Next.js)
- **Pages**: Market trading interface, analytics dashboard
- **Components**: Reusable UI components for trading
- **Hooks**: Custom hooks for blockchain interactions
- **Utils**: Helper functions and utilities

### Backend Services

#### Stats Server (`stats-server.ts`)
- Real-time market data aggregation
- Trading statistics and PnL tracking
- WebSocket feed processing
- PostgreSQL persistence
- Prometheus metrics

#### Fill Feed (`start-fill-feed.ts`)
- Real-time transaction log parsing
- Fill event broadcasting
- WebSocket server for live updates

#### Liquidity Monitor (`liquidity-monitoring.ts`)
- Market maker depth analysis
- Uptime tracking
- REST API for liquidity data
- Configurable spread analysis (10, 50, 100, 200 bps)

### Database Schema

The stats server uses PostgreSQL with the following main tables:

- `state_checkpoints` - System state snapshots
- `market_volumes` - Volume tracking by market
- `trader_stats` - Trading activity statistics
- `trader_positions` - Position tracking for PnL
- `fill_log_results` - Recent fill history
- `alt_markets` - Address Lookup Table mappings

---

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_RPC_URL` | Solana RPC endpoint | Yes |
| `NEXT_PUBLIC_READ_ONLY` | UI read-only mode | Yes |
| `NEXT_PUBLIC_FEED_URL` | WebSocket feed URL | Yes |
| `DATABASE_URL` | PostgreSQL connection string | Optional* |
| `RPC_URL` | RPC endpoint for scripts | Yes |

*Required for data persistence in stats server

### Network Configuration

#### Mainnet
```env
NEXT_PUBLIC_RPC_URL=https://api.mainnet-beta.solana.com
NEXT_PUBLIC_FEED_URL=wss://mfx-feed-mainnet.fly.dev
```

#### Devnet
```env
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_FEED_URL=wss://mfx-feed-devnet.fly.dev
```

---

## 🐛 Known Issues

### Wallet Compatibility
- **Solflare**: Network mismatch error when signing devnet transactions
  - Error: "Your current network is set to devnet, but this transaction is for mainnet"
  - **Workaround**: Use Phantom wallet for devnet testing

### Rate Limiting
- Some RPC endpoints may rate limit frequent requests
- Consider using paid RPC services for production

---

## 📊 Monitoring

### Prometheus Metrics
Both the stats server and fill feed expose Prometheus metrics on port 9090:

- `fills` - Number of fills processed
- `volume` - 24-hour volume by market and token
- `last_price` - Latest trade prices
- `depth` - Market maker depth by trader
- `reconnects` - WebSocket reconnection count

### Grafana Dashboard
Configure Grafana to scrape metrics from:
- Stats server: `http://localhost:9090/metrics`
- Fill feed: `http://localhost:9090/metrics`
- Liquidity monitor: `http://localhost:9090/metrics`

---

## 🚀 Deployment

### Production Build
```bash
yarn build
yarn start
```

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build
EXPOSE 3000
CMD ["yarn", "start"]
```

### Service Dependencies
Ensure the following services are running in production:
1. PostgreSQL database
2. Solana RPC endpoint
3. WebSocket feed server

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

### Development Guidelines
- Follow TypeScript best practices
- Use ESLint configuration provided
- Test thoroughly with different wallet providers
- Update API documentation for new endpoints

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 🔗 Links

- [Manifest Protocol Documentation](https://docs.manifest.trade)
- [Solana Documentation](https://docs.solana.com)
- [Next.js Documentation](https://nextjs.org/docs)