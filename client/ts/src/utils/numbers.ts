import { bignum } from '@metaplex-foundation/beet';
import { BN } from 'bn.js';

/**
 * Converts a beet.bignum to a number.
 *
 * @param n The number to convert
 */
export function toNum(n: bignum): number {
  let target: number;
  if (typeof n === 'number') {
    target = n;
  } else {
    target = n.toString() as any as number;
  }
  return target;
}

const BN_NUMBER_MAX = new BN(2 ** 53 - 1);
const BN_10 = new BN(10);

/**
 * Converts a beet.bignum to a number after dividing by 10**18
 *
 * @param n The number to convert
 */
export function convertU128(n: bignum): number {
  if (typeof n === 'number') {
    return n;
  }

  let mantissa = n.clone();
  for (let exponent = -18; exponent < 20; exponent += 1) {
    if (mantissa.lte(BN_NUMBER_MAX)) {
      return mantissa.toNumber() * 10 ** exponent;
    }
    mantissa = mantissa.div(BN_10);
  }

  throw 'unreachable';
}
