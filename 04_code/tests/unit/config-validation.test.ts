import { describe, expect, it } from "vitest";
import { getDeliveryCodePepper, getPlatformFeeBps, showDemoByDefault } from "@/config/app";
import { GOODS_CATEGORIES, OFFERABLE_CATEGORIES, categoryPolicy, isGoodsCategory } from "@/config/goods-policy";
import { DEFAULT_MATCHING_CONFIG, loadMatchingConfig } from "@/config/matching";
import { CITIES, ENABLED_ROUTES, routeId } from "@/config/cities";
import {
  bookingCreateSchema,
  confirmDeliverySchema,
  loginSchema,
  offerCreateSchema,
  registerSchema,
  requestCreateSchema,
  searchQuerySchema,
  transitionSchema,
} from "@/server/validation";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("configuration", () => {
  it("exige un pepper robuste en production, tolère un repli non secret en dev", () => {
    expect(() => getDeliveryCodePepper(env({ NODE_ENV: "production" }))).toThrow();
    expect(() => getDeliveryCodePepper(env({ NODE_ENV: "production", DELIVERY_CODE_PEPPER: "court" }))).toThrow();
    expect(getDeliveryCodePepper(env({ NODE_ENV: "production", DELIVERY_CODE_PEPPER: "x".repeat(32) }))).toBe("x".repeat(32));
    expect(getDeliveryCodePepper(env({ NODE_ENV: "development" })).length).toBeGreaterThan(10);
  });

  it("valide la commission", () => {
    expect(getPlatformFeeBps(env({}))).toBe(0);
    expect(getPlatformFeeBps(env({ PLATFORM_FEE_BPS: "500" }))).toBe(500);
    expect(() => getPlatformFeeBps(env({ PLATFORM_FEE_BPS: "-1" }))).toThrow();
    expect(() => getPlatformFeeBps(env({ PLATFORM_FEE_BPS: "9000" }))).toThrow();
    expect(() => getPlatformFeeBps(env({ PLATFORM_FEE_BPS: "abc" }))).toThrow();
  });

  it("n'affiche pas le démo par défaut", () => {
    expect(showDemoByDefault(env({}))).toBe(false);
    expect(showDemoByDefault(env({ ALX_SHOW_DEMO: "true" }))).toBe(true);
  });

  it("charge et valide les pondérations depuis l'environnement", () => {
    expect(loadMatchingConfig(env({}))).toBe(DEFAULT_MATCHING_CONFIG);
    const custom = loadMatchingConfig(env({ ALX_MATCHING_WEIGHTS: JSON.stringify({ price: 1, dateProximity: 1, reliability: 1, delay: 1, headroom: 1 }) }));
    expect(custom.weights.price).toBe(1);
    expect(custom.version).toContain("+env");
    expect(() => loadMatchingConfig(env({ ALX_MATCHING_WEIGHTS: JSON.stringify({ price: 0, dateProximity: 0, reliability: 0, delay: 0, headroom: 0 }) }))).toThrow();
    expect(() => loadMatchingConfig(env({ ALX_MATCHING_WEIGHTS: JSON.stringify({ price: -1, dateProximity: 1, reliability: 1, delay: 1, headroom: 1 }) }))).toThrow();
    expect(() => loadMatchingConfig(env({ ALX_MATCHING_WEIGHTS: "pas du json" }))).toThrow();
  });

  it("distingue marchandises autorisées, à vérifier et interdites", () => {
    expect(categoryPolicy("clothing")).toBe("allowed");
    expect(categoryPolicy("electronics")).toBe("review");
    expect(categoryPolicy("weapons_ammunition")).toBe("prohibited");
    expect(categoryPolicy("inconnue")).toBeNull();
    expect(isGoodsCategory("clothing")).toBe(true);
    expect(isGoodsCategory("toString")).toBe(false);
    expect(OFFERABLE_CATEGORIES.every((c) => (c.policy as string) !== "prohibited")).toBe(true);
    expect(GOODS_CATEGORIES.filter((c) => c.policy === "prohibited").length).toBeGreaterThan(0);
  });

  it("référentiel géographique cohérent : couloirs entre villes connues, distinctes", () => {
    const ids = new Set(CITIES.map((c) => c.id));
    for (const [o, d] of ENABLED_ROUTES) {
      expect(ids.has(o) && ids.has(d)).toBe(true);
      expect(o).not.toBe(d);
    }
    expect(routeId("sn-dakar", "ci-abidjan")).toBe("sn-dakar--ci-abidjan");
  });
});

