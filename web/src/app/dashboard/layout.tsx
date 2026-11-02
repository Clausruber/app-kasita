"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { CalendarCheck, CalendarDays, Clock, Inbox, Lock, LogOut, Newspaper, Settings, ShieldCheck, UserRound } from "lucide-react";
import { auth } from "@/lib/firebase/client";
import { useAuth } from "@/lib/auth-context";
import { useInbox } from "@/hooks/use-firestore";
import { useMe } from "@/hooks/use-me";
import { can } from "@/lib/permissions";
import { BrandLogo } from "@/components/shared/brand-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// `perm`: access key a team member needs (lib/permissions.ts). Ajustes always opens (Perfil is for everyone).
const NAV = [
  { href: "/dashboard/inbox", label: "Inbox", icon: Inbox, perm: "inbox" },
  { href: "/dashboard/posts", label: "Publicaciones", icon: Newspaper, perm: "posts" },
  { href: "/dashboard/clients", label: "Clientes", icon: UserRound, perm: "clients" },
  { href: "/dashboard/calendar", label: "Calendario", icon: CalendarDays, perm: "calendar" },
  { href: "/dashboard/agenda", label: "Agenda", icon: CalendarCheck, perm: "agenda" },
  { href: "/dashboard/settings", label: "Ajustes", icon: Settings, perm: null },
];

function NoAccess() {
  return (
    <div className="mx-auto max-w-md space-y-2 rounded-xl border p-6 text-center">
      <Lock className="mx-auto size-8 text-muted-foreground" />
      <h1 className="text-lg font-semibold">Sin acceso</h1>
      <p className="text-sm text-muted-foreground">El administrador no te habilitó esta sección. Usa el menú para ir a las que sí tienes.</p>
    </div>
  );
}

/** Shown to accounts the SuperAdmin has not activated yet (or disabled). */
function PendingAccount({ email, disabled, member }: { email: string | null; disabled: boolean; member: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="max-w-md space-y-3 rounded-xl border p-6 text-center">
        <div className="flex justify-center pt-1 pb-3">
          <BrandLogo className="h-[47px]" />
        </div>
        <Clock className="mx-auto size-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{disabled ? "Cuenta desactivada" : "Cuenta pendiente de activación"}</h1>
        <p className="text-sm text-muted-foreground">
          {disabled
            ? member
              ? "El administrador de tu equipo desactivó tu acceso. Contacta con él si crees que es un error."
              : "El administrador desactivó esta cuenta. Contacta con él si crees que es un error."
            : member
              ? "La cuenta de tu empresa aún no está activa. Inténtalo más tarde."
              : "Tu cuenta se creó correctamente. El administrador debe activarla y configurar la conexión con las redes sociales antes de que puedas usarla."}
        </p>
        <p className="text-xs text-muted-foreground">{email}</p>
        <Button variant="outline" size="sm" onClick={() => signOut(auth)}>
          <LogOut /> Cerrar sesión
        </Button>
      </div>
    </div>
  );
}

function UnreadBadge() {
  const { data } = useInbox();
  const unread = data.filter((m) => m.direction === "in" && !m.read).length;
  if (!unread) return null;
  return (
    <span className="ml-auto rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
      {unread > 99 ? "99+" : unread}
    </span>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();

  // Client-side guard; the real security is in the API (ID token) and Firestore rules.
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user || me.isLoading) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">Cargando…</div>;
  }
  const superadmin = me.data?.role === "superadmin";
  if (me.data && !superadmin && me.data.status !== "active") {
    return <PendingAccount email={user.email} disabled={me.data.status === "disabled"} member={me.data.role === "member"} />;
  }
  const allowed = NAV.filter((n) => !n.perm || can(me.data?.perms, n.perm));
  const nav = superadmin ? [...allowed, { href: "/dashboard/superadmin", label: "SuperAdmin", icon: ShieldCheck, perm: null }] : allowed;
  const current = NAV.find((n) => pathname.startsWith(n.href));
  const blocked = !!current && !allowed.includes(current);

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      {/* Fixed while the page scrolls: a top bar on mobile, the full-height sidebar on desktop. */}
      <aside className="sticky top-0 z-30 flex shrink-0 flex-col gap-1 border-b bg-background p-3 md:h-dvh md:w-56 md:self-start md:overflow-y-auto md:border-r md:border-b-0">
        {/* Logo 43px high (fills the 224px sidebar), separated from the menu by a line. */}
        <div className="mb-2 flex items-center border-b px-2 pt-1 pb-3">
          <BrandLogo className="h-[43px] max-w-full" />
        </div>
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm whitespace-nowrap hover:bg-muted",
                pathname.startsWith(href) && "bg-muted font-medium",
              )}
            >
              <Icon className="size-4" />
              {label}
              {href === "/dashboard/inbox" && <UnreadBadge />}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden pt-4 md:block">
          <p className="truncate px-2 text-xs text-muted-foreground">{user.email}</p>
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={() => signOut(auth)}>
            <LogOut /> Cerrar sesión
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">{blocked ? <NoAccess /> : children}</main>
    </div>
  );
}
