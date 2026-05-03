import {
  getBackpackItemDefinition,
  getItemSize,
  type BackpackItemInstanceV1,
  type BackpackLayoutV1,
  type PlacedBackpackItemV1,
} from "@backpack-dungeon/game-core";
import { BackpackCell, type BackpackCellPreviewState } from "./BackpackCell";
import { BackpackItemTile } from "./BackpackItemTile";
import styles from "./battle.module.css";

export interface BackpackPlacementPreview {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly valid: boolean;
  readonly reason?: string;
}

export interface BackpackGridProps {
  readonly layout: BackpackLayoutV1;
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly selectedInstanceId: string | null;
  readonly selectedRotated: boolean;
  readonly preview: BackpackPlacementPreview | null;
  readonly feedback: string | null;
  readonly onCellClick: (x: number, y: number, instanceId?: string | null) => void;
  readonly onCellHover: (x: number, y: number) => void;
  readonly onCellLeave: () => void;
  readonly onSelectItem: (instanceId: string) => void;
  readonly onDragStartItem: (item: BackpackItemInstanceV1) => void;
}

export function BackpackGrid({
  layout,
  inventory,
  selectedInstanceId,
  selectedRotated,
  preview,
  feedback,
  onCellClick,
  onCellHover,
  onCellLeave,
  onSelectItem,
  onDragStartItem,
}: BackpackGridProps) {
  const cells = Array.from({ length: layout.width * layout.height }, (_, index) => ({
    x: index % layout.width,
    y: Math.floor(index / layout.width),
  }));

  return (
    <div className={styles.gridShell}>
      <div
        className={styles.backpackGrid}
        style={{
          gridTemplateColumns: `repeat(${layout.width}, minmax(34px, 1fr))`,
          gridTemplateRows: `repeat(${layout.height}, minmax(34px, 1fr))`,
        }}
      >
        {cells.map((cell) => (
          <BackpackCell
            key={`${cell.x}-${cell.y}`}
            x={cell.x}
            y={cell.y}
            preview={previewStateForCell(cell.x, cell.y, preview)}
            onClick={onCellClick}
            onHover={onCellHover}
            onLeave={onCellLeave}
            onDropItem={onCellClick}
          />
        ))}
        {layout.placedItems.map((placedItem) => (
          <PlacedItem
            key={placedItem.instanceId}
            placedItem={placedItem}
            inventory={inventory}
            selected={placedItem.instanceId === selectedInstanceId}
            selectedRotated={selectedRotated}
            onSelect={() => onSelectItem(placedItem.instanceId)}
            onDragStartItem={onDragStartItem}
          />
        ))}
      </div>
      <div className={styles.backpackFeedback} aria-live="polite">
        {feedback ?? (preview?.reason && !preview.valid ? preview.reason : "Arrange items before combat.")}
      </div>
    </div>
  );
}

function PlacedItem({
  placedItem,
  inventory,
  selected,
  selectedRotated,
  onSelect,
  onDragStartItem,
}: {
  readonly placedItem: PlacedBackpackItemV1;
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly selected: boolean;
  readonly selectedRotated: boolean;
  readonly onSelect: () => void;
  readonly onDragStartItem: (item: BackpackItemInstanceV1) => void;
}) {
  const item = inventory.find((candidate) => candidate.instanceId === placedItem.instanceId);
  if (!item) return null;

  const definition = getDefinition(placedItem.definitionId);
  if (!definition) return null;

  const rotated = selected ? selectedRotated : placedItem.rotated;
  const size = getItemSize(definition, placedItem.rotated);

  return (
    <div
      className={styles.placedGridItem}
      style={{
        gridColumn: `${placedItem.x + 1} / span ${size.width}`,
        gridRow: `${placedItem.y + 1} / span ${size.height}`,
      }}
    >
      <BackpackItemTile
        item={item}
        definition={definition}
        selected={selected}
        placed
        rotated={rotated}
        compact
        onSelect={onSelect}
        onDragStart={onDragStartItem}
      />
    </div>
  );
}

function previewStateForCell(
  x: number,
  y: number,
  preview: BackpackPlacementPreview | null
): BackpackCellPreviewState {
  if (!preview) return "none";
  const inside =
    x >= preview.x &&
    x < preview.x + preview.width &&
    y >= preview.y &&
    y < preview.y + preview.height;
  if (!inside) return "none";
  return preview.valid ? "valid" : "invalid";
}

function getDefinition(definitionId: string) {
  try {
    return getBackpackItemDefinition(definitionId);
  } catch {
    return null;
  }
}
