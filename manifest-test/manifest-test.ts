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
  createMint,
  createAssociatedTokenAccountIdempotent,
  mintTo,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { 
  DELEGATION_PROGRAM_ID, 
  delegationRecordPdaFromDelegatedAccount, 
  delegationMetadataPdaFromDelegatedAccount, 
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  GetCommitmentSignature,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import bs58 from "bs58";
import fs from "fs";
import * as readline from 'readline';

// Load the manifest IDL
const manifestIdl = JSON.parse(
  fs.readFileSync("./manifest.json", "utf8")
);

// Configure the client to use the local cluster
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Configure ephemeral rollup connection for MagicBlock
const ephemeralConnection = new Connection(
  process.env.PROVIDER_ENDPOINT || "https://devnet.magicblock.app/", 
  {
    wsEndpoint: process.env.WS_ENDPOINT || "wss://devnet.magicblock.app/",
  }
);

// Program IDs
const manifestProgramId = new PublicKey("FASTz9tarYt7xR67mA2zDtr15iQqjsDoU4FxyUrZG8vb");

// Base and Quote mint addresses for market derivation
const baseMint = new PublicKey("So11111111111111111111111111111111111111112"); // SOL (Wrapped SOL)
const quoteMint = new PublicKey("BzWHEYCTkBNHUimqBinWAUEgkKv1FUKQxv4Za3iyJwAC"); // USDC on devnet

// Test keypairs
const admin = Keypair.fromSecretKey(bs58.decode("enter admin secret key here"));

// Global state to track created resources
interface GlobalState {
  marketPDA?: PublicKey;
  baseMint?: PublicKey;
  quoteMint?: PublicKey;
  baseVault?: PublicKey;
  quoteVault?: PublicKey;
  baseTokenAccount?: PublicKey;
  quoteTokenAccount?: PublicKey;
  seatClaimed?: boolean;
  marketDelegated?: boolean;
}

// Global state - no default market initialization
const state: GlobalState = {

  // These will be derived from the market data or set to known values
  baseMint: new PublicKey("So11111111111111111111111111111111111111112"), // SOL (Wrapped SOL)
  quoteMint: new PublicKey("BzWHEYCTkBNHUimqBinWAUEgkKv1FUKQxv4Za3iyJwAC"), // USDC on devnet
  marketDelegated: true, // Market is already delegated
};

// Order types
enum OrderType {
  Limit = 0,
  ImmediateOrCancel = 1,
  PostOnly = 2,
  Global = 3,
  Reverse = 4,
}

// Helper function to convert price to mantissa and exponent
function toMantissaAndExponent(price: number): { mantissa: number, exponent: number } {
  let mantissa = price;
  let exponent = 0;
  
  // Normalize mantissa to be between 10^6 and 10^9 to fit in u32
  while (mantissa >= 4294967295) { // u32::MAX
    mantissa /= 10;
    exponent += 1;
  }
  
  while (mantissa < 100000 && exponent > -18) {
    mantissa *= 10;
    exponent -= 1;
  }
  
  return { mantissa: Math.floor(mantissa), exponent };
}

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper function to prompt user input
function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

// Helper function to wait for user to press Enter
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    rl.question('\nPress Enter to continue...', () => resolve());
  });
}

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

// Create ClaimSeat instruction
function createClaimSeatInstruction(accounts: {
  payer: PublicKey;
  market: PublicKey;
  systemProgram: PublicKey;
}): TransactionInstruction {
  // ClaimSeat instruction discriminator is 1
  const data = Buffer.alloc(1);
  data.writeUInt8(1, 0);

  const keys = [
    { pubkey: accounts.payer, isWritable: true, isSigner: true },
    { pubkey: accounts.market, isWritable: true, isSigner: false },
    { pubkey: accounts.systemProgram, isWritable: false, isSigner: false },
  ];

  return new TransactionInstruction({
    programId: manifestProgramId,
    keys,
    data,
  });
}

// Create Deposit instruction (state-only, no transfers)
function createDepositInstruction(accounts: {
  payer: PublicKey;
  market: PublicKey;
  traderToken: PublicKey;
  vault: PublicKey;
  tokenProgram: PublicKey;
  mint: PublicKey;
}, params: {
  amountAtoms: bigint;
  traderIndexHint?: number;
}): TransactionInstruction {
  // Create data buffer for DepositParams (without discriminator)
  const data = Buffer.alloc(8 + 5); // u64 + Option<u32>
  let offset = 0;
  
  // Write amount_atoms (u64, little endian)
  data.writeBigUInt64LE(params.amountAtoms, offset);
  offset += 8;
  
  // Write trader_index_hint (Option<u32>)
  if (params.traderIndexHint !== undefined) {
    data.writeUInt8(1, offset); // Some
    offset += 1;
    data.writeUInt32LE(params.traderIndexHint, offset);
    offset += 4;
  } else {
    data.writeUInt8(0, offset); // None
    offset += 1;
  }

  // Create final instruction data with discriminator
  const instructionData = Buffer.alloc(1 + offset);
  instructionData.writeUInt8(2, 0); // Deposit discriminator
  data.copy(instructionData, 1, 0, offset); // Copy params data after discriminator

  const keys = [
    { pubkey: accounts.payer, isWritable: true, isSigner: true },
    { pubkey: accounts.market, isWritable: true, isSigner: false },
    { pubkey: accounts.traderToken, isWritable: false, isSigner: false }, // Read-only
    { pubkey: accounts.vault, isWritable: false, isSigner: false }, // Read-only
    { pubkey: accounts.tokenProgram, isWritable: false, isSigner: false },
    { pubkey: accounts.mint, isWritable: false, isSigner: false },
  ];

  return new TransactionInstruction({
    programId: manifestProgramId,
    keys,
    data: instructionData,
  });
}

