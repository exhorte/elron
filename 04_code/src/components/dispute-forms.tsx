"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DISPUTE_OUTCOMES, DISPUTE_REASONS } from "@/domain/disputes";
import { DISPUTE_OUTCOME_LABELS, DISPUTE_REASON_LABELS } from "@/lib/format";
import { api, describeError } from "./api-client";
import { ProofUploader, type UploadedProof } from "./proof-uploader";
import { Field, Notice, btnDanger, btnPrimary, inputCls } from "./ui";

function AttachedList({ items, onRemove }: { items: UploadedProof[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm">
      {items.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-800">
          <span className="truncate">
            {p.purposeLabel} · {p.originalName}
          </span>
          <button type="button" className="text-xs underline" onClick={() => onRemove(p.id)}>
            Retirer
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Ouverture d'un litige : motif, description, preuves déjà téléversées ou jointes ici. */
export function OpenDisputeForm({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [attached, setAttached] = useState<UploadedProof[]>([]);

  if (!open) {
    return (
      <button type="button" className={btnDanger} onClick={() => setOpen(true)}>
        Ouvrir un litige
      </button>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const f = new FormData(e.currentTarget);
        setPending(true);
        const res = await api(`/api/v1/shipments/${shipmentId}/disputes`, "POST", {
          reasonCode: String(f.get("reasonCode")),
          description: String(f.get("description") ?? ""),
          proofs: attached.map((p) => ({ fileId: p.id })),
        });
        setPending(false);
        if (!res.ok) return setError(describeError(res.error));
        router.refresh();
      }}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Notice tone="warn">Ouvrir un litige gèle le colis : plus aucun changement de statut jusqu&apos;à la décision d&apos;un opérateur. Décrivez les faits précisément.</Notice>
      <Field label="Motif" htmlFor="reasonCode">
        <select id="reasonCode" name="reasonCode" className={inputCls} defaultValue="other">
          {DISPUTE_REASONS.map((r) => (
            <option key={r} value={r}>
              {DISPUTE_REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Description des faits" htmlFor="description" hint="10 caractères minimum.">
        <textarea id="description" name="description" required minLength={10} maxLength={2000} rows={4} className={inputCls} />
      </Field>
      <ProofUploader shipmentId={shipmentId} defaultPurpose="dispute" onUploaded={(p) => setAttached((a) => [...a, p])} />
      <AttachedList items={attached} onRemove={(id) => setAttached((a) => a.filter((x) => x.id !== id))} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={btnDanger}>
          {pending ? "Envoi…" : "Ouvrir le litige"}
        </button>
        <button type="button" className="rounded-lg px-3 text-sm underline" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

/** Nouveau message dans un litige ouvert. */
export function DisputeMessageForm({ disputeId, shipmentId }: { disputeId: string; shipmentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [attached, setAttached] = useState<UploadedProof[]>([]);
  const [body, setBody] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setPending(true);
        const res = await api(`/api/v1/disputes/${disputeId}/messages`, "POST", { body, proofs: attached.map((p) => ({ fileId: p.id })) });
        setPending(false);
        if (!res.ok) return setError(describeError(res.error));
        setBody("");
        setAttached([]);
        router.refresh();
      }}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field label="Votre message" htmlFor={`msg-${disputeId}`}>
        <textarea id={`msg-${disputeId}`} required maxLength={2000} rows={3} value={body} onChange={(e) => setBody(e.target.value)} className={inputCls} />
      </Field>
      <ProofUploader shipmentId={shipmentId} defaultPurpose="dispute" onUploaded={(p) => setAttached((a) => [...a, p])} />
      <AttachedList items={attached} onRemove={(id) => setAttached((a) => a.filter((x) => x.id !== id))} />
      <button type="submit" disabled={pending || body.trim().length === 0} className={btnPrimary}>
        {pending ? "Envoi…" : "Envoyer"}
      </button>
    </form>
  );
}

/** Décision d'un opérateur (non partie au colis). */
export function ResolveDisputeForm({ disputeId, statusBeforeLabel }: { disputeId: string; statusBeforeLabel: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-3 rounded-lg border border-slate-300 p-3 dark:border-slate-700"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const f = new FormData(e.currentTarget);
        if (!window.confirm("Cette décision modifie le statut du colis et clôt le litige. Continuer ?")) return;
        setPending(true);
        const res = await api(`/api/v1/admin/disputes/${disputeId}/resolve`, "POST", { outcome: String(f.get("outcome")), note: String(f.get("note") ?? "") });
        setPending(false);
        if (!res.ok) return setError(describeError(res.error));
        router.refresh();
      }}
    >
      <h4 className="font-semibold">Décision de l&apos;opérateur</h4>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field label="Issue" htmlFor="outcome" hint={`« Reprise » ramène le colis à son état d'avant le litige : ${statusBeforeLabel}.`}>
        <select id="outcome" name="outcome" className={inputCls} defaultValue="resume">
          {DISPUTE_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {DISPUTE_OUTCOME_LABELS[o]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Motivation de la décision" htmlFor="note" hint="Visible des deux parties.">
        <textarea id="note" name="note" required minLength={3} maxLength={1000} rows={3} className={inputCls} />
      </Field>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Enregistrement…" : "Enregistrer la décision"}
      </button>
    </form>
  );
}
