"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BACKPACK_ITEM_DEFINITIONS,
  autoPackItems,
  canPlaceItem,
  createBackpackSnapshot,
  createStarterBackpackItems,
  placeItem,
  removeItem as removeLayoutItem,
  rotatePlacedItem,
  validateBackpackSnapshot,
  type BackpackItemInstanceV1,
  type BackpackItemSourceKind,
  type BackpackLayoutV1,
  type BackpackSnapshotV1,
  type PlacedBackpackItemV1,
} from "@backpack-dungeon/game-core";

export interface BackpackSaveV1 {
  readonly version: 1;
  readonly dayId: string;
  readonly player: string;
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly layout: BackpackLayoutV1;
  readonly updatedAt: number;
}

export interface UseBackpackInventoryResult {
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly layout: BackpackLayoutV1;
  readonly backpackSnapshot: BackpackSnapshotV1;
  readonly addItem: (item: BackpackItemInstanceV1) => void;
  readonly addAndAutoPlaceItem: (item: BackpackItemInstanceV1) => AddAndAutoPlaceResult;
  readonly addItems: (items: readonly BackpackItemInstanceV1[]) => void;
  readonly removeItem: (instanceId: string) => void;
  readonly moveItem: (instanceId: string, x: number, y: number, rotated?: boolean) => void;
  readonly rotateItem: (instanceId: string) => void;
  readonly autoPack: () => void;
  readonly resetBackpack: () => void;
  readonly hasItemSource: (sourceKind: BackpackItemSourceKind, sourceRef: string) => boolean;
}

export interface AddAndAutoPlaceResult {
  readonly added: boolean;
  readonly placed: boolean;
}

const DEFAULT_BACKPACK_WIDTH = 6;
const DEFAULT_BACKPACK_HEIGHT = 5;
const BACKPACK_STORAGE_PREFIX = "packrun:backpack:v1";
const CORRUPT_STORAGE_PREFIX = "packrun:backpack:corrupt";
const MEMORY_SAVES = new Map<string, string>();

export function useBackpackInventory(
  dayId: string,
  playerPubkey: string | null | undefined,
): UseBackpackInventoryResult {
  const [save, setSave] = useState<BackpackSaveV1>(() => createEmptySave(dayId, ""));

  useEffect(() => {
    if (!playerPubkey) {
      setSave(createEmptySave(dayId, ""));
      return;
    }

    setSave(loadBackpackSave(dayId, playerPubkey));
  }, [dayId, playerPubkey]);

  const commitSave = useCallback(
    (update: (current: BackpackSaveV1) => BackpackSaveV1) => {
      if (!playerPubkey) return;

      setSave((current) => {
        const base =
          current.dayId === dayId && current.player === playerPubkey
            ? current
            : loadBackpackSave(dayId, playerPubkey);
        const next = touchSave(update(base));
        persistBackpackSave(next);
        return next;
      });
    },
    [dayId, playerPubkey],
  );

  const addItem = useCallback(
    (item: BackpackItemInstanceV1) => {
      commitSave((current) => {
        const nextInventory = appendUniqueItems(current.inventory, [item]);
        if (nextInventory === current.inventory) return current;
        return { ...current, inventory: nextInventory };
      });
    },
    [commitSave],
  );

  const addAndAutoPlaceItem = useCallback(
    (item: BackpackItemInstanceV1): AddAndAutoPlaceResult => {
      const plannedInventory = appendUniqueItems(save.inventory, [item]);
      const plannedAdded = plannedInventory !== save.inventory;
      const plannedLayout = plannedAdded ? firstFitPlaceItem(save.layout, item) : save.layout;
      const plannedResult: AddAndAutoPlaceResult = {
        added: plannedAdded,
        placed: plannedLayout !== save.layout,
      };

      commitSave((current) => {
        const nextInventory = appendUniqueItems(current.inventory, [item]);
        const added = nextInventory !== current.inventory;
        if (!added) {
          return current;
        }

        const nextLayout = firstFitPlaceItem(current.layout, item);
        return {
          ...current,
          inventory: nextInventory,
          layout: nextLayout,
        };
      });

      return plannedResult;
    },
    [commitSave, save.inventory, save.layout],
  );

  const addItems = useCallback(
    (items: readonly BackpackItemInstanceV1[]) => {
      commitSave((current) => {
        const nextInventory = appendUniqueItems(current.inventory, items);
        if (nextInventory === current.inventory) return current;
        return { ...current, inventory: nextInventory };
      });
    },
    [commitSave],
  );

  const removeItem = useCallback(
    (instanceId: string) => {
      commitSave((current) => ({
        ...current,
        inventory: current.inventory.filter((item) => item.instanceId !== instanceId),
        layout: removeLayoutItem(current.layout, instanceId),
      }));
    },
    [commitSave],
  );

  const moveItem = useCallback(
    (instanceId: string, x: number, y: number, rotated?: boolean) => {
      commitSave((current) => {
        const placedItem = current.layout.placedItems.find((item) => item.instanceId === instanceId);
        const inventoryItem = current.inventory.find((item) => item.instanceId === instanceId);
        if (!inventoryItem && !placedItem) return current;

        try {
          return {
            ...current,
            layout: placeItem(
              current.layout,
              {
                definitionId: placedItem?.definitionId ?? inventoryItem?.definitionId ?? "",
                instanceId,
              },
              { x, y },
              rotated ?? placedItem?.rotated ?? false,
              BACKPACK_ITEM_DEFINITIONS,
            ),
          };
        } catch {
          return current;
        }
      });
    },
    [commitSave],
  );

  const rotateItem = useCallback(
    (instanceId: string) => {
      commitSave((current) => {
        try {
          return {
            ...current,
            layout: rotatePlacedItem(current.layout, instanceId, BACKPACK_ITEM_DEFINITIONS),
          };
        } catch {
          return current;
        }
      });
    },
    [commitSave],
  );

  const autoPack = useCallback(() => {
    commitSave((current) => ({
      ...current,
      layout: autoPackItems(
        current.inventory,
        BACKPACK_ITEM_DEFINITIONS,
        current.layout.width,
        current.layout.height,
      ),
    }));
  }, [commitSave]);

  const resetBackpack = useCallback(() => {
    commitSave((current) => ({
      ...current,
      layout: {
        height: current.layout.height,
        placedItems: [],
        version: 1,
        width: current.layout.width,
      },
    }));
  }, [commitSave]);

  const hasItemSource = useCallback(
    (sourceKind: BackpackItemSourceKind, sourceRef: string) =>
      save.inventory.some((item) => item.sourceKind === sourceKind && item.sourceRef === sourceRef),
    [save.inventory],
  );

  const backpackSnapshot = useMemo(
    () =>
      createBackpackSnapshot({
        inventory: save.inventory,
        itemDefinitions: BACKPACK_ITEM_DEFINITIONS,
        layout: save.layout,
      }),
    [save.inventory, save.layout],
  );

  return {
    inventory: save.inventory,
    layout: save.layout,
    backpackSnapshot,
    addItem,
    addAndAutoPlaceItem,
    addItems,
    removeItem,
    moveItem,
    rotateItem,
    autoPack,
    resetBackpack,
    hasItemSource,
  };
}

