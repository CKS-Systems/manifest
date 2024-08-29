use num_enum::TryFromPrimitive;
use shank::ShankInstruction;

/// Instructions available for the Manifest program
#[repr(u8)]
#[derive(TryFromPrimitive, Debug, Copy, Clone, ShankInstruction, PartialEq, Eq)]
#[rustfmt::skip]
pub enum ManifestInstruction {
    /// Create a market
    #[account(0, writable, signer, name = "payer", desc = "Payer")]
    #[account(1, writable, name = "market", desc = "Account holding all market state")]
    #[account(2, name = "system_program", desc = "System program")]
    #[account(3, name = "base_mint", desc = "Base mint")]
    #[account(4, name = "quote_mint", desc = "Quote mint")]
    #[account(5, writable, name = "base_vault", desc = "Base vault PDA, seeds are [b'vault', market, base_mint]")]
    #[account(6, writable, name = "quote_vault", desc = "Quote vault PDA, seeds are [b'vault', market, quote_mint]")]
    #[account(7, name = "token_program", desc = "Token program")]
    // Always include both token programs so we can initialize both types of token vaults if needed.
    #[account(8, name = "token_program_22", desc = "Token program 22")]
    CreateMarket = 0,

    /// Allocate a seat
    #[account(0, writable, signer, name = "payer", desc = "Payer")]
    #[account(1, writable, name = "market", desc = "Account holding all market state")]
    #[account(2, name = "system_program", desc = "System program")]
    ClaimSeat = 1,

    /// Deposit
    #[account(0, writable, signer, name = "payer", desc = "Payer")]
    #[account(1, writable, name = "market", desc = "Account holding all market state")]
    #[account(2, writable, name = "trader_token", desc = "Trader token account")]
    #[account(3, writable, name = "vault", desc = "Vault PDA, seeds are [b'vault', market, mint]")]
    #[account(4, name = "token_program", desc = "Token program(22), should be the version that aligns with the token being used")]
    #[account(5, name = "mint", desc = "Required for token22 transfer_checked")]
    Deposit = 2,

    /// Withdraw
    #[account(0, writable, signer, name = "payer", desc = "Payer")]
    #[account(1, writable, name = "market", desc = "Account holding all market state")]
    #[account(2, writable, name = "trader_token", desc = "Trader token account")]
    #[account(3, writable, name = "vault", desc = "Vault PDA, seeds are [b'vault', market, mint]")]
    #[account(4, name = "token_program", desc = "Token program(22), should be the version that aligns with the token being used")]
    #[account(5, name = "mint", desc = "Required for token22 transfer_checked")]
    Withdraw = 3,

    /// Places an order using funds in a wallet instead of on deposit
    #[account(0, writable, signer, name = "payer", desc = "Payer")]
    #[account(1, writable, name = "market", desc = "Account holding all market state")]
    #[account(2, writable, name = "trader_base", desc = "Trader base token account")]
    #[account(3, writable, name = "trader_quote", desc = "Trader quote token account")]
    #[account(4, writable, name = "base_vault", desc = "Base vault PDA, seeds are [b'vault', market_address, base_mint]")]
    #[account(5, writable, name = "quote_vault", desc = "Quote vault PDA, seeds are [b'vault', market_address, quote_mint]")]
    #[account(6, name = "token_program_base", desc = "Token program(22) base")]
    #[account(7, name = "base_mint", desc = "Base mint, only inlcuded if base is Token22, otherwise not required")]
    #[account(8, name = "token_program_quote", desc = "Token program(22) quote. Optional. Only include if different from base")]
    #[account(9, name = "quote_mint", desc = "Quote mint, only inlcuded if base is Token22, otherwise not required")]
    #[account(10, writable, optional, name = "global", desc = "Global account")]
    #[account(11, writable, optional, name = "global_vault", desc = "Global vault")]
    Swap = 4,

