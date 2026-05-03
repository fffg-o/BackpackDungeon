import {
  getItemSize,
  type BackpackItemDefinitionV1,
  type BackpackItemInstanceV1,
} from "@backpack-dungeon/game-core";
import { ItemEffectList } from "./ItemEffectList";
import styles from "./battle.module.css";

export interface ItemTooltipProps {
  readonly definition: BackpackItemDefinitionV1;
  readonly item: BackpackItemInstanceV1;
  readonly rotated?: boolean;
}

export function ItemTooltip({ definition, item, rotated = false }: ItemTooltipProps) {
  const size = getItemSize(definition, rotated);
  const hints = adjacencyHints(definition);

  return (
    <div className={styles.itemTooltip} role="tooltip">
      <div className={styles.tooltipHeader}>
        <span className={styles.tooltipIcon}>{definition.icon}</span>
        <span>
          <strong>{definition.name}</strong>
          <span className={styles.tooltipMeta}>{definition.tier}</span>
        </span>
      </div>
      <div className={styles.tooltipGrid}>
        <span>Kind</span>
        <strong>{definition.kind}</strong>
        <span>Size</span>
        <strong>
          {size.width}x{size.height}
        </strong>
        <span>Source</span>
        <strong>{item.sourceKind}</strong>
        <span>ID</span>
        <strong>{shortId(item.instanceId)}</strong>
      </div>
      <ItemEffectList definition={definition} />
      {hints.length > 0 && (
        <ul className={styles.adjacencyHintList}>
          {hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function adjacencyHints(definition: BackpackItemDefinitionV1): readonly string[] {
  if (definition.kind === "gem" && definition.tags.includes("ruby")) {
    return ["Next to a weapon: +1 ATK."];
  }
  if (definition.kind === "charm") {
    return ["Next to a gem: +100 crit bps."];
  }
  if (definition.kind === "ward") {
    return ["Next to armor: +1 DEF."];
  }
  if (definition.kind === "weapon") {
    return ["Ruby touching this weapon gains +1 ATK."];
  }
  if (definition.kind === "armor") {
    return ["Ward touching this armor gains +1 DEF."];
  }
  return [];
}

function shortId(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
