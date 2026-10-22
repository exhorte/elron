import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { listAllShipments, listPendingIdentityReviews, reviewIdentity, setUserStatus, upsertTravelerProfile } from "@/server/admin";
import { searchOffers } from "@/server/search";
import { searchQuerySchema } from "@/server/validation";
import { ABJ, DKR, db, errorCode, makeAcceptedShipment, makeOffer, makeUser, resetDb } from "../helpers";

beforeEach(resetDb);

const declare = (actor: Parameters<typeof upsertTravelerProfile>[1]) =>
  upsertTravelerProfile(db(), actor, { declaredLegalName: "Moussa Diallo", declaredIdKind: "passport" });

describe("statut d'identité : déclaré ≠ vérifié ≠ décision opérateur", () => {
  it("déclarer une identité ne la vérifie pas", async () => {
    const user = await makeUser();
    const profile = await declare(user);
    expect(profile.identityStatus).toBe("declared");
    expect(profile.identityReviewedBy).toBeNull();
    expect(profile.identityReviewedAt).toBeNull();
    // aucun numéro ni fichier d'identité n'est stocké : seulement le nom déclaré et le type de pièce
    expect(Object.keys(profile).some((k) => /number|file|scan|document|photo/i.test(k))).toBe(false);
  });

  it("seul un opérateur peut vérifier ; le résultat est tracé (qui, quand, audit)", async () => {
    const traveler = await makeUser({ traveler: true });
    const plain = await makeUser();
    const operator = await makeUser({ role: "operator" });
    await declare(traveler);
    expect(await errorCode(reviewIdentity(db(), plain, traveler.id, "verified", null))).toBe("operator_required");
    expect(await errorCode(listPendingIdentityReviews(db(), plain))).toBe("operator_required");
    expect((await listPendingIdentityReviews(db(), operator)).map((p) => p.userId)).toEqual([traveler.id]);

    await reviewIdentity(db(), operator, traveler.id, "verified", "Pièce contrôlée en visio");
    const [profile] = await db().select().from(schema.travelerProfiles).where(eq(schema.travelerProfiles.userId, traveler.id));
    expect(profile).toMatchObject({ identityStatus: "verified", identityReviewedBy: operator.id, identityReviewNote: "Pièce contrôlée en visio" });
    expect(profile!.identityReviewedAt).toBeInstanceOf(Date);
    expect(await listPendingIdentityReviews(db(), operator)).toHaveLength(0);

    const [log] = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "identity.reviewed"));
    expect(log).toMatchObject({ actorUserId: operator.id, entityId: traveler.id });
  });

  it("refuse l'auto-validation, la revue sans déclaration et la double revue", async () => {
    const operator = await makeUser({ role: "operator", traveler: true });
    const other = await makeUser({ role: "operator" });
    await declare(operator);
    expect(await errorCode(reviewIdentity(db(), operator, operator.id, "verified", null))).toBe("self_review");
    const undeclared = await makeUser({ traveler: true });
    expect(await errorCode(reviewIdentity(db(), other, undeclared.id, "verified", null))).toBe("identity_not_declared");
    await reviewIdentity(db(), other, operator.id, "verified", null);
    expect(await errorCode(reviewIdentity(db(), other, operator.id, "verified", null))).toBe("identity_not_declared");
  });

  it("la base refuse « verified » sans relecteur", async () => {
    const traveler = await makeUser({ traveler: true });
    await expect(
      db().update(schema.travelerProfiles).set({ identityStatus: "verified" }).where(eq(schema.travelerProfiles.userId, traveler.id)),
    ).rejects.toThrow();
  });

  it("verrouille le nom d'une identité vérifiée ; un refus permet de redéclarer", async () => {
    const traveler = await makeUser({ traveler: true });
    const operator = await makeUser({ role: "operator" });
    await declare(traveler);
    await reviewIdentity(db(), operator, traveler.id, "verified", null);
    expect(await errorCode(upsertTravelerProfile(db(), traveler, { declaredLegalName: "Autre Nom", declaredIdKind: "passport" }))).toBe("identity_locked");
    const same = await declare(traveler);
    expect(same.identityStatus).toBe("verified"); // inchangé

    const second = await makeUser({ traveler: true });
    await declare(second);
    await reviewIdentity(db(), operator, second.id, "rejected", "Pièce illisible");
    const again = await upsertTravelerProfile(db(), second, { declaredLegalName: "Nom Corrigé", declaredIdKind: "national_id" });
    expect(again.identityStatus).toBe("declared");
    expect(again.identityReviewedBy).toBeNull();
  });

  it("affiche le badge vérifié dans la recherche uniquement après décision d'un opérateur", async () => {
    const provider = await makeUser({ traveler: true });
    const operator = await makeUser({ role: "operator" });
    await makeOffer(provider);
    const q = searchQuerySchema.parse({ origin: DKR, destination: ABJ, weightKg: "5" });
    expect((await searchOffers(db(), null, q)).results[0]!.offer.provider.identityStatus).toBe("not_provided");
    await declare(provider);
    expect((await searchOffers(db(), null, q)).results[0]!.offer.provider.identityStatus).toBe("declared");
    await reviewIdentity(db(), operator, provider.id, "verified", null);
    const res = await searchOffers(db(), null, q);
    expect(res.results[0]!.offer.provider.identityStatus).toBe("verified");
    expect(res.results[0]!.match.flags).not.toContain("identity_unverified");
  });

  it("crée le profil voyageur à la demande sans le vérifier", async () => {
    const user = await makeUser();
    const profile = await upsertTravelerProfile(db(), user, { bio: "Je voyage chaque mois" });
    expect(profile.identityStatus).toBe("not_provided");
    expect(profile.bio).toBe("Je voyage chaque mois");
    const updated = await upsertTravelerProfile(db(), user, { bio: "Mise à jour" });
    expect(updated.bio).toBe("Mise à jour");
  });
});

describe("administration", () => {
  it("seuls les administrateurs suspendent ; pas soi-même ; raison tracée", async () => {
    const admin = await makeUser({ role: "admin" });
    const operator = await makeUser({ role: "operator" });
    const user = await makeUser();
    expect(await errorCode(setUserStatus(db(), operator, user.id, "suspended", "raison valable"))).toBe("admin_required");
    expect(await errorCode(setUserStatus(db(), user, user.id, "suspended", "raison valable"))).toBe("admin_required");
    expect(await errorCode(setUserStatus(db(), admin, admin.id, "suspended", "raison valable"))).toBe("self_suspend");
    expect(await errorCode(setUserStatus(db(), admin, "00000000-0000-4000-8000-000000000000", "suspended", "raison valable"))).toBe("not_found");
    await setUserStatus(db(), admin, user.id, "suspended", "Fraude suspectée");
    const [row] = await db().select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(row!.status).toBe("suspended");
    const [log] = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "user.status_changed"));
    expect(log!.data).toMatchObject({ status: "suspended", reason: "Fraude suspectée" });
    await setUserStatus(db(), admin, user.id, "active", "Levée après vérification");
    const [after] = await db().select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(after!.status).toBe("active");
  });

  it("la liste globale des colis est réservée aux opérateurs", async () => {
    await makeAcceptedShipment();
    const operator = await makeUser({ role: "operator" });
    expect(await errorCode(listAllShipments(db(), await makeUser()))).toBe("operator_required");
    const all = await listAllShipments(db(), operator);
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("ACCEPTED");
    expect(JSON.stringify(all)).not.toContain("Awa");
  });
});
