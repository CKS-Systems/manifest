export interface CardProps {
    item: {
      notionalVolume: number;
      notionalVolume24hour: number;
    };
};

export interface MarketPerformance {
    marketId: string;
    current: number;
    minute30: number;
    hour1: number;
    hour4: number;
    hour24: number;
  };