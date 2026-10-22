import { beforeEach, describe, expect, it } from "vitest";
import { POST as acceptRoute } from "@/app/api/v1/bookings/[id]/accept/route";
import { GET as bookingsGet, POST as bookingsPost } from "@/app/api/v1/bookings/route";
import { POST as confirmRoute } from "@/app/api/v1/shipments/[id]/confirm-delivery/route";
import { POST as deliveryCodeRoute } from "@/app/api/v1/shipments/[id]/delivery-code/route";
import { GET as shipmentGet } from "@/app/api/v1/shipments/[id]/route";
import { POST as transitionRoute } from "@/app/api/v1/shipments/[id]/transitions/route";
import { GET as shipmentsGet } from "@/app/api/v1/shipments/route";
import { GET as healthGet } from "@/app/api/v1/health/route";
import { GET as metaGet } from "@/app/api/v1/meta/route";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { POST as logoutRoute } from "@/app/api/v1/auth/logout/route";
import { POST as registerRoute } from "@/app/api/v1/auth/register/route";
import { GET as meGet } from "@/app/api/v1/me/route";
import { PUT as travelerProfilePut } from "@/app/api/v1/me/traveler-profile/route";
import { GET as offerGet } from "@/app/api/v1/offers/[id]/route";
import { GET as offersGet, POST as offersPost } from "@/app/api/v1/offers/route";
import { GET as matchesGet } from "@/app/api/v1/requests/[id]/matches/route";
import { GET as requestGet } from "@/app/api/v1/requests/[id]/route";
import { POST as requestsPost } from "@/app/api/v1/requests/route";
import { GET as searchGet } from "@/app/api/v1/search/offers/route";
import { GET as trackGet } from "@/app/api/v1/track/[code]/route";
import { GET as bookingGet } from "@/app/api/v1/bookings/[id]/route";
import { OPERATIONS, buildOpenApi } from "@/server/openapi";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ABJ, DAY, DKR, makeUser, resetDb } from "../helpers";
import { call, cookieFrom } from "./http-helpers";

beforeEach(resetDb);

const PASSWORD = "correct-horse-battery";
const UUID = "6f1c2f0e-3d62-4b8e-9d0a-0a2c8b1d5e11";

async function registerVia(email: string, extra: Record<string, unknown> = {}) {
  const res = await call(registerRoute, {
    method: "POST",
    path: "/api/v1/auth/register",
    body: { email, password: PASSWORD, displayName: email.split("@")[0], ...extra },
  });
  return { res, cookie: cookieFrom(res) };
}

async function loginVia(email: string) {
  const res = await call(loginRoute, { method: "POST", path: "/api/v1/auth/login", body: { email, password: PASSWORD } });
  return cookieFrom(res);
}

const offerBody = (o: Record<string, unknown> = {}) => ({
  originCityId: DKR,
  destinationCityId: ABJ,
  transportMode: "air",
  departureAt: new Date(Date.now() + 3 * DAY).toISOString(),
  arrivalEstimatedAt: new Date(Date.now() + 4 * DAY).toISOString(),
  depositCutoffAt: new Date(Date.now() + 2 * DAY).toISOString(),
  capacityWeightG: 20_000,
  pricePerKgMinor: 3500,
  currency: "XOF",
  acceptedCategories: ["clothing", "books_misc"],
  depositAddress: "Point de dépôt de test",
  ...o,
});

const requestBody = (o: Record<string, unknown> = {}) => ({
  originCityId: DKR,
  destinationCityId: ABJ,
  weightG: 5000,
  category: "clothing",
  description: "Vêtements pour la famille",
  receiverName: "Awa Koné",
  receiverPhone: "+225 07 00 00 00",
  ...o,
});

