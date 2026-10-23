import { describe, expect, it } from "vitest";
import { CRITERIA, DEFAULT_MATCHING_CONFIG, type MatchingConfig } from "@/config/matching";
import { exclusionReasons, rankOffers, type ExclusionReason, type MatchOffer, type MatchRequest } from "@/domain/matching";

const NOW = new Date("2026-11-01T10:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

const request = (o: Partial<MatchRequest> = {}): MatchRequest => ({
  senderUserId: "sender",
  routeId: "r1",
  weightG: 5000,
  volumeL: null,
  category: "clothing",
  budgetMaxMinor: null,
  budgetCurrency: null,
  budgetIsStrict: false,
  earliestDepartureAt: null,
  latestDepartureAt: null,
  neededBy: null,
  deadlineIsStrict: false,
  ...o,
});

const offer = (id: string, o: Partial<MatchOffer> = {}): MatchOffer => ({
  id,
  providerUserId: `provider-${id}`,
  routeId: "r1",
  status: "published",
  providerActive: true,
  departureAt: at(3),
  arrivalEstimatedAt: at(4),
  depositCutoffAt: at(2),
  capacityWeightG: 20_000,
  reservedWeightG: 0,
  capacityVolumeL: null,
  reservedVolumeL: 0,
  pricePerKgMinor: 3500,
  currency: "XOF",
  acceptedCategories: ["clothing", "books_misc"],
  identityVerified: false,
  stats: { completed: 0, incidents: 0 },
  ...o,
});

describe("filtres obligatoires", () => {
  it("accepte une offre pleinement compatible", () => {
    expect(exclusionReasons(request(), offer("a"), NOW)).toEqual([]);
  });

  const cases: Array<[ExclusionReason, Partial<MatchOffer>, Partial<MatchRequest>?]> = [
    ["own_offer", { providerUserId: "sender" }],
    ["offer_not_published", { status: "cancelled" }],
    ["provider_not_active", { providerActive: false }],
    ["route_mismatch", { routeId: "autre" }],
    ["already_departed", { departureAt: at(-1) }],
    ["deposit_cutoff_passed", { depositCutoffAt: at(-0.1) }],
    ["before_earliest_departure", {}, { earliestDepartureAt: at(5) }],
    ["after_latest_departure", {}, { latestDepartureAt: at(2) }],
    ["insufficient_weight", { capacityWeightG: 10_000, reservedWeightG: 6000 }],
    ["insufficient_volume", { capacityVolumeL: 10, reservedVolumeL: 0 }, { volumeL: 20 }],
    ["category_not_accepted", { acceptedCategories: ["books_misc"] }],
    ["category_prohibited", { acceptedCategories: ["weapons_ammunition", "clothing"] }, { category: "weapons_ammunition" }],
    ["over_budget_strict", {}, { budgetMaxMinor: 1000, budgetCurrency: "XOF", budgetIsStrict: true }],
    ["after_deadline_strict", { arrivalEstimatedAt: at(9) }, { neededBy: at(6), deadlineIsStrict: true }],
  ];

  it.each(cases)("exclut : %s", (reason, offerOverride, requestOverride) => {
    const reasons = exclusionReasons(request(requestOverride), offer("a", offerOverride), NOW);
    expect(reasons).toContain(reason);
  });

  it("exclut une offre au poids exactement insuffisant mais accepte un ajustement exact", () => {
    expect(exclusionReasons(request({ weightG: 5000 }), offer("a", { capacityWeightG: 5000 }), NOW)).toEqual([]);
    expect(exclusionReasons(request({ weightG: 5001 }), offer("a", { capacityWeightG: 5000 }), NOW)).toContain("insufficient_weight");
  });

  it("une catégorie interdite n'est jamais compatible, même si l'offre la liste", () => {
    const outcome = rankOffers(request({ category: "illicit_drugs" }), [offer("a", { acceptedCategories: ["illicit_drugs"] })], NOW);
    expect(outcome.matches).toHaveLength(0);
    expect(outcome.excluded[0]!.reasons).toContain("category_prohibited");
  });

  it("n'applique pas le budget strict quand les devises diffèrent (aucune conversion en MVP)", () => {
    const req = request({ budgetMaxMinor: 100, budgetCurrency: "EUR", budgetIsStrict: true });
    expect(exclusionReasons(req, offer("a"), NOW)).not.toContain("over_budget_strict");
    const outcome = rankOffers(req, [offer("a")], NOW);
    expect(outcome.matches[0]!.flags).toContain("budget_currency_differs");
  });

  it("une arrivée inconnue n'exclut pas, même avec échéance stricte (signalée à l'utilisateur)", () => {
    const req = request({ neededBy: at(6), deadlineIsStrict: true });
    const outcome = rankOffers(req, [offer("a", { arrivalEstimatedAt: null })], NOW);
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.matches[0]!.flags).toContain("arrival_unknown");
  });

  it("liste toutes les raisons d'exclusion (transparence)", () => {
    const outcome = rankOffers(request(), [offer("a", { status: "closed", capacityWeightG: 1000, acceptedCategories: ["books_misc"] })], NOW);
    expect(outcome.excluded[0]!.reasons.sort()).toEqual(["category_not_accepted", "insufficient_weight", "offer_not_published"]);
  });
});

