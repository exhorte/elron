"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError } from "./api-client";
import { Notice, btnDanger, btnPrimary, btnSecondary, inputCls } from "./ui";

/** Accepter ou refuser une réservation (prestataire). */
export function BookingDecision({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="space-y-2">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {rejecting ? (
        <div className="flex flex-wrap gap-2">
          <input aria-label="Motif du refus (facultatif)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif (facultatif)" maxLength={500} className={`${inputCls} max-w-xs`} />
          <button
            type="button"
            disabled={pending}
            className={btnDanger}
            onClick={async () => {
              setPending(true);
              const res = await api(`/api/v1/bookings/${bookingId}/reject`, "POST", { reason: reason.trim() || null });
              setPending(false);
              if (!res.ok) return setError(describeError(res.error));
              router.refresh();
            }}
          >
            Confirmer le refus
          </button>
          <button type="button" className={btnSecondary} onClick={() => setRejecting(false)}>
            Retour
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            className={btnPrimary}
            onClick={async () => {
              setError(null);
              setPending(true);
              const res = await api<{ shipmentId: string }>(`/api/v1/bookings/${bookingId}/accept`, "POST");
              setPending(false);
              if (!res.ok) return setError(describeError(res.error));
              router.push(`/shipments/${res.data.shipmentId}`);
              router.refresh();
            }}
          >
            {pending ? "Acceptation…" : "Accepter"}
          </button>
          <button type="button" className={btnSecondary} onClick={() => setRejecting(true)}>
            Refuser
          </button>
        </div>
      )}
    </div>
  );
}

/** Action POST sans corps avec confirmation (annuler une demande, une offre, une réservation). */
export function ConfirmPostButton({ path, label, confirmText }: { path: string; label: string; confirmText: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-2">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <button
        type="button"
        disabled={pending}
        className={btnSecondary}
        onClick={async () => {
          if (!window.confirm(confirmText)) return;
          setError(null);
          setPending(true);
          const res = await api(path, "POST");
          setPending(false);
          if (!res.ok) return setError(describeError(res.error));
          router.refresh();
        }}
      >
        {label}
      </button>
    </div>
  );
}
