import {
  hashCanonicalJson,
  type CanonicalJsonValue,
  type EnemyConfig
} from "@backpack-dungeon/shared";
import type { BackpackSnapshotV1 } from "./backpack-effects.js";
import type { BackpackItemDefinitionV1 } from "./backpack-items.js";
import { getItemSize, type PlacedBackpackItemV1 } from "./backpack-layout.js";
import { randomRange } from "./rng.js";

export interface BattlePlayerSnapshotV1 {
  readonly energy: number;
  readonly clearedLocations: number;
  readonly bossDamage: number;
  readonly itemsPurchased: number;
  readonly commonLootCount: number;
  readonly rareEligibilityPoints: number;
}

export interface BattleEnemySnapshotV1 {
  readonly level: number;
  readonly maxHealth: number;
  readonly attack: number;
  readonly rewardTier: string;
}

export interface BattleInputV1 {
  readonly version: 1;
  readonly encounterKind: "enemy" | "boss";
  readonly dayId: string;
  readonly mapRoot: string;
  readonly rulesetHash?: string;
  readonly player: string;
  readonly poiId: string;
  readonly poiIdHash: string;
  readonly enemyId: string;
  readonly enemyName: string;
  readonly clearCount: number;
  readonly attemptIndex: number;
  readonly playerSnapshot: BattlePlayerSnapshotV1;
  readonly enemySnapshot: BattleEnemySnapshotV1;
  readonly backpack?: BackpackSnapshotV1;
}

export interface BattleCombatantStatsV1 {
  readonly maxHealth: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
  readonly critBps: number;
  readonly dodgeBps: number;
}

export interface BackpackBattleStatsV1 {
  readonly maxHealthFlat: number;
  readonly attackFlat: number;
  readonly defenseFlat: number;
  readonly speedFlat: number;
  readonly critBpsFlat: number;
  readonly dodgeBpsFlat: number;
  readonly battleStartDamageFlat: number;
  readonly lowHealthHealFlat: number;
  readonly notes: readonly string[];
}

export interface BattleLogEntryV1 {
  readonly turn: number;
  readonly actor: "player" | "enemy";
  readonly action: string;
  readonly roll: number;
  readonly damage: number;
  readonly critical: boolean;
  readonly dodged: boolean;
  readonly playerHpAfter: number;
  readonly enemyHpAfter: number;
  readonly note?: string;
  readonly itemTriggers?: readonly string[];
  readonly shieldDelta?: number;
  readonly healDelta?: number;
}

export interface BattleResultV1 {
  readonly version: 1;
  readonly inputHash: string;
  readonly resultHash: string;
  readonly proofHash: string;
  readonly encounterKind: "enemy" | "boss";
  readonly won: boolean;
  readonly turnsTaken: number;
  readonly playerDamageDealt: number;
  readonly enemyDamageDealt: number;
  readonly damageTaken: number;
  readonly playerHpRemaining: number;
  readonly enemyHpRemaining: number;
  readonly flawless: boolean;
  readonly score: number;
  readonly bossDamageScore: number;
  readonly log: readonly BattleLogEntryV1[];
}

export type BattleResultV1HashInput = Omit<BattleResultV1, "resultHash" | "proofHash">;

export interface BuildBattleInputParams {
  readonly encounterKind: "enemy" | "boss";
  readonly dayId: string;
  readonly mapRoot: string;
  readonly rulesetHash?: string;
  readonly player: string;
  readonly poiId: string;
  readonly poiIdHash: string;
  readonly enemyConfig?: EnemyConfig;
  readonly enemy?: EnemyConfig;
  readonly enemyId?: string;
  readonly enemyName?: string;
  readonly clearCount?: number;
  readonly attemptIndex?: number;
  readonly playerSnapshot: BattlePlayerSnapshotV1;
  readonly enemySnapshot?: BattleEnemySnapshotV1;
  readonly backpack?: BackpackSnapshotV1;
}

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

interface CombatSimulationState {
  readonly turnsTaken: number;
  readonly playerDamageDealt: number;
  readonly enemyDamageDealt: number;
  readonly damageTaken: number;
  readonly playerHpRemaining: number;
  readonly enemyHpRemaining: number;
  readonly log: readonly BattleLogEntryV1[];
}

const BATTLE_VERSION = 1;
const BPS_DENOMINATOR = 10_000;
const ENEMY_MAX_TURNS = 30;
const BOSS_MAX_TURNS = 12;
const PLAYER_BASE_MAX_HEALTH = 100;
const PLAYER_BASE_ATTACK = 15;
const PLAYER_BASE_DEFENSE = 5;
const PLAYER_SCALE_PER_CLEAR_BPS = 800;
const PLAYER_BASE_CRIT_BPS = 1_500;
const PLAYER_BASE_DODGE_BPS = 1_000;
const PLAYER_CRIT_MULTIPLIER_BPS = 20_000;
const ENEMY_CRIT_MULTIPLIER_BPS = 15_000;
const DEFENSE_EFFECT_BPS = 5_000;
const MIN_BOSS_DAMAGE_SCORE = 1;
const MAX_BOSS_DAMAGE_SCORE = 10_000;
const LOW_HEALTH_TRIGGER_BPS = 3_500;
const EMPTY_BACKPACK_BATTLE_STATS: BackpackBattleStatsV1 = Object.freeze({
  attackFlat: 0,
  battleStartDamageFlat: 0,
  critBpsFlat: 0,
  defenseFlat: 0,
  dodgeBpsFlat: 0,
  lowHealthHealFlat: 0,
  maxHealthFlat: 0,
  notes: Object.freeze([]),
  speedFlat: 0
});

