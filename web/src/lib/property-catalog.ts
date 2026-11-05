// Option lists for the property form (shared by the UI and the API). Values are what we store, in Spanish
// as Mexican listing portals show them.
import type { CloseKind, DealStage, Operation, Property, PropertyStatus } from "@/lib/types";

export const PROPERTY_STATUS: { id: PropertyStatus; label: string }[] = [
  { id: "borrador", label: "Borrador" },
  { id: "disponible", label: "Disponible" },
  { id: "apartado", label: "Apartado" },
  { id: "vendido", label: "Vendido" },
  { id: "rentado", label: "Rentado" },
];
export const statusLabel = (s: string) => PROPERTY_STATUS.find((x) => x.id === s)?.label ?? s;

export const PROPERTY_TYPES = ["Departamento", "Casa", "Casa en condominio", "Terreno", "Local comercial", "Oficina", "Bodega"];
export const OPERATIONS: { id: Operation; label: string }[] = [
  { id: "venta", label: "Venta" },
  { id: "renta", label: "Renta" },
  { id: "venta_renta", label: "Venta y renta" },
];
export const operationLabel = (o: string) => OPERATIONS.find((x) => x.id === o)?.label ?? o;
export const forSale = (o: Operation) => o === "venta" || o === "venta_renta";
export const forRent = (o: Operation) => o === "renta" || o === "venta_renta";

export const AMENITIES = [
  "Alberca",
  "Gimnasio",
  "Elevador",
  "Seguridad 24 h",
  "Acceso controlado",
  "Roof garden",
  "Terraza",
  "Balcón",
  "Jardín",
  "Áreas verdes",
  "Juegos infantiles",
  "Salón de usos múltiples",
  "Business center",
  "Cocina integral",
  "Cuarto de servicio",
  "Cuarto de lavado",
  "Bodega",
  "Aire acondicionado",
  "Calefacción",
  "Calentador solar",
  "Paneles solares",
  "Cisterna",
  "Estacionamiento para visitas",
  "Pet friendly",
  "Vista panorámica",
];

export const MX_STATES = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua", "Ciudad de México", "Coahuila",
  "Colima", "Durango", "Estado de México", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit",
  "Nuevo León", "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas",
  "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas",
];

export const TITLE_MAX = 80;
export const MAX_HIGHLIGHTS = 10;
export const HIGHLIGHT_MAX = 120; // characters per highlight
/** "Departamento en renta · 2 rec · Narvarte, Ciudad de México" */
export const buildTitle = (p: Pick<Property, "propertyType" | "operation" | "bedrooms" | "location">) => {
  const op = p.operation === "venta_renta" ? "en venta o renta" : `en ${p.operation}`;
  const place = [p.location.neighborhood, p.location.city].map((s) => s.trim()).filter(Boolean).join(", ");
  return [`${p.propertyType || "Inmueble"} ${op}`, p.bedrooms ? `${p.bedrooms} rec` : "", place]
    .filter(Boolean)
    .join(" · ")
    .slice(0, TITLE_MAX);
};

/** Short specs line: "2 rec · 2 baños · 1 est · 85 m²" (empty parts are skipped). */
export function specsLine(p: Pick<Property, "bedrooms" | "bathrooms" | "halfBathrooms" | "parking" | "builtArea" | "landArea">) {
  const baths = p.bathrooms + p.halfBathrooms * 0.5;
  const area = p.builtArea || p.landArea;
  return [
    p.bedrooms ? `${p.bedrooms} rec` : "",
    baths ? `${baths} ${baths === 1 ? "baño" : "baños"}` : "",
    p.parking ? `${p.parking} est` : "",
    area ? `${area.toLocaleString("es-MX")} m²` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export const MAX_PHOTOS = 30;

// Thumbnails for lists and pickers: ~30–60 KB instead of the 1920 px photo.
export const THUMB_SIDE = 480;
export const THUMB_QUALITY = 0.75;
/** Storage path of a photo's thumbnail: same folder, "{name}_thumb.jpg". */
export const thumbPathOf = (path: string) => path.replace(/\.[a-z0-9]+$/i, "") + "_thumb.jpg";
/** The URL to show a photo small: its thumbnail when it has one, else the photo itself. */
export const thumbOf = (p: { url: string; thumb?: string } | undefined) => p?.thumb || p?.url || "";

export const daysOnMarket = (intakeDate: string, closedAt?: string | null) =>
  Math.max(0, Math.floor(((closedAt ? new Date(closedAt) : new Date()).getTime() - new Date(intakeDate).getTime()) / 86_400_000));

export const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);

/** Price as shown on cards: "$3,200,000" for sale, "$18,000/mes" for rent, both when it is offered both ways. */
export function priceLine(p: Pick<Property, "operation" | "salePrice" | "rentPrice">) {
  return [forSale(p.operation) ? money(p.salePrice) : "", forRent(p.operation) ? `${money(p.rentPrice)}/mes` : ""]
    .filter(Boolean)
    .join(" · ");
}
/** The main price of a property (sale price, or monthly rent for rent-only). */
export const mainPrice = (p: Pick<Property, "operation" | "salePrice" | "rentPrice">) =>
  forSale(p.operation) ? p.salePrice : p.rentPrice;

export const DEAL_STAGES: { id: DealStage; label: string }[] = [
  { id: "nuevo", label: "Nuevo" },
  { id: "contactado", label: "Contactado" },
  { id: "visita", label: "Visita" },
  { id: "negociacion", label: "Negociación" },
  { id: "apartado", label: "Apartado" },
  { id: "vendido", label: "Cerrado" },
  { id: "perdido", label: "Perdido" },
];
export const stageLabel = (s: string) => DEAL_STAGES.find((x) => x.id === s)?.label ?? s;
// Stages only reachable through the apartado / cierre dialogs (they change the property too).
export const GUARDED_STAGES: DealStage[] = ["apartado", "vendido"];

export const CLOSE_KINDS: { id: CloseKind; label: string }[] = [
  { id: "venta", label: "Venta" },
  { id: "renta", label: "Renta" },
];

export const PAYMENT_METHODS = [
  { id: "contado", label: "Contado" },
  { id: "hipotecario", label: "Crédito hipotecario bancario" },
  { id: "infonavit", label: "Infonavit / Fovissste" },
  { id: "cofinanciamiento", label: "Cofinanciamiento" },
] as const;

export const LEASE_MONTHS = [6, 12, 18, 24, 36];
