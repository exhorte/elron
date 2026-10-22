import { categoryPolicy } from "@/config/goods-policy";
import { CRITERIA, DEFAULT_MATCHING_CONFIG, type Criterion, type MatchingConfig } from "@/config/matching";
import { computeSubtotalMinor, type CurrencyCode } from "@/domain/money";

/**
 * Moteur de recherche/appariement déterministe (pas d'apprentissage automatique).
 *
 *   1. Filtres OBLIGATOIRES → exclusion avec raisons explicites. Un score ne les contourne jamais.
 *   2. Score transparent 0–100 sur les offres restantes, détail par critère exposé.
 *   3. Informations manquantes → drapeaux affichables (« arrivée non déclarée », …), jamais cachées.
 */

export type ExclusionReason =
  | "own_offer"
  | "offer_not_published"
  | "provider_not_active"
  | "route_mismatch"
  | "already_departed"
  | "deposit_cutoff_passed"
  | "before_earliest_departure"
  | "after_latest_departure"
  | "insufficient_weight"
  | "insufficient_volume"
  | "category_not_accepted"
  | "category_prohibited"
  | "over_budget_strict"
  | "after_deadline_strict";

export type MatchFlag =
  | "arrival_unknown"
  | "volume_unknown"
  | "no_history"
  | "identity_unverified"
  | "price_not_comparable"
  | "over_budget"
  | "budget_currency_differs"
  | "review_category"
  | "after_deadline";

export interface MatchRequest {
  senderUserId: string;
  routeId: string;
  weightG: number;
  volumeL: number | null;
  /** null = catégorie non précisée (recherche exploratoire) : aucun filtre de catégorie. */
  category: string | null;
  budgetMaxMinor: number | null;
  budgetCurrency: CurrencyCode | null;
  budgetIsStrict: boolean;
  earliestDepartureAt: Date | null;
  latestDepartureAt: Date | null;
  neededBy: Date | null;
  deadlineIsStrict: boolean;
}

export interface ProviderStats {
  /** Colis livrés avec succès. */
  completed: number;
  /** Colis perdus, endommagés ou en litige. */
  incidents: number;
}

export interface MatchOffer {
  id: string;
  providerUserId: string;
  routeId: string;
  status: "published" | "closed" | "cancelled";
  providerActive: boolean;
  departureAt: Date;
  arrivalEstimatedAt: Date | null;
  depositCutoffAt: Date | null;
  capacityWeightG: number;
  reservedWeightG: number;
  capacityVolumeL: number | null;
  reservedVolumeL: number;
  pricePerKgMinor: number;
  currency: CurrencyCode;
  acceptedCategories: readonly string[];
  identityVerified: boolean;
  stats: ProviderStats;
}

export interface RankedOffer {
  offerId: string;
  score: number; // 0–100
  totalMinor: number;
  currency: CurrencyCode;
  breakdown: Record<Criterion, { value: number; weight: number }>;
  flags: MatchFlag[];
}

export interface MatchOutcome {
  matches: RankedOffer[];
  excluded: Array<{ offerId: string; reasons: ExclusionReason[] }>;
  configVersion: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Raisons d'exclusion obligatoires (vide = compatible). */
export function exclusionReasons(request: MatchRequest, offer: MatchOffer, now: Date): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];
  if (offer.providerUserId === request.senderUserId) reasons.push("own_offer");
  if (offer.status !== "published") reasons.push("offer_not_published");
  if (!offer.providerActive) reasons.push("provider_not_active");
  if (offer.routeId !== request.routeId) reasons.push("route_mismatch");
  if (offer.departureAt.getTime() <= now.getTime()) reasons.push("already_departed");
  if (offer.depositCutoffAt && offer.depositCutoffAt.getTime() <= now.getTime()) reasons.push("deposit_cutoff_passed");
  if (request.earliestDepartureAt && offer.departureAt < request.earliestDepartureAt) {
    reasons.push("before_earliest_departure");
  }
  if (request.latestDepartureAt && offer.departureAt > request.latestDepartureAt) {
    reasons.push("after_latest_departure");
  }
  if (offer.capacityWeightG - offer.reservedWeightG < request.weightG) reasons.push("insufficient_weight");
  if (
    request.volumeL !== null &&
    offer.capacityVolumeL !== null &&
    offer.capacityVolumeL - offer.reservedVolumeL < request.volumeL
  ) {
    reasons.push("insufficient_volume");
  }
  if (request.category !== null) {
    if (categoryPolicy(request.category) === "prohibited") reasons.push("category_prohibited");
    else if (!offer.acceptedCategories.includes(request.category)) reasons.push("category_not_accepted");
  }

  const total = computeSubtotalMinor(offer.pricePerKgMinor, request.weightG);
  if (
    request.budgetIsStrict &&
    request.budgetMaxMinor !== null &&
    request.budgetCurrency === offer.currency &&
    total > request.budgetMaxMinor
  ) {
    reasons.push("over_budget_strict");
  }
  if (
    request.deadlineIsStrict &&
    request.neededBy &&
    offer.arrivalEstimatedAt &&
    offer.arrivalEstimatedAt > request.neededBy
  ) {
    reasons.push("after_deadline_strict");
  }
  return reasons;
}

