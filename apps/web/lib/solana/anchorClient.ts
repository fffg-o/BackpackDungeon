import { AnchorProvider, Program, type Idl, type Provider } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, type ConfirmOptions } from "@solana/web3.js";
import packrunIdl from "../../idl/packrun.json";
import { PACKRUN_PROGRAM_ID, SOLANA_RPC_URL } from "./constants";

export interface AccountClient<T> {
  readonly fetch: (address: PublicKey) => Promise<T>;
  readonly fetchNullable: (address: PublicKey) => Promise<T | null>;
}

export interface DailyDungeonAccount {
  readonly dayId: string;
  readonly authority: unknown;
  readonly status: unknown;
  readonly mapRoot: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly locationCount: number;
  readonly enemyCount: number;
  readonly shopCount: number;
  readonly treasureCount: number;
  readonly bossCount: number;
  readonly startTs: IntegerAccountValue;
  readonly endTs: IntegerAccountValue;
  readonly bossHp: IntegerAccountValue;
  readonly bossShardCount: number;
}

export interface LocationAccount {
  readonly dailyDungeon: unknown;
  readonly dayId: string;
  readonly poiId: string;
  readonly poiIdHash: readonly number[];
  readonly kind: unknown;
  readonly status: unknown;
  readonly x: number;
  readonly y: number;
  readonly baseConfigHash: readonly number[];
}

export interface EnemyLocationAccount {
  readonly location: unknown;
  readonly dayId: string;
  readonly poiId: string;
  readonly enemyId: string;
  readonly name: string;
  readonly level: number;
  readonly baseHp: number;
  readonly baseDamage: number;
  readonly difficultyLevel: number;
  readonly maxRewardTier: unknown;
  readonly valuableClearCap: number;
  readonly clearCount: IntegerAccountValue;
  readonly baseCooldownSeconds: IntegerAccountValue;
  readonly nextAvailableAt: IntegerAccountValue;
}

export interface ShopAccount {
  readonly location: unknown;
  readonly dayId: string;
  readonly poiId: string;
  readonly keeperName: string;
  readonly slotCount: number;
  readonly openedAt: IntegerAccountValue;
}

export interface ShopItemSlotAccount {
  readonly shop: unknown;
  readonly dayId: string;
  readonly poiId: string;
  readonly poiIdHash: readonly number[];
  readonly slotIndex: number;
  readonly itemId: string;
  readonly rewardTier: unknown;
  readonly basePrice: IntegerAccountValue;
  readonly baseStock: number;
  readonly maxStock: number;
  readonly soldCount: IntegerAccountValue;
  readonly restockIntervalSeconds: IntegerAccountValue;
  readonly maxRestockCount: number;
  readonly perWalletDailyLimit: number;
  readonly openedAt: IntegerAccountValue;
}

export interface BossLocationAccount {
  readonly location: unknown;
  readonly dayId: string;
  readonly poiId: string;
  readonly bossId: string;
  readonly name: string;
  readonly level: number;
  readonly baseHp: number;
  readonly baseDamage: number;
  readonly rewardTier: unknown;
}

export interface BossDamageShardAccount {
  readonly dayId: string;
  readonly bossLocation: unknown;
  readonly shardIndex: number;
  readonly totalDamage: IntegerAccountValue;
  readonly participantCount: number;
}

export interface PlayerBossContributionAccount {
  readonly dayId: string;
  readonly player: unknown;
  readonly bossLocation: unknown;
  readonly shardIndex: number;
  readonly totalDamage: IntegerAccountValue;
  readonly lastHitAt: IntegerAccountValue;
}

export interface PlayerRunAccount {
  readonly dayId: string;
  readonly player: unknown;
  readonly dailyDungeon: unknown;
  readonly energy: number;
  readonly clearedLocations: number;
  readonly bossDamage: IntegerAccountValue;
  readonly commonLootCount: number;
  readonly rareEligibilityPoints: number;
  readonly itemsPurchased: number;
  readonly enteredAt: IntegerAccountValue;
  readonly active: boolean;
  readonly goldBalance?: IntegerAccountValue;
  readonly gold_balance?: IntegerAccountValue;
}

