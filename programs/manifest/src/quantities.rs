use crate::program::{assert_with_msg, ManifestError};
use borsh::{BorshDeserialize as Deserialize, BorshSerialize as Serialize};
use bytemuck::{Pod, Zeroable};
use hypertree::trace;
use shank::ShankAccount;
use solana_program::{msg, program_error::ProgramError};
use std::{
    cmp::Ordering, fmt::Display, ops::{Add, AddAssign, Div}, u128, u64
};

/// New and as_u64 for creating and switching to u64 when needing to use base or
/// quote
pub trait WrapperU64 {
    fn new(value: u64) -> Self;
    fn as_u64(&self) -> u64;
}

macro_rules! checked_add {
    ($type_name:ident) => {
        impl $type_name {
            pub fn checked_add(self, other: Self) -> Result<$type_name, ManifestError> {
                let result_or: Option<u64> = self.inner.checked_add(other.inner);
                if result_or.is_none() {
                    Err(ManifestError::Overflow)
                } else {
                    Ok($type_name::new(result_or.unwrap()))
                }
            }

            pub fn checked_sub(self, other: Self) -> Result<$type_name, ManifestError> {
                let result_or: Option<u64> = self.inner.checked_sub(other.inner);
                if result_or.is_none() {
                    Err(ManifestError::Overflow)
                } else {
                    Ok($type_name::new(result_or.unwrap()))
                }
            }
        }
    };
}

macro_rules! basic_math {
    ($type_name:ident) => {
        impl Add for $type_name {
            type Output = Self;
            fn add(self, other: Self) -> Self {
                $type_name::new(self.inner + other.inner)
            }
        }

        impl AddAssign for $type_name {
            fn add_assign(&mut self, other: Self) {
                *self = *self + other;
            }
        }

        impl Default for $type_name {
            fn default() -> Self {
                Self::ZERO
            }
        }

        impl Display for $type_name {
            fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                self.inner.fmt(f)
            }
        }

        impl PartialEq for $type_name {
            fn eq(&self, other: &Self) -> bool {
                self.inner == other.inner
            }
        }

        impl Eq for $type_name {}
    };
}

macro_rules! basic_u64 {
    ($type_name:ident) => {
        impl WrapperU64 for $type_name {
            fn new(value: u64) -> Self {
                $type_name { inner: value }
            }

            fn as_u64(&self) -> u64 {
                self.inner
            }
        }

        impl $type_name {
            pub const ZERO: Self = $type_name { inner: 0 };
            pub const ONE: Self = $type_name { inner: 1 };

            pub fn min(self, other: Self) -> Self {
                if self.inner <= other.inner {
                    self
                } else {
                    other
                }
            }
        }

        impl From<$type_name> for u64 {
            fn from(x: $type_name) -> u64 {
                x.inner
            }
        }

        // Below should only be used in tests.
        impl PartialEq<u64> for $type_name {
            fn eq(&self, other: &u64) -> bool {
                self.inner == *other
            }
        }

        impl PartialEq<$type_name> for u64 {
            fn eq(&self, other: &$type_name) -> bool {
                *self == other.inner
            }
        }

        basic_math!($type_name);
        checked_add!($type_name);
    };
}

#[derive(
    Debug, Clone, Copy, PartialOrd, Ord, Zeroable, Pod, Deserialize, Serialize, ShankAccount,
)]
#[repr(transparent)]
pub struct QuoteAtoms {
    inner: u64,
}
basic_u64!(QuoteAtoms);

#[derive(
    Debug, Clone, Copy, PartialOrd, Ord, Zeroable, Pod, Deserialize, Serialize, ShankAccount,
)]
#[repr(transparent)]
pub struct BaseAtoms {
    inner: u64,
}
basic_u64!(BaseAtoms);

#[derive(
    Debug, Clone, Copy, PartialOrd, Ord, Zeroable, Pod, Deserialize, Serialize, ShankAccount,
)]
#[repr(transparent)]
pub struct GlobalAtoms {
    inner: u64,
}
basic_u64!(GlobalAtoms);

// Manifest pricing
#[derive(
    Clone,
    Copy,
    Default,
    Zeroable,
    Pod,
    Deserialize,
    Serialize,
    ShankAccount,
)]
#[repr(C)]
pub struct QuoteAtomsPerBaseAtom {
    inner: [u64; 2],
}

fn u128_to_u64_slice(a: u128) -> [u64; 2] {
    bytemuck::cast(a)
}
fn u64_slice_to_u128(a: [u64; 2]) -> u128 {
    bytemuck::cast(a)
}

const ATOM_LIMIT: u128 = u64::MAX as u128;
const D20: u128 = 10u128.pow(20);
const D20F: f64 = D20 as f64;

