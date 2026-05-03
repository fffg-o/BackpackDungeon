import {
  hashCanonicalJson,
  RewardTier,
  type ShopItemSlot
} from "@backpack-dungeon/shared";

export type BackpackItemKind =
  | "weapon"
  | "gem"
  | "armor"
  | "potion"
  | "bomb"
  | "charm"
  | "food"
  | "key"
  | "ward";

export type BackpackItemSourceKind =
  | "starter"
  | "shop"
  | "treasure"
  | "enemy"
  | "debug";

export interface BackpackItemSizeV1 {
  readonly width: number;
  readonly height: number;
}

export interface BackpackItemEffectV1 {
  readonly stat?: "attack" | "defense" | "maxHealth" | "speed" | "critBps" | "dodgeBps";
  readonly flat?: number;
  readonly bps?: number;
  readonly trigger?:
    | "passive"
    | "battleStart"
    | "turnStart"
    | "onPlayerAttack"
    | "onEnemyAttack"
    | "lowHealth";
  readonly cooldownTurns?: number;
  readonly description: string;
}

export interface BackpackItemDefinitionV1 {
  readonly id: string;
  readonly name: string;
  readonly kind: BackpackItemKind;
  readonly tier: RewardTier;
  readonly size: BackpackItemSizeV1;
  readonly icon: string;
  readonly effects: readonly BackpackItemEffectV1[];
  readonly tags: readonly string[];
  readonly description: string;
}

export interface BackpackItemInstanceV1 {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly sourceKind: BackpackItemSourceKind;
  readonly sourceRef: string;
  readonly acquiredAt: number;
}

export interface CreateBackpackItemSourceParams {
  readonly dayId: string;
  readonly player: string;
  readonly sourceRef?: string;
  readonly acquiredAt?: number;
}

export interface CreateBackpackItemFromShopSlotParams
  extends CreateBackpackItemSourceParams {
  readonly signature?: string;
  readonly purchaseIndex?: number;
}

export interface BackpackTreasureSpecInput {
  readonly id?: string;
  readonly itemId?: string;
  readonly poiId?: string;
  readonly poiIdHash?: string;
  readonly rewardTier?: RewardTier;
  readonly sourceRef?: string;
}

export interface BackpackEnemyRewardInput {
  readonly id?: string;
  readonly itemId?: string;
  readonly enemyId?: string;
  readonly poiId?: string;
  readonly rewardTier?: RewardTier;
  readonly sourceRef?: string;
}

const TIER_ORDER = Object.freeze([
  RewardTier.Common,
  RewardTier.Uncommon,
  RewardTier.Rare,
  RewardTier.Epic,
  RewardTier.Legendary
] as const);

const RUBY_ATTACK_BY_TIER: Readonly<Record<RewardTier, number>> = Object.freeze({
  [RewardTier.Common]: 1,
  [RewardTier.Uncommon]: 2,
  [RewardTier.Rare]: 3,
  [RewardTier.Epic]: 4,
  [RewardTier.Legendary]: 6
});

const POTION_HEAL_BY_TIER: Readonly<Record<RewardTier, number>> = Object.freeze({
  [RewardTier.Common]: 18,
  [RewardTier.Uncommon]: 24,
  [RewardTier.Rare]: 32,
  [RewardTier.Epic]: 42,
  [RewardTier.Legendary]: 56
});

const BOMB_DAMAGE_BY_TIER: Readonly<Record<RewardTier, number>> = Object.freeze({
  [RewardTier.Common]: 6,
  [RewardTier.Uncommon]: 8,
  [RewardTier.Rare]: 11,
  [RewardTier.Epic]: 15,
  [RewardTier.Legendary]: 22
});

const WARD_DEFENSE_BY_TIER: Readonly<Record<RewardTier, number>> = Object.freeze({
  [RewardTier.Common]: 1,
  [RewardTier.Uncommon]: 2,
  [RewardTier.Rare]: 3,
  [RewardTier.Epic]: 4,
  [RewardTier.Legendary]: 5
});

const FOOD_HEALTH_BY_TIER: Readonly<Record<RewardTier, number>> = Object.freeze({
  [RewardTier.Common]: 6,
  [RewardTier.Uncommon]: 10,
  [RewardTier.Rare]: 14,
  [RewardTier.Epic]: 20,
  [RewardTier.Legendary]: 30
});

