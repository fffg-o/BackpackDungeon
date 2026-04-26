"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

const WalletMultiButtonInner = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton,
    ),
  { ssr: false },
);

/**
 * Client-only wrapper around `WalletMultiButton` to prevent hydration
 * mismatches caused by the wallet adapter's internal use of browser-only APIs.
 *
 * Use this component anywhere `WalletMultiButton` would be used.
 */
export function WalletButton(props: ComponentProps<typeof WalletMultiButtonInner>) {
  return <WalletMultiButtonInner {...props} />;
}
