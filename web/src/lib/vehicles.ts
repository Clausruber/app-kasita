import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { HttpError } from "@/lib/auth-guard";
import { BODY_TYPES, FEATURES, FUELS, TRACTIONS, TRANSMISSIONS, buildTitle, TITLE_MAX } from "@/lib/vehicle-catalog";
import type { Vehicle, VehicleHold, VehiclePhoto, VehicleReservation } from "@/lib/types";

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const iso = (v: unknown) => (v instanceof Timestamp ? v.toDate().toISOString() : null);
const oneOf = (v: unknown, list: readonly string[]) => (typeof v === "string" && list.includes(v) ? v : "");

function int(v: unknown, label: string, min: number, max: number) {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s$]/g, ""));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} no válido`);
  return Math.round(n);
}

function reservationOf(r: FirebaseFirestore.DocumentData | null | undefined): VehicleReservation | null {
  if (!r) return null;
  return { dealId: r.dealId ?? "", amount: r.amount ?? 0, at: iso(r.at) ?? "", expiresAt: iso(r.expiresAt) ?? "" };
}
export { reservationOf };

/** Serialises a vehicle doc; VIN and plates are blanked for viewers without `inventory.private`. */
/** Active hold only: once `until` passes the notice disappears (nothing to clean up). */
export function holdOf(h: FirebaseFirestore.DocumentData | null | undefined): VehicleHold | null {
  const until = h?.until?.toDate?.() as Date | undefined;
  if (!until || until.getTime() <= Date.now()) return null;
  return { byId: String(h!.byId ?? ""), byName: String(h!.byName ?? ""), until: until.toISOString(), note: String(h!.note ?? "") };
}

export function toVehicleRow(id: string, d: FirebaseFirestore.DocumentData, showPrivate: boolean): Vehicle {
  const photos: VehiclePhoto[] = Array.isArray(d.photos) ? d.photos : [];
  return {
    id,
    ...(d.demo ? { demo: true } : {}),
    status: d.status ?? "borrador",
    brand: d.brand ?? "",
    model: d.model ?? "",
    year: d.year ?? 0,
    trim: d.trim ?? "",
    km: d.km ?? 0,
    price: d.price ?? 0,
    currency: "MXN",
    condition: d.condition === "nuevo" ? "nuevo" : "usado",
    bodyType: d.bodyType ?? "",
    fuel: d.fuel ?? "",
    transmission: d.transmission ?? "",
    doors: d.doors ?? 4,
    color: d.color ?? "",
    engine: d.engine ?? "",
    traction: d.traction ?? "",
    vin: showPrivate ? (d.vin ?? "") : "",
    plates: showPrivate ? (d.plates ?? "") : "",
    singleOwner: Boolean(d.singleOwner),
    location: { state: d.location?.state ?? "", city: d.location?.city ?? "" },
    description: d.description ?? "",
    features: Array.isArray(d.features) ? d.features : [],
    title: d.title ?? "",
    stockNumber: d.stockNumber ?? "",
    photos,
    mlPermalink: d.mlPermalink ?? null,
    reservation: reservationOf(d.reservation),
    hold: holdOf(d.hold),
    intakeDate: iso(d.intakeDate) ?? new Date().toISOString(),
    soldAt: iso(d.soldAt),
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  };
}

/**
 * Validates the editable fields of a vehicle (create or full edit). Status may only be borrador or
 * disponible here: apartado / vendido go through the deal endpoints, which keep vehicle and deal in sync.
 * VIN and plates are only taken from users allowed to see them.
 */
export function parseVehicleInput(body: Record<string, unknown>, canPrivate: boolean) {
  const year = int(body.year, "Año", 1950, new Date().getFullYear() + 1);
  const brand = clip(body.brand, 40);
  const model = clip(body.model, 60);
  if (!brand || !model) throw new HttpError(400, "Marca y modelo son obligatorios");
  const trim = clip(body.trim, 60);
  const vin = clip(body.vin, 17).toUpperCase().replace(/\s/g, "");
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new HttpError(400, "El VIN debe tener 17 caracteres (sin I, O ni Q)");
  const intake = typeof body.intakeDate === "string" && body.intakeDate ? new Date(body.intakeDate) : new Date();
  if (Number.isNaN(intake.getTime())) throw new HttpError(400, "Fecha de ingreso no válida");
  const features = (Array.isArray(body.features) ? body.features : []).filter((f): f is string => typeof f === "string" && FEATURES.includes(f));
  const status = body.status === "disponible" ? "disponible" : "borrador";
  const title = clip(body.title, TITLE_MAX) || buildTitle({ brand, model, trim, year });
  return {
    status,
    brand,
    model,
    year,
    trim,
    km: int(body.km ?? 0, "Kilometraje", 0, 2_000_000),
    price: int(body.price, "Precio", 1, 100_000_000),
    currency: "MXN" as const,
    condition: body.condition === "nuevo" ? "nuevo" : "usado",
    bodyType: oneOf(body.bodyType, BODY_TYPES),
    fuel: oneOf(body.fuel, FUELS),
    transmission: oneOf(body.transmission, TRANSMISSIONS),
    doors: int(body.doors ?? 4, "Puertas", 2, 6),
    color: clip(body.color, 30),
    engine: clip(body.engine, 10),
    traction: oneOf(body.traction, TRACTIONS),
    singleOwner: Boolean(body.singleOwner),
    location: {
      state: clip((body.location as { state?: unknown } | undefined)?.state, 40),
      city: clip((body.location as { city?: unknown } | undefined)?.city, 60),
    },
    description: clip(body.description, 5000),
    features,
    title,
    stockNumber: clip(body.stockNumber, 30),
    intakeDate: Timestamp.fromDate(intake),
    ...(canPrivate ? { vin, plates: clip(body.plates, 12).toUpperCase() } : {}),
  };
}
