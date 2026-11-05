import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import {
  aiKnowledgeDoc,
  aiKnowledgeFilesCol,
  MESSAGES,
  ROOT,
  conversationMessagesCol,
  globalAiDoc,
  postDoc,
  postMessagesCol,
  tenantDoc,
  userDoc,
} from "./paths";
import { DF_AI_ENCRYPTION_KEY, decrypt } from "./crypto";
import { workspaceOf } from "./actor";
import { type DraftQuote, PRIVATE_REPLY_PLATFORMS, sendDm, sendReply } from "./comments";
import { type ClientField, type ClientProposal, getClientProfile, mergeClientFields, normaliseField } from "./clients";
import {
  type Agenda,
  type Channel,
  type Customer,
  SlotTakenError,
  cancelBooking,
  customerBookings,
  formatSlot,
  getSlots,
  listAgendas,
  localDateTime,
  releaseHold,
  reserveSlot,
} from "./agenda";
import { bookingProperty, hasInventory, inventorySection, searchInventory } from "./inventory";

const OPENROUTER_URL = process.env.OPENROUTER_API_URL || "https://openrouter.ai/api/v1";
const MAX_AGE_MS = 24 * 3600_000; // older comments never trigger the agent
const MAX_THREAD = 30;
const MAX_TOOL_ROUNDS = 5; // e.g. search inventory + check availability + book

const db = () => getFirestore();

type Brand = { name?: string; tone?: string; about?: string; faq?: string; never?: string };
type AiSettings = {
  mode?: "off" | "manual" | "auto";
  textModel?: string | null;
  instructions?: string;
  brand?: Brand;
  // From _system/aiKnowledge: consolidated Markdown of instructions + brand + uploaded PDFs.
  manual?: string;
  manualStale?: boolean;
  // Markdown generated from Ajustes → Empresa (address, contact, opening hours).
  company?: string;
  companyTimezone?: string;
  // Comment words that ask for a quote by private reply (absent = DEFAULT_QUOTE_KEYWORDS).
  quoteKeywords?: string[];
  quoteKeywordsOnly?: boolean; // true: send quotes only when a keyword appears
};