const DECIMAL_CONSTANTS: [u128; 31] = [
    10u128.pow(30),
    10u128.pow(29),
    10u128.pow(28),
    10u128.pow(27),
    10u128.pow(26),
    10u128.pow(25),
    10u128.pow(24),
    10u128.pow(23),
    10u128.pow(22),
    10u128.pow(21),
    10u128.pow(20),
    10u128.pow(19),
    10u128.pow(18),
    10u128.pow(17),
    10u128.pow(16),
    10u128.pow(15),
    10u128.pow(14),
    10u128.pow(13),
    10u128.pow(12),
    10u128.pow(11),
    10u128.pow(10),
    10u128.pow(09),
    10u128.pow(08),
    10u128.pow(07),
    10u128.pow(06),
    10u128.pow(05),
    10u128.pow(04),
    10u128.pow(03),
    10u128.pow(02),
    10u128.pow(01),
    10u128.pow(00),
];

// Prices
impl QuoteAtomsPerBaseAtom {
    pub const ZERO: Self = QuoteAtomsPerBaseAtom { inner: [0; 2] };
    pub const MIN: Self = QuoteAtomsPerBaseAtom::ZERO;
    pub const MAX: Self = QuoteAtomsPerBaseAtom { inner: [u64::MAX; 2] };

    pub fn try_from_mantissa_and_exponent(
        mantissa: u32,
        exponent: i8,
    ) -> Result<Self, PriceConversionError> {
        if exponent > 10 {
            msg!("invalid exponent {exponent} > 10 would truncate",);
            return Err(PriceConversionError(0x0));
        }
        if exponent < -20 {
            msg!("invalid exponent {exponent} < -20 would truncate",);
            return Err(PriceConversionError(0x1));
        }
        /* map exponent to array range
         10 -> [0]  -> D30
          0 -> [10] -> D20
        -10 -> [20] -> D10
        -20 -> [30] ->  D0
        */
        let offset = -(exponent - 10) as usize;
        let inner = DECIMAL_CONSTANTS[offset]
            .checked_mul(mantissa as u128)
            .ok_or(PriceConversionError(0x2))?;
        return Ok(QuoteAtomsPerBaseAtom { inner: u128_to_u64_slice(inner) });
    }

    pub fn checked_base_for_quote(
        self,
        quote_atoms: QuoteAtoms,
        round_up: bool,
    ) -> Result<BaseAtoms, ProgramError> {
        if self == Self::ZERO {
            return Ok(BaseAtoms::new(0));
        }
        let dividend = D20
            .checked_mul(quote_atoms.inner as u128)
            .ok_or(PriceConversionError(0x4))?;
        let inner: u128 = u64_slice_to_u128(self.inner);
        let base_atoms = if round_up {
            dividend.div_ceil(inner)
        } else {
            dividend.div(inner)
        };
        assert_with_msg(
            base_atoms <= ATOM_LIMIT,
            ManifestError::Overflow,
            "Overflow",
        )?;
        Ok(BaseAtoms::new(base_atoms as u64))
    }

    #[inline]
    fn checked_quote_for_base_(
        self,
        base_atoms: BaseAtoms,
        round_up: bool,
    ) -> Result<u128, ProgramError> {
        let inner: u128 = u64_slice_to_u128(self.inner);
        let product: u128 = inner
            .checked_mul(base_atoms.inner as u128)
            .ok_or(PriceConversionError(0x8))?;
        let quote_atoms = if round_up {
            product.div_ceil(D20)
        } else {
            product.div(D20)
        };
        trace!("base:{base_atoms} price:{self} quote:{quote_atoms}");
        assert_with_msg(
            quote_atoms <= ATOM_LIMIT,
            ManifestError::Overflow,
            "Overflow",
        )?;

        return Ok(quote_atoms);
    }

    pub fn checked_quote_for_base(
        self,
        other: BaseAtoms,
        round_up: bool,
    ) -> Result<QuoteAtoms, ProgramError> {
        self.checked_quote_for_base_(other, round_up)
            .map(|r| QuoteAtoms::new(r as u64))
    }

    pub fn checked_effective_price(
        self,
        num_base_atoms: BaseAtoms,
        is_bid: bool,
    ) -> Result<QuoteAtomsPerBaseAtom, ProgramError> {
        if BaseAtoms::ZERO == num_base_atoms {
            return Ok(self);
        }
        let quote_matched_atoms = self.checked_quote_for_base_(num_base_atoms, !is_bid)?;
        let quote_matched_d20 = quote_matched_atoms
            .checked_mul(D20)
            .ok_or(PriceConversionError(0x9))?;
        // no special case rounding needed because effective price is just a value used to compare for order
        let inner = quote_matched_d20.div(num_base_atoms.inner as u128);
        Ok(QuoteAtomsPerBaseAtom { inner: u128_to_u64_slice(inner) })
    }
}

impl Ord for QuoteAtomsPerBaseAtom {
    fn cmp(&self, other: &Self) -> Ordering {
        (u64_slice_to_u128(self.inner)).cmp(&u64_slice_to_u128(other.inner))
    }
}

