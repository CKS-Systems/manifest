import WebSocket from 'ws';
import { sleep } from '@/lib/util';
import { Mutex } from 'async-mutex';
import * as promClient from 'prom-client';
import {
  AccountInfo,
  Connection,
  GetProgramAccountsResponse,
  PublicKey,
} from '@solana/web3.js';
import {
  FillLogResult,
  ManifestClient,
  Market,
  RestingOrder,
} from '@cks-systems/manifest-sdk';
import { Pool } from 'pg';
import {
  CHECKPOINT_DURATION_SEC,
  ONE_DAY_SEC,
  DEPTHS_BPS,
  SOL_USDC_MARKET,
  CBBTC_USDC_MARKET,
  USDC_MINT,
  SOL_MINT,
  CBBTC_MINT,
  WBTC_MINT,
  STABLECOIN_MINTS,
} from './constants';
import { resolveActualTrader, chunks } from './utils';
import * as queries from './queries';
import { lookupMintTicker } from './mint';
import { fetchMarketProgramAccounts } from './marketFetcher';
import { calculateTraderPnL } from './pnl';
import { CompleteFillsQueryOptions, CompleteFillsQueryResult } from './types';
import { withRetry } from './utils';

export class ManifestStatsServer {
  private connection: Connection;
  private ws: WebSocket | null = null;
  // Base and quote volume
  private baseVolumeAtomsSinceLastCheckpoint: Map<string, number> = new Map();
  private quoteVolumeAtomsSinceLastCheckpoint: Map<string, number> = new Map();

  // Hourly checkpoints
  private baseVolumeAtomsCheckpoints: Map<string, number[]> = new Map();
  private quoteVolumeAtomsCheckpoints: Map<string, number[]> = new Map();

  // Last price by market. Price is in atoms per atom.
  private lastPriceByMarket: Map<string, number> = new Map();

  // Pubkey to the number of taker & maker trades.
  private traderNumTakerTrades: Map<string, number> = new Map();
  private traderNumMakerTrades: Map<string, number> = new Map();

  private traderPositions: Map<string, Map<string, number>> = new Map();
  private traderAcquisitionValue: Map<string, Map<string, number>> = new Map();

  // Market objects used for mints and decimals.
  private markets: Map<string, Market> = new Map();

  // Tickers. Ticker from metaplex metadata with a fallback to spl token
  // registry for old stuff like wsol.
  private tickers: Map<string, [string, string]> = new Map();

  private lastFillSlot: number = 0;

  // Recent fill log results
  private fillLogResults: Map<string, FillLogResult[]> = new Map();

  // Mutex to guard all the recent fills, volume, ... Most important for recent
  // fills when a fill spills over to multiple maker orders and bursts in fill
  // logs.
  private fillMutex: Mutex = new Mutex();

  private traderTakerNotionalVolume: Map<string, number> = new Map();
  private traderMakerNotionalVolume: Map<string, number> = new Map();
  private pool: Pool;
  private isReadOnly: boolean;
  private startTime: number;

  // Prometheus metrics
  private fills: promClient.Counter<'market'>;
  private reconnects: promClient.Counter<string>;
  private volume: promClient.Gauge<'market' | 'mint' | 'side'>;
  private lastPrice: promClient.Gauge<'market'>;
  private depth: promClient.Gauge<'depth_bps' | 'market' | 'trader'>;

