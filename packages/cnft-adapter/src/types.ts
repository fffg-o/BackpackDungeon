import type { NftMetadataBase, RewardTier } from "@backpack-dungeon/shared";

// ────────────────────────────────────────────────────────────────────────────
// Bubblegum-compatible cNFT metadata interfaces
// ────────────────────────────────────────────────────────────────────────────

/**
 * Full metadata payload for minting a compressed NFT via Metaplex Bubblegum.
 *
 * `name`, `symbol`, `uri` map directly to the Bubblegum `mintV1` instruction.
 * `uri` should point to a JSON file conforming to the Metaplex Token Metadata
 * standard (the same shape as `NftMetadataBase`).
 */
export interface CnftMetadata {
  /** On-chain asset name (≤ 32 bytes in Bubblegum). */
  readonly name: string;
  /** On-chain symbol (≤ 10 bytes in Bubblegum). */
  readonly symbol: string;
  /** URI pointing to the off-chain metadata JSON (Metaplex standard). */
  readonly uri: string;
  /** Optional collection verification info for Bubblegum. */
  readonly collection?: CnftCollection;
}

export interface CnftCollection {
  /** Merkle tree authority / collection mint address (base58). */
  readonly key: string;
  /** Whether this cNFT is verified as part of the collection. */
  readonly verified: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Domain-specific metadata builders
// ────────────────────────────────────────────────────────────────────────────

/**
 * Metadata for an enemy loot drop cNFT.
 * Low-value drops (Common / Uncommon / Rare) use this.
 */
export interface EnemyLootMetadata extends NftMetadataBase {
  readonly attributes: readonly [
    { readonly trait_type: "category"; readonly value: "enemy_loot" },
    { readonly trait_type: "enemy_id"; readonly value: string },
    { readonly trait_type: "reward_tier"; readonly value: RewardTier },
    { readonly trait_type: "day_id"; readonly value: string },
    ...ReadonlyArray<{ readonly trait_type: string; readonly value: string | number | boolean }>
  ];
}

/**
 * Metadata for a boss participation cNFT.
 * Awarded to every player who contributed to a boss kill.
 */
export interface BossParticipationMetadata extends NftMetadataBase {
  readonly attributes: readonly [
    { readonly trait_type: "category"; readonly value: "boss_participation" },
    { readonly trait_type: "boss_id"; readonly value: string },
    { readonly trait_type: "day_id"; readonly value: string },
    ...ReadonlyArray<{ readonly trait_type: string; readonly value: string | number | boolean }>
  ];
}

/**
 * Metadata for a daily reward NFT.
 * Claimed once per day for completing the dungeon.
 */
export interface DailyRewardMetadata extends NftMetadataBase {
  readonly attributes: readonly [
    { readonly trait_type: "category"; readonly value: "daily_reward" },
    { readonly trait_type: "day_id"; readonly value: string },
    ...ReadonlyArray<{ readonly trait_type: string; readonly value: string | number | boolean }>
  ];
}

// ────────────────────────────────────────────────────────────────────────────
// Mint result
// ────────────────────────────────────────────────────────────────────────────

export interface MintResult {
  /** Whether the mint operation succeeded. */
  readonly success: boolean;
  /** The asset ID (Merkle tree leaf index / asset ID) if minted on-chain. */
  readonly assetId?: string;
  /** Human-readable log of what was minted. */
  readonly log: string;
  /** ISO timestamp of the mint operation. */
  readonly mintedAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Adapter interface (for future real + mock implementations)
// ────────────────────────────────────────────────────────────────────────────

export interface CnftMintAdapter {
  mintEnemyLootCnft(metadata: EnemyLootMetadata): Promise<MintResult>;
  mintBossParticipationCnft(metadata: BossParticipationMetadata): Promise<MintResult>;
  mintDailyRewardNft(metadata: DailyRewardMetadata): Promise<MintResult>;
}
