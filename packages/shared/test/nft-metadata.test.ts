import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEnemyLootMetadata,
  buildBossParticipationMetadata,
  buildDailyRewardMetadata,
  RewardTier,
} from "../src/index.js";

// ── Shared test params ──

const BASE_PARAMS = {
  name: "Test NFT",
  description: "A test NFT metadata",
  day_id: "2026-04-26",
  location_id: "enemy-1",
  reward_tier: RewardTier.Rare,
  player: "Dv3qZ2X8J9mQ1kL5pR7sT4wY6nB2cF0eH",
  ruleset_hash: "abc123def456",
};

// ──────────────────────────────────────────
// buildEnemyLootMetadata
// ──────────────────────────────────────────

test("buildEnemyLootMetadata returns required attributes", () => {
  const result = buildEnemyLootMetadata({
    ...BASE_PARAMS,
    clear_count: 5,
  });

  assert.equal(result.name, "Test NFT");
  assert.equal(result.symbol, "BPD");
  assert.equal(result.description, "A test NFT metadata");
  assert.equal(
    result.image,
    "https://backpack-dungeon.example.com/assets/enemy-loot.png",
  );

  const attrs = result.attributes;
  assert.ok(attrs.find((a) => a.trait_type === "day_id" && a.value === "2026-04-26"));
  assert.ok(attrs.find((a) => a.trait_type === "location_id" && a.value === "enemy-1"));
  assert.ok(attrs.find((a) => a.trait_type === "reward_tier" && a.value === "Rare"));
  assert.ok(attrs.find((a) => a.trait_type === "player" && a.value === BASE_PARAMS.player));
  assert.ok(attrs.find((a) => a.trait_type === "clear_count" && a.value === 5));
  assert.ok(attrs.find((a) => a.trait_type === "ruleset_hash" && a.value === "abc123def456"));
});

test("buildEnemyLootMetadata includes optional proof_uri and final_state_hash when provided", () => {
  const result = buildEnemyLootMetadata({
    ...BASE_PARAMS,
    clear_count: 3,
    proof_uri: "https://proof.example.com/proof.json",
    final_state_hash: "0xdeadbeef",
  });

  const attrs = result.attributes;
  assert.ok(
    attrs.find(
      (a) => a.trait_type === "proof_uri" && a.value === "https://proof.example.com/proof.json",
    ),
  );
  assert.ok(attrs.find((a) => a.trait_type === "final_state_hash" && a.value === "0xdeadbeef"));
});

test("buildEnemyLootMetadata omits optional fields when not provided", () => {
  const result = buildEnemyLootMetadata({
    ...BASE_PARAMS,
    clear_count: 1,
  });

  const traitTypes = result.attributes.map((a) => a.trait_type);
  assert.ok(!traitTypes.includes("proof_uri"));
  assert.ok(!traitTypes.includes("final_state_hash"));
});

test("buildEnemyLootMetadata allows custom image override", () => {
  const result = buildEnemyLootMetadata({
    ...BASE_PARAMS,
    clear_count: 2,
    image: "https://custom.example.com/nft.png",
  });

  assert.equal(result.image, "https://custom.example.com/nft.png");
});

// ──────────────────────────────────────────
// buildBossParticipationMetadata
// ──────────────────────────────────────────

test("buildBossParticipationMetadata returns required attributes including damage", () => {
  const result = buildBossParticipationMetadata({
    ...BASE_PARAMS,
    location_id: "boss-final",
    damage: 1500,
  });

  assert.equal(result.name, "Test NFT");
  assert.equal(result.symbol, "BPD");
  assert.equal(
    result.image,
    "https://backpack-dungeon.example.com/assets/boss-participation.png",
  );

  const attrs = result.attributes;
  assert.ok(attrs.find((a) => a.trait_type === "day_id" && a.value === "2026-04-26"));
  assert.ok(attrs.find((a) => a.trait_type === "location_id" && a.value === "boss-final"));
  assert.ok(attrs.find((a) => a.trait_type === "reward_tier" && a.value === "Rare"));
  assert.ok(attrs.find((a) => a.trait_type === "player" && a.value === BASE_PARAMS.player));
  assert.ok(attrs.find((a) => a.trait_type === "damage" && a.value === 1500));
  assert.ok(attrs.find((a) => a.trait_type === "ruleset_hash" && a.value === "abc123def456"));
});

test("buildBossParticipationMetadata includes optional fields when provided", () => {
  const result = buildBossParticipationMetadata({
    ...BASE_PARAMS,
    location_id: "boss-final",
    damage: 999,
    proof_uri: "https://proof.example.com/boss-proof.json",
    final_state_hash: "0xcafebabe",
  });

  const attrs = result.attributes;
  assert.ok(
    attrs.find(
      (a) =>
        a.trait_type === "proof_uri" && a.value === "https://proof.example.com/boss-proof.json",
    ),
  );
  assert.ok(attrs.find((a) => a.trait_type === "final_state_hash" && a.value === "0xcafebabe"));
});

