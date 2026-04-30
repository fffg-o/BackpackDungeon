import { RewardTier } from "@backpack-dungeon/shared";
import type {
  CanonicalJsonValue,
  EnemyConfig,
  LocationSpec
} from "@backpack-dungeon/shared";
import { deriveSeed, randomRange, type SeedSource } from "./rng.js";

export interface EnemyScalingConfig extends EnemyConfig {
  readonly baseCooldownSeconds?: number;
  readonly baseRewardTier?: RewardTier;
  readonly maxRewardTier?: RewardTier;
  readonly valuableClearCap?: number;
}

export interface EnemyStats {
  readonly level: number;
  readonly maxHealth: number;
  readonly attack: number;
}

export interface EnemyRewardPlayerPerformance {
  readonly damageTaken?: number;
  readonly flawless?: boolean;
  readonly score?: number;
  readonly turnsTaken?: number;
}

export interface EnemyReward {
  readonly amount: number;
  readonly clearCount: number;
  readonly cooldownSeconds: number;
  readonly enemyId: string;
  readonly id: string;
  readonly itemId: string;
  readonly tier: RewardTier;
}

export type EnemyRewardSpec =
  | EnemyScalingConfig
  | (LocationSpec & { readonly enemy: EnemyScalingConfig });

export const DEFAULT_ENEMY_BASE_COOLDOWN_SECONDS = 60;
export const DEFAULT_VALUABLE_CLEAR_CAP = 5;

const REWARD_TIER_ORDER = Object.freeze([
  RewardTier.Common,
  RewardTier.Uncommon,
  RewardTier.Rare,
  RewardTier.Epic,
  RewardTier.Legendary
] as const);

const REWARD_AMOUNT_RANGES: Record<RewardTier, { readonly min: number; readonly max: number }> = {
  [RewardTier.Common]: { min: 8, max: 14 },
  [RewardTier.Uncommon]: { min: 16, max: 28 },
  [RewardTier.Rare]: { min: 32, max: 54 },
  [RewardTier.Epic]: { min: 64, max: 100 },
  [RewardTier.Legendary]: { min: 120, max: 180 }
};

export function computeEnemyStats(
  baseEnemy: EnemyScalingConfig,
  clearCount: number
): EnemyStats {
  const clears = assertClearCount(clearCount);
  const hpMultiplier = 1 + clears * 0.18 + Math.floor(clears / 5) * 0.12;
  const attackMultiplier = 1 + clears * 0.12 + Math.floor(clears / 5) * 0.08;

  return {
    attack: Math.max(baseEnemy.attack + clears, Math.ceil(baseEnemy.attack * attackMultiplier)),
    level: baseEnemy.level + Math.floor(clears / 2),
    maxHealth: Math.max(
      baseEnemy.maxHealth + clears,
      Math.ceil(baseEnemy.maxHealth * hpMultiplier)
    )
  };
}

export function computeEnemyCooldown(
  baseEnemy: EnemyScalingConfig,
  clearCount: number
): number {
  const clears = assertClearCount(clearCount);
  const baseCooldown = assertPositiveInteger(
    baseEnemy.baseCooldownSeconds ?? DEFAULT_ENEMY_BASE_COOLDOWN_SECONDS,
    "baseCooldownSeconds"
  );

  return Math.ceil(baseCooldown * (1 + clears * 0.05));
}

export function computeEnemyRewardTier(
  baseEnemy: EnemyScalingConfig,
  clearCount: number
): RewardTier {
  const clears = assertClearCount(clearCount);
  const valuableClearCap = getValuableClearCap(baseEnemy);

  if (clears >= valuableClearCap) {
    return RewardTier.Common;
  }

  const maxRewardIndex = tierIndex(baseEnemy.maxRewardTier ?? baseEnemy.rewardTier);
  const baseRewardIndex = Math.min(
    tierIndex(baseEnemy.baseRewardTier ?? RewardTier.Common),
    maxRewardIndex
  );
  const rewardDistance = maxRewardIndex - baseRewardIndex;

  if (rewardDistance <= 0 || clears === 0) {
    return REWARD_TIER_ORDER[baseRewardIndex];
  }

  const progressWindow = Math.max(1, valuableClearCap - 1);
  const boostedSteps = Math.max(1, Math.ceil((clears * rewardDistance) / progressWindow));
  const rewardIndex = Math.min(maxRewardIndex, baseRewardIndex + boostedSteps);

  return REWARD_TIER_ORDER[rewardIndex];
}

