import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/password-forms";
import { Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-md">
      <PageTitle title="Mot de passe oublié" subtitle="Nous vous enverrons un lien à usage unique, valable 60 minutes." />
      <Card>
        <ForgotPasswordForm />
      </Card>
    </div>
  );
}