describe("authentification HTTP", () => {
  it("inscrit, pose un cookie de session HttpOnly/SameSite=Lax et ne renvoie jamais de secret", async () => {
    const { res, cookie } = await registerVia("fatou@example.test");
    expect(res.status).toBe(201);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\//);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.text).not.toMatch(/password|hash/i);

    const me = await call(meGet, { path: "/api/v1/me", cookie });
    expect(me.status).toBe(200);
    expect(me.json.data.user.email).toBe("fatou@example.test");
    expect(me.json.data.user.platformRole).toBe("user");
    expect(me.json.data.travelerProfile).toBeNull();
    expect(me.text).not.toMatch(/password|hash|token/i);
  });

  it("répond 401 sans session ou avec une session forgée", async () => {
    expect((await call(meGet, { path: "/api/v1/me" })).status).toBe(401);
    expect((await call(meGet, { path: "/api/v1/me", cookie: "alx_session=jeton-forge-qui-nexiste-pas-du-tout" })).status).toBe(401);
  });

  it("refuse un e-mail déjà pris (409) et de mauvais identifiants (401)", async () => {
    await registerVia("dup@example.test");
    const again = await registerVia("dup@example.test");
    expect(again.res.status).toBe(409);
    expect(again.res.json.error.code).toBe("email_taken");
    const bad = await call(loginRoute, { method: "POST", path: "/api/v1/auth/login", body: { email: "dup@example.test", password: "faux-faux-faux" } });
    expect(bad.status).toBe(401);
    expect(bad.json.error.code).toBe("invalid_credentials");
  });

  it("verrouille après 5 échecs (429) puis refuse même le bon mot de passe", async () => {
    await registerVia("lock@example.test");
    for (let i = 0; i < 5; i += 1) {
      await call(loginRoute, { method: "POST", path: "/api/v1/auth/login", body: { email: "lock@example.test", password: "faux-faux-faux" } });
    }
    const locked = await call(loginRoute, { method: "POST", path: "/api/v1/auth/login", body: { email: "lock@example.test", password: PASSWORD } });
    expect(locked.status).toBe(429);
    expect(locked.json.error.code).toBe("account_locked");
  });

  it("déconnecte : le cookie est effacé et la session n'est plus valable", async () => {
    const { cookie } = await registerVia("out@example.test");
    const out = await call(logoutRoute, { method: "POST", path: "/api/v1/auth/logout", cookie });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await call(meGet, { path: "/api/v1/me", cookie })).status).toBe(401);
  });
});

describe("validation et protocole", () => {
  it("renvoie 422 avec le détail des champs invalides", async () => {
    const res = await call(registerRoute, { method: "POST", path: "/api/v1/auth/register", body: { email: "pas-un-email", password: "court", displayName: "A" } });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("validation_error");
    const paths = res.json.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["email", "password", "displayName"]));
  });

  it("refuse les champs inconnus (mass-assignment) à l'inscription et à la publication", async () => {
    const reg = await registerVia("mass@example.test", { platformRole: "admin" });
    expect(reg.res.status).toBe(422);
    const { cookie } = await registerVia("prov@example.test", { asTraveler: true });
    const offer = await call(offersPost, { method: "POST", path: "/api/v1/offers", cookie, body: offerBody({ providerUserId: UUID, reservedWeightG: 0, isDemo: true }) });
    expect(offer.status).toBe(422);
  });

  it("répond 400 pour un JSON invalide, 415 pour un mauvais Content-Type", async () => {
    const bad = await call(registerRoute, { method: "POST", path: "/api/v1/auth/register", rawBody: "{pas du json" });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("invalid_json");
    const wrong = await call(registerRoute, { method: "POST", path: "/api/v1/auth/register", rawBody: "a=b", contentType: "text/plain" });
    expect(wrong.status).toBe(415);
  });

  it("refuse une requête d'écriture venant d'une autre origine (CSRF), accepte la même origine", async () => {
    const evil = await call(loginRoute, {
      method: "POST",
      path: "/api/v1/auth/login",
      headers: { origin: "https://evil.example" },
      body: { email: "x@example.test", password: "x" },
    });
    expect(evil.status).toBe(403);
    expect(evil.json.error.code).toBe("bad_origin");
    const same = await call(loginRoute, {
      method: "POST",
      path: "/api/v1/auth/login",
      headers: { origin: "http://localhost" },
      body: { email: "x@example.test", password: "x" },
    });
    expect(same.status).toBe(401); // passe le contrôle d'origine, échoue sur les identifiants
  });

  it("valide les identifiants de ressource et les paramètres de recherche", async () => {
    const { cookie } = await registerVia("valid@example.test");
    const badId = await call(shipmentGet, { path: "/api/v1/shipments/pas-un-uuid", cookie, params: { id: "pas-un-uuid" } });
    expect(badId.status).toBe(422);
    const missing = await call(shipmentGet, { path: `/api/v1/shipments/${UUID}`, cookie, params: { id: UUID } });
    expect(missing.status).toBe(404);
    const badSearch = await call(searchGet, { path: "/api/v1/search/offers?origin=x&destination=y&weightKg=-1" });
    expect(badSearch.status).toBe(422);
    const closed = await call(searchGet, { path: `/api/v1/search/offers?origin=fr-paris&destination=${ABJ}&weightKg=5` });
    expect(closed.status).toBe(422);
    expect(closed.json.error.code).toBe("route_not_enabled");
  });
});

