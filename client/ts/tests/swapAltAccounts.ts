import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionMessage,
} from '@solana/web3.js';
import { assert } from 'chai';
import { ManifestClient } from '../src/client';
import { getGlobalVaultAddress } from '../src/utils/global';

const key = (value: number): PublicKey =>
  new PublicKey(new Uint8Array(32).fill(value));

describe('swap address lookup table accounts', () => {
  for (const isBase22 of [false, true]) {
    for (const isQuote22 of [false, true]) {
      for (const isBaseIn of [true, false]) {
        it(`looks up the output Global vault (base22=${isBase22}, quote22=${isQuote22}, baseIn=${isBaseIn})`, () => {
          const [base, quote, market, payer] = [1, 2, 3, 4].map(key);
          const client = Object.create(
            ManifestClient.prototype,
          ) as ManifestClient;
          Object.assign(client, {
            market: { address: market },
            baseMint: { address: base },
            quoteMint: { address: quote },
            isBase22,
            isQuote22,
          });

          const instruction = client.swapIx(payer, {
            inAtoms: 1000,
            outAtoms: 1,
            isBaseIn,
            isExactIn: true,
          });
          const globalVault = getGlobalVaultAddress(isBaseIn ? quote : base);
          assert.isTrue(
            instruction.keys.some(
              ({ pubkey, isWritable }) =>
                pubkey.equals(globalVault) && isWritable,
            ),
          );

          const lookupTable = new AddressLookupTableAccount({
            key: key(5),
            state: {
              deactivationSlot: 0xffffffffffffffffn,
              lastExtendedSlot: 0,
              lastExtendedSlotStartIndex: 0,
              authority: payer,
              addresses: [...client.getSwapAltPks()].map(
                (address) => new PublicKey(address),
              ),
            },
          });
          const message = new TransactionMessage({
            payerKey: payer,
            recentBlockhash: key(6).toBase58(),
            instructions: [instruction],
          }).compileToV0Message([lookupTable]);

          assert.isFalse(
            message.staticAccountKeys.some((key) => key.equals(globalVault)),
            'the Global vault should be compressed by the ALT',
          );
          assert.isTrue(
            message
              .resolveAddressTableLookups([lookupTable])
              .writable.some((key) => key.equals(globalVault)),
          );
        });
      }
    }
  }
});
