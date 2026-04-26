#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Backpack Dungeon — Crank: Initialize All Location PDAs from Merkle Tree
//
// This script is called by start.sh after init-daily-dungeon.mjs. It:
//   1. Generates today's deterministic map (same as init-daily-dungeon.mjs)
//   2. Builds the Merkle tree
//   3. Iterates all POIs from the generated map
//   4. Skips POIs whose LocationAccount PDA already exists on-chain
//   5. Calls initLocationFromMerkle for each missing POI
//
// Usage:
//   node scripts/init-all-locations.mjs
//
// Environment:
//   ANCHOR_WALLET          — path to the deployer keypair (default: ~/.config/solana/id.json)
//   ANCHOR_PROVIDER_URL    — Solana RPC URL (default: http://127.0.0.1:8899)
// ──────────────────────────────────────────────────────────────────────────────

import anchor from "@coral-xyz/anchor";
import solanaWeb3 from "@solana/web3.js";
import { generateDailyMap, buildLocationMerkleTree, getLocationProof } from "@backpack-dungeon/game-core";
import { LocationKind } from "@backpack-dungeon/shared";
import { createHash } from "node:crypto";
import idl from "../target/idl/packrun.json" with { type: "json" };

const { AnchorProvider, Program, BN } = anchor;
const { PublicKey, SystemProgram } = solanaWeb3;

// ── Constants ────────────────────────────────────────────────────────────────
// Must match scripts/init-daily-dungeon.mjs and programs/packrun/src/lib.rs

const PROGRAM_ID = new PublicKey("Hj9xusyzfxP8ic9U6rmpGcY4pPGFBJQqm7BUJ4w475jU");
const MASTER_SEED = "packrun-master";

const TODAY = new Date();
const DAY_ID = TODAY.toISOString().slice(0, 10);

const BASE_INPUT = Object.freeze({
  bossCount: 2,
  dayId: DAY_ID,
  enemyCount: 12,
  height: 20,
  masterSeed: MASTER_SEED,
  poiDensity: 0.06,
  shopCount: 4,
  treasureCount: 6,
  width: 30,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a 64-char hex string to a Uint8Array of 32 bytes. */
function hexToBytes32(hex) {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** SHA-256 hash as raw 32-byte Uint8Array (Node.js built-in crypto). */
function sha256Bytes32(input) {
  return createHash("sha256").update(input).digest();
}

/** Convert a string like "Boss" → { boss: {} } for Anchor enums. */
function anchorEnum(value) {
  return { [value.toLowerCase()]: {} };
}

// ── PDA helpers (mirrors apps/web/lib/solana/pdas.ts) ─────────────────────────

function dailyDungeonPda(dayId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("dungeon"), Buffer.from(dayId)],
    PROGRAM_ID,
  );
}

function locationPda(dayId, poiIdHash) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("location"), Buffer.from(dayId), Buffer.from(poiIdHash)],
    PROGRAM_ID,
  );
}

function enemyLocationPda(dayId, poiIdHash) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("enemy"), Buffer.from(dayId), Buffer.from(poiIdHash)],
    PROGRAM_ID,
  );
}

function shopPda(dayId, poiIdHash) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("shop"), Buffer.from(dayId), Buffer.from(poiIdHash)],
    PROGRAM_ID,
  );
}

function bossLocationPda(dayId, poiIdHash) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("boss"), Buffer.from(dayId), Buffer.from(poiIdHash)],
    PROGRAM_ID,
  );
}

// ── Anchor-compatible serialisers (mirrors apps/web/lib/solana/converters.ts) ──

