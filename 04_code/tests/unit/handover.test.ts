import { describe, expect, it } from "vitest";
import {
  HANDOVER_CONFIG,
  checkCodeState,
  deliveryCodeExpiry,
  generateDeliveryCode,
  hashDeliveryCode,
  verifyDeliveryCode,
} from "@/domain/handover";
import { TRACKING_CODE_PATTERN, generateTrackingCode } from "@/domain/ids";

const PEPPER = "unit-test-pepper-0123456789abcdef0123";
const NOW = new Date("2026-11-01T10:00:00Z");

describe("code de remise", () => {
  it("génère un code à 6 chiffres", () => {
    for (let i = 0; i < 200; i += 1) expect(generateDeliveryCode()).toMatch(/^\d{6}$/);
  });

  it("vérifie le bon code et refuse les autres", () => {
    const hash = hashDeliveryCode("123456", "ship-1", PEPPER);
    expect(verifyDeliveryCode("123456", "ship-1", PEPPER, hash)).toBe(true);
    expect(verifyDeliveryCode("123457", "ship-1", PEPPER, hash)).toBe(false);
    expect(verifyDeliveryCode("12345", "ship-1", PEPPER, hash)).toBe(false);
    expect(verifyDeliveryCode("abcdef", "ship-1", PEPPER, hash)).toBe(false);
    expect(verifyDeliveryCode("1234567", "ship-1", PEPPER, hash)).toBe(false);
  });

  it("lie le code au colis et au secret serveur", () => {
    const hash = hashDeliveryCode("123456", "ship-1", PEPPER);
    expect(verifyDeliveryCode("123456", "ship-2", PEPPER, hash)).toBe(false);
    expect(verifyDeliveryCode("123456", "ship-1", "autre-secret-autre-secret-autre-secret", hash)).toBe(false);
    expect(hash).not.toContain("123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("calcule l'expiration et l'état du code", () => {
    const expiresAt = deliveryCodeExpiry(NOW);
    expect(expiresAt.getTime() - NOW.getTime()).toBe(HANDOVER_CONFIG.ttlDays * 86_400_000);
    const fresh = { attempts: 0, lockedAt: null, expiresAt, consumedAt: null };
    expect(checkCodeState(fresh, NOW)).toBe("ok");
    expect(checkCodeState(fresh, expiresAt)).toBe("expired");
    expect(checkCodeState({ ...fresh, attempts: HANDOVER_CONFIG.maxAttempts }, NOW)).toBe("locked");
    expect(checkCodeState({ ...fresh, lockedAt: NOW }, NOW)).toBe("locked");
    expect(checkCodeState({ ...fresh, consumedAt: NOW }, NOW)).toBe("consumed");
    expect(checkCodeState({ ...fresh, consumedAt: NOW, attempts: 9 }, NOW)).toBe("consumed");
  });

  it("limite à 5 tentatives", () => {
    expect(HANDOVER_CONFIG.maxAttempts).toBe(5);
  });
});

describe("code de suivi", () => {
  it("respecte le format et évite les caractères ambigus", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const code = generateTrackingCode();
      expect(code).toMatch(TRACKING_CODE_PATTERN);
      expect(code.slice(4)).not.toMatch(/[01OIL]/);
      seen.add(code);
    }
    expect(seen.size).toBe(2000);
  });
});
