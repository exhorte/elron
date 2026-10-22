"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GOODS_CATEGORIES } from "@/config/goods-policy";
import { CURRENCY_CODES, parseMajorToMinor, type CurrencyCode } from "@/domain/money";
import { TRANSPORT_LABELS, localInputToIso } from "@/lib/format";
import { api, describeError } from "./api-client";
import type { CityOption } from "./search-form";
import { Field, Notice, btnPrimary, inputCls } from "./ui";

const OFFERABLE = GOODS_CATEGORIES.filter((c) => c.policy !== "prohibited");

export function OfferForm({ cities }: { cities: CityOption[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const f = new FormData(e.currentTarget);
        const str = (k: string) => String(f.get(k) ?? "").trim();

        const kg = Number(str("capacityKg").replace(",", "."));
        if (!Number.isFinite(kg) || kg <= 0) return setError("Indiquez une capacité valide en kg.");
        const currency = str("currency") as CurrencyCode;
        const price = parseMajorToMinor(str("pricePerKg"), currency);
        if (price === null) return setError(`Prix par kg invalide pour la devise ${currency}.`);
        const departureAt = localInputToIso(str("departureAt"));
        if (!departureAt) return setError("Indiquez la date et l'heure de départ.");
        const categories = f.getAll("categories").map(String);
        if (categories.length === 0) return setError("Cochez au moins une catégorie de marchandise acceptée.");

        const body: Record<string, unknown> = {
          originCityId: str("origin"),
          destinationCityId: str("destination"),
          transportMode: str("transportMode"),
          departureAt,
          capacityWeightG: Math.round(kg * 1000),
          pricePerKgMinor: price,
          currency,
          acceptedCategories: categories,
        };
        for (const [field, key] of [
          ["arrivalEstimatedAt", "arrivalEstimatedAt"],
          ["depositCutoffAt", "depositCutoffAt"],
        ] as const) {
          if (str(field)) {
            const iso = localInputToIso(str(field));
            if (!iso) return setError("Date invalide.");
            body[key] = iso;
          }
        }
        if (str("capacityVolumeL")) body.capacityVolumeL = Number(str("capacityVolumeL"));
        for (const k of ["handoverTerms", "depositAddress", "pickupAddress"]) if (str(k)) body[k] = str(k);

        setPending(true);
        const res = await api<{ id: string }>("/api/v1/offers", "POST", body);
        setPending(false);
        if (!res.ok) return setError(describeError(res.error));
        router.push("/dashboard?published=1");
        router.refresh();
      }}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-base font-semibold">Votre trajet</legend>
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
        <Field label="Moyen de transport" htmlFor="transportMode">
          <select id="transportMode" name="transportMode" className={inputCls} defaultValue="air">
            {Object.entries(TRANSPORT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Départ (heure GMT)" htmlFor="departureAt">
          <input id="departureAt" name="departureAt" type="datetime-local" required className={inputCls} />
        </Field>
        <Field label="Arrivée estimée (GMT, facultatif)" htmlFor="arrivalEstimatedAt" hint="Si vous ne la précisez pas, les expéditeurs verront « arrivée non déclarée ».">
          <input id="arrivalEstimatedAt" name="arrivalEstimatedAt" type="datetime-local" className={inputCls} />
        </Field>
        <Field label="Dernier dépôt des colis (GMT, facultatif)" htmlFor="depositCutoffAt">
          <input id="depositCutoffAt" name="depositCutoffAt" type="datetime-local" className={inputCls} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-base font-semibold">Capacité et prix</legend>
        <Field label="Poids disponible (kg)" htmlFor="capacityKg">
          <input id="capacityKg" name="capacityKg" required inputMode="decimal" placeholder="20" className={inputCls} />
        </Field>
        <Field label="Volume disponible en litres (facultatif)" htmlFor="capacityVolumeL">
          <input id="capacityVolumeL" name="capacityVolumeL" inputMode="numeric" className={inputCls} />
        </Field>
        <Field label="Prix par kg" htmlFor="pricePerKg">
          <input id="pricePerKg" name="pricePerKg" required inputMode="decimal" placeholder="3500" className={inputCls} />
        </Field>
        <Field label="Devise" htmlFor="currency">
          <select id="currency" name="currency" defaultValue="XOF" className={inputCls}>
            {CURRENCY_CODES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-base font-semibold">Marchandises que vous acceptez</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {OFFERABLE.map((c) => (
            <label key={c.code} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
              <input type="checkbox" name="categories" value={c.code} defaultChecked={c.policy === "allowed"} className="mt-0.5 size-5" />
              <span>
                {c.label}
                {c.policy === "review" ? <span className="block text-xs text-amber-700 dark:text-amber-400">À vérifier à la remise — à vous de décider</span> : null}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Les marchandises interdites par la plateforme ne peuvent pas être proposées. Respectez aussi les règles de votre compagnie et des douanes : la
          plateforme ne les valide pas.
        </p>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-1 text-base font-semibold">Remise des colis (facultatif)</legend>
        <Field label="Lieu de dépôt" htmlFor="depositAddress" hint="Révélé uniquement aux expéditeurs dont la réservation est acceptée.">
          <input id="depositAddress" name="depositAddress" maxLength={300} className={inputCls} />
        </Field>
        <Field label="Lieu de retrait à destination" htmlFor="pickupAddress">
          <input id="pickupAddress" name="pickupAddress" maxLength={300} className={inputCls} />
        </Field>
        <Field label="Conditions de remise" htmlFor="handoverTerms">
          <textarea id="handoverTerms" name="handoverTerms" maxLength={1000} rows={3} className={inputCls} />
        </Field>
      </fieldset>

      <button type="submit" disabled={pending} className={`${btnPrimary} w-full sm:w-auto`}>
        {pending ? "Publication…" : "Publier mon trajet"}
      </button>
    </form>
  );
}
