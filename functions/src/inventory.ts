import { getFirestore } from "firebase-admin/firestore";
import { vehiclesCol } from "./paths";

// Inventory as the AI agent sees it: only available units, never VIN or plates.
// Keep the vehicle fields in sync with web/src/lib/vehicles.ts.

const db = () => getFirestore();
const MAX_SCAN = 300;
const MAX_RESULTS = 6;
// "un auto de 205 mil": without explicit limits, look ±20% around that price.
const PRICE_SPAN = 0.2;

// Arguments come straight from the model, so numbers may arrive as strings.
export type InventoryFilters = {
  query?: string;
  brand?: string;
  model?: string;
  yearMin?: number | string;
  yearMax?: number | string;
  price?: number | string; // approximate budget: closest prices first
  priceMin?: number | string;
  priceMax?: number | string;
  kmMax?: number | string;
  bodyType?: string;
  transmission?: string;
  fuel?: string;
  condition?: string;
};

// Words people use for any car, and filler: they must not be required in the text match.
const STOPWORDS = new Set(
  "auto autos carro carros coche coches vehiculo vehiculos unidad unidades modelo de del el la los las un una unos unas con en y o para que tienen tiene hay algun alguna busco quiero precio pesos mxn mil k".split(" "),
);

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
// "205,000", "$205000", "205 mil", "205k" → 205000. Unreadable values become undefined (no filter).
const num = (v: unknown) => {
  if (v === undefined || v === null || v === "") return undefined;
  const s = norm(v).replace(/[,\s$]/g, "");
  const m = /^(\d+(?:\.\d+)?)(mil|k)?$/.exec(s);
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : undefined;
};

type VehicleDoc = {
  id: string;
  brand?: string;
  model?: string;
  trim?: string;
  title?: string;
  year: number;
  km?: number;
  price: number;
  condition?: string;
  color?: string;
  bodyType?: string;
  fuel?: string;
  transmission?: string;
  traction?: string;
  location?: { state?: string; city?: string };
  features?: string[];
  photos?: { url: string }[];
  mlPermalink?: string | null;
};

async function available(uid: string): Promise<VehicleDoc[]> {
  const snap = await db().collection(vehiclesCol(uid)).where("status", "==", "disponible").limit(MAX_SCAN).get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<VehicleDoc, "id">), id: d.id }));
}

/** The car of a test drive: must exist and still be on sale. Returns an error message otherwise. */
export async function bookingVehicle(uid: string, vehicleId: unknown): Promise<{ id: string; title: string } | { error: string }> {
  if (typeof vehicleId !== "string" || !vehicleId.trim() || vehicleId.includes("/")) return { error: "Falta el auto (vehicleId)" };
  const snap = await db().collection(vehiclesCol(uid)).doc(vehicleId.trim()).get();
  if (!snap.exists) return { error: "Ese auto no existe en el inventario" };
  if (!["disponible", "apartado"].includes(snap.get("status"))) return { error: "Ese auto ya no está a la venta" };
  const v = snap.data() as VehicleDoc;
  return { id: snap.id, title: v.title || [v.brand, v.model, v.year].filter(Boolean).join(" ") };
}

/** Whether the account has anything for sale (the tool is only offered then). */
export async function hasInventory(uid: string) {
  return !(await db().collection(vehiclesCol(uid)).where("status", "==", "disponible").limit(1).get()).empty;
}

