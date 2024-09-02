use std::fmt::Display;

use bytemuck::{Pod, Zeroable};

use crate::DataIndex;

pub const NIL: DataIndex = DataIndex::MAX;

pub trait TreeValue: Zeroable + Pod + PartialOrd + Ord + PartialEq + Eq + Display {}
impl<T: Zeroable + Pod + PartialOrd + Ord + PartialEq + Eq + Display> TreeValue for T {}

// TODO: Make this for all possible orderbook data structures (linked list), not just trees
pub trait TreeReadOperations<'a> {
    fn lookup_index<V: TreeValue>(&'a self, value: &V) -> DataIndex;
    fn get_max_index(&self) -> DataIndex;
    fn get_root_index(&self) -> DataIndex;
    fn get_predecessor_index<V: TreeValue>(&'a self, index: DataIndex) -> DataIndex;
    fn get_successor_index<V: TreeValue>(&'a self, index: DataIndex) -> DataIndex;

    // TODO: Make this implementation generic, difference from what is
    // implemented is that it returns the value, not RBNode<V>
    // fn iter<V: TreeValue, I: Iterator<Item = (DataIndex, &'a V)> + 'a >(&'a self) -> I;
}

pub(crate) trait GetReadOnlyData<'a> {
    fn data(&'a self) -> &'a [u8];
    fn root_index(&self) -> DataIndex;
    fn max_index(&self) -> DataIndex;
}

pub trait TreeWriteOperations<'a, V: TreeValue> {
    fn insert(&mut self, index: DataIndex, value: V);
    fn remove_by_index(&mut self, index: DataIndex);
}
