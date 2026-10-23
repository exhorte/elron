"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NOTE_REQUIRED_FOR, STATUS_LABELS_FR, type ShipmentStatus } from "@/domain/workflow";
import { formatDateTime } from "@/lib/format";
import { api, describeError } from "./api-client";
import { ProofUploader, type UploadedProof } from "./proof-uploader";
import { Card, Field, Notice, btnDanger, btnPrimary, btnSecondary, inputCls } from "./ui";

const ACTION_LABELS: Partial<Record<ShipmentStatus, string>> = {
  HANDED_OVER: "J'ai pris le colis en charge",
  IN_TRANSIT: "Le colis est en transit",
  ARRIVED: "Le colis est arrivé à destination",
  OUT_FOR_DELIVERY: "Remise au destinataire en cours",
  DELIVERY_FAILED: "La remise a échoué",
  DAMAGED: "Signaler un dommage",
  LOST: "Signaler une perte",
  DISPUTED: "Ouvrir un litige",
  RETURNED: "Colis retourné à l'expéditeur",
  CANCELLED: "Annuler ce colis",
  DELIVERED: "Résoudre : remis",
};

const DANGEROUS: ReadonlySet<ShipmentStatus> = new Set<ShipmentStatus>(["CANCELLED", "DAMAGED", "LOST", "DISPUTED", "DELIVERY_FAILED"]);

interface Props {
  shipmentId: string;
  status: ShipmentStatus;
  viewerRole: "sender" | "provider" | "operator";
  allowedTransitions: ShipmentStatus[];
  deliveryCode: {
    generated: boolean;
    generation: number;
    expiresAt: string | null;
    attemptsLeft: number | null;
    locked: boolean;
    consumed: boolean;
    canGenerate: boolean;
  };
}

