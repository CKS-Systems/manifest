use bytemuck::{Pod, Zeroable};
use manifest::logs::Discriminant;
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


macro_rules! discriminant {
    ($type_name:ident, $value:ident, $test_name:ident) => {
        impl Discriminant for $type_name {
            fn discriminant() -> [u8; 8] {
                $value
            }
        }

        #[test]
        fn $test_name() {
            let mut buffer: [u8; 8] = [0u8; 8];
            let discriminant: u64 = manifest::utils::get_discriminant::<$type_name>().unwrap();
            buffer[..8].copy_from_slice(&u64::to_le_bytes(discriminant));
            assert_eq!(buffer, $type_name::discriminant());
        }
    };
}

const PLATFORM_FEE_LOG_DISCRIMINANT: [u8; 8] = [128, 117, 227, 97, 178, 125, 227, 80];
const REFERRER_FEE_LOG_DISCRIMINANT: [u8; 8] = [17, 0, 54, 206, 161, 236, 90, 155];

discriminant!(
    PlatformFeeLog,
    PLATFORM_FEE_LOG_DISCRIMINANT,
    test_platform_fee_log
);

discriminant!(
    ReferrerFeeLog,
    REFERRER_FEE_LOG_DISCRIMINANT,
    test_referrer_fee_log
);