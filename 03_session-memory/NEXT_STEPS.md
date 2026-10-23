# NEXT_STEPS — par priorité

## P0 — décisions humaines (rien d'autre ne les remplace)

1. **Push du lot 2** : commité en local (auteur unique), **pas poussé**. À valider, puis surveiller la CI (première exécution sur les nouvelles migrations et le dossier d'envois). Rappel : le dépôt `exhorte/elron` est **public** ; décider s'il doit devenir privé (il publie la conversation de recherche).
2. **Validation professionnelle** (juriste/transitaire) : (a) la politique de marchandises (`src/config/goods-policy.ts`, D-009) ; (b) le statut de la plateforme — simple mise en relation ou opérateur postal/transport (au Sénégal, l'ARTP rappelle qu'une licence est requise pour le courrier ; la conversation le signale, **non vérifié ici**) ; (c) responsabilité et assurance ; (d) protection des données (destinataires, téléphones, **photos de colis et leurs métadonnées**).
3. **Modèle de paiement** : choisir un prestataire compatible marketplace dans les pays visés (Wave, Orange Money, CinetPay, PayDunya, Stripe Connect…) **après** vérification de leurs conditions ; décider si un séquestre est envisageable juridiquement. Tant que non tranché : aucun paiement (D-015) — et donc **aucune compensation possible dans les litiges**.
4. **Hébergement et fournisseurs** : hébergeur de l'application et de PostgreSQL ; **e-mail transactionnel (bloque le mot de passe oublié en production)** ; fournisseur SMS/OTP ; stockage objet si le disque local ne convient pas. (Création de comptes = action humaine.)
5. **Validation terrain** (phase 0 de la conversation) : parler à de vrais expéditeurs, voyageurs, agences sur Dakar↔Abidjan avant d'investir dans les lots 3+. Le PDF montre que la demande visible est surtout **Europe/Canada↔Afrique** : confirmer le couloir de départ réel.
6. Nom définitif du produit ; conditions d'utilisation, politique de confidentialité et **règles de modération des avis et des litiges** (qui décide, délais, recours).
7. **Valeurs à arbitrer** : limites de débit (`src/config/rate-limits.ts`), part des avis dans la fiabilité (40 %), fenêtre d'avis (30 jours), taille/nombre de preuves.

## Lot 2 — état

Fait (2026-10-23) : limitation de débit, mot de passe oublié (sans fournisseur d'e-mail), preuves téléversées, litiges, avis et réputation. Détail : `PROJECT_STATE.md`, décisions D-021 à D-025.

## P1 — lot 2b (je peux le faire sans intervention, sauf fournisseurs)

1. Passer les actions GitHub `checkout`/`setup-node` à une version Node 24 (supprime l'avertissement de la CI).
2. **Vérification d'e-mail** et **vérification du téléphone par OTP** via interfaces + adaptateurs de test clairement non opérationnels (le fournisseur réel = P0.4).
3. **Notifications** (`notifications` + adaptateur) : litige ouvert, message de litige, réservation à traiter, avis reçu. Aujourd'hui aucune : les parties doivent consulter le colis.
4. Avis : option d'**avis croisés aveugles** (publication quand les deux ont noté ou après délai) ; signalement d'un avis ; modération opérateur.
5. Preuves : retrait des métadonnées EXIF/GPS à l'envoi (ou option) ; adaptateur S3 derrière `ObjectStorage` ; politique de rétention ; **analyse antivirus** si hébergement le permet.
6. Test de mutation des verrous du lot 2 (plafond de preuves, litiges uniques, avis uniques) pour confirmer que leurs tests détectent l'absence de verrou.
7. Test E2E navigateur (Playwright) du parcours nominal et des litiges ; test d'accessibilité.
8. `Dockerfile` de l'application + guide de déploiement (`DELIVERY_CODE_PEPPER`, `UPLOAD_DIR`, `APP_BASE_URL`, `TRUSTED_PROXY_HOPS`, `MAIL_TRANSPORT`) ; secrets générés hors dépôt.
9. Interface opérateur : liste filtrable des litiges résolus, des utilisateurs, récupération d'accès en l'absence d'e-mail.
10. Audit de licences transitif (`license-checker`) consigné dans `REUSE_CATALOG.md`.

## P2 — lots suivants (voir `01_plan/DEVELOPMENT_PLAN.md`)

Lot 3 agences (organisations, membres, départs récurrents, tarifs par paliers/forfaits comme dans les annonces du PDF) → lot 4 devis (marché C) → lot 5 points relais → lot 6 paiement en sandbox → lot 7 multi-segments + API B2B → lot 8 classement appris sur données réelles.

## Dette technique identifiée

- Listes de réservations : requêtes N+1 (`loadBookingView`) — acceptable en MVP, à regrouper si volumétrie.
- Limitation de débit à fenêtre fixe : une rafale à cheval sur deux fenêtres peut atteindre 2× la limite ; passer à une fenêtre glissante si nécessaire.
- `purgeRateLimitBuckets` est appelée de façon opportuniste (≈ 1 requête sur 200) : prévoir une tâche planifiée.
- Fuseaux horaires par ville et i18n.
- Taux de change : aucune politique (les offres en devises différentes sont signalées « non comparables »).
- Conversion kg↔colis volumineux (poids volumétrique) non traitée.
- Le lecteur multipart charge au plus 5,06 Mo en mémoire par requête d'envoi : acceptable, à revoir si la limite augmente.
