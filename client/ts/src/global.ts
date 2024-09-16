/* eslint-disable @typescript-eslint/no-unused-vars */
import { PublicKey, Connection } from '@solana/web3.js';
import { bignum } from '@metaplex-foundation/beet';
import { publicKey as beetPublicKey } from '@metaplex-foundation/beet-solana';
import { deserializeRedBlackTree } from './utils/redBlackTree';
import { toNum } from './utils/numbers';
import { FIXED_MANIFEST_HEADER_SIZE, NIL } from './constants';
import { getMint } from '@solana/spl-token';
import { globalSeatBeet } from './utils/beet';

export type GlobalSeat = {
  trader: PublicKey;
  tokenBalance: bignum;
  unclaimedGasBalance: bignum;
};

export interface GlobalData {
  mint: PublicKey;
  vault: PublicKey;
  globalSeats: GlobalSeat[];
  numBytesAllocated: number;
  numSeatsClaimed: number;
}

export class Global {
  address: PublicKey;
  private data: GlobalData;

  private constructor({
    address,
    data,
  }: {
    address: PublicKey;
    data: GlobalData;
  }) {
    this.address = address;
    this.data = data;
  }

  static async loadFromAddress({
    connection,
    address,
  }: {
    connection: Connection;
    address: PublicKey;
  }): Promise<Global> {
    const accountInfo = await connection.getAccountInfo(address, 'confirmed');
    if (!accountInfo?.data) {
      throw new Error(`Failed to load ${address}`);
    }
    return Global.loadFromBuffer({ address, buffer: accountInfo.data });
  }

  static loadFromBuffer({
    address,
    buffer,
  }: {
    address: PublicKey;
    buffer: Buffer;
  }): Global {
    const globalData = Global.deserializeGlobalBuffer(buffer);
    return new Global({ address, data: globalData });
  }

  async reload(connection: Connection): Promise<void> {
    const accountInfo = await connection.getAccountInfo(
      this.address,
      'confirmed',
    );
    if (!accountInfo?.data) {
      throw new Error(`Failed to load ${this.address}`);
    }
    this.data = Global.deserializeGlobalBuffer(accountInfo.data);
  }

  async getGlobalBalanceTokens(
    connection: Connection,
    trader: PublicKey,
  ): Promise<number> {
    const seat = this.data.globalSeats.find((seat) =>
      seat.trader.equals(trader),
    );
    if (!seat) {
      return 0;
    }
    return (
      toNum(seat.tokenBalance) / 10 ** (await this.tokenDecimals(connection))
    );
  }

  getUnclaimedGasTokens(trader: PublicKey): number {
    const seat = this.data.globalSeats.find((seat) =>
      seat.trader.equals(trader),
    );
    if (!seat) {
      return 0;
    }
    return toNum(seat.unclaimedGasBalance) / 10 ** 9;
  }

  tokenMint(): PublicKey {
    return this.data.mint;
  }

  async tokenDecimals(connection: Connection): Promise<number> {
    return (await getMint(connection, this.tokenMint())).decimals;
  }

  hasSeat(trader: PublicKey): boolean {
    return this.data.globalSeats.some((seat) => seat.trader.equals(trader));
  }

  prettyPrint(): void {
    console.log('');
    console.log(`Global: ${this.address}`);
    console.log(`========================`);
    console.log(`Mint: ${this.data.mint.toBase58()}`);
    console.log(`Vault: ${this.data.mint.toBase58()}`);
    console.log(`NumBytesAllocated: ${this.data.numBytesAllocated}`);
    console.log(`NumSeatsClaimed: ${this.data.numSeatsClaimed}`);
    console.log(`ClaimedSeats: ${this.data.globalSeats.length}`);
    this.data.globalSeats.forEach((seat) => {
      console.log(
        `publicKey: ${seat.trader.toBase58()} 
        tokenBalance: ${seat.tokenBalance.toString()} 
        unclaimedGas: ${seat.unclaimedGasBalance.toString()}`,
      );
    });
    console.log(`========================`);
  }

  private static deserializeGlobalBuffer(data: Buffer): GlobalData {
    let offset = 0;
    offset += 8; // Skip discriminant

    const mint = beetPublicKey.read(data, offset);
    offset += beetPublicKey.byteSize;
    const vault = beetPublicKey.read(data, offset);
    offset += beetPublicKey.byteSize;

    const globalSeatsRootIndex = data.readUInt32LE(offset);
    offset += 4;
    const globalAmountsRootIndex = data.readUInt32LE(offset);
    offset += 4;
    const globalAmountsMaxIndex = data.readUInt32LE(offset);
    offset += 4;
    const freeListHeadIndex = data.readUInt32LE(offset);
    offset += 4;

    const numBytesAllocated = data.readUInt32LE(offset);
    offset += 4;

    offset += 1; // Skip vault_bump
    offset += 1; // Skip global_bump

    const numSeatsClaimed = data.readInt16LE(offset);
    offset += 2;

    const globalSeats =
      globalSeatsRootIndex != NIL
        ? deserializeRedBlackTree(
            data.subarray(FIXED_MANIFEST_HEADER_SIZE),
            globalSeatsRootIndex,
            globalSeatBeet,
          )
        : [];

    return {
      mint,
      vault,
      globalSeats,
      numBytesAllocated,
      numSeatsClaimed,
    };
  }
}
