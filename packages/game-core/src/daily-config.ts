import type { DayId } from "@backpack-dungeon/shared";
import type { DailyMapInput } from "./daily-map.js";
import { assertRandomSeed } from "./rng.js";

export const DEFAULT_DAILY_MAP_RANDOM_SEED = 20_260_426;

export const DEFAULT_DAILY_MAP_PARAMETERS = Object.freeze({
  bossCount: 1,
  enemyCount: 12,
  height: 20,
  poiDensity: 0.06,
  randomSeed: DEFAULT_DAILY_MAP_RANDOM_SEED,
  shopCount: 4,
  treasureCount: 6,
  width: 30
} satisfies Omit<DailyMapInput, "dayId">);

export interface DailyMapConfigInput {
  readonly bossCount?: number;
  readonly dayId: DayId;
  readonly enemyCount?: number;
  readonly height?: number;
  readonly poiDensity?: number;
  readonly randomSeed?: number;
  readonly shopCount?: number;
  readonly treasureCount?: number;
  readonly width?: number;
}

export function createDailyMapInput(config: DailyMapConfigInput): DailyMapInput {
  const randomSeed = assertRandomSeed(
    config.randomSeed ?? DEFAULT_DAILY_MAP_PARAMETERS.randomSeed,
    "randomSeed"
  );

  return {
    bossCount: config.bossCount ?? DEFAULT_DAILY_MAP_PARAMETERS.bossCount,
    dayId: config.dayId,
    enemyCount: config.enemyCount ?? DEFAULT_DAILY_MAP_PARAMETERS.enemyCount,
    height: config.height ?? DEFAULT_DAILY_MAP_PARAMETERS.height,
    poiDensity: config.poiDensity ?? DEFAULT_DAILY_MAP_PARAMETERS.poiDensity,
    randomSeed,
    shopCount: config.shopCount ?? DEFAULT_DAILY_MAP_PARAMETERS.shopCount,
    treasureCount: config.treasureCount ?? DEFAULT_DAILY_MAP_PARAMETERS.treasureCount,
    width: config.width ?? DEFAULT_DAILY_MAP_PARAMETERS.width
  };
}

export function parseDailyMapRandomSeed(
  value: string | number | null | undefined,
  fallback = DEFAULT_DAILY_MAP_RANDOM_SEED
): number {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return assertRandomSeed(fallback, "fallback");
  }

  const parsed = typeof value === "number" ? value : Number(value.trim());
  return assertRandomSeed(parsed, "randomSeed");
}

export function todayDayId(date = new Date()): DayId {
  return date.toISOString().slice(0, 10);
}
