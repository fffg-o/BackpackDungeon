"use client";

import type { BattleLogEntryV1, BattleResultV1 } from "@backpack-dungeon/game-core";
import type { BattleOverlayPhase } from "./BattleOverlay";
import { localizeBackpackItemTriggerNote } from "../../../i18n/backpackItems";
import { useI18n } from "../../../i18n/useI18n";
import styles from "./battle.module.css";

export interface BattleTimelineProps {
  readonly phase: BattleOverlayPhase;
}

export function BattleTimeline({ phase }: BattleTimelineProps) {
  const { t } = useI18n();
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
        <div className={styles.timelineEmpty}>{t("battle.combatWaiting")}</div>
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
  const { t } = useI18n();
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
          {entry.action.startsWith("item:") ? t("battle.actors.backpack") : entry.actor === "player" ? t("battle.actors.player") : t("battle.actors.enemy")}
        </span>
        <span className={styles.logAction}>{formatAction(entry, t)}</span>
        <span className={styles.logDamage}>{formatDelta(entry, t)}</span>
      </div>
      {itemTriggers.length > 0 && (
        <div className={styles.logBadges}>
          {itemTriggers.map((trigger, index) => {
            const localizedTrigger = localizeBackpackItemTriggerNote(trigger, t);
            return (
              <span
                key={`${entry.turn}-${index}-${trigger}`}
                className={[
                  styles.logItemTrigger,
                  active && index === itemTriggers.length - 1 ? styles.logItemTriggerActive : "",
                ].join(" ")}
                title={localizedTrigger}
              >
                T{entry.turn} {localizedTrigger}
              </span>
            );
          })}
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

function formatAction(
  entry: BattleLogEntryV1,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (entry.action === "item:battleStart") {
    if ((entry.shieldDelta ?? 0) > 0 && entry.damage <= 0) return t("battle.actions.wardGuards");
    return t("battle.actions.bombExplodes");
  }
  if (entry.action === "item:lowHealth") return t("battle.actions.potionTriggers");
  if (entry.action !== "attack") return entry.action;
  if (entry.dodged) return entry.actor === "player" ? t("battle.actions.strike") : t("battle.actions.heavy");
  return entry.actor === "player" ? t("battle.actions.strike") : entry.critical ? t("battle.actions.heavy") : t("battle.actions.attack");
}

function formatDelta(
  entry: BattleLogEntryV1,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (entry.dodged) return t("battle.actions.dodge");

  const parts: string[] = [];
  if (entry.critical) parts.push(t("battle.actions.crit"));
  if (entry.damage > 0) {
    parts.push(
      entry.action === "item:battleStart"
        ? t("battle.actions.bonusDamage", { damage: entry.damage })
        : t("battle.actions.damage", { damage: entry.damage })
    );
  } else if (entry.action === "attack") {
    parts.push(entry.actor === "player" ? t("battle.actions.blocked") : t("battle.actions.miss"));
  }
  if ((entry.healDelta ?? 0) > 0) parts.push(`+${entry.healDelta} HP`);
  if ((entry.shieldDelta ?? 0) > 0) parts.push(t("battle.actions.shield", { amount: entry.shieldDelta ?? 0 }));

  return parts.join(" · ");
}
