"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

// Zernio redirects here after the OAuth flow of a social network.
function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const error = params.get("error");
    if (error) toast.error(`No se pudo conectar la cuenta: ${error}`);
    else toast.success(`Cuenta ${params.get("connected") ?? ""} conectada`);
    router.replace("/dashboard/settings#redes");
  }, [params, router]);
  return <p className="p-6 text-muted-foreground">Conectando cuenta…</p>;
}

export default function CallbackPage() {
  return (
    <Suspense>
      <Callback />
    </Suspense>
  );
}
