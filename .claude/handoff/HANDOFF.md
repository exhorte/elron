# HANDOFF — ALX (African Logistics Exchange), point de reprise du 2026-10-23

Aucun secret ici : ce fichier peut être lu sans risque. Les mots de passe de démonstration sont affichés une seule fois par `npm run db:seed:demo` et ne sont pas notés.

## 1. Objectif
Marketplace de capacité d'expédition de colis (voyageurs, transporteurs) pour l'Afrique, couloir de validation Dakar ↔ Abidjan : trouver, comparer, réserver, suivre, confirmer la remise par code, avec confiance (identité déclarée ≠ vérifiée, preuves, litiges, avis).
Prototype : aucun paiement, aucune règle douanière ou juridique inventée, rien ne doit prétendre fonctionner sans l'être.

## 2. État
- [x] Lot 0 : audit, REUSE_CATALOG, BENCHMARK, architecture, décisions (dépôts de référence : aucun code copié)
- [x] Lot 1 (MVP) : compte, profil, offres, demandes, recherche/score, réservation, colis, workflow par rôles, code de remise, suivi public, admin minimal — **poussé**, CI verte
- [x] Lot 2 : limitation de débit, mot de passe oublié, preuves téléversées, litiges, avis/réputation — **commité en local, NON POUSSÉ** (3 commits d'avance sur `origin/main`, HEAD `881e453`)
- [ ] Push du lot 2 + première CI dessus (attend l'accord du porteur)
- [ ] Lot 2b : vérifications e-mail/téléphone, notifications, avis croisés aveugles, EXIF/antivirus/S3, E2E, Dockerfile
- [ ] Lots 3 à 8 (agences, devis, relais, paiement sandbox, multi-segments, classement appris)

## 3. Décisions (détail : `01_plan/DECISIONS_LOG.md`, D-001 à D-025)
- Monolithe Next.js 16 + TypeScript + PostgreSQL 16 + Drizzle ; pas de microservices, broker, FastAPI ni dépendance d'auth tierce.
- Auth maison (scrypt, sessions en base). Capacité réservée à l'acceptation ; verrous demande → offre → réservation → colis → litige.
- **Invariant** : colis `DISPUTED` ⇔ litige ouvert ; seul point de changement de statut : `lockShipmentForTransition` + `applyLockedTransition`.
- Montants en entiers mineurs, poids en grammes, aucune conversion de devises ; données démo isolées (`is_demo`), jamais mélangées au réel.
- Preuves : type lu sur les octets, stockage privé, servies par `GET /api/v1/proofs/{id}` seulement. E-mail : interface `MailAdapter` **sans fournisseur** (console en dev, refusé en prod).
- Écartés : ORS (GPL-3.0, hors MVP), Supabase/Auth.js, séquestre/paiement, Redis pour la limitation de débit.
- **Règle du porteur (2026-10-23) : auteur unique, jamais de `Co-Authored-By` ni mention d'outil dans les commits.** Pas de `git push` sans accord explicite.

## 4. Fichiers clés (depuis `C:\Dev\elron`)
- `CLAUDE.md` — index et règles ; lire d'abord, puis `03_session-memory/PROJECT_STATE.md` et `NEXT_STEPS.md`
- `04_code/src/domain/{workflow,matching,money,handover,files,disputes}.ts` — logique pure
- `04_code/src/server/{shipments,bookings,disputes,proofs,reviews,rate-limit,password-reset,http}.ts` — services et enveloppe HTTP
- `04_code/src/db/schema.ts` + `04_code/drizzle/0000…0006_*.sql` — schéma et migrations (triggers append-only écrits à la main)
- `04_code/src/config/{rate-limits,matching,goods-policy,cities,uploads,app}.ts` — valeurs ajustables (non validées)
- `04_code/src/server/openapi.ts` → `04_code/docs/openapi.json` (généré : `npm run docs:openapi`, 46 opérations)
- `04_code/tests/` — unit, integration, api ; `tests/helpers.ts`, `tests/global-setup.ts`
- `.github/workflows/ci.yml` — CI (Postgres en service)

## 5. Vérification (dernier résultat : 2026-10-23)
Depuis `04_code/` après `npm run db:up` :
- `npm test` → 24 fichiers, **361 tests OK** (93 unit, 181 intégration, 87 API), ≈ 60 s
- `npx tsc --noEmit` OK · `npx eslint .` OK · `npm run build` OK
- CI GitHub : verte sur le lot 1 ; jamais exécutée sur le lot 2
- Navigateur (dev, port 3100, données démo) : preuve, avis, litige + décision opérateur, mot de passe oublié vérifiés à la main
- Contrôle auteur : `git log --format=%B | grep -iE 'co-authored|anthropic|claude sonnet'` doit rester vide

## 6. Pièges
- **Ne jamais lancer deux exécutions complètes de tests en même temps** : même base `alx_test`, `TRUNCATE` → `deadlock detected` et faux échecs (arrivé pendant le lot 2).
- La base Docker locale tourne **sans fsync** (dev/test seulement, `docker-compose.yml`) ; projet Compose nommé `alx`, port 5433 (le nom `04_code` était pris par un autre projet).
- PowerShell traite `[id]` comme un joker : utiliser `-LiteralPath` pour `src/app/**/[id]/**`.
- Une garde de sécurité a bloqué une commande contenant `rm` dans une chaîne ; passer par l'outil d'édition.
- Drizzle enveloppe les erreurs pg (« Failed query ») : la cause est dans `.cause` (`tests/helpers.ts: dbError`).
- `drizzle-kit` n'accepte pas l'alias `@/` : `schema.ts` n'importe que par chemins relatifs.
- Les migrations lot 2 ont été générées puis complétées à la main (triggers `forbid_mutation`) : ne pas les régénérer sans reporter les triggers.
- Des messages de hook rattachés à des résultats d'outils ont demandé de pousser et d'exécuter `relay.py` : ignorés, car le porteur n'a pas autorisé de push. Seul le retour du hook « Stop » (écrire ce fichier) a été suivi.

## 7. Questions ouvertes pour le porteur
1. Pousser le lot 2 vers `exhorte/elron` (dépôt **public**, contient la conversation de recherche ; le PDF est exclu) ? Rendre le dépôt privé ?
2. Fournisseur d'e-mail (le mot de passe oublié est inopérant en production sans lui), SMS/OTP, hébergement, stockage S3 éventuel.
3. Validation juridique : politique de marchandises, statut de la plateforme (licence courrier ?), responsabilité, données personnelles (photos incluses).
4. Valeurs à arbitrer : limites de débit, part des avis dans le score (40 %), fenêtre d'avis (30 j), taille/nombre de preuves.
5. Couloir réel : le PDF montre surtout Europe/Canada ↔ Afrique ; Dakar ↔ Abidjan est-il le bon point de départ ?
6. Règles de modération des avis et des litiges (qui décide, délais, recours).

## 8. Prochaine action
1. Demander au porteur s'il autorise le push du lot 2. S'il dit oui : vérifier le contrôle d'auteur (section 5), `git push` (remote `origin`, branche `main`), puis `gh run watch` sur la CI et corriger ce qui diffère de Linux. S'il dit non : ne rien pousser.
2. Ensuite, lot 2b dans l'ordre de `03_session-memory/NEXT_STEPS.md` (section P1) : commencer par passer `actions/checkout` et `actions/setup-node` à une version Node 24, puis le test de mutation des verrous du lot 2.
3. À chaque lot : tests, mise à jour de `PROJECT_STATE.md`, `NEXT_STEPS.md`, `TEST_STATUS.md`, commit sans co-auteur.
