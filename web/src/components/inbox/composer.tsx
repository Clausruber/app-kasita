"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, Paperclip, Send, Sparkles, UserRoundPen, X } from "lucide-react";
import { uploadMedia } from "@/lib/api";
import type { Message } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCan } from "@/hooks/use-me";

export type SendInput = { text: string; attachmentUrl?: string; booking?: "confirm" | "cancel"; saveClient?: boolean };

const FIELD_LABEL = { firstName: "Nombre", lastName: "Apellidos", whatsapp: "WhatsApp", email: "Email" } as const;

/**
 * Reply composer shared by comments and DMs: AI draft prefill (with the booking it proposes),
 * "Sugerir" with an optional note, optional image attachment and send.
 */
export function Composer({
  latest,
  placeholder,
  canAttach,
  attachHint,
  onSend,
  onSuggest,
}: {
  latest: Message;
  placeholder: string;
  canAttach: boolean;
  attachHint?: string;
  onSend: (input: SendInput) => Promise<void>;
  onSuggest: (note?: string) => Promise<string>;
}) {
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const draft = latest.aiDraft;
  const [usingDraft, setUsingDraft] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [confirmBooking, setConfirmBooking] = useState(true);
  const canReply = useCan()("inbox.reply");
  const proposed = !latest.replied ? draft?.booking : null;
  const proposedClient = !latest.replied && draft?.client && Object.keys(draft.client.fields).length ? draft.client : null;
  const [saveClient, setSaveClient] = useState(true);

  // Prefill the composer with the agent's draft when one arrives (unless the user is already typing).
  const draftKey = draft ? `${draft.text}|${draft.at?.toMillis() ?? ""}` : "";
  const lastDraftKey = useRef("");
  useEffect(() => {
    if (!draft?.text || draftKey === lastDraftKey.current) return;
    lastDraftKey.current = draftKey;
    setText((t) => {
      if (t.trim()) return t;
      setUsingDraft(true);
      return draft.text;
    });
  }, [draft, draftKey]);

  async function suggest() {
    setSuggesting(true);
    try {
      const reply = await onSuggest(note.trim() || undefined);
      lastDraftKey.current = ""; // let the effect accept the new draft too
      setText(reply);
      setUsingDraft(true);
      setConfirmBooking(true);
      setSaveClient(true);
      setNoteOpen(false);
      setNote("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Solo se pueden anexar imágenes");
    setUploading(true);
    try {
      const { url } = await uploadMedia(file);
      setAttachment({ url, name: file.name });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    if (!text.trim()) return toast.error("Escribe una respuesta");
    setSending(true);
    try {
      await onSend({
        text,
        ...(attachment ? { attachmentUrl: attachment.url } : {}),
        ...(proposed ? { booking: confirmBooking ? "confirm" : "cancel" } : {}),
        ...(proposedClient ? { saveClient } : {}),
      });
      if (proposedClient && saveClient) toast.success("Datos guardados en la ficha del cliente");
      if (proposed && confirmBooking) toast.success(`Cita confirmada: ${proposed.service} · ${proposed.label}`);
      setText("");
      setAttachment(null);
      setUsingDraft(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (!canReply)
    return <footer className="border-t p-3 text-sm text-muted-foreground">Solo lectura: no tienes permiso para responder.</footer>;

  return (
    <footer className="space-y-2 border-t bg-background p-3">
      {usingDraft && draft && text === draft.text && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs",
            draft.needsHuman ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-violet-500/10 text-violet-800 dark:text-violet-300",
          )}
        >
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Sugerido por IA{draft.needsHuman ? " · revisar antes de enviar" : ""}
            {draft.reason ? `: ${draft.reason}` : ""}
          </span>
        </div>
      )}
      {proposed && (
        <label className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-800 dark:text-emerald-300">
          <input type="checkbox" checked={confirmBooking} onChange={(e) => setConfirmBooking(e.target.checked)} />
          <CalendarCheck className="size-3.5 shrink-0" />
          <span>
            Confirmar reserva al enviar: <strong>{proposed.service}</strong> · {proposed.label}
            {!confirmBooking && " (se liberará el horario)"}
          </span>
        </label>
      )}
      {proposedClient && (
        <label className="flex items-center gap-2 rounded-lg bg-sky-500/10 px-2 py-1.5 text-xs text-sky-800 dark:text-sky-300">
          <input type="checkbox" checked={saveClient} onChange={(e) => setSaveClient(e.target.checked)} />
          <UserRoundPen className="size-3.5 shrink-0" />
          <span>
            Guardar en la ficha del cliente:{" "}
            {Object.entries(proposedClient.fields)
              .map(([k, v]) => `${FIELD_LABEL[k as keyof typeof FIELD_LABEL]} ${v}`)
              .join(" · ")}
          </span>
        </label>
      )}
      {latest.aiStatus === "error" && latest.aiError && (
        <p className="rounded-lg bg-destructive/10 px-2 py-1.5 text-xs text-destructive">El agente falló: {latest.aiError}</p>
      )}
      {noteOpen && (
        <div className="flex gap-2">
          <input
            autoFocus
            className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm"
            placeholder="Indicación opcional: más formal, ofrece descuento…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && suggest()}
          />
          <Button size="sm" variant="secondary" disabled={suggesting} onClick={suggest}>
            {suggesting ? "Pensando…" : "Generar"}
          </Button>
        </div>
      )}
      {attachment && (
        <div className="flex items-center gap-2 rounded-lg border p-1.5 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={attachment.url} alt="" className="size-10 rounded object-cover" />
          <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
          <Button variant="ghost" size="icon-xs" aria-label="Quitar anexo" onClick={() => setAttachment(null)}>
            <X />
          </Button>
        </div>
      )}
      <Textarea
        rows={3}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
      />
      <div className="flex items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!canAttach || uploading || sending}
          title={canAttach ? "Anexar una imagen" : attachHint}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip /> {uploading ? "Subiendo…" : "Anexo"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={suggesting || sending}
          title="Pedir una respuesta al agente IA"
          onClick={() => (noteOpen ? suggest() : setNoteOpen(true))}
        >
          <Sparkles /> {suggesting ? "Pensando…" : "Sugerir"}
        </Button>
        <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl+Enter para enviar</span>
        <Button size="sm" className="ml-auto" disabled={sending || uploading || !text.trim()} onClick={send}>
          <Send /> {sending ? "Enviando…" : "Enviar"}
        </Button>
      </div>
    </footer>
  );
}

/** "📅 Cita" chip on a reply that confirmed a booking. */
export function BookingChip({ booking }: { booking: NonNullable<Message["booking"]> }) {
  return (
    <span className="flex items-center gap-0.5 rounded bg-emerald-500/15 px-1 text-emerald-700 dark:text-emerald-300">
      <CalendarCheck className="size-3" /> Cita: {booking.service} · {booking.label}
    </span>
  );
}
