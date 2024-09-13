/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

type ErrorWithCode = Error & { code: number };
type MaybeErrorWithCode = ErrorWithCode | null | undefined;

const createErrorFromCodeLookup: Map<number, () => ErrorWithCode> = new Map();
const createErrorFromNameLookup: Map<string, () => ErrorWithCode> = new Map();

/**
 * InvalidMarketParameters: 'Invalid market parameters error'
 *
 * @category Errors
 * @category generated
 */
export class InvalidMarketParametersError extends Error {
  readonly code: number = 0x0;
  readonly name: string = 'InvalidMarketParameters';
  constructor() {
    super('Invalid market parameters error');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, InvalidMarketParametersError);
    }
  }
}

createErrorFromCodeLookup.set(0x0, () => new InvalidMarketParametersError());
createErrorFromNameLookup.set(
  'InvalidMarketParameters',
  () => new InvalidMarketParametersError(),
);

/**
 * InvalidDepositAccounts: 'Invalid deposit accounts error'
 *
 * @category Errors
 * @category generated
 */
export class InvalidDepositAccountsError extends Error {
  readonly code: number = 0x1;
  readonly name: string = 'InvalidDepositAccounts';
  constructor() {
    super('Invalid deposit accounts error');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, InvalidDepositAccountsError);
    }
  }
}

createErrorFromCodeLookup.set(0x1, () => new InvalidDepositAccountsError());
createErrorFromNameLookup.set(
  'InvalidDepositAccounts',
  () => new InvalidDepositAccountsError(),
);

/**
 * InvalidWithdrawAccounts: 'Invalid withdraw accounts error'
 *
 * @category Errors
 * @category generated
 */
export class InvalidWithdrawAccountsError extends Error {
  readonly code: number = 0x2;
  readonly name: string = 'InvalidWithdrawAccounts';
  constructor() {
    super('Invalid withdraw accounts error');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, InvalidWithdrawAccountsError);
    }
  }
}

createErrorFromCodeLookup.set(0x2, () => new InvalidWithdrawAccountsError());
createErrorFromNameLookup.set(
  'InvalidWithdrawAccounts',
  () => new InvalidWithdrawAccountsError(),
);

/**
 * InvalidCancel: 'Invalid cancel error'
 *
 * @category Errors
 * @category generated
 */
export class InvalidCancelError extends Error {
  readonly code: number = 0x3;
  readonly name: string = 'InvalidCancel';
  constructor() {
    super('Invalid cancel error');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, InvalidCancelError);
    }
  }
}

createErrorFromCodeLookup.set(0x3, () => new InvalidCancelError());
createErrorFromNameLookup.set('InvalidCancel', () => new InvalidCancelError());

/**
 * InvalidFreeList: 'Internal free list corruption error'
 *
 * @category Errors
 * @category generated
 */
export class InvalidFreeListError extends Error {
  readonly code: number = 0x4;
  readonly name: string = 'InvalidFreeList';
  constructor() {
    super('Internal free list corruption error');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, InvalidFreeListError);
    }
  }
}

createErrorFromCodeLookup.set(0x4, () => new InvalidFreeListError());
createErrorFromNameLookup.set(
  'InvalidFreeList',
  () => new InvalidFreeListError(),
);

/**
 * AlreadyClaimedSeat: 'Cannot claim a second seat for the same trader'
 *
 * @category Errors
 * @category generated
 */
export class AlreadyClaimedSeatError extends Error {
  readonly code: number = 0x5;
  readonly name: string = 'AlreadyClaimedSeat';
  constructor() {
    super('Cannot claim a second seat for the same trader');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, AlreadyClaimedSeatError);
    }
  }
}

createErrorFromCodeLookup.set(0x5, () => new AlreadyClaimedSeatError());
createErrorFromNameLookup.set(
  'AlreadyClaimedSeat',
  () => new AlreadyClaimedSeatError(),
);

