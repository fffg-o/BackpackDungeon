"use client";

import { GAME_CORE_VERSION } from "@backpack-dungeon/game-core";
import { PACKRUN_LOCATION_KINDS } from "@backpack-dungeon/shared";
import { useI18n } from "./i18n/useI18n";

export default function Home() {
  const { t } = useI18n();

  return (
    <main>
      <div className="shell">
        <h1>BackpackDungeon</h1>
        <p>
          {t("home.ready", {
            count: PACKRUN_LOCATION_KINDS.length,
            version: GAME_CORE_VERSION,
          })}
        </p>
      </div>
    </main>
  );
}