export function buildBattleInput(params: BuildBattleInputParams): BattleInputV1 {
  const enemyConfig = params.enemyConfig ?? params.enemy;
  const clearCount = assertNonNegativeInteger(params.clearCount ?? 0, "clearCount");
  const attemptIndex = assertNonNegativeInteger(params.attemptIndex ?? 0, "attemptIndex");
  const enemySnapshot =
    params.enemySnapshot ??
    (enemyConfig === undefined
      ? undefined
      : buildEnemySnapshot(params.encounterKind, enemyConfig, clearCount));
  const enemyId = params.enemyId ?? enemyConfig?.id;
  const enemyName = params.enemyName ?? enemyConfig?.name;

  if (enemySnapshot === undefined) {
    throw new TypeError("enemySnapshot or enemyConfig must be provided.");
  }
  if (enemyId === undefined) {
    throw new TypeError("enemyId or enemyConfig must be provided.");
  }
  if (enemyName === undefined) {
    throw new TypeError("enemyName or enemyConfig must be provided.");
  }

  const input: BattleInputV1 = {
    version: BATTLE_VERSION,
    encounterKind: assertEncounterKind(params.encounterKind),
    dayId: assertNonEmptyString(params.dayId, "dayId"),
    mapRoot: assertNonEmptyString(params.mapRoot, "mapRoot"),
    rulesetHash:
      params.rulesetHash === undefined
        ? undefined
        : assertNonEmptyString(params.rulesetHash, "rulesetHash"),
    player: assertNonEmptyString(params.player, "player"),
    poiId: assertNonEmptyString(params.poiId, "poiId"),
    poiIdHash: assertNonEmptyString(params.poiIdHash, "poiIdHash"),
    enemyId: assertNonEmptyString(enemyId, "enemyId"),
    enemyName: assertNonEmptyString(enemyName, "enemyName"),
    clearCount,
    attemptIndex,
    playerSnapshot: normalizePlayerSnapshot(params.playerSnapshot),
    enemySnapshot: normalizeEnemySnapshot(enemySnapshot),
    backpack: params.backpack
  };

  return input;
}

export function computeBattleSeed(input: BattleInputV1): string {
  return hashCanonicalJson({
    domain: "battle-seed-v1",
    inputHash: computeBattleInputHash(input),
    version: BATTLE_VERSION
  });
}

export function computePlayerBattleStats(
  snapshot: BattlePlayerSnapshotV1,
  backpack?: BackpackSnapshotV1
): BattleCombatantStatsV1 {
  const normalized = normalizePlayerSnapshot(snapshot);
  const progressionBps =
    BPS_DENOMINATOR + normalized.clearedLocations * PLAYER_SCALE_PER_CLEAR_BPS;
  const lootPower =
    normalized.itemsPurchased * 250 +
    normalized.commonLootCount * 60 +
    normalized.rareEligibilityPoints * 25;
  const attackBps = progressionBps + normalized.itemsPurchased * 550 + lootPower;
  const defenseBps =
    progressionBps +
    normalized.itemsPurchased * 450 +
    normalized.commonLootCount * 140 +
    normalized.rareEligibilityPoints * 10;

  const baseStats = {
    maxHealth:
      divRound(PLAYER_BASE_MAX_HEALTH * progressionBps, BPS_DENOMINATOR) +
      normalized.itemsPurchased * 5 +
      Math.floor(normalized.commonLootCount / 2) +
      Math.floor(Math.min(normalized.energy, 100) / 5),
    attack: Math.max(1, divRound(PLAYER_BASE_ATTACK * attackBps, BPS_DENOMINATOR)),
    defense: Math.max(0, divRound(PLAYER_BASE_DEFENSE * defenseBps, BPS_DENOMINATOR)),
    speed:
      100 +
      normalized.clearedLocations * 4 +
      normalized.itemsPurchased * 6 +
      Math.floor(Math.min(normalized.energy, 200) / 4) +
      Math.floor(normalized.rareEligibilityPoints / 2),
    critBps: clamp(
      PLAYER_BASE_CRIT_BPS +
        normalized.itemsPurchased * 100 +
        normalized.commonLootCount * 15 +
        normalized.rareEligibilityPoints * 35,
      0,
      6_500
    ),
    dodgeBps: clamp(
      PLAYER_BASE_DODGE_BPS +
        Math.floor(Math.min(normalized.energy, 200) * 15) +
        normalized.clearedLocations * 15 +
        normalized.commonLootCount * 20,
      0,
      4_500
    )
  };

  if (backpack === undefined) {
    return baseStats;
  }

  return applyBackpackBattleStats(baseStats, computeBackpackBattleStats(backpack));
}

