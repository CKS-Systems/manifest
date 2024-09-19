"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FillFeed = void 0;
exports.runFillFeed = runFillFeed;
const ws_1 = __importDefault(require("ws"));
const web3_js_1 = require("@solana/web3.js");
const FillLog_1 = require("./manifest/accounts/FillLog");
const manifest_1 = require("./manifest");
const numbers_1 = require("./utils/numbers");
const bs58_1 = __importDefault(require("bs58"));
const keccak256_1 = __importDefault(require("keccak256"));
/**
 * FillFeed example implementation.
 */
class FillFeed {
    connection;
    wss;
    constructor(connection) {
        this.connection = connection;
        this.wss = new ws_1.default.Server({ port: 1234 });
        this.wss.on('connection', (ws) => {
            console.log('New client connected');
            ws.on('message', (message) => {
                console.log(`Received message: ${message}`);
            });
            ws.on('close', () => {
                console.log('Client disconnected');
            });
        });
    }
    /**
     * Parse logs in an endless loop.
     */
    async parseLogs(endEarly) {
        // Start with a hopefully recent signature.
        let lastSignature = (await this.connection.getSignaturesForAddress(manifest_1.PROGRAM_ID))[0].signature;
        // End early is 30 seconds, used for testing.
        const endTime = endEarly
            ? new Date(Date.now() + 30_000)
            : new Date(Date.now() + 1_000_000_000_000);
        while (new Date(Date.now()) < endTime) {
            await new Promise((f) => setTimeout(f, 10_000));
            const signatures = await this.connection.getSignaturesForAddress(manifest_1.PROGRAM_ID, {
                until: lastSignature,
            });
            // Flip it so we do oldest first.
            signatures.reverse();
            if (signatures.length == 0) {
                continue;
            }
            lastSignature = signatures[signatures.length - 1].signature;
            for (const signature of signatures) {
                await this.handleSignature(signature);
            }
        }
        this.wss.close();
    }
    /**
     * Handle a signature by fetching the tx onchain and possibly sending a fill
     * notification.
     */
    async handleSignature(signature) {
        console.log('Handling', signature.signature);
        const tx = await this.connection.getTransaction(signature.signature);
        if (!tx?.meta?.logMessages) {
            console.log('No log messages');
            return;
        }
        if (tx.meta.err != null) {
            console.log('Skipping failed tx');
            return;
        }
        const messages = tx?.meta?.logMessages;
        const programDatas = messages.filter((message) => {
            return message.includes('Program data:');
        });
        if (programDatas.length == 0) {
            console.log('No program datas');
            return;
        }
        for (const programDataEntry of programDatas) {
            const programData = programDataEntry.split(' ')[2];
            const byteArray = Uint8Array.from(atob(programData), (c) => c.charCodeAt(0));
            const buffer = Buffer.from(byteArray);
            // Hack to fix the difference in caching on the CI action.
            if (!buffer.subarray(0, 8).equals(fillDiscriminant) &&
                !buffer
                    .subarray(0, 8)
                    .equals(Buffer.from([52, 81, 147, 82, 119, 191, 72, 172]))) {
                continue;
            }
            const deserializedFillLog = FillLog_1.FillLog.deserialize(buffer.subarray(8))[0];
            console.log('Got a fill', JSON.stringify(toFillLogResult(deserializedFillLog, signature.slot)));
            this.wss.clients.forEach((client) => {
                client.send(JSON.stringify(toFillLogResult(deserializedFillLog, signature.slot)));
            });
        }
    }
}
exports.FillFeed = FillFeed;
/**
 * Run a fill feed as a websocket server that clients can connect to and get
 * notifications of fills for all manifest markets.
 */
async function runFillFeed() {
    const connection = new web3_js_1.Connection(process.env.RPC_URL || 'http://127.0.0.1:8899', 'confirmed');
    const fillFeed = new FillFeed(connection);
    await fillFeed.parseLogs();
}
/**
 * Helper function for getting account discriminator that matches how anchor
 * generates discriminators.
 */
function genAccDiscriminator(accName) {
    return (0, keccak256_1.default)(Buffer.concat([
        Buffer.from(bs58_1.default.decode(manifest_1.PROGRAM_ID.toBase58())),
        Buffer.from('manifest::logs::'),
        Buffer.from(accName),
    ])).subarray(0, 8);
}
const fillDiscriminant = genAccDiscriminator('FillLog');
function toFillLogResult(fillLog, slot) {
    return {
        market: fillLog.market.toBase58(),
        maker: fillLog.maker.toBase58(),
        taker: fillLog.taker.toBase58(),
        baseAtoms: (0, numbers_1.toNum)(fillLog.baseAtoms.inner),
        quoteAtoms: (0, numbers_1.toNum)(fillLog.quoteAtoms.inner),
        price: (0, numbers_1.convertU128)(fillLog.price.inner),
        takerIsBuy: fillLog.takerIsBuy,
        slot,
    };
}
