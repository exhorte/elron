import { DISPUTE_OUTCOME_LABELS, DISPUTE_REASON_LABELS, ROLE_LABELS, formatDateTime } from "@/lib/format";
import { STATUS_LABELS_FR } from "@/domain/workflow";
import type { DisputeView } from "@/server/disputes";
import type { ShipmentView } from "@/server/shipments";
import { DisputeMessageForm, OpenDisputeForm, ResolveDisputeForm } from "./dispute-forms";
import { Badge, Card, Notice } from "./ui";

/** Litiges d'un colis : ouverture, fil de discussion, décision de l'opérateur. */
export function DisputeSection({ shipment, disputes }: { shipment: ShipmentView; disputes: DisputeView[] }) {
  if (disputes.length === 0 && !shipment.canOpenDispute) return null;
  return (
    <Card>
      <h2 className="mb-3 font-semibold">Litiges</h2>
      {disputes.length === 0 ? <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Aucun litige. En cas de problème, ouvrez-en un : un opérateur examinera les éléments et tranchera.</p> : null}

      {disputes.map((d) => (
        <section key={d.id} className="mb-5 space-y-3 border-b border-slate-200 pb-5 last:border-b-0 last:pb-0 dark:border-slate-800" aria-label={`Litige ${DISPUTE_REASON_LABELS[d.reasonCode] ?? d.reasonCode}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={d.status === "open" ? "warn" : "muted"}>{d.status === "open" ? "Ouvert" : "Clos"}</Badge>
            <span className="font-medium">{DISPUTE_REASON_LABELS[d.reasonCode] ?? d.reasonCode}</span>
            <span className="text-xs text-slate-500">
              ouvert le {formatDateTime(d.createdAt)} par {d.openerName} ({ROLE_LABELS[d.openerRole]})
            </span>
          </div>

          <ol className="space-y-2">
            {d.messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-lg border p-3 text-sm ${
                  m.kind === "resolution" ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950" : "border-slate-200 dark:border-slate-800"
                }`}
              >
                <p className="text-xs text-slate-500">
                  {m.authorName} ({ROLE_LABELS[m.authorRole]}) · {formatDateTime(m.createdAt)}
                  {m.kind === "resolution" ? " · décision" : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                {m.proofs.length > 0 ? (
                  <p className="mt-1 text-xs">
                    Pièces :{" "}
                    {m.proofs.map((p, i) => (
                      <span key={p.fileId}>
                        {i > 0 ? ", " : ""}
                        <a className="underline" href={`/api/v1/proofs/${p.fileId}`} target="_blank" rel="noreferrer">
                          {p.contentType === "application/pdf" ? "PDF" : "photo"} ({p.sha256.slice(0, 8)}…)
                        </a>
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>

          {d.status === "resolved" ? (
            <Notice tone="ok">
              Décision : <strong>{DISPUTE_OUTCOME_LABELS[d.resolutionOutcome ?? ""] ?? d.resolutionOutcome}</strong>
              {d.resolvedAt ? ` — le ${formatDateTime(d.resolvedAt)}` : ""}
            </Notice>
          ) : (
            <>
              <DisputeMessageForm disputeId={d.id} shipmentId={shipment.id} />
              {shipment.viewerRole === "operator" ? <ResolveDisputeForm disputeId={d.id} statusBeforeLabel={STATUS_LABELS_FR[d.statusBefore]} /> : null}
            </>
          )}
        </section>
      ))}

      {shipment.canOpenDispute ? <OpenDisputeForm shipmentId={shipment.id} /> : null}
    </Card>
  );
}
