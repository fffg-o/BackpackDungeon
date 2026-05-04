"use client";

import { useI18n } from "../../../i18n/useI18n";
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
  const { t } = useI18n();
  return (
    <div className={styles.toolbar}>
      <button type="button" className={styles.toolbarButton} onClick={onAutoPack}>
        {t("backpack.autoPack")}
      </button>
      {onRotate && (
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={onRotate}
          disabled={rotateDisabled}
        >
          {t("backpack.rotate")}
        </button>
      )}
      {onResetBackpack && (
        <button type="button" className={styles.toolbarButton} onClick={onResetBackpack}>
          {t("backpack.reset")}
        </button>
      )}
    </div>
  );
}