/**
 * PostOnlyCrosses: 'Matched on a post only order'
 *
 * @category Errors
 * @category generated
 */
export class PostOnlyCrossesError extends Error {
  readonly code: number = 0x6;
  readonly name: string = 'PostOnlyCrosses';
  constructor() {
    super('Matched on a post only order');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, PostOnlyCrossesError);
    }
  }
}

createErrorFromCodeLookup.set(0x6, () => new PostOnlyCrossesError());
createErrorFromNameLookup.set(
  'PostOnlyCrosses',
  () => new PostOnlyCrossesError(),
);

/**
 * AlreadyExpired: 'New order is already expired'
 *
 * @category Errors
 * @category generated
 */
export class AlreadyExpiredError extends Error {
  readonly code: number = 0x7;
  readonly name: string = 'AlreadyExpired';
  constructor() {
    super('New order is already expired');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, AlreadyExpiredError);
    }
  }
}

createErrorFromCodeLookup.set(0x7, () => new AlreadyExpiredError());
createErrorFromNameLookup.set(
  'AlreadyExpired',
  () => new AlreadyExpiredError(),
);

/**
 * InsufficientOut: 'Less than minimum out amount'
 *
 * @category Errors
 * @category generated
 */
export class InsufficientOutError extends Error {
  readonly code: number = 0x8;
  readonly name: string = 'InsufficientOut';
  constructor() {
    super('Less than minimum out amount');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, InsufficientOutError);
    }
  }
}

createErrorFromCodeLookup.set(0x8, () => new InsufficientOutError());
createErrorFromNameLookup.set(
  'InsufficientOut',
  () => new InsufficientOutError(),
);

/**
 * InvalidPlaceOrderFromWalletParams: 'Invalid place order from wallet params'
 *
 * @category Errors
 * @category generated
 */
export class InvalidPlaceOrderFromWalletParamsError extends Error {
  readonly code: number = 0x9;
  readonly name: string = 'InvalidPlaceOrderFromWalletParams';
  constructor() {
    super('Invalid place order from wallet params');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, InvalidPlaceOrderFromWalletParamsError);
    }
  }
}

createErrorFromCodeLookup.set(
  0x9,
  () => new InvalidPlaceOrderFromWalletParamsError(),
);
createErrorFromNameLookup.set(
  'InvalidPlaceOrderFromWalletParams',
  () => new InvalidPlaceOrderFromWalletParamsError(),
);

/**
 * WrongIndexHintParams: 'Index hint did not match actual index'
 *
 * @category Errors
 * @category generated
 */
export class WrongIndexHintParamsError extends Error {
  readonly code: number = 0xa;
  readonly name: string = 'WrongIndexHintParams';
  constructor() {
    super('Index hint did not match actual index');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, WrongIndexHintParamsError);
    }
  }
}

createErrorFromCodeLookup.set(0xa, () => new WrongIndexHintParamsError());
createErrorFromNameLookup.set(
  'WrongIndexHintParams',
  () => new WrongIndexHintParamsError(),
);

/**
 * PriceNotPositive: 'Price is not positive'
 *
 * @category Errors
 * @category generated
 */
export class PriceNotPositiveError extends Error {
  readonly code: number = 0xb;
  readonly name: string = 'PriceNotPositive';
  constructor() {
    super('Price is not positive');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, PriceNotPositiveError);
    }
  }
}

createErrorFromCodeLookup.set(0xb, () => new PriceNotPositiveError());
createErrorFromNameLookup.set(
  'PriceNotPositive',
  () => new PriceNotPositiveError(),
);

/**
 * OrderWouldOverflow: 'Order settlement would overflow'
 *
 * @category Errors
 * @category generated
 */
export class OrderWouldOverflowError extends Error {
  readonly code: number = 0xc;
  readonly name: string = 'OrderWouldOverflow';
  constructor() {
    super('Order settlement would overflow');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, OrderWouldOverflowError);
    }
  }
}

