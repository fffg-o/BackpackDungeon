"use client";

import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import {
  generateDailyMap,
  buildLocationMerkleTree,
  getLocationProof,
  computeEnemyReward,
  computeEnemyStats,
  computeBossDamage,
  getBossShardIndex,
  type DailyLocationSpec,
  type DailyMapInput,
  type EnemyReward,
} from "@backpack-dungeon/game-core";
import { LocationKind, RewardTier } from "@backpack-dungeon/shared";
import type { LocationKind as LocationKindType } from "@backpack-dungeon/shared";
import type { EnemyConfig, BossConfig } from "@backpack-dungeon/shared";
import { mockCnftAdapter } from "@backpack-dungeon/cnft-adapter";
import type { MintResult } from "@backpack-dungeon/cnft-adapter";
import {
  simulateBattle,
  type BattleResult,
} from "./battle-sim";
import styles from "./dungeon.module.css";

// ── Types ───────────────────────────────────────────────────────────────────

type WalletState =
  | { readonly status: "disconnected" }
  | { readonly status: "connecting" }
  | { readonly status: "connected"; readonly address: string };

interface PoiDetail {
  readonly spec: DailyLocationSpec;
  readonly onChain: OnChainState | null;
  readonly merkleProof: ReturnType<typeof getLocationProof>;
}

interface OnChainState {
  readonly initialized: boolean;
  readonly clearCount?: number;
  readonly difficultyLevel?: number;
  readonly cooldownEnd?: number;
  readonly stock?: Record<number, { readonly available: number; readonly price: number }>;
  readonly bossShards?: readonly { readonly index: number; readonly totalDamage: number; readonly participantCount: number }[];
  readonly bossDefeated?: boolean;
  readonly rewardClaimed?: boolean;
}

type BattlePhase =
  | { readonly phase: "idle" }
  | { readonly phase: "simulating" }
  | { readonly phase: "result"; readonly result: BattleResult }
  | { readonly phase: "submitting" }
  | { readonly phase: "success"; readonly reward: EnemyReward; readonly mintResult: MintResult }
  | { readonly phase: "error"; readonly message: string };

type ShopBuyPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "buying"; readonly slotIndex: number }
  | { readonly phase: "bought"; readonly slotIndex: number; readonly mintResult: MintResult }
  | { readonly phase: "error"; readonly message: string };

type BossBattlePhase =
  | { readonly phase: "idle" }
  | { readonly phase: "simulating" }
  | { readonly phase: "result"; readonly result: BattleResult; readonly damage: number }
  | { readonly phase: "submitting" }
  | { readonly phase: "success"; readonly damage: number; readonly mintResult: MintResult }
  | { readonly phase: "error"; readonly message: string };

type TreasureClaimPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "claiming" }
  | { readonly phase: "claimed"; readonly mintResult: MintResult }
  | { readonly phase: "error"; readonly message: string };

// ── Constants ────────────────────────────────────────────────────────────────

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

// ── Mock on-chain state ──────────────────────────────────────────────────────

