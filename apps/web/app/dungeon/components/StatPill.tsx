import styles from "../dungeon.module.css";

export interface StatPillProps {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly title?: string;
}

export function StatPill({ label, value, title }: StatPillProps) {
  return (
    <span title={title ?? label} className={styles.stat}>
      {label ? `${label} ` : ""}
      {value}
    </span>
  );
}
