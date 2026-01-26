import { Connection } from '@solana/web3.js';
import { FillLogResult, FillLog } from '@cks-systems/manifest-sdk';
import { genAccDiscriminator } from '@cks-systems/manifest-sdk/utils';
import {
  detectAggregatorFromKeys,
  detectOriginatingProtocolFromKeys,
  toFillLogResult,
} from '@cks-systems/manifest-sdk/fillFeed';

const fillDiscriminant = genAccDiscriminator('manifest::logs::FillLog');

export const parseTransactionForFills = async (
  connection: Connection,
  signature: string,
): Promise<FillLogResult[]> => {
  const fills: FillLogResult[] = [];

  const tx = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });

  if (!tx?.meta?.logMessages) {
    return fills;
  }

  if (tx.meta.err != null) {
    return fills;
  }

  const slot = tx.slot;
  const blockTime = tx.blockTime ?? undefined;

  // Extract signers
  let originalSigner: string | undefined;
  let signers: string[] | undefined;

  const message = tx.transaction.message;

  if ('accountKeys' in message) {
    // Legacy transaction
    originalSigner = message.accountKeys[0]?.toBase58();
    signers = message.accountKeys
      .map((key, index) => ({ key, index }))
      .filter(({ index }) => message.isAccountSigner(index))
      .map(({ key }) => key.toBase58());
  } else {
    // Versioned transaction (v0)
    originalSigner = message.staticAccountKeys[0]?.toBase58();
    signers = message.staticAccountKeys
      .map((key, index) => ({ key, index }))
      .filter(({ index }) => message.isAccountSigner(index))
      .map(({ key }) => key.toBase58());
  }

  // Detect aggregator and originating protocol
  let aggregator: string | undefined;
  let originatingProtocol: string | undefined;

  if ('accountKeys' in message) {
    const accountKeysStr = message.accountKeys.map((k) => k.toBase58());
    aggregator = detectAggregatorFromKeys(accountKeysStr);
    originatingProtocol = detectOriginatingProtocolFromKeys(accountKeysStr);
  } else {
    const accountKeysStr = message.staticAccountKeys.map((k) => k.toBase58());
    aggregator = detectAggregatorFromKeys(accountKeysStr);
    originatingProtocol = detectOriginatingProtocolFromKeys(accountKeysStr);
  }

  const messages = tx.meta.logMessages;
  const programDatas = messages.filter((msg) => msg.includes('Program data:'));

  for (const programDataEntry of programDatas) {
    const programData = programDataEntry.split(' ')[2];
    const byteArray = Uint8Array.from(atob(programData), (c) =>
      c.charCodeAt(0),
    );
    const buffer = Buffer.from(byteArray);

    if (!buffer.subarray(0, 8).equals(fillDiscriminant)) {
      continue;
    }

    try {
      const deserializedFillLog = FillLog.deserialize(buffer.subarray(8))[0];
      const fillResult = toFillLogResult(
        deserializedFillLog,
        slot,
        signature,
        originalSigner,
        aggregator,
        originatingProtocol,
        signers,
        blockTime,
      );

      fills.push(fillResult);
    } catch (error) {
      console.error(`Error deserializing FillLog:`, error);
    }
  }

  return fills;
};