export function computeBackpackBattleStats(backpack: BackpackSnapshotV1): BackpackBattleStatsV1 {
  validateBackpackSnapshot(backpack);

  const totals = mutableBackpackBattleStats();
  const placedItems = placedBackpackItems(backpack);

  for (const item of placedItems) {
    for (const effect of item.definition.effects) {
      if (effect.flat === undefined) {
        continue;
      }

      if (
        effect.stat !== undefined &&
        (effect.trigger === undefined ||
          effect.trigger === "passive" ||
          effect.trigger === "battleStart")
      ) {
        addBackpackFlatStat(totals, effect.stat, effect.flat);
        totals.notes.push(`${item.definition.name}: ${effect.description}`);
        continue;
      }

      if (effect.stat === undefined && effect.trigger === "battleStart") {
        totals.battleStartDamageFlat += effect.flat;
        totals.notes.push(`${item.definition.name}: ${effect.description}`);
        continue;
      }

      if (effect.stat === undefined && effect.trigger === "lowHealth") {
        totals.lowHealthHealFlat += effect.flat;
        totals.notes.push(`${item.definition.name}: ${effect.description}`);
      }
    }
  }

  for (const item of placedItems) {
    if (isRubyDefinition(item.definition) && hasAdjacentKind(item, placedItems, "weapon")) {
      totals.attackFlat += 1;
      totals.notes.push(`${item.definition.name}: adjacent weapon attack +1.`);
    }

    if (item.definition.kind === "charm" && hasAdjacentKind(item, placedItems, "gem")) {
      totals.critBpsFlat += 100;
      totals.notes.push(`${item.definition.name}: adjacent gem critical chance +100 bps.`);
    }

    if (item.definition.kind === "ward" && hasAdjacentKind(item, placedItems, "armor")) {
      totals.defenseFlat += 1;
      totals.notes.push(`${item.definition.name}: adjacent armor defense +1.`);
    }
  }

  return {
    attackFlat: totals.attackFlat,
    battleStartDamageFlat: totals.battleStartDamageFlat,
    critBpsFlat: totals.critBpsFlat,
    defenseFlat: totals.defenseFlat,
    dodgeBpsFlat: totals.dodgeBpsFlat,
    lowHealthHealFlat: totals.lowHealthHealFlat,
    maxHealthFlat: totals.maxHealthFlat,
    notes: totals.notes,
    speedFlat: totals.speedFlat
  };
}

export function simulateEnemyBattle(
  input: BattleInputV1,
  enemyConfig: EnemyConfig
): BattleResultV1 {
  validateBattleInput(input);
  validateEnemyConfig(enemyConfig);
  if (input.encounterKind !== "enemy") {
    throw new RangeError("simulateEnemyBattle requires an enemy encounter input.");
  }

  const combat = simulateCombat(input, ENEMY_MAX_TURNS);
  const won = combat.enemyHpRemaining === 0 && combat.playerHpRemaining > 0;
  const flawless = won && combat.damageTaken === 0;

  return finalizeBattleResult(input, combat, {
    bossDamageScore: 0,
    flawless,
    won
  });
}

export function simulateBossBattle(
  input: BattleInputV1,
  bossAsEnemyConfig: EnemyConfig
): BattleResultV1 {
  validateBattleInput(input);
  validateEnemyConfig(bossAsEnemyConfig);
  if (input.encounterKind !== "boss") {
    throw new RangeError("simulateBossBattle requires a boss encounter input.");
  }

  const combat = simulateCombat(input, BOSS_MAX_TURNS);
  const won = combat.playerHpRemaining > 0;
  const flawless = won && combat.damageTaken === 0;
  const bossDamageScore = computeBossDamageScore(
    combat.playerDamageDealt,
    combat.damageTaken,
    flawless,
    won
  );

  return finalizeBattleResult(input, combat, {
    bossDamageScore,
    flawless,
    won
  });
}

export function computeBattleInputHash(input: BattleInputV1): string {
  validateBattleInput(input);

  return hashCanonicalJson({
    domain: "battle-input-v1",
    input: battleInputToCanonical(input),
    version: BATTLE_VERSION
  });
}

export function computeBattleResultHash(resultWithoutHashes: BattleResultV1HashInput): string {
  return hashCanonicalJson({
    domain: "battle-result-v1",
    result: battleResultHashInputToCanonical(resultWithoutHashes),
    version: BATTLE_VERSION
  });
}

export function computeBattleProofHash(
  inputHash: string,
  log: readonly BattleLogEntryV1[]
): string {
  return hashCanonicalJson({
    domain: "battle-proof-v1",
    inputHash: assertNonEmptyString(inputHash, "inputHash"),
    log: log.map(battleLogEntryToCanonical),
    version: BATTLE_VERSION
  });
}

export function computePlayerStats(clearCount: number): PlayerBattleStats {
  const clears = assertNonNegativeInteger(clearCount, "clearCount");
  const scaleBps = BPS_DENOMINATOR + clears * PLAYER_SCALE_PER_CLEAR_BPS;

  return {
    maxHealth: divRound(PLAYER_BASE_MAX_HEALTH * scaleBps, BPS_DENOMINATOR),
    attack: divRound(PLAYER_BASE_ATTACK * scaleBps, BPS_DENOMINATOR),
    defense: divRound(PLAYER_BASE_DEFENSE * scaleBps, BPS_DENOMINATOR)
  };
}

export function simulateBattle(
  enemy: EnemyConfig,
  clearCount: number,
  rngSeed?: string
): BattleResult {
  validateEnemyConfig(enemy);
  const clears = assertNonNegativeInteger(clearCount, "clearCount");
  const seed = rngSeed ?? `${enemy.id}-${clears}`;
  const legacyInputHash = hashCanonicalJson({
    clearCount: clears,
    domain: "legacy-battle-input",
    enemyId: enemy.id,
    seed,
    version: BATTLE_VERSION
  });
  const result = simulateEnemyBattle(
    buildBattleInput({
      attemptIndex: 0,
      clearCount: clears,
      dayId: "legacy",
      encounterKind: "enemy",
      enemyConfig: enemy,
      mapRoot: `legacy-map-${legacyInputHash}`,
      player: `legacy-player-${legacyInputHash.slice(0, 16)}`,
      playerSnapshot: legacyPlayerSnapshot(clears),
      poiId: enemy.id,
      poiIdHash: legacyInputHash,
      rulesetHash: `legacy-rules-${legacyInputHash}`
    }),
    enemy
  );

  return {
    won: result.won,
    turnsTaken: result.turnsTaken,
    damageTaken: result.damageTaken,
    flawless: result.flawless,
    log: result.log.map((entry) => ({
      turn: entry.turn,
      attacker: entry.actor,
      damage: entry.damage,
      playerHpAfter: entry.playerHpAfter,
      enemyHpAfter: entry.enemyHpAfter
    }))
  };
}

