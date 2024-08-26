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
    target = n.toNumber();
  }
  return target;
}

/**
 * Converts a beet.bignum to a number after dividing by 10**20
 *
 * @param n The number to convert
 */
export function convertU128(n: bignum): number {
  let target: number;
  if (typeof n === 'number') {
    target = 0;
  } else {
    // can only initialize up to 2**53, but need to divide by 10**20.
    const divisor = new BN(10 ** 10);
    if (n.div(divisor) < new BN(2**53 - 1)) {
      console.log('was', n);
      console.log('div', n.div(divisor), new BN(2**53 - 1));
      console.log('num', n.div(divisor).toNumber());
      console.log('result', n.div(divisor).toNumber() / 10**10);
      console.log('would have been', n.div(divisor).div(divisor).toNumber());
      return n.div(divisor).toNumber() / 10**10;
    }
    target = n.div(divisor).div(divisor).toNumber();
  }
  return target;
}
