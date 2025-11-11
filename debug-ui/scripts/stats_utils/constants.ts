import { PublicKey } from '@solana/web3.js';
import { genAccDiscriminator } from '@cks-systems/manifest-sdk/utils';

// Stores checkpoints every 5 minutes
export const CHECKPOINT_DURATION_SEC: number = 5 * 60;
export const ONE_DAY_SEC: number = 24 * 60 * 60;
export const PORT: number = 3000;
export const DEPTHS_BPS: number[] = [50, 100, 200];

// Manifest Program ID
export const MANIFEST_PROGRAM_ID = new PublicKey(
  'MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms',
);

// Market discriminator for filtering accounts
export const MARKET_DISCRIMINATOR: Buffer = genAccDiscriminator(
  'manifest::state::market::MarketFixed',
);

// Market and mint addresses
export const SOL_USDC_MARKET = 'ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Known aggregators
export const KNOWN_AGGREGATORS = new Set([
  'D5YqVMoSxnqeZAKAUUE1Dm3bmjtdxQ5DCF356ozqN9cM', // Titan
  'HV1KXxWFaSeriyFvXyx48FqG9BoFbfinB8njCJonqP7K', // OKX
]);

