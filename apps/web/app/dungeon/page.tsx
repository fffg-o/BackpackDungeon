"use client";

import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WalletButton } from "./wallet-button";
import { BattleArena } from "./components/BattleArena";
import { BattleOverlay, type BattleOverlayPhase } from "./components/battle/BattleOverlay";
import { BackpackManagerModal } from "./components/backpack/BackpackManagerModal";
import { StatPill } from "./components/StatPill";
import { useBackpackInventory } from "./hooks/useBackpackInventory";
import { useI18n } from "../i18n/useI18n";
import {
  buildBattleInput,
  buildLocationMerkleTree,
  computePlayerBattleStats,
  createBackpackItemFromShopSlot,
  createBackpackItemFromTreasure,
  createDailyMapInput,
  generateDailyMap,
  getBackpackItemDefinition,
  getLocationProof,
  parseDailyMapRandomSeed,
  previewBackpackItemFromShopSlot,
  simulateBossBattle,
  simulateEnemyBattle,
  todayDayId,
  type BackpackItemDefinitionV1,
  type BattlePlayerSnapshotV1,
  type BattleResultV1,
  type BattleCombatantStatsV1,
  type DailyLocationSpec,
  type DailyMapInput,
} from "@backpack-dungeon/game-core";
import { LocationKind, RewardTier } from "@backpack-dungeon/shared";
import type { EnemyConfig, LocationKind as LocationKindType } from "@backpack-dungeon/shared";
import { createPackrunProgram } from "../../lib/solana/anchorClient";
import {
  fetchDailyDungeon,
  fetchPlayerRun,
  fetchPoiOnChainState,
  type DailyDungeonState,
  type PlayerRunState,
  type PoiOnChainState,
} from "../../lib/solana/dungeonQueries";
import {
  buyItem,
  claimBossParticipationNft,
  claimDailyReward,
  clearEnemy,
  enterDungeon,
  initBossDamageShard,
  initLocationFromMerkle,
  initShopItemSlot,
  submitBossDamage,
} from "../../lib/solana/dungeonTxs";
import { bossShardIndexForPlayer, locationPda, sha256Bytes32 } from "../../lib/solana/pdas";
import styles from "./dungeon.module.css";

const ENABLE_MANUAL_POI_INIT =
  process.env.NEXT_PUBLIC_ENABLE_MANUAL_POI_INIT !== "false";

interface PoiDetail {
  readonly spec: DailyLocationSpec;
  readonly onChain: PoiOnChainState | null;
  readonly merkleProof: ReturnType<typeof getLocationProof>;
  readonly loading: boolean;
  readonly error?: string;
}

type TxPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "submitting" }
  | { readonly phase: "success"; readonly signature: string }
  | { readonly phase: "error"; readonly message: string };

type BattlePhase =
  | { readonly phase: "idle" }
  | { readonly phase: "preparing" }
  | {
      readonly phase: "replaying";
      readonly result: BattleResultV1;
      readonly replayIndex: number;
      readonly inputClearCount: number;
    }
  | { readonly phase: "result"; readonly result: BattleResultV1; readonly inputClearCount: number }
  | { readonly phase: "submitting" }
  | { readonly phase: "success"; readonly signature: string; readonly result?: BattleResultV1 }
  | { readonly phase: "error"; readonly message: string };

type ShopActionPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "initializingSlot"; readonly slotIndex: number }
  | { readonly phase: "buying"; readonly slotIndex: number }
  | { readonly phase: "bought"; readonly slotIndex: number; readonly signature: string }
  | { readonly phase: "slotInitialized"; readonly slotIndex: number; readonly signature: string }
  | { readonly phase: "error"; readonly message: string };

type BossBattlePhase =
  | { readonly phase: "idle" }
  | { readonly phase: "preparing" }
  | {
      readonly phase: "replaying";
      readonly result: BattleResultV1;
      readonly replayIndex: number;
      readonly damage: number;
    }
  | { readonly phase: "result"; readonly result: BattleResultV1; readonly damage: number }
  | { readonly phase: "submitting" }
  | { readonly phase: "success"; readonly damage: number; readonly signature: string; readonly result?: BattleResultV1 }
  | { readonly phase: "error"; readonly message: string };

type TxPending =
  | null
  | "enterDungeon"
  | "initLocation"
  | "clearEnemy"
  | "initBossShard"
  | "submitBossDamage"
  | "claimBossNft"
  | "claimDailyReward"
  | `initShopSlot:${number}`
  | `buyItem:${number}`;

interface DungeonToast {
  readonly id: number;
  readonly title: string;
  readonly message?: string;
  readonly signature?: string;
  readonly variant?: "success" | "warning" | "error";
}

const MAP_INPUT: DailyMapInput = createDailyMapInput({
  dayId: process.env.NEXT_PUBLIC_PACKRUN_DAY_ID || todayDayId(),
  randomSeed: parseDailyMapRandomSeed(process.env.NEXT_PUBLIC_PACKRUN_RANDOM_SEED),
});

const ENEMY_CLEAR_ENERGY_COST = 5;
const DEFAULT_ENEMY_CLEAR_GOLD_REWARD = 10;
const DEFAULT_TREASURE_GOLD_REWARD = 25;
const EXPLORER_CLUSTER = "devnet";
const BATTLE_REPLAY_STEP_MS = 450;
const MINIMUM_BOSS_NFT_DAMAGE = 1;

const POI_ICONS: Record<LocationKindType, string> = {
  [LocationKind.Enemy]: "⚔️",
  [LocationKind.Shop]: "🛒",
  [LocationKind.Treasure]: "💎",
  [LocationKind.Boss]: "👑",
  [LocationKind.Event]: "❓",
};

const POI_COLORS: Record<LocationKindType, string> = {
  [LocationKind.Enemy]: "#e74c3c",
  [LocationKind.Shop]: "#f39c12",
  [LocationKind.Treasure]: "#9b59b6",
  [LocationKind.Boss]: "#c0392b",
  [LocationKind.Event]: "#95a5a6",
};

function formatCooldown(seconds: number, readyLabel = "Ready"): string {
  if (seconds <= 0) return readyLabel;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}

function rewardTierColor(tier: string): string {
  const colors: Record<string, string> = {
    Common: "#b0b0b0",
    Uncommon: "#2ecc71",
    Rare: "#3498db",
    Epic: "#9b59b6",
    Legendary: "#f1c40f",
  };
  return colors[tier] ?? "#b0b0b0";
}

function getCooldownSeconds(onChain: PoiOnChainState | null): number {
  if (!onChain?.nextAvailableAt) return 0;
  return Math.max(0, onChain.nextAvailableAt - Math.floor(Date.now() / 1000));
}

function isOnCooldown(onChain: PoiOnChainState | null): boolean {
  return getCooldownSeconds(onChain) > 0;
}

