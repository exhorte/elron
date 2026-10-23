"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError } from "./api-client";
import { Field, Notice, btnPrimary, inputCls } from "./ui";

const LABELS = ["", "Très insatisfaisant", "Insatisfaisant", "Correct", "Bien", "Excellent"];

/** Note de 1 à 5 + commentaire facultatif. Un avis est définitif : il ne pourra plus être modifié. */
export function ReviewForm({ shipmentId, counterpartName }: { shipmentId: string; counterpartName: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (rating === 0) return setError("Choisissez une note de 1 à 5.");
        const f = new FormData(e.currentTarget);
        setPending(true);
        const res = await api(`/api/v1/shipments/${shipmentId}/reviews`, "POST", { rating, comment: String(f.get("comment") ?? "").trim() || null });
        setPending(false);
        if (!res.ok) return setError(describeError(res.error));
        router.refresh();
      }}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Votre note pour {counterpartName}</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Note de 1 à 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border px-3 text-lg ${
                rating === n ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-300 dark:border-slate-700"
              }`}
            >
              <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" />
              <span aria-hidden>{n}★</span>
              <span className="sr-only">
                {n} sur 5 — {LABELS[n]}
              </span>
            </label>
          ))}
        </div>
        {rating > 0 ? <p className="mt-1 text-xs text-slate-500">{LABELS[rating]}</p> : null}
      </fieldset>
      <Field label="Commentaire (facultatif)" htmlFor="comment" hint="Public, associé à votre nom affiché. Restez factuel.">
        <textarea id="comment" name="comment" maxLength={500} rows={3} className={inputCls} />
      </Field>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Envoi…" : "Publier mon avis (définitif)"}
      </button>
    </form>
  );
}
