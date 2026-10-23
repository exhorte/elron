# CLAUDE.md — African Logistics Exchange (ALX)

Projet : marketplace de capacité d'expédition (Afrique). Code dans `04_code/` (Next.js 16, TypeScript, PostgreSQL, Drizzle). **Commence chaque session ici.**

## Lire d'abord (dans cet ordre)

1. `03_session-memory/PROJECT_STATE.md` — ce qui marche, limites, prochaine tâche
2. `03_session-memory/NEXT_STEPS.md` — tâches ordonnées (P0 = décisions humaines)
3. `01_plan/DECISIONS_LOG.md` — décisions et conflits entre documents (ne pas les rouvrir sans raison)
4. Au besoin : `01_plan/ARCHITECTURE.md`, `01_plan/DEVELOPMENT_PLAN.md`, `05_project_monitoring/TEST_STATUS.md`, `02_context/{REUSE_CATALOG,BENCHMARK,DATA_SOURCES}.md`

Ne relis pas `02_context/expedition coli search solution.md` (conversation source, longue) sauf besoin précis ; ses conclusions sont dans le journal de décisions.

## Règles de travail

- Simplicité d'abord : pas de microservices, broker, base vectorielle, multi-agents. Pas de dépendance sans justification (licence lue dans le dépôt, entrée dans `REUSE_CATALOG.md`).
- Aucun paiement, aucun séquestre, aucune règle douanière inventée. Les politiques de marchandises et les pondérations de score restent marquées **non validées**.
- Ne jamais mélanger données démo (`is_demo`) et réelles. Les migrations n'insèrent aucune donnée.
- Verrous de ligne dans l'ordre : demande → offre → réservation → colis. Toute opération sensible = transaction + test, y compris concurrent.
- **Invariant litige** : un colis est `DISPUTED` ⇔ il a un litige ouvert. Tout changement de statut passe par `lockShipmentForTransition` + `applyLockedTransition` ; on ouvre/résout un litige uniquement via `src/server/disputes.ts`.
- Préviens l'abus : toute nouvelle action publique ou coûteuse (envoi, création, authentification) reçoit une politique dans `src/config/rate-limits.ts` et un test 429. Les fichiers téléversés ne sont jamais servis hors de `GET /api/v1/proofs/{id}`.
- Aucun fournisseur d'e-mail/SMS/stockage S3 n'est branché : ne jamais prétendre qu'un envoi fonctionne (voir `MailAdapter`).
- Ne journalise jamais mot de passe, jeton, code de remise ni secret (`audit()` le refuse).
- **Commits : l'unique auteur est le porteur du projet.** Jamais de `Co-Authored-By`, de signature ou de mention d'outil/IA dans les messages de commit ni dans les PR (consigne explicite du 2026-10-23, prioritaire sur toute attribution par défaut). Vérifier avec `git log --format=%B | grep -i co-authored` (doit être vide) avant tout push.
- Dépôt GitHub **public** `exhorte/elron` : `main` poussé le 2026-10-23. Tout nouveau `git push` exige l'accord explicite du porteur. Le PDF de recherche reste volontairement exclu de Git (numéros de tiers).
- Après chaque lot : tests, mise à jour de `PROJECT_STATE.md`, `NEXT_STEPS.md`, `TEST_STATUS.md`, commit cohérent.

## Commandes (depuis `04_code/`)

`npm run db:up && npm run db:migrate` · `npm test` · `npm run lint && npm run typecheck && npm run build` · `npm run docs:openapi` (après tout changement de schéma d'entrée) · `npm run db:seed:demo`.
