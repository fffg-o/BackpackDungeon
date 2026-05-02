import styles from "../dungeon.module.css";

export interface ActionButtonProps {
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly variant?: "clear" | "primary" | "secondary" | "init";
}

export function ActionButton({
  children,
  disabled = false,
  onClick,
  variant = "clear",
}: ActionButtonProps) {
  const className =
    variant === "primary"
      ? styles.btnPrimary
      : variant === "secondary"
        ? styles.btnSecondary
        : variant === "init"
          ? styles.btnInit
          : styles.btnClear;

  return (
    <button className={className} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