function buildEnemySnapshot(
  encounterKind: "enemy" | "boss",
  enemyConfig: EnemyConfig,
  clearCount: number
): BattleEnemySnapshotV1 {
  validateEnemyConfig(enemyConfig);
  const stats =
    encounterKind === "enemy"
      ? computeScaledEnemyStats(enemyConfig, clearCount)
      : {
          attack: enemyConfig.attack,
          level: enemyConfig.level,
          maxHealth: enemyConfig.maxHealth
        };

  return {
    attack: stats.attack,
    level: stats.level,
    maxHealth: stats.maxHealth,
    rewardTier: enemyConfig.rewardTier
  };
}

function computeScaledEnemyStats(
  enemyConfig: EnemyConfig,
  clearCount: number
): {
  readonly level: number;
  readonly maxHealth: number;
  readonly attack: number;
} {
  const clears = assertNonNegativeInteger(clearCount, "clearCount");
  const majorClearSteps = Math.floor(clears / 5);
  const hpMultiplierBps = BPS_DENOMINATOR + clears * 1_800 + majorClearSteps * 1_200;
  const attackMultiplierBps = BPS_DENOMINATOR + clears * 1_200 + majorClearSteps * 800;

  return {
    attack: Math.max(
      enemyConfig.attack + clears,
      divCeil(enemyConfig.attack * attackMultiplierBps, BPS_DENOMINATOR)
    ),
    level: enemyConfig.level + Math.floor(clears / 2),
    maxHealth: Math.max(
      enemyConfig.maxHealth + clears,
      divCeil(enemyConfig.maxHealth * hpMultiplierBps, BPS_DENOMINATOR)
    )
  };
}

function simulateCombat(input: BattleInputV1, maxTurns: number): CombatSimulationState {
  const backpackStats =
    input.backpack === undefined
      ? EMPTY_BACKPACK_BATTLE_STATS
      : computeBackpackBattleStats(input.backpack);
  const playerStats = computePlayerBattleStats(input.playerSnapshot, input.backpack);
  const enemyStats = computeEnemyBattleStats(input.enemySnapshot);
  const seed = computeBattleSeed(input);
  const log: BattleLogEntryV1[] = [];
  const order: readonly ("player" | "enemy")[] =
    playerStats.speed >= enemyStats.speed ? ["player", "enemy"] : ["enemy", "player"];
  let playerHp = playerStats.maxHealth;
  let enemyHp = enemyStats.maxHealth;
  let playerDamageDealt = 0;
  let enemyDamageDealt = 0;
  let turn = 0;
  let rollIndex = 0;
  let lowHealthHealTriggered = false;

  if (backpackStats.battleStartDamageFlat > 0 && enemyHp > 0) {
    const damage = Math.min(enemyHp, backpackStats.battleStartDamageFlat);
    enemyHp = Math.max(0, enemyHp - damage);
    playerDamageDealt += damage;
    log.push(
      buildItemLogEntry({
        action: "item:battleStart",
        actor: "player",
        damage,
        enemyHpAfter: enemyHp,
        itemTriggers: collectBackpackTriggerNotes(input.backpack, "battleStart"),
        note: "battleStart",
        playerHpAfter: playerHp,
        turn
      })
    );
  }

  while (playerHp > 0 && enemyHp > 0 && turn < maxTurns) {
    turn += 1;

    for (const actor of order) {
      if (playerHp <= 0 || enemyHp <= 0) {
        break;
      }

      const attackerStats = actor === "player" ? playerStats : enemyStats;
      const defenderStats = actor === "player" ? enemyStats : playerStats;
      const defenderHp = actor === "player" ? enemyHp : playerHp;
      const hitRoll = randomRange(seed, rollIndex, 1, BPS_DENOMINATOR);
      rollIndex += 1;
      const critRoll = randomRange(seed, rollIndex, 1, BPS_DENOMINATOR);
      rollIndex += 1;
      const dodged = hitRoll <= defenderStats.dodgeBps;
      const critical = !dodged && critRoll <= attackerStats.critBps;
      const damage = dodged
        ? 0
        : computeAttackDamage(actor, attackerStats, defenderStats, defenderHp, critical);

      if (actor === "player") {
        enemyHp = Math.max(0, enemyHp - damage);
        playerDamageDealt += damage;
      } else {
        playerHp = Math.max(0, playerHp - damage);
        enemyDamageDealt += damage;
      }

      log.push(
        buildLogEntry({
          actor,
          critical,
          damage,
          dodged,
          enemyHpAfter: enemyHp,
          playerHpAfter: playerHp,
          roll: hitRoll,
          turn
        })
      );

      if (
        actor === "enemy" &&
        !lowHealthHealTriggered &&
        backpackStats.lowHealthHealFlat > 0 &&
        playerHp > 0 &&
        playerHp * BPS_DENOMINATOR < playerStats.maxHealth * LOW_HEALTH_TRIGGER_BPS
      ) {
        const heal = Math.min(backpackStats.lowHealthHealFlat, playerStats.maxHealth - playerHp);
        lowHealthHealTriggered = true;
        if (heal > 0) {
          playerHp += heal;
          log.push(
            buildItemLogEntry({
              action: "item:lowHealth",
              actor: "player",
              damage: 0,
              enemyHpAfter: enemyHp,
              healDelta: heal,
              itemTriggers: collectBackpackTriggerNotes(input.backpack, "lowHealth"),
              note: "lowHealth",
              playerHpAfter: playerHp,
              turn
            })
          );
        }
      }
    }
  }

  return {
    turnsTaken: turn,
    playerDamageDealt,
    enemyDamageDealt,
    damageTaken: enemyDamageDealt,
    playerHpRemaining: playerHp,
    enemyHpRemaining: enemyHp,
    log
  };
}

