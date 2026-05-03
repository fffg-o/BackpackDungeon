import type {
  BackpackItemDefinitionV1,
  BackpackItemInstanceV1,
  BackpackItemSizeV1
} from "./backpack-items.js";

export interface PlacedBackpackItemV1 {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly x: number;
  readonly y: number;
  readonly rotated: boolean;
}

export interface BackpackLayoutV1 {
  readonly version: 1;
  readonly width: number;
  readonly height: number;
  readonly placedItems: readonly PlacedBackpackItemV1[];
}

export type BackpackDefinitionLookup =
  | readonly BackpackItemDefinitionV1[]
  | Readonly<Record<string, BackpackItemDefinitionV1>>;

export type BackpackPlaceableItem =
  | BackpackItemInstanceV1
  | Pick<PlacedBackpackItemV1, "instanceId" | "definitionId">;

export interface BackpackItemPosition {
  readonly x: number;
  readonly y: number;
}

const ITEM_KIND_PRIORITY: Readonly<Record<BackpackItemDefinitionV1["kind"], number>> =
  Object.freeze({
    weapon: 0,
    armor: 1,
    gem: 2,
    charm: 3,
    ward: 4,
    bomb: 5,
    potion: 6,
    food: 7,
    key: 8
  });

export function getItemSize(
  definition: BackpackItemDefinitionV1,
  rotated: boolean
): BackpackItemSizeV1 {
  assertPositiveInteger(definition.size.width, "definition.size.width");
  assertPositiveInteger(definition.size.height, "definition.size.height");

  return rotated
    ? {
        width: definition.size.height,
        height: definition.size.width
      }
    : definition.size;
}

export function canPlaceItem(
  layout: BackpackLayoutV1,
  placedItem: PlacedBackpackItemV1,
  definitions: BackpackDefinitionLookup
): boolean {
  validateLayoutShape(layout);
  if (!isNonNegativeInteger(placedItem.x) || !isNonNegativeInteger(placedItem.y)) {
    return false;
  }

  const definition = findDefinition(definitions, placedItem.definitionId);
  if (!definition) {
    return false;
  }

  const size = getItemSize(definition, placedItem.rotated);
  if (placedItem.x + size.width > layout.width || placedItem.y + size.height > layout.height) {
    return false;
  }

  const occupied = occupiedCells(layout, definitions, placedItem.instanceId);
  for (const cell of cellsFor(placedItem, size)) {
    if (occupied.has(cell)) {
      return false;
    }
  }

  return true;
}

export function placeItem(
  layout: BackpackLayoutV1,
  item: BackpackPlaceableItem,
  position: BackpackItemPosition,
  rotated: boolean,
  definitions: BackpackDefinitionLookup
): BackpackLayoutV1 {
  validateLayoutShape(layout);
  const placedItem: PlacedBackpackItemV1 = {
    definitionId: assertNonEmptyString(item.definitionId, "item.definitionId"),
    instanceId: assertNonEmptyString(item.instanceId, "item.instanceId"),
    rotated,
    x: assertNonNegativeInteger(position.x, "position.x"),
    y: assertNonNegativeInteger(position.y, "position.y")
  };

  const withoutExisting = removeItem(layout, placedItem.instanceId);
  if (!canPlaceItem(withoutExisting, placedItem, definitions)) {
    throw new RangeError(`Cannot place backpack item ${placedItem.instanceId} at ${position.x},${position.y}.`);
  }

  return {
    ...withoutExisting,
    placedItems: [...withoutExisting.placedItems, placedItem]
  };
}

export function removeItem(layout: BackpackLayoutV1, instanceId: string): BackpackLayoutV1 {
  validateLayoutShape(layout);
  const normalizedInstanceId = assertNonEmptyString(instanceId, "instanceId");

  return {
    ...layout,
    placedItems: layout.placedItems.filter((item) => item.instanceId !== normalizedInstanceId)
  };
}

