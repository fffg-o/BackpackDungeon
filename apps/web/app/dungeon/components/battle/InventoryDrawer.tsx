"use client";

import {
  getBackpackItemDefinition,
  type BackpackItemInstanceV1,
  type BackpackLayoutV1,
} from "@backpack-dungeon/game-core";
import { BackpackItemTile } from "./BackpackItemTile";
import { useI18n } from "../../../i18n/useI18n";
import styles from "./battle.module.css";

export interface InventoryDrawerProps {
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly layout: BackpackLayoutV1;
  readonly selectedInstanceId: string | null;
  readonly rotatedByInstanceId: ReadonlyMap<string, boolean>;
  readonly backpackFull: boolean;
  readonly onSelectItem: (instanceId: string) => void;
  readonly onDragStartItem: (item: BackpackItemInstanceV1) => void;
}

export function InventoryDrawer({
  inventory,
  layout,
  selectedInstanceId,
  rotatedByInstanceId,
  backpackFull,
  onSelectItem,
  onDragStartItem,
}: InventoryDrawerProps) {
  const { t } = useI18n();
  const placedIds = new Set(layout.placedItems.map((item) => item.instanceId));
  const placedItems = inventory.filter((item) => placedIds.has(item.instanceId));

  return (
    <div className={styles.inventoryDrawer}>
      <InventoryGroup
        title={t("backpack.equippedPlaced")}
        items={placedItems}
        placedIds={placedIds}
        selectedInstanceId={selectedInstanceId}
        rotatedByInstanceId={rotatedByInstanceId}
        onSelectItem={onSelectItem}
        onDragStartItem={onDragStartItem}
        emptyText={t("backpack.noPlaced")}
      />
      <InventoryGroup
        title={t("backpack.inventoryUnplaced")}
        items={inventory}
        placedIds={placedIds}
        selectedInstanceId={selectedInstanceId}
        rotatedByInstanceId={rotatedByInstanceId}
        onSelectItem={onSelectItem}
        onDragStartItem={onDragStartItem}
        emptyText={t("backpack.noInventory")}
      />
      {backpackFull && <div className={styles.backpackWarning}>{t("backpack.full")}</div>}
    </div>
  );
}

function InventoryGroup({
  title,
  items,
  placedIds,
  selectedInstanceId,
  rotatedByInstanceId,
  onSelectItem,
  onDragStartItem,
  emptyText,
}: {
  readonly title: string;
  readonly items: readonly BackpackItemInstanceV1[];
  readonly placedIds: ReadonlySet<string>;
  readonly selectedInstanceId: string | null;
  readonly rotatedByInstanceId: ReadonlyMap<string, boolean>;
  readonly onSelectItem: (instanceId: string) => void;
  readonly onDragStartItem: (item: BackpackItemInstanceV1) => void;
  readonly emptyText: string;
}) {
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
