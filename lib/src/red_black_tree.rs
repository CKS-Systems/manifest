use bytemuck::{Pod, Zeroable};
use std::{cmp::Ordering, fmt::Display};

use crate::{get_helper, get_mut_helper, trace, DataIndex};

pub const NIL: DataIndex = DataIndex::MAX;
pub const RBTREE_OVERHEAD_BYTES: usize = 16;
pub trait TreeValue: Zeroable + Pod + PartialOrd + Ord + PartialEq + Eq + Display {}
impl<T: Zeroable + Pod + PartialOrd + Ord + PartialEq + Eq + Display> TreeValue for T {}

/// A Red-Black tree which supports random access O(log n), insert O(log n),
/// delete O(log n), and get max O(1)
pub struct RedBlackTree<'a, V: TreeValue> {
    /// The address within data that the root node starts.
    root_index: DataIndex,
    /// Unowned byte array which contains all the data for this tree and possibly more.
    data: &'a mut [u8],

    /// Max allowing O(1) access for matching top of book.
    /// If this is initialized to NIL on a tree that is not empty, then do not
    /// update and just keep it as NIL. This feature is only useful for usage
    /// patterns that frequently visit the max.
    max_index: DataIndex,

    phantom: std::marker::PhantomData<&'a V>,
}

/// A Red-Black tree which supports random access O(log n) and get max O(1),
/// but does not require the data to be mutable.
pub struct RedBlackTreeReadOnly<'a, V: TreeValue> {
    /// The address within data that the root node starts.
    root_index: DataIndex,
    /// Unowned byte array which contains all the data for this tree and possibly more.
    data: &'a [u8],

    /// Max allowing O(1) access for matching top of book.
    /// If this is initialized to NIL on a tree that is not empty, then do not
    /// update and just keep it as NIL. This feature is only useful for usage
    /// patterns that frequently visit the max.
    max_index: DataIndex,

    phantom: std::marker::PhantomData<&'a V>,
}

impl<'a, V: TreeValue> RedBlackTreeReadOnly<'a, V> {
    /// Creates a new RedBlackTree. Does not mutate data yet. Assumes the actual
    /// data in data is already well formed as a red black tree.
    pub fn new(data: &'a [u8], root_index: DataIndex, max_index: DataIndex) -> Self {
        RedBlackTreeReadOnly::<V> {
            root_index,
            data,
            max_index,
            phantom: std::marker::PhantomData,
        }
    }

    /// Sorted iterator starting from the min.
    pub fn iter(&self) -> RedBlackTreeReadOnlyIterator<V> {
        RedBlackTreeReadOnlyIterator {
            tree: self,
            index: self.get_min_index::<V>(),
        }
    }
}
trait GetReadOnlyData<'a> {
    fn data(&'a self) -> &'a [u8];
    fn root_index(&self) -> DataIndex;
    fn max_index(&self) -> DataIndex;
}

