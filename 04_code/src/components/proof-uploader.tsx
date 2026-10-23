"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PROOF_PURPOSES, PROOF_PURPOSE_LABELS, UPLOAD_LIMITS, type ProofPurpose } from "@/config/uploads";
import { describeError, uploadFile } from "./api-client";
import { Field, Notice, inputCls } from "./ui";

export interface UploadedProof {
  id: string;
  originalName: string;
  contentType: string;
  purposeLabel: string;
}

/**
 * Envoi d'une preuve (photo ou PDF). Le contrôle réel (type déduit des octets, taille, limites) est fait par
 * le serveur ; ici, simples garde-fous de confort. `onUploaded` permet de rattacher la preuve à une action.
 */
export function ProofUploader({
  shipmentId,
  defaultPurpose = "other",
  onUploaded,
}: {
  shipmentId: string;
  defaultPurpose?: ProofPurpose;
  onUploaded?: (proof: UploadedProof) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [purpose, setPurpose] = useState<ProofPurpose>(defaultPurpose);

  return (
    <div className="space-y-2">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
        <Field label="Photo ou PDF (5 Mo max)" htmlFor={`proof-file-${shipmentId}`}>
          <input
            id={`proof-file-${shipmentId}`}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={pending}
            className={inputCls}
            onChange={async (e) => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              if (!file) return;
              setError(null);
              if (file.size > UPLOAD_LIMITS.maxBytes) {
                input.value = "";
                return setError("Fichier trop volumineux (5 Mo maximum).");
              }
              setPending(true);
              const res = await uploadFile<UploadedProof & { purposeLabel: string }>(`/api/v1/shipments/${shipmentId}/proofs`, file, { purpose });
              setPending(false);
              input.value = "";
              if (!res.ok) return setError(describeError(res.error));
              onUploaded?.({ id: res.data.id, originalName: res.data.originalName, contentType: res.data.contentType, purposeLabel: res.data.purposeLabel });
              router.refresh();
            }}
          />
        </Field>
        <Field label="Nature de la preuve" htmlFor={`proof-purpose-${shipmentId}`}>
          <select id={`proof-purpose-${shipmentId}`} value={purpose} onChange={(e) => setPurpose(e.target.value as ProofPurpose)} className={inputCls}>
            {PROOF_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {PROOF_PURPOSE_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {pending ? <p className="text-sm text-slate-500">Envoi en cours…</p> : <p className="text-xs text-slate-500">Les photos peuvent contenir des métadonnées (lieu, date) ; seuls les parties du colis et les opérateurs y ont accès.</p>}
    </div>
  );
}
