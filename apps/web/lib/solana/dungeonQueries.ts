import type { DailyLocationSpec } from "@backpack-dungeon/game-core";
import { LocationKind } from "@backpack-dungeon/shared";
import { PublicKey } from "@solana/web3.js";
import type {
  BossDamageShardAccount,
  BossLocationAccount,
  BossNftClaimAccount,
  DailyDungeonAccount,
  DailyRewardClaimAccount,
  EnemyLocationAccount,
  LocationAccount,
  PackrunProgram,
  PlayerBossContributionAccount,
  PlayerRunAccount,
  ShopAccount,
  ShopItemSlotAccount,
} from "./anchorClient";
import {
  bossLocationPda,
  bossNftClaimPda,
  bossShardPda,
  dailyDungeonPda,
  dailyRewardClaimPda,
  enemyLocationPda,
  locationPda,
  playerBossContributionPda,
  playerRunPda,
  sha256Bytes32,
  shopItemSlotPda,
  shopPda,
} from "./pdas";
import { computeShopSlotState, toSafeNumber } from "./shopMath";

export interface DailyDungeonState {
  readonly initialized: true;
  readonly dayId: string;
  readonly mapRoot: string;
  readonly width: number;
  readonly height: number;
  readonly startTs: number;
  readonly endTs: number;
  readonly bossHp: number;
  readonly bossShardCount: number;
  readonly locationCount: number;
  readonly enemyCount: number;
  readonly shopCount: number;
  readonly treasureCount: number;
  readonly bossCount: number;
  readonly status: string;
}

export interface PlayerRunState {
  readonly energy: number;
  readonly clearedLocations: number;
  readonly bossDamage: number;
  readonly commonLootCount: number;
  readonly rareEligibilityPoints: number;
  readonly itemsPurchased: number;
  readonly enteredAt: number;
  readonly active: boolean;
}

export interface ShopSlotState {
  readonly initialized: boolean;
  readonly slotIndex: number;
  readonly itemId?: string;
  readonly rewardTier?: string;
  readonly basePrice?: number;
  readonly currentPrice?: number;
  readonly expectedPrice?: string;
  readonly availableStock?: number;
  readonly available?: number;
  readonly price?: number;
  readonly soldCount?: number;
  readonly perWalletDailyLimit?: number;
}

export interface BossShardState {
  readonly initialized: boolean;
  readonly index: number;
  readonly totalDamage: number;
  readonly participantCount: number;
}

export interface PoiOnChainState {
  readonly initialized: boolean;
  readonly location?: {
    readonly status: string;
    readonly x: number;
    readonly y: number;
    readonly baseConfigHash: string;
  };
  readonly playerRun?: PlayerRunState | null;
  readonly clearCount?: number;
  readonly difficultyLevel?: number;
  readonly nextAvailableAt?: number;
  readonly cooldownEnd?: number;
  readonly baseHp?: number;
  readonly baseDamage?: number;
  readonly valuableClearCap?: number;
  readonly keeperName?: string;
  readonly slotCount?: number;
  readonly stock?: Readonly<Record<number, ShopSlotState>>;
  readonly bossName?: string;
  readonly bossHp?: number;
  readonly totalDamage?: number;
  readonly participantCount?: number;
  readonly bossShards?: readonly BossShardState[];
  readonly bossDefeated?: boolean;
  readonly playerContribution?: number;
  readonly playerBossDamage?: number;
  readonly playerShardIndex?: number;
  readonly dailyRewardClaimed?: boolean;
  readonly bossNftClaimed?: boolean;
}

export interface RewardClaimState {
  readonly claimed: boolean;
  readonly claimedAt?: number;
  readonly rewardTier?: string;
  readonly amount?: number;
}

export interface BossNftClaimState {
  readonly claimed: boolean;
  readonly claimedAt?: number;
  readonly playerDamage?: number;
  readonly shardIndex?: number;
}

export async function fetchDailyDungeon(
  program: PackrunProgram,
  dayId: string,
): Promise<DailyDungeonState | null> {
  const [address] = dailyDungeonPda(dayId);
  const account = await program.account.dailyDungeon.fetchNullable(address);
  return account ? normalizeDailyDungeon(account) : null;
}

