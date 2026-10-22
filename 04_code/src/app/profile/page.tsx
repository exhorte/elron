import type { Metadata } from "next";
import { Badge, Card, Notice, PageTitle } from "@/components/ui";
import { TravelerProfileForm } from "@/components/traveler-profile-form";
import { getDb } from "@/db/client";
import { IDENTITY_LABELS } from "@/lib/format";
import { requireActorPage } from "@/lib/session";
import { getTravelerProfile } from "@/server/admin";

export const metadata: Metadata = { title: "Mon profil" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const actor = await requireActorPage("/profile");
  const profile = await getTravelerProfile(getDb(), actor.id);
  const identity = IDENTITY_LABELS[profile?.identityStatus ?? "not_provided"]!;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle title="Mon profil" subtitle={`${actor.displayName} · ${actor.email}`} />
      <Card>
        <h2 className="font-semibold">Expéditeur</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Tout compte peut envoyer des colis. Le téléphone n&apos;est pas encore vérifié (fonction à venir).</p>
      </Card>
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">Voyageur / transporteur</h2>
          {profile ? <Badge tone={identity.tone}>{identity.label}</Badge> : null}
        </div>
        {profile?.identityStatus === "rejected" ? (
          <div className="mb-3">
            <Notice tone="warn">Votre dernière vérification a été refusée{profile.identityReviewNote ? ` : ${profile.identityReviewNote}` : ""}. Corrigez votre déclaration puis enregistrez.</Notice>
          </div>
        ) : null}
        <TravelerProfileForm initial={profile} submitLabel={profile ? "Enregistrer" : "Créer mon profil voyageur"} />
      </Card>
    </div>
  );
}
