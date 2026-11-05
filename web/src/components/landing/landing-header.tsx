"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { BrandLogo } from "@/components/shared/brand-logo";
import { useAuth } from "@/lib/auth-context";

const NAV = [
  { href: "#funciones", label: "Funciones" },
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#beneficios", label: "Beneficios" },
];

export function LandingHeader() {
  const { user, loading } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-colors",
        scrolled ? "border-b bg-background/85 backdrop-blur-md" : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <Link href="/" aria-label="Inicio">
          <BrandLogo className="h-7" />
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="transition-colors hover:text-foreground">
              {n.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {!loading && user ? (
            <Link href="/dashboard" className={cn(buttonVariants({ size: "lg" }), "rounded-full px-4")}>
              Ir al panel <ArrowRight />
            </Link>
          ) : (
            <>
              <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "hidden rounded-full px-4 sm:inline-flex")}>
                Iniciar sesión
              </Link>
              <Link
                href="/register"
                className={cn(buttonVariants({ size: "lg" }), "rounded-full bg-[#D8790D] px-4 text-white hover:bg-[#c06a0a]")}
              >
                Crear cuenta
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
