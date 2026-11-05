
import { HttpError } from "./auth-guard";

/** Fixed id of the agent knowledge document generated from the Empresa tab. */
export const COMPANY_FILE_ID = "company";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABEL: Record<(typeof WEEKDAYS)[number], string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};
const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export type Company = {
  name: string;
  legalName: string;
  taxId: string;
  description: string;
  logoUrl: string;
  address: { street: string; number: string; complement: string; district: string; city: string; state: string; postalCode: string; country: string };
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  timezone: string;
  hours: Record<string, { start: string; end: string }[]>;
  hoursNote: string;
};

/** Validates the Empresa tab. Opening hours use the same ranges as the agendas. */
export function parseCompany(b: Record<string, unknown>): Company {
  const name = clip(b.name, 120);
  if (!name) throw new HttpError(400, "Indica el nombre de la empresa");
  const email = clip(b.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Email no válido");
  const website = clip(b.website, 200);
  if (website && !/^https?:\/\/\S+\.\S+/.test(website)) throw new HttpError(400, "La web debe empezar por https://");
  const logoUrl = clip(b.logoUrl, 1000);
  if (logoUrl && !/^https:\/\//.test(logoUrl)) throw new HttpError(400, "Logo no válido");
  const whatsapp = clip(b.whatsapp, 30).replace(/[\s().-]/g, "");
  if (whatsapp && !/^\+?\d{6,15}$/.test(whatsapp)) throw new HttpError(400, "WhatsApp no válido: usa el número con prefijo de país");
  const timezone = clip(b.timezone, 64) || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new HttpError(400, "Zona horaria no válida");
  }
  const a = (b.address ?? {}) as Record<string, unknown>;
  const hoursIn = (b.hours ?? {}) as Record<string, { start?: string; end?: string }[]>;
  const hours: Company["hours"] = {};
  for (const d of WEEKDAYS) {
    const ranges = (Array.isArray(hoursIn[d]) ? hoursIn[d] : []).slice(0, 6).map((r) => {
      if (!TIME.test(r.start ?? "") || !TIME.test(r.end ?? "") || toMin(r.end!) <= toMin(r.start!))
        throw new HttpError(400, `Horario no válido (${DAY_LABEL[d]}): ${r.start}–${r.end}`);
      return { start: r.start!, end: r.end! };
    });
    ranges.sort((x, y) => toMin(x.start) - toMin(y.start));
    if (ranges.some((r, i) => i > 0 && toMin(r.start) < toMin(ranges[i - 1].end))) throw new HttpError(400, `Horarios solapados (${DAY_LABEL[d]})`);
    hours[d] = ranges;
  }
  return {
    name,
    legalName: clip(b.legalName, 160),
    taxId: clip(b.taxId, 40),
    description: clip(b.description, 2000),
    logoUrl,
    address: {
      street: clip(a.street, 160),
      number: clip(a.number, 20),
      complement: clip(a.complement, 80),
      district: clip(a.district, 80),
      city: clip(a.city, 80),
      state: clip(a.state, 80),
      postalCode: clip(a.postalCode, 20),
      country: clip(a.country, 60),
    },
    phone: clip(b.phone, 30),
    whatsapp: whatsapp && !whatsapp.startsWith("+") ? `+${whatsapp}` : whatsapp,
    email,
    website,
    timezone,
    hours,
    hoursNote: clip(b.hoursNote, 500),
  };
}

export function formatAddress(a: Company["address"]) {
  const line1 = [a.street, a.number].filter(Boolean).join(", ");
  return [line1 + (a.complement ? ` (${a.complement})` : ""), a.district, [a.postalCode, a.city].filter(Boolean).join(" "), a.state, a.country]
    .filter((x) => x?.trim())
    .join(", ");
}

/**
 * The company data as Markdown, stored as an agent knowledge document (like the PDFs) so the agent
 * answers "where are you?" / "when are you open?" with the real data.
 */
export function companyMarkdown(c: Company) {
  const line = (label: string, v: string) => (v ? `- **${label}:** ${v}\n` : "");
  const hours = WEEKDAYS.map((d) => `| ${DAY_LABEL[d]} | ${c.hours[d]?.length ? c.hours[d].map((r) => `${r.start}–${r.end}`).join(", ") : "Cerrado"} |`).join("\n");
  return [
    `# ${c.name}`,
    c.description ? `\n\n${c.description}\n` : "",
    "\n## Datos de la empresa\n",
    line("Nombre comercial", c.name),
    line("Razón social", c.legalName),
    line("Identificación fiscal", c.taxId),
    "\n## Ubicación y contacto\n",
    line("Dirección", formatAddress(c.address)),
    line("Teléfono", c.phone),
    line("WhatsApp", c.whatsapp),
    line("Email", c.email),
    line("Web", c.website),
    `\n## Horario de funcionamiento (zona horaria ${c.timezone})\n`,
    "| Día | Horario |\n|---|---|\n" + hours + "\n",
    c.hoursNote ? `\n${c.hoursNote}\n` : "",
  ]
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
