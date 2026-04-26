// ──────────────────────────────────────────────────────────────────────────────
// Backpack Dungeon — Off-chain Gameplay Integration Tests
//
// These tests validate deterministic game-core logic, Merkle proof generation,
// battle simulation, shop logic, boss logic, RNG, and mock cNFT behavior.
// They do not call Anchor instructions or mutate on-chain accounts.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import test from "node:test";
import { LocationKind, RewardTier } from "@backpack-dungeon/shared";
import {
  generateDailyMap,
  buildLocationMerkleTree,
  getLocationProof,
  locationLeafHash,
  verifyLocationProof,
  computeEnemyStats,
  computeEnemyCooldown,
  computeEnemyReward,
  computeEnemyRewardTier,
  computeRestockEpoch,
  computeAvailableStock,
  computeShopPrice,
  canBuyItem,
  getBossShardIndex,
  computeBossDamage,
  computeBossParticipationTier,
  BossParticipationTier,
  isBossDefeated,
  aggregateBossDamage,
  deriveSeed,
  randomU32,
  randomRange,
  pickWeighted,
} from "@backpack-dungeon/game-core";
import { mockCnftAdapter } from "@backpack-dungeon/cnft-adapter";
import { simulateBattle } from "../apps/web/app/dungeon/battle-sim.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

const MASTER_SEED = "packrun-master";
const BASE_INPUT = Object.freeze({
  bossCount: 2,
  dayId: "2026-04-25",
  enemyCount: 12,
  height: 20,
  masterSeed: MASTER_SEED,
  poiDensity: 0.06,
  shopCount: 4,
  treasureCount: 6,
  width: 30,
});

const OPENED_AT = 1_000;
const RESTOCK_INTERVAL = 300;

const BASE_SLOT = Object.freeze({
  itemId: "potion-common",
  maxStock: 3,
  openedAt: OPENED_AT,
  perWalletDailyLimit: 5,
  price: 100,
  restockInterval: RESTOCK_INTERVAL,
  rewardTier: RewardTier.Common,
  slotId: "slot-potion",
  soldCount: 0,
  stock: 3,
});

const PLAYER = Object.freeze({
  balance: 10_000,
  dailyPurchasesByItem: {},
  dailyPurchasesBySlot: {},
  wallet: "wallet-1",
});

const PLAYER_PUBKEY = "7pQZQX5D6H7c8x7k4q9wWAhLw2Gj5v5fJ8E7pN6uPack";

// ══════════════════════════════════════════════════════════════════════════════
// 1. Daily Map Generation
// ══════════════════════════════════════════════════════════════════════════════

test("daily map generates with correct dimensions", () => {
  const map = generateDailyMap(BASE_INPUT);
  assert.equal(map.width, BASE_INPUT.width);
  assert.equal(map.height, BASE_INPUT.height);
  assert.equal(typeof map.dayId, "string");
  assert.equal(typeof map.seedHash, "string");
  assert.equal(map.seedHash.length, 64);
});

test("daily map is deterministic for same input", () => {
  const a = generateDailyMap(BASE_INPUT);
  const b = generateDailyMap(BASE_INPUT);
  assert.equal(a.seedHash, b.seedHash);
  assert.equal(a.locations.length, b.locations.length);
  for (let i = 0; i < a.locations.length; i++) {
    assert.deepEqual(a.locations[i], b.locations[i]);
  }
});

test("daily map changes with different master seed", () => {
  const a = generateDailyMap(BASE_INPUT);
  const b = generateDailyMap({ ...BASE_INPUT, masterSeed: "different-seed" });
  assert.notEqual(a.seedHash, b.seedHash);
});

test("daily map changes with different dayId", () => {
  const a = generateDailyMap(BASE_INPUT);
  const b = generateDailyMap({ ...BASE_INPUT, dayId: "2026-04-26" });
  assert.notEqual(a.seedHash, b.seedHash);
});

test("daily map produces correct POI counts", () => {
  const map = generateDailyMap(BASE_INPUT);
  const enemies = map.locations.filter((l) => l.kind === LocationKind.Enemy);
  const shops = map.locations.filter((l) => l.kind === LocationKind.Shop);
  const bosses = map.locations.filter((l) => l.kind === LocationKind.Boss);
  const treasures = map.locations.filter((l) => l.kind === LocationKind.Treasure);

  assert.equal(enemies.length, BASE_INPUT.enemyCount);
  assert.equal(shops.length, BASE_INPUT.shopCount);
  assert.equal(bosses.length, BASE_INPUT.bossCount);
  assert.equal(treasures.length, BASE_INPUT.treasureCount);
});

