export interface LabelsByAddr {
  [addr: string]: string;
}

export type FillResultUi = {
  market: string;
  maker: string;
  taker: string;
  baseTokens: number;
  quoteTokens: number;
  priceTokens: number;
  takerSide: string;
  signature: sting;
  slot: number;
};
