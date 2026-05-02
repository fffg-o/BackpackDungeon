import { sha256 } from "@noble/hashes/sha2.js";
import { PublicKey } from "@solana/web3.js";
import { PACKRUN_PROGRAM_PUBLIC_KEY } from "./constants";

const textEncoder = new TextEncoder();

function utf8Seed(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function bytes32Seed(value: Uint8Array, name: string): Uint8Array {
  if (value.length !== 32) {
    throw new RangeError(`${name} must be 32 bytes.`);
  }
  return value;
}

function u16Seed(value: number, name: string): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${name} must be an unsigned 16-bit integer.`);
  }

  const seed = new Uint8Array(2);
  new DataView(seed.buffer).setUint16(0, value, true);
  return seed;
}

export function sha256Bytes32(input: string): Uint8Array {
  return sha256(utf8Seed(input));
}

export function sha256RawBytes32(input: Uint8Array): Uint8Array {
  return sha256(input);
}

export function dailyDungeonPda(dayId: string): readonly [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8Seed("dungeon"), utf8Seed(dayId)],
    PACKRUN_PROGRAM_PUBLIC_KEY,
  );
}

export function locationPda(
  dayId: string,
  poiIdHash: Uint8Array,
): readonly [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8Seed("location"), utf8Seed(dayId), bytes32Seed(poiIdHash, "poiIdHash")],
    PACKRUN_PROGRAM_PUBLIC_KEY,
  );
}

export function enemyLocationPda(
  dayId: string,
  poiIdHash: Uint8Array,
): readonly [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8Seed("enemy"), utf8Seed(dayId), bytes32Seed(poiIdHash, "poiIdHash")],
    PACKRUN_PROGRAM_PUBLIC_KEY,
  );
}

export function shopPda(
  dayId: string,
  poiIdHash: Uint8Array,
): readonly [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8Seed("shop"), utf8Seed(dayId), bytes32Seed(poiIdHash, "poiIdHash")],
    PACKRUN_PROGRAM_PUBLIC_KEY,
  );
}

export function bossLocationPda(
  dayId: string,
  poiIdHash: Uint8Array,
): readonly [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8Seed("boss"), utf8Seed(dayId), bytes32Seed(poiIdHash, "poiIdHash")],
    PACKRUN_PROGRAM_PUBLIC_KEY,
  );
}

export function playerRunPda(
  dayId: string,
  player: PublicKey,
): readonly [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8Seed("run"), utf8Seed(dayId), player.toBuffer()],
    PACKRUN_PROGRAM_PUBLIC_KEY,
  );
}

export function shopItemSlotPda(
  dayId: string,
  poiIdHash: Uint8Array,
  slotIndex: number,
): readonly [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      utf8Seed("shop_slot"),
      utf8Seed(dayId),
      bytes32Seed(poiIdHash, "poiIdHash"),
      u16Seed(slotIndex, "slotIndex"),
    ],
    PACKRUN_PROGRAM_PUBLIC_KEY,
  );
}

export function bossShardPda(
  dayId: string,
  shardIndex: number,
): readonly [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8Seed("boss_shard"), utf8Seed(dayId), u16Seed(shardIndex, "shardIndex")],
    PACKRUN_PROGRAM_PUBLIC_KEY,
  );
}

export function playerBossContributionPda(
  dayId: string,
  player: PublicKey,
): readonly [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8Seed("boss_contribution"), utf8Seed(dayId), player.toBuffer()],
    PACKRUN_PROGRAM_PUBLIC_KEY,
  );
}

export function dailyRewardClaimPda(
  dayId: string,
  player: PublicKey,
  poiIdHash: Uint8Array,
): readonly [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8Seed("daily_claim"), utf8Seed(dayId), player.toBuffer(), bytes32Seed(poiIdHash, "poiIdHash")],
    PACKRUN_PROGRAM_PUBLIC_KEY,
  );
}

export function bossNftClaimPda(
  dayId: string,
  player: PublicKey,
): readonly [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8Seed("boss_nft_claim"), utf8Seed(dayId), player.toBuffer()],
    PACKRUN_PROGRAM_PUBLIC_KEY,
  );
}

export function bossShardIndexForPlayer(player: PublicKey, shardCount: number): number {
  if (!Number.isInteger(shardCount) || shardCount <= 0 || shardCount > 0xffff) {
    throw new RangeError("shardCount must be a positive unsigned 16-bit integer.");
  }

  const hash = sha256RawBytes32(player.toBytes());
  const hashPrefix = new DataView(hash.buffer, hash.byteOffset, hash.byteLength).getUint16(0, true);
  return hashPrefix % shardCount;
}

