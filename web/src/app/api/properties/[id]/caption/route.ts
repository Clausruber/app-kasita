import { NextResponse } from "next/server";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { propertyDoc } from "@/lib/firebase/paths";
import { requireAi } from "@/lib/knowledge-store";
import { llmText } from "@/lib/openrouter";
import { toPropertyRow } from "@/lib/properties";
import { propertyFacts } from "@/lib/property-facts";

type Ctx = { params: Promise<{ id: string }> };

const SYSTEM = `Eres el community manager de una inmobiliaria en México. Escribes el texto de una publicación
para Facebook e Instagram que anuncia UN inmueble en venta o renta.
Reglas:
- Usa SOLO los datos que te doy; no inventes amenidades, acabados, financiamiento ni promociones.
- Escribe los precios exactamente como vienen (la renta es mensual). Nunca des la dirección exacta: solo colonia y ciudad.
- Español de México, tono cercano y profesional, con 2-4 emojis bien puestos.
- Estructura: gancho en la primera línea, 3-6 viñetas con lo más atractivo (recámaras, baños, m², estacionamiento,
  amenidades, ubicación), precio, llamada a la acción ("Escríbenos por mensaje para agendar tu visita").
- Termina con 3-6 hashtags relevantes (tipo de inmueble, operación, colonia, ciudad, #Inmuebles…).
- Máximo 900 caracteres. Devuelve solo el texto de la publicación.`;

// Post copy for one property, written by the account's AI model from the listing data (never the exact address or owner).
export const POST = withPerm<Ctx>("posts.create", async (req, user, { params }) => {
  const { id } = await params;
  const snap = await adminDb.doc(propertyDoc(user.uid, id)).get();
  if (!snap.exists) throw new HttpError(404, "Inmueble no encontrado");
  const v = toPropertyRow(id, snap.data()!, false);
  const { tone } = (await req.json().catch(() => ({}))) as { tone?: string };
  const { ai, apiKey, model } = await requireAi(user.uid);
  const facts = [
    `Negocio: ${ai.brand.name || "—"}`,
    ai.brand.tone ? `Tono de la marca: ${ai.brand.tone}` : "",
    tone ? `Indicación para este post: ${String(tone).slice(0, 300)}` : "",
    ...propertyFacts(v, { includeTitle: true }),
  ].filter(Boolean);
  const caption = await llmText(apiKey, model, SYSTEM, facts.join("\n"), 700, 0.7);
  return NextResponse.json({ caption: caption.slice(0, 2200) });
});