export function rankOffers(
  request: MatchRequest,
  offers: readonly MatchOffer[],
  now: Date,
  config: MatchingConfig = DEFAULT_MATCHING_CONFIG,
): MatchOutcome {
  const excluded: MatchOutcome["excluded"] = [];
  const compatible: MatchOffer[] = [];
  for (const offer of offers) {
    const reasons = exclusionReasons(request, offer, now);
    if (reasons.length > 0) excluded.push({ offerId: offer.id, reasons });
    else compatible.push(offer);
  }

  const totals = new Map(compatible.map((o) => [o.id, computeSubtotalMinor(o.pricePerKgMinor, request.weightG)]));
  const currencies = new Set(compatible.map((o) => o.currency));
  const minTotalByCurrency = new Map<CurrencyCode, number>();
  for (const o of compatible) {
    const t = totals.get(o.id)!;
    const current = minTotalByCurrency.get(o.currency);
    if (current === undefined || t < current) minTotalByCurrency.set(o.currency, t);
  }
  const durations = compatible.map((o) => (o.arrivalEstimatedAt ? o.arrivalEstimatedAt.getTime() - o.departureAt.getTime() : null));
  const knownDurations = durations.filter((d): d is number => d !== null && d > 0);
  const minDuration = knownDurations.length > 0 ? Math.min(...knownDurations) : null;

  const weightSum = CRITERIA.reduce((acc, c) => acc + config.weights[c], 0);
  const reference = request.earliestDepartureAt ?? now;
  const ranked: RankedOffer[] = compatible.map((offer, index) => {
    const total = totals.get(offer.id)!;
    const flags: MatchFlag[] = [];

    // prix : relatif à l'offre la moins chère de la même devise (aucune conversion de devises en MVP)
    const minTotal = minTotalByCurrency.get(offer.currency)!;
    const price = total === 0 ? 1 : clamp01(minTotal / total);
    if (currencies.size > 1) flags.push("price_not_comparable");
    if (request.budgetMaxMinor !== null) {
      if (request.budgetCurrency !== offer.currency) flags.push("budget_currency_differs");
      else if (total > request.budgetMaxMinor) flags.push("over_budget");
    }

    // proximité de la date de départ avec la date souhaitée
    const daysApart = Math.abs(offer.departureAt.getTime() - reference.getTime()) / DAY_MS;
    const dateProximity = clamp01(1 - daysApart / config.dateProximityHorizonDays);

    // fiabilité : lissage de Laplace (a priori neutre 0,5 sans historique)
    const { completed, incidents } = offer.stats;
    const reliability = (completed + 1) / (completed + incidents + 2);
    if (completed + incidents === 0) flags.push("no_history");
    if (!offer.identityVerified) flags.push("identity_unverified");

    // délai : par rapport à l'échéance si connue, sinon relatif à l'offre la plus rapide ; inconnu = neutre
    let delay = 0.5;
    const duration = durations[index];
    if (!offer.arrivalEstimatedAt) {
      flags.push("arrival_unknown");
    } else if (request.neededBy) {
      const onTime = offer.arrivalEstimatedAt <= request.neededBy;
      delay = onTime ? 1 : 0;
      if (!onTime) flags.push("after_deadline");
    } else if (minDuration !== null && duration !== null && duration > 0) {
      delay = clamp01(minDuration / duration);
    }

    // marge de capacité restante par rapport au besoin (réduit le risque de conflit de réservation)
    const available = offer.capacityWeightG - offer.reservedWeightG;
    const headroom = clamp01((available - request.weightG) / request.weightG / config.headroomCapRatio);
    if (request.volumeL !== null && offer.capacityVolumeL === null) flags.push("volume_unknown");
    if (request.category !== null && categoryPolicy(request.category) === "review") flags.push("review_category");

    const values: Record<Criterion, number> = { price, dateProximity, reliability, delay, headroom };
    const breakdown = Object.fromEntries(
      CRITERIA.map((c) => [c, { value: round3(values[c]), weight: config.weights[c] }]),
    ) as RankedOffer["breakdown"];
    const score = weightSum === 0 ? 0 : Math.round((100 * CRITERIA.reduce((acc, c) => acc + config.weights[c] * values[c], 0)) / weightSum);
    return { offerId: offer.id, score, totalMinor: total, currency: offer.currency, breakdown, flags };
  });

  const departures = new Map(compatible.map((o) => [o.id, o.departureAt.getTime()]));
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      departures.get(a.offerId)! - departures.get(b.offerId)! ||
      a.offerId.localeCompare(b.offerId),
  );
  return { matches: ranked, excluded, configVersion: config.version };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
