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
  const itemTriggers = entry.itemTriggers ?? [];

  return (
    <div
      className={[
        styles.logEntry,
        active ? styles.logEntryActive : "",
        entry.dodged ? styles.logEntryDodged : "",
        entry.critical ? styles.logEntryCritical : "",
      ].join(" ")}
    >
      <div className={styles.logMain}>
        <span className={styles.logTurn}>T{entry.turn}</span>
        <span className={actorClassName(entry)}>
          {entry.action.startsWith("item:") ? "Backpack" : entry.actor === "player" ? "Player" : "Enemy"}
        </span>
        <span className={styles.logAction}>{formatAction(entry)}</span>
        <span className={styles.logDamage}>{formatDelta(entry)}</span>
      </div>
      {itemTriggers.length > 0 && (
        <div className={styles.logBadges}>
          {itemTriggers.map((trigger, index) => (
            <span
              key={`${entry.turn}-${index}-${trigger}`}
              className={[
                styles.logItemTrigger,
                active && index === itemTriggers.length - 1 ? styles.logItemTriggerActive : "",
              ].join(" ")}
              title={trigger}
            >
              T{entry.turn} {trigger}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function phaseHasResult(
  phase: BattleOverlayPhase
): phase is Extract<BattleOverlayPhase, { readonly result: BattleResultV1 }> {
  return "result" in phase;
}

function actorClassName(entry: BattleLogEntryV1): string {
  if (entry.action.startsWith("item:")) return styles.logActorBackpack;
  return entry.actor === "player" ? styles.logActorPlayer : styles.logActorEnemy;
}

function formatAction(entry: BattleLogEntryV1): string {
  if (entry.action === "item:battleStart") {
    if ((entry.shieldDelta ?? 0) > 0 && entry.damage <= 0) return "Ward guards";
    return "Bomb explodes";
  }
  if (entry.action === "item:lowHealth") return "Potion triggers";
  if (entry.action !== "attack") return entry.action;
  if (entry.dodged) return entry.actor === "player" ? "Strike" : "Heavy";
  return entry.actor === "player" ? "Strike" : entry.critical ? "Heavy" : "Attack";
}

function formatDelta(entry: BattleLogEntryV1): string {
  if (entry.dodged) return "DODGE";

  const parts: string[] = [];
  if (entry.critical) parts.push("CRIT");
  if (entry.damage > 0) {
    parts.push(
      entry.action === "item:battleStart" ? `${entry.damage} bonus dmg` : `${entry.damage} dmg`
    );
  } else if (entry.action === "attack") {
    parts.push(entry.actor === "player" ? "Blocked" : "Miss");
  }
  if ((entry.healDelta ?? 0) > 0) parts.push(`+${entry.healDelta} HP`);
  if ((entry.shieldDelta ?? 0) > 0) parts.push(`+${entry.shieldDelta} shield`);

  return parts.join(" · ");
}
