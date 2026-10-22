import type { Metadata } from "next";
import { RequestForm } from "@/components/request-form";
import { Card, PageTitle } from "@/components/ui";
import { getDb } from "@/db/client";
import { citiesFromRoutes } from "@/lib/cities";
import { requireActorPage } from "@/lib/session";
import { listEnabledRoutes } from "@/server/geo";

export const metadata: Metadata = { title: "Envoyer un colis" };
export const dynamic = "force-dynamic";

export default async function NewRequestPage() {
  await requireActorPage("/requests/new");
  const cities = citiesFromRoutes(await listEnabledRoutes(getDb()));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle title="Envoyer un colis" subtitle="Décrivez votre colis : nous vous proposerons les offres compatibles." />
      <Card>
        <RequestForm cities={cities} />
      </Card>
    </div>
  );
}