export function rotatePlacedItem(
  layout: BackpackLayoutV1,
  instanceId: string,
  definitions: BackpackDefinitionLookup
): BackpackLayoutV1 {
  validateLayoutShape(layout);
  const normalizedInstanceId = assertNonEmptyString(instanceId, "instanceId");
  const current = layout.placedItems.find((item) => item.instanceId === normalizedInstanceId);
  if (!current) {
    throw new RangeError(`Backpack item is not placed: ${instanceId}`);
  }

  const rotatedItem = {
    ...current,
    rotated: !current.rotated
  };
  if (!canPlaceItem(layout, rotatedItem, definitions)) {
    throw new RangeError(`Cannot rotate backpack item ${instanceId} in its current position.`);
  }

  return {
    ...layout,
    placedItems: layout.placedItems.map((item) =>
      item.instanceId === normalizedInstanceId ? rotatedItem : item
    )
  };
}

export function autoPackItems(
  inventory: readonly BackpackItemInstanceV1[],
  definitions: BackpackDefinitionLookup,
  width: number,
  height: number
): BackpackLayoutV1 {
  const layout: BackpackLayoutV1 = {
    height: assertPositiveInteger(height, "height"),
    placedItems: [],
    version: 1,
    width: assertPositiveInteger(width, "width")
  };

  const sortedItems = [...inventory].sort((a, b) => {
    const definitionA = requireDefinition(definitions, a.definitionId);
    const definitionB = requireDefinition(definitions, b.definitionId);
    const priorityDelta = itemPriority(definitionA) - itemPriority(definitionB);
    if (priorityDelta !== 0) return priorityDelta;

    const areaDelta = itemArea(definitionB) - itemArea(definitionA);
    if (areaDelta !== 0) return areaDelta;

    return a.instanceId.localeCompare(b.instanceId);
  });

  return sortedItems.reduce((currentLayout, item) => {
    const definition = requireDefinition(definitions, item.definitionId);
    const rotations = definition.size.width === definition.size.height ? [false] : [false, true];

    for (const rotated of rotations) {
      for (let y = 0; y < currentLayout.height; y += 1) {
        for (let x = 0; x < currentLayout.width; x += 1) {
          const candidate: PlacedBackpackItemV1 = {
            definitionId: item.definitionId,
            instanceId: item.instanceId,
            rotated,
            x,
            y
          };
          if (canPlaceItem(currentLayout, candidate, definitions)) {
            return {
              ...currentLayout,
              placedItems: [...currentLayout.placedItems, candidate]
            };
          }
        }
      }
    }

    return currentLayout;
  }, layout);
}

function itemPriority(definition: BackpackItemDefinitionV1): number {
  return ITEM_KIND_PRIORITY[definition.kind];
}

function itemArea(definition: BackpackItemDefinitionV1): number {
  return definition.size.width * definition.size.height;
}

function occupiedCells(
  layout: BackpackLayoutV1,
  definitions: BackpackDefinitionLookup,
  ignoredInstanceId?: string
): Set<string> {
  const occupied = new Set<string>();
  for (const item of layout.placedItems) {
    if (item.instanceId === ignoredInstanceId) {
      continue;
    }

    const definition = findDefinition(definitions, item.definitionId);
    if (!definition) {
      continue;
    }

    for (const cell of cellsFor(item, getItemSize(definition, item.rotated))) {
      occupied.add(cell);
    }
  }

  return occupied;
}

function cellsFor(
  item: PlacedBackpackItemV1,
  size: BackpackItemSizeV1
): readonly string[] {
  const cells: string[] = [];
  for (let y = item.y; y < item.y + size.height; y += 1) {
    for (let x = item.x; x < item.x + size.width; x += 1) {
      cells.push(`${x},${y}`);
    }
  }

  return cells;
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

function requireDefinition(
  definitions: BackpackDefinitionLookup,
  definitionId: string
): BackpackItemDefinitionV1 {
  const definition = findDefinition(definitions, definitionId);
  if (!definition) {
    throw new RangeError(`Unknown backpack item definition: ${definitionId}`);
  }

  return definition;
}

function validateLayoutShape(layout: BackpackLayoutV1): void {
  if (layout.version !== 1) {
    throw new RangeError("Backpack layout version must be 1.");
  }
  assertPositiveInteger(layout.width, "layout.width");
  assertPositiveInteger(layout.height, "layout.height");
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
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
  if (!isNonNegativeInteger(value)) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }

  return value;
}
