import assert from "node:assert/strict";
import test from "node:test";
import {
  bossShardPda,
  bossLocationPda,
  dailyDungeonPda,
  enemyLocationPda,
  locationPda,
  PACKRUN_PDA_SEEDS,
  playerRunPda,
  sha256Bytes,
  shopPda,
  shopItemSlotPda
} from "../src/index.js";

const textDecoder = new TextDecoder();

function seedStrings(seeds: readonly Uint8Array[]): readonly string[] {
  return seeds.map((seed) => textDecoder.decode(seed));
}

test("PACKRUN_PDA_SEEDS matches the Rust program seed constants", () => {
  assert.deepEqual(PACKRUN_PDA_SEEDS, {
    dailyDungeon: "dungeon",
    location: "location",
    enemyLocation: "enemy",
    shop: "shop",
    bossLocation: "boss",
    playerRun: "run",
    bossShard: "boss_shard",
    bossContribution: "boss_contribution",
    shopItemSlot: "shop_slot",
    dailyRewardClaim: "daily_claim"
  });
});

test("dailyDungeonPda returns the Rust seed order", () => {
  assert.deepEqual(seedStrings(dailyDungeonPda("2026-04-25")), ["dungeon", "2026-04-25"]);
});

test("locationPda returns the Rust seed order", () => {
  const poiIdHash = sha256Bytes("enemy-1");
  const seeds = locationPda("2026-04-25", poiIdHash);

  assert.deepEqual(seedStrings(seeds.slice(0, 2)), ["location", "2026-04-25"]);
  assert.deepEqual(seeds[2], poiIdHash);
  assert.equal(seeds[2].length, 32);
});

test("playerRunPda returns the Rust seed order with raw player bytes", () => {
  const player = new Uint8Array(32);
  player[0] = 7;

  const seeds = playerRunPda("2026-04-25", player);

  assert.deepEqual(seedStrings(seeds.slice(0, 2)), ["run", "2026-04-25"]);
  assert.deepEqual(seeds[2], player);
});

test("detail account PDA helpers use hashed poi_id seeds", () => {
  const poiIdHash = sha256Bytes("enemy-1");

  assert.deepEqual(seedStrings(enemyLocationPda("2026-04-25", poiIdHash).slice(0, 2)), [
    "enemy",
    "2026-04-25"
  ]);
  assert.deepEqual(enemyLocationPda("2026-04-25", poiIdHash)[2], poiIdHash);
  assert.deepEqual(seedStrings(shopPda("2026-04-25", poiIdHash).slice(0, 2)), [
    "shop",
    "2026-04-25"
  ]);
  assert.deepEqual(shopPda("2026-04-25", poiIdHash)[2], poiIdHash);
  assert.deepEqual(seedStrings(bossLocationPda("2026-04-25", poiIdHash).slice(0, 2)), [
    "boss",
    "2026-04-25"
  ]);
  assert.deepEqual(bossLocationPda("2026-04-25", poiIdHash)[2], poiIdHash);
});

test("shopItemSlotPda encodes slotIndex as little-endian u16", () => {
  const poiIdHash = sha256Bytes("shop-1");
  const seeds = shopItemSlotPda("2026-04-25", poiIdHash, 513);

  assert.deepEqual(seedStrings(seeds.slice(0, 2)), ["shop_slot", "2026-04-25"]);
  assert.deepEqual(seeds[2], poiIdHash);
  assert.deepEqual([...seeds[3]], [1, 2]);
});

test("bossShardPda encodes shardIndex as little-endian u16", () => {
  const seeds = bossShardPda("2026-04-25", 258);

  assert.deepEqual(seedStrings(seeds.slice(0, 2)), ["boss_shard", "2026-04-25"]);
  assert.deepEqual([...seeds[2]], [2, 1]);
});

test("playerRunPda rejects non-pubkey byte lengths", () => {
  assert.throws(() => playerRunPda("2026-04-25", new Uint8Array(31)), /32-byte public key/);
});

test("poi_id PDA helpers use a 32-byte hash seed for long ids", () => {
  const longPoiId = "shop-location-with-human-readable-id-longer-than-32-bytes";
  const poiIdHash = sha256Bytes(longPoiId);

  assert.ok(new TextEncoder().encode(longPoiId).length > 32);
  assert.equal(poiIdHash.length, 32);
  assert.equal(locationPda("2026-04-25", poiIdHash)[2].length, 32);
  assert.equal(shopItemSlotPda("2026-04-25", poiIdHash, 0)[2].length, 32);
});

test("poi_id PDA helpers reject non-hash byte lengths", () => {
  assert.throws(() => locationPda("2026-04-25", new Uint8Array(31)), /32 bytes/);
  assert.throws(() => shopItemSlotPda("2026-04-25", new Uint8Array(33), 0), /32 bytes/);
});