function toAnchorLocationSpec(spec, dayId) {
  return {
    dayId,
    poiId: spec.id,
    poiIdHash: Array.from(sha256Bytes32(spec.id)),
    kind: anchorEnum(spec.kind),
    x: spec.position.x,
    y: spec.position.y,
    baseConfigHash: Array.from(hexToBytes32(spec.baseConfigHash)),
    enemy: spec.enemy
      ? {
          id: spec.enemy.id,
          name: spec.enemy.name,
          level: spec.enemy.level,
          maxHealth: spec.enemy.maxHealth,
          attack: spec.enemy.attack,
          rewardTier: anchorEnum(spec.enemy.rewardTier),
        }
      : null,
    shop: spec.shop
      ? {
          id: spec.shop.id,
          keeperName: spec.shop.keeperName ?? null,
          itemSlots: spec.shop.itemSlots.map(toAnchorShopSlot),
        }
      : null,
    boss: spec.boss
      ? {
          id: spec.boss.id,
          name: spec.boss.name,
          level: spec.boss.level,
          maxHealth: spec.boss.maxHealth,
          attack: spec.boss.attack,
          rewardTier: anchorEnum(spec.boss.rewardTier),
        }
      : null,
    rewardTier: spec.rewardTier ? anchorEnum(spec.rewardTier) : null,
    eventId: spec.eventId ?? null,
  };
}

function toAnchorShopSlot(slot) {
  return {
    slotId: slot.slotId,
    itemId: slot.itemId,
    price: new BN(slot.price),
    baseStock: slot.stock,
    maxStock: slot.stock,
    restockIntervalSeconds: new BN(300),
    maxRestockCount: 0,
    perWalletDailyLimit: 5,
    rewardTier: anchorEnum(slot.rewardTier),
  };
}

