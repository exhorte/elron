# TEST_STATUS

Dernière exécution complète : **2026-10-22** — `npm test` : **12 fichiers, 242 tests, 242 réussis** (≈ 70 s). `tsc --noEmit`, `eslint .` et `next build` : sans erreur.

| Projet Vitest | Fichiers | Tests | Base de données |
|---|---|---|---|
| `unit` | 5 (`money`, `workflow`, `handover`, `matching`, `config-validation`) | 82 | aucune |
| `integration` | 6 (`auth`, `market`, `bookings`, `shipments`, `admin`, `database`) | 113 | PostgreSQL réel (`alx_test`) |
| `integration` (API) | 1 (`tests/api/api.test.ts`) | 47 | PostgreSQL réel ; handlers appelés avec de vraies `Request` |

La base de test est créée et **migrée de zéro** à chaque exécution (`tests/global-setup.ts`) ; elle refuse de s'exécuter si le nom ne finit pas par `_test`. Aucun service externe n'est appelé ; il n'y a **aucun mock** (les adaptateurs externes n'existent pas encore).

```bash
cd 04_code && npm run db:up && npm test          # tout
npx vitest run --project unit                    # sans base
```

## Couverture des tests obligatoires (§18 du prompt)

| Exigence | Où |
|---|---|
| Création de compte, connexion | `auth.test.ts`, `api.test.ts` |
| Permissions, contrôle des rôles, sécurité des endpoints | `api.test.ts` : 401 sans session sur **chaque** endpoint protégé (généré depuis la spec), 403 pour chaque endpoint opérateur/admin avec un utilisateur simple, IDOR (demande 403, colis/réservation 404), CSRF, mass-assignment, champs inconnus ; `admin.test.ts` |
| Création d'un trajet, validation des capacités | `market.test.ts`, `config-validation.test.ts`, `database.test.ts` (CHECK) |
| Publication d'une demande | `market.test.ts` |
| Recherche, matching | `matching.test.ts` (filtres, score, pondérations, déterminisme), `market.test.ts` |
| Réservation, **prévention des doubles réservations** | `bookings.test.ts` : doublon séquentiel et **parallèle**, index uniques partiels, 10 acceptations simultanées pour 3 places |
| Acceptation, refus, annulation | `bookings.test.ts`, `shipments.test.ts` (annulation libère la capacité) |
| Transition des statuts | `workflow.test.ts` (toutes les paires × tous les rôles), `shipments.test.ts` |
| Confirmation de remise | `shipments.test.ts` : usage unique, 5 essais (y compris en parallèle), verrouillage, expiration, régénération, jamais en clair |
| Gestion des erreurs | `api.test.ts` (422/400/415/403/404/409/429), enveloppe stable |
| Migrations | `database.test.ts` (tables, idempotence, aucun INSERT dans les migrations, référentiel idempotent) |
| Cohérence des montants | `money.test.ts` (invariant net + commission = sous-total sur une grille), `bookings.test.ts`, contrainte SQL |
| Parcours critiques en intégration | `api.test.ts` « parcours complet » : 14 étapes, de l'inscription à la remise et au suivi public |
| Contrat d'API | `api.test.ts` : routes ↔ OpenAPI, méthodes ↔ OpenAPI, fichier généré à jour |

## Vérification que les tests de concurrence détectent le défaut

Test de mutation manuel (2026-10-22) : retrait des `FOR UPDATE` de `acceptBooking` → 3 tests échouent (10 acceptations réussies pour 3 places, double-clic créant deux colis). Code restauré, tests verts.

## Ce qui n'est PAS couvert

- Aucun test navigateur automatisé (E2E) ; l'interface a été vérifiée **manuellement** (connexion, acceptation, code de remise, mobile 375 px).
- Pas de test de charge ni de performance.
- La CI GitHub n'a jamais tourné (workflow écrit seulement).
- Pas de test des en-têtes HTTP de sécurité ni du drapeau `Secure` en production.
- Intégrations réelles (e-mail, SMS, paiement, stockage) : inexistantes, donc non testées.
