import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <PageTitle title="Connexion" />
      <Card>
        <AuthForm mode="login" next={next} />
      </Card>
      <p className="mt-4 text-sm">
        Pas encore de compte ?{" "}
        <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-emerald-800 underline dark:text-emerald-400">
          Créer un compte
        </Link>
      </p>
    </div>
  );
}
