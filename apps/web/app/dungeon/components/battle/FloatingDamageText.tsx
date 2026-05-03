import styles from "./battle.module.css";

export interface FloatingDamageTextProps {
  readonly text: string;
  readonly side: "player" | "enemy";
  readonly critical?: boolean;
  readonly dodged?: boolean;
  readonly variant?: "damage" | "heal" | "shield" | "dodge";
}

export function FloatingDamageText({
  text,
  side,
  critical = false,
  dodged = false,
  variant = "damage",
}: FloatingDamageTextProps) {
  return (
    <div
      className={[
        styles.floatingDamage,
        side === "player" ? styles.floatingPlayer : styles.floatingEnemy,
        critical ? styles.floatingCritical : "",
        dodged ? styles.floatingDodge : "",
        variant === "heal" ? styles.floatingHeal : "",
        variant === "shield" ? styles.floatingShield : "",
      ].join(" ")}
    >
      {text}
    </div>
  );
}
