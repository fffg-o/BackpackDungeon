import type { RefObject } from "react";
import type { BattleOverlayPhase } from "./BattleOverlay";
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
  return (
    <div className={styles.header}>
      <div className={styles.headerMain}>
        <p className={styles.eyebrow}>{encounterKind === "boss" ? "Raid Encounter" : "Battle Encounter"}</p>
        <h2 id="battle-overlay-title" className={styles.title}>{title}</h2>
      </div>
      <div className={styles.headerMeta}>
        <span className={styles.metaPill}>{enemyName}</span>
        {enemyLevel !== undefined && <span className={styles.metaPill}>Level {enemyLevel}</span>}
        <span className={styles.metaPill}>{phaseLabel(phase)}</span>
        {energyCost !== undefined && (
          <span className={styles.metaPill}>
            EN {playerEnergy ?? "-"} / {energyCost}
          </span>
        )}
        {cooldownSeconds > 0 && <span className={styles.metaPill}>{formatCooldown(cooldownSeconds)}</span>}
        <button
          ref={closeButtonRef}
          className={styles.closeButton}
          type="button"
          onClick={onClose}
          disabled={!canClose}
          aria-label="Close battle overlay"
        >
          X
        </button>
      </div>
    </div>
  );
}

function phaseLabel(phase: BattleOverlayPhase): string {
  if (phase.phase === "setup") return "Setup";
  if (phase.phase === "preparing") return "Preparing";
  if (phase.phase === "replaying") return "Auto Battle";
  if (phase.phase === "result") return "Result";
  if (phase.phase === "submitting") return "Submitting";
  if (phase.phase === "success") return "Submitted";
  return "Error";
}

function formatCooldown(seconds: number): string {
  if (seconds <= 0) return "Ready";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}
