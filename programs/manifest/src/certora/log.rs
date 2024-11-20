#![allow(unused_macros)]
#![allow(unused_imports)]

// To avoid creating Strings when printing messages

macro_rules! msg {
    ($msg:expr) => {};
    ($($arg:tt)*) => {};
}

pub(crate) use msg;
