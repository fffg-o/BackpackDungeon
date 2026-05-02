import type { BattleLogEntryV1 } from "@backpack-dungeon/game-core";
import styles from "../dungeon.module.css";

export interface CombatLogProps {
  readonly log: readonly BattleLogEntryV1[];
  readonly replayIndex: number;
}

export function CombatLog({ log, replayIndex }: CombatLogProps) {
  const visibleEntries = log.slice(0, Math.max(0, replayIndex) + 1);

  if (visibleEntries.length === 0) {
    return null;
  }

  const latestIndex = visibleEntries.length - 1;

  return (
    <div className={styles.battleLog}>
      {visibleEntries.map((entry, index) => (
        <div
          key={`${entry.turn}-${entry.actor}-${index}`}
          className={`${styles.logEntry} ${index === latestIndex ? styles.logEntryActive : ""}`}
        >
          <span className={styles.logTurn}>T{entry.turn}</span>
          <span className={entry.actor === "player" ? styles.logPlayer : styles.logEnemy}>
            {entry.actor === "player" ? "Player" : "Enemy"}
          </span>
          <span className={styles.logDamage}>{formatDamage(entry)}</span>
          <span className={styles.logHp}>
            HP {entry.playerHpAfter}/{entry.enemyHpAfter}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatDamage(entry: BattleLogEntryV1): string {
  if (entry.dodged) {
    return "DODGE";
  }

  if (entry.damage === 0) {
    return entry.actor === "player" ? "Blocked" : "Miss";
  }

  return `${entry.critical ? "CRIT " : ""}${entry.damage}`;
}
