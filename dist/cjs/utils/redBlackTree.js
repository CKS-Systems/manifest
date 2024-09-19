"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deserializeRedBlackTree = deserializeRedBlackTree;
const beet_1 = require("./beet");
const numbers_1 = require("./numbers");
const constants_1 = require("../constants");
const NUM_TREE_HEADER_BYTES = 16;
/**
 * Deserializes a RedBlackTree from a given buffer into a list
 * @description This deserializes the RedBlackTree defined in https://github.com/CKS-Systems/manifest/blob/main/src/state/red_black_tree.rs
 *
 * @param data The data buffer to deserialize
 * @param rootIndex Index in the buffer for the root
 * @param valueDeserializer The deserializer for the tree value
 */
function deserializeRedBlackTree(data, rootIndex, valueDeserializer) {
    const result = [];
    const [rootHeaderValue] = beet_1.redBlackTreeHeaderBeet.deserialize(data.subarray(rootIndex, rootIndex + NUM_TREE_HEADER_BYTES));
    // Find the min
    let currentHeader = rootHeaderValue;
    let currentIndex = rootIndex;
    while ((0, numbers_1.toNum)(currentHeader.left) != constants_1.NIL) {
        currentIndex = (0, numbers_1.toNum)(currentHeader.left);
        const [currentHeaderTemp] = beet_1.redBlackTreeHeaderBeet.deserialize(data.subarray(currentIndex, currentIndex + NUM_TREE_HEADER_BYTES));
        currentHeader = currentHeaderTemp;
    }
    // Keep going while there is a successor.
    const [currentValue] = valueDeserializer.deserialize(data.subarray(currentIndex + NUM_TREE_HEADER_BYTES, currentIndex + NUM_TREE_HEADER_BYTES + valueDeserializer.byteSize));
    result.push(currentValue);
    while (getSuccessorIndex(data, currentIndex) != constants_1.NIL) {
        currentIndex = getSuccessorIndex(data, currentIndex);
        const [currentValue] = valueDeserializer.deserialize(data.subarray(currentIndex + NUM_TREE_HEADER_BYTES, currentIndex + NUM_TREE_HEADER_BYTES + valueDeserializer.byteSize));
        result.push(currentValue);
    }
    return result;
}
function getSuccessorIndex(data, index) {
    if (index == constants_1.NIL) {
        return constants_1.NIL;
    }
    let [currentHeader] = beet_1.redBlackTreeHeaderBeet.deserialize(data.subarray(index, index + NUM_TREE_HEADER_BYTES));
    let currentIndex = index;
    // Successor is below, go right then all the way to the left.
    if ((0, numbers_1.toNum)(currentHeader.right) != constants_1.NIL) {
        currentIndex = (0, numbers_1.toNum)(currentHeader.right);
        currentHeader = beet_1.redBlackTreeHeaderBeet.deserialize(data.subarray(currentIndex, currentIndex + NUM_TREE_HEADER_BYTES))[0];
        while ((0, numbers_1.toNum)(currentHeader.left) != constants_1.NIL) {
            currentIndex = (0, numbers_1.toNum)(currentHeader.left);
            currentHeader = beet_1.redBlackTreeHeaderBeet.deserialize(data.subarray(currentIndex, currentIndex + NUM_TREE_HEADER_BYTES))[0];
        }
        return currentIndex;
    }
    if (currentHeader.parent == constants_1.NIL) {
        return constants_1.NIL;
    }
    let [parentHeader] = beet_1.redBlackTreeHeaderBeet.deserialize(data.subarray((0, numbers_1.toNum)(currentHeader.parent), (0, numbers_1.toNum)(currentHeader.parent) + NUM_TREE_HEADER_BYTES));
    // Successor is above, keep going up while we are the right child
    while ((0, numbers_1.toNum)(parentHeader.right) == currentIndex) {
        currentIndex = (0, numbers_1.toNum)(currentHeader.parent);
        if (currentIndex == constants_1.NIL) {
            return constants_1.NIL;
        }
        currentHeader = beet_1.redBlackTreeHeaderBeet.deserialize(data.subarray(currentIndex, currentIndex + NUM_TREE_HEADER_BYTES))[0];
        if (currentHeader.parent == constants_1.NIL) {
            return constants_1.NIL;
        }
        parentHeader = beet_1.redBlackTreeHeaderBeet.deserialize(data.subarray((0, numbers_1.toNum)(currentHeader.parent), (0, numbers_1.toNum)(currentHeader.parent) + NUM_TREE_HEADER_BYTES))[0];
    }
    // Go up once more.
    currentHeader = beet_1.redBlackTreeHeaderBeet.deserialize(data.subarray(currentIndex, currentIndex + NUM_TREE_HEADER_BYTES))[0];
    if (currentHeader.parent == constants_1.NIL) {
        return constants_1.NIL;
    }
    return (0, numbers_1.toNum)(currentHeader.parent);
}
