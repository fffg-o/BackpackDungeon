import { hashCanonicalJson } from "@backpack-dungeon/shared";
import type { BattleCombatantStatsV1 } from "./battle-system.js";
import type {
  BackpackItemDefinitionV1,
  BackpackItemEffectV1,
  BackpackItemInstanceV1
} from "./backpack-items.js";
import {
  getItemSize,
  type BackpackDefinitionLookup,
  type BackpackLayoutV1,
  type PlacedBackpackItemV1
} from "./backpack-layout.js";

export interface BackpackSnapshotV1 {
  readonly version: 1;
  readonly layout: BackpackLayoutV1;
  readonly itemDefinitions: readonly BackpackItemDefinitionV1[];
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly backpackHash: string;
}

export interface BackpackHashInputV1 {
  readonly version?: 1;
  readonly layout: BackpackLayoutV1;
  readonly itemDefinitions?: readonly BackpackItemDefinitionV1[];
  readonly inventory: readonly BackpackItemInstanceV1[];
}

export type BackpackStatKey = NonNullable<BackpackItemEffectV1["stat"]>;

export interface BackpackStatBonusesV1 {
  readonly attack: number;
  readonly defense: number;
  readonly maxHealth: number;
  readonly speed: number;
  readonly critBps: number;
  readonly dodgeBps: number;
}

export interface BackpackTriggeredEffectV1 {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly trigger: NonNullable<BackpackItemEffectV1["trigger"]>;
  readonly description: string;
  readonly flat?: number;
  readonly stat?: BackpackStatKey;
}

const EMPTY_BONUSES: BackpackStatBonusesV1 = Object.freeze({
  attack: 0,
  critBps: 0,
  defense: 0,
  dodgeBps: 0,
  maxHealth: 0,
  speed: 0
});

export function computeBackpackHash(
  input: BackpackSnapshotV1 | BackpackHashInputV1
): string {
  return hashCanonicalJson({
    domain: "backpack-snapshot-v1",
    inventory: [...input.inventory]
      .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
      .map((item) => ({
        acquiredAt: item.acquiredAt,
        definitionId: item.definitionId,
        instanceId: item.instanceId,
        sourceKind: item.sourceKind,
        sourceRef: item.sourceRef
      })),
    itemDefinitions: [...(input.itemDefinitions ?? [])]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((definition) => ({
        description: definition.description,
        effects: definition.effects.map((effect) => ({
          bps: effect.bps,
          cooldownTurns: effect.cooldownTurns,
          description: effect.description,
          flat: effect.flat,
          stat: effect.stat,
          trigger: effect.trigger
        })),
        icon: definition.icon,
        id: definition.id,
        kind: definition.kind,
        name: definition.name,
        size: {
          height: definition.size.height,
          width: definition.size.width
        },
        tags: [...definition.tags],
        tier: definition.tier
      })),
    layout: {
      height: input.layout.height,
      placedItems: [...input.layout.placedItems]
        .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
        .map((item) => ({
          definitionId: item.definitionId,
          instanceId: item.instanceId,
          rotated: item.rotated,
          x: item.x,
          y: item.y
        })),
      version: input.layout.version,
      width: input.layout.width
    },
    version: 1
  });
}

export function createBackpackSnapshot(
  input: BackpackHashInputV1 & {
    readonly itemDefinitions: readonly BackpackItemDefinitionV1[];
  }
): BackpackSnapshotV1 {
  return {
    inventory: input.inventory,
    itemDefinitions: input.itemDefinitions,
    layout: input.layout,
    version: 1,
    backpackHash: computeBackpackHash(input)
  };
}

export function computeBackpackStatBonuses(
  layout: BackpackLayoutV1,
  inventory: readonly BackpackItemInstanceV1[],
  definitions: BackpackDefinitionLookup
): BackpackStatBonusesV1 {
  const bonuses = mutableBonuses();
  const placed = placedItemsWithDefinitions(layout, inventory, definitions);

  for (const item of placed) {
    for (const effect of item.definition.effects) {
      if (effect.stat && (effect.trigger === undefined || effect.trigger === "passive")) {
        bonuses[effect.stat] += effect.flat ?? 0;
      }
    }
  }

  for (const charm of placed.filter((item) => item.definition.kind === "charm")) {
    const charmEffectBps =
      charm.definition.effects.find((effect) => effect.stat === "attack" && effect.bps)?.bps ?? 0;
    if (charmEffectBps <= 0) {
      continue;
    }

    for (const adjacent of placed) {
      if (adjacent.placed.instanceId === charm.placed.instanceId) {
        continue;
      }
      if (adjacent.definition.kind !== "gem" && adjacent.definition.kind !== "weapon") {
        continue;
      }
      if (!areAdjacent(charm.placed, charm.definition, adjacent.placed, adjacent.definition)) {
        continue;
      }

      const attackFlat = adjacent.definition.effects
        .filter((effect) => effect.stat === "attack")
        .reduce((total, effect) => total + (effect.flat ?? 0), 0);
      bonuses.attack += Math.max(1, Math.floor((attackFlat * charmEffectBps) / 10_000));
    }
  }

  return bonuses;
}