// Keep in sync with web/src/lib/openrouter.ts DEFAULT_QUOTE_KEYWORDS.
const DEFAULT_QUOTE_KEYWORDS = ["cotiza"];
const quoteKeywordsOf = (ai: AiSettings) => (Array.isArray(ai.quoteKeywords) ? ai.quoteKeywords : DEFAULT_QUOTE_KEYWORDS).filter((k) => typeof k === "string" && k.trim());
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Keyword at the start of a word, ignoring case and accents: "cotiza" matches "Cotización", "cotizar", "#cotiza". */
export const keywordIn = (text: string, keyword: string) => {
  const k = fold(keyword.trim()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !!k && new RegExp(`(^|[^\\p{L}\\p{N}])${k}`, "u").test(fold(text));
};
type Msg = FirebaseFirestore.DocumentData & { id: string };
type DraftBooking = { id: string; service: string; label: string; start: number; property?: string | null; lane?: string | null };
export type AgentResult = {
  reply: string;
  needsHuman: boolean;
  reason: string | null;
  model: string;
  booking: DraftBooking | null;
  client: ClientProposal | null; // data the person gave, saved to the client card when the reply is sent
  quote: DraftQuote | null; // comments: quote sent by private reply (DM) when the reply is sent
  trace?: ToolTrace[]; // only in test runs
};
type ToolTrace = { tool: string; args: unknown; result: unknown };
// dryRun: test chat from Ajustes → nothing is booked, cancelled or saved.
type RunState = { booking: DraftBooking | null; client: ClientProposal | null; quote: DraftQuote | null; quotesAllowed: boolean; dryRun: boolean; trace: ToolTrace[] };

const authorKey = (m: FirebaseFirestore.DocumentData) => m.author?.username || m.author?.name || "?";

/** Per-account mode/instructions/brand/manual + the global OpenRouter key and text model (SuperAdmin). */
async function loadSettings(uid: string) {
  const [user, global, knowledge, tenant, company] = await Promise.all([
    db().doc(userDoc(uid)).get(),
    db().doc(globalAiDoc()).get(),
    db().doc(aiKnowledgeDoc(uid)).get(),
    db().doc(tenantDoc(uid)).get(),
    db().collection(aiKnowledgeFilesCol(uid)).doc("company").get(),
  ]);
  const ai: AiSettings = {
    ...((user.get("ai") ?? {}) as AiSettings),
    textModel: (global.get("textModel") as string | undefined) ?? null,
    manual: (knowledge.get("manual") as string | undefined) ?? "",
    manualStale: Boolean(knowledge.get("stale")),
    company: (company.get("markdown") as string | undefined) ?? "",
    companyTimezone: (user.get("company.timezone") as string | undefined) ?? undefined,
  };
  const enc = global.get("openrouterKey") as string | undefined;
  let apiKey: string | null = null;
  let keyUnreadable = false;
  try {
    apiKey = enc ? decrypt(enc) : null;
  } catch (err) {
    // Saved with a different DF_AI_ENCRYPTION_KEY than the functions secret.
    keyUnreadable = true;
    logger.error("openrouter key cannot be decrypted", { err: String(err) });
  }
  return { ai, apiKey, keyUnreadable, active: tenant.get("status") === "active" };
}

const KEY_UNREADABLE = "No se pudo leer la API key de OpenRouter: el SuperAdmin debe volver a guardarla en el panel de SuperAdmin.";
const NO_AI = "El administrador aún no ha configurado la IA (API key de OpenRouter y modelo)";

type Context = {
  channel: Channel;
  platform: string;
  postText: string | null; // null for DMs
  authorName: string;
  customer: Customer;
  target: Msg;
  lines: string[];
  profile?: Awaited<ReturnType<typeof getClientProfile>>;
};

const line = (who: string, m: FirebaseFirestore.DocumentData) => `[${who}] ${String(m.text ?? "").replace(/\s+/g, " ").trim()}`;

/** Text-only context of a comment: the post, and this person's thread with us in chronological order. */
async function buildCommentContext(uid: string, postId: string, messageId: string): Promise<Context> {
  const [post, msgs] = await Promise.all([
    db().doc(postDoc(uid, postId)).get(),
    db().collection(postMessagesCol(uid, postId)).orderBy("createdAt", "asc").get(),
  ]);
  const all: Msg[] = msgs.docs.map((d) => ({ id: d.id, ...d.data() }));
  const target = all.find((m) => m.id === messageId);
  if (!post.exists || !target) throw new Error("Post o comentario no encontrado");

  const who = authorKey(target);
  const theirIds = new Set(all.filter((m) => m.direction === "in" && authorKey(m) === who).map((m) => m.commentId));
  const thread = all
    .filter((m) => (m.direction === "in" ? authorKey(m) === who : m.parentId != null && theirIds.has(m.parentId)))
    .slice(-MAX_THREAD);
  const authorName = (target.author?.name as string) || who;
  const platform = (target.platform as string) ?? post.get("platforms")?.[0]?.platform ?? "";

  return {
    channel: { kind: "comment", postId, messageId },
    platform,
    postText: (post.get("content") as string) || "(post sin texto)",
    authorName,
    customer: { name: authorName, platform, authorId: target.author?.id ?? who, username: target.author?.username ?? null },
    target,
    lines: thread.map((m) => line(m.direction === "in" ? authorName : "Marca", m)),
  };
}

/** Text-only context of a DM: the last messages of the conversation. */
async function buildDmContext(uid: string, convId: string, messageId: string): Promise<Context> {
  const msgs = await db().collection(conversationMessagesCol(uid, convId)).orderBy("createdAt", "desc").limit(MAX_THREAD).get();
  const thread: Msg[] = msgs.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
  const target = thread.find((m) => m.id === messageId) ?? (await db().collection(conversationMessagesCol(uid, convId)).doc(messageId).get()).data();
  if (!target) throw new Error("Mensaje no encontrado");
  const t = { id: messageId, ...target } as Msg;
  const authorName = (t.author?.name as string) || authorKey(t);
  return {
    channel: { kind: "dm", conversationId: convId, messageId },
    platform: (t.platform as string) ?? "",
    postText: null,
    authorName,
    customer: { name: authorName, platform: t.platform ?? null, authorId: t.author?.id ?? authorKey(t), username: t.author?.username ?? null },
    target: t,
    lines: thread.map((m) => line(m.direction === "in" ? authorName : "Marca", m)),
  };
}

function agendaSection(agendas: Agenda[], existing: FirebaseFirestore.DocumentData[]) {
  if (!agendas.length) return [];
  const tz = agendas[0].timezone;
  const now = localDateTime(Date.now(), tz);
  const weekday = new Intl.DateTimeFormat("es-ES", { timeZone: tz, weekday: "long" }).format(new Date());
  return [
    "\n# AGENDA DE SERVICIOS",
    `Hoy es ${weekday} ${now.date}, son las ${now.time} (zona ${tz}).`,
    "Servicios que se pueden reservar:",
    ...agendas.map(
      (a) =>
        `- agendaId="${a.id}" · ${a.service} · ${a.durationMin} min${a.price ? ` · ${a.price}` : ""}${a.description ? ` · ${a.description}` : ""}${a.propertyRequired ? " · REQUIERE INMUEBLE (propertyId)" : ""}`,
    ),
    existing.length
      ? `Citas próximas de esta persona: ${existing.map((b) => `bookingId="${b.id}" ${b.service} ${formatSlot((b.start as Timestamp).toMillis(), b.timezone ?? tz)} (${b.status === "held" ? "pendiente de confirmar" : "confirmada"})`).join("; ")}`
      : "Esta persona no tiene citas próximas.",
    "Reglas de agenda:",
    "- NUNCA inventes horarios ni digas que hay disponibilidad sin llamar antes a check_availability para esa fecha.",
    "- Si no queda claro el servicio o la fecha, pregúntalo. Ofrece como máximo 5 horarios, los más cercanos a lo que pidió.",
    "- Llama a book_appointment SOLO cuando la persona confirme explícitamente un horario concreto que le ofreciste. Después confirma en la respuesta el servicio, el día y la hora.",
    "- Al confirmar una cita, si la ficha no tiene nombre y apellidos o WhatsApp, pídelos (el WhatsApp solo por mensaje directo).",
    "- Si book_appointment devuelve slot_taken, dilo y ofrece las alternativas que devuelve.",
    ...(agendas.some((a) => a.propertyRequired)
      ? [
          "- Visitas (agendas que REQUIEREN INMUEBLE): antes de ver horarios confirma qué inmueble quiere visitar. Obtén su propertyId con search_inventory (nunca lo inventes) y pásalo a check_availability y a book_appointment. Si no sabe cuál, ayúdale a elegir con search_inventory.",
          "- Al confirmar la visita menciona el inmueble (tipo y colonia, nunca la dirección exacta), el día, la hora y, si book_appointment devuelve agent, el nombre del asesor que la atenderá; la dirección se la comparte ese asesor.",
        ]
      : []),
    "- Para cancelar una cita de esta persona usa cancel_appointment con su bookingId.",
    "- Las fechas que pasas a las herramientas van en formato YYYY-MM-DD y las horas HH:mm (hora local de la agenda).",
  ];
}

const CLIENT_RULES = [
  "\n# DATOS DEL CLIENTE",
  "- Cuando la persona te dé de forma explícita su nombre, apellidos, WhatsApp o email, guárdalos con update_client. Nunca deduzcas ni inventes datos.",
  "- No sobrescribas lo que ya está en la ficha. Solo si la persona dice claramente que un dato cambió («mi número nuevo es…»), usa correction=true.",
  "- Si update_client devuelve un error (p. ej. WhatsApp no válido), pide el dato de nuevo con amabilidad.",
  "- No pidas datos si no hacen falta.",
];

/**
 * Company data always goes in verbatim (even when the manual already summarises it): address, contact
 * and opening hours must be exact. Includes the current time so "are you open now?" can be answered.
 */
function companySection(ai: AiSettings) {
  if (!ai.company?.trim()) return [];
  const tz = ai.companyTimezone || "UTC";
  const now = new Intl.DateTimeFormat("es-ES", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  return [
    "\n# DATOS DE LA EMPRESA (fuente de verdad para dirección, contacto y horario)",
    `Ahora mismo es ${now} (zona ${tz}).`,
    "- Da la dirección, el teléfono y el horario exactamente como aparecen aquí. Si te preguntan si está abierto, compáralo con la hora actual.",
    ai.company.trim(),
  ];
}

export function systemPrompt(ai: AiSettings, agenda: string[] = [], isPublic = false) {
  const b = ai.brand ?? {};
  const section = (title: string, v?: string) => (v?.trim() ? `\n## ${title}\n${v.trim()}` : "");
  const rawProfile = [
    section("Instrucciones del dueño", ai.instructions),
    section("Tono", b.tone),
    section("Sobre el negocio", b.about),
    section("Preguntas frecuentes", b.faq),
    section("Nunca digas", b.never),
  ];
  const manual = ai.manual?.trim();
  return [
    `Eres el community manager de ${b.name?.trim() || "la marca"} y respondes comentarios y mensajes directos en sus redes sociales.`,
    "Reglas fijas:",
    "- Responde en el mismo idioma que la persona.",
    "- Sé breve (1-3 frases), natural y adecuado a la red social. No uses hashtags salvo que encajen.",
    `- Usa solo la información ${manual ? "del MANUAL DEL AGENTE" : "del perfil de la marca"}, del post y de las herramientas. No inventes precios, horarios, stock ni promesas.`,
    "- Ten en cuenta toda la conversación previa con esta persona; no repitas lo que ya se le dijo.",
    "- Si el mensaje es una queja seria, un tema legal/médico, datos personales, algo que no sabes responder con la información dada, o spam/insultos, marca needsHuman=true.",
    'Tu respuesta final es SOLO un JSON: {"reply": string, "needsHuman": boolean, "reason": string|null}. reason explica en una frase por qué necesita humano (o null).',
    ...companySection(ai),
    ...CLIENT_RULES,
    isPublic
      ? "- Esto es un comentario PÚBLICO: nunca pidas aquí teléfono, WhatsApp ni email. Si hacen falta, invita a la persona a escribirte por mensaje directo."
      : "- Es un mensaje directo privado: aquí sí puedes pedir el WhatsApp si hace falta.",
    ...agenda,
    ...(manual
      ? [
          "\n# MANUAL DEL AGENTE (fuente de verdad)\n",
          manual,
          // Instructions edited after the manual was generated: give them precedence until it is regenerated.
          ...(ai.manualStale ? ["\n# CAMBIOS RECIENTES DEL DUEÑO (prevalecen sobre el manual)", ...rawProfile] : []),
        ]
      : rawProfile),
  ].join("\n");
}

function userPrompt(ctx: Context, note?: string) {
  return [
    `Red social: ${ctx.platform}`,
    ctx.postText !== null ? `Texto del post:\n"""${ctx.postText}"""` : "Canal: mensaje directo (privado).",
    `Ficha del cliente: nombre ${ctx.profile?.firstName ?? "—"}; apellidos ${ctx.profile?.lastName ?? "—"}; WhatsApp ${ctx.profile?.whatsapp ?? "—"}; email ${ctx.profile?.email ?? "—"}${ctx.profile?.notes ? `; notas del dueño: ${ctx.profile.notes}` : ""}`,
    `Conversación con ${ctx.authorName} (de la más antigua a la más reciente):`,
    ...ctx.lines,
    "",
    `Responde al último mensaje de ${ctx.authorName}: "${ctx.target.text}"`,
    note?.trim() ? `\nIndicación adicional del dueño para esta respuesta: ${note.trim()}` : "",
  ].join("\n");
}

function parseJson(raw: string) {
  const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(start >= 0 ? text.slice(start, end + 1) : text) as { reply?: string; needsHuman?: boolean; reason?: string | null };
}

const CLIENT_TOOL = {
  type: "function",
  function: {
    name: "update_client",
    description: "Guarda en la ficha del cliente los datos que la persona dio explícitamente en la conversación.",
    parameters: {
      type: "object",
      properties: {
        firstName: { type: "string" },
        lastName: { type: "string", description: "Apellidos" },
        whatsapp: { type: "string", description: "Con prefijo de país, p. ej. +5511987654321" },
        email: { type: "string" },
        correction: { type: "boolean", description: "true solo si la persona corrige un dato que ya estaba en la ficha" },
      },
    },
  },
};

const AGENDA_TOOLS = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Horarios libres reales de un servicio para una fecha.",
      parameters: {
        type: "object",
        properties: {
          agendaId: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          propertyId: { type: "string", description: "Inmueble a visitar (de search_inventory): oculta horarios en que ese inmueble ya tiene visita" },
        },
        required: ["agendaId", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_appointment",
      description: "Reserva un horario que la persona confirmó explícitamente.",
      parameters: {
        type: "object",
        properties: {
          agendaId: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:mm" },
          customerName: { type: "string" },
          propertyId: { type: "string", description: "Obligatorio en agendas que REQUIEREN INMUEBLE: propertyId de search_inventory" },
        },
        required: ["agendaId", "date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_appointment",
      description: "Cancela una cita próxima de esta persona.",
      parameters: { type: "object", properties: { bookingId: { type: "string" } }, required: ["bookingId"] },
    },
  },
];

const INVENTORY_TOOL = {
  type: "function",
  function: {
    name: "search_inventory",
    description: "Busca inmuebles DISPONIBLES (venta o renta) en el inventario real de la inmobiliaria. Úsala antes de mencionar cualquier inmueble, precio o renta.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto libre solo con desarrollo, colonia o amenidad (p. ej. 'alberca', 'Torre Alameda'). No pongas precios." },
        operation: { type: "string", description: "venta o renta" },
        propertyType: { type: "string", description: "Departamento, Casa, Casa en condominio, Terreno, Local comercial, Oficina o Bodega" },
        city: { type: "string", description: "Ciudad o municipio" },
        neighborhood: { type: "string", description: "Colonia" },
        bedroomsMin: { type: "number", description: "Recámaras mínimas ('de 2 recámaras' → 2)" },
        bathroomsMin: { type: "number" },
        parkingMin: { type: "number", description: "Lugares de estacionamiento mínimos" },
        price: {
          type: "number",
          description: "Presupuesto aproximado en MXN: precio de venta, o renta mensual si operation=renta ('renta de 18 mil' → 18000, 'de 3 millones' → 3000000)",
        },
        priceMin: { type: "number", description: "Mínimo en MXN ('desde 2 millones')" },
        priceMax: { type: "number", description: "Máximo en MXN ('hasta 20 mil al mes', 'menos de 4 millones')" },
        petsAllowed: { type: "boolean", description: "true si la persona tiene mascotas" },
        furnished: { type: "boolean", description: "true si lo busca amueblado" },
      },
    },
  },
};

