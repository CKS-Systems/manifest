import {
  AccountInfo,
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { assert } from 'chai';
import { createPublicKey, verify } from 'crypto';
import { ManifestClient } from '../src/client';
import { PROGRAM_ID } from '../src/manifest';
import { getGlobalAddress, getGlobalVaultAddress } from '../src/utils/global';
import { getVaultAddress } from '../src/utils/market';

const key = (value: number): PublicKey =>
  Keypair.fromSeed(new Uint8Array(32).fill(value)).publicKey;

function mintAccount(owner: PublicKey): AccountInfo<Buffer> {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 1_000_000n,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  );
  return { data, owner, executable: false, lamports: 1_000_000, rentEpoch: 0 };
}

async function clientFixture(
  isBase22: boolean,
  isQuote22: boolean,
): Promise<ManifestClient> {
  const [base, quote, market] = [1, 2, 3].map(key);
  // Empty MarketFixed account: exercise SDK decoding and mint-owner detection.
  const data = Buffer.alloc(256);
  data.writeBigUInt64LE(4859840929024028656n, 0);
  data[9] = 6;
  data[10] = 6;
  base.toBuffer().copy(data, 16);
  quote.toBuffer().copy(data, 48);
  getVaultAddress(market, base).toBuffer().copy(data, 80);
  getVaultAddress(market, quote).toBuffer().copy(data, 112);
  for (const offset of [156, 160, 164, 168, 172, 176])
    data.writeUInt32LE(0xffffffff, offset);
  const connection = {
    async getAccountInfoAndContext(address: PublicKey) {
      assert.isTrue(address.equals(market));
      return {
        context: { slot: 100 },
        value: {
          data,
          owner: PROGRAM_ID,
          executable: false,
          lamports: 1_000_000,
        },
      };
    },
    async getMultipleAccountsInfo(addresses: PublicKey[]) {
      assert.deepEqual(
        addresses.map(String),
        [base, quote, getGlobalAddress(base), getGlobalAddress(quote)].map(
          String,
        ),
      );
      return [
        mintAccount(isBase22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID),
        mintAccount(isQuote22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID),
        null,
        null,
      ];
    },
  } as unknown as Connection;
  return ManifestClient.getClientReadOnly(connection, market);
}

describe('swap address lookup table accounts', () => {
  for (const isBase22 of [false, true]) {
    for (const isQuote22 of [false, true]) {
      for (const isBaseIn of [true, false]) {
        for (const isExactIn of [true, false]) {
          it(`round-trips the writable Global vault (base22=${isBase22}, quote22=${isQuote22}, baseIn=${isBaseIn}, exactIn=${isExactIn})`, async () => {
            const client = await clientFixture(isBase22, isQuote22);
            const [base, quote] = [1, 2].map(key);
            const payer = Keypair.fromSeed(new Uint8Array(32).fill(4));
            const instruction = client.swapIx(payer.publicKey, {
              inAtoms: 1000,
              outAtoms: 1,
              isBaseIn,
              isExactIn,
            });
            const globalVault = getGlobalVaultAddress(isBaseIn ? quote : base);
            const lookupTable = new AddressLookupTableAccount({
              key: key(5),
              state: {
                deactivationSlot: 0xffffffffffffffffn,
                lastExtendedSlot: 0,
                lastExtendedSlotStartIndex: 0,
                authority: payer.publicKey,
                addresses: [...client.getSwapAltPks()].map(
                  (address) => new PublicKey(address),
                ),
              },
            });
            const message = new TransactionMessage({
              payerKey: payer.publicKey,
              recentBlockhash: key(6).toBase58(),
              instructions: [instruction],
            }).compileToV0Message([lookupTable]);
            const transaction = new VersionedTransaction(message);
            transaction.sign([payer]);
            const wire = transaction.serialize();
            const restored = VersionedTransaction.deserialize(wire);
            if (restored.message.version !== 0) {
              throw new Error('Expected a v0 message');
            }
            assert.deepEqual(restored.serialize(), wire);
            const publicKey = createPublicKey({
              key: Buffer.concat([
                Buffer.from('302a300506032b6570032100', 'hex'),
                payer.publicKey.toBuffer(),
              ]),
              format: 'der',
              type: 'spki',
            });
            assert.isTrue(
              verify(
                null,
                restored.message.serialize(),
                publicKey,
                restored.signatures[0],
              ),
            );
            assert.isFalse(
              restored.message.staticAccountKeys.some((address) =>
                address.equals(globalVault),
              ),
            );
            assert.isTrue(
              restored.message
                .resolveAddressTableLookups([lookupTable])
                .writable.some((address) => address.equals(globalVault)),
            );
            const decoded = TransactionMessage.decompile(restored.message, {
              addressLookupTableAccounts: [lookupTable],
            }).instructions[0];
            assert.isTrue(decoded.programId.equals(instruction.programId));
            assert.deepEqual(decoded.data, instruction.data);
            assert.deepEqual(decoded.keys, instruction.keys);
          });
        }
      }
    }
  }
});
