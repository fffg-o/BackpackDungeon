// ────────────────────────────────────────────────────────────────────────────
// @backpack-dungeon/cnft-adapter
//
// cNFT mint adapter — mock implementation with Bubblegum-compatible types.
//
// ## Usage
//
// ```ts
// import { mockCnftAdapter } from "@backpack-dungeon/cnft-adapter";
//
// const result = await mockCnftAdapter.mintEnemyLootCnft({
//   name: "Goblin Tooth",
//   symbol: "LOOT",
//   description: "A grimy goblin tooth.",
//   image: "https://example.com/tooth.png",
//   attributes: [
//     { trait_type: "category",   value: "enemy_loot" },
//     { trait_type: "enemy_id",   value: "goblin_01" },
//     { trait_type: "reward_tier",value: "Common" },
//     { trait_type: "day_id",     value: "2025-04-25" },
//   ],
// });
// ```
//
// ## Future
//
// Replace `mockCnftAdapter` with a `bubblegumCnftAdapter` that calls
// `@metaplex-foundation/mpl-bubblegum` `mintV1` instructions.
// ────────────────────────────────────────────────────────────────────────────

export type {
  CnftMetadata,
  CnftCollection,
  EnemyLootMetadata,
  BossParticipationMetadata,
  DailyRewardMetadata,
  MintResult,
  CnftMintAdapter,
} from "./types.js";

export { mockCnftAdapter, getMintedAssets, clearMintedAssets } from "./mock-adapter.js";
