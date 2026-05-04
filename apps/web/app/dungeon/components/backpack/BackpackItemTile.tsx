"use client";

import { useCallback, useRef, useState, type MouseEvent } from "react";
import type {
  BackpackItemDefinitionV1,
  BackpackItemInstanceV1,
} from "@backpack-dungeon/game-core";
import { ItemNameTooltip } from "./ItemNameTooltip";
import { useI18n } from "../../../i18n/useI18n";
import styles from "./backpack.module.css";

export interface BackpackItemTileProps {
  readonly item: BackpackItemInstanceV1;
  readonly definition: BackpackItemDefinitionV1;
  readonly selected: boolean;
  readonly placed: boolean;
  readonly rotated?: boolean;
  readonly compact?: boolean;
  readonly onSelect: () => void;
  readonly onDragStart?: (item: BackpackItemInstanceV1) => void;
}

interface TooltipPosition {
  readonly x: number;
  readonly y: number;
}

export function BackpackItemTile({
  item,
  definition,
  selected,
  placed,
  rotated = false,
  compact = false,
  onSelect,
  onDragStart,
}: BackpackItemTileProps) {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);

  const showTooltipFromMouse = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    setTooltipPosition({ x: event.clientX, y: event.clientY });
  }, []);

  const showTooltipFromAnchor = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPosition({
      x: rect.left + Math.min(rect.width / 2, 28),
      y: rect.top + Math.min(rect.height / 2, 24),
    });
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={[
          styles.itemTile,
          styles[`itemKind_${definition.kind}`],
          selected ? styles.itemTileSelected : "",
          placed ? styles.itemTilePlaced : "",
          compact ? styles.itemTileCompact : "",
        ].join(" ")}
        onClick={onSelect}
        draggable={Boolean(onDragStart)}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", item.instanceId);
          event.dataTransfer.effectAllowed = "move";
          onDragStart?.(item);
        }}
        onMouseEnter={showTooltipFromMouse}
        onMouseMove={showTooltipFromMouse}
        onMouseLeave={() => setTooltipPosition(null)}
        onFocus={showTooltipFromAnchor}
        onBlur={() => setTooltipPosition(null)}
        title={definition.name}
        aria-label={`${definition.name}${placed ? `, ${t("backpack.placed")}` : ""}${rotated ? `, ${t("backpack.rotated")}` : ""}`}
      >
        <span className={styles.itemTileIcon} aria-hidden="true">
          {iconLabel(definition)}
        </span>
        <span className={styles.itemTileName}>{definition.name}</span>
        <span className={styles.itemTileState} aria-hidden="true">
          {placed && <span className={styles.itemTileDot} />}
          {rotated && <span className={`${styles.itemTileDot} ${styles.itemTileRotateDot}`} />}
        </span>
      </button>
      <ItemNameTooltip
        open={tooltipPosition !== null}
        name={definition.name}
        tier={definition.tier}
        x={tooltipPosition?.x ?? 0}
        y={tooltipPosition?.y ?? 0}
      />
    </>
  );
}

function iconLabel(definition: BackpackItemDefinitionV1): string {
  if (definition.kind === "gem") return "Rb";
  if (definition.kind === "weapon") return "W";
  if (definition.kind === "armor") return "A";
  if (definition.kind === "potion") return "P";
  if (definition.kind === "bomb") return "B";
  if (definition.kind === "charm") return "C";
  if (definition.kind === "ward") return "Wd";
  if (definition.kind === "food") return "F";
  return "K";
}
