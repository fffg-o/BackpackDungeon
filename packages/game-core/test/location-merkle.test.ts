import assert from "node:assert/strict";
import test from "node:test";
import { LocationKind } from "@backpack-dungeon/shared";
import {
  buildLocationMerkleTree,
  generateDailyMap,
  getLocationProof,
  locationLeafHash,
  verifyLocationProof,
  type DailyLocationSpec,
  type DailyMapInput
} from "../src/index.js";

const BASE_INPUT: DailyMapInput = Object.freeze({
  bossCount: 2,
  dayId: "2026-04-25",
  enemyCount: 8,
  height: 40,
  poiDensity: 0.05,
  randomSeed: 20_260_425,
  shopCount: 3,
  treasureCount: 5,
  width: 50
});

test("valid proof passes", () => {
  const map = generateDailyMap(BASE_INPUT);
  const spec = map.locations[4];
  const tree = buildLocationMerkleTree(map.locations);
  const proof = getLocationProof(map.locations, spec.id);

  assert.equal(locationLeafHash(spec).length, 64);
  assert.equal(tree.leaves.length, map.locations.length);
  assert.equal(tree.leaves[4], locationLeafHash(spec));
  assert.equal(verifyLocationProof(tree.root, spec, proof), true);
});

test("modified location type fails", () => {
  const { root, spec, proof } = fixture();
  const forged: DailyLocationSpec = {
    ...spec,
    kind: spec.kind === LocationKind.Enemy ? LocationKind.Treasure : LocationKind.Enemy
  };

  assert.equal(verifyLocationProof(root, forged, proof), false);
});

test("modified x/y fails", () => {
  const { root, spec, proof } = fixture();
  const forged: DailyLocationSpec = {
    ...spec,
    position: {
      x: spec.position.x + 1,
      y: spec.position.y
    }
  };

  assert.equal(verifyLocationProof(root, forged, proof), false);
});

test("modified config hash fails", () => {
  const { root, spec, proof } = fixture();
  const forged: DailyLocationSpec = {
    ...spec,
    baseConfigHash: "0".repeat(64)
  };

  assert.notEqual(forged.baseConfigHash, spec.baseConfigHash);
  assert.equal(verifyLocationProof(root, forged, proof), false);
});

test("wrong root fails", () => {
  const { spec, proof } = fixture();
  const wrongRoot = buildLocationMerkleTree(
    generateDailyMap({
      ...BASE_INPUT,
      randomSeed: 20_260_426
    }).locations
  ).root;

  assert.equal(verifyLocationProof(wrongRoot, spec, proof), false);
});

function fixture(): {
  readonly proof: ReturnType<typeof getLocationProof>;
  readonly root: string;
  readonly spec: DailyLocationSpec;
} {
  const map = generateDailyMap(BASE_INPUT);
  const spec = map.locations.find((location) => location.kind === LocationKind.Enemy);

  assert.ok(spec);

  const tree = buildLocationMerkleTree(map.locations);
  const proof = getLocationProof(map.locations, spec.id);

  return {
    proof,
    root: tree.root,
    spec
  };
}
