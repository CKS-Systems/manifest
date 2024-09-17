import { Connection, PublicKey } from '@solana/web3.js';

export type Cluster = 'mainnet-beta' | 'devnet' | 'localnet';

export async function getClusterFromConnection(
  connection: Connection,
): Promise<Cluster> {
  const hash = await connection.getGenesisHash();
  if (hash === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') {
    return 'mainnet-beta';
  } else if (hash === 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') {
    return 'devnet';
  } else {
    return 'localnet';
  }
}

export async function airdropSol(connection: Connection, recipient: PublicKey) {
  console.log(`Requesting airdrop for ${recipient}`);
  const signature = await connection.requestAirdrop(recipient, 2_000_000_000);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    blockhash,
    lastValidBlockHeight,
    signature,
  });
}
