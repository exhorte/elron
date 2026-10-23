/**
 * Données de DÉMONSTRATION, uniquement pour des essais locaux. Jamais exécutées par les migrations.
 *
 *   npm run db:seed:demo          crée les comptes et trajets démo (refuse si déjà présents)
 *   npm run db:reset:demo         supprime TOUTES les données démo (is_demo = true) puis les recrée
 *
 * Toute ligne créée porte is_demo = true ; les e-mails utilisent le domaine réservé « demo.alx.invalid ».
 * Les données démo ne sont jamais mélangées aux données réelles (recherche et réservation les séparent).
 * Refuse de s'exécuter en production.
 */
import { randomBytes } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb, schema } from "../src/db/client";
import { registerUser } from "../src/server/auth";
import { requestBooking } from "../src/server/bookings";
import { createOffer } from "../src/server/offers";
import { createRequest } from "../src/server/requests";
import { upsertTravelerProfile } from "../src/server/admin";
import type { Actor } from "../src/server/actor";

const DEMO_DOMAIN = "demo.alx.invalid";
const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(Date.now() + d * DAY);

async function resetDemo() {
  const db = getDb();
  await db.transaction(async (tx) => {
    const demoUsers = (await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.isDemo, true))).map((u) => u.id);
    if (demoUsers.length === 0) return;
    const demoRequests = (await tx.select({ id: schema.shipmentRequests.id }).from(schema.shipmentRequests).where(eq(schema.shipmentRequests.isDemo, true))).map((r) => r.id);
    const demoShipments = demoRequests.length
      ? (await tx.select({ id: schema.shipments.id }).from(schema.shipments).where(inArray(schema.shipments.requestId, demoRequests))).map((s) => s.id)
      : [];
    // Opération de maintenance volontaire, limitée aux lignes démo : les journaux sont normalement en ajout seul.
    await tx.execute(sql`ALTER TABLE shipment_events DISABLE TRIGGER shipment_events_append_only`);
    await tx.execute(sql`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only`);
    await tx.execute(sql`ALTER TABLE dispute_messages DISABLE TRIGGER dispute_messages_append_only`);
    await tx.execute(sql`ALTER TABLE reviews DISABLE TRIGGER reviews_append_only`);
    await tx.execute(sql`ALTER TABLE proof_files DISABLE TRIGGER proof_files_append_only`);
    if (demoShipments.length) {
      const demoDisputes = (await tx.select({ id: schema.disputes.id }).from(schema.disputes).where(inArray(schema.disputes.shipmentId, demoShipments))).map((x) => x.id);
      if (demoDisputes.length) await tx.delete(schema.disputeMessages).where(inArray(schema.disputeMessages.disputeId, demoDisputes));
      await tx.delete(schema.disputes).where(inArray(schema.disputes.shipmentId, demoShipments));
      await tx.delete(schema.reviews).where(inArray(schema.reviews.shipmentId, demoShipments));
      await tx.delete(schema.proofFiles).where(inArray(schema.proofFiles.shipmentId, demoShipments));
      await tx.delete(schema.shipmentEvents).where(inArray(schema.shipmentEvents.shipmentId, demoShipments));
      await tx.delete(schema.shipmentItems).where(inArray(schema.shipmentItems.shipmentId, demoShipments));
      await tx.delete(schema.shipments).where(inArray(schema.shipments.id, demoShipments));
    }
    await tx.delete(schema.auditLogs).where(inArray(schema.auditLogs.actorUserId, demoUsers));
    await tx.delete(schema.bookings).where(inArray(schema.bookings.senderUserId, demoUsers));
    await tx.delete(schema.bookings).where(inArray(schema.bookings.providerUserId, demoUsers));
    await tx.delete(schema.shipmentRequests).where(eq(schema.shipmentRequests.isDemo, true));
    await tx.delete(schema.capacityOffers).where(eq(schema.capacityOffers.isDemo, true));
    await tx.delete(schema.sessions).where(inArray(schema.sessions.userId, demoUsers));
    await tx.delete(schema.travelerProfiles).where(inArray(schema.travelerProfiles.userId, demoUsers));
    await tx.delete(schema.users).where(inArray(schema.users.id, demoUsers));
    await tx.execute(sql`ALTER TABLE shipment_events ENABLE TRIGGER shipment_events_append_only`);
    await tx.execute(sql`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only`);
    await tx.execute(sql`ALTER TABLE dispute_messages ENABLE TRIGGER dispute_messages_append_only`);
    await tx.execute(sql`ALTER TABLE reviews ENABLE TRIGGER reviews_append_only`);
    await tx.execute(sql`ALTER TABLE proof_files ENABLE TRIGGER proof_files_append_only`);
  });
  console.log("Données de démonstration supprimées.");
}

