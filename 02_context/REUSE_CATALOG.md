# REUSE_CATALOG — dépôts de référence et dépendances

Date de vérification : **2026-10-22**. Méthode : API GitHub (`gh api`), fichier `LICENSE` lu directement, README et fichiers clés lus, comptage des fichiers de test via l'arbre Git. Aucun code externe n'a été copié ni exécuté.

Légende : ✅ réutilisable · 🔧 à adapter · ❌ exclu · 💡 idée/pattern seulement.

## Synthèse décisionnelle

| Dépôt | Licence (vérifiée) | Décision | Pourquoi |
|---|---|---|---|
| warp-tools | MIT | 💡 patterns, pas de code | Stack proche (Next/Drizzle/TS) mais **0 fichier de test**, SQLite, domaine fret US (NMFC, lbs). Dernier push 2026-05-12. |
| OpenBoxes | EPL-1.0 | 💡 concepts uniquement | Groovy/Grails : stack incompatible. Copyleft faible au niveau fichier. Utile comme référence de modèle (mouvements, historique). |
| OpenRouteService | GPL-3.0 | ❌ hors MVP | Aucune valeur pour le MVP (appariement sur paires de villes). Si adopté plus tard : service HTTP externe, jamais de code embarqué. |
| Peek Delivery Tracker | Apache-2.0 | 💡 patterns de timeline/notifications | Suivi de colis *tiers* (3 500 transporteurs), pas une marketplace. Bonne discipline de tests (304 fichiers). |
| ERPNext | GPL-3.0 | 💡 concepts facturation, plus tard | Aucun code. Pas de backend. |
| courier-logistics-backend | **Aucune licence** | 💡 lecture seule | Sans licence = tous droits réservés : **aucune ligne de code copiée**. Seules des idées générales (verrous de lignes, tentatives de paiement) sont notées. |
| SwiftShip | MIT | 💡 patterns de transitions + preuve de livraison | Django ≠ notre stack. Table `VALID_TRANSITIONS` et événements immuables : même approche que la nôtre, ré-implémentée en TS. |

**Conclusion** : aucun de ces dépôts n'est une base de code à greffer. Les coûts d'intégration (autre langage, autre domaine, licence copyleft ou absente) dépassent le bénéfice. On réutilise des **patterns** documentés ci-dessous et des **bibliothèques** indépendantes (section « Dépendances adoptées »).

---

## 1. Warp Tools — https://github.com/wearewarp/warp-tools

| Champ | Constat |
|---|---|
| Licence | MIT (fichier `LICENSE` lu : « Copyright (c) 2026 Warp ») |
| Activité | Créé 2026-04-03 ; dernier push 2026-05-12 (≈ 5 mois sans activité) ; 5 étoiles |
| Langage / framework | TypeScript, Next.js 16, React 19, Drizzle ORM, SQLite (libsql / better-sqlite3), Tailwind 3, Turborepo |
| Architecture | Monorepo : `apps/` (18 mini-applications indépendantes, chacune avec sa base SQLite) + `packages/{ui,config,freight-core}` |
| Fonctionnalités réellement présentes | Selon README : `shipment-management` (« Mini TMS ») avec cycle quote→booked→dispatched→in_transit→delivered→invoiced→paid→closed, tableau kanban, journal d'événements, 4 tables (`shipments` 53 colonnes, `shipment_events`, `shipment_documents`, `check_calls`). Le README de l'app liste les fonctions comme faites ; **non vérifié par exécution** |
| Qualité des tests | **0 fichier de test détecté** dans l'arbre ; 1 workflow CI |
| Dépendances notables | Radix UI, CVA, lucide-react, date-fns, zod, drizzle-orm |
| Coûts | Aucun |
| Risques | Domaine camionnage américain (classes NMFC, livres, IFTA, detention), SQLite-first, aucune notion de capacité ni de marketplace, aucune couverture de tests |
| Réutilisable | 💡 le principe « journal d'événements auto-alimenté » et « complétude documentaire » (BOL/POD) |
| À adapter | 🔧 la complétude documentaire → preuves de dépôt/remise (post-MVP) ; l'organisation kanban pour le tableau de bord prestataire |
| Exclu | ❌ `freight-core` (US), schéma 53 colonnes, SQLite, les 17 autres mini-apps |

