import type { DailyDungeonConfig } from "@backpack-dungeon/shared";

export * from "./boss-shards.js";
export * from "./daily-config.js";
export * from "./daily-map.js";
export * from "./enemy-scaling.js";
export * from "./location-merkle.js";
export * from "./rng.js";
export * from "./shop-logic.js";

export const GAME_CORE_VERSION = "0.1.0";

export interface GameCorePackageInfo {
  readonly name: "game-core";
  readonly version: typeof GAME_CORE_VERSION;
  readonly acceptsDailyDungeonConfig: boolean;
}

export function getGameCorePackageInfo(
  _config?: DailyDungeonConfig
): GameCorePackageInfo {
  return {
    name: "game-core",
    version: GAME_CORE_VERSION,
    acceptsDailyDungeonConfig: true
  };
}
