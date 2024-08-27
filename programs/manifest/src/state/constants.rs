use hypertree::RBTREE_OVERHEAD_BYTES;

pub const MARKET_FIXED_SIZE: usize = 256;
pub const GLOBAL_FIXED_SIZE: usize = 88;

// Red black tree overhead is 16 bytes. If each block is 80 bytes, then we get
// 64 bytes for a RestingOrder or ClaimedSeat.
pub const GLOBAL_BLOCK_SIZE: usize = 64;
pub const MARKET_BLOCK_SIZE: usize = 80;
const MARKET_BLOCK_PAYLOAD_SIZE: usize = MARKET_BLOCK_SIZE - RBTREE_OVERHEAD_BYTES;
pub const RESTING_ORDER_SIZE: usize = MARKET_BLOCK_PAYLOAD_SIZE;
pub const CLAIMED_SEAT_SIZE: usize = MARKET_BLOCK_PAYLOAD_SIZE;
const GLOBAL_BLOCK_PAYLOAD_SIZE: usize = GLOBAL_BLOCK_SIZE - RBTREE_OVERHEAD_BYTES;
pub const GLOBAL_TRADER_SIZE: usize = GLOBAL_BLOCK_PAYLOAD_SIZE;
const FREE_LIST_OVERHEAD: usize = 4;
pub const FREE_LIST_BLOCK_SIZE: usize = MARKET_BLOCK_SIZE - FREE_LIST_OVERHEAD;

pub const NO_EXPIRATION_LAST_VALID_SLOT: u32 = 0;

pub const MARKET_FIXED_DISCRIMINANT: u64 = 4859840929024028656;
pub const GLOBAL_FIXED_DISCRIMINANT: u64 = 10787423733276977665;
