import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { syncReferenceData } from "@/db/reference-data";
import { db, dbError, makeAcceptedShipment, makeOffer, makeRequest, makeUser, resetDb } from "../helpers";

beforeEach(resetDb);

const EXPECTED_TABLES = [
  "audit_logs",
  "bookings",
  "capacity_offers",
  "cities",
  "routes",
  "sessions",
  "shipment_events",
  "shipment_items",
  "shipment_requests",
  "shipments",
  "traveler_profiles",
  "users",
];

describe("migrations", () => {
  it("créent toutes les tables attendues", async () => {
    const res = await db().execute(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`);
    const names = (res.rows as Array<{ table_name: string }>).map((r) => r.table_name);
    for (const t of EXPECTED_TABLES) expect(names, t).toContain(t);
  });

  it("sont rejouables sans erreur (idempotence)", async () => {
    await expect(migrate(db(), { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") })).resolves.not.toThrow();
  });

  it("synchronisent le référentiel de façon idempotente", async () => {
    const first = await syncReferenceData(db());
    const second = await syncReferenceData(db());
    expect(second).toEqual(first);
    const routes = await db().select().from(schema.routes).where(eq(schema.routes.enabled, true));
    expect(routes.map((r) => r.id).sort()).toEqual(["ci-abidjan--sn-dakar", "sn-dakar--ci-abidjan"]);
    const cities = await db().select().from(schema.cities);
    expect(cities.map((c) => c.id).sort()).toEqual(["ci-abidjan", "sn-dakar"]);
  });

  it("n'insèrent aucune donnée (ni opérationnelle, ni de démonstration) : le démo passe uniquement par db:seed:demo", () => {
    const dir = path.resolve(import.meta.dirname, "../../drizzle");
    const sqlFiles = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    expect(sqlFiles.length).toBeGreaterThanOrEqual(2);
    for (const file of sqlFiles) {
      expect(readFileSync(path.join(dir, file), "utf8"), file).not.toMatch(/\bINSERT\s+INTO\b/i);
    }
  });
});

describe("contraintes d'intégrité", () => {
  it("interdit deux réservations acceptées pour la même demande", async () => {
    const ctx = await makeAcceptedShipment();
    const [accepted] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, ctx.bookingId));
    const { id: _id, ...clone } = accepted!;
    void _id;
    const other = await makeUser({ traveler: true });
    const otherOffer = await makeOffer(other);
    expect(await dbError(
      db().insert(schema.bookings).values({ ...clone, offerId: otherOffer.id, providerUserId: other.id, status: "accepted" }),
    )).toMatch(/bookings_one_accepted_per_request_key|duplicate key/);
  });

  it("interdit deux réservations actives (même demande, même offre)", async () => {
    const ctx = await makeAcceptedShipment();
    const [accepted] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, ctx.bookingId));
    const { id: _id, ...clone } = accepted!;
    void _id;
    expect(await dbError(db().insert(schema.bookings).values({ ...clone, status: "requested" }))).toMatch(/bookings_active_pair_key|duplicate key/);
    // un statut terminal ne bloque pas une nouvelle demande
    await expect(db().insert(schema.bookings).values({ ...clone, status: "rejected" })).resolves.toBeDefined();
  });

  it("refuse des montants incohérents ou négatifs et des parties identiques", async () => {
    const ctx = await makeAcceptedShipment();
    const [b] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, ctx.bookingId));
    const { id: _id, ...clone } = b!;
    void _id;
    const base = { ...clone, status: "rejected" as const };
    expect(await dbError(db().insert(schema.bookings).values({ ...base, platformFeeMinor: 10 }))).toMatch(/bookings_amounts_consistent/);
    expect(await dbError(db().insert(schema.bookings).values({ ...base, subtotalMinor: -5, platformFeeMinor: 0, providerNetMinor: -5 }))).toMatch(/bookings_amounts/);
    expect(await dbError(db().insert(schema.bookings).values({ ...base, providerUserId: base.senderUserId }))).toMatch(/bookings_parties_distinct/);
    expect(await dbError(db().insert(schema.bookings).values({ ...base, weightG: 0 }))).toMatch(/bookings_weight_positive/);
  });

  it("refuse deux colis pour la même réservation ou le même code de suivi", async () => {
    const a = await makeAcceptedShipment();
    const [s] = await db().select().from(schema.shipments).where(eq(schema.shipments.id, a.shipmentId));
    const { id: _id, ...clone } = s!;
    void _id;
    expect(await dbError(db().insert(schema.shipments).values({ ...clone, trackingCode: "ALX-ZZZZZZZZ" }))).toMatch(/shipments_booking_key/);
    const b = await makeAcceptedShipment();
    const [s2] = await db().select().from(schema.shipments).where(eq(schema.shipments.id, b.shipmentId));
    expect(await dbError(db().update(schema.shipments).set({ trackingCode: s!.trackingCode }).where(eq(schema.shipments.id, s2!.id)))).toMatch(/shipments_tracking_code_key/);
  });

  it("refuse un statut de colis inconnu", async () => {
    const ctx = await makeAcceptedShipment();
    await expect(db().execute(sql`update shipments set status = 'TELEPORTED' where id = ${ctx.shipmentId}`)).rejects.toThrow();
  });

  it("refuse les incohérences de demande (budget sans devise, poids nul, fenêtre inversée)", async () => {
    const sender = await makeUser();
    const request = await makeRequest(sender);
    const set = (v: Partial<typeof schema.shipmentRequests.$inferInsert>) =>
      db().update(schema.shipmentRequests).set(v).where(eq(schema.shipmentRequests.id, request.id));
    expect(await dbError(set({ budgetMaxMinor: 1000 }))).toMatch(/requests_budget_consistent/);
    expect(await dbError(set({ weightG: 0 }))).toMatch(/requests_weight_positive/);
    expect(await dbError(set({ earliestDepartureAt: new Date("2030-01-02"), latestDepartureAt: new Date("2030-01-01") }))).toMatch(/requests_window_ordered/);
  });

  it("refuse une offre sans catégorie, à prix négatif ou à arrivée avant le départ", async () => {
    const provider = await makeUser({ traveler: true });
    const offer = await makeOffer(provider);
    const set = (v: Partial<typeof schema.capacityOffers.$inferInsert>) =>
      db().update(schema.capacityOffers).set(v).where(eq(schema.capacityOffers.id, offer.id));
    expect(await dbError(set({ acceptedCategories: [] }))).toMatch(/offers_categories_not_empty/);
    expect(await dbError(set({ pricePerKgMinor: -1 }))).toMatch(/offers_price_non_negative/);
    expect(await dbError(set({ arrivalEstimatedAt: new Date(offer.departureAt.getTime() - 1000) }))).toMatch(/offers_arrival_after_departure/);
  });

  it("protège l'intégrité référentielle (pas de suppression d'un utilisateur ayant des colis)", async () => {
    const ctx = await makeAcceptedShipment();
    await expect(db().delete(schema.users).where(eq(schema.users.id, ctx.sender.id))).rejects.toThrow();
  });
});

describe("migrations : indexes de recherche", () => {
  it("l'index partiel des offres publiées existe", async () => {
    const res = await db().execute(sql`select indexname from pg_indexes where tablename = 'capacity_offers'`);
    expect((res.rows as Array<{ indexname: string }>).map((r) => r.indexname)).toContain("offers_search_idx");
  });
});
