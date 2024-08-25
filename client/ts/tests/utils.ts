import { Connection } from '@solana/web3.js';
import { assert } from 'chai';
import { getClusterFromConnection } from '../src/utils/solana';

async function testUtils(): Promise<void> {
  const localnetConnection: Connection = new Connection(
    'http://127.0.0.1:8899',
  );
  assert((await getClusterFromConnection(localnetConnection)) == 'localnet');

  const devnetConnection: Connection = new Connection(
    'https://api.devnet.solana.com',
  );
  //assert((await getClusterFromConnection(devnetConnection)) == 'devnet');

  const mainnetConnection: Connection = new Connection(
    'https://api.mainnet-beta.solana.com',
  );
  //assert((await getClusterFromConnection(mainnetConnection)) == 'mainnet-beta');
}

describe('Utils test', () => {
  it('Utils', async () => {
    await testUtils();
  });
});