// Create BatchUpdate instruction for placing orders
function createBatchUpdateInstruction(accounts: {
  payer: PublicKey;
  market: PublicKey;
  systemProgram: PublicKey;
}, params: {
  traderIndexHint?: number;
  cancels: any[];
  orders: {
    baseAtoms: bigint;
    priceMantissa: number;
    priceExponent: number;
    isBid: boolean;
    lastValidSlot: number;
    orderType: OrderType;
  }[];
}): TransactionInstruction {
  // BatchUpdate instruction discriminator is 6
  let data = Buffer.alloc(1);
  data.writeUInt8(6, 0);

  // Serialize BatchUpdateParams using a simplified approach
  // In a real implementation, you'd use borsh or similar
  const paramsData = Buffer.alloc(1000); // Allocate enough space
  let offset = 0;

  // trader_index_hint (Option<u32>)
  if (params.traderIndexHint !== undefined) {
    paramsData.writeUInt8(1, offset);
    offset += 1;
    paramsData.writeUInt32LE(params.traderIndexHint, offset);
    offset += 4;
  } else {
    paramsData.writeUInt8(0, offset);
    offset += 1;
  }

  // cancels (Vec<CancelOrderParams>) - empty for now
  paramsData.writeUInt32LE(0, offset); // length = 0
  offset += 4;

  // orders (Vec<PlaceOrderParams>)
  paramsData.writeUInt32LE(params.orders.length, offset);
  offset += 4;

  for (const order of params.orders) {
    // baseAtoms (u64)
    paramsData.writeBigUInt64LE(order.baseAtoms, offset);
    offset += 8;
    // priceMantissa (u32)
    paramsData.writeUInt32LE(order.priceMantissa, offset);
    offset += 4;
    // priceExponent (i8)
    paramsData.writeInt8(order.priceExponent, offset);
    offset += 1;
    // isBid (bool)
    paramsData.writeUInt8(order.isBid ? 1 : 0, offset);
    offset += 1;
    // lastValidSlot (u32)
    paramsData.writeUInt32LE(order.lastValidSlot, offset);
    offset += 4;
    // orderType (u8)
    paramsData.writeUInt8(order.orderType, offset);
    offset += 1;
  }

  // Combine discriminator and params
  data = Buffer.concat([data, paramsData.slice(0, offset)]);

  const keys = [
    { pubkey: accounts.payer, isWritable: true, isSigner: true },
    { pubkey: accounts.market, isWritable: true, isSigner: false },
    { pubkey: accounts.systemProgram, isWritable: false, isSigner: false },
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

// Create CommitAndUndelegate instruction
function createCommitAndUndelegateMarketInstruction(accounts: {
  initializer: PublicKey;
  marketToDelegate: PublicKey;
  magicProgram: PublicKey;
  magicContextId: PublicKey;
}): TransactionInstruction {
  // CommitAndUndelegate instruction discriminator is 16
  const data = Buffer.alloc(1);
  data.writeUInt8(16, 0);

  const keys = [
    { pubkey: accounts.initializer, isWritable: true, isSigner: true },
    { pubkey: accounts.marketToDelegate, isWritable: true, isSigner: false },
    { pubkey: accounts.magicProgram, isWritable: false, isSigner: false },
    { pubkey: accounts.magicContextId, isWritable: true, isSigner: false },
  ];

  return new TransactionInstruction({
    programId: manifestProgramId,
    keys,
    data,
  });
}

// Create UnDelegateMarket instruction
function createUndelegateMarketInstruction(accounts: {
  delegatedMarket: PublicKey;
  delegationBuffer: PublicKey;
  initializer: PublicKey;
  systemProgram: PublicKey;
}): TransactionInstruction {
  // UnDelegateMarket instruction discriminator is 17
  const data = Buffer.alloc(1);
  data.writeUInt8(17, 0);

  // Account order must match processor: delegated_pda, delegation_buffer, initializer, system_program
  // Note: delegation_buffer should not be writable in ephemeral rollup context
  const keys = [
    { pubkey: accounts.delegatedMarket, isWritable: true, isSigner: false },
    { pubkey: accounts.delegationBuffer, isWritable: false, isSigner: false },
    { pubkey: accounts.initializer, isWritable: true, isSigner: true },
    { pubkey: accounts.systemProgram, isWritable: false, isSigner: false },
  ];

  return new TransactionInstruction({
    programId: manifestProgramId,
    keys,
    data,
  });
}

// Create CommitMarket instruction
function createCommitMarketInstruction(accounts: {
  initializer: PublicKey;
  market: PublicKey;
  magicProgram: PublicKey;
  magicContextId: PublicKey;
}): TransactionInstruction {
  // CommitMarket instruction discriminator is 15
  const data = Buffer.alloc(1);
  data.writeUInt8(15, 0);

  const keys = [
    { pubkey: accounts.initializer, isWritable: true, isSigner: true },
    { pubkey: accounts.market, isWritable: true, isSigner: false },
    { pubkey: accounts.magicProgram, isWritable: false, isSigner: false },
    { pubkey: accounts.magicContextId, isWritable: true, isSigner: false },
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
  
  await waitForEnter();
}

async function createMarket() {
  console.log('\n=== Creating New Market ===');
  
  if (state.marketPDA) {
    console.log('⚠️  A market already exists in this session:');
    console.log(`Market Address: ${state.marketPDA.toString()}`);
    const overwrite = await prompt('Do you want to create a new market anyway? (y/N): ');
    if (overwrite.toLowerCase() !== 'y' && overwrite.toLowerCase() !== 'yes') {
      console.log('❌ Market creation cancelled.');
      await waitForEnter();
      return;
    }
  }
  
  console.log('Creating new market...');
  
  // Use the global base and quote mint addresses
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

  // Create market instruction
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
  
  try {
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
      [admin]
  );

    console.log('✅ Market created successfully!');
  console.log('Transaction signature:', signature);
  console.log('Market address:', marketPDA.toString());

    // Update global state
    state.marketPDA = marketPDA;
    state.baseMint = baseMint;
    state.quoteMint = quoteMint;
    state.baseVault = baseVault;
    state.quoteVault = quoteVault;
    state.marketDelegated = false; // New market is not delegated
    state.seatClaimed = false; // New market requires seat claiming

    // Fetch and print basic market account data
  console.log('\n=== Market Account Data ===');
    const marketAccountInfo = await connection.getAccountInfo(marketPDA);
    if (marketAccountInfo) {
      console.log('Market account exists:');
      console.log('  Owner:', marketAccountInfo.owner.toString());
      console.log('  Lamports:', marketAccountInfo.lamports);
      console.log('  Data length:', marketAccountInfo.data.length);
      
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
      console.log('❌ Market account not found!');
    }
  } catch (error) {
    console.error('❌ Error creating market:', error);
  }

  await waitForEnter();
}

async function delegateMarket() {
  if (!state.marketPDA) {
    console.log('❌ No market found. Please create a market first.');
    await waitForEnter();
    return;
  }

  if (state.marketDelegated) {
      console.log('\n=== Market Delegation Status ===');
  console.log('✅ Market is already delegated to ephemeral rollup');
  console.log(`Market Address: ${state.marketPDA.toString()}`);
  console.log(`Ephemeral RPC: ${ephemeralConnection.rpcEndpoint}`);
  console.log('\n💡 Attempting to delegate an already delegated market will cause a "wrong program owner" error.');
  console.log('Use option 4 to commit and undelegate if you need to change delegation status.');
    await waitForEnter();
    return;
  }

  console.log('\n=== Delegating Market ===');
  
  // Use ephemeral rollups SDK to get correct delegation PDAs
  const delegationBuffer = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(state.marketPDA, manifestProgramId);
  const delegationRecord = delegationRecordPdaFromDelegatedAccount(state.marketPDA);
  const delegationMetadata = delegationMetadataPdaFromDelegatedAccount(state.marketPDA);

  console.log('Delegation buffer:', delegationBuffer.toString());
  console.log('Delegation record:', delegationRecord.toString());
  console.log('Delegation metadata:', delegationMetadata.toString());

  // Create delegate market instruction
  const delegateIx = createDelegateMarketInstruction({
    initializer: admin.publicKey,
    systemProgram: SystemProgram.programId,
    marketToDelegate: state.marketPDA,
    ownerProgram: manifestProgramId,
    delegationBuffer,
    delegationRecord,
    delegationMetadata,
    delegationProgram: DELEGATION_PROGRAM_ID,
  });

  // Execute delegation instruction
  const transaction = new Transaction().add(delegateIx);
  
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [admin]
    );

    console.log('✅ Market delegated successfully!');
    console.log('Transaction signature:', signature);
    state.marketDelegated = true;
  } catch (error) {
    console.error('❌ Error delegating market:', error);
  }

  await waitForEnter();
}

