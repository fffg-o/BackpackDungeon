import type {
  EnemyLootMetadata,
  BossParticipationMetadata,
  DailyRewardMetadata,
  MintResult,
  CnftMintAdapter,
} from "./types.js";

// ────────────────────────────────────────────────────────────────────────────
// In-memory store for minted cNFTs (MVP only — replace with on-chain index)
// ────────────────────────────────────────────────────────────────────────────

const mintedAssets: MintResult[] = [];

export function getMintedAssets(): readonly MintResult[] {
  return mintedAssets as readonly MintResult[];
}

export function clearMintedAssets(): void {
  mintedAssets.length = 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Mock adapter — logs metadata, stores locally, never touches chain
// ────────────────────────────────────────────────────────────────────────────

function buildUri(metadata: { name: string; description: string; image: string }): string {
  // In production this would upload to Arweave / NFT.Storage / Pinata.
  // For MVP we return a data URI so the metadata is self-contained.
  const blob = JSON.stringify(metadata);
  return `data:application/json;base64,${Buffer.from(blob).toString("base64")}`;
}

function now(): string {
  return new Date().toISOString();
}

function record(log: string): MintResult {
  const result: MintResult = {
    success: true,
    log,
    mintedAt: now(),
  };
  mintedAssets.push(result);
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Exported adapter
// ────────────────────────────────────────────────────────────────────────────

export const mockCnftAdapter: CnftMintAdapter = {
  async mintEnemyLootCnft(metadata: EnemyLootMetadata): Promise<MintResult> {
    const uri = buildUri({
      name: metadata.name,
      description: metadata.description,
      image: metadata.image,
    });

    console.log("[mock-cnft] mintEnemyLootCnft", {
      name: metadata.name,
      symbol: metadata.symbol,
      uri,
      attributes: metadata.attributes,
    });

    // ──────────────────────────────────────────────────────────────────────
    // TODO: Replace with real Bubblegum mintV1 call
    //
    // import { getBubblegumProgram } from "@metaplex-foundation/mpl-bubblegum";
    // import { mintV1 } from "@metaplex-foundation/mpl-bubblegum";
    //
    // const bubblegum = getBubblegumProgram(client);
    // const tx = await mintV1(bubblegum, {
    //   merkleTree:     MERKLE_TREE_ADDRESS,
    //   collection:     COLLECTION_MINT,
    //   owner:          PLAYER_ADDRESS,
    //   name:           metadata.name,
    //   symbol:         metadata.symbol,
    //   uri,
    //   sellerFeeBasisPoints: 0,
    // }).execute();
    // ──────────────────────────────────────────────────────────────────────

    return record(`[MOCK] minted enemy loot cNFT: ${metadata.name} (${metadata.attributes.find(a => a.trait_type === "enemy_id")?.value ?? "?"})`);
  },

  async mintBossParticipationCnft(metadata: BossParticipationMetadata): Promise<MintResult> {
    const uri = buildUri({
      name: metadata.name,
      description: metadata.description,
      image: metadata.image,
    });

    console.log("[mock-cnft] mintBossParticipationCnft", {
      name: metadata.name,
      symbol: metadata.symbol,
      uri,
      attributes: metadata.attributes,
    });

    // ──────────────────────────────────────────────────────────────────────
    // TODO: Replace with real Bubblegum mintV1 call (same pattern as above)
    // ──────────────────────────────────────────────────────────────────────

    return record(`[MOCK] minted boss participation cNFT: ${metadata.name} (boss: ${metadata.attributes.find(a => a.trait_type === "boss_id")?.value ?? "?"})`);
  },

  async mintDailyRewardNft(metadata: DailyRewardMetadata): Promise<MintResult> {
    const uri = buildUri({
      name: metadata.name,
      description: metadata.description,
      image: metadata.image,
    });

    console.log("[mock-cnft] mintDailyRewardNft", {
      name: metadata.name,
      symbol: metadata.symbol,
      uri,
      attributes: metadata.attributes,
    });

    // ──────────────────────────────────────────────────────────────────────
    // TODO: Replace with real Bubblegum mintV1 call (same pattern as above)
    // ──────────────────────────────────────────────────────────────────────

    return record(`[MOCK] minted daily reward NFT: ${metadata.name} (day: ${metadata.attributes.find(a => a.trait_type === "day_id")?.value ?? "?"})`);
  },
};
