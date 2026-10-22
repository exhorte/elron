import type { Metadata } from "next";
import { OfferForm } from "@/components/offer-form";
import { TravelerProfileForm } from "@/components/traveler-profile-form";
import { Card, Notice, PageTitle } from "@/components/ui";
import { getDb } from "@/db/client";
import { citiesFromRoutes } from "@/lib/cities";
import { requireActorPage } from "@/lib/session";
import { getTravelerProfile } from "@/server/admin";
import { listEnabledRoutes } from "@/server/geo";

export const metadata: Metadata = { title: "Publier un trajet" };
export const dynamic = "force-dynamic";

export default async function NewTripPage() {
  const actor = await requireActorPage("/trips/new");
  const db = getDb();
  const profile = await getTravelerProfile(db, actor.id);

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageTitle title="Publier un trajet" subtitle="Créez d'abord votre profil voyageur/transporteur." />
        <Card>
          <TravelerProfileForm submitLabel="Créer mon profil voyageur" />
        </Card>
      </div>
    );
  }
  const cities = citiesFromRoutes(await listEnabledRoutes(db));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle title="Publier un trajet" subtitle="Déclarez votre capacité disponible : les expéditeurs pourront vous demander de la réserver." />
      {actor.isDemo ? <Notice tone="warn">Compte de démonstration : cette offre sera marquée comme fictive.</Notice> : null}
      <Card>
        <OfferForm cities={cities} />
      </Card>
    </div>
  );
}