async function commitMarket() {
  if (!state.marketPDA) {
    console.log('❌ No market found. Please create a market first.');
    await waitForEnter();
    return;
  }

  if (!state.marketDelegated) {
    console.log('❌ Market is not delegated. Please delegate the market first.');
    await waitForEnter();
    return;
  }

  console.log('\n=== Committing Market ===');
  console.log('🔄 This operation commits the delegated market state to the base layer');
  console.log('📡 Transaction will be sent to MagicBlock ephemeral rollup provider');
  console.log(`   Ephemeral RPC: ${ephemeralConnection.rpcEndpoint}`);
  console.log(`   Market: ${state.marketPDA.toString()}`);
  console.log('\n💡 Note: This commits state changes without undelegating the market.');
  
  const confirm = await prompt('Do you want to proceed with market commit? (y/N): ');
  if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
    console.log('❌ Operation cancelled.');
    await waitForEnter();
    return;
  }

  // Create commit market instruction
  const commitMarketIx = createCommitMarketInstruction({
    initializer: admin.publicKey,
    market: state.marketPDA,
    magicProgram: MAGIC_PROGRAM_ID,
    magicContextId: MAGIC_CONTEXT_ID,
  });

  console.log('\n📦 Creating transaction for ephemeral rollup...');

  // Create transaction for ephemeral rollup
  const transaction = new Transaction().add(commitMarketIx);

  try {
    console.log('🚀 Sending transaction to ephemeral rollup...');
    
    // Send transaction to ephemeral rollup with skipPreflight
    const txHash = await sendAndConfirmTransaction(
      ephemeralConnection,
      transaction,
      [admin],
      {
        skipPreflight: true,
        commitment: "confirmed"
      }
    );
    
    console.log('✅ Transaction confirmed on ephemeral rollup!');
    console.log('Transaction hash:', txHash);

    // Get commitment signature
    console.log('📜 Getting commitment signature...');
    const commitmentSignature = await GetCommitmentSignature(
      txHash,
      ephemeralConnection
    );

    console.log('✅ Market committed successfully!');
    console.log('Ephemeral transaction hash:', txHash);
    console.log('Commitment signature:', commitmentSignature);

    console.log('\n💡 The market state has been committed to the base layer.');
    console.log('The market remains delegated and can continue operating on the ephemeral rollup.');
    
  } catch (error) {
    console.error('❌ Error committing market:', error);
    
    if (error instanceof Error && (error.message?.includes('MAGIC_PROGRAM_ID') || error.message?.includes('MAGIC_CONTEXT_ID'))) {
      console.log('\n💡 Note: The MagicBlock program IDs might need to be updated.');
      console.log('Please check the latest MagicBlock documentation for the correct program IDs.');
    }
  }

  await waitForEnter();
}

