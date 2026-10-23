# ALX — African Logistics Exchange (prototype, nom provisoire)

Marketplace de **capacité d'expédition** : des voyageurs et transporteurs publient la place disponible sur un trajet ; des expéditeurs publient un besoin, comparent les offres compatibles, réservent, et suivent le colis jusqu'à une remise confirmée par code. Couloir de validation : **Dakar ↔ Abidjan** (configurable).

> **Prototype.** Aucun paiement, aucune vérification automatique d'identité, politique de marchandises non validée juridiquement. Lire [`/about`](src/app/about/page.tsx) et `../03_session-memory/PROJECT_STATE.md` avant tout usage réel.

## Prérequis

Node.js ≥ 22, npm, Docker (PostgreSQL 16 en local).

## Démarrer

```bash
npm install
cp .env.example .env.local     # PowerShell : Copy-Item .env.example .env.local
npm run db:up                  # PostgreSQL via Docker Compose (projet "alx", port 5433)
npm run db:migrate             # migrations + synchro des villes/couloirs
npm run dev                    # http://localhost:3000
```

Données de démonstration (facultatif, **jamais** chargées automatiquement) :

```bash
npm run db:seed:demo           # comptes/offres fictifs ; le mot de passe est affiché une seule fois
npm run db:reset:demo          # supprime puis recrée uniquement les données démo
```

Les offres démo n'apparaissent que dans une recherche `?demo=1` et ne se réservent qu'avec des comptes démo.

## Scripts

| Commande | Rôle |
|---|---|
| `npm test` | tests (unitaires + PostgreSQL réel + API). Crée/migre `alx_test` automatiquement |
| `npm run test:unit` | tests purs, sans base |
| `npm run lint` / `npm run typecheck` / `npm run build` | qualité |
| `npm run db:generate` | génère une migration depuis `src/db/schema.ts` |
| `npm run docs:openapi` | régénère `docs/openapi.json` depuis les schémas zod |

## Configuration (`.env.local`)

| Variable | Défaut | Note |
|---|---|---|
| `DATABASE_URL` | `postgres://alx:alx@localhost:5433/alx` | identifiants **locaux** du conteneur |
| `TEST_DATABASE_URL` | `…/alx_test` | doit finir par `_test` |
| `DELIVERY_CODE_PEPPER` | (repli dev) | **obligatoire en production**, ≥ 32 caractères aléatoires |
| `PLATFORM_FEE_BPS` | `0` | commission en points de base ; 0 tant qu'aucun modèle économique n'est validé |
| `ALX_SHOW_DEMO` | `false` | recherche démo par défaut |
| `ALX_MATCHING_WEIGHTS` | (défaut) | JSON des pondérations du score (hypothèses non validées) |
| `TRUSTED_PROXY_HOPS` | `0` | proxys de confiance devant l'application ; sans cela `X-Forwarded-For` est ignoré et la limitation de débit utilise un compteur commun. **À régler en production** |
| `APP_BASE_URL` | `http://localhost:3000` | URL publique pour les e-mails ; obligatoire en production |
| `MAIL_TRANSPORT` | `console` (dev) / `disabled` (prod) | **aucun fournisseur d'e-mail n'est intégré** ; `console` est refusé en production |
| `STORAGE_DRIVER` / `UPLOAD_DIR` | `local` / `.data/uploads` | preuves téléversées ; `UPLOAD_DIR` obligatoire en production (volume persistant, hors dossier public) |

Périmètre géographique : `src/config/cities.ts` (puis `npm run db:migrate`). Politique de marchandises : `src/config/goods-policy.ts`.

## Où lire quoi

- API : `docs/openapi.json` (générée, vérifiée par test) — réponses `{data}` / `{error:{code,message,details}}`, montants en unités mineures, poids en grammes.
- Architecture, décisions, plan : `../01_plan/`. État, prochaines étapes : `../03_session-memory/`. Tests : `../05_project_monitoring/`. Sources, réutilisation, benchmark : `../02_context/`.

## Rôles et sécurité en bref

Tout compte peut expédier, noter, ouvrir un litige et téléverser des preuves sur ses colis ; un profil voyageur permet de publier des trajets. `operator` revoit les identités déclarées et voit tous les colis ; `admin` peut en plus suspendre un compte. Promouvoir un utilisateur se fait en base (aucune interface) : `update users set platform_role = 'operator' where email = '…'`.
