"use client";

import { ERROR_MESSAGES } from "@/lib/format";

export interface ApiFailure {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

/** Appel JSON vers /api/v1 (cookie de session inclus automatiquement, même origine). */
export async function api<T = unknown>(path: string, method: "GET" | "POST" | "PUT", body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as { data?: T; error?: ApiFailure } | null;
    if (res.ok && json && "data" in json) return { ok: true, data: json.data as T };
    return { ok: false, error: json?.error ?? { code: "network", message: "Réponse inattendue du serveur" } };
  } catch {
    return { ok: false, error: { code: "network", message: "Connexion impossible. Vérifiez votre réseau." } };
  }
}

/** Message utilisateur pour une erreur d'API (détail des champs invalides inclus). */
export function describeError(error: ApiFailure): string {
  if (error.code === "validation_error" && Array.isArray(error.details)) {
    return (error.details as Array<{ path: string; message: string }>)
      .map((d) => (d.path ? `${d.path} : ${d.message}` : d.message))
      .join(" · ");
  }
  if (error.code === "offer_incompatible" && error.details && typeof error.details === "object" && "reasons" in error.details) {
    return `${ERROR_MESSAGES.offer_incompatible} (${(error.details as { reasons: string[] }).reasons.join(", ")})`;
  }
  if (error.code === "delivery_code_invalid" && error.details && typeof error.details === "object" && "attemptsLeft" in error.details) {
    return `${ERROR_MESSAGES.delivery_code_invalid} Tentatives restantes : ${(error.details as { attemptsLeft: number }).attemptsLeft}.`;
  }
  return ERROR_MESSAGES[error.code] ?? error.message;
}
