"use client";

import { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail, signOut, updatePassword } from "firebase/auth";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { KeyRound, LogOut } from "lucide-react";
import { auth } from "@/lib/firebase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const AUTH_ERRORS: Record<string, string> = {
  "auth/wrong-password": "La contraseña actual no es correcta",
  "auth/invalid-credential": "La contraseña actual no es correcta",
  "auth/weak-password": "La nueva contraseña es muy débil (mínimo 6 caracteres)",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos.",
  "auth/requires-recent-login": "Vuelve a iniciar sesión e inténtalo de nuevo",
};
const authError = (e: unknown) => AUTH_ERRORS[(e as { code?: string }).code ?? ""] ?? (e as Error).message;

/** Ajustes → Perfil → Acceso: access data (email, password), appearance and sign-out. */
export function UserCard() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const providers = user?.providerData.map((p) => p.providerId) ?? [];
  const hasPassword = providers.includes("password");

  async function changePassword() {
    if (!user?.email) return;
    if (next.length < 8) return toast.error("La nueva contraseña debe tener al menos 8 caracteres");
    if (next !== repeat) return toast.error("Las contraseñas no coinciden");
    setBusy(true);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
      await updatePassword(user, next);
      setCurrent("");
      setNext("");
      setRepeat("");
      toast.success("Contraseña actualizada");
    } catch (e) {
      toast.error(authError(e));
    } finally {
      setBusy(false);
    }
  }

  async function resetByEmail() {
    if (!user?.email) return;
    try {
      await sendPasswordResetEmail(auth, user.email);
      toast.success(`Te enviamos un enlace a ${user.email}`);
    } catch (e) {
      toast.error(authError(e));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Acceso</CardTitle>
        <CardDescription>Email, contraseña y apariencia.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <section className="space-y-1">
          <p>
            <span className="text-muted-foreground">Email:</span> {user?.email}
          </p>
          <p>
            <span className="text-muted-foreground">Acceso con:</span>{" "}
            {providers.map((p) => (p === "password" ? "email y contraseña" : p === "google.com" ? "Google" : p)).join(", ") || "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Zona horaria del navegador:</span> {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="flex items-center gap-1.5 font-semibold">
            <KeyRound className="size-4" /> Contraseña
          </h3>
          {hasPassword ? (
            <div className="grid max-w-md gap-3">
              <div className="space-y-1">
                <Label htmlFor="us-cur">Contraseña actual</Label>
                <Input id="us-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="us-new">Nueva contraseña</Label>
                <Input id="us-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="us-rep">Repite la nueva contraseña</Label>
                <Input id="us-rep" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || !current || !next} onClick={changePassword}>
                  {busy ? "Cambiando…" : "Cambiar contraseña"}
                </Button>
                <Button variant="ghost" onClick={resetByEmail}>
                  Olvidé mi contraseña
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Entras con Google: la contraseña se gestiona en tu cuenta de Google.</p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold">Apariencia</h3>
          <div className="flex gap-2">
            {(["light", "dark", "system"] as const).map((t) => (
              <Button key={t} size="sm" variant={theme === t ? "secondary" : "outline"} onClick={() => setTheme(t)}>
                {t === "light" ? "Claro" : t === "dark" ? "Oscuro" : "Sistema"}
              </Button>
            ))}
          </div>
        </section>

        <Button variant="outline" onClick={() => signOut(auth)}>
          <LogOut /> Cerrar sesión
        </Button>
      </CardContent>
    </Card>
  );
}
