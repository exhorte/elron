import { OFFERABLE_CATEGORIES } from "@/config/goods-policy";
import { Field, btnPrimary, inputCls } from "./ui";

export interface CityOption {
  id: string;
  name: string;
}

/** Formulaire GET (fonctionne sans JavaScript) : la recherche est une simple URL partageable. */
export function SearchForm({
  cities,
  values = {},
}: {
  cities: CityOption[];
  values?: { origin?: string; destination?: string; weightKg?: string; category?: string; departureFrom?: string; departureTo?: string };
}) {
  return (
    <form action="/search" method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="De" htmlFor="origin">
        <select id="origin" name="origin" required defaultValue={values.origin ?? cities[0]?.id} className={inputCls}>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Vers" htmlFor="destination">
        <select id="destination" name="destination" required defaultValue={values.destination ?? cities[1]?.id ?? cities[0]?.id} className={inputCls}>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Poids du colis (kg)" htmlFor="weightKg">
        <input id="weightKg" name="weightKg" type="number" min="0.1" max="100" step="0.1" required defaultValue={values.weightKg ?? "5"} inputMode="decimal" className={inputCls} />
      </Field>
      <Field label="Nature (facultatif)" htmlFor="category">
        <select id="category" name="category" defaultValue={values.category ?? ""} className={inputCls}>
          <option value="">Toutes</option>
          {OFFERABLE_CATEGORIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
              {c.policy === "review" ? " (à vérifier)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Départ à partir du" htmlFor="departureFrom">
        <input id="departureFrom" name="departureFrom" type="date" defaultValue={values.departureFrom} className={inputCls} />
      </Field>
      <Field label="Départ au plus tard le" htmlFor="departureTo">
        <input id="departureTo" name="departureTo" type="date" defaultValue={values.departureTo} className={inputCls} />
      </Field>
      <div className="flex items-end sm:col-span-2">
        <button type="submit" className={`${btnPrimary} w-full sm:w-auto`}>
          Rechercher un trajet
        </button>
      </div>
    </form>
  );
}
