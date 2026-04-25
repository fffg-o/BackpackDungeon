import assert from "node:assert/strict";
import test from "node:test";
import { LocationKind } from "@backpack-dungeon/shared";
import {
  generateDailyMap,
  type DailyLocationSpec,
  type DailyMapInput
} from "../src/index.js";

const BASE_INPUT: DailyMapInput = Object.freeze({
  bossCount: 2,
  dayId: "2026-04-25",
  enemyCount: 12,
  height: 60,
  masterSeed: "packrun-master",
  poiDensity: 0.04,
  shopCount: 4,
  treasureCount: 8,
  width: 90
});

test("same seed produces the same POI list", () => {
  const first = generateDailyMap(BASE_INPUT);
  const second = generateDailyMap(BASE_INPUT);

  assert.deepEqual(first.locations, second.locations);
  assert.deepEqual(first, second);
});

test("different seed produces a different map", () => {
  const first = generateDailyMap(BASE_INPUT);
  const second = generateDailyMap({
    ...BASE_INPUT,
    masterSeed: "packrun-other-master"
  });

  assert.notDeepEqual(first.locations, second.locations);
  assert.notEqual(first.seedHash, second.seedHash);
});

test("POI counts are configurable and at least one boss is guaranteed", () => {
  const map = generateDailyMap({
    ...BASE_INPUT,
    bossCount: 0,
    enemyCount: 3,
    shopCount: 2,
    treasureCount: 5
  });

  assert.equal(countKind(map.locations, LocationKind.Boss), 1);
  assert.equal(countKind(map.locations, LocationKind.Enemy), 3);
  assert.equal(countKind(map.locations, LocationKind.Shop), 2);
  assert.equal(countKind(map.locations, LocationKind.Treasure), 5);
  assert.equal(map.locations.length, 11);
});

test("all POIs are within map bounds", () => {
  const map = generateDailyMap(BASE_INPUT);

  for (const location of map.locations) {
    assert.ok(location.position.x >= 0);
    assert.ok(location.position.x < map.width);
    assert.ok(location.position.y >= 0);
    assert.ok(location.position.y < map.height);
    assert.equal(location.baseConfigHash.length, 64);
  }
});

test("map generation does not create duplicate POI positions or ids", () => {
  const map = generateDailyMap(BASE_INPUT);
  const positions = new Set(map.locations.map((location) => positionKey(location)));
  const ids = new Set(map.locations.map((location) => location.id));

  assert.equal(positions.size, map.locations.length);
  assert.equal(ids.size, map.locations.length);
});

test("shops and enemies are spread across the map", () => {
  const map = generateDailyMap(BASE_INPUT);
  const shopQuadrants = quadrantsFor(map.locations, LocationKind.Shop, map.width, map.height);
  const enemyQuadrants = quadrantsFor(map.locations, LocationKind.Enemy, map.width, map.height);

  assert.ok(shopQuadrants.size >= 2);
  assert.ok(enemyQuadrants.size >= 3);
});

function countKind(locations: readonly DailyLocationSpec[], kind: LocationKind): number {
  return locations.filter((location) => location.kind === kind).length;
}

function positionKey(location: DailyLocationSpec): string {
  return `${location.position.x},${location.position.y}`;
}

function quadrantsFor(
  locations: readonly DailyLocationSpec[],
  kind: LocationKind,
  width: number,
  height: number
): Set<string> {
  return new Set(
    locations
      .filter((location) => location.kind === kind)
      .map((location) => {
        const x = location.position.x < width / 2 ? 0 : 1;
        const y = location.position.y < height / 2 ? 0 : 1;
        return `${x},${y}`;
      })
  );
}
