import { getFirestore } from "firebase-admin/firestore";
import { propertiesCol } from "./paths";

// Properties as the AI agent sees them: only available listings, never the exact address or owner data.
// Keep the property fields in sync with web/src/lib/properties.ts.

const db = () => getFirestore();
const MAX_SCAN = 300;
const MAX_RESULTS = 6;
// "un depa de 3 millones": without explicit limits, look ±20% around that price.
const PRICE_SPAN = 0.2;

// Arguments come straight from the model, so numbers may arrive as strings.
export type InventoryFilters = {
  query?: string;
  operation?: string; // venta | renta
  propertyType?: string;
  city?: string;
  neighborhood?: string;
  bedroomsMin?: number | string;
  bathroomsMin?: number | string;
  parkingMin?: number | string;
  price?: number | string; // approximate budget (sale price, or monthly rent when operation=renta): closest first
  priceMin?: number | string;
  priceMax?: number | string;
  petsAllowed?: boolean | string;
  furnished?: boolean | string;
};

// Words people use for any listing, and filler: they must not be required in the text match.
const STOPWORDS = new Set(
  "inmueble inmuebles propiedad propiedades depa depas departamento departamentos casa casas renta rentar venta vender comprar de del el la los las un una unos unas con en y o para que tienen tiene hay algun alguna busco quiero precio pesos mxn mil millones k recamaras recamara cuartos".split(
    " ",
  ),
);

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
// "3,200,000", "$18000", "18 mil", "18k", "3.2 millones" → number. Unreadable values become undefined (no filter).
const num = (v: unknown) => {
  if (v === undefined || v === null || v === "") return undefined;
  const s = norm(v).replace(/[,\s$]/g, "");
  const m = /^(\d+(?:\.\d+)?)(millones|millon|mdp|mil|k|m)?$/.exec(s);
  if (!m) return undefined;
  const mult = !m[2] ? 1 : m[2] === "mil" || m[2] === "k" ? 1000 : 1_000_000;
  return Number(m[1]) * mult;
};
const yes = (v: unknown) => v === true || /^(true|si|sí|1)$/i.test(String(v ?? ""));

type PropertyDoc = {
  id: string;
  title?: string;
  propertyType?: string;
  operation?: "venta" | "renta" | "venta_renta";
  salePrice?: number | null;
  rentPrice?: number | null;
  maintenanceFee?: number | null;
  bedrooms?: number;
  bathrooms?: number;
  halfBathrooms?: number;
  parking?: number;
  builtArea?: number | null;
  landArea?: number | null;
  floor?: string;
  furnished?: boolean;
  petsAllowed?: boolean;
  development?: string;
  location?: { state?: string; city?: string; neighborhood?: string };
  amenities?: string[];
  photos?: { url: string }[];
};

const forSale = (v: PropertyDoc) => v.operation !== "renta";
const forRent = (v: PropertyDoc) => v.operation === "renta" || v.operation === "venta_renta";
const titleOf = (v: PropertyDoc) =>
  v.title || [v.propertyType, v.location?.neighborhood, v.location?.city].filter(Boolean).join(" · ") || "Inmueble";

async function available(uid: string): Promise<PropertyDoc[]> {
  const snap = await db().collection(propertiesCol(uid)).where("status", "==", "disponible").limit(MAX_SCAN).get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<PropertyDoc, "id">), id: d.id }));
}

/** The property of a visit: must exist and still be offered. Returns an error message otherwise. */
export async function bookingProperty(uid: string, propertyId: unknown): Promise<{ id: string; title: string } | { error: string }> {
  if (typeof propertyId !== "string" || !propertyId.trim() || propertyId.includes("/")) return { error: "Falta el inmueble (propertyId)" };
  const snap = await db().collection(propertiesCol(uid)).doc(propertyId.trim()).get();
  if (!snap.exists) return { error: "Ese inmueble no existe" };
  if (!["disponible", "apartado"].includes(snap.get("status"))) return { error: "Ese inmueble ya no está disponible" };
  return { id: snap.id, title: titleOf(snap.data() as PropertyDoc) };
}

/** Whether the account has anything on the market (the tool is only offered then). */
export async function hasInventory(uid: string) {
  return !(await db().collection(propertiesCol(uid)).where("status", "==", "disponible").limit(1).get()).empty;
}