function mockOnChainState(spec: DailyLocationSpec): OnChainState | null {
  const hash = spec.baseConfigHash;
  const initThreshold = parseInt(hash.slice(0, 2), 16);
  if (initThreshold > 200) return null;

  const base: OnChainState = { initialized: true };

  if (spec.kind === LocationKind.Enemy && spec.enemy) {
    const clearCount = parseInt(hash.slice(2, 4), 16) % 8;
    return {
      ...base,
      clearCount,
      difficultyLevel: spec.enemy.level + clearCount,
      cooldownEnd: Date.now() / 1000 + 60 * (1 + clearCount * 0.05),
    };
  }

  if (spec.kind === LocationKind.Shop && spec.shop) {
    return {
      ...base,
      stock: Object.fromEntries(
        spec.shop.itemSlots.map((slot, i) => [
          i,
          {
            available: Math.max(0, slot.stock - (parseInt(hash.slice(4, 6), 16) % 3)),
            price: slot.price,
          },
        ])
      ),
    };
  }

  if (spec.kind === LocationKind.Boss && spec.boss) {
    return {
      ...base,
      bossShards: [
        { index: 0, totalDamage: 12500, participantCount: 3 },
        { index: 1, totalDamage: 8700, participantCount: 2 },
      ],
      bossDefeated: false,
    };
  }

  return base;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function isOnCooldown(onChain: OnChainState | null): boolean {
  if (!onChain?.cooldownEnd) return false;
  return onChain.cooldownEnd > Date.now() / 1000;
}

function getCooldownSeconds(onChain: OnChainState | null): number {
  if (!onChain?.cooldownEnd) return 0;
  return Math.max(0, onChain.cooldownEnd - Date.now() / 1000);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DailyDungeonPage() {
  const [wallet, setWallet] = useState<WalletState>({ status: "disconnected" });
  const [selectedPoi, setSelectedPoi] = useState<PoiDetail | null>(null);
  const [hoveredPoi, setHoveredPoi] = useState<DailyLocationSpec | null>(null);
  const [battlePhase, setBattlePhase] = useState<BattlePhase>({ phase: "idle" });
  const [shopBuyPhase, setShopBuyPhase] = useState<ShopBuyPhase>({ phase: "idle" });
  const [bossBattlePhase, setBossBattlePhase] = useState<BossBattlePhase>({ phase: "idle" });
  const [treasureClaimPhase, setTreasureClaimPhase] = useState<TreasureClaimPhase>({ phase: "idle" });
  const [localClearCounts, setLocalClearCounts] = useState<Record<string, number>>({});
  const [playerPoints, setPlayerPoints] = useState(500);

  // Cooldown ticker
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // Generate deterministic map
  const map = useMemo(() => generateDailyMap(MAP_INPUT), []);
  const merkleTree = useMemo(() => buildLocationMerkleTree(map.locations), [map]);

  // Build POI lookup
  const poiByPos = useMemo(() => {
    const map_ = new Map<string, DailyLocationSpec>();
    for (const loc of map.locations) {
      map_.set(`${loc.position.x},${loc.position.y}`, loc);
    }
    return map_;
  }, [map]);

  // Build grid cells
  const grid = useMemo(() => {
    const cells: { readonly x: number; readonly y: number; readonly poi: DailyLocationSpec | null }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        cells.push({ x, y, poi: poiByPos.get(`${x},${y}`) ?? null });
      }
    }
    return cells;
  }, [map, poiByPos]);

  const handlePoiClick = useCallback(
    (spec: DailyLocationSpec) => {
      const proof = getLocationProof(map.locations, spec.id);
      const onChain = mockOnChainState(spec);
      setSelectedPoi({ spec, onChain, merkleProof: proof });
      setBattlePhase({ phase: "idle" });
      setShopBuyPhase({ phase: "idle" });
      setBossBattlePhase({ phase: "idle" });
      setTreasureClaimPhase({ phase: "idle" });
    },
    [map]
  );

  const handleInitLocation = useCallback(() => {
    if (!selectedPoi) return;
    alert(
      `[Simulated] init_location_from_merkle called for:\n` +
        `POI: ${selectedPoi.spec.id}\n` +
        `Kind: ${selectedPoi.spec.kind}\n` +
        `Position: (${selectedPoi.spec.position.x}, ${selectedPoi.spec.position.y})\n` +
        `Merkle Root: ${merkleTree.root.slice(0, 16)}...\n` +
        `Proof length: ${selectedPoi.merkleProof.length} steps`
    );
  }, [selectedPoi, merkleTree]);

  // ── Enemy Battle Flow ─────────────────────────────────────────────────────

  const handleStartBattle = useCallback(() => {
    if (!selectedPoi?.spec.enemy || !selectedPoi.onChain) return;
    const clearCount = localClearCounts[selectedPoi.spec.id] ?? selectedPoi.onChain.clearCount ?? 0;
    const result = simulateBattle(selectedPoi.spec.enemy, clearCount);
    setBattlePhase({ phase: "result", result });
  }, [selectedPoi, localClearCounts]);

  const handleClearEnemy = useCallback(async () => {
    if (!selectedPoi?.spec.enemy || !selectedPoi.onChain) return;
    const battle = battlePhase;
    if (battle.phase !== "result" || !battle.result.won) return;

    setBattlePhase({ phase: "submitting" });

    const spec = selectedPoi.spec;
    const onChain = selectedPoi.onChain;
    const enemy = spec.enemy as EnemyConfig;
    const clearCount = (localClearCounts[spec.id] ?? onChain.clearCount ?? 0) + 1;

    try {
      // ── Step 1: Simulate clear_enemy on-chain call ──
      console.log("[Simulated] clear_enemy called for:", {
        locationId: spec.id,
        enemyId: enemy.id,
        previousClearCount: clearCount - 1,
        newClearCount: clearCount,
        battleResult: battle.result,
      });

      // Simulate network delay
      await new Promise((r) => setTimeout(r, 600));

      // ── Step 2: Compute reward ──
      const reward = computeEnemyReward(
        MASTER_SEED,
        { ...spec, enemy },
        clearCount - 1,
        {
          damageTaken: battle.result.damageTaken,
          flawless: battle.result.flawless,
          turnsTaken: battle.result.turnsTaken,
        }
      );

      // ── Step 3: Mint cNFT for loot ──
      const mintResult = await mockCnftAdapter.mintEnemyLootCnft({
        name: `${enemy.name} Loot`,
        symbol: "LOOT",
        description: `Spoils from defeating ${enemy.name} (clear #${clearCount})`,
        image: `https://backpack-dungeon.example/loot/${reward.itemId}.png`,
        attributes: [
          { trait_type: "category", value: "enemy_loot" },
          { trait_type: "enemy_id", value: enemy.id },
          { trait_type: "reward_tier", value: reward.tier },
          { trait_type: "day_id", value: map.dayId },
          { trait_type: "clear_count", value: clearCount },
          { trait_type: "item_id", value: reward.itemId },
          { trait_type: "amount", value: reward.amount },
        ],
      });

      // ── Step 4: Add points to player ──
      setPlayerPoints((prev) => prev + reward.amount);

      // ── Step 5: Update local state ──
      setLocalClearCounts((prev) => ({
        ...prev,
        [spec.id]: clearCount,
      }));

      setBattlePhase({ phase: "success", reward, mintResult });
    } catch (err) {
      setBattlePhase({
        phase: "error",
        message: err instanceof Error ? err.message : "Unknown error during clear_enemy",
      });
    }
  }, [selectedPoi, battlePhase, localClearCounts, map.dayId]);

  const handleRetry = useCallback(() => {
    setBattlePhase({ phase: "idle" });
  }, []);

  // ── Shop Buy Flow ─────────────────────────────────────────────────────────

  const handleBuyItem = useCallback(async (slotIndex: number) => {
    if (!selectedPoi?.spec.shop || !selectedPoi.onChain?.stock) return;
    const slot = selectedPoi.spec.shop.itemSlots[slotIndex];
    const stockInfo = selectedPoi.onChain.stock[slotIndex];
    if (!stockInfo || stockInfo.available <= 0) return;
    if (playerPoints < stockInfo.price) {
      setShopBuyPhase({ phase: "error", message: "Insufficient points!" });
      return;
    }

    setShopBuyPhase({ phase: "buying", slotIndex });

    try {
      await new Promise((r) => setTimeout(r, 500));

      // Deduct points
      setPlayerPoints((prev) => prev - stockInfo.price);

      // Mint cNFT for purchased item (use EnemyLootMetadata-compatible attributes)
      const mintResult = await mockCnftAdapter.mintEnemyLootCnft({
        name: `${slot.itemId}`,
        symbol: "ITEM",
        description: `Purchased from shop: ${slot.itemId}`,
        image: `https://backpack-dungeon.example/items/${slot.itemId}.png`,
        attributes: [
          { trait_type: "category", value: "enemy_loot" },
          { trait_type: "enemy_id", value: "shop" },
          { trait_type: "reward_tier", value: slot.rewardTier },
          { trait_type: "day_id", value: map.dayId },
          { trait_type: "item_id", value: slot.itemId },
          { trait_type: "price", value: stockInfo.price },
        ],
      });

      setShopBuyPhase({ phase: "bought", slotIndex, mintResult });
    } catch (err) {
      setShopBuyPhase({
        phase: "error",
        message: err instanceof Error ? err.message : "Purchase failed",
      });
    }
  }, [selectedPoi, playerPoints, map.dayId]);

  // ── Boss Battle Flow ──────────────────────────────────────────────────────

  const handleStartBossBattle = useCallback(() => {
    if (!selectedPoi?.spec.boss || !selectedPoi.onChain) return;
    setBossBattlePhase({ phase: "simulating" });

    // Simulate boss battle using enemy battle sim with boss config
    const boss = selectedPoi.spec.boss;
    const bossAsEnemy: EnemyConfig = {
      id: boss.id,
      name: boss.name,
      level: boss.level,
      maxHealth: boss.maxHealth,
      attack: boss.attack,
      rewardTier: boss.rewardTier,
    };

    // Small delay for UX
    setTimeout(() => {
      const result = simulateBattle(bossAsEnemy, 0);
      const damage = computeBossDamage({
        baseDamage: result.damageTaken > 0 ? Math.max(10, 100 - result.damageTaken) : 150,
        blockedDamage: 0,
        bonusDamage: result.flawless ? 50 : 0,
        multiplierBps: 10_000,
      });
      setBossBattlePhase({ phase: "result", result, damage });
    }, 400);
  }, [selectedPoi]);

  const handleSubmitBossDamage = useCallback(async () => {
    const bossBattle = bossBattlePhase;
    if (bossBattle.phase !== "result") return;

    setBossBattlePhase({ phase: "submitting" });

    try {
      await new Promise((r) => setTimeout(r, 600));

      const mintResult = await mockCnftAdapter.mintBossParticipationCnft({
        name: "Boss Participation",
        symbol: "BOSS",
        description: `Dealt ${bossBattle.damage} damage to boss`,
        image: "https://backpack-dungeon.example/boss/participation.png",
        attributes: [
          { trait_type: "category", value: "boss_participation" },
          { trait_type: "boss_id", value: selectedPoi?.spec.boss?.id ?? "unknown" },
          { trait_type: "day_id", value: map.dayId },
          { trait_type: "damage", value: bossBattle.damage },
        ],
      });

      setPlayerPoints((prev) => prev + Math.floor(bossBattle.damage / 2));
      setBossBattlePhase({ phase: "success", damage: bossBattle.damage, mintResult });
    } catch (err) {
      setBossBattlePhase({
        phase: "error",
        message: err instanceof Error ? err.message : "Failed to submit boss damage",
      });
    }
  }, [bossBattlePhase, selectedPoi, map.dayId]);

  // ── Treasure Claim Flow ───────────────────────────────────────────────────

  const handleClaimTreasure = useCallback(async () => {
    if (!selectedPoi?.spec) return;
    setTreasureClaimPhase({ phase: "claiming" });

    try {
      await new Promise((r) => setTimeout(r, 600));

      const tier = selectedPoi.spec.rewardTier ?? RewardTier.Common;
      const mintResult = await mockCnftAdapter.mintDailyRewardNft({
        name: `${tier} Treasure`,
        symbol: "TREASURE",
        description: `Treasure reward from daily dungeon`,
        image: `https://backpack-dungeon.example/treasure/${tier}.png`,
        attributes: [
          { trait_type: "category", value: "daily_reward" },
          { trait_type: "day_id", value: map.dayId },
          { trait_type: "tier", value: tier },
        ],
      });

      const points = { Common: 50, Uncommon: 100, Rare: 200, Epic: 500, Legendary: 1000 }[tier] ?? 50;
      setPlayerPoints((prev) => prev + points);
      setTreasureClaimPhase({ phase: "claimed", mintResult });
    } catch (err) {
      setTreasureClaimPhase({
        phase: "error",
        message: err instanceof Error ? err.message : "Failed to claim treasure",
      });
    }
  }, [selectedPoi, map.dayId]);

  // ── Wallet Connection ─────────────────────────────────────────────────────

  const connectWallet = useCallback(async () => {
    setWallet({ status: "connecting" });

    // Try real wallet-standard (window.solana / window.phantom)
    const solana = (window as unknown as Record<string, unknown>).solana as
      | { isPhantom?: boolean; connect: () => Promise<{ publicKey: { toString: () => string } }>; on?: (event: string, handler: () => void) => void }
      | undefined;

    if (solana?.connect) {
      try {
        const response = await solana.connect();
        setWallet({
          status: "connected",
          address: response.publicKey.toString(),
        });
        return;
      } catch {
        // User rejected or wallet error, fallback to mock
      }
    }

    // Fallback: mock wallet
    setTimeout(() => {
      setWallet({
        status: "connected",
        address: "DxLVLJqKxKxKxKxKxKxKxKxKxKxKxKxKxKxKxKxKxKx",
      });
    }, 800);
  }, []);

  const disconnectWallet = useCallback(() => {
    setWallet({ status: "disconnected" });
    setSelectedPoi(null);
    setBattlePhase({ phase: "idle" });
    setShopBuyPhase({ phase: "idle" });
    setBossBattlePhase({ phase: "idle" });
    setTreasureClaimPhase({ phase: "idle" });
  }, []);

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>🗺️ Daily Dungeon</h1>
          <span className={styles.dayId}>{map.dayId}</span>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.stats}>
            <span title="Player Points" className={styles.stat}>
              🪙 {playerPoints}
            </span>
            <span title="Seed hash" className={styles.stat}>
              🌱 {map.seedHash.slice(0, 12)}...
            </span>
            <span title="Total POIs" className={styles.stat}>
              📍 {map.locations.length}
            </span>
            <span title="Map size" className={styles.stat}>
              🗺️ {map.width}×{map.height}
            </span>
          </div>
          {wallet.status === "connected" ? (
            <div className={styles.walletInfo}>
              <span className={styles.walletAddress}>
                {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
              </span>
              <button className={styles.btnSecondary} onClick={disconnectWallet}>
                Disconnect
              </button>
            </div>
          ) : (
            <button
              className={styles.btnPrimary}
              onClick={connectWallet}
              disabled={wallet.status === "connecting"}
            >
              {wallet.status === "connecting" ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </header>

      {/* Legend */}
      <div className={styles.legend}>
        {Object.entries(POI_ICONS).map(([kind, icon]) => (
          <span key={kind} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: POI_COLORS[kind as LocationKindType] }} />
            {icon} {kind}
          </span>
        ))}
      </div>

      {/* Main content */}
      <div className={styles.content}>
        {/* Map grid */}
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

        {/* POI Detail panel */}
        <aside className={styles.sidebar}>
          {selectedPoi ? (
            <PoiDetailPanel
              detail={selectedPoi}
              merkleRoot={merkleTree.root}
              onInitLocation={handleInitLocation}
              walletConnected={wallet.status === "connected"}
              battlePhase={battlePhase}
              onStartBattle={handleStartBattle}
              onClearEnemy={handleClearEnemy}
              onRetry={handleRetry}
              localClearCount={selectedPoi ? (localClearCounts[selectedPoi.spec.id] ?? selectedPoi.onChain?.clearCount ?? 0) : 0}
              shopBuyPhase={shopBuyPhase}
              onBuyItem={handleBuyItem}
              playerPoints={playerPoints}
              bossBattlePhase={bossBattlePhase}
              onStartBossBattle={handleStartBossBattle}
              onSubmitBossDamage={handleSubmitBossDamage}
              treasureClaimPhase={treasureClaimPhase}
              onClaimTreasure={handleClaimTreasure}
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

// ── POI Detail Panel ─────────────────────────────────────────────────────────

function PoiDetailPanel({
  detail,
  merkleRoot,
  onInitLocation,
  walletConnected,
  battlePhase,
  onStartBattle,
  onClearEnemy,
  onRetry,
  localClearCount,
  shopBuyPhase,
  onBuyItem,
  playerPoints,
  bossBattlePhase,
  onStartBossBattle,
  onSubmitBossDamage,
  treasureClaimPhase,
  onClaimTreasure,
}: {
  readonly detail: PoiDetail;
  readonly merkleRoot: string;
  readonly onInitLocation: () => void;
  readonly walletConnected: boolean;
  readonly battlePhase: BattlePhase;
  readonly onStartBattle: () => void;
  readonly onClearEnemy: () => void;
  readonly onRetry: () => void;
  readonly localClearCount: number;
  readonly shopBuyPhase: ShopBuyPhase;
  readonly onBuyItem: (slotIndex: number) => void;
  readonly playerPoints: number;
  readonly bossBattlePhase: BossBattlePhase;
  readonly onStartBossBattle: () => void;
  readonly onSubmitBossDamage: () => void;
  readonly treasureClaimPhase: TreasureClaimPhase;
  readonly onClaimTreasure: () => void;
}) {
  const { spec, onChain, merkleProof } = detail;
  const onCooldown = isOnCooldown(onChain);
  const cooldownSecs = getCooldownSeconds(onChain);

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

      {/* Enemy details */}
      {spec.kind === LocationKind.Enemy && spec.enemy && (
        <EnemyContent
          enemy={spec.enemy}
          onChain={onChain}
          battlePhase={battlePhase}
          onStartBattle={onStartBattle}
          onClearEnemy={onClearEnemy}
          onRetry={onRetry}
          onCooldown={onCooldown}
          cooldownSecs={cooldownSecs}
          localClearCount={localClearCount}
        />
      )}

      {/* Shop details with buy functionality */}
      {spec.kind === LocationKind.Shop && spec.shop && (
        <ShopContent
          shop={spec.shop}
          onChain={onChain}
          shopBuyPhase={shopBuyPhase}
          onBuyItem={onBuyItem}
          playerPoints={playerPoints}
          walletConnected={walletConnected}
        />
      )}

      {/* Boss details with battle */}
      {spec.kind === LocationKind.Boss && spec.boss && (
        <BossContent
          boss={spec.boss}
          onChain={onChain}
          bossBattlePhase={bossBattlePhase}
          onStartBossBattle={onStartBossBattle}
          onSubmitBossDamage={onSubmitBossDamage}
          walletConnected={walletConnected}
        />
      )}

      {/* Treasure details with claim */}
      {spec.kind === LocationKind.Treasure && (
        <TreasureContent
          spec={spec}
          onChain={onChain}
          treasureClaimPhase={treasureClaimPhase}
          onClaimTreasure={onClaimTreasure}
          walletConnected={walletConnected}
        />
      )}

      {/* Merkle proof info */}
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

      {/* Init location button */}
      {spec.kind !== LocationKind.Enemy && !onChain?.initialized && walletConnected && (
        <button className={styles.btnInit} onClick={onInitLocation}>
          🚀 Init Location from Merkle Proof
        </button>
      )}
      {spec.kind !== LocationKind.Enemy && !walletConnected && (
        <p className={styles.hint}>Connect wallet to initialize this location on-chain</p>
      )}
      {spec.kind !== LocationKind.Enemy && onChain?.initialized && (
        <p className={styles.initialized}>✅ Initialized on-chain</p>
      )}
    </div>
  );
}

// ── Enemy Content ────────────────────────────────────────────────────────────

function EnemyContent({
  enemy,
  onChain,
  battlePhase,
  onStartBattle,
  onClearEnemy,
  onRetry,
  onCooldown,
  cooldownSecs,
  localClearCount,
}: {
  readonly enemy: NonNullable<DailyLocationSpec["enemy"]>;
  readonly onChain: OnChainState | null;
  readonly battlePhase: BattlePhase;
  readonly onStartBattle: () => void;
  readonly onClearEnemy: () => void;
  readonly onRetry: () => void;
  readonly onCooldown: boolean;
  readonly cooldownSecs: number;
  readonly localClearCount: number;
}) {
  return (
    <div className={styles.detailSection}>
      <h3 className={styles.sectionTitle}>⚔️ {enemy.name}</h3>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Level</span>
        <span className={styles.metaValue}>{enemy.level}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>HP</span>
        <span className={styles.metaValue}>{enemy.maxHealth}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Attack</span>
        <span className={styles.metaValue}>{enemy.attack}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Clear Count</span>
        <span className={styles.metaValue}>{localClearCount}</span>
      </div>
      {onChain?.difficultyLevel !== undefined && (
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>Difficulty</span>
          <span className={styles.metaValue}>{onChain.difficultyLevel}</span>
        </div>
      )}

      {onCooldown ? (
        <div className={styles.cooldown}>
          ⏳ Cooldown: {formatCooldown(cooldownSecs)}
        </div>
      ) : battlePhase.phase === "idle" ? (
        <button className={styles.btnClear} onClick={onStartBattle} style={{ marginTop: 8 }}>
          ⚔️ Start Battle
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
            <span className={styles.metaValue}>
              {battlePhase.result.won ? "✅ Victory" : "❌ Defeated"}
            </span>
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
            <button className={styles.btnClear} onClick={onClearEnemy} style={{ marginTop: 8 }}>
              📤 Submit Clear
            </button>
          ) : (
            <button className={styles.btnSecondary} onClick={onRetry} style={{ marginTop: 8 }}>
              🔄 Retry
            </button>
          )}
        </div>
      ) : battlePhase.phase === "submitting" ? (
        <div className={styles.battleSimulating}>
          <div className={styles.spinner} />
          <span>Submitting clear...</span>
        </div>
      ) : battlePhase.phase === "success" ? (
        <div className={styles.initialized}>
          ✅ Cleared! +{battlePhase.reward.amount} 🪙
          <div className={styles.detailMeta} style={{ marginTop: 4 }}>
            <span className={styles.metaLabel}>Tier</span>
            <span className={styles.metaValue} style={{ color: rewardTierColor(battlePhase.reward.tier) }}>
              {battlePhase.reward.tier}
            </span>
          </div>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>cNFT</span>
            <span className={styles.metaValue}>{battlePhase.mintResult.log}</span>
          </div>
        </div>
      ) : battlePhase.phase === "error" ? (
        <div className={styles.battleError} style={{ marginTop: 6 }}>
          ❌ {battlePhase.message}
        </div>
      ) : null}
    </div>
  );
}

// ── Shop Content ─────────────────────────────────────────────────────────────

function ShopContent({
  shop,
  onChain,
  shopBuyPhase,
  onBuyItem,
  playerPoints,
  walletConnected,
}: {
  readonly shop: NonNullable<DailyLocationSpec["shop"]>;
  readonly onChain: OnChainState | null;
  readonly shopBuyPhase: ShopBuyPhase;
  readonly onBuyItem: (slotIndex: number) => void;
  readonly playerPoints: number;
  readonly walletConnected: boolean;
}) {
  return (
    <div className={styles.detailSection}>
      <h3 className={styles.sectionTitle}>🏪 Shop</h3>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Keeper</span>
        <span className={styles.metaValue}>{shop.keeperName ?? "Unknown"}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Your Points</span>
        <span className={styles.metaValue}>{playerPoints} 🪙</span>
      </div>
      <h3 className={styles.sectionTitle}>Items</h3>
      {shop.itemSlots.map((slot, i) => {
        const stockInfo = onChain?.stock?.[i];
        const isBuying = shopBuyPhase.phase === "buying" && shopBuyPhase.slotIndex === i;
        const isBought = shopBuyPhase.phase === "bought" && shopBuyPhase.slotIndex === i;
        const canAfford = stockInfo ? playerPoints >= stockInfo.price : false;
        const inStock = stockInfo ? stockInfo.available > 0 : true;

        return (
          <div key={slot.slotId} className={styles.shopSlot}>
            <div className={styles.shopSlotHeader}>
              <span className={styles.shopSlotName}>{slot.itemId}</span>
              <span className={styles.shopSlotTier} style={{ color: rewardTierColor(slot.rewardTier) }}>
                {slot.rewardTier}
              </span>
            </div>
            <div className={styles.detailMeta}>
              <span className={styles.metaLabel}>Base Price</span>
              <span className={styles.metaValue}>{slot.price} 🪙</span>
            </div>
            {stockInfo && (
              <>
                <div className={styles.detailMeta}>
                  <span className={styles.metaLabel}>Available</span>
                  <span className={styles.metaValue}>{stockInfo.available}</span>
                </div>
                <div className={styles.detailMeta}>
                  <span className={styles.metaLabel}>Current Price</span>
                  <span className={styles.metaValue}>{stockInfo.price} 🪙</span>
                </div>
              </>
            )}
            {isBought ? (
              <div className={styles.initialized}>✅ Purchased!</div>
            ) : isBuying ? (
              <div className={styles.battleSimulating}>
                <div className={styles.spinner} />
                <span>Buying...</span>
              </div>
            ) : (
              walletConnected && inStock && (
                <button
                  className={styles.btnClear}
                  onClick={() => onBuyItem(i)}
                  disabled={!canAfford}
                  style={{ marginTop: 6, opacity: canAfford ? 1 : 0.5 }}
                >
                  {canAfford ? `🛒 Buy (${stockInfo?.price ?? slot.price} 🪙)` : "❌ Insufficient Points"}
                </button>
              )
            )}
            {shopBuyPhase.phase === "error" && (
              <div className={styles.battleError} style={{ marginTop: 6 }}>
                ❌ {shopBuyPhase.message}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Boss Content ─────────────────────────────────────────────────────────────

function BossContent({
  boss,
  onChain,
  bossBattlePhase,
  onStartBossBattle,
  onSubmitBossDamage,
  walletConnected,
}: {
  readonly boss: NonNullable<DailyLocationSpec["boss"]>;
  readonly onChain: OnChainState | null;
  readonly bossBattlePhase: BossBattlePhase;
  readonly onStartBossBattle: () => void;
  readonly onSubmitBossDamage: () => void;
  readonly walletConnected: boolean;
}) {
  return (
    <div className={styles.detailSection}>
      <h3 className={styles.sectionTitle}>👹 Boss: {boss.name}</h3>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Level</span>
        <span className={styles.metaValue}>{boss.level}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>HP</span>
        <span className={styles.metaValue}>{boss.maxHealth}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Attack</span>
        <span className={styles.metaValue}>{boss.attack}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Reward Tier</span>
        <span className={styles.metaValue} style={{ color: rewardTierColor(boss.rewardTier) }}>
          {boss.rewardTier}
        </span>
      </div>

      {/* Shard progress */}
      {onChain?.bossShards && (
        <div className={styles.bossShards}>
          <h4 className={styles.sectionTitle}>Shard Progress</h4>
          {onChain.bossShards.map((shard) => (
            <div key={shard.index} className={styles.detailMeta}>
              <span className={styles.metaLabel}>Shard #{shard.index}</span>
              <span className={styles.metaValue}>
                {shard.totalDamage} dmg ({shard.participantCount} players)
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Boss battle UI */}
      {bossBattlePhase.phase === "idle" && walletConnected && (
        <button className={styles.btnClear} onClick={onStartBossBattle} style={{ marginTop: 8 }}>
          ⚔️ Start Boss Battle
        </button>
      )}

      {bossBattlePhase.phase === "simulating" && (
        <div className={styles.battleSimulating}>
          <div className={styles.spinner} />
          <span>Simulating boss battle...</span>
        </div>
      )}

      {bossBattlePhase.phase === "result" && (
        <div className={styles.battleResult}>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Outcome</span>
            <span className={styles.metaValue}>
              {bossBattlePhase.result.won ? "✅ Victory" : "❌ Defeated"}
            </span>
          </div>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Damage Dealt</span>
            <span className={styles.metaValue}>{bossBattlePhase.damage}</span>
          </div>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Turns</span>
            <span className={styles.metaValue}>{bossBattlePhase.result.turnsTaken}</span>
          </div>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Damage Taken</span>
            <span className={styles.metaValue}>{bossBattlePhase.result.damageTaken}</span>
          </div>
          <div className={styles.buttonRow} style={{ marginTop: 8 }}>
            <button className={styles.btnClear} onClick={onSubmitBossDamage}>
              📤 Submit Damage
            </button>
            <button className={styles.btnSecondary} onClick={onStartBossBattle}>
              🔄 Retry
            </button>
          </div>
        </div>
      )}

      {bossBattlePhase.phase === "submitting" && (
        <div className={styles.battleSimulating}>
          <div className={styles.spinner} />
          <span>Submitting boss damage...</span>
        </div>
      )}

      {bossBattlePhase.phase === "success" && (
        <div className={styles.initialized}>
          ✅ Submitted {bossBattlePhase.damage} damage!
          <div className={styles.detailMeta} style={{ marginTop: 4 }}>
            <span className={styles.metaLabel}>cNFT</span>
            <span className={styles.metaValue}>{bossBattlePhase.mintResult.log}</span>
          </div>
        </div>
      )}

      {bossBattlePhase.phase === "error" && (
        <div className={styles.battleError} style={{ marginTop: 6 }}>
          ❌ {bossBattlePhase.message}
        </div>
      )}

      {!walletConnected && (
        <p className={styles.hint}>Connect wallet to fight the boss</p>
      )}
    </div>
  );
}

// ── Treasure Content ──────────────────────────────────────────────────────────

function TreasureContent({
  spec,
  onChain,
  treasureClaimPhase,
  onClaimTreasure,
  walletConnected,
}: {
  readonly spec: DailyLocationSpec;
  readonly onChain: OnChainState | null;
  readonly treasureClaimPhase: TreasureClaimPhase;
  readonly onClaimTreasure: () => void;
  readonly walletConnected: boolean;
}) {
  const tier = spec.rewardTier ?? RewardTier.Common;
  const tierPoints: Record<string, number> = {
    Common: 50,
    Uncommon: 100,
    Rare: 200,
    Epic: 500,
    Legendary: 1000,
  };

  return (
    <div className={styles.detailSection}>
      <h3 className={styles.sectionTitle}>💎 Treasure</h3>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Tier</span>
        <span className={styles.metaValue} style={{ color: rewardTierColor(tier) }}>
          {tier}
        </span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Reward</span>
        <span className={styles.metaValue}>{tierPoints[tier] ?? 50} 🪙</span>
      </div>

      {treasureClaimPhase.phase === "idle" && walletConnected && (
        <button className={styles.btnClear} onClick={onClaimTreasure} style={{ marginTop: 8 }}>
          🎁 Claim Treasure
        </button>
      )}

      {treasureClaimPhase.phase === "claiming" && (
        <div className={styles.battleSimulating}>
          <div className={styles.spinner} />
          <span>Claiming treasure...</span>
        </div>
      )}

      {treasureClaimPhase.phase === "claimed" && (
        <div className={styles.initialized}>
          ✅ Claimed {tier} Treasure!
          <div className={styles.detailMeta} style={{ marginTop: 4 }}>
            <span className={styles.metaLabel}>cNFT</span>
            <span className={styles.metaValue}>{treasureClaimPhase.mintResult.log}</span>
          </div>
        </div>
      )}

      {treasureClaimPhase.phase === "error" && (
        <div className={styles.battleError} style={{ marginTop: 6 }}>
          ❌ {treasureClaimPhase.message}
        </div>
      )}

      {!walletConnected && (
        <p className={styles.hint}>Connect wallet to claim treasure</p>
      )}
    </div>
  );
}
