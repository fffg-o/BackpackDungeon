"use client";

import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildLocationMerkleTree,
  computeBossDamage,
  generateDailyMap,
  getLocationProof,
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
import { bossShardIndexForPlayer } from "../../lib/solana/pdas";
import { simulateBattle, type BattleResult } from "./battle-sim";
import styles from "./dungeon.module.css";

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
  | { readonly phase: "simulating" }
  | { readonly phase: "result"; readonly result: BattleResult }
  | { readonly phase: "submitting" }
  | { readonly phase: "success"; readonly signature: string }
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
  | { readonly phase: "simulating" }
  | { readonly phase: "result"; readonly result: BattleResult; readonly damage: number }
  | { readonly phase: "submitting" }
  | { readonly phase: "success"; readonly damage: number; readonly signature: string }
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

const MASTER_SEED = "packrun-master";
const MAP_INPUT: DailyMapInput = {
  bossCount: 2,
  dayId: new Date().toISOString().slice(0, 10),
  enemyCount: 12,
  height: 20,
  masterSeed: MASTER_SEED,
  poiDensity: 0.06,
  shopCount: 4,
  treasureCount: 6,
  width: 30,
};

const ENEMY_CLEAR_ENERGY_COST = 5;
const EXPLORER_CLUSTER = "devnet";

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
  return Math.max(0, onChain.nextAvailableAt - Date.now() / 1000);
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