async function claimSeat() {
  if (!state.marketPDA) {
    state.marketPDA = new PublicKey("5zv2PEb1mfQJ8tEPZjJBiRW4Tbxv57aer5UCWymteZB3");
    return;
  }

  console.log('\n=== Claiming Seat ===');
  
  const claimSeatIx = createClaimSeatInstruction({
    payer: admin.publicKey,
    market: state.marketPDA,
    systemProgram: SystemProgram.programId,
  });

  const transaction = new Transaction().add(claimSeatIx);
  
  try {
  const signature = await sendAndConfirmTransaction(
    ephemeralConnection,
    transaction,
      [admin]
    );

    console.log('✅ Seat claimed successfully!');
    console.log('Transaction signature:', signature);
    state.seatClaimed = true;
  } catch (error) {
    console.error('❌ Error claiming seat:', error);
  }

  await waitForEnter();
}

async function setupTokenAccounts() {
  if (!state.baseMint || !state.quoteMint) {
    console.log('❌ No mints found. Please create a market first.');
    await waitForEnter();
    return;
  }

  console.log('\n=== Setting Up Token Accounts ===');
  
  // Create associated token accounts
  const baseTokenAccount = getAssociatedTokenAddressSync(
    state.baseMint,
    admin.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );
  
  const quoteTokenAccount = getAssociatedTokenAddressSync(
    state.quoteMint,
    admin.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  console.log('Base token account:', baseTokenAccount.toString());
  console.log('Quote token account:', quoteTokenAccount.toString());

  // Update global state
  state.baseTokenAccount = baseTokenAccount;
  state.quoteTokenAccount = quoteTokenAccount;

  console.log('\n💡 Note: Token accounts are identified but not created/funded.');
  console.log('For devnet SOL and USDC, you would need to:');
  console.log('1. Get SOL by wrapping native SOL');
  console.log('2. Get USDC from a devnet faucet');
  console.log('3. Create associated token accounts if they don\'t exist');

  await waitForEnter();
}



async function placeOrders() {
  if (!state.marketPDA) {
    console.log('❌ No market found. Please create a market first.');
    await waitForEnter();
    return;
  }

  if (!state.seatClaimed) {
    console.log('❌ Seat not claimed. Please claim a seat first.');
    await waitForEnter();
    return;
  }

  console.log('\n=== Placing Orders ===');
  console.log('Enter order details (press Enter with empty amount to finish):');

  const orders: any[] = [];

  while (true) {
    console.log(`\n--- Order ${orders.length + 1} ---`);
    const amountStr = await prompt('Amount (in base tokens, e.g., 0.5 for 0.5 SOL): ');
    
    if (!amountStr.trim()) {
      break;
    }

    const amount = parseFloat(amountStr);
    if (amount <= 0) {
      console.log('❌ Invalid amount. Please enter a positive number.');
      continue;
    }

    const priceStr = await prompt('Price (in quote tokens per base token, e.g., 100 for 100 USDC/SOL): ');
    const price = parseFloat(priceStr);
    if (price <= 0) {
      console.log('❌ Invalid price. Please enter a positive number.');
      continue;
    }

    const sideStr = (await prompt('Side (buy/sell): ')).toLowerCase();
    if (sideStr !== 'buy' && sideStr !== 'sell') {
      console.log('❌ Invalid side. Please enter "buy" or "sell".');
      continue;
    }

    const orderTypeStr = (await prompt('Order type (limit/ioc/postonly) [default: limit]: ')).toLowerCase() || 'limit';
    let orderType = OrderType.Limit;
    switch (orderTypeStr) {
      case 'ioc':
        orderType = OrderType.ImmediateOrCancel;
        break;
      case 'postonly':
        orderType = OrderType.PostOnly;
        break;
      default:
        orderType = OrderType.Limit;
    }

    const baseAtoms = BigInt(Math.floor(amount * 1_000_000_000)); // Convert to lamports
    const { mantissa: priceMantissa, exponent: priceExponent } = toMantissaAndExponent(price);

    orders.push({
      baseAtoms,
      priceMantissa,
      priceExponent,
      isBid: sideStr === 'buy',
      lastValidSlot: 0, // No expiration
      orderType,
    });

    console.log(`✅ Added ${sideStr} order: ${amount} at ${price} (mantissa: ${priceMantissa}, exp: ${priceExponent})`);
  }

  if (orders.length === 0) {
    console.log('No orders to place.');
    await waitForEnter();
    return;
  }

  const batchUpdateIx = createBatchUpdateInstruction({
    payer: admin.publicKey,
    market: state.marketPDA,
    systemProgram: SystemProgram.programId,
  }, {
    cancels: [],
    orders,
  });

  console.log(`\n📋 Created batch update instruction with ${orders.length} orders:`);
  orders.forEach((order, i) => {
    const side = order.isBid ? 'BUY' : 'SELL';
    const amount = Number(order.baseAtoms) / 1_000_000_000;
    const price = order.priceMantissa * Math.pow(10, order.priceExponent);
    console.log(`  ${i + 1}. ${side} ${amount} SOL at ${price} USDC/SOL`);
  });

  const execute = await prompt('\nExecute this transaction? (y/N): ');
  if (execute.toLowerCase() === 'y' || execute.toLowerCase() === 'yes') {
    const transaction = new Transaction().add(batchUpdateIx);
    
    try {
      const signature = await sendAndConfirmTransaction(
        ephemeralConnection,
        transaction,
        [admin]
      );

      console.log('✅ Orders placed successfully!');
  console.log('Transaction signature:', signature);
    } catch (error) {
      console.error('❌ Error placing orders:', error);
      console.log('\n💡 This likely failed due to insufficient deposits or missing token accounts.');
    }
  } else {
    console.log('Transaction not executed.');
  }

  await waitForEnter();
}

async function commitAndUndelegateMarket() {
  if (!state.marketPDA) {
    console.log('❌ No market found. Please create a market first.');
    await waitForEnter();
    return;
  }

  console.log('\n=== Committing and Undelegating Market ===');
  console.log('🔄 This operation commits the delegated market state and undelegates it');
  console.log('📡 Transaction will be sent to MagicBlock ephemeral rollup provider');
  console.log(`   Ephemeral RPC: ${ephemeralConnection.rpcEndpoint}`);
  console.log(`   Market: ${state.marketPDA.toString()}`);
  
  const confirm = await prompt('Do you want to proceed? (y/N): ');
  if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
    console.log('❌ Operation cancelled.');
    await waitForEnter();
    return;
  }

  // Create commit and undelegate instruction manually to ensure proper signing
  // Account order from instruction.rs: initializer, market_to_delegate, magic_program, magic_context_id
  const commitAndUndelegateIx = new TransactionInstruction({
    keys: [
      // Initializer
      {
        pubkey: admin.publicKey,
        isSigner: true,
        isWritable: true,
      },
      // Market To Delegate
      {
        pubkey: state.marketPDA,
        isSigner: false,
        isWritable: true,
      },
      // Magic Program
      {
        pubkey: MAGIC_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      // Magic Context
      {
        pubkey: MAGIC_CONTEXT_ID,
        isSigner: false,
        isWritable: true,
      }
    ],
    programId: manifestProgramId,
    data: Buffer.from([16]), // CommitAndUndelegate discriminator
  });

  console.log('\n📦 Creating transaction for ephemeral rollup...');

  // Create transaction for ephemeral rollup
  const transaction = new Transaction().add(commitAndUndelegateIx);

  try {
    console.log('🚀 Sending transaction to ephemeral rollup...');
    
    // Send transaction to ephemeral rollup with skipPreflight
    const txHash = await sendAndConfirmTransaction(
      ephemeralConnection,
      transaction,
      [admin],
      {
        skipPreflight: true,
        commitment: "confirmed"
      }
    );
    
    console.log('✅ Transaction confirmed on ephemeral rollup!');
    console.log('Transaction hash:', txHash);

    // Get commitment signature
    console.log('📜 Getting commitment signature...');
    const commitmentSignature = await GetCommitmentSignature(
      txHash,
      ephemeralConnection
    );

    console.log('✅ Market committed and undelegated successfully!');
    console.log('Ephemeral transaction hash:', txHash);
    console.log('Commitment signature:', commitmentSignature);
    
    // Update state
    state.marketDelegated = false;

    console.log('\n💡 The market state has been committed back to the base layer and undelegated.');
    console.log('You can now interact with the market on the regular devnet again.');
    
  } catch (error) {
    console.error('❌ Error committing and undelegating market:', error);
    
    if (error instanceof Error && (error.message?.includes('MAGIC_PROGRAM_ID') || error.message?.includes('MAGIC_CONTEXT_ID'))) {
      console.log('\n💡 Note: The MagicBlock program IDs might need to be updated.');
      console.log('Please check the latest MagicBlock documentation for the correct program IDs.');
    }
  }

  await waitForEnter();
}

async function undelegateMarket() {
  if (!state.marketPDA) {
    state.marketPDA = new PublicKey("ESJrufT1NYzLNkbZ4CsvGzBvAHWeoHakoxGguiKQUfoc");
    return;
  }


  console.log('\n=== Undelegating Market ===');
  console.log('🔄 This operation undelegates the market from the ephemeral rollup');
  console.log('📡 Transaction will be sent to MagicBlock ephemeral rollup provider');
  console.log(`   Ephemeral RPC: ${ephemeralConnection.rpcEndpoint}`);
  console.log(`   Market: ${state.marketPDA.toString()}`);
  console.log('\n⚠️  Note: This only undelegates without committing state changes.');
  console.log('💡 Use "Commit & Undelegate" if you want to commit state first.');
  
  const confirm = await prompt('Do you want to proceed with undelegation? (y/N): ');
  if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
    console.log('❌ Operation cancelled.');
    await waitForEnter();
    return;
  }

  // Get delegation buffer PDA
  const delegationBuffer = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(state.marketPDA, manifestProgramId);

  console.log('Delegation buffer:', delegationBuffer.toString());

  // Create undelegate market instruction manually to ensure proper signing
  // Account order from instruction.rs: delegated_market, delegation_buffer, initializer, system_program
  const undelegateIx = new TransactionInstruction({
    keys: [
      // Delegated Market
      {
        pubkey: state.marketPDA,
        isSigner: false,
        isWritable: true,
      },
      // Delegation Buffer
      {
        pubkey: delegationBuffer,
        isSigner: true,
        isWritable: false, // Must be non-writable in ephemeral rollup context
      },
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
      }
    ],
    programId: manifestProgramId,
    data: Buffer.from([17]), // UnDelegateMarket discriminator
  });

  console.log('\n📦 Creating transaction for ephemeral rollup...');

  // Create transaction for ephemeral rollup
  const transaction = new Transaction().add(undelegateIx);

  try {
    console.log('🚀 Sending transaction to ephemeral rollup...');
    
    // Send transaction to ephemeral rollup with skipPreflight
    const txHash = await sendAndConfirmTransaction(
      ephemeralConnection,
      transaction,
      [admin],
      {
        skipPreflight: true,
        commitment: "confirmed"
      }
    );
    
    console.log('✅ Transaction confirmed on ephemeral rollup!');
    console.log('Transaction hash:', txHash);

    // Get commitment signature
    console.log('📜 Getting commitment signature...');
    const commitmentSignature = await GetCommitmentSignature(
      txHash,
      ephemeralConnection
    );

    console.log('✅ Market undelegated successfully!');
    console.log('Ephemeral transaction hash:', txHash);
    console.log('Commitment signature:', commitmentSignature);
    
    // Update state
    state.marketDelegated = false;

    console.log('\n💡 The market has been undelegated and is now available on the base layer.');
    console.log('You can interact with the market on regular devnet again.');
    
  } catch (error) {
    console.error('❌ Error undelegating market:', error);
    
    if (error instanceof Error) {
      if (error.message?.includes('wrong program owner')) {
        console.log('\n💡 Note: This error typically occurs when the market is not actually delegated');
        console.log('or when there\'s a mismatch in delegation state.');
      }
    }
  }

  await waitForEnter();
}