const CHARM_BPS_BY_TIER: Readonly<Record<RewardTier, number>> = Object.freeze({
  [RewardTier.Common]: 500,
  [RewardTier.Uncommon]: 700,
  [RewardTier.Rare]: 900,
  [RewardTier.Epic]: 1_200,
  [RewardTier.Legendary]: 1_600
});

const KEY_SPEED_BY_TIER: Readonly<Record<RewardTier, number>> = Object.freeze({
  [RewardTier.Common]: 3,
  [RewardTier.Uncommon]: 5,
  [RewardTier.Rare]: 7,
  [RewardTier.Epic]: 10,
  [RewardTier.Legendary]: 14
});

const KEY_CRIT_BY_TIER: Readonly<Record<RewardTier, number>> = Object.freeze({
  [RewardTier.Common]: 100,
  [RewardTier.Uncommon]: 150,
  [RewardTier.Rare]: 225,
  [RewardTier.Epic]: 325,
  [RewardTier.Legendary]: 500
});

export const BACKPACK_ITEM_DEFINITIONS = Object.freeze([
  ...TIER_ORDER.map((tier) =>
    defineItem({
      id: `ruby-${tierSlug(tier)}`,
      name: `${tier} Ruby`,
      kind: "gem",
      tier,
      size: { width: 1, height: 1 },
      icon: "ruby",
      effects: [
        {
          stat: "attack",
          flat: RUBY_ATTACK_BY_TIER[tier],
          trigger: "passive",
          description: `Attack +${RUBY_ATTACK_BY_TIER[tier]}.`
        }
      ],
      tags: ["ruby", "gem", "attack"],
      description: `A compact ruby that adds ${RUBY_ATTACK_BY_TIER[tier]} attack.`
    })
  ),
  defineItem({
    id: "training-dagger",
    name: "Training Dagger",
    kind: "weapon",
    tier: RewardTier.Common,
    size: { width: 1, height: 2 },
    icon: "dagger",
    effects: [
      {
        stat: "attack",
        flat: 2,
        trigger: "passive",
        description: "Attack +2."
      }
    ],
    tags: ["dagger", "weapon", "starter"],
    description: "A starter blade that adds 2 attack."
  }),
  defineItem({
    id: "iron-dagger-uncommon",
    name: "Iron Dagger",
    kind: "weapon",
    tier: RewardTier.Uncommon,
    size: { width: 1, height: 2 },
    icon: "dagger",
    effects: [
      {
        stat: "attack",
        flat: 4,
        trigger: "passive",
        description: "Attack +4."
      }
    ],
    tags: ["dagger", "weapon", "iron"],
    description: "A narrow iron blade that adds 4 attack."
  }),
  defineItem({
    id: "iron-dagger-rare",
    name: "Iron Dagger",
    kind: "weapon",
    tier: RewardTier.Rare,
    size: { width: 1, height: 2 },
    icon: "dagger",
    effects: [
      {
        stat: "attack",
        flat: 6,
        trigger: "passive",
        description: "Attack +6."
      }
    ],
    tags: ["dagger", "weapon", "iron"],
    description: "A honed iron blade that adds 6 attack."
  }),
  defineItem({
    id: "iron-dagger-epic",
    name: "Iron Dagger",
    kind: "weapon",
    tier: RewardTier.Epic,
    size: { width: 1, height: 2 },
    icon: "dagger",
    effects: [
      {
        stat: "attack",
        flat: 8,
        trigger: "passive",
        description: "Attack +8."
      }
    ],
    tags: ["dagger", "weapon", "iron"],
    description: "A balanced iron blade that adds 8 attack."
  }),
  defineItem({
    id: "iron-dagger-legendary",
    name: "Iron Dagger",
    kind: "weapon",
    tier: RewardTier.Legendary,
    size: { width: 1, height: 2 },
    icon: "dagger",
    effects: [
      {
        stat: "attack",
        flat: 8,
        trigger: "passive",
        description: "Attack +8."
      },
      {
        stat: "critBps",
        flat: 250,
        trigger: "passive",
        description: "Critical chance +250 bps."
      }
    ],
    tags: ["dagger", "weapon", "iron"],
    description: "A rare duelist blade that adds 8 attack and critical chance."
  }),
  defineItem({
    id: "wooden-shield",
    name: "Wooden Shield",
    kind: "armor",
    tier: RewardTier.Common,
    size: { width: 2, height: 2 },
    icon: "shield",
    effects: [
      {
        stat: "defense",
        flat: 1,
        trigger: "passive",
        description: "Defense +1."
      }
    ],
    tags: ["shield", "armor", "wood"],
    description: "A broad wooden shield that adds 1 defense."
  }),
  defineItem({
    id: "wooden-shield-uncommon",
    name: "Wooden Shield",
    kind: "armor",
    tier: RewardTier.Uncommon,
    size: { width: 2, height: 2 },
    icon: "shield",
    effects: [
      {
        stat: "defense",
        flat: 2,
        trigger: "passive",
        description: "Defense +2."
      }
    ],
    tags: ["shield", "armor", "wood"],
    description: "A reinforced wooden shield that adds 2 defense."
  }),
  defineItem({
    id: "iron-armor-rare",
    name: "Iron Armor",
    kind: "armor",
    tier: RewardTier.Rare,
    size: { width: 1, height: 2 },
    icon: "armor",
    effects: [
      {
        stat: "defense",
        flat: 3,
        trigger: "passive",
        description: "Defense +3."
      }
    ],
    tags: ["armor", "iron"],
    description: "Layered iron plates that add 3 defense."
  }),
  defineItem({
    id: "iron-armor-epic",
    name: "Iron Armor",
    kind: "armor",
    tier: RewardTier.Epic,
    size: { width: 1, height: 2 },
    icon: "armor",
    effects: [
      {
        stat: "defense",
        flat: 4,
        trigger: "passive",
        description: "Defense +4."
      }
    ],
    tags: ["armor", "iron"],
    description: "Fine iron plates that add 4 defense."
  }),
  defineItem({
    id: "iron-armor-legendary",
    name: "Iron Armor",
    kind: "armor",
    tier: RewardTier.Legendary,
    size: { width: 1, height: 2 },
    icon: "armor",
    effects: [
      {
        stat: "defense",
        flat: 5,
        trigger: "passive",
        description: "Defense +5."
      }
    ],
    tags: ["armor", "iron"],
    description: "Masterwork iron plates that add 5 defense."
  }),
  ...TIER_ORDER.map((tier) =>
    defineItem({
      id: `potion-${tierSlug(tier)}`,
      name: `${tier} Potion`,
      kind: "potion",
      tier,
      size: { width: 1, height: 1 },
      icon: "potion",
      effects: [
        {
          flat: POTION_HEAL_BY_TIER[tier],
          trigger: "lowHealth",
          cooldownTurns: 999,
          description: `Once per battle below 35% HP, heals ${POTION_HEAL_BY_TIER[tier]} HP.`
        }
      ],
      tags: ["potion", "healing", "consumable-battle"],
      description: `A battle potion that marks used in combat and heals ${POTION_HEAL_BY_TIER[tier]} HP.`
    })
  ),
  ...TIER_ORDER.map((tier) =>
    defineItem({
      id: `bomb-${tierSlug(tier)}`,
      name: `${tier} Bomb`,
      kind: "bomb",
      tier,
      size: { width: 2, height: 1 },
      icon: "bomb",
      effects: [
        {
          flat: BOMB_DAMAGE_BY_TIER[tier],
          trigger: tier === RewardTier.Common ? "battleStart" : "turnStart",
          cooldownTurns: 999,
          description: `Deals ${BOMB_DAMAGE_BY_TIER[tier]} extra damage once per battle.`
        }
      ],
      tags: ["bomb", "damage", "consumable-battle"],
      description: `A volatile pack item that marks used in combat and deals ${BOMB_DAMAGE_BY_TIER[tier]} damage.`
    })
  ),
  ...TIER_ORDER.map((tier) =>
    defineItem({
      id: `charm-${tierSlug(tier)}`,
      name: `${tier} Charm`,
      kind: "charm",
      tier,
      size: { width: 1, height: 1 },
      icon: "charm",
      effects: [
        {
          stat: "attack",
          bps: CHARM_BPS_BY_TIER[tier],
          trigger: "passive",
          description: `Adjacent gems and weapons gain ${CHARM_BPS_BY_TIER[tier]} bps attack value.`
        }
      ],
      tags: ["charm", "adjacency", "support"],
      description: "A small charm that boosts adjacent gems and weapons."
    })
  ),
  ...TIER_ORDER.map((tier) =>
    defineItem({
      id: `ward-${tierSlug(tier)}`,
      name: `${tier} Ward`,
      kind: "ward",
      tier,
      size: { width: 1, height: 2 },
      icon: "ward",
      effects: [
        {
          stat: "defense",
          flat: WARD_DEFENSE_BY_TIER[tier],
          trigger: "battleStart",
          cooldownTurns: 999,
          description: `Battle start: defense +${WARD_DEFENSE_BY_TIER[tier]}.`
        }
      ],
      tags: ["ward", "shield", "battle-start"],
      description: `A ward that grants ${WARD_DEFENSE_BY_TIER[tier]} defense at battle start.`
    })
  ),
  ...TIER_ORDER.map((tier) =>
    defineItem({
      id: `ration-${tierSlug(tier)}`,
      name: `${tier} Ration`,
      kind: "food",
      tier,
      size: { width: 1, height: 1 },
      icon: "ration",
      effects: [
        {
          stat: "maxHealth",
          flat: FOOD_HEALTH_BY_TIER[tier],
          trigger: "passive",
          description: `Max health +${FOOD_HEALTH_BY_TIER[tier]}.`
        }
      ],
      tags: ["ration", "food", "health"],
      description: `Trail food that adds ${FOOD_HEALTH_BY_TIER[tier]} max health.`
    })
  ),
  ...TIER_ORDER.map((tier) =>
    defineItem({
      id: `key-${tierSlug(tier)}`,
      name: `${tier} Key`,
      kind: "key",
      tier,
      size: { width: 1, height: 1 },
      icon: "key",
      effects: [
        {
          stat: "speed",
          flat: KEY_SPEED_BY_TIER[tier],
          trigger: "passive",
          description: `Speed +${KEY_SPEED_BY_TIER[tier]}.`
        },
        {
          stat: "critBps",
          flat: KEY_CRIT_BY_TIER[tier],
          trigger: "passive",
          description: `Critical chance +${KEY_CRIT_BY_TIER[tier]} bps.`
        }
      ],
      tags: ["key", "speed", "crit"],
      description: "A light key that improves speed and critical chance."
    })
  )
] satisfies readonly BackpackItemDefinitionV1[]);