function firstFitPlaceItem(
  layout: BackpackLayoutV1,
  item: BackpackItemInstanceV1,
): BackpackLayoutV1 {
  if (layout.placedItems.some((placedItem) => placedItem.instanceId === item.instanceId)) {
    return layout;
  }

  const definition = BACKPACK_ITEM_DEFINITIONS.find(
    (candidate) => candidate.id === item.definitionId,
  );
  if (!definition) return layout;

  const rotations = definition.size.width === definition.size.height ? [false] : [false, true];

  for (const rotated of rotations) {
    for (let y = 0; y < layout.height; y += 1) {
      for (let x = 0; x < layout.width; x += 1) {
        const candidate: PlacedBackpackItemV1 = {
          definitionId: item.definitionId,
          instanceId: item.instanceId,
          rotated,
          x,
          y,
        };

        if (canPlaceItem(layout, candidate, BACKPACK_ITEM_DEFINITIONS)) {
          return {
            ...layout,
            placedItems: [...layout.placedItems, candidate],
          };
        }
      }
    }
  }

  return layout;
}

function appendUniqueItems(
  currentInventory: readonly BackpackItemInstanceV1[],
  items: readonly BackpackItemInstanceV1[],
): readonly BackpackItemInstanceV1[] {
  let changed = false;
  const next = [...currentInventory];

  for (const item of items) {
    if (next.some((existing) => existing.instanceId === item.instanceId)) {
      continue;
    }
    if (
      item.sourceKind === "treasure" &&
      next.some(
        (existing) =>
          existing.sourceKind === "treasure" && existing.sourceRef === item.sourceRef,
      )
    ) {
      continue;
    }

    next.push(item);
    changed = true;
  }

  return changed ? next : currentInventory;
}

function loadBackpackSave(dayId: string, player: string): BackpackSaveV1 {
  const key = backpackStorageKey(dayId, player);
  const raw = readRawSave(key);
  if (!raw) {
    const created = touchSave(createStarterSave(dayId, player));
    persistBackpackSave(created);
    return created;
  }

  try {
    const parsed = parseBackpackSave(JSON.parse(raw), dayId, player);
    return parsed;
  } catch {
    backupCorruptSave(key, raw);
    const rebuilt = touchSave(createStarterSave(dayId, player));
    persistBackpackSave(rebuilt);
    return rebuilt;
  }
}

function persistBackpackSave(save: BackpackSaveV1): void {
  writeRawSave(backpackStorageKey(save.dayId, save.player), JSON.stringify(save));
}

function createStarterSave(dayId: string, player: string): BackpackSaveV1 {
  const inventory = createStarterBackpackItems(dayId, player);
  return {
    version: 1,
    dayId,
    player,
    inventory,
    layout: autoPackItems(
      inventory,
      BACKPACK_ITEM_DEFINITIONS,
      DEFAULT_BACKPACK_WIDTH,
      DEFAULT_BACKPACK_HEIGHT,
    ),
    updatedAt: 0,
  };
}

