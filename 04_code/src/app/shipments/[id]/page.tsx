import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DisputeSection } from "@/components/dispute-section";
import { ProofUploader } from "@/components/proof-uploader";
import { ReviewSection } from "@/components/review-section";
import { ShipmentActions } from "@/components/shipment-actions";
import { Badge, Card, DemoBadge, Notice, PageTitle } from "@/components/ui";
import { categoryLabel } from "@/config/goods-policy";
import { getDb } from "@/db/client";
import { formatMoney, formatWeight } from "@/domain/money";
import { IDENTITY_LABELS, ROLE_LABELS, formatDateTime } from "@/lib/format";
import { requireActorPage } from "@/lib/session";
import { listShipmentDisputes } from "@/server/disputes";
import { listProofs } from "@/server/proofs";
import { getShipmentReviews } from "@/server/reviews";
import { getShipmentView } from "@/server/shipments";

export const metadata: Metadata = { title: "Détail du colis" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "ok" | "warn" | "danger" | "muted"> = {
  DELIVERED: "ok",
  DAMAGED: "danger",
  LOST: "danger",
  DISPUTED: "warn",
  DELIVERY_FAILED: "warn",
  CANCELLED: "muted",
  RETURNED: "muted",
};

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await requireActorPage(`/shipments/${id}`);
  const shipment = await getShipmentView(getDb(), actor, id).catch(() => null);
  if (!shipment) notFound();
  const identity = IDENTITY_LABELS[shipment.provider.identityStatus ?? "not_provided"]!;
  const [proofs, disputes, reviews] = await Promise.all([listProofs(getDb(), actor, id), listShipmentDisputes(getDb(), actor, id), getShipmentReviews(getDb(), actor, id)]);
  const counterpart = shipment.viewerRole === "sender" ? shipment.provider : shipment.sender;

  return (
    <div className="space-y-5">
      <PageTitle title={`Colis ${shipment.trackingCode}`} subtitle={`${shipment.origin.name} → ${shipment.destination.name}`} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[shipment.status] ?? "ok"}>{shipment.statusLabel}</Badge>
        <Badge tone="muted">Vous êtes : {ROLE_LABELS[shipment.viewerRole]}</Badge>
        {shipment.isDemo ? <DemoBadge /> : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 font-semibold">Historique</h2>
            <ol className="space-y-4 border-l-2 border-slate-200 pl-4 dark:border-slate-700">
              {shipment.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full bg-emerald-600" aria-hidden />
                  <p className="font-medium">{e.label}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(e.occurredAt)} · {ROLE_LABELS[e.actorRole]}
                    {e.actorName ? ` (${e.actorName})` : ""}
                  </p>
                  {e.note ? <p className="mt-1 text-sm">{e.note}</p> : null}
                  {Array.isArray(e.proofs) && e.proofs.length > 0 ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Preuves :{" "}
                      {(e.proofs as Array<{ fileId: string; contentType: string; sha256: string }>).map((p, i) => (
                        <span key={p.fileId}>
                          {i > 0 ? ", " : ""}
                          <a className="underline" href={`/api/v1/proofs/${p.fileId}`} target="_blank" rel="noreferrer">
                            {p.contentType === "application/pdf" ? "PDF" : "photo"} (empreinte {p.sha256.slice(0, 8)}…)
                          </a>
                        </span>
                      ))}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Preuves ({proofs.length})</h2>
            {proofs.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">Aucune preuve téléversée. Photographiez le colis à la remise et à la réception : cela protège les deux parties.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {proofs.map((p) => (
                  <li key={p.id} className="rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-800">
                    {p.contentType.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/v1/proofs/${p.id}`} alt={`${p.purposeLabel} — ${p.originalName}`} loading="lazy" className="mb-2 h-36 w-full rounded object-cover" />
                    ) : (
                      <a className="mb-2 block underline" href={`/api/v1/proofs/${p.id}`}>
                        Télécharger le PDF
                      </a>
                    )}
                    <p className="font-medium">{p.purposeLabel}</p>
                    <p className="text-xs text-slate-500">
                      {p.uploaderName} ({ROLE_LABELS[p.uploaderRole]}) · {formatDateTime(p.createdAt)} · {Math.ceil(p.sizeBytes / 1024)} Ko
                    </p>
                    <p className="truncate font-mono text-[11px] text-slate-400" title={p.sha256}>
                      SHA-256 {p.sha256.slice(0, 16)}…
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
              <ProofUploader shipmentId={shipment.id} />
            </div>
          </Card>

          <ShipmentActions
            shipmentId={shipment.id}
            status={shipment.status}
            viewerRole={shipment.viewerRole as "sender" | "provider" | "operator"}
            allowedTransitions={shipment.allowedTransitions}
            deliveryCode={{ ...shipment.deliveryCode, expiresAt: shipment.deliveryCode.expiresAt?.toISOString() ?? null }}
          />

          <DisputeSection shipment={shipment} disputes={disputes} />

          {shipment.viewerRole !== "operator" ? (
            <ReviewSection status={shipment.status} reviews={reviews} counterpartName={counterpart.displayName} shipmentId={shipment.id} />
          ) : null}
        </div>

        <aside className="space-y-4">
          <Card>
            <h2 className="mb-2 font-semibold">Colis</h2>
            <dl className="space-y-1 text-sm">
              <div>
                <dt className="inline text-slate-500">Poids : </dt>
                <dd className="inline">{formatWeight(shipment.weightG)}</dd>
              </div>
              <div>
                <dt className="inline text-slate-500">Nature : </dt>
                <dd className="inline">{categoryLabel(shipment.category)}</dd>
              </div>
              <div>
                <dt className="inline text-slate-500">Contenu déclaré : </dt>
                <dd className="inline">{shipment.description}</dd>
              </div>
              {shipment.declaredValue ? (
                <div>
                  <dt className="inline text-slate-500">Valeur déclarée : </dt>
                  <dd className="inline">{formatMoney(shipment.declaredValue.minor, shipment.declaredValue.currency)}</dd>
                </div>
              ) : null}
              {shipment.price ? (
                <div>
                  <dt className="inline text-slate-500">Prix convenu : </dt>
                  <dd className="inline">{formatMoney(shipment.price.subtotalMinor, shipment.price.currency)}</dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-2 text-xs text-slate-500">Le règlement se fait directement entre les parties : la plateforme ne gère aucun paiement.</p>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Parties</h2>
            <dl className="space-y-1 text-sm">
              <div>
                <dt className="inline text-slate-500">Expéditeur : </dt>
                <dd className="inline">
                  <Link className="underline" href={`/users/${shipment.sender.id}`}>
                    {shipment.sender.displayName}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="inline text-slate-500">Transporteur : </dt>
                <dd className="inline">
                  <Link className="underline" href={`/users/${shipment.provider.id}`}>
                    {shipment.provider.displayName}
                  </Link>
                </dd>
              </div>
              <div>
                <Badge tone={identity.tone}>{identity.label}</Badge>
              </div>
              <div className="pt-1">
                <dt className="inline text-slate-500">Destinataire : </dt>
                <dd className="inline">
                  {shipment.receiver.name} · {shipment.receiver.phone}
                </dd>
              </div>
            </dl>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Remise</h2>
            <dl className="space-y-1 text-sm">
              <div>
                <dt className="inline text-slate-500">Départ : </dt>
                <dd className="inline">{formatDateTime(shipment.offer.departureAt)}</dd>
              </div>
              <div>
                <dt className="inline text-slate-500">Dernier dépôt : </dt>
                <dd className="inline">{shipment.offer.depositCutoffAt ? formatDateTime(shipment.offer.depositCutoffAt) : "non précisé"}</dd>
              </div>
              <div>
                <dt className="inline text-slate-500">Lieu de dépôt : </dt>
                <dd className="inline">{shipment.offer.depositAddress ?? "à convenir avec le transporteur"}</dd>
              </div>
              <div>
                <dt className="inline text-slate-500">Lieu de retrait : </dt>
                <dd className="inline">{shipment.offer.pickupAddress ?? "à convenir avec le transporteur"}</dd>
              </div>
              {shipment.offer.handoverTerms ? (
                <div>
                  <dt className="inline text-slate-500">Conditions : </dt>
                  <dd className="inline">{shipment.offer.handoverTerms}</dd>
                </div>
              ) : null}
            </dl>
          </Card>
          <Notice>Page de suivi publique (sans données personnelles) : <a className="underline" href={`/track/${shipment.trackingCode}`}>/track/{shipment.trackingCode}</a></Notice>
        </aside>
      </div>
    </div>
  );
}
