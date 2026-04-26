import { PublicKey } from "@solana/web3.js";

export const PACKRUN_PROGRAM_ID =
  process.env.NEXT_PUBLIC_PACKRUN_PROGRAM_ID ??
  "AKGsUEW5WUdUQ6vWVkWWLF4CosWHfWTPMsfckWKTpvtL";

export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";

export const PACKRUN_PROGRAM_PUBLIC_KEY = new PublicKey(PACKRUN_PROGRAM_ID);

