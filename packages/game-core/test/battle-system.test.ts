import assert from "node:assert/strict";
import test from "node:test";
import { RewardTier, type EnemyConfig } from "@backpack-dungeon/shared";
import {
  BACKPACK_ITEM_DEFINITIONS,
  autoPackItems,
  buildBattleInput,
  computeBackpackBattleStats,
  computeBattleProofHash,
  computeBattleInputHash,
  computePlayerBattleStats,
  createBackpackItemFromTreasure,
  createBackpackSnapshot,
  createStarterBackpackItems,
  placeItem,
  simulateBattle,
  simulateBossBattle,
  simulateEnemyBattle,
  type BattleInputV1,
  type BattlePlayerSnapshotV1
} from "../src/index.js";

const PLAYER_SNAPSHOT: BattlePlayerSnapshotV1 = Object.freeze({
  energy: 25,
  clearedLocations: 0,
  bossDamage: 0,
  itemsPurchased: 0,
  commonLootCount: 0,
  rareEligibilityPoints: 0
});

const WEAK_ENEMY: EnemyConfig = Object.freeze({
  attack: 1,
  id: "slime-weak",
  level: 1,
  maxHealth: 12,
  name: "Weak Slime",
  rewardTier: RewardTier.Common
});

const STRONG_ENEMY: EnemyConfig = Object.freeze({
  attack: 95,
  id: "golem-strong",
  level: 12,
  maxHealth: 1_000,
  name: "Strong Golem",
  rewardTier: RewardTier.Epic
});

const BOSS: EnemyConfig = Object.freeze({
  attack: 20,
  id: "boss-cinder",
  level: 10,
  maxHealth: 800,
  name: "Cinder Boss",
  rewardTier: RewardTier.Legendary
});

test("same BattleInputV1 produces the exact same BattleResultV1", () => {
  const input = makeInput(WEAK_ENEMY);

  assert.deepEqual(simulateEnemyBattle(input, WEAK_ENEMY), simulateEnemyBattle(input, WEAK_ENEMY));
});

test("different player or poiIdHash changes resultHash", () => {
  const input = makeInput(WEAK_ENEMY);
  const baseline = simulateEnemyBattle(input, WEAK_ENEMY);
  const differentPlayer = simulateEnemyBattle(
    {
      ...input,
      player: "player-two"
    },
    WEAK_ENEMY
  );
  const differentPoiHash = simulateEnemyBattle(
    {
      ...input,
      poiIdHash: "poi-hash-two"
    },
    WEAK_ENEMY
  );

  assert.notEqual(differentPlayer.resultHash, baseline.resultHash);
  assert.notEqual(differentPoiHash.resultHash, baseline.resultHash);
});

test("enemy battle won is true on victory and false on failure", () => {
  assert.equal(simulateEnemyBattle(makeInput(WEAK_ENEMY), WEAK_ENEMY).won, true);
  assert.equal(simulateEnemyBattle(makeInput(STRONG_ENEMY), STRONG_ENEMY).won, false);
});

test("bossDamageScore is clamped to 1..10000", () => {
  const result = simulateBossBattle(makeInput(BOSS, "boss"), BOSS);

  assert.ok(result.bossDamageScore >= 1);
  assert.ok(result.bossDamageScore <= 10_000);
});

test("proofHash changes when log changes", () => {
  const result = simulateEnemyBattle(makeInput(WEAK_ENEMY), WEAK_ENEMY);
  const changedLog = result.log.map((entry, index) =>
    index === 0
      ? {
          ...entry,
          damage: entry.damage + 1
        }
      : entry
  );

  assert.notEqual(result.proofHash, computeBattleProofHash(result.inputHash, changedLog));
});

test("legacy simulateBattle returns the current frontend result shape", () => {
  const result = simulateBattle(WEAK_ENEMY, 0, "legacy-seed");

  assert.equal(typeof result.won, "boolean");
  assert.equal(typeof result.turnsTaken, "number");
  assert.equal(typeof result.damageTaken, "number");
  assert.equal(typeof result.flawless, "boolean");
  assert.ok(Array.isArray(result.log));
  assert.ok(result.log.length > 0);
  assert.equal(result.log[0].attacker === "player" || result.log[0].attacker === "enemy", true);
});

test("placed common ruby increases player attack and battle damage", () => {
  const enemy = { ...WEAK_ENEMY, maxHealth: 1_000 };
  const baseInput = makeInput(enemy);
  const backpack = makeStarterBackpack("player-one");
  const baseStats = computePlayerBattleStats(baseInput.playerSnapshot);
  const backpackStats = computePlayerBattleStats(baseInput.playerSnapshot, backpack);
  const baseResult = simulateEnemyBattle(baseInput, enemy);
  const backpackResult = simulateEnemyBattle({ ...baseInput, backpack }, enemy);

  assert.equal(computeBackpackBattleStats(backpack).attackFlat, 3);
  assert.ok(backpackStats.attack > baseStats.attack);
  assert.ok(backpackResult.playerDamageDealt > baseResult.playerDamageDealt);
});

