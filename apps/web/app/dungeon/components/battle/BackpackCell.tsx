import type { DragEvent } from "react";
import styles from "./battle.module.css";

export type BackpackCellPreviewState = "none" | "valid" | "invalid";

export interface BackpackCellProps {
  readonly x: number;
  readonly y: number;
  readonly preview: BackpackCellPreviewState;
  readonly onClick: (x: number, y: number) => void;
  readonly onHover: (x: number, y: number) => void;
  readonly onLeave: () => void;
  readonly onDropItem: (x: number, y: number, instanceId: string | null) => void;
}

export function BackpackCell({
  x,
  y,
  preview,
  onClick,
  onHover,
  onLeave,
  onDropItem,
}: BackpackCellProps) {
  return (
    <button
      type="button"
      className={[
        styles.gridCell,
        preview === "valid" ? styles.gridCellPreviewValid : "",
        preview === "invalid" ? styles.gridCellPreviewInvalid : "",
      ].join(" ")}
      style={{
        gridColumn: x + 1,
        gridRow: y + 1,
      }}
      onClick={() => onClick(x, y)}
      onMouseEnter={() => onHover(x, y)}
      onFocus={() => onHover(x, y)}
      onMouseLeave={onLeave}
      onBlur={onLeave}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onHover(x, y);
      }}
      onDrop={(event: DragEvent<HTMLButtonElement>) => {
        event.preventDefault();
        onDropItem(x, y, event.dataTransfer.getData("text/plain") || null);
      }}
      title={`Cell ${x},${y}`}
      aria-label={`Backpack cell ${x},${y}`}
    >
      <span className={styles.cellCoordinate}>{x},{y}</span>
    </button>
  );
}
