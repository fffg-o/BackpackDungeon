"use client";

import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import type {
  BackpackItemInstanceV1,
  BackpackLayoutV1,
  BattleCombatantStatsV1,
  BattleResultV1,
} from "@backpack-dungeon/game-core";
import { BattleHeader } from "./BattleHeader";
import { BattleResultSummary } from "./BattleResultSummary";
import { BattleSetupPanel } from "./BattleSetupPanel";
import { BattleStage } from "./BattleStage";
import { BattleTimeline } from "./BattleTimeline";
import { useI18n } from "../../../i18n/useI18n";
import styles from "./battle.module.css";

export type BattleOverlayPhase =
  | { readonly phase: "setup" }
  | { readonly phase: "preparing" }
  | { readonly phase: "replaying"; readonly result: BattleResultV1; readonly replayIndex: number }
  | { readonly phase: "result"; readonly result: BattleResultV1 }
  | { readonly phase: "submitting" }
  | { readonly phase: "success"; readonly signature: string; readonly result?: BattleResultV1 }
  | { readonly phase: "error"; readonly message: string };

export interface BattleOverlayProps {
  readonly open: boolean;
  readonly encounterKind: "enemy" | "boss";
  readonly title: string;
  readonly enemyName: string;
  readonly enemyLevel?: number;
  readonly playerName?: string;
  readonly phase: BattleOverlayPhase;
  readonly playerStats?: BattleCombatantStatsV1;
  readonly enemyStats?: BattleCombatantStatsV1;
  readonly cooldownSeconds?: number;
  readonly energyCost?: number;
  readonly playerEnergy?: number;
  readonly startBlocked?: boolean;
  readonly backpackLayout: BackpackLayoutV1;
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly onClose: () => void;
  readonly onStart: () => void;
  readonly onSubmit: () => void;
  readonly onRetry: () => void;
  readonly onMoveItem: (instanceId: string, x: number, y: number, rotated?: boolean) => void;
  readonly onRotateItem: (instanceId: string) => void;
  readonly onAutoPack: () => void;
  readonly explorerUrl?: (signature: string) => string;
  readonly shortSignature?: (signature: string) => string;
  readonly bossShardIndex?: number;
  readonly bossPlayerTotalDamageAfterSubmit?: number;
  readonly bossNftEligible?: boolean;
}

export function BattleOverlay({
  open,
  encounterKind,
  title,
  enemyName,
  enemyLevel,
  playerName = "Player",
  phase,
  playerStats,
  enemyStats,
  cooldownSeconds = 0,
  energyCost,
  playerEnergy,
  startBlocked = false,
  backpackLayout,
  inventory,
  onClose,
  onStart,
  onSubmit,
  onRetry,
  onMoveItem,
  onRotateItem,
  onAutoPack,
  explorerUrl,
  shortSignature,
  bossShardIndex,
  bossPlayerTotalDamageAfterSubmit,
  bossNftEligible,
}: BattleOverlayProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const startButtonRef = useRef<HTMLButtonElement | null>(null);
  const canClose = phase.phase !== "submitting";
  const energyMissing =
    energyCost !== undefined &&
    playerEnergy !== undefined &&
    playerEnergy < energyCost;
  const startDisabled =
    phase.phase !== "setup" || startBlocked || cooldownSeconds > 0 || energyMissing;
  const startLabel = cooldownSeconds > 0
    ? `${t("common.cooldown")} ${formatCooldown(cooldownSeconds, t("common.ready"))}`
    : energyMissing
      ? t("dungeon.errors.notEnoughEnergy")
      : encounterKind === "boss"
        ? t("battle.startRaid")
        : t("battle.start");
  const submitLabel = encounterKind === "boss" ? t("battle.submitBossDamage") : t("battle.submitClear");
  const handleClose = useCallback(() => {
    if (canClose) {
      onClose();
    }
  }, [canClose, onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => {
      const target = canClose ? closeButtonRef.current : startButtonRef.current;
      (target ?? firstFocusable(dialogRef.current))?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [canClose, open, phase.phase]);

  const header = useMemo(
    () => (
      <BattleHeader
        encounterKind={encounterKind}
        title={title}
        enemyName={enemyName}
        enemyLevel={enemyLevel}
        phase={phase}
        cooldownSeconds={cooldownSeconds}
        energyCost={energyCost}
        playerEnergy={playerEnergy}
        canClose={canClose}
        closeButtonRef={closeButtonRef}
        onClose={handleClose}
      />
    ),
    [
      canClose,
      cooldownSeconds,
      encounterKind,
      enemyLevel,
      enemyName,
      energyCost,
      handleClose,
      phase,
      playerEnergy,
      startBlocked,
      title,
    ]
  );

  if (!open) {
    return null;
  }

  return (
    <div className={styles.backdrop} onMouseDown={(event) => handleBackdropMouseDown(event, handleClose)}>
      <div
        ref={dialogRef}
        className={`${styles.dialog} ${encounterKind === "boss" ? styles.bossDialog : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="battle-overlay-title"
        onKeyDown={(event) => handleDialogKeyDown(event, dialogRef.current, handleClose, canClose)}
      >
        {header}
        <div className={styles.content}>
          <BattleSetupPanel
            backpackLayout={backpackLayout}
            inventory={inventory}
            onMoveItem={onMoveItem}
            onRotateItem={onRotateItem}
            onAutoPack={onAutoPack}
          />
          <BattleStage
            encounterKind={encounterKind}
            playerName={playerName}
            enemyName={enemyName}
            phase={phase}
            playerStats={playerStats}
            enemyStats={enemyStats}
          />
          <aside className={styles.sidePanel} aria-label={t("battle.combatLog")}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>{t("battle.combatLog")}</h3>
            </div>
            <BattleTimeline phase={phase} />
            <BattleResultSummary
              encounterKind={encounterKind}
              phase={phase}
              startDisabled={startDisabled}
              startLabel={startLabel}
              submitLabel={submitLabel}
              txPending={phase.phase === "submitting"}
              startButtonRef={startButtonRef}
              onStart={onStart}
              onSubmit={onSubmit}
              onRetry={onRetry}
              explorerUrl={explorerUrl}
              shortSignature={shortSignature}
              bossShardIndex={bossShardIndex}
              bossPlayerTotalDamageAfterSubmit={bossPlayerTotalDamageAfterSubmit}
              bossNftEligible={bossNftEligible}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}

function handleBackdropMouseDown(
  event: MouseEvent<HTMLDivElement>,
  onClose: () => void
): void {
  if (event.target === event.currentTarget) {
    onClose();
  }
}

function handleDialogKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  dialog: HTMLDivElement | null,
  onClose: () => void,
  canClose: boolean
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    if (canClose) onClose();
    return;
  }

  if (event.key !== "Tab" || !dialog) {
    return;
  }

  const focusable = getFocusable(dialog);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function firstFocusable(dialog: HTMLDivElement | null): HTMLElement | null {
  return dialog ? getFocusable(dialog)[0] ?? null : null;
}

function getFocusable(dialog: HTMLDivElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex >= 0);
}

function formatCooldown(seconds: number, readyLabel = "Ready"): string {
  if (seconds <= 0) return readyLabel;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}
