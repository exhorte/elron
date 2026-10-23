"use client";

import Link from "next/link";
import { useState } from "react";
import { api, describeError } from "./api-client";
import { Field, Notice, btnPrimary, inputCls } from "./ui";

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ deliveryConfigured: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  if (done) {
    return (
      <div className="space-y-3">
        <Notice tone={done.deliveryConfigured ? "ok" : "warn"}>
          {done.deliveryConfigured
            ? "Si un compte existe pour cette adresse, un e-mail contenant un lien valable 60 minutes vient d'être envoyé."
            : "L'envoi d'e-mails n'est pas encore configuré sur cette instance : aucun message ne sera reçu. Contactez un opérateur de la plateforme pour récupérer l'accès à votre compte."}
        </Notice>
        <Link href="/login" className="text-sm underline">
          Retour à la connexion
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setPending(true);
        const f = new FormData(e.currentTarget);
        const res = await api<{ deliveryConfigured: boolean }>("/api/v1/auth/forgot-password", "POST", { email: String(f.get("email") ?? "") });
        setPending(false);
        if (!res.ok) return setError(describeError(res.error));
        setDone({ deliveryConfigured: res.data.deliveryConfigured });
      }}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field label="Adresse e-mail de votre compte" htmlFor="email">
        <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" className={inputCls} />
      </Field>
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        {pending ? "Envoi…" : "Recevoir un lien de réinitialisation"}
      </button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  if (done) {
    return (
      <div className="space-y-3">
        <Notice tone="ok">Mot de passe modifié. Toutes vos sessions ont été fermées : connectez-vous avec le nouveau mot de passe.</Notice>
        <Link href="/login" className={btnPrimary}>
          Se connecter
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const f = new FormData(e.currentTarget);
        const password = String(f.get("password") ?? "");
        if (password !== String(f.get("confirm") ?? "")) return setError("Les deux mots de passe ne correspondent pas.");
        setPending(true);
        const res = await api("/api/v1/auth/reset-password", "POST", { token, password });
        setPending(false);
        if (!res.ok) return setError(res.error.code === "invalid_reset_token" ? res.error.message : describeError(res.error));
        setDone(true);
      }}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field label="Nouveau mot de passe" htmlFor="password" hint="10 caractères minimum.">
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className={inputCls} />
      </Field>
      <Field label="Confirmer le mot de passe" htmlFor="confirm">
        <input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className={inputCls} />
      </Field>
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        {pending ? "Enregistrement…" : "Enregistrer le nouveau mot de passe"}
      </button>
    </form>
  );
}
