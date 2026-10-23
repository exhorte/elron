import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Import relatif (et non "@/…") : drizzle-kit charge ce fichier sans résolution des alias tsconfig.
import { SHIPMENT_STATUSES, ACTOR_ROLES } from "../domain/workflow";

/**
 * Schéma MVP lot 1 (voir ARCHITECTURE.md). Tables volontairement différées : organizations,
 * organization_members, carrier_profiles, driver_profiles, relay_points, quotes, payments, payouts,
 * refunds, disputes, reviews, notifications (D-005). Les contraintes CHECK/partielles et les
 * triggers d'immutabilité complètent ce schéma dans les migrations SQL (drizzle/*.sql).
 */

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const platformRole = pgEnum("platform_role", ["user", "operator", "admin"]);
export const userStatus = pgEnum("user_status", ["active", "suspended"]);
export const identityStatus = pgEnum("identity_status", ["not_provided", "declared", "verified", "rejected"]);
export const transportMode = pgEnum("transport_mode", ["air", "bus", "car", "train", "other"]);
export const offerStatus = pgEnum("offer_status", ["published", "closed", "cancelled"]);
export const requestStatus = pgEnum("request_status", ["open", "booked", "cancelled"]);
export const bookingStatus = pgEnum("booking_status", ["requested", "accepted", "rejected", "cancelled", "superseded"]);
export const shipmentStatus = pgEnum("shipment_status", SHIPMENT_STATUSES);
export const actorRole = pgEnum("actor_role", ACTOR_ROLES);

// ───────────────────────── Identité et sessions

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    phone: text("phone"),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    platformRole: platformRole("platform_role").notNull().default("user"),
    status: userStatus("status").notNull().default("active"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    check("users_email_lowercase", sql`${t.email} = lower(${t.email})`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_hash_key").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/** Jetons de réinitialisation de mot de passe : seule l'empreinte SHA-256 est stockée ; usage unique ; expirants. */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("password_reset_token_hash_key").on(t.tokenHash), index("password_reset_user_idx").on(t.userId)],
);

/**
 * Profil voyageur/transporteur individuel. Tout utilisateur peut expédier sans profil ; un même
 * utilisateur peut être expéditeur ET voyageur. Statut déclaré ≠ statut vérifié ≠ décision opérateur :
 * aucun fichier d'identité n'est stocké, la vérification est un acte explicite d'un opérateur.
 */
export const travelerProfiles = pgTable(
  "traveler_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    bio: text("bio"),
    declaredLegalName: text("declared_legal_name"),
    declaredIdKind: text("declared_id_kind"), // national_id | passport | residence_permit (aucun numéro stocké)
    identityStatus: identityStatus("identity_status").notNull().default("not_provided"),
    identityDeclaredAt: timestamp("identity_declared_at", { withTimezone: true }),
    identityReviewedBy: uuid("identity_reviewed_by").references(() => users.id),
    identityReviewedAt: timestamp("identity_reviewed_at", { withTimezone: true }),
    identityReviewNote: text("identity_review_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "traveler_verified_requires_reviewer",
      sql`${t.identityStatus} <> 'verified' OR (${t.identityReviewedBy} IS NOT NULL AND ${t.identityReviewedAt} IS NOT NULL)`,
    ),
  ],
);

/** Compteurs de limitation de débit (fenêtre fixe). `key` = politique + empreinte du sujet : aucune IP ni e-mail en clair. */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index("rate_limit_window_idx").on(t.windowStart)],
);

// ───────────────────────── Référentiel géographique (configurable)

export const cities = pgTable("cities", {
  id: text("id").primaryKey(),
  countryCode: char("country_code", { length: 2 }).notNull(),
  name: text("name").notNull(),
  lat: doublePrecision("lat"),
  lon: doublePrecision("lon"),
  enabled: boolean("enabled").notNull().default(true),
});

