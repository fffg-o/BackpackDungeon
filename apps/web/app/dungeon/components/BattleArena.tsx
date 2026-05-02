import type {
  BattleCombatantStatsV1,
  BattleResultV1,
} from "@backpack-dungeon/game-core";
import { ActionButton } from "./ActionButton";
import { CombatLog } from "./CombatLog";
import { HpBar } from "./HpBar";
import { StatPill } from "./StatPill";
import { TxStatusCard } from "./TxStatusCard";
import styles from "../dungeon.module.css";

export type BattleArenaPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "preparing" }
  | { readonly phase: "replaying"; readonly result: BattleResultV1; readonly replayIndex: number; readonly damage?: number }
  | { readonly phase: "result"; readonly result: BattleResultV1; readonly damage?: number }
  | { readonly phase: "submitting" }
  | { readonly phase: "success"; readonly signature: string; readonly damage?: number }
  | { readonly phase: "error"; readonly message: string };

export interface BattleArenaProps {
  readonly title: string;
  readonly encounterKind: "enemy" | "boss";
  readonly playerName?: string;
  readonly enemyName: string;
  readonly playerStats?: BattleCombatantStatsV1;
  readonly enemyStats?: BattleCombatantStatsV1;
  readonly phase: BattleArenaPhase;
  readonly replayIndex?: number;
  readonly txPending: boolean;
  readonly cooldownSeconds?: number;
  readonly energyCost?: number;
  readonly playerEnergy?: number;
  readonly onStart: () => void;
  readonly onSubmit: () => void;
  readonly onRetry: () => void;
  readonly explorerUrl?: (signature: string) => string;
  readonly shortSignature?: (signature: string) => string;
}

export function BattleArena({
  title,
  encounterKind,
  playerName = "Player",
  enemyName,
  playerStats,
  enemyStats,
  phase,
  replayIndex,
  txPending,
  cooldownSeconds = 0,
  energyCost,
  playerEnergy,
  onStart,
  onSubmit,
  onRetry,
  explorerUrl,
  shortSignature,
}: BattleArenaProps) {
  const result = "result" in phase ? phase.result : null;
  const activeReplayIndex =
    phase.phase === "replaying"
      ? phase.replayIndex
      : replayIndex ?? (result ? result.log.length - 1 : 0);
  const hpSnapshot = result
    ? getHpSnapshot(result, activeReplayIndex, playerStats, enemyStats)
    : null;
  const cooldownActive = cooldownSeconds > 0;
  const energyMissing =
    energyCost !== undefined &&
    playerEnergy !== undefined &&
    playerEnergy < energyCost;
  const startDisabled = txPending || cooldownActive || energyMissing;
  const startLabel = cooldownActive
    ? `Cooldown ${formatCooldown(cooldownSeconds)}`
    : energyMissing
      ? "Not enough energy"
      : encounterKind === "boss"
        ? "Start Boss Battle"
        : "Start Battle";

  return (
    <div className={styles.battleArena}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.arenaHeader}>
        <span className={styles.arenaCombatant}>{playerName}</span>
        <span className={styles.arenaVs}>VS</span>
        <span className={styles.arenaCombatant}>{enemyName}</span>
      </div>

      {hpSnapshot && (
        <div className={styles.hpGrid}>
          <HpBar
            current={hpSnapshot.playerCurrent}
            max={hpSnapshot.playerMax}
            label={playerName}
            variant="player"
          />
          <HpBar
            current={hpSnapshot.enemyCurrent}
            max={hpSnapshot.enemyMax}
            label={enemyName}
            variant={encounterKind === "boss" ? "boss" : "enemy"}
          />
        </div>
      )}

      {renderPhaseBody({
        encounterKind,
        phase,
        txPending,
        startDisabled,
        startLabel,
        activeReplayIndex,
        onStart,
        onSubmit,
        onRetry,
        explorerUrl,
        shortSignature,
      })}
    </div>
  );
}

