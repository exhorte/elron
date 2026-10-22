"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError } from "./api-client";
import { Notice, btnPrimary } from "./ui";

/** Demande de réservation d'une offre pour une demande existante. */
export function BookingRequestButton({ requestId, offerId }: { requestId: string; offerId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-2">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <button
        type="button"
        disabled={pending}
        className={btnPrimary}
        onClick={async () => {
          setError(null);
          setPending(true);
          const res = await api("/api/v1/bookings", "POST", { requestId, offerId });
          setPending(false);
          if (!res.ok) return setError(describeError(res.error));
          router.push("/dashboard?booked=1");
          router.refresh();
        }}
      >
        {pending ? "Envoi…" : "Demander à réserver"}
      </button>
    </div>
  );
}
