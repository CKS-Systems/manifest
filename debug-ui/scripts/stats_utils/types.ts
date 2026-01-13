import { FillLogResult } from '@cks-systems/manifest-sdk';

/**
 * Query options for fetching complete fills from database
 */
export interface CompleteFillsQueryOptions {
  /** Filter by market address */
  market?: string;
  /** Filter by taker address */
  taker?: string;
  /** Filter by maker address */
  maker?: string;
  /** Filter by transaction signature */
  signature?: string;
  /** Maximum number of results to return (default: 100) */
  limit?: number;
  /** Number of results to skip (for pagination) */
  offset?: number;
  /** Filter fills from this slot onwards */
  fromSlot?: number;
  /** Filter fills up to this slot */
  toSlot?: number;
}

/**
 * Response from fetching complete fills from database
 */
export interface CompleteFillsQueryResult {
  /** Array of fill log results */
  fills: FillLogResult[];
  /** Whether there are more results available */
  hasMore: boolean;
}
