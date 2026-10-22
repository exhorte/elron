import { z, type ZodType } from "zod";
import {
  bookingCreateSchema,
  confirmDeliverySchema,
  identityReviewSchema,
  loginSchema,
  offerCreateSchema,
  reasonSchema,
  registerSchema,
  requestCreateSchema,
  searchQuerySchema,
  transitionSchema,
  travelerProfileSchema,
  userStatusSchema,
} from "./validation";
import type { AuthLevel } from "./http";

/**
 * Contrat d'API généré à partir des schémas zod réels : la documentation ne peut pas diverger de la
 * validation. `npm run docs:openapi` régénère docs/openapi.json ; un test vérifie qu'il est à jour et
 * qu'il couvre exactement les routes de src/app/api/v1.
 */
export interface Operation {
  method: "get" | "post" | "put";
  path: string;
  tag: string;
  summary: string;
  auth: AuthLevel;
  body?: ZodType;
  query?: ZodType;
  status?: number;
  notes?: string;
}

export const OPERATIONS: Operation[] = [
  { method: "get", path: "/api/v1/health", tag: "Système", summary: "Santé de l'application et de la base", auth: "none" },
  { method: "get", path: "/api/v1/meta", tag: "Système", summary: "Référentiels publics : couloirs ouverts, catégories de marchandises (politique non validée juridiquement), devises", auth: "none" },

  { method: "post", path: "/api/v1/auth/register", tag: "Auth", summary: "Créer un compte et ouvrir une session", auth: "none", body: registerSchema, status: 201 },
  { method: "post", path: "/api/v1/auth/login", tag: "Auth", summary: "Se connecter (5 échecs → verrouillage 15 min)", auth: "none", body: loginSchema },
  { method: "post", path: "/api/v1/auth/logout", tag: "Auth", summary: "Fermer la session", auth: "none" },
  { method: "get", path: "/api/v1/me", tag: "Profils", summary: "Utilisateur courant et profil voyageur", auth: "user" },
  { method: "put", path: "/api/v1/me/traveler-profile", tag: "Profils", summary: "Créer/mettre à jour le profil voyageur ; déclarer une identité (statut « declared », jamais « verified »)", auth: "user", body: travelerProfileSchema },

  { method: "get", path: "/api/v1/search/offers", tag: "Recherche", summary: "Offres compatibles, classées par score transparent (filtres obligatoires + critères pondérés)", auth: "optional", query: searchQuerySchema },

  { method: "get", path: "/api/v1/offers", tag: "Offres", summary: "Mes offres de capacité", auth: "user" },
  { method: "post", path: "/api/v1/offers", tag: "Offres", summary: "Publier une offre de capacité (profil voyageur requis)", auth: "user", body: offerCreateSchema, status: 201 },
  { method: "get", path: "/api/v1/offers/{id}", tag: "Offres", summary: "Détail public d'une offre (sans adresses)", auth: "none" },
  { method: "post", path: "/api/v1/offers/{id}/cancel", tag: "Offres", summary: "Annuler mon offre (refusé s'il existe une réservation acceptée)", auth: "user" },

  { method: "get", path: "/api/v1/requests", tag: "Demandes", summary: "Mes demandes d'expédition", auth: "user" },
  { method: "post", path: "/api/v1/requests", tag: "Demandes", summary: "Publier une demande d'expédition", auth: "user", body: requestCreateSchema, status: 201 },
  { method: "get", path: "/api/v1/requests/{id}", tag: "Demandes", summary: "Détail d'une demande (auteur ou opérateur)", auth: "user" },
  { method: "get", path: "/api/v1/requests/{id}/matches", tag: "Recherche", summary: "Offres compatibles avec ma demande (?explain=1 liste les exclusions)", auth: "user" },
  { method: "post", path: "/api/v1/requests/{id}/cancel", tag: "Demandes", summary: "Annuler ma demande ouverte", auth: "user" },

  { method: "get", path: "/api/v1/bookings", tag: "Réservations", summary: "Mes réservations (?as=sender|provider)", auth: "user" },
  { method: "post", path: "/api/v1/bookings", tag: "Réservations", summary: "Demander à réserver de la capacité (aucune capacité réservée avant acceptation)", auth: "user", body: bookingCreateSchema, status: 201 },
  { method: "get", path: "/api/v1/bookings/{id}", tag: "Réservations", summary: "Détail d'une réservation (parties uniquement)", auth: "user" },
  { method: "post", path: "/api/v1/bookings/{id}/accept", tag: "Réservations", summary: "Accepter (prestataire) : réserve la capacité et crée le colis dans une transaction", auth: "user" },
  { method: "post", path: "/api/v1/bookings/{id}/reject", tag: "Réservations", summary: "Refuser (prestataire)", auth: "user", body: reasonSchema },
  { method: "post", path: "/api/v1/bookings/{id}/cancel", tag: "Réservations", summary: "Retirer ma demande en attente (expéditeur)", auth: "user" },

  { method: "get", path: "/api/v1/shipments", tag: "Colis", summary: "Mes colis (expéditeur ou prestataire)", auth: "user" },
  { method: "get", path: "/api/v1/shipments/{id}", tag: "Colis", summary: "Détail, historique d'événements et transitions autorisées (parties/opérateur ; 404 pour un tiers)", auth: "user" },
  { method: "post", path: "/api/v1/shipments/{id}/transitions", tag: "Colis", summary: "Changer le statut selon la table de transitions et le rôle ; DELIVERED exige le code", auth: "user", body: transitionSchema },
  { method: "post", path: "/api/v1/shipments/{id}/delivery-code", tag: "Colis", summary: "Expéditeur : générer/régénérer le code de remise (affiché une seule fois)", auth: "user" },
  { method: "post", path: "/api/v1/shipments/{id}/confirm-delivery", tag: "Colis", summary: "Transporteur : confirmer la remise avec le code du destinataire (5 tentatives, expiration)", auth: "user", body: confirmDeliverySchema },
  { method: "get", path: "/api/v1/track/{code}", tag: "Colis", summary: "Suivi public par code (sans donnée personnelle)", auth: "none" },

  { method: "get", path: "/api/v1/admin/identity-reviews", tag: "Administration", summary: "Identités déclarées en attente de revue", auth: "operator" },
  { method: "post", path: "/api/v1/admin/users/{id}/identity-review", tag: "Administration", summary: "Décision d'opérateur sur une identité déclarée", auth: "operator", body: identityReviewSchema },
  { method: "post", path: "/api/v1/admin/users/{id}/status", tag: "Administration", summary: "Suspendre/réactiver un compte (administrateur)", auth: "admin", body: userStatusSchema },
  { method: "get", path: "/api/v1/admin/shipments", tag: "Administration", summary: "Tous les colis (opérateur)", auth: "operator" },
];

