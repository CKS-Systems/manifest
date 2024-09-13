use num_enum::TryFromPrimitive;
use shank::ShankInstruction;

/// Instructions available for the Manifest wrapper program
#[repr(u8)]
#[derive(TryFromPrimitive, Debug, Copy, Clone, ShankInstruction, PartialEq, Eq)]
#[rustfmt::skip]
pub enum ManifestWrapperInstruction {
    // Create a market is not needed for the wrapper

    /// Create a wrapper for owner.
    #[account(0, writable, signer, name = "owner", desc = "Owner of the Manifest account")]
    #[account(1, name = "system_program", desc = "System program")]
    #[account(2, writable, name = "wrapper_state", desc = "Wrapper state")]
    CreateWrapper= 0,

    /// Allocate a seat. Also initializes this wrapper state
    #[account(0, name = "manifest_program", desc = "Manifest program")]
    #[account(1, writable, signer, name = "owner", desc = "Owner of the Manifest account")]
    #[account(2, writable, name = "market", desc = "Account holding all market state")]
    #[account(3, name = "system_program", desc = "System program")]
    #[account(4, writable, name = "wrapper_state", desc = "Wrapper state")]
    ClaimSeat = 1,

    /// Deposit
    #[account(0, name = "manifest_program", desc = "Manifest program")]
    #[account(1, writable, signer, name = "owner", desc = "Owner of the Manifest account")]
    #[account(2, writable, name = "market", desc = "Account holding all market state")]
    #[account(3, writable, name = "trader_token_account", desc = "Trader token account")]
    #[account(4, writable, name = "vault", desc = "Vault PDA, seeds are [b'vault', market_address, mint_address]")]
    #[account(5, name = "token_program", desc = "Token program")]
    #[account(6, writable, name = "wrapper_state", desc = "Wrapper state")]
    #[account(7, name = "mint", desc = "Mint, needed for token 22")]
    Deposit = 2,

    /// Withdraw
    #[account(0, name = "manifest_program", desc = "Manifest program")]
    #[account(1, writable, signer, name = "owner", desc = "Owner of the Manifest account")]
    #[account(2, writable, name = "market", desc = "Account holding all market state")]
    #[account(3, writable, name = "trader_token_account", desc = "Trader token account")]
    #[account(4, writable, name = "vault", desc = "Vault PDA, seeds are [b'vault', market_address, mint_address]")]
    #[account(5, name = "token_program", desc = "Token program")]
    #[account(6, writable, name = "wrapper_state", desc = "Wrapper state")]
    #[account(7, name = "mint", desc = "Mint, needed for token 22")]
    Withdraw = 3,

    /// Cancels, then places orders.
    #[account(0, writable, name = "wrapper_state", desc = "Wrapper state")]
    #[account(1, name = "manifest_program", desc = "Manifest program")]
    #[account(2, writable, signer, name = "owner", desc = "Owner of the Manifest account")]
    #[account(3, writable, name = "market", desc = "Account holding all market state")]
    #[account(4, name = "system_program", desc = "System program")]
    BatchUpdate = 4,

    /// TODO: Create global account for a given token.

    /// Add a trader to the global account
    #[account(0, name = "manifest_program", desc = "Manifest program")]
    #[account(1, writable, signer, name = "owner", desc = "Owner of the Manifest account")]
    #[account(2, writable, name = "global", desc = "Global account")]
    #[account(3, name = "system_program", desc = "System program")]
    #[account(4, writable, name = "wrapper_state", desc = "Wrapper state")]
    GlobalAddTrader = 6,

    /// TODO Add other Global Ixs
}

impl ManifestWrapperInstruction {
    pub fn to_vec(&self) -> Vec<u8> {
        vec![*self as u8]
    }
}