impl<'a, V: TreeValue> GetReadOnlyData<'a> for RedBlackTreeReadOnly<'a, V> {
    fn data(&'a self) -> &'a [u8] {
        self.data
    }
    fn root_index(&self) -> DataIndex {
        self.root_index
    }
    fn max_index(&self) -> DataIndex {
        self.max_index
    }
}
impl<'a, V: TreeValue> GetReadOnlyData<'a> for RedBlackTree<'a, V> {
    fn data(&'a self) -> &'a [u8] {
        self.data
    }
    fn root_index(&self) -> DataIndex {
        self.root_index
    }
    fn max_index(&self) -> DataIndex {
        self.max_index
    }
}
trait TreeReadOperationsHelpers<'a> {
    fn get_value<V: TreeValue>(&'a self, index: DataIndex) -> &'a V;
    fn has_left<V: TreeValue>(&'a self, index: DataIndex) -> bool;
    fn has_right<V: TreeValue>(&'a self, index: DataIndex) -> bool;
    fn get_right_index<V: TreeValue>(&'a self, index: DataIndex) -> DataIndex;
    fn get_left_index<V: TreeValue>(&'a self, index: DataIndex) -> DataIndex;
    fn get_color<V: TreeValue>(&'a self, index: DataIndex) -> Color;
    fn get_parent_index<V: TreeValue>(&'a self, index: DataIndex) -> DataIndex;
    fn get_min_index<V: TreeValue>(&'a self) -> DataIndex;
    fn is_left_child<V: TreeValue>(&'a self, index: DataIndex) -> bool;
    fn is_right_child<V: TreeValue>(&'a self, index: DataIndex) -> bool;
}

impl<'a, T> TreeReadOperationsHelpers<'a> for T
where
    T: GetReadOnlyData<'a>,
{
    // TODO: Make unchecked versions of these to avoid unnecessary NIL checks
    // when we already know the index is not NIL.
    fn get_value<V: TreeValue>(&'a self, index: DataIndex) -> &'a V {
        debug_assert_ne!(index, NIL);
        let node: &RBNode<V> = get_helper::<RBNode<V>>(self.data(), index);
        &node.value
    }
    fn has_left<V: TreeValue>(&'a self, index: DataIndex) -> bool {
        debug_assert_ne!(index, NIL);
        let node: &RBNode<V> = get_helper::<RBNode<V>>(self.data(), index);
        node.left != NIL
    }
    fn has_right<V: TreeValue>(&'a self, index: DataIndex) -> bool {
        debug_assert_ne!(index, NIL);
        let node: &RBNode<V> = get_helper::<RBNode<V>>(self.data(), index);
        node.right != NIL
    }
    fn get_color<V: TreeValue>(&'a self, index: DataIndex) -> Color {
        if index == NIL {
            return Color::Black;
        }
        let node: &RBNode<V> = get_helper::<RBNode<V>>(self.data(), index);
        node.color
    }
    fn get_right_index<V: TreeValue>(&'a self, index: DataIndex) -> DataIndex {
        if index == NIL {
            return NIL;
        }
        let node: &RBNode<V> = get_helper::<RBNode<V>>(self.data(), index);
        node.right
    }
    fn get_left_index<V: TreeValue>(&'a self, index: DataIndex) -> DataIndex {
        if index == NIL {
            return NIL;
        }
        let node: &RBNode<V> = get_helper::<RBNode<V>>(self.data(), index);
        node.left
    }
    fn get_parent_index<V: TreeValue>(&'a self, index: DataIndex) -> DataIndex {
        if index == NIL {
            return NIL;
        }
        let node: &RBNode<V> = get_helper::<RBNode<V>>(self.data(), index);
        node.parent
    }

    fn get_min_index<V: TreeValue>(&'a self) -> DataIndex {
        if self.root_index() == NIL {
            return NIL;
        }
        let mut current_index: DataIndex = self.root_index();
        while self.get_left_index::<V>(current_index) != NIL {
            current_index = self.get_left_index::<V>(current_index);
        }
        current_index
    }

    fn is_left_child<V: TreeValue>(&'a self, index: DataIndex) -> bool {
        // TODO: Explore if we can store is_left_child and is_right_child in the
        // empty bits after color to avoid the compute of checking the parent.
        if index == self.root_index() {
            return false;
        }
        let parent_index: DataIndex = self.get_parent_index::<V>(index);
        self.get_left_index::<V>(parent_index) == index
    }
    fn is_right_child<V: TreeValue>(&'a self, index: DataIndex) -> bool {
        if index == self.root_index() {
            return false;
        }
        let parent_index: DataIndex = self.get_parent_index::<V>(index);
        self.get_right_index::<V>(parent_index) == index
    }
}

pub trait TreeReadOperations<'a> {
    fn lookup_index<V: TreeValue>(&'a self, value: &V) -> DataIndex;
    fn get_max_index(&self) -> DataIndex;
    fn get_root_index(&self) -> DataIndex;
    fn get_predecessor_index<V: TreeValue>(&'a self, index: DataIndex) -> DataIndex;
    fn get_successor_index<V: TreeValue>(&'a self, index: DataIndex) -> DataIndex;
}
impl<'a, T> TreeReadOperations<'a> for T
where
    T: GetReadOnlyData<'a>,
{
    /// Lookup the index of a given value.
    fn lookup_index<V: TreeValue>(&'a self, value: &V) -> DataIndex {
        if self.root_index() == NIL {
            return NIL;
        }

        let mut current_index: DataIndex = self.root_index();

        while self.get_value::<V>(current_index) != value {
            if self.get_value::<V>(current_index) > value {
                if self.has_left::<V>(current_index) {
                    current_index = self.get_left_index::<V>(current_index);
                } else {
                    return NIL;
                }
            } else if self.get_value::<V>(current_index) < value {
                if self.has_right::<V>(current_index) {
                    current_index = self.get_right_index::<V>(current_index);
                } else {
                    return NIL;
                }
            } else {
                // Check both subtrees for equal keys.
                let left_lookup: DataIndex = RedBlackTreeReadOnly::<V>::new(
                    self.data(),
                    self.get_left_index::<V>(current_index),
                    NIL,
                )
                .lookup_index(value);
                if left_lookup != NIL {
                    return left_lookup;
                }
                let right_lookup: DataIndex = RedBlackTreeReadOnly::<V>::new(
                    self.data(),
                    self.get_right_index::<V>(current_index),
                    NIL,
                )
                .lookup_index(value);
                if right_lookup != NIL {
                    return right_lookup;
                }
                return NIL;
            }
        }
        current_index
    }

    /// Get the max index. If a tree set this to NIL on a non-empty tree, this
    /// will always be NIL.
    fn get_max_index(&self) -> DataIndex {
        self.max_index()
    }

    /// Get the current root index.
    fn get_root_index(&self) -> DataIndex {
        self.root_index()
    }

    /// Get the previous index. This walks the tree, so does not care about equal keys.
    fn get_predecessor_index<V: TreeValue>(&'a self, index: DataIndex) -> DataIndex {
        if index == NIL {
            return NIL;
        }
        // Predecessor is below us.
        if self.get_left_index::<V>(index) != NIL {
            let mut current_index: DataIndex = self.get_left_index::<V>(index);
            while self.get_right_index::<V>(current_index) != NIL {
                current_index = self.get_right_index::<V>(current_index);
            }
            return current_index;
        }

        // Successor is above, keep going up while we are the left child
        let mut current_index: DataIndex = index;
        while self.is_left_child::<V>(current_index) {
            current_index = self.get_parent_index::<V>(current_index);
        }
        current_index = self.get_parent_index::<V>(current_index);

        current_index
    }

    /// Get the next index. This walks the tree, so does not care about equal keys.
    fn get_successor_index<V: TreeValue>(&'a self, index: DataIndex) -> DataIndex {
        if index == NIL {
            return NIL;
        }
        // Successor is below us.
        if self.get_right_index::<V>(index) != NIL {
            let mut current_index: DataIndex = self.get_right_index::<V>(index);
            while self.get_left_index::<V>(current_index) != NIL {
                current_index = self.get_left_index::<V>(current_index);
            }
            return current_index;
        }

        // Successor is above, keep going up while we are the right child
        let mut current_index: DataIndex = index;
        while self.is_right_child::<V>(current_index) {
            current_index = self.get_parent_index::<V>(current_index);
        }
        current_index = self.get_parent_index::<V>(current_index);

        current_index
    }
}

#[repr(u32)]
#[derive(Debug, Copy, Clone, PartialEq, Default)]
enum Color {
    #[default]
    Black = 0,
    Red = 1,
}

unsafe impl Zeroable for Color {
    fn zeroed() -> Self {
        unsafe { core::mem::zeroed() }
    }
}

#[derive(Debug, Default, Copy, Clone, Zeroable)]
#[repr(C)]
/// Node in a RedBlack tree. The first 16 bytes are used for maintaining the
/// RedBlack and BST properties, the rest is the payload.
pub struct RBNode<V> {
    left: DataIndex,
    right: DataIndex,
    parent: DataIndex,
    color: Color,
    // TODO: include an integer that the program can use for identifying types
    // of nodes. This will prevent the attack where a hinted action maliciously
    // uses a different type of node.
    value: V,
}
unsafe impl<V: TreeValue> Pod for RBNode<V> {}

impl<V: TreeValue> Ord for RBNode<V> {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.value).cmp(&(other.value))
    }
}

impl<V: TreeValue> PartialOrd for RBNode<V> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl<V: TreeValue> PartialEq for RBNode<V> {
    fn eq(&self, other: &Self) -> bool {
        (self.value) == (other.value)
    }
}

impl<V: TreeValue> Eq for RBNode<V> {}

impl<V: TreeValue> std::fmt::Display for RBNode<V> {
    fn fmt(&self, fmt: &mut std::fmt::Formatter<'_>) -> Result<(), std::fmt::Error> {
        write!(fmt, "{}", self.value)
    }
}

impl<V: TreeValue> RBNode<V> {
    fn get_left_index(&self) -> DataIndex {
        self.left
    }
    fn get_right_index(&self) -> DataIndex {
        self.right
    }
    pub fn get_mut_value(&mut self) -> &mut V {
        &mut self.value
    }
    pub fn get_value(&self) -> &V {
        &self.value
    }
}

impl<'a, V: TreeValue> RedBlackTree<'a, V> {
    /// Creates a new RedBlackTree. Does not mutate data yet. Assumes the actual
    /// data in data is already well formed as a red black tree.
    pub fn new(data: &'a mut [u8], root_index: DataIndex, max_index: DataIndex) -> Self {
        RedBlackTree::<V> {
            root_index,
            data,
            phantom: std::marker::PhantomData,
            max_index,
        }
    }

    /// Insert and rebalance. The data at index should be already zeroed.
    pub fn insert(&mut self, index: DataIndex, value: V) {
        trace!("TREE insert {index}");

        // Case where this is now the root
        if self.root_index == NIL {
            self.root_index = index;
            self.max_index = index;
            let root_node: &mut RBNode<V> = get_mut_helper::<RBNode<V>>(self.data, index);
            let new_node: RBNode<V> = RBNode {
                left: NIL,
                right: NIL,
                parent: NIL,
                color: Color::Black,
                value,
            };
            *root_node = new_node;
            return;
        }

        // Case where we walk the tree to add then will go back and fix coloring
        let new_node: RBNode<V> = RBNode {
            left: NIL,
            right: NIL,
            parent: NIL,
            color: Color::Red,
            value,
        };

        if self.max_index != NIL && *get_helper::<RBNode<V>>(self.data, self.max_index) < new_node {
            self.max_index = index;
        }
        self.insert_node_no_fix(new_node, index);
        self.insert_fix(index);

        #[cfg(test)]
        self.verify_rb_tree()
    }

    #[cfg(test)]
    fn remove_by_value(&mut self, value: &V) {
        let index: DataIndex = self.lookup_index(value);
        if index == NIL {
            return;
        }
        self.remove_by_index(index);
    }

    /// Remove a node by index and rebalance.
    pub fn remove_by_index(&mut self, index: DataIndex) {
        trace!("TREE remove {index}");

        // Silently fail on removing NIL nodes.
        if index == NIL {
            return;
        }
        if index == self.max_index {
            trace!(
                "TREE max {}->{}",
                self.max_index,
                self.get_predecessor_index::<V>(self.max_index)
            );
            self.max_index = self.get_predecessor_index::<V>(self.max_index);
        }

        // If it is an internal node, we copy the successor value here and call
        // delete on the successor. We could do either the successor or
        // predecessor. We pick the successor because we would prefer the side
        // of the tree with the max to be sparser.
        if self.is_internal(index) {
            // Swap nodes
            let successor_index: DataIndex = self.get_successor_index::<V>(index);
            self.swap_nodes(index, successor_index);
        }

        // Now we are guaranteed that the node to delete is either a leaf or has
        // only one child. Because there is only one possible child, check if
        // either is Red since NIL is Black.
        let to_delete_color: Color = self.get_color::<V>(index);
        let child_color: Color = if self.get_color::<V>(self.get_left_index::<V>(index)) == Color::Red
            || self.get_color::<V>(self.get_right_index::<V>(index)) == Color::Red
        {
            Color::Red
        } else {
            Color::Black
        };
        if child_color == Color::Red || to_delete_color == Color::Red {
            // Simple case make the new one Black and move the child onto current.
            let child_index: DataIndex = self.get_child_index(index);
            self.update_parent_child(index);
            self.set_color(child_index, Color::Black);
            return;
        }

        // Actually removes from the tree
        let child_index: DataIndex = self.get_child_index(index);
        let parent_index: DataIndex = self.get_parent_index::<V>(index);
        self.update_parent_child(index);
        self.remove_fix(child_index, parent_index);
    }

    fn remove_fix(&mut self, current_index: DataIndex, parent_index: DataIndex) {
        // Current is double black. It could be NIL if we just deleted a leaf,
        // so we need the parent to know where in the tree we are.

        // If we get to the root, then we are done.
        if self.root_index == current_index {
            return;
        }

        let sibling_index: DataIndex = self.get_sibling_index(current_index, parent_index);
        let sibling_color: Color = self.get_color::<V>(sibling_index);
        let parent_color: Color = self.get_color::<V>(parent_index);

        let sibling_has_red_child: bool = self.get_color::<V>(self.get_left_index::<V>(sibling_index))
            == Color::Red
            || self.get_color::<V>(self.get_right_index::<V>(sibling_index)) == Color::Red;

        // 3a
        if sibling_color == Color::Black && sibling_has_red_child {
            let sibling_left_child_index: DataIndex = self.get_left_index::<V>(sibling_index);
            let sibling_right_child_index: DataIndex = self.get_right_index::<V>(sibling_index);
            // i left left
            if self.get_color::<V>(sibling_left_child_index) == Color::Red
                && self.is_left_child::<V>(sibling_index)
            {
                self.set_color(sibling_left_child_index, Color::Black);
                self.set_color(parent_index, sibling_color);
                self.set_color(sibling_index, parent_color);
                self.rotate_right(parent_index);
                return;
            }
            // ii left right
            if self.get_color::<V>(sibling_right_child_index) == Color::Red
                && self.is_left_child::<V>(sibling_index)
            {
                self.set_color(sibling_right_child_index, Color::Red);
                self.set_color(parent_index, Color::Black);
                self.set_color(sibling_index, Color::Black);
                self.rotate_left(sibling_index);
                self.rotate_right(parent_index);
                return;
            }
            // iii right right
            if self.get_color::<V>(sibling_right_child_index) == Color::Red
                && self.is_right_child::<V>(sibling_index)
            {
                self.set_color(sibling_right_child_index, Color::Black);
                self.set_color(parent_index, sibling_color);
                self.set_color(sibling_index, parent_color);
                self.rotate_left(parent_index);
                return;
            }
            // iv right left
            if self.get_color::<V>(sibling_left_child_index) == Color::Red
                && self.is_right_child::<V>(sibling_index)
            {
                self.set_color(sibling_left_child_index, Color::Red);
                self.set_color(parent_index, Color::Black);
                self.set_color(sibling_index, Color::Black);
                self.rotate_right(sibling_index);
                self.rotate_left(parent_index);
                return;
            }
            unreachable!();
        }

        // 3b
        // Sibling is black and both children are black
        if sibling_color == Color::Black {
            self.set_color(sibling_index, Color::Red);
            if parent_color == Color::Black {
                // Recurse on the parent
                self.remove_fix(parent_index, self.get_parent_index::<V>(parent_index));
                return;
            } else {
                self.set_color(parent_index, Color::Black);
                return;
            }
        }

        // 3c
        // Sibing is red
        if self.is_left_child::<V>(sibling_index) {
            self.rotate_right(parent_index);
            self.set_color(parent_index, Color::Red);
            self.set_color(sibling_index, Color::Black);
            self.remove_fix(current_index, parent_index);
        } else if self.is_right_child::<V>(sibling_index) {
            self.rotate_left(parent_index);
            self.set_color(parent_index, Color::Red);
            self.set_color(sibling_index, Color::Black);
            self.remove_fix(current_index, parent_index);
        }
    }

    /// Insert a node into the subtree without fixing. This node could be a leaf
    /// or a subtree itself.
    fn insert_node_no_fix(&mut self, node_to_insert: RBNode<V>, new_node_index: DataIndex) {
        let mut current_parent: &RBNode<V> = get_helper::<RBNode<V>>(self.data, self.root_index);
        let mut current_parent_index: DataIndex = self.root_index;

        // Keep trying to walk while there are children. Breaks when there isnt
        // the expected child or at a leaf.
        while current_parent.left != NIL || current_parent.right != NIL {
            match node_to_insert.cmp(current_parent) {
                Ordering::Greater => {
                    let right_index: DataIndex = current_parent.get_right_index();
                    if right_index != NIL {
                        // Keep going down the right subtree
                        current_parent = get_helper::<RBNode<V>>(self.data, right_index);
                        current_parent_index = right_index;
                    } else {
                        break;
                    }
                }
                Ordering::Less => {
                    let left_index: DataIndex = current_parent.get_left_index();
                    if left_index != NIL {
                        // Keep going down the left subtree
                        current_parent = get_helper::<RBNode<V>>(self.data, left_index);
                        current_parent_index = left_index;
                    } else {
                        break;
                    }
                }
                Ordering::Equal => {
                    // Equal. Defaults to left to preserve FIFO.
                    let left_index: DataIndex = current_parent.get_left_index();
                    if left_index != NIL {
                        // Keep going down the left subtree
                        current_parent = get_helper::<RBNode<V>>(self.data, left_index);
                        current_parent_index = left_index;
                    } else {
                        break;
                    }
                }
            }
        }
        // We ended at a leaf and need to add below.
        if *self.get_node(current_parent_index) < node_to_insert {
            self.set_right_index(current_parent_index, new_node_index);
        } else {
            self.set_left_index(current_parent_index, new_node_index);
        }

        // Put the leaf in the tree and update its parent.
        {
            let new_node: &mut RBNode<V> = get_mut_helper::<RBNode<V>>(self.data, new_node_index);
            *new_node = node_to_insert;
            new_node.parent = current_parent_index;
        }
    }

    fn insert_fix(&mut self, index_to_fix: DataIndex) {
        if self.root_index == index_to_fix {
            self.set_color(index_to_fix, Color::Black);
            return;
        }

        // Check the color of the parent. If it is black, then nothing left to do.
        let parent_index: DataIndex = self.get_parent_index::<V>(index_to_fix);
        let parent_color: Color = self.get_color::<V>(parent_index);

        if parent_color == Color::Black {
            return;
        }

        let grandparent_index: DataIndex = self.get_parent_index::<V>(parent_index);

        // 5 possibilities  https://www.geeksforgeeks.org/insertion-in-red-black-tree/#
        // 1. Uncle is red
        // 2. Uncle is black LL
        // 3. Uncle is black LR
        // 4. Uncle is black RR
        // 5. Uncle is black RL
        let uncle_index: DataIndex = if self.get_left_index::<V>(grandparent_index) == parent_index
        {
            self.get_right_index::<V>(grandparent_index)
        } else {
            self.get_left_index::<V>(grandparent_index)
        };
        let uncle_color: Color = self.get_color::<V>(uncle_index);

        // Case I: Uncle is red
        if uncle_color == Color::Red {
            self.set_color(parent_index, Color::Black);
            self.set_color(uncle_index, Color::Black);
            self.set_color(grandparent_index, Color::Red);

            // Recurse
            self.insert_fix(grandparent_index);
            return;
        }

        let grandparent_color: Color = self.get_color::<V>(grandparent_index);
        let parent_color: Color = self.get_color::<V>(parent_index);
        let parent_is_left: bool = self.is_left_child::<V>(parent_index);
        let current_is_left: bool = self.is_left_child::<V>(index_to_fix);

        // Case II: Uncle is black, left left
        if parent_is_left && current_is_left {
            self.rotate_right(grandparent_index);
            self.set_color(grandparent_index, parent_color);
            self.set_color(parent_index, grandparent_color);
        }
        let index_to_fix_color: Color = self.get_color::<V>(index_to_fix);
        // Case III: Uncle is black, left right
        if parent_is_left && !current_is_left {
            self.rotate_left(parent_index);
            self.rotate_right(grandparent_index);
            self.set_color(grandparent_index, index_to_fix_color);
            self.set_color(index_to_fix, grandparent_color);
        }
        // Case IV: Uncle is black, right right
        if !parent_is_left && !current_is_left {
            self.rotate_left(grandparent_index);
            self.set_color(grandparent_index, parent_color);
            self.set_color(parent_index, grandparent_color);
        }
        // Case V: Uncle is black, right left
        if !parent_is_left && current_is_left {
            self.rotate_right(parent_index);
            self.rotate_left(grandparent_index);
            self.set_color(grandparent_index, index_to_fix_color);
            self.set_color(index_to_fix, grandparent_color);
        }
    }

    fn rotate_left(&mut self, index: DataIndex) {
        // Left rotate of G
        //
        //         GG                     GG
        //         |                      |
        //         G                      P
        //       /   \                  /   \
        //      U     P     --->      G      X
        //          /   \           /   \
        //        Y      X        U       Y

        let g_index: DataIndex = index;
        let p_index: DataIndex = self.get_right_index::<V>(g_index);
        let x_index: DataIndex = self.get_right_index::<V>(p_index);
        let y_index: DataIndex = self.get_left_index::<V>(p_index);
        let gg_index: DataIndex = self.get_parent_index::<V>(index);

        // P
        {
            // Does not use the helpers to avoid redundant NIL checks.
            let p_node: &mut RBNode<V> = get_mut_helper::<RBNode<V>>(self.data, p_index);
            p_node.parent = gg_index;
            p_node.left = g_index;
            p_node.right = x_index;
        }

        // Y
        self.set_parent_index(y_index, g_index);

        // G
        {
            let g_node: &mut RBNode<V> = get_mut_helper::<RBNode<V>>(self.data, g_index);
            g_node.parent = p_index;
            g_node.right = y_index;
        }

        // X

        // GG
        if gg_index != NIL {
            if self.get_left_index::<V>(gg_index) == index {
                self.set_left_index(gg_index, p_index);
            }
            if self.get_right_index::<V>(gg_index) == index {
                self.set_right_index(gg_index, p_index);
            }
        }

        // U
        // Unchanged, just included for completeness

        // Root
        if self.root_index == g_index {
            self.root_index = p_index;
        }
    }

    fn rotate_right(&mut self, index: DataIndex) {
        // Right rotate of G
        //
        //         GG                     GG
        //         |                      |
        //         G                      P
        //       /   \                  /   \
        //      P     U     --->      X       G
        //    /  \                          /   \
        //  X     Y                       Y       U

        let g_index: DataIndex = index;
        let p_index: DataIndex = self.get_left_index::<V>(g_index);
        let x_index: DataIndex = self.get_left_index::<V>(p_index);
        let y_index: DataIndex = self.get_right_index::<V>(p_index);
        let gg_index: DataIndex = self.get_parent_index::<V>(index);

        // P
        {
            // Does not use the helpers to avoid redundant NIL checks.
            let p_node: &mut RBNode<V> = get_mut_helper::<RBNode<V>>(self.data, p_index);
            p_node.parent = gg_index;
            p_node.left = x_index;
            p_node.right = g_index;
        }

        // Y
        self.set_parent_index(y_index, g_index);

        // X

        // G
        {
            let g_node: &mut RBNode<V> = get_mut_helper::<RBNode<V>>(self.data, g_index);
            g_node.parent = p_index;
            g_node.left = y_index;
        }

        // GG
        if gg_index != NIL {
            if self.get_left_index::<V>(gg_index) == index {
                self.set_left_index(gg_index, p_index);
            }
            if self.get_right_index::<V>(gg_index) == index {
                self.set_right_index(gg_index, p_index);
            }
        }

        // U
        // Unchanged, just included for completeness

        // Root
        if self.root_index == g_index {
            self.root_index = p_index;
        }
    }

    // TODO: Remove the NIL checks here when possible.
    fn set_color(&mut self, index: DataIndex, color: Color) {
        if index == NIL {
            return;
        }
        let node: &mut RBNode<V> = get_mut_helper::<RBNode<V>>(self.data, index);
        node.color = color;
    }
    fn set_parent_index(&mut self, index: DataIndex, parent_index: DataIndex) {
        if index == NIL {
            return;
        }
        let node: &mut RBNode<V> = get_mut_helper::<RBNode<V>>(self.data, index);
        node.parent = parent_index;
    }
    fn set_left_index(&mut self, index: DataIndex, left_index: DataIndex) {
        if index == NIL {
            return;
        }
        let node: &mut RBNode<V> = get_mut_helper::<RBNode<V>>(self.data, index);
        node.left = left_index;
    }
    fn set_right_index(&mut self, index: DataIndex, right_index: DataIndex) {
        if index == NIL {
            return;
        }
        let node: &mut RBNode<V> = get_mut_helper::<RBNode<V>>(self.data, index);
        node.right = right_index;
    }
    fn swap_nodes(&mut self, index_0: DataIndex, index_1: DataIndex) {
        let parent_0: DataIndex = self.get_parent_index::<V>(index_0);
        let parent_1: DataIndex = self.get_parent_index::<V>(index_1);
        let left_0: DataIndex = self.get_left_index::<V>(index_0);
        let left_1: DataIndex = self.get_left_index::<V>(index_1);
        let right_0: DataIndex = self.get_right_index::<V>(index_0);
        let right_1: DataIndex = self.get_right_index::<V>(index_1);

        let is_left_0: bool = self.is_left_child::<V>(index_0);
        let is_left_1: bool = self.is_left_child::<V>(index_1);

        // Setting the above parent coming down for both.
        if is_left_0 {
            self.set_left_index(parent_0, index_1);
        } else {
            self.set_right_index(parent_0, index_1);
        }
        if is_left_1 {
            self.set_left_index(parent_1, index_0);
        } else {
            self.set_right_index(parent_1, index_0);
        }

        self.set_left_index(index_0, left_1);
        self.set_right_index(index_0, right_1);
        self.set_parent_index(index_0, parent_1);

        self.set_left_index(index_1, left_0);
        self.set_right_index(index_1, right_0);
        self.set_parent_index(index_1, parent_0);

        self.set_parent_index(left_0, index_1);
        self.set_parent_index(left_1, index_0);
        self.set_parent_index(right_0, index_1);
        self.set_parent_index(right_1, index_0);

        // Edge case of swapping with successor.
        if parent_1 == index_0 {
            self.set_parent_index(index_0, index_1);
            self.set_parent_index(index_1, parent_0);
            self.set_right_index(index_1, index_0);
        }

        // Should not happen because we only swap with successor of an
        // internal node. Root is a successor of a leaf.
        debug_assert_ne!(self.root_index, index_1);
        if self.root_index == index_0 {
            self.root_index = index_1;
        }

        let index_0_color: Color = self.get_color::<V>(index_0);
        let index_1_color: Color = self.get_color::<V>(index_1);
        self.set_color(index_0, index_1_color);
        self.set_color(index_1, index_0_color);
    }
    fn get_node(&self, index: DataIndex) -> &RBNode<V> {
        debug_assert_ne!(index, NIL);
        let node: &RBNode<V> = get_helper::<RBNode<V>>(self.data, index);
        node
    }

    // Take out the node in the middle and fix parent child relationships
    fn update_parent_child(&mut self, index: DataIndex) {
        debug_assert_ne!(index, NIL);
        debug_assert!(!self.is_internal(index));

        let parent_index: DataIndex = self.get_parent_index::<V>(index);
        let child_index: DataIndex = self.get_child_index(index);

        trace!("TREE update parent child {parent_index}<-{index}<-{child_index}");
        self.set_parent_index(child_index, parent_index);
        if self.is_left_child::<V>(index) {
            self.set_left_index(parent_index, child_index);
        } else {
            self.set_right_index(parent_index, child_index);
        }
        if self.root_index == index {
            self.root_index = child_index;
        }
    }
    fn get_child_index(&self, index: DataIndex) -> DataIndex {
        debug_assert_ne!(index, NIL);
        // Assert that there are not both. This is getting the unique child.
        debug_assert!(!(self.has_left::<V>(index) && self.has_right::<V>(index)));

        let left_child_index: DataIndex = self.get_left_index::<V>(index);
        let child_index: DataIndex = if left_child_index != NIL {
            left_child_index
        } else {
            self.get_right_index::<V>(index)
        };
        child_index
    }
    fn is_internal(&self, index: DataIndex) -> bool {
        debug_assert_ne!(index, NIL);
        self.get_right_index::<V>(index) != NIL && self.get_left_index::<V>(index) != NIL
    }

    fn get_sibling_index(&self, index: DataIndex, parent_index: DataIndex) -> DataIndex {
        debug_assert_ne!(parent_index, NIL);
        let parent_left_child_index: DataIndex = self.get_left_index::<V>(parent_index);
        if parent_left_child_index == index {
            self.get_right_index::<V>(parent_index)
        } else {
            parent_left_child_index
        }
    }

    /// Sorted iterator starting from the min.
    pub fn iter(&self) -> RedBlackTreeIterator<V> {
        RedBlackTreeIterator {
            tree: self,
            index: self.get_min_index::<V>(),
        }
    }

    // Only used in pretty printing, so can be slow
    #[cfg(test)]
    fn depth(&self, index: DataIndex) -> i32 {
        let mut depth = -1;
        let mut current_index: DataIndex = index;
        while current_index != NIL {
            current_index = self.get_parent_index::<V>(current_index);
            depth += 1;
        }
        depth
    }
    #[cfg(test)]
    fn max_depth(&self) -> i32 {
        let max_depth: i32 = self.iter().fold(0, |a, b| a.max(self.depth(b.0)));
        max_depth
    }
    #[cfg(test)]
    fn x(&self, index: DataIndex) -> i32 {
        // Max depth
        let max_depth: i32 = self.max_depth();

        let mut x: i32 = 0;
        let mut current_index: DataIndex = index;
        while current_index != NIL {
            if self.is_left_child::<V>(current_index) {
                x -= i32::pow(2, (max_depth - self.depth(current_index)) as u32);
            }
            if self.is_right_child::<V>(current_index) {
                x += i32::pow(2, (max_depth - self.depth(current_index)) as u32);
            }
            current_index = self.get_parent_index::<V>(current_index);
        }
        x
    }

    #[cfg(test)]
    pub(crate) fn pretty_print(&self) {
        // Get the max depth and max / min X
        let max_depth: i32 = self.iter().fold(0, |a, b| a.max(self.depth(b.0)));
        let max_x: i32 = self.iter().fold(0, |a, b| a.max(self.x(b.0)));
        let min_x: i32 = self.iter().fold(0, |a, b| a.min(self.x(b.0)));
        solana_program::msg!("=========Pretty Print===========");
        for y in 0..(max_depth + 1) {
            let mut row_str: String = String::new();
            for x in (min_x)..(max_x + 1) {
                let mut found: bool = false;
                for (index, node) in self.iter() {
                    if self.depth(index) == y && self.x(index) == x {
                        found = true;
                        let str = &format!("{:<5}", node);
                        if node.color == Color::Red {
                            // Cannot use with sbf. Enable when debugging
                            // locally without sbf.
                            #[cfg(colored)]
                            {
                                use colored::Colorize;
                                row_str += &format!("{}", str.red());
                            }
                            #[cfg(not(colored))]
                            {
                                row_str += &str.to_string();
                            }
                        } else {
                            row_str += str;
                        }
                    }
                }
                if !found {
                    row_str += &format!("{:<5}", "");
                }
            }
            solana_program::msg!("{}", row_str);
        }
        let mut end: String = String::new();
        for _x in (min_x)..(max_x + 1) {
            end += "=====";
        }
        solana_program::msg!("{}", end);
    }

    #[cfg(test)]
    pub(crate) fn verify_rb_tree(&self) {
        // Verify that all red nodes only have black children
        for (index, node) in self.iter() {
            if node.color == Color::Red {
                assert!(self.get_color::<V>(self.get_left_index::<V>(index)) == Color::Black);
                assert!(self.get_color::<V>(self.get_right_index::<V>(index)) == Color::Black);
            }
        }

        // Verify that all nodes have the same number of black nodes to the root.
        let first_index: DataIndex = self.get_min_index::<V>();
        let num_black: i32 = self.num_black_nodes_through_root(first_index);

        for (index, _node) in self.iter() {
            if !self.has_left::<V>(index) || !self.has_right::<V>(index) {
                assert!(num_black == self.num_black_nodes_through_root(index));
            }
        }
    }
    #[cfg(test)]
    fn num_black_nodes_through_root(&self, index: DataIndex) -> i32 {
        let mut num_black_nodes: i32 = 0;
        let mut current_index: DataIndex = index;

        while current_index != NIL {
            if self.get_color::<V>(current_index) == Color::Black {
                num_black_nodes += 1;
            }
            current_index = self.get_parent_index::<V>(current_index);
        }
        num_black_nodes
    }
}

pub struct RedBlackTreeIterator<'a, V: TreeValue> {
    tree: &'a RedBlackTree<'a, V>,
    index: DataIndex,
}

impl<'a, V: TreeValue> Iterator for RedBlackTreeIterator<'a, V> {
    type Item = (DataIndex, &'a RBNode<V>);

    fn next(&mut self) -> Option<Self::Item> {
        let index: DataIndex = self.index;
        let successor_index: DataIndex = self.tree.get_successor_index::<V>(self.index);
        if index == NIL {
            None
        } else {
            let result: &RBNode<V> = get_helper::<RBNode<V>>(self.tree.data, index);
            self.index = successor_index;
            Some((index, result))
        }
    }
}

pub struct RedBlackTreeReadOnlyIterator<'a, V: TreeValue> {
    tree: &'a RedBlackTreeReadOnly<'a, V>,
    index: DataIndex,
}

impl<'a, V: TreeValue> Iterator for RedBlackTreeReadOnlyIterator<'a, V> {
    type Item = (DataIndex, &'a RBNode<V>);

    fn next(&mut self) -> Option<Self::Item> {
        let index: DataIndex = self.index;
        let successor_index: DataIndex = self.tree.get_successor_index::<V>(self.index);
        if index == NIL {
            None
        } else {
            let result: &RBNode<V> = get_helper::<RBNode<V>>(self.tree.data, index);
            self.index = successor_index;
            Some((index, result))
        }
    }
}

pub struct RedBlackTreeIntoIterator<'a, V: TreeValue> {
    tree: RedBlackTree<'a, V>,
    index: DataIndex,
}

impl<'a, V: TreeValue> Iterator for RedBlackTreeIntoIterator<'a, V> {
    type Item = (DataIndex, RBNode<V>);

    fn next(&mut self) -> Option<Self::Item> {
        let index: DataIndex = self.index;
        let successor_index: DataIndex = self.tree.get_successor_index::<V>(self.index);
        if index == NIL {
            None
        } else {
            let result: RBNode<V> = *get_helper::<RBNode<V>>(self.tree.data, self.index);
            self.index = successor_index;
            self.tree.remove_by_index(index);
            Some((index, result))
        }
    }
}

impl<'a, V: TreeValue> IntoIterator for RedBlackTree<'a, V> {
    type Item = (DataIndex, RBNode<V>);
    type IntoIter = RedBlackTreeIntoIterator<'a, V>;

    fn into_iter(self) -> RedBlackTreeIntoIterator<'a, V> {
        let min_index: DataIndex = self.get_min_index::<V>();
        RedBlackTreeIntoIterator::<V> {
            tree: self,
            index: min_index,
        }
    }
}

// No IterMut because changing keys could break red-black properties.

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_color_default() {
        assert_eq!(Color::default(), Color::Black);
        assert_eq!(Color::zeroed(), Color::Black);
    }

    #[derive(Copy, Clone, Pod, Zeroable, Debug)]
    #[repr(C)]
    struct TestOrder {
        order_id: u64,
        padding: [u8; 128],
    }

    impl Ord for TestOrder {
        fn cmp(&self, other: &Self) -> Ordering {
            (self.order_id).cmp(&(other.order_id))
        }
    }

    impl PartialOrd for TestOrder {
        fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
            Some(self.cmp(other))
        }
    }

    impl PartialEq for TestOrder {
        fn eq(&self, other: &Self) -> bool {
            (self.order_id) == (other.order_id)
        }
    }

    impl Eq for TestOrder {}

    impl Display for TestOrder {
        fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            write!(f, "{}", self.order_id)
        }
    }

    impl TestOrder {
        fn new(order_id: u64) -> Self {
            TestOrder {
                order_id,
                padding: [0; 128],
            }
        }
    }
    // Blocks are
    // Left: DataIndex
    // Right: DataIndex
    // Parent: DataIndex
    // Color: DataIndex
    // TestOrder: 8 + 128
    // 8 + 8 + 8 + 8 + 8 + 128 = 168
    const TEST_BLOCK_WIDTH: DataIndex = 168;

    #[test]
    fn test_insert_basic() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = RedBlackTree::new(&mut data, NIL, NIL);

        tree.insert(TEST_BLOCK_WIDTH * 0, TestOrder::new(1111));
        tree.insert(TEST_BLOCK_WIDTH, TestOrder::new(1234));
        tree.insert(TEST_BLOCK_WIDTH * 2, TestOrder::new(1000));
        tree.insert(TEST_BLOCK_WIDTH * 3, TestOrder::new(2000));
        tree.insert(TEST_BLOCK_WIDTH * 4, TestOrder::new(3000));
        tree.insert(TEST_BLOCK_WIDTH * 5, TestOrder::new(4000));
        tree.insert(TEST_BLOCK_WIDTH * 6, TestOrder::new(5000));
        tree.insert(TEST_BLOCK_WIDTH * 7, TestOrder::new(6000));
    }

    fn init_simple_tree(data: &mut [u8]) -> RedBlackTree<TestOrder> {
        let mut tree: RedBlackTree<TestOrder> = RedBlackTree::new(data, NIL, NIL);

        for i in 1..12 {
            tree.insert(TEST_BLOCK_WIDTH * i, TestOrder::new((i * 1_000).into()));
        }
        tree
    }

    #[test]
    fn test_pretty_print() {
        let mut data: [u8; 100000] = [0; 100000];
        let tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);
        tree.pretty_print();
    }

    #[test]
    fn test_insert_fix() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);

        // Should go left and right through the tree
        tree.insert(
            TEST_BLOCK_WIDTH * 32,
            TestOrder::new((15_900).try_into().unwrap()),
        );
        tree.verify_rb_tree();
    }

    #[test]
    fn test_remove_fix() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);

        for i in 1..12 {
            tree.remove_by_value(&TestOrder::new(i * 1_000));
        }
        tree.verify_rb_tree();
    }

    #[test]
    fn test_remove_fix_internal_successor_is_left() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);
        tree.remove_by_value(&TestOrder::new(7 * 1_000));
        tree.verify_rb_tree();
    }

    #[test]
    fn test_remove_fix_internal_right_right_parent_red() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);
        tree.remove_by_value(&TestOrder::new(6 * 1_000));
        tree.verify_rb_tree();
        tree.verify_rb_tree();
    }

    #[test]
    fn test_remove_fix_internal_successor_is_right_child() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);
        tree.remove_by_value(&TestOrder::new(2 * 1_000));
        tree.verify_rb_tree();
    }

    #[test]
    fn test_remove_only_has_right_after_swap() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);
        tree.remove_by_value(&TestOrder::new(5 * 1_000));
        tree.remove_by_value(&TestOrder::new(4 * 1_000));
        tree.verify_rb_tree();
    }

    #[test]
    fn test_remove_only_has_left_after_swap() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);
        tree.remove_by_value(&TestOrder::new(11 * 1_000));
        tree.remove_by_value(&TestOrder::new(10 * 1_000));
        tree.verify_rb_tree();
    }

    #[test]
    fn test_internal_remove() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);

        for i in 4..8 {
            tree.remove_by_value(&TestOrder::new(i * 1_000));
            tree.verify_rb_tree();
        }
    }

    #[test]
    fn test_rotate_right() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = RedBlackTree::new(&mut data, NIL, NIL);

        for i in 1..12 {
            tree.insert(
                TEST_BLOCK_WIDTH * i,
                TestOrder::new(((12 - i) * 1_000).into()),
            );
        }
        tree.verify_rb_tree();
    }

    #[test]
    fn test_into_iter() {
        let mut data: [u8; 100000] = [0; 100000];
        let tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);
        for (_index, _node) in tree {}
    }

    #[test]
    fn test_remove_nil() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);
        // Does not exist in the tree. Should fail silently.
        tree.remove_by_value(&TestOrder::new(99999));
        tree.remove_by_value(&TestOrder::new(1));
        tree.verify_rb_tree();
    }

    #[test]
    fn test_min_max() {
        let mut data: [u8; 100000] = [0; 100000];
        let tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);
        assert_eq!(tree.get_max_index(), TEST_BLOCK_WIDTH * 11);
        assert_eq!(tree.get_min_index::<TestOrder>(), TEST_BLOCK_WIDTH);
    }

    #[test]
    fn test_insert_right_left() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = RedBlackTree::new(&mut data, NIL, NIL);
        tree.insert(TEST_BLOCK_WIDTH * 0, TestOrder::new(100));
        tree.insert(TEST_BLOCK_WIDTH, TestOrder::new(200));
        tree.insert(TEST_BLOCK_WIDTH * 2, TestOrder::new(300));
        tree.insert(TEST_BLOCK_WIDTH * 3, TestOrder::new(150));
        tree.insert(TEST_BLOCK_WIDTH * 4, TestOrder::new(125));
    }

    #[test]
    fn test_remove_left_left() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = RedBlackTree::new(&mut data, NIL, NIL);
        tree.insert(TEST_BLOCK_WIDTH * 4, TestOrder::new(40));
        tree.insert(TEST_BLOCK_WIDTH * 3, TestOrder::new(30));
        tree.insert(TEST_BLOCK_WIDTH * 2, TestOrder::new(25));
        tree.insert(TEST_BLOCK_WIDTH, TestOrder::new(20));
        tree.insert(TEST_BLOCK_WIDTH * 0, TestOrder::new(15));

        tree.remove_by_value(&TestOrder::new(40));
        tree.verify_rb_tree();
    }

    #[test]
    fn test_remove_right_left() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = RedBlackTree::new(&mut data, NIL, NIL);
        tree.insert(TEST_BLOCK_WIDTH * 0, TestOrder::new(20));
        tree.insert(TEST_BLOCK_WIDTH, TestOrder::new(30));
        tree.insert(TEST_BLOCK_WIDTH * 2, TestOrder::new(40));
        tree.insert(TEST_BLOCK_WIDTH * 3, TestOrder::new(35));

        tree.remove_by_value(&TestOrder::new(20));
        tree.verify_rb_tree();
    }

    #[test]
    fn test_remove_left_right() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = RedBlackTree::new(&mut data, NIL, NIL);
        tree.insert(TEST_BLOCK_WIDTH * 0, TestOrder::new(20));
        tree.insert(TEST_BLOCK_WIDTH, TestOrder::new(30));
        tree.insert(TEST_BLOCK_WIDTH * 2, TestOrder::new(40));
        tree.insert(TEST_BLOCK_WIDTH * 3, TestOrder::new(25));

        tree.remove_by_value(&TestOrder::new(40));
        tree.verify_rb_tree();
    }

    #[test]
    fn test_remove_red_left_sibling() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = RedBlackTree::new(&mut data, NIL, NIL);
        tree.insert(TEST_BLOCK_WIDTH * 0, TestOrder::new(30));
        tree.insert(TEST_BLOCK_WIDTH, TestOrder::new(20));
        tree.insert(TEST_BLOCK_WIDTH * 3, TestOrder::new(15));
        tree.insert(TEST_BLOCK_WIDTH * 2, TestOrder::new(10));
        tree.insert(TEST_BLOCK_WIDTH * 4, TestOrder::new(5));

        tree.insert(TEST_BLOCK_WIDTH * 5, TestOrder::new(1));
        tree.remove_by_value(&TestOrder::new(1));
        tree.remove_by_value(&TestOrder::new(30));
        tree.verify_rb_tree();
    }

    #[test]
    fn test_remove_red_right_sibling() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = RedBlackTree::new(&mut data, NIL, NIL);
        tree.insert(TEST_BLOCK_WIDTH * 0, TestOrder::new(10));
        tree.insert(TEST_BLOCK_WIDTH, TestOrder::new(20));
        tree.insert(TEST_BLOCK_WIDTH * 3, TestOrder::new(25));
        tree.insert(TEST_BLOCK_WIDTH * 2, TestOrder::new(30));
        tree.insert(TEST_BLOCK_WIDTH * 4, TestOrder::new(35));

        tree.insert(TEST_BLOCK_WIDTH * 5, TestOrder::new(45));
        tree.remove_by_value(&TestOrder::new(45));
        tree.remove_by_value(&TestOrder::new(10));
        tree.verify_rb_tree();
    }

    #[test]
    fn test_insert_left_right() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = RedBlackTree::new(&mut data, NIL, NIL);
        tree.insert(TEST_BLOCK_WIDTH * 0, TestOrder::new(100));
        tree.insert(TEST_BLOCK_WIDTH, TestOrder::new(200));
        tree.insert(TEST_BLOCK_WIDTH * 2, TestOrder::new(300));
        tree.insert(TEST_BLOCK_WIDTH * 3, TestOrder::new(250));
        tree.insert(TEST_BLOCK_WIDTH * 4, TestOrder::new(275));
        tree.verify_rb_tree();
    }

    #[test]
    fn test_insert_left_right_onto_empty() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);
        tree.insert(TEST_BLOCK_WIDTH * 12, TestOrder::new(4500));
        tree.insert(TEST_BLOCK_WIDTH * 13, TestOrder::new(5500));
        tree.verify_rb_tree();
    }

    #[test]
    fn test_get_predecessor_index() {
        let mut data: [u8; 100000] = [0; 100000];
        let tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);
        assert_eq!(tree.get_predecessor_index::<TestOrder>(NIL), NIL);
        assert_eq!(
            tree.get_predecessor_index::<TestOrder>(TEST_BLOCK_WIDTH * 6),
            TEST_BLOCK_WIDTH * 5
        );
        assert_eq!(
            tree.get_predecessor_index::<TestOrder>(TEST_BLOCK_WIDTH * 5),
            TEST_BLOCK_WIDTH * 4
        );
        assert_eq!(
            tree.get_predecessor_index::<TestOrder>(TEST_BLOCK_WIDTH * 4),
            TEST_BLOCK_WIDTH * 3
        );
        assert_eq!(
            tree.get_predecessor_index::<TestOrder>(TEST_BLOCK_WIDTH * 3),
            TEST_BLOCK_WIDTH * 2
        );
        assert_eq!(
            tree.get_predecessor_index::<TestOrder>(TEST_BLOCK_WIDTH * 2),
            TEST_BLOCK_WIDTH
        );
        assert_eq!(
            tree.get_predecessor_index::<TestOrder>(TEST_BLOCK_WIDTH),
            NIL
        );
        tree.verify_rb_tree();
    }

    #[test]
    fn test_empty_min_max() {
        let mut data: [u8; 100000] = [0; 100000];
        let tree: RedBlackTree<TestOrder> = RedBlackTree::new(&mut data, NIL, NIL);
        assert_eq!(tree.get_min_index::<TestOrder>(), NIL);
        assert_eq!(tree.get_max_index(), NIL);
        tree.verify_rb_tree();
    }

    #[test]
    fn test_node_equality() {
        let mut data1: [u8; 100000] = [0; 100000];
        let mut data2: [u8; 100000] = [0; 100000];
        let _tree1: RedBlackTree<TestOrder> = init_simple_tree(&mut data1);
        let _tree2: RedBlackTree<TestOrder> = init_simple_tree(&mut data2);
        assert_ne!(
            get_helper::<RBNode<TestOrder>>(&mut data1, 1 * TEST_BLOCK_WIDTH),
            get_helper::<RBNode<TestOrder>>(&mut data2, 2 * TEST_BLOCK_WIDTH)
        );
    }

    #[test]
    fn test_insert_equal() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = init_simple_tree(&mut data);

        tree.insert(TEST_BLOCK_WIDTH * 12, TestOrder::new(4000));
        tree.insert(TEST_BLOCK_WIDTH * 13, TestOrder::new(5000));
        tree.insert(TEST_BLOCK_WIDTH * 14, TestOrder::new(1000));
        tree.insert(TEST_BLOCK_WIDTH * 15, TestOrder::new(1000));
        tree.verify_rb_tree();
    }

    #[test]
    fn test_insert_and_remove_complex() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = RedBlackTree::new(&mut data, NIL, NIL);

        tree.insert(TEST_BLOCK_WIDTH * 0, TestOrder::new(0));
        tree.insert(TEST_BLOCK_WIDTH * 1, TestOrder::new(1064));
        tree.insert(TEST_BLOCK_WIDTH * 2, TestOrder::new(4128));
        tree.insert(TEST_BLOCK_WIDTH * 3, TestOrder::new(2192));
        tree.insert(TEST_BLOCK_WIDTH * 4, TestOrder::new(5256));
        tree.insert(TEST_BLOCK_WIDTH * 5, TestOrder::new(3320));
        tree.insert(TEST_BLOCK_WIDTH * 6, TestOrder::new(8384));
        tree.insert(TEST_BLOCK_WIDTH * 7, TestOrder::new(7448));
        tree.insert(TEST_BLOCK_WIDTH * 8, TestOrder::new(6512));
        tree.remove_by_index(TEST_BLOCK_WIDTH * 6);
        tree.remove_by_index(TEST_BLOCK_WIDTH * 7);
        tree.remove_by_index(TEST_BLOCK_WIDTH * 8);
        tree.remove_by_index(TEST_BLOCK_WIDTH * 4);
        tree.remove_by_index(TEST_BLOCK_WIDTH * 2);

        tree.verify_rb_tree();
    }

    //                   B
    //              /        \
    //             R          R
    //           /    \     /   \
    //          B     B     B   (B)
    //               /
    //             R
    // Remove (B)
    //                   5
    //              /        \
    //             2          7
    //           /    \     /   \
    //          1     4     6   (8)
    //               /
    //             3
    // Remove (8)
    #[test]
    fn test_regression_1() {
        let mut data: [u8; 100000] = [0; 100000];
        *get_mut_helper(&mut data, 1 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: NIL,
            parent: 2 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(1),
        };
        *get_mut_helper(&mut data, 2 * TEST_BLOCK_WIDTH) = RBNode {
            left: 1 * TEST_BLOCK_WIDTH,
            right: 4 * TEST_BLOCK_WIDTH,
            parent: 5 * TEST_BLOCK_WIDTH,
            color: Color::Red,
            value: TestOrder::new(2),
        };
        *get_mut_helper(&mut data, 3 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: NIL,
            parent: 4 * TEST_BLOCK_WIDTH,
            color: Color::Red,
            value: TestOrder::new(3),
        };
        *get_mut_helper(&mut data, 4 * TEST_BLOCK_WIDTH) = RBNode {
            left: 3 * TEST_BLOCK_WIDTH,
            right: NIL,
            parent: 2 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(4),
        };
        *get_mut_helper(&mut data, 5 * TEST_BLOCK_WIDTH) = RBNode {
            left: 2 * TEST_BLOCK_WIDTH,
            right: 7 * TEST_BLOCK_WIDTH,
            parent: NIL,
            color: Color::Black,
            value: TestOrder::new(5),
        };
        *get_mut_helper(&mut data, 6 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: NIL,
            parent: 7 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(6),
        };
        *get_mut_helper(&mut data, 7 * TEST_BLOCK_WIDTH) = RBNode {
            left: 6 * TEST_BLOCK_WIDTH,
            right: 8 * TEST_BLOCK_WIDTH,
            parent: 5 * TEST_BLOCK_WIDTH,
            color: Color::Red,
            value: TestOrder::new(7),
        };
        *get_mut_helper(&mut data, 8 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: NIL,
            parent: 7 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(8),
        };

        let mut tree: RedBlackTree<TestOrder> =
            RedBlackTree::new(&mut data, 5 * TEST_BLOCK_WIDTH, NIL);
        tree.verify_rb_tree();

        tree.remove_by_index(8 * TEST_BLOCK_WIDTH);

        tree.verify_rb_tree();
    }

    //                  (B)
    //              /        \
    //             R          B
    //           /    \     /
    //          B     B     R
    //               / \
    //             R    R
    // Remove (B)
    //                  (6)
    //              /        \
    //             2          8
    //           /    \     /
    //          1     4     7
    //               / \
    //             3    5
    // Remove (6)
    #[test]
    fn test_regression_2() {
        let mut data: [u8; 100000] = [0; 100000];
        *get_mut_helper(&mut data, 1 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: NIL,
            parent: 2 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(1),
        };
        *get_mut_helper(&mut data, 2 * TEST_BLOCK_WIDTH) = RBNode {
            left: 1 * TEST_BLOCK_WIDTH,
            right: 4 * TEST_BLOCK_WIDTH,
            parent: 6 * TEST_BLOCK_WIDTH,
            color: Color::Red,
            value: TestOrder::new(2),
        };
        *get_mut_helper(&mut data, 3 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: NIL,
            parent: 4 * TEST_BLOCK_WIDTH,
            color: Color::Red,
            value: TestOrder::new(3),
        };
        *get_mut_helper(&mut data, 4 * TEST_BLOCK_WIDTH) = RBNode {
            left: 3 * TEST_BLOCK_WIDTH,
            right: 5 * TEST_BLOCK_WIDTH,
            parent: 2 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(4),
        };
        *get_mut_helper(&mut data, 5 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: NIL,
            parent: 4 * TEST_BLOCK_WIDTH,
            color: Color::Red,
            value: TestOrder::new(5),
        };
        *get_mut_helper(&mut data, 6 * TEST_BLOCK_WIDTH) = RBNode {
            left: 2 * TEST_BLOCK_WIDTH,
            right: 8 * TEST_BLOCK_WIDTH,
            parent: NIL,
            color: Color::Black,
            value: TestOrder::new(6),
        };
        *get_mut_helper(&mut data, 7 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: NIL,
            parent: 8 * TEST_BLOCK_WIDTH,
            color: Color::Red,
            value: TestOrder::new(7),
        };
        *get_mut_helper(&mut data, 8 * TEST_BLOCK_WIDTH) = RBNode {
            left: 7 * TEST_BLOCK_WIDTH,
            right: NIL,
            parent: 6 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(8),
        };

        let mut tree: RedBlackTree<TestOrder> =
            RedBlackTree::new(&mut data, 6 * TEST_BLOCK_WIDTH, NIL);
        tree.verify_rb_tree();

        tree.remove_by_index(6 * TEST_BLOCK_WIDTH);

        tree.verify_rb_tree();
    }

    //                   B
    //              /        \
    //             B          B
    //           /    \     /   \
    //          B     B     R   (B)
    //               /     / \
    //             R      B   B
    //                         \
    //                          R
    // Remove (B)
    //                   5
    //              /        \
    //             2          10
    //           /    \     /   \
    //          1     4     7   (11)
    //               /     / \
    //             3      6   8
    //                         \
    //                          9
    // Remove (11)
    #[test]
    fn test_regression_3() {
        let mut data: [u8; 100000] = [0; 100000];
        *get_mut_helper(&mut data, 1 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: NIL,
            parent: 2 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(1),
        };
        *get_mut_helper(&mut data, 2 * TEST_BLOCK_WIDTH) = RBNode {
            left: 1 * TEST_BLOCK_WIDTH,
            right: 4 * TEST_BLOCK_WIDTH,
            parent: 5 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(2),
        };
        *get_mut_helper(&mut data, 3 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: NIL,
            parent: 4 * TEST_BLOCK_WIDTH,
            color: Color::Red,
            value: TestOrder::new(3),
        };
        *get_mut_helper(&mut data, 4 * TEST_BLOCK_WIDTH) = RBNode {
            left: 3 * TEST_BLOCK_WIDTH,
            right: NIL,
            parent: 2 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(4),
        };
        *get_mut_helper(&mut data, 5 * TEST_BLOCK_WIDTH) = RBNode {
            left: 2 * TEST_BLOCK_WIDTH,
            right: 10 * TEST_BLOCK_WIDTH,
            parent: NIL,
            color: Color::Black,
            value: TestOrder::new(5),
        };
        *get_mut_helper(&mut data, 6 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: NIL,
            parent: 7 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(6),
        };
        *get_mut_helper(&mut data, 7 * TEST_BLOCK_WIDTH) = RBNode {
            left: 6 * TEST_BLOCK_WIDTH,
            right: 8 * TEST_BLOCK_WIDTH,
            parent: 10 * TEST_BLOCK_WIDTH,
            color: Color::Red,
            value: TestOrder::new(7),
        };
        *get_mut_helper(&mut data, 8 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: 9 * TEST_BLOCK_WIDTH,
            parent: 7 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(8),
        };
        *get_mut_helper(&mut data, 9 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: NIL,
            parent: 8 * TEST_BLOCK_WIDTH,
            color: Color::Red,
            value: TestOrder::new(9),
        };
        *get_mut_helper(&mut data, 10 * TEST_BLOCK_WIDTH) = RBNode {
            left: 7 * TEST_BLOCK_WIDTH,
            right: 11 * TEST_BLOCK_WIDTH,
            parent: 5 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(10),
        };
        *get_mut_helper(&mut data, 11 * TEST_BLOCK_WIDTH) = RBNode {
            left: NIL,
            right: NIL,
            parent: 10 * TEST_BLOCK_WIDTH,
            color: Color::Black,
            value: TestOrder::new(11),
        };
        let mut tree: RedBlackTree<TestOrder> =
            RedBlackTree::new(&mut data, 5 * TEST_BLOCK_WIDTH, NIL);
        tree.verify_rb_tree();

        tree.remove_by_index(11 * TEST_BLOCK_WIDTH);

        tree.verify_rb_tree();
    }

    #[test]
    fn test_read_only() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder> = RedBlackTree::new(&mut data, NIL, NIL);

        tree.insert(TEST_BLOCK_WIDTH * 0, TestOrder::new(1111));
        tree.insert(TEST_BLOCK_WIDTH, TestOrder::new(1234));
        tree.insert(TEST_BLOCK_WIDTH * 2, TestOrder::new(1000));
        tree.insert(TEST_BLOCK_WIDTH * 3, TestOrder::new(2000));
        tree.insert(TEST_BLOCK_WIDTH * 4, TestOrder::new(3000));
        tree.insert(TEST_BLOCK_WIDTH * 5, TestOrder::new(4000));
        tree.insert(TEST_BLOCK_WIDTH * 6, TestOrder::new(5000));
        tree.insert(TEST_BLOCK_WIDTH * 7, TestOrder::new(6000));
        let root_index: DataIndex = tree.get_root_index();
        drop(tree);

        let tree: RedBlackTreeReadOnly<TestOrder> =
            RedBlackTreeReadOnly::new(&data, root_index, NIL);
        for _ in tree.iter() {
            println!("Iteration in read only tree");
        }
        tree.data();
        assert_eq!(tree.root_index(), root_index);
        assert_eq!(tree.max_index(), NIL);
    }

    #[derive(Copy, Clone, Pod, Zeroable)]
    #[repr(C)]
    struct TestOrder2 {
        order_id: u64,
        nonce: u64,
        padding: [u64; 15],
    }

    impl Ord for TestOrder2 {
        fn cmp(&self, other: &Self) -> Ordering {
            (self.order_id).cmp(&(other.order_id))
        }
    }

    impl PartialOrd for TestOrder2 {
        fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
            Some(self.cmp(other))
        }
    }

    impl PartialEq for TestOrder2 {
        fn eq(&self, other: &Self) -> bool {
            (self.order_id) == (other.order_id) && (self.nonce) == (other.nonce)
        }
    }

    impl Eq for TestOrder2 {}

    impl Display for TestOrder2 {
        fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            write!(f, "{}", self.order_id)
        }
    }

    impl TestOrder2 {
        fn new(order_id: u64, nonce: u64) -> Self {
            TestOrder2 {
                order_id,
                nonce,
                padding: [0; 15],
            }
        }
    }

    // Equal lookup keys but not equal nodes.
    #[test]
    fn test_lookup_equal() {
        let mut data: [u8; 100000] = [0; 100000];
        let mut tree: RedBlackTree<TestOrder2> = RedBlackTree::new(&mut data, NIL, NIL);

        tree.insert(TEST_BLOCK_WIDTH * 0, TestOrder2::new(1000, 1234));
        tree.insert(TEST_BLOCK_WIDTH * 1, TestOrder2::new(1000, 2345));
        tree.insert(TEST_BLOCK_WIDTH * 2, TestOrder2::new(1000, 3456));
        tree.insert(TEST_BLOCK_WIDTH * 3, TestOrder2::new(1000, 4567));
        tree.insert(TEST_BLOCK_WIDTH * 4, TestOrder2::new(1000, 5678));
        tree.insert(TEST_BLOCK_WIDTH * 5, TestOrder2::new(1000, 6789));
        tree.insert(TEST_BLOCK_WIDTH * 6, TestOrder2::new(1000, 7890));
        tree.lookup_index(&TestOrder2::new(1_000, 1234));
        tree.lookup_index(&TestOrder2::new(1_000, 4567));
        tree.lookup_index(&TestOrder2::new(1_000, 7890));
    }
}
