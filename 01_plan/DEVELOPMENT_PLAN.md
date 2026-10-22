# DEVELOPMENT_PLAN

Principe : petits lots cohérents, chacun avec critères d'acceptation, tests et mise à jour de `PROJECT_STATE.md`. Un lot ne commence pas tant que les erreurs bloquantes du précédent ne sont pas traitées ou documentées.

| Lot | Contenu | Critères d'acceptation | État |
|---|---|---|---|
| 0 | Audit, catalogue de réutilisation, benchmark, architecture, décisions | `REUSE_CATALOG`, `BENCHMARK`, `ARCHITECTURE`, `DECISIONS_LOG` écrits ; licences lues dans les dépôts | ✅ 2026-10-22 |
| 1 | **MVP** : auth, profils, offres, demandes, recherche/matching, réservation, acceptation/refus, colis, workflow par rôles, code de remise, historique, suivi public, tableau de bord, admin minimal, tests, docs | Critères de succès §23 du prompt (voir tableau ci-dessous) | ✅ 2026-10-22 |
| 2 | Confiance et hygiène : mot de passe oublié, vérifications e-mail/téléphone, limitation de débit, litiges, notation, preuves téléversées, notifications, E2E, Dockerfile | Parcours de litige complet testé ; aucune action sensible sans limitation de débit ; preuves stockées en privé | ⏳ NEXT_STEPS P1 |
| 3 | Agences (marché B) : organisations, membres, départs récurrents, tarifs par paliers/forfaits, tableau de bord agence | Une agence publie une route récurrente et gère ses colis avec ≥ 2 membres ; permissions par organisation testées | — |
| 4 | Demandes avec offres (marché C) : `quotes`, comparaison, acceptation d'un devis | Plusieurs transporteurs répondent à une demande ; un seul devis accepté ; aucune surréservation | — |
| 5 | Points relais : `relay_points`, remise assistée, retrait par code/QR | Un colis déposé et retiré en relais avec preuve horodatée | — |
| 6 | Paiement **en sandbox** (après décision humaine P0.3) : `payments, payouts, refunds`, webhooks idempotents, rapprochement | Aucune clé réelle ; webhooks rejoués sans double effet ; montants cohérents | — |
| 7 | Multi-segments et API B2B | Un colis traverse 2 prestataires avec transfert de responsabilité enregistré | — |
| 8 | Classement appris et prévision | Uniquement sur données réelles collectées ; comparaison au classement déterministe | — |

## Critères de succès du MVP (§23 du prompt) — état

| # | Critère | État | Preuve |
|---|---|---|---|
| 1 | L'application démarre avec les instructions documentées | ✅ | `04_code/README.md` ; `npm run build` et `dev` vérifiés |
| 2 | La base peut être initialisée | ✅ | `db:up`, `db:migrate` ; test de migration idempotente |
| 3 | Un utilisateur peut se connecter | ✅ | `auth.test.ts`, `api.test.ts` |
| 4 | Un voyageur peut publier un trajet | ✅ | `market.test.ts` |
| 5 | Un expéditeur peut publier une demande | ✅ | `market.test.ts` |
| 6 | La recherche retourne des offres compatibles | ✅ | `market.test.ts`, `matching.test.ts` |
| 7 | Demande de réservation | ✅ | `bookings.test.ts` |
| 8 | Acceptation/refus | ✅ | `bookings.test.ts` |
| 9 | Le colis possède un historique | ✅ | `shipments.test.ts` (événements) |
| 10 | Transitions contrôlées | ✅ | `workflow.test.ts` (exhaustif), `shipments.test.ts` |
| 11 | La remise peut être confirmée | ✅ | `shipments.test.ts` (code, essais, expiration) |
| 12 | Les permissions sont testées | ✅ | `api.test.ts` (401/403/404 sur chaque endpoint protégé), `admin.test.ts` |
| 13 | Données de démonstration identifiées | ✅ | `is_demo`, badge, séparation testée |
| 14 | Les tests essentiels passent | ✅ | 242/242 |
| 15 | Limites et intégrations manquantes documentées | ✅ | `PROJECT_STATE.md`, `/about`, ce document |

⚠️ « MVP fonctionnel » ≠ « prêt à ouvrir au public » : voir les limites bloquantes n°1 et n°2 de `PROJECT_STATE.md`.
