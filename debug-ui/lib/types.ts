export interface LabelsByAddr {
  [addr: string]: string;
}

// When true, this is the primary market for a given pair. This is defined by
// quote volume traded and determines which is shown in UI.
// TODO: Make a toggle for show all
export interface ActiveByAddr {
  [addr: string]: boolean;
}

export interface VolumeByAddr {
  [addr: string]: number;
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
  dateString: string;
};
