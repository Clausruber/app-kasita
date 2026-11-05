import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { HttpError } from "@/lib/auth-guard";
import { AMENITIES, HIGHLIGHT_MAX, MAX_HIGHLIGHTS, OPERATIONS, PROPERTY_TYPES, buildTitle, forRent, forSale, TITLE_MAX } from "@/lib/property-catalog";
import type { Operation, Property, PropertyHold, PropertyLease, PropertyPhoto, PropertyReservation } from "@/lib/types";

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const iso = (v: unknown) => (v instanceof Timestamp ? v.toDate().toISOString() : null);
const oneOf = (v: unknown, list: readonly string[]) => (typeof v === "string" && list.includes(v) ? v : "");

function int(v: unknown, label: string, min: number, max: number) {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s$]/g, ""));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} no válido`);
  return Math.round(n);
}

function reservationOf(r: FirebaseFirestore.DocumentData | null | undefined): PropertyReservation | null {
  if (!r) return null;
  return { dealId: r.dealId ?? "", amount: r.amount ?? 0, at: iso(r.at) ?? "", expiresAt: iso(r.expiresAt) ?? "" };
}
export { reservationOf };

function leaseOf(l: FirebaseFirestore.DocumentData | null | undefined): PropertyLease | null {
  if (!l) return null;
  return {
    dealId: l.dealId ?? "",
    monthlyRent: l.monthlyRent ?? 0,
    deposit: l.deposit ?? 0,
    months: l.months ?? 0,
    start: iso(l.start) ?? "",
    end: iso(l.end) ?? "",
  };
}

/** Active hold only: once `until` passes the notice disappears (nothing to clean up). */
export function holdOf(h: FirebaseFirestore.DocumentData | null | undefined): PropertyHold | null {
  const until = h?.until?.toDate?.() as Date | undefined;
  if (!until || until.getTime() <= Date.now()) return null;
  return { byId: String(h!.byId ?? ""), byName: String(h!.byName ?? ""), until: until.toISOString(), note: String(h!.note ?? "") };
}

/** Serialises a property doc; exact address and owner data are blanked for viewers without `inventory.private`. */
export function toPropertyRow(id: string, d: FirebaseFirestore.DocumentData, showPrivate: boolean): Property {
  const photos: PropertyPhoto[] = Array.isArray(d.photos) ? d.photos : [];
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    id,
    ...(d.demo ? { demo: true } : {}),
    status: d.status ?? "borrador",
    propertyType: d.propertyType ?? "",
    operation: d.operation ?? "venta",
    salePrice: num(d.salePrice),
    rentPrice: num(d.rentPrice),
    maintenanceFee: num(d.maintenanceFee),
    currency: "MXN",
    bedrooms: d.bedrooms ?? 0,
    bathrooms: d.bathrooms ?? 0,
    halfBathrooms: d.halfBathrooms ?? 0,
    parking: d.parking ?? 0,
    builtArea: num(d.builtArea),
    landArea: num(d.landArea),
    floor: d.floor ?? "",
    yearBuilt: num(d.yearBuilt),
    furnished: Boolean(d.furnished),
    petsAllowed: Boolean(d.petsAllowed),
    availableFrom: iso(d.availableFrom),
    development: d.development ?? "",
    location: {
      state: d.location?.state ?? "",
      city: d.location?.city ?? "",
      neighborhood: d.location?.neighborhood ?? "",
      lat: num(d.location?.lat),
      lng: num(d.location?.lng),
    },
    address: showPrivate ? (d.address ?? "") : "",
    unit: showPrivate ? (d.unit ?? "") : "",
    ownerName: showPrivate ? (d.ownerName ?? "") : "",
    ownerPhone: showPrivate ? (d.ownerPhone ?? "") : "",
    description: d.description ?? "",
    amenities: Array.isArray(d.amenities) ? d.amenities : [],
    highlights: Array.isArray(d.highlights) ? d.highlights : [],
    title: d.title ?? "",
    stockNumber: d.stockNumber ?? "",
    photos,
    reservation: reservationOf(d.reservation),
    lease: leaseOf(d.lease),
    hold: holdOf(d.hold),
    intakeDate: iso(d.intakeDate) ?? new Date().toISOString(),
    closedAt: iso(d.closedAt),
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  };
}

/** Map pin: both numbers in range, or both null (no pin). */
function coordsOf(lat: unknown, lng: unknown) {
  const none = (v: unknown) => v === null || v === undefined || v === "";
  if (none(lat) && none(lng)) return { lat: null, lng: null };
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) throw new HttpError(400, "Coordenadas no válidas");
  return { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(b * 1e6) / 1e6 };
}

function optInt(v: unknown, label: string, min: number, max: number) {
  return v === null || v === undefined || v === "" ? null : int(v, label, min, max);
}
function optDate(v: unknown, label: string) {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label} no válida`);
  return Timestamp.fromDate(d);
}