const QUOTE_TOOL = {
  type: "function",
  function: {
    name: "send_quote_by_dm",
    description:
      "Envía a esta persona, por mensaje privado, la cotización (link con precio, fotos y detalles) de un inmueble. Úsala cuando en el comentario pida precio, costo, información o cotización.",
    parameters: {
      type: "object",
      properties: { propertyId: { type: "string", description: "propertyId de search_inventory (nunca lo inventes)" } },
      required: ["propertyId"],
    },
  },
};

/** Rules for quotes requested in public comments (only when send_quote_by_dm is offered). */
const QUOTE_RULES = [
  "\n# COTIZACIONES PEDIDAS EN COMENTARIOS",
  "- Si la persona pide precio, costo, informes o cotización de un inmueble, identifica cuál es: casi siempre el del post. Búscalo con search_inventory usando los datos del texto del post (tipo, colonia, desarrollo, recámaras, precio).",
  "- Si hay un único inmueble que encaja claramente, llama a send_quote_by_dm con su propertyId. Después responde en el comentario, en 1-2 frases, que ya le enviaste la cotización por mensaje privado (p. ej. «¡Hola! Te acabamos de enviar la cotización por mensaje privado 📩»).",
  "- En el comentario NUNCA escribas el precio, la renta, montos ni datos personales: todo eso va en el mensaje privado.",
  "- Si no queda claro qué inmueble le interesa (varios encajan o ninguno), NO llames a send_quote_by_dm: pregúntale en el comentario cuál le interesa.",
  "- Llama a send_quote_by_dm como máximo una vez por comentario.",
];