async function depositWithExternalTransfers() {
  if (!state.marketPDA || !state.baseMint || !state.quoteMint || !state.baseVault || !state.quoteVault || !state.baseTokenAccount || !state.quoteTokenAccount) {
    console.log('❌ Missing required state. Please complete previous steps first.');
    await waitForEnter();
    return;
  }

  if (!state.seatClaimed) {
    console.log('❌ Seat not claimed. Please claim a seat first.');
    await waitForEnter();
    return;
  }

  console.log('\n=== Depositing with External Transfers ===');
  console.log('💡 This will:');
  console.log('   1. Transfer tokens from your ATAs to the market vaults');
  console.log('   2. Update the market\'s internal accounting via deposit instruction');
  
  // Get deposit amounts from user
  const baseAmountStr = await prompt('Enter base token amount to deposit (SOL): ');
  const quoteAmountStr = await prompt('Enter quote token amount to deposit (USDC): ');
  
  const baseAmount = parseFloat(baseAmountStr) || 0;
  const quoteAmount = parseFloat(quoteAmountStr) || 0;
  
  if (baseAmount <= 0 && quoteAmount <= 0) {
    console.log('❌ Invalid amounts. Please enter positive numbers.');
    await waitForEnter();
    return;
  }

  const { createTransferInstruction } = await import('@solana/spl-token');
  const instructions: TransactionInstruction[] = [];

  // Step 1: Add external transfers
  if (baseAmount > 0) {
    const baseTransferAmount = BigInt(Math.floor(baseAmount * 1_000_000_000)); // Convert to lamports
    
    const baseTransferIx = createTransferInstruction(
      state.baseTokenAccount,  // from
      state.baseVault,         // to
      admin.publicKey,         // owner
      baseTransferAmount,      // amount
      [],                      // multiSigners
      TOKEN_PROGRAM_ID         // programId
    );

    instructions.push(baseTransferIx);
    console.log(`Will transfer ${baseTransferAmount} base atoms (${baseAmount} SOL)`);
    
    // Step 2: Add deposit instruction for base
    const baseDepositIx = createDepositInstruction({
      payer: admin.publicKey,
      market: state.marketPDA,
      traderToken: state.baseTokenAccount,
      vault: state.baseVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      mint: state.baseMint,
    }, {
      amountAtoms: baseTransferAmount,
    });

    instructions.push(baseDepositIx);
    console.log(`Will update market accounting for ${baseTransferAmount} base atoms`);
  }

  if (quoteAmount > 0) {
    const quoteTransferAmount = BigInt(Math.floor(quoteAmount * 1_000_000)); // Convert to micro-USDC
    
    const quoteTransferIx = createTransferInstruction(
      state.quoteTokenAccount, // from
      state.quoteVault,        // to
      admin.publicKey,         // owner
      quoteTransferAmount,     // amount
      [],                      // multiSigners
      TOKEN_PROGRAM_ID         // programId
    );

    instructions.push(quoteTransferIx);
    console.log(`Will transfer ${quoteTransferAmount} quote atoms (${quoteAmount} USDC)`);
    
    // Step 2: Add deposit instruction for quote
    const quoteDepositIx = createDepositInstruction({
      payer: admin.publicKey,
      market: state.marketPDA,
      traderToken: state.quoteTokenAccount,
      vault: state.quoteVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      mint: state.quoteMint,
    }, {
      amountAtoms: quoteTransferAmount,
    });

    instructions.push(quoteDepositIx);
    console.log(`Will update market accounting for ${quoteTransferAmount} quote atoms`);
  }

  if (instructions.length > 0) {
    // Split instructions into transfers and deposits
    const transferInstructions: TransactionInstruction[] = [];
    const depositInstructions: TransactionInstruction[] = [];
    
    for (let i = 0; i < instructions.length; i++) {
      if (i % 2 === 0) {
        // Even indices are transfers
        transferInstructions.push(instructions[i]);
      } else {
        // Odd indices are deposits
        depositInstructions.push(instructions[i]);
      }
    }
    
    console.log('\n📦 Executing split transactions...');
    console.log(`   ${transferInstructions.length} transfer instructions → Regular devnet`);
    console.log(`   ${depositInstructions.length} deposit instructions → Ephemeral rollup`);
    
    try {
      // Step 1: Execute transfers on regular devnet
      if (transferInstructions.length > 0) {
        console.log('\n🔄 Step 1: Executing token transfers on regular devnet...');
        const transferTransaction = new Transaction().add(...transferInstructions);
        
        const transferSignature = await sendAndConfirmTransaction(
          connection, // Regular devnet connection
          transferTransaction,
          [admin],
          {
            skipPreflight: true,
            commitment: "confirmed"
          }
        );
        
        console.log('✅ Token transfers completed!');
        console.log('Transfer transaction signature:', transferSignature);
      }
      
      // Step 2: Execute deposits on ephemeral rollup
      if (depositInstructions.length > 0) {
        console.log('\n🔄 Step 2: Executing deposit state updates on ephemeral rollup...');
        const depositTransaction = new Transaction().add(...depositInstructions);
        
        const depositSignature = await sendAndConfirmTransaction(
          ephemeralConnection, // Ephemeral rollup connection
          depositTransaction,
          [admin],
          {
            skipPreflight: true,
            commitment: "confirmed"
          }
        );
        
        console.log('✅ Deposit state updates completed!');
        console.log('Deposit transaction signature:', depositSignature);
      }
      
      console.log('\n✅ Split deposit process completed successfully!');
      
      if (baseAmount > 0) {
        console.log(`✅ Deposited ${baseAmount} SOL to market (transfer on devnet + state update on ER)`);
      }
      if (quoteAmount > 0) {
        console.log(`✅ Deposited ${quoteAmount} USDC to market (transfer on devnet + state update on ER)`);
      }
      
      console.log('\n💡 Token transfers executed on regular devnet, market state updated on ephemeral rollup.');
      console.log('You can now use these funds for trading.');
      
    } catch (error) {
      console.error('❌ Error executing split deposits:', error);
      console.log('\n💡 This likely failed due to:');
      console.log('- Missing or unfunded token accounts');
      console.log('- Insufficient token balances');
      console.log('- Market not properly delegated');
      console.log('- Network connectivity issues');
      console.log('- Mismatch between transfer and deposit amounts');
    }
  } else {
    console.log('❌ No deposits to execute.');
  }

  await waitForEnter();
}

