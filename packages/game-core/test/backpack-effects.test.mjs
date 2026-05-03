import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKPACK_ITEM_DEFINITIONS,
  computeBackpackHash,
  computeBackpackStatBonuses,
  createStarterBackpackItems,
  placeItem
} from "../dist-tests/src/index.js";

test("computeBackpackHash changes when item position changes", () => {
  const inventory = createStarterBackpackItems("2026-05-02", "player-one");
  const ruby = inventory.find((item) => item.definitionId === "ruby-common");
  assert.ok(ruby);

  const baseLayout = { height: 3, placedItems: [], version: 1, width: 3 };
  const left = placeItem(baseLayout, ruby, { x: 0, y: 0 }, false, BACKPACK_ITEM_DEFINITIONS);
  const right = placeItem(baseLayout, ruby, { x: 1, y: 0 }, false, BACKPACK_ITEM_DEFINITIONS);

  assert.notEqual(
    computeBackpackHash({
      inventory,
      itemDefinitions: BACKPACK_ITEM_DEFINITIONS,
      layout: left
    }),
    computeBackpackHash({
      inventory,
      itemDefinitions: BACKPACK_ITEM_DEFINITIONS,
      layout: right
    })
  );
});

test("computeBackpackStatBonuses includes placed ruby attack", () => {
  const inventory = createStarterBackpackItems("2026-05-02", "player-one");
  const ruby = inventory.find((item) => item.definitionId === "ruby-common");
  assert.ok(ruby);

  const layout = placeItem(
    { height: 3, placedItems: [], version: 1, width: 3 },
    ruby,
    { x: 0, y: 0 },
    false,
    BACKPACK_ITEM_DEFINITIONS
  );
  const bonuses = computeBackpackStatBonuses(layout, inventory, BACKPACK_ITEM_DEFINITIONS);

  assert.equal(bonuses.attack, 1);
});
