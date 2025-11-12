import { Market } from '@cks-systems/manifest-sdk';
import { SOL_MINT, SOL_USDC_MARKET, USDC_MINT } from './constants';

export interface TraderPnLDetails {
  totalPnL: number;
  positions: {
    [mint: string]: {
      tokenMint: string;
      marketKey: string | null;
      position: number;
      acquisitionValue: number;
      currentPrice: number;
      marketValue: number;
      pnl: number;
    };
  };
}

/**
 * Calculate PnL for a trader based on their positions
 * TODO: PnL on all quote asset markets
 */
export function calculateTraderPnL(
  trader: string,
  traderPositions: Map<string, Map<string, number>>,
  traderAcquisitionValue: Map<string, Map<string, number>>,
  markets: Map<string, Market>,
  lastPriceByMarket: Map<string, number>,
  includeDetails: boolean = false,
): number | TraderPnLDetails {
  let totalPnL = 0;

  if (!traderPositions.has(trader)) {
    return includeDetails ? { totalPnL: 0, positions: {} } : 0;
  }

  // Setup for detailed return if needed
  const positionDetails: {
    [mint: string]: {
      tokenMint: string;
      marketKey: string | null;
      position: number;
      acquisitionValue: number;
      currentPrice: number;
      marketValue: number;
      pnl: number;
    };
  } = {};

  const positions = traderPositions.get(trader)!;
  const acquisitionValues = traderAcquisitionValue.get(trader)!;

  // Calculate PnL for each base token position
  for (const [baseMint, baseAtomPosition] of positions.entries()) {
    // Skip zero positions
    if (baseAtomPosition === 0) continue;

    // Find USDC market for this base token
    let usdcMarket: Market | null = null;
    let marketKey: string | null = null;
    let lastPriceAtoms = 0;

    // Special handling for wSOL - directly use the preferred market
    if (baseMint === SOL_MINT) {
      if (markets.has(SOL_USDC_MARKET)) {
        usdcMarket = markets.get(SOL_USDC_MARKET)!;
        marketKey = SOL_USDC_MARKET;
        lastPriceAtoms = lastPriceByMarket.get(marketKey) || 0;
      }
    }

    if (!usdcMarket || !marketKey || lastPriceAtoms === 0) {
      for (const [marketPk, market] of markets.entries()) {
        if (
          market.baseMint().toBase58() === baseMint &&
          market.quoteMint().toBase58() === USDC_MINT
        ) {
          // Skip markets with zero price
          const price = lastPriceByMarket.get(marketPk) || 0;
          if (price > 0) {
            usdcMarket = market;
            marketKey = marketPk;
            lastPriceAtoms = price;
            break;
          }
        }
      }
    }

    // Skip if no USDC market found for this token or if price is zero
    if (!usdcMarket || !marketKey || lastPriceAtoms === 0) continue;

    // Calculate current value in USDC
    const baseDecimals = usdcMarket.baseDecimals();
    const quoteDecimals = usdcMarket.quoteDecimals();
    const basePosition = baseAtomPosition / 10 ** baseDecimals;

    // Convert price from atoms to actual price
    const priceInQuote = lastPriceAtoms * 10 ** (baseDecimals - quoteDecimals);

    // Calculate current market value
    const currentPositionValue = basePosition * priceInQuote;

    // Get acquisition value
    const acquisitionValue = acquisitionValues.get(baseMint) || 0;

    // PnL = current value - cost basis
    const positionPnL = currentPositionValue - acquisitionValue;

    // Add to total PnL
    totalPnL += positionPnL;

    // Store detailed position info if requested
    if (includeDetails) {
      positionDetails[baseMint] = {
        tokenMint: baseMint,
        marketKey,
        position: basePosition,
        acquisitionValue,
        currentPrice: priceInQuote,
        marketValue: currentPositionValue,
        pnl: positionPnL,
      };
    }
  }

  // Return either detailed object or just the total PnL number
  return includeDetails ? { totalPnL, positions: positionDetails } : totalPnL;
}