    /// Expand a market.
    /// 
    /// This is not used in normal operations because expansion happens within
    /// instructions that could require it.
    /// This is useful for when rent payer != transaction signer.
    #[account(0, writable, signer, name = "payer", desc = "Payer")]
    #[account(1, writable, name = "market", desc = "Account holding all market state")]
    #[account(2, name = "system_program", desc = "System program")]
    Expand = 5,

    /// Batch update with multiple place orders and cancels.
    #[account(0, writable, signer, name = "payer", desc = "Payer")]
    #[account(1, writable, name = "market", desc = "Account holding all market state")]
    #[account(2, name = "system_program", desc = "System program")]
    #[account(3, name = "base_mint", desc = "Mint for the global global account")]
    #[account(4, writable, name = "base_global", desc = "Base global account")]
    #[account(5, name = "base_global_vault", desc = "Base global vault")]
    #[account(6, name = "base_market_vault", desc = "Base market vault")]
    #[account(7, name = "base_token_program", desc = "Token program(22)")]
    #[account(8, name = "quote_mint", desc = "Mint for this global account")]
    #[account(9, writable, name = "quote_global", desc = "Quote global account")]
    #[account(10, name = "quote_global_vault", desc = "Quote global vault")]
    #[account(11, name = "quote_market_vault", desc = "Quote market vault")]
    #[account(12, name = "quote_token_program", desc = "Token program(22)")]
    BatchUpdate = 6,

    /// Create global account for a given token.
    #[account(0, writable, signer, name = "payer", desc = "Payer")]
    #[account(1, writable, name = "global", desc = "Global account")]
    #[account(2, name = "system_program", desc = "System program")]
    #[account(3, name = "mint", desc = "Mint for this global account")]
    #[account(4, writable, name = "global_vault", desc = "Global vault")]
    #[account(5, name = "token_program", desc = "Token program(22)")]
    GlobalCreate = 7,

    /// Add a trader to the global account.
    #[account(0, writable, signer, name = "payer", desc = "Payer")]
    #[account(1, writable, name = "global", desc = "Global account")]
    #[account(2, name = "system_program", desc = "System program")]
    GlobalAddTrader = 8,

    /// Deposit into global account for a given token.
    #[account(0, writable, signer, name = "payer", desc = "Payer")]
    #[account(1, writable, name = "global", desc = "Global account")]
    #[account(2, name = "mint", desc = "Mint for this global account")]
    #[account(3, name = "global_vault", desc = "Global vault")]
    #[account(4, name = "trader_token", desc = "Trader token account")]
    #[account(5, name = "token_program", desc = "Token program(22)")]
    GlobalDeposit = 9,

    /// Deposit into global account for a given token.
    #[account(0, writable, signer, name = "payer", desc = "Payer")]
    #[account(1, writable, name = "global", desc = "Global account")]
    #[account(2, name = "mint", desc = "Mint for this global account")]
    #[account(3, name = "global_vault", desc = "Global vault")]
    #[account(4, name = "trader_token", desc = "Trader token account")]
    #[account(5, name = "token_program", desc = "Token program(22)")]
    GlobalWithdraw = 10,


    // TODO: Implement this. Users can clean another users unbacked or expired
    // orders off the orderbook.
    //#[account(0, writable, signer, name = "payer", desc = "Payer")]
    // GlobalCleanOrder = 11,
    // GlobalPurgeTrader = 12,
}

impl ManifestInstruction {
    pub fn to_vec(&self) -> Vec<u8> {
        vec![*self as u8]
    }
}

#[test]
fn test_instruction_serialization() {
    let num_instructions: u8 = 10;
    for i in 0..=255 {
        let instruction: ManifestInstruction = match ManifestInstruction::try_from(i) {
            Ok(j) => {
                assert!(i <= num_instructions);
                j
            }
            Err(_) => {
                assert!(i > num_instructions);
                continue;
            }
        };
        assert_eq!(instruction as u8, i);
    }
}

#[test]
fn test_to_vec() {
    let create_market_ix = ManifestInstruction::CreateMarket;
    let vec = create_market_ix.to_vec();
    assert_eq!(*vec.first().unwrap(), 0);
}