createErrorFromCodeLookup.set(0xc, () => new OrderWouldOverflowError());
createErrorFromNameLookup.set(
  'OrderWouldOverflow',
  () => new OrderWouldOverflowError(),
);

/**
 * OrderTooSmall: 'Order is too small to settle any value'
 *
 * @category Errors
 * @category generated
 */
export class OrderTooSmallError extends Error {
  readonly code: number = 0xd;
  readonly name: string = 'OrderTooSmall';
  constructor() {
    super('Order is too small to settle any value');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, OrderTooSmallError);
    }
  }
}

createErrorFromCodeLookup.set(0xd, () => new OrderTooSmallError());
createErrorFromNameLookup.set('OrderTooSmall', () => new OrderTooSmallError());

/**
 * Overflow: 'Overflow in token addition'
 *
 * @category Errors
 * @category generated
 */
export class OverflowError extends Error {
  readonly code: number = 0xe;
  readonly name: string = 'Overflow';
  constructor() {
    super('Overflow in token addition');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, OverflowError);
    }
  }
}

createErrorFromCodeLookup.set(0xe, () => new OverflowError());
createErrorFromNameLookup.set('Overflow', () => new OverflowError());

/**
 * MissingGlobal: 'Missing Global account'
 *
 * @category Errors
 * @category generated
 */
export class MissingGlobalError extends Error {
  readonly code: number = 0xf;
  readonly name: string = 'MissingGlobal';
  constructor() {
    super('Missing Global account');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, MissingGlobalError);
    }
  }
}

createErrorFromCodeLookup.set(0xf, () => new MissingGlobalError());
createErrorFromNameLookup.set('MissingGlobal', () => new MissingGlobalError());

/**
 * GlobalInsufficient: 'Insufficient funds on global account to rest an order'
 *
 * @category Errors
 * @category generated
 */
export class GlobalInsufficientError extends Error {
  readonly code: number = 0x10;
  readonly name: string = 'GlobalInsufficient';
  constructor() {
    super('Insufficient funds on global account to rest an order');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, GlobalInsufficientError);
    }
  }
}

createErrorFromCodeLookup.set(0x10, () => new GlobalInsufficientError());
createErrorFromNameLookup.set(
  'GlobalInsufficient',
  () => new GlobalInsufficientError(),
);

/**
 * IncorrectAccount: 'Account key did not match expected'
 *
 * @category Errors
 * @category generated
 */
export class IncorrectAccountError extends Error {
  readonly code: number = 0x11;
  readonly name: string = 'IncorrectAccount';
  constructor() {
    super('Account key did not match expected');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, IncorrectAccountError);
    }
  }
}

createErrorFromCodeLookup.set(0x11, () => new IncorrectAccountError());
createErrorFromNameLookup.set(
  'IncorrectAccount',
  () => new IncorrectAccountError(),
);

/**
 * InvalidMint: 'Mint not allowed for market'
 *
 * @category Errors
 * @category generated
 */
export class InvalidMintError extends Error {
  readonly code: number = 0x12;
  readonly name: string = 'InvalidMint';
  constructor() {
    super('Mint not allowed for market');
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, InvalidMintError);
    }
  }
}

createErrorFromCodeLookup.set(0x12, () => new InvalidMintError());
createErrorFromNameLookup.set('InvalidMint', () => new InvalidMintError());

/**
 * Attempts to resolve a custom program error from the provided error code.
 * @category Errors
 * @category generated
 */
export function errorFromCode(code: number): MaybeErrorWithCode {
  const createError = createErrorFromCodeLookup.get(code);
  return createError != null ? createError() : null;
}

/**
 * Attempts to resolve a custom program error from the provided error name, i.e. 'Unauthorized'.
 * @category Errors
 * @category generated
 */
export function errorFromName(name: string): MaybeErrorWithCode {
  const createError = createErrorFromNameLookup.get(name);
  return createError != null ? createError() : null;
}
