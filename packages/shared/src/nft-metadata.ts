import type { DayId, NftMetadataBase, RewardTier } from "./index.js";

// ──────────────────────────────────────────
// Attribute helpers
// ──────────────────────────────────────────

export interface NftAttribute {
  readonly trait_type: string;
  readonly value: string | number | boolean;
}

function attr(trait_type: string, value: string | number | boolean): NftAttribute {
  return { trait_type, value };
}

// ──────────────────────────────────────────
// Common metadata fields
// ──────────────────────────────────────────

export interface NftMetadataParams {
  readonly name: string;
  readonly description: string;
  readonly image?: string;
  readonly day_id: DayId;
  readonly location_id: string;
  readonly reward_tier: RewardTier;
  readonly player: string;
  readonly ruleset_hash: string;
  readonly proof_uri?: string;
  readonly final_state_hash?: string;
}

// ──────────────────────────────────────────
// Enemy loot metadata
// ──────────────────────────────────────────

export interface EnemyLootMetadataParams extends NftMetadataParams {
  readonly clear_count: number;
}

export function buildEnemyLootMetadata(params: EnemyLootMetadataParams): NftMetadataBase {
  const {
    name,
    description,
    image = "https://backpack-dungeon.example.com/assets/enemy-loot.png",
    day_id,
    location_id,
    reward_tier,
    player,
    clear_count,
    ruleset_hash,
    proof_uri,
    final_state_hash,
  } = params;

  const attributes: NftAttribute[] = [
    attr("day_id", day_id),
    attr("location_id", location_id),
    attr("reward_tier", reward_tier),
    attr("player", player),
    attr("clear_count", clear_count),
    attr("ruleset_hash", ruleset_hash),
  ];

  if (proof_uri !== undefined) {
    attributes.push(attr("proof_uri", proof_uri));
  }
  if (final_state_hash !== undefined) {
    attributes.push(attr("final_state_hash", final_state_hash));
  }

  return {
    name,
    symbol: "BPD",
    description,
    image,
    attributes,
  };
}

// ──────────────────────────────────────────
// Boss participation metadata
// ──────────────────────────────────────────

export interface BossParticipationMetadataParams extends NftMetadataParams {
  readonly damage: number;
}

export function buildBossParticipationMetadata(
  params: BossParticipationMetadataParams,
): NftMetadataBase {
  const {
    name,
    description,
    image = "https://backpack-dungeon.example.com/assets/boss-participation.png",
    day_id,
    location_id,
    reward_tier,
    player,
    damage,
    ruleset_hash,
    proof_uri,
    final_state_hash,
  } = params;

  const attributes: NftAttribute[] = [
    attr("day_id", day_id),
    attr("location_id", location_id),
    attr("reward_tier", reward_tier),
    attr("player", player),
    attr("damage", damage),
    attr("ruleset_hash", ruleset_hash),
  ];

  if (proof_uri !== undefined) {
    attributes.push(attr("proof_uri", proof_uri));
  }
  if (final_state_hash !== undefined) {
    attributes.push(attr("final_state_hash", final_state_hash));
  }

  return {
    name,
    symbol: "BPD",
    description,
    image,
    attributes,
  };
}

// ──────────────────────────────────────────
// Daily reward metadata
// ──────────────────────────────────────────

export interface DailyRewardMetadataParams extends NftMetadataParams {
  /** The claim condition description, e.g. "Complete the daily dungeon" */
  readonly claim_condition: string;
}

export function buildDailyRewardMetadata(
  params: DailyRewardMetadataParams,
): NftMetadataBase {
  const {
    name,
    description,
    image = "https://backpack-dungeon.example.com/assets/daily-reward.png",
    day_id,
    location_id,
    reward_tier,
    player,
    ruleset_hash,
    proof_uri,
    final_state_hash,
    claim_condition,
  } = params;

  const attributes: NftAttribute[] = [
    attr("day_id", day_id),
    attr("location_id", location_id),
    attr("reward_tier", reward_tier),
    attr("player", player),
    attr("claim_condition", claim_condition),
    attr("ruleset_hash", ruleset_hash),
  ];

  if (proof_uri !== undefined) {
    attributes.push(attr("proof_uri", proof_uri));
  }
  if (final_state_hash !== undefined) {
    attributes.push(attr("final_state_hash", final_state_hash));
  }

  return {
    name,
    symbol: "BPD",
    description,
    image,
    attributes,
  };
}
