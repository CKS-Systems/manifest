import { sleep } from '@/lib/util';
import { KNOWN_AGGREGATORS, SOL_MINT, CBBTC_MINT, WBTC_MINT, STABLECOIN_MINTS } from './constants';
import { AccountInfo, GetProgramAccountsResponse, PublicKey } from '@solana/web3.js';
import { Market } from '@cks-systems/manifest-sdk';

/**
 * Retry a database operation with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delay = 1000,
): Promise<T> {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.error(
        `Database operation failed (attempt ${attempt + 1}/${maxRetries}):`,
        error,
      );
      lastError = error;
      if (attempt < maxRetries - 1) {
        await sleep(delay * Math.pow(2, attempt)); // Exponential backoff
      }
    }
  }
  throw lastError;
}

/**
 * Check if an address is a known aggregator
 */
export function isKnownAggregator(address: string): boolean {
  return KNOWN_AGGREGATORS.has(address);
}

/**
 * Resolve the actual trader address, accounting for known aggregators
 */
export function resolveActualTrader(
  trader: string,
  originalSigner?: string,
): string {
  if (originalSigner && isKnownAggregator(trader)) {
    return originalSigner;
  }
  return trader;
}

/**
 * Split an array into chunks of a given size
 */
export function chunks<T>(array: T[], size: number): T[][] {
  return Array.apply(0, new Array(Math.ceil(array.length / size))).map(
    (_, index) => array.slice(index * size, (index + 1) * size),
  );
}

/**
 * Calculate lifetime volume across all markets in USDC equivalent
 * @param marketProgramAccounts - Array of market program accounts
 * @param solPrice - SOL price in USDC (normalized)
 * @param cbbtcPrice - CBBTC price in USDC (normalized)
 * @returns Total lifetime volume in USDC equivalent
 */
export function getLifetimeVolumeForMarkets(
  marketProgramAccounts: GetProgramAccountsResponse,
  solPrice: number,
  cbbtcPrice: number,
): number {
  return marketProgramAccounts
    .map(
      (
        value: Readonly<{
          account: AccountInfo<Buffer>;
          pubkey: PublicKey;
        }>,
      ) => {
        try {
          const marketPk: string = value.pubkey.toBase58();
          const market: Market = Market.loadFromBuffer({
            buffer: value.account.data,
            address: new PublicKey(marketPk),
          });
          const quoteMint = market.quoteMint().toBase58();

          // Track stablecoin quote volume directly (USDC, USDT, PYUSD, USDS, USD1)
          if (STABLECOIN_MINTS.has(quoteMint)) {
            return (
              Number(market.quoteVolume()) / 10 ** market.quoteDecimals()
            );
          }

          // Convert SOL quote volume to USDC equivalent
          if (quoteMint == SOL_MINT && solPrice > 0) {
            const solVolumeNormalized =
              Number(market.quoteVolume()) / 10 ** market.quoteDecimals();
            return solVolumeNormalized * solPrice;
          }

          // Convert CBBTC/WBTC quote volume to USDC equivalent
          if (
            (quoteMint == CBBTC_MINT || quoteMint == WBTC_MINT) &&
            cbbtcPrice > 0
          ) {
            const cbbtcVolumeNormalized =
              Number(market.quoteVolume()) / 10 ** market.quoteDecimals();
            return cbbtcVolumeNormalized * cbbtcPrice;
          }

          return 0;
        } catch (err) {
          console.error('Error processing market account:', err);
          return 0;
        }
      },
    )
    .reduce((sum, num) => sum + num, 0);
}
