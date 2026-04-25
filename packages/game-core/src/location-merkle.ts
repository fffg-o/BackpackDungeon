import type { CanonicalJsonValue, LocationSpec } from "@backpack-dungeon/shared";
import { hashCanonicalJson } from "@backpack-dungeon/shared";

export type Bytes32 = string;

export interface MerkleLocationSpec extends LocationSpec {
  readonly baseConfigHash?: string;
}

export interface LocationMerkleTree {
  readonly root: Bytes32;
  readonly leaves: readonly Bytes32[];
}

export interface LocationProofStep {
  readonly sibling: Bytes32;
  readonly position: "left" | "right";
}

export type LocationMerkleProof = readonly LocationProofStep[];

const EMPTY_LOCATION_TREE_ROOT = hashCanonicalJson({
  domain: "location-merkle-empty-tree",
  version: 1
});

export function locationLeafHash(spec: MerkleLocationSpec): Bytes32 {
  return hashCanonicalJson({
    domain: "location-merkle-leaf",
    spec: locationSpecToCanonicalValue(spec),
    version: 1
  });
}

export function buildLocationMerkleTree(
  specs: readonly MerkleLocationSpec[]
): LocationMerkleTree {
  const leaves = specs.map((spec) => locationLeafHash(spec));

  return {
    leaves,
    root: merkleRootFromLeaves(leaves)
  };
}

export function getLocationProof(
  specs: readonly MerkleLocationSpec[],
  poiId: string
): LocationMerkleProof {
  const leafIndex = findLocationIndex(specs, poiId);
  const leaves = specs.map((spec) => locationLeafHash(spec));
  const proof: LocationProofStep[] = [];
  let level = leaves;
  let index = leafIndex;

  while (level.length > 1) {
    const isRightNode = index % 2 === 1;
    const siblingIndex = isRightNode ? index - 1 : index + 1;

    if (siblingIndex < level.length) {
      proof.push({
        position: isRightNode ? "left" : "right",
        sibling: level[siblingIndex]
      });
    }

    level = nextMerkleLevel(level);
    index = Math.floor(index / 2);
  }

  return proof;
}

export function verifyLocationProof(
  root: Bytes32,
  spec: MerkleLocationSpec,
  proof: LocationMerkleProof
): boolean {
  if (!isBytes32(root)) {
    return false;
  }

  let computed = locationLeafHash(spec);

  for (const step of proof) {
    if (!isBytes32(step.sibling)) {
      return false;
    }

    if (step.position === "left") {
      computed = parentHash(step.sibling, computed);
    } else if (step.position === "right") {
      computed = parentHash(computed, step.sibling);
    } else {
      return false;
    }
  }

  return computed === root;
}

function merkleRootFromLeaves(leaves: readonly Bytes32[]): Bytes32 {
  if (leaves.length === 0) {
    return EMPTY_LOCATION_TREE_ROOT;
  }

  let level = [...leaves];
  while (level.length > 1) {
    level = nextMerkleLevel(level);
  }

  return level[0];
}

function nextMerkleLevel(level: readonly Bytes32[]): Bytes32[] {
  const next: Bytes32[] = [];

  for (let index = 0; index < level.length; index += 2) {
    const left = level[index];
    const right = level[index + 1];
    next.push(right === undefined ? left : parentHash(left, right));
  }

  return next;
}

function parentHash(left: Bytes32, right: Bytes32): Bytes32 {
  return hashCanonicalJson({
    domain: "location-merkle-node",
    left,
    right,
    version: 1
  });
}

function findLocationIndex(specs: readonly MerkleLocationSpec[], poiId: string): number {
  const matches = specs
    .map((spec, index) => ({ index, spec }))
    .filter((entry) => entry.spec.id === poiId);

  if (matches.length === 0) {
    throw new RangeError(`Location ${poiId} was not found.`);
  }

  if (matches.length > 1) {
    throw new RangeError(`Location ${poiId} is not unique.`);
  }

  return matches[0].index;
}

function locationSpecToCanonicalValue(spec: MerkleLocationSpec): CanonicalJsonValue {
  return {
    baseConfigHash: spec.baseConfigHash,
    boss: spec.boss
      ? {
          attack: spec.boss.attack,
          id: spec.boss.id,
          level: spec.boss.level,
          maxHealth: spec.boss.maxHealth,
          name: spec.boss.name,
          rewardTier: spec.boss.rewardTier
        }
      : undefined,
    enemy: spec.enemy
      ? {
          attack: spec.enemy.attack,
          id: spec.enemy.id,
          level: spec.enemy.level,
          maxHealth: spec.enemy.maxHealth,
          name: spec.enemy.name,
          rewardTier: spec.enemy.rewardTier
        }
      : undefined,
    eventId: spec.eventId,
    id: spec.id,
    kind: spec.kind,
    position: {
      x: spec.position.x,
      y: spec.position.y
    },
    rewardTier: spec.rewardTier,
    shop: spec.shop
      ? {
          id: spec.shop.id,
          itemSlots: spec.shop.itemSlots.map((slot) => ({
            itemId: slot.itemId,
            price: slot.price,
            rewardTier: slot.rewardTier,
            slotId: slot.slotId,
            stock: slot.stock
          })),
          keeperName: spec.shop.keeperName
        }
      : undefined
  };
}

function isBytes32(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}
