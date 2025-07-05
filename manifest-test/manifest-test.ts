import { 
  Connection, 
  Keypair, 
  LAMPORTS_PER_SOL, 
  PublicKey, 
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  TOKEN_2022_PROGRAM_ID,
  createMint
} from "@solana/spl-token";
import { 
  DELEGATION_PROGRAM_ID, 
  delegationRecordPdaFromDelegatedAccount, 
  delegationMetadataPdaFromDelegatedAccount, 
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram 
} from "@magicblock-labs/ephemeral-rollups-sdk";
import bs58 from "bs58";
import fs from "fs";

// Load the manifest IDL
const manifestIdl = JSON.parse(
  fs.readFileSync("./manifest.json", "utf8")
);

// Configure the client to use the local cluster
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Program IDs
const manifestProgramId = new PublicKey("FASTz9tarYt7xR67mA2zDtr15iQqjsDoU4FxyUrZG8vb");

// Test keypairs
const admin = Keypair.fromSecretKey(bs58.decode("ENTER PRIVATE KEY HERE"));

// Create CreateMarket instruction
function createCreateMarketInstruction(accounts: {
  payer: PublicKey;
  market: PublicKey;
  systemProgram: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  tokenProgram: PublicKey;
  tokenProgram22: PublicKey;
}): TransactionInstruction {
  // CreateMarket instruction discriminator is 0
  const data = Buffer.alloc(1);
  data.writeUInt8(0, 0);

  const keys = [
    { pubkey: accounts.payer, isWritable: true, isSigner: true },
    { pubkey: accounts.market, isWritable: true, isSigner: false },
    { pubkey: accounts.systemProgram, isWritable: false, isSigner: false },
    { pubkey: accounts.baseMint, isWritable: false, isSigner: false },
    { pubkey: accounts.quoteMint, isWritable: false, isSigner: false },
    { pubkey: accounts.baseVault, isWritable: true, isSigner: false },
    { pubkey: accounts.quoteVault, isWritable: true, isSigner: false },
    { pubkey: accounts.tokenProgram, isWritable: false, isSigner: false },
    { pubkey: accounts.tokenProgram22, isWritable: false, isSigner: false },
  ];

  return new TransactionInstruction({
    programId: manifestProgramId,
    keys,
    data,
  });
}

// Create DelegateMarket instruction
function createDelegateMarketInstruction(accounts: {
  initializer: PublicKey;
  systemProgram: PublicKey;
  marketToDelegate: PublicKey;
  ownerProgram: PublicKey;
  delegationBuffer: PublicKey;
  delegationRecord: PublicKey;
  delegationMetadata: PublicKey;
  delegationProgram: PublicKey;
}): TransactionInstruction {
  // DelegateMarket instruction discriminator is 14
  const data = Buffer.alloc(1);
  data.writeUInt8(14, 0);

  const keys = [
    { pubkey: accounts.initializer, isWritable: true, isSigner: true },
    { pubkey: accounts.systemProgram, isWritable: false, isSigner: false },
    { pubkey: accounts.marketToDelegate, isWritable: true, isSigner: false },
    { pubkey: accounts.ownerProgram, isWritable: false, isSigner: false },
    { pubkey: accounts.delegationBuffer, isWritable: true, isSigner: false },
    { pubkey: accounts.delegationRecord, isWritable: true, isSigner: false },
    { pubkey: accounts.delegationMetadata, isWritable: true, isSigner: false },
    { pubkey: accounts.delegationProgram, isWritable: false, isSigner: false },
  ];

  return new TransactionInstruction({
    programId: manifestProgramId,
    keys,
    data,
  });
}

