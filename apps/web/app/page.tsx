import { GAME_CORE_VERSION } from "@backpack-dungeon/game-core";
import { PACKRUN_LOCATION_KINDS } from "@backpack-dungeon/shared";

export default function Home() {
  return (
    <main>
      <div className="shell">
        <h1>BackpackDungeon</h1>
        <p>
          Packrun workspace ready: game-core {GAME_CORE_VERSION}, shared{" "}
          {PACKRUN_LOCATION_KINDS.length} location kinds.
        </p>
      </div>
    </main>
  );
}
