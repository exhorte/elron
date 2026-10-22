import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BookingRequestButton } from "@/components/booking-request-button";
import { OfferCard } from "@/components/offer-card";
import { Card, DemoBadge, Notice, PageTitle } from "@/components/ui";
import { categoryLabel } from "@/config/goods-policy";
import { getDb } from "@/db/client";
import { formatWeight } from "@/domain/money";
import { REQUEST_STATUS_LABELS, formatDateTime } from "@/lib/format";
import { requireActorPage } from "@/lib/session";
import { matchesForRequest } from "@/server/search";
import { getRequestForActor } from "@/server/requests";

export const metadata: Metadata = { title: "Ma demande d'envoi" };
export const dynamic = "force-dynamic";

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await requireActorPage(`/requests/${id}`);
  const db = getDb();
  const request = await getRequestForActor(db, actor, id).catch(() => null);
  if (!request) notFound();
  const matches = request.status === "open" ? await matchesForRequest(db, actor, id) : null;

  return (
    <div className="space-y-5">
      <PageTitle title="Ma demande d'envoi" />
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {formatWeight(request.weightG)} · {categoryLabel(request.category)}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs dark:bg-slate-800">{REQUEST_STATUS_LABELS[request.status]}</span>
          {request.isDemo ? <DemoBadge /> : null}
        </div>
        <p className="mt-2 text-sm">{request.description}</p>
        <p className="mt-1 text-xs text-slate-500">
          Destinataire : {request.receiverName}
          {request.neededBy ? ` · à destination avant le ${formatDateTime(request.neededBy)}${request.deadlineIsStrict ? " (strict)" : ""}` : ""}
        </p>
      </Card>

      {request.status === "booked" ? <Notice tone="ok">Une réservation est acceptée pour cette demande. Retrouvez le colis dans « Mon espace ».</Notice> : null}
      {request.status === "cancelled" ? <Notice>Cette demande est annulée.</Notice> : null}

      {matches ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {matches.results.length} offre{matches.results.length > 1 ? "s" : ""} compatible{matches.results.length > 1 ? "s" : ""}
          </h2>
          {matches.results.length === 0 ? (
            <Notice>
              Aucune offre compatible pour le moment ({matches.excludedCount} exclue{matches.excludedCount > 1 ? "s" : ""} faute de respecter vos exigences). Revenez plus tard : de
              nouveaux trajets sont publiés régulièrement.
            </Notice>
          ) : (
            matches.results.map((r) => (
              <div key={r.offer.id} className="space-y-3">
                <OfferCard result={r} weightG={request.weightG} />
                <BookingRequestButton requestId={request.id} offerId={r.offer.id} />
              </div>
            ))
          )}
        </section>
      ) : null}
    </div>
  );
}