## 2. OpenBoxes — https://github.com/openboxes/openboxes

| Champ | Constat |
|---|---|
| Licence | EPL-1.0 (fichier `LICENSE.md` : « Eclipse Public License -v 1.0 ») |
| Activité | Très active (push 2026-10-22), 917 étoiles, créé 2012, 10 workflows CI |
| Langage / framework | Groovy / Grails, MySQL/PostgreSQL |
| Architecture | Application monolithique d'entrepôt (inventaire, réceptions, expéditions, mouvements entre sites) ; conçue pour environnements à faibles ressources (objectif déclaré dans le README) |
| Fonctionnalités | Gestion de stock et de mouvements pour établissements de santé ; non évalué à l'exécution |
| Tests | 245 fichiers de test (Groovy/Spock, JS) |
| Risques | Stack JVM incompatible ; EPL-1.0 impose de publier les modifications des fichiers EPL dérivés ; périmètre (stock) ≠ marketplace |
| Réutilisable | 💡 modèle « mouvement entre sites » + historique, pour la phase relais/entrepôts |
| Exclu | ❌ tout code |

## 3. OpenRouteService — https://github.com/GIScience/openrouteservice

| Champ | Constat |
|---|---|
| Licence | **GPL-3.0** (fichier `LICENSE` lu). ⚠️ Une page web du projet évoque la LGPL : **conflit**, on retient le fichier du dépôt |
| Activité | Très active (push 2026-10-21), 1 986 étoiles, 164 fichiers de test, 15 workflows |
| Langage | Java (fork de GraphHopper 4.0, données OpenStreetMap) |
| Services | Directions, isochrones, matrices, snapping, export de graphe |
| Coûts | API publique : plan « Standard » gratuit, ≈ 2 000 requêtes directions/jour (source : recherche web, non confirmée par la page officielle qui a renvoyé 404 à la lecture) ; le plan « Collaborative » exclut l'usage commercial. **Conditions d'usage commercial de l'API publique : à vérifier sur le site avant tout usage** |
| Auto-hébergement | Possible (Docker), lourd en RAM/disque pour un extrait Afrique ; non testé |
| Risques | GPL-3.0 : ne jamais embarquer le code ; appeler le service par HTTP uniquement. Un itinéraire routier **ne prouve pas** qu'un transport existe |
| Décision | ❌ **Hors MVP.** L'appariement MVP se fait sur des paires de villes configurées ; la distance n'est pas un critère. À réévaluer pour le dernier kilomètre/points relais |

## 4. Peek Delivery Tracker — https://github.com/plhery/peek-delivery-tracker

| Champ | Constat |
|---|---|
| Licence | Apache-2.0 (fichier `LICENSE` lu) |
| Activité | Créé 2026-07-01, push 2026-10-22, 13 étoiles |
| Langage / framework | TypeScript, React, Supabase (PostgreSQL), PWA + app iOS |
| Fonctionnalités | Suivi de colis *existants* de 3 500+ transporteurs via un moteur séparé (Universal Parcel Scraper, autre dépôt) ; notifications configurables, heures calmes, partage de page de colis, suppression 30 jours après livraison pour les suivis sans compte |
| Tests | 304 fichiers (unitaires, E2E Playwright, scripts CI), 6 workflows |
| Risques | Produit différent (agrégateur de suivi) ; dépend d'un scraper séparé |
| Réutilisable | 💡 page de suivi publique partageable **sans compte** ; 💡 règle de rétention des données ; 💡 discipline E2E |
| À adapter | 🔧 timeline publique minimale (sans données personnelles) ; notifications par canaux (post-MVP) |
| Exclu | ❌ code d'intégration des transporteurs |

