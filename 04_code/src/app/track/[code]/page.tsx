import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Notice, PageTitle, btnSecondary } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatDateTime } from "@/lib/format";
import { trackPublic } from "@/server/shipments";

export const metadata: Metadata = { title: "Suivi de colis", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function TrackCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const tracking = await trackPublic(getDb(), decodeURIComponent(code)).catch(() => null);
  if (!tracking) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <PageTitle title="Colis introuvable" />
        <Notice tone="warn">Aucun colis ne correspond à ce code. Vérifiez la saisie.</Notice>
        <Link href="/track" className={btnSecondary}>
          Nouvelle recherche
        </Link>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle title={`Colis ${tracking.trackingCode}`} subtitle={`${tracking.origin} → ${tracking.destination}`} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tracking.status === "DELIVERED" ? "ok" : "muted"}>{tracking.statusLabel}</Badge>
        <span className="text-xs text-slate-500">Mis à jour le {formatDateTime(tracking.updatedAt)}</span>
      </div>
      <Card>
        <ol className="space-y-4 border-l-2 border-slate-200 pl-4 dark:border-slate-700">
          {tracking.events.map((e, i) => (
            <li key={`${e.status}-${i}`} className="relative">
              <span className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full bg-emerald-600" aria-hidden />
              <p className="font-medium">{e.label}</p>
              <p className="text-xs text-slate-500">{formatDateTime(e.occurredAt)}</p>
            </li>
          ))}
        </ol>
      </Card>
      <p className="text-xs text-slate-500">
        Page publique : elle n&apos;affiche ni noms, ni téléphones, ni contenu. La plateforme ne garantit pas la livraison ; en cas de problème, les parties
        peuvent ouvrir un litige depuis leur compte.
      </p>
    </div>
  );
}
