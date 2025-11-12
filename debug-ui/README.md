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

### Running Stats Server in Read-Only Mode

For debugging database issues locally without making any writes to the database:

```bash
# Set READ_ONLY environment variable
READ_ONLY=true yarn stats
```

In read-only mode:
- All database write operations are skipped
- The server can still read from the database
- Fill processing and metrics collection still work
- State is not persisted to the database
- Useful for local debugging without affecting production data

## 📊 API Documentation

The Manifest protocol provides comprehensive APIs for market data, trading analytics, and liquidity monitoring.

### Quick API Overview

| Service | Base URL | Purpose |
|---------|----------|---------|
| **Stats Server** | `https://mfx-stats-mainnet.fly.dev` | Market data, trading analytics, real-time fills |
| **Liquidity Monitor** | `https://mfx-liquidity-monitor-mainnet.fly.dev` | Market maker analytics, uptime tracking |

### 📚 Detailed Documentation

- **[📈 Stats Server API](./docs/stats-api.md)** - Complete reference for market data, trading analytics, and real-time endpoints
- **[💧 Liquidity Monitor API](./docs/liquidity-api.md)** - Market maker analytics, depth tracking, and performance monitoring

### Key Endpoints Quick Reference

```bash
# Market data (CoinGecko compatible)
curl "https://mfx-stats-mainnet.fly.dev/tickers"

# Real-time orderbook
curl "https://mfx-stats-mainnet.fly.dev/orderbook?ticker_id=MARKET_ADDRESS"

# Trading leaderboard
curl "https://mfx-stats-mainnet.fly.dev/traders"

# Market maker analytics
curl "http://https://mfx-liquidity-monitor-mainnet.fly.dev/market-makers?hours=24"
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
- `yarn stats` - Start the stats server
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
| `READ_ONLY` | Stats server read-only mode (set to `true`) | No |

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

### 📖 Documentation
- **[Stats Server API](./docs/stats-api.md)** - Complete API reference for market data and analytics
- **[Liquidity Monitor API](./docs/liquidity-api.md)** - Market maker analytics and monitoring endpoints

### 🌐 External Resources
- [Manifest Protocol Documentation](https://docs.manifest.trade)
- [Solana Documentation](https://docs.solana.com)
- [Next.js Documentation](https://nextjs.org/docs)