/**
 * Validates the editable fields of a property (create or full edit). Status may only be borrador or
 * disponible here: apartado / vendido / rentado go through the deal endpoints, which keep property and
 * deal in sync. Exact address and owner data are only taken from users allowed to see them.
 */
export function parsePropertyInput(body: Record<string, unknown>, canPrivate: boolean) {
  const propertyType = oneOf(body.propertyType, PROPERTY_TYPES);
  if (!propertyType) throw new HttpError(400, "Elige el tipo de inmueble");
  const operation = oneOf(body.operation, OPERATIONS.map((o) => o.id)) as Operation | "";
  if (!operation) throw new HttpError(400, "Elige si es venta, renta o ambas");
  const salePrice = forSale(operation) ? int(body.salePrice, "Precio de venta", 1, 2_000_000_000) : null;
  const rentPrice = forRent(operation) ? int(body.rentPrice, "Renta mensual", 1, 10_000_000) : null;
  const loc = (body.location ?? {}) as { state?: unknown; city?: unknown; neighborhood?: unknown; lat?: unknown; lng?: unknown };
  const location = { state: clip(loc.state, 40), city: clip(loc.city, 60), neighborhood: clip(loc.neighborhood, 80), ...coordsOf(loc.lat, loc.lng) };
  if (!location.city) throw new HttpError(400, "La ciudad es obligatoria");
  const bedrooms = int(body.bedrooms ?? 0, "Recámaras", 0, 20);
  const intake = typeof body.intakeDate === "string" && body.intakeDate ? new Date(body.intakeDate) : new Date();
  if (Number.isNaN(intake.getTime())) throw new HttpError(400, "Fecha de alta no válida");
  const amenities = (Array.isArray(body.amenities) ? body.amenities : []).filter((f): f is string => typeof f === "string" && AMENITIES.includes(f));
  const highlights = [
    ...new Set((Array.isArray(body.highlights) ? body.highlights : []).map((h) => clip(h, HIGHLIGHT_MAX)).filter(Boolean)),
  ].slice(0, MAX_HIGHLIGHTS);
  const status = body.status === "disponible" ? "disponible" : "borrador";
  const title = clip(body.title, TITLE_MAX) || buildTitle({ propertyType, operation, bedrooms, location });
  return {
    status,
    propertyType,
    operation,
    salePrice,
    rentPrice,
    maintenanceFee: optInt(body.maintenanceFee, "Mantenimiento", 0, 1_000_000),
    currency: "MXN" as const,
    bedrooms,
    bathrooms: int(body.bathrooms ?? 0, "Baños", 0, 20),
    halfBathrooms: int(body.halfBathrooms ?? 0, "Medios baños", 0, 10),
    parking: int(body.parking ?? 0, "Estacionamientos", 0, 50),
    builtArea: optInt(body.builtArea, "Superficie construida", 0, 1_000_000),
    landArea: optInt(body.landArea, "Superficie de terreno", 0, 10_000_000),
    floor: clip(body.floor, 10),
    yearBuilt: optInt(body.yearBuilt, "Año de construcción", 1800, new Date().getFullYear() + 5),
    furnished: Boolean(body.furnished),
    petsAllowed: Boolean(body.petsAllowed),
    availableFrom: forRent(operation) ? optDate(body.availableFrom, "Fecha de disponibilidad") : null,
    development: clip(body.development, 80),
    location,
    description: clip(body.description, 5000),
    amenities,
    highlights,
    title,
    stockNumber: clip(body.stockNumber, 30),
    intakeDate: Timestamp.fromDate(intake),
    ...(canPrivate
      ? { address: clip(body.address, 160), unit: clip(body.unit, 20), ownerName: clip(body.ownerName, 80), ownerPhone: clip(body.ownerPhone, 30) }
      : {}),
  };
}