export function computeEnemyReward(
  seed: SeedSource,
  enemySpec: EnemyRewardSpec,
  clearCount: number,
  playerPerformance: EnemyRewardPlayerPerformance = {}
): EnemyReward {
  const baseEnemy = getEnemyConfig(enemySpec);
  const clears = assertClearCount(clearCount);
  const tier = computeEnemyRewardTier(baseEnemy, clears);
  const rewardSeed = deriveSeed(
    seed,
    "enemy-reward",
    getEnemySpecId(enemySpec),
    baseEnemy.id,
    clears,
    performanceToCanonicalValue(playerPerformance)
  );
  const amountRange = REWARD_AMOUNT_RANGES[tier];
  const baseAmount = randomRange(rewardSeed, 0, amountRange.min, amountRange.max);
  const performanceBonus = computePerformanceBonus(playerPerformance);
  const rewardHash = deriveSeed(rewardSeed, "enemy-reward-id", tier, baseAmount, performanceBonus);
  const tierSlug = tier.toLowerCase();

  return {
    amount: baseAmount + performanceBonus,
    clearCount: clears,
    cooldownSeconds: computeEnemyCooldown(baseEnemy, clears),
    enemyId: baseEnemy.id,
    id: `reward-${baseEnemy.id}-${clears}-${rewardHash.slice(0, 12)}`,
    itemId: `${tierSlug}-enemy-drop-${rewardHash.slice(12, 24)}`,
    tier
  };
}

function getEnemyConfig(enemySpec: EnemyRewardSpec): EnemyScalingConfig {
  if ("enemy" in enemySpec) {
    return enemySpec.enemy;
  }

  return enemySpec;
}

function getEnemySpecId(enemySpec: EnemyRewardSpec): string {
  if ("enemy" in enemySpec) {
    return enemySpec.id;
  }

  return enemySpec.id;
}

function getValuableClearCap(baseEnemy: EnemyScalingConfig): number {
  return assertNonNegativeInteger(
    baseEnemy.valuableClearCap ?? DEFAULT_VALUABLE_CLEAR_CAP,
    "valuableClearCap"
  );
}

function computePerformanceBonus(playerPerformance: EnemyRewardPlayerPerformance): number {
  const scoreBonus = Math.floor(Math.max(0, playerPerformance.score ?? 0) / 1_000);
  const flawlessBonus = playerPerformance.flawless ? 3 : 0;
  const speedBonus =
    playerPerformance.turnsTaken === undefined
      ? 0
      : Math.max(0, 5 - Math.floor(Math.max(0, playerPerformance.turnsTaken) / 5));
  const damagePenalty =
    playerPerformance.damageTaken === undefined
      ? 0
      : Math.floor(Math.max(0, playerPerformance.damageTaken) / 20);

  return Math.max(0, Math.min(12, scoreBonus + flawlessBonus + speedBonus - damagePenalty));
}

function performanceToCanonicalValue(
  playerPerformance: EnemyRewardPlayerPerformance
): CanonicalJsonValue {
  return {
    damageTaken: playerPerformance.damageTaken,
    flawless: playerPerformance.flawless,
    score: playerPerformance.score,
    turnsTaken: playerPerformance.turnsTaken
  };
}

function tierIndex(tier: RewardTier): number {
  const index = REWARD_TIER_ORDER.indexOf(tier);
  if (index === -1) {
    throw new RangeError(`Unknown reward tier: ${tier}`);
  }

  return index;
}

function assertClearCount(value: number): number {
  return assertNonNegativeInteger(value, "clearCount");
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
