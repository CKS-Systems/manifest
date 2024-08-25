/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as beet from "@metaplex-foundation/beet";
import { CancelOrderParams, cancelOrderParamsBeet } from "./CancelOrderParams";
import { PlaceOrderParams, placeOrderParamsBeet } from "./PlaceOrderParams";
export type BatchUpdateParams = {
  traderIndexHint: beet.COption<number>;
  cancels: CancelOrderParams[];
  orders: PlaceOrderParams[];
};

/**
 * @category userTypes
 * @category generated
 */
export const batchUpdateParamsBeet =
  new beet.FixableBeetArgsStruct<BatchUpdateParams>(
    [
      ["traderIndexHint", beet.coption(beet.u32)],
      ["cancels", beet.array(cancelOrderParamsBeet)],
      ["orders", beet.array(placeOrderParamsBeet)],
    ],
    "BatchUpdateParams",
  );
