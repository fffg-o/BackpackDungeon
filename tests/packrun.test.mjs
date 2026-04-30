// ──────────────────────────────────────────────────────────────────────────────
// Backpack Dungeon — Test Entry Point
//
// This file is the entry point referenced by Anchor.toml. It loads both the
// off-chain gameplay integration tests and the localnet Anchor integration
// tests that exercise account initialization.
// ──────────────────────────────────────────────────────────────────────────────

import "./packrun.gameplay.test.mjs";
import "./packrun.anchor.test.mjs";
