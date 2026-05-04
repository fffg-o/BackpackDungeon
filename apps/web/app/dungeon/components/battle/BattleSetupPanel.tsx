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
import { useI18n } from "../../../i18n/useI18n";
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
  const { t } = useI18n();
  const builder = useBackpackBuilder({
    inventory,
    layout: backpackLayout,
    onMoveItem,
    onRotateItem,
  });

  return (
    <section className={styles.setupPanel} aria-label={t("backpack.setup")}>
      <div className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>{t("backpack.title")}</h3>
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
            title={t("backpack.equippedPlaced")}
            inventory={inventory}
            layout={backpackLayout}
            selectedInstanceId={builder.selectedInstanceId}
            rotatedByInstanceId={builder.rotatedByInstanceId}
            mode="placed"
            emptyText={t("backpack.noPlaced")}
            onSelectItem={builder.selectItem}
            onDragStartItem={(item) => builder.selectItem(item.instanceId)}
          />
          <InventoryList
            title={t("backpack.inventoryUnplaced")}
            inventory={inventory}
            layout={backpackLayout}
            selectedInstanceId={builder.selectedInstanceId}
            rotatedByInstanceId={builder.rotatedByInstanceId}
            mode="unplaced"
            emptyText={t("backpack.noLoose")}
            onSelectItem={builder.selectItem}
            onDragStartItem={(item) => builder.selectItem(item.instanceId)}
          />
          {builder.backpackFull && (
            <div className={backpackStyles.backpackWarning}>
              {t("backpack.full")}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
