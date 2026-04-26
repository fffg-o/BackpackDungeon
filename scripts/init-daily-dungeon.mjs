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
// ──────────────────────────────────────────────────────────────────────────────

import anchor from "@coral-xyz/anchor";
import solanaWeb3 from "@solana/web3.js";
import { generateDailyMap, buildLocationMerkleTree } from "@backpack-dungeon/game-core";
import idl from "../target/idl/packrun.json" with { type: "json" };

const { AnchorProvider, Program, BN } = anchor;
const { PublicKey, SystemProgram } = solanaWeb3;

// ── Constants ────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey("Hj9xusyzfxP8ic9U6rmpGcY4pPGFBJQqm7BUJ4w475jU");
const MASTER_SEED = "packrun-master";

// Get today's date in YYYY-MM-DD format (UTC)
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

/** Derive a PDA for the daily dungeon account. */
function dailyDungeonPda(dayId) {
  return PublicKey.findProgramAddressSync(
    [DAILY_DUNGEON_SEED, Buffer.from(dayId)],
    PROGRAM_ID,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[INIT] Generating daily map for dayId: ${DAY_ID}...`);

  // 1. Generate deterministic daily map
  const dailyMap = generateDailyMap(BASE_INPUT);
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
  try {
    const existing = await program.account.dailyDungeon.fetch(dungeonPda);
    if (existing && existing.dayId === DAY_ID) {
      console.log(
        `[INIT] DailyDungeon for ${DAY_ID} already initialized, skipping.`,
      );
      return;
    }
  } catch {
    // Account not found — proceed to initialize
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
      BASE_INPUT.width,
      BASE_INPUT.height,
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
