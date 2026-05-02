import type { DailyLocationSpec, LocationProofStep } from "@backpack-dungeon/game-core";
import { LocationKind } from "@backpack-dungeon/shared";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import type { PackrunProgram } from "./anchorClient";
import {
  toAnchorLocationSpec,
  toAnchorProofStep,
  toAnchorShopSlot,
} from "./converters";
import {
  bossLocationPda,
  bossNftClaimPda,
  bossShardIndexForPlayer,
  bossShardPda,
  dailyDungeonPda,
  dailyRewardClaimPda,
  enemyLocationPda,
  locationPda,
  playerBossContributionPda,
  playerRunPda,
  sha256Bytes32,
  shopItemSlotPda,
  shopPda,
} from "./pdas";
import type { IntegerLike } from "./shopMath";
import { toBigInt } from "./shopMath";

export interface BattleResultInput {
  readonly version?: 1;
  readonly inputHash?: string;
  readonly resultHash?: string;
  readonly proofHash?: string;
  readonly encounterKind?: "enemy" | "boss";
  readonly won: boolean;
  readonly turnsTaken: number;
  readonly playerDamageDealt?: number;
  readonly enemyDamageDealt?: number;
  readonly damageTaken: number;
  readonly playerHpRemaining?: number;
  readonly enemyHpRemaining?: number;
  readonly flawless: boolean;
  readonly score?: number;
  readonly bossDamageScore?: number;
  readonly log?: readonly BattleLogEntryInput[];
}

export interface BattleLogEntryInput {
  readonly attacker?: "player" | "enemy";
  readonly actor?: "player" | "enemy";
  readonly damage: number;
}