describe("validation des entrées", () => {
  const validRegister = { email: "  Fatou@Example.TEST ", password: "motdepasse-long", displayName: "Fatou" };

  it("normalise l'e-mail et applique les valeurs par défaut", () => {
    const parsed = registerSchema.parse(validRegister);
    expect(parsed.email).toBe("fatou@example.test");
    expect(parsed.asTraveler).toBe(false);
  });

  it("refuse mot de passe court, e-mail invalide et champs inconnus (mass-assignment)", () => {
    expect(registerSchema.safeParse({ ...validRegister, password: "court" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...validRegister, email: "pas-un-email" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...validRegister, platformRole: "admin" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x", extra: 1 }).success).toBe(false);
  });

  it("normalise les numéros de téléphone", () => {
    const parsed = registerSchema.parse({ ...validRegister, phone: "+221 77 123-45.67" });
    expect(parsed.phone).toBe("+221771234567");
    expect(registerSchema.safeParse({ ...validRegister, phone: "abc" }).success).toBe(false);
  });

  const validOffer = {
    originCityId: "sn-dakar",
    destinationCityId: "ci-abidjan",
    transportMode: "air",
    departureAt: "2026-12-01T10:00:00Z",
    capacityWeightG: 20000,
    pricePerKgMinor: 3500,
    currency: "XOF",
    acceptedCategories: ["clothing"],
  };

  it("valide une offre et convertit les dates", () => {
    const parsed = offerCreateSchema.parse(validOffer);
    expect(parsed.departureAt).toBeInstanceOf(Date);
  });

  it("refuse capacité nulle, prix négatif/non entier, devise inconnue, catégorie inconnue, liste vide", () => {
    expect(offerCreateSchema.safeParse({ ...validOffer, capacityWeightG: 0 }).success).toBe(false);
    expect(offerCreateSchema.safeParse({ ...validOffer, pricePerKgMinor: -1 }).success).toBe(false);
    expect(offerCreateSchema.safeParse({ ...validOffer, pricePerKgMinor: 10.5 }).success).toBe(false);
    expect(offerCreateSchema.safeParse({ ...validOffer, currency: "BTC" }).success).toBe(false);
    expect(offerCreateSchema.safeParse({ ...validOffer, acceptedCategories: ["armes_nucleaires"] }).success).toBe(false);
    expect(offerCreateSchema.safeParse({ ...validOffer, acceptedCategories: [] }).success).toBe(false);
    expect(offerCreateSchema.safeParse({ ...validOffer, departureAt: "demain" }).success).toBe(false);
    expect(offerCreateSchema.safeParse({ ...validOffer, providerUserId: "x" }).success).toBe(false);
  });

  const validRequest = {
    originCityId: "sn-dakar",
    destinationCityId: "ci-abidjan",
    weightG: 5000,
    category: "clothing",
    description: "Vêtements",
    receiverName: "Awa Koné",
    receiverPhone: "+225 07 00 00 00",
  };

  it("valide une demande et applique les défauts", () => {
    const parsed = requestCreateSchema.parse(validRequest);
    expect(parsed.items).toEqual([]);
    expect(parsed.budgetIsStrict).toBe(false);
    expect(parsed.receiverPhone).toBe("+2250700000" + "0");
  });

  it("refuse les incohérences : dimensions partielles, budget sans devise, valeur sans devise, fenêtres inversées, strict sans valeur", () => {
    expect(requestCreateSchema.safeParse({ ...validRequest, lengthCm: 10 }).success).toBe(false);
    expect(requestCreateSchema.safeParse({ ...validRequest, lengthCm: 10, widthCm: 10, heightCm: 10 }).success).toBe(true);
    expect(requestCreateSchema.safeParse({ ...validRequest, budgetMaxMinor: 1000 }).success).toBe(false);
    expect(requestCreateSchema.safeParse({ ...validRequest, declaredValueMinor: 1000 }).success).toBe(false);
    expect(
      requestCreateSchema.safeParse({ ...validRequest, earliestDepartureAt: "2026-12-10T00:00:00Z", latestDepartureAt: "2026-12-01T00:00:00Z" }).success,
    ).toBe(false);
    expect(requestCreateSchema.safeParse({ ...validRequest, budgetIsStrict: true }).success).toBe(false);
    expect(requestCreateSchema.safeParse({ ...validRequest, deadlineIsStrict: true }).success).toBe(false);
    expect(requestCreateSchema.safeParse({ ...validRequest, weightG: 0 }).success).toBe(false);
    expect(requestCreateSchema.safeParse({ ...validRequest, senderUserId: "x" }).success).toBe(false);
  });

  it("valide réservation, transition, code de remise et recherche", () => {
    const id = "6f1c2f0e-3d62-4b8e-9d0a-0a2c8b1d5e11";
    expect(bookingCreateSchema.safeParse({ requestId: id, offerId: id }).success).toBe(true);
    expect(bookingCreateSchema.safeParse({ requestId: "pas-un-uuid", offerId: id }).success).toBe(false);
    expect(transitionSchema.safeParse({ to: "IN_TRANSIT" }).success).toBe(true);
    expect(transitionSchema.safeParse({ to: "TELEPORTE" }).success).toBe(false);
    expect(confirmDeliverySchema.safeParse({ code: "123456" }).success).toBe(true);
    expect(confirmDeliverySchema.safeParse({ code: "12345" }).success).toBe(false);
    expect(confirmDeliverySchema.safeParse({ code: "12345a" }).success).toBe(false);
    const q = searchQuerySchema.parse({ origin: "sn-dakar", destination: "ci-abidjan", weightKg: "5.5", demo: "1" });
    expect(q.weightKg).toBe(5.5);
    expect(q.demo).toBe(true);
    expect(searchQuerySchema.safeParse({ origin: "sn-dakar", destination: "ci-abidjan", weightKg: "0" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ origin: "x", destination: "ci-abidjan", weightKg: "1" }).success).toBe(false);
  });
});
