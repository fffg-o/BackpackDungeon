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
  readonly won: boolean;
  readonly turnsTaken: number;
  readonly damageTaken: number;
  readonly flawless: boolean;
  readonly log?: readonly {
    readonly attacker: "player" | "enemy";
    readonly damage: number;
  }[];
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
  const [dailyDungeon] = dailyDungeonPda(dayId);
  const [locationAccount] = locationPda(dayId, poiIdHash);
  const [enemyLocation] = enemyLocationPda(dayId, poiIdHash);
  const [shopAccount] = shopPda(dayId, poiIdHash);
  const [bossLocation] = bossLocationPda(dayId, poiIdHash);

  return program.methods
    .initLocationFromMerkle(
      toAnchorLocationSpec(spec, dayId),
      proof.map(toAnchorProofStep),
    )
    .accounts({
      authority,
      dailyDungeon,
      locationAccount,
      enemyLocation: spec.kind === LocationKind.Enemy ? enemyLocation : null,
      shopAccount: spec.kind === LocationKind.Shop ? shopAccount : null,
      bossLocation: spec.kind === LocationKind.Boss ? bossLocation : null,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
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
): Promise<string> {
  const poiIdHash = sha256Bytes32(spec.id);
  const [dailyDungeon] = dailyDungeonPda(dayId);
  const [playerRun] = playerRunPda(dayId, player);
  const [locationAccount] = locationPda(dayId, poiIdHash);
  const [enemyLocation] = enemyLocationPda(dayId, poiIdHash);

  return program.methods
    .clearEnemy(
      battleHash("enemy-clear", battleResult),
      toPlayerPerformanceSummary(battleResult),
      null,
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
      battleHash("boss-damage", battleResult),
      shardIndex,
      null,
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
): Promise<string> {
  const [dailyDungeon] = dailyDungeonPda(dayId);
  const [playerRun] = playerRunPda(dayId, player);
  const [dailyRewardClaim] = dailyRewardClaimPda(dayId, player);

  return program.methods
    .claimDailyReward()
    .accounts({
      player,
      dailyDungeon,
      playerRun,
      dailyRewardClaim,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

function toPlayerPerformanceSummary(result: BattleResultInput): Record<string, unknown> {
  const damageDealt =
    result.log?.reduce(
      (total, entry) => (entry.attacker === "player" ? total + entry.damage : total),
      0,
    ) ?? 0;
  const score = Math.max(
    0,
    damageDealt + (result.won ? 100 : 0) + (result.flawless ? 50 : 0) - result.damageTaken,
  );

  return {
    damageDealt,
    damageTaken: result.damageTaken,
    turnsTaken: result.turnsTaken,
    score,
    flawless: result.flawless,
  };
}

function battleHash(domain: string, result: BattleResultInput): readonly number[] {
  return Array.from(
    sha256Bytes32(
      JSON.stringify({
        domain,
        won: result.won,
        turnsTaken: result.turnsTaken,
        damageTaken: result.damageTaken,
        flawless: result.flawless,
        damageDealt: result.log
          ?.filter((entry) => entry.attacker === "player")
          .reduce((total, entry) => total + entry.damage, 0),
      }),
    ),
  );
}

function bigintToBn(value: bigint): BN {
  return new BN(value.toString());
}
