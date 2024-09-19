import { bignum } from '@metaplex-foundation/beet';
import { PublicKey, Connection, Keypair, TransactionInstruction, TransactionSignature } from '@solana/web3.js';
import { OrderType, SwapParams } from './manifest/types';
import { Market } from './market';
import { Wrapper } from './wrapperObj';
import { WrapperCancelOrderParams } from './wrapper';
export interface SetupData {
    setupNeeded: boolean;
    instructions: TransactionInstruction[];
    wrapperKeypair: Keypair | null;
}
export declare const marketDiscriminator: string;
export declare class ManifestClient {
    connection: Connection;
    wrapper: Wrapper;
    market: Market;
    private payer;
    private baseMint;
    private quoteMint;
    private isBase22;
    private isQuote22;
    private constructor();
    /**
     * fetches all user wrapper accounts and returns the first or null if none are found
     *
     * @param connection Connection
     * @param payerPub PublicKey of the trader
     *
     * @returns Promise<GetProgramAccountsResponse>
     */
    private static fetchFirstUserWrapper;
    /**
     * list all Manifest markets using getProgramAccounts. caution: this is a heavy call.
     *
     * @param connection Connection
     * @returns PublicKey[]
     */
    static listMarketPublicKeys(connection: Connection): Promise<PublicKey[]>;
    /**
     * Create a new client which creates a wrapper and claims seat if needed.
     *
     * @param connection Connection
     * @param marketPk PublicKey of the market
     * @param payerKeypair Keypair of the trader
     *
     * @returns ManifestClient
     */
    static getClientForMarket(connection: Connection, marketPk: PublicKey, payerKeypair: Keypair): Promise<ManifestClient>;
    /**
     * generate ixs which need to be executed in order to run a manifest client for a given market. `{ setupNeeded: false }` means all good.
     * this function should be used before getClientForMarketNoPrivateKey for UI cases where `Keypair`s cannot be directly passed in.
     *
     * @param connection Connection
     * @param marketPk PublicKey of the market
     * @param payerKeypair Keypair of the trader
     *
     * @returns Promise<SetupData>
     */
    static getSetupIxs(connection: Connection, marketPk: PublicKey, payerPub: PublicKey): Promise<SetupData>;
    /**
     * Create a new client. throws if setup ixs are needed. Call ManifestClient.getSetupIxs to check if ixs are needed.
     * This is the way to create a client without directly passing in `Keypair` types (for example when building a UI).
     *
     * @param connection Connection
     * @param marketPk PublicKey of the market
     * @param payerKeypair Keypair of the trader
     *
     * @returns ManifestClient
     */
    static getClientForMarketNoPrivateKey(connection: Connection, marketPk: PublicKey, payerPub: PublicKey): Promise<ManifestClient>;
    /**
     * Reload the market and wrapper objects.
     */
    reload(): Promise<void>;
    /**
     * CreateMarket instruction. Assumes the account is already funded onchain.
     *
     * @param payer PublicKey of the trader
     * @param baseMint PublicKey of the baseMint
     * @param quoteMint PublicKey of the quoteMint
     * @param market PublicKey of the market that will be created. Private key
     *               will need to be a signer.
     *
     * @returns TransactionInstruction
     */
    static createMarketIx(payer: PublicKey, baseMint: PublicKey, quoteMint: PublicKey, market: PublicKey): TransactionInstruction;
    /**
     * Deposit instruction
     *
     * @param payer PublicKey of the trader
     * @param mint PublicKey for deposit mint. Must be either the base or quote
     * @param amountTokens Number of tokens to deposit.
     *
     * @returns TransactionInstruction
     */
    depositIx(payer: PublicKey, mint: PublicKey, amountTokens: number): TransactionInstruction;
    /**
     * Withdraw instruction
     *
     * @param payer PublicKey of the trader
     * @param mint PublicKey for withdraw mint. Must be either the base or quote
     * @param amountTokens Number of tokens to withdraw.
     *
     * @returns TransactionInstruction
     */
    withdrawIx(payer: PublicKey, mint: PublicKey, amountTokens: number): TransactionInstruction;
    /**
     * Withdraw All instruction. Withdraws all available base and quote tokens
     *
     * @returns TransactionInstruction[]
     */
    withdrawAllIx(): TransactionInstruction[];
    /**
     * PlaceOrder instruction
     *
     * @param params PlaceOrderParamsExternal including all the information for
     * placing an order like amount, price, ordertype, ... This is called external
     * because to avoid conflicts with the autogenerated version which has
     * problems with expressing some of the parameters.
     *
     * @returns TransactionInstruction
     */
    placeOrderIx(params: WrapperPlaceOrderParamsExternal): TransactionInstruction;
    /**
     * PlaceOrderWithRequiredDeposit instruction. Only deposits the appropriate base
     * or quote tokens if not in the withdrawable balances.
     *
     * @param payer PublicKey of the trader
     * @param params WrapperPlaceOrderParamsExternal including all the information for
     * placing an order like amount, price, ordertype, ... This is called external
     * because to avoid conflicts with the autogenerated version which has
     * problems with expressing some of the parameters.
     *
     * @returns TransactionInstruction[]
     */
    placeOrderWithRequiredDepositIx(payer: PublicKey, params: WrapperPlaceOrderParamsExternal): TransactionInstruction[];
    /**
     * Swap instruction
     *
     * Optimized swap for routers and arb bots. Normal traders should compose
     * depost/withdraw/placeOrder to get limit orders. Does not go through the
     * wrapper.
     *
     * @param payer PublicKey of the trader
     * @param params SwapParams
     *
     * @returns TransactionInstruction
     */
    swapIx(payer: PublicKey, params: SwapParams): TransactionInstruction;
    /**
     * CancelOrder instruction
     *
     * @param params CancelOrderParams includes the orderSequenceNumber of the
     * order to cancel.
     *
     * @returns TransactionInstruction
     */
    cancelOrderIx(params: WrapperCancelOrderParams): TransactionInstruction;
    /**
     * BatchUpdate instruction
     *
     * @param params CancelOrderParams includes the orderSequenceNumber of the
     * order to cancel.
     *
     * @returns TransactionInstruction
     */
    batchUpdateIx(placeParams: WrapperPlaceOrderParamsExternal[], cancelParams: WrapperCancelOrderParams[], cancelAll: boolean): TransactionInstruction;
    /**
     * CancelAll instruction. Cancels all orders on a market
     *
     * @returns TransactionInstruction
     */
    cancelAllIx(): TransactionInstruction;
    /**
     * killSwitchMarket transactions. Pulls all orders
     * and withdraws all balances from the market in two transactions
     *
     * @param payer PublicKey of the trader
     *
     * @returns TransactionSignatures[]
     */
    killSwitchMarket(payerKeypair: Keypair): Promise<TransactionSignature[]>;
}
/**
 * Same as the autogenerated WrapperPlaceOrderParams except price here is a number.
 */
export type WrapperPlaceOrderParamsExternal = {
    /** Number of base tokens in the order. */
    numBaseTokens: number;
    /** Price as float in quote tokens per base tokens. */
    tokenPrice: number;
    /** Boolean for whether this order is on the bid side. */
    isBid: boolean;
    /** Last slot before this order is invalid and will be removed. */
    lastValidSlot: number;
    /** Type of order (Limit, PostOnly, ...). */
    orderType: OrderType;
    /** Used in fill or kill orders. Set to zero otherwise. */
    minOutTokens?: number;
    /** Client order id used for cancelling orders. Does not need to be unique. */
    clientOrderId: bignum;
};
export declare function toMantissaAndExponent(input: number): {
    priceMantissa: number;
    priceExponent: number;
};
//# sourceMappingURL=client.d.ts.map