import assert from "node:assert/strict";
import test from "node:test";
import { LocationKind } from "@backpack-dungeon/shared";
import {
  findOpenPosition,
  generateDailyMap,
  randomRange,
  type DailyLocationSpec,
  type DailyMapInput
} from "../src/index.js";

const BASE_INPUT: DailyMapInput = Object.freeze({
  bossCount: 1,
  dayId: "2026-04-25",
  enemyCount: 12,
  height: 60,
  poiDensity: 0.04,
  randomSeed: 20_260_425,
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
    randomSeed: 20_260_426
  });

  assert.notDeepEqual(first.locations, second.locations);
  assert.notEqual(first.seedHash, second.seedHash);
});

test("POI counts are configurable and exactly one boss is generated", () => {
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

test("requested extra bosses are ignored", () => {
  for (const bossCount of [0, 2, 99]) {
    const map = generateDailyMap({ ...BASE_INPUT, bossCount });

    assert.equal(countKind(map.locations, LocationKind.Boss), 1);
  }
});

test("the single boss has a unique id and position", () => {
  const map = generateDailyMap({ ...BASE_INPUT, bossCount: 2 });
  const bosses = map.locations.filter((location) => location.kind === LocationKind.Boss);
  const bossIds = new Set(bosses.map((location) => location.id));
  const bossPositions = new Set(bosses.map((location) => positionKey(location)));

  assert.equal(bosses.length, 1);
  assert.equal(bossIds.size, 1);
  assert.equal(bossPositions.size, 1);
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

test("findOpenPosition scans the full map area", () => {
  const seed = "full-scan-regression";
  const width = 8;
  const height = 1;
  const startLinear = randomRange(seed, 100_000, 0, width - 1);
  const openLinear = (startLinear + 5) % width;
  const occupied = new UnderreportedOccupied();

  for (let linear = 0; linear < width; linear += 1) {
    if (linear !== openLinear) {
      occupied.add(`${linear},0`);
    }
  }

  assert.equal(occupied.size, 1);
  assert.deepEqual(findOpenPosition(seed, width, height, occupied), {
    x: openLinear,
    y: 0
  });
});

class UnderreportedOccupied extends Set<string> {
  override get size(): number {
    return 1;
  }
}

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
