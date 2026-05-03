"use client";

import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WalletButton } from "./wallet-button";
import { BattleArena } from "./components/BattleArena";
import { BattleOverlay, type BattleOverlayPhase } from "./components/battle/BattleOverlay";
import { StatPill } from "./components/StatPill";
import { useBackpackInventory } from "./hooks/useBackpackInventory";
import {
  buildBattleInput,
  buildLocationMerkleTree,
  computePlayerBattleStats,
  createBackpackItemFromShopSlot,
  createBackpackItemFromTreasure,
  createDailyMapInput,
  generateDailyMap,
  getLocationProof,
  parseDailyMapRandomSeed,
  simulateBossBattle,
  simulateEnemyBattle,
  todayDayId,
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
import { bossShardIndexForPlayer, sha256Bytes32 } from "../../lib/solana/pdas";
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
  | { readonly phase: "success"; readonly signature: string; readonly result: BattleResultV1 }
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
  | { readonly phase: "success"; readonly damage: number; readonly signature: string; readonly result: BattleResultV1 }
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

const MAP_INPUT: DailyMapInput = createDailyMapInput({
  dayId: process.env.NEXT_PUBLIC_PACKRUN_DAY_ID || todayDayId(),
  randomSeed: parseDailyMapRandomSeed(process.env.NEXT_PUBLIC_PACKRUN_RANDOM_SEED),
});

const ENEMY_CLEAR_ENERGY_COST = 5;
const EXPLORER_CLUSTER = "devnet";
const BATTLE_REPLAY_STEP_MS = 450;

const POI_ICONS: Record<LocationKindType, string> = {
  [LocationKind.Enemy]: "⚔️",
  [LocationKind.Shop]: "🏪",
  [LocationKind.Treasure]: "💎",
  [LocationKind.Boss]: "👹",
  [LocationKind.Event]: "❓",
};

const POI_COLORS: Record<LocationKindType, string> = {
  [LocationKind.Enemy]: "#e74c3c",
  [LocationKind.Shop]: "#f39c12",
  [LocationKind.Treasure]: "#9b59b6",
  [LocationKind.Boss]: "#c0392b",
  [LocationKind.Event]: "#95a5a6",
};

function formatCooldown(seconds: number): string {
  if (seconds <= 0) return "Ready";
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

function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${EXPLORER_CLUSTER}`;
}

function formatNextAvailable(nextAvailableAt: number | undefined): string {
  if (!nextAvailableAt || nextAvailableAt <= 0) return "Ready";
  if (nextAvailableAt <= Math.floor(Date.now() / 1000)) return "Ready";

  return new Date(nextAvailableAt * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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
  const [enterPhase, setEnterPhase] = useState<TxPhase>({ phase: "idle" });
  const [initLocationPhase, setInitLocationPhase] = useState<TxPhase>({ phase: "idle" });
  const [battlePhase, setBattlePhase] = useState<BattlePhase>({ phase: "idle" });
  const [shopActionPhase, setShopActionPhase] = useState<ShopActionPhase>({ phase: "idle" });
  const [bossBattlePhase, setBossBattlePhase] = useState<BossBattlePhase>({ phase: "idle" });
  const [dailyRewardPhase, setDailyRewardPhase] = useState<TxPhase>({ phase: "idle" });
  const [bossNftClaimPhase, setBossNftClaimPhase] = useState<TxPhase>({ phase: "idle" });
  const [battleOverlayTarget, setBattleOverlayTarget] = useState<"enemy" | "boss" | null>(null);

  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const battleReplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bossReplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      clearBattleReplayTimer();
      clearBossReplayTimer();
    };
  }, [clearBattleReplayTimer, clearBossReplayTimer]);

  const map = useMemo(() => generateDailyMap(MAP_INPUT), []);
  const merkleTree = useMemo(() => buildLocationMerkleTree(map.locations), [map]);
  const {
    inventory,
    layout,
    backpackSnapshot,
    addItem,
    moveItem,
    rotateItem,
    autoPack,
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
        return `DailyDungeon account not found for ${map.dayId}. Ask the admin/crank to initialize today's dungeon.`;
      });
    } catch (error) {
      setDungeonError(formatError(error, "Failed to fetch daily dungeon."));
      setChainError(formatError(error, "Failed to fetch DailyDungeon."));
      setDailyDungeon(null);
    } finally {
      setDungeonLoading(false);
      setLoadingChainState(false);
    }
  }, [program, map.dayId]);

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
      setChainError(formatError(error, "Failed to fetch PlayerRun."));
      return null;
    } finally {
      setPlayerRunLoading(false);
      setLoadingChainState(false);
    }
  }, [program, map.dayId, publicKey, publicKeyString]);

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
        return onChain;
      } catch (error) {
        setSelectedPoi((current) =>
          current?.spec.id === spec.id
            ? {
                spec,
                merkleProof,
                onChain: current.onChain,
                loading: false,
                error: formatError(error, "Failed to fetch POI state."),
              }
            : current,
        );
        setSelectedPoiState(null);
        setChainError(formatError(error, "Failed to fetch selected POI chain state."));
        return null;
      } finally {
        setLoadingChainState(false);
      }
    },
    [program, map.dayId, publicKey, publicKeyString],
  );

  const refreshSelectedPoiState = useCallback(async (): Promise<PoiOnChainState | null> => {
    if (!selectedPoi) return null;
    return loadPoiState(selectedPoi.spec, selectedPoi.merkleProof);
  }, [selectedPoi, loadPoiState]);

  const refreshAfterTx = useCallback(async () => {
    await Promise.all([refreshDailyDungeon(), refreshPlayerRun()]);
    await refreshSelectedPoiState();
  }, [refreshDailyDungeon, refreshPlayerRun, refreshSelectedPoiState]);

  useEffect(() => {
    void refreshDailyDungeon();
  }, [refreshDailyDungeon]);

  useEffect(() => {
    void refreshPlayerRun();
  }, [refreshPlayerRun]);

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
      throw new Error("Connect wallet first.");
    }
    return {
      player: publicKey,
      signingProgram: createPackrunProgram(anchorWallet),
    };
  }, [anchorWallet, publicKey]);

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
      const message = formatError(error, "Failed to enter dungeon.");
      setEnterPhase({ phase: "error", message });
      setChainError(message);
    } finally {
      setTxPending(null);
    }
  }, [map.dayId, refreshAfterTx, requireWallet]);

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
      const message = formatError(error, "Failed to initialize location.");
      setInitLocationPhase({
        phase: "error",
        message,
      });
      setChainError(message);
    } finally {
      setTxPending(null);
    }
  }, [map.dayId, refreshAfterTx, requireWallet, selectedPoi]);

  const handleStartBattle = useCallback(() => {
    clearBattleReplayTimer();
    setBattlePhase({ phase: "preparing" });

    try {
      if (txPending !== null) throw new Error("A transaction is already pending.");
      if (!publicKey) throw new Error("Connect wallet first.");
      if (!playerRun) throw new Error("Enter dungeon first.");
      if (!selectedPoi?.spec.enemy) throw new Error("No enemy selected.");

      const onChain = selectedPoiState;
      if (!onChain?.initialized) throw new Error("Initialize Location first.");
      if (isOnCooldown(onChain)) {
        throw new Error(`Clear Enemy cooldown ${formatCooldown(getCooldownSeconds(onChain))}.`);
      }
      if (playerRun.energy < ENEMY_CLEAR_ENERGY_COST) {
        throw new Error("Not enough energy.");
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
      setBattlePhase({ phase: "error", message: formatError(error, "Failed to start battle.") });
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
      const signature = await clearEnemy(
        signingProgram,
        map.dayId,
        selectedPoi.spec,
        player,
        battle.result,
      );
      setTxSignature(signature);
      await Promise.all([refreshDailyDungeon(), refreshPlayerRun(), refreshSelectedPoiState()]);
      clearBattleReplayTimer();
      setBattlePhase({ phase: "success", signature, result: battle.result });
    } catch (error) {
      const message = formatError(error, "Failed to submit enemy clear.");
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
    selectedPoi,
    selectedPoiState,
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
    clearBossReplayTimer();
    setBossBattlePhase({ phase: "idle" });
    setBattleOverlayTarget("boss");
  }, [clearBossReplayTimer]);

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
        const message = formatError(error, "Failed to initialize shop slot.");
        setShopActionPhase({
          phase: "error",
          message,
        });
        setChainError(message);
      } finally {
        setTxPending(null);
      }
    },
    [map.dayId, refreshAfterTx, requireWallet, selectedPoi],
  );

  const handleBuyItem = useCallback(
    async (slotIndex: number) => {
      if (!selectedPoi?.spec.shop || !selectedPoi.onChain?.stock) return;
      if (!playerRun) {
        setShopActionPhase({ phase: "error", message: "Enter dungeon before buying items." });
        return;
      }

      const slot = selectedPoi.spec.shop.itemSlots[slotIndex];
      if (!slot) return;
      const stockInfo = selectedPoi.onChain.stock[slotIndex];
      if (!stockInfo?.initialized || !stockInfo.expectedPrice || (stockInfo.available ?? 0) <= 0) {
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
        addItem(
          createBackpackItemFromShopSlot(
            {
              ...slot,
              itemId: stockInfo.itemId ?? slot.itemId,
              rewardTier: normalizeRewardTier(stockInfo.rewardTier, slot.rewardTier),
            },
            {
              dayId: map.dayId,
              player: player.toBase58(),
              purchaseIndex: stockInfo.soldCount ?? slotIndex,
              signature,
            },
          ),
        );
        setShopActionPhase({ phase: "bought", slotIndex, signature });
        setTxSignature(signature);
        await refreshAfterTx();
      } catch (error) {
        const message = formatError(error, "Purchase failed.");
        setShopActionPhase({ phase: "error", message });
        setChainError(message);
      } finally {
        setTxPending(null);
      }
    },
    [addItem, map.dayId, playerRun, refreshAfterTx, requireWallet, selectedPoi],
  );

  const handleStartBossBattle = useCallback(() => {
    clearBossReplayTimer();
    setBossBattlePhase({ phase: "preparing" });

    try {
      if (!publicKey) throw new Error("Connect wallet first.");
      if (!playerRun) throw new Error("Enter dungeon first.");
      if (!selectedPoi?.spec.boss) throw new Error("No boss selected.");

      const onChain = selectedPoiState ?? selectedPoi.onChain;
      if (!onChain?.initialized) throw new Error("Initialize Location first.");

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
        message: formatError(error, "Failed to start boss battle."),
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
    selectedPoi,
    selectedPoiState,
    showBossBattleResult,
  ]);

  const handleInitBossShard = useCallback(async () => {
    if (!selectedPoi?.spec.boss || !selectedPoi.onChain?.initialized) return;
    if (!dailyDungeon) {
      setBossBattlePhase({ phase: "error", message: "Daily dungeon account is not initialized." });
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
      const message = formatError(error, "Failed to initialize BossDamageShard.");
      setBossBattlePhase({ phase: "error", message });
      setChainError(message);
    } finally {
      setTxPending(null);
    }
  }, [dailyDungeon, map.dayId, refreshAfterTx, requireWallet, selectedPoi]);

  const handleSubmitBossDamage = useCallback(async () => {
    if (!selectedPoi?.spec.boss) return;
    const onChain = selectedPoiState ?? selectedPoi.onChain;
    if (!onChain?.initialized) return;
    const bossBattle = bossBattlePhase;
    if (bossBattle.phase !== "result") return;
    if (bossBattle.result.bossDamageScore <= 0) {
      setBossBattlePhase({ phase: "error", message: "Boss damage must be greater than zero." });
      return;
    }
    if (!dailyDungeon) {
      setBossBattlePhase({ phase: "error", message: "Daily dungeon account is not initialized." });
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
        throw new Error(
          `Boss damage shard #${shardIndex} is not initialized on-chain. Add an init BossDamageShard instruction or initialize the shard before submitting damage.`,
        );
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
      setBossBattlePhase({ phase: "success", damage, signature, result: bossBattle.result });
      setTxSignature(signature);
      await refreshAfterTx();
    } catch (error) {
      const message = formatError(error, "Failed to submit boss damage.");
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
    refreshAfterTx,
    requireWallet,
    selectedPoi,
    selectedPoiState,
  ]);

  const handleClaimBossNft = useCallback(async () => {
    if (!selectedPoi?.spec.boss || !selectedPoi.onChain?.initialized) return;
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
      const message = formatError(error, "Failed to claim Boss participation NFT.");
      setBossNftClaimPhase({
        phase: "error",
        message,
      });
      setChainError(message);
    } finally {
      setTxPending(null);
    }
  }, [map.dayId, refreshAfterTx, requireWallet, selectedPoi]);

  const handleClaimDailyReward = useCallback(async () => {
    setDailyRewardPhase({ phase: "submitting" });
    setTxPending("claimDailyReward");
    setTxSignature(null);
    setChainError(null);
    try {
      if (!selectedPoi) throw new Error("No location selected.");
      const { player, signingProgram } = requireWallet();
      const poiIdHash = sha256Bytes32(selectedPoi.spec.id);
      const sourceRef = bytesToHex(poiIdHash);
      const signature = await claimDailyReward(signingProgram, map.dayId, player, poiIdHash);
      if (!hasItemSource("treasure", sourceRef)) {
        addItem(
          createBackpackItemFromTreasure(
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
          ),
        );
      }
      setDailyRewardPhase({ phase: "success", signature });
      setTxSignature(signature);
      await refreshAfterTx();
    } catch (error) {
      const message = formatError(error, "Failed to claim daily reward.");
      setDailyRewardPhase({
        phase: "error",
        message,
      });
      setChainError(message);
    } finally {
      setTxPending(null);
    }
  }, [addItem, hasItemSource, map.dayId, refreshAfterTx, requireWallet, selectedPoi]);

  const dungeonStatus = dungeonLoading
    ? "Loading"
    : dailyDungeon
      ? dailyDungeon.status
      : "Not initialized";
  const rootMatches = !dailyDungeon || dailyDungeon.mapRoot === merkleTree.root;
  const selectedOnChain = selectedPoiState ?? selectedPoi?.onChain ?? null;
  const selectedEnemy = selectedPoi?.spec.kind === LocationKind.Enemy ? selectedPoi.spec.enemy : undefined;
  const selectedBoss = selectedPoi?.spec.kind === LocationKind.Boss ? selectedPoi.spec.boss : undefined;
  const playerStats = playerRun
    ? computePlayerBattleStats(buildPlayerSnapshot(playerRun), backpackSnapshot)
    : undefined;
  const playerDisplayName = publicKeyString ? shortSignature(publicKeyString) : "Player";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>🗺️ Daily Dungeon</h1>
          <span className={styles.dayId}>{map.dayId}</span>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.stats}>
            <StatPill label="Chain:" value={dungeonStatus} title="Dungeon status" />
            {playerRun ? (
              <>
                <StatPill label="EN" value={playerRun.energy} title="Energy" />
                <StatPill label="CL" value={playerRun.clearedLocations} title="Cleared locations" />
                <StatPill label="BD" value={playerRun.bossDamage} title="Boss damage" />
                <StatPill label="IT" value={playerRun.itemsPurchased} title="Items purchased" />
              </>
            ) : (
              <StatPill
                label="Run:"
                value={playerRunLoading ? "Loading" : "None"}
                title="Player run"
              />
            )}
            <StatPill label="POI" value={map.locations.length} title="Total POIs" />
            <StatPill label="" value={`${map.width}x${map.height}`} title="Map size" />
          </div>
          {wallet.connected && !playerRun && (
            <button
              className={styles.btnPrimary}
              onClick={handleEnterDungeon}
              disabled={txPending !== null || enterPhase.phase === "submitting" || !dailyDungeon}
            >
              {enterPhase.phase === "submitting" ? "Entering..." : "Enter Dungeon"}
            </button>
          )}
          <WalletButton className={styles.walletButton} />
        </div>
      </header>

      {(chainError || dungeonError || !rootMatches || txSignature || enterPhase.phase === "error" || enterPhase.phase === "success") && (
        <div className={styles.statusBar}>
          {chainError && <span className={styles.statusError}>{chainError}</span>}
          {dungeonError && <span className={styles.statusError}>{dungeonError}</span>}
          {!rootMatches && <span className={styles.statusWarn}>Local map root differs from on-chain map root.</span>}
          {enterPhase.phase === "error" && <span className={styles.statusError}>{enterPhase.message}</span>}
          {enterPhase.phase === "success" && (
            <span className={styles.statusOk}>Entered: {shortSignature(enterPhase.signature)}</span>
          )}
          {txSignature && (
            <span className={styles.statusOk}>
              Transaction confirmed: <TxExplorerLink signature={txSignature} />
            </span>
          )}
        </div>
      )}

      <div className={styles.legend}>
        {Object.entries(POI_ICONS).map(([kind, icon]) => (
          <span key={kind} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: POI_COLORS[kind as LocationKindType] }} />
            {icon} {kind}
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
              const tileState = isSelected ? selectedPoiState ?? selectedPoi?.onChain ?? null : null;
              const tileLocked = spec.kind === LocationKind.Enemy && isOnCooldown(tileState);
              return (
                <button
                  key={`${cell.x}-${cell.y}`}
                  className={`${styles.poi} ${isSelected ? styles.poiSelected : ""} ${isHovered ? styles.poiHovered : ""} ${tileLocked ? styles.poiLocked : ""}`}
                  style={{ borderColor: POI_COLORS[spec.kind] }}
                  onClick={() => handlePoiClick(spec)}
                  onMouseEnter={() => setHoveredPoi(spec)}
                  onMouseLeave={() => setHoveredPoi(null)}
                  title={`${spec.kind}: ${spec.id} (${cell.x}, ${cell.y})${tileLocked ? ` - Locked for ${formatCooldown(getCooldownSeconds(tileState))}` : ""}`}
                >
                  <span className={styles.poiIcon}>{POI_ICONS[spec.kind]}</span>
                  {tileLocked && <span className={styles.poiLock} aria-hidden="true">🔒</span>}
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
              bossNftClaimPhase={bossNftClaimPhase}
              onClaimBossNft={handleClaimBossNft}
            />
          ) : (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>👆</span>
              <p>Click a POI on the map to view details</p>
            </div>
          )}
        </aside>
      </div>

      {selectedEnemy && (
        <BattleOverlay
          open={battleOverlayTarget === "enemy"}
          encounterKind="enemy"
          title={`Battle: ${selectedEnemy.name}`}
          enemyName={selectedEnemy.name}
          enemyLevel={selectedOnChain?.difficultyLevel ?? selectedEnemy.level}
          playerName={playerDisplayName}
          phase={toEnemyOverlayPhase(battlePhase)}
          playerStats={playerStats}
          enemyStats={buildEnemyCombatantStats(selectedEnemy, selectedOnChain)}
          cooldownSeconds={isOnCooldown(selectedOnChain) ? getCooldownSeconds(selectedOnChain) : 0}
          energyCost={ENEMY_CLEAR_ENERGY_COST}
          playerEnergy={playerRun?.energy}
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
        />
      )}

      {selectedBoss && (
        <BattleOverlay
          open={battleOverlayTarget === "boss"}
          encounterKind="boss"
          title={`Raid: ${selectedOnChain?.bossName ?? selectedBoss.name}`}
          enemyName={selectedOnChain?.bossName ?? selectedBoss.name}
          enemyLevel={selectedBoss.level}
          playerName={playerDisplayName}
          phase={toBossOverlayPhase(bossBattlePhase)}
          playerStats={playerStats}
          enemyStats={buildBossCombatantStats(selectedBoss, selectedOnChain)}
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
  bossNftClaimPhase,
  onClaimBossNft,
}: {
  readonly detail: PoiDetail;
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
  readonly bossNftClaimPhase: TxPhase;
  readonly onClaimBossNft: () => void;
}) {
  const { spec, onChain, merkleProof } = detail;
  const initialized = onChain?.initialized ?? false;

  return (
    <div className={styles.detailPanel}>
      <h2 className={styles.detailTitle}>
        {POI_ICONS[spec.kind]} {spec.kind}
      </h2>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>ID</span>
        <span className={styles.metaValue}>{spec.id}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Position</span>
        <span className={styles.metaValue}>
          ({spec.position.x}, {spec.position.y})
        </span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Config Hash</span>
        <span className={styles.metaValue} style={{ fontSize: 11 }}>
          {spec.baseConfigHash.slice(0, 16)}...
        </span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>On-chain</span>
        <span className={styles.metaValue}>{detail.loading || loadingChainState ? "Loading" : initialized ? "Initialized" : "Missing"}</span>
      </div>

      {detail.error && <div className={styles.battleError}>❌ {detail.error}</div>}

      {!detail.loading && !initialized && (
        <div className={styles.detailSection}>
          <p className={styles.hint}>This POI account is not initialized on-chain.</p>
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
                  {txPending === "enterDungeon" ? "Entering..." : "Enter Dungeon"}
                </button>
              ) : (
                <button
                  className={styles.btnInit}
                  onClick={onInitLocation}
                  disabled={txPending !== null || initLocationPhase.phase === "submitting" || !dailyDungeon}
                >
                  {initLocationPhase.phase === "submitting" ? "Initializing..." : "Initialize Location"}
                </button>
              )}
            </>
          ) : (
            <p className={styles.hint} style={{ marginTop: 8 }}>
              ⏳ Waiting for crank to initialize this location.
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
            {txPending === "enterDungeon" ? "Entering..." : "Enter Dungeon"}
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
        />
      )}

      {initialized && walletConnected && hasPlayerRun && spec.kind === LocationKind.Treasure && (
        <TreasureContent
          spec={spec}
          onChain={onChain}
          dailyRewardPhase={dailyRewardPhase}
          onClaimDailyReward={onClaimDailyReward}
          walletConnected={walletConnected}
          hasPlayerRun={hasPlayerRun}
          txPending={txPending}
        />
      )}

      <div className={styles.detailSection}>
        <h3 className={styles.sectionTitle}>🔗 Merkle Proof</h3>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>Root</span>
          <span className={styles.metaValue} style={{ fontSize: 11 }}>
            {merkleRoot.slice(0, 16)}...
          </span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>Proof Steps</span>
          <span className={styles.metaValue}>{merkleProof.length}</span>
        </div>
      </div>

      {initLocationPhase.phase === "success" && (
        <p className={styles.initialized}>Initialized: <TxExplorerLink signature={initLocationPhase.signature} /></p>
      )}
      {txSignature && (
        <p className={styles.initialized}>Last transaction: <TxExplorerLink signature={txSignature} /></p>
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
  const onCooldown = isOnCooldown(onChain);
  const cooldownSecs = getCooldownSeconds(onChain);
  const nextAvailableAt = onChain?.nextAvailableAt;
  const battleStateBlocked =
    txPending !== null || !walletConnected || !hasPlayerRun || !onChain?.initialized;

  return (
    <div className={styles.detailSection}>
      <h3 className={styles.sectionTitle}>⚔️ {enemy.name}</h3>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Level</span>
        <span className={styles.metaValue}>{enemy.level}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Base HP</span>
        <span className={styles.metaValue}>{onChain?.baseHp ?? enemy.maxHealth}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Base Damage</span>
        <span className={styles.metaValue}>{onChain?.baseDamage ?? enemy.attack}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Clear Count</span>
        <span className={styles.metaValue}>{onChain?.clearCount ?? 0}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Difficulty</span>
        <span className={styles.metaValue}>{onChain?.difficultyLevel ?? enemy.level}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Next Available</span>
        <span className={styles.metaValue}>{formatNextAvailable(nextAvailableAt)}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Cooldown</span>
        <span className={styles.metaValue}>{formatCooldown(cooldownSecs)}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Valuable Cap</span>
        <span className={styles.metaValue}>{onChain?.valuableClearCap ?? "-"}</span>
      </div>

      {onCooldown && (
        <div className={styles.cooldownNotice}>
          Enemy recovering / Locked for {formatCooldown(cooldownSecs)}
        </div>
      )}

      {!walletConnected ? (
        <ConnectWalletAction />
      ) : !hasPlayerRun ? (
        <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
          Enter Dungeon
        </button>
      ) : (
        <BattleArena
          title="Battle"
          encounterKind="enemy"
          enemyName={enemy.name}
          phase={battlePhase}
          txPending={battleStateBlocked}
          cooldownSeconds={onCooldown ? cooldownSecs : 0}
          energyCost={ENEMY_CLEAR_ENERGY_COST}
          playerEnergy={playerRun?.energy}
          idleActionLabel="Open Battle"
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
  txPending,
}: {
  readonly shop: NonNullable<DailyLocationSpec["shop"]>;
  readonly onChain: PoiOnChainState | null;
  readonly shopActionPhase: ShopActionPhase;
  readonly onInitShopSlot: (slotIndex: number) => void;
  readonly onBuyItem: (slotIndex: number) => void;
  readonly walletConnected: boolean;
  readonly hasPlayerRun: boolean;
  readonly txPending: TxPending;
}) {
  return (
    <div className={styles.detailSection}>
      <h3 className={styles.sectionTitle}>🏪 Shop</h3>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Keeper</span>
        <span className={styles.metaValue}>{onChain?.keeperName || shop.keeperName || "Unknown"}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Slots</span>
        <span className={styles.metaValue}>{onChain?.slotCount ?? shop.itemSlots.length}</span>
      </div>

      <h3 className={styles.sectionTitle}>Items</h3>
      {shop.itemSlots.map((slot, index) => {
        const stockInfo = onChain?.stock?.[index];
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

        return (
          <div key={slot.slotId} className={styles.shopSlot}>
            <div className={styles.shopSlotHeader}>
              <span className={styles.shopSlotName}>{stockInfo?.itemId ?? slot.itemId}</span>
              <span className={styles.shopSlotTier} style={{ color: rewardTierColor(stockInfo?.rewardTier ?? slot.rewardTier) }}>
                {stockInfo?.rewardTier ?? slot.rewardTier}
              </span>
            </div>
            {!stockInfo?.initialized ? (
              <>
                <p className={styles.hint}>Slot #{index} is not initialized on-chain.</p>
                <button
                  className={styles.btnInit}
                  onClick={() => onInitShopSlot(index)}
                  disabled={txPending !== null}
                >
                  {isInitializing ? "Initializing Slot..." : "Initialize Slot"}
                </button>
              </>
            ) : (
              <>
                <div className={styles.detailMeta}>
                  <span className={styles.metaLabel}>Base Price</span>
                  <span className={styles.metaValue}>{stockInfo.basePrice} pts</span>
                </div>
                <div className={styles.detailMeta}>
                  <span className={styles.metaLabel}>Current Price</span>
                  <span className={styles.metaValue}>{stockInfo.currentPrice} pts</span>
                </div>
                <div className={styles.detailMeta}>
                  <span className={styles.metaLabel}>Available</span>
                  <span className={styles.metaValue}>{availableStock}</span>
                </div>
                <div className={styles.detailMeta}>
                  <span className={styles.metaLabel}>Sold</span>
                  <span className={styles.metaValue}>{stockInfo.soldCount}</span>
                </div>
                <div className={styles.detailMeta}>
                  <span className={styles.metaLabel}>Wallet Limit</span>
                  <span className={styles.metaValue}>{stockInfo.perWalletDailyLimit}</span>
                </div>
                {isBought ? (
                  <div className={styles.initialized}>Purchased: <TxExplorerLink signature={shopActionPhase.signature} /></div>
                ) : isBuying ? (
                  <div className={styles.battleSimulating}>
                    <div className={styles.spinner} />
                    <span>Buying...</span>
                  </div>
                ) : walletConnected && hasPlayerRun && inStock ? (
                  <button className={styles.btnClear} onClick={() => onBuyItem(index)} disabled={txPending !== null} style={{ marginTop: 6 }}>
                    Buy Item ({stockInfo.currentPrice} pts)
                  </button>
                ) : walletConnected && !hasPlayerRun ? (
                  <p className={styles.hint}>Enter dungeon before buying items.</p>
                ) : !inStock ? (
                  <button className={styles.btnSecondary} disabled style={{ marginTop: 6 }}>
                    Sold Out
                  </button>
                ) : (
                  <p className={styles.hint}>Connect wallet to buy.</p>
                )}
              </>
            )}
            {isSlotInitialized && <div className={styles.initialized}>Slot initialized: <TxExplorerLink signature={shopActionPhase.signature} /></div>}
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
}) {
  const totalBossDamage = onChain?.totalDamage ?? 0;
  const bossHp = onChain?.bossHp ?? boss.maxHealth;
  const bossDefeated = onChain?.bossDefeated ?? totalBossDamage >= bossHp;
  const requiredShard =
    selectedBossShardIndex === null
      ? null
      : onChain?.bossShards?.find((shard) => shard.index === selectedBossShardIndex) ?? null;
  const hasContribution = (onChain?.playerContribution ?? 0) > 0;

  return (
    <div className={styles.detailSection}>
      <h3 className={styles.sectionTitle}>👹 Boss: {onChain?.bossName ?? boss.name}</h3>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Level</span>
        <span className={styles.metaValue}>{boss.level}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Boss HP</span>
        <span className={styles.metaValue}>{bossHp}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Base Damage</span>
        <span className={styles.metaValue}>{onChain?.baseDamage ?? boss.attack}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Player Damage</span>
        <span className={styles.metaValue}>{onChain?.playerContribution ?? 0}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Run Boss Damage</span>
        <span className={styles.metaValue}>{onChain?.playerBossDamage ?? 0}</span>
      </div>

      <div className={styles.bossShards}>
        <h4 className={styles.sectionTitle}>Boss HP Progress</h4>
        <div className={styles.bossHpBar}>
          <div
            className={styles.bossHpFill}
            style={{
              width: `${Math.min(100, (totalBossDamage / bossHp) * 100)}%`,
              background: bossDefeated ? "#2ecc71" : "#e74c3c",
            }}
          />
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>Damage Dealt</span>
          <span className={styles.metaValue}>
            {totalBossDamage} / {bossHp}
            {bossDefeated && " DEFEATED"}
          </span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>Participants</span>
          <span className={styles.metaValue}>{onChain?.participantCount ?? 0}</span>
        </div>
        <h4 className={styles.sectionTitle}>Shard Progress</h4>
        {(onChain?.bossShards ?? []).map((shard) => (
          <div key={shard.index} className={styles.detailMeta}>
            <span className={styles.metaLabel}>Shard #{shard.index}</span>
            <span className={styles.metaValue}>
              {shard.initialized ? `${shard.totalDamage} dmg (${shard.participantCount} players)` : "Missing"}
            </span>
          </div>
        ))}
      </div>

      {!walletConnected ? (
        <ConnectWalletAction />
      ) : !hasPlayerRun ? (
        <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
          Enter Dungeon
        </button>
      ) : selectedBossShardIndex === null ? (
        <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
          Boss Shard Unavailable
        </button>
      ) : !requiredShard?.initialized ? (
        <button className={styles.btnInit} onClick={onInitBossShard} disabled={txPending !== null} style={{ marginTop: 8 }}>
          {txPending === "initBossShard" ? "Initializing Boss Shard..." : "Initialize Boss Shard"}
        </button>
      ) : (
        <BattleArena
          title="Boss Battle"
          encounterKind="boss"
          enemyName={onChain?.bossName ?? boss.name}
          phase={bossBattlePhase}
          txPending={txPending !== null}
          idleActionLabel="Open Raid"
          onStart={onStartBossBattle}
          onSubmit={onSubmitBossDamage}
          onRetry={onStartBossBattle}
          explorerUrl={explorerTxUrl}
          shortSignature={shortSignature}
        />
      )}

      {onChain?.bossNftClaimed && <div className={styles.initialized}>Claimed</div>}
      {!onChain?.bossNftClaimed && hasContribution && bossNftClaimPhase.phase === "idle" && (
        <button className={styles.btnInit} onClick={onClaimBossNft} disabled={txPending !== null} style={{ marginTop: 8 }}>
          Claim Boss NFT
        </button>
      )}
      {bossNftClaimPhase.phase === "submitting" && (
        <div className={styles.battleSimulating}>
          <div className={styles.spinner} />
          <span>Claiming boss participation...</span>
        </div>
      )}
      {bossNftClaimPhase.phase === "success" && (
        <div className={styles.initialized}>Claim recorded: <TxExplorerLink signature={bossNftClaimPhase.signature} /></div>
      )}
      {bossNftClaimPhase.phase === "error" && <div className={styles.battleError}>❌ {bossNftClaimPhase.message}</div>}
    </div>
  );
}

function TreasureContent({
  spec,
  onChain,
  dailyRewardPhase,
  onClaimDailyReward,
  walletConnected,
  hasPlayerRun,
  txPending,
}: {
  readonly spec: DailyLocationSpec;
  readonly onChain: PoiOnChainState | null;
  readonly dailyRewardPhase: TxPhase;
  readonly onClaimDailyReward: () => void;
  readonly walletConnected: boolean;
  readonly hasPlayerRun: boolean;
  readonly txPending: TxPending;
}) {
  const tier = spec.rewardTier ?? RewardTier.Common;

  return (
    <div className={styles.detailSection}>
      <h3 className={styles.sectionTitle}>💎 Daily Reward</h3>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Treasure Tier</span>
        <span className={styles.metaValue} style={{ color: rewardTierColor(tier) }}>
          {tier}
        </span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Reward Scope</span>
        <span className={styles.metaValue}>Daily run</span>
      </div>

      {onChain?.dailyRewardClaimed ? (
        <div className={styles.initialized}>Claimed</div>
      ) : !walletConnected ? (
        <ConnectWalletAction />
      ) : !hasPlayerRun ? (
        <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
          Enter Dungeon
        </button>
      ) : dailyRewardPhase.phase === "idle" ? (
        <button className={styles.btnClear} onClick={onClaimDailyReward} disabled={txPending !== null} style={{ marginTop: 8 }}>
          Claim Daily Reward
        </button>
      ) : dailyRewardPhase.phase === "submitting" ? (
        <div className={styles.battleSimulating}>
          <div className={styles.spinner} />
          <span>Claiming daily reward...</span>
        </div>
      ) : dailyRewardPhase.phase === "success" ? (
        <div className={styles.initialized}>Claimed: <TxExplorerLink signature={dailyRewardPhase.signature} /></div>
      ) : dailyRewardPhase.phase === "error" ? (
        <div className={styles.battleError}>❌ {dailyRewardPhase.message}</div>
      ) : null}
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
