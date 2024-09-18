import { PublicKey, Connection } from '@solana/web3.js';
import { bignum } from '@metaplex-foundation/beet';
import { publicKey as beetPublicKey } from '@metaplex-foundation/beet-solana';
import { deserializeRedBlackTree } from './utils/redBlackTree';
import { toNum } from './utils/numbers';
import { FIXED_GLOBAL_HEADER_SIZE, NIL } from './constants';
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
  private _mintDecimals: number | null = null;

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

    /**
   * Returns a `Global` for a given address, a data buffer
   *
   * @param connection The Solana `Connection` object
   * @param address The `PublicKey` of the global account
   */
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
    console.log('DEBUG1');
    return Global.loadFromBuffer({ address, buffer: accountInfo.data });
  }

    /**
   * Returns a `Global` for a given address, a data buffer
   *
   * @param globalAddress The `PublicKey` of the global account
   * @param buffer The buffer holding the market account data
   */
  static loadFromBuffer({
    address,
    buffer,
  }: {
    address: PublicKey;
    buffer: Buffer;
  }): Global {
    console.log('DEBUG2');
    const globalData = Global.deserializeGlobalBuffer(buffer);
    console.log('DEBUG3', globalData);
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

  async getMintDecimals(connection: Connection): Promise<number> {
    if (this._mintDecimals === null) {
      const mintInfo = await getMint(connection, this.data.mint);
      this._mintDecimals = mintInfo.decimals;
    }
    return this._mintDecimals;
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
    const decimals = await this.getMintDecimals(connection);
    return toNum(seat.tokenBalance) / 10 ** decimals;
  }

  tokenMint(): PublicKey {
    return this.data.mint;
  }

  hasSeat(trader: PublicKey): boolean {
    return this.data.globalSeats.some((seat) => seat.trader.equals(trader));
  }

  prettyPrint(): void {
    console.log('');
    console.log(`Global: ${this.address}`);
    console.log(`========================`);
    console.log(`Mint: ${this.data.mint.toBase58()}`);
    console.log(`Vault: ${this.data.vault.toBase58()}`);
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

  /**
   * Deserializes global data from a given mint and returns a `Global` object
   *
   * This includes both the fixed and dynamic parts of the market.
   * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/global.rs
   *
   * @param data The data buffer to deserialize
   */
  private static deserializeGlobalBuffer(data: Buffer): GlobalData {
    let offset = 0;
    offset += 8; // Skip discriminant

    const mint = beetPublicKey.read(data, offset);
    offset += beetPublicKey.byteSize;
    const vault = beetPublicKey.read(data, offset);
    offset += beetPublicKey.byteSize;

    const globalSeatsRootIndex = data.readUInt32LE(offset);
    offset += 4;
    const _globalAmountsRootIndex = data.readUInt32LE(offset);
    offset += 4;
    const _globalAmountsMaxIndex = data.readUInt32LE(offset);
    offset += 4;
    const _freeListHeadIndex = data.readUInt32LE(offset);
    offset += 4;

    const numBytesAllocated = data.readUInt32LE(offset);
    offset += 4;

    offset += 1; // Skip vault_bump
    offset += 1; // Skip global_bump

    const numSeatsClaimed = data.readUInt16LE(offset);
    offset += 2;

    const globalSeats =
      globalSeatsRootIndex != NIL
        ? deserializeRedBlackTree(
            data.subarray(FIXED_GLOBAL_HEADER_SIZE),
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
