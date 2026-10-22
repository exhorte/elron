# DATA_SOURCES

## Principe

- **Données opérationnelles** : saisies par de vrais utilisateurs. **Aucune** donnée opérationnelle n'est pré-remplie.
- **Données de référence** : villes et couloirs activés (`cities`, `routes`). Faits géographiques, sans prétention de service réel.
- **Données de démonstration** : jamais chargées par les migrations. Elles ne s'insèrent que par `npm run db:seed:demo`. Chaque ligne démo est marquée `is_demo = true` ; les e-mails démo utilisent le domaine réservé `@demo.alx.invalid`. L'interface affiche un bandeau « DÉMO » sur toute offre/demande démo, et la recherche exclut le démo par défaut (`?includeDemo=1` ou `ALX_SHOW_DEMO=true` pour l'inclure).

## Registre

| ID | Source | Nature | Collecte | Méthode | Limites / restrictions |
|---|---|---|---|---|---|
| DS-01 | `02_context/expedition colis_compressed.pdf` (fourni par le porteur du projet) | Captures d'annonces Facebook/WhatsApp, août 2026 | Fournie ; lue le 2026-10-22 | Lecture visuelle des 5 pages | Annonces de tiers ; **non réutilisées comme données** (noms, numéros de téléphone non copiés) ; sert uniquement à orienter le modèle |
| DS-02 | `02_context/expedition coli search solution.md` | Conversation ChatGPT (recherche, recommandations) | Fournie | Lecture | Contient des affirmations non vérifiées (ex. fonctionnalités de YOBU) ; voir BENCHMARK.md |
| DS-03 | Pages officielles des 7 plateformes | Texte public | 2026-10-22 | Outil de lecture web + recherche | Voir `BENCHMARK.md` ; Grabr/YOBU non lisibles |
| DS-04 | API GitHub (7 dépôts) | Métadonnées, licences, arbres | 2026-10-22 | `gh api` (lecture seule) | Voir `REUSE_CATALOG.md` |
| DS-05 | `src/config/cities.ts`, `src/config/routes.ts` | Villes/couloirs de référence (Dakar, Abidjan) | 2026-10-22 | Saisie manuelle | Coordonnées arrondies, non utilisées dans le calcul ; **n'attestent aucun service de transport** |
| DS-06 | `src/config/goods-policy.ts` | Politique plateforme des catégories de marchandises | 2026-10-22 | Rédaction interne d'après l'observation du PDF | **Politique interne, pas une règle douanière ni juridique.** Validation professionnelle requise avant tout usage réel (voir `DECISIONS_LOG` D-009) |

## À collecter plus tard (non commencé)

Répertoire de transporteurs, tarifs observés historisés, points de dépôt/retrait, réglementation par corridor (sources officielles uniquement), incidents. Respect des conditions d'accès des sites ; aucun contournement d'authentification ; ne jamais stocker de pièces d'identité dans Git.
