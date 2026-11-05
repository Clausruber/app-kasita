import GUADALAJARA from "@/lib/demo-guadalajara.json";

// Test listings for Propiedades → Datos de prueba: 30 fictitious properties in the Guadalajara metro area
// (70 % residential), each with map coordinates. Loaded with `demo: true` so they can be wiped in one go.
// Coordinates are approximate (colonia centre plus a small fixed offset), never a real address.

const STREETS = ["Av. Vallarta", "Av. Chapultepec", "Av. México", "Av. Patria", "Calle Libertad", "Av. Américas"];

/** The i-th demo property as API input (passes through parsePropertyInput like any other listing). */
export function demoProperty(i: number) {
  const p = GUADALAJARA[i]; // `category` (residencial/comercial) is ignored by parsePropertyInput
  const intake = new Date(Date.now() - ((i * 37) % 120) * 86_400_000); // 0–120 days on the market
  const rents = p.operation !== "venta";
  return {
    ...p,
    yearBuilt: p.propertyType === "Terreno" ? null : new Date().getFullYear() - ((i * 3) % 25),
    availableFrom: rents ? new Date(Date.now() + ((i * 5) % 45) * 86_400_000).toISOString() : null,
    address: p.propertyType === "Terreno" ? "" : `${STREETS[i % STREETS.length]} ${100 + ((i * 37) % 900)}`,
    unit: p.propertyType === "Departamento" || p.propertyType === "Oficina" ? `${p.floor}0${1 + (i % 4)}` : "",
    ownerName: "Propietario de prueba",
    ownerPhone: "",
    intakeDate: intake.toISOString(),
  };
}

export const DEMO_COUNT = GUADALAJARA.length;

// Stock photos in /public/demo-photos (Unsplash License, see CREDITS.md) with their pixel size.
export const DEMO_PHOTO_SIZE: Record<string, [number, number]> = {
  "sala-1": [1600, 900], "sala-2": [1067, 1600], "sala-3": [1600, 846],
  "cocina-1": [1600, 900], "cocina-2": [1600, 1280],
  "recamara-1": [1600, 1067], "recamara-2": [1600, 1600],
  "bano-1": [1200, 1600], "bano-2": [1200, 1600],
  "casa-1": [1600, 900], "casa-2": [1600, 1060], "casa-3": [1600, 1200], "casa-4": [1600, 1600],
  "edificio-1": [1600, 1067], "edificio-2": [1600, 1600],
  "alberca-1": [1600, 900], "gimnasio-1": [1600, 900], "gimnasio-2": [1600, 1067],
  "local-1": [1600, 1100], "local-2": [1067, 1600],
  "oficina-1": [1600, 1067], "oficina-2": [1600, 1067],
  "bodega-1": [1600, 1067], "bodega-2": [1600, 1067],
  "terreno-1": [1600, 900],
};

const pick = (list: string[], i: number) => list[i % list.length];

/** Photo names for the i-th demo property, cover first; deterministic so every load looks the same. */
export function demoPhotos(i: number): string[] {
  const p = GUADALAJARA[i];
  const has = (a: string) => (p.amenities as string[]).includes(a);
  const amenity = [has("Alberca") ? "alberca-1" : "", has("Gimnasio") ? pick(["gimnasio-1", "gimnasio-2"], i) : ""].filter(Boolean);
  switch (p.propertyType) {
    case "Departamento":
      return [
        pick(["sala-1", "sala-3"], i),
        pick(["cocina-2", "cocina-1"], i),
        pick(["recamara-1", "recamara-2"], i),
        pick(["bano-1", "bano-2"], i),
        ...(amenity.length ? amenity.slice(0, 1) : [pick(["edificio-1", "edificio-2"], i)]),
      ];
    case "Casa":
    case "Casa en condominio":
      return [
        pick(["casa-1", "casa-4", "casa-2", "casa-3"], i),
        pick(["sala-3", "sala-1", "sala-2"], i),
        pick(["cocina-2", "cocina-1"], i),
        pick(["recamara-2", "recamara-1"], i),
        ...amenity.slice(0, 1),
      ];
    case "Local comercial":
      return [pick(["local-1", "local-2"], i), pick(["local-2", "local-1"], i)];
    case "Oficina":
      return [pick(["oficina-1", "oficina-2"], i), pick(["oficina-2", "oficina-1"], i), pick(["edificio-2", "edificio-1"], i)];
    case "Bodega":
      return [pick(["bodega-1", "bodega-2"], i), pick(["bodega-2", "bodega-1"], i)];
    default: // Terreno
      return ["terreno-1"];
  }
}