const DEFINITIONS_BY_ID: ReadonlyMap<string, BackpackItemDefinitionV1> = new Map(
  BACKPACK_ITEM_DEFINITIONS.map((definition) => [definition.id, definition])
);

const DEFINITION_ALIASES: ReadonlyMap<string, string> = new Map([
  ["common-ruby", "ruby-common"],
  ["uncommon-ruby", "ruby-uncommon"],
  ["rare-ruby", "ruby-rare"],
  ["epic-ruby", "ruby-epic"],
  ["legendary-ruby", "ruby-legendary"],
  ["ruby", "ruby-common"],
  ["potion", "potion-common"],
  ["bomb", "bomb-common"],
  ["charm", "charm-common"],
  ["ward", "ward-common"],
  ["ration", "ration-common"],
  ["food", "ration-common"],
  ["key", "key-common"],
  ["wooden-shield-common", "wooden-shield"],
  ["iron-dagger", "iron-dagger-uncommon"],
  ["iron-armor", "iron-armor-rare"]
]);

export function getBackpackItemDefinition(definitionId: string): BackpackItemDefinitionV1 {
  const normalized = normalizeDefinitionId(definitionId);
  const definition = DEFINITIONS_BY_ID.get(normalized);
  if (!definition) {
    throw new RangeError(`Unknown backpack item definition: ${definitionId}`);
  }

  return definition;
}

