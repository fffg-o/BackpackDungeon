"use client";

import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import {
  generateDailyMap,
  buildLocationMerkleTree,
  getLocationProof,
  computeEnemyReward,
  type DailyLocationSpec,
  type DailyMapInput,
  type EnemyReward,
} from "@backpack-dungeon/game-core";
import { LocationKind } from "@backpack-dungeon/shared";
import type { LocationKind as LocationKindType } from "@backpack-dungeon/shared";
import type { EnemyConfig } from "@backpack-dungeon/shared";
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
}

type BattlePhase =
  | { readonly phase: "idle" }
  | { readonly phase: "simulating" }
  | { readonly phase: "result"; readonly result: BattleResult }
  | { readonly phase: "submitting" }
  | { readonly phase: "success"; readonly reward: EnemyReward; readonly mintResult: MintResult }
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
  const [localClearCounts, setLocalClearCounts] = useState<Record<string, number>>({});

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

      // ── Step 3: Mint cNFT for low-value loot ──
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

      // ── Step 4: Update local state ──
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

  const connectWallet = useCallback(() => {
    setWallet({ status: "connecting" });
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

      {/* Shop details */}
      {spec.kind === LocationKind.Shop && spec.shop && (
        <div className={styles.detailSection}>
          <h3 className={styles.sectionTitle}>🏪 Shop</h3>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Keeper</span>
            <span className={styles.metaValue}>{spec.shop.keeperName ?? "Unknown"}</span>
          </div>
          <h3 className={styles.sectionTitle}>Items</h3>
          {spec.shop.itemSlots.map((slot, i) => (
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
              <div className={styles.detailMeta}>
                <span className={styles.metaLabel}>Base Stock</span>
                <span className={styles.metaValue}>{slot.stock}</span>
              </div>
              {onChain?.stock?.[i] && (
                <>
                  <div className={styles.detailMeta}>
                    <span className={styles.metaLabel}>Available</span>
                    <span className={styles.metaValue}>{onChain.stock[i].available}</span>
                  </div>
                  <div className={styles.detailMeta}>
                    <span className={styles.metaLabel}>Current Price</span>
                    <span className={styles.metaValue}>{onChain.stock[i].price} 🪙</span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Boss details */}
      {spec.kind === LocationKind.Boss && spec.boss && (
        <div className={styles.detailSection}>
          <h3 className={styles.sectionTitle}>👹 Boss</h3>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Name</span>
            <span className={styles.metaValue}>{spec.boss.name}</span>
          </div>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Level</span>
            <span className={styles.metaValue}>{spec.boss.level}</span>
          </div>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>HP</span>
            <span className={styles.metaValue}>{spec.boss.maxHealth}</span>
          </div>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Attack</span>
            <span className={styles.metaValue}>{spec.boss.attack}</span>
          </div>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Reward Tier</span>
            <span className={styles.metaValue} style={{ color: rewardTierColor(spec.boss.rewardTier) }}>
              {spec.boss.rewardTier}
            </span>
          </div>

          {onChain?.bossShards && (
            <>
              <h3 className={styles.sectionTitle}>💥 Shard Progress</h3>
              {onChain.bossShards.map((shard) => (
                <div key={shard.index} className={styles.shardRow}>
                  <span className={styles.shardLabel}>Shard #{shard.index}</span>
                  <span className={styles.shardValue}>
                    {shard.totalDamage.toLocaleString()} dmg · {shard.participantCount} players
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Treasure details */}
      {spec.kind === LocationKind.Treasure && (
        <div className={styles.detailSection}>
          <h3 className={styles.sectionTitle}>💎 Treasure</h3>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Reward Tier</span>
            <span className={styles.metaValue} style={{ color: rewardTierColor(spec.rewardTier ?? "Common") }}>
              {spec.rewardTier ?? "Common"}
            </span>
          </div>
        </div>
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

      {/* Init location button (only when not enemy — enemy uses battle flow) */}
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

// ── Enemy Content (battle flow) ──────────────────────────────────────────────

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
  readonly enemy: EnemyConfig;
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
      <h3 className={styles.sectionTitle}>⚔️ Enemy</h3>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Name</span>
        <span className={styles.metaValue}>{enemy.name}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Level</span>
        <span className={styles.metaValue}>{enemy.level}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Base HP</span>
        <span className={styles.metaValue}>{enemy.maxHealth}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Base Attack</span>
        <span className={styles.metaValue}>{enemy.attack}</span>
      </div>
      <div className={styles.detailMeta}>
        <span className={styles.metaLabel}>Reward Tier</span>
        <span className={styles.metaValue} style={{ color: rewardTierColor(enemy.rewardTier) }}>
          {enemy.rewardTier}
        </span>
      </div>

      {/* On-chain state */}
      {onChain && (
        <>
          <h3 className={styles.sectionTitle}>📊 On-Chain State</h3>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Clear Count</span>
            <span className={styles.metaValue}>{localClearCount}</span>
          </div>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Difficulty</span>
            <span className={styles.metaValue}>{onChain.difficultyLevel ?? enemy.level}</span>
          </div>
          <div className={styles.detailMeta}>
            <span className={styles.metaLabel}>Cooldown</span>
            <span className={styles.metaValue} style={{ color: onCooldown ? "#e74c3c" : "#2ecc71" }}>
              {onCooldown ? `⏳ ${formatCooldown(cooldownSecs)}` : "✅ Ready"}
            </span>
          </div>
        </>
      )}

      {/* ── Battle Flow ── */}
      <div className={styles.battleSection}>
        {battlePhase.phase === "idle" && onChain?.initialized && !onCooldown && (
          <button className={styles.btnBattle} onClick={onStartBattle}>
            ⚔️ Start Battle
          </button>
        )}

        {battlePhase.phase === "idle" && onCooldown && (
          <div className={styles.cooldownNotice}>
            ⏳ Enemy on cooldown — {formatCooldown(cooldownSecs)} remaining
          </div>
        )}

        {battlePhase.phase === "simulating" && (
          <div className={styles.battleSimulating}>
            <div className={styles.spinner} />
            <span>Simulating battle...</span>
          </div>
        )}

        {battlePhase.phase === "result" && (
          <BattleResultView
            result={battlePhase.result}
            onClear={onClearEnemy}
            onRetry={onRetry}
          />
        )}

        {battlePhase.phase === "submitting" && (
          <div className={styles.battleSimulating}>
            <div className={styles.spinner} />
            <span>Submitting clear_enemy to chain...</span>
          </div>
        )}

        {battlePhase.phase === "success" && (
          <ClearSuccessView
            reward={battlePhase.reward}
            mintResult={battlePhase.mintResult}
            onRetry={onRetry}
          />
        )}

        {battlePhase.phase === "error" && (
          <div className={styles.battleError}>
            <span>❌ {battlePhase.message}</span>
            <button className={styles.btnSecondary} onClick={onRetry}>
              Dismiss
            </button>
          </div>
        )}

        {!onChain?.initialized && (
          <p className={styles.hint}>Initialize this location on-chain to battle</p>
        )}
      </div>
    </div>
  );
}

// ── Battle Result View ───────────────────────────────────────────────────────

function BattleResultView({
  result,
  onClear,
  onRetry,
}: {
  readonly result: BattleResult;
  readonly onClear: () => void;
  readonly onRetry: () => void;
}) {
  const [showLog, setShowLog] = useState(false);

  return (
    <div className={styles.battleResult}>
      <h3 className={styles.sectionTitle}>
        {result.won ? "🎉 Victory!" : "💀 Defeated"}
      </h3>

      <div className={styles.battleStats}>
        <div className={styles.battleStat}>
          <span className={styles.metaLabel}>Turns</span>
          <span className={styles.metaValue}>{result.turnsTaken}</span>
        </div>
        <div className={styles.battleStat}>
          <span className={styles.metaLabel}>Damage Taken</span>
          <span className={styles.metaValue}>{result.damageTaken}</span>
        </div>
        <div className={styles.battleStat}>
          <span className={styles.metaLabel}>Flawless</span>
          <span className={styles.metaValue}>{result.flawless ? "✅" : "❌"}</span>
        </div>
      </div>

      {/* Battle log toggle */}
      <button
        className={styles.btnLogToggle}
        onClick={() => setShowLog((v) => !v)}
      >
        {showLog ? "📜 Hide Battle Log" : "📜 Show Battle Log"}
      </button>

      {showLog && (
        <div className={styles.battleLog}>
          {result.log.map((entry, i) => (
            <div key={i} className={styles.logEntry}>
              <span className={styles.logTurn}>T{entry.turn}</span>
              <span className={entry.attacker === "player" ? styles.logPlayer : styles.logEnemy}>
                {entry.attacker === "player" ? "⚔️ You" : "👹 Enemy"}
              </span>
              <span className={styles.logDamage}>
                {entry.damage > 0 ? `-${entry.damage} HP` : "miss"}
              </span>
              <span className={styles.logHp}>
                (P:{entry.playerHpAfter} E:{entry.enemyHpAfter})
              </span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.battleActions}>
        {result.won ? (
          <button className={styles.btnClear} onClick={onClear}>
            🏆 Submit Clear (clear_enemy)
          </button>
        ) : (
          <p className={styles.defeatHint}>You were defeated. Try again!</p>
        )}
        <button className={styles.btnSecondary} onClick={onRetry}>
          🔄 Retry Battle
        </button>
      </div>
    </div>
  );
}

// ── Clear Success View ───────────────────────────────────────────────────────

function ClearSuccessView({
  reward,
  mintResult,
  onRetry,
}: {
  readonly reward: EnemyReward;
  readonly mintResult: MintResult;
  readonly onRetry: () => void;
}) {
  return (
    <div className={styles.clearSuccess}>
      <h3 className={styles.sectionTitle}>🏆 Clear Successful!</h3>

      {/* Reward metadata */}
      <div className={styles.lootCard}>
        <div className={styles.lootHeader}>
          <span className={styles.lootIcon}>🎁</span>
          <span className={styles.lootTitle}>Loot Drop</span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>Item</span>
          <span className={styles.metaValue}>{reward.itemId}</span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>Tier</span>
          <span className={styles.metaValue} style={{ color: rewardTierColor(reward.tier) }}>
            {reward.tier}
          </span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>Amount</span>
          <span className={styles.metaValue}>{reward.amount} 🪙</span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>Clear #</span>
          <span className={styles.metaValue}>{reward.clearCount + 1}</span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>Cooldown</span>
          <span className={styles.metaValue}>{formatCooldown(reward.cooldownSeconds)}</span>
        </div>
      </div>

      {/* cNFT mint result */}
      <div className={styles.cnftResult}>
        <div className={styles.cnftHeader}>
          <span>🧊 cNFT Minted</span>
          <span className={mintResult.success ? styles.cnftSuccess : styles.cnftFailed}>
            {mintResult.success ? "✅" : "❌"}
          </span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>Log</span>
          <span className={styles.metaValue} style={{ fontSize: 11 }}>
            {mintResult.log}
          </span>
        </div>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>Minted At</span>
          <span className={styles.metaValue} style={{ fontSize: 11 }}>
            {mintResult.mintedAt}
          </span>
        </div>
      </div>

      <button className={styles.btnSecondary} onClick={onRetry} style={{ marginTop: 8 }}>
        🔙 Back to Enemy Details
      </button>
    </div>
  );
}