  constructor(
    rpcUrl: string,
    isReadOnly: boolean,
    databaseUrl: string | undefined,
    metrics: {
      fills: promClient.Counter<'market'>;
      reconnects: promClient.Counter<string>;
      volume: promClient.Gauge<'market' | 'mint' | 'side'>;
      lastPrice: promClient.Gauge<'market'>;
      depth: promClient.Gauge<'depth_bps' | 'market' | 'trader'>;
    },
  ) {
    this.isReadOnly = isReadOnly;
    this.startTime = Date.now();
    this.connection = new Connection(rpcUrl);
    this.fills = metrics.fills;
    this.reconnects = metrics.reconnects;
    this.volume = metrics.volume;
    this.lastPrice = metrics.lastPrice;
    this.depth = metrics.depth;

    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }, // May be needed depending on Fly Postgres configuration
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
      // Continue operation - don't let DB errors crash the server
    });

    this.resetWebsocket();

    // Only initialize database schema if not in read-only mode
    if (!this.isReadOnly) {
      this.initDatabase();
    }
  }

  private initTraderPositionTracking(trader: string): void {
    if (!this.traderPositions.has(trader)) {
      this.traderPositions.set(trader, new Map<string, number>());
    }
    if (!this.traderAcquisitionValue.has(trader)) {
      this.traderAcquisitionValue.set(trader, new Map<string, number>());
    }
  }

  private updateTraderPosition(
    trader: string,
    baseMint: string,
    baseAtomsDelta: number,
    quoteAtoms: number,
    market: Market,
  ): void {
    const positions = this.traderPositions.get(trader)!;
    const acquisitionValues = this.traderAcquisitionValue.get(trader)!;

    // Get current position
    const currentPosition = positions.get(baseMint) || 0;
    const newPosition = currentPosition + baseAtomsDelta;

    // Update position
    positions.set(baseMint, newPosition);

    // Get current acquisition value
    const currentValue = acquisitionValues.get(baseMint) || 0;
    const usdcValue = Number(quoteAtoms) / 10 ** market.quoteDecimals();

    if (baseAtomsDelta > 0) {
      acquisitionValues.set(baseMint, currentValue + usdcValue);
    } else {
      acquisitionValues.set(baseMint, currentValue - usdcValue);
    }
  }

  /**
   * Save complete fill to database immediately (async, non-blocking)
   */
  private async saveCompleteFillToDatabase(fill: FillLogResult): Promise<void> {
    if (this.isReadOnly) {
      return; // Skip database writes in read-only mode
    }

    try {
      await withRetry(async () => {
        await this.pool.query(queries.INSERT_FILL_COMPLETE, [
          fill.slot,
          fill.market,
          fill.signature,
          fill.taker,
          fill.maker,
          fill.takerSequenceNumber,
          fill.makerSequenceNumber,
          JSON.stringify(fill),
        ]);
      });
    } catch (error) {
      console.error('Error saving complete fill to database:', error);
      // Don't throw - fire and forget
    }
  }

  private async processFillAsync(fill: FillLogResult): Promise<void> {
    try {
      const {
        market,
        baseAtoms,
        quoteAtoms,
        priceAtoms,
        taker,
        maker,
        originalSigner,
      } = fill;

      const actualTaker = resolveActualTrader(taker, originalSigner);

      // Update trader counts
      this.traderNumTakerTrades.set(
        actualTaker,
        (this.traderNumTakerTrades.get(actualTaker) || 0) + 1,
      );
      this.traderNumMakerTrades.set(
        maker,
        (this.traderNumMakerTrades.get(maker) || 0) + 1,
      );

      // Initialize notional volumes if needed
      if (!this.traderTakerNotionalVolume.has(actualTaker)) {
        this.traderTakerNotionalVolume.set(actualTaker, 0);
      }
      if (!this.traderMakerNotionalVolume.has(maker)) {
        this.traderMakerNotionalVolume.set(maker, 0);
      }

      // Load market if needed (this is the slow part)
      let marketObject = this.markets.get(market);
      if (!marketObject) {
        marketObject = await this.loadNewMarket(market);
        if (!marketObject) {
          console.error('Failed to load market:', market);
          return;
        }
      }

      // Update price and volume
      this.lastPrice.set(
        { market },
        priceAtoms *
          10 ** (marketObject.baseDecimals() - marketObject.quoteDecimals()),
      );

      this.lastPriceByMarket.set(market, priceAtoms);
      this.baseVolumeAtomsSinceLastCheckpoint.set(
        market,
        (this.baseVolumeAtomsSinceLastCheckpoint.get(market) || 0) +
          Number(baseAtoms),
      );
      this.quoteVolumeAtomsSinceLastCheckpoint.set(
        market,
        (this.quoteVolumeAtomsSinceLastCheckpoint.get(market) || 0) +
          Number(quoteAtoms),
      );

      // Process notional volumes and positions
      await this.updateTradingMetrics(fill, marketObject, actualTaker);
    } catch (error) {
      console.error(
        'Error in background fill processing:',
        error,
        'Fill:',
        fill,
      );
      // Don't throw - this is fire-and-forget
    }
  }

  // Helper method for market loading
  private async loadNewMarket(market: string): Promise<Market | undefined> {
    try {
      this.baseVolumeAtomsSinceLastCheckpoint.set(market, 0);
      this.quoteVolumeAtomsSinceLastCheckpoint.set(market, 0);
      this.baseVolumeAtomsCheckpoints.set(
        market,
        new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
      );
      this.quoteVolumeAtomsCheckpoints.set(
        market,
        new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
      );

      const marketPk = new PublicKey(market);
      const marketObject = await Market.loadFromAddress({
        connection: this.connection,
        address: marketPk,
      });

      this.markets.set(market, marketObject);
      const baseSymbol = await lookupMintTicker(
        this.connection,
        marketObject.baseMint(),
      );
      const quoteSymbol = await lookupMintTicker(
        this.connection,
        marketObject.quoteMint(),
      );

      this.tickers.set(market, [baseSymbol, quoteSymbol]);

      return marketObject;
    } catch (error) {
      console.error('Error loading market:', market, error);
      return undefined; // Changed from null to undefined
    }
  }

  // Helper method for trading metrics
  private async updateTradingMetrics(
    fill: FillLogResult,
    marketObject: Market,
    actualTaker: string,
  ): Promise<void> {
    const { baseAtoms, quoteAtoms, takerIsBuy, maker } = fill;
    const quoteMint = marketObject.quoteMint().toBase58();

    if (STABLECOIN_MINTS.has(quoteMint)) {
      const notionalVolume =
        Number(quoteAtoms) / 10 ** marketObject.quoteDecimals();

      this.traderTakerNotionalVolume.set(
        actualTaker,
        this.traderTakerNotionalVolume.get(actualTaker)! + notionalVolume,
      );
      this.traderMakerNotionalVolume.set(
        maker,
        this.traderMakerNotionalVolume.get(maker)! + notionalVolume,
      );

      const baseMint = marketObject.baseMint().toBase58();
      this.initTraderPositionTracking(actualTaker);
      this.initTraderPositionTracking(maker);

      this.updateTraderPosition(
        actualTaker,
        baseMint,
        takerIsBuy ? Number(baseAtoms) : -Number(baseAtoms),
        Number(quoteAtoms),
        marketObject,
      );

      this.updateTraderPosition(
        maker,
        baseMint,
        takerIsBuy ? -Number(baseAtoms) : Number(baseAtoms),
        Number(quoteAtoms),
        marketObject,
      );
    } else if (quoteMint === SOL_MINT) {
      const solPriceAtoms = this.lastPriceByMarket.get(SOL_USDC_MARKET);
      if (solPriceAtoms) {
        const solUsdcMarket = this.markets.get(SOL_USDC_MARKET);
        if (solUsdcMarket) {
          const solPrice =
            solPriceAtoms *
            10 **
              (solUsdcMarket.baseDecimals() - solUsdcMarket.quoteDecimals());
          const notionalVolume =
            (Number(quoteAtoms) / 10 ** marketObject.quoteDecimals()) *
            solPrice;

          this.traderTakerNotionalVolume.set(
            actualTaker,
            this.traderTakerNotionalVolume.get(actualTaker)! + notionalVolume,
          );
          this.traderMakerNotionalVolume.set(
            maker,
            this.traderMakerNotionalVolume.get(maker)! + notionalVolume,
          );
        }
      }
    } else if (quoteMint === CBBTC_MINT || quoteMint === WBTC_MINT) {
      const cbbtcPriceAtoms = this.lastPriceByMarket.get(CBBTC_USDC_MARKET);
      if (cbbtcPriceAtoms) {
        const cbbtcUsdcMarket = this.markets.get(CBBTC_USDC_MARKET);
        if (cbbtcUsdcMarket) {
          const cbbtcPrice =
            cbbtcPriceAtoms *
            10 **
              (cbbtcUsdcMarket.baseDecimals() -
                cbbtcUsdcMarket.quoteDecimals());
          const notionalVolume =
            (Number(quoteAtoms) / 10 ** marketObject.quoteDecimals()) *
            cbbtcPrice;

          this.traderTakerNotionalVolume.set(
            actualTaker,
            this.traderTakerNotionalVolume.get(actualTaker)! + notionalVolume,
          );
          this.traderMakerNotionalVolume.set(
            maker,
            this.traderMakerNotionalVolume.get(maker)! + notionalVolume,
          );
        }
      }
    }
  }

  private resetWebsocket() {
    // Allow old one to timeout.
    if (this.ws != null) {
      try {
        this.ws.close();
      } catch (err) {
        /* empty */
      }
    }

    this.ws = new WebSocket('wss://mfx-feed-mainnet.fly.dev');

    this.ws.onopen = () => {};

    this.ws.onclose = () => {
      // Rely on the next iteration to force a reconnect. This happens without a
      // keep-alive.
      this.reconnects.inc();
    };
    this.ws.onerror = () => {
      // Rely on the next iteration to force a reconnect.
      this.reconnects.inc();
    };

    this.ws.onmessage = (message) => {
      this.fillMutex.runExclusive(async () => {
        let fill: FillLogResult;

        try {
          fill = JSON.parse(message.data.toString());
        } catch (error) {
          console.error('Failed to parse fill message:', error);
          return;
        }

        // Track slot for database persistence
        this.lastFillSlot = Math.max(this.lastFillSlot, fill.slot);

        // Immediately save to recent fill
        const { market } = fill;
        if (!this.fillLogResults.has(market)) {
          this.fillLogResults.set(market, []);
        }

        const prevFills = this.fillLogResults.get(market)!;
        prevFills.push(fill);

        const FILLS_TO_SAVE = 1000;
        if (prevFills.length > FILLS_TO_SAVE) {
          prevFills.splice(0, prevFills.length - FILLS_TO_SAVE);
        }
        this.fillLogResults.set(market, prevFills);

        this.fills.inc({ market });
        console.log('Got fill', fill);

        // Queue for background processing
        setImmediate(() => this.processFillAsync(fill));
        setImmediate(() => this.saveCompleteFillToDatabase(fill));
      });
    };
  }

  /**
   * Initialize at the start with a get program accounts.
   */
  async initialize(): Promise<void> {
    await this.loadState();

    const marketProgramAccounts: GetProgramAccountsResponse =
      await fetchMarketProgramAccounts(this.connection);

    marketProgramAccounts.forEach(
      (
        value: Readonly<{ account: AccountInfo<Buffer>; pubkey: PublicKey }>,
      ) => {
        const marketPk: string = value.pubkey.toBase58();

        // If we have account data, load the market and check volume
        if (value.account.data.length > 0) {
          try {
            const market: Market = Market.loadFromBuffer({
              buffer: value.account.data,
              address: new PublicKey(marketPk),
            });

            // Skip markets that have never traded to keep the amount of data
            // retention smaller.
            if (Number(market.quoteVolume()) == 0) {
              return;
            }

            this.markets.set(marketPk, market);
          } catch (err) {
            console.error(`Failed to load market ${marketPk}:`, err);
            // Continue with other markets
            return;
          }
        }

        // Initialize checkpoints regardless of whether we have market data
        if (!this.baseVolumeAtomsCheckpoints.has(marketPk)) {
          this.baseVolumeAtomsSinceLastCheckpoint.set(marketPk, 0);
          this.quoteVolumeAtomsSinceLastCheckpoint.set(marketPk, 0);
          this.baseVolumeAtomsCheckpoints.set(
            marketPk,
            new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
          );
          this.quoteVolumeAtomsCheckpoints.set(
            marketPk,
            new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
          );
        }
      },
    );

    const mintToSymbols: Map<string, string> = new Map();
    this.markets.forEach(async (market: Market) => {
      const baseMint: PublicKey = market.baseMint();
      const quoteMint: PublicKey = market.quoteMint();

      let baseSymbol = '';
      let quoteSymbol = '';
      if (mintToSymbols.has(baseMint.toBase58())) {
        baseSymbol = mintToSymbols.get(baseMint.toBase58())!;
      } else {
        // Sleep to backoff on RPC load.
        await new Promise((f) => setTimeout(f, 500));
        baseSymbol = await lookupMintTicker(this.connection, baseMint);
      }
      mintToSymbols.set(baseMint.toBase58(), baseSymbol);

      if (mintToSymbols.has(quoteMint.toBase58())) {
        quoteSymbol = mintToSymbols.get(quoteMint.toBase58())!;
      } else {
        quoteSymbol = await lookupMintTicker(this.connection, quoteMint);
      }
      mintToSymbols.set(quoteMint.toBase58(), quoteSymbol);

      this.tickers.set(market.address.toBase58(), [
        mintToSymbols.get(market.baseMint()!.toBase58())!,
        mintToSymbols.get(market.quoteMint()!.toBase58())!,
      ]);
    });

    this.baseVolumeAtomsCheckpoints.set('8sjV1AqBFvFuADBCQHhotaRq5DFFYSjjg1jMyVWMqXvZ', 
                                        [27997079236,39721030661,66298127318,33072365311,78153641895,64127370698,134559348934,128428826280,187209535827,167231180063,181993702709,80088898237,35129036169,121639415694,69310719576,52706217303,34229563795,51906096495,125222409040,67532814101,16278160461,36236900768,103453426796,15932464621,46858916482,82409638337,53711048123,106101369877,83813950394,85634235940,43127897310,45971628247,16774101584,48283965275,71495923727,82983983373,67582937711,68380413528,107970123492,77656583899,64947204740,21210810872,32577018181,27307332671,98790825448,71311222521,79442465245,54833427644,70535972321,55833732653,96801484418,60771672542,50033753524,46053754052,30462011968,75543783090,110798276554,54434482273,82899235282,41403834933,113536664271,113781343607,84920288979,163214646215,119353415782,134453112060,127290210279,93586875595,131014258082,97824479789,180380004505,64068095914,91714695464,67597905212,99754619062,58374216879,47040302603,211826297388,47868808310,30058475957,70195012724,34595802866,57988060090,87503256968,37613629632,34782979621,51344491983,103019856704,61702349760,26973966646,87845949593,65001467700,116459279795,84198241072,174225030719,71250694447,22749210701,163103019305,81605598327,103968462303,92713715425,85699008380,32568423370,54248094400,54807193287,77442596492,49301238989,21224723493,54472275735,40022549356,79797663701,18084143097,14693681280,92126815223,125251751424,143176729993,148181829318,92648002346,51368939669,55172334809,109255114838,123797328163,34433508221,75852643135,19986770835,54905536503,156669476155,93695116117,150221484064,126717001992,115954788255,89825066495,108316711220,91410143222,126785118947,196793291730,94611561161,95679115306,53794859647,69196279961,34003558041,91501731499,101896305883,51832030449,138706341956,35029687985,104755530943,108360519642,101799407875,175853207871,214877047503,153561765906,147811261809,153620635650,101051258645,121250816293,148417456540,143750805989,205185392924,147063436861,147589771073,86971684753,100215413485,165581359376,94006050229,158597888054,81868692218,133064873403,87989352852,82882944046,131746802890,69336479898,186044549998,116358639825,107917943851,101288559050,97587443571,154779321525,108448524842,144452265863,157794272914,70969757484,60677858263,24165414733,60811721345,38274164397,79920568049,84235629401,44867332252,22027351965,52438528473,74346141637,65108226860,72504663035,52538634891,62015937149,28422701177,123505985521,83555286071,35253902761,66445964624,58705963641,67712198538,70178813071,89066375810,71673141992,71957208939,86242409334,92033260758,84771452048,92041877293,104646885369,188547247733,127938873291,63981210772,139594537711,219530814493,74817405364,101067387517,144364905191,139478495520,103280154461,54293702370,99130521221,111072570741,118770611832,275004978577,77162285988,106551124271,153320635742,119679864556,166550645146,197801300385,220508038083,129876813761,128450478514,131824506257,157272105556,88636125117,80104272692,185952629975,78680641577,67306171239,109395792104,96365694471,106084520762,122515504642,93812827733,69616232849,152948918868,106765556595,268919133142,150042131187,120169956667,143481765719,160514506261,94071639028,102064296383,111323232385,141676012764,167710611708,61240037374,37824626690,116571057761,187572868957,157906535254,179203573541,257848649314,170900894987,180231134364,229232771966,236989177680,162594874945,59046798970,90550829043,102628910844,137682007308,201541769715,232218424555,152724667615,134705225520,38167896442,101142034934,117632203894,90889439119,68542525198,59340076186,53302163537]
                                       );
    this.quoteVolumeAtomsCheckpoints.set('8sjV1AqBFvFuADBCQHhotaRq5DFFYSjjg1jMyVWMqXvZ', 
                                         [27998855055,39723154426,66300168842,33072790119,78154573583,64127993487,134561953899,128430497241,187207771504,167226738652,181988946428,80086197718,35127947501,121636314734,69308870952,52704947742,34228798302,51905226461,125218372938,67529711682,16277504513,36235783534,103449183908,15931762309,46856770159,82406050652,53708536089,106099572739,83811646227,85632619710,43127945218,45971496681,16773910200,48283175926,71494649611,82982075824,67581168015,68378649209,107967103858,77654645551,64945714977,21210334441,32576451542,27306998328,98789558133,71310463104,79441435160,54832721308,70535048734,55833051105,96799613005,60770432918,50032635572,46052884514,30461503668,75543076850,110798184698,54434020640,82898767866,41403563870,113535352557,113778909569,84918765906,163212438772,119351963354,134451888277,127288976193,93586176017,131012001822,97823210937,180375277893,64064869978,91710524111,67594791410,99750611150,58371649148,47038095899,211822642218,47868449266,30058058312,70192959945,34595166841,57986960314,87502362432,37613189144,34782797541,51344258846,103019492454,61702432280,26974235148,87846912831,65002137861,116459844628,84197143979,174219389793,71248993071,22748824001,163099340040,81603915986,103965887356,92711739552,85697044806,32567602089,54246736717,54806404279,77441099568,49299463303,21223676532,54469498704,40020874122,79793961647,18083347664,14692887144,92121002587,125244014599,143168693113,148174227490,92643262485,51366488546,55169744286,109250020408,123791576084,34431811793,75848746984,19985745009,54902638026,156661265232,93690172955,150214141652,126711216520,115949399054,89821047661,108312384101,91406639149,126779192682,196783567672,94607221307,95674291800,53792669817,69193468250,34002031296,91498251183,101892871947,51830136266,138701285257,35028682482,104751796325,108356223421,101795654270,175846387079,214867556897,153554357149,147803528399,153613485436,101046061907,121244626424,148410197974,143744283751,205177167855,147056219083,147581643301,86966543684,100210801957,165576342010,94000616946,158588909114,81863988836,133058854378,87985211387,82878923326,131740597694,69333272118,186037464805,116354457457,107913090885,101283803142,97582664974,154773339515,108444438363,144446984172,157788802377,70967041792,60675065498,24164319285,60809492836,38272572093,79917203649,84231944219,44865459946,22026472671,52436298660,74343164700,65105591995,72501348363,52536202621,62012517291,28420984100,123497810162,83548755682,35251174539,66441383619,58701680433,67707116339,70174033334,89060241961,71668440795,71952727373,86236834206,92027306783,84766126705,92036528298,104640825530,188536878687,127932510689,63978189743,139587812303,219520402225,74813512382,101062071199,144357011037,139472272158,103274402216,54290573736,99123994914,111065545502,118764951054,274990296728,77157873344,106545062817,153311462132,119672229525,166540282698,197789298567,220495319788,129869860228,128443894449,131817349541,157264934167,88631310603,80099728543,185938046015,78675970597,67302074545,109389295050,96359398402,106078461529,122509243666,93808958733,69613096781,152941220650,106759466738,268901775213,150033296384,120162682250,143472781642,160504418645,94065708604,102057635010,111317410271,141669066553,167698831895,61232667080,37819573740,116557277273,187542152302,157878017630,179171974479,257804577676,170872184756,180202372233,229194943528,236949535667,162567628248,59036451942,90534401920,102610403921,137655170573,201499456950,232164486521,152688480935,134671324276,38157411957,101114316873,117599181659,90863089606,68522941750,59322785571,53286552879]
                                       );

  }

  /**
   * Periodically save the volume so a 24 hour rolling volume can be calculated.
   */
  saveCheckpoints(): void {
    console.log('Saving checkpoints');

    // Reset the websocket. It sometimes disconnects quietly, so just to be
    // safe, do it here.
    this.resetWebsocket();

    this.markets.forEach((value: Market, market: string) => {
      console.log(
        'Saving checkpoints for market',
        market,
        'base since last',
        this.baseVolumeAtomsSinceLastCheckpoint.get(market),
      );
      this.baseVolumeAtomsCheckpoints.set(market, [
        ...this.baseVolumeAtomsCheckpoints.get(market)!.slice(1),
        this.baseVolumeAtomsSinceLastCheckpoint.get(market)!,
      ]);
      this.baseVolumeAtomsSinceLastCheckpoint.set(market, 0);

      this.quoteVolumeAtomsCheckpoints.set(market, [
        ...this.quoteVolumeAtomsCheckpoints.get(market)!.slice(1),
        this.quoteVolumeAtomsSinceLastCheckpoint.get(market)!,
      ]);
      this.quoteVolumeAtomsSinceLastCheckpoint.set(market, 0);

      const baseMint: string = value.baseMint().toBase58();
      const quoteMint: string = value.quoteMint().toBase58();
      this.volume.set(
        { market, mint: baseMint, side: 'base' },
        this.baseVolumeAtomsCheckpoints
          .get(market)!
          .reduce((sum, num) => sum + num, 0),
      );
      this.volume.set(
        { market, mint: quoteMint, side: 'quote' },
        this.quoteVolumeAtomsCheckpoints
          .get(market)!
          .reduce((sum, num) => sum + num, 0),
      );
    });
  }

  /**
   * Periodically save to prometheus the depths of different market makers. This
   * is expensive, so it will only be run every few minutes at most. If we
   * wanted more frequent, should subscribe to market accounts. Because the
   * number of markets is unbounded, that is not done here.
   */
  async depthProbe(): Promise<void> {
    console.log('Probing depths for market maker data');

    const marketKeys: PublicKey[] = Array.from(this.markets.keys()).map(
      (market: string) => {
        return new PublicKey(market);
      },
    );

    try {
      const marketKeysChunks: PublicKey[][] = chunks(marketKeys, 100);
      for (const marketKeysChunk of marketKeysChunks) {
        const accountInfos: (AccountInfo<Buffer> | null)[] =
          await this.connection.getMultipleAccountsInfo(marketKeysChunk);
        accountInfos.forEach(
          (accountInfo: AccountInfo<Buffer> | null, index: number) => {
            if (!accountInfo) {
              return;
            }
            const marketPk: PublicKey = marketKeys[index];
            const market: Market = Market.loadFromBuffer({
              buffer: accountInfo.data,
              address: marketPk,
            });
            const bids: RestingOrder[] = market.bids();
            const asks: RestingOrder[] = market.asks();
            if (bids.length == 0 || asks.length == 0) {
              return;
            }

            const midTokens: number =
              (bids[bids.length - 1].tokenPrice +
                asks[asks.length - 1].tokenPrice) /
              2;

            DEPTHS_BPS.forEach((depthBps: number) => {
              const bidsAtDepth: RestingOrder[] = bids.filter(
                (bid: RestingOrder) => {
                  return bid.tokenPrice > midTokens * (1 - depthBps * 0.0001);
                },
              );
              const asksAtDepth: RestingOrder[] = asks.filter(
                (ask: RestingOrder) => {
                  return ask.tokenPrice < midTokens * (1 + depthBps * 0.0001);
                },
              );

              const bidTraders: Set<string> = new Set(
                bidsAtDepth.map((bid: RestingOrder) => bid.trader.toBase58()),
              );

              bidTraders.forEach((trader: string) => {
                const bidTokensAtDepth: number = bidsAtDepth
                  .filter((bid: RestingOrder) => {
                    return bid.trader.toBase58() == trader;
                  })
                  .map((bid: RestingOrder) => {
                    return Number(bid.numBaseTokens);
                  })
                  .reduce((sum, num) => sum + num, 0);
                const askTokensAtDepth: number = asksAtDepth
                  .filter((ask: RestingOrder) => {
                    return ask.trader.toBase58() == trader;
                  })
                  .map((ask: RestingOrder) => {
                    return Number(ask.numBaseTokens);
                  })
                  .reduce((sum, num) => sum + num, 0);

                if (bidTokensAtDepth > 0 && askTokensAtDepth > 0) {
                  this.depth.set(
                    {
                      depth_bps: depthBps,
                      market: marketPk.toBase58(),
                      trader: trader,
                    },
                    Math.min(bidTokensAtDepth, askTokensAtDepth) * midTokens,
                  );
                }
              });
            });
          },
        );
      }
    } catch (err) {
      console.log('Unable to fetch depth probe', err);
    }
  }

  /**
   * Get Tickers
   *
   * https://docs.google.com/document/d/1v27QFoQq1SKT3Priq3aqPgB70Xd_PnDzbOCiuoCyixw/edit?tab=t.0#heading=h.pa64vhp5pbih
   */
  getTickers() {
    const tickers: any = [];
    this.markets.forEach((market: Market, marketPk: string) => {
      tickers.push({
        ticker_id: marketPk,
        base_currency: market.baseMint().toBase58(),
        target_currency: market.quoteMint().toBase58(),
        last_price:
          this.lastPriceByMarket.get(marketPk)! *
          10 ** (market.baseDecimals() - market.quoteDecimals()),
        base_volume:
          this.baseVolumeAtomsCheckpoints
            .get(marketPk)!
            .reduce((sum, num) => sum + num, 0) /
          10 ** market.baseDecimals(),
        target_volume:
          this.quoteVolumeAtomsCheckpoints
            .get(marketPk)!
            .reduce((sum, num) => sum + num, 0) /
          10 ** market.quoteDecimals(),
        pool_id: marketPk,
        // Does not apply to orderbooks.
        liquidity_in_usd: 0,
        // Optional: not yet implemented
        // "bid": 0,
        // "ask": 0,
        // "high": 0,
        // "low": 0,
      });
    });
    return tickers;
  }

  /**
   * Would be named tickers if that wasnt reserved for coingecko.
   *
   */
  getMetadata() {
    console.log('getting metadata', this.tickers.size);
    return this.tickers;
  }

  /**
   * Get Orderbook
   *
   * https://docs.google.com/document/d/1v27QFoQq1SKT3Priq3aqPgB70Xd_PnDzbOCiuoCyixw/edit?tab=t.0#heading=h.vgzsfbx8rvps
   */
  async getOrderbook(tickerId: string, depth: number) {
    try {
      const market: Market = await Market.loadFromAddress({
        connection: this.connection,
        address: new PublicKey(tickerId),
      });
      if (depth == 0) {
        return {
          ticker_id: tickerId,
          bids: market
            .bids()
            .reverse()
            .map((restingOrder: RestingOrder) => {
              return [
                restingOrder.tokenPrice,
                Number(restingOrder.numBaseTokens),
              ];
            }),
          asks: market
            .asks()
            .reverse()
            .map((restingOrder: RestingOrder) => {
              return [
                restingOrder.tokenPrice,
                Number(restingOrder.numBaseTokens),
              ];
            }),
        };
      }
      const bids: RestingOrder[] = market.bids().reverse();
      const asks: RestingOrder[] = market.asks().reverse();
      const bidsUpToDepth: RestingOrder[] = [];
      const asksUpToDepth: RestingOrder[] = [];
      let bidTokens: number = 0;
      let askTokens: number = 0;
      bids.forEach((bid: RestingOrder) => {
        if (bidTokens < depth) {
          bidTokens += Number(bid.numBaseTokens);
          bidsUpToDepth.push(bid);
        }
      });
      asks.forEach((ask: RestingOrder) => {
        if (askTokens < depth) {
          askTokens += Number(ask.numBaseTokens);
          asksUpToDepth.push(ask);
        }
      });

      return {
        ticker_id: tickerId,
        bids: bidsUpToDepth.map((restingOrder: RestingOrder) => {
          return [restingOrder.tokenPrice, Number(restingOrder.numBaseTokens)];
        }),
        asks: asksUpToDepth.reverse().map((restingOrder: RestingOrder) => {
          return [restingOrder.tokenPrice, Number(restingOrder.numBaseTokens)];
        }),
      };
    } catch (err) {
      console.log('Error getOrderbook', tickerId, depth, err);
      return {};
    }
  }

  /**
   * Get Volume
   *
   * https://docs.llama.fi/list-your-project/other-dashboards/dimensions
   */
  async getVolume() {
    let marketProgramAccounts: GetProgramAccountsResponse;
    let lifetimeVolume = 0;

    // Get SOL price for converting SOL-quoted volumes to USDC equivalent
    const solPriceAtoms = this.lastPriceByMarket.get(SOL_USDC_MARKET);
    const solUsdcMarket = this.markets.get(SOL_USDC_MARKET);
    let solPrice = 0;
    if (solPriceAtoms && solUsdcMarket) {
      solPrice =
        solPriceAtoms *
        10 ** (solUsdcMarket.baseDecimals() - solUsdcMarket.quoteDecimals());
    }

    // Get CBBTC price for converting CBBTC-quoted volumes to USDC equivalent
    const cbbtcPriceAtoms = this.lastPriceByMarket.get(CBBTC_USDC_MARKET);
    const cbbtcUsdcMarket = this.markets.get(CBBTC_USDC_MARKET);
    let cbbtcPrice = 0;
    if (cbbtcPriceAtoms && cbbtcUsdcMarket) {
      cbbtcPrice =
        cbbtcPriceAtoms *
        10 **
          (cbbtcUsdcMarket.baseDecimals() - cbbtcUsdcMarket.quoteDecimals());
    }

    try {
      marketProgramAccounts = await ManifestClient.getMarketProgramAccounts(
        this.connection,
      );

      lifetimeVolume = marketProgramAccounts
        .map(
          (
            value: Readonly<{
              account: AccountInfo<Buffer>;
              pubkey: PublicKey;
            }>,
          ) => {
            try {
              const marketPk: string = value.pubkey.toBase58();
              const market: Market = Market.loadFromBuffer({
                buffer: value.account.data,
                address: new PublicKey(marketPk),
              });
              const quoteMint = market.quoteMint().toBase58();

              // Track stablecoin quote volume directly (USDC, USDT, PYUSD, USDS, USD1)
              if (STABLECOIN_MINTS.has(quoteMint)) {
                return (
                  Number(market.quoteVolume()) / 10 ** market.quoteDecimals()
                );
              }

              // Convert SOL quote volume to USDC equivalent
              if (quoteMint == SOL_MINT && solPrice > 0) {
                const solVolumeNormalized =
                  Number(market.quoteVolume()) / 10 ** market.quoteDecimals();
                return solVolumeNormalized * solPrice;
              }

              // Convert CBBTC/WBTC quote volume to USDC equivalent
              if (
                (quoteMint == CBBTC_MINT || quoteMint == WBTC_MINT) &&
                cbbtcPrice > 0
              ) {
                const cbbtcVolumeNormalized =
                  Number(market.quoteVolume()) / 10 ** market.quoteDecimals();
                return cbbtcVolumeNormalized * cbbtcPrice;
              }

              return 0;
            } catch (err) {
              console.error('Error processing market account:', err);
              return 0;
            }
          },
        )
        .reduce((sum, num) => sum + num, 0);
    } catch (error) {
      console.error(
        'Failed to get market program accounts for volume calculation:',
        error,
      );
      // Return zero lifetime volume on error.
      lifetimeVolume = 0;
    }

    const dailyVolumesByToken: Map<string, number> = new Map();
    let dailyUsdcEquivalentVolume = 0;
    let dailyDirectUsdcVolume = 0;

    this.markets.forEach((market: Market, marketPk: string) => {
      const baseVolume: number =
        this.baseVolumeAtomsCheckpoints
          .get(marketPk)!
          .reduce((sum, num) => sum + num, 0) /
        10 ** market.baseDecimals();
      const quoteVolume: number =
        this.quoteVolumeAtomsCheckpoints
          .get(marketPk)!
          .reduce((sum, num) => sum + num, 0) /
        10 ** market.quoteDecimals();
      const baseMint: string = 'solana:' + market.baseMint().toBase58();
      const quoteMint: string = 'solana:' + market.quoteMint().toBase58();
      if (baseVolume == 0 || quoteVolume == 0) {
        return;
      }
      // Track individual token volumes (excluding USDC which we'll handle separately)
      if (!dailyVolumesByToken.has(baseMint)) {
        dailyVolumesByToken.set(baseMint, 0);
      }
      dailyVolumesByToken.set(
        baseMint,
        dailyVolumesByToken.get(baseMint)! + baseVolume,
      );

      // Handle quote volumes differently for USDC vs other tokens
      if (market.quoteMint().toBase58() != USDC_MINT) {
        if (!dailyVolumesByToken.has(quoteMint)) {
          dailyVolumesByToken.set(quoteMint, 0);
        }
        dailyVolumesByToken.set(
          quoteMint,
          dailyVolumesByToken.get(quoteMint)! + quoteVolume,
        );
      }

      // Calculate total USDC equivalent volume
      if (market.quoteMint().toBase58() == SOL_MINT && solPrice > 0) {
        dailyUsdcEquivalentVolume += quoteVolume * solPrice;
      } else if (market.quoteMint().toBase58() == USDC_MINT) {
        dailyDirectUsdcVolume += quoteVolume;
        dailyUsdcEquivalentVolume += quoteVolume;
      }
    });

    // Report direct USDC volume separately and combined volume under USDC key
    const usdcKey = 'solana:' + USDC_MINT;
    if (dailyDirectUsdcVolume > 0) {
      dailyVolumesByToken.set(
        'manifest:direct_usdc_volume',
        dailyDirectUsdcVolume,
      );
    }
    if (dailyUsdcEquivalentVolume > 0) {
      dailyVolumesByToken.set(usdcKey, dailyUsdcEquivalentVolume);
    }

    return {
      totalVolume: {
        [usdcKey]: lifetimeVolume,
      },
      dailyVolume: Object.fromEntries(dailyVolumesByToken),
    };
  }
  /**
   * Get Traders to be used in a leaderboard if a UI wants to.
   * Returns counts for taker/maker trades and volumes.
   */
  getTraders(
    includeDebug: boolean = false,
    limit: number = 500,
  ): {
    [key: string]: {
      taker: number;
      maker: number;
      takerNotionalVolume: number;
      makerNotionalVolume: number;
      pnl: number;
      _debug?: any;
    };
  } {
    const allTraders = new Set<string>([
      ...Array.from(this.traderNumTakerTrades.keys()),
      ...Array.from(this.traderNumMakerTrades.keys()),
    ]);

    // Sort traders by total volume to get the most active ones
    const tradersByVolume = Array.from(allTraders)
      .map((trader) => ({
        trader,
        totalVolume:
          (this.traderTakerNotionalVolume.get(trader) || 0) +
          (this.traderMakerNotionalVolume.get(trader) || 0),
      }))
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .slice(0, limit); // Only process top N traders

    const traderData: {
      [key: string]: {
        taker: number;
        maker: number;
        takerNotionalVolume: number;
        makerNotionalVolume: number;
        pnl: number;
        _debug?: any;
      };
    } = {};

    tradersByVolume.forEach(({ trader }) => {
      const takerNotionalVolume =
        this.traderTakerNotionalVolume.get(trader) || 0;
      const makerNotionalVolume =
        this.traderMakerNotionalVolume.get(trader) || 0;

      const pnlResult = calculateTraderPnL(
        trader,
        this.traderPositions,
        this.traderAcquisitionValue,
        this.markets,
        this.lastPriceByMarket,
        includeDebug,
      );

      const pnl =
        typeof pnlResult === 'number' ? pnlResult : pnlResult.totalPnL;

      traderData[trader] = {
        taker: this.traderNumTakerTrades.get(trader) || 0,
        maker: this.traderNumMakerTrades.get(trader) || 0,
        takerNotionalVolume,
        makerNotionalVolume,
        pnl,
      };

      if (includeDebug && typeof pnlResult !== 'number') {
        traderData[trader]._debug = pnlResult;
      }
    });

    return traderData;
  }

  async getAlts(): Promise<{ alt: string; market: string }[]> {
    const response = await this.pool.query(queries.SELECT_ALT_MARKETS);
    return response.rows.map((r) => ({ alt: r.alt, market: r.market }));
  }

  /**
   * Get array of recent fills.
   */
  getRecentFills(market: string) {
    return { [market]: this.fillLogResults.get(market) };
  }

  async getCompleteFillsFromDatabase(
    options: CompleteFillsQueryOptions = {},
  ): Promise<CompleteFillsQueryResult> {
    const {
      market,
      taker,
      maker,
      signature,
      limit = 100,
      offset = 0,
      fromSlot,
      toSlot,
    } = options;

    try {
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (market) {
        conditions.push(`market = $${paramIndex++}`);
        params.push(market);
      }

      if (taker) {
        conditions.push(`taker = $${paramIndex++}`);
        params.push(taker);
      }

      if (maker) {
        conditions.push(`maker = $${paramIndex++}`);
        params.push(maker);
      }

      if (signature) {
        conditions.push(`signature = $${paramIndex++}`);
        params.push(signature);
      }

      if (fromSlot) {
        conditions.push(`slot >= $${paramIndex++}`);
        params.push(fromSlot);
      }

      if (toSlot) {
        conditions.push(`slot <= $${paramIndex++}`);
        params.push(toSlot);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get count
      const countResult = await this.pool.query(
        `SELECT COUNT(*) as total FROM fills_complete ${whereClause}`,
        params,
      );
      const total = parseInt(countResult.rows[0].total);

      // Get data
      const dataQuery = `
      SELECT fill_data FROM fills_complete
      ${whereClause}
      ORDER BY slot DESC, timestamp DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

      params.push(limit, offset);
      const dataResult = await this.pool.query(dataQuery, params);

      const fills: FillLogResult[] = dataResult.rows.map(
        (row) => row.fill_data,
      );

      return {
        fills,
        total,
        hasMore: offset + limit < total,
      };
    } catch (error) {
      console.error('Error querying complete fills:', error);
      throw error;
    }
  }

  /**
   * Set up database schema if needed
   */
  async initDatabase(): Promise<void> {
    try {
      // Create tables if they don't exist
      await this.pool.query(queries.CREATE_STATE_CHECKPOINTS_TABLE);
      await this.pool.query(queries.CREATE_MARKET_VOLUMES_TABLE);
      await this.pool.query(queries.CREATE_MARKET_CHECKPOINTS_TABLE);
      await this.pool.query(queries.CREATE_TRADER_STATS_TABLE);
      await this.pool.query(queries.CREATE_FILL_LOG_RESULTS_TABLE);
      await this.pool.query(queries.CREATE_TRADER_POSITIONS_TABLE);
      await this.pool.query(queries.CREATE_FILLS_COMPLETE_TABLE);
      await this.pool.query(queries.CREATE_FILLS_COMPLETE_INDEXES);
      await this.pool.query(queries.CREATE_ALT_MARKETS_TABLE);

      console.log('Database schema initialized');
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    }
  }

  /**
   * Save current state to database
   */
  async saveState(): Promise<void> {
    if (this.isReadOnly) {
      console.log('Skipping state save (read-only mode)');
      return;
    }

    // Only save state if process has been running for at least 24 hours
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const elapsedTime = Date.now() - this.startTime;
    if (elapsedTime < TWENTY_FOUR_HOURS_MS) {
      const hoursRemaining = (
        (TWENTY_FOUR_HOURS_MS - elapsedTime) /
        (60 * 60 * 1000)
      ).toFixed(1);
      console.log(
        `Skipping state save (need to run for 24h, ${hoursRemaining}h remaining)`,
      );
      return;
    }

    console.log('Saving state to database...');

    let client;
    try {
      console.log('Getting db client');
      client = await this.pool.connect();

      // Add error handler to prevent unhandled errors from crashing the server
      client.on('error', (err) => {
        console.error('Database client error:', err);
      });

      // Start a transaction
      console.log('Querying begin');
      await client.query(queries.BEGIN_TRANSACTION);

      // Insert a new checkpoint
      console.log('Inserting checkpoint');
      const checkpointResult = await client.query(
        queries.INSERT_STATE_CHECKPOINT,
        [this.lastFillSlot],
      );

      const checkpointId = checkpointResult.rows[0].id;

      // Save market volumes
      const volumePromises = [];
      for (const [
        market,
        baseVolume,
      ] of this.baseVolumeAtomsSinceLastCheckpoint.entries()) {
        const quoteVolume =
          this.quoteVolumeAtomsSinceLastCheckpoint.get(market) || 0;

        volumePromises.push(
          client.query(queries.INSERT_MARKET_VOLUME, [
            checkpointId,
            market,
            baseVolume,
            quoteVolume,
          ]),
        );
      }

      // Save market checkpoints
      const checkpointPromises = [];
      for (const [
        market,
        baseCheckpoints,
      ] of this.baseVolumeAtomsCheckpoints.entries()) {
        const quoteCheckpoints =
          this.quoteVolumeAtomsCheckpoints.get(market) || [];
        const lastPrice = this.lastPriceByMarket.get(market) || 0;

        checkpointPromises.push(
          client.query(queries.INSERT_MARKET_CHECKPOINT, [
            checkpointId,
            market,
            JSON.stringify(baseCheckpoints),
            JSON.stringify(quoteCheckpoints),
            lastPrice,
          ]),
        );
      }

      console.log('Awaiting all inserts to complete');
      // Wait for all queries to complete
      await Promise.all([...volumePromises, ...checkpointPromises]);

      // Save trader stats in batches
      console.log('Saving trader stats in batches');
      const traderArray = Array.from(
        new Set([
          ...Array.from(this.traderNumTakerTrades.keys()),
          ...Array.from(this.traderNumMakerTrades.keys()),
        ]),
      );
      const TRADER_BATCH_SIZE = 20; // Process 20 traders at a time

      for (let i = 0; i < traderArray.length; i += TRADER_BATCH_SIZE) {
        const batch = traderArray.slice(i, i + TRADER_BATCH_SIZE);
        const batchPromises = [];

        for (const trader of batch) {
          const numTakerTrades = this.traderNumTakerTrades.get(trader) || 0;
          const numMakerTrades = this.traderNumMakerTrades.get(trader) || 0;
          const takerVolume = this.traderTakerNotionalVolume.get(trader) || 0;
          const makerVolume = this.traderMakerNotionalVolume.get(trader) || 0;

          batchPromises.push(
            client.query(queries.INSERT_TRADER_STATS, [
              checkpointId,
              trader,
              numTakerTrades,
              numMakerTrades,
              takerVolume,
              makerVolume,
            ]),
          );
        }

        await Promise.all(batchPromises);
      }

      // Save trader positions with filtering and batching
      console.log('Saving trader positions with filtering');
      const POSITION_THRESHOLD = 1; // Only save positions with significant value ($1+)
      const BATCH_SIZE = 10; // Smaller batch size
      const DELAY_BETWEEN_BATCHES = 50; // ms

      // Helper function for delay
      const delay = (ms: number | undefined) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      // Process traders in smaller batches with delays
      let traderCount = 0;
      for (const [trader, positions] of this.traderPositions.entries()) {
        const acquisitionValues =
          this.traderAcquisitionValue.get(trader) || new Map();
        const positionBatchPromises = [];

        for (const [mint, position] of positions.entries()) {
          const acquisitionValue = acquisitionValues.get(mint) || 0;

          // Skip insignificant positions to reduce database load
          if (
            Math.abs(position) === 0 ||
            Math.abs(acquisitionValue) < POSITION_THRESHOLD
          ) {
            continue;
          }

          positionBatchPromises.push(
            client.query(queries.INSERT_TRADER_POSITION, [
              checkpointId,
              trader,
              mint,
              position,
              acquisitionValue,
            ]),
          );
        }

        // Execute all position queries for this trader in parallel
        if (positionBatchPromises.length > 0) {
          await Promise.all(positionBatchPromises);

          // Add throttling delay every BATCH_SIZE traders
          traderCount++;
          if (traderCount % BATCH_SIZE === 0) {
            await delay(DELAY_BETWEEN_BATCHES);
          }
        }
      }

      // Save fill logs using bulk insertion
      console.log('Saving fill log results with bulk insertion');

      const markets = Array.from(this.fillLogResults.keys());
      const BULK_INSERT_SIZE = 100; // Can be increased for better performance

      for (let i = 0; i < markets.length; i += BULK_INSERT_SIZE) {
        const batchMarkets = markets.slice(i, i + BULK_INSERT_SIZE);
        const bulkData = [];

        // Prepare bulk data
        for (const market of batchMarkets) {
          const fills = this.fillLogResults.get(market);
          if (fills && fills.length > 0) {
            bulkData.push({
              checkpoint_id: checkpointId,
              market: market,
              fill_data: JSON.stringify(fills),
            });
          }
        }

        // Skip if nothing to insert
        if (bulkData.length === 0) continue;

        // Execute bulk insertion
        if (bulkData.length > 0) {
          console.log(`Bulk inserting ${bulkData.length} fill records`);

          // Generate a parameterized query for the bulk insertion
          const columns = ['checkpoint_id', 'market', 'fill_data'];
          const columnStr = columns.join(', ');
          const placeholders = bulkData
            .map((_, index) => {
              const offset = index * columns.length;
              return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
            })
            .join(', ');

          const values = bulkData.flatMap((row) => [
            row.checkpoint_id,
            row.market,
            row.fill_data,
          ]);

          const query = `
            INSERT INTO fill_log_results (${columnStr})
            VALUES ${placeholders}
          `;

          await client.query(query, values);
        }

        // Add a small delay between batches
        if (i + BULK_INSERT_SIZE < markets.length) {
          await delay(100);
        }
      }

      console.log('Cleaning up old checkpoints');
      // Clean up old checkpoints - keep only the most recent one
      await client.query(queries.DELETE_OLD_CHECKPOINTS, [checkpointId]);

      console.log('Committing');
      await client.query(queries.COMMIT_TRANSACTION);
      console.log('State saved successfully to database');
    } catch (error) {
      console.error('Error saving state to database:', error);
      if (client) {
        try {
          await client.query(queries.ROLLBACK_TRANSACTION);
        } catch (rollbackError) {
          console.error('Error during rollback:', rollbackError);
          // Continue execution even if rollback fails
        }
      }
      // Don't re-throw - we want to continue operation even after errors
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.error('Error releasing client:', releaseError);
          // Don't throw release errors, just log them
        }
      }
    }
  }

  /**
   * Load state from database
   */
  async loadState(): Promise<boolean> {
    console.log('Loading state from database...');

    try {
      // Get the most recent checkpoint
      const checkpointResultRecent = await this.pool.query(
        queries.SELECT_RECENT_CHECKPOINT,
      );

      if (checkpointResultRecent.rowCount === 0) {
        console.log('No saved state found in database');
        return false;
      }

      const checkpointId = checkpointResultRecent.rows[0].id;
      this.lastFillSlot = checkpointResultRecent.rows[0].last_fill_slot;

      // Load market volumes
      const volumeResult = await this.pool.query(
        queries.SELECT_MARKET_VOLUMES,
        [checkpointId],
      );

      for (const row of volumeResult.rows) {
        this.baseVolumeAtomsSinceLastCheckpoint.set(
          row.market,
          Number(row.base_volume_since_last_checkpoint),
        );
        this.quoteVolumeAtomsSinceLastCheckpoint.set(
          row.market,
          Number(row.quote_volume_since_last_checkpoint),
        );
      }

      // Load market checkpoints
      const checkpointResult = await this.pool.query(
        queries.SELECT_MARKET_CHECKPOINTS,
        [checkpointId],
      );

      for (const row of checkpointResult.rows) {
        let baseCheckpoints = JSON.parse(row.base_volume_checkpoints_text);
        let quoteCheckpoints = JSON.parse(row.quote_volume_checkpoints_text);

        if (!Array.isArray(baseCheckpoints)) {
          console.log(
            `Base checkpoints for market ${row.market} is not an array, converting`,
          );
          baseCheckpoints = Object.values(baseCheckpoints);
        }

        if (!Array.isArray(quoteCheckpoints)) {
          console.log(
            `Quote checkpoints for market ${row.market} is not an array, converting`,
          );
          quoteCheckpoints = Object.values(quoteCheckpoints);
        }

        this.baseVolumeAtomsCheckpoints.set(row.market, baseCheckpoints);
        this.quoteVolumeAtomsCheckpoints.set(row.market, quoteCheckpoints);
        this.lastPriceByMarket.set(row.market, Number(row.last_price));
      }

      // Load trader stats
      const traderResult = await this.pool.query(queries.SELECT_TRADER_STATS, [
        checkpointId,
      ]);

      for (const row of traderResult.rows) {
        this.traderNumTakerTrades.set(row.trader, Number(row.num_taker_trades));
        this.traderNumMakerTrades.set(row.trader, Number(row.num_maker_trades));
        this.traderTakerNotionalVolume.set(
          row.trader,
          Number(row.taker_notional_volume),
        );
        this.traderMakerNotionalVolume.set(
          row.trader,
          Number(row.maker_notional_volume),
        );
      }

      // Load trader positions
      const positionResult = await this.pool.query(
        queries.SELECT_TRADER_POSITIONS,
        [checkpointId],
      );

      for (const row of positionResult.rows) {
        if (!this.traderPositions.has(row.trader)) {
          this.traderPositions.set(row.trader, new Map());
        }
        if (!this.traderAcquisitionValue.has(row.trader)) {
          this.traderAcquisitionValue.set(row.trader, new Map());
        }

        this.traderPositions
          .get(row.trader)!
          .set(row.mint, Number(row.position));
        this.traderAcquisitionValue
          .get(row.trader)!
          .set(row.mint, Number(row.acquisition_value));
      }

      // Load fill logs
      const fillResult = await this.pool.query(
        queries.SELECT_FILL_LOG_RESULTS,
        [checkpointId],
      );

      for (const row of fillResult.rows) {
        this.fillLogResults.set(row.market, row.fill_data);
      }

      console.log('State loaded successfully from database');
      return true;
    } catch (error) {
      console.error('Error loading state from database:', error);
      return false;
    }
  }
}
