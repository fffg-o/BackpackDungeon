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
  readonly bossShardIndex?: number;
  readonly bossPlayerTotalDamageAfterSubmit?: number;
  readonly bossNftEligible?: boolean;
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
  bossShardIndex,
  bossPlayerTotalDamageAfterSubmit,
  bossNftEligible,
}: BattleResultSummaryProps) {
  const result = phaseHasResult(phase) ? phase.result : null;

  return (
    <div className={styles.summary}>
      {result && (
        <ResultStats
          encounterKind={encounterKind}
          result={result}
          bossShardIndex={bossShardIndex}
          bossPlayerTotalDamageAfterSubmit={bossPlayerTotalDamageAfterSubmit}
          bossNftEligible={bossNftEligible}
        />
      )}
      {result && <BackpackEffectsSummary result={result} />}
      {result && <ReceiptDetails />}
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
  bossShardIndex,
  bossPlayerTotalDamageAfterSubmit,
  bossNftEligible,
}: {
  readonly encounterKind: "enemy" | "boss";
  readonly result: BattleResultV1;
  readonly bossShardIndex?: number;
  readonly bossPlayerTotalDamageAfterSubmit?: number;
  readonly bossNftEligible?: boolean;
}) {
  return (
    <div className={styles.receipt}>
      <div className={styles.resultGrid}>
        <ResultStat
          label="Outcome"
          value={encounterKind === "boss" ? "Raid Damage" : result.won ? "Victory" : "Defeated"}
        />
        <ResultStat label="Damage Dealt" value={result.playerDamageDealt} />
        <ResultStat label="Damage Taken" value={result.damageTaken} />
        <ResultStat label="Turns" value={result.turnsTaken} />
        <ResultStat label="Score" value={result.score} />
        <ResultStat label="Boss Damage Score" value={result.bossDamageScore} />
        {encounterKind === "boss" && (
          <>
            <ResultStat label="Damage Score" value={result.bossDamageScore} />
            <ResultStat label="Shard Index" value={bossShardIndex ?? "Unknown"} />
            <ResultStat
              label="Player Total Damage after submit"
              value={bossPlayerTotalDamageAfterSubmit ?? "Pending submit"}
            />
            <ResultStat
              label="Claim Boss NFT eligibility"
              value={bossNftEligible ? "Eligible" : "Needs damage"}
            />
          </>
        )}
      </div>
      <div className={styles.hashGrid}>
        <HashStat label="Backpack Hash" value={result.backpackHash} />
        <HashStat label="Input Hash" value={result.inputHash} />
        <HashStat label="Result Hash" value={result.resultHash} />
        <HashStat label="Proof Hash" value={result.proofHash} />
      </div>
      <p className={styles.receiptNotice}>
        This MVP records hashes on-chain. Battle simulation is still client-reported.
      </p>
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

function HashStat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | undefined;
}) {
  return (
    <div className={styles.hashStat}>
      <span className={styles.resultLabel}>{label}</span>
      <span className={styles.hashValue} title={value ? prefixedHash(value) : "Not captured"}>
        {shortHash(value)}
      </span>
      {value && (
        <button
          type="button"
          className={styles.copyButton}
          onClick={() => {
            void copyHash(value);
          }}
          aria-label={`Copy ${label}`}
        >
          Copy
        </button>
      )}
    </div>
  );
}

function BackpackEffectsSummary({ result }: { readonly result: BattleResultV1 }) {
  const triggers = aggregateItemTriggers(result);

  return (
    <section className={styles.effectsSummary} aria-label="Backpack effects">
      <h4 className={styles.summaryTitle}>Backpack Effects</h4>
      {triggers.length === 0 ? (
        <p className={styles.emptySummaryText}>No backpack triggers logged.</p>
      ) : (
        <div className={styles.effectReceiptList}>
          {triggers.map((trigger) => (
            <div key={trigger.text} className={styles.effectReceiptItem}>
              <span className={styles.effectReceiptCount}>{trigger.count}x</span>
              <span>{trigger.text}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReceiptDetails() {
  return (
    <details className={styles.receiptDetails}>
      <summary>Why this matters?</summary>
      <p>
        backpackHash represents the current backpack layout. resultHash represents the battle
        summary. proofHash represents the full replay log. These hashes are anchors for future
        verification.
      </p>
    </details>
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
    if (encounterKind === "enemy" && !result.won) {
      return (
        <div className={styles.buttonStack}>
          <button type="button" className={styles.secondaryButton} onClick={onRetry} disabled={txPending}>
            Rearrange Backpack
          </button>
          <button type="button" className={styles.primaryButton} onClick={onStart} disabled={txPending}>
            Retry
          </button>
        </div>
      );
    }

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
    const resultHash = phase.result?.resultHash;
    const proofHash = phase.result?.proofHash;
    return (
      <div className={styles.statusBox}>
        <div className={styles.successReceipt}>
          <span>Submitted battle receipt.</span>
          <span className={styles.resultLabel}>tx signature</span>
          {explorerUrl ? (
            <a
              className={styles.signature}
              href={explorerUrl(phase.signature)}
              target="_blank"
              rel="noreferrer"
            >
              {signatureText}
            </a>
          ) : (
            <span className={styles.signature}>{signatureText}</span>
          )}
          {explorerUrl && (
            <a
              className={styles.explorerLink}
              href={explorerUrl(phase.signature)}
              target="_blank"
              rel="noreferrer"
            >
              Explorer link
            </a>
          )}
          <HashStat label="Submitted battle result hash" value={resultHash} />
          <HashStat label="Submitted proof hash" value={proofHash} />
        </div>
      </div>
    );
  }

  if (phase.phase === "error") {
    return (
      <div className={`${styles.statusBox} ${styles.errorBox}`}>
        <span>{phase.message}</span>
        <div className={styles.buttonStack} style={{ marginTop: 10 }}>
          <button type="button" className={styles.primaryButton} onClick={onSubmit} disabled={txPending}>
            Retry Submit
          </button>
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
  return "result" in phase && phase.result !== undefined;
}

function aggregateItemTriggers(
  result: BattleResultV1
): readonly { readonly text: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of result.log) {
    for (const trigger of entry.itemTriggers ?? []) {
      counts.set(trigger, (counts.get(trigger) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([text, count]) => ({ count, text }));
}

function shortHash(value: string | undefined): string {
  if (!value) return "Not captured";
  const normalized = prefixedHash(value);
  if (normalized.length <= 14) return normalized;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function prefixedHash(value: string): string {
  return value.startsWith("0x") ? value : `0x${value}`;
}

async function copyHash(value: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  await navigator.clipboard.writeText(prefixedHash(value));
}
