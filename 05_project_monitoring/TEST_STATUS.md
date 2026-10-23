# TEST_STATUS

Dernière exécution complète : **2026-10-23** — `npm test` : **24 fichiers, 361 tests, 361 réussis** (≈ 60 s). `tsc --noEmit`, `eslint .` et `next build` : sans erreur. CI GitHub : verte sur le lot 1 (2026-10-23) ; **pas encore exécutée sur le lot 2** (non poussé).

| Projet Vitest | Fichiers | Tests | Base de données |
|---|---|---|---|
| `unit` | 7 (`money`, `workflow`, `handover`, `matching`, `config-validation`, `client-ip`, `files`) | 93 | aucune (le stockage de fichiers utilise un dossier temporaire) |
| `integration` | 11 (`auth`, `market`, `bookings`, `shipments`, `admin`, `database`, `rate-limit`, `password-reset`, `proofs`, `disputes`, `reviews`) | 181 | PostgreSQL réel (`alx_test`) |
| `integration` (API) | 6 (`api`, `rate-limit-api`, `password-reset-api`, `proofs-api`, `disputes-api`, `reviews-api`) | 87 | PostgreSQL réel ; handlers appelés avec de vraies `Request` (multipart et flux compris) |

La base de test est créée et **migrée de zéro** à chaque exécution ; elle refuse de tourner si son nom ne finit pas par `_test`. Dossier d'envois de test temporaire, supprimé en fin de run. Aucun service externe n'est appelé ; **aucun mock** hors `MemoryMailAdapter` (adaptateur d'e-mail en mémoire, clairement séparé de l'intégration réelle qui n'existe pas).

⚠️ **Ne jamais lancer deux exécutions complètes en même temps** : elles partagent la base `alx_test` et se bloquent mutuellement (`TRUNCATE` → `deadlock detected`). C'est arrivé pendant le lot 2 (résultats invalides, pas un défaut du code).

```bash
cd 04_code && npm run db:up && npm test          # tout
npx vitest run --project unit                    # sans base
```

## Couverture des tests obligatoires (§18 du prompt)

| Exigence | Où |
|---|---|
| Création de compte, connexion, verrouillage | `auth.test.ts`, `api.test.ts` |
| Permissions, rôles, sécurité des endpoints | `api.test.ts` : 401 sur **chaque** endpoint protégé et 403 sur chaque endpoint opérateur/admin (générés depuis la spec), IDOR, CSRF, mass-assignment ; `admin.test.ts` ; `disputes-api.test.ts` (parties ne résolvent pas), `proofs-api.test.ts` (tiers → 404) |
| Trajet, capacités, demande, recherche, matching | `market.test.ts`, `matching.test.ts` (filtres, score, pondérations, avis), `database.test.ts` |
| Réservation, **doubles réservations**, acceptation, annulation | `bookings.test.ts` (concurrence : 10 acceptations simultanées pour 3 places) |
| Transitions de statut | `workflow.test.ts` (toutes paires × rôles), `shipments.test.ts` |
| Confirmation de remise | `shipments.test.ts` : usage unique, 5 essais (parallèles compris), verrouillage, expiration |
| Gestion des erreurs | `api.test.ts` (400/401/403/404/409/415/422/429), enveloppe stable |
| Migrations | `database.test.ts` (tables, idempotence, aucun INSERT dans les migrations) |
| Cohérence des montants | `money.test.ts`, `bookings.test.ts`, contraintes SQL |
| Contrat d'API | `api.test.ts` : routes ↔ OpenAPI, méthodes ↔ OpenAPI, fichier généré à jour (46 opérations) |
| **Limitation de débit** | `rate-limit.test.ts` (atomicité sous 30 requêtes parallèles, fenêtres, sujets hachés, purge), `client-ip.test.ts` (X-Forwarded-For forgé ignoré), `rate-limit-api.test.ts`, 429 sur chaque endpoint limité |
| **Mot de passe oublié** | `password-reset.test.ts` : jeton haché, usage unique y compris parallèle, expiration, sessions révoquées, compte suspendu, aucun jeton dans l'audit, adaptateur refusé en production ; `password-reset-api.test.ts` : réponse identique connue/inconnue |
| **Preuves téléversées** | `files.test.ts` (octets réels, HTML/SVG/exécutable refusés, traversée de chemin), `proofs.test.ts` (taille, limite parallèle sans orphelin, immuabilité, instantané dans l'événement), `proofs-api.test.ts` (multipart, flux géant → 413, en-têtes de service, 415) |
| **Litiges** | `disputes.test.ts` (invariant, unicité même en parallèle, gel du colis, 6 issues, reprise, annulation libérant la capacité, double résolution concurrente), `disputes-api.test.ts` |
| **Avis et réputation** | `reviews.test.ts` (fenêtre 30 j, un avis par auteur même en parallèle, immuable, agrégats, score), `reviews-api.test.ts`, `matching.test.ts` |

## Vérification que les tests de concurrence détectent le défaut

Test de mutation manuel (2026-10-22, lot 1) : retrait des `FOR UPDATE` de `acceptBooking` → 3 tests échouent. **Non refait pour les verrous du lot 2** (litiges, avis, plafond de preuves) : leurs tests parallèles passent, mais leur sensibilité n'a pas été éprouvée par mutation.

## Ce qui n'est PAS couvert

- Aucun test navigateur automatisé (E2E) ; l'interface du lot 2 a été vérifiée **manuellement** (téléversement, avis, litige, décision opérateur, mot de passe oublié).
- Pas de test de charge ni de performance (la limitation de débit n'est pas calibrée sur du trafic réel).
- Pas de test d'un vrai fournisseur d'e-mail ni du stockage S3 (inexistants).
- Pas de test des en-têtes HTTP de sécurité globaux ni du drapeau `Secure` en production.
- Pas d'analyse antivirus ni de retrait des métadonnées des images (non implémentés, donc non testables).
