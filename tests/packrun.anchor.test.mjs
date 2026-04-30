// ──────────────────────────────────────────────────────────────────────────────
// Backpack Dungeon — Anchor Localnet Integration Tests
//
// These tests call real Anchor instructions on localnet and assert on-chain
// state changes. They require a running localnet validator with the program
// deployed (NO_DNA=1 anchor test).
//
// Flow:
//   1. init_daily_dungeon  — initialize a daily dungeon with deterministic map
//   2. enter_dungeon       — player enters the dungeon
//   3. init_location_from_merkle — init an enemy POI from Merkle proof
//   4. clear_enemy         — clear the enemy location
//   5. Fetch accounts & assert state changes
// ──────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import anchor from "@coral-xyz/anchor";
import solanaWeb3 from "@solana/web3.js";

const { AnchorProvider, Program, BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram } = solanaWeb3;
import {
  generateDailyMap,
  buildLocationMerkleTree,
  getLocationProof,
} from "@backpack-dungeon/game-core";
import { LocationKind } from "@backpack-dungeon/shared";
import idl from "../target/idl/packrun.json" with { type: "json" };

// ── Constants ─────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey("Hj9xusyzfxP8ic9U6rmpGcY4pPGFBJQqm7BUJ4w475jU");

const RANDOM_SEED = 20_260_425;
const DAY_ID = process.env.PACKRUN_TEST_DAY_ID ?? `test-${Date.now().toString(36).slice(-8)}`;

const BASE_INPUT = Object.freeze({
  bossCount: 2,
  dayId: DAY_ID,
  enemyCount: 12,
  height: 20,
  poiDensity: 0.06,
  randomSeed: RANDOM_SEED,
  shopCount: 4,
  treasureCount: 6,
  width: 30,
});

