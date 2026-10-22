import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RequestForm } from "@/components/request-form";
import { Badge, Card, DemoBadge, Notice, PageTitle } from "@/components/ui";
import { categoryLabel } from "@/config/goods-policy";
import { getDb } from "@/db/client";
import { formatMoney, formatWeight } from "@/domain/money";
import { IDENTITY_LABELS, TRANSPORT_LABELS, formatDateTime } from "@/lib/format";
import { citiesFromRoutes } from "@/lib/cities";
import { requireActorPage } from "@/lib/session";
import { listEnabledRoutes } from "@/server/geo";
import { getOfferView } from "@/server/offers";

export const metadata: Metadata = { title: "Demander à réserver" };
export const dynamic = "force-dynamic";

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ offerId: string }>;
  searchParams: Promise<{ weightKg?: string; category?: string }>;
}) {
  const { offerId } = await params;
  if (!z.uuid().safeParse(offerId).success) notFound();
  const sp = await searchParams;
  const actor = await requireActorPage(`/book/${offerId}`);
  const db = getDb();
  const offer = await getOfferView(db, offerId).catch(() => null);
  if (!offer || offer.status !== "published") notFound();

  const cities = citiesFromRoutes(await listEnabledRoutes(db));
  const identity = IDENTITY_LABELS[offer.provider.identityStatus ?? "not_provided"] ?? IDENTITY_LABELS.not_provided!;
  const mismatch = offer.isDemo !== actor.isDemo;
  const own = offer.provider.id === actor.id;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle title="Demander à réserver" subtitle="Décrivez votre colis : le transporteur acceptera ou refusera votre demande." />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {offer.origin.name} → {offer.destination.name}
          </h2>
          <div className="flex gap-1.5">
            {offer.isDemo ? <DemoBadge /> : null}
            <Badge tone={identity.tone}>{identity.label}</Badge>
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {offer.provider.displayName} · {TRANSPORT_LABELS[offer.transportMode]} · départ {formatDateTime(offer.departureAt)} ·{" "}
          {formatMoney(offer.pricePerKgMinor, offer.currency)}/kg · {formatWeight(offer.availableWeightG)} disponibles
        </p>
        <p className="mt-1 text-xs text-slate-500">Accepte : {offer.acceptedCategories.map(categoryLabel).join(", ")}</p>
      </Card>
      {own ? (
        <Notice tone="danger">Vous ne pouvez pas réserver votre propre offre.</Notice>
      ) : mismatch ? (
        <Notice tone="danger">
          Les données de démonstration et les données réelles ne peuvent pas être mélangées : connectez-vous avec un compte {offer.isDemo ? "de démonstration" : "réel"}.
        </Notice>
      ) : (
        <Card>
          <RequestForm
            cities={cities}
            fixed={{ originId: offer.origin.id, destinationId: offer.destination.id, offerId: offer.id, currency: offer.currency }}
            defaults={{ weightKg: sp.weightKg, category: sp.category }}
          />
        </Card>
      )}
    </div>
  );
}