export function createStarterBackpackItems(
  dayId: string,
  player: string
): readonly BackpackItemInstanceV1[] {
  const starterDefinitionIds = Object.freeze([
    "training-dagger",
    "wooden-shield",
    "ruby-common"
  ] as const);

  return starterDefinitionIds.map((definitionId, index) =>
    createBackpackItemInstance(definitionId, "starter", {
      dayId,
      player,
      sourceRef: `starter:${index}:${definitionId}`,
      acquiredAt: 0
    })
  );
}

export function createBackpackItemFromShopSlot(
  slot: ShopItemSlot,
  params: CreateBackpackItemFromShopSlotParams
): BackpackItemInstanceV1 {
  const definitionId = resolveDefinitionId(slot.itemId, slot.rewardTier, {
    dayId: params.dayId,
    itemId: slot.itemId,
    player: params.player,
    sourceKind: "shop",
    sourceRef: params.sourceRef ?? slot.slotId
  });
  const sourceRef =
    params.sourceRef ??
    params.signature ??
    `${params.dayId}:${slot.slotId}:${slot.itemId}:${params.purchaseIndex ?? 0}`;

  return createBackpackItemInstance(definitionId, "shop", {
    ...params,
    sourceRef
  });
}

export function createBackpackItemFromTreasure(
  spec: BackpackTreasureSpecInput,
  params: CreateBackpackItemSourceParams
): BackpackItemInstanceV1 {
  const tier = spec.rewardTier ?? RewardTier.Common;
  const sourceRef =
    params.sourceRef ??
    spec.sourceRef ??
    spec.poiIdHash ??
    spec.poiId ??
    spec.id ??
    "treasure";
  const definitionId = resolveDefinitionId(spec.itemId ?? spec.id ?? sourceRef, tier, {
    dayId: params.dayId,
    itemId: spec.itemId ?? spec.id ?? "treasure",
    player: params.player,
    sourceKind: "treasure",
    sourceRef
  });

  return createBackpackItemInstance(definitionId, "treasure", {
    ...params,
    sourceRef
  });
}

