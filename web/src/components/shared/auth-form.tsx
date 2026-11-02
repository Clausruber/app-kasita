"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { auth } from "@/lib/firebase/client";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { BrandLogo } from "@/components/shared/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  "auth/invalid-credential": "Email o contraseña incorrectos",
  "auth/email-already-in-use": "Ese email ya está registrado: inicia sesión",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres",
  "auth/invalid-email": "Email no válido",
  "auth/popup-closed-by-user": "Se cerró la ventana de Google",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos.",
};

type Mode = "login" | "register";

/** Login and company sign-up in one card, with "Iniciar sesión" / "Crear cuenta" tabs. */
export function AuthForm({ mode: initialMode }: { mode: Mode }) {
  const router = useRouter();
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", whatsapp: "", company: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registering = useRef(false); // hold the redirect until the sign-up details are saved
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (user && !registering.current) router.replace("/dashboard");
  }, [user, router]);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    // Keep the URL in sync without a navigation (/login ↔ /register).
    window.history.replaceState(null, "", m === "login" ? "/login" : "/register");
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof FirebaseError ? (ERRORS[e.code] ?? e.message) : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      if (mode === "login") return signInWithEmailAndPassword(auth, form.email, form.password);
      if (form.password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres");
      if (form.password !== form.confirm) throw new Error("Las contraseñas no coinciden");
      registering.current = true;
      try {
        const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
        await updateProfile(cred.user, { displayName: [form.firstName, form.lastName].filter(Boolean).join(" ") });
        await api("/api/me", {
          method: "PUT",
          body: { firstName: form.firstName, lastName: form.lastName, whatsapp: form.whatsapp, company: form.company },
        });
        router.replace("/dashboard");
      } finally {
        registering.current = false;
      }
    });
  }

  const isLogin = mode === "login";
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className={cn("w-full", isLogin ? "max-w-sm" : "max-w-lg")}>
        <CardHeader className="space-y-4">
          <div className="flex justify-center pt-2 pb-2">
            <BrandLogo className="h-[47px]" />
          </div>
          {/* "Iniciar sesión" is the default tab. */}
          <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={cn(
                  "rounded-md py-1.5 text-sm font-medium transition-colors",
                  mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "login" ? "Iniciar sesión" : "Crear cuenta"}
              </button>
            ))}
          </div>
          <div className="space-y-1 pt-1">
            <CardTitle>{isLogin ? "Inicia sesión" : "Crea tu cuenta"}</CardTitle>
            <CardDescription>
              {isLogin ? "Accede para gestionar tus redes, clientes y agenda." : "Registra tu empresa. El administrador activará la cuenta."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-3">
            {!isLogin && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName">Nombre</Label>
                    <Input id="firstName" required value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoComplete="given-name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName">Apellidos</Label>
                    <Input id="lastName" required value={form.lastName} onChange={(e) => set("lastName", e.target.value)} autoComplete="family-name" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="company">Empresa</Label>
                  <Input id="company" required value={form.company} onChange={(e) => set("company", e.target.value)} autoComplete="organization" />
                </div>
              </>
            )}
            {/* Email 60% · WhatsApp 40% on sign-up. */}
            <div className={cn("grid gap-3", !isLogin && "sm:grid-cols-[3fr_2fr]")}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" />
              </div>
              {!isLogin && (
                <div className="space-y-1.5">
                  <Label htmlFor="whatsapp">WhatsApp</Label>
                  <Input
                    id="whatsapp"
                    type="tel"
                    required
                    placeholder="+55 11 9…"
                    value={form.whatsapp}
                    onChange={(e) => set("whatsapp", e.target.value)}
                    autoComplete="tel"
                  />
                </div>
              )}
            </div>
            <div className={cn("grid gap-3", !isLogin && "sm:grid-cols-2")}>
              <div className="space-y-1.5">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={isLogin ? 6 : 8}
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                />
              </div>
              {!isLogin && (
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirmar</Label>
                  <Input id="confirm" type="password" required value={form.confirm} onChange={(e) => set("confirm", e.target.value)} autoComplete="new-password" />
                </div>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Un momento…" : isLogin ? "Entrar" : "Crear cuenta"}
            </Button>
          </form>
          {isLogin && (
            <Button variant="outline" className="w-full" disabled={busy} onClick={() => run(() => signInWithPopup(auth, new GoogleAuthProvider()))}>
              Continuar con Google
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
