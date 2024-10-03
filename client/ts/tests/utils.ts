import { Connection } from '@solana/web3.js';
import { assert } from 'chai';
import { getClusterFromConnection } from '../src/utils/solana';
import { toMantissaAndExponent } from '../src';

export const areFloatsEqual = (
  num1: number,
  num2: number,
  epsilon: number = 1e-10,
): boolean => Math.abs(num1 - num2) < epsilon;

async function testUtils(): Promise<void> {
  const localnetConnection: Connection = new Connection(
    'http://127.0.0.1:8899',
  );
  assert((await getClusterFromConnection(localnetConnection)) == 'localnet');

  //const devnetConnection: Connection = new Connection(
  //  'https://api.devnet.solana.com',
  //);
  //assert((await getClusterFromConnection(devnetConnection)) == 'devnet');

  //const mainnetConnection: Connection = new Connection(
  //  'https://api.mainnet-beta.solana.com',
  //);
  //assert((await getClusterFromConnection(mainnetConnection)) == 'mainnet-beta');
}

function testToMantissaAndExponent(): void {
  assert(
    toMantissaAndExponent(3).priceExponent == -8,
    `Unexpected exponent ${toMantissaAndExponent(3).priceExponent}`,
  );
  assert(
    toMantissaAndExponent(3).priceMantissa == 300_000_000,
    `Unexpected manitssa ${toMantissaAndExponent(3).priceMantissa}`,
  );
}

describe('Utils test', () => {
  it('Utils', async () => {
    await testUtils();
  });
  it('Pricing', async () => {
    testToMantissaAndExponent();
  });
});
