import type { Metadata } from "next";
import Link from "next/link";
import { IdentityReview } from "@/components/identity-review";
import { Badge, Card, Notice, PageTitle } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatWeight } from "@/domain/money";
import { formatDateTime } from "@/lib/format";
import { requireOperatorPage } from "@/lib/session";
import { listAllShipments, listPendingIdentityReviews } from "@/server/admin";
import { listOpenDisputes } from "@/server/disputes";
import { DISPUTE_REASON_LABELS } from "@/lib/format";

export const metadata: Metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

const ID_KIND: Record<string, string> = { national_id: "Carte nationale d'identité", passport: "Passeport", residence_permit: "Titre de séjour" };

export default async function AdminPage() {
  const actor = await requireOperatorPage("/admin");
  const db = getDb();
  const [pending, shipments, openDisputes] = await Promise.all([listPendingIdentityReviews(db, actor), listAllShipments(db, actor, 50), listOpenDisputes(db, actor)]);
  return (
    <div className="space-y-6">
      <PageTitle title="Administration" subtitle="Interface minimale d'opérateur." />
      <Notice>
        La vérification d&apos;identité se fait hors plateforme (aucune pièce n&apos;est stockée ici). Cette interface n&apos;enregistre que votre décision, avec votre nom et la date,
        dans le journal d&apos;audit.
      </Notice>

      <section aria-labelledby="disp" className="space-y-3">
        <h2 id="disp" className="text-lg font-semibold">
          Litiges ouverts ({openDisputes.length})
        </h2>
        {openDisputes.length === 0 ? (
          <Notice>Aucun litige ouvert.</Notice>
        ) : (
          openDisputes.map((d) => (
            <Card key={d.id}>
              <p className="font-medium">
                <Link className="underline" href={`/shipments/${d.shipmentId}`}>
                  {d.trackingCode}
                </Link>{" "}
                — {DISPUTE_REASON_LABELS[d.reasonCode] ?? d.reasonCode}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Ouvert le {formatDateTime(d.createdAt)} par {d.openerName} · {d.messages.length} message{d.messages.length > 1 ? "s" : ""}
              </p>
              <p className="mt-1 line-clamp-2 text-sm">{d.description}</p>
            </Card>
          ))
        )}
      </section>

      <section aria-labelledby="idr" className="space-y-3">
        <h2 id="idr" className="text-lg font-semibold">
          Identités déclarées à examiner ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <Notice>Aucune identité en attente.</Notice>
        ) : (
          pending.map((p) => (
            <Card key={p.userId}>
              <p className="font-medium">
                {p.displayName} <span className="text-sm font-normal text-slate-500">· {p.email}</span>
              </p>
              <p className="text-sm">
                Nom déclaré : <strong>{p.declaredLegalName}</strong> · {p.declaredIdKind ? ID_KIND[p.declaredIdKind] : "—"}
                {p.declaredAt ? ` · déclaré le ${formatDateTime(p.declaredAt)}` : ""}
              </p>
              <div className="mt-3">
                <IdentityReview userId={p.userId} />
              </div>
            </Card>
          ))
        )}
      </section>

      <section aria-labelledby="ships" className="space-y-3">
        <h2 id="ships" className="text-lg font-semibold">
          Derniers colis
        </h2>
        {shipments.length === 0 ? (
          <Notice>Aucun colis.</Notice>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Statut</th>
                  <th className="px-3 py-2">Poids</th>
                  <th className="px-3 py-2">Mis à jour</th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 font-mono">
                      <Link className="underline" href={`/shipments/${s.id}`}>
                        {s.trackingCode}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={s.status === "DISPUTED" ? "warn" : s.status === "DELIVERED" ? "ok" : "muted"}>{s.statusLabel}</Badge>
                    </td>
                    <td className="px-3 py-2">{formatWeight(s.weightG)}</td>
                    <td className="px-3 py-2">{formatDateTime(s.statusChangedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
