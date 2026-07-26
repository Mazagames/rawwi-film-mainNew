import { canonicalStringify } from "./canonicalJson.js";
import { sha256 } from "./hash.js";

function formatUuidFromHex(hex: string): string {
  const cleaned = hex.replace(/[^0-9a-f]/gi, "").toLowerCase().padEnd(32, "0").slice(0, 32);
  const chars = cleaned.split("");
  chars[12] = "4";
  const variant = Number.parseInt(chars[16] ?? "8", 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const normalized = chars.join("");
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20, 32),
  ].join("-");
}

export function buildFindingUuid(seed: unknown): string {
  return formatUuidFromHex(sha256(canonicalStringify(seed)));
}
