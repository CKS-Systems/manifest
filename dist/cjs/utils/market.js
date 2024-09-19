"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVaultAddress = getVaultAddress;
const index_1 = require("../manifest/index");
const web3_js_1 = require("@solana/web3.js");
function getVaultAddress(market, mint) {
    const [vaultAddress, _unusedBump] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('vault'), market.toBuffer(), mint.toBuffer()], index_1.PROGRAM_ID);
    return vaultAddress;
}
