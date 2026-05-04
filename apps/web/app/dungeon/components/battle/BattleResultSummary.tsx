"use client";

import type { RefObject } from "react";
import type { BattleResultV1 } from "@backpack-dungeon/game-core";
import type { BattleOverlayPhase } from "./BattleOverlay";
import { localizeBackpackItemTriggerNote } from "../../../i18n/backpackItems";
import { useI18n } from "../../../i18n/useI18n";
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
  const { t } = useI18n();
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
        t,
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
  const { t } = useI18n();
  return (
    <div className={styles.receipt}>
      <div className={styles.resultGrid}>
        <ResultStat
          label={t("battle.outcome")}
          value={encounterKind === "boss" ? t("battle.raidDamage") : result.won ? t("common.victory") : t("common.defeated")}
        />
        <ResultStat label={t("battle.damageDealt")} value={result.playerDamageDealt} />
        <ResultStat label={t("battle.damageTaken")} value={result.damageTaken} />
        <ResultStat label={t("battle.turns")} value={result.turnsTaken} />
        <ResultStat label={t("battle.score")} value={result.score} />
        <ResultStat label={t("battle.bossDamageScore")} value={result.bossDamageScore} />
        {encounterKind === "boss" && (
          <>
            <ResultStat label={t("battle.damageScore")} value={result.bossDamageScore} />
            <ResultStat label={t("battle.shardIndex")} value={bossShardIndex ?? t("common.unknown")} />
            <ResultStat
              label={t("battle.playerTotalAfterSubmit")}
              value={bossPlayerTotalDamageAfterSubmit ?? t("battle.pendingSubmit")}
            />
            <ResultStat
              label={t("battle.bossNftEligibility")}
              value={bossNftEligible ? t("common.eligible") : t("battle.needsDamage")}
            />
          </>
        )}
      </div>
      <div className={styles.hashGrid}>
        <HashStat label={t("battle.backpackHash")} value={result.backpackHash} />
        <HashStat label={t("battle.inputHash")} value={result.inputHash} />
        <HashStat label={t("battle.resultHash")} value={result.resultHash} />
        <HashStat label={t("battle.proofHash")} value={result.proofHash} />
      </div>
      <p className={styles.receiptNotice}>
        {t("battle.mvpNotice")}
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
  const { t } = useI18n();
  return (
    <div className={styles.hashStat}>
      <span className={styles.resultLabel}>{label}</span>
      <span className={styles.hashValue} title={value ? prefixedHash(value) : t("common.notCaptured")}>
        {shortHash(value, t("common.notCaptured"))}
      </span>
      {value && (
        <button
          type="button"
          className={styles.copyButton}
          onClick={() => {
            void copyHash(value);
          }}
          aria-label={t("battle.copiedHash", { label })}
        >
          {t("common.copy")}
        </button>
      )}
    </div>
  );
}

function BackpackEffectsSummary({ result }: { readonly result: BattleResultV1 }) {
  const { t } = useI18n();
  const triggers = aggregateItemTriggers(result, t);

  return (
    <section className={styles.effectsSummary} aria-label={t("battle.effects")}>
      <h4 className={styles.summaryTitle}>{t("battle.effects")}</h4>
      {triggers.length === 0 ? (
        <p className={styles.emptySummaryText}>{t("battle.noTriggers")}</p>
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
  const { t } = useI18n();
  return (
    <details className={styles.receiptDetails}>
      <summary>{t("battle.whyMatters")}</summary>
      <p>{t("battle.whyMattersBody")}</p>
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
  readonly t: ReturnType<typeof useI18n>["t"];
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
    t,
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
          <span>{phase.phase === "preparing" ? t("battle.preparingAuto") : t("battle.autoRunning")}</span>
        </div>
      </div>
    );
  }

  if (phase.phase === "result" && result) {
    if (encounterKind === "enemy" && !result.won) {
      return (
        <div className={styles.buttonStack}>
          <button type="button" className={styles.secondaryButton} onClick={onRetry} disabled={txPending}>
            {t("battle.rearrangeBackpack")}
          </button>
          <button type="button" className={styles.primaryButton} onClick={onStart} disabled={txPending}>
            {t("common.retry")}
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
          {t("battle.backToSetup")}
        </button>
      </div>
    );
  }

  if (phase.phase === "submitting") {
    return (
      <div className={styles.statusBox}>
        <div className={styles.submittingRow}>
          <span className={styles.spinner} />
          <span>{encounterKind === "boss" ? t("battle.submittingBossDamage") : t("battle.submittingClear")}</span>
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
          <span>{t("battle.submittedReceipt")}</span>
          <span className={styles.resultLabel}>{t("battle.txSignature")}</span>
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
              {t("battle.explorerLink")}
            </a>
          )}
          <HashStat label={t("battle.submittedResultHash")} value={resultHash} />
          <HashStat label={t("battle.submittedProofHash")} value={proofHash} />
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
            {t("battle.retrySubmit")}
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onRetry}>
            {t("battle.backToSetup")}
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
  result: BattleResultV1,
  t: ReturnType<typeof useI18n>["t"],
): readonly { readonly text: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of result.log) {
    for (const trigger of entry.itemTriggers ?? []) {
      const text = localizeBackpackItemTriggerNote(trigger, t);
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([text, count]) => ({ count, text }));
}

function shortHash(value: string | undefined, emptyLabel: string): string {
  if (!value) return emptyLabel;
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
