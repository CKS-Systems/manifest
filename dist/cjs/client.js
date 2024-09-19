"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManifestClient = exports.marketDiscriminator = void 0;
exports.toMantissaAndExponent = toMantissaAndExponent;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const instructions_1 = require("./manifest/instructions");
const market_1 = require("./market");
const wrapperObj_1 = require("./wrapperObj");
const manifest_1 = require("./manifest");
const wrapper_1 = require("./wrapper");
const constants_1 = require("./constants");
const market_2 = require("./utils/market");
// TODO: compute this rather than hardcode
exports.marketDiscriminator = 'hFwv1prLTHL';
class ManifestClient {
    connection;
    wrapper;
    market;
    payer;
    baseMint;
    quoteMint;
    isBase22;
    isQuote22;
    constructor(connection, wrapper, market, payer, baseMint, quoteMint) {
        this.connection = connection;
        this.wrapper = wrapper;
        this.market = market;
        this.payer = payer;
        this.baseMint = baseMint;
        this.quoteMint = quoteMint;
        this.isBase22 = baseMint.tlvData.length > 0;
        this.isQuote22 = quoteMint.tlvData.length > 0;
    }
    /**
     * fetches all user wrapper accounts and returns the first or null if none are found
     *
     * @param connection Connection
     * @param payerPub PublicKey of the trader
     *
     * @returns Promise<GetProgramAccountsResponse>
     */
    static async fetchFirstUserWrapper(connection, payerPub) {
        const existingWrappers = await connection.getProgramAccounts(wrapper_1.PROGRAM_ID, {
            filters: [
                // Dont check discriminant since there is only one type of account.
                {
                    memcmp: {
                        offset: 8,
                        encoding: 'base58',
                        bytes: payerPub.toBase58(),
                    },
                },
            ],
        });
        return existingWrappers.length > 0 ? existingWrappers[0] : null;
    }
    /**
     * list all Manifest markets using getProgramAccounts. caution: this is a heavy call.
     *
     * @param connection Connection
     * @returns PublicKey[]
     */
    static async listMarketPublicKeys(connection) {
        const accounts = await connection.getProgramAccounts(manifest_1.PROGRAM_ID, {
            filters: [{ memcmp: { offset: 0, bytes: exports.marketDiscriminator } }],
        });
        return accounts.map((a) => a.pubkey);
    }
    /**
     * Create a new client which creates a wrapper and claims seat if needed.
     *
     * @param connection Connection
     * @param marketPk PublicKey of the market
     * @param payerKeypair Keypair of the trader
     *
     * @returns ManifestClient
     */
    static async getClientForMarket(connection, marketPk, payerKeypair) {
        const marketObject = await market_1.Market.loadFromAddress({
            connection: connection,
            address: marketPk,
        });
        const baseMintPk = marketObject.baseMint();
        const quoteMintPk = marketObject.quoteMint();
        const baseMint = await (0, spl_token_1.getMint)(connection, baseMintPk);
        const quoteMint = await (0, spl_token_1.getMint)(connection, quoteMintPk);
        const userWrapper = await ManifestClient.fetchFirstUserWrapper(connection, payerKeypair.publicKey);
        const transaction = new web3_js_1.Transaction();
        if (!userWrapper) {
            const wrapperKeypair = web3_js_1.Keypair.generate();
            const createAccountIx = web3_js_1.SystemProgram.createAccount({
                fromPubkey: payerKeypair.publicKey,
                newAccountPubkey: wrapperKeypair.publicKey,
                space: constants_1.FIXED_WRAPPER_HEADER_SIZE,
                lamports: await connection.getMinimumBalanceForRentExemption(constants_1.FIXED_WRAPPER_HEADER_SIZE),
                programId: wrapper_1.PROGRAM_ID,
            });
            const createWrapperIx = (0, wrapper_1.createCreateWrapperInstruction)({
                owner: payerKeypair.publicKey,
                wrapperState: wrapperKeypair.publicKey,
            });
            const claimSeatIx = (0, wrapper_1.createClaimSeatInstruction)({
                manifestProgram: manifest_1.PROGRAM_ID,
                owner: payerKeypair.publicKey,
                market: marketPk,
                wrapperState: wrapperKeypair.publicKey,
            });
            transaction.add(createAccountIx);
            transaction.add(createWrapperIx);
            transaction.add(claimSeatIx);
            await (0, web3_js_1.sendAndConfirmTransaction)(connection, transaction, [
                payerKeypair,
                wrapperKeypair,
            ]);
            const wrapper = await wrapperObj_1.Wrapper.loadFromAddress({
                connection,
                address: wrapperKeypair.publicKey,
            });
            return new ManifestClient(connection, wrapper, marketObject, payerKeypair.publicKey, baseMint, quoteMint);
        }
        // Otherwise there is an existing wrapper
        const wrapperData = wrapperObj_1.Wrapper.deserializeWrapperBuffer(userWrapper.account.data);
        const existingMarketInfos = wrapperData.marketInfos.filter((marketInfo) => {
            return marketInfo.market.toBase58() == marketPk.toBase58();
        });
        if (existingMarketInfos.length > 0) {
            const wrapper = await wrapperObj_1.Wrapper.loadFromAddress({
                connection,
                address: userWrapper.pubkey,
            });
            return new ManifestClient(connection, wrapper, marketObject, payerKeypair.publicKey, baseMint, quoteMint);
        }
        // There is a wrapper, but need to claim a seat.
        const claimSeatIx = (0, wrapper_1.createClaimSeatInstruction)({
            manifestProgram: manifest_1.PROGRAM_ID,
            owner: payerKeypair.publicKey,
            market: marketPk,
            wrapperState: userWrapper.pubkey,
        });
        transaction.add(claimSeatIx);
        await (0, web3_js_1.sendAndConfirmTransaction)(connection, transaction, [payerKeypair]);
        const wrapper = await wrapperObj_1.Wrapper.loadFromAddress({
            connection,
            address: userWrapper.pubkey,
        });
        return new ManifestClient(connection, wrapper, marketObject, payerKeypair.publicKey, baseMint, quoteMint);
    }
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
    static async getSetupIxs(connection, marketPk, payerPub) {
        const setupData = {
            setupNeeded: true,
            instructions: [],
            wrapperKeypair: null,
        };
        const userWrapper = await ManifestClient.fetchFirstUserWrapper(connection, payerPub);
        if (!userWrapper) {
            const wrapperKeypair = web3_js_1.Keypair.generate();
            setupData.wrapperKeypair = wrapperKeypair;
            const createAccountIx = web3_js_1.SystemProgram.createAccount({
                fromPubkey: payerPub,
                newAccountPubkey: wrapperKeypair.publicKey,
                space: constants_1.FIXED_WRAPPER_HEADER_SIZE,
                lamports: await connection.getMinimumBalanceForRentExemption(constants_1.FIXED_WRAPPER_HEADER_SIZE),
                programId: wrapper_1.PROGRAM_ID,
            });
            setupData.instructions.push(createAccountIx);
            const createWrapperIx = (0, wrapper_1.createCreateWrapperInstruction)({
                owner: payerPub,
                wrapperState: wrapperKeypair.publicKey,
            });
            setupData.instructions.push(createWrapperIx);
            const claimSeatIx = (0, wrapper_1.createClaimSeatInstruction)({
                manifestProgram: manifest_1.PROGRAM_ID,
                owner: payerPub,
                market: marketPk,
                wrapperState: wrapperKeypair.publicKey,
            });
            setupData.instructions.push(claimSeatIx);
            return setupData;
        }
        const wrapperData = wrapperObj_1.Wrapper.deserializeWrapperBuffer(userWrapper.account.data);
        const existingMarketInfos = wrapperData.marketInfos.filter((marketInfo) => {
            return marketInfo.market.toBase58() == marketPk.toBase58();
        });
        if (existingMarketInfos.length > 0) {
            setupData.setupNeeded = false;
            return setupData;
        }
        // There is a wrapper, but need to claim a seat.
        const claimSeatIx = (0, wrapper_1.createClaimSeatInstruction)({
            manifestProgram: manifest_1.PROGRAM_ID,
            owner: payerPub,
            market: marketPk,
            wrapperState: userWrapper.pubkey,
        });
        setupData.instructions.push(claimSeatIx);
        return setupData;
    }
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
    static async getClientForMarketNoPrivateKey(connection, marketPk, payerPub) {
        const { setupNeeded } = await this.getSetupIxs(connection, marketPk, payerPub);
        if (setupNeeded) {
            throw new Error('setup ixs need to be executed first');
        }
        const marketObject = await market_1.Market.loadFromAddress({
            connection: connection,
            address: marketPk,
        });
        const baseMintPk = marketObject.baseMint();
        const quoteMintPk = marketObject.quoteMint();
        const baseMint = await (0, spl_token_1.getMint)(connection, baseMintPk);
        const quoteMint = await (0, spl_token_1.getMint)(connection, quoteMintPk);
        const userWrapper = await ManifestClient.fetchFirstUserWrapper(connection, payerPub);
        if (!userWrapper) {
            throw new Error('userWrapper is null even though setupNeeded is false. This should never happen.');
        }
        const wrapper = await wrapperObj_1.Wrapper.loadFromAddress({
            connection,
            address: userWrapper.pubkey,
        });
        return new ManifestClient(connection, wrapper, marketObject, payerPub, baseMint, quoteMint);
    }
    /**
     * Reload the market and wrapper objects.
     */
    async reload() {
        await Promise.all([
            this.wrapper.reload(this.connection),
            this.market.reload(this.connection),
        ]);
    }
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
    static createMarketIx(payer, baseMint, quoteMint, market) {
        const baseVault = (0, market_2.getVaultAddress)(market, baseMint);
        const quoteVault = (0, market_2.getVaultAddress)(market, quoteMint);
        return (0, instructions_1.createCreateMarketInstruction)({
            payer,
            market,
            baseVault,
            quoteVault,
            baseMint,
            quoteMint,
            tokenProgram22: spl_token_1.TOKEN_2022_PROGRAM_ID,
        });
    }
    /**
     * Deposit instruction
     *
     * @param payer PublicKey of the trader
     * @param mint PublicKey for deposit mint. Must be either the base or quote
     * @param amountTokens Number of tokens to deposit.
     *
     * @returns TransactionInstruction
     */
    depositIx(payer, mint, amountTokens) {
        const vault = (0, market_2.getVaultAddress)(this.market.address, mint);
        const traderTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, payer);
        const is22 = (mint.equals(this.baseMint.address) && this.isBase22) ||
            (mint.equals(this.quoteMint.address) && this.isQuote22);
        const mintDecimals = this.market.quoteMint().toBase58() === mint.toBase58()
            ? this.market.quoteDecimals()
            : this.market.baseDecimals();
        const amountAtoms = Math.ceil(amountTokens * 10 ** mintDecimals);
        return (0, wrapper_1.createDepositInstruction)({
            market: this.market.address,
            traderTokenAccount,
            vault,
            manifestProgram: manifest_1.PROGRAM_ID,
            owner: this.payer,
            wrapperState: this.wrapper.address,
            mint,
            tokenProgram: is22 ? spl_token_1.TOKEN_2022_PROGRAM_ID : spl_token_1.TOKEN_PROGRAM_ID,
        }, {
            params: {
                amountAtoms,
            },
        });
    }
    /**
     * Withdraw instruction
     *
     * @param payer PublicKey of the trader
     * @param mint PublicKey for withdraw mint. Must be either the base or quote
     * @param amountTokens Number of tokens to withdraw.
     *
     * @returns TransactionInstruction
     */
    withdrawIx(payer, mint, amountTokens) {
        const vault = (0, market_2.getVaultAddress)(this.market.address, mint);
        const traderTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, payer);
        const is22 = (mint.equals(this.baseMint.address) && this.isBase22) ||
            (mint.equals(this.quoteMint.address) && this.isQuote22);
        const mintDecimals = this.market.quoteMint().toBase58() === mint.toBase58()
            ? this.market.quoteDecimals()
            : this.market.baseDecimals();
        const amountAtoms = Math.floor(amountTokens * 10 ** mintDecimals);
        return (0, wrapper_1.createWithdrawInstruction)({
            market: this.market.address,
            traderTokenAccount,
            vault,
            manifestProgram: manifest_1.PROGRAM_ID,
            owner: this.payer,
            wrapperState: this.wrapper.address,
            mint,
            tokenProgram: is22 ? spl_token_1.TOKEN_2022_PROGRAM_ID : spl_token_1.TOKEN_PROGRAM_ID,
        }, {
            params: {
                amountAtoms,
            },
        });
    }
    /**
     * Withdraw All instruction. Withdraws all available base and quote tokens
     *
     * @returns TransactionInstruction[]
     */
    withdrawAllIx() {
        const withdrawInstructions = [];
        const baseBalance = this.market.getWithdrawableBalanceTokens(this.payer, true);
        if (baseBalance > 0) {
            const baseWithdrawIx = this.withdrawIx(this.payer, this.market.baseMint(), baseBalance);
            withdrawInstructions.push(baseWithdrawIx);
        }
        const quoteBalance = this.market.getWithdrawableBalanceTokens(this.payer, false);
        if (quoteBalance > 0) {
            const quoteWithdrawIx = this.withdrawIx(this.payer, this.market.quoteMint(), quoteBalance);
            withdrawInstructions.push(quoteWithdrawIx);
        }
        return withdrawInstructions;
    }
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
    placeOrderIx(params) {
        return (0, wrapper_1.createBatchUpdateInstruction)({
            market: this.market.address,
            manifestProgram: manifest_1.PROGRAM_ID,
            owner: this.payer,
            wrapperState: this.wrapper.address,
        }, {
            params: {
                cancels: [],
                cancelAll: false,
                orders: [toWrapperPlaceOrderParams(this.market, params)],
                traderIndexHint: null,
            },
        });
    }
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
    placeOrderWithRequiredDepositIx(payer, params) {
        const placeOrderIx = this.placeOrderIx(params);
        const currentBalance = this.market.getWithdrawableBalanceTokens(payer, !params.isBid);
        let depositMint;
        let depositAmount = 0;
        if (params.isBid) {
            depositMint = this.market.quoteMint();
            depositAmount = params.numBaseTokens * params.tokenPrice - currentBalance;
        }
        else {
            depositMint = this.market.baseMint();
            depositAmount = params.numBaseTokens - currentBalance;
        }
        if (depositAmount <= 0) {
            return [placeOrderIx];
        }
        const depositIx = this.depositIx(payer, depositMint, depositAmount);
        return [depositIx, placeOrderIx];
    }
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
    swapIx(payer, params) {
        const traderBase = (0, spl_token_1.getAssociatedTokenAddressSync)(this.baseMint.address, payer);
        const traderQuote = (0, spl_token_1.getAssociatedTokenAddressSync)(this.quoteMint.address, payer);
        const baseVault = (0, market_2.getVaultAddress)(this.market.address, this.baseMint.address);
        const quoteVault = (0, market_2.getVaultAddress)(this.market.address, this.quoteMint.address);
        // Assumes just normal token program for now.
        // No Token22 support here in sdk yet.
        return (0, instructions_1.createSwapInstruction)({
            payer,
            market: this.market.address,
            traderBase,
            traderQuote,
            baseVault,
            quoteVault,
            tokenProgramBase: this.isBase22
                ? spl_token_1.TOKEN_2022_PROGRAM_ID
                : spl_token_1.TOKEN_PROGRAM_ID,
            baseMint: this.baseMint.address,
            tokenProgramQuote: this.isQuote22
                ? spl_token_1.TOKEN_2022_PROGRAM_ID
                : spl_token_1.TOKEN_PROGRAM_ID,
            quoteMint: this.quoteMint.address,
        }, {
            params,
        });
    }
    /**
     * CancelOrder instruction
     *
     * @param params CancelOrderParams includes the orderSequenceNumber of the
     * order to cancel.
     *
     * @returns TransactionInstruction
     */
    cancelOrderIx(params) {
        return (0, wrapper_1.createBatchUpdateInstruction)({
            market: this.market.address,
            manifestProgram: manifest_1.PROGRAM_ID,
            owner: this.payer,
            wrapperState: this.wrapper.address,
        }, {
            params: {
                cancels: [params],
                cancelAll: false,
                orders: [],
                traderIndexHint: null,
            },
        });
    }
    /**
     * BatchUpdate instruction
     *
     * @param params CancelOrderParams includes the orderSequenceNumber of the
     * order to cancel.
     *
     * @returns TransactionInstruction
     */
    batchUpdateIx(placeParams, cancelParams, cancelAll) {
        return (0, wrapper_1.createBatchUpdateInstruction)({
            market: this.market.address,
            manifestProgram: manifest_1.PROGRAM_ID,
            owner: this.payer,
            wrapperState: this.wrapper.address,
        }, {
            params: {
                cancels: cancelParams,
                cancelAll,
                orders: placeParams.map((params) => toWrapperPlaceOrderParams(this.market, params)),
                traderIndexHint: null,
            },
        });
    }
    /**
     * CancelAll instruction. Cancels all orders on a market
     *
     * @returns TransactionInstruction
     */
    cancelAllIx() {
        return (0, wrapper_1.createBatchUpdateInstruction)({
            market: this.market.address,
            manifestProgram: manifest_1.PROGRAM_ID,
            owner: this.payer,
            wrapperState: this.wrapper.address,
        }, {
            params: {
                cancels: [],
                cancelAll: true,
                orders: [],
                traderIndexHint: null,
            },
        });
    }
    /**
     * killSwitchMarket transactions. Pulls all orders
     * and withdraws all balances from the market in two transactions
     *
     * @param payer PublicKey of the trader
     *
     * @returns TransactionSignatures[]
     */
    async killSwitchMarket(payerKeypair) {
        await this.market.reload(this.connection);
        const cancelAllIx = this.cancelAllIx();
        const cancelAllTx = new web3_js_1.Transaction();
        const cancelAllSig = await (0, web3_js_1.sendAndConfirmTransaction)(this.connection, cancelAllTx.add(cancelAllIx), [payerKeypair], {
            skipPreflight: true,
            commitment: 'confirmed',
        });
        // TOOD: Merge this into one transaction
        await this.market.reload(this.connection);
        const withdrawAllIx = this.withdrawAllIx();
        const withdrawAllTx = new web3_js_1.Transaction();
        const wihdrawAllSig = await (0, web3_js_1.sendAndConfirmTransaction)(this.connection, withdrawAllTx.add(...withdrawAllIx), [payerKeypair], {
            skipPreflight: true,
            commitment: 'confirmed',
        });
        return [cancelAllSig, wihdrawAllSig];
    }
}
exports.ManifestClient = ManifestClient;
function toWrapperPlaceOrderParams(market, wrapperPlaceOrderParamsExternal) {
    const quoteAtomsPerToken = 10 ** market.quoteDecimals();
    const baseAtomsPerToken = 10 ** market.baseDecimals();
    // Converts token price to atom price since not always equal
    // Ex. BONK/USDC = 0.00001854 USDC tokens/BONK tokens -> 0.0001854 USDC Atoms/BONK Atoms
    const priceQuoteAtomsPerBaseAtoms = wrapperPlaceOrderParamsExternal.tokenPrice *
        (quoteAtomsPerToken / baseAtomsPerToken);
    const { priceMantissa, priceExponent } = toMantissaAndExponent(priceQuoteAtomsPerBaseAtoms);
    const numBaseAtoms = Math.floor(wrapperPlaceOrderParamsExternal.numBaseTokens * baseAtomsPerToken);
    const minOutTokens = wrapperPlaceOrderParamsExternal.minOutTokens ?? 0;
    const minOutAtoms = wrapperPlaceOrderParamsExternal.isBid
        ? Math.floor(minOutTokens * baseAtomsPerToken)
        : Math.floor(minOutTokens * quoteAtomsPerToken);
    return {
        ...wrapperPlaceOrderParamsExternal,
        baseAtoms: numBaseAtoms,
        priceMantissa,
        priceExponent,
        minOutAtoms,
    };
}
function toMantissaAndExponent(input) {
    let priceExponent = 0;
    let priceMantissa = input;
    const uInt32Max = 4_294_967_296;
    while (priceExponent > -20 && priceMantissa < uInt32Max / 100) {
        priceExponent -= 1;
        priceMantissa *= 10;
    }
    priceMantissa = Math.floor(priceMantissa);
    return {
        priceMantissa,
        priceExponent,
    };
}
