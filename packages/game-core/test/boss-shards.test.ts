import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateBossDamage,
  BossParticipationTier,
  computeBossDamage,
  computeBossParticipationTier,
  getBossShardIndex,
  isBossDefeated
} from "../src/index.js";

const PLAYER = "7pQZQX5D6H7c8x7k4q9wWAhLw2Gj5v5fJ8E7pN6uPack";

test("same player always maps to the same shard", () => {
  const first = getBossShardIndex(PLAYER, 16);
  const second = getBossShardIndex(PLAYER, 16);

  assert.equal(first, second);
});

test("shard index is within range", () => {
  for (const shardCount of [1, 2, 8, 32]) {
    const shardIndex = getBossShardIndex(PLAYER, shardCount);

    assert.ok(shardIndex >= 0);
    assert.ok(shardIndex < shardCount);
  }
});

test("battle result damage supports bonuses, blocks, and multipliers", () => {
  assert.equal(
    computeBossDamage({
      baseDamage: 100,
      blockedDamage: 10,
      bonusDamage: 20,
      multiplierBps: 15_000
    }),
    165
  );
});

test("total damage aggregates correctly", () => {
  assert.equal(
    aggregateBossDamage([
      {
        shardIndex: 0,
        totalDamage: 120
      },
      {
        contributions: [
          {
            damage: 40,
            playerPubkey: "player-a"
          },
          {
            damage: 60,
            playerPubkey: "player-b"
          }
        ],
        shardIndex: 1
      },
      {
        damage: 80,
        shardIndex: 2
      }
    ]),
    300
  );
});

test("boss defeated when totalDamage is at least bossHp", () => {
  assert.equal(isBossDefeated(499, 500), false);
  assert.equal(isBossDefeated(500, 500), true);
  assert.equal(isBossDefeated(650, 500), true);
});

test("participation tier can be computed from damage share", () => {
  assert.equal(computeBossParticipationTier(0, 1_000), BossParticipationTier.None);
  assert.equal(computeBossParticipationTier(20, 1_000), BossParticipationTier.Bronze);
  assert.equal(computeBossParticipationTier(50, 1_000), BossParticipationTier.Silver);
  assert.equal(computeBossParticipationTier(100, 1_000), BossParticipationTier.Gold);
  assert.equal(computeBossParticipationTier(250, 1_000), BossParticipationTier.Mvp);
});
