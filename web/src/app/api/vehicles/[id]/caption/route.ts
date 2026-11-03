import { NextResponse } from "next/server";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { vehicleDoc } from "@/lib/firebase/paths";
import { requireAi } from "@/lib/knowledge-store";
import { llmText } from "@/lib/openrouter";
import { money } from "@/lib/vehicle-catalog";
import { toVehicleRow } from "@/lib/vehicles";

type Ctx = { params: Promise<{ id: string }> };

const SYSTEM = `Eres el community manager de una agencia/lote de autos en México. Escribes el texto de una publicación
para Facebook e Instagram que anuncia UN auto a la venta.
Reglas:
- Usa SOLO los datos que te doy; no inventes equipamiento, garantías, financiamiento ni promociones.
- Escribe el precio exactamente como viene.
- Español de México, tono cercano y vendedor, con 2-4 emojis bien puestos.
- Estructura: gancho en la primera línea, 3-6 viñetas con lo más atractivo (año, km, transmisión, equipamiento),
  precio, llamada a la acción ("Escríbenos por mensaje para agendar tu prueba de manejo").
- Termina con 3-6 hashtags relevantes (marca, modelo, ciudad, #AutosSeminuevos…).
- Máximo 900 caracteres. Devuelve solo el texto de la publicación.`;

// Post copy for one vehicle, written by the account's AI model from the vehicle data (never VIN/plates).
export const POST = withPerm<Ctx>("posts.create", async (req, user, { params }) => {
  const { id } = await params;
  const snap = await adminDb.doc(vehicleDoc(user.uid, id)).get();
  if (!snap.exists) throw new HttpError(404, "Auto no encontrado");
  const v = toVehicleRow(id, snap.data()!, false);
  const { tone } = (await req.json().catch(() => ({}))) as { tone?: string };
  const { ai, apiKey, model } = await requireAi(user.uid);
  const facts = [
    `Negocio: ${ai.brand.name || "—"}`,
    ai.brand.tone ? `Tono de la marca: ${ai.brand.tone}` : "",
    tone ? `Indicación para este post: ${String(tone).slice(0, 300)}` : "",
    `Auto: ${v.title}`,
    `Marca/modelo/versión: ${[v.brand, v.model, v.trim].filter(Boolean).join(" ")}`,
    `Año: ${v.year}`,
    `Condición: ${v.condition}`,
    v.km ? `Kilometraje: ${v.km.toLocaleString("es-MX")} km` : "",
    `Precio: ${money(v.price)} MXN`,
    v.transmission ? `Transmisión: ${v.transmission}` : "",
    v.fuel ? `Combustible: ${v.fuel}` : "",
    v.engine ? `Motor: ${v.engine} L` : "",
    v.bodyType ? `Carrocería: ${v.bodyType}` : "",
    v.color ? `Color: ${v.color}` : "",
    v.singleOwner ? "Único dueño" : "",
    v.location.city || v.location.state ? `Ubicación: ${[v.location.city, v.location.state].filter(Boolean).join(", ")}` : "",
    v.features.length ? `Equipamiento: ${v.features.join(", ")}` : "",
    v.description ? `Descripción del vendedor: ${v.description.slice(0, 1500)}` : "",
  ].filter(Boolean);
  const caption = await llmText(apiKey, model, SYSTEM, facts.join("\n"), 700, 0.7);
  return NextResponse.json({ caption: caption.slice(0, 2200) });
});
