import { MAX_FEE_BPS } from "@/domain/money";

const DEV_PEPPER = "dev-only-pepper-not-a-secret-change-me-in-prod";

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

/** Secret HMAC des codes de remise. Obligatoire (>= 32 caractères) en production. */
export function getDeliveryCodePepper(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DELIVERY_CODE_PEPPER;
  if (isProduction(env)) {
    if (!value || value.length < 32) {
      throw new Error("DELIVERY_CODE_PEPPER (>= 32 caractères) est obligatoire en production");
    }
    return value;
  }
  return value && value.length > 0 ? value : DEV_PEPPER;
}

export function getPlatformFeeBps(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PLATFORM_FEE_BPS;
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > MAX_FEE_BPS) {
    throw new Error(`PLATFORM_FEE_BPS invalide : ${raw}`);
  }
  return value;
}

export function showDemoByDefault(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALX_SHOW_DEMO === "true";
}

export const SESSION_COOKIE = "alx_session";
export const SESSION_TTL_DAYS = 14;
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;
