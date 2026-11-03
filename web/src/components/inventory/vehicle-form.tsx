"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { api } from "@/lib/api";
import {
  BODY_TYPES,
  COLORS,
  DOORS,
  FEATURES,
  FUELS,
  MX_STATES,
  TITLE_MAX,
  TRACTIONS,
  TRANSMISSIONS,
  buildTitle,
} from "@/lib/vehicle-catalog";
import type { Vehicle } from "@/lib/types";
import { useCan } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Form = Omit<Vehicle, "id" | "photos" | "reservation" | "hold" | "soldAt" | "createdAt" | "updatedAt" | "mlPermalink" | "currency"> & {
  autoTitle: boolean;
};

const EMPTY: Form = {
  status: "borrador",
  brand: "",
  model: "",
  year: new Date().getFullYear(),
  trim: "",
  km: 0,
  price: 0,
  condition: "usado",
  bodyType: "",
  fuel: "Gasolina",
  transmission: "Automática",
  doors: 4,
  color: "",
  engine: "",
  traction: "Delantera",
  vin: "",
  plates: "",
  singleOwner: false,
  location: { state: "", city: "" },
  description: "",
  features: [],
  title: "",
  stockNumber: "",
  intakeDate: new Date().toISOString(),
  autoTitle: true,
};

// Only the editable fields: photos, reservation… change elsewhere and must not mark the form dirty.
const formOf = (v: Vehicle | null): Form =>
  v
    ? { ...(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, v[k as keyof Vehicle] ?? EMPTY[k as keyof Form]])) as Form), autoTitle: v.title === buildTitle(v) }
    : { ...EMPTY, intakeDate: new Date().toISOString() };

const selectCls = "h-8 w-full rounded-lg border bg-background px-2 text-sm";

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

