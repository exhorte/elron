"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError } from "./api-client";
import { Field, Notice, btnPrimary, inputCls } from "./ui";

export function TravelerProfileForm({
  initial,
  submitLabel = "Enregistrer",
}: {
  initial?: { bio: string | null; declaredLegalName: string | null; declaredIdKind: string | null; identityStatus: string } | null;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const locked = initial?.identityStatus === "verified";

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setSaved(false);
        const f = new FormData(e.currentTarget);
        const body: Record<string, unknown> = { bio: String(f.get("bio") ?? "").trim() || null };
        const name = String(f.get("declaredLegalName") ?? "").trim();
        const kind = String(f.get("declaredIdKind") ?? "");
        if (name || kind) {
          if (!name || !kind) return setError("Indiquez le nom ET le type de pièce, ou aucun des deux.");
          body.declaredLegalName = name;
          body.declaredIdKind = kind;
        }
        setPending(true);
        const res = await api("/api/v1/me/traveler-profile", "PUT", body);
        setPending(false);
        if (!res.ok) return setError(describeError(res.error));
        setSaved(true);
        router.refresh();
      }}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {saved ? <Notice tone="ok">Profil enregistré.</Notice> : null}
      <Field label="Présentation (facultatif)" htmlFor="bio" hint="Ex. : vous voyagez chaque mois entre les deux villes.">
        <textarea id="bio" name="bio" rows={3} maxLength={500} defaultValue={initial?.bio ?? ""} className={inputCls} />
      </Field>
      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={locked}>
        <legend className="mb-1 text-sm font-semibold">Identité déclarée</legend>
        <Field label="Nom complet tel qu'il figure sur votre pièce" htmlFor="declaredLegalName">
          <input id="declaredLegalName" name="declaredLegalName" defaultValue={initial?.declaredLegalName ?? ""} className={inputCls} />
        </Field>
        <Field label="Type de pièce" htmlFor="declaredIdKind">
          <select id="declaredIdKind" name="declaredIdKind" defaultValue={initial?.declaredIdKind ?? ""} className={inputCls}>
            <option value="">—</option>
            <option value="national_id">Carte nationale d&apos;identité</option>
            <option value="passport">Passeport</option>
            <option value="residence_permit">Titre de séjour</option>
          </select>
        </Field>
      </fieldset>
      <p className="text-xs text-slate-500">
        Aucune pièce d&apos;identité n&apos;est téléversée ni stockée. Déclarer une identité ne la fait <strong>pas</strong> passer en « vérifiée » : seule la
        décision d&apos;un opérateur, après contrôle hors plateforme, ajoute le badge.
      </p>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Enregistrement…" : submitLabel}
      </button>
    </form>
  );
}
