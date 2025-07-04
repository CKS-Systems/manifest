//! Certora specs

pub(crate) mod hooks;
pub(crate) mod mocks_batch_update;
pub mod spec;
pub(crate) mod summaries;
pub(crate) mod utils;

extern "C" {
    pub fn CVT_sanity(c: bool);
}

pub fn cvt_sanity(c: bool) {
    unsafe {
        CVT_sanity(c);
    }
}

#[macro_export]
macro_rules! cvt_vacuity_check {
    () => {
        crate::certora::cvt_sanity(true)
    };
}
