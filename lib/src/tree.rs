use std::fmt::Display;

use bytemuck::{Pod, Zeroable};

use crate::DataIndex;

pub const NIL: DataIndex = DataIndex::MAX;

pub trait Payload: Zeroable + Pod + PartialOrd + Ord + PartialEq + Eq + Display {}
impl<T: Zeroable + Pod + PartialOrd + Ord + PartialEq + Eq + Display> Payload for T {}

// A HyperTree is any datastructure that does not require contiguous memory and
// implements max, insert, delete, lookup, iterator, successor, predecessor.
// Read and write operations can be separated.
pub trait HyperTreeReadOperations<'a> {
    fn lookup_index<V: Payload>(&'a self, value: &V) -> DataIndex;
    fn get_max_index(&self) -> DataIndex;
    fn get_root_index(&self) -> DataIndex;
    fn get_predecessor_index<V: Payload>(&'a self, index: DataIndex) -> DataIndex;
    fn get_successor_index<V: Payload>(&'a self, index: DataIndex) -> DataIndex;
}

pub struct HyperTreeValueReadOnlyIterator<'a, T: HyperTreeReadOperations<'a>, V: Payload> {
    pub(crate) tree: &'a T,
    pub(crate) index: DataIndex,
    pub(crate) phantom: std::marker::PhantomData<&'a V>,
}

pub trait HyperTreeValueIteratorTrait<'a, T: HyperTreeReadOperations<'a>> {
    fn iter<V: Payload>(&'a self) -> HyperTreeValueReadOnlyIterator<T, V>;
}

pub trait HyperTreeWriteOperations<'a, V: Payload> {
    fn insert(&mut self, index: DataIndex, value: V);
    fn remove_by_index(&mut self, index: DataIndex);
}

// Specific to red black trees and not all data structures. Implementing this
// gets a lot of other stuff for free.
pub trait GetRedBlackReadOnlyData<'a> {
    fn data(&'a self) -> &'a [u8];
    fn root_index(&self) -> DataIndex;
    fn max_index(&self) -> DataIndex;
}
