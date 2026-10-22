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
- Ne journalise jamais mot de passe, jeton, code de remise ni secret (`audit()` le refuse).
- Pas de `git push` sans accord explicite (remote `origin` = dépôt GitHub **public** `exhorte/elron`). Le PDF de recherche est volontairement exclu de Git (numéros de tiers).
- Après chaque lot : tests, mise à jour de `PROJECT_STATE.md`, `NEXT_STEPS.md`, `TEST_STATUS.md`, commit cohérent.

## Commandes (depuis `04_code/`)

`npm run db:up && npm run db:migrate` · `npm test` · `npm run lint && npm run typecheck && npm run build` · `npm run docs:openapi` (après tout changement de schéma d'entrée) · `npm run db:seed:demo`.
