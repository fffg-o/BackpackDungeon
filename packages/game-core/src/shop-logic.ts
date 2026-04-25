import { RewardTier } from "@backpack-dungeon/shared";
import type { ShopItemSlot } from "@backpack-dungeon/shared";

export interface ShopPriceParams {
  readonly restockIncreaseBps?: number;
  readonly soldIncreaseBps?: number;
  readonly maxPrice?: number;
}

export interface ShopSlotState extends ShopItemSlot {
  readonly openedAt: number;
  readonly restockInterval: number;
  readonly soldCount: number;
  readonly maxStock?: number;
  readonly maxRestockCount?: number;
  readonly perWalletDailyLimit?: number;
  readonly priceParams?: ShopPriceParams;
}

export interface ShopPlayerState {
  readonly wallet: string;
  readonly balance: number;
  readonly dailyPurchasesByItem?: Readonly<Record<string, number | undefined>>;
  readonly dailyPurchasesBySlot?: Readonly<Record<string, number | undefined>>;
}

export const DEFAULT_SHOP_RESTOCK_PRICE_INCREASE_BPS = 1_200;
export const DEFAULT_SHOP_SOLD_PRICE_INCREASE_BPS = 400;

export function computeRestockEpoch(
  openedAt: number,
  currentTime: number,
  interval: number
): number {
  assertSafeInteger(openedAt, "openedAt");
  assertSafeInteger(currentTime, "currentTime");
  assertPositiveInteger(interval, "interval");

  if (currentTime < openedAt) {
    return 0;
  }

  return Math.floor((currentTime - openedAt) / interval);
}

export function computeAvailableStock(
  baseStock: number,
  restockCount: number,
  soldCount: number,
  maxStock: number
): number {
  assertNonNegativeInteger(baseStock, "baseStock");
  assertNonNegativeInteger(restockCount, "restockCount");
  assertNonNegativeInteger(soldCount, "soldCount");
  assertNonNegativeInteger(maxStock, "maxStock");

  if (maxStock === 0 || baseStock === 0) {
    return 0;
  }

  const restockSize = Math.min(baseStock, maxStock);
  const lifetimeSupply = restockSize * (restockCount + 1);
  const unsoldSupply = Math.max(0, lifetimeSupply - soldCount);

  return Math.min(maxStock, unsoldSupply);
}

export function computeShopPrice(
  basePrice: number,
  restockCount: number,
  soldCount: number,
  priceParams: ShopPriceParams = {}
): number {
  assertNonNegativeInteger(basePrice, "basePrice");
  assertNonNegativeInteger(restockCount, "restockCount");
  assertNonNegativeInteger(soldCount, "soldCount");

  const restockIncreaseBps = assertNonNegativeInteger(
    priceParams.restockIncreaseBps ?? DEFAULT_SHOP_RESTOCK_PRICE_INCREASE_BPS,
    "restockIncreaseBps"
  );
  const soldIncreaseBps = assertNonNegativeInteger(
    priceParams.soldIncreaseBps ?? DEFAULT_SHOP_SOLD_PRICE_INCREASE_BPS,
    "soldIncreaseBps"
  );
  const maxPrice =
    priceParams.maxPrice === undefined
      ? undefined
      : assertNonNegativeInteger(priceParams.maxPrice, "maxPrice");

  const multiplierBps =
    10_000 + restockCount * restockIncreaseBps + soldCount * soldIncreaseBps;
  const price = Math.ceil((basePrice * multiplierBps) / 10_000);

  return maxPrice === undefined ? price : Math.min(maxPrice, price);
}

export function canBuyItem(
  shopSlotState: ShopSlotState,
  playerState: ShopPlayerState,
  currentTime: number
): boolean {
  assertSafeInteger(currentTime, "currentTime");
  assertNonNegativeInteger(playerState.balance, "balance");

  if (currentTime < shopSlotState.openedAt) {
    return false;
  }

  const restockCount = computeEffectiveRestockCount(shopSlotState, currentTime);
  const availableStock = computeAvailableStock(
    shopSlotState.stock,
    restockCount,
    shopSlotState.soldCount,
    shopSlotState.maxStock ?? shopSlotState.stock
  );

  if (availableStock <= 0) {
    return false;
  }

  if (isDailyLimitReached(shopSlotState, playerState)) {
    return false;
  }

  const price = computeShopPrice(
    shopSlotState.price,
    restockCount,
    shopSlotState.soldCount,
    shopSlotState.priceParams
  );

  return playerState.balance >= price;
}

function computeEffectiveRestockCount(
  shopSlotState: ShopSlotState,
  currentTime: number
): number {
  const restockCount = computeRestockEpoch(
    shopSlotState.openedAt,
    currentTime,
    shopSlotState.restockInterval
  );

  if (shopSlotState.maxRestockCount === undefined) {
    return restockCount;
  }

  const maxRestockCount = assertNonNegativeInteger(
    shopSlotState.maxRestockCount,
    "maxRestockCount"
  );

  if (tierRank(shopSlotState.rewardTier) >= tierRank(RewardTier.Rare)) {
    return Math.min(restockCount, maxRestockCount);
  }

  return restockCount;
}

function isDailyLimitReached(
  shopSlotState: ShopSlotState,
  playerState: ShopPlayerState
): boolean {
  if (shopSlotState.perWalletDailyLimit === undefined) {
    return false;
  }

  const limit = assertNonNegativeInteger(
    shopSlotState.perWalletDailyLimit,
    "perWalletDailyLimit"
  );
  const slotPurchases = playerState.dailyPurchasesBySlot?.[shopSlotState.slotId] ?? 0;
  const itemPurchases = playerState.dailyPurchasesByItem?.[shopSlotState.itemId] ?? 0;
  const purchasesToday = Math.max(slotPurchases, itemPurchases);

  assertNonNegativeInteger(purchasesToday, "purchasesToday");

  return purchasesToday >= limit;
}

function tierRank(tier: RewardTier): number {
  return [
    RewardTier.Common,
    RewardTier.Uncommon,
    RewardTier.Rare,
    RewardTier.Epic,
    RewardTier.Legendary
  ].indexOf(tier);
}

function assertSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer.`);
  }

  return value;
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }

  return value;
}

function assertNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }

  return value;
}
