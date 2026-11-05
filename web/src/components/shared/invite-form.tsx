"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { Lock, UsersRound } from "lucide-react";
import { auth } from "@/lib/firebase/client";
import { BrandLogo } from "@/components/shared/brand-logo";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Invite = { firstName: string; lastName: string; email: string; whatsapp: string; role: string; company: string | null; logoUrl: string | null };

const ERRORS: Record<string, string> = {
  "auth/invalid-credential": "Contraseña incorrecta",
  "auth/wrong-password": "Contraseña incorrecta",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos.",
};

async function accept(token: string, whatsapp: string) {
  const idToken = await auth.currentUser?.getIdToken(true);
  const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ whatsapp }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Error ${res.status}`);
}

/** Registration from an invitation link: name, surname and email come from the admin and are locked. */
export function InviteForm({ token }: { token: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [existing, setExisting] = useState(false); // the email already has an account: sign in instead
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Invitación no válida");
        setInvite(d);
        setWhatsapp(d.whatsapp ?? "");
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [token]);

  async function finish() {
    await accept(token, whatsapp);
    await qc.invalidateQueries({ queryKey: ["me"] });
    router.replace("/dashboard/inbox");
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof FirebaseError && e.code === "auth/email-already-in-use") {
        setExisting(true);
        setError("Ya existe una cuenta con este email. Escribe su contraseña para unirte al equipo.");
      } else setError(e instanceof FirebaseError ? (ERRORS[e.code] ?? e.message) : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!invite) return;
    run(async () => {
      if (existing) await signInWithEmailAndPassword(auth, invite.email, password);
      else {
        if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres");
        if (password !== repeat) throw new Error("Las contraseñas no coinciden");
        await createUserWithEmailAndPassword(auth, invite.email, password);
      }
      await finish();
    });
  }

  const signedInAsOther = user && invite && user.email?.toLowerCase() !== invite.email;
  const signedInAsInvited = user && invite && user.email?.toLowerCase() === invite.email;

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="flex justify-center pt-2 pb-2">
            <BrandLogo className="h-[47px]" />
          </div>
          {invite?.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={invite.logoUrl} alt="" className="mb-2 size-12 rounded-lg object-contain" />
          )}
          <CardTitle className="flex items-center gap-2">
            <UsersRound className="size-5" /> Únete al equipo{invite?.company ? ` de ${invite.company}` : ""}
          </CardTitle>
          <CardDescription>{invite ? `Te invitaron como ${invite.role}. Crea tu contraseña para entrar.` : loadError ? "Pide al administrador un enlace nuevo." : "Cargando invitación…"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {invite && signedInAsOther && (
            <div className="space-y-2 text-sm">
              <p>
                Has iniciado sesión como <strong>{user.email}</strong>. Esta invitación es para <strong>{invite.email}</strong>.
              </p>
              <Button variant="outline" onClick={() => signOut(auth)}>
                Cerrar sesión y continuar
              </Button>
            </div>
          )}
          {invite && signedInAsInvited && (
            <Button className="w-full" disabled={busy} onClick={() => run(finish)}>
              Unirme al equipo
            </Button>
          )}
          {invite && !user && (
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="iv-first">Nombre</Label>
                  <Input id="iv-first" value={invite.firstName} readOnly disabled />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="iv-last">Apellidos</Label>
                  <Input id="iv-last" value={invite.lastName} readOnly disabled />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iv-email" className="flex items-center gap-1">
                  Email <Lock className="size-3 text-muted-foreground" />
                </Label>
                <Input id="iv-email" type="email" value={invite.email} readOnly disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iv-wa">WhatsApp</Label>
                <Input id="iv-wa" type="tel" placeholder="+5511987654321" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iv-pw">{existing ? "Contraseña de tu cuenta" : "Crea una contraseña"}</Label>
                <Input
                  id="iv-pw"
                  type="password"
                  required
                  minLength={existing ? 6 : 8}
                  autoComplete={existing ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {!existing && (
                <div className="space-y-1.5">
                  <Label htmlFor="iv-pw2">Repite la contraseña</Label>
                  <Input id="iv-pw2" type="password" required autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
                </div>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Entrando…" : existing ? "Entrar y unirme" : "Crear cuenta y unirme"}
              </Button>
            </form>
          )}
          {error && user && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
