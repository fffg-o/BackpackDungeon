"use client";

import type { BattleCombatantStatsV1, BattleResultV1 } from "@backpack-dungeon/game-core";
import { HpBar } from "../HpBar";
import { FloatingDamageText } from "./FloatingDamageText";
import type { BattleOverlayPhase } from "./BattleOverlay";
import { useI18n } from "../../../i18n/useI18n";
import styles from "./battle.module.css";

export interface BattleStageProps {
  readonly encounterKind: "enemy" | "boss";
  readonly playerName: string;
  readonly enemyName: string;
  readonly phase: BattleOverlayPhase;
  readonly playerStats?: BattleCombatantStatsV1;
  readonly enemyStats?: BattleCombatantStatsV1;
}

export function BattleStage({
  encounterKind,
  playerName,
  enemyName,
  phase,
  playerStats,
  enemyStats,
}: BattleStageProps) {
  const { t } = useI18n();
  const result = phaseHasResult(phase) ? phase.result : null;
  const replayIndex =
    phase.phase === "replaying"
      ? phase.replayIndex
      : result
        ? result.log.length - 1
        : 0;
  const hpSnapshot = getHpSnapshot(result, replayIndex, playerStats, enemyStats);
  const activeEntry = result?.log[Math.max(0, Math.min(replayIndex, result.log.length - 1))] ?? null;
  const activeItemTrigger = (activeEntry?.itemTriggers?.length ?? 0) > 0;

  return (
    <section
      className={`${styles.stagePanel} ${activeItemTrigger ? styles.itemGlow : ""}`}
      aria-label={t("battle.stage")}
    >
      <div className={styles.stageTopline}>
        <h3 className={styles.stageTitle}>{t("battle.stageTitle")}</h3>
        <span className={styles.stagePhase}>{stagePhaseLabel(phase, t)}</span>
      </div>

      <div className={styles.fighters}>
        <CombatantCard
          name={playerName}
          avatar="P"
          hpCurrent={hpSnapshot.playerCurrent}
          hpMax={hpSnapshot.playerMax}
          stats={playerStats}
          variant="player"
          active={activeEntry?.actor === "player"}
          itemGlow={activeItemTrigger}
        />
        <div className={styles.versus}>VS</div>
        <CombatantCard
          name={enemyName}
          avatar={encounterKind === "boss" ? "B" : "E"}
          hpCurrent={hpSnapshot.enemyCurrent}
          hpMax={hpSnapshot.enemyMax}
          stats={enemyStats}
          variant={encounterKind === "boss" ? "boss" : "enemy"}
          active={activeEntry?.actor === "enemy"}
          itemGlow={false}
        />

        {activeEntry && activeEntry.damage > 0 && (
          <FloatingDamageText
            key={`${activeEntry.turn}-${activeEntry.action}-damage`}
            text={formatFloatingDamage(activeEntry, t)}
            side={activeEntry.actor === "player" ? "enemy" : "player"}
            critical={activeEntry.critical}
            dodged={activeEntry.dodged}
          />
        )}
        {activeEntry && activeEntry.dodged && activeEntry.damage <= 0 && (
          <FloatingDamageText
            key={`${activeEntry.turn}-${activeEntry.action}-dodge`}
            text={t("battle.actions.dodge")}
            side={activeEntry.actor === "player" ? "enemy" : "player"}
            dodged
            variant="dodge"
          />
        )}
        {activeEntry && (activeEntry.healDelta ?? 0) > 0 && (
          <FloatingDamageText
            key={`${activeEntry.turn}-${activeEntry.action}-heal`}
            text={`+${activeEntry.healDelta} HP`}
            side="player"
            variant="heal"
          />
        )}
        {activeEntry && (activeEntry.shieldDelta ?? 0) > 0 && (
          <FloatingDamageText
            key={`${activeEntry.turn}-${activeEntry.action}-shield`}
            text={t("battle.actions.shield", { amount: activeEntry.shieldDelta ?? 0 })}
            side="player"
            variant="shield"
          />
        )}
      </div>
    </section>
  );
}