function displayMenu() {
  console.clear();
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                   🚀 MANIFEST TRADING CLI                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Admin Public Key: ${admin.publicKey.toString()}`);
  console.log(`Network: Devnet`);
  console.log('');
  
  // Display current state
  console.log('📊 Current State:');
  console.log(`  Market: ${state.marketPDA ? '✅ Pre-initialized' : '❌ Not found'}`);
  console.log(`  Delegation: ${state.marketDelegated ? '✅ Delegated' : (state.marketPDA ? '❌ Not delegated' : '❌ No market')}`);
  console.log(`  Seat: ${state.seatClaimed ? '✅ Claimed' : '❌ Not claimed'}`);
  console.log(`  Token Accounts: ${state.baseTokenAccount && state.quoteTokenAccount ? '✅ Identified' : '❌ Not set up'}`);
  console.log('');

  console.log('🔧 Available Actions:');
  console.log('  1. Airdrop SOL');
  console.log('  2. Create Market');
  console.log('  3. Delegate Market');
  console.log('  4. Commit Market (MagicBlock)');
  console.log('  5. Commit & Undelegate Market (MagicBlock)');
  console.log('  6. Undelegate Market');
  console.log('  7. Claim Seat');
  console.log('  8. Setup Token Accounts');
  console.log('  9. Deposit Funds');
  console.log('  10. Place Orders');
  console.log('  11. View State Details');
  console.log('  12. Exit');
  console.log('');
}

async function viewStateDetails() {
  console.log('\n=== 📊 Detailed State Information ===');
  
  if (state.marketPDA) {
    console.log(`\n🏪 Market:`);
    console.log(`  Address: ${state.marketPDA.toString()}`);
    console.log(`  Base Mint: ${state.baseMint?.toString() || 'N/A'}`);
    console.log(`  Quote Mint: ${state.quoteMint?.toString() || 'N/A'}`);
    console.log(`  Base Vault: ${state.baseVault?.toString() || 'N/A'}`);
    console.log(`  Quote Vault: ${state.quoteVault?.toString() || 'N/A'}`);
  }

  if (state.baseTokenAccount || state.quoteTokenAccount) {
    console.log(`\n💰 Token Accounts:`);
    console.log(`  Base Token Account: ${state.baseTokenAccount?.toString() || 'N/A'}`);
    console.log(`  Quote Token Account: ${state.quoteTokenAccount?.toString() || 'N/A'}`);
  }

  console.log(`\n🎫 Trading Status:`);
  console.log(`  Seat Claimed: ${state.seatClaimed ? 'Yes' : 'No'}`);
  
  console.log(`\n🔗 Delegation Status:`);
  console.log(`  Market Delegated: ${state.marketDelegated ? 'Yes' : 'No'}`);
  if (state.marketDelegated) {
    console.log(`  Ephemeral Rollup: ${ephemeralConnection.rpcEndpoint}`);
  }
  
  console.log(`\n🔗 Program IDs:`);
  console.log(`  Manifest: ${manifestProgramId.toString()}`);
  console.log(`  Delegation: ${DELEGATION_PROGRAM_ID.toString()}`);
  console.log(`  MagicBlock Program: ${MAGIC_PROGRAM_ID.toString()}`);
  console.log(`  MagicBlock Context: ${MAGIC_CONTEXT_ID.toString()}`);

  await waitForEnter();
}

async function main() {
  console.log('🚀 Starting Manifest Trading CLI...');
  
  while (true) {
    displayMenu();
    
    const choice = await prompt('Select an action (1-12): ');
    
    switch (choice.trim()) {
      case '1':
        await airdrop();
        break;
      case '2':
        await createMarket();
        break;
      case '3':
        await delegateMarket();
        break;
      case '4':
        await commitMarket();
        break;
      case '5':
        await commitAndUndelegateMarket();
        break;
      case '6':
        await undelegateMarket();
        break;
      case '7':
        await claimSeat();
        break;
      case '8':
        await setupTokenAccounts();
        break;
      case '9':
        await depositWithExternalTransfers();
        break;
      case '10':
        await placeOrders();
        break;
      case '11':
        await viewStateDetails();
        break;
      case '12':
        console.log('\n👋 Goodbye!');
        rl.close();
        process.exit(0);
        break;
      default:
        console.log('❌ Invalid choice. Please select 1-12.');
        await waitForEnter();
    }
  }
}

// Handle graceful exit
process.on('SIGINT', () => {
  console.log('\n👋 Goodbye!');
  rl.close();
  process.exit(0);
});

main().catch(error => {
  console.error('❌ Fatal error:', error);
  rl.close();
  process.exit(1);
}); 