/** Up to 6 available listings matching the filters: closest to the budget first, else cheapest first. */
export async function searchInventory(uid: string, f: InventoryFilters) {
  const op = norm(f.operation).startsWith("rent") ? "renta" : norm(f.operation).startsWith("vent") || norm(f.operation).startsWith("comp") ? "venta" : "";
  // Amounts typed into the text ("3200000", "18,000") are prices, not words to match.
  const tokens = norm([f.query].filter(Boolean).join(" "))
    .replace(/(\d),(\d{3})/g, "$1$2")
    .split(/[\s,]+/)
    .filter((w) => w && !STOPWORDS.has(w));
  const amount = tokens.map(Number).find((n) => n > 1000);
  const words = tokens.filter((w) => !/^\d+$/.test(w));
  const target = num(f.price) ?? (num(f.priceMin) || num(f.priceMax) ? undefined : amount);
  const priceMin = num(f.priceMin) ?? (target && !num(f.priceMax) ? target * (1 - PRICE_SPAN) : undefined);
  const priceMax = num(f.priceMax) ?? (target && !num(f.priceMin) ? target * (1 + PRICE_SPAN) : undefined);
  const type = norm(f.propertyType);
  const city = norm(f.city);
  const hood = norm(f.neighborhood);
  const bedroomsMin = num(f.bedroomsMin);
  const bathroomsMin = num(f.bathroomsMin);
  const parkingMin = num(f.parkingMin);
  // Without an explicit operation, a budget under 200k is a monthly rent.
  const rentMode = op === "renta" || (!op && (target ?? priceMax ?? priceMin ?? Infinity) < 200_000);
  const priceOf = (v: PropertyDoc) => (rentMode ? v.rentPrice : v.salePrice) ?? 0;
  const all = await available(uid);
  const matches = all
    .filter((v) => {
      if (op === "venta" && !forSale(v)) return false;
      if ((op === "renta" || rentMode) && !forRent(v)) return false;
      const text = norm(
        [v.title, v.propertyType, v.development, v.location?.neighborhood, v.location?.city, v.location?.state, ...(v.amenities ?? [])].join(" "),
      );
      if (words.some((w) => !text.includes(w))) return false;
      if (type && !norm(v.propertyType).startsWith(type.slice(0, 4))) return false;
      if (city && !norm([v.location?.city, v.location?.state].join(" ")).includes(city)) return false;
      if (hood && !norm(v.location?.neighborhood).includes(hood)) return false;
      if (bedroomsMin && (v.bedrooms ?? 0) < bedroomsMin) return false;
      if (bathroomsMin && (v.bathrooms ?? 0) + (v.halfBathrooms ?? 0) * 0.5 < bathroomsMin) return false;
      if (parkingMin && (v.parking ?? 0) < parkingMin) return false;
      if (yes(f.petsAllowed) && !v.petsAllowed) return false;
      if (yes(f.furnished) && !v.furnished) return false;
      const price = priceOf(v);
      if (priceMin && price < priceMin) return false;
      if (priceMax && price > priceMax) return false;
      return true;
    })
    .sort((a, b) =>
      target
        ? Math.abs(priceOf(a) - target) - Math.abs(priceOf(b) - target)
        : priceMax && !priceMin
          ? priceOf(b) - priceOf(a) // "hasta 20 mil": the best the budget gets first
          : priceOf(a) - priceOf(b),
    );
  return {
    total: matches.length,
    results: matches.slice(0, MAX_RESULTS).map((v) => ({
      propertyId: v.id,
      title: titleOf(v),
      propertyType: v.propertyType ?? null,
      operation: v.operation ?? "venta",
      salePrice: forSale(v) ? (v.salePrice ?? null) : null,
      rentPrice: forRent(v) ? (v.rentPrice ?? null) : null,
      maintenanceFee: v.maintenanceFee ?? null,
      currency: "MXN",
      bedrooms: v.bedrooms ?? 0,
      bathrooms: (v.bathrooms ?? 0) + (v.halfBathrooms ?? 0) * 0.5,
      parking: v.parking ?? 0,
      builtArea: v.builtArea ?? null,
      landArea: v.landArea ?? null,
      floor: v.floor || null,
      furnished: Boolean(v.furnished),
      petsAllowed: Boolean(v.petsAllowed),
      development: v.development || null,
      location: [v.location?.neighborhood, v.location?.city, v.location?.state].filter(Boolean).join(", ") || null,
      amenities: (v.amenities ?? []).slice(0, 8),
      photo: v.photos?.[0]?.url ?? null,
    })),
    note: matches.length
      ? null
      : "No hay inmuebles disponibles con esos filtros. Dilo con honestidad y ofrece alternativas cercanas (otra colonia, precio o número de recámaras) buscando de nuevo.",
  };
}

/** Prompt section: what is on the market right now, so the agent knows when to search. */
export async function inventorySection(uid: string) {
  const all = await available(uid);
  if (!all.length) return [];
  const types = [...new Set(all.map((v) => v.propertyType).filter(Boolean))].slice(0, 10);
  const cities = [...new Set(all.map((v) => v.location?.city).filter(Boolean))].slice(0, 15);
  const sale = all.filter(forSale).length;
  const rent = all.filter(forRent).length;
  return [
    "\n# INVENTARIO DE INMUEBLES",
    `Hay ${all.length} inmuebles disponibles (${sale} en venta, ${rent} en renta)${types.length ? `; tipos: ${types.join(", ")}` : ""}${cities.length ? `; ciudades: ${cities.join(", ")}` : ""}.`,
    "- Para cualquier pregunta sobre inmuebles disponibles, precios, rentas, recámaras, ubicación o amenidades usa SIEMPRE la herramienta search_inventory.",
    "- Indica operation='renta' o 'venta' cuando la persona lo diga. Si da un precio ('un depa de 3 millones', 'renta de 18 mil') usa price; si dice 'hasta' o 'menos de' usa priceMax; 'desde' usa priceMin. No metas precios en query.",
    "- Nunca menciones un inmueble, precio, renta o disponibilidad que no venga de search_inventory. Si no hay resultados, dilo y ofrece alternativas.",
    "- Da como máximo 3 opciones por mensaje: tipo, recámaras, baños, m², colonia y precio (o renta al mes, más mantenimiento si lo hay).",
    "- Nunca des la dirección exacta: solo colonia y ciudad. No negocies precios ni apartes inmuebles: si la persona quiere negociar, apartar o conocer el inmueble, ofrece agendar una visita (con la agenda si existe) o marca needsHuman=true.",
  ];
}