function shortSignature(signature: string): string {
  return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
}

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${EXPLORER_CLUSTER}`;
}

function formatNextAvailable(nextAvailableAt: number | undefined, readyLabel = "Ready"): string {
  if (!nextAvailableAt || nextAvailableAt <= 0) return readyLabel;
  if (nextAvailableAt <= Math.floor(Date.now() / 1000)) return readyLabel;

  return new Date(nextAvailableAt * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDurationSeconds(totalSeconds: number | undefined, notScheduledLabel = "Not scheduled"): string {
  if (!totalSeconds || totalSeconds <= 0) return notScheduledLabel;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatGold(value: number): string {
  return Math.max(0, value).toLocaleString();
}

function computeEnemyClearGoldReward(baseLevel: number, clearCountAfter: number): number {
  return DEFAULT_ENEMY_CLEAR_GOLD_REWARD + baseLevel + clearCountAfter;
}

function shopPurchaseSourceRef(
  dayId: string,
  poiId: string,
  slotIndex: number,
  txSignature: string,
): string {
  return `${dayId}:${poiId}:${slotIndex}:${txSignature}`;
}

function treasureSourceRef(spec: DailyLocationSpec): string {
  return bytesToHex(sha256Bytes32(spec.id));
}

function locationPdaLabel(dayId: string, spec: DailyLocationSpec): string {
  return locationPda(dayId, sha256Bytes32(spec.id))[0].toBase58();
}

function itemIcon(definition: BackpackItemDefinitionV1): string {
  const icons: Readonly<Record<string, string>> = {
    armor: "🛡️",
    bomb: "💣",
    charm: "✨",
    dagger: "🗡️",
    key: "🔑",
    potion: "🧪",
    ration: "🥫",
    ruby: "💎",
    shield: "🛡️",
    ward: "🔷",
  };
  return icons[definition.icon] ?? definition.icon;
}

function itemEffectSummary(definition: BackpackItemDefinitionV1): string {
  if (definition.effects.length === 0) return definition.description;
  return definition.effects.map((effect) => effect.description).join(" ");
}

function shopRestockInfo(
  stockInfo: NonNullable<PoiOnChainState["stock"]>[number] | undefined,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (!stockInfo?.initialized) return t("shop.restockUninitialized");
  const epoch = stockInfo.restockEpoch ?? 0;
  const interval = formatDurationSeconds(stockInfo.restockIntervalSeconds, t("common.notScheduled"));
  return t("shop.restockInfo", { epoch, interval });
}

function shopStockLabel(
  stockInfo: NonNullable<PoiOnChainState["stock"]>[number] | undefined,
  fallbackStock: number,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (!stockInfo?.initialized) return t("shop.baseStock", { stock: fallbackStock });
  const available = stockInfo.availableStock ?? stockInfo.available ?? 0;
  const maxStock = stockInfo.maxStock ?? fallbackStock;
  return `${available} / ${maxStock}`;
}

function shopTileStock(onChain: PoiOnChainState | null): string | null {
  const stockEntries = Object.values(onChain?.stock ?? {});
  if (stockEntries.length === 0) return null;
  const available = stockEntries.reduce(
    (total, entry) => total + (entry.availableStock ?? entry.available ?? 0),
    0,
  );
  return `${stockEntries.length}/${available}`;
}

function locationKindLabel(
  kind: LocationKindType,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (kind === LocationKind.Enemy) return t("dungeon.labels.enemy");
  if (kind === LocationKind.Shop) return t("dungeon.labels.shop");
  if (kind === LocationKind.Treasure) return t("dungeon.labels.treasure");
  if (kind === LocationKind.Boss) return t("dungeon.labels.boss");
  return t("dungeon.labels.event");
}

function shopTxKey(kind: "initShopSlot" | "buyItem", slotIndex: number): TxPending {
  return `${kind}:${slotIndex}`;
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    // Handle wallet rejection errors (plain objects like { code: 4001, message: "..." })
    if ("message" in error && typeof (error as Record<string, unknown>).message === "string") {
      return (error as Record<string, unknown>).message as string;
    }
    try {
      const str = String(error);
      if (str !== "[object Object]") return str;
    } catch {
      // fall through
    }
  }
  if (typeof error === "string") return error;
  return fallback;
}

function buildPlayerSnapshot(playerRun: PlayerRunState): BattlePlayerSnapshotV1 {
  return {
    energy: playerRun.energy,
    clearedLocations: playerRun.clearedLocations,
    bossDamage: playerRun.bossDamage,
    itemsPurchased: playerRun.itemsPurchased,
    commonLootCount: playerRun.commonLootCount,
    rareEligibilityPoints: playerRun.rareEligibilityPoints,
  };
}

function bytesToHex(bytes: readonly number[] | Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getRulesetHash(dailyDungeon: DailyDungeonState | null): string | undefined {
  const hash = (dailyDungeon as (DailyDungeonState & { readonly rulesetHash?: string }) | null)
    ?.rulesetHash;
  return typeof hash === "string" && hash.length > 0 ? hash : undefined;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function toEnemyOverlayPhase(phase: BattlePhase): BattleOverlayPhase {
  if (phase.phase === "idle") return { phase: "setup" };
  if (phase.phase === "preparing") return { phase: "preparing" };
  if (phase.phase === "replaying") {
    return {
      phase: "replaying",
      replayIndex: phase.replayIndex,
      result: phase.result,
    };
  }
  if (phase.phase === "result") return { phase: "result", result: phase.result };
  if (phase.phase === "submitting") return { phase: "submitting" };
  if (phase.phase === "success") {
    return { phase: "success", signature: phase.signature, result: phase.result };
  }
  return { phase: "error", message: phase.message };
}

function toBossOverlayPhase(phase: BossBattlePhase): BattleOverlayPhase {
  if (phase.phase === "idle") return { phase: "setup" };
  if (phase.phase === "preparing") return { phase: "preparing" };
  if (phase.phase === "replaying") {
    return {
      phase: "replaying",
      replayIndex: phase.replayIndex,
      result: phase.result,
    };
  }
  if (phase.phase === "result") return { phase: "result", result: phase.result };
  if (phase.phase === "submitting") return { phase: "submitting" };
  if (phase.phase === "success") {
    return { phase: "success", signature: phase.signature, result: phase.result };
  }
  return { phase: "error", message: phase.message };
}

function buildEnemyCombatantStats(
  enemy: Pick<EnemyConfig, "attack" | "level" | "maxHealth" | "rewardTier">,
  onChain: PoiOnChainState | null,
): BattleCombatantStatsV1 {
  const level = onChain?.difficultyLevel ?? enemy.level;
  const attack = onChain?.baseDamage ?? enemy.attack;
  const maxHealth = onChain?.baseHp ?? enemy.maxHealth;
  const rank = rewardTierRank(enemy.rewardTier);

  return {
    attack,
    critBps: clampBps(800 + level * 35 + rank * 150),
    defense: Math.max(0, level + Math.floor(attack / 4) + rank * 2),
    dodgeBps: clampBps(500 + level * 25 + rank * 100),
    maxHealth,
    speed: 90 + level * 3 + rank * 4,
  };
}

function buildBossCombatantStats(
  boss: NonNullable<DailyLocationSpec["boss"]>,
  onChain: PoiOnChainState | null,
): BattleCombatantStatsV1 {
  return buildEnemyCombatantStats(
    {
      attack: onChain?.baseDamage ?? boss.attack,
      level: boss.level,
      maxHealth: onChain?.bossHp ?? boss.maxHealth,
      rewardTier: boss.rewardTier,
    },
    null,
  );
}

function rewardTierRank(tier: RewardTier): number {
  return [
    RewardTier.Common,
    RewardTier.Uncommon,
    RewardTier.Rare,
    RewardTier.Epic,
    RewardTier.Legendary,
  ].indexOf(tier);
}

function normalizeRewardTier(value: string | undefined, fallback: RewardTier): RewardTier {
  return Object.values(RewardTier).includes(value as RewardTier)
    ? (value as RewardTier)
    : fallback;
}

function clampBps(value: number): number {
  return Math.max(0, Math.min(10_000, value));
}

export default function DailyDungeonPage() {
  const { t } = useI18n();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const publicKey = wallet.publicKey;
  const publicKeyString = publicKey?.toBase58() ?? null;
  const program = useMemo(() => createPackrunProgram(anchorWallet ?? undefined), [anchorWallet]);

  const [dailyDungeon, setDailyDungeon] = useState<DailyDungeonState | null>(null);
  const [dungeonLoading, setDungeonLoading] = useState(true);
  const [dungeonError, setDungeonError] = useState<string | null>(null);
  const [playerRun, setPlayerRun] = useState<PlayerRunState | null>(null);
  const [playerRunLoading, setPlayerRunLoading] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<PoiDetail | null>(null);
  const [selectedPoiState, setSelectedPoiState] = useState<PoiOnChainState | null>(null);
  const [loadingChainState, setLoadingChainState] = useState(false);
  const [txPending, setTxPending] = useState<TxPending>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [hoveredPoi, setHoveredPoi] = useState<DailyLocationSpec | null>(null);
  const [poiChainStates, setPoiChainStates] = useState<Readonly<Record<string, PoiOnChainState>>>({});
  const [enterPhase, setEnterPhase] = useState<TxPhase>({ phase: "idle" });
  const [initLocationPhase, setInitLocationPhase] = useState<TxPhase>({ phase: "idle" });
  const [battlePhase, setBattlePhase] = useState<BattlePhase>({ phase: "idle" });
  const [shopActionPhase, setShopActionPhase] = useState<ShopActionPhase>({ phase: "idle" });
  const [bossBattlePhase, setBossBattlePhase] = useState<BossBattlePhase>({ phase: "idle" });
  const [dailyRewardPhase, setDailyRewardPhase] = useState<TxPhase>({ phase: "idle" });
  const [bossNftClaimPhase, setBossNftClaimPhase] = useState<TxPhase>({ phase: "idle" });
  const [battleOverlayTarget, setBattleOverlayTarget] = useState<"enemy" | "boss" | null>(null);
  const [backpackOpen, setBackpackOpen] = useState(false);
  const [toast, setToast] = useState<DungeonToast | null>(null);

  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const battleReplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bossReplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearBattleReplayTimer = useCallback(() => {
    if (battleReplayTimerRef.current) {
      clearTimeout(battleReplayTimerRef.current);
      battleReplayTimerRef.current = null;
    }
  }, []);

  const clearBossReplayTimer = useCallback(() => {
    if (bossReplayTimerRef.current) {
      clearTimeout(bossReplayTimerRef.current);
      bossReplayTimerRef.current = null;
    }
  }, []);

  const clearToastTimer = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const pushToast = useCallback(
    (nextToast: Omit<DungeonToast, "id">) => {
      clearToastTimer();
      setToast({
        id: Date.now(),
        ...nextToast,
      });
      toastTimerRef.current = setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
      }, 7000);
    },
    [clearToastTimer],
  );

  useEffect(() => {
    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      clearBattleReplayTimer();
      clearBossReplayTimer();
      clearToastTimer();
    };
  }, [clearBattleReplayTimer, clearBossReplayTimer, clearToastTimer]);

  const map = useMemo(() => generateDailyMap(MAP_INPUT), []);
  const merkleTree = useMemo(() => buildLocationMerkleTree(map.locations), [map]);
  const {
    inventory,
    layout,
    backpackSnapshot,
    addAndAutoPlaceItem,
    moveItem,
    rotateItem,
    autoPack,
    resetBackpack,
    hasItemSource,
  } = useBackpackInventory(map.dayId, publicKeyString);

  const poiByPos = useMemo(() => {
    const lookup = new Map<string, DailyLocationSpec>();
    for (const loc of map.locations) {
      lookup.set(`${loc.position.x},${loc.position.y}`, loc);
    }
    return lookup;
  }, [map]);

  const grid = useMemo(() => {
    const cells: { readonly x: number; readonly y: number; readonly poi: DailyLocationSpec | null }[] = [];
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        cells.push({ x, y, poi: poiByPos.get(`${x},${y}`) ?? null });
      }
    }
    return cells;
  }, [map, poiByPos]);

  const bossLocations = useMemo(
    () => map.locations.filter((location) => location.kind === LocationKind.Boss),
    [map.locations],
  );
  const primaryBossId = bossLocations[0]?.id ?? null;
  const hasDeprecatedMultiBossMap = bossLocations.length > 1;

  const selectedBossShardIndex = useMemo(() => {
    if (!publicKey || !dailyDungeon?.bossShardCount) return null;
    return bossShardIndexForPlayer(publicKey, dailyDungeon.bossShardCount);
  }, [dailyDungeon?.bossShardCount, publicKey, publicKeyString]);

  const refreshDailyDungeon = useCallback(async () => {
    setDungeonLoading(true);
    setLoadingChainState(true);
    setDungeonError(null);
    try {
      const dungeon = await fetchDailyDungeon(program, map.dayId);
      setDailyDungeon(dungeon);
      setChainError((current) => {
        if (dungeon) return current?.startsWith("DailyDungeon account not found") ? null : current;
        return t("dungeon.errors.dailyDungeonMissing", { dayId: map.dayId });
      });
    } catch (error) {
      setDungeonError(formatError(error, t("dungeon.errors.fetchDailyDungeon")));
      setChainError(formatError(error, t("dungeon.errors.fetchDailyDungeonAccount")));
      setDailyDungeon(null);
    } finally {
      setDungeonLoading(false);
      setLoadingChainState(false);
    }
  }, [program, map.dayId, t]);

  const refreshPlayerRun = useCallback(async (): Promise<PlayerRunState | null> => {
    if (!publicKey) {
      setPlayerRun(null);
      return null;
    }

    setPlayerRunLoading(true);
    setLoadingChainState(true);
    try {
      const nextPlayerRun = await fetchPlayerRun(program, map.dayId, publicKey);
      setPlayerRun(nextPlayerRun);
      return nextPlayerRun;
    } catch (error) {
      setChainError(formatError(error, t("dungeon.errors.fetchPlayerRun")));
      return null;
    } finally {
      setPlayerRunLoading(false);
      setLoadingChainState(false);
    }
  }, [program, map.dayId, publicKey, publicKeyString, t]);

  const loadPoiState = useCallback(
    async (
      spec: DailyLocationSpec,
      merkleProof: ReturnType<typeof getLocationProof>,
    ): Promise<PoiOnChainState | null> => {
      setLoadingChainState(true);
      setSelectedPoiState(null);
      setSelectedPoi((current) => ({
        spec,
        merkleProof,
        onChain: current?.spec.id === spec.id ? current.onChain : null,
        loading: true,
      }));

      try {
        const onChain = await fetchPoiOnChainState(
          program,
          map.dayId,
          spec,
          publicKey ?? undefined,
        );
        setSelectedPoiState(onChain);
        setSelectedPoi((current) =>
          current?.spec.id === spec.id
            ? { spec, merkleProof, onChain, loading: false }
            : current,
        );
        setPoiChainStates((current) => ({
          ...current,
          [spec.id]: onChain,
        }));
        return onChain;
      } catch (error) {
        setSelectedPoi((current) =>
          current?.spec.id === spec.id
            ? {
                spec,
                merkleProof,
                onChain: current.onChain,
                loading: false,
                error: formatError(error, t("dungeon.errors.fetchPoi")),
              }
            : current,
        );
        setSelectedPoiState(null);
        setChainError(formatError(error, t("dungeon.errors.fetchSelectedPoi")));
        return null;
      } finally {
        setLoadingChainState(false);
      }
    },
    [program, map.dayId, publicKey, publicKeyString, t],
  );

  const refreshSelectedPoiState = useCallback(async (): Promise<PoiOnChainState | null> => {
    if (!selectedPoi) return null;
    return loadPoiState(selectedPoi.spec, selectedPoi.merkleProof);
  }, [selectedPoi, loadPoiState]);

  const refreshMapPoiStates = useCallback(async () => {
    const entries = await Promise.all(
      map.locations.map(async (spec) => {
        try {
          const onChain = await fetchPoiOnChainState(
            program,
            map.dayId,
            spec,
            publicKey ?? undefined,
          );
          return [spec.id, onChain] as const;
        } catch {
          return [spec.id, null] as const;
        }
      }),
    );

    setPoiChainStates(
      Object.fromEntries(entries.filter((entry): entry is readonly [string, PoiOnChainState] => entry[1] !== null)),
    );
  }, [map.dayId, map.locations, program, publicKey, publicKeyString]);

  const refreshAfterTx = useCallback(async () => {
    await Promise.all([refreshDailyDungeon(), refreshPlayerRun(), refreshMapPoiStates()]);
    await refreshSelectedPoiState();
  }, [refreshDailyDungeon, refreshMapPoiStates, refreshPlayerRun, refreshSelectedPoiState]);

  useEffect(() => {
    void refreshDailyDungeon();
  }, [refreshDailyDungeon]);

  useEffect(() => {
    void refreshPlayerRun();
  }, [refreshPlayerRun]);

  useEffect(() => {
    void refreshMapPoiStates();
  }, [refreshMapPoiStates]);

  useEffect(() => {
    if (battlePhase.phase !== "replaying") {
      clearBattleReplayTimer();
      return;
    }

    if (battlePhase.replayIndex >= battlePhase.result.log.length - 1) {
      setBattlePhase({
        phase: "result",
        result: battlePhase.result,
        inputClearCount: battlePhase.inputClearCount,
      });
      return;
    }

    battleReplayTimerRef.current = setTimeout(() => {
      setBattlePhase((current) => {
        if (current.phase !== "replaying") return current;
        return {
          ...current,
          replayIndex: Math.min(current.replayIndex + 1, current.result.log.length - 1),
        };
      });
    }, BATTLE_REPLAY_STEP_MS);

    return () => clearBattleReplayTimer();
  }, [battlePhase, clearBattleReplayTimer]);

  useEffect(() => {
    if (battlePhase.phase !== "result" && battlePhase.phase !== "replaying") return;
    if (selectedPoi?.spec.kind !== LocationKind.Enemy) return;
    if (selectedPoiState?.clearCount === undefined) return;
    if (battlePhase.inputClearCount === selectedPoiState.clearCount) return;

    clearBattleReplayTimer();
    setBattlePhase({ phase: "idle" });
  }, [
    battlePhase,
    clearBattleReplayTimer,
    selectedPoi?.spec.kind,
    selectedPoiState?.clearCount,
  ]);

  useEffect(() => {
    if (bossBattlePhase.phase !== "replaying") {
      clearBossReplayTimer();
      return;
    }

    if (bossBattlePhase.replayIndex >= bossBattlePhase.result.log.length - 1) {
      setBossBattlePhase({
        phase: "result",
        result: bossBattlePhase.result,
        damage: bossBattlePhase.damage,
      });
      return;
    }

    bossReplayTimerRef.current = setTimeout(() => {
      setBossBattlePhase((current) => {
        if (current.phase !== "replaying") return current;
        return {
          ...current,
          replayIndex: Math.min(current.replayIndex + 1, current.result.log.length - 1),
        };
      });
    }, BATTLE_REPLAY_STEP_MS);

    return () => clearBossReplayTimer();
  }, [bossBattlePhase, clearBossReplayTimer]);

  useEffect(() => {
    clearBattleReplayTimer();
    clearBossReplayTimer();
    setBattlePhase({ phase: "idle" });
    setBossBattlePhase({ phase: "idle" });
    setBattleOverlayTarget(null);
    if (selectedPoi) {
      void loadPoiState(selectedPoi.spec, selectedPoi.merkleProof);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKeyString]);

  const handlePoiClick = useCallback(
    (spec: DailyLocationSpec) => {
      const proof = getLocationProof(map.locations, spec.id);
      clearBattleReplayTimer();
      clearBossReplayTimer();
      setBattlePhase({ phase: "idle" });
      setShopActionPhase({ phase: "idle" });
      setBossBattlePhase({ phase: "idle" });
      setDailyRewardPhase({ phase: "idle" });
      setBossNftClaimPhase({ phase: "idle" });
      setInitLocationPhase({ phase: "idle" });
      setBattleOverlayTarget(null);
      setSelectedPoiState(null);
      setTxSignature(null);
      void loadPoiState(spec, proof);
    },
    [clearBattleReplayTimer, clearBossReplayTimer, map.locations, loadPoiState],
  );

  const requireWallet = useCallback(() => {
    if (!publicKey || !anchorWallet) {
      throw new Error(t("wallet.connectFirst"));
    }
    return {
      player: publicKey,
      signingProgram: createPackrunProgram(anchorWallet),
    };
  }, [anchorWallet, publicKey, t]);

  const showBattleResult = useCallback(
    (result: BattleResultV1, inputClearCount: number) => {
      clearBattleReplayTimer();
      if (prefersReducedMotion() || result.log.length === 0) {
        setBattlePhase({ phase: "result", result, inputClearCount });
        return;
      }

      setBattlePhase({ phase: "replaying", result, replayIndex: 0, inputClearCount });
    },
    [clearBattleReplayTimer],
  );

  const showBossBattleResult = useCallback(
    (result: BattleResultV1) => {
      clearBossReplayTimer();
      const damage = result.bossDamageScore;
      if (prefersReducedMotion() || result.log.length === 0) {
        setBossBattlePhase({ phase: "result", result, damage });
        return;
      }

      setBossBattlePhase({ phase: "replaying", result, replayIndex: 0, damage });
    },
    [clearBossReplayTimer],
  );

  const handleEnterDungeon = useCallback(async () => {
    setEnterPhase({ phase: "submitting" });
    setTxPending("enterDungeon");
    setTxSignature(null);
    setChainError(null);
    try {
      const { player, signingProgram } = requireWallet();
      const signature = await enterDungeon(signingProgram, map.dayId, player);
      setEnterPhase({ phase: "success", signature });
      setTxSignature(signature);
      await refreshAfterTx();
    } catch (error) {
      const message = formatError(error, t("dungeon.errors.enterDungeon"));
      setEnterPhase({ phase: "error", message });
      setChainError(message);
    } finally {
      setTxPending(null);
    }
  }, [map.dayId, refreshAfterTx, requireWallet, t]);

  const handleInitLocation = useCallback(async () => {
    if (!selectedPoi) return;
    setInitLocationPhase({ phase: "submitting" });
    setTxPending("initLocation");
    setTxSignature(null);
    setChainError(null);
    try {
      const { player, signingProgram } = requireWallet();
      const signature = await initLocationFromMerkle(
        signingProgram,
        map.dayId,
        selectedPoi.spec,
        selectedPoi.merkleProof,
        player,
      );
      setInitLocationPhase({ phase: "success", signature });
      setTxSignature(signature);
      await refreshAfterTx();
    } catch (error) {
      const message = formatError(error, t("dungeon.errors.initializeLocation"));
      setInitLocationPhase({
        phase: "error",
        message,
      });
      setChainError(message);
    } finally {
      setTxPending(null);
    }
  }, [map.dayId, refreshAfterTx, requireWallet, selectedPoi, t]);

  const handleStartBattle = useCallback(() => {
    clearBattleReplayTimer();
    setBattlePhase({ phase: "preparing" });

    try {
      if (txPending !== null) throw new Error(t("dungeon.errors.transactionPending"));
      if (!publicKey) throw new Error(t("wallet.connectFirst"));
      if (!playerRun) throw new Error(t("dungeon.errors.enterFirst"));
      if (!selectedPoi?.spec.enemy) throw new Error(t("dungeon.errors.noEnemy"));

      const onChain = selectedPoiState;
      if (!onChain?.initialized) throw new Error(t("dungeon.actions.initializeLocation"));
      if (isOnCooldown(onChain)) {
        throw new Error(`${t("battle.clearEnemy")} ${t("common.cooldown")} ${formatCooldown(getCooldownSeconds(onChain), t("common.ready"))}.`);
      }
      if (playerRun.energy < ENEMY_CLEAR_ENERGY_COST) {
        throw new Error(t("dungeon.errors.notEnoughEnergy"));
      }

      const clearCount = selectedPoiState?.clearCount ?? 0;
      const input = buildBattleInput({
        encounterKind: "enemy",
        dayId: map.dayId,
        mapRoot: merkleTree.root,
        rulesetHash: getRulesetHash(dailyDungeon),
        player: publicKey.toBase58(),
        poiId: selectedPoi.spec.id,
        poiIdHash: bytesToHex(sha256Bytes32(selectedPoi.spec.id)),
        enemyConfig: selectedPoi.spec.enemy,
        clearCount,
        attemptIndex: (playerRun?.clearedLocations ?? 0) + clearCount,
        playerSnapshot: buildPlayerSnapshot(playerRun),
        backpack: backpackSnapshot,
      });
      const result = simulateEnemyBattle(input, selectedPoi.spec.enemy);

      showBattleResult(result, clearCount);
    } catch (error) {
      setBattlePhase({ phase: "error", message: formatError(error, t("dungeon.errors.startBattle")) });
    }
  }, [
    clearBattleReplayTimer,
    backpackSnapshot,
    dailyDungeon,
    map.dayId,
    merkleTree.root,
    playerRun,
    publicKey,
    selectedPoi,
    selectedPoiState,
    showBattleResult,
    txPending,
    t,
  ]);

  const handleClearEnemy = useCallback(async () => {
    if (!selectedPoi?.spec.enemy) return;
    const onChain = selectedPoiState;
    if (!onChain?.initialized) return;
    const battle = battlePhase;
    if (battle.phase !== "result" || !battle.result.won) return;
    if (battle.inputClearCount !== (selectedPoiState?.clearCount ?? 0)) {
      setBattlePhase({ phase: "idle" });
      return;
    }

    setBattlePhase({ phase: "submitting" });
    setTxPending("clearEnemy");
    setTxSignature(null);
    setChainError(null);
    try {
      const { player, signingProgram } = requireWallet();
      const goldReward = computeEnemyClearGoldReward(
        selectedPoi.spec.enemy.level,
        (selectedPoiState?.clearCount ?? 0) + 1,
      );
      const signature = await clearEnemy(
        signingProgram,
        map.dayId,
        selectedPoi.spec,
        player,
        battle.result,
      );
      setTxSignature(signature);
      const [, nextPlayerRun] = await Promise.all([
        refreshDailyDungeon(),
        refreshPlayerRun(),
        refreshSelectedPoiState(),
      ]);
      clearBattleReplayTimer();
      setBattlePhase({ phase: "success", signature, result: battle.result });
      pushToast({
        title: t("dungeon.gold.reward", { amount: goldReward }),
        message: nextPlayerRun?.hasGoldBalance
          ? `${t("dungeon.gold.label")} ${formatGold(nextPlayerRun.goldBalance)}`
          : t("dungeon.gold.balanceAfterReenter"),
        signature,
        variant: "success",
      });
    } catch (error) {
      const message = formatError(error, t("dungeon.errors.submitEnemyClear"));
      setBattlePhase({
        phase: "error",
        message,
      });
      setChainError(message);
    } finally {
      setTxPending(null);
    }
  }, [
    battlePhase,
    clearBattleReplayTimer,
    map.dayId,
    refreshDailyDungeon,
    refreshPlayerRun,
    refreshSelectedPoiState,
    requireWallet,
    pushToast,
    selectedPoi,
    selectedPoiState,
    t,
  ]);

  const handleRetry = useCallback(() => {
    clearBattleReplayTimer();
    setBattlePhase({ phase: "idle" });
  }, [clearBattleReplayTimer]);

  const handleBossRetry = useCallback(() => {
    clearBossReplayTimer();
    setBossBattlePhase({ phase: "idle" });
  }, [clearBossReplayTimer]);

  const handleOpenBattleOverlay = useCallback(() => {
    clearBattleReplayTimer();
    setBattlePhase({ phase: "idle" });
    setBattleOverlayTarget("enemy");
  }, [clearBattleReplayTimer]);

  const handleOpenBossOverlay = useCallback(() => {
    if (selectedPoi?.spec.kind === LocationKind.Boss && selectedPoi.spec.id !== primaryBossId) {
      setBossBattlePhase({
        phase: "error",
        message: t("dungeon.errors.deprecatedBossRaid"),
      });
      return;
    }

    clearBossReplayTimer();
    setBossBattlePhase({ phase: "idle" });
    setBattleOverlayTarget("boss");
  }, [clearBossReplayTimer, primaryBossId, selectedPoi, t]);

  const handleCloseBattleOverlay = useCallback(() => {
    if (
      (battleOverlayTarget === "enemy" && battlePhase.phase === "submitting") ||
      (battleOverlayTarget === "boss" && bossBattlePhase.phase === "submitting")
    ) {
      return;
    }

    setBattleOverlayTarget(null);
  }, [battleOverlayTarget, battlePhase.phase, bossBattlePhase.phase]);

  const handleInitShopSlot = useCallback(
    async (slotIndex: number) => {
      if (!selectedPoi?.spec.shop || !selectedPoi.onChain?.initialized) return;
      setShopActionPhase({ phase: "initializingSlot", slotIndex });
      setTxPending(shopTxKey("initShopSlot", slotIndex));
      setTxSignature(null);
      setChainError(null);
      try {
        const { player, signingProgram } = requireWallet();
        const signature = await initShopItemSlot(
          signingProgram,
          map.dayId,
          selectedPoi.spec,
          slotIndex,
          player,
        );
        setShopActionPhase({ phase: "slotInitialized", slotIndex, signature });
        setTxSignature(signature);
        await refreshAfterTx();
      } catch (error) {
        const message = formatError(error, t("dungeon.errors.initShopSlot"));
        setShopActionPhase({
          phase: "error",
          message,
        });
        setChainError(message);
      } finally {
        setTxPending(null);
      }
    },
    [map.dayId, refreshAfterTx, requireWallet, selectedPoi, t],
  );

  const handleBuyItem = useCallback(
    async (slotIndex: number) => {
      if (!selectedPoi?.spec.shop || !selectedPoi.onChain?.stock) return;
      if (!playerRun) {
        setShopActionPhase({ phase: "error", message: t("shop.enterBeforeBuying") });
        return;
      }

      const slot = selectedPoi.spec.shop.itemSlots[slotIndex];
      if (!slot) return;
      const stockInfo = selectedPoi.onChain.stock[slotIndex];
      const availableStock = stockInfo?.availableStock ?? stockInfo?.available ?? 0;
      if (!stockInfo?.initialized || !stockInfo.expectedPrice || availableStock <= 0) {
        return;
      }
      if (!playerRun.hasGoldBalance) {
        setShopActionPhase({
          phase: "error",
          message: t("dungeon.gold.migrationWarning"),
        });
        return;
      }
      const price = stockInfo.currentPrice ?? stockInfo.price ?? slot.price;
      if (playerRun.goldBalance < price) {
        setShopActionPhase({ phase: "error", message: t("shop.notEnoughGold") });
        return;
      }

      setShopActionPhase({ phase: "buying", slotIndex });
      setTxPending(shopTxKey("buyItem", slotIndex));
      setTxSignature(null);
      setChainError(null);
      try {
        const { player, signingProgram } = requireWallet();
        const signature = await buyItem(
          signingProgram,
          map.dayId,
          selectedPoi.spec,
          slotIndex,
          stockInfo.expectedPrice,
          player,
        );
        const purchasedSlot = {
          ...slot,
          itemId: stockInfo.itemId ?? slot.itemId,
          rewardTier: normalizeRewardTier(stockInfo.rewardTier, slot.rewardTier),
        };
        const sourceRef = shopPurchaseSourceRef(
          map.dayId,
          selectedPoi.spec.id,
          slotIndex,
          signature,
        );
        const purchasedItem = createBackpackItemFromShopSlot(purchasedSlot, {
          dayId: map.dayId,
          player: player.toBase58(),
          purchaseIndex: stockInfo.soldCount ?? slotIndex,
          sourceRef,
        });
        const placement = addAndAutoPlaceItem(purchasedItem);
        const definition = getBackpackItemDefinition(purchasedItem.definitionId);
        setShopActionPhase({ phase: "bought", slotIndex, signature });
        setTxSignature(signature);
        await refreshAfterTx();
        pushToast({
          title: t("shop.bought", { name: definition.name }),
          message: placement.placed
            ? t("backpack.added")
            : t("backpack.addedInventoryNoRoom"),
          signature,
          variant: placement.placed ? "success" : "warning",
        });
      } catch (error) {
        const message = formatError(error, t("dungeon.errors.purchaseFailed"));
        setShopActionPhase({ phase: "error", message });
        setChainError(message);
      } finally {
        setTxPending(null);
      }
    },
    [
      addAndAutoPlaceItem,
      map.dayId,
      playerRun,
      pushToast,
      refreshAfterTx,
      requireWallet,
      selectedPoi,
      t,
    ],
  );

  const handleStartBossBattle = useCallback(() => {
    clearBossReplayTimer();
    setBossBattlePhase({ phase: "preparing" });

    try {
      if (!publicKey) throw new Error(t("wallet.connectFirst"));
      if (!playerRun) throw new Error(t("dungeon.errors.enterFirst"));
      if (!selectedPoi?.spec.boss) throw new Error(t("dungeon.errors.noBoss"));
      if (selectedPoi.spec.id !== primaryBossId) {
        throw new Error(t("dungeon.errors.deprecatedBossRaid"));
      }

      const onChain = selectedPoiState ?? selectedPoi.onChain;
      if (!onChain?.initialized) throw new Error(t("dungeon.actions.initializeLocation"));

      const boss = selectedPoi.spec.boss;
      const bossAsEnemy: EnemyConfig = {
        id: boss.id,
        name: boss.name,
        level: boss.level,
        maxHealth: boss.maxHealth,
        attack: boss.attack,
        rewardTier: boss.rewardTier,
      };
      const input = buildBattleInput({
        encounterKind: "boss",
        dayId: map.dayId,
        mapRoot: merkleTree.root,
        rulesetHash: getRulesetHash(dailyDungeon),
        player: publicKey.toBase58(),
        poiId: selectedPoi.spec.id,
        poiIdHash: bytesToHex(sha256Bytes32(selectedPoi.spec.id)),
        enemyConfig: bossAsEnemy,
        clearCount: 0,
        attemptIndex: playerRun.bossDamage + playerRun.clearedLocations,
        playerSnapshot: buildPlayerSnapshot(playerRun),
        backpack: backpackSnapshot,
      });
      const result = simulateBossBattle(input, bossAsEnemy);

      showBossBattleResult(result);
    } catch (error) {
      setBossBattlePhase({
        phase: "error",
        message: formatError(error, t("dungeon.errors.startBossBattle")),
      });
    }
  }, [
    clearBossReplayTimer,
    backpackSnapshot,
    dailyDungeon,
    map.dayId,
    merkleTree.root,
    playerRun,
    publicKey,
    primaryBossId,
    selectedPoi,
    selectedPoiState,
    showBossBattleResult,
    t,
  ]);

  const handleInitBossShard = useCallback(async () => {
    if (!selectedPoi?.spec.boss || !selectedPoi.onChain?.initialized) return;
    if (selectedPoi.spec.id !== primaryBossId) {
      setBossBattlePhase({
        phase: "error",
        message: t("dungeon.errors.deprecatedBossShard"),
      });
      return;
    }
    if (!dailyDungeon) {
      setBossBattlePhase({ phase: "error", message: t("dungeon.errors.dungeonNotReady") });
      return;
    }

    setTxPending("initBossShard");
    setTxSignature(null);
    setChainError(null);
    try {
      const { player, signingProgram } = requireWallet();
      const shardIndex = bossShardIndexForPlayer(player, dailyDungeon.bossShardCount);
      const signature = await initBossDamageShard(
        signingProgram,
        map.dayId,
        selectedPoi.spec,
        shardIndex,
        player,
      );
      setTxSignature(signature);
      await refreshAfterTx();
    } catch (error) {
      const message = formatError(error, t("dungeon.errors.initBossShard"));
      setBossBattlePhase({ phase: "error", message });
      setChainError(message);
    } finally {
      setTxPending(null);
    }
  }, [dailyDungeon, map.dayId, primaryBossId, refreshAfterTx, requireWallet, selectedPoi, t]);

  const handleSubmitBossDamage = useCallback(async () => {
    if (!selectedPoi?.spec.boss) return;
    if (selectedPoi.spec.id !== primaryBossId) {
      setBossBattlePhase({
        phase: "error",
        message: t("dungeon.errors.deprecatedBossSubmit"),
      });
      return;
    }
    const onChain = selectedPoiState ?? selectedPoi.onChain;
    if (!onChain?.initialized) return;
    const bossBattle = bossBattlePhase;
    if (bossBattle.phase !== "result") return;
    if (bossBattle.result.bossDamageScore <= 0) {
      setBossBattlePhase({ phase: "error", message: t("dungeon.errors.bossDamagePositive") });
      return;
    }
    if (!dailyDungeon) {
      setBossBattlePhase({ phase: "error", message: t("dungeon.errors.dungeonNotReady") });
      return;
    }

    setBossBattlePhase({ phase: "submitting" });
    setTxPending("submitBossDamage");
    setTxSignature(null);
    setChainError(null);
    try {
      const { player, signingProgram } = requireWallet();
      const shardIndex = bossShardIndexForPlayer(player, dailyDungeon.bossShardCount);
      const shard = onChain.bossShards?.find((entry) => entry.index === shardIndex);
      if (!shard?.initialized) {
        throw new Error(t("dungeon.errors.bossShardMissing", { shardIndex }));
      }

      const damage = bossBattle.result.bossDamageScore;
      const signature = await submitBossDamage(
        signingProgram,
        map.dayId,
        selectedPoi.spec,
        player,
        damage,
        bossBattle.result,
        dailyDungeon.bossShardCount,
      );
      setTxSignature(signature);
      await refreshAfterTx();
      setBossBattlePhase({ phase: "success", damage, signature, result: bossBattle.result });
    } catch (error) {
      const message = formatError(error, t("dungeon.errors.submitBossDamage"));
      setBossBattlePhase({
        phase: "error",
        message,
      });
      setChainError(message);
    } finally {
      setTxPending(null);
    }
  }, [
    bossBattlePhase,
    dailyDungeon,
    map.dayId,
    primaryBossId,
    refreshAfterTx,
    requireWallet,
    selectedPoi,
    selectedPoiState,
    t,
  ]);

  const handleClaimBossNft = useCallback(async () => {
    if (!selectedPoi?.spec.boss || !selectedPoi.onChain?.initialized) return;
    if (selectedPoi.spec.id !== primaryBossId) {
      setBossNftClaimPhase({
        phase: "error",
        message: t("dungeon.errors.deprecatedBossClaim"),
      });
      return;
    }
    setBossNftClaimPhase({ phase: "submitting" });
    setTxPending("claimBossNft");
    setTxSignature(null);
    setChainError(null);
    try {
      const { player, signingProgram } = requireWallet();
      const signature = await claimBossParticipationNft(
        signingProgram,
        map.dayId,
        selectedPoi.spec,
        player,
      );
      setBossNftClaimPhase({ phase: "success", signature });
      setTxSignature(signature);
      await refreshAfterTx();
    } catch (error) {
      const message = formatError(error, t("dungeon.errors.claimBossNft"));
      setBossNftClaimPhase({
        phase: "error",
        message,
      });
      setChainError(message);
    } finally {
      setTxPending(null);
    }
  }, [map.dayId, primaryBossId, refreshAfterTx, requireWallet, selectedPoi, t]);

  const handleClaimDailyReward = useCallback(async () => {
    setDailyRewardPhase({ phase: "submitting" });
    setTxPending("claimDailyReward");
    setTxSignature(null);
    setChainError(null);
    try {
      if (!selectedPoi) throw new Error(t("dungeon.errors.noLocation"));
      const { player, signingProgram } = requireWallet();
      const poiIdHash = sha256Bytes32(selectedPoi.spec.id);
      const sourceRef = bytesToHex(poiIdHash);
      const signature = await claimDailyReward(signingProgram, map.dayId, player, poiIdHash);
      let localItemMessage = t("treasure.rewardClaimed");
      let toastVariant: DungeonToast["variant"] = "success";
      if (!hasItemSource("treasure", sourceRef)) {
        const treasureItem = createBackpackItemFromTreasure(
          {
            id: selectedPoi.spec.id,
            poiId: selectedPoi.spec.id,
            poiIdHash: sourceRef,
            rewardTier: selectedPoi.spec.rewardTier ?? RewardTier.Common,
            sourceRef,
          },
          {
            dayId: map.dayId,
            player: player.toBase58(),
            sourceRef,
          },
        );
        const placement = addAndAutoPlaceItem(treasureItem);
        localItemMessage = placement.placed
          ? t("backpack.added")
          : t("backpack.addedInventoryNoRoom");
        toastVariant = placement.placed ? "success" : "warning";
      }
      setDailyRewardPhase({ phase: "success", signature });
      setTxSignature(signature);
      await refreshAfterTx();
      pushToast({
        title: t("dungeon.gold.reward", { amount: DEFAULT_TREASURE_GOLD_REWARD }),
        message: localItemMessage,
        signature,
        variant: toastVariant,
      });
    } catch (error) {
      const message = formatError(error, t("dungeon.errors.claimDailyReward"));
      setDailyRewardPhase({
        phase: "error",
        message,
      });
      setChainError(message);
    } finally {
      setTxPending(null);
    }
  }, [
    addAndAutoPlaceItem,
    hasItemSource,
    map.dayId,
    pushToast,
    refreshAfterTx,
    requireWallet,
    selectedPoi,
    t,
  ]);

  const handleRestoreTreasureItem = useCallback(() => {
    if (!selectedPoi) return;

    try {
      if (!publicKeyString) throw new Error(t("wallet.connectFirst"));
      const sourceRef = treasureSourceRef(selectedPoi.spec);
      if (hasItemSource("treasure", sourceRef)) {
        pushToast({
          title: t("backpack.alreadyRestored"),
          variant: "warning",
        });
        return;
      }

      const treasureItem = createBackpackItemFromTreasure(
        {
          id: selectedPoi.spec.id,
          poiId: selectedPoi.spec.id,
          poiIdHash: sourceRef,
          rewardTier: selectedPoi.spec.rewardTier ?? RewardTier.Common,
          sourceRef,
        },
        {
          dayId: map.dayId,
          player: publicKeyString,
          sourceRef,
        },
      );
      const placement = addAndAutoPlaceItem(treasureItem);
      pushToast({
        title: t("backpack.restoredLocal"),
        message: placement.placed ? t("backpack.added") : t("backpack.addedInventoryNoRoom"),
        variant: placement.placed ? "success" : "warning",
      });
    } catch (error) {
      pushToast({
        title: formatError(error, t("dungeon.errors.restoreTreasure")),
        variant: "error",
      });
    }
  }, [
    addAndAutoPlaceItem,
    hasItemSource,
    map.dayId,
    publicKeyString,
    pushToast,
    selectedPoi,
    t,
  ]);

  const dungeonStatus = dungeonLoading
    ? t("dungeon.status.loading")
    : dailyDungeon
      ? dailyDungeon.status
      : t("dungeon.status.notInitialized");
  const rootMatches = !dailyDungeon || dailyDungeon.mapRoot === merkleTree.root;
  const selectedOnChain = selectedPoiState ?? selectedPoi?.onChain ?? null;
  const selectedEnemy = selectedPoi?.spec.kind === LocationKind.Enemy ? selectedPoi.spec.enemy : undefined;
  const selectedBoss =
    selectedPoi?.spec.kind === LocationKind.Boss && selectedPoi.spec.id === primaryBossId
      ? selectedPoi.spec.boss
      : undefined;
  const selectedBossShard =
    selectedBossShardIndex === null
      ? null
      : selectedOnChain?.bossShards?.find((shard) => shard.index === selectedBossShardIndex) ?? null;
  const playerStats = playerRun
    ? computePlayerBattleStats(buildPlayerSnapshot(playerRun), backpackSnapshot)
    : undefined;
  const playerDisplayName = publicKeyString ? shortSignature(publicKeyString) : t("common.player");
  const pendingBossDamage =
    bossBattlePhase.phase === "result" || bossBattlePhase.phase === "success"
      ? bossBattlePhase.damage
      : 0;
  const bossPlayerTotalDamageAfterSubmit =
    bossBattlePhase.phase === "result"
      ? (selectedOnChain?.playerBossDamage ?? playerRun?.bossDamage ?? 0) + pendingBossDamage
      : bossBattlePhase.phase === "success"
        ? selectedOnChain?.playerBossDamage ?? playerRun?.bossDamage
        : undefined;
  const bossNftEligibleAfterSubmit =
    ((selectedOnChain?.playerContribution ?? 0) + pendingBossDamage) >= MINIMUM_BOSS_NFT_DAMAGE;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>🗺️ {t("dungeon.title")}</h1>
          <span className={styles.dayId}>{map.dayId}</span>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.stats}>
            <StatPill label={t("dungeon.status.chain")} value={dungeonStatus} title={t("dungeon.status.dungeonStatusTitle")} />
            {playerRun ? (
              <>
                <StatPill label={t("dungeon.stats.energyShort")} value={playerRun.energy} title={t("common.energy")} />
                <span className={`${styles.stat} ${styles.goldPill}`} title={t("dungeon.gold.label")}>
                  🪙 {t("dungeon.gold.label")} {formatGold(playerRun.goldBalance)}
                </span>
                <StatPill label={t("dungeon.stats.clearedShort")} value={playerRun.clearedLocations} title={t("dungeon.stats.clearedLocations")} />
                <StatPill label={t("dungeon.stats.bossDamageShort")} value={playerRun.bossDamage} title={t("dungeon.stats.bossDamage")} />
                <StatPill label={t("dungeon.stats.itemsShort")} value={playerRun.itemsPurchased} title={t("dungeon.stats.itemsPurchased")} />
              </>
            ) : (
              <StatPill
                label={t("dungeon.status.playerRun")}
                value={playerRunLoading ? t("dungeon.status.loading") : t("dungeon.status.none")}
                title={t("dungeon.status.playerRunTitle")}
              />
            )}
            <StatPill label="POI" value={map.locations.length} title={t("dungeon.stats.totalPois")} />
            <StatPill label="" value={`${map.width}x${map.height}`} title={t("dungeon.stats.mapSize")} />
          </div>
          <button
            type="button"
            className={styles.backpackButton}
            onClick={() => setBackpackOpen(true)}
            aria-label={t("dungeon.backpack.openAria", { count: inventory.length })}
          >
            {t("dungeon.backpack.open", { count: inventory.length })}
            {playerRun ? ` · 🪙 ${formatGold(playerRun.goldBalance)}` : ""}
          </button>
          {wallet.connected && !playerRun && (
            <button
              className={styles.btnPrimary}
              onClick={handleEnterDungeon}
              disabled={txPending !== null || enterPhase.phase === "submitting" || !dailyDungeon}
            >
              {enterPhase.phase === "submitting" ? t("dungeon.actions.entering") : t("dungeon.actions.enter")}
            </button>
          )}
          <WalletButton className={styles.walletButton} />
        </div>
      </header>

      {(chainError ||
        dungeonError ||
        !rootMatches ||
        hasDeprecatedMultiBossMap ||
        txSignature ||
        enterPhase.phase === "error" ||
        enterPhase.phase === "success") && (
        <div className={styles.statusBar}>
          {chainError && <span className={styles.statusError}>{chainError}</span>}
          {dungeonError && <span className={styles.statusError}>{dungeonError}</span>}
          {!rootMatches && <span className={styles.statusWarn}>{t("dungeon.map.rootMismatch")}</span>}
          {hasDeprecatedMultiBossMap && (
            <span className={styles.statusWarn}>
              {t("dungeon.map.deprecatedMultiBoss", { bossId: shortId(primaryBossId ?? t("common.unknown")) })}
            </span>
          )}
          {enterPhase.phase === "error" && <span className={styles.statusError}>{enterPhase.message}</span>}
          {enterPhase.phase === "success" && (
            <span className={styles.statusOk}>{t("dungeon.status.entered", { signature: shortSignature(enterPhase.signature) })}</span>
          )}
          {txSignature && (
            <span className={styles.statusOk}>
              {t("dungeon.status.transactionConfirmed")} <TxExplorerLink signature={txSignature} />
            </span>
          )}
        </div>
      )}

      {toast && (
        <div className={`${styles.toast} ${styles[`toast_${toast.variant ?? "success"}`]}`}>
          <strong>{toast.title}</strong>
          {toast.message && <span>{toast.message}</span>}
          {toast.signature && <span className={styles.toastSignature}>{shortSignature(toast.signature)}</span>}
        </div>
      )}

      <div className={styles.legend}>
        {Object.entries(POI_ICONS).map(([kind, icon]) => (
          <span key={kind} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: POI_COLORS[kind as LocationKindType] }} />
            {icon} {locationKindLabel(kind as LocationKindType, t)}
          </span>
        ))}
      </div>

      <div className={styles.content}>
        <div className={styles.mapContainer}>
          <div
            className={styles.grid}
            style={{
              gridTemplateColumns: `repeat(${map.width}, 1fr)`,
              gridTemplateRows: `repeat(${map.height}, 1fr)`,
            }}
          >
            {grid.map((cell) => {
              if (!cell.poi) {
                return <div key={`${cell.x}-${cell.y}`} className={styles.cell} />;
              }
              const spec = cell.poi;
              const isSelected = selectedPoi?.spec.id === spec.id;
              const isHovered = hoveredPoi?.id === spec.id;
              const tileState = isSelected
                ? selectedPoiState ?? selectedPoi?.onChain ?? poiChainStates[spec.id] ?? null
                : poiChainStates[spec.id] ?? null;
              const tileLocked = spec.kind === LocationKind.Enemy && isOnCooldown(tileState);
              const tileInitialized = tileState?.initialized ?? false;
              const tileUninitialized = tileState !== null && !tileInitialized;
              const tileClearedRecently =
                spec.kind === LocationKind.Enemy && (tileState?.clearCount ?? 0) > 0 && !tileLocked;
              const tileTreasureClaimed =
                spec.kind === LocationKind.Treasure && tileState?.dailyRewardClaimed;
              const tileDeprecatedBoss =
                spec.kind === LocationKind.Boss && spec.id !== primaryBossId;
              const shopStock = spec.kind === LocationKind.Shop ? shopTileStock(tileState) : null;
              return (
                <button
                  key={`${cell.x}-${cell.y}`}
                  className={[
                    styles.poi,
                    isSelected ? styles.poiSelected : "",
                    isHovered ? styles.poiHovered : "",
                    tileInitialized ? styles.poiInitialized : "",
                    tileUninitialized ? styles.poiUninitialized : "",
                    tileLocked ? styles.poiLocked : "",
                    tileClearedRecently ? styles.poiCleared : "",
                    spec.kind === LocationKind.Boss ? styles.poiBoss : "",
                    spec.kind === LocationKind.Shop ? styles.poiShop : "",
                    tileTreasureClaimed ? styles.poiTreasureClaimed : "",
                    tileDeprecatedBoss ? styles.poiDeprecated : "",
                  ].join(" ")}
                  style={{ borderColor: POI_COLORS[spec.kind] }}
                  onClick={() => handlePoiClick(spec)}
                  onMouseEnter={() => setHoveredPoi(spec)}
                  onMouseLeave={() => setHoveredPoi(null)}
                  title={`${locationKindLabel(spec.kind, t)}: ${spec.id} (${cell.x}, ${cell.y})${tileLocked ? ` - ${t("dungeon.map.tileLockedTitle", { duration: formatCooldown(getCooldownSeconds(tileState), t("common.ready")) })}` : ""}${tileDeprecatedBoss ? ` - ${t("dungeon.map.deprecatedBossTitle")}` : ""}`}
                >
                  <span className={styles.poiIcon}>{POI_ICONS[spec.kind]}</span>
                  {tileLocked && <span className={styles.poiLock} aria-hidden="true">🔒</span>}
                  {shopStock && <span className={styles.poiCornerBadge}>{shopStock}</span>}
                  {tileTreasureClaimed && <span className={styles.poiCheck} aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        <aside className={styles.sidebar}>
          {selectedPoi ? (
            <PoiDetailPanel
              detail={{
                ...selectedPoi,
                onChain: selectedPoiState ?? selectedPoi.onChain,
                loading: selectedPoi.loading || (loadingChainState && !selectedPoiState),
              }}
              dayId={map.dayId}
              dailyDungeon={dailyDungeon}
              merkleRoot={merkleTree.root}
              onInitLocation={handleInitLocation}
              initLocationPhase={initLocationPhase}
              walletConnected={wallet.connected}
              hasPlayerRun={playerRun !== null}
              playerRun={playerRun}
              loadingChainState={loadingChainState}
              txPending={txPending}
              txSignature={txSignature}
              selectedBossShardIndex={selectedBossShardIndex}
              onEnterDungeon={handleEnterDungeon}
              battlePhase={battlePhase}
              onStartBattle={handleOpenBattleOverlay}
              onClearEnemy={handleClearEnemy}
              onRetry={handleRetry}
              shopActionPhase={shopActionPhase}
              onInitShopSlot={handleInitShopSlot}
              onBuyItem={handleBuyItem}
              bossBattlePhase={bossBattlePhase}
              onStartBossBattle={handleOpenBossOverlay}
              onInitBossShard={handleInitBossShard}
              onSubmitBossDamage={handleSubmitBossDamage}
              dailyRewardPhase={dailyRewardPhase}
              onClaimDailyReward={handleClaimDailyReward}
              onRestoreTreasureItem={handleRestoreTreasureItem}
              hasItemSource={hasItemSource}
              playerPubkey={publicKeyString}
              bossNftClaimPhase={bossNftClaimPhase}
              onClaimBossNft={handleClaimBossNft}
              primaryBossId={primaryBossId}
              hasDeprecatedMultiBossMap={hasDeprecatedMultiBossMap}
            />
          ) : (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>👆</span>
              <p>{t("dungeon.map.empty")}</p>
            </div>
          )}
        </aside>
      </div>

      <BackpackManagerModal
        open={backpackOpen}
        onClose={() => setBackpackOpen(false)}
        layout={layout}
        inventory={inventory}
        backpackSnapshot={backpackSnapshot}
        onMoveItem={moveItem}
        onRotateItem={rotateItem}
        onAutoPack={autoPack}
        onResetBackpack={resetBackpack}
      />

      {selectedEnemy && (
        <BattleOverlay
          open={battleOverlayTarget === "enemy"}
          encounterKind="enemy"
          title={`${t("battle.title")}: ${selectedEnemy.name}`}
          enemyName={selectedEnemy.name}
          enemyLevel={selectedOnChain?.difficultyLevel ?? selectedEnemy.level}
          playerName={playerDisplayName}
          phase={toEnemyOverlayPhase(battlePhase)}
          playerStats={playerStats}
          enemyStats={buildEnemyCombatantStats(selectedEnemy, selectedOnChain)}
          cooldownSeconds={isOnCooldown(selectedOnChain) ? getCooldownSeconds(selectedOnChain) : 0}
          energyCost={ENEMY_CLEAR_ENERGY_COST}
          playerEnergy={playerRun?.energy}
          startBlocked={
            txPending !== null ||
            !publicKey ||
            !playerRun ||
            !selectedOnChain?.initialized
          }
          backpackLayout={layout}
          inventory={inventory}
          onClose={handleCloseBattleOverlay}
          onStart={handleStartBattle}
          onSubmit={handleClearEnemy}
          onRetry={handleRetry}
          onMoveItem={moveItem}
          onRotateItem={rotateItem}
          onAutoPack={autoPack}
          explorerUrl={explorerTxUrl}
          shortSignature={shortSignature}
          bossShardIndex={selectedBossShardIndex ?? undefined}
          bossPlayerTotalDamageAfterSubmit={bossPlayerTotalDamageAfterSubmit}
          bossNftEligible={bossNftEligibleAfterSubmit}
        />
      )}

      {selectedBoss && (
        <BattleOverlay
          open={battleOverlayTarget === "boss"}
          encounterKind="boss"
          title={t("boss.raid")}
          enemyName={selectedOnChain?.bossName ?? selectedBoss.name}
          enemyLevel={selectedBoss.level}
          playerName={playerDisplayName}
          phase={toBossOverlayPhase(bossBattlePhase)}
          playerStats={playerStats}
          enemyStats={buildBossCombatantStats(selectedBoss, selectedOnChain)}
          startBlocked={
            txPending !== null ||
            !publicKey ||
            !playerRun ||
            !selectedOnChain?.initialized ||
            !selectedBossShard?.initialized
          }
          backpackLayout={layout}
          inventory={inventory}
          onClose={handleCloseBattleOverlay}
          onStart={handleStartBossBattle}
          onSubmit={handleSubmitBossDamage}
          onRetry={handleBossRetry}
          onMoveItem={moveItem}
          onRotateItem={rotateItem}
          onAutoPack={autoPack}
          explorerUrl={explorerTxUrl}
          shortSignature={shortSignature}
        />
      )}
    </div>
  );
}

function PoiDetailPanel({
  detail,
  dayId,
  dailyDungeon,
  merkleRoot,
  onInitLocation,
  initLocationPhase,
  walletConnected,
  hasPlayerRun,
  playerRun,
  loadingChainState,
  txPending,
  txSignature,
  selectedBossShardIndex,
  onEnterDungeon,
  battlePhase,
  onStartBattle,
  onClearEnemy,
  onRetry,
  shopActionPhase,
  onInitShopSlot,
  onBuyItem,
  bossBattlePhase,
  onStartBossBattle,
  onInitBossShard,
  onSubmitBossDamage,
  dailyRewardPhase,
  onClaimDailyReward,
  onRestoreTreasureItem,
  hasItemSource,
  playerPubkey,
  bossNftClaimPhase,
  onClaimBossNft,
  primaryBossId,
  hasDeprecatedMultiBossMap,
}: {
  readonly detail: PoiDetail;
  readonly dayId: string;
  readonly dailyDungeon: DailyDungeonState | null;
  readonly merkleRoot: string;
  readonly onInitLocation: () => void;
  readonly initLocationPhase: TxPhase;
  readonly walletConnected: boolean;
  readonly hasPlayerRun: boolean;
  readonly playerRun: PlayerRunState | null;
  readonly loadingChainState: boolean;
  readonly txPending: TxPending;
  readonly txSignature: string | null;
  readonly selectedBossShardIndex: number | null;
  readonly onEnterDungeon: () => void;
  readonly battlePhase: BattlePhase;
  readonly onStartBattle: () => void;
  readonly onClearEnemy: () => void;
  readonly onRetry: () => void;
  readonly shopActionPhase: ShopActionPhase;
  readonly onInitShopSlot: (slotIndex: number) => void;
  readonly onBuyItem: (slotIndex: number) => void;
  readonly bossBattlePhase: BossBattlePhase;
  readonly onStartBossBattle: () => void;
  readonly onInitBossShard: () => void;
  readonly onSubmitBossDamage: () => void;
  readonly dailyRewardPhase: TxPhase;
  readonly onClaimDailyReward: () => void;
  readonly onRestoreTreasureItem: () => void;
  readonly hasItemSource: (sourceKind: "treasure", sourceRef: string) => boolean;
  readonly playerPubkey: string | null;
  readonly bossNftClaimPhase: TxPhase;
  readonly onClaimBossNft: () => void;
  readonly primaryBossId: string | null;
  readonly hasDeprecatedMultiBossMap: boolean;
}) {
  const { t } = useI18n();
  const { spec, onChain, merkleProof } = detail;
  const initialized = onChain?.initialized ?? false;
  const locationAddress = locationPdaLabel(dayId, spec);
  const isPrimaryBoss = spec.kind !== LocationKind.Boss || spec.id === primaryBossId;

  return (
    <div className={styles.detailPanel}>
      <div className={styles.poiHeader}>
        <span className={styles.poiHeaderIcon}>{POI_ICONS[spec.kind]}</span>
        <div className={styles.poiHeaderText}>
          <h2 className={styles.detailTitle}>{locationKindLabel(spec.kind, t)}</h2>
          <span className={styles.poiHeaderMeta}>
            ({spec.position.x}, {spec.position.y}) · {shortId(spec.id)}
          </span>
        </div>
        <span className={initialized ? styles.badgeOk : styles.badgeWarn}>
          {detail.loading || loadingChainState
            ? t("common.loading")
            : initialized
              ? t("common.initialized")
              : t("common.missing")}
        </span>
      </div>

      {detail.error && <div className={styles.battleError}>❌ {detail.error}</div>}

      {hasDeprecatedMultiBossMap && spec.kind === LocationKind.Boss && !isPrimaryBoss && (
        <div className={styles.deprecatedWarning}>
          {t("dungeon.poi.deprecatedBoss")}
        </div>
      )}

      <div className={styles.detailCard}>
        <h3 className={styles.sectionTitle}>{t("dungeon.poi.chainState")}</h3>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>{t("dungeon.poi.initialized")}</span>
          <span className={styles.metaValue}>{initialized ? t("common.yes") : t("common.no")}</span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>{t("common.pda")}</span>
          <span className={styles.metaValue}>{locationAddress}</span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>{t("common.hash")}</span>
          <span className={styles.metaValue}>{onChain?.location?.baseConfigHash ?? spec.baseConfigHash}</span>
        </div>
      </div>

      {!detail.loading && !initialized && (
        <div className={styles.detailCard}>
          <p className={styles.hint}>{t("dungeon.poi.notInitialized")}</p>
          {ENABLE_MANUAL_POI_INIT ? (
            <>
              {!walletConnected ? (
                <ConnectWalletAction />
              ) : !hasPlayerRun ? (
                <button
                  className={styles.btnPrimary}
                  onClick={onEnterDungeon}
                  disabled={txPending !== null || !dailyDungeon}
                >
                  {txPending === "enterDungeon" ? t("dungeon.actions.entering") : t("dungeon.actions.enter")}
                </button>
              ) : (
                <button
                  className={styles.btnInit}
                  onClick={onInitLocation}
                  disabled={txPending !== null || initLocationPhase.phase === "submitting" || !dailyDungeon}
                >
                  {initLocationPhase.phase === "submitting" ? t("dungeon.actions.initializing") : t("dungeon.actions.initializeLocation")}
                </button>
              )}
            </>
          ) : (
            <p className={styles.hint} style={{ marginTop: 8 }}>
              ⏳ {t("dungeon.poi.waitingCrank")}
            </p>
          )}
          {initLocationPhase.phase === "error" && <div className={styles.battleError}>❌ {initLocationPhase.message}</div>}
        </div>
      )}

      {initialized && !walletConnected && <ConnectWalletAction />}

      {initialized && walletConnected && !hasPlayerRun && (
        <div className={styles.detailSection}>
          <button
            className={styles.btnPrimary}
            onClick={onEnterDungeon}
            disabled={txPending !== null || !dailyDungeon}
          >
            {txPending === "enterDungeon" ? t("dungeon.actions.entering") : t("dungeon.actions.enter")}
          </button>
        </div>
      )}

      {initialized && walletConnected && hasPlayerRun && spec.kind === LocationKind.Enemy && spec.enemy && (
        <EnemyContent
          enemy={spec.enemy}
          onChain={onChain}
          battlePhase={battlePhase}
          onStartBattle={onStartBattle}
          onClearEnemy={onClearEnemy}
          onRetry={onRetry}
          walletConnected={walletConnected}
          hasPlayerRun={hasPlayerRun}
          playerRun={playerRun}
          txPending={txPending}
        />
      )}

      {initialized && walletConnected && hasPlayerRun && spec.kind === LocationKind.Shop && spec.shop && (
        <ShopContent
          shop={spec.shop}
          onChain={onChain}
          shopActionPhase={shopActionPhase}
          onInitShopSlot={onInitShopSlot}
          onBuyItem={onBuyItem}
          walletConnected={walletConnected}
          hasPlayerRun={hasPlayerRun}
          playerRun={playerRun}
          txPending={txPending}
        />
      )}

      {initialized && walletConnected && hasPlayerRun && spec.kind === LocationKind.Boss && spec.boss && (
        <BossContent
          boss={spec.boss}
          onChain={onChain}
          bossBattlePhase={bossBattlePhase}
          onStartBossBattle={onStartBossBattle}
          onInitBossShard={onInitBossShard}
          onSubmitBossDamage={onSubmitBossDamage}
          walletConnected={walletConnected}
          hasPlayerRun={hasPlayerRun}
          txPending={txPending}
          selectedBossShardIndex={selectedBossShardIndex}
          bossNftClaimPhase={bossNftClaimPhase}
          onClaimBossNft={onClaimBossNft}
          playerRun={playerRun}
          raidEnabled={isPrimaryBoss}
        />
      )}

      {initialized && walletConnected && hasPlayerRun && spec.kind === LocationKind.Treasure && (
        <TreasureContent
          spec={spec}
          dayId={dayId}
          playerPubkey={playerPubkey}
          onChain={onChain}
          dailyRewardPhase={dailyRewardPhase}
          onClaimDailyReward={onClaimDailyReward}
          onRestoreTreasureItem={onRestoreTreasureItem}
          hasBackpackItem={hasItemSource("treasure", treasureSourceRef(spec))}
          walletConnected={walletConnected}
          hasPlayerRun={hasPlayerRun}
          txPending={txPending}
        />
      )}

      <div className={styles.detailCard}>
        <h3 className={styles.sectionTitle}>🔗 {t("dungeon.poi.merkleProof")}</h3>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>{t("common.root")}</span>
          <span className={styles.metaValue}>{merkleRoot}</span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>{t("dungeon.poi.proofSteps")}</span>
          <span className={styles.metaValue}>{merkleProof.length}</span>
        </div>
      </div>

      {initLocationPhase.phase === "success" && (
        <p className={styles.initialized}>{t("dungeon.status.initializedTx")} <TxExplorerLink signature={initLocationPhase.signature} /></p>
      )}
      {txSignature && (
        <p className={styles.initialized}>{t("dungeon.status.lastTransaction")} <TxExplorerLink signature={txSignature} /></p>
      )}
    </div>
  );
}

function EnemyContent({
  enemy,
  onChain,
  battlePhase,
  onStartBattle,
  onClearEnemy,
  onRetry,
  walletConnected,
  hasPlayerRun,
  playerRun,
  txPending,
}: {
  readonly enemy: NonNullable<DailyLocationSpec["enemy"]>;
  readonly onChain: PoiOnChainState | null;
  readonly battlePhase: BattlePhase;
  readonly onStartBattle: () => void;
  readonly onClearEnemy: () => void;
  readonly onRetry: () => void;
  readonly walletConnected: boolean;
  readonly hasPlayerRun: boolean;
  readonly playerRun: PlayerRunState | null;
  readonly txPending: TxPending;
}) {
  const { t } = useI18n();
  const onCooldown = isOnCooldown(onChain);
  const cooldownSecs = getCooldownSeconds(onChain);
  const nextAvailableAt = onChain?.nextAvailableAt;
  const battleStateBlocked =
    txPending !== null || !walletConnected || !hasPlayerRun || !onChain?.initialized;

  return (
    <div className={styles.detailSection}>
      <h3 className={styles.sectionTitle}>⚔️ {enemy.name}</h3>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>{t("common.level")}</span>
        <span className={styles.metaValue}>{enemy.level}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>{t("dungeon.labels.baseHp")}</span>
        <span className={styles.metaValue}>{onChain?.baseHp ?? enemy.maxHealth}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>{t("dungeon.labels.baseDamage")}</span>
        <span className={styles.metaValue}>{onChain?.baseDamage ?? enemy.attack}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>{t("dungeon.labels.clearCount")}</span>
        <span className={styles.metaValue}>{onChain?.clearCount ?? 0}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>{t("dungeon.labels.difficulty")}</span>
        <span className={styles.metaValue}>{onChain?.difficultyLevel ?? enemy.level}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>{t("dungeon.labels.nextAvailable")}</span>
        <span className={styles.metaValue}>{formatNextAvailable(nextAvailableAt, t("common.ready"))}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>{t("common.cooldown")}</span>
        <span className={styles.metaValue}>{formatCooldown(cooldownSecs, t("common.ready"))}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>{t("dungeon.labels.valuableCap")}</span>
        <span className={styles.metaValue}>{onChain?.valuableClearCap ?? "-"}</span>
      </div>

      {onCooldown && (
        <div className={styles.cooldownNotice}>
          {t("battle.enemyRecovering")} · {t("common.cooldown")} {formatCooldown(cooldownSecs, t("common.ready"))}
        </div>
      )}

      {!walletConnected ? (
        <ConnectWalletAction />
      ) : !hasPlayerRun ? (
        <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
          {t("dungeon.actions.enter")}
        </button>
      ) : (
        <BattleArena
          title={t("battle.title")}
          encounterKind="enemy"
          enemyName={enemy.name}
          phase={battlePhase}
          txPending={battleStateBlocked}
          cooldownSeconds={onCooldown ? cooldownSecs : 0}
          energyCost={ENEMY_CLEAR_ENERGY_COST}
          playerEnergy={playerRun?.energy}
          idleActionLabel={t("battle.open")}
          onStart={onStartBattle}
          onSubmit={onClearEnemy}
          onRetry={onRetry}
          explorerUrl={explorerTxUrl}
          shortSignature={shortSignature}
        />
      )}
    </div>
  );
}

function ShopContent({
  shop,
  onChain,
  shopActionPhase,
  onInitShopSlot,
  onBuyItem,
  walletConnected,
  hasPlayerRun,
  playerRun,
  txPending,
}: {
  readonly shop: NonNullable<DailyLocationSpec["shop"]>;
  readonly onChain: PoiOnChainState | null;
  readonly shopActionPhase: ShopActionPhase;
  readonly onInitShopSlot: (slotIndex: number) => void;
  readonly onBuyItem: (slotIndex: number) => void;
  readonly walletConnected: boolean;
  readonly hasPlayerRun: boolean;
  readonly playerRun: PlayerRunState | null;
  readonly txPending: TxPending;
}) {
  const { t } = useI18n();
  const playerGoldKnown = playerRun?.hasGoldBalance ?? false;
  const playerGold = playerRun?.goldBalance ?? 0;

  return (
    <div className={styles.detailCard}>
      <h3 className={styles.sectionTitle}>🛒 {t("shop.title")}</h3>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>{t("dungeon.labels.keeper")}</span>
        <span className={styles.metaValue}>{onChain?.keeperName || shop.keeperName || t("common.unknown")}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>{t("dungeon.labels.slots")}</span>
        <span className={styles.metaValue}>{onChain?.slotCount ?? shop.itemSlots.length}</span>
      </div>
      <div className={styles.shopGoldBanner}>
        <span>{t("dungeon.gold.current")}</span>
        <strong>🪙 {formatGold(playerGold)}</strong>
      </div>
      {hasPlayerRun && !playerGoldKnown && (
        <p className={styles.goldWarning}>
          {t("dungeon.gold.migrationWarning")}
        </p>
      )}
      <p className={styles.mvpNotice}>
        {t("shop.mvpNotice")}
      </p>

      <h3 className={styles.sectionTitle}>{t("common.items")}</h3>
      {shop.itemSlots.map((slot, index) => {
        const stockInfo = onChain?.stock?.[index];
        const previewSlot = {
          ...slot,
          itemId: stockInfo?.itemId ?? slot.itemId,
          rewardTier: normalizeRewardTier(stockInfo?.rewardTier, slot.rewardTier),
        };
        const preview = previewBackpackItemFromShopSlot(previewSlot);
        const definition = preview.definition;
        const isInitializing =
          txPending === shopTxKey("initShopSlot", index) ||
          (shopActionPhase.phase === "initializingSlot" && shopActionPhase.slotIndex === index);
        const isBuying =
          txPending === shopTxKey("buyItem", index) ||
          (shopActionPhase.phase === "buying" && shopActionPhase.slotIndex === index);
        const isBought = shopActionPhase.phase === "bought" && shopActionPhase.slotIndex === index;
        const isSlotInitialized = shopActionPhase.phase === "slotInitialized" && shopActionPhase.slotIndex === index;
        const availableStock = stockInfo?.availableStock ?? stockInfo?.available ?? 0;
        const inStock = availableStock > 0;
        const price = stockInfo?.currentPrice ?? stockInfo?.price ?? slot.price;
        const canAfford = playerGoldKnown && playerGold >= price;
        const afterPurchase = playerGold - price;
        const disabled = Boolean(stockInfo?.initialized && (!inStock || !canAfford));

        return (
          <div
            key={slot.slotId}
            className={`${styles.shopSlot} ${disabled ? styles.shopSlotDisabled : ""}`}
            aria-disabled={disabled}
          >
            <div className={styles.shopCardHeader}>
              <span className={styles.shopItemIcon} aria-hidden="true">
                {itemIcon(definition)}
              </span>
              <div className={styles.shopItemTitle}>
                <span className={styles.shopSlotName}>{definition.name}</span>
                <span className={styles.shopItemSubline}>
                  {t("shop.itemPrice", { price: formatGold(price) })}
                </span>
              </div>
              <span
                className={styles.shopSlotTier}
                style={{ color: rewardTierColor(definition.tier) }}
              >
                {definition.tier}
              </span>
            </div>
            <p className={styles.shopEffectSummary}>{itemEffectSummary(definition)}</p>
            {!stockInfo?.initialized ? (
              <>
                <p className={styles.hint}>{t("shop.slotNotInitialized", { index })}</p>
                <button
                  className={styles.btnInit}
                  onClick={() => onInitShopSlot(index)}
                  disabled={txPending !== null}
                >
                  {isInitializing ? t("shop.initializingSlot") : t("shop.initializeSlot")}
                </button>
              </>
            ) : (
              <>
                <div className={styles.shopStatsGrid}>
                  <ShopCardStat label={t("shop.currentGold")} value={playerGoldKnown ? formatGold(playerGold) : "0"} />
                  <ShopCardStat label={t("common.price")} value={formatGold(price)} />
                  <ShopCardStat
                    label={t("shop.afterPurchase")}
                    value={playerGoldKnown ? formatGold(afterPurchase) : t("common.unavailable")}
                  />
                  <ShopCardStat label={t("common.stock")} value={shopStockLabel(stockInfo, slot.stock, t)} />
                  <ShopCardStat label={t("common.sold")} value={stockInfo.soldCount ?? 0} />
                  <ShopCardStat label={t("common.restock")} value={shopRestockInfo(stockInfo, t)} />
                </div>
                <div className={styles.detailMeta}>
                  <span className={styles.metaLabel}>{t("shop.walletLimit")}</span>
                  <span className={styles.metaValue}>{stockInfo.perWalletDailyLimit ?? "-"}</span>
                </div>
                {isBought ? (
                  <div className={styles.initialized}>{t("shop.purchased")} <TxExplorerLink signature={shopActionPhase.signature} /></div>
                ) : isBuying ? (
                  <div className={styles.battleSimulating}>
                    <div className={styles.spinner} />
                    <span>{t("shop.buying")}</span>
                  </div>
                ) : walletConnected && hasPlayerRun && inStock ? (
                  <>
                    <button
                      className={styles.btnClear}
                      onClick={() => onBuyItem(index)}
                      disabled={txPending !== null || !canAfford}
                      style={{ marginTop: 6 }}
                    >
                      {t("shop.buy")}
                    </button>
                    {!playerGoldKnown ? (
                      <p className={styles.goldWarning}>
                        {t("dungeon.gold.migrationWarning")}
                      </p>
                    ) : !canAfford ? (
                      <p className={styles.goldWarning}>{t("shop.notEnoughGold")}</p>
                    ) : null}
                  </>
                ) : walletConnected && !hasPlayerRun ? (
                  <p className={styles.hint}>{t("shop.enterBeforeBuying")}</p>
                ) : !inStock ? (
                  <button className={styles.btnSecondary} disabled style={{ marginTop: 6 }}>
                    {t("shop.soldOut")}
                  </button>
                ) : (
                  <p className={styles.hint}>{t("shop.connectToBuy")}</p>
                )}
              </>
            )}
            {isSlotInitialized && <div className={styles.initialized}>{t("shop.slotInitialized")} <TxExplorerLink signature={shopActionPhase.signature} /></div>}
            {shopActionPhase.phase === "error" && (
              <div className={styles.battleError} style={{ marginTop: 6 }}>
                ❌ {shopActionPhase.message}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ShopCardStat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}) {
  return (
    <div className={styles.shopCardStat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BossContent({
  boss,
  onChain,
  bossBattlePhase,
  onStartBossBattle,
  onInitBossShard,
  onSubmitBossDamage,
  walletConnected,
  hasPlayerRun,
  txPending,
  selectedBossShardIndex,
  bossNftClaimPhase,
  onClaimBossNft,
  playerRun,
  raidEnabled,
}: {
  readonly boss: NonNullable<DailyLocationSpec["boss"]>;
  readonly onChain: PoiOnChainState | null;
  readonly bossBattlePhase: BossBattlePhase;
  readonly onStartBossBattle: () => void;
  readonly onInitBossShard: () => void;
  readonly onSubmitBossDamage: () => void;
  readonly walletConnected: boolean;
  readonly hasPlayerRun: boolean;
  readonly txPending: TxPending;
  readonly selectedBossShardIndex: number | null;
  readonly bossNftClaimPhase: TxPhase;
  readonly onClaimBossNft: () => void;
  readonly playerRun: PlayerRunState | null;
  readonly raidEnabled: boolean;
}) {
  const { t } = useI18n();
  const totalBossDamage = onChain?.totalDamage ?? 0;
  const bossHp = onChain?.bossHp ?? boss.maxHealth;
  const bossDefeated = onChain?.bossDefeated ?? totalBossDamage >= bossHp;
  const bossHpPercent = bossHp > 0 ? Math.min(100, (totalBossDamage / bossHp) * 100) : 0;
  const requiredShard =
    selectedBossShardIndex === null
      ? null
      : onChain?.bossShards?.find((shard) => shard.index === selectedBossShardIndex) ?? null;
  const playerContribution = onChain?.playerContribution ?? 0;
  const playerTotalDamage = onChain?.playerBossDamage ?? playerRun?.bossDamage ?? 0;
  const alreadyChallenged = playerContribution > 0 || playerTotalDamage > 0;
  const currentShardDamage = requiredShard?.totalDamage ?? 0;
  const hasMinimumContribution = playerContribution >= MINIMUM_BOSS_NFT_DAMAGE;
  const canClaimBossNft = raidEnabled && !onChain?.bossNftClaimed && hasMinimumContribution;
  const lastDamage =
    bossBattlePhase.phase === "result" || bossBattlePhase.phase === "success"
      ? bossBattlePhase.damage
      : null;

  return (
    <div className={`${styles.detailCard} ${styles.bossCard}`}>
      <div className={styles.bossHeader}>
        <div>
          <h3 className={styles.sectionTitle}>👑 {onChain?.bossName ?? boss.name}</h3>
          <p className={styles.bossSubtitle}>{t("boss.subtitle", { tier: boss.rewardTier })}</p>
        </div>
        <span className={onChain?.bossNftClaimed ? styles.badgeOk : styles.badgeWarn}>
          {onChain?.bossNftClaimed ? t("boss.nftClaimed") : t("boss.nftNotClaimed")}
        </span>
      </div>

      {!raidEnabled && (
        <div className={styles.deprecatedWarning}>
          {t("boss.deprecated")}
        </div>
      )}

      <div className={styles.bossStatGrid}>
        <ShopCardStat label={t("boss.name")} value={onChain?.bossName ?? boss.name} />
        <ShopCardStat label={t("boss.level")} value={boss.level} />
        <ShopCardStat label={t("boss.hp")} value={bossHp} />
        <ShopCardStat label={t("boss.rewardTier")} value={boss.rewardTier} />
        <ShopCardStat label={t("boss.shardCount")} value={onChain?.bossShards?.length ?? "-"} />
        <ShopCardStat label={t("boss.playerShard")} value={selectedBossShardIndex ?? "-"} />
        <ShopCardStat label={t("boss.shardDamage")} value={currentShardDamage} />
        <ShopCardStat label={t("boss.playerTotal")} value={playerTotalDamage} />
      </div>

      <div className={styles.bossShards}>
        <h4 className={styles.sectionTitle}>{t("boss.hp")}</h4>
        <div className={styles.bossHpBar}>
          <div
            className={styles.bossHpFill}
            style={{
              width: `${bossHpPercent}%`,
              background: bossDefeated ? "#2ecc71" : "#e74c3c",
            }}
          />
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>{t("boss.damageDealt")}</span>
          <span className={styles.metaValue}>
            {totalBossDamage} / {bossHp}
            {bossDefeated && ` ${t("boss.defeated")}`}
          </span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>{t("boss.participants")}</span>
          <span className={styles.metaValue}>{onChain?.participantCount ?? 0}</span>
        </div>
        <h4 className={styles.sectionTitle}>{t("boss.shardProgress")}</h4>
        {(onChain?.bossShards ?? []).map((shard) => (
          <div
            key={shard.index}
            className={`${styles.shardRow} ${shard.index === selectedBossShardIndex ? styles.shardRowActive : ""}`}
          >
            <span className={styles.metaLabel}>{t("boss.shard", { index: shard.index })}</span>
            <span className={styles.metaValue}>
              {shard.initialized
                ? t("boss.shardValue", { damage: shard.totalDamage, players: shard.participantCount })
                : t("common.missing")}
            </span>
          </div>
        ))}
      </div>

      {!walletConnected ? (
        <ConnectWalletAction />
      ) : !hasPlayerRun ? (
        <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
          {t("dungeon.actions.enter")}
        </button>
      ) : !raidEnabled ? (
        <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
          {t("boss.deprecatedPoi")}
        </button>
      ) : selectedBossShardIndex === null ? (
        <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
          {t("boss.shardUnavailable")}
        </button>
      ) : !requiredShard?.initialized ? (
        <button className={styles.btnInit} onClick={onInitBossShard} disabled={txPending !== null} style={{ marginTop: 8 }}>
          {txPending === "initBossShard" ? t("boss.initializingShard") : t("boss.initShard")}
        </button>
      ) : alreadyChallenged ? (
        <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
          {t("boss.alreadyChallenged")}
        </button>
      ) : (
        <BattleArena
          title={t("boss.raid")}
          encounterKind="boss"
          enemyName={onChain?.bossName ?? boss.name}
          phase={bossBattlePhase}
          txPending={txPending !== null}
          idleActionLabel={t("battle.openRaid")}
          onStart={onStartBossBattle}
          onSubmit={onSubmitBossDamage}
          onRetry={onStartBossBattle}
          explorerUrl={explorerTxUrl}
          shortSignature={shortSignature}
        />
      )}

      {lastDamage !== null && (
        <div className={styles.raidReceipt}>
          <span>{t("boss.raidReceipt")}</span>
          <strong>{t("boss.damageScore", { damage: lastDamage })}</strong>
          {bossBattlePhase.phase === "success" && (
            <TxExplorerLink signature={bossBattlePhase.signature} />
          )}
        </div>
      )}

      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>{t("battle.bossNftEligibility")}</span>
        <span className={styles.metaValue}>
          {onChain?.bossNftClaimed
            ? t("common.claimed")
            : hasMinimumContribution
              ? t("common.eligible")
              : t("boss.needsDamageAmount", { damage: MINIMUM_BOSS_NFT_DAMAGE })}
        </span>
      </div>
      {onChain?.bossNftClaimed && <div className={styles.initialized}>{t("common.claimed")}</div>}
      {!onChain?.bossNftClaimed && canClaimBossNft && bossNftClaimPhase.phase === "idle" && (
        <button className={styles.btnBossClaim} onClick={onClaimBossNft} disabled={txPending !== null} style={{ marginTop: 8 }}>
          {t("boss.claimNft")}
        </button>
      )}
      {bossNftClaimPhase.phase === "submitting" && (
        <div className={styles.battleSimulating}>
          <div className={styles.spinner} />
          <span>{t("boss.claimingParticipation")}</span>
        </div>
      )}
      {bossNftClaimPhase.phase === "success" && (
        <div className={styles.initialized}>{t("boss.claimRecorded")} <TxExplorerLink signature={bossNftClaimPhase.signature} /></div>
      )}
      {bossNftClaimPhase.phase === "error" && <div className={styles.battleError}>❌ {bossNftClaimPhase.message}</div>}
    </div>
  );
}

function TreasureContent({
  spec,
  dayId,
  playerPubkey,
  onChain,
  dailyRewardPhase,
  onClaimDailyReward,
  onRestoreTreasureItem,
  hasBackpackItem,
  walletConnected,
  hasPlayerRun,
  txPending,
}: {
  readonly spec: DailyLocationSpec;
  readonly dayId: string;
  readonly playerPubkey: string | null;
  readonly onChain: PoiOnChainState | null;
  readonly dailyRewardPhase: TxPhase;
  readonly onClaimDailyReward: () => void;
  readonly onRestoreTreasureItem: () => void;
  readonly hasBackpackItem: boolean;
  readonly walletConnected: boolean;
  readonly hasPlayerRun: boolean;
  readonly txPending: TxPending;
}) {
  const { t } = useI18n();
  const tier = spec.rewardTier ?? RewardTier.Common;
  const sourceRef = treasureSourceRef(spec);
  const previewItem = playerPubkey
    ? createBackpackItemFromTreasure(
        {
          id: spec.id,
          poiId: spec.id,
          poiIdHash: sourceRef,
          rewardTier: tier,
          sourceRef,
        },
        {
          dayId,
          player: playerPubkey,
          sourceRef,
        },
      )
    : null;
  const previewDefinition = previewItem
    ? getBackpackItemDefinition(previewItem.definitionId)
    : getBackpackItemDefinition("ruby-common");
  const canRestore = Boolean(onChain?.dailyRewardClaimed && !hasBackpackItem);

  return (
    <div className={styles.treasureStack}>
      <div className={styles.detailCard}>
        <h3 className={styles.sectionTitle}>{t("treasure.chainReward")}</h3>
        <p className={styles.mvpNotice}>
          {t("treasure.mvpNotice")}
        </p>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>{t("dungeon.labels.rewardTier")}</span>
          <span className={styles.metaValue} style={{ color: rewardTierColor(tier) }}>
            {tier}
          </span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>{t("common.claimed")}</span>
          <span className={styles.metaValue}>{onChain?.dailyRewardClaimed ? t("common.yes") : t("common.no")}</span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>NFT / cNFT</span>
          <span className={styles.metaValue}>{t("treasure.nftRecord")}</span>
        </div>
        {dailyRewardPhase.phase === "success" && (
          <div className={styles.initialized}>{t("treasure.txSignature")} <TxExplorerLink signature={dailyRewardPhase.signature} /></div>
        )}

        {onChain?.dailyRewardClaimed ? (
          <div className={styles.initialized}>{t("common.claimed")}</div>
        ) : !walletConnected ? (
          <ConnectWalletAction />
        ) : !hasPlayerRun ? (
          <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
            {t("dungeon.actions.enter")}
          </button>
        ) : dailyRewardPhase.phase === "idle" ? (
          <button className={styles.btnClear} onClick={onClaimDailyReward} disabled={txPending !== null} style={{ marginTop: 8 }}>
            {t("treasure.claim")}
          </button>
        ) : dailyRewardPhase.phase === "submitting" ? (
          <div className={styles.battleSimulating}>
            <div className={styles.spinner} />
            <span>{t("treasure.claiming")}</span>
          </div>
        ) : dailyRewardPhase.phase === "error" ? (
          <div className={styles.battleError}>❌ {dailyRewardPhase.message}</div>
        ) : null}
      </div>

      <div className={styles.detailCard}>
        <h3 className={styles.sectionTitle}>{t("backpack.rewardTitle")}</h3>
        <div className={styles.rewardPreviewCard}>
          <span className={styles.shopItemIcon} aria-hidden="true">
            {itemIcon(previewDefinition)}
          </span>
          <div className={styles.rewardPreviewBody}>
            <strong>{previewDefinition.name}</strong>
            <span>{previewDefinition.tier}</span>
            <p>{itemEffectSummary(previewDefinition)}</p>
          </div>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>{t("backpack.addedLocally")}</span>
          <span className={styles.metaValue}>{hasBackpackItem ? t("common.yes") : t("common.no")}</span>
        </div>
        {canRestore && (
          <button className={styles.btnInit} onClick={onRestoreTreasureItem} disabled={txPending !== null} style={{ marginTop: 8 }}>
            {t("backpack.restore")}
          </button>
        )}
      </div>
    </div>
  );
}

function ConnectWalletAction() {
  return (
    <div className={styles.detailSection}>
      <WalletButton className={styles.walletButton} />
    </div>
  );
}

function TxExplorerLink({ signature }: { readonly signature: string }) {
  return (
    <a className={styles.txLink} href={explorerTxUrl(signature)} target="_blank" rel="noreferrer">
      {shortSignature(signature)}
    </a>
  );
}
