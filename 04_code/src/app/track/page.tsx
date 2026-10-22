import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, PageTitle, btnPrimary, inputCls, Field } from "@/components/ui";
import { TRACKING_CODE_PATTERN } from "@/domain/ids";

export const metadata: Metadata = { title: "Suivre un colis" };

async function search(formData: FormData) {
  "use server";
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  redirect(TRACKING_CODE_PATTERN.test(code) ? `/track/${code}` : `/track?invalid=1`);
}

export default async function TrackPage({ searchParams }: { searchParams: Promise<{ invalid?: string }> }) {
  const { invalid } = await searchParams;
  return (
    <div className="mx-auto max-w-md space-y-4">
      <PageTitle title="Suivre un colis" subtitle="Saisissez le code de suivi (ALX-XXXXXXXX). Aucun compte nécessaire." />
      <Card>
        <form action={search} className="space-y-3">
          <Field label="Code de suivi" htmlFor="code" hint={invalid ? "Format invalide : ALX- suivi de 8 caractères." : undefined}>
            <input id="code" name="code" required placeholder="ALX-ABCD2345" autoCapitalize="characters" autoComplete="off" className={`${inputCls} font-mono uppercase`} />
          </Field>
          <button type="submit" className={`${btnPrimary} w-full`}>
            Suivre
          </button>
        </form>
      </Card>
    </div>
  );
}
