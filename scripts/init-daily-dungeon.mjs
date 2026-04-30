#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Backpack Dungeon — Daily Dungeon Initialization Script
//
// This script is called by start.sh after deploying the Anchor program to
// localnet. It:
//   1. Generates today's deterministic daily map (using @backpack-dungeon/game-core)
//   2. Builds the Merkle tree and extracts the root hash
//   3. Calls init_daily_dungeon on the deployed program via Anchor
//
// Usage:
//   node scripts/init-daily-dungeon.mjs
//
// Environment:
//   ANCHOR_WALLET          — path to the deployer keypair (default: ~/.config/solana/id.json)
//   ANCHOR_PROVIDER_URL    — Solana RPC URL (default: http://127.0.0.1:8899)
//   PACKRUN_DAY_ID         — optional YYYY-MM-DD override
//   PACKRUN_RANDOM_SEED    — optional numeric random seed for map generation
// ──────────────────────────────────────────────────────────────────────────────

import anchor from "@coral-xyz/anchor";
import solanaWeb3 from "@solana/web3.js";
import {
  buildLocationMerkleTree,
  createDailyMapInput,
  generateDailyMap,
  parseDailyMapRandomSeed,
  todayDayId,
} from "@backpack-dungeon/game-core";
import idl from "../target/idl/packrun.json" with { type: "json" };

const { AnchorProvider, Program, BN } = anchor;
const { PublicKey, SystemProgram } = solanaWeb3;

// ── Constants ────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey("Hj9xusyzfxP8ic9U6rmpGcY4pPGFBJQqm7BUJ4w475jU");

const DAY_ID = process.env.PACKRUN_DAY_ID ?? todayDayId();
const RANDOM_SEED = parseDailyMapRandomSeed(process.env.PACKRUN_RANDOM_SEED);

const MAP_INPUT = Object.freeze(createDailyMapInput({
  dayId: DAY_ID,
  randomSeed: RANDOM_SEED,
}));

// PDA seed constants (must match programs/packrun/src/lib.rs)
const DAILY_DUNGEON_SEED = Buffer.from("dungeon");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a hex string (64 hex chars) to a Uint8Array of 32 bytes. */
function hexToBytes32(hex) {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertExistingDungeonMatchesMap(dungeon, expectedRoot) {
  const onChainRoot = bytesToHex(dungeon.mapRoot);
  const mismatches = [];

  if (onChainRoot !== expectedRoot) {
    mismatches.push(`mapRoot on-chain=${onChainRoot} local=${expectedRoot}`);
  }
  if (dungeon.width !== MAP_INPUT.width || dungeon.height !== MAP_INPUT.height) {
    mismatches.push(
      `dimensions on-chain=${dungeon.width}x${dungeon.height} local=${MAP_INPUT.width}x${MAP_INPUT.height}`,
    );
  }

  if (mismatches.length > 0) {
    throw new Error(
      [
        `DailyDungeon for ${DAY_ID} already exists, but it was initialized with different map data.`,
        ...mismatches,
        `Current local config: PACKRUN_DAY_ID=${DAY_ID}, PACKRUN_RANDOM_SEED=${RANDOM_SEED}.`,
        "Use the same PACKRUN_RANDOM_SEED/PACKRUN_DAY_ID as the existing account, or reset the local validator/ledger before reinitializing this day.",
      ].join("\n"),
    );
  }
}

/** Derive a PDA for the daily dungeon account. */
function dailyDungeonPda(dayId) {
  return PublicKey.findProgramAddressSync(
    [DAILY_DUNGEON_SEED, Buffer.from(dayId)],
    PROGRAM_ID,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[INIT] Generating daily map for dayId: ${DAY_ID} with seed ${RANDOM_SEED}...`);

  // 1. Generate deterministic daily map
  const dailyMap = generateDailyMap(MAP_INPUT);
  console.log(`[INIT] Map generated: ${dailyMap.locations.length} locations`);

  // 2. Build Merkle tree and extract root hash
  const merkleTree = buildLocationMerkleTree(dailyMap.locations);
  const mapRoot = Array.from(hexToBytes32(merkleTree.root));
  console.log(`[INIT] Merkle root: ${merkleTree.root}`);

  // 3. Connect to localnet via Anchor provider
  console.log("[INIT] Connecting to localnet validator...");
  // Default to localnet RPC if ANCHOR_PROVIDER_URL is not set
  if (!process.env.ANCHOR_PROVIDER_URL) {
    process.env.ANCHOR_PROVIDER_URL = "http://127.0.0.1:8899";
  }
  const provider = AnchorProvider.env();
  const wallet = provider.wallet;
  const program = new Program(idl, provider);

  console.log(`[INIT] Deployer authority: ${wallet.publicKey.toBase58()}`);

  // 4. Derive the daily dungeon PDA
  const [dungeonPda] = dailyDungeonPda(DAY_ID);
  console.log(`[INIT] DailyDungeon PDA: ${dungeonPda.toBase58()}`);

  // 5. Check if already initialized
  const existing = await program.account.dailyDungeon.fetchNullable(dungeonPda);
  if (existing) {
    assertExistingDungeonMatchesMap(existing, merkleTree.root);
    console.log(
      `[INIT] DailyDungeon for ${DAY_ID} already initialized with matching map root, skipping.`,
    );
    return;
  }

  // 6. Prepare time window (1 hour ago → 24 hours from now)
  const now = Math.floor(Date.now() / 1000);
  const startTs = new BN(now - 3600); // 1 hour ago
  const endTs = new BN(now + 86400);  // 24 hours from now

  // Placeholder ruleset hash (32 zero bytes)
  const rulesetHash = new Uint8Array(32).fill(0);

  console.log("[INIT] Calling initDailyDungeon on-chain...");

  // 7. Send the transaction
  const txSig = await program.methods
    .initDailyDungeon(
      DAY_ID,
      mapRoot,
      Array.from(rulesetHash),
      MAP_INPUT.width,
      MAP_INPUT.height,
      startTs,
      endTs,
      new BN(10_000), // boss_hp
      16,              // boss_shard_count
    )
    .accounts({
      authority: wallet.publicKey,
      dailyDungeon: dungeonPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`[INIT] Transaction confirmed: ${txSig}`);

  // 8. Verify on-chain state
  const dungeon = await program.account.dailyDungeon.fetch(dungeonPda);
  console.log(`[INIT] Verified on-chain:`);
  console.log(`       dayId:         ${dungeon.dayId}`);
  console.log(`       status:        ${dungeon.status.open ? "open" : "closed"}`);
  console.log(`       dimensions:    ${dungeon.width}x${dungeon.height}`);
  console.log(`       locations:     ${dungeon.locationCount}`);
  console.log(`       enemies:       ${dungeon.enemyCount}`);
  console.log(`       bossHp:        ${dungeon.bossHp.toString()}`);
  console.log(`       bossShards:    ${dungeon.bossShardCount}`);
  console.log(`       startTs:       ${dungeon.startTs.toString()}`);
  console.log(`       endTs:         ${dungeon.endTs.toString()}`);

  console.log("[INIT] Daily dungeon initialization complete!");
}

main().catch((err) => {
  console.error("[INIT] Failed:", err);
  process.exit(1);
});
