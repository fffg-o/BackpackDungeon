"use client";

import type { BackpackItemDefinitionV1 } from "@backpack-dungeon/game-core";
import { localizeBackpackItemEffect } from "../../../i18n/backpackItems";
import { useI18n } from "../../../i18n/useI18n";
import styles from "./battle.module.css";

export interface ItemEffectListProps {
  readonly definition: BackpackItemDefinitionV1;
}

export function ItemEffectList({ definition }: ItemEffectListProps) {
  const { t } = useI18n();

  return (
    <ul className={styles.itemEffectList}>
      {definition.effects.map((effect, index) => (
        <li key={`${definition.id}-effect-${index}`}>
          {localizeBackpackItemEffect(definition, index, t, effect.description)}
        </li>
      ))}
    </ul>
  );
}
