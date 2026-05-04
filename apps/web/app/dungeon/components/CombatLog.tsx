"use client";

import type { BattleLogEntryV1 } from "@backpack-dungeon/game-core";
import { useI18n } from "../../i18n/useI18n";
import styles from "../dungeon.module.css";

export interface CombatLogProps {
  readonly log: readonly BattleLogEntryV1[];
  readonly replayIndex: number;
}

export function CombatLog({ log, replayIndex }: CombatLogProps) {
  const { t } = useI18n();
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
            {entry.actor === "player" ? t("battle.actors.player") : t("battle.actors.enemy")}
          </span>
          <span className={styles.logDamage}>{formatDamage(entry, t)}</span>
          <span className={styles.logHp}>
            HP {entry.playerHpAfter}/{entry.enemyHpAfter}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatDamage(
  entry: BattleLogEntryV1,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (entry.dodged) {
    return t("battle.actions.dodge");
  }

  if (entry.damage === 0) {
    return entry.actor === "player" ? t("battle.actions.blocked") : t("battle.actions.miss");
  }

  return `${entry.critical ? `${t("battle.actions.crit")} ` : ""}${entry.damage}`;
}