impl PartialOrd for QuoteAtomsPerBaseAtom {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for QuoteAtomsPerBaseAtom {
    fn eq(&self, other: &Self) -> bool {
        (self.inner) == (other.inner)
    }
}

impl Eq for QuoteAtomsPerBaseAtom {}

impl std::fmt::Display for QuoteAtomsPerBaseAtom {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_fmt(format_args!("{}", &(u64_slice_to_u128(self.inner) as f64 / D20F)))
    }
}

impl std::fmt::Debug for QuoteAtomsPerBaseAtom {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("QuoteAtomsPerBaseAtom")
            .field("value", &(u64_slice_to_u128(self.inner) as f64 / D20F))
            .finish()
    }
}

#[derive(Debug)]
pub struct PriceConversionError(u32);

const PRICE_CONVERSION_ERROR_BASE: u32 = 100;

impl From<PriceConversionError> for ProgramError {
    fn from(value: PriceConversionError) -> Self {
        ProgramError::Custom(value.0 + PRICE_CONVERSION_ERROR_BASE)
    }
}

impl TryFrom<f64> for QuoteAtomsPerBaseAtom {
    type Error = PriceConversionError;

    fn try_from(value: f64) -> Result<Self, Self::Error> {
        let mantissa = value * D20F;
        if mantissa.is_infinite() {
            msg!("infinite can not be expressed as fixed point decimal");
            return Err(PriceConversionError(0xC));
        }
        if mantissa.is_nan() {
            msg!("nan can not be expressed as fixed point decimal");
            return Err(PriceConversionError(0xD));
        }
        if mantissa > u128::MAX as f64 {
            msg!("price is too large");
            return Err(PriceConversionError(0xE));
        }
        Ok(QuoteAtomsPerBaseAtom {
            inner: u128_to_u64_slice(mantissa as u128),
        })
    }
}

impl BaseAtoms {
    pub fn checked_mul(
        self,
        other: QuoteAtomsPerBaseAtom,
        round_up: bool,
    ) -> Result<QuoteAtoms, ProgramError> {
        other.checked_quote_for_base(self, round_up)
    }
}

#[test]
fn test_new_constructor_macro() {
    let base_atoms_1: BaseAtoms = BaseAtoms::new(5);
    let base_atoms_2: BaseAtoms = BaseAtoms::new(10);

    assert_eq!(base_atoms_1 + base_atoms_2, BaseAtoms::new(15));
    assert!((base_atoms_1 + base_atoms_2).eq(&BaseAtoms::new(15)));
    assert!((base_atoms_1 + base_atoms_2).eq(&15_u64));
    assert!(15u64.eq(&(base_atoms_1 + base_atoms_2)));
}

#[test]
fn test_checked_add() {
    let base_atoms_1: BaseAtoms = BaseAtoms::new(1);
    let base_atoms_2: BaseAtoms = BaseAtoms::new(2);
    assert_eq!(
        base_atoms_1.checked_add(base_atoms_2).unwrap(),
        BaseAtoms::new(3)
    );

    let base_atoms_1: BaseAtoms = BaseAtoms::new(u64::MAX - 1);
    let base_atoms_2: BaseAtoms = BaseAtoms::new(2);
    assert!(base_atoms_1.checked_add(base_atoms_2).is_err());
}

#[test]
fn test_checked_sub() {
    let base_atoms_1: BaseAtoms = BaseAtoms::new(1);
    let base_atoms_2: BaseAtoms = BaseAtoms::new(2);
    assert_eq!(
        base_atoms_2.checked_sub(base_atoms_1).unwrap(),
        BaseAtoms::new(1)
    );

    assert!(base_atoms_1.checked_sub(base_atoms_2).is_err());
}

#[test]
fn test_multiply_macro() {
    let base_atoms: BaseAtoms = BaseAtoms::new(5);
    let quote_atoms_per_base_atom: QuoteAtomsPerBaseAtom = QuoteAtomsPerBaseAtom {
        inner: u128_to_u64_slice(100 * D20 - 1),
    };
    assert_eq!(
        base_atoms
            .checked_mul(quote_atoms_per_base_atom, true)
            .unwrap(),
        QuoteAtoms::new(500)
    );
}

#[test]
fn test_print() {
    println!("{}", BaseAtoms::new(1));
    println!("{}", QuoteAtoms::new(2));
    println!(
        "{}",
        QuoteAtomsPerBaseAtom {
            inner: u128_to_u64_slice(123 * D20 / 100),
        }
    );
}

#[test]
fn test_debug() {
    println!("{:?}", BaseAtoms::new(1));
    println!("{:?}", QuoteAtoms::new(2));
    println!(
        "{:?}",
        QuoteAtomsPerBaseAtom {
            inner: u128_to_u64_slice(123 * D20 / 100),
        }
    );
}