test("all POIs have unique positions", () => {
  const map = generateDailyMap(BASE_INPUT);
  const positions = map.locations.map((l) => `${l.position.x},${l.position.y}`);
  const unique = new Set(positions);
  assert.equal(unique.size, positions.length);
});

test("all POIs have unique IDs", () => {
  const map = generateDailyMap(BASE_INPUT);
  const ids = map.locations.map((l) => l.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length);
});

test("all POIs have baseConfigHash", () => {
  const map = generateDailyMap(BASE_INPUT);
  for (const loc of map.locations) {
    assert.ok(loc.baseConfigHash, `Location ${loc.id} missing baseConfigHash`);
    assert.equal(loc.baseConfigHash.length, 64);
  }
});

test("enemy POIs have enemy config", () => {
  const map = generateDailyMap(BASE_INPUT);
  for (const loc of map.locations) {
    if (loc.kind === LocationKind.Enemy) {
      assert.ok(loc.enemy, `Enemy ${loc.id} missing enemy config`);
      assert.ok(loc.enemy.id);
      assert.ok(loc.enemy.name);
      assert.ok(loc.enemy.level > 0);
      assert.ok(loc.enemy.maxHealth > 0);
      assert.ok(loc.enemy.attack > 0);
    }
  }
});

test("shop POIs have shop config with item slots", () => {
  const map = generateDailyMap(BASE_INPUT);
  for (const loc of map.locations) {
    if (loc.kind === LocationKind.Shop) {
      assert.ok(loc.shop, `Shop ${loc.id} missing shop config`);
      assert.ok(loc.shop.itemSlots.length > 0);
      for (const slot of loc.shop.itemSlots) {
        assert.ok(slot.slotId);
        assert.ok(slot.itemId);
        assert.ok(slot.price > 0);
        assert.ok(slot.stock > 0);
      }
    }
  }
});

test("boss POIs have boss config", () => {
  const map = generateDailyMap(BASE_INPUT);
  for (const loc of map.locations) {
    if (loc.kind === LocationKind.Boss) {
      assert.ok(loc.boss, `Boss ${loc.id} missing boss config`);
      assert.ok(loc.boss.name);
      assert.ok(loc.boss.level > 0);
      assert.ok(loc.boss.maxHealth > 0);
      assert.ok(loc.boss.attack > 0);
    }
  }
});

test("treasure POIs have reward tier", () => {
  const map = generateDailyMap(BASE_INPUT);
  for (const loc of map.locations) {
    if (loc.kind === LocationKind.Treasure) {
      assert.ok(loc.rewardTier);
    }
  }
});

