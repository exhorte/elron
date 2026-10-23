import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { stars } from "@/components/review-section";
import { Badge, Card, Notice, PageTitle } from "@/components/ui";
import { getDb } from "@/db/client";
import { IDENTITY_LABELS, ROLE_LABELS, formatDate, formatRating } from "@/lib/format";
import { getReputation } from "@/server/reviews";

export const metadata: Metadata = { title: "Réputation" };
export const dynamic = "force-dynamic";

export default async function UserReputationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const rep = await getReputation(getDb(), id).catch(() => null);
  if (!rep) notFound();
  const identity = IDENTITY_LABELS[rep.user.identityStatus ?? "not_provided"]!;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle title={rep.user.displayName} subtitle="Réputation sur la plateforme" />
      <Badge tone={identity.tone}>{identity.label}</Badge>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-semibold">En tant que transporteur</h2>
          <p className="mt-1 text-lg">{formatRating(rep.asProvider.ratings)}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {rep.asProvider.delivered} livraison{rep.asProvider.delivered > 1 ? "s" : ""} confirmée{rep.asProvider.delivered > 1 ? "s" : ""} · {rep.asProvider.incidents} incident{rep.asProvider.incidents > 1 ? "s" : ""} (perte, dommage ou litige)
          </p>
        </Card>
        <Card>
          <h2 className="font-semibold">En tant qu&apos;expéditeur</h2>
          <p className="mt-1 text-lg">{formatRating(rep.asSender.ratings)}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {rep.asSender.delivered} envoi{rep.asSender.delivered > 1 ? "s" : ""} livré{rep.asSender.delivered > 1 ? "s" : ""}
          </p>
        </Card>
      </div>

      <section aria-labelledby="recent" className="space-y-2">
        <h2 id="recent" className="text-lg font-semibold">
          Derniers avis
        </h2>
        {rep.recent.length === 0 ? (
          <Notice>Aucun avis pour le moment.</Notice>
        ) : (
          rep.recent.map((r, i) => (
            <Card key={i}>
              <p className="text-xs text-slate-500">
                {r.authorName} ({ROLE_LABELS[r.authorRole]}) · {formatDate(r.createdAt)}
              </p>
              <p className="mt-1">
                <span className="text-amber-600" aria-label={`${r.rating} sur 5`}>
                  {stars(r.rating)}
                </span>{" "}
                {r.rating}/5
              </p>
              {r.comment ? <p className="mt-1 whitespace-pre-wrap text-sm">{r.comment}</p> : null}
            </Card>
          ))
        )}
      </section>
      <p className="text-xs text-slate-500">
        Les avis sont publiés dès leur dépôt et ne sont pas modifiables ; la plateforme ne les vérifie pas. Une note ne remplace pas la vérification d&apos;identité ni ne garantit une livraison.
      </p>
    </div>
  );
}
