import { BeetArgsStruct, bignum } from '@metaplex-foundation/beet';
export type RedBlackTreeNodeHeader = {
    left: bignum;
    right: bignum;
    parent: bignum;
    color: bignum;
};
/**
 * Deserializes a RedBlackTree from a given buffer into a list
 * @description This deserializes the RedBlackTree defined in https://github.com/CKS-Systems/manifest/blob/main/src/state/red_black_tree.rs
 *
 * @param data The data buffer to deserialize
 * @param rootIndex Index in the buffer for the root
 * @param valueDeserializer The deserializer for the tree value
 */
export declare function deserializeRedBlackTree<Value>(data: Buffer, rootIndex: number, valueDeserializer: BeetArgsStruct<Value>): Value[];
