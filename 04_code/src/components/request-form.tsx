"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GOODS_CATEGORIES } from "@/config/goods-policy";
import { CURRENCY_CODES, parseMajorToMinor, type CurrencyCode } from "@/domain/money";
import { localInputToIso } from "@/lib/format";
import { api, describeError } from "./api-client";
import type { CityOption } from "./search-form";
import { Field, Notice, btnPrimary, inputCls } from "./ui";

const OFFERABLE = GOODS_CATEGORIES.filter((c) => c.policy !== "prohibited");
const PROHIBITED = GOODS_CATEGORIES.filter((c) => c.policy === "prohibited");

interface Props {
  cities: CityOption[];
  /** Si défini : trajet figé et réservation demandée immédiatement après la création de la demande. */
  fixed?: { originId: string; destinationId: string; offerId: string; currency: CurrencyCode };
  defaults?: { weightKg?: string; category?: string };
}

export function RequestForm({ cities, fixed, defaults }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [category, setCategory] = useState(defaults?.category && OFFERABLE.some((c) => c.code === defaults.category) ? defaults.category : "clothing");
  const policy = OFFERABLE.find((c) => c.code === category)?.policy;

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const f = new FormData(e.currentTarget);
        const str = (k: string) => String(f.get(k) ?? "").trim();

        const weightKg = Number(str("weightKg").replace(",", "."));
        if (!Number.isFinite(weightKg) || weightKg <= 0) return setError("Indiquez un poids valide en kg.");
        const body: Record<string, unknown> = {
          originCityId: fixed?.originId ?? str("origin"),
          destinationCityId: fixed?.destinationId ?? str("destination"),
          weightG: Math.round(weightKg * 1000),
          category,
          description: str("description"),
          receiverName: str("receiverName"),
          receiverPhone: str("receiverPhone"),
          budgetIsStrict: f.get("budgetIsStrict") === "on",
          deadlineIsStrict: f.get("deadlineIsStrict") === "on",
        };

        const dims = ["lengthCm", "widthCm", "heightCm"].map((k) => str(k));
        if (dims.some(Boolean)) {
          if (!dims.every(Boolean)) return setError("Renseignez les trois dimensions (L, l, h) ou aucune.");
          ["lengthCm", "widthCm", "heightCm"].forEach((k, i) => (body[k] = Number(dims[i])));
        }
        if (str("declaredValue")) {
          const cur = str("declaredCurrency") as CurrencyCode;
          const minor = parseMajorToMinor(str("declaredValue"), cur);
          if (minor === null) return setError("Valeur déclarée invalide.");
          body.declaredValueMinor = minor;
          body.declaredValueCurrency = cur;
        }
        if (str("budget")) {
          const cur = str("budgetCurrency") as CurrencyCode;
          const minor = parseMajorToMinor(str("budget"), cur);
          if (minor === null) return setError("Budget invalide.");
          body.budgetMaxMinor = minor;
          body.budgetCurrency = cur;
        } else {
          body.budgetIsStrict = false;
        }
        for (const [field, key] of [
          ["earliest", "earliestDepartureAt"],
          ["latest", "latestDepartureAt"],
          ["neededBy", "neededBy"],
        ] as const) {
          const iso = localInputToIso(str(field));
          if (str(field) && !iso) return setError("Date invalide.");
          if (iso) body[key] = iso;
        }
        if (!body.neededBy) body.deadlineIsStrict = false;

        setPending(true);
        const created = await api<{ id: string }>("/api/v1/requests", "POST", body);
        if (!created.ok) {
          setPending(false);
          return setError(describeError(created.error));
        }
        if (fixed) {
          const booking = await api("/api/v1/bookings", "POST", { requestId: created.data.id, offerId: fixed.offerId, message: str("message") || undefined });
          setPending(false);
          if (!booking.ok) {
            // La demande existe : on l'ouvre pour que l'utilisateur voie les alternatives.
            return setError(`${describeError(booking.error)} Votre demande a été enregistrée : consultez-la depuis « Mon espace ».`);
          }
          router.push("/dashboard?booked=1");
        } else {
          setPending(false);
          router.push(`/requests/${created.data.id}`);
        }
        router.refresh();
      }}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-base font-semibold">Trajet et colis</legend>
        {fixed ? null : (
          <>
            <Field label="De" htmlFor="origin">
              <select id="origin" name="origin" required defaultValue={cities[0]?.id} className={inputCls}>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vers" htmlFor="destination">
              <select id="destination" name="destination" required defaultValue={cities[1]?.id ?? cities[0]?.id} className={inputCls}>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <Field label="Poids (kg)" htmlFor="weightKg">
          <input id="weightKg" name="weightKg" required inputMode="decimal" defaultValue={defaults?.weightKg ?? ""} placeholder="5" className={inputCls} />
        </Field>
        <Field label="Nature du colis" htmlFor="category">
          <select id="category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
            {OFFERABLE.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
                {c.policy === "review" ? " — à vérifier" : ""}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          {policy === "review" ? (
            <Notice tone="warn">
              Cette marchandise est soumise à vérification (déclaration précise et contrôle à la remise). Le transporteur doit l&apos;accepter explicitement.
              Vérifiez la réglementation applicable : la plateforme ne la garantit pas.
            </Notice>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">
            Interdits sur la plateforme : {PROHIBITED.map((c) => c.label.toLowerCase()).join(" ; ")}. Politique interne, non validée juridiquement.
          </p>
        </div>
        <div className="sm:col-span-2">
          <Field label="Contenu détaillé" htmlFor="description" hint="Décrivez précisément ce que contient le colis : le transporteur doit savoir ce qu'il transporte.">
            <textarea id="description" name="description" required minLength={3} maxLength={500} rows={3} className={inputCls} />
          </Field>
        </div>
        <Field label="Dimensions L × l × h en cm (facultatif)" htmlFor="lengthCm">
          <div className="grid grid-cols-3 gap-2">
            <input id="lengthCm" name="lengthCm" inputMode="numeric" placeholder="L" aria-label="Longueur en cm" className={inputCls} />
            <input name="widthCm" inputMode="numeric" placeholder="l" aria-label="Largeur en cm" className={inputCls} />
            <input name="heightCm" inputMode="numeric" placeholder="h" aria-label="Hauteur en cm" className={inputCls} />
          </div>
        </Field>
        <Field label="Valeur déclarée (facultatif)" htmlFor="declaredValue">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input id="declaredValue" name="declaredValue" inputMode="decimal" className={inputCls} />
            <select name="declaredCurrency" defaultValue={fixed?.currency ?? "XOF"} aria-label="Devise de la valeur déclarée" className={inputCls}>
              {CURRENCY_CODES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-base font-semibold">Destinataire</legend>
        <Field label="Nom du destinataire" htmlFor="receiverName">
          <input id="receiverName" name="receiverName" required minLength={2} autoComplete="off" className={inputCls} />
        </Field>
        <Field label="Téléphone du destinataire" htmlFor="receiverPhone" hint="Visible uniquement du transporteur dont la réservation est acceptée.">
          <input id="receiverPhone" name="receiverPhone" required type="tel" inputMode="tel" autoComplete="off" placeholder="+225…" className={inputCls} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-base font-semibold">Préférences (facultatif)</legend>
        <Field label="Budget maximum" htmlFor="budget">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input id="budget" name="budget" inputMode="decimal" className={inputCls} />
            <select name="budgetCurrency" defaultValue={fixed?.currency ?? "XOF"} aria-label="Devise du budget" className={inputCls}>
              {CURRENCY_CODES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </Field>
        <label className="flex items-center gap-3 self-end pb-2 text-sm">
          <input type="checkbox" name="budgetIsStrict" className="size-5" />
          Budget strict : exclure les offres plus chères
        </label>
        <Field label="Départ au plus tôt (GMT)" htmlFor="earliest">
          <input id="earliest" name="earliest" type="datetime-local" className={inputCls} />
        </Field>
        <Field label="Départ au plus tard (GMT)" htmlFor="latest">
          <input id="latest" name="latest" type="datetime-local" className={inputCls} />
        </Field>
        <Field label="Doit arriver avant (GMT)" htmlFor="neededBy">
          <input id="neededBy" name="neededBy" type="datetime-local" className={inputCls} />
        </Field>
        <label className="flex items-center gap-3 self-end pb-2 text-sm">
          <input type="checkbox" name="deadlineIsStrict" className="size-5" />
          Échéance stricte : exclure les arrivées plus tardives
        </label>
      </fieldset>

      {fixed ? (
        <Field label="Message au transporteur (facultatif)" htmlFor="message">
          <textarea id="message" name="message" maxLength={500} rows={2} className={inputCls} />
        </Field>
      ) : null}

      <button type="submit" disabled={pending} className={`${btnPrimary} w-full sm:w-auto`}>
        {pending ? "Envoi…" : fixed ? "Envoyer la demande de réservation" : "Publier ma demande"}
      </button>
    </form>
  );
}
