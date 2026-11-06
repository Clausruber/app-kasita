"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import {
  BellRing,
  Building2,
  CalendarCheck,
  CalendarDays,
  Clock,
  FileText,
  Inbox,
  KanbanSquare,
  Lock,
  LogOut,
  Menu,
  Newspaper,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { auth } from "@/lib/firebase/client";
import { useAuth } from "@/lib/auth-context";
import { useInbox } from "@/hooks/use-firestore";
import { useMe } from "@/hooks/use-me";
import { useTaskBadge } from "@/hooks/use-tasks";
import { can } from "@/lib/permissions";
import { BrandLogo } from "@/components/shared/brand-logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// `perm`: access key a team member needs (lib/permissions.ts). Ajustes always opens (Perfil is for everyone).
// `group`: a line separates groups in the sidebar (lot · selling · settings).
const NAV = [
  { href: "/dashboard/inventory", label: "Propiedades", icon: Building2, perm: "inventory", group: 1 },
  { href: "/dashboard/clients", label: "Clientes", icon: UserRound, perm: "clients", group: 1 },
  { href: "/dashboard/calendar", label: "Calendario", icon: CalendarDays, perm: "calendar", group: 1 },
  { href: "/dashboard/agenda", label: "Agenda", icon: CalendarCheck, perm: "agenda", group: 1 },
  { href: "/dashboard/posts", label: "Publicaciones", icon: Newspaper, perm: "posts", group: 1 },
  { href: "/dashboard/inbox", label: "Inbox", icon: Inbox, perm: "inbox", group: 2 },
  { href: "/dashboard/quotes", label: "Cotizaciones", icon: FileText, perm: "inventory", group: 2 },
  { href: "/dashboard/tasks", label: "Seguimientos", icon: BellRing, perm: "tasks", group: 2 },
  { href: "/dashboard/pipeline", label: "Pipeline", icon: KanbanSquare, perm: "deals", group: 2 },
  { href: "/dashboard/settings", label: "Ajustes", icon: Settings, perm: null, group: 3 },
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

function TaskBadge() {
  const due = useTaskBadge();
  if (!due) return null;
  return <span className="ml-auto rounded-full bg-destructive px-1.5 text-xs text-white">{due > 99 ? "99+" : due}</span>;
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
  const [mobileOpen, setMobileOpen] = useState(false);

  // Client-side guard; the real security is in the API (ID token) and Firestore rules.
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (loading || !user || me.isLoading) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">Cargando…</div>;
  }
  const superadmin = me.data?.role === "superadmin";
  if (me.data && !superadmin && me.data.status !== "active") {
    return <PendingAccount email={user.email} disabled={me.data.status === "disabled"} member={me.data.role === "member"} />;
  }
  const allowed = NAV.filter((n) => !n.perm || can(me.data?.perms, n.perm));
  const nav = superadmin ? [...allowed, { href: "/dashboard/superadmin", label: "SuperAdmin", icon: ShieldCheck, perm: null, group: 3 }] : allowed;
  const current = NAV.find((n) => pathname.startsWith(n.href));
  const blocked = !!current && !allowed.includes(current);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* ── MOBILE HEADER (Mode Mobile < md) ── */}
      <header className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b bg-background px-3 md:hidden">
        {/* Left: Hamburger menu button */}
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="text-foreground"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu className="size-5" />
          </Button>
        </div>

        {/* Center: Brand Logo perfectly centered */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center">
          <Link href="/dashboard/inventory" className="flex items-center justify-center">
            <BrandLogo className="h-[36px] max-w-[150px]" />
          </Link>
        </div>

        {/* Right: Quick shortcut to Inbox */}
        <div className="flex items-center">
          <Link
            href="/dashboard/inbox"
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Ir a Inbox"
          >
            <Inbox className="size-5" />
          </Link>
        </div>
      </header>

      {/* ── MOBILE DRAWER / SHEET ── */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="flex w-[280px] max-w-[85vw] flex-col p-0">
          <SheetHeader className="border-b px-4 py-3.5 text-center">
            <div className="flex items-center justify-center">
              <BrandLogo className="h-[38px] max-w-full" />
            </div>
            <SheetTitle className="sr-only">Navegación de Kasita</SheetTitle>
          </SheetHeader>

          {/* Scrollable vertical nav in drawer */}
          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {nav.map(({ href, label, icon: Icon, group }, i) => (
              <Fragment key={href}>
                {i > 0 && nav[i - 1].group !== group && (
                  <div className="my-2 border-t border-border/60" />
                )}
                <Link
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted",
                    pathname.startsWith(href)
                      ? "bg-muted font-semibold text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1">{label}</span>
                  {href === "/dashboard/inbox" && <UnreadBadge />}
                  {href === "/dashboard/tasks" && <TaskBadge />}
                </Link>
              </Fragment>
            ))}
          </nav>

          {/* User profile & Sign out */}
          <div className="border-t bg-muted/20 p-3">
            <p className="truncate px-2 text-xs text-muted-foreground">{user.email}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setMobileOpen(false);
                signOut(auth);
              }}
            >
              <LogOut className="size-4 mr-2" /> Cerrar sesión
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── DESKTOP SIDEBAR (>= md) ── */}
      <aside className="sticky top-0 z-30 hidden md:flex shrink-0 flex-col gap-1 border-r bg-background p-3 md:h-dvh md:w-56 md:overflow-y-auto">
        <div className="mb-2 flex items-center border-b px-2 pt-1 pb-3">
          <BrandLogo className="h-[43px] max-w-full" />
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map(({ href, label, icon: Icon, group }, i) => (
            <Fragment key={href}>
              {i > 0 && nav[i - 1].group !== group && (
                <span aria-hidden className="mx-2 my-1.5 h-px bg-border" />
              )}
              <Link
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted",
                  pathname.startsWith(href) && "bg-muted font-medium",
                )}
              >
                <Icon className="size-4" />
                {label}
                {href === "/dashboard/inbox" && <UnreadBadge />}
                {href === "/dashboard/tasks" && <TaskBadge />}
              </Link>
            </Fragment>
          ))}
        </nav>
        <div className="mt-auto pt-4">
          <p className="truncate px-2 text-xs text-muted-foreground">{user.email}</p>
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={() => signOut(auth)}>
            <LogOut /> Cerrar sesión
          </Button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="min-w-0 flex-1 p-4 md:p-6">{blocked ? <NoAccess /> : children}</main>
    </div>
  );
}
