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
| `src/server/` | Services transactionnels : `auth, offers, requests, search, bookings, shipments, admin, audit, geo` ; lot 2 : `rate-limit, password-reset, mail, proofs, storage, disputes, reviews` ; + `http.ts` (enveloppe des endpoints : auth, CSRF, IP de confiance, multipart plafonné), `validation.ts` (zod), `openapi.ts` |
| `src/app/api/v1/` | 46 opérations HTTP |
| `src/app/**` | Pages : accueil, recherche, réservation, demande, trajet, tableau de bord, colis (preuves, litiges, avis), suivi public, profil, réputation `/users/[id]`, mot de passe oublié/réinitialisation, admin, à propos |
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
shipments ─< proof_files                                  (preuves téléversées : métadonnées + SHA-256 ; fichier sur stockage privé ; append-only)
shipments ─< disputes ─< dispute_messages                 (DISPUTED ⇔ un litige ouvert ; fil append-only avec instantanés de preuves)
shipments ─< reviews                                      (1 avis / auteur / colis, 1–5, après DELIVERED ; append-only)
users ─< password_reset_tokens                            (SHA-256 du jeton, 60 min, usage unique)
rate_limit_buckets                                        (compteurs à fenêtre fixe ; sujet haché)
audit_logs                                                (append-only ; jamais de secret)
```

Contraintes clés (testées) : e-mail en minuscules et unique ; `reserved ≤ capacity` ; `net + commission = sous-total` ; une réservation active par paire demande/offre ; **une seule réservation acceptée par demande** ; un colis par réservation ; code de suivi unique ; `verified` exige un relecteur ; fenêtres de dates ordonnées ; budget/valeur déclarée avec devise ; triggers `forbid_mutation` sur les journaux.

## Séparation des concepts

Une demande n'est pas un colis ; un colis n'est pas une réservation ; une réservation n'est pas un paiement (inexistant) ; un paiement ne serait pas une preuve de livraison. Les trois cycles de vie (demande, réservation, colis) sont distincts (D-006).

## Concurrence

Ordre global des verrous : `shipment_requests → capacity_offers → bookings → shipments → disputes`. `lockShipmentForTransition` + `applyLockedTransition` (src/server/shipments.ts) sont le **point unique** de changement de statut (hors code de remise) ; ouverture et résolution de litige s'en servent dans leur propre transaction. Acceptation, annulation de colis et confirmation de remise sont transactionnelles ; la confirmation de remise **valide** l'incrément de tentatives avant de lever l'erreur (sinon le rollback effacerait le compteur).

## Sécurité (mesures en place)

Sessions à jeton aléatoire hachées ; cookie HttpOnly + SameSite=Lax (+ Secure en production) ; contrôle d'origine sur les écritures ; JSON strict (champs inconnus refusés) ; 401/403/404 distingués (un tiers reçoit 404 sur un colis) ; verrouillage de connexion ; code de remise HMAC + tentatives + expiration ; données personnelles du destinataire visibles des seules parties ; suivi public sans donnée personnelle ; adresses de dépôt/retrait non publiques ; audit sans secrets ; en-têtes `nosniff`, `X-Frame-Options`, `Referrer-Policy`. **Lot 2** : limitation de débit en base (IP de confiance uniquement) ; jetons de réinitialisation hachés, à usage unique, sessions révoquées ; preuves validées sur les octets, stockage privé, service avec CSP `sandbox` + `nosniff` + `no-store`, corps multipart lu en flux plafonné ; litiges et avis immuables ; résolution de litige interdite aux parties.

## Extension prévue (sans réécriture)

| Marché / besoin | Point d'accroche |
|---|---|
| B — agences/transporteurs | `organizations` + `organization_members` + `carrier_profiles` ; `capacity_offers.organization_id` ; récurrence de départs |
| C — demandes avec offres | table `quotes` liée à `shipment_requests` ; le moteur de filtres est réutilisable |
| D — multi-segments | `shipment_segments` entre `shipments` et `bookings` ; transferts de responsabilité = événements |
| Relais | `relay_points` + remise par scan/OTP déjà modélisée (code de remise) |
| Paiement | table `payments` + adaptateur ; **seulement** après validation (D-015) |
| Classement appris | `rankOffers` accepte une `MatchingConfig` ; livraisons, incidents et avis alimentent déjà la fiabilité |
| Notifications / e-mail | `notifications` + `MailAdapter` (interface prête, **aucun fournisseur branché**) |
| Stockage S3 | l'interface `ObjectStorage` accepte un second adaptateur sans toucher aux services |