export function applyBackpackStatBonuses(
  stats: BattleCombatantStatsV1,
  bonuses: BackpackStatBonusesV1
): BattleCombatantStatsV1 {
  return {
    attack: Math.max(1, stats.attack + bonuses.attack),
    critBps: clampBps(stats.critBps + bonuses.critBps),
    defense: Math.max(0, stats.defense + bonuses.defense),
    dodgeBps: clampBps(stats.dodgeBps + bonuses.dodgeBps),
    maxHealth: Math.max(1, stats.maxHealth + bonuses.maxHealth),
    speed: Math.max(1, stats.speed + bonuses.speed)
  };
}

export function collectBackpackTriggeredEffects(
  layout: BackpackLayoutV1,
  inventory: readonly BackpackItemInstanceV1[],
  definitions: BackpackDefinitionLookup,
  trigger: NonNullable<BackpackItemEffectV1["trigger"]>
): readonly BackpackTriggeredEffectV1[] {
  return placedItemsWithDefinitions(layout, inventory, definitions).flatMap((item) =>
    item.definition.effects
      .filter((effect) => effect.trigger === trigger)
      .map((effect) => ({
        definitionId: item.definition.id,
        description: effect.description,
        flat: effect.flat,
        instanceId: item.instance.instanceId,
        stat: effect.stat,
        trigger
      }))
  );
}

function mutableBonuses(): Record<BackpackStatKey, number> {
  return { ...EMPTY_BONUSES };
}

function placedItemsWithDefinitions(
  layout: BackpackLayoutV1,
  inventory: readonly BackpackItemInstanceV1[],
  definitions: BackpackDefinitionLookup
): readonly {
  readonly placed: PlacedBackpackItemV1;
  readonly instance: BackpackItemInstanceV1;
  readonly definition: BackpackItemDefinitionV1;
}[] {
  return layout.placedItems.flatMap((placed) => {
    const instance = inventory.find((item) => item.instanceId === placed.instanceId);
    const definition = findDefinition(definitions, placed.definitionId);
    if (!instance || !definition) {
      return [];
    }

    return [
      {
        definition,
        instance,
        placed
      }
    ];
  });
}

function areAdjacent(
  a: PlacedBackpackItemV1,
  definitionA: BackpackItemDefinitionV1,
  b: PlacedBackpackItemV1,
  definitionB: BackpackItemDefinitionV1
): boolean {
  const rectA = rectFor(a, definitionA);
  const rectB = rectFor(b, definitionB);
  const horizontallyTouching =
    (rectA.right + 1 === rectB.left || rectB.right + 1 === rectA.left) &&
    rangesOverlap(rectA.top, rectA.bottom, rectB.top, rectB.bottom);
  const verticallyTouching =
    (rectA.bottom + 1 === rectB.top || rectB.bottom + 1 === rectA.top) &&
    rangesOverlap(rectA.left, rectA.right, rectB.left, rectB.right);

  return horizontallyTouching || verticallyTouching;
}

function rectFor(
  item: PlacedBackpackItemV1,
  definition: BackpackItemDefinitionV1
): {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
} {
  const size = getItemSize(definition, item.rotated);
  return {
    bottom: item.y + size.height - 1,
    left: item.x,
    right: item.x + size.width - 1,
    top: item.y
  };
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function findDefinition(
  definitions: BackpackDefinitionLookup,
  definitionId: string
): BackpackItemDefinitionV1 | null {
  if (isDefinitionArray(definitions)) {
    return definitions.find((definition) => definition.id === definitionId) ?? null;
  }

  return definitions[definitionId] ?? null;
}

function isDefinitionArray(
  definitions: BackpackDefinitionLookup
): definitions is readonly BackpackItemDefinitionV1[] {
  return Array.isArray(definitions);
}

function clampBps(value: number): number {
  return Math.max(0, Math.min(10_000, value));
}
