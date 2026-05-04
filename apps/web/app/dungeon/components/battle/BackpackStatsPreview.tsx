"use client";

import {
  BACKPACK_ITEM_DEFINITIONS,
  computeBackpackCombatEffects,
  createBackpackSnapshot,
  type BackpackItemInstanceV1,
  type BackpackLayoutV1,
} from "@backpack-dungeon/game-core";
import { useI18n } from "../../../i18n/useI18n";
import styles from "./battle.module.css";

export interface BackpackStatsPreviewProps {
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly layout: BackpackLayoutV1;
}

export function BackpackStatsPreview({ inventory, layout }: BackpackStatsPreviewProps) {
  const { t } = useI18n();
  const effects = safeComputeEffects(inventory, layout);
  const triggerText = [
    effects.battleStartDamageFlat > 0 ? t("backpack.battleDamage", { amount: effects.battleStartDamageFlat }) : null,
    effects.lowHealthHealFlat > 0 ? t("backpack.lowHpHeal", { amount: effects.lowHealthHealFlat }) : null,
    effects.shieldFlat > 0 ? t("backpack.shield", { amount: effects.shieldFlat }) : null,
  ]
    .filter(Boolean)
    .join(" / ");
  const synergyCount = effects.notes.filter((note) => note.includes("adjacent")).length;

  return (
    <section className={styles.statsPreview} aria-label={t("backpack.statsPreviewAria")}>
      <h4 className={styles.inventoryGroupTitle}>{t("backpack.statsPreview")}</h4>
      <div className={styles.statsPreviewGrid}>
        <PreviewStat label={t("backpack.attackBonus")} value={`+${effects.attackFlat}`} />
        <PreviewStat label={t("backpack.defenseBonus")} value={`+${effects.defenseFlat}`} />
        <PreviewStat label={t("backpack.maxHpBonus")} value={`+${effects.maxHealthFlat}`} />
        <PreviewStat label={t("backpack.critBonus")} value={`+${effects.critBpsFlat} bps`} />
        <PreviewStat label={t("backpack.triggerEffects")} value={triggerText || t("common.none")} />
        <PreviewStat label={t("backpack.synergyCount")} value={synergyCount} />
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
