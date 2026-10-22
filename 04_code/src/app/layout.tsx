import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";
import { getCurrentActor } from "@/lib/session";
import { isOperator } from "@/server/actor";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ALX — African Logistics Exchange (prototype)", template: "%s · ALX" },
  description:
    "Prototype de marketplace d'expédition : trouvez, comparez et réservez de la capacité de transport (voyageurs, agences) et suivez votre colis.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export const dynamic = "force-dynamic";

const navLink = "rounded-md px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const actor = await getCurrentActor();
  return (
    <html lang="fr">
      <body>
        <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2">
            <Link href="/" className="mr-2 text-lg font-bold tracking-tight text-emerald-800 dark:text-emerald-400">
              ALX
            </Link>
            <nav aria-label="Navigation principale" className="flex flex-1 flex-wrap items-center gap-x-1">
              <Link href="/search" className={navLink}>
                Rechercher
              </Link>
              <Link href="/trips/new" className={navLink}>
                Publier un trajet
              </Link>
              <Link href="/requests/new" className={navLink}>
                Envoyer un colis
              </Link>
              <Link href="/track" className={navLink}>
                Suivre un colis
              </Link>
              {actor ? (
                <Link href="/dashboard" className={navLink}>
                  Mon espace
                </Link>
              ) : null}
              {actor && isOperator(actor) ? (
                <Link href="/admin" className={navLink}>
                  Administration
                </Link>
              ) : null}
            </nav>
            <div className="flex items-center gap-1">
              {actor ? (
                <>
                  <Link href="/profile" className="max-w-40 truncate text-sm text-slate-700 hover:underline dark:text-slate-200">
                    {actor.displayName}
                  </Link>
                  <LogoutButton />
                </>
              ) : (
                <>
                  <Link href="/login" className={navLink}>
                    Connexion
                  </Link>
                  <Link href="/register" className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800">
                    Créer un compte
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 pt-4 text-xs text-slate-500 dark:text-slate-400">
          <p>
            Prototype en développement. Aucun paiement n&apos;est géré par la plateforme : le règlement se fait directement entre les parties. La
            politique de marchandises est interne et n&apos;a pas été validée juridiquement.{" "}
            <Link href="/about" className="underline">
              Limites et conformité
            </Link>
          </p>
        </footer>
      </body>
    </html>
  );
}
