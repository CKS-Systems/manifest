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

    // TODO: Make this implementation generic, difference from what is
    // implemented is that it returns the value, not RBNode<V>
    // fn iter<V: TreeValue, I: Iterator<Item = (DataIndex, &'a V)> + 'a >(&'a self) -> I;
}

pub trait HyperTreeWriteOperations<'a, V: Payload> {
    fn insert(&mut self, index: DataIndex, value: V);
    fn remove_by_index(&mut self, index: DataIndex);
}

// Specific to red black trees and not all data structures. Implementing this
// gets a lot of other stuff for free.
pub(crate) trait GetRedBlackReadOnlyData<'a> {
    fn data(&'a self) -> &'a [u8];
    fn root_index(&self) -> DataIndex;
    fn max_index(&self) -> DataIndex;
}
pub(crate) trait GetRedBlackData<'a> {
    fn data(&'a mut self) -> &'a mut [u8];
}