export interface DailyRewardClaimAccount {
  readonly dayId: string;
  readonly player: unknown;
  readonly rewardPool: unknown;
  readonly rewardTier: unknown;
  readonly amount: IntegerAccountValue;
  readonly claimedAt: IntegerAccountValue;
}

export interface BossNftClaimAccount {
  readonly dayId: string;
  readonly player: unknown;
  readonly bossLocation: unknown;
  readonly playerDamage: IntegerAccountValue;
  readonly shardIndex: number;
  readonly claimedAt: IntegerAccountValue;
}

export type IntegerAccountValue =
  | number
  | string
  | bigint
  | {
      readonly toString: () => string;
      readonly toNumber?: () => number;
    };

export interface PackrunAccountClients {
  readonly dailyDungeon: AccountClient<DailyDungeonAccount>;
  readonly locationAccount: AccountClient<LocationAccount>;
  readonly enemyLocation: AccountClient<EnemyLocationAccount>;
  readonly shopAccount: AccountClient<ShopAccount>;
  readonly shopItemSlotAccount: AccountClient<ShopItemSlotAccount>;
  readonly bossLocation: AccountClient<BossLocationAccount>;
  readonly bossDamageShard: AccountClient<BossDamageShardAccount>;
  readonly playerBossContribution: AccountClient<PlayerBossContributionAccount>;
  readonly playerRun: AccountClient<PlayerRunAccount>;
  readonly dailyRewardClaim: AccountClient<DailyRewardClaimAccount>;
  readonly bossNftClaim: AccountClient<BossNftClaimAccount>;
}

export type PackrunProgram = Program<Idl> & {
  readonly account: PackrunAccountClients;
  readonly methods: PackrunMethods;
};

interface MethodBuilder {
  readonly accounts: (accounts: Record<string, unknown>) => {
    readonly rpc: () => Promise<string>;
  };
}

interface PackrunMethods {
  readonly enterDungeon: (dayId: string) => MethodBuilder;
  readonly initLocationFromMerkle: (spec: unknown, proof: unknown) => MethodBuilder;
  readonly initEnemyDetail: (
    dayId: string,
    poiId: string,
    poiIdHash: readonly number[],
    spec: unknown,
  ) => MethodBuilder;
  readonly initShopDetail: (
    dayId: string,
    poiId: string,
    poiIdHash: readonly number[],
    spec: unknown,
  ) => MethodBuilder;
  readonly initBossDetail: (
    dayId: string,
    poiId: string,
    poiIdHash: readonly number[],
    spec: unknown,
  ) => MethodBuilder;
  readonly initShopItemSlot: (
    dayId: string,
    poiId: string,
    poiIdHash: readonly number[],
    slotIndex: number,
    slot: unknown,
  ) => MethodBuilder;
  readonly initBossDamageShard: (
    dayId: string,
    bossPoiHash: readonly number[],
    shardIndex: number,
  ) => MethodBuilder;
  readonly clearEnemy: (
    battleResultHash: readonly number[],
    playerPerformanceSummary: unknown,
    proofUriHash: readonly number[] | null,
  ) => MethodBuilder;
  readonly buyItem: (slotIndex: number, expectedPrice: unknown) => MethodBuilder;
  readonly submitBossDamage: (
    damage: unknown,
    bossBattleHash: readonly number[],
    shardIndex: number,
    proofUriHash: readonly number[] | null,
  ) => MethodBuilder;
  readonly claimBossParticipationNft: () => MethodBuilder;
  readonly claimDailyReward: () => MethodBuilder;
}

const CONFIRM_OPTIONS: ConfirmOptions = {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
};

export function createConnection(): Connection {
  return new Connection(SOLANA_RPC_URL, "confirmed");
}

export function createPackrunProgram(wallet?: AnchorWallet): PackrunProgram {
  const connection = createConnection();
  const provider: Provider = wallet
    ? new AnchorProvider(connection, wallet, CONFIRM_OPTIONS)
    : { connection };

  const idl = {
    ...packrunIdl,
    address: PACKRUN_PROGRAM_ID,
  } as Idl;

  return new Program(idl, provider) as PackrunProgram;
}
