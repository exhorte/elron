# BENCHMARK — plateformes comparables

Collecte : **2026-10-22**, lecture des pages publiques via un outil de lecture web (résumé automatique de la page) puis recherche web. Seules les mentions **explicites** sont notées ✅. « ? » = non indiqué sur la page lue (pas « absent »). Aucun code privé n'a été consulté.

Limites de la collecte : Grabr a renvoyé HTTP 403 (page officielle illisible) ; la fiche Play Store de YOBU est revenue tronquée et la recherche web n'a trouvé **aucune source** sur « YOBU ». Les affirmations de la conversation ChatGPT sur YOBU ne sont donc **pas confirmées**. Roadie : site grand public lu, pas la documentation développeur.

| Critère | GP Delivery | Kifurushi | Afrique Relais | Shiply | Grabr | Roadie | YOBU |
|---|---|---|---|---|---|---|---|
| Publication de trajets | ✅ (≈2 min, kilos + prix/kg) | ✅ « Post my trip » (route, date de vol, kilos, prix/kg) | ✅ « Enregistrer votre voyage » (notifications) | ? (carrier = capacité résiduelle ; méthode ? ) | ✅ (source secondaire) | n/a | ? |
| Recherche | ? | ✅ navigation sans compte, filtre par pays | ✅ recherche + trajets proches dans le temps | ✅ (côté transporteur) | ? | ? | ? |
| Réservation | ✅ frais affichés avant | ? (accord entre parties) | ✅ « réserver votre place » | ✅ accepter un devis + acompte | ✅ (source secondaire) | n/a | ? |
| Offres de transport (devis) | ? | ✅ demandes d'envoi publiées | ✅ « avis de recherche de GP » | ✅ cœur du modèle (devis par e-mail, 30 min typiques) | ✅ offres de voyageurs (source secondaire) | n/a | ? |
| Gestion de capacité | kilos par voyageur | kilos par voyageur | ? | capacité résiduelle de véhicules | ? | n/a | ? |
| Agences / transporteurs pro | ? (offre « Entreprises » : groupage) | ? | ✅ « Afrique Transporteur », « Afrique DRIVER » | ✅ section transporteurs | ? | ✅ 310 000+ chauffeurs indépendants | ? |
| Voyageurs particuliers | ✅ | ✅ | ✅ (« GP ») | ? | ✅ | ? | ? |
| Points relais | ? (lieux convenus par messagerie) | ? | ✅ concept « Magik Relais » (détails ?) | ? | ? | ? | ? |
| Suivi | ✅ notifications à chaque étape | ✅ double confirmation de remise (tableau de bord) | ✅ « Suivre mon colis », alertes | ? | ? | ? | ? |
| Paiement | ✅ payé **avant** la remise ; moyens ? | ✅ **direct** entre parties (cash, M-Pesa, virement) ; la plateforme ne détient pas les fonds | ? | ✅ acompte après acceptation | ✅ fonds retenus jusqu'à confirmation (source secondaire) | ? | ? |
| Commission / frais | ✅ **5 % expéditeur + 5 % voyageur** | ✅ 0 % (gratuit pendant le lancement) | ? (calculateur de frais ; montants ?) | ? | ⚠️ conflit : 7 % (un blog) vs aucune part sur le voyageur (rapport universitaire) | ? | ? |
| Vérification d'identité | ✅ pièce + selfie, revue manuelle, badge « GP vérifié » | ✅ pièce + selfie avant le 1ᵉʳ transport | ? | ? (« notés par avis »; équipe Trust & Safety citée) | ✅ (source secondaire) | ? (« gig-certified » mentionné pour la pharmacie) | ? |
| Code de remise | ✅ code de retrait à usage unique | ✅ code à 6 chiffres à usage unique saisi pour clôturer | ? | ? | ? | ? | ? |
| Litiges | ✅ signalement structuré, médiation, photo obligatoire | ? | ? | ? (remboursement d'acompte par e-mail) | ✅ remboursement si échec (source secondaire) | ? | ? |
| Notation | ✅ score public 0–100 fondé sur les livraisons réussies | ✅ avis débloqués après livraison confirmée | ? (témoignages = texte factice sur la page) | ✅ avis transporteurs | ✅ | ? | ? |
| Applications mobiles | ✅ iOS + Android | ? | ? | ? | ? | ? | Android (existence de la fiche) |
| B2B | ✅ « Entreprises » (départs groupés, reçu par envoi) | ? | ? | ? | ? | ✅ entreprises, 3PL, UPS | ? |
| Intégrations | ? | ? | ? | ✅ import eBay | ? | ✅ « Roadie for UPS / 3PLs » (détails ?) | ? |
| Pays | Sénégal, Burkina, Côte d'Ivoire, Mali, Bénin, Togo, Cameroun (+ Niger, Gambie, Guinée « bientôt ») | 54 pays africains + 23 destinations diaspora (annoncé) | Sénégal, Guinée, Mali, Côte d'Ivoire, France, USA, Canada, Allemagne, Belgique, Italie, Espagne | UK/Europe + sites locaux | ? | USA (97 % des foyers, annoncé) | ? |

Sources : pages officielles `gpdelivery.africa`, `kifurushiapp.com`, `afrique-relais.com`, `shiply.com`, `roadie.com` (lues 2026-10-22) ; [recherche web Grabr](https://wanderthemap.com/2020/01/grabr-review-a-fun-way-to-make-money-while-traveling/) (blog 2020, à recouper).

## Observations tirées du PDF de recherche (`02_context/expedition colis_compressed.pdf`)

5 pages de captures d'annonces Facebook/WhatsApp (août 2026). Constats **vus à l'image** :

- Corridors annoncés : Dakar↔Paris, Abidjan↔Paris, Dakar↔Abidjan (Jotna Express, samedi), Dakar→Montréal, Abidjan→Montréal, Dakar→Brazzaville/Pointe-Noire/Kinshasa (OKAPI), départs depuis Abidjan vers ~20 villes (Signature Logistics).
- Tarification hétérogène : **€/kg** (8 €, 10 €, 13 €), **FCFA/kg** (3 500, 5 000 « selon le type de colis », 1 400 groupage vs 10 € express), **forfaits bagage** (23 kg = 130 €, 10 kg = 70 €). → plusieurs **devises** et **modes de tarification** ; ne pas supposer un prix/kg unique.
- Dates : départ + **date limite de dépôt** (« dernier dépôt le 16 août ») ; départs **récurrents** (« Dakar tous les mardis, Abidjan tous les vendredis »).
- Lieux : adresse de **dépôt** et de **retrait** distincts ; contacts WhatsApp/téléphone ; paiement parfois « lors du dépôt des colis ».
- Capacité affichée : « 30 kg disponible », « 23 kilos disponibles / 32 kilos disponibles ».
- Restrictions : marchandises « spéciales » (enveloppes, électronique, cosmétiques, pharmaceutiques, bijoux, perruques) au tarif spécial ou soumises à vérification ; consigne « ne pas scotcher ni emballer les colis » (inspection).
- Conséquence modèle : `deposit_cutoff_at`, adresses dépôt/retrait, prix par kg **ou** forfait, devise par offre, catégories acceptées, récurrence (post-MVP).

## Ce que le MVP doit absolument couvrir (déduit)

1. Trajet + kilos + prix/kg + devise + date limite de dépôt (marché réel du PDF).
2. Demande d'envoi (colis, catégorie, budget optionnel).
3. Réservation avec acceptation/refus par le transporteur.
4. Suivi par événements + **code de remise à usage unique** (pratique GP Delivery et Kifurushi).
5. Statut d'identité **déclaré / vérifié / décision opérateur** (aucun des sites lus ne détaille sa procédure).

## Différenciation à long terme (hypothèses, non validées)

- Agrégation voyageurs + agences + relais dans une seule recherche comparable (aucun des sites lus ne l'affiche).
- Récurrence des départs d'agences + capacité restante en temps réel.
- Multi-segments avec transfert de responsabilité enregistré.