async function airdrop() {
  console.log("\n=== Airdropping SOL ===");
  const balance = await connection.getBalance(admin.publicKey);
  console.log('Current balance is', balance / LAMPORTS_PER_SOL, ' SOL');
  
  if (balance < LAMPORTS_PER_SOL) {
    console.log('Requesting airdrop of 2 SOL...');
    const airdropSignature = await connection.requestAirdrop(
      admin.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    
    await connection.confirmTransaction(airdropSignature);
    
    const newBalance = await connection.getBalance(admin.publicKey);
    console.log('New balance is', newBalance / LAMPORTS_PER_SOL, ' SOL');
  } else {
    console.log('Balance sufficient, skipping airdrop');
  }
}

async function createMarket() {
  console.log('\n=== Creating Market ===');
  
  // Use devnet SOL and USDC mint addresses
  // SOL is the same on all networks, but USDC has different addresses per network
  const baseMint = new PublicKey("So11111111111111111111111111111111111111112"); // SOL (Wrapped SOL) - same on all networks
  const quoteMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // USDC on devnet

  console.log("Using baseMint (SOL):", baseMint.toString());
  console.log("Using quoteMint (USDC devnet):", quoteMint.toString());

  // Calculate market PDA
  const [marketPDA, marketBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), baseMint.toBuffer(), quoteMint.toBuffer()],
    manifestProgramId
  );

  console.log('Market PDA:', marketPDA.toString());
  console.log('Market bump:', marketBump);

  // Calculate vault PDAs
  const [baseVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPDA.toBuffer(), baseMint.toBuffer()],
    manifestProgramId
  );

  const [quoteVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPDA.toBuffer(), quoteMint.toBuffer()],
    manifestProgramId
  );

  console.log('Base Vault:', baseVault.toString());
  console.log('Quote Vault:', quoteVault.toString());

  // Create market instruction (this will create the PDA account internally)
  const createMarketIx = createCreateMarketInstruction({
    payer: admin.publicKey,
    market: marketPDA,
    systemProgram: SystemProgram.programId,
    baseMint,
    quoteMint,
    baseVault,
    quoteVault,
    tokenProgram: TOKEN_PROGRAM_ID,
    tokenProgram22: TOKEN_2022_PROGRAM_ID,
  });

  // Execute the create market instruction
  const transaction = new Transaction().add(createMarketIx);
  
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [admin] // Only admin needs to sign
  );

  console.log('Market created successfully!');
  console.log('Transaction signature:', signature);
  console.log('Market address:', marketPDA.toString());

  // Fetch and print market account data
  console.log('\n=== Market Account Data ===');
  try {
    const marketAccountInfo = await connection.getAccountInfo(marketPDA);
    if (marketAccountInfo) {
      console.log('Market account exists:');
      console.log('  Owner:', marketAccountInfo.owner.toString());
      console.log('  Lamports:', marketAccountInfo.lamports);
      console.log('  Data length:', marketAccountInfo.data.length);
      console.log('  Executable:', marketAccountInfo.executable);
      console.log('  Rent epoch:', marketAccountInfo.rentEpoch);
      
      // Print first 64 bytes of data as hex for inspection
      const dataHex = marketAccountInfo.data.slice(0, 64).toString('hex');
      console.log('  Data (first 64 bytes):', dataHex);
      
      // Try to parse some basic fields from the MarketFixed structure
      if (marketAccountInfo.data.length >= 8) {
        // Read discriminant (first 8 bytes)
        const discriminant = marketAccountInfo.data.readBigUInt64LE(0);
        console.log('  Discriminant:', discriminant.toString());
      }
      
      if (marketAccountInfo.data.length >= 16) {
        // Read version (byte at offset 8)
        const version = marketAccountInfo.data.readUInt8(8);
        console.log('  Version:', version);
        
        // Read base mint decimals (byte at offset 9)
        const baseMintDecimals = marketAccountInfo.data.readUInt8(9);
        console.log('  Base mint decimals:', baseMintDecimals);
        
        // Read quote mint decimals (byte at offset 10)
        const quoteMintDecimals = marketAccountInfo.data.readUInt8(10);
        console.log('  Quote mint decimals:', quoteMintDecimals);
      }
      
      if (marketAccountInfo.data.length >= 80) {
        // Read base mint (32 bytes starting at offset 16)
        const baseMintBytes = marketAccountInfo.data.slice(16, 48);
        const baseMintFromData = new PublicKey(baseMintBytes);
        console.log('  Base mint from data:', baseMintFromData.toString());
        console.log('  Base mint matches:', baseMintFromData.equals(baseMint));
        
        // Read quote mint (32 bytes starting at offset 48)
        const quoteMintBytes = marketAccountInfo.data.slice(48, 80);
        const quoteMintFromData = new PublicKey(quoteMintBytes);
        console.log('  Quote mint from data:', quoteMintFromData.toString());
        console.log('  Quote mint matches:', quoteMintFromData.equals(quoteMint));
      }
      
    } else {
      console.log('Market account not found!');
    }
  } catch (error) {
    console.error('Error fetching market account:', error);
  }

  return { marketPDA, baseMint, quoteMint };
}

async function delegateMarket(marketPDA: PublicKey) {
  console.log('\n=== Delegating Market ===');
  
  // Use ephemeral rollups SDK to get correct delegation PDAs - exactly like the counter example
  const delegationBuffer = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(marketPDA, manifestProgramId);
  const delegationRecord = delegationRecordPdaFromDelegatedAccount(marketPDA);
  const delegationMetadata = delegationMetadataPdaFromDelegatedAccount(marketPDA);

  console.log('Delegation buffer:', delegationBuffer.toString());
  console.log('Delegation record:', delegationRecord.toString());
  console.log('Delegation metadata:', delegationMetadata.toString());

  // Create delegate market instruction - following the exact counter pattern
  const keys = [
    // Initializer
    {
      pubkey: admin.publicKey,
      isSigner: true,
      isWritable: true,
    },
    // System Program
    {
      pubkey: SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
    // Market Account (delegated account) - this should NOT be a signer since it's a PDA
    {
      pubkey: marketPDA,
      isSigner: false,
      isWritable: true,
    },
    // Owner Program (manifest program)
    {
      pubkey: manifestProgramId,
      isSigner: false,
      isWritable: false,
    },
    // Delegation Buffer
    {
      pubkey: delegationBuffer,
      isSigner: false,
      isWritable: true,
    },
    // Delegation Record
    {
      pubkey: delegationRecord,
      isSigner: false,
      isWritable: true,
    },
    // Delegation Metadata
    {
      pubkey: delegationMetadata,
      isSigner: false,
      isWritable: true,
    },
    // Delegation Program
    {
      pubkey: DELEGATION_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
  ];

  const serializedInstructionData = Buffer.from([14]); // DelegateMarket discriminator
  
  const delegateIx = new TransactionInstruction({
    keys: keys,
    programId: manifestProgramId,
    data: serializedInstructionData
  });

  // Execute delegation instruction
  const transaction = new Transaction().add(delegateIx);
  
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [admin] // Only admin needs to sign
  );

  console.log('Market delegated successfully!');
  console.log('Transaction signature:', signature);
}

async function main() {
  try {
    console.log(`Admin Public Key: ${admin.publicKey}`);
    console.log(`Manifest Program ID: ${manifestProgramId.toString()}`);
    console.log(`Delegation Program ID: ${DELEGATION_PROGRAM_ID.toString()}`);
    
    await airdrop();
    
    const { marketPDA } = await createMarket();
    
    await delegateMarket(marketPDA);
    
    console.log('\n✅ Successfully created and delegated market!');
    
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main(); 