import { forRent, forSale, money, operationLabel } from "@/lib/property-catalog";
import type { Property } from "@/lib/types";

/** What the AI may know about a property: never the exact address, unit, owner or internal stock number. */
export type PropertyFactsInput = Pick<
  Property,
  | "title"
  | "propertyType"
  | "operation"
  | "salePrice"
  | "rentPrice"
  | "maintenanceFee"
  | "bedrooms"
  | "bathrooms"
  | "halfBathrooms"
  | "parking"
  | "builtArea"
  | "landArea"
  | "floor"
  | "yearBuilt"
  | "furnished"
  | "petsAllowed"
  | "development"
  | "amenities"
  | "highlights"
  | "description"
> & { location: Pick<Property["location"], "state" | "city" | "neighborhood"> };

/** One fact per line, for the AI prompts (post copy, listing title and description). Empty fields are skipped. */
export function propertyFacts(v: PropertyFactsInput, opts: { includeTitle?: boolean } = {}): string[] {
  return [
    opts.includeTitle && v.title ? `Inmueble: ${v.title}` : "",
    `Tipo: ${v.propertyType}`,
    `Operación: ${operationLabel(v.operation)}`,
    forSale(v.operation) && v.salePrice ? `Precio de venta: ${money(v.salePrice)} MXN` : "",
    forRent(v.operation) && v.rentPrice ? `Renta mensual: ${money(v.rentPrice)} MXN` : "",
    v.maintenanceFee ? `Mantenimiento: ${money(v.maintenanceFee)} al mes` : "",
    v.bedrooms ? `Recámaras: ${v.bedrooms}` : "",
    v.bathrooms || v.halfBathrooms ? `Baños: ${v.bathrooms}${v.halfBathrooms ? ` y ${v.halfBathrooms} medio(s)` : ""}` : "",
    v.parking ? `Estacionamientos: ${v.parking}` : "",
    v.builtArea ? `Construcción: ${v.builtArea} m²` : "",
    v.landArea ? `Terreno: ${v.landArea} m²` : "",
    v.floor ? `Piso: ${v.floor}` : "",
    v.yearBuilt ? `Año de construcción: ${v.yearBuilt}` : "",
    v.furnished ? "Amueblado" : "",
    v.petsAllowed ? "Acepta mascotas" : "",
    v.development ? `Desarrollo: ${v.development}` : "",
    `Ubicación: ${[v.location.neighborhood, v.location.city, v.location.state].filter(Boolean).join(", ")}`,
    v.amenities.length ? `Amenidades: ${v.amenities.join(", ")}` : "",
    v.highlights?.length ? `Puntos fuertes (en orden de importancia):\n${v.highlights.map((h) => `- ${h}`).join("\n")}` : "",
    v.description ? `Descripción del asesor: ${v.description.slice(0, 1500)}` : "",
  ].filter(Boolean);
}
