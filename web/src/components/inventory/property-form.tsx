"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Lock, Plus, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api";
import { AMENITIES, HIGHLIGHT_MAX, MAX_HIGHLIGHTS, MX_STATES, OPERATIONS, PROPERTY_TYPES, TITLE_MAX, buildTitle, forRent, forSale } from "@/lib/property-catalog";
import type { Operation, Property } from "@/lib/types";
import { useCan } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Form = Omit<Property, "id" | "photos" | "reservation" | "lease" | "hold" | "closedAt" | "createdAt" | "updatedAt" | "currency"> & {
  autoTitle: boolean;
};

const EMPTY: Form = {
  status: "borrador",
  propertyType: "Departamento",
  operation: "venta",
  salePrice: null,
  rentPrice: null,
  maintenanceFee: null,
  bedrooms: 2,
  bathrooms: 1,
  halfBathrooms: 0,
  parking: 1,
  builtArea: null,
  landArea: null,
  floor: "",
  yearBuilt: null,
  furnished: false,
  petsAllowed: false,
  availableFrom: null,
  development: "",
  location: { state: "", city: "", neighborhood: "", lat: null, lng: null },
  address: "",
  unit: "",
  ownerName: "",
  ownerPhone: "",
  description: "",
  amenities: [],
  highlights: [],
  title: "",
  stockNumber: "",
  intakeDate: new Date().toISOString(),
  autoTitle: true,
};

// Only the editable fields: photos, reservation… change elsewhere and must not mark the form dirty.
const formOf = (v: Property | null): Form =>
  v
    ? { ...(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, v[k as keyof Property] ?? EMPTY[k as keyof Form]])) as Form), autoTitle: v.title === buildTitle(v) }
    : { ...EMPTY, intakeDate: new Date().toISOString() };

const selectCls = "h-8 w-full rounded-lg border bg-background px-2 text-sm";
const COORDS_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

