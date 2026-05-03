import { hashCanonicalJson } from "@backpack-dungeon/shared";
import type { BattleCombatantStatsV1 } from "./battle-system.js";
import type {
  BackpackItemDefinitionV1,
  BackpackItemEffectV1,
  BackpackItemInstanceV1
} from "./backpack-items.js";
import {
  canPlaceItem,
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

export interface BackpackCombatEffectSummaryV1 {
  readonly maxHealthFlat: number;
  readonly attackFlat: number;
  readonly defenseFlat: number;
  readonly speedFlat: number;
  readonly critBpsFlat: number;
  readonly dodgeBpsFlat: number;
  readonly battleStartDamageFlat: number;
  readonly lowHealthHealFlat: number;
  readonly shieldFlat: number;
  readonly notes: readonly string[];
  readonly triggeredItemInstanceIds: readonly string[];
}

export type BackpackCombatTriggerCategoryV1 = "passive" | "battleStart" | "lowHealth";

interface BackpackCombatEffectContributionV1 {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly trigger: BackpackCombatTriggerCategoryV1;
  readonly note: string;
  readonly maxHealthFlat?: number;
  readonly attackFlat?: number;
  readonly defenseFlat?: number;
  readonly speedFlat?: number;
  readonly critBpsFlat?: number;
  readonly dodgeBpsFlat?: number;
  readonly battleStartDamageFlat?: number;
  readonly lowHealthHealFlat?: number;
  readonly shieldFlat?: number;
}

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

export function validateBackpackSnapshot(backpack: BackpackSnapshotV1): void {
  if (backpack.version !== 1) {
    throw new RangeError("BackpackSnapshotV1.version must be 1.");
  }
  assertNonEmptyString(backpack.backpackHash, "backpack.backpackHash");
  validateLayoutShape(backpack.layout);

  const inventoryIds = new Set<string>();
  for (const item of backpack.inventory) {
    assertNonEmptyString(item.instanceId, "backpack.inventory.instanceId");
    assertNonEmptyString(item.definitionId, "backpack.inventory.definitionId");
    assertNonEmptyString(item.sourceKind, "backpack.inventory.sourceKind");
    assertNonEmptyString(item.sourceRef, "backpack.inventory.sourceRef");
    assertNonNegativeInteger(item.acquiredAt, "backpack.inventory.acquiredAt");
    if (inventoryIds.has(item.instanceId)) {
      throw new RangeError(`Duplicate backpack inventory item: ${item.instanceId}`);
    }
    inventoryIds.add(item.instanceId);
  }

  const definitionIds = new Set<string>();
  for (const definition of backpack.itemDefinitions) {
    assertNonEmptyString(definition.id, "backpack.itemDefinitions.id");
    assertNonEmptyString(definition.name, "backpack.itemDefinitions.name");
    assertNonEmptyString(definition.kind, "backpack.itemDefinitions.kind");
    assertPositiveInteger(definition.size.width, "backpack.itemDefinitions.size.width");
    assertPositiveInteger(definition.size.height, "backpack.itemDefinitions.size.height");
    for (const effect of definition.effects) {
      assertNonEmptyString(effect.description, "backpack.itemDefinitions.effects.description");
    }
    if (definitionIds.has(definition.id)) {
      throw new RangeError(`Duplicate backpack item definition: ${definition.id}`);
    }
    definitionIds.add(definition.id);
  }

  const placedIds = new Set<string>();
  for (const item of backpack.layout.placedItems) {
    assertNonEmptyString(item.instanceId, "backpack.layout.placedItems.instanceId");
    assertNonEmptyString(item.definitionId, "backpack.layout.placedItems.definitionId");
    assertNonNegativeInteger(item.x, "backpack.layout.placedItems.x");
    assertNonNegativeInteger(item.y, "backpack.layout.placedItems.y");
    if (typeof item.rotated !== "boolean") {
      throw new TypeError("backpack.layout.placedItems.rotated must be a boolean.");
    }
    if (placedIds.has(item.instanceId)) {
      throw new RangeError(`Duplicate placed backpack item: ${item.instanceId}`);
    }
    placedIds.add(item.instanceId);

    const instance = backpack.inventory.find(
      (candidate) => candidate.instanceId === item.instanceId
    );
    if (!instance) {
      throw new RangeError(`Placed backpack item is not in inventory: ${item.instanceId}`);
    }
    if (instance.definitionId !== item.definitionId) {
      throw new RangeError(`Placed backpack item definition mismatch: ${item.instanceId}`);
    }
    if (!findDefinition(backpack.itemDefinitions, item.definitionId)) {
      throw new RangeError(`Unknown placed backpack item definition: ${item.definitionId}`);
    }

    const layoutWithoutItem = {
      ...backpack.layout,
      placedItems: backpack.layout.placedItems.filter(
        (candidate) => candidate.instanceId !== item.instanceId
      )
    };
    if (!canPlaceItem(layoutWithoutItem, item, backpack.itemDefinitions)) {
      throw new RangeError(`Invalid backpack item placement: ${item.instanceId}`);
    }
  }
}

export function computeBackpackStatBonuses(
  layout: BackpackLayoutV1,
  inventory: readonly BackpackItemInstanceV1[],
  definitions: BackpackDefinitionLookup
): BackpackStatBonusesV1 {
  const placed = placedItemsWithDefinitions(layout, inventory, definitions);
  const summary = summarizeBackpackCombatEffects(placed);

  return {
    attack: summary.attackFlat,
    critBps: summary.critBpsFlat,
    defense: summary.defenseFlat,
    dodgeBps: summary.dodgeBpsFlat,
    maxHealth: summary.maxHealthFlat,
    speed: summary.speedFlat
  };
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

export function computeBackpackCombatEffects(
  backpack: BackpackSnapshotV1
): BackpackCombatEffectSummaryV1 {
  validateBackpackSnapshot(backpack);

  return summarizeBackpackCombatEffects(
    placedItemsWithDefinitions(backpack.layout, backpack.inventory, backpack.itemDefinitions)
  );
}

export function applyBackpackCombatEffects(
  stats: BattleCombatantStatsV1,
  effects: BackpackCombatEffectSummaryV1
): BattleCombatantStatsV1 {
  return {
    attack: Math.max(1, stats.attack + effects.attackFlat),
    critBps: clampBps(stats.critBps + effects.critBpsFlat),
    defense: Math.max(0, stats.defense + effects.defenseFlat),
    dodgeBps: clampBps(stats.dodgeBps + effects.dodgeBpsFlat),
    maxHealth: Math.max(1, stats.maxHealth + effects.maxHealthFlat),
    speed: Math.max(1, stats.speed + effects.speedFlat)
  };
}

export function collectBackpackCombatTriggerNotes(
  backpack: BackpackSnapshotV1 | undefined,
  trigger: BackpackCombatTriggerCategoryV1
): readonly string[] {
  if (backpack === undefined) {
    return [];
  }

  validateBackpackSnapshot(backpack);

  return combatEffectContributions(
    placedItemsWithDefinitions(backpack.layout, backpack.inventory, backpack.itemDefinitions)
  )
    .filter((contribution) => contribution.trigger === trigger)
    .map((contribution) => contribution.note);
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

function summarizeBackpackCombatEffects(
  placed: readonly {
    readonly placed: PlacedBackpackItemV1;
    readonly instance: BackpackItemInstanceV1;
    readonly definition: BackpackItemDefinitionV1;
  }[]
): BackpackCombatEffectSummaryV1 {
  const totals = mutableCombatEffects();
  const notes: string[] = [];
  const triggeredItemInstanceIds = new Set<string>();

  for (const contribution of combatEffectContributions(placed)) {
    totals.maxHealthFlat += contribution.maxHealthFlat ?? 0;
    totals.attackFlat += contribution.attackFlat ?? 0;
    totals.defenseFlat += contribution.defenseFlat ?? 0;
    totals.speedFlat += contribution.speedFlat ?? 0;
    totals.critBpsFlat += contribution.critBpsFlat ?? 0;
    totals.dodgeBpsFlat += contribution.dodgeBpsFlat ?? 0;
    totals.battleStartDamageFlat += contribution.battleStartDamageFlat ?? 0;
    totals.lowHealthHealFlat += contribution.lowHealthHealFlat ?? 0;
    totals.shieldFlat += contribution.shieldFlat ?? 0;
    notes.push(contribution.note);
    triggeredItemInstanceIds.add(contribution.instanceId);
  }

  return {
    attackFlat: totals.attackFlat,
    battleStartDamageFlat: totals.battleStartDamageFlat,
    critBpsFlat: totals.critBpsFlat,
    defenseFlat: totals.defenseFlat,
    dodgeBpsFlat: totals.dodgeBpsFlat,
    lowHealthHealFlat: totals.lowHealthHealFlat,
    maxHealthFlat: totals.maxHealthFlat,
    notes,
    shieldFlat: totals.shieldFlat,
    speedFlat: totals.speedFlat,
    triggeredItemInstanceIds: [...triggeredItemInstanceIds].sort()
  };
}

function combatEffectContributions(
  placed: readonly {
    readonly placed: PlacedBackpackItemV1;
    readonly instance: BackpackItemInstanceV1;
    readonly definition: BackpackItemDefinitionV1;
  }[]
): readonly BackpackCombatEffectContributionV1[] {
  const contributions: BackpackCombatEffectContributionV1[] = [];

  for (const item of placed) {
    for (const effect of item.definition.effects) {
      if (effect.flat === undefined) {
        continue;
      }

      if (effect.stat !== undefined && isFlatStatCombatEffect(item.definition, effect)) {
        contributions.push({
          ...flatStatContribution(effect.stat, effect.flat),
          definitionId: item.definition.id,
          instanceId: item.instance.instanceId,
          note: `${item.definition.name}: ${effect.description}`,
          shieldFlat: item.definition.kind === "ward" && effect.stat === "defense" ? effect.flat : 0,
          trigger: item.definition.kind === "ward" ? "battleStart" : "passive"
        });
        continue;
      }

      if (item.definition.kind === "bomb" && isBombDamageEffect(effect)) {
        contributions.push({
          battleStartDamageFlat: effect.flat,
          definitionId: item.definition.id,
          instanceId: item.instance.instanceId,
          note: `${item.definition.name}: ${effect.description}`,
          trigger: "battleStart"
        });
        continue;
      }

      if (item.definition.kind === "potion" && effect.trigger === "lowHealth") {
        contributions.push({
          definitionId: item.definition.id,
          instanceId: item.instance.instanceId,
          lowHealthHealFlat: effect.flat,
          note: `${item.definition.name}: ${effect.description}`,
          trigger: "lowHealth"
        });
      }
    }
  }

  for (const item of placed) {
    if (isRubyDefinition(item.definition) && hasAdjacentKind(item, placed, "weapon")) {
      contributions.push({
        attackFlat: 1,
        definitionId: item.definition.id,
        instanceId: item.instance.instanceId,
        note: `${item.definition.name}: adjacent weapon attack +1.`,
        trigger: "passive"
      });
    }

    if (item.definition.kind === "charm" && hasAdjacentKind(item, placed, "gem")) {
      contributions.push({
        critBpsFlat: 100,
        definitionId: item.definition.id,
        instanceId: item.instance.instanceId,
        note: `${item.definition.name}: adjacent gem critical chance +100 bps.`,
        trigger: "passive"
      });
    }

    if (item.definition.kind === "ward" && hasAdjacentKind(item, placed, "armor")) {
      contributions.push({
        defenseFlat: 1,
        definitionId: item.definition.id,
        instanceId: item.instance.instanceId,
        note: `${item.definition.name}: adjacent armor defense +1.`,
        trigger: "passive"
      });
    }
  }

  return contributions;
}

function mutableCombatEffects(): {
  maxHealthFlat: number;
  attackFlat: number;
  defenseFlat: number;
  speedFlat: number;
  critBpsFlat: number;
  dodgeBpsFlat: number;
  battleStartDamageFlat: number;
  lowHealthHealFlat: number;
  shieldFlat: number;
} {
  return {
    attackFlat: 0,
    battleStartDamageFlat: 0,
    critBpsFlat: 0,
    defenseFlat: 0,
    dodgeBpsFlat: 0,
    lowHealthHealFlat: 0,
    maxHealthFlat: 0,
    shieldFlat: 0,
    speedFlat: 0
  };
}

function flatStatContribution(
  stat: BackpackStatKey,
  flat: number
): Pick<
  BackpackCombatEffectContributionV1,
  "attackFlat" | "critBpsFlat" | "defenseFlat" | "dodgeBpsFlat" | "maxHealthFlat" | "speedFlat"
> {
  if (stat === "attack") return { attackFlat: flat };
  if (stat === "critBps") return { critBpsFlat: flat };
  if (stat === "defense") return { defenseFlat: flat };
  if (stat === "dodgeBps") return { dodgeBpsFlat: flat };
  if (stat === "maxHealth") return { maxHealthFlat: flat };
  return { speedFlat: flat };
}

function isFlatStatCombatEffect(
  definition: BackpackItemDefinitionV1,
  effect: BackpackItemEffectV1
): boolean {
  return (
    effect.flat !== undefined &&
    effect.stat !== undefined &&
    (effect.trigger === undefined ||
      effect.trigger === "passive" ||
      (definition.kind === "ward" && effect.trigger === "battleStart"))
  );
}

function isBombDamageEffect(effect: BackpackItemEffectV1): boolean {
  return (
    effect.flat !== undefined &&
    effect.stat === undefined &&
    (effect.trigger === "battleStart" || effect.trigger === "turnStart")
  );
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

function isRubyDefinition(definition: BackpackItemDefinitionV1): boolean {
  return definition.kind === "gem" && definition.tags.includes("ruby");
}

function hasAdjacentKind(
  item: {
    readonly placed: PlacedBackpackItemV1;
    readonly definition: BackpackItemDefinitionV1;
  },
  placedItems: readonly {
    readonly placed: PlacedBackpackItemV1;
    readonly definition: BackpackItemDefinitionV1;
  }[],
  kind: BackpackItemDefinitionV1["kind"]
): boolean {
  return placedItems.some(
    (candidate) =>
      candidate.placed.instanceId !== item.placed.instanceId &&
      candidate.definition.kind === kind &&
      areAdjacent(item.placed, item.definition, candidate.placed, candidate.definition)
  );
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

function validateLayoutShape(layout: BackpackLayoutV1): void {
  if (layout.version !== 1) {
    throw new RangeError("BackpackLayoutV1.version must be 1.");
  }
  assertPositiveInteger(layout.width, "backpack.layout.width");
  assertPositiveInteger(layout.height, "backpack.layout.height");
}

function assertNonEmptyString(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }

  return value;
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }

  return value;
}

function assertNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }

  return value;
}

function clampBps(value: number): number {
  return Math.max(0, Math.min(10_000, value));
}
