import { Connection, PublicKey } from '@solana/web3.js';
export type Cluster = 'mainnet-beta' | 'devnet' | 'localnet';
export declare function getClusterFromConnection(connection: Connection): Promise<Cluster>;
export declare function airdropSol(connection: Connection, recipient: PublicKey): Promise<void>;