export async function fetchPlayerRun(
  program: PackrunProgram,
  dayId: string,
  player: PublicKey,
): Promise<PlayerRunState | null> {
  const [address] = playerRunPda(dayId, player);
  const account = await program.account.playerRun.fetchNullable(address);
  return account ? normalizePlayerRun(account) : null;
}

export async function fetchPoiOnChainState(
  program: PackrunProgram,
  dayId: string,
  spec: DailyLocationSpec,
  player?: PublicKey,
): Promise<PoiOnChainState> {
  const [playerRun, dailyRewardClaim, bossNftClaim] = await Promise.all([
    player ? fetchPlayerRun(program, dayId, player) : Promise.resolve(null),
    player ? fetchDailyRewardClaim(program, dayId, player) : Promise.resolve(null),
    player ? fetchBossNftClaim(program, dayId, player) : Promise.resolve(null),
  ]);

  const base = {
    playerRun,
    dailyRewardClaimed: dailyRewardClaim?.claimed ?? false,
    bossNftClaimed: bossNftClaim?.claimed ?? false,
  };

  if (spec.kind === LocationKind.Enemy) {
    return { ...base, ...(await fetchEnemyState(program, dayId, spec)) };
  }

  if (spec.kind === LocationKind.Shop) {
    return { ...base, ...(await fetchShopState(program, dayId, spec)) };
  }

  if (spec.kind === LocationKind.Boss) {
    return { ...base, ...(await fetchBossState(program, dayId, spec, player)) };
  }

  const location = await fetchLocation(program, dayId, spec);
  return {
    ...base,
    initialized: location !== null,
    location: location ? normalizeLocation(location) : undefined,
  };
}

export async function fetchEnemyState(
  program: PackrunProgram,
  dayId: string,
  spec: DailyLocationSpec,
): Promise<PoiOnChainState> {
  const poiIdHash = sha256Bytes32(spec.id);
  const [[, location], [, enemy]] = await Promise.all([
    withAddress(locationPda(dayId, poiIdHash), program.account.locationAccount),
    withAddress(enemyLocationPda(dayId, poiIdHash), program.account.enemyLocation),
  ]);

  if (!location || !enemy) {
    return { initialized: false };
  }

  return {
    initialized: true,
    location: normalizeLocation(location),
    clearCount: toNumber(enemy.clearCount, "enemy.clearCount"),
    difficultyLevel: enemy.difficultyLevel,
    nextAvailableAt: toNumber(enemy.nextAvailableAt, "enemy.nextAvailableAt"),
    cooldownEnd: toNumber(enemy.nextAvailableAt, "enemy.nextAvailableAt"),
    baseHp: enemy.baseHp,
    baseDamage: enemy.baseDamage,
    valuableClearCap: enemy.valuableClearCap,
  };
}

export async function fetchShopState(
  program: PackrunProgram,
  dayId: string,
  spec: DailyLocationSpec,
): Promise<PoiOnChainState> {
  const poiIdHash = sha256Bytes32(spec.id);
  const [[, location], [, shop]] = await Promise.all([
    withAddress(locationPda(dayId, poiIdHash), program.account.locationAccount),
    withAddress(shopPda(dayId, poiIdHash), program.account.shopAccount),
  ]);

  if (!location || !shop) {
    return { initialized: false };
  }

  const slotCount = shop.slotCount || spec.shop?.itemSlots.length || 0;
  const slotAccounts = await Promise.all(
    Array.from({ length: slotCount }, async (_, slotIndex) => {
      const [slotAddress] = shopItemSlotPda(dayId, poiIdHash, slotIndex);
      return program.account.shopItemSlotAccount.fetchNullable(slotAddress);
    }),
  );

  const currentTime = Math.floor(Date.now() / 1000);
  const stock = Object.fromEntries(
    slotAccounts.map((slot, index) => {
      if (!slot) {
        return [index, { initialized: false, slotIndex: index } satisfies ShopSlotState];
      }

      const computed = computeShopSlotState({
        basePrice: slot.basePrice,
        baseStock: slot.baseStock,
        maxStock: slot.maxStock,
        soldCount: slot.soldCount,
        restockIntervalSeconds: slot.restockIntervalSeconds,
        openedAt: slot.openedAt,
        currentTime,
      });
      const availableStock = toSafeNumber(computed.availableStock, "availableStock");
      const currentPrice = toSafeNumber(computed.currentPrice, "currentPrice");

      return [
        index,
        {
          initialized: true,
          slotIndex: index,
          itemId: slot.itemId,
          rewardTier: enumVariant(slot.rewardTier),
          basePrice: toNumber(slot.basePrice, "shopItemSlot.basePrice"),
          currentPrice,
          expectedPrice: computed.currentPrice.toString(),
          availableStock,
          available: availableStock,
          price: currentPrice,
          soldCount: toNumber(slot.soldCount, "shopItemSlot.soldCount"),
          perWalletDailyLimit: slot.perWalletDailyLimit,
        } satisfies ShopSlotState,
      ];
    }),
  );

  return {
    initialized: true,
    location: normalizeLocation(location),
    keeperName: shop.keeperName,
    slotCount: shop.slotCount,
    stock,
  };
}

