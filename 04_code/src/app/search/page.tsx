import type { Metadata } from "next";
import Link from "next/link";
import { OfferCard } from "@/components/offer-card";
import { SearchForm } from "@/components/search-form";
import { Card, DemoBadge, Notice, PageTitle, btnSecondary } from "@/components/ui";
import { getDb } from "@/db/client";
import { citiesFromRoutes } from "@/lib/cities";
import { getCurrentActor } from "@/lib/session";
import { listEnabledRoutes } from "@/server/geo";
import { searchOffers, type SearchResponse } from "@/server/search";
import { searchQuerySchema } from "@/server/validation";

export const metadata: Metadata = { title: "Rechercher un trajet" };
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Convertit un `<input type=date>` (AAAA-MM-JJ) en date-heure GMT attendue par l'API. */
const dayStart = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : undefined);
const dayEnd = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59Z` : undefined);

type Outcome =
  | { kind: "idle" }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ok"; response: SearchResponse; weightKg: number };

async function runSearch(raw: Params, values: Record<string, string | undefined>): Promise<Outcome> {
  if (!(values.origin && values.destination && values.weightKg)) return { kind: "idle" };
  const parsed = searchQuerySchema.safeParse({
    origin: values.origin,
    destination: values.destination,
    weightKg: values.weightKg,
    ...(values.category ? { category: values.category } : {}),
    ...(dayStart(values.departureFrom) ? { departureFrom: dayStart(values.departureFrom) } : {}),
    ...(dayEnd(values.departureTo) ? { departureTo: dayEnd(values.departureTo) } : {}),
    ...(one(raw.demo) === "1" ? { demo: "1" } : {}),
  });
  if (!parsed.success) return { kind: "invalid", message: parsed.error.issues.map((i) => i.message).join(" · ") };
  try {
    const response = await searchOffers(getDb(), await getCurrentActor(), parsed.data);
    return { kind: "ok", response, weightKg: parsed.data.weightKg };
  } catch (err) {
    const message = (err as { code?: string }).code === "route_not_enabled" ? "Ce trajet n'est pas encore ouvert sur la plateforme." : "Recherche impossible.";
    return { kind: "error", message };
  }
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  const cities = citiesFromRoutes(await listEnabledRoutes(getDb()));
  const values = {
    origin: one(raw.origin),
    destination: one(raw.destination),
    weightKg: one(raw.weightKg),
    category: one(raw.category),
    departureFrom: one(raw.departureFrom),
    departureTo: one(raw.departureTo),
  };
  const outcome = await runSearch(raw, values);

  return (
    <div className="space-y-6">
      <PageTitle title="Rechercher un trajet" subtitle="Comparez les voyageurs et transporteurs qui partent bientôt." />
      <Card>
        <SearchForm cities={cities} values={values} />
      </Card>

      {outcome.kind === "invalid" ? <Notice tone="danger">Critères de recherche invalides : {outcome.message}</Notice> : null}
      {outcome.kind === "error" ? <Notice tone="danger">{outcome.message}</Notice> : null}

      {outcome.kind === "ok" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">
              {outcome.response.results.length} offre{outcome.response.results.length > 1 ? "s" : ""} compatible{outcome.response.results.length > 1 ? "s" : ""}
            </h2>
            {outcome.response.dataset === "demo" ? <DemoBadge /> : null}
          </div>
          <Notice>
            Les offres qui ne respectent pas vos exigences obligatoires (trajet, capacité, nature, dates) sont exclues
            {outcome.response.excludedCount > 0 ? ` : ${outcome.response.excludedCount} exclue${outcome.response.excludedCount > 1 ? "s" : ""}` : ""}. Le classement entre
            offres compatibles est indicatif et son détail est visible sur chaque carte.
          </Notice>
          {outcome.response.results.length === 0 ? (
            <Card>
              <p className="font-medium">Aucune offre compatible pour le moment.</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Élargissez les dates ou réduisez le poids. Vous pouvez aussi publier votre demande d&apos;envoi et revenir consulter les offres plus tard.
              </p>
              <div className="mt-3 flex gap-2">
                <Link href="/requests/new" className={btnSecondary}>
                  Publier une demande d&apos;envoi
                </Link>
              </div>
              {outcome.response.dataset === "real" ? (
                <p className="mt-3 text-xs text-slate-500">
                  Cette plateforme démarre sans données fictives : seules les offres réellement publiées par des transporteurs apparaissent ici.
                </p>
              ) : null}
            </Card>
          ) : (
            outcome.response.results.map((r) => (
              <OfferCard
                key={r.offer.id}
                result={r}
                weightG={Math.round(outcome.weightKg * 1000)}
                bookHref={`/book/${r.offer.id}?${new URLSearchParams({ weightKg: String(outcome.weightKg), ...(values.category ? { category: values.category } : {}) }).toString()}`}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
