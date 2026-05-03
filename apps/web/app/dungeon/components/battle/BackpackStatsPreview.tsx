import {
  BACKPACK_ITEM_DEFINITIONS,
  computeBackpackCombatEffects,
  createBackpackSnapshot,
  type BackpackItemInstanceV1,
  type BackpackLayoutV1,
} from "@backpack-dungeon/game-core";
import styles from "./battle.module.css";

export interface BackpackStatsPreviewProps {
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly layout: BackpackLayoutV1;
}

export function BackpackStatsPreview({ inventory, layout }: BackpackStatsPreviewProps) {
  const effects = safeComputeEffects(inventory, layout);
  const triggerText = [
    effects.battleStartDamageFlat > 0 ? `${effects.battleStartDamageFlat} battle dmg` : null,
    effects.lowHealthHealFlat > 0 ? `${effects.lowHealthHealFlat} low HP heal` : null,
    effects.shieldFlat > 0 ? `${effects.shieldFlat} shield` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  const synergyCount = effects.notes.filter((note) => note.includes("adjacent")).length;

  return (
    <section className={styles.statsPreview} aria-label="Backpack stats preview">
      <h4 className={styles.inventoryGroupTitle}>Stats Preview</h4>
      <div className={styles.statsPreviewGrid}>
        <PreviewStat label="Attack bonus" value={`+${effects.attackFlat}`} />
        <PreviewStat label="Defense bonus" value={`+${effects.defenseFlat}`} />
        <PreviewStat label="Max HP bonus" value={`+${effects.maxHealthFlat}`} />
        <PreviewStat label="Crit bonus" value={`+${effects.critBpsFlat} bps`} />
        <PreviewStat label="Trigger effects" value={triggerText || "None"} />
        <PreviewStat label="Synergy count" value={synergyCount} />
      </div>
    </section>
  );
}

function PreviewStat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}) {
  return (
    <div className={styles.previewStat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function safeComputeEffects(
  inventory: readonly BackpackItemInstanceV1[],
  layout: BackpackLayoutV1
) {
  try {
    return computeBackpackCombatEffects(
      createBackpackSnapshot({
        inventory,
        itemDefinitions: BACKPACK_ITEM_DEFINITIONS,
        layout,
      })
    );
  } catch {
    return {
      attackFlat: 0,
      battleStartDamageFlat: 0,
      critBpsFlat: 0,
      defenseFlat: 0,
      dodgeBpsFlat: 0,
      lowHealthHealFlat: 0,
      maxHealthFlat: 0,
      notes: [],
      shieldFlat: 0,
      speedFlat: 0,
      triggeredItemInstanceIds: [],
    };
  }
}