describe("autorisations (sécurité des endpoints)", () => {
  const modules = import.meta.glob("/src/app/api/v1/**/route.ts");
  const moduleFor = (apiPath: string) => modules[`/src/app${apiPath.replace(/\{(\w+)\}/g, "[$1]")}/route.ts`];
  const PARAMS = { id: UUID, code: "ALX-AAAAAAAA" };

  async function invoke(op: (typeof OPERATIONS)[number], cookie?: string) {
    const mod = (await moduleFor(op.path)!()) as Record<string, (req: Request, ctx?: unknown) => Promise<Response>>;
    const handler = mod[op.method.toUpperCase()]!;
    return call(handler as Parameters<typeof call>[0], {
      method: op.method.toUpperCase(),
      path: op.path.replace(/\{(\w+)\}/g, (_, k: string) => PARAMS[k as "id" | "code"]),
      cookie,
      ...(op.method !== "get" ? { body: {} } : {}),
      params: PARAMS,
    });
  }

  const protectedOps = OPERATIONS.filter((o) => o.auth === "user" || o.auth === "operator" || o.auth === "admin");

  it("couvre chaque endpoint protégé (garde-fou : liste non vide)", () => {
    expect(protectedOps.length).toBeGreaterThan(20);
  });

  it.each(protectedOps.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o] as const))("%s répond 401 sans session", async (_name, op) => {
    const res = await invoke(op);
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("unauthorized");
  });

  const operatorOps = OPERATIONS.filter((o) => o.auth === "operator" || o.auth === "admin");
  it.each(operatorOps.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o] as const))("%s répond 403 à un utilisateur simple", async (_name, op) => {
    const user = await makeUser({ email: `plain-${Math.random().toString(36).slice(2)}@example.test` });
    const cookie = await loginVia(user.email);
    const res = await invoke(op, cookie);
    expect(res.status).toBe(403);
  });

  it("réserve la suspension de comptes aux administrateurs (un opérateur reçoit 403)", async () => {
    const operator = await makeUser({ role: "operator", email: "op@example.test" });
    const target = await makeUser();
    const cookie = await loginVia(operator.email);
    const { POST } = await import("@/app/api/v1/admin/users/[id]/status/route");
    const res = await call(POST, { method: "POST", path: `/api/v1/admin/users/${target.id}/status`, cookie, params: { id: target.id }, body: { status: "suspended", reason: "test de suspension" } });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("admin_required");
  });

  it("les endpoints publics fonctionnent sans session et ne fuient aucune donnée personnelle", async () => {
    const health = await call(healthGet, { path: "/api/v1/health" });
    expect(health.status).toBe(200);
    expect(health.json.data.status).toBe("ok");

    const meta = await call(metaGet, { path: "/api/v1/meta" });
    expect(meta.status).toBe(200);
    expect(meta.json.data.routes.map((r: { id: string }) => r.id)).toEqual(["ci-abidjan--sn-dakar", "sn-dakar--ci-abidjan"]);
    expect(meta.json.data.goodsPolicy.validatedLegally).toBe(false);
    expect(meta.json.data.goodsCategories.some((c: { policy: string }) => c.policy === "prohibited")).toBe(true);

    expect((await call(trackGet, { path: "/api/v1/track/ALX-AAAAAAAA", params: { code: "ALX-AAAAAAAA" } })).status).toBe(404);
  });
});

