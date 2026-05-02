import assert from "node:assert/strict";
import test from "node:test";
import { RewardTier, type EnemyConfig } from "@backpack-dungeon/shared";
import {
  buildBattleInput,
  computeBattleProofHash,
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