// "$3,200,000", "3.2 millones", "18 mil": a public comment answer must not carry prices.
const PRICE_RE = /\$\s?\d|\d[\d.,]*\s?(mil\b|millones?|mdp|k\b)|\bmxn\b/i;

type ToolCall = { id: string; function: { name: string; arguments: string } };

/** Executes one tool call against the agenda. Bookings are always held; sending the reply confirms them. */
async function runTool(uid: string, ctx: Context, agendas: Agenda[], state: RunState, call: ToolCall) {
  let args: Record<string, string> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    return { error: "argumentos JSON no válidos" };
  }
  const agenda = agendas.find((a) => a.id === args.agendaId);
  switch (call.function.name) {
    case "update_client": {
      if (!ctx.customer.authorId || !ctx.platform) return { error: "no se puede identificar a esta persona" };
      const errors: Record<string, string> = {};
      const incoming: Partial<Record<ClientField, string>> = { ...state.client?.fields };
      for (const f of ["firstName", "lastName", "whatsapp", "email"] as const) {
        if (typeof args[f] !== "string" || !args[f].trim()) continue;
        const r = normaliseField(f, args[f]);
        if ("error" in r) errors[f] = r.error;
        else incoming[f] = r.value;
      }
      const { accepted, kept } = mergeClientFields(ctx.profile ?? null, incoming, String(args.correction) === "true");
      if (Object.keys(accepted).length)
        state.client = { platform: ctx.platform, authorId: String(ctx.customer.authorId), author: ctx.target.author ?? {}, fields: accepted };
      return {
        ok: !Object.keys(errors).length,
        saved: accepted,
        ...(Object.keys(kept).length ? { notChanged: kept, note: "Ya había un valor en la ficha; usa correction=true solo si la persona dice que cambió." } : {}),
        ...(Object.keys(errors).length ? { errors } : {}),
      };
    }
    case "check_availability": {
      if (!agenda) return { error: "agendaId desconocido", agendas: agendas.map((a) => ({ agendaId: a.id, service: a.service })) };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date ?? "")) return { error: "date debe ser YYYY-MM-DD" };
      const slots = await getSlots(uid, agenda, args.date, Date.now(), args.propertyId || null);
      return {
        agendaId: agenda.id,
        service: agenda.service,
        date: args.date,
        timezone: agenda.timezone,
        free: slots.map((s) => s.time),
        note: slots.length ? null : "No hay horarios libres ese día (cerrado, bloqueado, pasado o completo).",
        ...(agenda.propertyRequired && !args.propertyId ? { reminder: "Esta agenda requiere inmueble: confirma el propertyId antes de reservar." } : {}),
      };
    }
    case "book_appointment": {
      if (!agenda) return { error: "agendaId desconocido" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date ?? "") || !/^\d{2}:\d{2}$/.test(args.time ?? "")) return { error: "date YYYY-MM-DD y time HH:mm" };
      let property: { id: string; title: string } | null = null;
      if (agenda.propertyRequired || args.propertyId) {
        if (!args.propertyId) return { error: "property_required", note: "Pregunta qué inmueble quiere visitar y obtén su propertyId con search_inventory." };
        const v = await bookingProperty(uid, args.propertyId);
        if ("error" in v) return { error: v.error };
        property = v;
      }
      if (state.dryRun) {
        const slots = await getSlots(uid, agenda, args.date, Date.now(), property?.id);
        const slot = slots.find((s) => s.time === args.time);
        if (!slot) return { error: "slot_taken", alternatives: slots.slice(0, 5).map((s) => `${s.date} ${s.time}`) };
        const label = formatSlot(slot.start, agenda.timezone);
        const lane = !agenda.agents && agenda.lanes > 1 ? slot.lanes[0] : null;
        state.booking = { id: "simulada", service: agenda.service, label, start: slot.start, property: property?.title ?? null, lane };
        return { ok: true, bookingId: "simulada", service: agenda.service, when: label, property: property?.title ?? null, space: lane };
      }
      // One booking per reply: a new one replaces the hold proposed earlier in this same run.
      if (state.booking) await releaseHold(uid, state.booking.id).catch(() => {});
      // Same agent who already attends this person, when free (continuity); else the least busy one.
      const previous = ctx.customer.authorId ? await customerBookings(uid, String(ctx.customer.authorId)).catch(() => []) : [];
      const preferAssigneeIds = previous.map((x) => x.assigneeId as string | null).filter((x): x is string => !!x);
      try {
        const b = await reserveSlot(uid, agenda.id, args.date, args.time, {
          status: "held",
          preferAssigneeIds,
          customer: {
            ...ctx.customer,
            // Data the person just gave in this conversation wins over the card.
            name:
              [state.client?.fields.firstName ?? ctx.profile?.firstName, state.client?.fields.lastName ?? ctx.profile?.lastName].filter(Boolean).join(" ") ||
              args.customerName?.trim() ||
              ctx.customer.name,
            contact: state.client?.fields.whatsapp ?? ctx.customer.contact ?? null,
          },
          channel: ctx.channel,
          source: "ai",
          property,
        });
        state.booking = { id: b.id, service: b.service, label: b.label, start: b.start, property: b.property?.title ?? null, lane: b.lane };
        return { ok: true, bookingId: b.id, service: b.service, when: b.label, property: b.property?.title ?? null, space: b.lane, agent: b.assigneeName };
      } catch (e) {
        if (e instanceof SlotTakenError) return { error: "slot_taken", alternatives: e.alternatives.map((s) => `${s.date} ${s.time}`) };
        throw e;
      }
    }
    case "search_inventory":
      return searchInventory(uid, args);
    case "send_quote_by_dm": {
      if (ctx.channel.kind !== "comment" || !state.quotesAllowed) return { error: "no disponible para este comentario" };
      if (ctx.target.quoteDm) return { error: "already_sent", note: "Ya se le envió una cotización por mensaje privado a este comentario." };
      const v = await bookingProperty(uid, args.propertyId);
      if ("error" in v) return { error: v.error };
      state.quote = { propertyId: v.id, title: v.title };
      return {
        ok: true,
        property: v.title,
        note: "La cotización se enviará por mensaje privado junto con tu respuesta. En el comentario di solo que ya se la enviaste por mensaje privado, sin precios.",
      };
    }
    case "cancel_appointment": {
      if (state.dryRun) return { ok: true, simulated: true };
      const mine = await customerBookings(uid, String(ctx.customer.authorId));
      if (!mine.some((b) => b.id === args.bookingId)) return { error: "Esa cita no es de esta persona o ya no está activa" };
      await cancelBooking(uid, args.bookingId);
      return { ok: true };
    }
  }
  return { error: "herramienta desconocida" };
}

