import assert from "node:assert/strict";
import test from "node:test";
import { RewardTier } from "@backpack-dungeon/shared";
import {
  BACKPACK_ITEM_DEFINITIONS,
  computeBackpackCombatEffects,
  computeBackpackHash,
  computeBackpackStatBonuses,
  createBackpackItemFromTreasure,
  createBackpackSnapshot,
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

test("computeBackpackCombatEffects includes placed ruby attack", () => {
  const ruby = makeItem("ruby-common", "ruby-combat");
  const backpack = makeBackpack([ruby], [
    { item: ruby, x: 0, y: 0 }
  ]);

  const effects = computeBackpackCombatEffects(backpack);

  assert.equal(effects.attackFlat, 1);
  assert.ok(effects.notes.some((note) => note.includes("Attack +1")));
});

test("ruby adjacent to weapon gains extra attack", () => {
  const ruby = makeItem("ruby-common", "ruby-adjacent");
  const dagger = makeItem("training-dagger", "dagger-adjacent");
  const backpack = makeBackpack([ruby, dagger], [
    { item: ruby, x: 0, y: 0 },
    { item: dagger, x: 1, y: 0 }
  ]);

  const effects = computeBackpackCombatEffects(backpack);

  assert.equal(effects.attackFlat, 4);
  assert.ok(effects.notes.some((note) => note.includes("adjacent weapon attack +1")));
});

test("charm adjacent to gem increases crit bps", () => {
  const ruby = makeItem("ruby-common", "ruby-charm");
  const charm = makeItem("charm-common", "charm-gem");
  const backpack = makeBackpack([ruby, charm], [
    { item: ruby, x: 0, y: 0 },
    { item: charm, x: 1, y: 0 }
  ]);

  const effects = computeBackpackCombatEffects(backpack);

  assert.equal(effects.critBpsFlat, 100);
  assert.ok(effects.notes.some((note) => note.includes("adjacent gem critical chance +100 bps")));
});

test("ward adjacent to armor increases defense", () => {
  const ward = makeItem("ward-common", "ward-armor");
  const armor = makeItem("wooden-shield", "armor-ward");
  const baseBackpack = makeBackpack([ward, armor], [
    { item: ward, x: 0, y: 0 },
    { item: armor, x: 3, y: 0 }
  ]);
  const adjacentBackpack = makeBackpack([ward, armor], [
    { item: ward, x: 0, y: 0 },
    { item: armor, x: 1, y: 0 }
  ]);

  const baseEffects = computeBackpackCombatEffects(baseBackpack);
  const adjacentEffects = computeBackpackCombatEffects(adjacentBackpack);

  assert.equal(adjacentEffects.defenseFlat, baseEffects.defenseFlat + 1);
  assert.ok(adjacentEffects.notes.some((note) => note.includes("adjacent armor defense +1")));
});

function makeItem(definitionId, sourceRef) {
  return createBackpackItemFromTreasure(
    { itemId: definitionId, rewardTier: RewardTier.Common, sourceRef },
    { dayId: "2026-05-02", player: "player-one", sourceRef }
  );
}

function makeBackpack(inventory, placements) {
  const layout = placements.reduce(
    (currentLayout, placement) =>
      placeItem(
        currentLayout,
        placement.item,
        { x: placement.x, y: placement.y },
        placement.rotated ?? false,
        BACKPACK_ITEM_DEFINITIONS
      ),
    { height: 5, placedItems: [], version: 1, width: 6 }
  );

  return createBackpackSnapshot({
    inventory,
    itemDefinitions: BACKPACK_ITEM_DEFINITIONS,
    layout
  });
}
