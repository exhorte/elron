"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api-client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      onClick={async () => {
        setPending(true);
        await api("/api/v1/auth/logout", "POST");
        router.push("/");
        router.refresh();
      }}
    >
      Déconnexion
    </button>
  );
}
