# NEXT_STEPS — par priorité

## P0 — décisions humaines (rien d'autre ne les remplace)

1. **Remote GitHub** : `exhorte/elron` est **public et vide**. Pousser tel quel publierait aussi la conversation de recherche. Décider : pousser (et si oui, le PDF reste-t-il exclu ?), ou rendre le dépôt privé d'abord. Aucun push n'a été fait.
2. **Validation professionnelle** (juriste/transitaire) : (a) la politique de marchandises (`src/config/goods-policy.ts`, D-009) ; (b) le statut de la plateforme — simple mise en relation ou opérateur postal/transport (au Sénégal, l'ARTP rappelle qu'une licence est requise pour le courrier ; la conversation le signale, **non vérifié ici**) ; (c) responsabilité et assurance ; (d) protection des données (destinataires, téléphones).
3. **Modèle de paiement** : choisir un prestataire compatible marketplace dans les pays visés (Wave, Orange Money, CinetPay, PayDunya, Stripe Connect…) **après** vérification de leurs conditions ; décider si un séquestre est envisageable juridiquement. Tant que non tranché : aucun paiement (D-015).
4. **Hébergement et fournisseurs** : hébergeur de l'application et de PostgreSQL ; e-mail transactionnel ; fournisseur SMS/OTP. (Création de comptes = action humaine.)
5. **Validation terrain** (phase 0 de la conversation) : parler à de vrais expéditeurs, voyageurs, agences sur Dakar↔Abidjan avant d'investir dans les lots 3+. Le PDF montre que la demande visible est surtout **Europe/Canada↔Afrique** : confirmer le couloir de départ réel.
6. Nom définitif du produit ; conditions d'utilisation et politique de confidentialité.

## P1 — lot 2 « confiance et hygiène » (je peux le faire sans intervention, sauf fournisseurs)

1. Pousser (si P0.1 tranché) et **exécuter la CI** ; corriger ce qui diffère de Windows.
2. Réinitialisation de mot de passe + vérification d'e-mail via une interface `MailAdapter` (adaptateur « outbox » local **clairement non opérationnel**).
3. Limitation de débit (connexion, inscription, code de remise) par IP et par compte.
4. Table `disputes` + messages + preuves ; interface opérateur de résolution (les statuts existent déjà).
5. Notation après livraison confirmée (`reviews`) ; alimenter le critère « fiabilité ».
6. Téléversement de preuves via une interface de stockage objet (adaptateur disque local en dev, compatible S3 ensuite), taille/type validés, accès privé.
7. Vérification du téléphone par OTP (interface + adaptateur de test ; fournisseur réel = P0.4).
8. Test E2E navigateur (Playwright) du parcours nominal ; test d'accessibilité.
9. `Dockerfile` de l'application + guide de déploiement ; `DELIVERY_CODE_PEPPER` de production généré hors dépôt.
10. Audit de licences transitif (`license-checker`) consigné dans `REUSE_CATALOG.md`.

## P2 — lots suivants (voir `01_plan/DEVELOPMENT_PLAN.md`)

Lot 3 agences (organisations, membres, départs récurrents, tarifs par paliers/forfaits comme dans les annonces du PDF) → lot 4 devis (marché C) → lot 5 points relais → lot 6 paiement en sandbox → lot 7 multi-segments + API B2B → lot 8 classement appris sur données réelles.

## Dette technique identifiée

- Listes de réservations : requêtes N+1 (`loadBookingView`) — acceptable en MVP, à regrouper si volumétrie.
- Fuseaux horaires par ville et i18n.
- Taux de change : aucune politique (les offres en devises différentes sont signalées « non comparables »).
- Conversion kg↔colis volumineux (poids volumétrique) non traitée.
