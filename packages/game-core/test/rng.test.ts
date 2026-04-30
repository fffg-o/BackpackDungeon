import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveSeed,
  masterSeedFromRandomSeed,
  pickWeighted,
  randomRange,
  randomU32,
  type WeightedItem
} from "../src/index.js";

const LOOT_TABLE: readonly WeightedItem<string>[] = Object.freeze([
  { item: "common", weight: 75 },
  { item: "rare", weight: 20 },
  { item: "legendary", weight: 5 }
]);

test("same seed produces the same randomU32 sequence", () => {
  const seed = deriveSeed("packrun-master", "map", "2026-04-25");
  const first = Array.from({ length: 12 }, (_, index) => randomU32(seed, index));
  const second = Array.from({ length: 12 }, (_, index) => randomU32(seed, index));

  assert.deepEqual(first, second);
});

test("same seed produces the same ranged and weighted picks", () => {
  const seed = deriveSeed("packrun-master", "reward", "2026-04-25");
  const first = Array.from({ length: 12 }, (_, index) => ({
    amount: randomRange(seed, index, 10, 99),
    item: pickWeighted(seed, index + 100, LOOT_TABLE)
  }));
  const second = Array.from({ length: 12 }, (_, index) => ({
    amount: randomRange(seed, index, 10, 99),
    item: pickWeighted(seed, index + 100, LOOT_TABLE)
  }));

  assert.deepEqual(first, second);
});

test("different domain produces an independent result", () => {
  const mapSeed = deriveSeed("packrun-master", "map", "2026-04-25");
  const rewardSeed = deriveSeed("packrun-master", "reward", "2026-04-25");

  assert.notEqual(mapSeed, rewardSeed);
  assert.notEqual(randomU32(mapSeed, 0), randomU32(rewardSeed, 0));
});

test("numeric random seed normalizes to one deterministic master seed", () => {
  const randomSeed = 20_260_425;
  const normalizedSeed = masterSeedFromRandomSeed(randomSeed);

  assert.equal(deriveSeed(randomSeed, "map"), deriveSeed(normalizedSeed, "map"));
  assert.equal(randomU32(randomSeed, 4), randomU32(normalizedSeed, 4));
});

test("map seed and reward seed do not affect each other", () => {
  const masterSeed = "packrun-master";
  const dayId = "2026-04-25";
  const mapSeed = deriveSeed(masterSeed, "map", dayId);
  const rewardSeed = deriveSeed(masterSeed, "reward", dayId);
  const rewardSequence = Array.from({ length: 8 }, (_, index) =>
    pickWeighted(rewardSeed, index, LOOT_TABLE)
  );

  Array.from({ length: 50 }, (_, index) => randomU32(mapSeed, index));

  const rewardSequenceAfterMapReads = Array.from({ length: 8 }, (_, index) =>
    pickWeighted(rewardSeed, index, LOOT_TABLE)
  );

  assert.deepEqual(rewardSequenceAfterMapReads, rewardSequence);
});
