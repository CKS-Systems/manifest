import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { OrderType } from '../src/manifest/types';
export declare function placeOrder(connection: Connection, payerKeypair: Keypair, marketAddress: PublicKey, numBaseTokens: number, tokenPrice: number, isBid: boolean, orderType: OrderType, clientOrderId: number, minOutTokens?: number, lastValidSlot?: number): Promise<void>;
//# sourceMappingURL=placeOrder.d.ts.map