export function ShipmentActions({ shipmentId, status, viewerRole, allowedTransitions, deliveryCode }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [target, setTarget] = useState<ShipmentStatus | null>(null);
  const [note, setNote] = useState("");
  const [attached, setAttached] = useState<UploadedProof[]>([]);
  const [issuedCode, setIssuedCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [code, setCode] = useState("");

  const canConfirm = viewerRole === "provider" && ["ARRIVED", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"].includes(status);
  const noteRequired = target ? NOTE_REQUIRED_FOR.has(target) : false;

  async function submitTransition(to: ShipmentStatus) {
    setError(null);
    if (NOTE_REQUIRED_FOR.has(to) && !note.trim()) return setError("Une justification est requise pour ce changement de statut.");
    setPending(true);
    const res = await api(`/api/v1/shipments/${shipmentId}/transitions`, "POST", {
      to,
      note: note.trim() || null,
      proofs: attached.map((p) => ({ fileId: p.id })),
    });
    setPending(false);
    if (!res.ok) return setError(describeError(res.error));
    setTarget(null);
    setNote("");
    setAttached([]);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {/* Code de remise — expéditeur */}
      {viewerRole === "sender" ? (
        <Card>
          <h3 className="font-semibold">Code de remise</h3>
          {issuedCode ? (
            <div className="mt-2 space-y-2">
              <p className="text-sm">À communiquer au destinataire uniquement. Il ne sera plus affiché après cette page.</p>
              <p className="select-all rounded-lg bg-emerald-50 px-4 py-3 text-center font-mono text-3xl tracking-[0.4em] text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" aria-live="polite">
                {issuedCode.code}
              </p>
              <p className="text-xs text-slate-500">Valable jusqu&apos;au {formatDateTime(issuedCode.expiresAt)}. Le transporteur ne voit jamais ce code : il le saisira à la remise.</p>
            </div>
          ) : deliveryCode.consumed ? (
            <p className="mt-1 text-sm">Code utilisé : la remise a été confirmée.</p>
          ) : (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {deliveryCode.generated
                ? `Un code est actif (${deliveryCode.locked ? "verrouillé après trop de tentatives" : `${deliveryCode.attemptsLeft} tentative(s) restante(s)`}). Il n'est pas relisible ; vous pouvez en générer un nouveau, ce qui invalide l'ancien.`
                : "Générez un code et donnez-le au destinataire : la remise ne sera confirmée qu'avec ce code."}
            </p>
          )}
          {deliveryCode.canGenerate ? (
            <button
              type="button"
              disabled={pending}
              className={`${deliveryCode.generated ? btnSecondary : btnPrimary} mt-3`}
              onClick={async () => {
                if (deliveryCode.generated && !window.confirm("Générer un nouveau code invalide l'ancien. Continuer ?")) return;
                setError(null);
                setPending(true);
                const res = await api<{ code: string; expiresAt: string }>(`/api/v1/shipments/${shipmentId}/delivery-code`, "POST");
                setPending(false);
                if (!res.ok) return setError(describeError(res.error));
                setIssuedCode({ code: res.data.code, expiresAt: res.data.expiresAt });
                router.refresh();
              }}
            >
              {deliveryCode.generated ? "Générer un nouveau code" : "Générer le code de remise"}
            </button>
          ) : null}
        </Card>
      ) : null}

      {/* Confirmation de remise — transporteur */}
      {canConfirm ? (
        <Card>
          <h3 className="font-semibold">Confirmer la remise</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Demandez au destinataire le code à 6 chiffres que l&apos;expéditeur lui a transmis.{" "}
            {deliveryCode.generated ? `Tentatives restantes : ${deliveryCode.attemptsLeft}.` : "L'expéditeur n'a pas encore généré de code."}
          </p>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              setPending(true);
              const res = await api(`/api/v1/shipments/${shipmentId}/confirm-delivery`, "POST", { code });
              setPending(false);
              if (!res.ok) {
                setCode("");
                return setError(describeError(res.error));
              }
              router.refresh();
            }}
          >
            <Field label="Code du destinataire" htmlFor="deliveryCode">
              <input
                id="deliveryCode"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className={`${inputCls} w-44 text-center font-mono text-xl tracking-widest`}
              />
            </Field>
            <button type="submit" disabled={pending || code.length !== 6 || deliveryCode.locked} className={btnPrimary}>
              Confirmer la remise
            </button>
          </form>
          {deliveryCode.locked ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">Verrouillé : l&apos;expéditeur doit générer un nouveau code.</p> : null}
        </Card>
      ) : null}

      {/* Transitions de statut */}
      {allowedTransitions.length > 0 ? (
        <Card>
          <h3 className="font-semibold">Actions</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {allowedTransitions.map((to) => (
              <button
                key={to}
                type="button"
                disabled={pending}
                className={DANGEROUS.has(to) ? btnDanger : target === to ? btnPrimary : btnSecondary}
                onClick={() => {
                  setError(null);
                  if (NOTE_REQUIRED_FOR.has(to) || viewerRole === "operator") setTarget(to);
                  else void submitTransition(to);
                }}
              >
                {ACTION_LABELS[to] ?? STATUS_LABELS_FR[to]}
              </button>
            ))}
          </div>
          {target ? (
            <div className="mt-4 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
              <p className="text-sm font-medium">{ACTION_LABELS[target] ?? STATUS_LABELS_FR[target]}</p>
              <Field label={noteRequired ? "Justification (obligatoire)" : "Note (facultatif)"} htmlFor="note">
                <textarea id="note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
              </Field>
              <div className="space-y-2">
                <p className="text-sm font-medium">Preuves jointes (facultatif)</p>
                <ProofUploader shipmentId={shipmentId} defaultPurpose={target === "DAMAGED" ? "damage" : target === "HANDED_OVER" ? "handover" : "other"} onUploaded={(p) => setAttached((a) => [...a, p])} />
                {attached.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {attached.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-800">
                        <span className="truncate">{p.purposeLabel} · {p.originalName}</span>
                        <button type="button" className="text-xs underline" onClick={() => setAttached((a) => a.filter((x) => x.id !== p.id))}>
                          Retirer
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={pending} className={btnPrimary} onClick={() => submitTransition(target)}>
                  Valider
                </button>
                <button type="button" className={btnSecondary} onClick={() => setTarget(null)}>
                  Annuler
                </button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
