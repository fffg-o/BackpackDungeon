"use client";

import { useI18n } from "../../i18n/useI18n";
import styles from "../dungeon.module.css";

export interface HpBarProps {
  readonly current: number;
  readonly max: number;
  readonly label: string;
  readonly variant: "player" | "enemy" | "boss";
}

export function HpBar({ current, max, label, variant }: HpBarProps) {
  const { t } = useI18n();
  const safeMax = Math.max(1, max);
  const safeCurrent = Math.max(0, Math.min(current, safeMax));
  const percent = Math.floor((safeCurrent * 100) / safeMax);
  const stateClass =
    percent <= 25
      ? styles.hpFillDanger
      : percent <= 55
        ? styles.hpFillWarn
        : styles.hpFillHealthy;

  return (
    <div className={styles.hpBlock}>
      <div className={styles.hpMeta}>
        <span className={styles.metaLabel}>{label}</span>
        <span className={styles.metaValue}>
          {safeCurrent <= 0 ? t("common.defeated") : `${safeCurrent} / ${safeMax}`}
        </span>
      </div>
      <div className={`${styles.hpBar} ${styles[`hpBar${capitalizeVariant(variant)}`]}`}>
        <div
          className={`${styles.hpFill} ${stateClass}`}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  );
}

function capitalizeVariant(variant: HpBarProps["variant"]): "Player" | "Enemy" | "Boss" {
  if (variant === "player") return "Player";
  if (variant === "boss") return "Boss";
  return "Enemy";
}
