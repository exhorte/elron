import Link from "next/link";
import { SearchForm } from "@/components/search-form";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";
import { getDb } from "@/db/client";
import { citiesFromRoutes } from "@/lib/cities";
import { listEnabledRoutes } from "@/server/geo";

export const dynamic = "force-dynamic";

const steps = [
  { title: "1. Cherchez", text: "Indiquez le trajet, le poids et la nature de votre colis. Seules les offres compatibles s'affichent." },
  { title: "2. Comparez et réservez", text: "Prix total, dates, dernier dépôt, informations manquantes : tout est visible. Le transporteur accepte ou refuse." },
  { title: "3. Suivez et confirmez", text: "Chaque étape est enregistrée. La remise se confirme avec un code à usage unique donné au destinataire." },
];

export default async function HomePage() {
  const routes = await listEnabledRoutes(getDb());
  const cities = citiesFromRoutes(routes);
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Envoyez un colis avec la capacité de transport déjà disponible.</h1>
        <p className="max-w-2xl text-lg text-slate-600 dark:text-slate-400">
          ALX met en relation les expéditeurs avec des voyageurs et des transporteurs qui ont de la place sur un trajet existant. Prototype : couloir
          de validation <strong>Dakar ↔ Abidjan</strong>.
        </p>
      </section>

      <Card>
        <SearchForm cities={cities} />
      </Card>

      <section className="grid gap-4 md:grid-cols-3" aria-label="Comment ça marche">
        {steps.map((s) => (
          <Card key={s.title}>
            <h2 className="font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{s.text}</p>
          </Card>
        ))}
      </section>

      <section className="flex flex-wrap gap-3">
        <Link href="/trips/new" className={btnPrimary}>
          Je voyage : publier mon trajet
        </Link>
        <Link href="/requests/new" className={btnSecondary}>
          J&apos;ai un colis à envoyer
        </Link>
        <Link href="/track" className={btnSecondary}>
          Suivre un colis
        </Link>
      </section>
    </div>
  );
}
