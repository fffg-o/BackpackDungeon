import assert from "node:assert/strict";
import test from "node:test";
import { RewardTier } from "@backpack-dungeon/shared";
import {
  canBuyItem,
  computeAvailableStock,
  computeRestockEpoch,
  computeShopPrice,
  type ShopPlayerState,
  type ShopSlotState
} from "../src/index.js";

const OPENED_AT = 1_000;
const RESTOCK_INTERVAL = 300;

const BASE_SLOT: ShopSlotState = Object.freeze({
  itemId: "potion-common",
  maxStock: 3,
  openedAt: OPENED_AT,
  perWalletDailyLimit: 5,
  price: 100,
  restockInterval: RESTOCK_INTERVAL,
  rewardTier: RewardTier.Common,
  slotId: "slot-potion",
  soldCount: 0,
  stock: 3
});

const PLAYER: ShopPlayerState = Object.freeze({
  balance: 10_000,
  dailyPurchasesByItem: {},
  dailyPurchasesBySlot: {},
  wallet: "wallet-1"
});

test("stock decreases after purchase and buyout blocks purchase", () => {
  assert.equal(computeAvailableStock(3, 0, 0, 3), 3);
  assert.equal(computeAvailableStock(3, 0, 1, 3), 2);
  assert.equal(computeAvailableStock(3, 0, 3, 3), 0);

  assert.equal(
    canBuyItem(
      {
        ...BASE_SLOT,
        soldCount: 3
      },
      PLAYER,
      OPENED_AT
    ),
    false
  );
});

test("stock refills after interval", () => {
  const soldOutSlot: ShopSlotState = {
    ...BASE_SLOT,
    soldCount: 3
  };

  assert.equal(computeRestockEpoch(OPENED_AT, OPENED_AT + RESTOCK_INTERVAL - 1, RESTOCK_INTERVAL), 0);
  assert.equal(
    canBuyItem(soldOutSlot, PLAYER, OPENED_AT + RESTOCK_INTERVAL - 1),
    false
  );

  assert.equal(computeRestockEpoch(OPENED_AT, OPENED_AT + RESTOCK_INTERVAL, RESTOCK_INTERVAL), 1);
  assert.equal(computeAvailableStock(3, 1, 3, 3), 3);
  assert.equal(canBuyItem(soldOutSlot, PLAYER, OPENED_AT + RESTOCK_INTERVAL), true);
});

test("price rises after restock and sales", () => {
  const initialPrice = computeShopPrice(100, 0, 0);
  const afterRestock = computeShopPrice(100, 1, 0);
  const afterRestockAndSales = computeShopPrice(100, 1, 3);

  assert.ok(afterRestock > initialPrice);
  assert.ok(afterRestockAndSales > afterRestock);
});

test("rare item stops restocking after maxRestockCount", () => {
  const rareSlot: ShopSlotState = {
    itemId: "rare-charm",
    maxRestockCount: 1,
    maxStock: 1,
    openedAt: OPENED_AT,
    price: 500,
    restockInterval: RESTOCK_INTERVAL,
    rewardTier: RewardTier.Rare,
    slotId: "slot-rare-charm",
    soldCount: 1,
    stock: 1
  };

  assert.equal(canBuyItem(rareSlot, PLAYER, OPENED_AT + RESTOCK_INTERVAL), true);
  assert.equal(
    canBuyItem(
      {
        ...rareSlot,
        soldCount: 2
      },
      PLAYER,
      OPENED_AT + RESTOCK_INTERVAL * 10
    ),
    false
  );
});

test("wallet daily limit blocks purchase", () => {
  assert.equal(
    canBuyItem(
      BASE_SLOT,
      {
        ...PLAYER,
        dailyPurchasesBySlot: {
          [BASE_SLOT.slotId]: 5
        }
      },
      OPENED_AT
    ),
    false
  );
});
