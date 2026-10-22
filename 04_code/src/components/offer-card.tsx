import Link from "next/link";
import { categoryLabel } from "@/config/goods-policy";
import { formatMoney, formatWeight } from "@/domain/money";
import { CRITERIA_LABELS, FLAG_LABELS, IDENTITY_LABELS, TRANSPORT_LABELS, formatDateTime } from "@/lib/format";
import type { SearchResult } from "@/server/search";
import { Badge, DemoBadge, btnPrimary } from "./ui";

const FLAG_TONE: Record<string, "warn" | "muted"> = {
  over_budget: "warn",
  after_deadline: "warn",
  arrival_unknown: "warn",
  identity_unverified: "warn",
  review_category: "warn",
};

export function OfferCard({ result, bookHref, weightG }: { result: SearchResult; bookHref?: string; weightG: number }) {
  const { offer, match } = result;
  const identity = IDENTITY_LABELS[offer.provider.identityStatus ?? "not_provided"] ?? IDENTITY_LABELS.not_provided!;
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            {offer.origin.name} → {offer.destination.name}
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {offer.provider.displayName} · {TRANSPORT_LABELS[offer.transportMode] ?? offer.transportMode}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold">{formatMoney(match.totalMinor, match.currency)}</p>
          <p className="text-xs text-slate-500">
            pour {formatWeight(weightG)} · {formatMoney(offer.pricePerKgMinor, offer.currency)}/kg
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {offer.isDemo ? <DemoBadge /> : null}
        <Badge tone={identity.tone}>{identity.label}</Badge>
        {match.flags
          .filter((f) => f !== "identity_unverified") /* déjà couvert par le badge d'identité ci-dessus */
          .map((f) => (
            <Badge key={f} tone={FLAG_TONE[f] ?? "muted"}>
              {FLAG_LABELS[f]}
            </Badge>
          ))}
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="inline text-slate-500">Départ : </dt>
          <dd className="inline">{formatDateTime(offer.departureAt)}</dd>
        </div>
        <div>
          <dt className="inline text-slate-500">Arrivée estimée : </dt>
          <dd className="inline">{offer.arrivalEstimatedAt ? formatDateTime(offer.arrivalEstimatedAt) : "non déclarée"}</dd>
        </div>
        <div>
          <dt className="inline text-slate-500">Dernier dépôt : </dt>
          <dd className="inline">{offer.depositCutoffAt ? formatDateTime(offer.depositCutoffAt) : "non précisé"}</dd>
        </div>
        <div>
          <dt className="inline text-slate-500">Capacité restante : </dt>
          <dd className="inline">
            {formatWeight(offer.availableWeightG)}
            {offer.availableVolumeL !== null ? ` · ${offer.availableVolumeL} L` : ""}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="inline text-slate-500">Accepte : </dt>
          <dd className="inline">{offer.acceptedCategories.map(categoryLabel).join(", ")}</dd>
        </div>
        {offer.handoverTerms ? (
          <div className="sm:col-span-2">
            <dt className="inline text-slate-500">Conditions de remise : </dt>
            <dd className="inline">{offer.handoverTerms}</dd>
          </div>
        ) : null}
      </dl>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-600 dark:text-slate-400">
          Score de classement : <strong>{match.score}/100</strong> (indicatif, pondérations non validées)
        </summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="py-1 pr-2 font-medium">Critère</th>
              <th className="py-1 pr-2 font-medium">Valeur (0–1)</th>
              <th className="py-1 font-medium">Poids</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(match.breakdown).map(([criterion, v]) => (
              <tr key={criterion} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 pr-2">{CRITERIA_LABELS[criterion] ?? criterion}</td>
                <td className="py-1 pr-2">{v.value.toFixed(2)}</td>
                <td className="py-1">{v.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {bookHref ? (
        <div className="mt-4">
          <Link href={bookHref} className={btnPrimary}>
            Demander à réserver
          </Link>
          <p className="mt-2 text-xs text-slate-500">Aucune capacité n&apos;est bloquée avant l&apos;acceptation du transporteur.</p>
        </div>
      ) : null}
    </article>
  );
}
