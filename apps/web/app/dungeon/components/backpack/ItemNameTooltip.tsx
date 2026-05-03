"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import styles from "./backpack.module.css";

export interface ItemNameTooltipProps {
  readonly open: boolean;
  readonly name: string;
  readonly tier?: string;
  readonly x: number;
  readonly y: number;
}

const TOOLTIP_WIDTH = 220;
const TOOLTIP_HEIGHT = 58;
const CURSOR_OFFSET = 14;
const VIEWPORT_PADDING = 8;

export function ItemNameTooltip({ open, name, tier, x, y }: ItemNameTooltipProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const style = useMemo<CSSProperties>(() => {
    if (typeof window === "undefined") {
      return { left: x + CURSOR_OFFSET, top: y + CURSOR_OFFSET };
    }

    return {
      left: clamp(x + CURSOR_OFFSET, VIEWPORT_PADDING, window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_PADDING),
      top: clamp(y + CURSOR_OFFSET, VIEWPORT_PADDING, window.innerHeight - TOOLTIP_HEIGHT - VIEWPORT_PADDING),
    };
  }, [x, y]);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div className={styles.tooltip} role="tooltip" style={style}>
      {name}
      {tier && <span className={styles.tooltipTier}>{tier}</span>}
    </div>,
    document.body,
  );
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}
