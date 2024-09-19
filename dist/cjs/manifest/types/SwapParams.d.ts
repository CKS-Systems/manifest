/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */
import * as beet from '@metaplex-foundation/beet';
export type SwapParams = {
    inAtoms: beet.bignum;
    outAtoms: beet.bignum;
    isBaseIn: boolean;
    isExactIn: boolean;
};
/**
 * @category userTypes
 * @category generated
 */
export declare const swapParamsBeet: beet.BeetArgsStruct<SwapParams>;