export const routes = pgTable(
  "routes",
  {
    id: text("id").primaryKey(),
    originCityId: text("origin_city_id")
      .notNull()
      .references(() => cities.id),
    destinationCityId: text("destination_city_id")
      .notNull()
      .references(() => cities.id),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [
    uniqueIndex("routes_pair_key").on(t.originCityId, t.destinationCityId),
    check("routes_distinct_cities", sql`${t.originCityId} <> ${t.destinationCityId}`),
  ],
);

// ───────────────────────── Marché : offres de capacité et demandes

export const capacityOffers = pgTable(
  "capacity_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerUserId: uuid("provider_user_id")
      .notNull()
      .references(() => users.id),
    routeId: text("route_id")
      .notNull()
      .references(() => routes.id),
    transportMode: transportMode("transport_mode").notNull(),
    departureAt: timestamp("departure_at", { withTimezone: true }).notNull(),
    arrivalEstimatedAt: timestamp("arrival_estimated_at", { withTimezone: true }),
    depositCutoffAt: timestamp("deposit_cutoff_at", { withTimezone: true }),
    capacityWeightG: integer("capacity_weight_g").notNull(),
    reservedWeightG: integer("reserved_weight_g").notNull().default(0),
    capacityVolumeL: integer("capacity_volume_l"),
    reservedVolumeL: integer("reserved_volume_l").notNull().default(0),
    pricePerKgMinor: integer("price_per_kg_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    acceptedCategories: text("accepted_categories").array().notNull(),
    handoverTerms: text("handover_terms"),
    depositAddress: text("deposit_address"),
    pickupAddress: text("pickup_address"),
    status: offerStatus("status").notNull().default("published"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("offers_search_idx").on(t.routeId, t.departureAt).where(sql`${t.status} = 'published'`),
    index("offers_provider_idx").on(t.providerUserId),
    check("offers_capacity_positive", sql`${t.capacityWeightG} > 0`),
    check("offers_reserved_within_capacity", sql`${t.reservedWeightG} >= 0 AND ${t.reservedWeightG} <= ${t.capacityWeightG}`),
    check(
      "offers_volume_within_capacity",
      sql`${t.reservedVolumeL} >= 0 AND (${t.capacityVolumeL} IS NULL OR ${t.reservedVolumeL} <= ${t.capacityVolumeL})`,
    ),
    check("offers_price_non_negative", sql`${t.pricePerKgMinor} >= 0`),
    check("offers_arrival_after_departure", sql`${t.arrivalEstimatedAt} IS NULL OR ${t.arrivalEstimatedAt} >= ${t.departureAt}`),
    check("offers_categories_not_empty", sql`cardinality(${t.acceptedCategories}) > 0`),
  ],
);

export const shipmentRequests = pgTable(
  "shipment_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => users.id),
    routeId: text("route_id")
      .notNull()
      .references(() => routes.id),
    weightG: integer("weight_g").notNull(),
    lengthCm: integer("length_cm"),
    widthCm: integer("width_cm"),
    heightCm: integer("height_cm"),
    volumeL: integer("volume_l"),
    category: text("category").notNull(),
    description: text("description").notNull(),
    items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
    declaredValueMinor: integer("declared_value_minor"),
    declaredValueCurrency: char("declared_value_currency", { length: 3 }),
    budgetMaxMinor: integer("budget_max_minor"),
    budgetCurrency: char("budget_currency", { length: 3 }),
    budgetIsStrict: boolean("budget_is_strict").notNull().default(false),
    earliestDepartureAt: timestamp("earliest_departure_at", { withTimezone: true }),
    latestDepartureAt: timestamp("latest_departure_at", { withTimezone: true }),
    neededBy: timestamp("needed_by", { withTimezone: true }),
    deadlineIsStrict: boolean("deadline_is_strict").notNull().default(false),
    // Destinataire : personne tierce, pas forcément utilisateur de la plateforme.
    receiverName: text("receiver_name").notNull(),
    receiverPhone: text("receiver_phone").notNull(),
    status: requestStatus("status").notNull().default("open"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("requests_sender_idx").on(t.senderUserId),
    index("requests_open_route_idx").on(t.routeId).where(sql`${t.status} = 'open'`),
    check("requests_weight_positive", sql`${t.weightG} > 0`),
    check("requests_budget_consistent", sql`(${t.budgetMaxMinor} IS NULL) = (${t.budgetCurrency} IS NULL)`),
    check("requests_declared_value_consistent", sql`(${t.declaredValueMinor} IS NULL) = (${t.declaredValueCurrency} IS NULL)`),
    check("requests_window_ordered", sql`${t.earliestDepartureAt} IS NULL OR ${t.latestDepartureAt} IS NULL OR ${t.earliestDepartureAt} <= ${t.latestDepartureAt}`),
  ],
);

// ───────────────────────── Réservations

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => shipmentRequests.id),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => capacityOffers.id),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => users.id),
    providerUserId: uuid("provider_user_id")
      .notNull()
      .references(() => users.id),
    weightG: integer("weight_g").notNull(),
    volumeL: integer("volume_l"),
    status: bookingStatus("status").notNull().default("requested"),
    // Prix figé à la demande de réservation (instantané) : la modification de l'offre ne le change pas.
    pricePerKgMinor: integer("price_per_kg_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    subtotalMinor: integer("subtotal_minor").notNull(),
    platformFeeMinor: integer("platform_fee_minor").notNull(),
    providerNetMinor: integer("provider_net_minor").notNull(),
    feeBps: integer("fee_bps").notNull(),
    message: text("message"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => users.id),
    statusReason: text("status_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("bookings_offer_idx").on(t.offerId),
    index("bookings_sender_idx").on(t.senderUserId),
    index("bookings_provider_idx").on(t.providerUserId),
    // Pas de double demande active du même colis auprès de la même offre…
    uniqueIndex("bookings_active_pair_key").on(t.requestId, t.offerId).where(sql`${t.status} IN ('requested','accepted')`),
    // …et une demande ne peut être acceptée qu'une seule fois.
    uniqueIndex("bookings_one_accepted_per_request_key").on(t.requestId).where(sql`${t.status} = 'accepted'`),
    check("bookings_weight_positive", sql`${t.weightG} > 0`),
    check("bookings_amounts_non_negative", sql`${t.subtotalMinor} >= 0 AND ${t.platformFeeMinor} >= 0 AND ${t.providerNetMinor} >= 0`),
    check("bookings_amounts_consistent", sql`${t.providerNetMinor} + ${t.platformFeeMinor} = ${t.subtotalMinor}`),
    check("bookings_parties_distinct", sql`${t.senderUserId} <> ${t.providerUserId}`),
  ],
);

