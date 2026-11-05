"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BookOpen, CalendarCheck, FileText, Paperclip, Send, Sparkles, UserRoundPen, X } from "lucide-react";
import { uploadMedia } from "@/lib/api";
import type { Message } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCan } from "@/hooks/use-me";
import { CatalogDrawer, type CatalogPrefill } from "@/components/quotes/catalog-drawer";

export type SendInput = {
  text: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentType?: "image" | "file";
  booking?: "confirm" | "cancel";
  saveClient?: boolean;
  quote?: "send" | "skip"; // comments: send the AI-proposed quote by private reply
};

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
  catalog,
}: {
  latest: Message;
  placeholder: string;
  canAttach: boolean;
  attachHint?: string;
  catalog?: CatalogPrefill; // DMs: "Catálogo" opens the drawer and attaches the PDF
  onSend: (input: SendInput) => Promise<void>;
  onSuggest: (note?: string) => Promise<string>;
}) {
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<{ url: string; name: string; type: "image" | "file" } | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const canCatalog = useCan()("inventory");
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
  const proposedQuote = !latest.replied && !latest.quoteDm ? draft?.quote : null;
  const [sendQuote, setSendQuote] = useState(true);

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
      setSendQuote(true);
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
      setAttachment({ url, name: file.name, type: "image" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    if (!text.trim() && !attachment) return toast.error("Escribe una respuesta");
    setSending(true);
    try {
      await onSend({
        text,
        ...(attachment ? { attachmentUrl: attachment.url, attachmentName: attachment.name, attachmentType: attachment.type } : {}),
        ...(proposed ? { booking: confirmBooking ? "confirm" : "cancel" } : {}),
        ...(proposedClient ? { saveClient } : {}),
        ...(proposedQuote ? { quote: sendQuote ? "send" : "skip" } : {}),
      });
      if (proposedQuote && sendQuote) toast.success(`Cotización de ${proposedQuote.title} enviada por mensaje privado`);
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
      {proposedQuote && (
        <label className="flex items-center gap-2 rounded-lg bg-violet-500/10 px-2 py-1.5 text-xs text-violet-800 dark:text-violet-300">
          <input type="checkbox" checked={sendQuote} onChange={(e) => setSendQuote(e.target.checked)} />
          <FileText className="size-3.5 shrink-0" />
          <span>
            Enviar por mensaje privado la cotización de <strong>{proposedQuote.title}</strong> (link público)
            {!sendQuote && " · revisa que la respuesta no diga que se le envió"}
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
          {attachment.type === "file" ? (
            <span className="flex size-10 items-center justify-center rounded bg-red-500/10 text-[10px] font-bold text-red-700 dark:text-red-300">PDF</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={attachment.url} alt="" className="size-10 rounded object-cover" />
          )}
          <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
          {attachment.type === "file" && (
            <a href={attachment.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              Ver
            </a>
          )}
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
        {catalog && canCatalog && (
          <Button variant="outline" size="sm" disabled={sending} title="Armar una cotización (link) con propiedades" onClick={() => setCatalogOpen(true)}>
            <BookOpen /> Catálogo
          </Button>
        )}
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
        <Button size="sm" className="ml-auto" disabled={sending || uploading || (!text.trim() && !attachment)} onClick={send}>
          <Send /> {sending ? "Enviando…" : "Enviar"}
        </Button>
      </div>
      {catalog && catalogOpen && (
        <CatalogDrawer
          open
          onOpenChange={setCatalogOpen}
          mode="insert"
          prefill={catalog}
          // The link goes into the message; the seller edits and sends it (never sent automatically).
          onInsertLink={(message) => setText((t) => (t.trim() ? `${t.trimEnd()}\n\n${message}` : message))}
        />
      )}
    </footer>
  );
}

/** Chip on a public reply whose quote went to the commenter by private reply. */
export function QuoteChip({ quote }: { quote: NonNullable<Message["quote"]> }) {
  return (
    <span className="flex items-center gap-0.5 rounded bg-violet-500/15 px-1 text-violet-700 dark:text-violet-300">
      <FileText className="size-3" /> {quote.folio} por DM · {quote.propertyTitle}
      {quote.uncertain ? " (sin confirmar)" : ""}
    </span>
  );
}

/** "📅 Cita" chip on a reply that confirmed a booking. */
export function BookingChip({ booking }: { booking: NonNullable<Message["booking"]> }) {
  return (
    <span className="flex items-center gap-0.5 rounded bg-emerald-500/15 px-1 text-emerald-700 dark:text-emerald-300">
      <CalendarCheck className="size-3" /> Cita: {booking.service}
      {booking.property ? ` · ${booking.property}` : ""} · {booking.label}
      {booking.lane ? ` · espacio ${booking.lane}` : ""}
    </span>
  );
}
