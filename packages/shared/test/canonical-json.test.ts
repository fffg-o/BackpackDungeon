import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, hashCanonicalJson, sha256Hex } from "../src/index.js";

test("canonicalJson returns the same string for the same object shape", () => {
  const value = {
    dayId: "2026-04-24",
    locations: [
      {
        id: "enemy-1",
        kind: "Enemy",
        position: { x: 2, y: 3 }
      }
    ],
    width: 7,
    height: 5
  };

  assert.equal(canonicalJson(value), canonicalJson(value));
});

test("canonicalJson sorts object keys recursively", () => {
  const a = {
    b: 2,
    a: {
      d: true,
      c: "packrun"
    }
  };
  const b = {
    a: {
      c: "packrun",
      d: true
    },
    b: 2
  };

  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(a), '{"a":{"c":"packrun","d":true},"b":2}');
});

test("hashCanonicalJson is stable and ignores field order", () => {
  const left = {
    seedHash: "abc",
    dayId: "2026-04-24",
    boss: {
      name: "The Founder",
      level: 1
    }
  };
  const right = {
    boss: {
      level: 1,
      name: "The Founder"
    },
    dayId: "2026-04-24",
    seedHash: "abc"
  };

  assert.equal(hashCanonicalJson(left), hashCanonicalJson(right));
  assert.equal(hashCanonicalJson(left), hashCanonicalJson(left));
});

test("sha256Hex hashes strings deterministically", () => {
  assert.equal(
    sha256Hex("packrun"),
    "ad8c451ac732b4a3428e29580eb73f7342b76b3d78130b0e6eb4ed9b52ea610a"
  );
});
