"use client";

import type {
  BackpackItemInstanceV1,
  BackpackLayoutV1,
} from "@backpack-dungeon/game-core";
import { BackpackGrid } from "../backpack/BackpackGrid";
import { BackpackToolbar } from "../backpack/BackpackToolbar";
import { InventoryList } from "../backpack/InventoryList";
import { useBackpackBuilder } from "../backpack/useBackpackBuilder";
import backpackStyles from "../backpack/backpack.module.css";
import { BackpackStatsPreview } from "./BackpackStatsPreview";
import styles from "./battle.module.css";

export interface BattleSetupPanelProps {
  readonly backpackLayout: BackpackLayoutV1;
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly onMoveItem: (instanceId: string, x: number, y: number, rotated?: boolean) => void;
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
  const builder = useBackpackBuilder({
    inventory,
    layout: backpackLayout,
    onMoveItem,
    onRotateItem,
  });

  return (
    <section className={styles.setupPanel} aria-label="Backpack setup">
      <div className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>Backpack</h3>
        <BackpackToolbar
          onAutoPack={onAutoPack}
          onRotate={builder.rotateSelected}
          rotateDisabled={!builder.selectedItem || !builder.selectedCanRotate}
        />
      </div>
      <div className={styles.panelBody}>
        <div className={styles.builderStack}>
          <BackpackGrid
            layout={backpackLayout}
            inventory={inventory}
            selectedInstanceId={builder.selectedInstanceId}
            selectedRotated={builder.selectedRotated}
            preview={builder.preview}
            feedback={builder.feedback}
            onCellClick={builder.placeSelectedItem}
            onCellHover={(x, y) => builder.setHoveredCell({ x, y })}
            onCellLeave={() => builder.setHoveredCell(null)}
            onSelectItem={builder.selectItem}
            onDragStartItem={(item) => builder.selectItem(item.instanceId)}
          />
          <BackpackStatsPreview inventory={inventory} layout={backpackLayout} />
          <InventoryList
            title="Equipped / Placed"
            inventory={inventory}
            layout={backpackLayout}
            selectedInstanceId={builder.selectedInstanceId}
            rotatedByInstanceId={builder.rotatedByInstanceId}
            mode="placed"
            emptyText="No items placed."
            onSelectItem={builder.selectItem}
            onDragStartItem={(item) => builder.selectItem(item.instanceId)}
          />
          <InventoryList
            title="Inventory / Unplaced"
            inventory={inventory}
            layout={backpackLayout}
            selectedInstanceId={builder.selectedInstanceId}
            rotatedByInstanceId={builder.rotatedByInstanceId}
            mode="unplaced"
            emptyText="No loose items."
            onSelectItem={builder.selectItem}
            onDragStartItem={(item) => builder.selectItem(item.instanceId)}
          />
          {builder.backpackFull && (
            <div className={backpackStyles.backpackWarning}>
              Backpack full. Make room before placing more.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