function createEmptySave(dayId: string, player: string): BackpackSaveV1 {
  return {
    version: 1,
    dayId,
    player,
    inventory: [],
    layout: {
      height: DEFAULT_BACKPACK_HEIGHT,
      placedItems: [],
      version: 1,
      width: DEFAULT_BACKPACK_WIDTH,
    },
    updatedAt: 0,
  };
}

function touchSave(save: BackpackSaveV1): BackpackSaveV1 {
  return {
    ...save,
    updatedAt: Date.now(),
  };
}

function backpackStorageKey(dayId: string, player: string): string {
  return `${BACKPACK_STORAGE_PREFIX}:${dayId}:${player}`;
}

function corruptStorageKey(key: string): string {
  return key.replace(BACKPACK_STORAGE_PREFIX, CORRUPT_STORAGE_PREFIX);
}

function readRawSave(key: string): string | null {
  const storage = getStorage();
  if (storage) {
    try {
      return storage.getItem(key);
    } catch {
      return MEMORY_SAVES.get(key) ?? null;
    }
  }

  return MEMORY_SAVES.get(key) ?? null;
}

function writeRawSave(key: string, value: string): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(key, value);
      return;
    } catch {
      // Fall back to memory below.
    }
  }

  MEMORY_SAVES.set(key, value);
}

function backupCorruptSave(key: string, value: string): void {
  writeRawSave(`${corruptStorageKey(key)}:${Date.now()}`, value);
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    const storage = window.localStorage;
    const probeKey = "packrun:backpack:probe";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

function parseBackpackSave(value: unknown, dayId: string, player: string): BackpackSaveV1 {
  if (!isRecord(value)) throw new TypeError("Backpack save must be an object.");
  if (value.version !== 1) throw new TypeError("Backpack save version must be 1.");
  if (value.dayId !== dayId || value.player !== player) {
    throw new TypeError("Backpack save is for a different day or player.");
  }
  if (!Array.isArray(value.inventory)) throw new TypeError("Backpack inventory must be an array.");
  if (!isBackpackLayout(value.layout)) throw new TypeError("Backpack layout is invalid.");
  if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) {
    throw new TypeError("Backpack updatedAt is invalid.");
  }

  const inventory = value.inventory.map(parseBackpackItemInstance);
  const layout = value.layout;
  validateBackpackSnapshot(
    createBackpackSnapshot({
      inventory,
      itemDefinitions: BACKPACK_ITEM_DEFINITIONS,
      layout,
    }),
  );

  return {
    version: 1,
    dayId,
    player,
    inventory,
    layout,
    updatedAt: value.updatedAt,
  };
}

function parseBackpackItemInstance(value: unknown): BackpackItemInstanceV1 {
  if (!isRecord(value)) throw new TypeError("Backpack item must be an object.");
  if (typeof value.instanceId !== "string" || value.instanceId.length === 0) {
    throw new TypeError("Backpack item instanceId is invalid.");
  }
  if (typeof value.definitionId !== "string" || value.definitionId.length === 0) {
    throw new TypeError("Backpack item definitionId is invalid.");
  }
  if (typeof value.sourceKind !== "string" || value.sourceKind.length === 0) {
    throw new TypeError("Backpack item sourceKind is invalid.");
  }
  if (typeof value.sourceRef !== "string" || value.sourceRef.length === 0) {
    throw new TypeError("Backpack item sourceRef is invalid.");
  }
  if (
    typeof value.acquiredAt !== "number" ||
    !Number.isSafeInteger(value.acquiredAt) ||
    value.acquiredAt < 0
  ) {
    throw new TypeError("Backpack item acquiredAt is invalid.");
  }

  return {
    acquiredAt: value.acquiredAt,
    definitionId: value.definitionId,
    instanceId: value.instanceId,
    sourceKind: value.sourceKind as BackpackItemSourceKind,
    sourceRef: value.sourceRef,
  };
}

function isBackpackLayout(value: unknown): value is BackpackLayoutV1 {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.width !== "number" || !Number.isSafeInteger(value.width) || value.width <= 0) {
    return false;
  }
  if (
    typeof value.height !== "number" ||
    !Number.isSafeInteger(value.height) ||
    value.height <= 0
  ) {
    return false;
  }
  if (!Array.isArray(value.placedItems)) return false;

  return value.placedItems.every(
    (item) =>
      isRecord(item) &&
      typeof item.instanceId === "string" &&
      item.instanceId.length > 0 &&
      typeof item.definitionId === "string" &&
      item.definitionId.length > 0 &&
      typeof item.x === "number" &&
      Number.isSafeInteger(item.x) &&
      item.x >= 0 &&
      typeof item.y === "number" &&
      Number.isSafeInteger(item.y) &&
      item.y >= 0 &&
      typeof item.rotated === "boolean",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
