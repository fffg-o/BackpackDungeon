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
  bossCount: 1,
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
const SHOP_SEED = Buffer.from("shop");
const SHOP_ITEM_SLOT_SEED = Buffer.from("shop_slot");
const DAILY_REWARD_CLAIM_SEED = Buffer.from("daily_claim");
const DEFAULT_STARTING_GOLD = 100;
const DEFAULT_ENEMY_CLEAR_GOLD_REWARD = 10;
const DEFAULT_TREASURE_GOLD_REWARD = 25;

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

/** Derive a PDA for a shop detail account. */
function shopPda(dayId, poiIdHash) {
  return PublicKey.findProgramAddressSync(
    [SHOP_SEED, Buffer.from(dayId), Buffer.from(poiIdHash)],
    PROGRAM_ID
  );
}

/** Derive a PDA for a shop item slot account. */
function shopItemSlotPda(dayId, poiIdHash, slotIndex) {
  const slotIndexBytes = Buffer.alloc(2);
  slotIndexBytes.writeUInt16LE(slotIndex);
  return PublicKey.findProgramAddressSync(
    [SHOP_ITEM_SLOT_SEED, Buffer.from(dayId), Buffer.from(poiIdHash), slotIndexBytes],
    PROGRAM_ID
  );
}

/** Derive a PDA for a daily reward claim account. */
function dailyRewardClaimPda(dayId, player, poiIdHash) {
  return PublicKey.findProgramAddressSync(
    [DAILY_REWARD_CLAIM_SEED, Buffer.from(dayId), player.toBuffer(), Buffer.from(poiIdHash)],
    PROGRAM_ID
  );
}

