# Backpack Effects

`packages/game-core/src/backpack-effects.ts` is the source of truth for combat effects from a `BackpackSnapshotV1`.

`backpack-items.ts` defines item data and item creation only. `backpack-layout.ts` owns placement, rotation, bounds, overlap, and auto-pack rules. `battle-system.ts` consumes `computeBackpackCombatEffects` and does not define item synergy rules.

## Item Effects

| Item kind | Combat effect |
| --- | --- |
| Ruby / gem | Adds flat attack from its item definition. |
| Weapon | Adds flat attack from its item definition. |
| Armor | Adds flat defense from its item definition. |
| Food / ration | Adds flat max health from its item definition. |
| Key | Adds flat speed and critical chance bps from its item definition. |
| Potion | Adds `lowHealthHealFlat`; battle-system triggers it once when the hero drops below 35% HP. |
| Bomb | Adds `battleStartDamageFlat`; battle-system applies this before normal attacks. Bomb definitions with `battleStart` or `turnStart` triggers are treated as battle-start damage for the current MVP combat loop. |
| Ward | Adds flat defense and `shieldFlat` from its ward defense effect. The shield value is logged as a battle-start backpack trigger. |
| Charm | Has no flat stat by itself; its combat value comes from adjacency. |

## Adjacency

Items are adjacent when their occupied rectangles touch orthogonally. Diagonal contact does not count.

| Rule | Bonus |
| --- | --- |
| Ruby next to any weapon | Ruby adds an extra `attackFlat +1`. |
| Charm next to any gem | Charm adds `critBpsFlat +100`. |
| Ward next to any armor | Ward adds `defenseFlat +1`. |

## Summary Fields

`computeBackpackCombatEffects(backpack)` returns `BackpackCombatEffectSummaryV1`:

| Field | Meaning |
| --- | --- |
| `maxHealthFlat` | Added to hero max HP before battle. |
| `attackFlat` | Added to hero attack before battle. |
| `defenseFlat` | Added to hero defense before battle. |
| `speedFlat` | Added to hero speed before battle. |
| `critBpsFlat` | Added to hero crit chance bps before battle. |
| `dodgeBpsFlat` | Added to hero dodge chance bps before battle. |
| `battleStartDamageFlat` | Bonus damage applied before the first normal attack. |
| `lowHealthHealFlat` | One-shot heal pool for the low-health trigger. |
| `shieldFlat` | Battle-start shield feedback, currently logged for UI and paired with ward defense. |
| `notes` | Human-readable item and synergy notes for battle logs and previews. |
| `triggeredItemInstanceIds` | Instance ids that contributed at least one combat effect. |

## Validation

`validateBackpackSnapshot` lives in `backpack-effects.ts` so simulation and UI inventory loading share the same snapshot checks. It validates snapshot shape, item and definition ids, duplicate inventory or placed ids, placement bounds, overlap, and placed-item membership in inventory.
