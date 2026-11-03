"use client";

import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { CalendarCheck, FlaskConical, RotateCcw, SendHorizontal, UserRoundCheck, UserRoundX, Wrench } from "lucide-react";
import { functions } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Trace = { tool: string; args: unknown; result: unknown };
type TestResult = {
  reply: string;
  needsHuman: boolean;
  reason: string | null;
  model: string;
  booking: { label: string; service: string; vehicle?: string | null; lane?: string | null } | null;
  client: { fields: Record<string, string> } | null;
  trace?: Trace[];
};
type TestInput = { channel: "dm" | "comment"; postText?: string; messages: { from: "cliente" | "marca"; text: string }[] };
type Turn = { from: "cliente" } | { from: "marca"; result: TestResult } | { from: "error" };
type ChatTurn = Turn & { text: string };

const testFn = httpsCallable<TestInput, TestResult>(functions, "alTestAgent");

const TOOL_LABEL: Record<string, string> = {
  search_inventory: "Buscar en inventario",
  check_availability: "Ver disponibilidad",
  book_appointment: "Agendar cita",
  cancel_appointment: "Cancelar cita",
  update_client: "Guardar datos del cliente",
};
const CLIENT_FIELD: Record<string, string> = { firstName: "nombre", lastName: "apellidos", whatsapp: "WhatsApp", email: "email" };

/** One-line summary of what a tool returned, e.g. how many cars matched. */
function summary(t: Trace) {
  const r = t.result as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return "";
  if (typeof r.error === "string") return `error: ${r.error}`;
  if (Array.isArray(r.results)) return `${r.total ?? r.results.length} auto(s) encontrados`;
  if (Array.isArray(r.free)) return r.free.length ? `${r.free.length} horario(s) libre(s)` : "sin horarios";
  if (typeof r.when === "string") return `simulada: ${r.when}`;
  if (r.ok) return "ok";
  return "";
}

function AgentExtras({ result }: { result: TestResult }) {
  const fields = Object.entries(result.client?.fields ?? {});
  return (
    <div className="mt-1 space-y-1 text-xs">
      <div className="flex flex-wrap gap-1">
        {result.needsHuman ? (
          <span className="flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <UserRoundX className="size-3" /> Pasaría a humano{result.reason ? `: ${result.reason}` : ""}
          </span>
        ) : null}
        {result.booking && (
          <span className="flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            <CalendarCheck className="size-3" /> Cita simulada: {result.booking.service}
            {result.booking.vehicle ? ` · ${result.booking.vehicle}` : ""} · {result.booking.label}
            {result.booking.lane ? ` · espacio ${result.booking.lane}` : ""}
          </span>
        )}
        {fields.length > 0 && (
          <span className="flex items-center gap-1 rounded-md bg-sky-100 px-1.5 py-0.5 text-sky-900 dark:bg-sky-950 dark:text-sky-200">
            <UserRoundCheck className="size-3" /> Datos detectados: {fields.map(([k, v]) => `${CLIENT_FIELD[k] ?? k} ${v}`).join(", ")}
          </span>
        )}
      </div>
      {!!result.trace?.length && (
        <details className="text-muted-foreground">
          <summary className="flex cursor-pointer items-center gap-1 select-none">
            <Wrench className="size-3" /> Herramientas usadas: {result.trace.map((t) => TOOL_LABEL[t.tool] ?? t.tool).join(", ")}
          </summary>
          <ul className="mt-1 space-y-1">
            {result.trace.map((t, i) => (
              <li key={i} className="rounded-md bg-muted/60 p-1.5">
                <p className="font-medium text-foreground">
                  {TOOL_LABEL[t.tool] ?? t.tool} <span className="font-normal text-muted-foreground">{summary(t)}</span>
                </p>
                <pre className="mt-0.5 overflow-x-auto font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(t.args)}</pre>
                <pre className="mt-0.5 max-h-40 overflow-auto font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(t.result, null, 1)}</pre>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Talk to the agent as a customer would: same prompt, manual, inventory and agendas; nothing is sent or booked. */
export function AgentTestChat() {
  const [channel, setChannel] = useState<"dm" | "comment">("dm");
  const [postText, setPostText] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [turns, busy]);

  async function send() {
    const msg = text.trim();
    if (!msg || busy) return;
    const next: ChatTurn[] = [...turns, { from: "cliente", text: msg }];
    setTurns(next);
    setText("");
    setBusy(true);
    try {
      const messages = next.flatMap((t) => (t.from === "error" ? [] : [{ from: t.from, text: t.text }]));
      const { data } = await testFn({ channel, postText: channel === "comment" ? postText : undefined, messages });
      setTurns((cur) => [...cur, { from: "marca", text: data.reply || "(sin respuesta)", result: data }]);
    } catch (e) {
      setTurns((cur) => [...cur, { from: "error", text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setTurns([]);
    setText("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-5" /> Probar el agente
        </CardTitle>
        <CardDescription>
          Escríbele como si fueras un cliente. Usa los ajustes guardados, el manual, el inventario y las agendas; nada se
          publica, no se apartan horarios y no se guardan clientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5 text-sm">
            {(
              [
                ["dm", "Mensaje directo"],
                ["comment", "Comentario público"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setChannel(id)}
                className={cn("rounded-md px-2.5 py-1", channel === id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={reset} disabled={busy || !turns.length}>
            <RotateCcw /> Reiniciar
          </Button>
        </div>
        {channel === "comment" && (
          <Textarea rows={2} placeholder="Texto del post donde comenta el cliente (opcional)" value={postText} onChange={(e) => setPostText(e.target.value)} />
        )}

        <div className="h-96 space-y-3 overflow-y-auto rounded-lg border bg-muted/30 p-3">
          {!turns.length && (
            <p className="pt-16 text-center text-sm text-muted-foreground">
              Prueba algo como «¿Tienen un sedán automático de menos de 300 mil?» o «¿Puedo ir a verlo el sábado?»
            </p>
          )}
          {turns.map((t, i) => (
            <div key={i} className={cn("flex flex-col", t.from === "cliente" ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
                  t.from === "cliente" && "rounded-br-sm bg-primary text-primary-foreground",
                  t.from === "marca" && "rounded-bl-sm border bg-background",
                  t.from === "error" && "border border-destructive/40 bg-destructive/10 text-destructive",
                )}
              >
                {t.text}
              </div>
              {t.from === "marca" && (
                <div className="max-w-[85%]">
                  <AgentExtras result={t.result} />
                </div>
              )}
            </div>
          ))}
          {busy && <p className="text-xs text-muted-foreground">El agente está escribiendo…</p>}
          <div ref={bottom} />
        </div>

        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            placeholder="Escribe como cliente… (Enter para enviar, Shift+Enter para salto de línea)"
            value={text}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button onClick={send} disabled={busy || !text.trim()} aria-label="Enviar">
            <SendHorizontal />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
