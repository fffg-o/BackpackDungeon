"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getBackpackItemDefinition,
  getItemSize,
  type BackpackItemInstanceV1,
  type BackpackLayoutV1,
} from "@backpack-dungeon/game-core";
import type { BackpackPlacementPreview } from "./BackpackGrid";

export interface UseBackpackBuilderOptions {
  readonly layout: BackpackLayoutV1;
  readonly inventory: readonly BackpackItemInstanceV1[];
  readonly onMoveItem: (instanceId: string, x: number, y: number, rotated?: boolean) => void;
  readonly onRotateItem: (instanceId: string) => void;
  readonly keyboardEnabled?: boolean;
}

export function useBackpackBuilder({
  layout,
  inventory,
  onMoveItem,
  onRotateItem,
  keyboardEnabled = true,
}: UseBackpackBuilderOptions) {
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    inventory[0]?.instanceId ?? null,
  );
  const [hoveredCell, setHoveredCell] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [draftRotations, setDraftRotations] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const selectedPlaced = layout.placedItems.find(
    (item) => item.instanceId === selectedInstanceId,
  );
  const selectedItem = inventory.find((item) => item.instanceId === selectedInstanceId) ?? null;
  const selectedRotated =
    selectedInstanceId === null
      ? false
      : draftRotations.get(selectedInstanceId) ?? selectedPlaced?.rotated ?? false;
  const selectedDefinition = selectedItem ? getDefinitionSafe(selectedItem.definitionId) : null;
  const selectedCanRotate = selectedDefinition
    ? selectedDefinition.size.width !== selectedDefinition.size.height
    : false;
  const rotatedByInstanceId = useMemo(
    () =>
      new Map(
        inventory.map((item) => {
          const placed = layout.placedItems.find(
            (candidate) => candidate.instanceId === item.instanceId,
          );
          return [item.instanceId, draftRotations.get(item.instanceId) ?? placed?.rotated ?? false];
        }),
      ),
    [draftRotations, inventory, layout.placedItems],
  );
  const preview = useMemo(
    () =>
      hoveredCell && selectedItem
        ? placementPreview(layout, selectedItem, hoveredCell.x, hoveredCell.y, selectedRotated)
        : null,
    [hoveredCell, layout, selectedItem, selectedRotated],
  );
  const backpackFull = useMemo(
    () => inventory.some((item) => !isPlaced(layout, item.instanceId)) && !hasAnyRoom(layout, inventory),
    [inventory, layout],
  );

  useEffect(() => {
    if (selectedInstanceId && inventory.some((item) => item.instanceId === selectedInstanceId)) {
      return;
    }
    setSelectedInstanceId(inventory[0]?.instanceId ?? null);
  }, [inventory, selectedInstanceId]);

  const selectItem = useCallback((instanceId: string) => {
    setSelectedInstanceId(instanceId);
    setFeedback(null);
  }, []);

  const placeSelectedItem = useCallback(
    (x: number, y: number, droppedInstanceId?: string | null) => {
      const instanceId = droppedInstanceId ?? selectedInstanceId;
      if (!instanceId) {
        setFeedback("Select an item first");
        return;
      }

      const item = inventory.find((candidate) => candidate.instanceId === instanceId);
      if (!item) return;

      const placed = layout.placedItems.find((candidate) => candidate.instanceId === instanceId);
      const rotated = draftRotations.get(instanceId) ?? placed?.rotated ?? false;
      const nextPreview = placementPreview(layout, item, x, y, rotated);
      setSelectedInstanceId(instanceId);
      setHoveredCell({ x, y });

      if (!nextPreview.valid) {
        setFeedback(nextPreview.reason ?? "No room here");
        return;
      }

      onMoveItem(instanceId, x, y, rotated);
      setFeedback(null);
    },
    [draftRotations, inventory, layout, onMoveItem, selectedInstanceId],
  );

  const rotateSelected = useCallback(() => {
    if (!selectedItem || !selectedInstanceId || !selectedCanRotate) return;
    const nextRotated = !selectedRotated;

    if (selectedPlaced) {
      const nextPreview = placementPreview(
        layout,
        selectedItem,
        selectedPlaced.x,
        selectedPlaced.y,
        nextRotated,
      );
      if (!nextPreview.valid) {
        setFeedback(nextPreview.reason ?? "No room here");
        return;
      }
      onRotateItem(selectedInstanceId);
      setFeedback(null);
      return;
    }

    setDraftRotations((current) => new Map(current).set(selectedInstanceId, nextRotated));
    setFeedback(null);
  }, [
    layout,
    onRotateItem,
    selectedCanRotate,
    selectedInstanceId,
    selectedItem,
    selectedPlaced,
    selectedRotated,
  ]);

  useEffect(() => {
    if (!keyboardEnabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "r") return;
      if (event.target instanceof HTMLElement && isTextInput(event.target)) return;
      event.preventDefault();
      rotateSelected();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keyboardEnabled, rotateSelected]);

  return {
    backpackFull,
    feedback,
    placeSelectedItem,
    preview,
    rotatedByInstanceId,
    rotateSelected,
    selectItem,
    selectedCanRotate,
    selectedInstanceId,
    selectedItem,
    selectedRotated,
    setHoveredCell,
  };
}