// ───────────────────────── Colis et suivi

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackingCode: text("tracking_code").notNull(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    requestId: uuid("request_id")
      .notNull()
      .references(() => shipmentRequests.id),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => capacityOffers.id),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => users.id),
    providerUserId: uuid("provider_user_id")
      .notNull()
      .references(() => users.id),
    routeId: text("route_id")
      .notNull()
      .references(() => routes.id),
    status: shipmentStatus("status").notNull().default("ACCEPTED"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    weightG: integer("weight_g").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    declaredValueMinor: integer("declared_value_minor"),
    declaredValueCurrency: char("declared_value_currency", { length: 3 }),
    receiverName: text("receiver_name").notNull(),
    receiverPhone: text("receiver_phone").notNull(),
    // Code de remise : généré à la demande de l'EXPÉDITEUR (jamais visible du transporteur) ; seul le
    // HMAC est stocké. generation = 0 tant qu'aucun code n'a été généré.
    deliveryCodeHash: text("delivery_code_hash"),
    deliveryCodeGeneration: integer("delivery_code_generation").notNull().default(0),
    deliveryCodeExpiresAt: timestamp("delivery_code_expires_at", { withTimezone: true }),
    deliveryCodeAttempts: integer("delivery_code_attempts").notNull().default(0),
    deliveryCodeLockedAt: timestamp("delivery_code_locked_at", { withTimezone: true }),
    deliveryCodeConsumedAt: timestamp("delivery_code_consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("shipments_tracking_code_key").on(t.trackingCode),
    uniqueIndex("shipments_booking_key").on(t.bookingId),
    index("shipments_sender_idx").on(t.senderUserId),
    index("shipments_provider_idx").on(t.providerUserId),
    index("shipments_status_idx").on(t.status),
    check("shipments_weight_positive", sql`${t.weightG} > 0`),
    check("shipments_attempts_non_negative", sql`${t.deliveryCodeAttempts} >= 0`),
  ],
);

export const shipmentItems = pgTable(
  "shipment_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    declaredValueMinor: integer("declared_value_minor"),
  },
  (t) => [index("shipment_items_shipment_idx").on(t.shipmentId), check("shipment_items_quantity_positive", sql`${t.quantity} >= 1`)],
);

/** Journal d'événements : append-only (trigger Postgres interdisant UPDATE/DELETE). */
export const shipmentEvents = pgTable(
  "shipment_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id),
    fromStatus: shipmentStatus("from_status"),
    toStatus: shipmentStatus("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorRole: actorRole("actor_role").notNull(),
    note: text("note"),
    context: jsonb("context").notNull().default(sql`'{}'::jsonb`),
    proofs: jsonb("proofs").notNull().default(sql`'[]'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shipment_events_shipment_idx").on(t.shipmentId, t.id)],
);

/** Journal d'audit : append-only. Ne jamais y écrire de mot de passe, secret ni code de remise. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId)],
);