export function createBackpackItemFromEnemyReward(
  reward: BackpackEnemyRewardInput,
  params: CreateBackpackItemSourceParams
): BackpackItemInstanceV1 {
  const tier = reward.rewardTier ?? RewardTier.Common;
  const sourceRef =
    params.sourceRef ??
    reward.sourceRef ??
    reward.enemyId ??
    reward.poiId ??
    reward.id ??
    "enemy";
  const definitionId = resolveDefinitionId(reward.itemId ?? reward.id ?? sourceRef, tier, {
    dayId: params.dayId,
    itemId: reward.itemId ?? reward.id ?? "enemy-reward",
    player: params.player,
    sourceKind: "enemy",
    sourceRef
  });

  return createBackpackItemInstance(definitionId, "enemy", {
    ...params,
    sourceRef
  });
}

export function computeBackpackItemSourceHash(params: {
  readonly dayId: string;
  readonly player: string;
  readonly sourceKind: BackpackItemSourceKind;
  readonly sourceRef: string;
  readonly definitionId: string;
}): string {
  return hashCanonicalJson({
    dayId: assertNonEmptyString(params.dayId, "dayId"),
    definitionId: getBackpackItemDefinition(params.definitionId).id,
    domain: "backpack-item-source-v1",
    player: assertNonEmptyString(params.player, "player"),
    sourceKind: assertSourceKind(params.sourceKind),
    sourceRef: assertNonEmptyString(params.sourceRef, "sourceRef"),
    version: 1
  });
}

function createBackpackItemInstance(
  definitionId: string,
  sourceKind: BackpackItemSourceKind,
  params: CreateBackpackItemSourceParams
): BackpackItemInstanceV1 {
  const definition = getBackpackItemDefinition(definitionId);
  const sourceRef = assertNonEmptyString(params.sourceRef ?? sourceKind, "sourceRef");
  const sourceHash = computeBackpackItemSourceHash({
    dayId: params.dayId,
    definitionId: definition.id,
    player: params.player,
    sourceKind,
    sourceRef
  });

  return {
    acquiredAt:
      params.acquiredAt === undefined
        ? deterministicAcquiredAt(sourceHash)
        : assertNonNegativeInteger(params.acquiredAt, "acquiredAt"),
    definitionId: definition.id,
    instanceId: `${sourceKind}-${sourceHash.slice(0, 32)}`,
    sourceKind,
    sourceRef
  };
}

function resolveDefinitionId(
  itemId: string,
  tier: RewardTier,
  context: {
    readonly dayId: string;
    readonly itemId: string;
    readonly player: string;
    readonly sourceKind: BackpackItemSourceKind;
    readonly sourceRef: string;
  }
): string {
  const normalized = normalizeDefinitionId(itemId);
  if (DEFINITIONS_BY_ID.has(normalized)) {
    return normalized;
  }

  const family = inferItemFamily(normalized);
  if (family) {
    return definitionIdForFamily(family, tier);
  }

  return pickDefinitionId(tier, context);
}

