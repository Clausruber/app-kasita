import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Building2,
  CalendarCheck,
  Check,
  FileText,
  Inbox,
  ListChecks,
  Megaphone,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { BrandLogo } from "@/components/shared/brand-logo";
import { LandingHeader } from "@/components/landing/landing-header";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Kasita";

const BRAND = "bg-[#D8790D] text-white hover:bg-[#c06a0a]";

const NETWORKS = ["Instagram", "Facebook", "TikTok", "YouTube", "LinkedIn", "X", "Threads", "Pinterest", "Google Business", "Telegram"];

const FEATURES = [
  {
    icon: Inbox,
    title: "Todas las conversaciones en un lugar",
    text: "Comentarios y mensajes directos de todas tus redes llegan a una sola bandeja, con el historial de cada persona.",
  },
  {
    icon: Bot,
    title: "Respuestas inmediatas, 24/7",
    text: "Un agente de IA entrenado con tu información responde dudas de precios, disponibilidad y propiedades con el tono de tu marca.",
  },
  {
    icon: CalendarCheck,
    title: "Visitas agendadas en el chat",
    text: "El cliente elige su horario mientras conversa y la cita queda reservada sin choques en la agenda de tu equipo.",
  },
  {
    icon: FileText,
    title: "Catálogos y cotizaciones al momento",
    text: "Envía cotizaciones en PDF dentro de la conversación, con un enlace para que el cliente las revise y las acepte.",
  },
  {
    icon: Megaphone,
    title: "Publica en todas tus redes",
    text: "Una publicación, todas tus cuentas, con tu logo en cada foto. Más alcance, más interesados que atender.",
  },
  {
    icon: Building2,
    title: "Inventario siempre al día",
    text: "Sabes qué está disponible, apartado o vendido, para no ofrecer nunca algo que ya no existe.",
  },
];

const STEPS = [
  { n: "1", title: "Conecta tus redes", text: "Vincula Instagram, Facebook, TikTok y más en un par de clics." },
  { n: "2", title: "Entrena a tu agente", text: "Sube tus documentos y cuéntale cómo es tu negocio y tu forma de hablar." },
  { n: "3", title: "Atiende y vende", text: "La IA responde y agenda; tú revisas, das seguimiento y cierras." },
];

const BENEFITS = [
  "Ningún cliente se queda sin respuesta",
  "Tú decides si la IA responde sola o con tu aprobación",
  "Cada persona queda registrada como cliente con su historial",
  "Seguimiento con tareas y embudo de ventas",
  "Tu equipo con permisos por usuario",
  "Avisos cuando una pregunta necesita a una persona",
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <LandingHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[#D8790D]/15 blur-3xl"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pt-14 pb-20 md:grid-cols-2 md:pt-20">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Sparkles className="size-3.5 text-[#D8790D]" /> Atención al cliente con IA para inmobiliarias
              </span>
              <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
                Ningún cliente sin respuesta. <span className="text-[#D8790D]">Ninguna venta perdida.</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg text-pretty text-muted-foreground">
                {APP_NAME} responde al instante los comentarios y mensajes de todas tus redes, agenda visitas y da
                seguimiento a cada interesado, las 24 horas.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/register" className={cn(buttonVariants({ size: "lg" }), BRAND, "h-11 rounded-full px-6 text-base")}>
                  Crear cuenta <ArrowRight />
                </Link>
                <a href="#funciones" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 rounded-full px-6 text-base")}>
                  Ver funciones
                </a>
              </div>
            </div>

            {/* Product preview: a photo with a mock conversation on top */}
            <div className="relative mx-auto w-full max-w-md">
              <div className="relative aspect-[4/5] overflow-hidden rounded-3xl shadow-2xl ring-1 ring-black/5">
                <Image src="/demo-photos/casa-1.jpg" alt="Casa en venta" fill priority sizes="(min-width: 768px) 28rem, 90vw" className="object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
              </div>
              <div className="absolute inset-x-4 bottom-4 space-y-2 sm:-left-8 sm:right-8">
                <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-sm text-neutral-900 shadow-lg">
                  Hola, ¿la casa sigue disponible? ¿Puedo verla el sábado?
                </div>
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-[#D8790D] px-4 py-2.5 text-sm text-white shadow-lg">
                  ¡Hola! Sí, sigue disponible 🏡 Te aparté el sábado a las 11:00. ¿Te envío el catálogo?
                </div>
                <div className="flex w-fit items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-neutral-700 shadow">
                  <CalendarCheck className="size-3.5 text-[#D8790D]" /> Visita agendada · respondido en 4 s
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Networks */}
        <section className="border-y bg-muted/40">
          <div className="mx-auto max-w-6xl px-5 py-8">
            <p className="text-center text-sm text-muted-foreground">Atiende a tus clientes en las redes donde ya están</p>
            <div className="mt-4 flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm font-semibold text-foreground/70">
              {NETWORKS.map((n) => (
                <span key={n}>{n}</span>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="funciones" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Todo para atender mejor y vender más</h2>
              <p className="mt-4 text-muted-foreground">
                Desde el primer mensaje hasta la cita y la cotización, sin saltar entre apps.
              </p>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-2xl border bg-card p-6 transition-shadow hover:shadow-md">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-[#D8790D]/10 text-[#D8790D]">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="como-funciona" className="scroll-mt-20 bg-muted/40">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Empieza en minutos</h2>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.n} className="text-center">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#D8790D] text-lg font-bold text-white">
                    {s.n}
                  </div>
                  <h3 className="mt-4 font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section id="beneficios" className="scroll-mt-20">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 md:grid-cols-2">
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl shadow-xl ring-1 ring-black/5">
              <Image src="/demo-photos/sala-1.jpg" alt="Sala de una propiedad" fill sizes="(min-width: 768px) 36rem, 90vw" className="object-cover" />
            </div>
            <div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Clientes bien atendidos, clientes que vuelven</h2>
              <p className="mt-4 text-muted-foreground">
                La IA se encarga de lo repetitivo para que tu equipo dedique su tiempo a lo que cierra ventas: las visitas
                y las negociaciones.
              </p>
              <ul className="mt-6 space-y-3">
                {BENEFITS.map((b) => (
                  <li key={b} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#D8790D]/15 text-[#D8790D]">
                      <Check className="size-3.5" />
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-6 text-sm text-muted-foreground">
                <span className="flex items-center gap-2"><UsersRound className="size-4" /> Trabajo en equipo</span>
                <span className="flex items-center gap-2"><ListChecks className="size-4" /> Seguimiento con tareas</span>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="px-5 pb-20">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-neutral-950 px-6 py-14 text-center text-white sm:px-12">
            <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              Atiende a cada cliente como si fuera el único
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-white/70">
              Crea tu cuenta y conecta tus redes hoy mismo.
            </p>
            <Link href="/register" className={cn(buttonVariants({ size: "lg" }), BRAND, "mt-8 h-11 rounded-full px-6 text-base")}>
              Crear cuenta <ArrowRight />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row">
          <BrandLogo className="h-5" />
          <p>© {new Date().getFullYear()} {APP_NAME}. Todos los derechos reservados.</p>
          <Link href="/login" className="hover:text-foreground">Iniciar sesión</Link>
        </div>
      </footer>
    </div>
  );
}