function finalizeBattleResult(
  input: BattleInputV1,
  combat: CombatSimulationState,
  flags: {
    readonly won: boolean;
    readonly flawless: boolean;
    readonly bossDamageScore: number;
  }
): BattleResultV1 {
  const inputHash = computeBattleInputHash(input);
  const resultHashInput: BattleResultV1HashInput = {
    version: BATTLE_VERSION,
    inputHash,
    encounterKind: input.encounterKind,
    won: flags.won,
    turnsTaken: combat.turnsTaken,
    playerDamageDealt: combat.playerDamageDealt,
    enemyDamageDealt: combat.enemyDamageDealt,
    damageTaken: combat.damageTaken,
    playerHpRemaining: combat.playerHpRemaining,
    enemyHpRemaining: combat.enemyHpRemaining,
    flawless: flags.flawless,
    score: computeBattleScore(combat, flags.won, flags.flawless),
    bossDamageScore: flags.bossDamageScore,
    log: combat.log
  };

  return {
    ...resultHashInput,
    resultHash: computeBattleResultHash(resultHashInput),
    proofHash: computeBattleProofHash(inputHash, combat.log)
  };
}

function computeEnemyBattleStats(snapshot: BattleEnemySnapshotV1): BattleCombatantStatsV1 {
  const normalized = normalizeEnemySnapshot(snapshot);
  const tierRank = rewardTierRank(normalized.rewardTier);

  return {
    maxHealth: normalized.maxHealth,
    attack: normalized.attack,
    defense: Math.max(0, normalized.level + Math.floor(normalized.attack / 4) + tierRank * 2),
    speed: 90 + normalized.level * 3 + tierRank * 4,
    critBps: clamp(800 + normalized.level * 35 + tierRank * 150, 0, 5_000),
    dodgeBps: clamp(500 + normalized.level * 25 + tierRank * 100, 0, 3_500)
  };
}

function computeAttackDamage(
  actor: "player" | "enemy",
  attackerStats: BattleCombatantStatsV1,
  defenderStats: BattleCombatantStatsV1,
  defenderHp: number,
  critical: boolean
): number {
  const blocked = Math.floor((defenderStats.defense * DEFENSE_EFFECT_BPS) / BPS_DENOMINATOR);
  const baseDamage = Math.max(1, attackerStats.attack - blocked);
  const multiplierBps =
    actor === "player" ? PLAYER_CRIT_MULTIPLIER_BPS : ENEMY_CRIT_MULTIPLIER_BPS;
  const rawDamage = critical
    ? Math.max(1, Math.floor((baseDamage * multiplierBps) / BPS_DENOMINATOR))
    : baseDamage;

  return Math.min(defenderHp, rawDamage);
}

function buildLogEntry(params: {
  readonly turn: number;
  readonly actor: "player" | "enemy";
  readonly roll: number;
  readonly damage: number;
  readonly critical: boolean;
  readonly dodged: boolean;
  readonly playerHpAfter: number;
  readonly enemyHpAfter: number;
}): BattleLogEntryV1 {
  const entry = {
    turn: params.turn,
    actor: params.actor,
    action: "attack",
    roll: params.roll,
    damage: params.damage,
    critical: params.critical,
    dodged: params.dodged,
    playerHpAfter: params.playerHpAfter,
    enemyHpAfter: params.enemyHpAfter
  };

  if (params.dodged) {
    return {
      ...entry,
      note: "dodged"
    };
  }

  if (params.critical) {
    return {
      ...entry,
      note: "critical"
    };
  }

  return entry;
}

function buildItemLogEntry(params: {
  readonly turn: number;
  readonly actor: "player" | "enemy";
  readonly action: string;
  readonly damage: number;
  readonly playerHpAfter: number;
  readonly enemyHpAfter: number;
  readonly itemTriggers: readonly string[];
  readonly note: string;
  readonly healDelta?: number;
  readonly shieldDelta?: number;
}): BattleLogEntryV1 {
  return {
    turn: params.turn,
    actor: params.actor,
    action: params.action,
    roll: 1,
    damage: params.damage,
    critical: false,
    dodged: false,
    playerHpAfter: params.playerHpAfter,
    enemyHpAfter: params.enemyHpAfter,
    itemTriggers: params.itemTriggers,
    note: params.note,
    healDelta: params.healDelta,
    shieldDelta: params.shieldDelta
  };
}

function applyBackpackBattleStats(
  stats: BattleCombatantStatsV1,
  bonuses: BackpackBattleStatsV1
): BattleCombatantStatsV1 {
  return {
    attack: Math.max(1, stats.attack + bonuses.attackFlat),
    critBps: clamp(stats.critBps + bonuses.critBpsFlat, 0, BPS_DENOMINATOR),
    defense: Math.max(0, stats.defense + bonuses.defenseFlat),
    dodgeBps: clamp(stats.dodgeBps + bonuses.dodgeBpsFlat, 0, BPS_DENOMINATOR),
    maxHealth: Math.max(1, stats.maxHealth + bonuses.maxHealthFlat),
    speed: Math.max(1, stats.speed + bonuses.speedFlat)
  };
}

