"use client";

import { useMemo, useState } from "react";
import {
  getBackpackItemDefinition,
  getItemSize,
  type BackpackItemDefinitionV1,
  type BackpackItemInstanceV1,
  type BackpackLayoutV1,
  type PlacedBackpackItemV1,
} from "@backpack-dungeon/game-core";
import styles from "./battle.module.css";

export interface BattleSetupPanelProps {
  readonly backpackLayout: BackpackLayoutV1;
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly onMoveItem: (instanceId: string, x: number, y: number) => void;
  readonly onRotateItem: (instanceId: string) => void;
  readonly onAutoPack: () => void;
}

export function BattleSetupPanel({
  backpackLayout,
  inventory,
  onMoveItem,
  onRotateItem,
  onAutoPack,
}: BattleSetupPanelProps) {
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    inventory[0]?.instanceId ?? null
  );
  const selectedPlaced = backpackLayout.placedItems.find(
    (item) => item.instanceId === selectedInstanceId
  );
  const placedInstanceIds = useMemo(
    () => new Set(backpackLayout.placedItems.map((item) => item.instanceId)),
    [backpackLayout.placedItems]
  );
  const cells = useMemo(
    () =>
      Array.from({ length: backpackLayout.width * backpackLayout.height }, (_, index) => ({
        x: index % backpackLayout.width,
        y: Math.floor(index / backpackLayout.width),
      })),
    [backpackLayout.height, backpackLayout.width]
  );

  return (
    <section className={styles.setupPanel} aria-label="Backpack setup">
      <div className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>Backpack</h3>
        <div className={styles.setupActions}>
          <button type="button" className={styles.smallButton} onClick={onAutoPack}>
            Auto
          </button>
          <button
            type="button"
            className={styles.smallButton}
            onClick={() => selectedInstanceId && onRotateItem(selectedInstanceId)}
            disabled={!selectedPlaced}
          >
            Rotate
          </button>
        </div>
      </div>
      <div className={styles.panelBody}>
        <div
          className={styles.backpackGrid}
          style={{
            gridTemplateColumns: `repeat(${backpackLayout.width}, minmax(34px, 1fr))`,
            gridTemplateRows: `repeat(${backpackLayout.height}, minmax(34px, 1fr))`,
          }}
        >
          {cells.map((cell) => (
            <button
              key={`${cell.x}-${cell.y}`}
              type="button"
              className={`${styles.gridCell} ${
                selectedPlaced?.x === cell.x && selectedPlaced.y === cell.y ? styles.gridCellSelected : ""
              }`}
              style={{
                gridColumn: cell.x + 1,
                gridRow: cell.y + 1,
              }}
              onClick={() => {
                if (selectedInstanceId) onMoveItem(selectedInstanceId, cell.x, cell.y);
              }}
              aria-label={`Place selected item at ${cell.x},${cell.y}`}
            />
          ))}
          {backpackLayout.placedItems.map((placedItem) => (
            <PlacedItemButton
              key={placedItem.instanceId}
              placedItem={placedItem}
              selected={placedItem.instanceId === selectedInstanceId}
              onSelect={() => setSelectedInstanceId(placedItem.instanceId)}
            />
          ))}
        </div>

        <div className={styles.inventoryList}>
          {inventory.map((item) => (
            <InventoryItemButton
              key={item.instanceId}
              item={item}
              selected={item.instanceId === selectedInstanceId}
              placed={placedInstanceIds.has(item.instanceId)}
              onSelect={() => setSelectedInstanceId(item.instanceId)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function PlacedItemButton({
  placedItem,
  selected,
  onSelect,
}: {
  readonly placedItem: PlacedBackpackItemV1;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const definition = getDefinition(placedItem.definitionId);
  if (!definition) return null;

  const size = getItemSize(definition, placedItem.rotated);
  return (
    <button
      type="button"
      className={`${styles.placedItem} ${selected ? styles.placedItemSelected : ""}`}
      style={{
        gridColumn: `${placedItem.x + 1} / span ${size.width}`,
        gridRow: `${placedItem.y + 1} / span ${size.height}`,
      }}
      onClick={onSelect}
      title={definition.description}
    >
      <span className={styles.itemName}>{definition.name}</span>
      <span className={styles.itemMeta}>
        {size.width}x{size.height}
      </span>
    </button>
  );
}

function InventoryItemButton({
  item,
  selected,
  placed,
  onSelect,
}: {
  readonly item: BackpackItemInstanceV1;
  readonly selected: boolean;
  readonly placed: boolean;
  readonly onSelect: () => void;
}) {
  const definition = getDefinition(item.definitionId);
  if (!definition) return null;
  const effectText = summarizeEffects(definition);

  return (
    <button
      type="button"
      className={[
        styles.inventoryItem,
        selected ? styles.inventoryItemSelected : "",
        placed ? styles.inventoryItemPlaced : "",
      ].join(" ")}
      onClick={onSelect}
      title={definition.description}
    >
      <span>
        <span className={styles.itemName}>{definition.name}</span>
        <span className={styles.itemMeta}> {effectText}</span>
      </span>
      <span className={styles.itemMeta}>{placed ? "Packed" : "Loose"}</span>
    </button>
  );
}

function getDefinition(definitionId: string): BackpackItemDefinitionV1 | null {
  try {
    return getBackpackItemDefinition(definitionId);
  } catch {
    return null;
  }
}

function summarizeEffects(definition: BackpackItemDefinitionV1): string {
  const firstStat = definition.effects.find((effect) => effect.stat && effect.flat);
  if (firstStat?.stat && firstStat.flat !== undefined) {
    return `${firstStat.stat} +${firstStat.flat}`;
  }

  const firstEffect = definition.effects[0];
  if (firstEffect?.flat !== undefined) {
    return `effect ${firstEffect.flat}`;
  }

  return definition.kind;
}
