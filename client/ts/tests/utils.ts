import { Connection } from '@solana/web3.js';
import { assert } from 'chai';
import { getClusterFromConnection } from '../src/utils/solana';
import { toMantissaAndExponent } from '../src';

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
    toMantissaAndExponent(3).priceExponent == -9,
    `Unexpected exponent ${toMantissaAndExponent(3).priceExponent}`,
  );
  assert(
    toMantissaAndExponent(3).priceMantissa == 3_000_000_000,
    `Unexpected exponent ${toMantissaAndExponent(3).priceMantissa}`,
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