## 5. ERPNext — https://github.com/frappe/erpnext

| Champ | Constat |
|---|---|
| Licence | GPL-3.0 (API GitHub) |
| Activité | Très active, 40 455 étoiles, Python / Frappe |
| Décision | 💡 concepts de facturation, rapprochement, validations — **phase B2B/paiements uniquement**. ❌ pas de backend, pas de code (GPL-3.0 + stack Frappe) |

## 6. courier-logistics-backend — https://github.com/mdshamim-mern/courier-logistics-backend

| Champ | Constat |
|---|---|
| Licence | **Aucune** (API : `license: NONE` ; `LICENSE` introuvable) → droits réservés ; **interdit de copier le code** |
| Activité | Créé 2026-09-10, push 2026-10-10, 0 étoile |
| Stack | Node, Express, TypeScript, Prisma, PostgreSQL ; paiement bKash/Stripe/SSLCommerz |
| Tests | 12 fichiers dont `row-locks.test.ts`, `security.test.ts`, `integration/transactions.test.ts` (noms lus ; contenu non examiné) |
| Lu (idées seulement) | Statuts d'expédition, hubs/transferts, tentatives de paiement, `bookingKey` d'idempotence, soft-delete |
| Réutilisable | 💡 l'existence de tests de verrous de lignes et d'idempotence comme exigence pour notre propre suite — ré-écrite de zéro |
| Exclu | ❌ tout code ; ❌ l'intégration de paiement (Bangladesh, non pertinente) |

## 7. SwiftShip — https://github.com/burhanalibajwa/swiftship-courier-management-system

| Champ | Constat |
|---|---|
| Licence | MIT (fichier `LICENSE` lu) |
| Activité | Créé 2026-09-17, un seul jour d'activité, 0 étoile |
| Stack | Django REST, PostgreSQL, JWT, Docker, WebSocket |
| Tests | 35 fichiers `test_*.py` (permissions, transitions, preuve de livraison, rate limiting) |
| Lu | `shipments/models.py`, `constants.py` : table `VALID_TRANSITIONS` en source unique de vérité ; `TrackingEvent` immuable (aucun endpoint update/delete) ; colis/lignes d'articles ; `CheckConstraint` sur montants ≥ 0 |
| Réutilisable | 💡 **transitions déclaratives + événements immuables** (adoptés, ré-écrits en TypeScript avec rôles et trigger Postgres d'immutabilité) ; 💡 contraintes CHECK sur les montants |
| Exclu | ❌ code Django ; COD, riders, analytics (hors périmètre) |

---

## Dépendances adoptées (licences vérifiées via `npm view <pkg> license` le 2026-10-22)

| Paquet | Rôle | Licence |
|---|---|---|
| next, react, react-dom | Application web | MIT |
| tailwindcss, @tailwindcss/postcss | Styles | MIT |
| drizzle-orm | ORM SQL typé | Apache-2.0 |
| drizzle-kit | Migrations | MIT |
| pg | Pilote PostgreSQL | MIT |
| zod | Validation d'entrées | MIT |
| vitest | Tests | MIT |
| tsx | Exécution de scripts TS | MIT |
| typescript (5.9.x) | Langage | Apache-2.0 |
| eslint, eslint-config-next | Lint | MIT |

Aucune dépendance d'authentification tierce : le hachage utilise `crypto.scrypt` de Node (voir DECISIONS_LOG D-004). Un audit de licences transitif (`npm ls --all` + `license-checker`) est dans NEXT_STEPS.

## Règle d'entrée d'un nouveau composant

1. Licence lue dans le dépôt (pas dans le README). 2. Pas de GPL/AGPL embarqué. 3. Au moins des tests présents. 4. Gain mesurable vs 20 lignes de code maison. 5. Une ligne ajoutée à ce catalogue.
