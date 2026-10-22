import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { showDemoByDefault } from "@/config/app";
import { loadMatchingConfig } from "@/config/matching";
import { schema, type Db } from "@/db/client";
import { rankOffers, type MatchOffer, type MatchOutcome, type MatchRequest, type ProviderStats, type RankedOffer } from "@/domain/matching";
import type { CurrencyCode } from "@/domain/money";
import type { Actor } from "./actor";
import { requireEnabledRoute } from "./geo";
import { toOfferViews, type OfferRow, type OfferView } from "./offers";
import { getRequestForActor, type RequestRow } from "./requests";
import type { SearchQuery } from "./validation";

const { capacityOffers, users, travelerProfiles, shipments } = schema;

const ANONYMOUS_SENDER = "00000000-0000-0000-0000-000000000000";

export interface SearchResult {
  offer: OfferView;
  match: RankedOffer;
}

export interface SearchResponse {
  results: SearchResult[];
  excludedCount: number;
  /** Présent uniquement avec `explain` : raisons d'exclusion par offre (transparence). */
  excluded?: MatchOutcome["excluded"];
  scoring: { configVersion: string; weights: Record<string, number>; validated: false };
  dataset: "real" | "demo";
}

interface Candidate {
  offer: OfferRow;
  providerName: string;
  providerActive: boolean;
  identityStatus: string | null;
  stats: ProviderStats;
}

/** Offres publiées d'un couloir, dans un seul jeu de données (réel OU démo, jamais mélangés). */
export async function loadCandidates(db: Db, routeId: string, now: Date, demo: boolean): Promise<Candidate[]> {
  const rows = await db
    .select({
      offer: capacityOffers,
      providerName: users.displayName,
      providerStatus: users.status,
      identityStatus: travelerProfiles.identityStatus,
    })
    .from(capacityOffers)
    .innerJoin(users, eq(users.id, capacityOffers.providerUserId))
    .leftJoin(travelerProfiles, eq(travelerProfiles.userId, capacityOffers.providerUserId))
    .where(
      and(
        eq(capacityOffers.routeId, routeId),
        eq(capacityOffers.status, "published"),
        gt(capacityOffers.departureAt, now),
        eq(capacityOffers.isDemo, demo),
      ),
    );
  if (rows.length === 0) return [];

  const providerIds = [...new Set(rows.map((r) => r.offer.providerUserId))];
  const statRows = await db
    .select({
      providerUserId: shipments.providerUserId,
      completed: sql<number>`count(*) filter (where ${shipments.status} = 'DELIVERED')`.mapWith(Number),
      incidents: sql<number>`count(*) filter (where ${shipments.status} in ('LOST','DAMAGED','DISPUTED'))`.mapWith(Number),
    })
    .from(shipments)
    .where(inArray(shipments.providerUserId, providerIds))
    .groupBy(shipments.providerUserId);
  const stats = new Map(statRows.map((s) => [s.providerUserId, { completed: s.completed, incidents: s.incidents }]));

  return rows.map((r) => ({
    offer: r.offer,
    providerName: r.providerName,
    providerActive: r.providerStatus === "active",
    identityStatus: r.identityStatus,
    stats: stats.get(r.offer.providerUserId) ?? { completed: 0, incidents: 0 },
  }));
}

export function toMatchOffer(c: Candidate): MatchOffer {
  const o = c.offer;
  return {
    id: o.id,
    providerUserId: o.providerUserId,
    routeId: o.routeId,
    status: o.status,
    providerActive: c.providerActive,
    departureAt: o.departureAt,
    arrivalEstimatedAt: o.arrivalEstimatedAt,
    depositCutoffAt: o.depositCutoffAt,
    capacityWeightG: o.capacityWeightG,
    reservedWeightG: o.reservedWeightG,
    capacityVolumeL: o.capacityVolumeL,
    reservedVolumeL: o.reservedVolumeL,
    pricePerKgMinor: o.pricePerKgMinor,
    currency: o.currency as CurrencyCode,
    acceptedCategories: o.acceptedCategories,
    identityVerified: c.identityStatus === "verified",
    stats: c.stats,
  };
}

export function toMatchRequest(row: RequestRow): MatchRequest {
  return {
    senderUserId: row.senderUserId,
    routeId: row.routeId,
    weightG: row.weightG,
    volumeL: row.volumeL,
    category: row.category,
    budgetMaxMinor: row.budgetMaxMinor,
    budgetCurrency: row.budgetCurrency as CurrencyCode | null,
    budgetIsStrict: row.budgetIsStrict,
    earliestDepartureAt: row.earliestDepartureAt,
    latestDepartureAt: row.latestDepartureAt,
    neededBy: row.neededBy,
    deadlineIsStrict: row.deadlineIsStrict,
  };
}

async function rankAndView(db: Db, request: MatchRequest, candidates: Candidate[], now: Date, explain: boolean, demo: boolean): Promise<SearchResponse> {
  const config = loadMatchingConfig();
  const outcome = rankOffers(request, candidates.map(toMatchOffer), now, config);
  const byId = new Map(candidates.map((c) => [c.offer.id, c]));
  const views = await toOfferViews(
    db,
    outcome.matches.map((m) => {
      const c = byId.get(m.offerId)!;
      return { offer: c.offer, providerName: c.providerName, identityStatus: c.identityStatus };
    }),
  );
  return {
    results: outcome.matches.map((match, i) => ({ offer: views[i]!, match })),
    excludedCount: outcome.excluded.length,
    ...(explain ? { excluded: outcome.excluded } : {}),
    scoring: { configVersion: outcome.configVersion, weights: config.weights, validated: false },
    dataset: demo ? "demo" : "real",
  };
}

/** Recherche exploratoire (publique) : sans demande préalable. */
export async function searchOffers(db: Db, viewer: Actor | null, query: SearchQuery, now = new Date()): Promise<SearchResponse> {
  const route = await requireEnabledRoute(db, query.origin, query.destination);
  const demo = query.demo ?? showDemoByDefault();
  const request: MatchRequest = {
    senderUserId: viewer?.id ?? ANONYMOUS_SENDER,
    routeId: route.id,
    weightG: Math.round(query.weightKg * 1000),
    volumeL: null,
    category: query.category ?? null,
    budgetMaxMinor: query.budgetMaxMinor ?? null,
    budgetCurrency: query.budgetMaxMinor !== undefined ? (query.budgetCurrency ?? null) : null,
    budgetIsStrict: false,
    earliestDepartureAt: query.departureFrom ?? null,
    latestDepartureAt: query.departureTo ?? null,
    neededBy: null,
    deadlineIsStrict: false,
  };
  const candidates = await loadCandidates(db, route.id, now, demo);
  return rankAndView(db, request, candidates, now, query.explain ?? false, demo);
}

/** Offres compatibles avec une demande précise (jeu de données = celui de la demande). */
export async function matchesForRequest(db: Db, actor: Actor, requestId: string, now = new Date(), explain = false): Promise<SearchResponse> {
  const row = await getRequestForActor(db, actor, requestId);
  const candidates = await loadCandidates(db, row.routeId, now, row.isDemo);
  return rankAndView(db, toMatchRequest(row), candidates, now, explain, row.isDemo);
}
