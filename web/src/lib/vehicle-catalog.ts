// Option lists for the vehicle form (shared by the UI and the API). Values are what we store and what
// lib/mercadolibre.ts maps to Mercado Libre attributes, so keep them in Spanish as ML México shows them.
import type { DealStage, Vehicle, VehicleStatus } from "@/lib/types";

export const VEHICLE_STATUS: { id: VehicleStatus; label: string }[] = [
  { id: "borrador", label: "Borrador" },
  { id: "disponible", label: "Disponible" },
  { id: "apartado", label: "Apartado" },
  { id: "vendido", label: "Vendido" },
];
export const statusLabel = (s: string) => VEHICLE_STATUS.find((x) => x.id === s)?.label ?? s;

export const BODY_TYPES = ["Sedán", "Hatchback", "SUV", "Pick-Up", "Coupé", "Convertible", "Minivan", "Van", "Camión", "Station Wagon"];
export const FUELS = ["Gasolina", "Diésel", "Híbrido", "Eléctrico", "Gas LP", "Gas natural"];
export const TRANSMISSIONS = ["Automática", "Manual", "CVT", "Automática secuencial"];
export const TRACTIONS = ["Delantera", "Trasera", "4x4", "AWD"];
export const DOORS = [2, 3, 4, 5];
export const COLORS = ["Blanco", "Negro", "Gris", "Plata", "Rojo", "Azul", "Verde", "Beige", "Café", "Dorado", "Naranja", "Amarillo", "Vino", "Otro"];

export const FEATURES = [
  "Aire acondicionado",
  "Climatizador automático",
  "Bolsas de aire frontales",
  "Bolsas de aire laterales",
  "Frenos ABS",
  "Control de estabilidad",
  "Control crucero",
  "Cámara de reversa",
  "Sensores de estacionamiento",
  "Pantalla táctil",
  "Apple CarPlay / Android Auto",
  "Bluetooth",
  "Navegador GPS",
  "Vidrios eléctricos",
  "Espejos eléctricos",
  "Asientos de piel",
  "Asientos con calefacción",
  "Quemacocos",
  "Rines de aluminio",
  "Faros de niebla",
  "Faros LED",
  "Encendido sin llave",
  "Tercera fila de asientos",
  "Factura original",
  "Servicios de agencia",
];

export const MX_STATES = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua", "Ciudad de México", "Coahuila",
  "Colima", "Durango", "Estado de México", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit",
  "Nuevo León", "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas",
  "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas",
];

// Mercado Libre caps listing titles at 60 characters.
export const TITLE_MAX = 60;
export const buildTitle = (v: Pick<Vehicle, "brand" | "model" | "trim" | "year">) =>
  [v.brand, v.model, v.trim, v.year || ""].map((s) => String(s).trim()).filter(Boolean).join(" ").slice(0, TITLE_MAX);

export const MAX_PHOTOS = 30;

export const daysOnLot = (intakeDate: string, soldAt?: string | null) =>
  Math.max(0, Math.floor(((soldAt ? new Date(soldAt) : new Date()).getTime() - new Date(intakeDate).getTime()) / 86_400_000));

export const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);

export const DEAL_STAGES: { id: DealStage; label: string }[] = [
  { id: "nuevo", label: "Nuevo" },
  { id: "contactado", label: "Contactado" },
  { id: "prueba", label: "Prueba de manejo" },
  { id: "negociacion", label: "Negociación" },
  { id: "apartado", label: "Apartado" },
  { id: "vendido", label: "Vendido" },
  { id: "perdido", label: "Perdido" },
];
export const stageLabel = (s: string) => DEAL_STAGES.find((x) => x.id === s)?.label ?? s;
// Stages only reachable through the apartado / venta dialogs (they change the vehicle too).
export const GUARDED_STAGES: DealStage[] = ["apartado", "vendido"];

export const PAYMENT_METHODS = [
  { id: "contado", label: "Contado" },
  { id: "credito", label: "Crédito de la agencia" },
  { id: "financiera", label: "Financiera / banco" },
] as const;