function mutableBackpackBattleStats(): {
  attackFlat: number;
  battleStartDamageFlat: number;
  critBpsFlat: number;
  defenseFlat: number;
  dodgeBpsFlat: number;
  lowHealthHealFlat: number;
  maxHealthFlat: number;
  notes: string[];
  speedFlat: number;
} {
  return {
    attackFlat: 0,
    battleStartDamageFlat: 0,
    critBpsFlat: 0,
    defenseFlat: 0,
    dodgeBpsFlat: 0,
    lowHealthHealFlat: 0,
    maxHealthFlat: 0,
    notes: [],
    speedFlat: 0
  };
}

function addBackpackFlatStat(
  totals: ReturnType<typeof mutableBackpackBattleStats>,
  stat: NonNullable<BackpackItemDefinitionV1["effects"][number]["stat"]>,
  flat: number
): void {
  if (stat === "attack") totals.attackFlat += flat;
  else if (stat === "critBps") totals.critBpsFlat += flat;
  else if (stat === "defense") totals.defenseFlat += flat;
  else if (stat === "dodgeBps") totals.dodgeBpsFlat += flat;
  else if (stat === "maxHealth") totals.maxHealthFlat += flat;
  else if (stat === "speed") totals.speedFlat += flat;
}

function placedBackpackItems(backpack: BackpackSnapshotV1): readonly {
  readonly placed: PlacedBackpackItemV1;
  readonly definition: BackpackItemDefinitionV1;
}[] {
  const inventoryIds = new Set(backpack.inventory.map((item) => item.instanceId));
  return [...backpack.layout.placedItems]
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
    .flatMap((placed) => {
      if (!inventoryIds.has(placed.instanceId)) {
        return [];
      }
      const definition = backpack.itemDefinitions.find(
        (candidate) => candidate.id === placed.definitionId
      );
      if (!definition) {
        return [];
      }
      return [{ placed, definition }];
    });
}

function collectBackpackTriggerNotes(
  backpack: BackpackSnapshotV1 | undefined,
  trigger: "battleStart" | "lowHealth"
): readonly string[] {
  if (backpack === undefined) {
    return [];
  }

  return placedBackpackItems(backpack).flatMap((item) =>
    item.definition.effects
      .filter(
        (effect) =>
          effect.trigger === trigger &&
          effect.stat === undefined &&
          effect.flat !== undefined
      )
      .map((effect) => `${item.definition.name}: ${effect.description}`)
  );
}

function isRubyDefinition(definition: BackpackItemDefinitionV1): boolean {
  return definition.kind === "gem" && definition.tags.includes("ruby");
}

function hasAdjacentKind(
  item: {
    readonly placed: PlacedBackpackItemV1;
    readonly definition: BackpackItemDefinitionV1;
  },
  placedItems: readonly {
    readonly placed: PlacedBackpackItemV1;
    readonly definition: BackpackItemDefinitionV1;
  }[],
  kind: BackpackItemDefinitionV1["kind"]
): boolean {
  return placedItems.some(
    (candidate) =>
      candidate.placed.instanceId !== item.placed.instanceId &&
      candidate.definition.kind === kind &&
      areBackpackItemsAdjacent(item.placed, item.definition, candidate.placed, candidate.definition)
  );
}

function areBackpackItemsAdjacent(
  a: PlacedBackpackItemV1,
  definitionA: BackpackItemDefinitionV1,
  b: PlacedBackpackItemV1,
  definitionB: BackpackItemDefinitionV1
): boolean {
  const rectA = backpackRectFor(a, definitionA);
  const rectB = backpackRectFor(b, definitionB);
  const horizontallyTouching =
    (rectA.right + 1 === rectB.left || rectB.right + 1 === rectA.left) &&
    rangesOverlap(rectA.top, rectA.bottom, rectB.top, rectB.bottom);
  const verticallyTouching =
    (rectA.bottom + 1 === rectB.top || rectB.bottom + 1 === rectA.top) &&
    rangesOverlap(rectA.left, rectA.right, rectB.left, rectB.right);

  return horizontallyTouching || verticallyTouching;
}