function CombatantCard({
  name,
  avatar,
  hpCurrent,
  hpMax,
  stats,
  variant,
  active,
  itemGlow,
}: {
  readonly name: string;
  readonly avatar: string;
  readonly hpCurrent: number;
  readonly hpMax: number;
  readonly stats?: BattleCombatantStatsV1;
  readonly variant: "player" | "enemy" | "boss";
  readonly active: boolean;
  readonly itemGlow: boolean;
}) {
  return (
    <div
      className={[
        styles.fighter,
        active ? styles.fighterActive : "",
        itemGlow ? styles.fighterItemGlow : "",
      ].join(" ")}
    >
      <div
        className={`${styles.fighterAvatar} ${
          variant === "boss" ? styles.bossAvatar : variant === "enemy" ? styles.enemyAvatar : ""
        }`}
      >
        {avatar}
      </div>
      <h4 className={styles.combatantName}>{name}</h4>
      <HpBar current={hpCurrent} max={hpMax} label="HP" variant={variant} />
      {stats && (
        <div className={styles.statsRow}>
          <span className={styles.statChip}>ATK {stats.attack}</span>
          <span className={styles.statChip}>DEF {stats.defense}</span>
          <span className={styles.statChip}>SPD {stats.speed}</span>
        </div>
      )}
    </div>
  );
}

function getHpSnapshot(
  result: BattleResultV1 | null,
  replayIndex: number,
  playerStats?: BattleCombatantStatsV1,
  enemyStats?: BattleCombatantStatsV1
): {
  readonly playerCurrent: number;
  readonly playerMax: number;
  readonly enemyCurrent: number;
  readonly enemyMax: number;
} {
  const playerMax = playerStats?.maxHealth ?? maxObservedHp(result, "player");
  const enemyMax = enemyStats?.maxHealth ?? maxObservedHp(result, "enemy");
  if (!result) {
    return {
      enemyCurrent: enemyMax,
      enemyMax,
      playerCurrent: playerMax,
      playerMax
    };
  }

  const activeEntry = result.log[Math.max(0, Math.min(replayIndex, result.log.length - 1))];
  return {
    enemyCurrent: activeEntry?.enemyHpAfter ?? result.enemyHpRemaining,
    enemyMax,
    playerCurrent: activeEntry?.playerHpAfter ?? result.playerHpRemaining,
    playerMax
  };
}

function maxObservedHp(result: BattleResultV1 | null, actor: "player" | "enemy"): number {
  if (!result) return actor === "player" ? 100 : 1;
  const values = result.log.map((entry) =>
    actor === "player" ? entry.playerHpAfter : entry.enemyHpAfter
  );
  values.push(actor === "player" ? result.playerHpRemaining : result.enemyHpRemaining);
  return Math.max(1, ...values);
}

function phaseHasResult(
  phase: BattleOverlayPhase
): phase is Extract<BattleOverlayPhase, { readonly result: BattleResultV1 }> {
  return "result" in phase;
}

function stagePhaseLabel(
  phase: BattleOverlayPhase,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (phase.phase === "setup") return t("common.setup");
  if (phase.phase === "preparing") return t("common.preparing");
  if (phase.phase === "replaying") {
    return `${phase.replayIndex + 1} / ${Math.max(1, phase.result.log.length)}`;
  }
  if (phase.phase === "submitting") return t("battle.status.submittingToChain");
  if (phase.phase === "success") return t("common.recorded");
  if (phase.phase === "error") return t("common.attention");
  return phase.result.won ? t("common.victory") : t("common.defeated");
}

function formatFloatingDamage(
  entry: BattleResultV1["log"][number],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (entry.dodged) return t("battle.actions.dodge");
  if (entry.damage <= 0) return "0";
  return `${entry.critical ? `${t("battle.actions.crit")} ` : ""}${entry.damage}`;
}
