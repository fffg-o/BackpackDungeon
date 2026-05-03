import type { RefObject } from "react";
import type { BattleResultV1 } from "@backpack-dungeon/game-core";
import type { BattleOverlayPhase } from "./BattleOverlay";
import styles from "./battle.module.css";

export interface BattleResultSummaryProps {
  readonly encounterKind: "enemy" | "boss";
  readonly phase: BattleOverlayPhase;
  readonly startDisabled: boolean;
  readonly startLabel: string;
  readonly submitLabel: string;
  readonly txPending: boolean;
  readonly startButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onStart: () => void;
  readonly onSubmit: () => void;
  readonly onRetry: () => void;
  readonly explorerUrl?: (signature: string) => string;
  readonly shortSignature?: (signature: string) => string;
}

export function BattleResultSummary({
  encounterKind,
  phase,
  startDisabled,
  startLabel,
  submitLabel,
  txPending,
  startButtonRef,
  onStart,
  onSubmit,
  onRetry,
  explorerUrl,
  shortSignature,
}: BattleResultSummaryProps) {
  const result = phaseHasResult(phase) ? phase.result : null;

  return (
    <div className={styles.summary}>
      {result && <ResultStats encounterKind={encounterKind} result={result} />}
      {renderActions({
        encounterKind,
        explorerUrl,
        onRetry,
        onStart,
        onSubmit,
        phase,
        result,
        shortSignature,
        startButtonRef,
        startDisabled,
        startLabel,
        submitLabel,
        txPending,
      })}
    </div>
  );
}

function ResultStats({
  encounterKind,
  result,
}: {
  readonly encounterKind: "enemy" | "boss";
  readonly result: BattleResultV1;
}) {
  const damageValue =
    encounterKind === "boss" ? result.bossDamageScore : result.playerDamageDealt;

  return (
    <div className={styles.resultGrid}>
      <ResultStat label="Outcome" value={result.won ? "Victory" : "Defeated"} />
      <ResultStat label="Turns" value={result.turnsTaken} />
      <ResultStat label="Dealt" value={damageValue} />
      <ResultStat label="Taken" value={result.damageTaken} />
    </div>
  );
}

function ResultStat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}) {
  return (
    <div className={styles.resultStat}>
      <span className={styles.resultLabel}>{label}</span>
      <span className={styles.resultValue}>{value}</span>
    </div>
  );
}

function renderActions(params: {
  readonly encounterKind: "enemy" | "boss";
  readonly phase: BattleOverlayPhase;
  readonly result: BattleResultV1 | null;
  readonly startDisabled: boolean;
  readonly startLabel: string;
  readonly submitLabel: string;
  readonly txPending: boolean;
  readonly startButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onStart: () => void;
  readonly onSubmit: () => void;
  readonly onRetry: () => void;
  readonly explorerUrl?: (signature: string) => string;
  readonly shortSignature?: (signature: string) => string;
}) {
  const {
    encounterKind,
    explorerUrl,
    onRetry,
    onStart,
    onSubmit,
    phase,
    result,
    shortSignature,
    startButtonRef,
    startDisabled,
    startLabel,
    submitLabel,
    txPending,
  } = params;

  if (phase.phase === "setup") {
    return (
      <div className={styles.buttonStack}>
        <button
          ref={startButtonRef}
          type="button"
          className={styles.primaryButton}
          onClick={onStart}
          disabled={startDisabled}
        >
          {startLabel}
        </button>
      </div>
    );
  }

  if (phase.phase === "preparing" || phase.phase === "replaying") {
    return (
      <div className={styles.statusBox}>
        <div className={styles.submittingRow}>
          <span className={styles.spinner} />
          <span>{phase.phase === "preparing" ? "Preparing auto battle." : "Auto battle running."}</span>
        </div>
      </div>
    );
  }

  if (phase.phase === "result" && result) {
    const submitEnabled =
      encounterKind === "boss" ? result.bossDamageScore > 0 : result.won;
    return (
      <div className={styles.buttonStack}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={onSubmit}
          disabled={txPending || !submitEnabled}
        >
          {submitLabel}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onRetry} disabled={txPending}>
          Back to Setup
        </button>
      </div>
    );
  }

  if (phase.phase === "submitting") {
    return (
      <div className={styles.statusBox}>
        <div className={styles.submittingRow}>
          <span className={styles.spinner} />
          <span>{encounterKind === "boss" ? "Submitting boss damage." : "Submitting clear."}</span>
        </div>
      </div>
    );
  }

  if (phase.phase === "success") {
    const signatureText = shortSignature ? shortSignature(phase.signature) : phase.signature;
    const signature = explorerUrl ? (
      <a className={styles.signature} href={explorerUrl(phase.signature)} target="_blank" rel="noreferrer">
        {signatureText}
      </a>
    ) : (
      <span className={styles.signature}>{signatureText}</span>
    );

    return (
      <div className={styles.statusBox}>
        Submitted on-chain.
        {signature}
      </div>
    );
  }

  if (phase.phase === "error") {
    return (
      <div className={`${styles.statusBox} ${styles.errorBox}`}>
        {phase.message}
        <div className={styles.buttonStack} style={{ marginTop: 10 }}>
          <button type="button" className={styles.secondaryButton} onClick={onRetry}>
            Back to Setup
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function phaseHasResult(
  phase: BattleOverlayPhase
): phase is Extract<BattleOverlayPhase, { readonly result: BattleResultV1 }> {
  return "result" in phase;
}