function shopTxKey(kind: "initShopSlot" | "buyItem", slotIndex: number): TxPending {
  return `${kind}:${slotIndex}`;
}

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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

  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const map = useMemo(() => generateDailyMap(MAP_INPUT), []);
  const merkleTree = useMemo(() => buildLocationMerkleTree(map.locations), [map]);

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

  const refreshPlayerRun = useCallback(async () => {
    if (!publicKey) {
      setPlayerRun(null);
      return;
    }

    setPlayerRunLoading(true);
    setLoadingChainState(true);
    try {
      setPlayerRun(await fetchPlayerRun(program, map.dayId, publicKey));
    } catch (error) {
      setChainError(formatError(error, "Failed to fetch PlayerRun."));
    } finally {
      setPlayerRunLoading(false);
      setLoadingChainState(false);
    }
  }, [program, map.dayId, publicKey, publicKeyString]);

  const loadPoiState = useCallback(
    async (spec: DailyLocationSpec, merkleProof: ReturnType<typeof getLocationProof>) => {
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
      } finally {
        setLoadingChainState(false);
      }
    },
    [program, map.dayId, publicKey, publicKeyString],
  );

  const refreshSelectedPoi = useCallback(async () => {
    if (!selectedPoi) return;
    await loadPoiState(selectedPoi.spec, selectedPoi.merkleProof);
  }, [selectedPoi, loadPoiState]);

  const refreshAfterTx = useCallback(async () => {
    await Promise.all([refreshDailyDungeon(), refreshPlayerRun()]);
    await refreshSelectedPoi();
  }, [refreshDailyDungeon, refreshPlayerRun, refreshSelectedPoi]);

  useEffect(() => {
    void refreshDailyDungeon();
  }, [refreshDailyDungeon]);

  useEffect(() => {
    void refreshPlayerRun();
  }, [refreshPlayerRun]);

  useEffect(() => {
    if (selectedPoi) {
      void loadPoiState(selectedPoi.spec, selectedPoi.merkleProof);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKeyString]);

  const handlePoiClick = useCallback(
    (spec: DailyLocationSpec) => {
      const proof = getLocationProof(map.locations, spec.id);
      setBattlePhase({ phase: "idle" });
      setShopActionPhase({ phase: "idle" });
      setBossBattlePhase({ phase: "idle" });
      setDailyRewardPhase({ phase: "idle" });
      setBossNftClaimPhase({ phase: "idle" });
      setInitLocationPhase({ phase: "idle" });
      setSelectedPoiState(null);
      setTxSignature(null);
      void loadPoiState(spec, proof);
    },
    [map.locations, loadPoiState],
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
    if (!selectedPoi?.spec.enemy || !selectedPoi.onChain?.initialized) return;
    const clearCount = selectedPoi.onChain.clearCount ?? 0;
    const result = simulateBattle(selectedPoi.spec.enemy, clearCount);
    setBattlePhase({ phase: "result", result });
  }, [selectedPoi]);

  const handleClearEnemy = useCallback(async () => {
    if (!selectedPoi?.spec.enemy || !selectedPoi.onChain?.initialized) return;
    const battle = battlePhase;
    if (battle.phase !== "result" || !battle.result.won) return;

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
      setBattlePhase({ phase: "success", signature });
      setTxSignature(signature);
      await refreshAfterTx();
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
  }, [battlePhase, map.dayId, refreshAfterTx, requireWallet, selectedPoi]);

  const handleRetry = useCallback(() => {
    setBattlePhase({ phase: "idle" });
  }, []);

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
    [map.dayId, playerRun, refreshAfterTx, requireWallet, selectedPoi],
  );

  const handleStartBossBattle = useCallback(() => {
    if (!selectedPoi?.spec.boss || !selectedPoi.onChain?.initialized) return;

    const boss = selectedPoi.spec.boss;
    const bossAsEnemy: EnemyConfig = {
      id: boss.id,
      name: boss.name,
      level: boss.level,
      maxHealth: boss.maxHealth,
      attack: boss.attack,
      rewardTier: boss.rewardTier,
    };

    const result = simulateBattle(bossAsEnemy, 0);
    const damage = computeBossDamage({
      baseDamage: result.damageTaken > 0 ? Math.max(10, 100 - result.damageTaken) : 150,
      blockedDamage: 0,
      bonusDamage: result.flawless ? 50 : 0,
      multiplierBps: 10_000,
    });
    setBossBattlePhase({ phase: "result", result, damage });
  }, [selectedPoi]);

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
    if (!selectedPoi?.spec.boss || !selectedPoi.onChain?.initialized) return;
    const bossBattle = bossBattlePhase;
    if (bossBattle.phase !== "result") return;
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
      const shard = selectedPoi.onChain.bossShards?.find((entry) => entry.index === shardIndex);
      if (!shard?.initialized) {
        throw new Error(
          `Boss damage shard #${shardIndex} is not initialized on-chain. Add an init BossDamageShard instruction or initialize the shard before submitting damage.`,
        );
      }

      const signature = await submitBossDamage(
        signingProgram,
        map.dayId,
        selectedPoi.spec,
        player,
        bossBattle.damage,
        bossBattle.result,
        dailyDungeon.bossShardCount,
      );
      setBossBattlePhase({ phase: "success", damage: bossBattle.damage, signature });
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
  }, [bossBattlePhase, dailyDungeon, map.dayId, refreshAfterTx, requireWallet, selectedPoi]);

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
      const { player, signingProgram } = requireWallet();
      const signature = await claimDailyReward(signingProgram, map.dayId, player);
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
  }, [map.dayId, refreshAfterTx, requireWallet]);

  const dungeonStatus = dungeonLoading
    ? "Loading"
    : dailyDungeon
      ? dailyDungeon.status
      : "Not initialized";
  const rootMatches = !dailyDungeon || dailyDungeon.mapRoot === merkleTree.root;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>🗺️ Daily Dungeon</h1>
          <span className={styles.dayId}>{map.dayId}</span>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.stats}>
            <span title="Dungeon status" className={styles.stat}>
              Chain: {dungeonStatus}
            </span>
            {playerRun ? (
              <>
                <span title="Energy" className={styles.stat}>
                  EN {playerRun.energy}
                </span>
                <span title="Cleared locations" className={styles.stat}>
                  CL {playerRun.clearedLocations}
                </span>
                <span title="Boss damage" className={styles.stat}>
                  BD {playerRun.bossDamage}
                </span>
                <span title="Items purchased" className={styles.stat}>
                  IT {playerRun.itemsPurchased}
                </span>
              </>
            ) : (
              <span title="Player run" className={styles.stat}>
                Run: {playerRunLoading ? "Loading" : "None"}
              </span>
            )}
            <span title="Total POIs" className={styles.stat}>
              POI {map.locations.length}
            </span>
            <span title="Map size" className={styles.stat}>
              {map.width}x{map.height}
            </span>
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
          <WalletMultiButton className={styles.walletButton} />
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
              return (
                <button
                  key={`${cell.x}-${cell.y}`}
                  className={`${styles.poi} ${isSelected ? styles.poiSelected : ""} ${isHovered ? styles.poiHovered : ""}`}
                  style={{ borderColor: POI_COLORS[spec.kind] }}
                  onClick={() => handlePoiClick(spec)}
                  onMouseEnter={() => setHoveredPoi(spec)}
                  onMouseLeave={() => setHoveredPoi(null)}
                  title={`${spec.kind}: ${spec.id} (${cell.x}, ${cell.y})`}
                >
                  <span className={styles.poiIcon}>{POI_ICONS[spec.kind]}</span>
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
              onStartBattle={handleStartBattle}
              onClearEnemy={handleClearEnemy}
              onRetry={handleRetry}
              shopActionPhase={shopActionPhase}
              onInitShopSlot={handleInitShopSlot}
              onBuyItem={handleBuyItem}
              bossBattlePhase={bossBattlePhase}
              onStartBossBattle={handleStartBossBattle}
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
          dailyDungeon={dailyDungeon}
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
  const hasEnergy = (playerRun?.energy ?? 0) >= ENEMY_CLEAR_ENERGY_COST;

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
        <span className={styles.metaLabel}>Valuable Cap</span>
        <span className={styles.metaValue}>{onChain?.valuableClearCap ?? "-"}</span>
      </div>

      {!walletConnected ? (
        <ConnectWalletAction />
      ) : !hasPlayerRun ? (
        <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
          Enter Dungeon
        </button>
      ) : onCooldown ? (
        <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
          Clear Enemy cooldown {formatCooldown(cooldownSecs)}
        </button>
      ) : !hasEnergy ? (
        <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
          Clear Enemy needs {ENEMY_CLEAR_ENERGY_COST} EN
        </button>
      ) : battlePhase.phase === "idle" ? (
        <button className={styles.btnClear} onClick={onStartBattle} disabled={txPending !== null} style={{ marginTop: 8 }}>
          Start Battle
        </button>
      ) : battlePhase.phase === "simulating" ? (
        <div className={styles.battleSimulating}>
          <div className={styles.spinner} />
          <span>Simulating battle...</span>
        </div>
      ) : battlePhase.phase === "result" ? (
        <div className={styles.battleResult}>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Outcome</span>
            <span className={styles.metaValue}>{battlePhase.result.won ? "Victory" : "Defeated"}</span>
          </div>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Turns</span>
            <span className={styles.metaValue}>{battlePhase.result.turnsTaken}</span>
          </div>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Damage Taken</span>
            <span className={styles.metaValue}>{battlePhase.result.damageTaken}</span>
          </div>
          {battlePhase.result.won ? (
            <button className={styles.btnClear} onClick={onClearEnemy} disabled={txPending !== null} style={{ marginTop: 8 }}>
              {txPending === "clearEnemy" ? "Submitting Clear Enemy..." : "Submit Clear Enemy"}
            </button>
          ) : (
            <button className={styles.btnSecondary} onClick={onRetry} disabled={txPending !== null} style={{ marginTop: 8 }}>
              Retry
            </button>
          )}
        </div>
      ) : battlePhase.phase === "submitting" ? (
        <div className={styles.battleSimulating}>
          <div className={styles.spinner} />
          <span>Submitting clear...</span>
        </div>
      ) : battlePhase.phase === "success" ? (
        <div className={styles.initialized}>Cleared: <TxExplorerLink signature={battlePhase.signature} /></div>
      ) : battlePhase.phase === "error" ? (
        <div className={styles.battleError}>❌ {battlePhase.message}</div>
      ) : null}
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
      ) : bossBattlePhase.phase === "idle" ? (
        <button className={styles.btnClear} onClick={onStartBossBattle} disabled={txPending !== null} style={{ marginTop: 8 }}>
          Start Boss Battle
        </button>
      ) : bossBattlePhase.phase === "simulating" ? (
        <div className={styles.battleSimulating}>
          <div className={styles.spinner} />
          <span>Simulating boss battle...</span>
        </div>
      ) : bossBattlePhase.phase === "result" ? (
        <div className={styles.battleResult}>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Outcome</span>
            <span className={styles.metaValue}>{bossBattlePhase.result.won ? "Victory" : "Defeated"}</span>
          </div>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Damage Dealt</span>
            <span className={styles.metaValue}>{bossBattlePhase.damage}</span>
          </div>
          <div className={styles.buttonRow} style={{ marginTop: 8 }}>
            <button className={styles.btnClear} onClick={onSubmitBossDamage} disabled={txPending !== null}>
              {txPending === "submitBossDamage" ? "Submitting Boss Damage..." : "Submit Boss Damage"}
            </button>
            <button className={styles.btnSecondary} onClick={onStartBossBattle} disabled={txPending !== null}>
              Retry
            </button>
          </div>
        </div>
      ) : bossBattlePhase.phase === "submitting" ? (
        <div className={styles.battleSimulating}>
          <div className={styles.spinner} />
          <span>Submitting boss damage...</span>
        </div>
      ) : bossBattlePhase.phase === "success" ? (
        <div className={styles.initialized}>
          Submitted {bossBattlePhase.damage}: <TxExplorerLink signature={bossBattlePhase.signature} />
        </div>
      ) : bossBattlePhase.phase === "error" ? (
        <div className={styles.battleError}>❌ {bossBattlePhase.message}</div>
      ) : null}

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
  dailyDungeon,
  onChain,
  dailyRewardPhase,
  onClaimDailyReward,
  walletConnected,
  hasPlayerRun,
  txPending,
}: {
  readonly spec: DailyLocationSpec;
  readonly dailyDungeon: DailyDungeonState | null;
  readonly onChain: PoiOnChainState | null;
  readonly dailyRewardPhase: TxPhase;
  readonly onClaimDailyReward: () => void;
  readonly walletConnected: boolean;
  readonly hasPlayerRun: boolean;
  readonly txPending: TxPending;
}) {
  const tier = spec.rewardTier ?? RewardTier.Common;
  const now = Math.floor(Date.now() / 1000);
  const dungeonEnded = dailyDungeon ? now > dailyDungeon.endTs : false;

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
      ) : !dungeonEnded ? (
        <button className={styles.btnSecondary} disabled style={{ marginTop: 8 }}>
          Claim Daily Reward after dungeon end
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
      <WalletMultiButton className={styles.walletButton} />
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
