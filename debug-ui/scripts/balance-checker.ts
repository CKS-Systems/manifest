import { ManifestClient, Market } from '@cks-systems/manifest-sdk';
import { getVaultAddress } from '@cks-systems/manifest-sdk/utils';
import {
  AccountInfo,
  Connection,
  ParsedAccountData,
  PublicKey,
  RpcResponseAndContext,
} from '@solana/web3.js';

const { RPC_URL } = process.env;

if (!RPC_URL) {
  throw new Error('RPC_URL missing from env');
}

const run = async () => {
  const connection: Connection = new Connection(RPC_URL);
  const marketPks: PublicKey[] =
    await ManifestClient.listMarketPublicKeys(connection);

  for (const marketPk of marketPks) {
    const client: ManifestClient = await ManifestClient.getClientReadOnly(
      connection,
      marketPk,
    );
    const baseMint: PublicKey = client.market.baseMint();
    const quoteMint: PublicKey = client.market.quoteMint();

    const parsedAccounts: RpcResponseAndContext<
      (AccountInfo<Buffer | ParsedAccountData> | null)[]
    > = await connection.getMultipleParsedAccounts([
      marketPk,
      getVaultAddress(marketPk, baseMint),
      getVaultAddress(marketPk, quoteMint),
    ]);
    const market: Market = Market.loadFromBuffer({
      address: marketPk,
      buffer: parsedAccounts.value[0]?.data! as Buffer,
    });
    const {
      baseWithdrawableBalanceAtoms,
      quoteWithdrawableBalanceAtoms,
      baseOpenOrdersBalanceAtoms,
      quoteOpenOrdersBalanceAtoms,
    } = market.getMarketBalances();

    const baseVaultBalanceAtoms: number = Number(
      (parsedAccounts.value[1]?.data as ParsedAccountData).parsed['info'][
        'tokenAmount'
      ]['amount'],
    );
    const quoteVaultBalanceAtoms: number = Number(
      (parsedAccounts.value[2]?.data as ParsedAccountData).parsed['info'][
        'tokenAmount'
      ]['amount'],
    );

    const baseExpectedAtoms: number =
      baseWithdrawableBalanceAtoms + baseOpenOrdersBalanceAtoms;
    const quoteExpectedAtoms: number =
      quoteWithdrawableBalanceAtoms + quoteOpenOrdersBalanceAtoms;

    if (
      baseExpectedAtoms != baseVaultBalanceAtoms ||
      quoteExpectedAtoms != quoteVaultBalanceAtoms
    ) {
      console.log('Market', marketPk.toBase58());
      console.log(
        'Base actual',
        baseVaultBalanceAtoms,
        'base expected',
        baseWithdrawableBalanceAtoms + baseOpenOrdersBalanceAtoms,
        'difference',
        baseVaultBalanceAtoms -
          (baseWithdrawableBalanceAtoms + baseOpenOrdersBalanceAtoms),
      );
      console.log(
        'Quote actual',
        quoteVaultBalanceAtoms,
        'quote expected',
        quoteWithdrawableBalanceAtoms + quoteOpenOrdersBalanceAtoms,
        'difference',
        quoteVaultBalanceAtoms -
          (quoteWithdrawableBalanceAtoms + quoteOpenOrdersBalanceAtoms),
      );
    }
  }
};

run().catch((e) => {
  console.error('fatal error');
  throw e;
});
