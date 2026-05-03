import type {
  BackpackItemDefinitionV1,
  BackpackItemInstanceV1,
} from "@backpack-dungeon/game-core";

export interface ItemTooltipProps {
  readonly definition: BackpackItemDefinitionV1;
  readonly item: BackpackItemInstanceV1;
  readonly rotated?: boolean;
}

export function ItemTooltip(_props: ItemTooltipProps) {
  return null;
}
