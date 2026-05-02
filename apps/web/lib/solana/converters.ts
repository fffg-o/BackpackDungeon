import type { DailyLocationSpec } from "@backpack-dungeon/game-core";
import type { LocationProofStep } from "@backpack-dungeon/game-core";
import type { ShopItemSlot } from "@backpack-dungeon/shared";
import BN from "bn.js";
import { sha256Bytes32 } from "./pdas";

type AnchorEnum = Readonly<Record<string, Readonly<Record<string, never>>>>;

export interface AnchorProofStep {
  readonly sibling: readonly number[];
  readonly position: AnchorEnum;
}

export interface AnchorShopItemSlotSpecInput {
  readonly slotId: string;
  readonly itemId: string;
  readonly price: BN;
  readonly baseStock: number;
  readonly maxStock: number;
  readonly restockIntervalSeconds: BN;
  readonly maxRestockCount: number;
  readonly perWalletDailyLimit: number;
  readonly rewardTier: AnchorEnum;
}

export interface AnchorLocationSpecInput {
  readonly dayId: string;
  readonly poiId: string;
  readonly poiIdHash: readonly number[];
  readonly kind: AnchorEnum;
  readonly x: number;
  readonly y: number;
  readonly baseConfigHash: readonly number[];
  readonly enemy: {
    readonly id: string;
    readonly name: string;
    readonly level: number;
    readonly maxHealth: number;
    readonly attack: number;
    readonly rewardTier: AnchorEnum;
  } | null;
  readonly shop: {
    readonly id: string;
    readonly keeperName: string | null;
    readonly itemSlots: readonly AnchorShopItemSlotSpecInput[];
  } | null;
  readonly boss: {
    readonly id: string;
    readonly name: string;
    readonly level: number;
    readonly maxHealth: number;
    readonly attack: number;
    readonly rewardTier: AnchorEnum;
  } | null;
  readonly rewardTier: AnchorEnum | null;
  readonly eventId: string | null;
}

export function hexToBytes32(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/u.test(normalized)) {
    throw new RangeError("hex must be exactly 32 bytes.");
  }

  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function toAnchorProofStep(step: LocationProofStep): AnchorProofStep {
  return {
    sibling: Array.from(hexToBytes32(step.sibling)),
    position: anchorEnum(step.position),
  };
}

export function toAnchorLocationSpec(
  spec: DailyLocationSpec,
  dayId: string,
): AnchorLocationSpecInput {
  return {
    dayId,
    poiId: spec.id,
    poiIdHash: Array.from(sha256Bytes32(spec.id)),
    kind: anchorEnum(spec.kind),
    x: spec.position.x,
    y: spec.position.y,
    baseConfigHash: Array.from(hexToBytes32(spec.baseConfigHash)),
    enemy: spec.enemy
      ? {
          id: spec.enemy.id,
          name: spec.enemy.name,
          level: spec.enemy.level,
          maxHealth: spec.enemy.maxHealth,
          attack: spec.enemy.attack,
          rewardTier: anchorEnum(spec.enemy.rewardTier),
        }
      : null,
    shop: spec.shop
      ? {
          id: spec.shop.id,
          keeperName: spec.shop.keeperName ?? null,
          itemSlots: spec.shop.itemSlots.map(toAnchorShopSlot),
        }
      : null,
    boss: spec.boss
      ? {
          id: spec.boss.id,
          name: spec.boss.name,
          level: spec.boss.level,
          maxHealth: spec.boss.maxHealth,
          attack: spec.boss.attack,
          rewardTier: anchorEnum(spec.boss.rewardTier),
        }
      : null,
    rewardTier: spec.rewardTier ? anchorEnum(spec.rewardTier) : null,
    eventId: spec.eventId ?? null,
  };
}

export function toAnchorShopSlot(slot: ShopItemSlot): AnchorShopItemSlotSpecInput {
  return {
    slotId: slot.slotId,
    itemId: slot.itemId,
    price: new BN(slot.price),
    baseStock: slot.stock,
    maxStock: slot.stock,
    restockIntervalSeconds: new BN(300),
    maxRestockCount: 0,
    perWalletDailyLimit: Math.min(5, slot.stock),
    rewardTier: anchorEnum(slot.rewardTier),
  };
}

function anchorEnum(value: string): AnchorEnum {
  return { [value.toLowerCase()]: {} };
}

