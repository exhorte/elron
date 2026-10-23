import type { Metadata } from "next";
import { Card, PageTitle } from "@/components/ui";
import { GOODS_CATEGORIES, GOODS_POLICY_VALIDATED, GOODS_POLICY_VERSION } from "@/config/goods-policy";
import { DEFAULT_MATCHING_CONFIG } from "@/config/matching";
import { CRITERIA_LABELS } from "@/lib/format";

export const metadata: Metadata = { title: "Limites et conformité" };

const label = { allowed: "Autorisée", review: "À vérifier", prohibited: "Interdite" } as const;

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageTitle title="Limites et conformité" subtitle="Ce que ce prototype fait, et surtout ce qu'il ne fait pas encore." />

      <Card>
        <h2 className="font-semibold">Ce qui n&apos;est pas en place</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>Aucun paiement</strong> : la plateforme ne perçoit, ne retient ni ne reverse aucun argent. Le règlement se fait directement entre les parties. Aucun
            « séquestre » n&apos;est proposé : un tel mécanisme exige un prestataire agréé et une validation juridique.
          </li>
          <li>
            <strong>Pas de vérification automatique de pièce d&apos;identité</strong> : un profil « déclaré » n&apos;est pas « vérifié ». Seul un opérateur peut ajouter le badge, et aucune pièce n&apos;est stockée.
          </li>
          <li>
            Pas de vérification du numéro de téléphone ni de l&apos;adresse e-mail, pas d&apos;application mobile native, pas de points relais, pas de notifications. L&apos;envoi d&apos;e-mails (réinitialisation du mot de passe) n&apos;est branché à aucun
            fournisseur sur cette version.
          </li>
          <li>
            Les <strong>litiges</strong> sont tranchés par un opérateur qui n&apos;agit que sur le statut du colis : aucun remboursement ni indemnisation n&apos;existe (pas de paiement). Les <strong>avis</strong> sont publics dès leur dépôt,
            non modifiables et non vérifiés. Les <strong>preuves téléversées</strong> (photos, PDF) ne sont pas analysées par un antivirus et peuvent contenir des métadonnées (lieu, date).
          </li>
          <li>La plateforme ne garantit pas la livraison et n&apos;offre aucune assurance.</li>
        </ul>
      </Card>

      <Card>
        <h2 className="font-semibold">Politique de marchandises (interne)</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Version {GOODS_POLICY_VERSION} — {GOODS_POLICY_VALIDATED ? "validée juridiquement" : "NON validée juridiquement"}. Il s&apos;agit d&apos;une politique propre à la plateforme, pas d&apos;une règle douanière ou
          légale : vérifiez toujours la réglementation du pays de départ, du pays d&apos;arrivée et du mode de transport.
        </p>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {GOODS_CATEGORIES.map((c) => (
            <li key={c.code}>
              {c.label} — <span className="font-medium">{label[c.policy]}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="font-semibold">Classement des offres</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Les exigences obligatoires (trajet, capacité, nature de marchandise, dates, statut du transporteur) excluent une offre : aucun score ne les contourne. Entre offres
          compatibles, un score indicatif de 0 à 100 combine ces critères. Les pondérations sont des hypothèses initiales, non calibrées ni validées (version {DEFAULT_MATCHING_CONFIG.version}).
        </p>
        <ul className="mt-2 text-sm">
          {Object.entries(DEFAULT_MATCHING_CONFIG.weights).map(([k, w]) => (
            <li key={k}>
              {CRITERIA_LABELS[k]} : {w}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="font-semibold">Données de démonstration</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Ce site démarre sans aucune donnée fictive. Les données de démonstration, lorsqu&apos;elles sont chargées pour des essais, sont marquées « DÉMO » et ne sont jamais mélangées aux données réelles.
        </p>
      </Card>
    </div>
  );
}
