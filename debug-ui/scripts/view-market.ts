import 'dotenv/config';

import { Connection, PublicKey } from '@solana/web3.js';
import { Market, RestingOrder } from '@cks-systems/manifest-sdk';
import { OrderType } from '@cks-systems/manifest-sdk/manifest/types';

const { RPC_URL } = process.env;

if (!RPC_URL) {
  throw new Error('RPC_URL missing from env');
}

const orderTypeToString = (orderType: OrderType): string => {
  switch (orderType) {
    case OrderType.Limit:
      return 'Limit';
    case OrderType.ImmediateOrCancel:
      return 'IOC';
    case OrderType.PostOnly:
      return 'PostOnly';
    case OrderType.Global:
      return 'Global';
    case OrderType.Reverse:
      return 'Reverse';
    case OrderType.ReverseTight:
      return 'ReverseTight';
    default:
      return `Unknown(${orderType})`;
  }
};

const formatExpiration = (lastValidSlot: bigint | number, orderType: OrderType): string => {
  // Reverse orders never expire
  if (orderType === OrderType.Reverse || orderType === OrderType.ReverseTight) {
    return 'Never';
  }
  const slot = Number(lastValidSlot);
  // 0 or max u32 means no expiration
  if (slot === 0 || slot === 4294967295) {
    return 'Never';
  }
  return slot.toString();
};

const formatPrice = (price: number): string => {
  if (price >= 1000) {
    return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  } else if (price >= 1) {
    return price.toFixed(4);
  } else if (price >= 0.0001) {
    return price.toFixed(6);
  } else {
    return price.toExponential(4);
  }
};

const formatSize = (size: number): string => {
  if (size >= 1000000) {
    return `${(size / 1000000).toFixed(2)}M`;
  } else if (size >= 1000) {
    return `${(size / 1000).toFixed(2)}K`;
  } else if (size >= 1) {
    return size.toFixed(4);
  } else {
    return size.toFixed(6);
  }
};

const printOrderTable = (
  orders: RestingOrder[],
  side: 'BID' | 'ASK',
): void => {
  const color = side === 'BID' ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';

  console.log(`\n${color}=== ${side}S ===${reset}`);
  console.log(
    `${'Price'.padStart(14)} | ${'Size'.padStart(14)} | ${'Type'.padStart(12)} | ${'Expiration'.padStart(20)} | Trader`,
  );
  console.log('-'.repeat(100));

  if (orders.length === 0) {
    console.log('  (no orders)');
    return;
  }

  for (const order of orders) {
    const price = formatPrice(order.tokenPrice);
    const size = formatSize(Number(order.numBaseTokens));
    const orderType = orderTypeToString(order.orderType);
    const expiration = formatExpiration(order.lastValidSlot, order.orderType);
    const trader = order.trader.toBase58().slice(0, 8) + '...';

    let typeDisplay = orderType;
    if ((order.orderType === OrderType.Reverse || order.orderType === OrderType.ReverseTight) && order.spreadBps !== undefined) {
      typeDisplay = `${orderType}(${order.spreadBps.toFixed(2)}bps)`;
    }

    console.log(
      `${color}${price.padStart(14)}${reset} | ${size.padStart(14)} | ${typeDisplay.padStart(12)} | ${expiration.padStart(20)} | ${trader}`,
    );
  }
};

const run = async () => {
  const marketPkArg = process.argv[2];
  if (!marketPkArg) {
    console.error('Usage: tsx scripts/view-market.ts <market_pubkey>');
    console.error('Example: tsx scripts/view-market.ts HyLPjWF8HQxF9iHCBpYPkVpR43SUNusoX4eZ5u2HYPt1');
    process.exit(1);
  }

  let marketPk: PublicKey;
  try {
    marketPk = new PublicKey(marketPkArg);
  } catch {
    console.error(`Invalid public key: ${marketPkArg}`);
    process.exit(1);
  }

  const connection = new Connection(RPC_URL!);

  console.log(`\nLoading market ${marketPk.toBase58()}...`);

  const market = await Market.loadFromAddress({
    connection,
    address: marketPk,
  });

  const currentSlot = await connection.getSlot();

  // Get bids and asks sorted by price (most competitive first)
  const bids = market.bidsL2(); // Already sorted best (highest) to worst
  const asks = market.asksL2(); // Already sorted best (lowest) to worst

  // Print market info
  console.log('\n' + '='.repeat(90));
  console.log(`MARKET: ${marketPk.toBase58()}`);
  console.log('='.repeat(90));
  console.log(`Base Mint:  ${market.baseMint().toBase58()}`);
  console.log(`Quote Mint: ${market.quoteMint().toBase58()}`);
  console.log(`Decimals:   Base=${market.baseDecimals()}, Quote=${market.quoteDecimals()}`);
  console.log(`Volume:     ${Number(market.quoteVolume()).toLocaleString()} quote atoms`);
  console.log(`Current Slot: ${currentSlot}`);

  const bestBid = market.bestBidPrice();
  const bestAsk = market.bestAskPrice();
  if (bestBid && bestAsk) {
    const spread = bestAsk - bestBid;
    const spreadPct = ((spread / bestAsk) * 100).toFixed(4);
    console.log(`\nBest Bid: ${formatPrice(bestBid)} | Best Ask: ${formatPrice(bestAsk)} | Spread: ${formatPrice(spread)} (${spreadPct}%)`);
  } else if (bestBid) {
    console.log(`\nBest Bid: ${formatPrice(bestBid)} | Best Ask: (none)`);
  } else if (bestAsk) {
    console.log(`\nBest Bid: (none) | Best Ask: ${formatPrice(bestAsk)}`);
  } else {
    console.log(`\nOrderbook is empty`);
  }

  console.log(`\nOrders: ${bids.length} bids, ${asks.length} asks`);

  // Print asks first (in reverse order so lowest ask is at bottom, closest to bids)
  const asksReversed = [...asks].reverse();
  printOrderTable(asksReversed, 'ASK');

  // Print bids
  printOrderTable(bids, 'BID');

  console.log('\n');
};

run().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
