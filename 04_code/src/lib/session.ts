import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/config/app";
import { getDb } from "@/db/client";
import type { Actor } from "@/server/actor";
import { isOperator } from "@/server/actor";
import { getActorBySessionToken } from "@/server/auth";

/** Utilisateur courant pour les pages serveur (null si non connecté). */
export async function getCurrentActor(): Promise<Actor | null> {
  const store = await cookies();
  return getActorBySessionToken(getDb(), store.get(SESSION_COOKIE)?.value, new Date());
}

export async function requireActorPage(nextPath: string): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return actor;
}

export async function requireOperatorPage(nextPath: string): Promise<Actor> {
  const actor = await requireActorPage(nextPath);
  if (!isOperator(actor)) redirect("/dashboard");
  return actor;
}
