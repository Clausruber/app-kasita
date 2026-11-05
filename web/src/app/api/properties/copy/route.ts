import { NextResponse } from "next/server";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { requireAi } from "@/lib/knowledge-store";
import { llmText } from "@/lib/openrouter";
import { parsePropertyInput } from "@/lib/properties";
import { TITLE_MAX } from "@/lib/property-catalog";
import { propertyFacts } from "@/lib/property-facts";

const SYSTEM = `Eres un copywriter inmobiliario profesional en México. Escribes el título y la descripción de un anuncio
de UN inmueble para portales inmobiliarios, la ficha de la propiedad y las cotizaciones que reciben los clientes.

Reglas de contenido:
- Usa SOLO los datos que te doy. No inventes acabados, vistas, iluminación, cercanías, amenidades, antigüedad,
  financiamiento ni promociones. Si un dato no está, no lo menciones.
- Los "Puntos fuertes" son lo más valioso: ábrelos y desarróllalos en el orden dado.
- Si hay una "Descripción del asesor", tómala como fuente de hechos y mejórala; no agregues datos que no estén.
- Nunca des la dirección exacta: solo colonia, ciudad y estado. Escribe los precios exactamente como vienen
  (la renta es mensual).

Título:
- Máximo ${TITLE_MAX} caracteres. Sin emojis, sin signos de exclamación, sin MAYÚSCULAS sostenidas.
- Incluye el tipo de inmueble, la operación (venta/renta), la colonia o ciudad y el punto fuerte más atractivo.

Descripción:
- Español de México, tono profesional y cálido, persuasivo sin exagerar. Sin emojis ni hashtags.
- 120 a 220 palabras en 3-4 párrafos cortos: apertura con el punto más fuerte; puntos fuertes y características
  (recámaras, baños, m², estacionamiento); amenidades y ubicación; cierre invitando a agendar una visita.

Responde SOLO con JSON válido, sin texto adicional: {"title": "...", "description": "..."}`;

/** `{"title": …, "description": …}` from the model, tolerating a ```json fence or text around it. */
function parseCopy(text: string) {
  const raw = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  try {
    const o = JSON.parse(json) as { title?: unknown; description?: unknown };
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const description = typeof o.description === "string" ? o.description.trim() : "";
    if (title && description) return { title: title.slice(0, TITLE_MAX), description: description.slice(0, 5000) };
  } catch {
    // falls through to the error below
  }
  throw new HttpError(502, "No se pudo generar el texto, intenta de nuevo");
}

/**
 * Listing title + description written by the account's AI model from the property form as it is now
 * (it may not be saved yet). Validated like a save, without the private fields (address, owner).
 */
export const POST = withPerm("inventory.edit", async (req, user) => {
  const v = parsePropertyInput(await req.json(), false);
  const { ai, apiKey, model } = await requireAi(user.uid);
  const facts = [
    ai.brand.name ? `Inmobiliaria: ${ai.brand.name}` : "",
    ai.brand.tone ? `Tono de la marca: ${ai.brand.tone}` : "",
    ...propertyFacts(v),
  ].filter(Boolean);
  const text = await llmText(apiKey, model, SYSTEM, facts.join("\n"), 1200, 0.7);
  return NextResponse.json(parseCopy(text));
});
