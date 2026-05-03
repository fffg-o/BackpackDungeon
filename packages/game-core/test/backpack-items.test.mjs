import assert from "node:assert/strict";
import test from "node:test";
import { RewardTier } from "@backpack-dungeon/shared";
import {
  createBackpackItemFromShopSlot,
  createStarterBackpackItems,
  getBackpackItemDefinition
} from "../dist-tests/src/index.js";

test("Common Ruby definition gives attack +1", () => {
  const ruby = getBackpackItemDefinition("ruby-common");
  const attackEffect = ruby.effects.find((effect) => effect.stat === "attack");

  assert.equal(ruby.kind, "gem");
  assert.equal(ruby.size.width, 1);
  assert.equal(ruby.size.height, 1);
  assert.equal(attackEffect?.flat, 1);
});

test("starter backpack item ids are deterministic for day and player", () => {
  const first = createStarterBackpackItems("2026-05-02", "player-one");
  const second = createStarterBackpackItems("2026-05-02", "player-one");

  assert.deepEqual(first, second);
});

test("shop slot item maps deterministically from slot metadata", () => {
  const slot = {
    itemId: "potion-rare-shop-seed",
    price: 12,
    rewardTier: RewardTier.Rare,
    slotId: "shop-1-slot-1",
    stock: 2
  };
  const params = {
    dayId: "2026-05-02",
    player: "player-one",
    signature: "tx-one"
  };

  assert.deepEqual(
    createBackpackItemFromShopSlot(slot, params),
    createBackpackItemFromShopSlot(slot, params)
  );
});