test("POI positions are within map bounds", () => {
  const map = generateDailyMap(BASE_INPUT);
  for (const loc of map.locations) {
    assert.ok(
      loc.position.x >= 0 && loc.position.x < map.width,
      `x out of bounds: ${loc.position.x}`
    );
    assert.ok(
      loc.position.y >= 0 && loc.position.y < map.height,
      `y out of bounds: ${loc.position.y}`
    );
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Merkle Tree
// ══════════════════════════════════════════════════════════════════════════════

test("merkle tree root is deterministic", () => {
  const map = generateDailyMap(BASE_INPUT);
  const tree1 = buildLocationMerkleTree(map.locations);
  const tree2 = buildLocationMerkleTree(map.locations);
  assert.equal(tree1.root, tree2.root);
});

test("merkle tree leaf count matches location count", () => {
  const map = generateDailyMap(BASE_INPUT);
  const tree = buildLocationMerkleTree(map.locations);
  assert.equal(tree.leaves.length, map.locations.length);
});

test("valid merkle proof passes verification", () => {
  const map = generateDailyMap(BASE_INPUT);
  const spec = map.locations[3];
  const tree = buildLocationMerkleTree(map.locations);
  const proof = getLocationProof(map.locations, spec.id);
  assert.equal(verifyLocationProof(tree.root, spec, proof), true);
});

test("merkle proof fails for modified location kind", () => {
  const map = generateDailyMap(BASE_INPUT);
  const spec = map.locations.find((l) => l.kind === LocationKind.Enemy);
  assert.ok(spec);
  const tree = buildLocationMerkleTree(map.locations);
  const proof = getLocationProof(map.locations, spec.id);
  const forged = { ...spec, kind: LocationKind.Treasure };
  assert.equal(verifyLocationProof(tree.root, forged, proof), false);
});

test("merkle proof fails for modified position", () => {
  const map = generateDailyMap(BASE_INPUT);
  const spec = map.locations[2];
  const tree = buildLocationMerkleTree(map.locations);
  const proof = getLocationProof(map.locations, spec.id);
  const forged = {
    ...spec,
    position: { x: spec.position.x + 1, y: spec.position.y },
  };
  assert.equal(verifyLocationProof(tree.root, forged, proof), false);
});

test("merkle proof fails for modified config hash", () => {
  const map = generateDailyMap(BASE_INPUT);
  const spec = map.locations[2];
  const tree = buildLocationMerkleTree(map.locations);
  const proof = getLocationProof(map.locations, spec.id);
  const forged = { ...spec, baseConfigHash: "0".repeat(64) };
  assert.equal(verifyLocationProof(tree.root, forged, proof), false);
});

test("merkle proof fails with wrong root", () => {
  const map = generateDailyMap(BASE_INPUT);
  const otherMap = generateDailyMap({ ...BASE_INPUT, masterSeed: "other-seed" });
  const spec = map.locations[2];
  const proof = getLocationProof(map.locations, spec.id);
  const otherTree = buildLocationMerkleTree(otherMap.locations);
  assert.equal(verifyLocationProof(otherTree.root, spec, proof), false);
});

test("merkle proof for first and last location", () => {
  const map = generateDailyMap(BASE_INPUT);
  const tree = buildLocationMerkleTree(map.locations);

  const first = map.locations[0];
  const last = map.locations[map.locations.length - 1];

  const proofFirst = getLocationProof(map.locations, first.id);
  const proofLast = getLocationProof(map.locations, last.id);

  assert.equal(verifyLocationProof(tree.root, first, proofFirst), true);
  assert.equal(verifyLocationProof(tree.root, last, proofLast), true);
});

test("leaf hash is 64 hex characters", () => {
  const map = generateDailyMap(BASE_INPUT);
  for (const loc of map.locations) {
    const hash = locationLeafHash(loc);
    assert.equal(hash.length, 64, `Leaf hash for ${loc.id} is not 64 chars`);
    assert.ok(/^[0-9a-f]{64}$/.test(hash));
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Enemy Scaling
// ══════════════════════════════════════════════════════════════════════════════

test("enemy stats scale with clear count", () => {
  const map = generateDailyMap(BASE_INPUT);
  const enemy = map.locations.find((l) => l.kind === LocationKind.Enemy && l.enemy);
  assert.ok(enemy?.enemy);

  const baseStats = computeEnemyStats(enemy.enemy, 0);
  const scaledStats = computeEnemyStats(enemy.enemy, 5);

  assert.ok(scaledStats.maxHealth >= baseStats.maxHealth);
  assert.ok(scaledStats.attack >= baseStats.attack);
});

test("enemy cooldown increases with clear count", () => {
  const map = generateDailyMap(BASE_INPUT);
  const enemy = map.locations.find((l) => l.kind === LocationKind.Enemy && l.enemy);
  assert.ok(enemy?.enemy);

  const cooldown0 = computeEnemyCooldown(enemy.enemy, 0);
  const cooldown10 = computeEnemyCooldown(enemy.enemy, 10);

  assert.ok(cooldown10 >= cooldown0);
  assert.ok(cooldown0 > 0);
});

test("enemy reward tier computation", () => {
  const map = generateDailyMap(BASE_INPUT);
  const enemy = map.locations.find((l) => l.kind === LocationKind.Enemy && l.enemy);
  assert.ok(enemy?.enemy);

  const tier = computeEnemyRewardTier(enemy.enemy, 0);

  assert.ok([RewardTier.Common, RewardTier.Uncommon, RewardTier.Rare].includes(tier));
});

test("enemy reward computation returns valid structure", () => {
  const map = generateDailyMap(BASE_INPUT);
  const enemy = map.locations.find((l) => l.kind === LocationKind.Enemy && l.enemy);
  assert.ok(enemy?.enemy);

  const reward = computeEnemyReward(MASTER_SEED, enemy, 0, {
    damageTaken: 15,
    flawless: false,
    turnsTaken: 6,
  });

  assert.ok(reward.itemId);
  assert.ok(reward.tier);
  assert.ok(reward.amount >= 0);
  assert.ok(reward.clearCount >= 0);
  assert.ok(reward.cooldownSeconds >= 0);
});

test("flawless victory gives better rewards", () => {
  const map = generateDailyMap(BASE_INPUT);
  const enemy = map.locations.find((l) => l.kind === LocationKind.Enemy && l.enemy);
  assert.ok(enemy?.enemy);

  const normal = computeEnemyReward(MASTER_SEED, enemy, 0, {
    damageTaken: 30,
    flawless: false,
    turnsTaken: 8,
  });

  const flawless = computeEnemyReward(MASTER_SEED, enemy, 0, {
    damageTaken: 0,
    flawless: true,
    turnsTaken: 3,
  });

  assert.ok(flawless.amount >= normal.amount);
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Shop Logic
// ══════════════════════════════════════════════════════════════════════════════

test("restock epoch is zero before first interval", () => {
  assert.equal(computeRestockEpoch(OPENED_AT, OPENED_AT, RESTOCK_INTERVAL), 0);
  assert.equal(
    computeRestockEpoch(OPENED_AT, OPENED_AT + RESTOCK_INTERVAL - 1, RESTOCK_INTERVAL),
    0
  );
});

test("restock epoch increments after interval", () => {
  assert.equal(computeRestockEpoch(OPENED_AT, OPENED_AT + RESTOCK_INTERVAL, RESTOCK_INTERVAL), 1);
  assert.equal(
    computeRestockEpoch(OPENED_AT, OPENED_AT + RESTOCK_INTERVAL * 3, RESTOCK_INTERVAL),
    3
  );
});

test("available stock decreases with purchases", () => {
  assert.equal(computeAvailableStock(3, 0, 0, 3), 3);
  assert.equal(computeAvailableStock(3, 0, 1, 3), 2);
  assert.equal(computeAvailableStock(3, 0, 3, 3), 0);
});

test("available stock refills after restock", () => {
  assert.equal(computeAvailableStock(3, 1, 3, 3), 3);
  assert.equal(computeAvailableStock(3, 2, 3, 3), 3);
});

test("available stock respects max stock cap", () => {
  assert.equal(computeAvailableStock(5, 0, 0, 3), 3);
  assert.equal(computeAvailableStock(5, 1, 0, 3), 3);
});

test("shop price increases with restocks and sales", () => {
  const base = computeShopPrice(100, 0, 0);
  const afterRestock = computeShopPrice(100, 1, 0);
  const afterSales = computeShopPrice(100, 0, 3);
  const afterBoth = computeShopPrice(100, 1, 3);

  assert.ok(afterRestock > base);
  assert.ok(afterSales > base);
  assert.ok(afterBoth > afterRestock);
  assert.ok(afterBoth > afterSales);
});

test("shop price respects max price cap", () => {
  const capped = computeShopPrice(100, 10, 10, { maxPrice: 150 });
  assert.ok(capped <= 150);
});

test("canBuyItem returns true for valid purchase", () => {
  assert.equal(canBuyItem(BASE_SLOT, PLAYER, OPENED_AT), true);
});

test("canBuyItem returns false when sold out", () => {
  const soldOut = { ...BASE_SLOT, soldCount: 3 };
  assert.equal(canBuyItem(soldOut, PLAYER, OPENED_AT), false);
});

test("canBuyItem returns false when insufficient balance", () => {
  const poorPlayer = { ...PLAYER, balance: 50 };
  assert.equal(canBuyItem(BASE_SLOT, poorPlayer, OPENED_AT), false);
});

test("canBuyItem returns false when daily limit reached", () => {
  const limitedPlayer = {
    ...PLAYER,
    dailyPurchasesBySlot: { [BASE_SLOT.slotId]: 5 },
  };
  assert.equal(canBuyItem(BASE_SLOT, limitedPlayer, OPENED_AT), false);
});

test("canBuyItem returns false before shop opens", () => {
  assert.equal(canBuyItem(BASE_SLOT, PLAYER, OPENED_AT - 1), false);
});

test("rare item stops restocking after maxRestockCount", () => {
  const rareSlot = {
    itemId: "rare-charm",
    maxRestockCount: 1,
    maxStock: 1,
    openedAt: OPENED_AT,
    price: 500,
    restockInterval: RESTOCK_INTERVAL,
    rewardTier: RewardTier.Rare,
    slotId: "slot-rare-charm",
    soldCount: 1,
    stock: 1,
  };

  assert.equal(canBuyItem(rareSlot, PLAYER, OPENED_AT + RESTOCK_INTERVAL), true);
  assert.equal(
    canBuyItem({ ...rareSlot, soldCount: 2 }, PLAYER, OPENED_AT + RESTOCK_INTERVAL * 10),
    false
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. Boss Shards
// ══════════════════════════════════════════════════════════════════════════════

test("same player always maps to same shard", () => {
  const first = getBossShardIndex(PLAYER_PUBKEY, 16);
  const second = getBossShardIndex(PLAYER_PUBKEY, 16);
  assert.equal(first, second);
});

test("shard index is within valid range", () => {
  for (const count of [1, 2, 8, 32]) {
    const index = getBossShardIndex(PLAYER_PUBKEY, count);
    assert.ok(index >= 0);
    assert.ok(index < count);
  }
});

test("different players may map to different shards", () => {
  const playerA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const playerB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  // Not guaranteed to be different, but should be deterministic
  assert.equal(getBossShardIndex(playerA, 16), getBossShardIndex(playerA, 16));
  assert.equal(getBossShardIndex(playerB, 16), getBossShardIndex(playerB, 16));
});

test("boss damage computation with bonuses and multipliers", () => {
  assert.equal(
    computeBossDamage({
      baseDamage: 100,
      blockedDamage: 10,
      bonusDamage: 20,
      multiplierBps: 15_000,
    }),
    165
  );
});

test("boss damage with zero bonus", () => {
  assert.equal(
    computeBossDamage({ baseDamage: 50, blockedDamage: 0, bonusDamage: 0, multiplierBps: 10_000 }),
    50
  );
});

test("aggregateBossDamage sums all shard damages", () => {
  assert.equal(
    aggregateBossDamage([
      { shardIndex: 0, totalDamage: 120 },
      {
        shardIndex: 1,
        contributions: [
          { damage: 40, playerPubkey: "player-a" },
          { damage: 60, playerPubkey: "player-b" },
        ],
      },
      { shardIndex: 2, damage: 80 },
    ]),
    300
  );
});

test("isBossDefeated returns correct boolean", () => {
  assert.equal(isBossDefeated(499, 500), false);
  assert.equal(isBossDefeated(500, 500), true);
  assert.equal(isBossDefeated(650, 500), true);
});

test("participation tier thresholds", () => {
  assert.equal(computeBossParticipationTier(0, 1_000), BossParticipationTier.None);
  assert.equal(computeBossParticipationTier(20, 1_000), BossParticipationTier.Bronze);
  assert.equal(computeBossParticipationTier(50, 1_000), BossParticipationTier.Silver);
  assert.equal(computeBossParticipationTier(100, 1_000), BossParticipationTier.Gold);
  assert.equal(computeBossParticipationTier(250, 1_000), BossParticipationTier.Mvp);
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. Battle Simulation
// ══════════════════════════════════════════════════════════════════════════════

test("battle simulation returns valid result", () => {
  const map = generateDailyMap(BASE_INPUT);
  const enemy = map.locations.find((l) => l.kind === LocationKind.Enemy && l.enemy);
  assert.ok(enemy?.enemy);

  const result = simulateBattle(enemy.enemy, 0);
  assert.ok(typeof result.won === "boolean");
  assert.ok(result.turnsTaken > 0);
  assert.ok(result.damageTaken >= 0);
  assert.ok(typeof result.flawless === "boolean");
  assert.ok(result.log.length > 0);
});

test("battle simulation is deterministic for same inputs", () => {
  const map = generateDailyMap(BASE_INPUT);
  const enemy = map.locations.find((l) => l.kind === LocationKind.Enemy && l.enemy);
  assert.ok(enemy?.enemy);

  const a = simulateBattle(enemy.enemy, 0);
  const b = simulateBattle(enemy.enemy, 0);
  assert.equal(a.won, b.won);
  assert.equal(a.turnsTaken, b.turnsTaken);
  assert.equal(a.log.length, b.log.length);
});

test("player stats scale with clear count", async () => {
  const { computePlayerStats } = await import("../apps/web/app/dungeon/battle-sim.ts");
  const base = computePlayerStats(0);
  const scaled = computePlayerStats(10);

  assert.ok(scaled.maxHealth > base.maxHealth);
  assert.ok(scaled.attack > base.attack);
  assert.ok(scaled.defense > base.defense);
});

test("battle log entries have correct structure", () => {
  const map = generateDailyMap(BASE_INPUT);
  const enemy = map.locations.find((l) => l.kind === LocationKind.Enemy && l.enemy);
  assert.ok(enemy?.enemy);

  const result = simulateBattle(enemy.enemy, 0);
  for (const entry of result.log) {
    assert.ok(entry.turn > 0);
    assert.ok(["player", "enemy"].includes(entry.attacker));
    assert.ok(entry.damage >= 0);
    assert.ok(entry.playerHpAfter >= 0);
    assert.ok(entry.enemyHpAfter >= 0);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. cNFT Mock Adapter
// ══════════════════════════════════════════════════════════════════════════════

test("mock cnft adapter mints enemy loot successfully", async () => {
  const metadata = {
    name: "Goblin Loot",
    symbol: "LOOT",
    description: "Spoils from defeating Goblin",
    image: "https://example.com/loot.png",
    attributes: [
      { trait_type: "category", value: "enemy_loot" },
      { trait_type: "enemy_id", value: "goblin-1" },
      { trait_type: "reward_tier", value: "Common" },
      { trait_type: "day_id", value: "2026-04-25" },
      { trait_type: "clear_count", value: 1 },
      { trait_type: "item_id", value: "gold-coins" },
      { trait_type: "amount", value: 50 },
    ],
  };

  const result = await mockCnftAdapter.mintEnemyLootCnft(metadata);
  assert.equal(result.success, true);
  assert.ok(result.log);
  assert.ok(result.mintedAt);
});

test("mock cnft adapter mints boss participation nft", async () => {
  const result = await mockCnftAdapter.mintBossParticipationCnft({
    name: "Boss Participation",
    symbol: "BOSS",
    description: "Participation in boss battle",
    image: "https://example.com/boss.png",
    attributes: [
      { trait_type: "category", value: "boss_participation" },
      { trait_type: "tier", value: "Gold" },
      { trait_type: "day_id", value: "2026-04-25" },
    ],
  });

  assert.equal(result.success, true);
  assert.ok(result.log);
  assert.ok(result.mintedAt);
});

test("mock cnft adapter mints daily reward nft", async () => {
  const result = await mockCnftAdapter.mintDailyRewardNft({
    name: "Daily Reward",
    symbol: "REWARD",
    description: "Daily dungeon completion reward",
    image: "https://example.com/reward.png",
    attributes: [
      { trait_type: "category", value: "daily_reward" },
      { trait_type: "tier", value: "Rare" },
      { trait_type: "day_id", value: "2026-04-25" },
    ],
  });

  assert.equal(result.success, true);
  assert.ok(result.log);
  assert.ok(result.mintedAt);
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. RNG Determinism
// ══════════════════════════════════════════════════════════════════════════════

test("deriveSeed produces deterministic output", () => {
  const a = deriveSeed(MASTER_SEED, "day-1");
  const b = deriveSeed(MASTER_SEED, "day-1");
  assert.equal(a, b);
});

test("deriveSeed changes with different inputs", () => {
  const a = deriveSeed(MASTER_SEED, "day-1");
  const b = deriveSeed(MASTER_SEED, "day-2");
  assert.notEqual(a, b);
});

test("randomU32 returns values in valid range", () => {
  for (let i = 0; i < 100; i++) {
    const val = randomU32(MASTER_SEED, i);
    assert.ok(val >= 0);
    assert.ok(val <= 0xffffffff);
  }
});

test("randomU32 is deterministic", () => {
  assert.equal(randomU32(MASTER_SEED, 0), randomU32(MASTER_SEED, 0));
  assert.equal(randomU32(MASTER_SEED, 42), randomU32(MASTER_SEED, 42));
});

test("randomRange returns values within bounds", () => {
  for (let i = 0; i < 50; i++) {
    const val = randomRange(MASTER_SEED, i, 10, 20);
    assert.ok(val >= 10);
    assert.ok(val <= 20);
  }
});

test("pickWeighted selects from weighted items", () => {
  const items = [
    { item: "common", weight: 70 },
    { item: "rare", weight: 25 },
    { item: "legendary", weight: 5 },
  ];

  const results = new Set();
  for (let i = 0; i < 200; i++) {
    const picked = pickWeighted(MASTER_SEED, i, items);
    results.add(picked);
  }

  // All items should be picked at least once in 200 trials
  assert.equal(results.size, 3);
});

test("pickWeighted is deterministic", () => {
  const items = [
    { item: "common", weight: 70 },
    { item: "rare", weight: 25 },
    { item: "legendary", weight: 5 },
  ];

  const a = pickWeighted(MASTER_SEED, 42, items);
  const b = pickWeighted(MASTER_SEED, 42, items);
  assert.equal(a.item, b.item);
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. End-to-End Dungeon Flow
// ══════════════════════════════════════════════════════════════════════════════

test("full flow: generate -> merkle -> verify -> battle -> clear -> reward", () => {
  // 1. Generate daily map
  const map = generateDailyMap(BASE_INPUT);
  assert.ok(map.locations.length > 0);

  // 2. Build merkle tree
  const tree = buildLocationMerkleTree(map.locations);
  assert.equal(tree.leaves.length, map.locations.length);

  // 3. Pick an enemy location
  const enemyLoc = map.locations.find((l) => l.kind === LocationKind.Enemy && l.enemy);
  assert.ok(enemyLoc?.enemy);

  // 4. Verify merkle proof
  const proof = getLocationProof(map.locations, enemyLoc.id);
  assert.equal(verifyLocationProof(tree.root, enemyLoc, proof), true);

  // 5. Simulate battle
  const battleResult = simulateBattle(enemyLoc.enemy, 0);
  assert.ok(typeof battleResult.won === "boolean");

  // 6. Compute reward
  const reward = computeEnemyReward(MASTER_SEED, enemyLoc, 0, {
    damageTaken: battleResult.damageTaken,
    flawless: battleResult.flawless,
    turnsTaken: battleResult.turnsTaken,
  });
  assert.ok(reward.itemId);
  assert.ok(reward.amount >= 0);
  assert.ok(reward.cooldownSeconds >= 0);
});

test("full flow: shop purchase validation", () => {
  const map = generateDailyMap(BASE_INPUT);
  const shopLoc = map.locations.find((l) => l.kind === LocationKind.Shop && l.shop);
  assert.ok(shopLoc?.shop);
  assert.ok(shopLoc.shop.itemSlots.length > 0);

  const slot = shopLoc.shop.itemSlots[0];
  const shopSlotState = {
    itemId: slot.itemId,
    maxStock: slot.stock,
    openedAt: OPENED_AT,
    perWalletDailyLimit: 5,
    price: slot.price,
    restockInterval: RESTOCK_INTERVAL,
    rewardTier: slot.rewardTier,
    slotId: slot.slotId,
    soldCount: 0,
    stock: slot.stock,
  };

  // Player with sufficient balance can buy
  const richPlayer = { balance: 10_000, wallet: "player-1" };
  assert.equal(canBuyItem(shopSlotState, richPlayer, OPENED_AT), true);

  // Player with insufficient balance cannot buy
  const poorPlayer = { balance: 1, wallet: "player-2" };
  assert.equal(canBuyItem(shopSlotState, poorPlayer, OPENED_AT), false);
});

test("full flow: boss shard participation", () => {
  const map = generateDailyMap(BASE_INPUT);
  const bossLoc = map.locations.find((l) => l.kind === LocationKind.Boss && l.boss);
  assert.ok(bossLoc?.boss);

  const shardIndex = getBossShardIndex(PLAYER_PUBKEY, 16);
  assert.ok(shardIndex >= 0 && shardIndex < 16);

  const damage = computeBossDamage({
    baseDamage: 100,
    blockedDamage: 5,
    bonusDamage: 10,
    multiplierBps: 12_000,
  });
  assert.ok(damage > 0);
});

test("full flow: multiple enemy clears increase difficulty", () => {
  const map = generateDailyMap(BASE_INPUT);
  const enemy = map.locations.find((l) => l.kind === LocationKind.Enemy && l.enemy);
  assert.ok(enemy?.enemy);

  // First clear
  const stats0 = computeEnemyStats(enemy.enemy, 0);
  const cooldown0 = computeEnemyCooldown(enemy.enemy, 0);

  // After 5 clears
  const stats5 = computeEnemyStats(enemy.enemy, 5);
  const cooldown5 = computeEnemyCooldown(enemy.enemy, 5);

  assert.ok(stats5.maxHealth >= stats0.maxHealth);
  assert.ok(stats5.attack >= stats0.attack);
  assert.ok(cooldown5 >= cooldown0);
});