/** Retire le motif regex géant que zod ajoute aux date-time (le format suffit à la lisibilité du contrat). */
function stripDateTimePatterns(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripDateTimePatterns);
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "pattern" && obj.format === "date-time") continue;
      out[k] = stripDateTimePatterns(v);
    }
    return out;
  }
  return node;
}

const jsonSchema = (schema: ZodType) =>
  stripDateTimePatterns(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })) as Record<string, unknown>;

function errorResponses(op: Operation): Record<string, unknown> {
  const ref = { $ref: "#/components/responses/Error" };
  const out: Record<string, unknown> = {};
  if (op.auth !== "none" && op.auth !== "optional") out["401"] = ref;
  if (op.auth === "operator" || op.auth === "admin" || (op.method !== "get" && op.auth === "user")) out["403"] = ref;
  if (op.path.includes("{")) out["404"] = ref;
  if (op.method !== "get") out["409"] = ref;
  if (op.body || op.query || op.path.includes("{")) out["422"] = ref;
  return out;
}

export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const parameters: unknown[] = [];
    for (const name of op.path.match(/\{(\w+)\}/g)?.map((p) => p.slice(1, -1)) ?? []) {
      parameters.push({ name, in: "path", required: true, schema: { type: "string" } });
    }
    if (op.query) {
      const schema = jsonSchema(op.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, s] of Object.entries(schema.properties ?? {})) {
        parameters.push({ name, in: "query", required: schema.required?.includes(name) ?? false, schema: s });
      }
    }
    if (op.path === "/api/v1/bookings" && op.method === "get") {
      parameters.push({ name: "as", in: "query", required: false, schema: { type: "string", enum: ["sender", "provider"], default: "sender" } });
    }
    (paths[op.path] ??= {})[op.method] = {
      tags: [op.tag],
      summary: op.summary,
      ...(op.auth === "none" ? { security: [] } : { security: [{ cookieAuth: [] }] }),
      "x-auth": op.auth,
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(op.body) } } } } : {}),
      responses: {
        [String(op.status ?? 200)]: { description: "Succès ; corps `{ \"data\": … }`" },
        ...errorResponses(op),
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "African Logistics Exchange (ALX) — API v1",
      version: "0.1.0",
      description:
        "API du MVP (lot 1). Succès : `{ data }`. Erreur : `{ error: { code, message, details? } }`. " +
        "Montants en unités mineures entières (XOF/XAF : francs ; EUR/CAD/USD : centimes) ; poids en grammes. " +
        "Aucun paiement n'est implémenté (hors périmètre). La politique de catégories de marchandises est interne et NON validée juridiquement. " +
        "Les données de démonstration (`isDemo`) ne sont jamais mélangées aux données réelles. " +
        "Fichier généré : `npm run docs:openapi`.",
    },
    servers: [{ url: "/" }],
    tags: [...new Set(OPERATIONS.map((o) => o.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { cookieAuth: { type: "apiKey", in: "cookie", name: "alx_session" } },
      responses: {
        Error: {
          description: "Erreur applicative",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["error"],
                properties: {
                  error: {
                    type: "object",
                    required: ["code", "message"],
                    properties: { code: { type: "string" }, message: { type: "string" }, details: {} },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
