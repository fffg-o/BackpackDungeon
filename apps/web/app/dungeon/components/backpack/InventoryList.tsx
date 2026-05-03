"use client";

import {
  getBackpackItemDefinition,
  type BackpackItemInstanceV1,
  type BackpackLayoutV1,
} from "@backpack-dungeon/game-core";
import { BackpackItemTile } from "./BackpackItemTile";
import styles from "./backpack.module.css";

export type InventoryListMode = "all" | "placed" | "unplaced";

export interface InventoryListProps {
  readonly title: string;
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly layout: BackpackLayoutV1;
  readonly selectedInstanceId: string | null;
  readonly rotatedByInstanceId: ReadonlyMap<string, boolean>;
  readonly mode?: InventoryListMode;
  readonly emptyText: string;
  readonly onSelectItem: (instanceId: string) => void;
  readonly onDragStartItem: (item: BackpackItemInstanceV1) => void;
}

export function InventoryList({
  title,
  inventory,
  layout,
  selectedInstanceId,
  rotatedByInstanceId,
  mode = "all",
  emptyText,
  onSelectItem,
  onDragStartItem,
}: InventoryListProps) {
  const placedIds = new Set(layout.placedItems.map((item) => item.instanceId));
  const items = inventory.filter((item) => {
    if (mode === "placed") return placedIds.has(item.instanceId);
    if (mode === "unplaced") return !placedIds.has(item.instanceId);
    return true;
  });

  return (
    <section className={styles.inventoryGroup}>
      <h4 className={styles.inventoryGroupTitle}>{title}</h4>
      {items.length === 0 ? (
        <p className={styles.emptySummaryText}>{emptyText}</p>
      ) : (
        <div className={styles.inventoryList}>
          {items.map((item) => {
            const definition = getDefinition(item.definitionId);
            if (!definition) return null;
            return (
              <BackpackItemTile
                key={`${title}-${item.instanceId}`}
                item={item}
                definition={definition}
                selected={item.instanceId === selectedInstanceId}
                placed={placedIds.has(item.instanceId)}
                rotated={rotatedByInstanceId.get(item.instanceId) ?? false}
                onSelect={() => onSelectItem(item.instanceId)}
                onDragStart={onDragStartItem}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function getDefinition(definitionId: string) {
  try {
    return getBackpackItemDefinition(definitionId);
  } catch {
    return null;
  }
}
