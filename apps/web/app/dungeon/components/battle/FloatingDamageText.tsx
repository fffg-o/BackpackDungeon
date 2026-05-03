import styles from "./battle.module.css";

export interface FloatingDamageTextProps {
  readonly text: string;
  readonly side: "player" | "enemy";
  readonly critical?: boolean;
  readonly dodged?: boolean;
}

export function FloatingDamageText({
  text,
  side,
  critical = false,
  dodged = false,
}: FloatingDamageTextProps) {
  return (
    <div
      className={[
        styles.floatingDamage,
        side === "player" ? styles.floatingPlayer : styles.floatingEnemy,
        critical ? styles.floatingCritical : "",
        dodged ? styles.floatingDodge : "",
      ].join(" ")}
    >
      {text}
    </div>
  );
}
