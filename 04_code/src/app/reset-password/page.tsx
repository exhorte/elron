import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/password-forms";
import { Card, Notice, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Nouveau mot de passe", robots: { index: false }, referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <PageTitle title="Nouveau mot de passe" />
      {token ? (
        <Card>
          <ResetPasswordForm token={token} />
        </Card>
      ) : (
        <div className="space-y-3">
          <Notice tone="warn">Lien incomplet. Refaites une demande de réinitialisation.</Notice>
          <Link href="/forgot-password" className="text-sm underline">
            Mot de passe oublié
          </Link>
        </div>
      )}
    </div>
  );
}