test("buildBossParticipationMetadata omits optional fields when not provided", () => {
  const result = buildBossParticipationMetadata({
    ...BASE_PARAMS,
    location_id: "boss-final",
    damage: 500,
  });

  const traitTypes = result.attributes.map((a) => a.trait_type);
  assert.ok(!traitTypes.includes("proof_uri"));
  assert.ok(!traitTypes.includes("final_state_hash"));
});

// ──────────────────────────────────────────
// buildDailyRewardMetadata
// ──────────────────────────────────────────

test("buildDailyRewardMetadata returns required attributes including claim_condition", () => {
  const result = buildDailyRewardMetadata({
    ...BASE_PARAMS,
    location_id: "daily-reward-1",
    claim_condition: "Complete the daily dungeon",
  });

  assert.equal(result.name, "Test NFT");
  assert.equal(result.symbol, "BPD");
  assert.equal(
    result.image,
    "https://backpack-dungeon.example.com/assets/daily-reward.png",
  );

  const attrs = result.attributes;
  assert.ok(attrs.find((a) => a.trait_type === "day_id" && a.value === "2026-04-26"));
  assert.ok(attrs.find((a) => a.trait_type === "location_id" && a.value === "daily-reward-1"));
  assert.ok(attrs.find((a) => a.trait_type === "reward_tier" && a.value === "Rare"));
  assert.ok(attrs.find((a) => a.trait_type === "player" && a.value === BASE_PARAMS.player));
  assert.ok(
    attrs.find(
      (a) => a.trait_type === "claim_condition" && a.value === "Complete the daily dungeon",
    ),
  );
  assert.ok(attrs.find((a) => a.trait_type === "ruleset_hash" && a.value === "abc123def456"));
});

test("buildDailyRewardMetadata includes optional fields when provided", () => {
  const result = buildDailyRewardMetadata({
    ...BASE_PARAMS,
    location_id: "daily-reward-2",
    claim_condition: "Defeat the boss",
    proof_uri: "https://proof.example.com/daily-proof.json",
    final_state_hash: "0xdecafbad",
  });

  const attrs = result.attributes;
  assert.ok(
    attrs.find(
      (a) =>
        a.trait_type === "proof_uri" && a.value === "https://proof.example.com/daily-proof.json",
    ),
  );
  assert.ok(attrs.find((a) => a.trait_type === "final_state_hash" && a.value === "0xdecafbad"));
});

test("buildDailyRewardMetadata omits optional fields when not provided", () => {
  const result = buildDailyRewardMetadata({
    ...BASE_PARAMS,
    location_id: "daily-reward-3",
    claim_condition: "Reach the treasure room",
  });

  const traitTypes = result.attributes.map((a) => a.trait_type);
  assert.ok(!traitTypes.includes("proof_uri"));
  assert.ok(!traitTypes.includes("final_state_hash"));
});

// ──────────────────────────────────────────
// Cross-type consistency
// ──────────────────────────────────────────

test("all NFT metadata builders return the same base shape", () => {
  const enemy = buildEnemyLootMetadata({ ...BASE_PARAMS, clear_count: 1 });
  const boss = buildBossParticipationMetadata({ ...BASE_PARAMS, location_id: "boss", damage: 100 });
  const daily = buildDailyRewardMetadata({
    ...BASE_PARAMS,
    location_id: "reward",
    claim_condition: "Play daily",
  });

  for (const meta of [enemy, boss, daily]) {
    assert.equal(meta.symbol, "BPD");
    assert.equal(typeof meta.name, "string");
    assert.equal(typeof meta.description, "string");
    assert.equal(typeof meta.image, "string");
    assert.ok(Array.isArray(meta.attributes));
    assert.ok(meta.attributes.length >= 6);
  }
});

test("each builder produces distinct attribute sets reflecting its type", () => {
  const enemy = buildEnemyLootMetadata({ ...BASE_PARAMS, clear_count: 7 });
  const boss = buildBossParticipationMetadata({ ...BASE_PARAMS, location_id: "boss", damage: 2500 });
  const daily = buildDailyRewardMetadata({
    ...BASE_PARAMS,
    location_id: "reward",
    claim_condition: "Complete daily run",
  });

  const enemyTraits = enemy.attributes.map((a) => a.trait_type);
  const bossTraits = boss.attributes.map((a) => a.trait_type);
  const dailyTraits = daily.attributes.map((a) => a.trait_type);

  // Enemy has clear_count but not damage or claim_condition
  assert.ok(enemyTraits.includes("clear_count"));
  assert.ok(!enemyTraits.includes("damage"));
  assert.ok(!enemyTraits.includes("claim_condition"));

  // Boss has damage but not clear_count or claim_condition
  assert.ok(bossTraits.includes("damage"));
  assert.ok(!bossTraits.includes("clear_count"));
  assert.ok(!bossTraits.includes("claim_condition"));

  // Daily has claim_condition but not clear_count or damage
  assert.ok(dailyTraits.includes("claim_condition"));
  assert.ok(!dailyTraits.includes("clear_count"));
  assert.ok(!dailyTraits.includes("damage"));
});
