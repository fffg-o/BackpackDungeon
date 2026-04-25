import assert from "node:assert/strict";
import test from "node:test";
import { LocationKind, RewardTier } from "@backpack-dungeon/shared";
import {
  computeEnemyCooldown,
  computeEnemyReward,
  computeEnemyRewardTier,
  computeEnemyStats,
  type EnemyScalingConfig
} from "../src/index.js";

const VALUABLE_CLEAR_CAP = 4;
const TRACKED_CLEAR_COUNTS = Object.freeze([
  0,
  1,
  VALUABLE_CLEAR_CAP - 1,
  VALUABLE_CLEAR_CAP,
  VALUABLE_CLEAR_CAP + 10
] as const);

const BASE_ENEMY: EnemyScalingConfig = Object.freeze({
  attack: 10,
  baseCooldownSeconds: 60,
  baseRewardTier: RewardTier.Common,
  id: "enemy-cavern-scout",
  level: 3,
  maxHealth: 100,
  maxRewardTier: RewardTier.Epic,
  name: "Cavern Scout",
  rewardTier: RewardTier.Legendary,
  valuableClearCap: VALUABLE_CLEAR_CAP
});

test("enemy stats and cooldown increase for tracked clear counts", () => {
  const stats = TRACKED_CLEAR_COUNTS.map((clearCount) =>
    computeEnemyStats(BASE_ENEMY, clearCount)
  );
  const cooldowns = TRACKED_CLEAR_COUNTS.map((clearCount) =>
    computeEnemyCooldown(BASE_ENEMY, clearCount)
  );

  assert.deepEqual(stats[0], {
    attack: BASE_ENEMY.attack,
    level: BASE_ENEMY.level,
    maxHealth: BASE_ENEMY.maxHealth
  });
  for (let index = 1; index < TRACKED_CLEAR_COUNTS.length; index += 1) {
    assert.ok(stats[index].maxHealth > stats[index - 1].maxHealth);
    assert.ok(stats[index].attack > stats[index - 1].attack);
    assert.ok(cooldowns[index] > cooldowns[index - 1]);
  }
});

test("reward tier improves before valuableClearCap and resets at the cap", () => {
  assert.equal(computeEnemyRewardTier(BASE_ENEMY, 0), RewardTier.Common);
  assert.equal(computeEnemyRewardTier(BASE_ENEMY, 1), RewardTier.Uncommon);
  assert.equal(
    computeEnemyRewardTier(BASE_ENEMY, VALUABLE_CLEAR_CAP - 1),
    RewardTier.Epic
  );
  assert.equal(computeEnemyRewardTier(BASE_ENEMY, VALUABLE_CLEAR_CAP), RewardTier.Common);
  assert.equal(
    computeEnemyRewardTier(BASE_ENEMY, VALUABLE_CLEAR_CAP + 10),
    RewardTier.Common
  );
});

test("reward never exceeds configured maxRewardTier", () => {
  const cappedEnemy: EnemyScalingConfig = {
    ...BASE_ENEMY,
    maxRewardTier: RewardTier.Uncommon
  };

  for (const clearCount of TRACKED_CLEAR_COUNTS) {
    const tier = computeEnemyRewardTier(cappedEnemy, clearCount);
    assert.ok(tierRank(tier) <= tierRank(RewardTier.Uncommon));
  }
});

test("computed enemy rewards are deterministic for tracked clear counts", () => {
  for (const clearCount of TRACKED_CLEAR_COUNTS) {
    const first = computeEnemyReward("reward-seed", BASE_ENEMY, clearCount, {
      flawless: true,
      score: 2_500,
      turnsTaken: 9
    });
    const second = computeEnemyReward("reward-seed", BASE_ENEMY, clearCount, {
      flawless: true,
      score: 2_500,
      turnsTaken: 9
    });

    assert.deepEqual(first, second);
    assert.equal(first.tier, computeEnemyRewardTier(BASE_ENEMY, clearCount));
  }
});

test("enemy rewards can be computed from an enemy location spec", () => {
  const locationReward = computeEnemyReward(
    "reward-seed",
    {
      enemy: BASE_ENEMY,
      id: "poi-enemy-1",
      kind: LocationKind.Enemy,
      position: {
        x: 4,
        y: 7
      }
    },
    1,
    {
      damageTaken: 30,
      score: 1_000
    }
  );

  assert.equal(locationReward.enemyId, BASE_ENEMY.id);
  assert.equal(locationReward.clearCount, 1);
  assert.equal(locationReward.tier, RewardTier.Uncommon);
});

function tierRank(tier: RewardTier): number {
  return [
    RewardTier.Common,
    RewardTier.Uncommon,
    RewardTier.Rare,
    RewardTier.Epic,
    RewardTier.Legendary
  ].indexOf(tier);
}
