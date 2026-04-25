// ────────────────────────────────────────────────────────────────────────────
// Battle simulation for enemy encounters
//
// Simple turn-based simulation: player and enemy trade blows until one falls.
// Player stats are derived from a base loadout scaled by clear_count.
// ────────────────────────────────────────────────────────────────────────────

import type { EnemyConfig } from "@backpack-dungeon/shared";
import { computeEnemyStats, type EnemyStats } from "@backpack-dungeon/game-core";

export interface PlayerBattleStats {
  readonly maxHealth: number;
  readonly attack: number;
  readonly defense: number;
}

export interface BattleState {
  readonly playerHp: number;
  readonly enemyHp: number;
  readonly turn: number;
  readonly log: readonly BattleLogEntry[];
  readonly finished: boolean;
  readonly won: boolean | null;
}

export interface BattleLogEntry {
  readonly turn: number;
  readonly attacker: "player" | "enemy";
  readonly damage: number;
  readonly playerHpAfter: number;
  readonly enemyHpAfter: number;
}

export interface BattleResult {
  readonly won: boolean;
  readonly turnsTaken: number;
  readonly damageTaken: number;
  readonly flawless: boolean;
  readonly log: readonly BattleLogEntry[];
}

const BASE_PLAYER_STATS: PlayerBattleStats = {
  maxHealth: 100,
  attack: 15,
  defense: 5,
};

const PLAYER_SCALE_PER_CLEAR = 0.08; // 8% per clear_count
const CRIT_CHANCE = 0.15;
const CRIT_MULTIPLIER = 2.0;
const DODGE_CHANCE = 0.1;

/**
 * Compute player stats scaled by the number of clears the enemy has seen.
 * More clears = stronger enemy = player gets a small scaling bonus too.
 */
export function computePlayerStats(clearCount: number): PlayerBattleStats {
  const scale = 1 + clearCount * PLAYER_SCALE_PER_CLEAR;
  return {
    maxHealth: Math.round(BASE_PLAYER_STATS.maxHealth * scale),
    attack: Math.round(BASE_PLAYER_STATS.attack * scale),
    defense: Math.round(BASE_PLAYER_STATS.defense * scale),
  };
}

/**
 * Run a full battle simulation to completion.
 * Returns the final result with detailed logs.
 */
export function simulateBattle(
  enemy: EnemyConfig,
  clearCount: number,
  rngSeed?: string,
): BattleResult {
  const enemyScaled: EnemyStats = computeEnemyStats(enemy, clearCount);
  const playerStats = computePlayerStats(clearCount);

  let playerHp = playerStats.maxHealth;
  let enemyHp = enemyScaled.maxHealth;
  const log: BattleLogEntry[] = [];
  let turn = 0;

  // Simple deterministic RNG from seed
  const rng = createRng(rngSeed ?? `${enemy.id}-${clearCount}`);

  while (playerHp > 0 && enemyHp > 0 && turn < 50) {
    turn++;

    // ── Player attacks enemy ──
    const playerCrit = rng.next() < CRIT_CHANCE;
    const playerDodge = rng.next() < DODGE_CHANCE;

    if (!playerDodge) {
      const baseDmg = Math.max(1, playerStats.attack - Math.floor(enemyScaled.attack * 0.15));
      const dmg = playerCrit ? Math.round(baseDmg * CRIT_MULTIPLIER) : baseDmg;
      enemyHp = Math.max(0, enemyHp - dmg);
      log.push({
        turn,
        attacker: "player",
        damage: dmg,
        playerHpAfter: playerHp,
        enemyHpAfter: enemyHp,
      });
    } else {
      log.push({
        turn,
        attacker: "player",
        damage: 0,
        playerHpAfter: playerHp,
        enemyHpAfter: enemyHp,
      });
    }

    if (enemyHp <= 0) break;

    // ── Enemy attacks player ──
    const enemyCrit = rng.next() < 0.08;
    const enemyMiss = rng.next() < 0.05;

    if (!enemyMiss) {
      const baseDmg = Math.max(1, enemyScaled.attack - Math.floor(playerStats.defense * 0.5));
      const dmg = enemyCrit ? Math.round(baseDmg * 1.5) : baseDmg;
      playerHp = Math.max(0, playerHp - dmg);
      log.push({
        turn,
        attacker: "enemy",
        damage: dmg,
        playerHpAfter: playerHp,
        enemyHpAfter: enemyHp,
      });
    } else {
      log.push({
        turn,
        attacker: "enemy",
        damage: 0,
        playerHpAfter: playerHp,
        enemyHpAfter: enemyHp,
      });
    }
  }

  const won = playerHp > 0 && enemyHp <= 0;
  const damageTaken = playerStats.maxHealth - playerHp;

  return {
    won,
    turnsTaken: turn,
    damageTaken,
    flawless: damageTaken === 0 && won,
    log,
  };
}

// ── Simple seeded RNG (mulberry32) ─────────────────────────────────────────

function createRng(seed: string): { next: () => number } {
  let state = hashStr(seed);
  return {
    next: (): number => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function hashStr(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash;
}
