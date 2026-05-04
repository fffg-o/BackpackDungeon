import {
  BACKPACK_ITEM_DEFINITIONS,
  type BackpackItemDefinitionV1,
} from "@backpack-dungeon/game-core";
import type { I18nContextValue, TranslationParams } from "./types";

type Translate = I18nContextValue["t"];

export interface LocalizedBackpackItemText {
  readonly name: string;
  readonly tier: string;
  readonly description: string;
  readonly effects: readonly string[];
}

export function localizeRewardTier(
  tier: BackpackItemDefinitionV1["tier"],
  t: Translate,
): string {
  return translatedOrFallback(t, `items.tiers.${tier}`, tier);
}

export function localizeBackpackItem(
  definition: BackpackItemDefinitionV1,
  t: Translate,
): LocalizedBackpackItemText {
  return {
    name: localizeBackpackItemName(definition, t),
    tier: localizeRewardTier(definition.tier, t),
    description: localizeBackpackItemDescription(definition, t),
    effects: definition.effects.map((effect, index) =>
      localizeBackpackItemEffect(definition, index, t, effect.description),
    ),
  };
}

export function localizeBackpackItemName(
  definition: BackpackItemDefinitionV1,
  t: Translate,
): string {
  return translatedOrFallback(
    t,
    `items.definitions.${definition.id}.name`,
    definition.name,
  );
}

export function localizeBackpackItemDescription(
  definition: BackpackItemDefinitionV1,
  t: Translate,
): string {
  return translatedOrFallback(
    t,
    `items.definitions.${definition.id}.description`,
    definition.description,
  );
}

export function localizeBackpackItemEffect(
  definition: BackpackItemDefinitionV1,
  effectIndex: number,
  t: Translate,
  fallback = definition.effects[effectIndex]?.description ?? "",
): string {
  return translatedOrFallback(
    t,
    `items.definitions.${definition.id}.effects.${effectIndex}`,
    fallback,
  );
}

export function localizeBackpackItemEffectSummary(
  definition: BackpackItemDefinitionV1,
  t: Translate,
): string {
  if (definition.effects.length === 0) {
    return localizeBackpackItemDescription(definition, t);
  }

  return definition.effects
    .map((effect, index) =>
      localizeBackpackItemEffect(definition, index, t, effect.description),
    )
    .join(" ");
}

export function localizeBackpackItemTriggerNote(
  note: string,
  t: Translate,
): string {
  const separatorIndex = note.indexOf(": ");
  if (separatorIndex < 0) {
    return localizeTriggerDetail(note, t);
  }

  const sourceName = note.slice(0, separatorIndex);
  const detail = note.slice(separatorIndex + 2);
  const localizedName = localizeSourceItemName(sourceName, t);
  const localizedDetail = localizeTriggerDetail(detail, t);

  return translatedOrFallback(
    t,
    "items.triggerFormat",
    `${localizedName}: ${localizedDetail}`,
    {
      name: localizedName,
      detail: localizedDetail,
    },
  );
}

function localizeSourceItemName(sourceName: string, t: Translate): string {
  const definition = BACKPACK_ITEM_DEFINITIONS.find(
    (candidate) => candidate.name === sourceName,
  );
  return definition ? localizeBackpackItemName(definition, t) : sourceName;
}

function localizeTriggerDetail(detail: string, t: Translate): string {
  const synergyKey = SYNERGY_TRIGGER_KEYS[detail];
  if (synergyKey) {
    return translatedOrFallback(t, synergyKey, detail);
  }

  for (const definition of BACKPACK_ITEM_DEFINITIONS) {
    const effectIndex = definition.effects.findIndex(
      (effect) => effect.description === detail,
    );
    if (effectIndex >= 0) {
      return localizeBackpackItemEffect(definition, effectIndex, t, detail);
    }
  }

  return detail;
}

function translatedOrFallback(
  t: Translate,
  key: string,
  fallback: string,
  params?: TranslationParams,
): string {
  const translated = t(key, params);
  return translated === key ? fallback : translated;
}

const SYNERGY_TRIGGER_KEYS: Readonly<Record<string, string>> = Object.freeze({
  "adjacent weapon attack +1.": "items.triggers.adjacentWeaponAttack",
  "adjacent gem critical chance +100 bps.": "items.triggers.adjacentGemCrit",
  "adjacent armor defense +1.": "items.triggers.adjacentArmorDefense",
});