describe("parcours complet par l'API HTTP (MVP)", () => {
  it("compte → profil → offre → demande → recherche → réservation → acceptation → suivi → remise", async () => {
    const provider = await registerVia("moussa@example.test", { asTraveler: true, displayName: "Moussa" });
    const sender = await registerVia("fatou@example.test", { displayName: "Fatou" });
    const stranger = await registerVia("intrus@example.test");
    const transcript: string[] = [];

    // profil voyageur : une déclaration d'identité n'est PAS une vérification
    const profile = await call(travelerProfilePut, {
      method: "PUT",
      path: "/api/v1/me/traveler-profile",
      cookie: provider.cookie,
      body: { declaredLegalName: "Moussa Diallo", declaredIdKind: "passport" },
    });
    expect(profile.json.data.identityStatus).toBe("declared");

    // un expéditeur sans profil voyageur ne peut pas publier d'offre
    const noProfile = await call(offersPost, { method: "POST", path: "/api/v1/offers", cookie: sender.cookie, body: offerBody() });
    expect(noProfile.status).toBe(403);
    expect(noProfile.json.error.code).toBe("traveler_profile_required");

    // publication de l'offre (voyageur)
    const offer = await call(offersPost, { method: "POST", path: "/api/v1/offers", cookie: provider.cookie, body: offerBody() });
    expect(offer.status).toBe(201);
    const offerId = offer.json.data.id as string;
    transcript.push(offer.text);
    expect((await call(offersGet, { path: "/api/v1/offers", cookie: provider.cookie })).json.data).toHaveLength(1);

    // recherche publique, sans compte
    const search = await call(searchGet, { path: `/api/v1/search/offers?origin=${DKR}&destination=${ABJ}&weightKg=5&category=clothing` });
    expect(search.status).toBe(200);
    expect(search.json.data.results).toHaveLength(1);
    expect(search.json.data.results[0].match.totalMinor).toBe(17_500);
    expect(search.json.data.results[0].match.breakdown.price).toBeDefined();
    expect(search.json.data.scoring.validated).toBe(false);
    transcript.push(search.text);
    expect((await call(offerGet, { path: `/api/v1/offers/${offerId}`, params: { id: offerId } })).json.data.hasDepositAddress).toBe(true);

    // demande + correspondances
    const request = await call(requestsPost, { method: "POST", path: "/api/v1/requests", cookie: sender.cookie, body: requestBody() });
    expect(request.status).toBe(201);
    const requestId = request.json.data.id as string;
    const matches = await call(matchesGet, { path: `/api/v1/requests/${requestId}/matches`, cookie: sender.cookie, params: { id: requestId } });
    expect(matches.json.data.results).toHaveLength(1);

    // IDOR : un tiers ne lit ni la demande ni ses correspondances
    expect((await call(requestGet, { path: `/api/v1/requests/${requestId}`, cookie: stranger.cookie, params: { id: requestId } })).status).toBe(403);
    expect((await call(matchesGet, { path: `/api/v1/requests/${requestId}/matches`, cookie: stranger.cookie, params: { id: requestId } })).status).toBe(403);

    // réservation, puis acceptation par le prestataire uniquement
    const booking = await call(bookingsPost, { method: "POST", path: "/api/v1/bookings", cookie: sender.cookie, body: { requestId, offerId, message: "Bonjour" } });
    expect(booking.status).toBe(201);
    expect(booking.json.data).toMatchObject({ status: "requested", subtotalMinor: 17_500, currency: "XOF" });
    const bookingId = booking.json.data.id as string;
    const dup = await call(bookingsPost, { method: "POST", path: "/api/v1/bookings", cookie: sender.cookie, body: { requestId, offerId } });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("booking_already_requested");

    const accessAsStranger = await call(bookingGet, { path: `/api/v1/bookings/${bookingId}`, cookie: stranger.cookie, params: { id: bookingId } });
    expect(accessAsStranger.status).toBe(404);
    const forbiddenAccept = await call(acceptRoute, { method: "POST", path: `/api/v1/bookings/${bookingId}/accept`, cookie: sender.cookie, params: { id: bookingId } });
    expect(forbiddenAccept.status).toBe(403);
    const incoming = await call(bookingsGet, { path: "/api/v1/bookings?as=provider", cookie: provider.cookie });
    expect(incoming.json.data).toHaveLength(1);
    expect(incoming.text).not.toContain("Awa Koné"); // coordonnées du destinataire cachées avant acceptation

    const accepted = await call(acceptRoute, { method: "POST", path: `/api/v1/bookings/${bookingId}/accept`, cookie: provider.cookie, params: { id: bookingId } });
    expect(accepted.status).toBe(200);
    const { shipmentId, trackingCode } = accepted.json.data as { shipmentId: string; trackingCode: string };
    expect(trackingCode).toMatch(/^ALX-/);

    // code de remise : seul l'expéditeur le génère et le voit, une seule fois
    const asProvider = await call(deliveryCodeRoute, { method: "POST", path: `/api/v1/shipments/${shipmentId}/delivery-code`, cookie: provider.cookie, params: { id: shipmentId } });
    expect(asProvider.status).toBe(403);
    const codeRes = await call(deliveryCodeRoute, { method: "POST", path: `/api/v1/shipments/${shipmentId}/delivery-code`, cookie: sender.cookie, params: { id: shipmentId } });
    expect(codeRes.status).toBe(200);
    const code = codeRes.json.data.code as string;
    expect(code).toMatch(/^\d{6}$/);

    // transitions contrôlées
    const step = (to: string, cookie: string, note?: string) =>
      call(transitionRoute, { method: "POST", path: `/api/v1/shipments/${shipmentId}/transitions`, cookie, params: { id: shipmentId }, body: { to, ...(note ? { note } : {}) } });
    expect((await step("HANDED_OVER", sender.cookie)).status).toBe(403);
    expect((await step("IN_TRANSIT", provider.cookie)).status).toBe(409);
    expect((await step("HANDED_OVER", provider.cookie)).json.data.status).toBe("HANDED_OVER");
    expect((await step("IN_TRANSIT", provider.cookie)).json.data.status).toBe("IN_TRANSIT");
    expect((await step("DELIVERED", provider.cookie)).json.error.code).toBe("invalid_transition");
    expect((await step("ARRIVED", provider.cookie)).json.data.status).toBe("ARRIVED");
    expect((await step("DELIVERED", provider.cookie)).json.error.code).toBe("delivery_code_required");

    // le transporteur ne voit jamais le code ; un tiers ne voit pas le colis
    const providerView = await call(shipmentGet, { path: `/api/v1/shipments/${shipmentId}`, cookie: provider.cookie, params: { id: shipmentId } });
    expect(providerView.text).not.toContain(code);
    expect(providerView.json.data.receiver.name).toBe("Awa Koné");
    expect((await call(shipmentGet, { path: `/api/v1/shipments/${shipmentId}`, cookie: stranger.cookie, params: { id: shipmentId } })).status).toBe(404);

    // confirmation de remise : mauvais code puis bon code ; l'expéditeur ne peut pas confirmer lui-même
    const confirm = (c: string, cookie: string) =>
      call(confirmRoute, { method: "POST", path: `/api/v1/shipments/${shipmentId}/confirm-delivery`, cookie, params: { id: shipmentId }, body: { code: c } });
    expect((await confirm(code, sender.cookie)).status).toBe(403);
    const wrong = await confirm(code === "000000" ? "000001" : "000000", provider.cookie);
    expect(wrong.status).toBe(422);
    expect(wrong.json.error).toMatchObject({ code: "delivery_code_invalid", details: { attemptsLeft: 4 } });
    const done = await confirm(code, provider.cookie);
    expect(done.status).toBe(200);
    expect(done.json.data.status).toBe("DELIVERED");
    expect((await confirm(code, provider.cookie)).status).toBe(409); // code à usage unique

    // historique et suivi public
    const mine = await call(shipmentsGet, { path: "/api/v1/shipments", cookie: sender.cookie });
    expect(mine.json.data).toHaveLength(1);
    expect(mine.json.data[0].status).toBe("DELIVERED");
    const track = await call(trackGet, { path: `/api/v1/track/${trackingCode}`, params: { code: trackingCode } });
    expect(track.status).toBe(200);
    expect(track.json.data.events.map((e: { status: string }) => e.status)).toEqual(["ACCEPTED", "HANDED_OVER", "IN_TRANSIT", "ARRIVED", "DELIVERED"]);
    for (const secret of ["Moussa", "Fatou", "Awa", "moussa@", "fatou@", "+2250700"]) expect(track.text).not.toContain(secret);

    // aucune réponse ne contient de secret
    transcript.push(providerView.text, track.text, mine.text);
    for (const t of transcript) expect(t).not.toMatch(/passwordHash|password_hash|tokenHash|deliveryCodeHash/);
  });
});

