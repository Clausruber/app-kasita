// Mercado Libre México mapping for vehicles (category "Autos y Camionetas").
// Phase 1 only builds a copy-ready sheet; `toMlAttributes` is the payload a future API publish will send.
// TODO verificar: attribute ids and accepted values against
//   GET https://api.mercadolibre.com/categories/MLM1744/attributes
// Some attributes take a `value_id` from a closed list (brand and model are hierarchical), so the
// publisher will have to resolve names to ids; keeping every mapping here makes that a one-file change.
import type { Vehicle } from "@/lib/types";
import { money } from "@/lib/vehicle-catalog";

export const ML_CATEGORY = "MLM1744";

type Attr = { field: keyof Vehicle | "condition"; mlId: string; label: string; unit?: string };
export const ML_ATTRIBUTE_MAP: Attr[] = [
  { field: "brand", mlId: "BRAND", label: "Marca" },
  { field: "model", mlId: "MODEL", label: "Modelo" },
  { field: "year", mlId: "VEHICLE_YEAR", label: "Año" },
  { field: "trim", mlId: "TRIM", label: "Versión" },
  { field: "km", mlId: "KILOMETERS", label: "Kilómetros", unit: "km" },
  { field: "fuel", mlId: "FUEL_TYPE", label: "Tipo de combustible" },
  { field: "transmission", mlId: "TRANSMISSION", label: "Transmisión" },
  { field: "doors", mlId: "DOORS", label: "Puertas" },
  { field: "color", mlId: "COLOR", label: "Color" },
  { field: "engine", mlId: "ENGINE_DISPLACEMENT", label: "Motor", unit: "L" },
  { field: "traction", mlId: "TRACTION_CONTROL", label: "Tracción" },
  { field: "bodyType", mlId: "VEHICLE_BODY_TYPE", label: "Tipo de carrocería" },
  { field: "singleOwner", mlId: "SINGLE_OWNER", label: "Único dueño" },
  { field: "condition", mlId: "ITEM_CONDITION", label: "Condición" },
];

function valueOf(v: Vehicle, a: Attr): string {
  const raw = v[a.field as keyof Vehicle];
  if (a.field === "singleOwner") return v.singleOwner ? "Sí" : "No";
  if (a.field === "condition") return v.condition === "nuevo" ? "Nuevo" : "Usado";
  if (raw === "" || raw == null || raw === 0) return "";
  return a.unit ? `${raw} ${a.unit}` : String(raw);
}

/** Attributes for the ML items API ({ id, value_name }); empty values are left out. */
export function toMlAttributes(v: Vehicle) {
  return ML_ATTRIBUTE_MAP.map((a) => ({ id: a.mlId, value_name: valueOf(v, a) })).filter((a) => a.value_name);
}

/** Plain-text sheet in the order ML's form asks for it, for the "Copiar para Mercado Libre" button. */
export function toMlSheet(v: Vehicle) {
  const lines = [
    `Título: ${v.title}`,
    `Precio: ${money(v.price)} MXN`,
    `Categoría: Autos y Camionetas (${ML_CATEGORY})`,
    "",
    ...ML_ATTRIBUTE_MAP.map((a) => [a.label, valueOf(v, a)] as const)
      .filter(([, val]) => val)
      .map(([label, val]) => `${label}: ${val}`),
    v.location.city || v.location.state ? `Ubicación: ${[v.location.city, v.location.state].filter(Boolean).join(", ")}` : "",
    "",
    v.description,
    v.features.length ? `\nEquipamiento:\n${v.features.map((f) => `• ${f}`).join("\n")}` : "",
  ];
  return lines.filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n").trim();
}

/** Fields ML requires that this vehicle is still missing (shown as a checklist before copying). */
export function mlMissing(v: Vehicle) {
  const req: [string, unknown][] = [
    ["Marca", v.brand],
    ["Modelo", v.model],
    ["Año", v.year],
    ["Versión", v.trim],
    ["Kilómetros", v.condition === "nuevo" || v.km > 0],
    ["Precio", v.price],
    ["Combustible", v.fuel],
    ["Transmisión", v.transmission],
    ["Carrocería", v.bodyType],
    ["Color", v.color],
    ["Ubicación", v.location.state && v.location.city],
    ["Fotos (mínimo 6 recomendado)", v.photos.length >= 6],
  ];
  return req.filter(([, ok]) => !ok).map(([label]) => label);
}
