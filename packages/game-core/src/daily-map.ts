import {
  hashCanonicalJson,
  LocationKind,
  RewardTier
} from "@backpack-dungeon/shared";
import type {
  BossConfig,
  DayId,
  EnemyConfig,
  LocationSpec,
  Position,
  ShopConfig,
  ShopItemSlot
} from "@backpack-dungeon/shared";
import {
  deriveSeed,
  pickWeighted,
  randomRange,
  type WeightedItem
} from "./rng.js";

export type DailyPoiKind =
  | LocationKind.Boss
  | LocationKind.Enemy
  | LocationKind.Shop
  | LocationKind.Treasure;

export interface DailyMapInput {
  readonly dayId: DayId;
  readonly masterSeed: string;
  readonly width: number;
  readonly height: number;
  readonly poiDensity: number;
  readonly bossCount: number;
  readonly shopCount: number;
  readonly enemyCount: number;
  readonly treasureCount: number;
}

export interface DailyLocationSpec extends Omit<LocationSpec, "kind"> {
  readonly kind: DailyPoiKind;
  readonly baseConfigHash: string;
}

export interface DailyMap {
  readonly dayId: DayId;
  readonly seedHash: string;
  readonly width: number;
  readonly height: number;
  readonly poiDensity: number;
  readonly locations: readonly DailyLocationSpec[];
}

interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

const UINT32_SIZE = 0x1_0000_0000;

const REWARD_TIER_WEIGHTS: readonly WeightedItem<RewardTier>[] = Object.freeze([
  { item: RewardTier.Common, weight: 50 },
  { item: RewardTier.Uncommon, weight: 28 },
  { item: RewardTier.Rare, weight: 14 },
  { item: RewardTier.Epic, weight: 6 },
  { item: RewardTier.Legendary, weight: 2 }
]);

const ENEMY_NAMES: readonly WeightedItem<string>[] = Object.freeze([
  { item: "Pack Thief", weight: 35 },
  { item: "Cavern Scout", weight: 25 },
  { item: "Iron Strider", weight: 20 },
  { item: "Hex Warden", weight: 12 },
  { item: "Void Marauder", weight: 8 }
]);

const BOSS_NAMES: readonly WeightedItem<string>[] = Object.freeze([
  { item: "The Buried King", weight: 25 },
  { item: "Vault Eater", weight: 25 },
  { item: "Lantern Tyrant", weight: 20 },
  { item: "The Last Cartographer", weight: 18 },
  { item: "Abyss Quartermaster", weight: 12 }
]);

const SHOP_KEEPERS: readonly WeightedItem<string>[] = Object.freeze([
  { item: "Mira", weight: 30 },
  { item: "Orrin", weight: 25 },
  { item: "Sel", weight: 20 },
  { item: "Brass", weight: 15 },
  { item: "Nix", weight: 10 }
]);

const SHOP_ITEM_FAMILIES: readonly WeightedItem<string>[] = Object.freeze([
  { item: "potion", weight: 30 },
  { item: "ration", weight: 25 },
  { item: "bomb", weight: 16 },
  { item: "ward", weight: 14 },
  { item: "key", weight: 10 },
  { item: "charm", weight: 5 }
]);