function Field({ label, htmlFor, children, wide }: { label: ReactNode; htmlFor?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "space-y-1 sm:col-span-2 lg:col-span-3" : "space-y-1"}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function Select({ id, value, options, onChange, empty }: { id: string; value: string | number; options: (string | number)[]; onChange: (v: string) => void; empty?: string }) {
  return (
    <select id={id} className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function NumberInput({ id, value, onChange, placeholder }: { id: string; value: number | null; onChange: (v: number | null) => void; placeholder?: string }) {
  return <Input id={id} type="number" inputMode="numeric" min={0} placeholder={placeholder} value={value ?? ""} onChange={(e) => onChange(numOrNull(e.target.value))} />;
}

/**
 * "20.6935, -103.3905" as copied from Google Maps (right click on the pin). Typed text stays as is until
 * it parses; an empty field removes the pin.
 */
function CoordsInput({ location, onChange }: { location: Form["location"]; onChange: (lat: number | null, lng: number | null) => void }) {
  const saved = location.lat != null && location.lng != null ? `${location.lat}, ${location.lng}` : "";
  const [text, setText] = useState(saved);
  const bad = !!text.trim() && !COORDS_RE.test(text);
  return (
    <>
      <Input
        id="p-coords"
        placeholder="20.6935, -103.3905"
        value={text}
        aria-invalid={bad}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          const ok = COORDS_RE.exec(v);
          if (!v.trim()) onChange(null, null);
          else if (ok) onChange(Number(ok[1]), Number(ok[2]));
        }}
      />
      <p className="text-[11px] text-muted-foreground">
        {bad ? "Formato: latitud, longitud" : "Cópialas de Google Maps (clic derecho sobre el punto). Aproximadas si no quieres revelar la dirección."}
      </p>
    </>
  );
}

/** Property data sheet (create or edit): what Mexican listing portals ask for a sale or rental. */
export function PropertyForm({ property, onSaved }: { property: Property | null; onSaved: (v: Property) => void }) {
  const can = useCan();
  const canEdit = can("inventory.edit");
  const canPrivate = can("inventory.private");
  const [form, setForm] = useState<Form>(() => formOf(property));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => {
      const next = { ...f, [k]: v };
      return next.autoTitle ? { ...next, title: buildTitle(next) } : next;
    });
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(property));
  const locked = ["apartado", "vendido", "rentado"].includes(property?.status ?? "");
  const isLand = form.propertyType === "Terreno";

  // Highlights: the agent's selling points, most important first.
  const [highlight, setHighlight] = useState("");
  const addHighlight = () => {
    const h = highlight.trim();
    if (!h) return;
    if (form.highlights.includes(h)) return setHighlight("");
    if (form.highlights.length >= MAX_HIGHLIGHTS) return toast.error(`Máximo ${MAX_HIGHLIGHTS} destacados`);
    set("highlights", [...form.highlights, h]);
    setHighlight("");
  };
  const moveHighlight = (i: number, d: -1 | 1) => {
    const next = [...form.highlights];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set("highlights", next);
  };

  // AI copywriter: title + description from the form as it is now (also before the first save).
  const [copy, setCopy] = useState<{ title: string; description: string } | null>(null);
  const [writing, setWriting] = useState(false);
  const hasPrice = (forSale(form.operation) ? !!form.salePrice : true) && (forRent(form.operation) ? !!form.rentPrice : true);
  const canWrite = hasPrice && !!form.location.city.trim();
  async function writeCopy() {
    setWriting(true);
    try {
      setCopy(await api<{ title: string; description: string }>("/api/properties/copy", { method: "POST", body: form }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setWriting(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const body = { ...form, title: form.autoTitle ? "" : form.title };
      const r = property
        ? await api<{ property: Property }>(`/api/properties/${property.id}`, { method: "PUT", body })
        : await api<{ property: Property }>("/api/properties", { method: "POST", body });
      setForm(formOf(r.property));
      onSaved(r.property);
      toast.success(property ? "Propiedad guardada" : "Propiedad creada: ahora agrega las fotos");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <fieldset disabled={!canEdit} className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Operación y precio</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Tipo de inmueble *" htmlFor="p-type">
              <Select id="p-type" value={form.propertyType} options={PROPERTY_TYPES} onChange={(v) => set("propertyType", v)} />
            </Field>
            <Field label="Operación *" htmlFor="p-op">
              <select id="p-op" className={selectCls} value={form.operation} onChange={(e) => set("operation", e.target.value as Operation)}>
                {OPERATIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Estado de la publicación" htmlFor="p-status">
              {locked ? (
                <p className="flex h-8 items-center gap-1 text-sm text-muted-foreground">
                  <Lock className="size-3.5" /> {property?.status === "apartado" ? "Apartado" : property?.status === "rentado" ? "Rentado" : "Vendido"} (se
                  cambia desde Pipeline)
                </p>
              ) : (
                <select id="p-status" className={selectCls} value={form.status} onChange={(e) => set("status", e.target.value as Form["status"])}>
                  <option value="borrador">Borrador (no lo ve el agente)</option>
                  <option value="disponible">Disponible</option>
                </select>
              )}
            </Field>
            {forSale(form.operation) && (
              <Field label="Precio de venta (MXN) *" htmlFor="p-sale">
                <NumberInput id="p-sale" value={form.salePrice} onChange={(v) => set("salePrice", v)} />
              </Field>
            )}
            {forRent(form.operation) && (
              <Field label="Renta mensual (MXN) *" htmlFor="p-rent">
                <NumberInput id="p-rent" value={form.rentPrice} onChange={(v) => set("rentPrice", v)} />
              </Field>
            )}
            <Field label="Mantenimiento mensual (MXN)" htmlFor="p-maint">
              <NumberInput id="p-maint" value={form.maintenanceFee} onChange={(v) => set("maintenanceFee", v)} />
            </Field>
            {forRent(form.operation) && (
              <Field label="Disponible para rentar desde" htmlFor="p-avail">
                <Input
                  id="p-avail"
                  type="date"
                  value={form.availableFrom?.slice(0, 10) ?? ""}
                  onChange={(e) => set("availableFrom", e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null)}
                />
              </Field>
            )}
            <Field label="Fecha de alta" htmlFor="p-intake">
              <Input
                id="p-intake"
                type="date"
                value={form.intakeDate.slice(0, 10)}
                onChange={(e) => e.target.value && set("intakeDate", new Date(`${e.target.value}T12:00:00`).toISOString())}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Distribución y superficie</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {!isLand && (
              <>
                <Field label="Recámaras" htmlFor="p-bed">
                  <NumberInput id="p-bed" value={form.bedrooms} onChange={(v) => set("bedrooms", v ?? 0)} />
                </Field>
                <Field label="Baños completos" htmlFor="p-bath">
                  <NumberInput id="p-bath" value={form.bathrooms} onChange={(v) => set("bathrooms", v ?? 0)} />
                </Field>
                <Field label="Medios baños" htmlFor="p-half">
                  <NumberInput id="p-half" value={form.halfBathrooms} onChange={(v) => set("halfBathrooms", v ?? 0)} />
                </Field>
                <Field label="Estacionamientos" htmlFor="p-park">
                  <NumberInput id="p-park" value={form.parking} onChange={(v) => set("parking", v ?? 0)} />
                </Field>
                <Field label="Superficie construida (m²)" htmlFor="p-built">
                  <NumberInput id="p-built" value={form.builtArea} onChange={(v) => set("builtArea", v)} />
                </Field>
              </>
            )}
            <Field label="Superficie de terreno (m²)" htmlFor="p-land">
              <NumberInput id="p-land" value={form.landArea} onChange={(v) => set("landArea", v)} />
            </Field>
            {!isLand && (
              <>
                <Field label="Piso / nivel" htmlFor="p-floor">
                  <Input id="p-floor" placeholder="PB, 5, PH…" value={form.floor} onChange={(e) => set("floor", e.target.value)} />
                </Field>
                <Field label="Año de construcción" htmlFor="p-year">
                  <NumberInput id="p-year" placeholder="2018" value={form.yearBuilt} onChange={(v) => set("yearBuilt", v)} />
                </Field>
                <div className="flex flex-wrap items-end gap-4 pb-1.5">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.furnished} onCheckedChange={(c) => set("furnished", Boolean(c))} /> Amueblado
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.petsAllowed} onCheckedChange={(c) => set("petsAllowed", Boolean(c))} /> Acepta mascotas
                  </label>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Ubicación</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Estado" htmlFor="p-state">
              <Select id="p-state" value={form.location.state} options={MX_STATES} empty="—" onChange={(v) => set("location", { ...form.location, state: v })} />
            </Field>
            <Field label="Ciudad / municipio *" htmlFor="p-city">
              <Input id="p-city" value={form.location.city} onChange={(e) => set("location", { ...form.location, city: e.target.value })} />
            </Field>
            <Field label="Colonia" htmlFor="p-hood">
              <Input id="p-hood" placeholder="Narvarte" value={form.location.neighborhood} onChange={(e) => set("location", { ...form.location, neighborhood: e.target.value })} />
            </Field>
            <Field label="Coordenadas (para el mapa)" htmlFor="p-coords">
              <CoordsInput location={form.location} onChange={(lat, lng) => set("location", { ...form.location, lat, lng })} />
            </Field>
            <Field label="Desarrollo / edificio" htmlFor="p-dev">
              <Input id="p-dev" placeholder="Torre Alameda" value={form.development} onChange={(e) => set("development", e.target.value)} />
            </Field>
            <Field label="Clave interna" htmlFor="p-stock">
              <Input id="p-stock" value={form.stockNumber} onChange={(e) => set("stockNumber", e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            Dirección exacta y propietario <Lock className="size-3.5 text-muted-foreground" aria-label="Privado" />
            <span className="text-xs font-normal text-muted-foreground">nunca se publica ni la ve el agente</span>
          </h3>
          {canPrivate ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Calle y número" htmlFor="p-addr">
                <Input id="p-addr" value={form.address} onChange={(e) => set("address", e.target.value)} />
              </Field>
              <Field label="Interior / depto." htmlFor="p-unit">
                <Input id="p-unit" value={form.unit} onChange={(e) => set("unit", e.target.value)} />
              </Field>
              <div className="hidden lg:block" />
              <Field label="Nombre del propietario" htmlFor="p-owner">
                <Input id="p-owner" value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} />
              </Field>
              <Field label="Teléfono del propietario" htmlFor="p-owner-tel">
                <Input id="p-owner-tel" type="tel" value={form.ownerPhone} onChange={(e) => set("ownerPhone", e.target.value)} />
              </Field>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No tienes acceso a la dirección exacta ni a los datos del propietario.</p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Amenidades</h3>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {AMENITIES.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.amenities.includes(f)}
                  onCheckedChange={(c) => set("amenities", c ? [...form.amenities, f] : form.amenities.filter((x) => x !== f))}
                />
                {f}
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Publicación</h3>
          <Field
            label={
              <>
                Destacados del inmueble{" "}
                <span className="font-normal text-muted-foreground">
                  · {form.highlights.length}/{MAX_HIGHLIGHTS} · el primero es el más importante
                </span>
              </>
            }
            htmlFor="p-highlight"
            wide
          >
            <div className="flex gap-2">
              <Input
                id="p-highlight"
                maxLength={HIGHLIGHT_MAX}
                placeholder="p. ej. Remodelada en 2024, vista al parque, a 5 min de la universidad"
                value={highlight}
                onChange={(e) => setHighlight(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addHighlight();
                  }
                }}
              />
              <Button variant="outline" size="sm" className="h-8 shrink-0" disabled={!highlight.trim() || form.highlights.length >= MAX_HIGHLIGHTS} onClick={addHighlight}>
                <Plus /> Agregar destacado
              </Button>
            </div>
            {form.highlights.length > 0 ? (
              <ol className="mt-2 space-y-1">
                {form.highlights.map((h, i) => (
                  <li key={h} className="flex items-center gap-1 rounded-lg border px-2 py-1 text-sm">
                    <span className="w-5 shrink-0 text-xs text-muted-foreground">{i + 1}.</span>
                    <span className="min-w-0 flex-1 break-words">{h}</span>
                    <Button variant="ghost" size="icon-xs" aria-label="Subir" disabled={i === 0} onClick={() => moveHighlight(i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="Bajar" disabled={i === form.highlights.length - 1} onClick={() => moveHighlight(i, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label={`Quitar ${h}`} onClick={() => set("highlights", form.highlights.filter((x) => x !== h))}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[11px] text-muted-foreground">Puntos fuertes que no están en los campos: remodelación, vista, iluminación, cercanías…</p>
            )}
          </Field>

          <div className="space-y-2 rounded-lg border border-dashed p-3 sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" disabled={!canWrite || writing} onClick={writeCopy}>
                <Sparkles /> {writing ? "Escribiendo…" : copy ? "Regenerar" : "Escribir título y descripción con IA"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {canWrite ? "Usa solo los datos de este formulario y tus destacados." : "Completa precio y ciudad para generar."}
              </span>
            </div>
            {copy && (
              <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
                <p className="font-semibold">{copy.title}</p>
                <p className="whitespace-pre-line text-muted-foreground">{copy.description}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setForm((f) => ({ ...f, title: copy.title, description: copy.description, autoTitle: false }));
                      setCopy(null);
                      toast.success("Texto aplicado; guarda para conservarlo");
                    }}
                  >
                    Usar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setCopy(null)}>
                    Descartar
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Field label={`Título (máx. ${TITLE_MAX} caracteres)`} htmlFor="p-title" wide>
            <div className="flex gap-2">
              <Input
                id="p-title"
                maxLength={TITLE_MAX}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value, autoTitle: false }))}
              />
              {!form.autoTitle && (
                <Button variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, autoTitle: true, title: buildTitle(f) }))}>
                  Automático
                </Button>
              )}
            </div>
          </Field>
          <Field label="Descripción" htmlFor="p-desc" wide>
            <Textarea
              id="p-desc"
              rows={6}
              placeholder="Iluminación, vista, acabados, cercanía a escuelas y transporte, requisitos para rentar…"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
        </section>
      </fieldset>

      {canEdit && (
        <div className="sticky bottom-0 flex gap-2 border-t bg-background py-3">
          <Button disabled={(!dirty && !!property) || saving} onClick={save}>
            {saving ? "Guardando…" : property ? "Guardar cambios" : "Crear propiedad"}
          </Button>
          {dirty && property && (
            <Button variant="ghost" onClick={() => setForm(formOf(property))}>
              Descartar cambios
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