function placementPreview(
  layout: BackpackLayoutV1,
  item: BackpackItemInstanceV1,
  x: number,
  y: number,
  rotated: boolean,
): BackpackPlacementPreview {
  const definition = getDefinitionSafe(item.definitionId);
  if (!definition) {
    return { height: 1, reason: "Unknown item", valid: false, width: 1, x, y };
  }
  const size = getItemSize(definition, rotated);
  if (x + size.width > layout.width || y + size.height > layout.height) {
    return { ...size, reason: "No room here", valid: false, x, y };
  }
  if (overlapsExisting(layout, item.instanceId, x, y, size.width, size.height)) {
    return { ...size, reason: "Slot occupied", valid: false, x, y };
  }
  return { ...size, valid: true, x, y };
}

function overlapsExisting(
  layout: BackpackLayoutV1,
  ignoredInstanceId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const occupied = new Set<string>();
  for (const placed of layout.placedItems) {
    if (placed.instanceId === ignoredInstanceId) continue;
    const definition = getDefinitionSafe(placed.definitionId);
    if (!definition) continue;
    const size = getItemSize(definition, placed.rotated);
    for (let cellY = placed.y; cellY < placed.y + size.height; cellY += 1) {
      for (let cellX = placed.x; cellX < placed.x + size.width; cellX += 1) {
        occupied.add(`${cellX},${cellY}`);
      }
    }
  }

  for (let cellY = y; cellY < y + height; cellY += 1) {
    for (let cellX = x; cellX < x + width; cellX += 1) {
      if (occupied.has(`${cellX},${cellY}`)) return true;
    }
  }

  return false;
}

function hasAnyRoom(
  layout: BackpackLayoutV1,
  inventory: readonly BackpackItemInstanceV1[],
): boolean {
  return inventory
    .filter((item) => !isPlaced(layout, item.instanceId))
    .some((item) => {
      const definition = getDefinitionSafe(item.definitionId);
      if (!definition) return false;
      const rotations = definition.size.width === definition.size.height ? [false] : [false, true];
      return rotations.some((rotated) => {
        for (let y = 0; y < layout.height; y += 1) {
          for (let x = 0; x < layout.width; x += 1) {
            if (placementPreview(layout, item, x, y, rotated).valid) return true;
          }
        }
        return false;
      });
    });
}

function isPlaced(layout: BackpackLayoutV1, instanceId: string): boolean {
  return layout.placedItems.some((item) => item.instanceId === instanceId);
}

function getDefinitionSafe(definitionId: string) {
  try {
    return getBackpackItemDefinition(definitionId);
  } catch {
    return null;
  }
}

function isTextInput(element: HTMLElement): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable
  );
}
