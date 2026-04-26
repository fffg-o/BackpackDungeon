export type DayId = string;

// ── NFT metadata builders ──
export {
  buildEnemyLootMetadata,
  buildBossParticipationMetadata,
  buildDailyRewardMetadata,
} from "./nft-metadata.js";

export type {
  NftMetadataParams,
  EnemyLootMetadataParams,
  BossParticipationMetadataParams,
  DailyRewardMetadataParams,
} from "./nft-metadata.js";

export interface Position {
  readonly x: number;
  readonly y: number;
}

export enum LocationKind {
  Enemy = "Enemy",
  Shop = "Shop",
  Treasure = "Treasure",
  Boss = "Boss",
  Event = "Event"
}

export enum RewardTier {
  Common = "Common",
  Uncommon = "Uncommon",
  Rare = "Rare",
  Epic = "Epic",
  Legendary = "Legendary"
}

export interface EnemyConfig {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly maxHealth: number;
  readonly attack: number;
  readonly rewardTier: RewardTier;
}

export interface ShopItemSlot {
  readonly slotId: string;
  readonly itemId: string;
  readonly price: number;
  readonly stock: number;
  readonly rewardTier: RewardTier;
}

export interface ShopConfig {
  readonly id: string;
  readonly keeperName?: string;
  readonly itemSlots: readonly ShopItemSlot[];
}

export interface BossConfig {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly maxHealth: number;
  readonly attack: number;
  readonly rewardTier: RewardTier;
}

export interface LocationSpec {
  readonly id: string;
  readonly kind: LocationKind;
  readonly position: Position;
  readonly enemy?: EnemyConfig;
  readonly shop?: ShopConfig;
  readonly rewardTier?: RewardTier;
  readonly boss?: BossConfig;
  readonly eventId?: string;
}

export interface DailyDungeonConfig {
  readonly dayId: DayId;
  readonly seedHash: string;
  readonly width: number;
  readonly height: number;
  readonly locations: readonly LocationSpec[];
  readonly boss: BossConfig;
}

export interface PlayerRunSummary {
  readonly runId: string;
  readonly dayId: DayId;
  readonly player: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly finalPosition: Position;
  readonly defeatedEnemies: readonly string[];
  readonly collectedRewards: readonly string[];
  readonly score: number;
  readonly completed: boolean;
}

export interface NftMetadataBase {
  readonly name: string;
  readonly symbol: string;
  readonly description: string;
  readonly image: string;
  readonly externalUrl?: string;
  readonly attributes: readonly {
    readonly trait_type: string;
    readonly value: string | number | boolean;
  }[];
}

export const PACKRUN_LOCATION_KINDS = Object.freeze([
  LocationKind.Enemy,
  LocationKind.Shop,
  LocationKind.Treasure,
  LocationKind.Boss,
  LocationKind.Event
] as const);

export const PACKRUN_REWARD_TIERS = Object.freeze([
  RewardTier.Common,
  RewardTier.Uncommon,
  RewardTier.Rare,
  RewardTier.Epic,
  RewardTier.Legendary
] as const);

export const PACKRUN_PDA_SEEDS = Object.freeze({
  dailyDungeon: "dungeon",
  location: "location",
  enemyLocation: "enemy",
  shop: "shop",
  bossLocation: "boss",
  playerRun: "run",
  bossShard: "boss_shard",
  bossContribution: "boss_contribution",
  shopItemSlot: "shop_slot",
  dailyRewardClaim: "daily_claim",
  bossNftClaim: "boss_nft_claim"
} as const);

export type PackrunPdaSeeds = readonly Uint8Array[];

export type PackrunPublicKeyInput =
  | Uint8Array
  | {
      readonly toBytes: () => Uint8Array;
    }
  | {
      readonly toBuffer: () => Uint8Array;
    };

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue | undefined };

export function canonicalJson(value: CanonicalJsonValue): string {
  return JSON.stringify(toCanonicalValue(value));
}

export function sha256Hex(input: string | Uint8Array): string {
  return bytesToHex(typeof input === "string" ? sha256Bytes(input) : sha256(input));
}

export function sha256Bytes(input: string): Uint8Array {
  return sha256(encodeUtf8(input));
}

export function hashCanonicalJson(value: CanonicalJsonValue): string {
  return sha256Hex(canonicalJson(value));
}

export function packrunPdaSeed(prefix: keyof typeof PACKRUN_PDA_SEEDS): Uint8Array {
  return encodeUtf8(PACKRUN_PDA_SEEDS[prefix]);
}

export function dailyDungeonPda(dayId: DayId): PackrunPdaSeeds {
  return [packrunPdaSeed("dailyDungeon"), encodeUtf8(dayId)];
}

