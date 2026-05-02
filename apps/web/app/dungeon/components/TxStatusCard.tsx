import styles from "../dungeon.module.css";

export type TxStatus =
  | { readonly phase: "submitting"; readonly label: string }
  | { readonly phase: "success"; readonly label: string; readonly signature: string }
  | { readonly phase: "error"; readonly message: string };

export interface TxStatusCardProps {
  readonly status: TxStatus;
  readonly explorerUrl?: (signature: string) => string;
  readonly shortSignature?: (signature: string) => string;
}

export function TxStatusCard({
  status,
  explorerUrl,
  shortSignature = defaultShortSignature,
}: TxStatusCardProps) {
  if (status.phase === "submitting") {
    return (
      <div className={styles.battleSimulating}>
        <div className={styles.spinner} />
        <span>{status.label}</span>
      </div>
    );
  }

  if (status.phase === "error") {
    return <div className={styles.battleError}>{status.message}</div>;
  }

  const label = `${status.label}: ${shortSignature(status.signature)}`;
  return (
    <div className={styles.initialized}>
      {explorerUrl ? (
        <a
          href={explorerUrl(status.signature)}
          target="_blank"
          rel="noreferrer"
          className={styles.txLink}
        >
          {label}
        </a>
      ) : (
        label
      )}
    </div>
  );
}

function defaultShortSignature(signature: string): string {
  return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
}
