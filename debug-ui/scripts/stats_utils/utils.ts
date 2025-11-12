import { sleep } from '@/lib/util';
import { KNOWN_AGGREGATORS } from './constants';

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
