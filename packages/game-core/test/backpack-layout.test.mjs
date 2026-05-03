import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKPACK_ITEM_DEFINITIONS,
  autoPackItems,
  canPlaceItem,
  createStarterBackpackItems,
  getBackpackItemDefinition,
  getItemSize,
  placeItem,
  rotatePlacedItem
} from "../dist-tests/src/index.js";

test("item cannot be placed outside backpack bounds", () => {
  const layout = { height: 2, placedItems: [], version: 1, width: 2 };
  const dagger = getBackpackItemDefinition("training-dagger");

  assert.equal(
    canPlaceItem(
      layout,
      {
        definitionId: dagger.id,
        instanceId: "dagger-one",
        rotated: false,
        x: 1,
        y: 1
      },
      BACKPACK_ITEM_DEFINITIONS
    ),
    false
  );
});

test("items cannot overlap occupied cells", () => {
  const layout = {
    height: 3,
    placedItems: [
      {
        definitionId: "training-dagger",
        instanceId: "dagger-one",
        rotated: false,
        x: 0,
        y: 0
      }
    ],
    version: 1,
    width: 3
  };

  assert.equal(
    canPlaceItem(
      layout,
      {
        definitionId: "ruby-common",
        instanceId: "ruby-one",
        rotated: false,
        x: 0,
        y: 1
      },
      BACKPACK_ITEM_DEFINITIONS
    ),
    false
  );
});

test("rotated item size changes and rotatePlacedItem persists rotation", () => {
  const dagger = getBackpackItemDefinition("training-dagger");
  assert.deepEqual(getItemSize(dagger, false), { width: 1, height: 2 });
  assert.deepEqual(getItemSize(dagger, true), { width: 2, height: 1 });

  const layout = placeItem(
    { height: 3, placedItems: [], version: 1, width: 3 },
    { definitionId: dagger.id, instanceId: "dagger-one" },
    { x: 0, y: 0 },
    false,
    BACKPACK_ITEM_DEFINITIONS
  );
  const rotated = rotatePlacedItem(layout, "dagger-one", BACKPACK_ITEM_DEFINITIONS);

  assert.equal(rotated.placedItems[0].rotated, true);
});

test("autoPackItems is deterministic for identical input", () => {
  const inventory = createStarterBackpackItems("2026-05-02", "player-one");

  assert.deepEqual(
    autoPackItems(inventory, BACKPACK_ITEM_DEFINITIONS, 5, 4),
    autoPackItems(inventory, BACKPACK_ITEM_DEFINITIONS, 5, 4)
  );
});
