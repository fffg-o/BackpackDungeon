"use client";

import type {
  BattleCombatantStatsV1,
  BattleResultV1,
} from "@backpack-dungeon/game-core";
import { ActionButton } from "./ActionButton";
import { CombatLog } from "./CombatLog";
import { HpBar } from "./HpBar";
import { StatPill } from "./StatPill";
import { TxStatusCard } from "./TxStatusCard";
import { useI18n } from "../../i18n/useI18n";
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
  readonly idleActionLabel?: string;
  readonly onStart: () => void;
  readonly onSubmit: () => void;
  readonly onRetry: () => void;
  readonly explorerUrl?: (signature: string) => string;
  readonly shortSignature?: (signature: string) => string;
}

export function BattleArena({
  title,
  encounterKind,
  playerName,
  enemyName,
  playerStats,
  enemyStats,
  phase,
  replayIndex,
  txPending,
  cooldownSeconds = 0,
  energyCost,
  playerEnergy,
  idleActionLabel,
  onStart,
  onSubmit,
  onRetry,
  explorerUrl,
  shortSignature,
}: BattleArenaProps) {
  const { t } = useI18n();
  const displayPlayerName = playerName ?? t("common.player");
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
    ? `${t("common.cooldown")} ${formatCooldown(cooldownSeconds, t("common.ready"))}`
    : energyMissing
      ? t("dungeon.errors.notEnoughEnergy")
      : idleActionLabel ?? (encounterKind === "boss" ? t("battle.startBoss") : t("battle.startBattle"));

  return (
    <div className={styles.battleArena}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.arenaHeader}>
        <span className={styles.arenaCombatant}>{displayPlayerName}</span>
        <span className={styles.arenaVs}>VS</span>
        <span className={styles.arenaCombatant}>{enemyName}</span>
      </div>

      {hpSnapshot && (
        <div className={styles.hpGrid}>
          <HpBar
            current={hpSnapshot.playerCurrent}
            max={hpSnapshot.playerMax}
            label={displayPlayerName}
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
        t,
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
  readonly t: ReturnType<typeof useI18n>["t"];
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
    t,
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
        <span>{encounterKind === "boss" ? t("battle.preparingBoss") : t("battle.preparingBattle")}</span>
      </div>
    );
  }

  if (phase.phase === "replaying") {
    return (
      <div className={styles.battleResult}>
        <div className={styles.detailMeta}>
          <span className={styles.metaLabel}>{t("battle.status.autoBattle")}</span>
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
          label: encounterKind === "boss" ? t("battle.submittingBossDamage") : t("battle.submittingClear"),
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
              ? t("boss.damageSubmitted", { damage: phase.damage })
              : t("battle.clearEnemy"),
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
  const { t } = useI18n();
  const submitEnabled =
    encounterKind === "boss" ? result.bossDamageScore > 0 : result.won;
  const damageValue = encounterKind === "boss" ? damage ?? result.bossDamageScore : result.playerDamageDealt;

  return (
    <div className={styles.battleResult}>
      <div className={styles.pillRow}>
        <StatPill label={t("battle.outcome")} value={result.won ? t("common.victory") : t("common.defeated")} />
        <StatPill label={t("battle.turns")} value={result.turnsTaken} />
        <StatPill label={t("battle.damageTaken")} value={result.damageTaken} />
        <StatPill label={t("battle.damageDealt")} value={damageValue} />
      </div>
      <CombatLog log={result.log} replayIndex={replayIndex} />
      {submitEnabled ? (
        <div className={styles.buttonRow}>
          <ActionButton onClick={onSubmit} disabled={txPending}>
            {txPending
              ? encounterKind === "boss"
                ? t("battle.submittingBossDamage")
                : t("battle.submittingClear")
              : encounterKind === "boss"
                ? t("battle.submitBossDamage")
                : t("battle.submitClear")}
          </ActionButton>
          {encounterKind === "boss" && (
            <ActionButton onClick={onStart} disabled={txPending} variant="secondary">
              {t("common.retry")}
            </ActionButton>
          )}
        </div>
      ) : (
        <div className={styles.buttonRow}>
          <ActionButton onClick={onStart} disabled={txPending}>
            {t("common.retry")}
          </ActionButton>
          <ActionButton onClick={onRetry} disabled={txPending} variant="secondary">
            {t("common.close")}
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

function formatCooldown(seconds: number, readyLabel = "Ready"): string {
  if (seconds <= 0) return readyLabel;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}
