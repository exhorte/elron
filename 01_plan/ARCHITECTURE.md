# ARCHITECTURE — lot 1 (MVP)

## Vue d'ensemble

```
Navigateur ──► Next.js 16 (App Router)
                 ├─ Pages serveur  ──► services (src/server) ──► Drizzle ──► PostgreSQL 16
                 ├─ Composants client (formulaires) ──► /api/v1/* (route handlers) ──► services
                 └─ Domaine pur (src/domain, src/config) : argent, workflow, matching, remise — sans I/O
```

Une application, un déploiement. Les pages serveur appellent directement les services ; les formulaires passent par l'API `/api/v1`. **L'autorisation est dans les services**, donc identique pour les deux chemins.

## Arborescence (`04_code/`)

| Chemin | Rôle |
|---|---|
| `src/domain/` | Logique pure testable : `money`, `workflow` (table de transitions), `matching`, `handover`, `ids` |
| `src/config/` | Configuration versionnée : `cities` (périmètre), `goods-policy` (non validée), `matching` (poids), `app` (env) |
| `src/db/` | `schema.ts` (Drizzle), `client.ts`, `reference-data.ts`, `errors.ts` |
| `drizzle/` | Migrations SQL : `0000_init` (générée) et `0001_immutability_triggers` (écrite à la main) |
| `src/server/` | Services transactionnels : `auth, offers, requests, search, bookings, shipments, admin, audit, geo` + `http.ts` (enveloppe des endpoints), `validation.ts` (zod), `openapi.ts` |
| `src/app/api/v1/` | 30 opérations HTTP |
| `src/app/**` | Pages : accueil, recherche, réservation, demande, trajet, tableau de bord, colis, suivi public, profil, admin, à propos |
| `src/components/` | UI (Tailwind 4), formulaires client |
| `scripts/` | `migrate.ts`, `seed-demo.ts`, `build-openapi.ts` |
| `tests/` | `unit/` (pur), `integration/` (PostgreSQL réel), `api/` (handlers + contrat OpenAPI) |
| `docs/openapi.json` | Contrat d'API généré |

## Modèle de données

```
users ─┬─< sessions
       ├─1 traveler_profiles (statut d'identité : not_provided/declared/verified/rejected + relecteur)
       ├─< capacity_offers >─ routes >─ cities          (offre = capacité publiée par un voyageur/transporteur)
       └─< shipment_requests >─ routes                   (demande d'envoi ; destinataire = champs, pas un utilisateur)

shipment_requests ─< bookings >─ capacity_offers          (prix et montants figés ; états requested/accepted/…)
bookings ─1 shipments ─< shipment_items
                      └─< shipment_events                 (append-only : de/vers, acteur, rôle, note, contexte, preuves)
audit_logs                                                (append-only ; jamais de secret)
```

Contraintes clés (testées) : e-mail en minuscules et unique ; `reserved ≤ capacity` ; `net + commission = sous-total` ; une réservation active par paire demande/offre ; **une seule réservation acceptée par demande** ; un colis par réservation ; code de suivi unique ; `verified` exige un relecteur ; fenêtres de dates ordonnées ; budget/valeur déclarée avec devise ; triggers `forbid_mutation` sur les journaux.

## Séparation des concepts

Une demande n'est pas un colis ; un colis n'est pas une réservation ; une réservation n'est pas un paiement (inexistant) ; un paiement ne serait pas une preuve de livraison. Les trois cycles de vie (demande, réservation, colis) sont distincts (D-006).

## Concurrence

Ordre global des verrous : `shipment_requests → capacity_offers → bookings → shipments`. Acceptation, annulation de colis et confirmation de remise sont transactionnelles ; la confirmation de remise **valide** l'incrément de tentatives avant de lever l'erreur (sinon le rollback effacerait le compteur).

## Sécurité (mesures en place)

Sessions à jeton aléatoire hachées ; cookie HttpOnly + SameSite=Lax (+ Secure en production) ; contrôle d'origine sur les écritures ; JSON strict (champs inconnus refusés) ; 401/403/404 distingués (un tiers reçoit 404 sur un colis) ; verrouillage de connexion ; code de remise HMAC + tentatives + expiration ; données personnelles du destinataire visibles des seules parties ; suivi public sans donnée personnelle ; adresses de dépôt/retrait non publiques ; audit sans secrets ; en-têtes `nosniff`, `X-Frame-Options`, `Referrer-Policy`.

## Extension prévue (sans réécriture)

| Marché / besoin | Point d'accroche |
|---|---|
| B — agences/transporteurs | `organizations` + `organization_members` + `carrier_profiles` ; `capacity_offers.organization_id` ; récurrence de départs |
| C — demandes avec offres | table `quotes` liée à `shipment_requests` ; le moteur de filtres est réutilisable |
| D — multi-segments | `shipment_segments` entre `shipments` et `bookings` ; transferts de responsabilité = événements |
| Relais | `relay_points` + remise par scan/OTP déjà modélisée (code de remise) |
| Paiement | table `payments` + adaptateur ; **seulement** après validation (D-015) |
| Classement appris | `rankOffers` accepte une `MatchingConfig` ; les statistiques de fiabilité sont déjà calculées |
| Notifications | `notifications` + adaptateur ; aucune intégration ne prétend fonctionner aujourd'hui |