// PDA seed constants (must match programs/packrun/src/lib.rs)
const DAILY_DUNGEON_SEED = Buffer.from("dungeon");
const LOCATION_SEED = Buffer.from("location");
const ENEMY_LOCATION_SEED = Buffer.from("enemy");
const PLAYER_RUN_SEED = Buffer.from("run");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a hex string (64 hex chars) to a Uint8Array of 32 bytes. */
function hexToBytes32(hex) {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Compute SHA-256 hash of a string, return as Uint8Array (32 bytes). */
function sha256Bytes32(input) {
  return new Uint8Array(createHash("sha256").update(input, "utf-8").digest());
}

/** Derive a PDA for the daily dungeon account. */
function dailyDungeonPda(dayId) {
  return PublicKey.findProgramAddressSync(
    [DAILY_DUNGEON_SEED, Buffer.from(dayId)],
    PROGRAM_ID
  );
}

/** Derive a PDA for a location account. */
function locationPda(dayId, poiIdHash) {
  return PublicKey.findProgramAddressSync(
    [LOCATION_SEED, Buffer.from(dayId), Buffer.from(poiIdHash)],
    PROGRAM_ID
  );
}

/** Derive a PDA for an enemy location account. */
function enemyLocationPda(dayId, poiIdHash) {
  return PublicKey.findProgramAddressSync(
    [ENEMY_LOCATION_SEED, Buffer.from(dayId), Buffer.from(poiIdHash)],
    PROGRAM_ID
  );
}

/** Derive a PDA for a player run account. */
function playerRunPda(dayId, player) {
  return PublicKey.findProgramAddressSync(
    [PLAYER_RUN_SEED, Buffer.from(dayId), player.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Convert a TS LocationProofStep (sibling: hex string, position: "left"|"right")
 * to the Anchor LocationMerkleProofStep format.
 */
function toAnchorProofStep(step) {
  return {
    sibling: Array.from(hexToBytes32(step.sibling)),
    position: step.position === "left" ? { left: {} } : { right: {} },
  };
}

/**
 * Convert a TS DailyLocationSpec (camelCase) to the Anchor LocationSpecInput
 * (snake_case) format, matching the IDL type definition.
 */
function toAnchorLocationSpec(spec, dayId) {
  const poiIdHash = Array.from(sha256Bytes32(spec.id));

  const result = {
    dayId,
    poiId: spec.id,
    poiIdHash,
    kind: { [spec.kind.toLowerCase()]: {} },
    x: spec.position.x,
    y: spec.position.y,
    baseConfigHash: Array.from(hexToBytes32(spec.baseConfigHash)),
    enemy: null,
    shop: null,
    boss: null,
    rewardTier: null,
    eventId: null,
  };

  if (spec.enemy) {
    result.enemy = {
      id: spec.enemy.id,
      name: spec.enemy.name,
      level: spec.enemy.level,
      maxHealth: spec.enemy.maxHealth,
      attack: spec.enemy.attack,
      rewardTier: { [spec.enemy.rewardTier.toLowerCase()]: {} },
    };
  }

  if (spec.shop) {
    result.shop = {
      id: spec.shop.id,
      keeperName: spec.shop.keeperName ?? null,
      itemSlots: spec.shop.itemSlots.map((slot) => ({
        slotId: slot.slotId,
        itemId: slot.itemId,
        price: new BN(slot.price),
        baseStock: slot.stock,
        maxStock: slot.stock,
        restockIntervalSeconds: new BN(300),
        maxRestockCount: 0,
        perWalletDailyLimit: 5,
        rewardTier: { [slot.rewardTier.toLowerCase()]: {} },
      })),
    };
  }

  if (spec.boss) {
    result.boss = {
      id: spec.boss.id,
      name: spec.boss.name,
      level: spec.boss.level,
      maxHealth: spec.boss.maxHealth,
      attack: spec.boss.attack,
      rewardTier: { [spec.boss.rewardTier.toLowerCase()]: {} },
    };
  }

  if (spec.rewardTier) {
    result.rewardTier = { [spec.rewardTier.toLowerCase()]: {} };
  }

  if (spec.eventId) {
    result.eventId = spec.eventId;
  }

  return result;
}

function assertAnchorEnumVariant(value, variant) {
  assert.deepEqual(value?.[variant], {});
}

// ── Setup ─────────────────────────────────────────────────────────────────────

// Use the default Anchor provider (reads wallet from Anchor.toml config)
// Default to localnet RPC if ANCHOR_PROVIDER_URL is not set
if (!process.env.ANCHOR_PROVIDER_URL) {
  process.env.ANCHOR_PROVIDER_URL = "http://127.0.0.1:8899";
}
const provider = AnchorProvider.env();
const wallet = provider.wallet;
const program = new Program(idl, provider);

// Generate deterministic daily map once for all tests
const dailyMap = generateDailyMap(BASE_INPUT);
const merkleTree = buildLocationMerkleTree(dailyMap.locations);
const mapRoot = Array.from(hexToBytes32(merkleTree.root));

// Find an enemy location for testing
const enemyLoc = dailyMap.locations.find(
  (l) => l.kind === LocationKind.Enemy && l.enemy
);

// ── Tests ─────────────────────────────────────────────────────────────────────

test("anchor: init daily dungeon", async () => {
  const [dungeonPda] = dailyDungeonPda(DAY_ID);

  const startTs = new BN(0);
  const endTs = new BN(4_102_444_800); // 2100-01-01

  // ruleset_hash: placeholder bytes32 for the ruleset
  const rulesetHash = new Uint8Array(32).fill(0);

  await program.methods
    .initDailyDungeon(
      DAY_ID,
      Array.from(mapRoot),
      Array.from(rulesetHash),
      BASE_INPUT.width,
      BASE_INPUT.height,
      startTs,
      endTs,
      new BN(10_000),  // boss_hp
      16,               // boss_shard_count
    )
    .accounts({
      authority: wallet.publicKey,
      dailyDungeon: dungeonPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  // Fetch and verify the dungeon account
  const dungeon = await program.account.dailyDungeon.fetch(dungeonPda);
  assert.equal(dungeon.dayId, DAY_ID);
  assertAnchorEnumVariant(dungeon.status, "open");
  assert.equal(dungeon.width, BASE_INPUT.width);
  assert.equal(dungeon.height, BASE_INPUT.height);
  assert.equal(dungeon.locationCount, 0);
  assert.equal(dungeon.enemyCount, 0);
  assert.equal(dungeon.bossHp.toString(), "10000");
  assert.equal(dungeon.bossShardCount, 16);
});

test("anchor: enter dungeon", async () => {
  const [dungeonPda] = dailyDungeonPda(DAY_ID);
  const [runPda] = playerRunPda(DAY_ID, wallet.publicKey);

  await program.methods
    .enterDungeon(DAY_ID)
    .accounts({
      player: wallet.publicKey,
      dailyDungeon: dungeonPda,
      playerRun: runPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  // Fetch and verify the player run account
  const run = await program.account.playerRun.fetch(runPda);
  assert.equal(run.dayId, DAY_ID);
  assert.equal(run.player.equals(wallet.publicKey), true);
  assert.equal(run.energy, 100);  // DEFAULT_PLAYER_RUN_ENERGY
  assert.equal(run.active, true);
  assert.equal(run.clearedLocations, 0);
});

test("anchor: init location from merkle (enemy)", async () => {
  assert.ok(enemyLoc, "No enemy location found in generated map");
  const [dungeonPda] = dailyDungeonPda(DAY_ID);

  const proof = getLocationProof(dailyMap.locations, enemyLoc.id);
  const anchorProof = proof.map(toAnchorProofStep);
  const anchorSpec = toAnchorLocationSpec(enemyLoc, DAY_ID);

  const poiIdHash = Array.from(sha256Bytes32(enemyLoc.id));
  const [locationPdaKey] = locationPda(DAY_ID, poiIdHash);
  const [enemyPdaKey] = enemyLocationPda(DAY_ID, poiIdHash);

  await program.methods
    .initLocationFromMerkle(anchorSpec, anchorProof)
    .accounts({
      authority: wallet.publicKey,
      dailyDungeon: dungeonPda,
      locationAccount: locationPdaKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .initEnemyDetail(DAY_ID, enemyLoc.id, poiIdHash, anchorSpec)
    .accounts({
      authority: wallet.publicKey,
      dailyDungeon: dungeonPda,
      locationAccount: locationPdaKey,
      enemyLocation: enemyPdaKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  // Fetch and verify the location account
  const location = await program.account.locationAccount.fetch(locationPdaKey);
  assert.equal(location.dayId, DAY_ID);
  assert.equal(location.poiId, enemyLoc.id);
  assertAnchorEnumVariant(location.kind, "enemy");
  assertAnchorEnumVariant(location.status, "available");
  assert.equal(location.x, enemyLoc.position.x);
  assert.equal(location.y, enemyLoc.position.y);

  // Fetch and verify the enemy location account
  const enemy = await program.account.enemyLocation.fetch(enemyPdaKey);
  assert.equal(enemy.dayId, DAY_ID);
  assert.equal(enemy.poiId, enemyLoc.id);
  assert.equal(enemy.enemyId, enemyLoc.enemy.id);
  assert.equal(enemy.level, enemyLoc.enemy.level);
  assert.equal(enemy.baseHp, enemyLoc.enemy.maxHealth);
  assert.equal(enemy.baseDamage, enemyLoc.enemy.attack);
  assert.equal(enemy.clearCount.toString(), "0");
});

test("anchor: clear enemy", async () => {
  assert.ok(enemyLoc, "No enemy location found in generated map");

  const [dungeonPda] = dailyDungeonPda(DAY_ID);
  const [runPda] = playerRunPda(DAY_ID, wallet.publicKey);

  const poiIdHash = Array.from(sha256Bytes32(enemyLoc.id));
  const [locationPdaKey] = locationPda(DAY_ID, poiIdHash);
  const [enemyPdaKey] = enemyLocationPda(DAY_ID, poiIdHash);

  // Dummy battle result hash (32 zero bytes)
  const battleResultHash = new Uint8Array(32).fill(0);

  // Player performance summary
  const performanceSummary = {
    damageDealt: 50,
    damageTaken: 10,
    turnsTaken: 5,
    score: 100,
    flawless: false,
  };

  // No proof URI hash
  const proofUriHash = null;

  await program.methods
    .clearEnemy(
      Array.from(battleResultHash),
      performanceSummary,
      proofUriHash,
    )
    .accounts({
      player: wallet.publicKey,
      dailyDungeon: dungeonPda,
      playerRun: runPda,
      locationAccount: locationPdaKey,
      enemyLocation: enemyPdaKey,
    })
    .rpc();

  // ── Assertions ──────────────────────────────────────────────────────────

  // 1. Player run: energy decreased, cleared_locations incremented
  const run = await program.account.playerRun.fetch(runPda);
  assert.ok(run.energy < 100, `Expected energy < 100, got ${run.energy}`);
  assert.equal(run.clearedLocations, 1);

  // 2. Enemy location: clear_count incremented, next_available_at set
  const enemy = await program.account.enemyLocation.fetch(enemyPdaKey);
  assert.equal(enemy.clearCount.toString(), "1");
  assert.ok(
    enemy.nextAvailableAt.toNumber() > 0,
    `Expected next_available_at > 0, got ${enemy.nextAvailableAt}`
  );

  // 3. Location account remains available; cooldown is tracked on EnemyLocation
  const location = await program.account.locationAccount.fetch(locationPdaKey);
  assertAnchorEnumVariant(location.status, "available");

  // 4. Daily dungeon: initialized account counters remain unchanged by clearing
  const dungeon = await program.account.dailyDungeon.fetch(dungeonPda);
  assert.equal(dungeon.locationCount, 1);
  assert.equal(dungeon.enemyCount, 1);
});
