export interface LabelsByAddr {
  [addr: string]: string;
}

export type FillResultUi = {
  market: string;
  maker: string;
  taker: string;
  isMakerGlobal: boolean;
  baseTokens: number;
  quoteTokens: number;
  priceTokens: number;
  takerSide: string;
  signature: string;
  slot: number;
};
