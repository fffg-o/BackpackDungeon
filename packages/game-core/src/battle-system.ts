import {
  hashCanonicalJson,
  type CanonicalJsonValue,
  type EnemyConfig
} from "@backpack-dungeon/shared";
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
}

export interface BattleCombatantStatsV1 {
  readonly maxHealth: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
  readonly critBps: number;
  readonly dodgeBps: number;
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
    enemySnapshot: normalizeEnemySnapshot(enemySnapshot)
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
  snapshot: BattlePlayerSnapshotV1
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

  return {
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
  const playerStats = computePlayerBattleStats(input.playerSnapshot);
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
}

function validateEnemyConfig(enemyConfig: EnemyConfig): void {
  assertNonEmptyString(enemyConfig.id, "enemyConfig.id");
  assertNonEmptyString(enemyConfig.name, "enemyConfig.name");
  assertNonNegativeInteger(enemyConfig.level, "enemyConfig.level");
  assertPositiveInteger(enemyConfig.maxHealth, "enemyConfig.maxHealth");
  assertPositiveInteger(enemyConfig.attack, "enemyConfig.attack");
  assertNonEmptyString(enemyConfig.rewardTier, "enemyConfig.rewardTier");
}

function battleInputToCanonical(input: BattleInputV1): CanonicalJsonValue {
  return {
    attemptIndex: input.attemptIndex,
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

  return {
    action: entry.action,
    actor: entry.actor,
    critical: entry.critical,
    damage: entry.damage,
    dodged: entry.dodged,
    enemyHpAfter: entry.enemyHpAfter,
    note: entry.note,
    playerHpAfter: entry.playerHpAfter,
    roll: entry.roll,
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
