"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError } from "./api-client";
import { Field, Notice, btnPrimary, inputCls } from "./ui";

/** Ne redirige que vers un chemin interne (évite les redirections ouvertes). */
export function safeNext(next: string | undefined | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/dashboard";
}

export function AuthForm({ mode, next }: { mode: "login" | "register"; next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setPending(true);
        const f = new FormData(e.currentTarget);
        const body =
          mode === "login"
            ? { email: String(f.get("email") ?? ""), password: String(f.get("password") ?? "") }
            : {
                email: String(f.get("email") ?? ""),
                password: String(f.get("password") ?? ""),
                displayName: String(f.get("displayName") ?? ""),
                ...(String(f.get("phone") ?? "").trim() ? { phone: String(f.get("phone")) } : {}),
                asTraveler: f.get("asTraveler") === "on",
              };
        const res = await api(mode === "login" ? "/api/v1/auth/login" : "/api/v1/auth/register", "POST", body);
        setPending(false);
        if (!res.ok) return setError(describeError(res.error));
        router.push(safeNext(next));
        router.refresh();
      }}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {mode === "register" ? (
        <Field label="Nom affiché" htmlFor="displayName" hint="Visible des autres utilisateurs.">
          <input id="displayName" name="displayName" required minLength={2} maxLength={80} autoComplete="name" className={inputCls} />
        </Field>
      ) : null}
      <Field label="Adresse e-mail" htmlFor="email">
        <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" className={inputCls} />
      </Field>
      <Field label="Mot de passe" htmlFor="password" hint={mode === "register" ? "10 caractères minimum." : undefined}>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={mode === "register" ? 10 : 1}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          className={inputCls}
        />
      </Field>
      {mode === "register" ? (
        <>
          <Field label="Téléphone (facultatif)" htmlFor="phone" hint="Sera vérifié dans une version ultérieure ; non vérifié aujourd'hui.">
            <input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" className={inputCls} />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="asTraveler" className="mt-1 size-5" />
            <span>
              Je voyage ou je transporte des colis : créer aussi mon profil voyageur/transporteur.
              <span className="block text-xs text-slate-500">Vous pouvez toujours envoyer des colis, avec ou sans ce profil.</span>
            </span>
          </label>
        </>
      ) : null}
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        {pending ? "Patientez…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
      </button>
    </form>
  );
}
