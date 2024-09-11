use num_enum::TryFromPrimitive;
use shank::ShankInstruction;

/// Instructions available for the Manifest wrapper program
#[repr(u8)]
#[derive(TryFromPrimitive, Debug, Copy, Clone, ShankInstruction, PartialEq, Eq)]
#[rustfmt::skip]
pub enum ManifestWrapperInstruction {
    // Create a market is not needed for the wrapper

    /// Create a wrapper for owner. Note that owner and payer are separate for
    /// use as a PDA.
    #[account(0, writable, signer, name = "owner", desc = "Owner of the Manifest account")]
    #[account(1, name = "system_program", desc = "System program")]
    #[account(2, writable, signer, name = "payer", desc = "Payer of rent and gas")]
    #[account(3, writable, name = "wrapper_state", desc = "Wrapper state")]
    CreateWrapper= 0,

    /// Allocate a seat. Also initializes this wrapper state
    #[account(0, name = "manifest_program", desc = "Manifest program")]
    #[account(1, writable, signer, name = "owner", desc = "Owner of the Manifest account")]
    #[account(2, writable, name = "market", desc = "Account holding all market state")]
    #[account(3, name = "system_program", desc = "System program")]
    #[account(4, writable, signer, name = "payer", desc = "Payer of rent and gas")]
    #[account(5, writable, name = "wrapper_state", desc = "Wrapper state")]
    ClaimSeat = 1,

    /// Place order, deposits additional funds needed
    #[account(0, name = "manifest_program", desc = "Manifest program")]
    #[account(1, writable, signer, name = "owner", desc = "Owner of the Manifest account")]
    #[account(2, writable, name = "trader_token_account", desc = "Trader token account")]
    #[account(3, writable, name = "vault", desc = "Vault PDA, seeds are [b'vault', market_address, mint_address]")]
    #[account(4, writable, name = "market", desc = "Account holding all market state")]
    #[account(5, name = "system_program", desc = "System program")]
    #[account(6, writable, signer, name = "payer", desc = "Payer of rent and gas")]
    #[account(7, writable, name = "wrapper_state", desc = "Wrapper state")]
    PlaceOrder = 2,

    /// Edit order, deposits additional funds needed
    #[account(0, name = "manifest_program", desc = "Manifest program")]
    #[account(1, writable, signer, name = "owner", desc = "Owner of the Manifest account")]
    #[account(2, writable, name = "market", desc = "Account holding all market state")]
    #[account(3, name = "system_program", desc = "System program")]
    #[account(4, writable, signer, name = "payer", desc = "Payer of rent and gas")]
    #[account(5, writable, name = "wrapper_state", desc = "Wrapper state")]
    #[account(6, writable, name = "trader_token_account", desc = "Trader token account")]
    #[account(7, writable, name = "vault", desc = "Vault PDA, seeds are [b'vault', market_address, mint_address]")]
    EditOrder = 3,

    /// Cancel order
    #[account(0, name = "manifest_program", desc = "Manifest program")]
    #[account(1, writable, signer, name = "owner", desc = "Owner of the Manifest account")]
    #[account(2, writable, name = "market", desc = "Account holding all market state")]
    #[account(3, name = "system_program", desc = "System program")]
    #[account(4, writable, signer, name = "payer", desc = "Payer of rent and gas")]
    #[account(5, writable, name = "wrapper_state", desc = "Wrapper state")]
    CancelOrder = 4,

    /// Settle withdrawable funds
    #[account(0, name = "manifest_program", desc = "Manifest program")]
    #[account(1, writable, signer, name = "owner", desc = "Owner of the Manifest account")]
    #[account(2, writable, name = "market", desc = "Account holding all market state")]
    #[account(3, name = "system_program", desc = "System program")]
    #[account(4, writable, signer, name = "payer", desc = "Payer of rent and gas")]
    #[account(5, writable, name = "wrapper_state", desc = "Wrapper state")]
    #[account(6, writable, name = "trader_token_account", desc = "Trader token account")]
    #[account(7, writable, name = "vault", desc = "Vault PDA, seeds are [b'vault', market_address, mint_address]")]
    SettleFunds = 5,
}

impl ManifestWrapperInstruction {
    pub fn to_vec(&self) -> Vec<u8> {
        vec![*self as u8]
    }
}
