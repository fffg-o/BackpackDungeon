import type {
  BackpackItemDefinitionV1,
  BackpackItemInstanceV1,
} from "@backpack-dungeon/game-core";
import { ItemTooltip } from "./ItemTooltip";
import styles from "./battle.module.css";

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
  return (
    <button
      type="button"
      className={[
        styles.inventoryItem,
        styles.itemTile,
        styles[`itemKind_${definition.kind}`],
        selected ? styles.inventoryItemSelected : "",
        placed ? styles.inventoryItemPlaced : "",
        compact ? styles.itemTileCompact : "",
      ].join(" ")}
      onClick={onSelect}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.instanceId);
        event.dataTransfer.effectAllowed = "move";
        onDragStart?.(item);
      }}
      title={definition.description}
    >
      <span className={styles.itemTileIcon} aria-hidden="true">
        {iconLabel(definition)}
      </span>
      <span className={styles.itemTileText}>
        <span className={styles.itemName}>{definition.name}</span>
        <span className={styles.itemMeta}>{summarizeEffects(definition)}</span>
      </span>
      <span className={styles.itemTileBadges}>
        {placed && <span className={styles.placedBadge}>Placed</span>}
        {rotated && <span className={styles.placedBadge}>Rotated</span>}
      </span>
      <ItemTooltip definition={definition} item={item} rotated={rotated} />
    </button>
  );
}

function summarizeEffects(definition: BackpackItemDefinitionV1): string {
  const firstStat = definition.effects.find((effect) => effect.stat && effect.flat);
  if (firstStat?.stat && firstStat.flat !== undefined) {
    return `${firstStat.stat} +${firstStat.flat}`;
  }

  const firstEffect = definition.effects[0];
  if (firstEffect?.flat !== undefined) {
    return `${firstEffect.trigger ?? "effect"} ${firstEffect.flat}`;
  }

  return definition.kind;
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
