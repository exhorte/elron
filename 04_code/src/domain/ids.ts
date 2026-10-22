import { randomInt } from "node:crypto";

// Alphabet sans caractères ambigus (0/O, 1/I/L) : lisible au téléphone ou sur WhatsApp.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateTrackingCode(): string {
  let suffix = "";
  for (let i = 0; i < 8; i += 1) suffix += ALPHABET[randomInt(0, ALPHABET.length)];
  return `ALX-${suffix}`;
}

export const TRACKING_CODE_PATTERN = /^ALX-[2-9A-HJKMNP-Z]{8}$/;
