import type { BattleLogEntryV1, BattleResultV1 } from "@backpack-dungeon/game-core";
import type { BattleOverlayPhase } from "./BattleOverlay";
import styles from "./battle.module.css";

export interface BattleTimelineProps {
  readonly phase: BattleOverlayPhase;
}

export function BattleTimeline({ phase }: BattleTimelineProps) {
  const result = phaseHasResult(phase) ? phase.result : null;
  const replayIndex =
    phase.phase === "replaying"
      ? phase.replayIndex
      : result
        ? result.log.length - 1
        : -1;
  const visibleEntries = result ? result.log.slice(0, Math.max(0, replayIndex) + 1) : [];
  const activeIndex = visibleEntries.length - 1;

  return (
    <div className={styles.timeline}>
      {visibleEntries.length === 0 ? (
        <div className={styles.timelineEmpty}>Combat log waiting.</div>
      ) : (
        visibleEntries.map((entry, index) => (
          <TimelineEntry
            key={`${entry.turn}-${entry.actor}-${index}`}
            entry={entry}
            active={index === activeIndex}
          />
        ))
      )}
    </div>
  );
}

function TimelineEntry({
  entry,
  active,
}: {
  readonly entry: BattleLogEntryV1;
  readonly active: boolean;
}) {
  return (
    <div className={`${styles.logEntry} ${active ? styles.logEntryActive : ""}`}>
      <span className={styles.logTurn}>T{entry.turn}</span>
      <span className={entry.actor === "player" ? styles.logActorPlayer : styles.logActorEnemy}>
        {entry.actor === "player" ? "Player" : "Enemy"}
      </span>
      <span className={styles.logDamage}>{formatDamage(entry)}</span>
    </div>
  );
}

function phaseHasResult(
  phase: BattleOverlayPhase
): phase is Extract<BattleOverlayPhase, { readonly result: BattleResultV1 }> {
  return "result" in phase;
}

function formatDamage(entry: BattleLogEntryV1): string {
  if (entry.dodged) return "DODGE";
  if (entry.damage === 0) return entry.actor === "player" ? "Blocked" : "Miss";
  return `${entry.critical ? "CRIT " : ""}${entry.damage} dmg`;
}
