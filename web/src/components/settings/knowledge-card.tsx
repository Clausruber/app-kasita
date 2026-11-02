"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { AlertTriangle, Download, FileText, RefreshCw, Trash2, Upload } from "lucide-react";
import { api, apiForm } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type KnowledgeState = {
  files: { id: string; name: string; pages: number; chars: number; source: "pdf" | "company"; createdAt: string | null }[];
  manual: string;
  manualSource: "generated" | "edited" | null;
  manualUpdatedAt: string | null;
  stale: boolean;
};

const MAX_MB = 15;

/** PDFs → Markdown, merged with the instructions into the "Manual del agente" the AI reads as context. */
export function KnowledgeCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["ai-knowledge", user?.uid];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    enabled: !!user,
    queryFn: () => api<KnowledgeState>("/api/ai/knowledge"),
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | "upload" | "delete" | "compile" | "save">(null);
  const [edited, setEdited] = useState<string | null>(null); // unsaved manual edits
  const [dragging, setDragging] = useState(false);

  const manual = edited ?? data?.manual ?? "";
  const setState = (s: KnowledgeState) => {
    qc.setQueryData(key, s);
    setEdited(null);
  };

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<KnowledgeState>, ok: string) {
    setBusy(kind);
    try {
      setState(await fn());
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function upload(file: File | undefined) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) return toast.error("Solo se aceptan archivos PDF");
    if (file.size > MAX_MB * 1024 * 1024) return toast.error(`El PDF supera ${MAX_MB} MB`);
    const form = new FormData();
    form.append("file", file);
    run("upload", () => apiForm<KnowledgeState>("/api/ai/knowledge", form), `"${file.name}" procesado y añadido al manual`);
  }

  function download() {
    const blob = new Blob([manual], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "manual-del-agente.md";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-5" /> Conocimiento del agente
        </CardTitle>
        <CardDescription>
          Sube PDFs con información del negocio (catálogo, políticas, FAQ…). Se convierten a Markdown y se unen con
          tus instrucciones y el perfil de la marca en un único <strong>Manual del agente</strong>, que la IA usa como
          contexto en cada respuesta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

        {/* Upload */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            upload(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-xl border border-dashed p-5 text-center text-sm transition-colors",
            dragging && "border-primary bg-primary/5",
          )}
        >
          <Upload className="size-5 text-muted-foreground" />
          {busy === "upload" ? (
            <p className="text-muted-foreground">Leyendo el PDF y generando el Markdown… puede tardar 1-2 minutos.</p>
          ) : (
            <p className="text-muted-foreground">Arrastra un PDF aquí o</p>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => fileInput.current?.click()}>
            {busy === "upload" ? "Procesando…" : "Elegir PDF"}
          </Button>
          <p className="text-xs text-muted-foreground">Máx. {MAX_MB} MB y 10 documentos. Los PDF escaneados (solo imagen) no tienen texto que leer.</p>
        </div>

        {/* Documents */}
        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {!!data?.files.length && (
          <ul className="divide-y rounded-lg border">
            {data.files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{f.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {f.source === "company" ? "Generado desde Ajustes → Empresa" : `${f.pages} ${f.pages === 1 ? "página" : "páginas"}`} ·{" "}
                    {(f.chars / 1000).toFixed(1)}k caracteres de Markdown
                  </p>
                </div>
                {f.source !== "company" && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Quitar ${f.name}`}
                  disabled={!!busy}
                  onClick={() => {
                    if (!confirm(`¿Quitar "${f.name}" del conocimiento del agente?`)) return;
                    run(
                      "delete",
                      () => api<KnowledgeState>(`/api/ai/knowledge?fileId=${encodeURIComponent(f.id)}`, { method: "DELETE" }),
                      "Documento quitado y manual regenerado",
                    );
                  }}
                >
                  <Trash2 />
                </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Manual */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto text-sm font-semibold">Manual del agente (Markdown)</h3>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() => {
                if (edited !== null && !confirm("Regenerar descarta tus cambios sin guardar. ¿Continuar?")) return;
                run("compile", () => api<KnowledgeState>("/api/ai/knowledge/manual", { method: "POST" }), "Manual regenerado");
              }}
            >
              <RefreshCw className={cn(busy === "compile" && "animate-spin")} /> {data?.manual ? "Regenerar" : "Generar"}
            </Button>
            <Button size="sm" variant="outline" disabled={!manual} onClick={download}>
              <Download /> .md
            </Button>
          </div>

          {data?.stale && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Cambiaste las instrucciones o el perfil después de generar el manual. El agente ya usa tus cambios, pero
              regenera el manual para integrarlos bien.
            </p>
          )}

          {data?.manual || edited !== null ? (
            <>
              <Textarea
                rows={16}
                className="font-mono text-xs"
                value={manual}
                onChange={(e) => setEdited(e.target.value)}
                aria-label="Manual del agente"
              />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="mr-auto">
                  {(manual.length / 1000).toFixed(1)}k caracteres
                  {data?.manualUpdatedAt &&
                    ` · ${data.manualSource === "edited" ? "editado" : "generado"} ${formatDistanceToNow(new Date(data.manualUpdatedAt), { addSuffix: true, locale: es })}`}
                </span>
                {edited !== null && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEdited(null)}>
                      Descartar
                    </Button>
                    <Button
                      size="sm"
                      disabled={!!busy}
                      onClick={() =>
                        run(
                          "save",
                          () => api<KnowledgeState>("/api/ai/knowledge/manual", { method: "PUT", body: { manual } }),
                          "Manual guardado",
                        )
                      }
                    >
                      Guardar cambios
                    </Button>
                  </>
                )}
              </div>
            </>
          ) : (
            !isLoading && (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                Aún no hay manual. Sube un PDF o pulsa <strong>Generar</strong> para crearlo solo con tus instrucciones y
                el perfil de la marca.
              </p>
            )
          )}
          {busy === "compile" && <p className="text-xs text-muted-foreground">Generando el manual… puede tardar un minuto.</p>}
        </section>
      </CardContent>
    </Card>
  );
}
