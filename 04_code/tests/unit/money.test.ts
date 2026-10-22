import { describe, expect, it } from "vitest";
import {
  computeFeeMinor,
  computeSubtotalMinor,
  formatMoney,
  formatWeight,
  isCurrency,
  parseMajorToMinor,
  splitAmounts,
} from "@/domain/money";

describe("computeSubtotalMinor", () => {
  it("multiplie prix/kg et poids en entiers", () => {
    expect(computeSubtotalMinor(3500, 5000)).toBe(17_500);
    expect(computeSubtotalMinor(3500, 1000)).toBe(3500);
    expect(computeSubtotalMinor(0, 5000)).toBe(0);
  });

  it("arrondit au plus proche, demi vers le haut", () => {
    expect(computeSubtotalMinor(333, 500)).toBe(167); // 166,5
    expect(computeSubtotalMinor(333, 501)).toBe(167); // 166,833
    expect(computeSubtotalMinor(333, 499)).toBe(166); // 166,167
  });

  it("refuse les valeurs négatives ou non entières", () => {
    expect(() => computeSubtotalMinor(-1, 1000)).toThrow(RangeError);
    expect(() => computeSubtotalMinor(100, 1.5)).toThrow(RangeError);
    expect(() => computeSubtotalMinor(Number.MAX_SAFE_INTEGER, 1000)).toThrow(RangeError);
  });
});

describe("computeFeeMinor / splitAmounts", () => {
  it("calcule la commission en points de base", () => {
    expect(computeFeeMinor(17_500, 500)).toBe(875);
    expect(computeFeeMinor(150, 100)).toBe(2); // 1,5 → 2
    expect(computeFeeMinor(17_500, 0)).toBe(0);
  });

  it("refuse une commission aberrante", () => {
    expect(() => computeFeeMinor(1000, 5001)).toThrow(RangeError);
    expect(() => computeFeeMinor(1000, -1)).toThrow(RangeError);
  });

  it("conserve toujours net + commission = sous-total (cohérence des montants)", () => {
    for (let price = 0; price <= 12_000; price += 997) {
      for (const weight of [1, 99, 250, 999, 1000, 4999, 12_345, 100_000]) {
        for (const feeBps of [0, 1, 99, 500, 1000, 2500, 5000]) {
          const split = splitAmounts({ pricePerKgMinor: price, weightGrams: weight, feeBps });
          expect(split.providerNetMinor + split.platformFeeMinor).toBe(split.subtotalMinor);
          expect(split.platformFeeMinor).toBeGreaterThanOrEqual(0);
          expect(split.providerNetMinor).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(split.subtotalMinor)).toBe(true);
        }
      }
    }
  });
});

describe("parseMajorToMinor", () => {
  it("convertit sans flottant", () => {
    expect(parseMajorToMinor("12,50", "EUR")).toBe(1250);
    expect(parseMajorToMinor("12.5", "EUR")).toBe(1250);
    expect(parseMajorToMinor("12", "EUR")).toBe(1200);
    expect(parseMajorToMinor("0.07", "EUR")).toBe(7);
    expect(parseMajorToMinor("3 500", "XOF")).toBe(3500);
  });

  it("rejette les saisies invalides ou trop précises", () => {
    expect(parseMajorToMinor("12.5", "XOF")).toBeNull();
    expect(parseMajorToMinor("1.234", "EUR")).toBeNull();
    expect(parseMajorToMinor("abc", "EUR")).toBeNull();
    expect(parseMajorToMinor("-5", "EUR")).toBeNull();
    expect(parseMajorToMinor("", "EUR")).toBeNull();
  });
});

describe("formats et devises", () => {
  it("formate selon l'exposant de la devise", () => {
    const eur = formatMoney(350_000, "EUR").replace(/[  ]/g, " ");
    expect(eur).toContain("3 500,00");
    const xof = formatMoney(3500, "XOF").replace(/[  ]/g, " ");
    expect(xof).toContain("3 500");
    expect(xof).not.toContain(",00");
  });

  it("formate les poids", () => {
    expect(formatWeight(5000)).toBe("5 kg");
    expect(formatWeight(5500)).toBe("5.5 kg");
    expect(formatWeight(250)).toBe("0.25 kg");
  });

  it("reconnaît les devises supportées", () => {
    expect(isCurrency("XOF")).toBe(true);
    expect(isCurrency("EUR")).toBe(true);
    expect(isCurrency("BTC")).toBe(false);
    expect(isCurrency("toString")).toBe(false);
  });
});