/** Up to 6 available units matching the filters: closest to the budget first, else cheapest first. */
export async function searchInventory(uid: string, f: InventoryFilters) {
  const yearMin = num(f.yearMin);
  const yearMax = num(f.yearMax);
  // Amounts typed into the text ("205000", "205,000") are prices, not words to match; years (≤ 2100) stay.
  const tokens = norm([f.query, f.brand, f.model].filter(Boolean).join(" "))
    .replace(/(\d),(\d{3})/g, "$1$2")
    .split(/[\s,]+/)
    .filter((w) => w && !STOPWORDS.has(w));
  const amount = tokens.map(Number).find((n) => n > 2100);
  const words = tokens.filter((w) => !/^\d+$/.test(w) || (w.length === 4 && Number(w) <= 2100));
  const target = num(f.price) ?? (num(f.priceMin) || num(f.priceMax) ? undefined : amount);
  const priceMin = num(f.priceMin) ?? (target && !num(f.priceMax) ? target * (1 - PRICE_SPAN) : undefined);
  const priceMax = num(f.priceMax) ?? (target && !num(f.priceMin) ? target * (1 + PRICE_SPAN) : undefined);
  const kmMax = num(f.kmMax);
  const body = norm(f.bodyType);
  const trans = norm(f.transmission);
  const fuel = norm(f.fuel);
  const condition = norm(f.condition);
  const all = await available(uid);
  const matches = all
    .filter((v) => {
      const text = norm([v.brand, v.model, v.trim, v.year, v.color, v.bodyType, v.fuel, v.transmission, v.traction, v.condition].join(" "));
      if (words.some((w) => !text.includes(w))) return false;
      if (yearMin && v.year < yearMin) return false;
      if (yearMax && v.year > yearMax) return false;
      if (priceMin && v.price < priceMin) return false;
      if (priceMax && v.price > priceMax) return false;
      if (kmMax !== undefined && !Number.isNaN(kmMax) && (v.km ?? 0) > kmMax) return false;
      if (body && !norm(v.bodyType).includes(body)) return false;
      if (trans && !norm(v.transmission).startsWith(trans.slice(0, 4))) return false;
      if (fuel && !norm(v.fuel).startsWith(fuel.slice(0, 4))) return false;
      if (condition && norm(v.condition) !== (condition.startsWith("nuev") ? "nuevo" : "usado")) return false;
      return true;
    })
    .sort((a, b) =>
      target
        ? Math.abs(a.price - target) - Math.abs(b.price - target)
        : priceMax && !priceMin
          ? b.price - a.price // "hasta 300 mil": the best the budget buys first
          : a.price - b.price,
    );
  return {
    total: matches.length,
    results: matches.slice(0, MAX_RESULTS).map((v) => ({
      vehicleId: v.id,
      title: v.title || `${v.brand} ${v.model} ${v.year}`,
      year: v.year,
      km: v.km,
      price: v.price,
      currency: "MXN",
      condition: v.condition,
      transmission: v.transmission || null,
      fuel: v.fuel || null,
      color: v.color || null,
      location: [v.location?.city, v.location?.state].filter(Boolean).join(", ") || null,
      features: (v.features ?? []).slice(0, 8),
      photo: v.photos?.[0]?.url ?? null,
      link: v.mlPermalink ?? null,
    })),
    note: matches.length ? null : "No hay autos disponibles con esos filtros. Dilo con honestidad y ofrece alternativas cercanas (otro año, precio o modelo) buscando de nuevo.",
  };
}

/** Prompt section: what is on the lot right now, so the agent knows when to search. */
export async function inventorySection(uid: string) {
  const all = await available(uid);
  if (!all.length) return [];
  const brands = [...new Set(all.map((v) => v.brand).filter(Boolean))].slice(0, 30);
  const prices = all.map((v) => v.price).filter((p) => p > 0);
  return [
    "\n# INVENTARIO DE AUTOS",
    `Hay ${all.length} autos disponibles${brands.length ? ` (marcas: ${brands.join(", ")})` : ""}${prices.length ? `, de $${Math.min(...prices).toLocaleString("es-MX")} a $${Math.max(...prices).toLocaleString("es-MX")} MXN` : ""}.`,
    "- Para cualquier pregunta sobre autos disponibles, precios, versiones, kilometraje o equipamiento usa SIEMPRE la herramienta search_inventory.",
    "- Si la persona da un precio ('un auto de 205 mil') usa price; si dice 'hasta' o 'menos de' usa priceMax; 'desde' usa priceMin. No metas precios ni la palabra 'auto' en query.",
    "- Nunca menciones un auto, precio, kilometraje o disponibilidad que no venga de search_inventory. Si no hay resultados, dilo y ofrece alternativas.",
    "- Da como máximo 3 opciones por mensaje, con título, año, km y precio. Si hay link, compártelo.",
    "- No negocies descuentos ni apartes autos: si la persona quiere negociar, apartar o ver el auto, ofrece agendar una visita o prueba de manejo (con la agenda si existe) o marca needsHuman=true.",
  ];
}