/** Vehicle data sheet (create or edit). Fields cover what Mercado Libre México asks for a car listing. */
export function VehicleForm({ vehicle, onSaved }: { vehicle: Vehicle | null; onSaved: (v: Vehicle) => void }) {
  const can = useCan();
  const canEdit = can("inventory.edit");
  const canPrivate = can("inventory.private");
  const [form, setForm] = useState<Form>(() => formOf(vehicle));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => {
      const next = { ...f, [k]: v };
      return next.autoTitle ? { ...next, title: buildTitle(next) } : next;
    });
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(vehicle));
  const locked = vehicle?.status === "apartado" || vehicle?.status === "vendido";

  async function save() {
    setSaving(true);
    try {
      const body = { ...form, title: form.autoTitle ? "" : form.title };
      const r = vehicle
        ? await api<{ vehicle: Vehicle }>(`/api/vehicles/${vehicle.id}`, { method: "PUT", body })
        : await api<{ vehicle: Vehicle }>("/api/vehicles", { method: "POST", body });
      setForm(formOf(r.vehicle));
      onSaved(r.vehicle);
      toast.success(vehicle ? "Auto guardado" : "Auto creado: ahora agrega las fotos");
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
          <h3 className="text-sm font-semibold">Datos principales</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Marca *" htmlFor="v-brand">
              <Input id="v-brand" placeholder="Volkswagen" value={form.brand} onChange={(e) => set("brand", e.target.value)} />
            </Field>
            <Field label="Modelo *" htmlFor="v-model">
              <Input id="v-model" placeholder="Jetta" value={form.model} onChange={(e) => set("model", e.target.value)} />
            </Field>
            <Field label="Año *" htmlFor="v-year">
              <Input id="v-year" type="number" inputMode="numeric" value={form.year || ""} onChange={(e) => set("year", Number(e.target.value))} />
            </Field>
            <Field label="Versión" htmlFor="v-trim">
              <Input id="v-trim" placeholder="Comfortline 1.4 TSI" value={form.trim} onChange={(e) => set("trim", e.target.value)} />
            </Field>
            <Field label="Precio (MXN) *" htmlFor="v-price">
              <Input id="v-price" type="number" inputMode="numeric" min={0} value={form.price || ""} onChange={(e) => set("price", Number(e.target.value))} />
            </Field>
            <Field label="Kilometraje" htmlFor="v-km">
              <Input id="v-km" type="number" inputMode="numeric" min={0} value={form.km} onChange={(e) => set("km", Number(e.target.value))} />
            </Field>
            <Field label="Condición" htmlFor="v-cond">
              <select id="v-cond" className={selectCls} value={form.condition} onChange={(e) => set("condition", e.target.value as Form["condition"])}>
                <option value="usado">Usado</option>
                <option value="nuevo">Nuevo</option>
              </select>
            </Field>
            <Field label="Estado de la publicación" htmlFor="v-status">
              {locked ? (
                <p className="flex h-8 items-center gap-1 text-sm text-muted-foreground">
                  <Lock className="size-3.5" /> {vehicle?.status === "apartado" ? "Apartado" : "Vendido"} (se cambia desde Pipeline)
                </p>
              ) : (
                <select id="v-status" className={selectCls} value={form.status} onChange={(e) => set("status", e.target.value as Form["status"])}>
                  <option value="borrador">Borrador (no lo ve el agente)</option>
                  <option value="disponible">Disponible</option>
                </select>
              )}
            </Field>
            <Field label="Fecha de ingreso al lote" htmlFor="v-intake">
              <Input
                id="v-intake"
                type="date"
                value={form.intakeDate.slice(0, 10)}
                onChange={(e) => e.target.value && set("intakeDate", new Date(`${e.target.value}T12:00:00`).toISOString())}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Mecánica y apariencia</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Carrocería" htmlFor="v-body">
              <Select id="v-body" value={form.bodyType} options={BODY_TYPES} empty="—" onChange={(v) => set("bodyType", v)} />
            </Field>
            <Field label="Combustible" htmlFor="v-fuel">
              <Select id="v-fuel" value={form.fuel} options={FUELS} empty="—" onChange={(v) => set("fuel", v)} />
            </Field>
            <Field label="Transmisión" htmlFor="v-trans">
              <Select id="v-trans" value={form.transmission} options={TRANSMISSIONS} empty="—" onChange={(v) => set("transmission", v)} />
            </Field>
            <Field label="Tracción" htmlFor="v-traction">
              <Select id="v-traction" value={form.traction} options={TRACTIONS} empty="—" onChange={(v) => set("traction", v)} />
            </Field>
            <Field label="Motor (litros)" htmlFor="v-engine">
              <Input id="v-engine" placeholder="1.4" value={form.engine} onChange={(e) => set("engine", e.target.value)} />
            </Field>
            <Field label="Puertas" htmlFor="v-doors">
              <Select id="v-doors" value={form.doors} options={DOORS} onChange={(v) => set("doors", Number(v))} />
            </Field>
            <Field label="Color" htmlFor="v-color">
              <Input id="v-color" list="v-colors" value={form.color} onChange={(e) => set("color", e.target.value)} />
              <datalist id="v-colors">
                {COLORS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
              <Checkbox checked={form.singleOwner} onCheckedChange={(c) => set("singleOwner", Boolean(c))} /> Único dueño
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            Identificación <Lock className="size-3.5 text-muted-foreground" aria-label="Privado" />
            <span className="text-xs font-normal text-muted-foreground">nunca se publica ni la ve el agente</span>
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {canPrivate ? (
              <>
                <Field label="VIN / número de serie" htmlFor="v-vin">
                  <Input id="v-vin" maxLength={17} className="font-mono uppercase" value={form.vin} onChange={(e) => set("vin", e.target.value)} />
                </Field>
                <Field label="Placas" htmlFor="v-plates">
                  <Input id="v-plates" maxLength={12} className="uppercase" value={form.plates} onChange={(e) => set("plates", e.target.value)} />
                </Field>
              </>
            ) : (
              <p className="text-sm text-muted-foreground sm:col-span-2">No tienes acceso a VIN y placas.</p>
            )}
            <Field label="Número de stock interno" htmlFor="v-stock">
              <Input id="v-stock" value={form.stockNumber} onChange={(e) => set("stockNumber", e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Ubicación</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Estado" htmlFor="v-state">
              <Select id="v-state" value={form.location.state} options={MX_STATES} empty="—" onChange={(v) => set("location", { ...form.location, state: v })} />
            </Field>
            <Field label="Ciudad / municipio" htmlFor="v-city">
              <Input id="v-city" value={form.location.city} onChange={(e) => set("location", { ...form.location, city: e.target.value })} />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Equipamiento</h3>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.features.includes(f)}
                  onCheckedChange={(c) => set("features", c ? [...form.features, f] : form.features.filter((x) => x !== f))}
                />
                {f}
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Publicación</h3>
          <Field label={`Título (máx. ${TITLE_MAX} caracteres, como en Mercado Libre)`} htmlFor="v-title" wide>
            <div className="flex gap-2">
              <Input
                id="v-title"
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
          <Field label="Descripción" htmlFor="v-desc" wide>
            <Textarea
              id="v-desc"
              rows={6}
              placeholder="Estado general, servicios, garantía, documentos, por qué conviene…"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
        </section>
      </fieldset>

      {canEdit && (
        <div className="sticky bottom-0 flex gap-2 border-t bg-background py-3">
          <Button disabled={(!dirty && !!vehicle) || saving} onClick={save}>
            {saving ? "Guardando…" : vehicle ? "Guardar cambios" : "Crear auto"}
          </Button>
          {dirty && vehicle && (
            <Button variant="ghost" onClick={() => setForm(formOf(vehicle))}>
              Descartar cambios
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