describe("score transparent", () => {
  it("expose un score 0–100 et le détail de chaque critère", () => {
    const [m] = rankOffers(request(), [offer("a")], NOW).matches;
    expect(m!.score).toBeGreaterThanOrEqual(0);
    expect(m!.score).toBeLessThanOrEqual(100);
    for (const c of CRITERIA) {
      expect(m!.breakdown[c].value).toBeGreaterThanOrEqual(0);
      expect(m!.breakdown[c].value).toBeLessThanOrEqual(1);
      expect(m!.breakdown[c].weight).toBe(DEFAULT_MATCHING_CONFIG.weights[c]);
    }
    expect(m!.totalMinor).toBe(17_500);
  });

  it("classe l'offre la moins chère devant, à égalité du reste", () => {
    const outcome = rankOffers(request(), [offer("cher", { pricePerKgMinor: 5000 }), offer("pas-cher", { pricePerKgMinor: 2500 })], NOW);
    expect(outcome.matches.map((m) => m.offerId)).toEqual(["pas-cher", "cher"]);
    expect(outcome.matches[0]!.breakdown.price.value).toBe(1);
  });

  it("valorise l'historique fiable, pénalise les incidents, signale l'absence d'historique", () => {
    const outcome = rankOffers(
      request(),
      [
        offer("neuf"),
        offer("fiable", { stats: { completed: 20, incidents: 0 } }),
        offer("risque", { stats: { completed: 2, incidents: 8 } }),
      ],
      NOW,
    );
    expect(outcome.matches.map((m) => m.offerId)).toEqual(["fiable", "neuf", "risque"]);
    expect(outcome.matches.find((m) => m.offerId === "neuf")!.flags).toContain("no_history");
    expect(outcome.matches.find((m) => m.offerId === "neuf")!.breakdown.reliability.value).toBe(0.5);
  });

  it("mélange les avis au taux de livraisons dans la fiabilité, sans jamais exclure", () => {
    const rated = (sum: number, count: number) => offer(`r${count}-${sum}`, { stats: { completed: 0, incidents: 0, ratings: { count, sum } } });
    const reliability = (o: MatchOffer, config?: MatchingConfig) => rankOffers(request(), [o], NOW, config).matches[0]!.breakdown.reliability.value;

    expect(reliability(offer("sans-avis"))).toBe(0.5);
    // beaucoup de 5/5 → fiabilité élevée ; beaucoup de 1/5 → faible
    expect(reliability(rated(100, 20))).toBeGreaterThan(0.65);
    expect(reliability(rated(20, 20))).toBeLessThan(0.4);
    // un seul 5/5 est tiré vers le neutre (moyenne bayésienne) : meilleur que rien, mais loin du maximum
    const one = reliability(rated(5, 1));
    expect(one).toBeGreaterThan(0.5);
    expect(one).toBeLessThan(reliability(rated(100, 20)));
    // une part d'avis nulle les ignore
    const ignore: MatchingConfig = { ...DEFAULT_MATCHING_CONFIG, reliabilityRatingShare: 0 };
    expect(reliability(rated(100, 20), ignore)).toBe(0.5);
    // des avis sans livraison enlèvent le drapeau « aucun historique »
    const flags = rankOffers(request(), [rated(5, 1)], NOW).matches[0]!.flags;
    expect(flags).not.toContain("no_history");
    expect(rankOffers(request(), [rated(2, 1)], NOW).matches).toHaveLength(1);
  });

  it("signale l'identité non vérifiée sans l'utiliser comme filtre", () => {
    const outcome = rankOffers(request(), [offer("a", { identityVerified: false }), offer("b", { identityVerified: true })], NOW);
    expect(outcome.matches).toHaveLength(2);
    expect(outcome.matches.find((m) => m.offerId === "a")!.flags).toContain("identity_unverified");
    expect(outcome.matches.find((m) => m.offerId === "b")!.flags).not.toContain("identity_unverified");
  });

  it("signale prix non comparables quand les devises diffèrent", () => {
    const outcome = rankOffers(request(), [offer("a"), offer("b", { currency: "EUR", pricePerKgMinor: 800 })], NOW);
    for (const m of outcome.matches) expect(m.flags).toContain("price_not_comparable");
  });

  it("signale le dépassement de budget non strict et l'échéance dépassée", () => {
    const req = request({ budgetMaxMinor: 10_000, budgetCurrency: "XOF", neededBy: at(3.5) });
    const [m] = rankOffers(req, [offer("a")], NOW).matches;
    expect(m!.flags).toContain("over_budget");
    expect(m!.flags).toContain("after_deadline");
    expect(m!.breakdown.delay.value).toBe(0);
  });

  it("signale une catégorie à vérification et un volume non renseigné", () => {
    const req = request({ category: "electronics", volumeL: 10 });
    const [m] = rankOffers(req, [offer("a", { acceptedCategories: ["electronics"] })], NOW).matches;
    expect(m!.flags).toContain("review_category");
    expect(m!.flags).toContain("volume_unknown");
  });

  it("les pondérations sont configurables et changent le classement", () => {
    const offers = [
      offer("cheap-new", { pricePerKgMinor: 2000 }),
      offer("pricey-reliable", { pricePerKgMinor: 4000, stats: { completed: 50, incidents: 0 } }),
    ];
    const priceFirst: MatchingConfig = { ...DEFAULT_MATCHING_CONFIG, weights: { price: 100, dateProximity: 0, reliability: 0, delay: 0, headroom: 0 } };
    const trustFirst: MatchingConfig = { ...DEFAULT_MATCHING_CONFIG, weights: { price: 0, dateProximity: 0, reliability: 100, delay: 0, headroom: 0 } };
    expect(rankOffers(request(), offers, NOW, priceFirst).matches[0]!.offerId).toBe("cheap-new");
    expect(rankOffers(request(), offers, NOW, trustFirst).matches[0]!.offerId).toBe("pricey-reliable");
  });

  it("est invariant à l'échelle des pondérations", () => {
    const offers = [offer("a"), offer("b", { pricePerKgMinor: 2500 })];
    const scaled: MatchingConfig = {
      ...DEFAULT_MATCHING_CONFIG,
      weights: Object.fromEntries(CRITERIA.map((c) => [c, DEFAULT_MATCHING_CONFIG.weights[c] * 10])) as MatchingConfig["weights"],
    };
    const a = rankOffers(request(), offers, NOW).matches.map((m) => [m.offerId, m.score]);
    const b = rankOffers(request(), offers, NOW, scaled).matches.map((m) => [m.offerId, m.score]);
    expect(b).toEqual(a);
  });

  it("est déterministe quel que soit l'ordre d'entrée (départage par départ puis identifiant)", () => {
    const offers = [offer("c"), offer("a"), offer("b", { departureAt: at(2.5), depositCutoffAt: at(2) })];
    const orders = [offers, [...offers].reverse(), [offers[1]!, offers[2]!, offers[0]!]];
    const results = orders.map((o) => rankOffers(request(), o, NOW).matches.map((m) => m.offerId));
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it("un très bon score ne peut jamais réintégrer une offre exclue", () => {
    const perfectButTooSmall = offer("parfaite", { pricePerKgMinor: 0, capacityWeightG: 1000, stats: { completed: 99, incidents: 0 }, identityVerified: true });
    const outcome = rankOffers(request(), [perfectButTooSmall, offer("moyenne", { pricePerKgMinor: 9000 })], NOW);
    expect(outcome.matches.map((m) => m.offerId)).toEqual(["moyenne"]);
    expect(outcome.excluded.map((e) => e.offerId)).toEqual(["parfaite"]);
  });

  it("valorise la marge de capacité et la proximité de date", () => {
    const outcome = rankOffers(
      request({ earliestDepartureAt: at(3) }),
      [offer("juste", { capacityWeightG: 5000 }), offer("large", { capacityWeightG: 20_000 })],
      NOW,
    );
    expect(outcome.matches.find((m) => m.offerId === "large")!.breakdown.headroom.value).toBe(1);
    expect(outcome.matches.find((m) => m.offerId === "juste")!.breakdown.headroom.value).toBe(0);
    const far = rankOffers(request({ earliestDepartureAt: at(3) }), [offer("proche", { departureAt: at(3) }), offer("loin", { departureAt: at(17), arrivalEstimatedAt: at(18) })], NOW);
    expect(far.matches.find((m) => m.offerId === "proche")!.breakdown.dateProximity.value).toBe(1);
    expect(far.matches.find((m) => m.offerId === "loin")!.breakdown.dateProximity.value).toBe(0);
  });

  it("sans catégorie précisée (recherche exploratoire), aucun filtre de catégorie", () => {
    const outcome = rankOffers(request({ category: null }), [offer("a", { acceptedCategories: ["books_misc"] })], NOW);
    expect(outcome.matches).toHaveLength(1);
  });

  it("renvoie la version de configuration utilisée", () => {
    expect(rankOffers(request(), [], NOW).configVersion).toBe(DEFAULT_MATCHING_CONFIG.version);
  });
});