export function generateDailyMap(input: DailyMapInput): DailyMap {
  const width = assertPositiveInteger(input.width, "width");
  const height = assertPositiveInteger(input.height, "height");
  assertDensity(input.poiDensity);

  const bossCount = Math.max(1, assertNonNegativeInteger(input.bossCount, "bossCount"));
  const shopCount = assertNonNegativeInteger(input.shopCount, "shopCount");
  const enemyCount = assertNonNegativeInteger(input.enemyCount, "enemyCount");
  const treasureCount = assertNonNegativeInteger(input.treasureCount, "treasureCount");
  const area = assertSafeArea(width, height);
  const totalPoiCount = bossCount + shopCount + enemyCount + treasureCount;

  if (totalPoiCount > area) {
    throw new RangeError("POI count cannot exceed map area.");
  }

  const rootSeed = deriveSeed(input.masterSeed, "daily-map", input.dayId);
  const layoutSeed = deriveSeed(
    rootSeed,
    "poi-layout",
    width,
    height,
    input.poiDensity,
    bossCount,
    shopCount,
    enemyCount,
    treasureCount
  );
  const occupied = new Set<string>();
  const locations: DailyLocationSpec[] = [];

  appendLocations(locations, occupied, {
    count: bossCount,
    distributed: true,
    height,
    kind: LocationKind.Boss,
    rootSeed,
    seed: deriveSeed(layoutSeed, "boss-positions"),
    width
  });
  appendLocations(locations, occupied, {
    count: shopCount,
    distributed: true,
    height,
    kind: LocationKind.Shop,
    rootSeed,
    seed: deriveSeed(layoutSeed, "shop-positions"),
    width
  });
  appendLocations(locations, occupied, {
    count: enemyCount,
    distributed: true,
    height,
    kind: LocationKind.Enemy,
    rootSeed,
    seed: deriveSeed(layoutSeed, "enemy-positions"),
    width
  });
  appendLocations(locations, occupied, {
    count: treasureCount,
    distributed: false,
    height,
    kind: LocationKind.Treasure,
    rootSeed,
    seed: deriveSeed(layoutSeed, "treasure-positions"),
    width
  });

  return {
    dayId: input.dayId,
    height,
    locations,
    poiDensity: input.poiDensity,
    seedHash: deriveSeed(
      rootSeed,
      "daily-map-seed-hash",
      width,
      height,
      input.poiDensity,
      bossCount,
      shopCount,
      enemyCount,
      treasureCount
    ),
    width
  };
}

function appendLocations(
  locations: DailyLocationSpec[],
  occupied: Set<string>,
  input: {
    readonly count: number;
    readonly distributed: boolean;
    readonly height: number;
    readonly kind: DailyPoiKind;
    readonly rootSeed: string;
    readonly seed: string;
    readonly width: number;
  }
): void {
  const positions = allocatePositions(
    input.seed,
    input.count,
    input.width,
    input.height,
    occupied,
    input.distributed
  );

  for (let index = 0; index < positions.length; index += 1) {
    locations.push(createLocation(input.rootSeed, input.kind, index, positions[index]));
  }
}

function allocatePositions(
  seed: string,
  count: number,
  width: number,
  height: number,
  occupied: Set<string>,
  distributed: boolean
): readonly Position[] {
  const positions: Position[] = [];
  const cells = distributed
    ? buildDistributedCells(seed, width, height, count)
    : Array.from({ length: count }, () => fullMapRect(width, height));

  for (let index = 0; index < count; index += 1) {
    const cell = cells[index] ?? fullMapRect(width, height);
    const position = pickOpenPosition(seed, index, cell, width, height, occupied);
    occupied.add(positionKey(position));
    positions.push(position);
  }

  return positions;
}

function buildDistributedCells(
  seed: string,
  width: number,
  height: number,
  count: number
): readonly Rect[] {
  if (count === 0) {
    return [];
  }

  const columns = Math.min(
    width,
    Math.max(1, Math.ceil(Math.sqrt(count * (width / height))))
  );
  const rows = Math.min(height, Math.max(1, Math.ceil(count / columns)));
  const cells: Rect[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({
        maxX: Math.floor(((column + 1) * width) / columns) - 1,
        maxY: Math.floor(((row + 1) * height) / rows) - 1,
        minX: Math.floor((column * width) / columns),
        minY: Math.floor((row * height) / rows)
      });
    }
  }

  return shuffle(seed, cells).slice(0, count);
}

function pickOpenPosition(
  seed: string,
  index: number,
  cell: Rect,
  width: number,
  height: number,
  occupied: Set<string>
): Position {
  const cellSeed = deriveSeed(seed, "cell-position", index);

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const position = {
      x: randomRange(cellSeed, attempt * 2, cell.minX, cell.maxX),
      y: randomRange(cellSeed, attempt * 2 + 1, cell.minY, cell.maxY)
    };
    if (!occupied.has(positionKey(position))) {
      return position;
    }
  }

  return findOpenPosition(cellSeed, width, height, occupied);
}

export function findOpenPosition(
  seed: string,
  width: number,
  height: number,
  occupied: Set<string>
): Position {
  const start = {
    x: randomRange(seed, 100_000, 0, width - 1),
    y: randomRange(seed, 100_001, 0, height - 1)
  };
  const area = width * height;
  const startLinear = start.y * width + start.x;

  for (let offset = 0; offset < area; offset += 1) {
    const linear = (startLinear + offset) % area;
    const position = {
      x: linear % width,
      y: Math.floor(linear / width)
    };
    if (!occupied.has(positionKey(position))) {
      return position;
    }
  }

  throw new RangeError("Could not find an open POI position.");
}

