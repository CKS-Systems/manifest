import { bignum } from '@metaplex-foundation/beet';
/**
 * Converts a beet.bignum to a number.
 *
 * @param n The number to convert
 */
export declare function toNum(n: bignum): number;
/**
 * Converts a beet.bignum to a number after dividing by 10**18
 *
 * @param n The number to convert
 */
export declare function convertU128(n: bignum): number;
