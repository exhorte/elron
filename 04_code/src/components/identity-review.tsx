"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError } from "./api-client";
import { Notice, btnDanger, btnPrimary, inputCls } from "./ui";

/** Décision d'opérateur sur une identité déclarée. */
export function IdentityReview({ userId }: { userId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function decide(decision: "verified" | "rejected") {
    setError(null);
    setPending(true);
    const res = await api(`/api/v1/admin/users/${userId}/identity-review`, "POST", { decision, note: note.trim() || null });
    setPending(false);
    if (!res.ok) return setError(describeError(res.error));
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <input aria-label="Note de décision" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (ex. contrôle effectué hors plateforme)" maxLength={500} className={inputCls} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} className={btnPrimary} onClick={() => decide("verified")}>
          Marquer comme vérifiée
        </button>
        <button type="button" disabled={pending} className={btnDanger} onClick={() => decide("rejected")}>
          Refuser
        </button>
      </div>
    </div>
  );
}