export async function fetchBossState(
  program: PackrunProgram,
  dayId: string,
  spec: DailyLocationSpec,
  player?: PublicKey,
): Promise<PoiOnChainState> {
  const dailyDungeon = await fetchDailyDungeon(program, dayId);
  const poiIdHash = sha256Bytes32(spec.id);
  const [[, location], [bossAddress, boss]] = await Promise.all([
    withAddress(locationPda(dayId, poiIdHash), program.account.locationAccount),
    withAddress(bossLocationPda(dayId, poiIdHash), program.account.bossLocation),
  ]);

  if (!location || !boss || !dailyDungeon) {
    return { initialized: false };
  }

  const shardCount = dailyDungeon.bossShardCount;
  const rawShards = await Promise.all(
    Array.from({ length: shardCount }, async (_, shardIndex) => {
      const [address] = bossShardPda(dayId, shardIndex);
      return program.account.bossDamageShard.fetchNullable(address);
    }),
  );

  const bossAddressString = bossAddress.toBase58();
  const bossShards = rawShards.map((shard, index) => normalizeBossShard(shard, index, bossAddressString));
  const totalDamage = bossShards.reduce((total, shard) => total + shard.totalDamage, 0);
  const participantCount = bossShards.reduce((total, shard) => total + shard.participantCount, 0);

  const contribution = player
    ? await program.account.playerBossContribution.fetchNullable(
        playerBossContributionPda(dayId, player)[0],
      )
    : null;
  const playerRun = player ? await fetchPlayerRun(program, dayId, player) : null;

  return {
    initialized: true,
    location: normalizeLocation(location),
    bossName: boss.name,
    bossHp: dailyDungeon.bossHp,
    baseHp: boss.baseHp,
    baseDamage: boss.baseDamage,
    bossShards,
    totalDamage,
    participantCount,
    bossDefeated: totalDamage >= dailyDungeon.bossHp,
    playerContribution:
      contribution && pubkeyString(contribution.bossLocation) === bossAddressString
        ? toNumber(contribution.totalDamage, "playerBossContribution.totalDamage")
        : 0,
    playerBossDamage: playerRun?.bossDamage ?? 0,
    playerShardIndex:
      contribution && pubkeyString(contribution.bossLocation) === bossAddressString
        ? contribution.shardIndex
        : undefined,
  };
}

export async function fetchDailyRewardClaim(
  program: PackrunProgram,
  dayId: string,
  player: PublicKey,
): Promise<RewardClaimState | null> {
  const [address] = dailyRewardClaimPda(dayId, player);
  const account = await program.account.dailyRewardClaim.fetchNullable(address);
  return account ? normalizeDailyRewardClaim(account) : null;
}

export async function fetchBossNftClaim(
  program: PackrunProgram,
  dayId: string,
  player: PublicKey,
): Promise<BossNftClaimState | null> {
  const [address] = bossNftClaimPda(dayId, player);
  const account = await program.account.bossNftClaim.fetchNullable(address);
  return account ? normalizeBossNftClaim(account) : null;
}

