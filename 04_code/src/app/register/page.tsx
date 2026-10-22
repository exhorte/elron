import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Créer un compte" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <PageTitle title="Créer un compte" subtitle="Un seul compte pour envoyer des colis et, si vous le souhaitez, en transporter." />
      <Card>
        <AuthForm mode="register" next={next} />
      </Card>
      <p className="mt-4 text-sm">
        Déjà inscrit ?{" "}
        <Link href="/login" className="font-medium text-emerald-800 underline dark:text-emerald-400">
          Se connecter
        </Link>
      </p>
    </div>
  );
}
