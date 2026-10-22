/**
 * Montants : toujours des entiers en unités mineures (centimes pour l'EUR, francs pour le XOF/XAF).
 * Aucun flottant dans les calculs d'argent.
 */
export const CURRENCIES = {
  XOF: { exponent: 0, label: "Franc CFA (BCEAO)" },
  XAF: { exponent: 0, label: "Franc CFA (BEAC)" },
  EUR: { exponent: 2, label: "Euro" },
  CAD: { exponent: 2, label: "Dollar canadien" },
  USD: { exponent: 2, label: "Dollar US" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrency(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export const MAX_FEE_BPS = 5000; // 50 % : garde-fou contre une mauvaise configuration

function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} doit être un entier >= 0 (reçu ${value})`);
  }
}

/** Sous-total = prix/kg × poids, arrondi au plus proche (demi vers le haut), en entiers. */
export function computeSubtotalMinor(pricePerKgMinor: number, weightGrams: number): number {
  assertNonNegativeInt("pricePerKgMinor", pricePerKgMinor);
  assertNonNegativeInt("weightGrams", weightGrams);
  const product = pricePerKgMinor * weightGrams;
  if (!Number.isSafeInteger(product)) throw new RangeError("Montant hors limites");
  return Math.floor((product + 500) / 1000);
}

/** Commission en points de base (100 bps = 1 %), arrondie au plus proche (demi vers le haut). */
export function computeFeeMinor(subtotalMinor: number, feeBps: number): number {
  assertNonNegativeInt("subtotalMinor", subtotalMinor);
  assertNonNegativeInt("feeBps", feeBps);
  if (feeBps > MAX_FEE_BPS) throw new RangeError(`feeBps > ${MAX_FEE_BPS}`);
  return Math.floor((subtotalMinor * feeBps + 5000) / 10000);
}

export interface AmountSplit {
  subtotalMinor: number;
  platformFeeMinor: number;
  providerNetMinor: number;
}

/** Invariant garanti : providerNetMinor + platformFeeMinor === subtotalMinor. */
export function splitAmounts(input: {
  pricePerKgMinor: number;
  weightGrams: number;
  feeBps: number;
}): AmountSplit {
  const subtotalMinor = computeSubtotalMinor(input.pricePerKgMinor, input.weightGrams);
  const platformFeeMinor = computeFeeMinor(subtotalMinor, input.feeBps);
  return { subtotalMinor, platformFeeMinor, providerNetMinor: subtotalMinor - platformFeeMinor };
}

export function formatMoney(minor: number, currency: CurrencyCode, locale = "fr-FR"): string {
  const { exponent } = CURRENCIES[currency];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minor / 10 ** exponent);
}

/** Convertit une saisie décimale ("12,50") en unités mineures sans passer par un flottant. */
export function parseMajorToMinor(input: string, currency: CurrencyCode): number | null {
  const { exponent } = CURRENCIES[currency];
  const trimmed = input.trim().replace(/\s/g, "");
  const pattern = exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+([.,]\\d{1,${exponent}})?$`);
  if (!pattern.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.replace(",", ".").split(".");
  const minor = Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

export function formatWeight(grams: number): string {
  return grams % 1000 === 0 ? `${grams / 1000} kg` : `${(grams / 1000).toFixed(2).replace(/\.?0+$/, "")} kg`;
}
