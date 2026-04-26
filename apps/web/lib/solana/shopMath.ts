import BN from "bn.js";

export const BPS_DENOMINATOR = 10_000n;
export const DEFAULT_RESTOCK_PRICE_INCREASE_BPS = 1_200n;
export const DEFAULT_SOLD_PRICE_INCREASE_BPS = 400n;

export type IntegerLike =
  | number
  | string
  | bigint
  | BN
  | {
      readonly toString: () => string;
    };

export interface ShopMathInput {
  readonly basePrice: IntegerLike;
  readonly baseStock: IntegerLike;
  readonly maxStock: IntegerLike;
  readonly soldCount: IntegerLike;
  readonly restockIntervalSeconds: IntegerLike;
  readonly openedAt: IntegerLike;
  readonly currentTime: IntegerLike;
}

export interface ShopComputedState {
  readonly restockEpoch: bigint;
  readonly availableStock: bigint;
  readonly currentPrice: bigint;
}

export function toBigInt(value: IntegerLike): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError("number values must be safe integers.");
    }
    return BigInt(value);
  }
  if (typeof value === "string") return BigInt(value);
  return BigInt(value.toString());
}

export function toSafeNumber(value: IntegerLike, name: string): number {
  const bigintValue = toBigInt(value);
  if (bigintValue > BigInt(Number.MAX_SAFE_INTEGER) || bigintValue < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${name} is outside the safe JavaScript number range.`);
  }
  return Number(bigintValue);
}

export function computeRestockEpoch(
  openedAt: IntegerLike,
  currentTime: IntegerLike,
  interval: IntegerLike,
): bigint {
  const openedAtValue = toBigInt(openedAt);
  const currentTimeValue = toBigInt(currentTime);
  const intervalValue = toBigInt(interval);

  if (intervalValue <= 0n || currentTimeValue < openedAtValue) {
    return 0n;
  }

  return (currentTimeValue - openedAtValue) / intervalValue;
}

export function computeAvailableStock(
  baseStock: IntegerLike,
  restockEpoch: IntegerLike,
  soldCount: IntegerLike,
  maxStock: IntegerLike,
): bigint {
  const baseStockValue = toBigInt(baseStock);
  const maxStockValue = toBigInt(maxStock);
  if (baseStockValue === 0n || maxStockValue === 0n) {
    return 0n;
  }

  const lifetimeSupply = baseStockValue * (toBigInt(restockEpoch) + 1n);
  const soldCountValue = toBigInt(soldCount);
  const unsoldSupply = soldCountValue >= lifetimeSupply ? 0n : lifetimeSupply - soldCountValue;
  return unsoldSupply < maxStockValue ? unsoldSupply : maxStockValue;
}

export function computeShopPrice(
  basePrice: IntegerLike,
  restockEpoch: IntegerLike,
  soldCount: IntegerLike,
): bigint {
  const restockIncrease = toBigInt(restockEpoch) * DEFAULT_RESTOCK_PRICE_INCREASE_BPS;
  const soldIncrease = toBigInt(soldCount) * DEFAULT_SOLD_PRICE_INCREASE_BPS;
  const multiplierBps = BPS_DENOMINATOR + restockIncrease + soldIncrease;
  const priceNumer = toBigInt(basePrice) * multiplierBps;
  return (priceNumer + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

export function computeShopSlotState(input: ShopMathInput): ShopComputedState {
  const restockEpoch = computeRestockEpoch(
    input.openedAt,
    input.currentTime,
    input.restockIntervalSeconds,
  );

  return {
    restockEpoch,
    availableStock: computeAvailableStock(
      input.baseStock,
      restockEpoch,
      input.soldCount,
      input.maxStock,
    ),
    currentPrice: computeShopPrice(input.basePrice, restockEpoch, input.soldCount),
  };
}

