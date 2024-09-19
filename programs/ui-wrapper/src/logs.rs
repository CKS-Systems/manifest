use bytemuck::{Pod, Zeroable};
use shank::ShankAccount;
use solana_program::pubkey::Pubkey;

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct PlatformFeeLog {
    pub market: Pubkey,
    pub user: Pubkey,
    pub platform_token_account: Pubkey,
    pub platform_fee: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct ReferrerFeeLog {
    pub market: Pubkey,
    pub user: Pubkey,
    pub referrer_token_account: Pubkey,
    pub referrer_fee: u64,
}