function currentShopPrice(slotAccount) {
  const openedAt = BigInt(slotAccount.openedAt.toString());
  const interval = BigInt(slotAccount.restockIntervalSeconds.toString());
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const restockEpoch = interval <= 0n || now < openedAt ? 0n : (now - openedAt) / interval;
  const basePrice = BigInt(slotAccount.basePrice.toString());
  const soldCount = BigInt(slotAccount.soldCount.toString());
  const multiplierBps = 10_000n + restockEpoch * 1_200n + soldCount * 400n;
  return (basePrice * multiplierBps + 9_999n) / 10_000n;
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
        perWalletDailyLimit: Math.min(5, Math.max(1, slot.stock)),
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

function anchorErrorText(error) {
  return [
    error?.message,
    error?.error?.errorCode?.code,
    error?.error?.errorMessage,
    ...(error?.logs ?? []),
  ].filter(Boolean).join("\n");
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
const shopLoc = dailyMap.locations.find(
  (l) => l.kind === LocationKind.Shop && l.shop?.itemSlots.length
);
const treasureLoc = dailyMap.locations.find(
  (l) => l.kind === LocationKind.Treasure
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
  assert.equal(run.goldBalance.toString(), String(DEFAULT_STARTING_GOLD));
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
  assert.equal(enemy.difficultyLevel, enemyLoc.enemy.level);
  assert.equal(enemy.clearCount.toString(), "0");
  assert.equal(enemy.baseCooldownSeconds.toNumber(), 60);
  assert.equal(enemy.nextAvailableAt.toNumber(), 0);
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

  const beforeClearUnix = Math.floor(Date.now() / 1_000);

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
  assert.equal(run.energy, 95);
  assert.equal(run.clearedLocations, 1);
  assert.equal(run.commonLootCount, 1);

  // 2. Enemy location: clear_count incremented, difficulty increased, cooldown set
  const enemy = await program.account.enemyLocation.fetch(enemyPdaKey);
  assert.equal(enemy.clearCount.toString(), "1");
  assert.ok(
    enemy.difficultyLevel > enemyLoc.enemy.level,
    `Expected difficulty_level > ${enemyLoc.enemy.level}, got ${enemy.difficultyLevel}`
  );
  assert.ok(
    enemy.nextAvailableAt.toNumber() > beforeClearUnix,
    `Expected next_available_at > ${beforeClearUnix}, got ${enemy.nextAvailableAt}`
  );
  const expectedGoldAfterClear =
    DEFAULT_STARTING_GOLD + DEFAULT_ENEMY_CLEAR_GOLD_REWARD + enemy.difficultyLevel;
  assert.equal(run.goldBalance.toString(), String(expectedGoldAfterClear));

  // 3. Immediate second clear is blocked by EnemyLocation cooldown
  await assert.rejects(
    () => program.methods
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
      .rpc(),
    (error) => {
      assert.match(anchorErrorText(error), /EnemyOnCooldown|enemy is still on cooldown/i);
      return true;
    }
  );

  // 4. Location account remains available; cooldown is tracked on EnemyLocation
  const location = await program.account.locationAccount.fetch(locationPdaKey);
  assertAnchorEnumVariant(location.status, "available");

  // 5. Daily dungeon: initialized account counters remain unchanged by clearing
  const dungeon = await program.account.dailyDungeon.fetch(dungeonPda);
  assert.equal(dungeon.locationCount, 1);
  assert.equal(dungeon.enemyCount, 1);
});

test("anchor: buy item spends on-chain gold", async () => {
  assert.ok(shopLoc, "No shop location found in generated map");

  const [dungeonPda] = dailyDungeonPda(DAY_ID);
  const [runPda] = playerRunPda(DAY_ID, wallet.publicKey);

  const poiIdHash = Array.from(sha256Bytes32(shopLoc.id));
  const [locationPdaKey] = locationPda(DAY_ID, poiIdHash);
  const [shopPdaKey] = shopPda(DAY_ID, poiIdHash);
  const [slotPdaKey] = shopItemSlotPda(DAY_ID, poiIdHash, 0);

  const proof = getLocationProof(dailyMap.locations, shopLoc.id);
  const anchorProof = proof.map(toAnchorProofStep);
  const anchorSpec = toAnchorLocationSpec(shopLoc, DAY_ID);

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
    .initShopDetail(DAY_ID, shopLoc.id, poiIdHash, anchorSpec)
    .accounts({
      authority: wallet.publicKey,
      dailyDungeon: dungeonPda,
      locationAccount: locationPdaKey,
      shopAccount: shopPdaKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const slotInput = {
    ...anchorSpec.shop.itemSlots[0],
    price: new BN(30),
  };

  await program.methods
    .initShopItemSlot(DAY_ID, shopLoc.id, poiIdHash, 0, slotInput)
    .accounts({
      dailyDungeon: dungeonPda,
      locationAccount: locationPdaKey,
      shopAccount: shopPdaKey,
      shopItemSlot: slotPdaKey,
      payer: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const runBefore = await program.account.playerRun.fetch(runPda);
  const slotBefore = await program.account.shopItemSlotAccount.fetch(slotPdaKey);
  const expectedPrice = currentShopPrice(slotBefore);

  await program.methods
    .buyItem(0, new BN(expectedPrice.toString()))
    .accounts({
      player: wallet.publicKey,
      dailyDungeon: dungeonPda,
      playerRun: runPda,
      locationAccount: locationPdaKey,
      shopAccount: shopPdaKey,
      shopItemSlot: slotPdaKey,
    })
    .rpc();

  const runAfter = await program.account.playerRun.fetch(runPda);
  const slotAfter = await program.account.shopItemSlotAccount.fetch(slotPdaKey);
  assert.equal(
    runAfter.goldBalance.toString(),
    (BigInt(runBefore.goldBalance.toString()) - expectedPrice).toString(),
  );
  assert.equal(runAfter.itemsPurchased, runBefore.itemsPurchased + 1);
  assert.equal(slotAfter.soldCount.toString(), "1");
});

test("anchor: claim daily reward adds gold once", async () => {
  assert.ok(treasureLoc, "No treasure location found in generated map");

  const [dungeonPda] = dailyDungeonPda(DAY_ID);
  const [runPda] = playerRunPda(DAY_ID, wallet.publicKey);

  const poiIdHash = Array.from(sha256Bytes32(treasureLoc.id));
  const [locationPdaKey] = locationPda(DAY_ID, poiIdHash);
  const [claimPdaKey] = dailyRewardClaimPda(DAY_ID, wallet.publicKey, poiIdHash);

  const proof = getLocationProof(dailyMap.locations, treasureLoc.id);
  const anchorProof = proof.map(toAnchorProofStep);
  const anchorSpec = toAnchorLocationSpec(treasureLoc, DAY_ID);

  await program.methods
    .initLocationFromMerkle(anchorSpec, anchorProof)
    .accounts({
      authority: wallet.publicKey,
      dailyDungeon: dungeonPda,
      locationAccount: locationPdaKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const runBefore = await program.account.playerRun.fetch(runPda);

  await program.methods
    .claimDailyReward()
    .accounts({
      player: wallet.publicKey,
      dailyDungeon: dungeonPda,
      playerRun: runPda,
      locationAccount: locationPdaKey,
      dailyRewardClaim: claimPdaKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const runAfter = await program.account.playerRun.fetch(runPda);
  assert.equal(
    runAfter.goldBalance.toString(),
    (BigInt(runBefore.goldBalance.toString()) + BigInt(DEFAULT_TREASURE_GOLD_REWARD)).toString(),
  );

  await assert.rejects(
    () => program.methods
      .claimDailyReward()
      .accounts({
        player: wallet.publicKey,
        dailyDungeon: dungeonPda,
        playerRun: runPda,
        locationAccount: locationPdaKey,
        dailyRewardClaim: claimPdaKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc(),
    (error) => {
      assert.match(anchorErrorText(error), /DailyRewardAlreadyClaimed|already claimed/i);
      return true;
    }
  );

  const runAfterRejectedClaim = await program.account.playerRun.fetch(runPda);
  assert.equal(runAfterRejectedClaim.goldBalance.toString(), runAfter.goldBalance.toString());
});
