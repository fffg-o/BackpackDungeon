import { hashCanonicalJson } from "@backpack-dungeon/shared";
import { randomRange } from "./rng.js";

export enum BossParticipationTier {
  None = "None",
  Bronze = "Bronze",
  Silver = "Silver",
  Gold = "Gold",
  Mvp = "Mvp"
}

export interface BossBattleResult {
  readonly baseDamage?: number;
  readonly bonusDamage?: number;
  readonly blockedDamage?: number;
  readonly damageDealt?: number;
  readonly multiplierBps?: number;
}

export interface BossPlayerContribution {
  readonly playerPubkey: string;
  readonly damage: number;
}

export interface BossShardState {
  readonly shardIndex: number;
  readonly damage?: number;
  readonly totalDamage?: number;
  readonly contributions?: readonly BossPlayerContribution[];
}

export function getBossShardIndex(playerPubkey: string, shardCount: number): number {
  if (typeof playerPubkey !== "string" || playerPubkey.length === 0) {
    throw new TypeError("playerPubkey must be a non-empty string.");
  }
  assertPositiveInteger(shardCount, "shardCount");

  const seed = hashCanonicalJson({
    domain: "boss-shard-index",
    playerPubkey,
    shardCount,
    version: 1
  });

  return randomRange(seed, 0, 0, shardCount - 1);
}

export function computeBossDamage(battleResult: BossBattleResult): number {
  const rawDamage = assertNonNegativeInteger(
    battleResult.damageDealt ?? battleResult.baseDamage ?? 0,
    "damage"
  );
  const bonusDamage = assertNonNegativeInteger(
    battleResult.bonusDamage ?? 0,
    "bonusDamage"
  );
  const blockedDamage = assertNonNegativeInteger(
    battleResult.blockedDamage ?? 0,
    "blockedDamage"
  );
  const multiplierBps = assertNonNegativeInteger(
    battleResult.multiplierBps ?? 10_000,
    "multiplierBps"
  );
  const damageBeforeMultiplier = Math.max(0, rawDamage + bonusDamage - blockedDamage);

  return Math.floor((damageBeforeMultiplier * multiplierBps) / 10_000);
}

export function aggregateBossDamage(shards: readonly BossShardState[]): number {
  return shards.reduce((total, shard) => total + computeShardDamage(shard), 0);
}

export function isBossDefeated(totalDamage: number, bossHp: number): boolean {
  assertNonNegativeInteger(totalDamage, "totalDamage");
  assertPositiveInteger(bossHp, "bossHp");

  return totalDamage >= bossHp;
}

export function computeBossParticipationTier(
  playerDamage: number,
  totalDamage: number
): BossParticipationTier {
  assertNonNegativeInteger(playerDamage, "playerDamage");
  assertNonNegativeInteger(totalDamage, "totalDamage");

  if (playerDamage === 0 || totalDamage === 0) {
    return BossParticipationTier.None;
  }

  const shareBps = Math.floor((playerDamage * 10_000) / totalDamage);

  if (shareBps >= 2_500) {
    return BossParticipationTier.Mvp;
  }

  if (shareBps >= 1_000) {
    return BossParticipationTier.Gold;
  }

  if (shareBps >= 500) {
    return BossParticipationTier.Silver;
  }

  return BossParticipationTier.Bronze;
}

function computeShardDamage(shard: BossShardState): number {
  assertNonNegativeInteger(shard.shardIndex, "shardIndex");

  if (shard.totalDamage !== undefined) {
    return assertNonNegativeInteger(shard.totalDamage, "totalDamage");
  }

  if (shard.damage !== undefined) {
    return assertNonNegativeInteger(shard.damage, "damage");
  }

  return (shard.contributions ?? []).reduce((total, contribution) => {
    if (typeof contribution.playerPubkey !== "string" || contribution.playerPubkey.length === 0) {
      throw new TypeError("playerPubkey must be a non-empty string.");
    }

    return total + assertNonNegativeInteger(contribution.damage, "contribution.damage");
  }, 0);
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }

  return value;
}

function assertNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }

  return value;
}
