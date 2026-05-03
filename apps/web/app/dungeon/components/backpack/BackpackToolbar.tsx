"use client";

import styles from "./backpack.module.css";

export interface BackpackToolbarProps {
  readonly onAutoPack: () => void;
  readonly onResetBackpack?: () => void;
  readonly onRotate?: () => void;
  readonly rotateDisabled?: boolean;
}

export function BackpackToolbar({
  onAutoPack,
  onResetBackpack,
  onRotate,
  rotateDisabled = false,
}: BackpackToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <button type="button" className={styles.toolbarButton} onClick={onAutoPack}>
        Auto Pack
      </button>
      {onRotate && (
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={onRotate}
          disabled={rotateDisabled}
        >
          Rotate
        </button>
      )}
      {onResetBackpack && (
        <button type="button" className={styles.toolbarButton} onClick={onResetBackpack}>
          Reset Layout
        </button>
      )}
    </div>
  );
}