function createLocation(
  rootSeed: string,
  kind: DailyPoiKind,
  index: number,
  position: Position
): DailyLocationSpec {
  const configSeed = deriveSeed(rootSeed, "poi-config", kind, index, position.x, position.y);
  const baseConfigHash = hashCanonicalJson({
    kind,
    position: {
      x: position.x,
      y: position.y
    },
    seed: configSeed,
    version: 1
  });
  const idSeed = deriveSeed(rootSeed, "poi-id", kind, index, position.x, position.y, baseConfigHash);
  const id = `${kind.toLowerCase()}-${index + 1}-${idSeed.slice(0, 12)}`;
  const base = {
    baseConfigHash,
    id,
    kind,
    position
  };

  if (kind === LocationKind.Boss) {
    return {
      ...base,
      boss: createBossConfig(id, configSeed, index)
    };
  }

  if (kind === LocationKind.Enemy) {
    return {
      ...base,
      enemy: createEnemyConfig(id, configSeed, index)
    };
  }

  if (kind === LocationKind.Shop) {
    return {
      ...base,
      shop: createShopConfig(id, configSeed)
    };
  }

  return {
    ...base,
    rewardTier: pickRewardTier(configSeed, 0)
  };
}

function createEnemyConfig(id: string, seed: string, index: number): EnemyConfig {
  const level = randomRange(seed, 1, 1, 12);
  const name = pickWeighted(seed, 2, ENEMY_NAMES);

  return {
    attack: 3 + Math.floor(level * 1.5) + randomRange(seed, 3, 0, 4),
    id: `${id}-enemy`,
    level,
    maxHealth: 18 + level * 7 + randomRange(seed, 4, 0, 14),
    name: `${name} ${index + 1}`,
    rewardTier: pickRewardTier(seed, 5)
  };
}

function createBossConfig(id: string, seed: string, index: number): BossConfig {
  const level = randomRange(seed, 1, 12, 25);
  const name = pickWeighted(seed, 2, BOSS_NAMES);

  return {
    attack: 10 + Math.floor(level * 2.2) + randomRange(seed, 3, 0, 8),
    id: `${id}-boss`,
    level,
    maxHealth: 120 + level * 18 + randomRange(seed, 4, 0, 40),
    name: index === 0 ? name : `${name} ${index + 1}`,
    rewardTier: pickRewardTier(seed, 5)
  };
}

function createShopConfig(id: string, seed: string): ShopConfig {
  const itemSlots: ShopItemSlot[] = [];
  for (let slotIndex = 0; slotIndex < 3; slotIndex += 1) {
    const slotSeed = deriveSeed(seed, "shop-slot", slotIndex);
    const rewardTier = pickRewardTier(slotSeed, 0);
    const family = pickWeighted(slotSeed, 1, SHOP_ITEM_FAMILIES);

    itemSlots.push({
      itemId: `${family}-${rewardTier.toLowerCase()}-${deriveSeed(slotSeed, "item-id").slice(0, 8)}`,
      price: randomRange(slotSeed, 2, 8, 120),
      rewardTier,
      slotId: `${id}-slot-${slotIndex + 1}`,
      stock: randomRange(slotSeed, 3, 1, 5)
    });
  }

  return {
    id: `${id}-shop`,
    itemSlots,
    keeperName: pickWeighted(seed, 20, SHOP_KEEPERS)
  };
}

function pickRewardTier(seed: string, index: number): RewardTier {
  return pickWeighted(seed, index, REWARD_TIER_WEIGHTS);
}

function shuffle<T>(seed: string, items: readonly T[]): readonly T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomRange(seed, index, 0, index);
    const value = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = value;
  }

  return shuffled;
}

function fullMapRect(width: number, height: number): Rect {
  return {
    maxX: width - 1,
    maxY: height - 1,
    minX: 0,
    minY: 0
  };
}

function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }

  if (value > UINT32_SIZE) {
    throw new RangeError(`${name} must not exceed 2^32.`);
  }

  return value;
}

function assertNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }

  return value;
}

function assertDensity(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("poiDensity must be a finite number between 0 and 1.");
  }
}

function assertSafeArea(width: number, height: number): number {
  const area = width * height;
  if (!Number.isSafeInteger(area)) {
    throw new RangeError("Map area must be a safe integer.");
  }

  return area;
}
