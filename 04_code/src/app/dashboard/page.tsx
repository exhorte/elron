import type { Metadata } from "next";
import Link from "next/link";
import { BookingDecision, ConfirmPostButton } from "@/components/action-buttons";
import { Badge, Card, DemoBadge, Notice, PageTitle, btnPrimary, btnSecondary } from "@/components/ui";
import { categoryLabel } from "@/config/goods-policy";
import { getDb } from "@/db/client";
import { formatMoney, formatWeight } from "@/domain/money";
import {
  BOOKING_STATUS_LABELS,
  OFFER_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  TRANSPORT_LABELS,
  formatDateTime,
} from "@/lib/format";
import { requireActorPage } from "@/lib/session";
import { getTravelerProfile } from "@/server/admin";
import { listBookings } from "@/server/bookings";
import { listOffersByProvider } from "@/server/offers";
import { listRequestsBySender } from "@/server/requests";
import { listMyShipments } from "@/server/shipments";

export const metadata: Metadata = { title: "Mon espace" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ booked?: string; published?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActorPage("/dashboard");
  const db = getDb();
  const [profile, shipments, incoming, outgoing, offers, requests] = await Promise.all([
    getTravelerProfile(db, actor.id),
    listMyShipments(db, actor),
    listBookings(db, actor, "provider"),
    listBookings(db, actor, "sender"),
    listOffersByProvider(db, actor),
    listRequestsBySender(db, actor),
  ]);
  const pendingIncoming = incoming.filter((b) => b.status === "requested");

  return (
    <div className="space-y-6">
      <PageTitle title="Mon espace" subtitle={actor.displayName} />
      {sp.booked ? <Notice tone="ok">Demande de réservation envoyée. Le transporteur doit l&apos;accepter : vous la retrouvez ci-dessous.</Notice> : null}
      {sp.published ? <Notice tone="ok">Votre trajet est publié et visible dans les recherches.</Notice> : null}
      {actor.isDemo ? <DemoBadge /> : null}

      <div className="flex flex-wrap gap-2">
        <Link href="/requests/new" className={btnPrimary}>
          Envoyer un colis
        </Link>
        <Link href="/trips/new" className={btnSecondary}>
          Publier un trajet
        </Link>
        {!profile ? (
          <Link href="/profile" className={btnSecondary}>
            Créer mon profil voyageur
          </Link>
        ) : null}
      </div>

      {pendingIncoming.length > 0 ? (
        <section aria-labelledby="incoming" className="space-y-3">
          <h2 id="incoming" className="text-lg font-semibold">
            Demandes de réservation à traiter ({pendingIncoming.length})
          </h2>
          {pendingIncoming.map((b) => (
            <Card key={b.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {b.counterpart.displayName} · {formatWeight(b.weightG)} · {categoryLabel(b.request.category)}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{b.request.description}</p>
                  {b.message ? <p className="mt-1 text-sm italic">« {b.message} »</p> : null}
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatMoney(b.subtotalMinor, b.currency)}</p>
                  {b.platformFeeMinor > 0 ? <p className="text-xs text-slate-500">dont commission {formatMoney(b.platformFeeMinor, b.currency)}</p> : null}
                  {b.request.isDemo ? <DemoBadge /> : null}
                </div>
              </div>
              <div className="mt-3">
                <BookingDecision bookingId={b.id} />
              </div>
            </Card>
          ))}
        </section>
      ) : null}

      <section aria-labelledby="shipments" className="space-y-3">
        <h2 id="shipments" className="text-lg font-semibold">
          Mes colis
        </h2>
        {shipments.length === 0 ? (
          <Notice>Aucun colis pour le moment. Un colis est créé lorsqu&apos;un transporteur accepte une réservation.</Notice>
        ) : (
          <ul className="space-y-2">
            {shipments.map((s) => (
              <li key={s.id}>
                <Link href={`/shipments/${s.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-emerald-600 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-medium">{s.trackingCode}</span>
                    <Badge tone={s.status === "DELIVERED" ? "ok" : "muted"}>{s.statusLabel}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    {s.originName} → {s.destinationName} · {formatWeight(s.weightG)} · {s.viewerRole === "sender" ? "Vous expédiez" : "Vous transportez"} · mis à jour le{" "}
                    {formatDateTime(s.statusChangedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="outgoing" className="space-y-3">
        <h2 id="outgoing" className="text-lg font-semibold">
          Mes demandes de réservation
        </h2>
        {outgoing.length === 0 ? (
          <Notice>Aucune demande envoyée.</Notice>
        ) : (
          <ul className="space-y-2">
            {outgoing.map((b) => (
              <li key={b.id}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {b.counterpart.displayName} · {formatWeight(b.weightG)} · {formatMoney(b.subtotalMinor, b.currency)}
                    </span>
                    <Badge tone={b.status === "accepted" ? "ok" : b.status === "requested" ? "warn" : "muted"}>{BOOKING_STATUS_LABELS[b.status]}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {b.shipmentId ? (
                      <Link className={btnSecondary} href={`/shipments/${b.shipmentId}`}>
                        Voir le colis
                      </Link>
                    ) : null}
                    {b.status === "requested" ? <ConfirmPostButton path={`/api/v1/bookings/${b.id}/cancel`} label="Retirer ma demande" confirmText="Retirer cette demande de réservation ?" /> : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="requests" className="space-y-3">
        <h2 id="requests" className="text-lg font-semibold">
          Mes demandes d&apos;envoi
        </h2>
        {requests.length === 0 ? (
          <Notice>Aucune demande publiée.</Notice>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => (
              <li key={r.id}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {formatWeight(r.weightG)} · {categoryLabel(r.category)} · {r.description.slice(0, 60)}
                    </span>
                    <Badge tone={r.status === "open" ? "warn" : r.status === "booked" ? "ok" : "muted"}>{REQUEST_STATUS_LABELS[r.status]}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link className={btnSecondary} href={`/requests/${r.id}`}>
                      {r.status === "open" ? "Voir les offres compatibles" : "Détails"}
                    </Link>
                    {r.status === "open" ? <ConfirmPostButton path={`/api/v1/requests/${r.id}/cancel`} label="Annuler la demande" confirmText="Annuler cette demande d'envoi ?" /> : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {profile ? (
        <section aria-labelledby="offers" className="space-y-3">
          <h2 id="offers" className="text-lg font-semibold">
            Mes trajets publiés
          </h2>
          {offers.length === 0 ? (
            <Notice>Aucun trajet publié.</Notice>
          ) : (
            <ul className="space-y-2">
              {offers.map((o) => (
                <li key={o.id}>
                  <Card>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {o.origin.name} → {o.destination.name} · {TRANSPORT_LABELS[o.transportMode]} · {formatDateTime(o.departureAt)}
                      </span>
                      <Badge tone={o.status === "published" ? "ok" : "muted"}>{OFFER_STATUS_LABELS[o.status]}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      {formatWeight(o.capacityWeightG - o.availableWeightG)} réservés sur {formatWeight(o.capacityWeightG)} · {formatMoney(o.pricePerKgMinor, o.currency)}/kg
                      {o.isDemo ? " · démo" : ""}
                    </p>
                    {o.status === "published" ? (
                      <div className="mt-2">
                        <ConfirmPostButton path={`/api/v1/offers/${o.id}/cancel`} label="Annuler ce trajet" confirmText="Annuler ce trajet ? Les demandes en attente seront refusées." />
                      </div>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