function inferItemFamily(normalizedItemId: string): BackpackItemKind | "ration" | "ruby" | null {
  if (normalizedItemId.includes("ruby") || normalizedItemId.includes("gem")) return "ruby";
  if (normalizedItemId.includes("dagger") || normalizedItemId.includes("weapon")) return "weapon";
  if (
    normalizedItemId.includes("shield") ||
    normalizedItemId.includes("armor") ||
    normalizedItemId.includes("mail")
  ) {
    return "armor";
  }
  if (normalizedItemId.includes("potion")) return "potion";
  if (normalizedItemId.includes("bomb")) return "bomb";
  if (normalizedItemId.includes("charm")) return "charm";
  if (normalizedItemId.includes("ward")) return "ward";
  if (normalizedItemId.includes("ration") || normalizedItemId.includes("food")) return "ration";
  if (normalizedItemId.includes("key")) return "key";
  return null;
}

function definitionIdForFamily(
  family: BackpackItemKind | "ration" | "ruby",
  tier: RewardTier
): string {
  const slug = tierSlug(tier);
  if (family === "ruby" || family === "gem") return `ruby-${slug}`;
  if (family === "weapon") {
    if (tier === RewardTier.Common) return "training-dagger";
    return `iron-dagger-${slug}`;
  }
  if (family === "armor") {
    if (tier === RewardTier.Common) return "wooden-shield";
    if (tier === RewardTier.Uncommon) return "wooden-shield-uncommon";
    return `iron-armor-${slug}`;
  }
  if (family === "ration" || family === "food") return `ration-${slug}`;
  return `${family}-${slug}`;
}

function pickDefinitionId(
  tier: RewardTier,
  context: {
    readonly dayId: string;
    readonly itemId: string;
    readonly player: string;
    readonly sourceKind: BackpackItemSourceKind;
    readonly sourceRef: string;
  }
): string {
  const candidates = Object.freeze([
    `ruby-${tierSlug(tier)}`,
    definitionIdForFamily("weapon", tier),
    definitionIdForFamily("armor", tier),
    `potion-${tierSlug(tier)}`,
    `bomb-${tierSlug(tier)}`,
    `charm-${tierSlug(tier)}`,
    `ward-${tierSlug(tier)}`,
    `ration-${tierSlug(tier)}`,
    `key-${tierSlug(tier)}`
  ]);
  const hash = hashCanonicalJson({
    ...context,
    domain: "backpack-definition-pick-v1",
    tier,
    version: 1
  });
  const index = Number.parseInt(hash.slice(0, 8), 16) % candidates.length;
  return candidates[index];
}

function normalizeDefinitionId(definitionId: string): string {
  const normalized = assertNonEmptyString(definitionId, "definitionId").trim().toLowerCase();
  return DEFINITION_ALIASES.get(normalized) ?? normalized;
}

function defineItem(definition: BackpackItemDefinitionV1): BackpackItemDefinitionV1 {
  assertNonEmptyString(definition.id, "definition.id");
  assertNonEmptyString(definition.name, "definition.name");
  assertPositiveInteger(definition.size.width, "definition.size.width");
  assertPositiveInteger(definition.size.height, "definition.size.height");
  return definition;
}

function tierSlug(tier: RewardTier): string {
  assertRewardTier(tier);
  return tier.toLowerCase();
}

function assertRewardTier(tier: RewardTier): RewardTier {
  if (!TIER_ORDER.includes(tier)) {
    throw new RangeError(`Unknown reward tier: ${tier}`);
  }

  return tier;
}

function assertSourceKind(sourceKind: BackpackItemSourceKind): BackpackItemSourceKind {
  if (
    sourceKind !== "starter" &&
    sourceKind !== "shop" &&
    sourceKind !== "treasure" &&
    sourceKind !== "enemy" &&
    sourceKind !== "debug"
  ) {
    throw new RangeError(`Unknown backpack item source kind: ${sourceKind}`);
  }

  return sourceKind;
}

function deterministicAcquiredAt(sourceHash: string): number {
  return Number.parseInt(sourceHash.slice(0, 10), 16);
}

function assertNonEmptyString(value: string, name: string): string {
  if (value.trim().length === 0) {
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
