# PROJECT_STATE — African Logistics Exchange (ALX, nom provisoire)

Dernière mise à jour : **2026-10-22** · Lot 1 (MVP) terminé · Git local : 1 commit, **non poussé**.

## Ce qui fonctionne (vérifié par tests automatisés + parcours manuel dans le navigateur)

Parcours complet, de bout en bout, sur le couloir Dakar ↔ Abidjan :
compte → profil voyageur (identité *déclarée*) → publication d'un trajet avec capacité → demande d'expédition → recherche publique classée (exclusions + score détaillé + drapeaux d'informations manquantes) → demande de réservation → acceptation/refus par le transporteur (réserve la capacité, crée le colis) → statuts contrôlés par rôle → code de remise généré par l'expéditeur, confirmé par le transporteur (usage unique, 5 essais, expiration) → historique et suivi public → tableau de bord → administration minimale (revue d'identité, liste des colis).

- **Terminé** : audit, catalogue de réutilisation, benchmark, architecture, schéma + migrations (12 tables, triggers d'immutabilité), domaine pur, services transactionnels, 30 endpoints `/api/v1` + OpenAPI générée, UI mobile-first (15 pages), seed de démonstration isolé, CI (workflow écrit, jamais exécuté), documentation.
- **En cours** : rien.
- **Tests** : 242 passent (voir `05_project_monitoring/TEST_STATUS.md`). `tsc`, `eslint` et `next build` passent.
- **Vérifié manuellement (navigateur intégré)** : connexion, acceptation d'une réservation de démo, génération du code (affiché une fois), page colis côté transporteur et expéditeur, mise en page mobile 375 px sans défilement horizontal.

## Décisions récentes (détail : `01_plan/DECISIONS_LOG.md`)

Monolithe Next.js + PostgreSQL (D-001) · auth maison scrypt + sessions (D-004) · workflow réconcilié demande/réservation/colis (D-006) · capacité réservée à l'acceptation + verrous ordonnés (D-013) · code de remise émis par l'expéditeur (D-012) · aucun paiement (D-015) · démo isolée du réel (D-014) · **aucun code externe copié** (D-019).

## Problèmes connus et limites (honnêtes)

| # | Limite | Gravité |
|---|---|---|
| 1 | **Politique de marchandises et pondérations de score non validées** (juridiquement / empiriquement) | Bloquant avant tout usage réel |
| 2 | Pas de réinitialisation de mot de passe, pas de vérification e-mail/téléphone, pas de limitation de débit par IP | Bloquant avant ouverture publique |
| 3 | Pas de paiement ni de séquestre ; règlement hors plateforme (volontaire) | Par conception |
| 4 | Preuves = simples références (pas de téléversement de fichiers) | Moyenne |
| 5 | Pas de litiges outillés, de notation, de notifications, de points relais, d'agences, de devis, de multi-segments | Lots suivants |
| 6 | Dates en GMT seulement ; interface en français seulement | Faible (couloir actuel) |
| 7 | Le PDF d'annonces n'est pas dans Git (numéros de tiers) ; remote GitHub **public et vide**, rien poussé | Décision humaine |
| 8 | Aucun test navigateur automatisé (E2E) ; CI jamais exécutée ; pas de Dockerfile applicatif ni de choix d'hébergement | Moyenne |
| 9 | Un colis `LOST`/`DAMAGED` ne libère pas la capacité (volontaire : le trajet a eu lieu) | À confirmer métier |
| 10 | Audit de licences transitif des dépendances non fait (seules les licences directes sont vérifiées) | Faible |

## Prochaine tâche prioritaire

Voir `NEXT_STEPS.md` : (1) décisions humaines P0 (remote, validation juridique, hébergement) ; (2) lot 2 « confiance et hygiène » — réinitialisation de mot de passe, limitation de débit, litiges et notation, preuves téléversées.

## Comment reprendre

```bash
cd 04_code && npm install && npm run db:up && npm run db:migrate && npm test
npm run dev          # http://localhost:3000 (3100 si le port est pris)
npm run db:seed:demo # comptes et offres fictifs (mot de passe affiché une fois)
```
