use hypertree::RBTREE_OVERHEAD_BYTES;

pub const MARKET_FIXED_SIZE: usize = 512;
pub const GLOBAL_FIXED_SIZE: usize = 88;

// Red black tree overhead is 16 bytes. If each block is 80 bytes, then we get
// 64 bytes for a RestingOrder or ClaimedSeat.
pub const BLOCK_SIZE: usize = 80;
const BLOCK_PAYLOAD_SIZE: usize = BLOCK_SIZE - RBTREE_OVERHEAD_BYTES;
pub const RESTING_ORDER_SIZE: usize = BLOCK_PAYLOAD_SIZE;
pub const CLAIMED_SEAT_SIZE: usize = BLOCK_PAYLOAD_SIZE;
pub const GLOBAL_TRADER_SIZE: usize = BLOCK_PAYLOAD_SIZE;
pub const GLOBAL_TRADER_MARKET_INFO_SIZE: usize = BLOCK_PAYLOAD_SIZE;
const FREE_LIST_OVERHEAD: usize = 4;
pub const FREE_LIST_BLOCK_SIZE: usize = BLOCK_SIZE - FREE_LIST_OVERHEAD;

pub const NO_EXPIRATION_LAST_VALID_SLOT: u32 = 0;

pub const MARKET_FIXED_DISCRIMINANT: u64 = 4859840929024028656;
pub const GLOBAL_FIXED_DISCRIMINANT: u64 = 10787423733276977665;
