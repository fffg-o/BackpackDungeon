import type { CanonicalJsonValue } from "@backpack-dungeon/shared";
import { hashCanonicalJson } from "@backpack-dungeon/shared";

export type SeedPart = CanonicalJsonValue;

export interface WeightedItem<T> {
  readonly item: T;
  readonly weight: number;
}

const UINT32_SIZE = 0x1_0000_0000;

export function deriveSeed(
  masterSeed: string,
  domain: string,
  ...parts: readonly SeedPart[]
): string {
  assertString(masterSeed, "masterSeed");
  assertString(domain, "domain");

  return hashCanonicalJson({
    domain,
    masterSeed,
    parts,
    version: 1
  });
}

export function randomU32(seed: string, index: number): number {
  assertString(seed, "seed");
  assertNonNegativeInteger(index, "index");

  const digest = hashCanonicalJson({
    index,
    seed,
    version: 1
  });

  return Number.parseInt(digest.slice(0, 8), 16) >>> 0;
}

export function randomRange(
  seed: string,
  index: number,
  min: number,
  max: number
): number {
  assertString(seed, "seed");
  assertNonNegativeInteger(index, "index");
  assertSafeInteger(min, "min");
  assertSafeInteger(max, "max");

  if (min > max) {
    throw new RangeError("min must be less than or equal to max.");
  }

  const span = max - min + 1;
  if (!Number.isSafeInteger(span) || span <= 0 || span > UINT32_SIZE) {
    throw new RangeError("randomRange supports inclusive spans from 1 to 2^32.");
  }

  if (span === 1) {
    return min;
  }

  const rangeSeed = deriveSeed(seed, "random-range", index, min, max);
  const bucketSize = Math.floor(UINT32_SIZE / span);
  const limit = bucketSize * span;

  for (let attempt = 0; ; attempt += 1) {
    const value = randomU32(rangeSeed, attempt);
    if (value < limit) {
      return min + (value % span);
    }
  }
}

export function pickWeighted<T>(
  seed: string,
  index: number,
  weightedItems: readonly WeightedItem<T>[]
): T {
  assertString(seed, "seed");
  assertNonNegativeInteger(index, "index");

  if (weightedItems.length === 0) {
    throw new RangeError("weightedItems must contain at least one item.");
  }

  let totalWeight = 0;
  for (const entry of weightedItems) {
    assertPositiveInteger(entry.weight, "weight");
    totalWeight += entry.weight;
    if (totalWeight > UINT32_SIZE) {
      throw new RangeError("Total weight must not exceed 2^32.");
    }
  }

  const roll = randomRange(seed, index, 1, totalWeight);
  let cursor = 0;
  for (const entry of weightedItems) {
    cursor += entry.weight;
    if (roll <= cursor) {
      return entry.item;
    }
  }

  return weightedItems[weightedItems.length - 1].item;
}

function assertString(value: string, name: string): void {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string.`);
  }
}

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer.`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  assertSafeInteger(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must be non-negative.`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  assertSafeInteger(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be positive.`);
  }
}