function backpackRectFor(
  item: PlacedBackpackItemV1,
  definition: BackpackItemDefinitionV1
): {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
} {
  const size = getItemSize(definition, item.rotated);
  return {
    bottom: item.y + size.height - 1,
    left: item.x,
    right: item.x + size.width - 1,
    top: item.y
  };
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function computeBattleScore(
  combat: CombatSimulationState,
  won: boolean,
  flawless: boolean
): number {
  const rawScore =
    combat.playerDamageDealt * 10 +
    (won ? 1_000 : 0) +
    (flawless ? 500 : 0) -
    combat.damageTaken * 5 +
    Math.max(0, ENEMY_MAX_TURNS - combat.turnsTaken) * 20;

  return Math.max(0, rawScore);
}

function computeBossDamageScore(
  playerDamageDealt: number,
  damageTaken: number,
  flawless: boolean,
  survived: boolean
): number {
  const rawScore =
    playerDamageDealt * 50 +
    (survived ? 500 : 0) +
    (flawless ? 1_000 : 0) -
    damageTaken * 20;

  return clamp(rawScore, MIN_BOSS_DAMAGE_SCORE, MAX_BOSS_DAMAGE_SCORE);
}

function legacyPlayerSnapshot(clearCount: number): BattlePlayerSnapshotV1 {
  return {
    energy: 0,
    clearedLocations: clearCount,
    bossDamage: 0,
    itemsPurchased: 0,
    commonLootCount: 0,
    rareEligibilityPoints: 0
  };
}

function normalizePlayerSnapshot(snapshot: BattlePlayerSnapshotV1): BattlePlayerSnapshotV1 {
  return {
    energy: assertNonNegativeInteger(snapshot.energy, "playerSnapshot.energy"),
    clearedLocations: assertNonNegativeInteger(
      snapshot.clearedLocations,
      "playerSnapshot.clearedLocations"
    ),
    bossDamage: assertNonNegativeInteger(snapshot.bossDamage, "playerSnapshot.bossDamage"),
    itemsPurchased: assertNonNegativeInteger(
      snapshot.itemsPurchased,
      "playerSnapshot.itemsPurchased"
    ),
    commonLootCount: assertNonNegativeInteger(
      snapshot.commonLootCount,
      "playerSnapshot.commonLootCount"
    ),
    rareEligibilityPoints: assertNonNegativeInteger(
      snapshot.rareEligibilityPoints,
      "playerSnapshot.rareEligibilityPoints"
    )
  };
}

function normalizeEnemySnapshot(snapshot: BattleEnemySnapshotV1): BattleEnemySnapshotV1 {
  return {
    level: assertNonNegativeInteger(snapshot.level, "enemySnapshot.level"),
    maxHealth: assertPositiveInteger(snapshot.maxHealth, "enemySnapshot.maxHealth"),
    attack: assertPositiveInteger(snapshot.attack, "enemySnapshot.attack"),
    rewardTier: assertNonEmptyString(snapshot.rewardTier, "enemySnapshot.rewardTier")
  };
}

function validateBattleInput(input: BattleInputV1): void {
  if (input.version !== BATTLE_VERSION) {
    throw new RangeError("BattleInputV1.version must be 1.");
  }

  assertEncounterKind(input.encounterKind);
  assertNonEmptyString(input.dayId, "dayId");
  assertNonEmptyString(input.mapRoot, "mapRoot");
  if (input.rulesetHash !== undefined) {
    assertNonEmptyString(input.rulesetHash, "rulesetHash");
  }
  assertNonEmptyString(input.player, "player");
  assertNonEmptyString(input.poiId, "poiId");
  assertNonEmptyString(input.poiIdHash, "poiIdHash");
  assertNonEmptyString(input.enemyId, "enemyId");
  assertNonEmptyString(input.enemyName, "enemyName");
  assertNonNegativeInteger(input.clearCount, "clearCount");
  assertNonNegativeInteger(input.attemptIndex, "attemptIndex");
  normalizePlayerSnapshot(input.playerSnapshot);
  normalizeEnemySnapshot(input.enemySnapshot);
  if (input.backpack !== undefined) {
    validateBackpackSnapshot(input.backpack);
  }
}

function validateEnemyConfig(enemyConfig: EnemyConfig): void {
  assertNonEmptyString(enemyConfig.id, "enemyConfig.id");
  assertNonEmptyString(enemyConfig.name, "enemyConfig.name");
  assertNonNegativeInteger(enemyConfig.level, "enemyConfig.level");
  assertPositiveInteger(enemyConfig.maxHealth, "enemyConfig.maxHealth");
  assertPositiveInteger(enemyConfig.attack, "enemyConfig.attack");
  assertNonEmptyString(enemyConfig.rewardTier, "enemyConfig.rewardTier");
}

function validateBackpackSnapshot(backpack: BackpackSnapshotV1): void {
  if (backpack.version !== 1) {
    throw new RangeError("BackpackSnapshotV1.version must be 1.");
  }
  assertNonEmptyString(backpack.backpackHash, "backpack.backpackHash");
  if (backpack.layout.version !== 1) {
    throw new RangeError("BackpackLayoutV1.version must be 1.");
  }
  assertPositiveInteger(backpack.layout.width, "backpack.layout.width");
  assertPositiveInteger(backpack.layout.height, "backpack.layout.height");

  for (const item of backpack.inventory) {
    assertNonEmptyString(item.instanceId, "backpack.inventory.instanceId");
    assertNonEmptyString(item.definitionId, "backpack.inventory.definitionId");
    assertNonEmptyString(item.sourceKind, "backpack.inventory.sourceKind");
    assertNonEmptyString(item.sourceRef, "backpack.inventory.sourceRef");
    assertNonNegativeInteger(item.acquiredAt, "backpack.inventory.acquiredAt");
  }

  for (const definition of backpack.itemDefinitions) {
    assertNonEmptyString(definition.id, "backpack.itemDefinitions.id");
    assertNonEmptyString(definition.name, "backpack.itemDefinitions.name");
    assertNonEmptyString(definition.kind, "backpack.itemDefinitions.kind");
    assertPositiveInteger(definition.size.width, "backpack.itemDefinitions.size.width");
    assertPositiveInteger(definition.size.height, "backpack.itemDefinitions.size.height");
  }

  for (const item of backpack.layout.placedItems) {
    assertNonEmptyString(item.instanceId, "backpack.layout.placedItems.instanceId");
    assertNonEmptyString(item.definitionId, "backpack.layout.placedItems.definitionId");
    assertNonNegativeInteger(item.x, "backpack.layout.placedItems.x");
    assertNonNegativeInteger(item.y, "backpack.layout.placedItems.y");
  }
}

function battleInputToCanonical(input: BattleInputV1): CanonicalJsonValue {
  return {
    attemptIndex: input.attemptIndex,
    backpack: backpackSnapshotToBattleInputCanonical(input.backpack),
    clearCount: input.clearCount,
    dayId: input.dayId,
    encounterKind: input.encounterKind,
    enemyId: input.enemyId,
    enemyName: input.enemyName,
    enemySnapshot: enemySnapshotToCanonical(input.enemySnapshot),
    mapRoot: input.mapRoot,
    player: input.player,
    playerSnapshot: playerSnapshotToCanonical(input.playerSnapshot),
    poiId: input.poiId,
    poiIdHash: input.poiIdHash,
    rulesetHash: input.rulesetHash,
    version: input.version
  };
}

function backpackSnapshotToBattleInputCanonical(
  backpack: BackpackSnapshotV1 | undefined
): CanonicalJsonValue | undefined {
  if (backpack === undefined) {
    return undefined;
  }

  return {
    backpackHash: assertNonEmptyString(backpack.backpackHash, "backpack.backpackHash"),
    placedItemCount: assertNonNegativeInteger(
      backpack.layout.placedItems.length,
      "backpack.layout.placedItems.length"
    ),
    placedItemInstanceIds: backpack.layout.placedItems
      .map((item) => assertNonEmptyString(item.instanceId, "backpack.placedItem.instanceId"))
      .sort()
  };
}

function battleResultHashInputToCanonical(result: BattleResultV1HashInput): CanonicalJsonValue {
  return {
    bossDamageScore: result.bossDamageScore,
    damageTaken: result.damageTaken,
    encounterKind: result.encounterKind,
    enemyDamageDealt: result.enemyDamageDealt,
    enemyHpRemaining: result.enemyHpRemaining,
    flawless: result.flawless,
    inputHash: result.inputHash,
    log: result.log.map(battleLogEntryToCanonical),
    playerDamageDealt: result.playerDamageDealt,
    playerHpRemaining: result.playerHpRemaining,
    score: result.score,
    turnsTaken: result.turnsTaken,
    version: result.version,
    won: result.won
  };
}

function playerSnapshotToCanonical(snapshot: BattlePlayerSnapshotV1): CanonicalJsonValue {
  return {
    bossDamage: snapshot.bossDamage,
    clearedLocations: snapshot.clearedLocations,
    commonLootCount: snapshot.commonLootCount,
    energy: snapshot.energy,
    itemsPurchased: snapshot.itemsPurchased,
    rareEligibilityPoints: snapshot.rareEligibilityPoints
  };
}

function enemySnapshotToCanonical(snapshot: BattleEnemySnapshotV1): CanonicalJsonValue {
  return {
    attack: snapshot.attack,
    level: snapshot.level,
    maxHealth: snapshot.maxHealth,
    rewardTier: snapshot.rewardTier
  };
}

function battleLogEntryToCanonical(entry: BattleLogEntryV1): CanonicalJsonValue {
  assertNonNegativeInteger(entry.turn, "log.turn");
  assertActor(entry.actor);
  assertNonEmptyString(entry.action, "log.action");
  assertRangeInteger(entry.roll, 1, BPS_DENOMINATOR, "log.roll");
  assertNonNegativeInteger(entry.damage, "log.damage");
  assertNonNegativeInteger(entry.playerHpAfter, "log.playerHpAfter");
  assertNonNegativeInteger(entry.enemyHpAfter, "log.enemyHpAfter");
  if (entry.healDelta !== undefined) {
    assertNonNegativeInteger(entry.healDelta, "log.healDelta");
  }
  if (entry.shieldDelta !== undefined) {
    assertSafeInteger(entry.shieldDelta, "log.shieldDelta");
  }

  return {
    action: entry.action,
    actor: entry.actor,
    critical: entry.critical,
    damage: entry.damage,
    dodged: entry.dodged,
    enemyHpAfter: entry.enemyHpAfter,
    healDelta: entry.healDelta,
    itemTriggers: entry.itemTriggers?.map((trigger) =>
      assertNonEmptyString(trigger, "log.itemTriggers")
    ),
    note: entry.note,
    playerHpAfter: entry.playerHpAfter,
    roll: entry.roll,
    shieldDelta: entry.shieldDelta,
    turn: entry.turn
  };
}

function assertEncounterKind(value: "enemy" | "boss"): "enemy" | "boss" {
  if (value !== "enemy" && value !== "boss") {
    throw new RangeError("encounterKind must be enemy or boss.");
  }

  return value;
}

function assertActor(value: "player" | "enemy"): "player" | "enemy" {
  if (value !== "player" && value !== "enemy") {
    throw new RangeError("actor must be player or enemy.");
  }

  return value;
}

function rewardTierRank(tier: string): number {
  const normalized = tier.toLowerCase();

  if (normalized === "legendary") return 4;
  if (normalized === "epic") return 3;
  if (normalized === "rare") return 2;
  if (normalized === "uncommon") return 1;

  return 0;
}

function assertNonEmptyString(value: string, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }

  return value;
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }

  return value;
}

function assertNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }

  return value;
}

function assertSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer.`);
  }

  return value;
}

function assertRangeInteger(value: number, min: number, max: number, name: string): number {
  assertNonNegativeInteger(value, name);
  if (value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}.`);
  }

  return value;
}

function divRound(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

function divCeil(numerator: number, denominator: number): number {
  return Math.floor((numerator + denominator - 1) / denominator);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