function renderPhaseBody(params: {
  readonly encounterKind: BattleArenaProps["encounterKind"];
  readonly phase: BattleArenaPhase;
  readonly txPending: boolean;
  readonly startDisabled: boolean;
  readonly startLabel: string;
  readonly activeReplayIndex: number;
  readonly onStart: () => void;
  readonly onSubmit: () => void;
  readonly onRetry: () => void;
  readonly explorerUrl?: (signature: string) => string;
  readonly shortSignature?: (signature: string) => string;
}) {
  const {
    encounterKind,
    phase,
    txPending,
    startDisabled,
    startLabel,
    activeReplayIndex,
    onStart,
    onSubmit,
    onRetry,
    explorerUrl,
    shortSignature,
  } = params;

  if (phase.phase === "idle") {
    return (
      <ActionButton onClick={onStart} disabled={startDisabled}>
        {startLabel}
      </ActionButton>
    );
  }

  if (phase.phase === "preparing") {
    return (
      <div className={styles.battleSimulating}>
        <div className={styles.spinner} />
        <span>{encounterKind === "boss" ? "Preparing boss battle..." : "Preparing battle..."}</span>
      </div>
    );
  }

  if (phase.phase === "replaying") {
    return (
      <div className={styles.battleResult}>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>Replay</span>
          <span className={styles.metaValue}>
            {Math.min(activeReplayIndex + 1, phase.result.log.length)} / {phase.result.log.length}
          </span>
        </div>
        <CombatLog log={phase.result.log} replayIndex={activeReplayIndex} />
      </div>
    );
  }

  if (phase.phase === "result") {
    return (
      <BattleResultPanel
        encounterKind={encounterKind}
        result={phase.result}
        replayIndex={activeReplayIndex}
        damage={phase.damage}
        txPending={txPending}
        onStart={onStart}
        onSubmit={onSubmit}
        onRetry={onRetry}
      />
    );
  }

  if (phase.phase === "submitting") {
    return (
      <TxStatusCard
        status={{
          phase: "submitting",
          label: encounterKind === "boss" ? "Submitting boss damage..." : "Submitting clear...",
        }}
      />
    );
  }

  if (phase.phase === "success") {
    return (
      <TxStatusCard
        status={{
          phase: "success",
          label:
            encounterKind === "boss" && phase.damage !== undefined
              ? `Submitted ${phase.damage}`
              : "Cleared",
          signature: phase.signature,
        }}
        explorerUrl={explorerUrl}
        shortSignature={shortSignature}
      />
    );
  }

  return <TxStatusCard status={{ phase: "error", message: phase.message }} />;
}

function BattleResultPanel({
  encounterKind,
  result,
  replayIndex,
  damage,
  txPending,
  onStart,
  onSubmit,
  onRetry,
}: {
  readonly encounterKind: BattleArenaProps["encounterKind"];
  readonly result: BattleResultV1;
  readonly replayIndex: number;
  readonly damage?: number;
  readonly txPending: boolean;
  readonly onStart: () => void;
  readonly onSubmit: () => void;
  readonly onRetry: () => void;
}) {
  const submitEnabled =
    encounterKind === "boss" ? result.bossDamageScore > 0 : result.won;
  const damageValue = encounterKind === "boss" ? damage ?? result.bossDamageScore : result.playerDamageDealt;

  return (
    <div className={styles.battleResult}>
      <div className={styles.pillRow}>
        <StatPill label="Outcome" value={result.won ? "Victory" : "Defeated"} />
        <StatPill label="Turns" value={result.turnsTaken} />
        <StatPill label="Taken" value={result.damageTaken} />
        <StatPill label="Dealt" value={damageValue} />
      </div>
      <CombatLog log={result.log} replayIndex={replayIndex} />
      {submitEnabled ? (
        <div className={styles.buttonRow}>
          <ActionButton onClick={onSubmit} disabled={txPending}>
            {txPending
              ? encounterKind === "boss"
                ? "Submitting Boss Damage..."
                : "Submitting Clear Enemy..."
              : encounterKind === "boss"
                ? "Submit Boss Damage"
                : "Submit Clear Enemy"}
          </ActionButton>
          {encounterKind === "boss" && (
            <ActionButton onClick={onStart} disabled={txPending} variant="secondary">
              Retry
            </ActionButton>
          )}
        </div>
      ) : (
        <div className={styles.buttonRow}>
          <ActionButton onClick={onStart} disabled={txPending}>
            Retry
          </ActionButton>
          <ActionButton onClick={onRetry} disabled={txPending} variant="secondary">
            Close
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function getHpSnapshot(
  result: BattleResultV1,
  replayIndex: number,
  playerStats?: BattleCombatantStatsV1,
  enemyStats?: BattleCombatantStatsV1,
): {
  readonly playerCurrent: number;
  readonly playerMax: number;
  readonly enemyCurrent: number;
  readonly enemyMax: number;
} {
  const activeEntry = result.log[Math.max(0, Math.min(replayIndex, result.log.length - 1))];
  const playerCurrent = activeEntry?.playerHpAfter ?? result.playerHpRemaining;
  const enemyCurrent = activeEntry?.enemyHpAfter ?? result.enemyHpRemaining;

  return {
    playerCurrent,
    playerMax: playerStats?.maxHealth ?? maxObservedHp(result, "player"),
    enemyCurrent,
    enemyMax: enemyStats?.maxHealth ?? maxObservedHp(result, "enemy"),
  };
}

function maxObservedHp(result: BattleResultV1, actor: "player" | "enemy"): number {
  const values = result.log.map((entry) =>
    actor === "player" ? entry.playerHpAfter : entry.enemyHpAfter,
  );
  values.push(actor === "player" ? result.playerHpRemaining : result.enemyHpRemaining);
  return Math.max(1, ...values);
}

function formatCooldown(seconds: number): string {
  if (seconds <= 0) return "Ready";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}