async function fetchLocation(
  program: PackrunProgram,
  dayId: string,
  spec: DailyLocationSpec,
): Promise<LocationAccount | null> {
  const [address] = locationPda(dayId, sha256Bytes32(spec.id));
  return program.account.locationAccount.fetchNullable(address);
}

async function withAddress<T>(
  pda: readonly [PublicKey, number],
  client: { readonly fetchNullable: (address: PublicKey) => Promise<T | null> },
): Promise<readonly [PublicKey, T | null]> {
  return [pda[0], await client.fetchNullable(pda[0])];
}

function normalizeDailyDungeon(account: DailyDungeonAccount): DailyDungeonState {
  return {
    initialized: true,
    dayId: account.dayId,
    mapRoot: bytesToHex(account.mapRoot),
    width: account.width,
    height: account.height,
    startTs: toNumber(account.startTs, "dailyDungeon.startTs"),
    endTs: toNumber(account.endTs, "dailyDungeon.endTs"),
    bossHp: toNumber(account.bossHp, "dailyDungeon.bossHp"),
    bossShardCount: account.bossShardCount,
    locationCount: account.locationCount,
    enemyCount: account.enemyCount,
    shopCount: account.shopCount,
    treasureCount: account.treasureCount,
    bossCount: account.bossCount,
    status: enumVariant(account.status),
  };
}

function normalizePlayerRun(account: PlayerRunAccount): PlayerRunState {
  return {
    energy: account.energy,
    clearedLocations: account.clearedLocations,
    bossDamage: toNumber(account.bossDamage, "playerRun.bossDamage"),
    commonLootCount: account.commonLootCount,
    rareEligibilityPoints: account.rareEligibilityPoints,
    itemsPurchased: account.itemsPurchased,
    enteredAt: toNumber(account.enteredAt, "playerRun.enteredAt"),
    active: account.active,
  };
}

function normalizeLocation(account: LocationAccount): NonNullable<PoiOnChainState["location"]> {
  return {
    status: enumVariant(account.status),
    x: account.x,
    y: account.y,
    baseConfigHash: bytesToHex(account.baseConfigHash),
  };
}

function normalizeBossShard(
  account: BossDamageShardAccount | null,
  index: number,
  bossAddress: string,
): BossShardState {
  if (!account || pubkeyString(account.bossLocation) !== bossAddress) {
    return {
      initialized: false,
      index,
      totalDamage: 0,
      participantCount: 0,
    };
  }

  return {
    initialized: true,
    index,
    totalDamage: toNumber(account.totalDamage, "bossDamageShard.totalDamage"),
    participantCount: account.participantCount,
  };
}

function normalizeDailyRewardClaim(account: DailyRewardClaimAccount): RewardClaimState {
  const claimedAt = toNumber(account.claimedAt, "dailyRewardClaim.claimedAt");
  return {
    claimed: claimedAt !== 0,
    claimedAt,
    rewardTier: enumVariant(account.rewardTier),
    amount: toNumber(account.amount, "dailyRewardClaim.amount"),
  };
}

function normalizeBossNftClaim(account: BossNftClaimAccount): BossNftClaimState {
  const claimedAt = toNumber(account.claimedAt, "bossNftClaim.claimedAt");
  return {
    claimed: claimedAt !== 0,
    claimedAt,
    playerDamage: toNumber(account.playerDamage, "bossNftClaim.playerDamage"),
    shardIndex: account.shardIndex,
  };
}

function toNumber(value: Parameters<typeof toSafeNumber>[0], name: string): number {
  return toSafeNumber(value, name);
}

function enumVariant(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const [variant] = Object.keys(value);
    if (variant) {
      return variant.slice(0, 1).toUpperCase() + variant.slice(1);
    }
  }
  return "Unknown";
}

function pubkeyString(value: unknown): string {
  if (value instanceof PublicKey) return value.toBase58();
  if (value && typeof value === "object" && "toBase58" in value) {
    return String((value as { readonly toBase58: () => string }).toBase58());
  }
  return String(value);
}

function bytesToHex(bytes: readonly number[]): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
