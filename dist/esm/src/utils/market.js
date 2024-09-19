import { PROGRAM_ID } from '../manifest/index';
import { PublicKey } from '@solana/web3.js';
export function getVaultAddress(market, mint) {
    const [vaultAddress, _unusedBump] = PublicKey.findProgramAddressSync([Buffer.from('vault'), market.toBuffer(), mint.toBuffer()], PROGRAM_ID);
    return vaultAddress;
}
