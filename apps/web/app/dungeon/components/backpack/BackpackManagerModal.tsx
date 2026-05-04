"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import type {
  BackpackItemInstanceV1,
  BackpackLayoutV1,
  BackpackSnapshotV1,
} from "@backpack-dungeon/game-core";
import { BackpackGrid } from "./BackpackGrid";
import { BackpackToolbar } from "./BackpackToolbar";
import { InventoryList } from "./InventoryList";
import { useBackpackBuilder } from "./useBackpackBuilder";
import { useI18n } from "../../../i18n/useI18n";
import styles from "./backpack.module.css";

export interface BackpackManagerModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly layout: BackpackLayoutV1;
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly backpackSnapshot: BackpackSnapshotV1;
  readonly onMoveItem: (instanceId: string, x: number, y: number, rotated?: boolean) => void;
  readonly onRotateItem: (instanceId: string) => void;
  readonly onAutoPack: () => void;
  readonly onResetBackpack: () => void;
}

export function BackpackManagerModal({
  open,
  onClose,
  layout,
  inventory,
  backpackSnapshot,
  onMoveItem,
  onRotateItem,
  onAutoPack,
  onResetBackpack,
}: BackpackManagerModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const builder = useBackpackBuilder({
    inventory,
    keyboardEnabled: open,
    layout,
    onMoveItem,
    onRotateItem,
  });

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
      (closeButtonRef.current ?? firstFocusable(dialogRef.current))?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className={styles.managerBackdrop} onMouseDown={(event) => handleBackdropMouseDown(event, handleClose)}>
      <div
        ref={dialogRef}
        className={styles.managerDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="backpack-manager-title"
        onKeyDown={(event) => handleDialogKeyDown(event, dialogRef.current)}
      >
        <header className={styles.managerHeader}>
          <div className={styles.managerTitleBlock}>
            <p className={styles.managerEyebrow}>{t("backpack.inventory")}</p>
            <h2 id="backpack-manager-title" className={styles.managerTitle}>
              {t("backpack.managerTitle")}
            </h2>
          </div>
          <div className={styles.managerMeta}>
            <span className={styles.managerMetaPill}>{t("backpack.items", { count: inventory.length })}</span>
            <span className={styles.managerMetaPill}>{t("backpack.hash", { hash: shortHash(backpackSnapshot.backpackHash) })}</span>
            <button
              ref={closeButtonRef}
              type="button"
              className={styles.managerCloseButton}
              onClick={handleClose}
              aria-label={t("backpack.closeManager")}
            >
              X
            </button>
          </div>
        </header>
        <div className={styles.managerToolbar}>
          <BackpackToolbar
            onAutoPack={onAutoPack}
            onResetBackpack={onResetBackpack}
            onRotate={builder.rotateSelected}
            rotateDisabled={!builder.selectedItem || !builder.selectedCanRotate}
          />
        </div>
        <div className={styles.managerContent}>
          <section className={styles.managerPanel} aria-label={t("backpack.grid")}>
            <BackpackGrid
              layout={layout}
              inventory={inventory}
              selectedInstanceId={builder.selectedInstanceId}
              selectedRotated={builder.selectedRotated}
              preview={builder.preview}
              feedback={builder.feedback}
              onCellClick={builder.placeSelectedItem}
              onCellHover={(x, y) => builder.setHoveredCell({ x, y })}
              onCellLeave={() => builder.setHoveredCell(null)}
              onSelectItem={builder.selectItem}
              onDragStartItem={(item) => builder.selectItem(item.instanceId)}
            />
          </section>
          <aside className={styles.managerInventoryPanel} aria-label={t("backpack.unplacedAria")}>
            <InventoryList
              title={t("backpack.unplacedItems")}
              inventory={inventory}
              layout={layout}
              selectedInstanceId={builder.selectedInstanceId}
              rotatedByInstanceId={builder.rotatedByInstanceId}
              mode="unplaced"
              emptyText={t("backpack.allPacked")}
              onSelectItem={builder.selectItem}
              onDragStartItem={(item) => builder.selectItem(item.instanceId)}
            />
            {builder.backpackFull && (
              <div className={styles.backpackWarning}>{t("backpack.full")}</div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function handleBackdropMouseDown(
  event: MouseEvent<HTMLDivElement>,
  onClose: () => void,
): void {
  if (event.target === event.currentTarget) {
    onClose();
  }
}

function handleDialogKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  dialog: HTMLDivElement | null,
): void {
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
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex >= 0);
}

function shortHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 8)}...`;
}
