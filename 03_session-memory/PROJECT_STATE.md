# PROJECT_STATE — African Logistics Exchange (ALX, nom provisoire)

Dernière mise à jour : **2026-10-23** · Lots 1 (MVP) et 2 (confiance et hygiène) terminés · Git : `main` poussé jusqu'au lot 1 ; **lot 2 commité en local, non poussé** · auteur unique (le porteur du projet).

## Ce qui fonctionne (vérifié par tests automatisés + parcours manuel dans le navigateur)

**Lot 1** — couloir Dakar ↔ Abidjan, de bout en bout : compte → profil voyageur (identité *déclarée*) → trajet avec capacité → demande d'expédition → recherche classée (exclusions + score détaillé + drapeaux d'informations manquantes) → réservation → acceptation/refus (réserve la capacité, crée le colis) → statuts contrôlés par rôle → code de remise (généré par l'expéditeur, confirmé par le transporteur) → historique et suivi public → tableau de bord → administration minimale.

**Lot 2** — ajouté et testé :
- **Limitation de débit** en base (connexion, inscription, mot de passe oublié/réinitialisation, confirmation de remise, envoi de preuve, litige, message, avis) ; 429 + `Retry-After` ; IP lue uniquement derrière `TRUSTED_PROXY_HOPS` proxys de confiance.
- **Mot de passe oublié** : jeton haché à usage unique (60 min), réponse identique pour toute adresse, sessions révoquées, avis de changement. **L'envoi d'e-mails n'est branché à aucun fournisseur** (interface `MailAdapter`, adaptateur `console` en dev, `disabled` en production) : l'interface le dit.
- **Preuves téléversées** : JPEG/PNG/WEBP/PDF ≤ 5 Mo, type déduit des octets, 20 par colis, stockage privé sur disque, service contrôlé (parties/opérateurs, CSP `sandbox`, `nosniff`, `no-store`), empreinte SHA-256 figée dans l'événement du colis.
- **Litiges** : invariant `DISPUTED` ⇔ litige ouvert ; ouverture par les parties selon le workflow ; fil de messages avec preuves ; résolution par un opérateur non partie (reprise, remis, retourné, perdu, endommagé, annulé + libération de capacité).
- **Avis et réputation** : 1–5 après remise confirmée (30 jours), immuables, réputation publique `/users/{id}`, branchés sur le critère de fiabilité du score.

- **Tests** : **361 passent** (93 unitaires, 181 intégration, 87 API ; voir `05_project_monitoring/TEST_STATUS.md`). `tsc`, `eslint` et `next build` passent. CI GitHub verte sur le lot 1 ; **non exécutée sur le lot 2 (non poussé)**.
- **Vérifié manuellement (navigateur intégré, base de dev avec données démo)** : téléversement d'une photo depuis l'interface et son affichage, dépôt d'un avis, ouverture d'un litige, décision d'un opérateur (colis revenu à « Remis »), mot de passe oublié (même réponse pour adresse connue/inconnue, lien affiché dans la console du serveur).

## Décisions récentes (détail : `01_plan/DECISIONS_LOG.md`)

D-021 limitation de débit · D-022 preuves téléversées · D-023 mot de passe oublié sans fournisseur d'e-mail · D-024 litiges (invariant, résolution opérateur) · D-025 avis et réputation dans le score. Le format de preuve « référence libre » du lot 1 est supprimé. `docker-compose.yml` désactive `fsync` sur la base **locale** (tests 4× plus rapides : 245 s → 59 s).

## Problèmes connus et limites (honnêtes)

| # | Limite | Gravité |
|---|---|---|
| 1 | **Politique de marchandises, pondérations du score, valeurs de limitation de débit, part des avis (40 %) : non validées** | Bloquant avant tout usage réel |
| 2 | **Aucun fournisseur d'e-mail** : le mot de passe oublié est inopérant en production ; pas de vérification d'e-mail ni de téléphone (OTP) | Bloquant avant ouverture publique |
| 3 | Pas de paiement ni de séquestre ; **les litiges n'ont aucun effet financier** (ni remboursement ni indemnisation) | Par conception |
| 4 | Preuves : **pas d'antivirus**, **métadonnées EXIF/GPS conservées**, stockage disque local seulement (pas de S3), immuables (pas de purge) | Moyenne |
| 5 | Avis visibles immédiatement (pas d'avis croisés aveugles → risque de représailles), non vérifiés, sans signalement | Moyenne |
| 6 | Aucune notification : les parties doivent consulter le colis pour voir un litige ou un message | Moyenne |
| 7 | **`TRUSTED_PROXY_HOPS` à régler en production**, sinon un seul compteur commun de limitation de débit (un utilisateur peut en bloquer d'autres) | Bloquant au déploiement |
| 8 | Pas d'agences, devis, points relais, multi-segments ; dates en GMT et français seulement | Lots suivants |
| 9 | Le dépôt GitHub est **public** et contient la conversation de recherche ; le PDF est exclu | Décision humaine (déjà prise pour le lot 1) |
| 10 | Aucun test navigateur automatisé (E2E) ; pas de Dockerfile applicatif ni d'hébergement choisi ; actions GitHub `checkout`/`setup-node` v4 (avertissement Node 20) | Moyenne |
| 11 | Un colis `LOST`/`DAMAGED` ne libère pas la capacité (volontaire) ; audit de licences transitif non fait (aucune nouvelle dépendance au lot 2) | Faible |
| 12 | Sensibilité des tests de concurrence du lot 2 non éprouvée par mutation (faite pour le lot 1 uniquement) | Faible |

## Prochaine tâche prioritaire

Voir `NEXT_STEPS.md` : (1) décider du **push du lot 2** et lancer la CI ; (2) décisions humaines P0 (fournisseur d'e-mail/SMS, validation juridique, hébergement) ; (3) lot 2b : vérification d'e-mail/téléphone, notifications, E2E, Dockerfile.

## Comment reprendre

```bash
cd 04_code && npm install && npm run db:up && npm run db:migrate && npm test
npm run dev          # http://localhost:3000 (3100 si le port est pris)
npm run db:seed:demo # comptes et offres fictifs (mot de passe affiché une fois)
```
