import type { BackpackItemDefinitionV1 } from "@backpack-dungeon/game-core";
import styles from "./battle.module.css";

export interface ItemEffectListProps {
  readonly definition: BackpackItemDefinitionV1;
}

export function ItemEffectList({ definition }: ItemEffectListProps) {
  return (
    <ul className={styles.itemEffectList}>
      {definition.effects.map((effect, index) => (
        <li key={`${definition.id}-effect-${index}`}>{effect.description}</li>
      ))}
    </ul>
  );
}