function toAnchorProofStep(step) {
  return {
    sibling: Array.from(hexToBytes32(step.sibling)),
    position: anchorEnum(step.position),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[CRANK] Initialising all locations for dayId: ${DAY_ID}...`);

  // 1. Generate deterministic daily map (same input as init-daily-dungeon.mjs)
  const dailyMap = generateDailyMap(BASE_INPUT);
  console.log(`[CRANK] Map generated: ${dailyMap.locations.length} locations`);

  // 2. Build Merkle tree (we only need it to verify the root)
  const merkleTree = buildLocationMerkleTree(dailyMap.locations);
  console.log(`[CRANK] Merkle root: ${merkleTree.root}`);

  // 3. Connect to localnet via Anchor provider
  console.log("[CRANK] Connecting to localnet validator...");
  // Default to localnet RPC if ANCHOR_PROVIDER_URL is not set
  if (!process.env.ANCHOR_PROVIDER_URL) {
    process.env.ANCHOR_PROVIDER_URL = "http://127.0.0.1:8899";
  }
  const provider = AnchorProvider.env();
  const wallet = provider.wallet;
  const program = new Program(idl, provider);

  console.log(`[CRANK] Crank authority: ${wallet.publicKey.toBase58()}`);

  // 4. Derive the daily dungeon PDA and verify it exists
  const [dungeonPda] = dailyDungeonPda(DAY_ID);
  const dungeon = await program.account.dailyDungeon.fetchNullable(dungeonPda);
  if (!dungeon) {
    throw new Error(
      `DailyDungeon for ${DAY_ID} not found at ${dungeonPda.toBase58()}. ` +
        "Run scripts/init-daily-dungeon.mjs first.",
    );
  }
  console.log(`[CRANK] DailyDungeon: ${dungeonPda.toBase58()}`);

  // 5. Iterate all POIs, skip already-initialised accounts, init missing ones
  const locations = dailyMap.locations;
  let initialized = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < locations.length; i++) {
    const spec = locations[i];
    const poiIdHash = sha256Bytes32(spec.id);
    const [locationAddress] = locationPda(DAY_ID, poiIdHash);

    // Check if this LocationAccount PDA already exists on-chain
    const existing = await program.account.locationAccount.fetchNullable(locationAddress);
    if (existing) {
      console.log(
        `[CRANK] [${i + 1}/${locations.length}] SKIP ${spec.id} ` +
          `(${spec.kind}) — already initialized`,
      );
      skipped++;
      continue;
    }

    console.log(
      `[CRANK] [${i + 1}/${locations.length}] INIT ${spec.id} ` +
        `(${spec.kind}) at (${spec.position.x}, ${spec.position.y})...`,
    );

    try {
      // Get the Merkle proof for this POI
      const proof = getLocationProof(locations, spec.id);

      // Build Anchor-compatible inputs
      const anchorSpec = toAnchorLocationSpec(spec, DAY_ID);
      const anchorProof = proof.map(toAnchorProofStep);

      // 1. Create the LocationAccount (no detail sub-accounts — they are
      //    created in separate instructions to work around an Anchor v0.32.1
      //    bug where Option<Account> with init uses SystemProgram for PDA
      //    derivation instead of the correct program ID).
      const txSig = await program.methods
        .initLocationFromMerkle(anchorSpec, anchorProof)
        .accounts({
          authority: wallet.publicKey,
          dailyDungeon: dungeonPda,
          locationAccount: locationAddress,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`[CRANK]   ✅ LocationAccount created: ${txSig}`);

      // 2. Create the detail sub-account depending on location kind.
      //    We pass day_id, poi_id, poi_id_hash as separate instruction args
      //    (these are used in the #[instruction] attribute for seed derivation)
      //    and the full anchorSpec as an additional data-only arg.
      if (spec.kind === LocationKind.Enemy) {
        const [, enemyPda] = enemyLocationPda(DAY_ID, poiIdHash);
        const detailTx = await program.methods
          .initEnemyDetail(DAY_ID, spec.id, Array.from(poiIdHash), anchorSpec)
          .accounts({
            authority: wallet.publicKey,
            dailyDungeon: dungeonPda,
            locationAccount: locationAddress,
            enemyLocation: enemyPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log(`[CRANK]   ✅ EnemyLocation created: ${detailTx}`);
      } else if (spec.kind === LocationKind.Shop) {
        const [, shopPdaAddr] = shopPda(DAY_ID, poiIdHash);
        const detailTx = await program.methods
          .initShopDetail(DAY_ID, spec.id, Array.from(poiIdHash), anchorSpec)
          .accounts({
            authority: wallet.publicKey,
            dailyDungeon: dungeonPda,
            locationAccount: locationAddress,
            shopAccount: shopPdaAddr,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log(`[CRANK]   ✅ ShopAccount created: ${detailTx}`);
      } else if (spec.kind === LocationKind.Boss) {
        const [, bossPdaAddr] = bossLocationPda(DAY_ID, poiIdHash);
        const detailTx = await program.methods
          .initBossDetail(DAY_ID, spec.id, Array.from(poiIdHash), anchorSpec)
          .accounts({
            authority: wallet.publicKey,
            dailyDungeon: dungeonPda,
            locationAccount: locationAddress,
            bossLocation: bossPdaAddr,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log(`[CRANK]   ✅ BossLocation created: ${detailTx}`);
      }

      initialized++;
    } catch (error) {
      console.error(`[CRANK]   ❌ Error: ${error.message}`);
      errors++;
    }
  }

  // 6. Summary
  const total = locations.length;
  console.log(`\n${"═".repeat(56)}`);
  console.log(`  CRANK SUMMARY for ${DAY_ID}`);
  console.log(`${"═".repeat(56)}`);
  console.log(`  Total POIs:      ${total}`);
  console.log(`  Initialized:     ${initialized}`);
  console.log(`  Skipped (exist): ${skipped}`);
  console.log(`  Errors:          ${errors}`);
  if (initialized + skipped + errors === total) {
    console.log(`  Status:          ✅ All locations accounted for`);
  } else {
    console.log(`  Status:          ⚠️  Mismatch (unexpected)`);
  }
  console.log(`${"═".repeat(56)}`);

  if (errors > 0) {
    console.warn(`\n[CRANK] ${errors} location(s) failed — check logs above.`);
    // Exit with code 0 so start.sh doesn't abort; crank can be re-run.
  }
}

main().catch((err) => {
  console.error("[CRANK] Fatal:", err);
  process.exit(1);
});
