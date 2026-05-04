"use client";

import type { RefObject } from "react";
import type { BattleOverlayPhase } from "./BattleOverlay";
import { useI18n } from "../../../i18n/useI18n";
import styles from "./battle.module.css";

export interface BattleHeaderProps {
  readonly encounterKind: "enemy" | "boss";
  readonly title: string;
  readonly enemyName: string;
  readonly enemyLevel?: number;
  readonly phase: BattleOverlayPhase;
  readonly cooldownSeconds?: number;
  readonly energyCost?: number;
  readonly playerEnergy?: number;
  readonly canClose: boolean;
  readonly closeButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onClose: () => void;
}

export function BattleHeader({
  encounterKind,
  title,
  enemyName,
  enemyLevel,
  phase,
  cooldownSeconds = 0,
  energyCost,
  playerEnergy,
  canClose,
  closeButtonRef,
  onClose,
}: BattleHeaderProps) {
  const { t } = useI18n();
  return (
    <div className={styles.header}>
      <div className={styles.headerMain}>
        <p className={styles.eyebrow}>{encounterKind === "boss" ? t("battle.raidEncounter") : t("battle.encounter")}</p>
        <h2 id="battle-overlay-title" className={styles.title}>{title}</h2>
      </div>
      <div className={styles.headerMeta}>
        <span className={styles.metaPill}>{enemyName}</span>
        {enemyLevel !== undefined && <span className={styles.metaPill}>{t("common.level")} {enemyLevel}</span>}
        <span className={styles.metaPill}>{phaseLabel(phase, t)}</span>
        {energyCost !== undefined && (
          <span className={styles.metaPill}>
            EN {playerEnergy ?? "-"} / {energyCost}
          </span>
        )}
        {cooldownSeconds > 0 && <span className={styles.metaPill}>{formatCooldown(cooldownSeconds, t("common.ready"))}</span>}
        <button
          ref={closeButtonRef}
          className={styles.closeButton}
          type="button"
          onClick={onClose}
          disabled={!canClose}
          aria-label={t("common.close")}
        >
          X
        </button>
      </div>
    </div>
  );
}

function phaseLabel(
  phase: BattleOverlayPhase,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (phase.phase === "setup") return t("common.setup");
  if (phase.phase === "preparing") return t("common.preparing");
  if (phase.phase === "replaying") return t("battle.status.autoBattle");
  if (phase.phase === "result") return t("common.result");
  if (phase.phase === "submitting") return t("common.submitting");
  if (phase.phase === "success") return t("common.submitted");
  return t("common.error");
}

function formatCooldown(seconds: number, readyLabel = "Ready"): string {
  if (seconds <= 0) return readyLabel;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}