test("moving ruby changes backpackHash, inputHash, and resultHash", () => {
  const input = makeInput(WEAK_ENEMY);
  const inventory = createStarterBackpackItems("2026-05-02", "player-one");
  const ruby = inventory.find((item) => item.definitionId === "ruby-common");
  assert.ok(ruby);

  const leftLayout = placeItem(
    { height: 3, placedItems: [], version: 1, width: 3 },
    ruby,
    { x: 0, y: 0 },
    false,
    BACKPACK_ITEM_DEFINITIONS
  );
  const rightLayout = placeItem(
    { height: 3, placedItems: [], version: 1, width: 3 },
    ruby,
    { x: 2, y: 0 },
    false,
    BACKPACK_ITEM_DEFINITIONS
  );
  const leftBackpack = createBackpackSnapshot({
    inventory,
    itemDefinitions: BACKPACK_ITEM_DEFINITIONS,
    layout: leftLayout
  });
  const rightBackpack = createBackpackSnapshot({
    inventory,
    itemDefinitions: BACKPACK_ITEM_DEFINITIONS,
    layout: rightLayout
  });
  const leftInput = { ...input, backpack: leftBackpack };
  const rightInput = { ...input, backpack: rightBackpack };

  assert.notEqual(leftBackpack.backpackHash, rightBackpack.backpackHash);
  assert.notEqual(computeBattleInputHash(leftInput), computeBattleInputHash(rightInput));
  assert.notEqual(
    simulateEnemyBattle(leftInput, WEAK_ENEMY).resultHash,
    simulateEnemyBattle(rightInput, WEAK_ENEMY).resultHash
  );
});

test("potion lowHealth effect heals once and writes itemTriggers to the log", () => {
  const potion = createBackpackItemFromTreasure(
    { itemId: "potion-common", rewardTier: RewardTier.Common, sourceRef: "potion-test" },
    { dayId: "2026-05-02", player: "player-one" }
  );
  const backpack = createBackpackSnapshot({
    inventory: [potion],
    itemDefinitions: BACKPACK_ITEM_DEFINITIONS,
    layout: placeItem(
      { height: 2, placedItems: [], version: 1, width: 2 },
      potion,
      { x: 0, y: 0 },
      false,
      BACKPACK_ITEM_DEFINITIONS
    )
  });
  const enemy = { ...WEAK_ENEMY, attack: 80, maxHealth: 200 };
  const result = simulateEnemyBattle({ ...makeInput(enemy), backpack }, enemy);
  const trigger = result.log.find((entry) => entry.action === "item:lowHealth");

  assert.ok(trigger);
  assert.ok((trigger.healDelta ?? 0) > 0);
  assert.ok((trigger.itemTriggers?.length ?? 0) > 0);
});

test("bomb battleStart effect damages before the first attack log", () => {
  const bomb = createBackpackItemFromTreasure(
    { itemId: "bomb-common", rewardTier: RewardTier.Common, sourceRef: "bomb-test" },
    { dayId: "2026-05-02", player: "player-one" }
  );
  const backpack = createBackpackSnapshot({
    inventory: [bomb],
    itemDefinitions: BACKPACK_ITEM_DEFINITIONS,
    layout: placeItem(
      { height: 2, placedItems: [], version: 1, width: 3 },
      bomb,
      { x: 0, y: 0 },
      false,
      BACKPACK_ITEM_DEFINITIONS
    )
  });
  const result = simulateEnemyBattle({ ...makeInput(WEAK_ENEMY), backpack }, WEAK_ENEMY);

  assert.equal(result.log[0].action, "item:battleStart");
  assert.equal(result.log[0].damage, 6);
  assert.ok((result.log[0].itemTriggers?.length ?? 0) > 0);
});

function makeInput(
  enemy: EnemyConfig,
  encounterKind: BattleInputV1["encounterKind"] = "enemy"
): BattleInputV1 {
  return buildBattleInput({
    attemptIndex: 0,
    clearCount: 0,
    dayId: "2026-05-02",
    encounterKind,
    enemyConfig: enemy,
    mapRoot: "map-root-one",
    player: "player-one",
    playerSnapshot: PLAYER_SNAPSHOT,
    poiId: `poi-${enemy.id}`,
    poiIdHash: `poi-hash-${enemy.id}`,
    rulesetHash: "ruleset-one"
  });
}

function makeStarterBackpack(player: string) {
  const inventory = createStarterBackpackItems("2026-05-02", player);
  return createBackpackSnapshot({
    inventory,
    itemDefinitions: BACKPACK_ITEM_DEFINITIONS,
    layout: autoPackItems(inventory, BACKPACK_ITEM_DEFINITIONS, 6, 5)
  });
}