async function chat(apiKey: string, body: object) {
  const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://kasita-crm.web.app",
      "X-Title": "Social Planner",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${json.error?.message ?? "error"}`);
  return json.choices?.[0]?.message ?? {};
}

async function runAgent(uid: string, apiKey: string, model: string, ai: AiSettings, ctx: Context, note?: string, dryRun = false): Promise<AgentResult> {
  if (!dryRun && ctx.customer.authorId && ctx.platform) {
    ctx.profile = await getClientProfile(uid, ctx.platform, String(ctx.customer.authorId));
    // Bookings carry the client's real name when the owner saved it.
    if (ctx.profile?.fullName) ctx.customer = { ...ctx.customer, name: ctx.profile.fullName, contact: ctx.profile.whatsapp ?? ctx.customer.contact ?? null };
  }
  const agendas = await listAgendas(uid);
  const existing = !dryRun && agendas.length && ctx.customer.authorId ? await customerBookings(uid, String(ctx.customer.authorId)) : [];
  const [inventory, stock] = await Promise.all([inventorySection(uid), hasInventory(uid)]);
  const messages: object[] = [
    { role: "system", content: systemPrompt(ai, [...agendaSection(agendas, existing), ...inventory], ctx.channel.kind === "comment") },
    { role: "user", content: userPrompt(ctx, note) },
  ];
  const state: RunState = { booking: null, client: null, quote: null, quotesAllowed: false, dryRun, trace: [] };
  // Quotes by private reply: public comments on networks that allow a DM to whoever commented (or the test chat).
  // Keywords from Ajustes → Agente IA: a match asks for the quote; "only" mode offers it on a match alone.
  const keywords = quoteKeywordsOf(ai);
  const hit = keywords.find((k) => keywordIn(String(ctx.target.text ?? ""), k));
  const quotes =
    stock && ctx.channel.kind === "comment" && (dryRun || PRIVATE_REPLY_PLATFORMS.includes(ctx.platform)) && (!ai.quoteKeywordsOnly || !!hit);
  state.quotesAllowed = !!quotes;
  if (quotes) {
    (messages[0] as { content: string }).content += "\n" + QUOTE_RULES.join("\n");
    if (ai.quoteKeywordsOnly)
      (messages[0] as { content: string }).content += "\n- El dueño pidió enviar cotizaciones solo cuando el comentario contiene una de sus palabras clave.";
    if (hit)
      (messages[1] as { content: string }).content +=
        `\n\nEl comentario contiene la palabra clave de cotización «${hit}»: envíale la cotización del inmueble del post con send_quote_by_dm (si no queda claro cuál es, pregúntale).`;
  }
  const tools = [CLIENT_TOOL, ...(stock ? [INVENTORY_TOOL] : []), ...(quotes ? [QUOTE_TOOL] : []), ...(agendas.length ? AGENDA_TOOLS : [])];
  let content = "";

  for (let round = 0; ; round++) {
    const useTools = round < MAX_TOOL_ROUNDS;
    const msg = await chat(apiKey, {
      model,
      temperature: 0.4,
      max_tokens: 600,
      response_format: { type: "json_object" },
      messages,
      ...(useTools ? { tools, tool_choice: "auto" } : {}),
    });
    if (!useTools || !msg.tool_calls?.length) {
      content = msg.content ?? "";
      break;
    }
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      const out = await runTool(uid, ctx, agendas, state, call);
      if (dryRun) state.trace.push({ tool: call.function.name, args: parseArgs(call.function.arguments), result: out });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
    }
  }

  let out;
  try {
    out = parseJson(content);
  } catch {
    // Model ignored the JSON format: use the text, but have a human check it.
    return { reply: content.trim(), needsHuman: true, reason: "La IA no devolvió el formato esperado", model, booking: state.booking, client: state.client, quote: state.quote, ...(dryRun ? { trace: state.trace } : {}) };
  }
  const reply = (out.reply ?? "").trim();
  // A public comment must never carry the price: a human checks it first.
  const leaksPrice = ctx.channel.kind === "comment" && !!state.quote && PRICE_RE.test(reply);
  return {
    reply,
    needsHuman: Boolean(out.needsHuman) || !reply || leaksPrice,
    reason: out.reason ?? (!reply ? "La IA no propuso respuesta" : leaksPrice ? "La respuesta pública menciona un precio" : null),
    model,
    booking: state.booking,
    client: state.client,
    quote: state.quote,
    ...(dryRun ? { trace: state.trace } : {}),
  };
}

function parseArgs(raw?: string) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return raw ?? null;
  }
}

const draftOf = (r: AgentResult) => ({
  text: r.reply,
  model: r.model,
  needsHuman: r.needsHuman,
  reason: r.reason,
  booking: r.booking,
  client: r.client,
  quote: r.quote,
  at: FieldValue.serverTimestamp(),
});

/** Shared by the comment and DM triggers: filters, claims the message, runs the agent and replies or drafts. */
async function onIncoming(uid: string, ref: FirebaseFirestore.DocumentReference, m: FirebaseFirestore.DocumentData, build: () => Promise<Context>) {
  if (m.direction !== "in" || m.source === "sync" || m.aiStatus) return;
  const created = (m.createdAt as Timestamp | undefined)?.toMillis?.() ?? Date.now();
  if (Date.now() - created > MAX_AGE_MS) return;

  const { ai, apiKey, active } = await loadSettings(uid);
  if (!active || !ai.mode || ai.mode === "off" || !apiKey || !ai.textModel) return;

  // Claim the message so a duplicate event never produces two answers.
  const claimed = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.get("aiStatus")) return false;
    tx.update(ref, { aiStatus: "pending" });
    return true;
  });
  if (!claimed) return;

  try {
    const ctx = await build();
    const result = await runAgent(uid, apiKey, ai.textModel, ai, ctx);

    if (ai.mode === "auto" && !result.needsHuman) {
      const requestId = `ai_${ref.id}`.slice(0, 64);
      const opts = { sentBy: "ai" as const, requestId, booking: result.booking ? ("confirm" as const) : undefined, proposed: result.booking, saveClient: true, proposedClient: result.client, quote: result.quote ? ("send" as const) : undefined, proposedQuote: result.quote };
      if (ctx.channel.kind === "dm") await sendDm(uid, ctx.channel.conversationId!, ref.id, result.reply, opts);
      else await sendReply(uid, ctx.channel.postId!, ref.id, result.reply, opts);
      logger.info("agent replied", { uid, path: ref.path, model: result.model, booking: result.booking?.id ?? null });
      return;
    }
    // Manual mode, or the agent asked for a human: leave a draft (any booking stays held).
    await ref.update({ aiStatus: "drafted", aiDraft: draftOf(result) });
  } catch (err) {
    logger.error("agent failed", { uid, path: ref.path, err: String(err) });
    await ref.update({ aiStatus: "error", aiError: String((err as Error).message ?? err).slice(0, 300) });
  }
}

/** Runs the agent on every new incoming comment, according to the user's mode. */
export const kfAgentOnComment = onDocumentCreated(
  { document: `${ROOT}/{uid}/posts/{postId}/${MESSAGES}/{messageId}`, secrets: [DF_AI_ENCRYPTION_KEY] },
  async (event) => {
    const { uid, postId, messageId } = event.params;
    const m = event.data?.data();
    if (!m || m.kind !== "comment") return;
    await onIncoming(uid, event.data!.ref, m, () => buildCommentContext(uid, postId, messageId));
  },
);

/** Same for direct messages. */
export const kfAgentOnDm = onDocumentCreated(
  { document: `${ROOT}/{uid}/conversations/{convId}/${MESSAGES}/{messageId}`, secrets: [DF_AI_ENCRYPTION_KEY] },
  async (event) => {
    const { uid, convId, messageId } = event.params;
    const m = event.data?.data();
    if (!m || m.kind !== "dm") return;
    await onIncoming(uid, event.data!.ref, m, () => buildDmContext(uid, convId, messageId));
  },
);

/** On-demand draft ("Sugerir con IA"), in any mode, optionally guided by a note. Comments or DMs. */
export const kfSuggestReply = onCall({ secrets: [DF_AI_ENCRYPTION_KEY] }, async (req) => {
  const uid = await workspaceOf(req, "inbox.reply");
  const { postId, conversationId, messageId, note } = req.data as { postId?: string; conversationId?: string; messageId?: string; note?: string };
  if ((!postId && !conversationId) || !messageId) throw new HttpsError("invalid-argument", "Faltan postId/conversationId o messageId");

  const { ai, apiKey, keyUnreadable } = await loadSettings(uid);
  if (keyUnreadable) throw new HttpsError("failed-precondition", KEY_UNREADABLE);
  if (!apiKey || !ai.textModel) throw new HttpsError("failed-precondition", NO_AI);

  try {
    const ref = postId
      ? db().collection(postMessagesCol(uid, postId)).doc(messageId)
      : db().collection(conversationMessagesCol(uid, conversationId!)).doc(messageId);
    // A new suggestion replaces the previous draft: free the slot it was holding.
    const prev = (await ref.get()).get("aiDraft.booking.id") as string | undefined;
    if (prev) await releaseHold(uid, prev).catch(() => {});
    const ctx = postId ? await buildCommentContext(uid, postId, messageId) : await buildDmContext(uid, conversationId!, messageId);
    const result = await runAgent(uid, apiKey, ai.textModel, ai, ctx, typeof note === "string" ? note.slice(0, 500) : undefined);
    await ref.update({ aiStatus: "drafted", aiDraft: draftOf(result), aiError: null });
    return result;
  } catch (err) {
    throw new HttpsError("internal", (err as Error).message);
  }
});


const TEST_MAX_MESSAGES = 30;
const TEST_MAX_CHARS = 1000;

/** Test chat in Ajustes → Agente IA: same prompt and tools, but nothing is sent, booked or saved. */
export const kfTestAgent = onCall({ secrets: [DF_AI_ENCRYPTION_KEY] }, async (req) => {
  const uid = await workspaceOf(req, "settings.agente");
  const { channel, postText, messages } = (req.data ?? {}) as { channel?: string; postText?: string; messages?: { from?: string; text?: string }[] };
  const thread = (Array.isArray(messages) ? messages : [])
    .slice(-TEST_MAX_MESSAGES)
    .map((m) => ({ from: m?.from === "marca" ? "marca" : "cliente", text: String(m?.text ?? "").slice(0, TEST_MAX_CHARS).trim() }))
    .filter((m) => m.text);
  const last = thread[thread.length - 1];
  if (!last || last.from !== "cliente") throw new HttpsError("invalid-argument", "El último mensaje debe ser del cliente");

  const { ai, apiKey, keyUnreadable } = await loadSettings(uid);
  if (keyUnreadable) throw new HttpsError("failed-precondition", KEY_UNREADABLE);
  if (!apiKey || !ai.textModel) throw new HttpsError("failed-precondition", NO_AI);

  const isComment = channel === "comment";
  const authorName = "Cliente de prueba";
  const ctx: Context = {
    channel: isComment ? { kind: "comment", postId: "prueba", messageId: "prueba" } : { kind: "dm", conversationId: "prueba", messageId: "prueba" },
    platform: "prueba",
    postText: isComment ? String(postText ?? "").slice(0, 2000).trim() || "(post sin texto)" : null,
    authorName,
    customer: { name: authorName, platform: "prueba", authorId: "test", username: null },
    target: { id: "prueba", text: last.text, direction: "in" },
    lines: thread.map((m) => line(m.from === "cliente" ? authorName : "Marca", m)),
  };
  try {
    return await runAgent(uid, apiKey, ai.textModel, ai, ctx, undefined, true);
  } catch (err) {
    throw new HttpsError("internal", (err as Error).message);
  }
});