export function locationPda(dayId: DayId, poiIdHash: Uint8Array): PackrunPdaSeeds {
  return [packrunPdaSeed("location"), encodeUtf8(dayId), bytes32Seed(poiIdHash, "poiIdHash")];
}

export function enemyLocationPda(dayId: DayId, poiIdHash: Uint8Array): PackrunPdaSeeds {
  return [packrunPdaSeed("enemyLocation"), encodeUtf8(dayId), bytes32Seed(poiIdHash, "poiIdHash")];
}

export function shopPda(dayId: DayId, poiIdHash: Uint8Array): PackrunPdaSeeds {
  return [packrunPdaSeed("shop"), encodeUtf8(dayId), bytes32Seed(poiIdHash, "poiIdHash")];
}

export function bossLocationPda(dayId: DayId, poiIdHash: Uint8Array): PackrunPdaSeeds {
  return [packrunPdaSeed("bossLocation"), encodeUtf8(dayId), bytes32Seed(poiIdHash, "poiIdHash")];
}

export function playerRunPda(dayId: DayId, player: PackrunPublicKeyInput): PackrunPdaSeeds {
  return [packrunPdaSeed("playerRun"), encodeUtf8(dayId), publicKeySeed(player, "player")];
}

export function shopItemSlotPda(
  dayId: DayId,
  poiIdHash: Uint8Array,
  slotIndex: number
): PackrunPdaSeeds {
  return [
    packrunPdaSeed("shopItemSlot"),
    encodeUtf8(dayId),
    bytes32Seed(poiIdHash, "poiIdHash"),
    u16Seed(slotIndex, "slotIndex")
  ];
}

export function bossShardPda(dayId: DayId, shardIndex: number): PackrunPdaSeeds {
  return [packrunPdaSeed("bossShard"), encodeUtf8(dayId), u16Seed(shardIndex, "shardIndex")];
}

export function bossContributionPda(dayId: DayId, player: PackrunPublicKeyInput): PackrunPdaSeeds {
  return [packrunPdaSeed("bossContribution"), encodeUtf8(dayId), publicKeySeed(player, "player")];
}

export function dailyRewardClaimPda(dayId: DayId, player: PackrunPublicKeyInput): PackrunPdaSeeds {
  return [packrunPdaSeed("dailyRewardClaim"), encodeUtf8(dayId), publicKeySeed(player, "player")];
}

export function bossNftClaimPda(dayId: DayId, player: PackrunPublicKeyInput): PackrunPdaSeeds {
  return [packrunPdaSeed("bossNftClaim"), encodeUtf8(dayId), publicKeySeed(player, "player")];
}

function toCanonicalValue(value: CanonicalJsonValue): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers.");
    }

    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalValue(entry));
  }

  const record = value as { readonly [key: string]: CanonicalJsonValue | undefined };
  const canonicalObject: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry !== undefined) {
      canonicalObject[key] = toCanonicalValue(entry);
    }
  }

  return canonicalObject;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function publicKeySeed(value: PackrunPublicKeyInput, name: string): Uint8Array {
  let seed: Uint8Array;

  if (value instanceof Uint8Array) {
    seed = value;
  } else if ("toBytes" in value) {
    seed = value.toBytes();
  } else {
    seed = value.toBuffer();
  }

  if (seed.length !== 32) {
    throw new RangeError(`${name} must be a 32-byte public key.`);
  }

  return new Uint8Array(seed);
}

function bytes32Seed(value: Uint8Array, name: string): Uint8Array {
  if (value.length !== 32) {
    throw new RangeError(`${name} must be 32 bytes.`);
  }

  return new Uint8Array(value);
}

function u16Seed(value: number, name: string): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${name} must be an unsigned 16-bit integer.`);
  }

  const seed = new Uint8Array(2);
  new DataView(seed.buffer).setUint16(0, value, true);
  return seed;
}

const SHA256_INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19
]);

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function sha256(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 1 + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;

  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const state = new Uint32Array(SHA256_INITIAL_STATE);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = paddedView.getUint32(offset + index * 4, false);
    }

    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotateRight(words[index - 15], 7) ^
        rotateRight(words[index - 15], 18) ^
        (words[index - 15] >>> 3);
      const s1 =
        rotateRight(words[index - 2], 17) ^
        rotateRight(words[index - 2], 19) ^
        (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  const output = new Uint8Array(32);
  const outputView = new DataView(output.buffer);
  for (let index = 0; index < state.length; index += 1) {
    outputView.setUint32(index * 4, state[index], false);
  }

  return output;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