export async function enterDungeon(
  program: PackrunProgram,
  dayId: string,
  player: PublicKey,
): Promise<string> {
  const [dailyDungeon] = dailyDungeonPda(dayId);
  const [playerRun] = playerRunPda(dayId, player);

  return program.methods
    .enterDungeon(dayId)
    .accounts({
      player,
      dailyDungeon,
      playerRun,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function initLocationFromMerkle(
  program: PackrunProgram,
  dayId: string,
  spec: DailyLocationSpec,
  proof: readonly LocationProofStep[],
  authority: PublicKey,
): Promise<string> {
  const poiIdHash = sha256Bytes32(spec.id);
  const poiIdHashArg = Array.from(poiIdHash);
  const anchorSpec = toAnchorLocationSpec(spec, dayId);
  const [dailyDungeon] = dailyDungeonPda(dayId);
  const [locationAccount] = locationPda(dayId, poiIdHash);
  const [enemyLocation] = enemyLocationPda(dayId, poiIdHash);
  const [shopAccount] = shopPda(dayId, poiIdHash);
  const [bossLocation] = bossLocationPda(dayId, poiIdHash);
  let signature: string | null = null;

  const existingLocation = await program.account.locationAccount.fetchNullable(locationAccount);
  if (!existingLocation) {
    signature = await program.methods
      .initLocationFromMerkle(anchorSpec, proof.map(toAnchorProofStep))
      .accounts({
        authority,
        dailyDungeon,
        locationAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  if (spec.kind === LocationKind.Enemy) {
    const existingEnemy = await program.account.enemyLocation.fetchNullable(enemyLocation);
    if (!existingEnemy) {
      signature = await program.methods
        .initEnemyDetail(dayId, spec.id, poiIdHashArg, anchorSpec)
        .accounts({
          authority,
          dailyDungeon,
          locationAccount,
          enemyLocation,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  } else if (spec.kind === LocationKind.Shop) {
    const existingShop = await program.account.shopAccount.fetchNullable(shopAccount);
    if (!existingShop) {
      signature = await program.methods
        .initShopDetail(dayId, spec.id, poiIdHashArg, anchorSpec)
        .accounts({
          authority,
          dailyDungeon,
          locationAccount,
          shopAccount,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  } else if (spec.kind === LocationKind.Boss) {
    const existingBoss = await program.account.bossLocation.fetchNullable(bossLocation);
    if (!existingBoss) {
      signature = await program.methods
        .initBossDetail(dayId, spec.id, poiIdHashArg, anchorSpec)
        .accounts({
          authority,
          dailyDungeon,
          locationAccount,
          bossLocation,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  }

  if (!signature) {
    throw new Error("Selected location is already initialized.");
  }

  return signature;
}

export async function initShopItemSlot(
  program: PackrunProgram,
  dayId: string,
  spec: DailyLocationSpec,
  slotIndex: number,
  payer: PublicKey,
): Promise<string> {
  if (!spec.shop) {
    throw new Error("Selected location is not a shop.");
  }

  const slot = spec.shop.itemSlots[slotIndex];
  if (!slot) {
    throw new RangeError("Shop slot index is out of range.");
  }

  const poiIdHash = sha256Bytes32(spec.id);
  const [dailyDungeon] = dailyDungeonPda(dayId);
  const [locationAccount] = locationPda(dayId, poiIdHash);
  const [shopAccount] = shopPda(dayId, poiIdHash);
  const [shopItemSlot] = shopItemSlotPda(dayId, poiIdHash, slotIndex);

  return program.methods
    .initShopItemSlot(
      dayId,
      spec.id,
      Array.from(poiIdHash),
      slotIndex,
      toAnchorShopSlot(slot),
    )
    .accounts({
      dailyDungeon,
      locationAccount,
      shopAccount,
      shopItemSlot,
      payer,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function initBossDamageShard(
  program: PackrunProgram,
  dayId: string,
  spec: DailyLocationSpec,
  shardIndex: number,
  payer: PublicKey,
): Promise<string> {
  if (!spec.boss) {
    throw new Error("Selected location is not a boss.");
  }

  const poiIdHash = sha256Bytes32(spec.id);
  const [dailyDungeon] = dailyDungeonPda(dayId);
  const [locationAccount] = locationPda(dayId, poiIdHash);
  const [bossLocation] = bossLocationPda(dayId, poiIdHash);
  const [bossDamageShard] = bossShardPda(dayId, shardIndex);

  return program.methods
    .initBossDamageShard(dayId, Array.from(poiIdHash), shardIndex)
    .accounts({
      dailyDungeon,
      locationAccount,
      bossLocation,
      bossDamageShard,
      payer,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function clearEnemy(
  program: PackrunProgram,
  dayId: string,
  spec: DailyLocationSpec,
  player: PublicKey,
  battleResult: BattleResultInput,
  proofHashOverride?: string,
): Promise<string> {
  const poiIdHash = sha256Bytes32(spec.id);
  const [dailyDungeon] = dailyDungeonPda(dayId);
  const [playerRun] = playerRunPda(dayId, player);
  const [locationAccount] = locationPda(dayId, poiIdHash);
  const [enemyLocation] = enemyLocationPda(dayId, poiIdHash);

  return program.methods
    .clearEnemy(
      battleResultHash("enemy-clear", battleResult),
      toPlayerPerformanceSummary(battleResult),
      maybeHex32ToNumberArray(proofHashOverride ?? battleResult.proofHash),
    )
    .accounts({
      player,
      dailyDungeon,
      playerRun,
      locationAccount,
      enemyLocation,
    })
    .rpc();
}

export async function buyItem(
  program: PackrunProgram,
  dayId: string,
  spec: DailyLocationSpec,
  slotIndex: number,
  expectedPrice: IntegerLike,
  player: PublicKey,
): Promise<string> {
  const poiIdHash = sha256Bytes32(spec.id);
  const [dailyDungeon] = dailyDungeonPda(dayId);
  const [playerRun] = playerRunPda(dayId, player);
  const [locationAccount] = locationPda(dayId, poiIdHash);
  const [shopAccount] = shopPda(dayId, poiIdHash);
  const [shopItemSlot] = shopItemSlotPda(dayId, poiIdHash, slotIndex);

  return program.methods
    .buyItem(slotIndex, bigintToBn(toBigInt(expectedPrice)))
    .accounts({
      player,
      dailyDungeon,
      playerRun,
      locationAccount,
      shopAccount,
      shopItemSlot,
    })
    .rpc();
}

export async function submitBossDamage(
  program: PackrunProgram,
  dayId: string,
  spec: DailyLocationSpec,
  player: PublicKey,
  damage: IntegerLike,
  battleResult: BattleResultInput,
  bossShardCount: number,
  proofHashOverride?: string,
): Promise<string> {
  const poiIdHash = sha256Bytes32(spec.id);
  const shardIndex = bossShardIndexForPlayer(player, bossShardCount);
  const [dailyDungeon] = dailyDungeonPda(dayId);
  const [playerRun] = playerRunPda(dayId, player);
  const [locationAccount] = locationPda(dayId, poiIdHash);
  const [bossLocation] = bossLocationPda(dayId, poiIdHash);
  const [bossDamageShard] = bossShardPda(dayId, shardIndex);
  const [playerBossContribution] = playerBossContributionPda(dayId, player);

  return program.methods
    .submitBossDamage(
      bigintToBn(toBigInt(damage)),
      battleResultHash("boss-damage", battleResult),
      shardIndex,
      maybeHex32ToNumberArray(proofHashOverride ?? battleResult.proofHash),
    )
    .accounts({
      player,
      dailyDungeon,
      playerRun,
      locationAccount,
      bossLocation,
      bossDamageShard,
      playerBossContribution,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function claimBossParticipationNft(
  program: PackrunProgram,
  dayId: string,
  spec: DailyLocationSpec,
  player: PublicKey,
): Promise<string> {
  const poiIdHash = sha256Bytes32(spec.id);
  const [dailyDungeon] = dailyDungeonPda(dayId);
  const [locationAccount] = locationPda(dayId, poiIdHash);
  const [bossLocation] = bossLocationPda(dayId, poiIdHash);
  const [playerBossContribution] = playerBossContributionPda(dayId, player);
  const [bossNftClaim] = bossNftClaimPda(dayId, player);

  const contribution = await program.account.playerBossContribution.fetch(playerBossContribution);
  const [bossDamageShard] = bossShardPda(dayId, contribution.shardIndex);

  return program.methods
    .claimBossParticipationNft()
    .accounts({
      player,
      dailyDungeon,
      bossLocation,
      locationAccount,
      playerBossContribution,
      bossDamageShard,
      bossNftClaim,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function claimDailyReward(
  program: PackrunProgram,
  dayId: string,
  player: PublicKey,
  poiIdHash: Uint8Array,
): Promise<string> {
  const [dailyDungeon] = dailyDungeonPda(dayId);
  const [playerRun] = playerRunPda(dayId, player);
  const [locationAccount] = locationPda(dayId, poiIdHash);
  const [dailyRewardClaim] = dailyRewardClaimPda(dayId, player, poiIdHash);

  return program.methods
    .claimDailyReward()
    .accounts({
      player,
      dailyDungeon,
      playerRun,
      locationAccount,
      dailyRewardClaim,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

function toPlayerPerformanceSummary(result: BattleResultInput): Record<string, unknown> {
  const damageDealt =
    result.playerDamageDealt ?? computePlayerDamageDealtFromLog(result.log) ?? 0;
  const score = Math.max(
    0,
    damageDealt + (result.won ? 100 : 0) + (result.flawless ? 50 : 0) - result.damageTaken,
  );

  return {
    damageDealt,
    damageTaken: result.damageTaken,
    turnsTaken: result.turnsTaken,
    score: result.score ?? score,
    flawless: result.flawless,
  };
}

function battleResultHash(domain: string, result: BattleResultInput): readonly number[] {
  return result.resultHash !== undefined
    ? hex32ToNumberArray(result.resultHash)
    : legacyBattleHash(domain, result);
}

function legacyBattleHash(domain: string, result: BattleResultInput): readonly number[] {
  return Array.from(
    sha256Bytes32(
      JSON.stringify({
        domain,
        won: result.won,
        turnsTaken: result.turnsTaken,
        damageTaken: result.damageTaken,
        flawless: result.flawless,
        damageDealt: result.playerDamageDealt ?? computePlayerDamageDealtFromLog(result.log),
      }),
    ),
  );
}

export function hex32ToNumberArray(hex: string): readonly number[] {
  const normalized = normalizeHex32(hex);
  const bytes: number[] = [];

  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }

  return bytes;
}

export function maybeHex32ToNumberArray(hex?: string): readonly number[] | null {
  return hex === undefined ? null : hex32ToNumberArray(hex);
}

function normalizeHex32(hex: string): string {
  if (typeof hex !== "string") {
    throw new TypeError("hex must be a string.");
  }

  const trimmed = hex.trim();
  const withoutPrefix =
    trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;

  if (!/^[0-9a-fA-F]{64}$/.test(withoutPrefix)) {
    throw new RangeError("hex must be a 32-byte hex string with 64 hex characters.");
  }

  return withoutPrefix;
}

function computePlayerDamageDealtFromLog(
  log?: readonly BattleLogEntryInput[],
): number | undefined {
  return log
    ?.filter((entry) => getBattleLogActor(entry) === "player")
    .reduce((total, entry) => total + entry.damage, 0);
}

function getBattleLogActor(entry: BattleLogEntryInput): "player" | "enemy" | null {
  return entry.actor ?? entry.attacker ?? null;
}

function bigintToBn(value: bigint): BN {
  return new BN(value.toString());
}
