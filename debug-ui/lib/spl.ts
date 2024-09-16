import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Account,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
  TokenInvalidMintError,
  TokenInvalidOwnerError,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';
import {
  Commitment,
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';

export const getAtaSetupIx = async (
  conn: Connection,
  signerPub: PublicKey,
  mintPub: PublicKey,
  ownerPub: PublicKey,
  allowOwnerOffCurve = false,
  commitment?: Commitment,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): Promise<TransactionInstruction | null> => {
  const ataPub = getAssociatedTokenAddressSync(
    mintPub,
    ownerPub,
    allowOwnerOffCurve,
    programId,
    associatedTokenProgramId,
  );

  try {
    await getAccount(conn, ataPub, commitment, programId);
  } catch (error: unknown) {
    if (
      error instanceof TokenAccountNotFoundError ||
      error instanceof TokenInvalidAccountOwnerError
    ) {
      return createAssociatedTokenAccountInstruction(
        signerPub,
        ataPub,
        ownerPub,
        mintPub,
        programId,
        associatedTokenProgramId,
      );
    } else {
      throw error;
    }
  }

  return null;
};

export const getAtaChecked = async (
  conn: Connection,
  mintPub: PublicKey,
  ownerPub: PublicKey,
  allowOwnerOffCurve = false,
  commitment?: Commitment,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): Promise<Account> => {
  const associatedToken = getAssociatedTokenAddressSync(
    mintPub,
    ownerPub,
    allowOwnerOffCurve,
    programId,
    associatedTokenProgramId,
  );

  const account = await getAccount(
    conn,
    associatedToken,
    commitment,
    programId,
  );

  if (!account.mint.equals(mintPub)) throw new TokenInvalidMintError();
  if (!account.owner.equals(ownerPub)) throw new TokenInvalidOwnerError();

  return account;
};

export const getMintToIx = (
  mintPub: PublicKey,
  destPub: PublicKey,
  authPub: PublicKey,
  amount: number | bigint,
): TransactionInstruction => {
  return createMintToInstruction(
    mintPub,
    destPub,
    authPub,
    amount,
  );
};
