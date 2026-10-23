import { ZodError, type ZodType } from "zod";
import { SESSION_COOKIE, isProduction } from "@/config/app";
import { getDb, type Db } from "@/db/client";
import type { Actor } from "./actor";
import { isOperator } from "./actor";
import { getActorBySessionToken } from "./auth";
import { AppError, forbidden, unauthorized } from "./errors";

/**
 * Enveloppe commune des endpoints /api/v1 : authentification, contrôle d'origine (CSRF), validation
 * JSON, conversion des erreurs en réponses stables `{ error: { code, message, details? } }`.
 * Les réponses de succès sont `{ data }`.
 */

export type AuthLevel = "none" | "optional" | "user" | "operator" | "admin";

export interface HandlerContext<P> {
  req: Request;
  db: Db;
  actor: Actor | null;
  params: P;
  now: Date;
  /** IP client « de confiance » (voir `clientIp`), ou « unknown ». */
  ip: string;
  /** Lit et valide le corps JSON avec un schéma zod strict. */
  body: <T>(schema: ZodType<T>) => Promise<T>;
  /** Valide les paramètres de requête. */
  query: <T>(schema: ZodType<T>) => T;
}

export class HttpResult {
  constructor(
    readonly data: unknown,
    readonly status = 200,
    readonly headers: Record<string, string> = {},
  ) {}
}

const MAX_BODY_BYTES = 100_000;

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string, expiresAt: Date): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProduction() ? "; Secure" : ""}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProduction() ? "; Secure" : ""}`;
}

export function sessionTokenFrom(req: Request): string | undefined {
  return parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
}

/**
 * IP du client pour la limitation de débit. `X-Forwarded-For` est falsifiable par le client : on ne s'y
 * fie que derrière N proxys de confiance (`TRUSTED_PROXY_HOPS`, 0 par défaut) et on prend l'entrée que le
 * N-ième proxy a ajoutée en partant de la droite. Sans proxy de confiance : « unknown » (compteur commun,
 * acceptable en développement ; à configurer en production).
 */
export function clientIp(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  const hops = Number(env.TRUSTED_PROXY_HOPS ?? 0);
  if (!Number.isInteger(hops) || hops <= 0) return "unknown";
  const parts = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidate = parts.length >= hops ? parts[parts.length - hops] : undefined;
  return candidate && candidate.length <= 45 && /^[0-9a-fA-F:.]+$/.test(candidate) ? candidate : "unknown";
}

/** Défense CSRF en profondeur (en plus de SameSite=Lax) : une requête navigateur d'une autre origine est refusée. */
function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return; // clients non navigateur (curl, tests) : pas de CSRF possible sans cookie ambiant
  const expected = new URL(req.url).origin;
  const host = req.headers.get("host");
  const allowed = origin === expected || (host !== null && (origin === `http://${host}` || origin === `https://${host}`));
  if (!allowed) throw forbidden("bad_origin", "Origine de la requête non autorisée");
}

async function readJsonBody(req: Request): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new AppError(415, "unsupported_media_type", "Content-Type application/json requis");
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError(413, "payload_too_large", "Corps de requête trop volumineux");
  try {
    return text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new AppError(400, "invalid_json", "JSON invalide");
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return json({ error: { code: "validation_error", message: "Données invalides", details: issues } }, 422);
  }
  if (err instanceof AppError) {
    return json(
      { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } },
      err.status,
      err.headers ?? {},
    );
  }
  console.error("[api] erreur non gérée", err);
  return json({ error: { code: "internal_error", message: "Erreur interne" } }, 500);
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function route<P = Record<string, never>>(
  options: { auth: AuthLevel; mutation?: boolean },
  handler: (ctx: HandlerContext<P>) => Promise<unknown>,
) {
  return async (req: Request, routeCtx?: { params: Promise<P> }): Promise<Response> => {
    try {
      if (options.mutation) assertSameOrigin(req);
      const db = getDb();
      const now = new Date();
      const actor = options.auth === "none" ? null : await getActorBySessionToken(db, sessionTokenFrom(req), now);
      if (options.auth !== "none" && options.auth !== "optional") {
        if (!actor) throw unauthorized();
        if (options.auth === "operator" && !isOperator(actor)) throw forbidden("operator_required", "Réservé aux opérateurs");
        if (options.auth === "admin" && actor.platformRole !== "admin") throw forbidden("admin_required", "Réservé aux administrateurs");
      }
      const params = (routeCtx ? await routeCtx.params : {}) as P;
      const result = await handler({
        req,
        db,
        actor,
        params,
        now,
        ip: clientIp(req),
        body: async (schema) => schema.parse(await readJsonBody(req)),
        query: (schema) => schema.parse(Object.fromEntries(new URL(req.url).searchParams.entries())),
      });
      if (result instanceof HttpResult) return json({ data: result.data }, result.status, result.headers);
      return json({ data: result ?? null }, 200);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function requireActor(actor: Actor | null): Actor {
  if (!actor) throw unauthorized();
  return actor;
}
