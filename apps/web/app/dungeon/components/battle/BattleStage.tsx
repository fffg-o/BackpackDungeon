import type { BattleCombatantStatsV1, BattleResultV1 } from "@backpack-dungeon/game-core";
import { HpBar } from "../HpBar";
import { FloatingDamageText } from "./FloatingDamageText";
import type { BattleOverlayPhase } from "./BattleOverlay";
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
      aria-label="Battle stage"
    >
      <div className={styles.stageTopline}>
        <h3 className={styles.stageTitle}>Hero vs Enemy</h3>
        <span className={styles.stagePhase}>{stagePhaseLabel(phase)}</span>
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
            text={formatFloatingDamage(activeEntry)}
            side={activeEntry.actor === "player" ? "enemy" : "player"}
            critical={activeEntry.critical}
            dodged={activeEntry.dodged}
          />
        )}
        {activeEntry && activeEntry.dodged && activeEntry.damage <= 0 && (
          <FloatingDamageText
            key={`${activeEntry.turn}-${activeEntry.action}-dodge`}
            text="DODGE"
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
            text={`+${activeEntry.shieldDelta} shield`}
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

function stagePhaseLabel(phase: BattleOverlayPhase): string {
  if (phase.phase === "setup") return "Setup";
  if (phase.phase === "preparing") return "Preparing";
  if (phase.phase === "replaying") {
    return `${phase.replayIndex + 1} / ${Math.max(1, phase.result.log.length)}`;
  }
  if (phase.phase === "submitting") return "Submitting to chain";
  if (phase.phase === "success") return "Recorded";
  if (phase.phase === "error") return "Needs attention";
  return phase.result.won ? "Victory" : "Defeated";
}

function formatFloatingDamage(entry: BattleResultV1["log"][number]): string {
  if (entry.dodged) return "DODGE";
  if (entry.damage <= 0) return "0";
  return `${entry.critical ? "CRIT " : ""}${entry.damage}`;
}