describe("contrat OpenAPI", () => {
  const routeFiles = Object.keys(import.meta.glob("/src/app/api/v1/**/route.ts"));
  const toTemplate = (file: string) => file.replace(/^\/src\/app/, "").replace(/\/route\.ts$/, "").replace(/\[(\w+)\]/g, "{$1}");

  it("documente exactement les routes de src/app/api/v1", () => {
    const fromFiles = routeFiles.map(toTemplate).sort();
    const fromSpec = [...new Set(OPERATIONS.map((o) => o.path))].sort();
    expect(fromSpec).toEqual(fromFiles);
  });

  it("documente exactement les méthodes exportées par chaque route", async () => {
    const modules = import.meta.glob("/src/app/api/v1/**/route.ts");
    for (const [file, load] of Object.entries(modules)) {
      const mod = (await load()) as Record<string, unknown>;
      const exported = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => typeof mod[m] === "function").sort();
      const documented = OPERATIONS.filter((o) => o.path === toTemplate(file)).map((o) => o.method.toUpperCase()).sort();
      expect(documented, file).toEqual(exported);
    }
  });

  it("docs/openapi.json est à jour (lancer `npm run docs:openapi` sinon)", () => {
    const committed = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../docs/openapi.json"), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApi())));
  });

  it("déclare les schémas stricts des corps de requête", () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, { requestBody?: { content: { "application/json": { schema: { additionalProperties?: boolean } } } } }>> };
    expect(spec.paths["/api/v1/offers"]!.post!.requestBody!.content["application/json"].schema.additionalProperties).toBe(false);
    expect(spec.paths["/api/v1/requests"]!.post!.requestBody!.content["application/json"].schema.additionalProperties).toBe(false);
  });
});