async function mkUser(label: string, name: string, password: string, opts: { traveler?: boolean; role?: "user" | "operator" } = {}): Promise<Actor> {
  const db = getDb();
  const actor = await registerUser(db, {
    email: `${label}@${DEMO_DOMAIN}`,
    password,
    displayName: `${name} (démo)`,
    asTraveler: opts.traveler ?? false,
  });
  await db.update(schema.users).set({ isDemo: true, platformRole: opts.role ?? "user" }).where(eq(schema.users.id, actor.id));
  return { ...actor, isDemo: true, platformRole: opts.role ?? "user" };
}

async function seed() {
  const db = getDb();
  const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.isDemo, true)).limit(1);
  if (existing.length > 0) {
    console.error("Des données démo existent déjà. Utilisez `npm run db:reset:demo` pour les recréer.");
    process.exitCode = 1;
    return;
  }
  const password = randomBytes(9).toString("base64url");
  const traveler1 = await mkUser("voyageur1", "Voyageur fictif A", password, { traveler: true });
  const traveler2 = await mkUser("voyageur2", "Agence fictive B", password, { traveler: true });
  const sender = await mkUser("expediteur", "Expéditeur fictif", password);
  await mkUser("operateur", "Opérateur fictif", password, { role: "operator" });
  await upsertTravelerProfile(db, traveler1, { declaredLegalName: "Personne Fictive", declaredIdKind: "passport", bio: "Profil fictif de démonstration" });

  const base = { transportMode: "air" as const, currency: "XOF" as const, depositAddress: "Lieu de dépôt fictif", pickupAddress: "Lieu de retrait fictif", handoverTerms: "Conditions fictives de démonstration" };
  const offerA = await createOffer(db, traveler1, {
    ...base,
    originCityId: "sn-dakar",
    destinationCityId: "ci-abidjan",
    departureAt: inDays(4),
    arrivalEstimatedAt: inDays(4.2),
    depositCutoffAt: inDays(3),
    capacityWeightG: 23_000,
    capacityVolumeL: null,
    pricePerKgMinor: 3500,
    acceptedCategories: ["clothing", "books_misc", "documents"],
  });
  await createOffer(db, traveler2, {
    ...base,
    transportMode: "bus",
    originCityId: "sn-dakar",
    destinationCityId: "ci-abidjan",
    departureAt: inDays(7),
    arrivalEstimatedAt: null,
    depositCutoffAt: inDays(6),
    capacityWeightG: 150_000,
    capacityVolumeL: 800,
    pricePerKgMinor: 2800,
    acceptedCategories: ["clothing", "books_misc", "food_dry", "electronics"],
  });
  await createOffer(db, traveler1, {
    ...base,
    originCityId: "ci-abidjan",
    destinationCityId: "sn-dakar",
    departureAt: inDays(10),
    arrivalEstimatedAt: inDays(10.2),
    depositCutoffAt: inDays(9),
    capacityWeightG: 15_000,
    capacityVolumeL: null,
    pricePerKgMinor: 3200,
    acceptedCategories: ["clothing", "books_misc"],
  });

  const request = await createRequest(db, sender, {
    originCityId: "sn-dakar",
    destinationCityId: "ci-abidjan",
    weightG: 6000,
    category: "clothing",
    description: "Vêtements fictifs pour la démonstration",
    items: [],
    budgetIsStrict: false,
    deadlineIsStrict: false,
    receiverName: "Destinataire fictif",
    receiverPhone: "+22500000000",
  });
  await requestBooking(db, sender, { requestId: request.id, offerId: offerA.id, message: "Message fictif de démonstration" });

  console.log("Données de démonstration créées (toutes marquées is_demo).");
  console.log(`Comptes (mot de passe unique, affiché une seule fois) : ${password}`);
  for (const l of ["voyageur1", "voyageur2", "expediteur", "operateur"]) console.log(`  ${l}@${DEMO_DOMAIN}`);
  console.log("Les offres démo n'apparaissent dans la recherche qu'avec ?demo=1 (jamais mélangées aux données réelles).");
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refus : le seed de démonstration est interdit en production.");
  if (process.argv.includes("--reset")) await resetDemo();
  await seed();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
