import { PROGRAM_ID } from '../manifest/index';

import { PublicKey } from '@solana/web3.js';

export function getMarketAddress(baseMint: PublicKey, quoteMint: PublicKey): PublicKey {
  const [marketAddress, _unusedBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), baseMint.toBuffer(), quoteMint.toBuffer()],
    PROGRAM_ID,
  );
  return marketAddress;
}

export function getVaultAddress(market: PublicKey, mint: PublicKey): PublicKey {
  const [vaultAddress, _unusedBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), market.toBuffer(), mint.toBuffer()],
    PROGRAM_ID,
  );
  return vaultAddress;
}
