import { FEATURES } from "@/lib/vehicle-catalog";

// Test inventory for Inventario → Datos de prueba: 50 units marked `demo: true` so they can be wiped in one go.
// Values are fixed per index (no Math.random) so every load produces the same lot.

type Base = [brand: string, model: string, trim: string, bodyType: string, fuel: string, transmission: string, traction: string, engine: string, newPrice: number, doors: number];

const MODELS: Base[] = [
  ["Nissan", "Versa", "Advance", "Sedán", "Gasolina", "CVT", "Delantera", "1.6", 340_000, 4],
  ["Nissan", "Sentra", "Exclusive", "Sedán", "Gasolina", "CVT", "Delantera", "2.0", 480_000, 4],
  ["Nissan", "March", "Sense", "Hatchback", "Gasolina", "Manual", "Delantera", "1.6", 270_000, 5],
  ["Nissan", "Kicks", "Advance", "SUV", "Gasolina", "CVT", "Delantera", "1.6", 430_000, 5],
  ["Nissan", "X-Trail", "Exclusive", "SUV", "Gasolina", "CVT", "AWD", "2.5", 690_000, 5],
  ["Nissan", "NP300", "Doble Cabina SE", "Pick-Up", "Diésel", "Manual", "4x4", "2.5", 560_000, 4],
  ["Chevrolet", "Aveo", "LT", "Sedán", "Gasolina", "Automática", "Delantera", "1.5", 290_000, 4],
  ["Chevrolet", "Onix", "Premier", "Sedán", "Gasolina", "Automática", "Delantera", "1.0", 350_000, 4],
  ["Chevrolet", "Tracker", "Premier", "SUV", "Gasolina", "Automática", "Delantera", "1.2", 480_000, 5],
  ["Chevrolet", "Silverado", "LT Crew Cab", "Pick-Up", "Gasolina", "Automática", "4x4", "5.3", 1_050_000, 4],
  ["Chevrolet", "Tahoe", "Premier", "SUV", "Gasolina", "Automática", "4x4", "5.3", 1_650_000, 5],
  ["Volkswagen", "Jetta", "Comfortline", "Sedán", "Gasolina", "Automática", "Delantera", "1.4", 480_000, 4],
  ["Volkswagen", "Vento", "Highline", "Sedán", "Gasolina", "Automática", "Delantera", "1.6", 340_000, 4],
  ["Volkswagen", "Polo", "Comfortline", "Hatchback", "Gasolina", "Manual", "Delantera", "1.6", 320_000, 5],
  ["Volkswagen", "Tiguan", "Comfortline", "SUV", "Gasolina", "Automática", "Delantera", "1.4", 650_000, 5],
  ["Volkswagen", "Taos", "Highline", "SUV", "Gasolina", "Automática", "Delantera", "1.4", 600_000, 5],
  ["Toyota", "Corolla", "SE", "Sedán", "Gasolina", "CVT", "Delantera", "2.0", 470_000, 4],
  ["Toyota", "Corolla", "Hybrid", "Sedán", "Híbrido", "CVT", "Delantera", "1.8", 520_000, 4],
  ["Toyota", "Yaris", "S", "Sedán", "Gasolina", "CVT", "Delantera", "1.5", 330_000, 4],
  ["Toyota", "RAV4", "XLE", "SUV", "Gasolina", "Automática", "AWD", "2.5", 720_000, 5],
  ["Toyota", "Hilux", "SR Doble Cabina", "Pick-Up", "Gasolina", "Manual", "Trasera", "2.7", 560_000, 4],
  ["Toyota", "Tacoma", "TRD Sport", "Pick-Up", "Gasolina", "Automática", "4x4", "3.5", 850_000, 4],
  ["Toyota", "Sienna", "XLE Hybrid", "Minivan", "Híbrido", "CVT", "Delantera", "2.5", 1_050_000, 5],
  ["Honda", "Civic", "Touring", "Sedán", "Gasolina", "CVT", "Delantera", "1.5", 590_000, 4],
  ["Honda", "City", "Sport", "Sedán", "Gasolina", "CVT", "Delantera", "1.5", 380_000, 4],
  ["Honda", "HR-V", "Touring", "SUV", "Gasolina", "CVT", "Delantera", "1.8", 520_000, 5],
  ["Honda", "CR-V", "Touring", "SUV", "Gasolina", "CVT", "AWD", "1.5", 760_000, 5],
  ["Honda", "Odyssey", "Touring", "Minivan", "Gasolina", "Automática", "Delantera", "3.5", 1_000_000, 5],
  ["Mazda", "Mazda 2", "i Grand Touring", "Hatchback", "Gasolina", "Automática", "Delantera", "1.5", 340_000, 5],
  ["Mazda", "Mazda 3", "i Sport", "Sedán", "Gasolina", "Automática", "Delantera", "2.5", 470_000, 4],
  ["Mazda", "CX-30", "i Grand Touring", "SUV", "Gasolina", "Automática", "Delantera", "2.5", 560_000, 5],
  ["Mazda", "CX-5", "Signature", "SUV", "Gasolina", "Automática", "AWD", "2.5", 730_000, 5],
  ["Mazda", "MX-5", "RF", "Convertible", "Gasolina", "Manual", "Trasera", "2.0", 650_000, 2],
  ["Kia", "Rio", "EX", "Sedán", "Gasolina", "Automática", "Delantera", "1.6", 340_000, 4],
  ["Kia", "Forte", "GT Line", "Sedán", "Gasolina", "CVT", "Delantera", "2.0", 440_000, 4],
  ["Kia", "Seltos", "SX", "SUV", "Gasolina", "Automática", "Delantera", "1.6", 530_000, 5],
  ["Kia", "Sportage", "SXL", "SUV", "Gasolina", "Automática", "AWD", "2.5", 700_000, 5],
  ["Hyundai", "Grand i10", "GLS", "Hatchback", "Gasolina", "Manual", "Delantera", "1.2", 260_000, 5],
  ["Hyundai", "Elantra", "Limited", "Sedán", "Gasolina", "CVT", "Delantera", "2.0", 480_000, 4],
  ["Hyundai", "Tucson", "Limited", "SUV", "Híbrido", "Automática", "AWD", "1.6", 760_000, 5],
  ["Ford", "Ranger", "XLT", "Pick-Up", "Diésel", "Automática", "4x4", "2.0", 780_000, 4],
  ["Ford", "Lobo", "Lariat", "Pick-Up", "Gasolina", "Automática", "4x4", "3.5", 1_250_000, 4],
  ["Ford", "Mustang", "GT", "Coupé", "Gasolina", "Automática", "Trasera", "5.0", 1_100_000, 2],
  ["Ford", "Explorer", "Limited", "SUV", "Gasolina", "Automática", "AWD", "2.3", 1_000_000, 5],
  ["Jeep", "Wrangler", "Rubicon", "SUV", "Gasolina", "Automática", "4x4", "2.0", 1_150_000, 4],
  ["Jeep", "Compass", "Limited", "SUV", "Gasolina", "Automática", "Delantera", "1.3", 620_000, 5],
  ["RAM", "700", "Bighorn", "Pick-Up", "Gasolina", "Manual", "Delantera", "1.3", 360_000, 2],
  ["BMW", "Serie 3", "330i Sport Line", "Sedán", "Gasolina", "Automática", "Trasera", "2.0", 1_050_000, 4],
  ["Audi", "Q5", "Elite", "SUV", "Gasolina", "Automática secuencial", "AWD", "2.0", 1_150_000, 5],
  ["Tesla", "Model 3", "Long Range", "Sedán", "Eléctrico", "Automática", "AWD", "", 1_000_000, 4],
];

const COLORS = ["Blanco", "Negro", "Gris", "Plata", "Rojo", "Azul", "Blanco", "Gris", "Vino", "Beige"];
const CITIES: [string, string][] = [
  ["Ciudad de México", "Ciudad de México"],
  ["Jalisco", "Guadalajara"],
  ["Nuevo León", "Monterrey"],
  ["Puebla", "Puebla"],
  ["Querétaro", "Querétaro"],
  ["Estado de México", "Naucalpan"],
];
const CURRENT_YEAR = new Date().getFullYear();

/** The i-th demo unit as API input (passes through parseVehicleInput like any other car). */
export function demoVehicle(i: number) {
  const [brand, model, trim, bodyType, fuel, transmission, traction, engine, newPrice, doors] = MODELS[i % MODELS.length];
  const isNew = i % 9 === 0;
  const age = isNew ? 0 : 1 + ((i * 7) % 9); // 1..9 years old
  const year = CURRENT_YEAR - age;
  const km = isNew ? 0 : age * (11_000 + ((i * 3_137) % 9_000)) + ((i * 613) % 5_000);
  // ~12% depreciation per year, rounded to the nearest $5,000.
  const price = Math.round((newPrice * Math.pow(0.88, age)) / 5_000) * 5_000;
  const [state, city] = CITIES[i % CITIES.length];
  const color = COLORS[(i * 3) % COLORS.length];
  const features = FEATURES.filter((_, f) => (f * 5 + i) % 3 !== 0 || f < 3).slice(0, 6 + (i % 10));
  const intake = new Date(Date.now() - ((i * 37) % 120) * 86_400_000); // 0–120 days on the lot
  return {
    status: i % 12 === 11 ? "borrador" : "disponible",
    brand,
    model,
    trim,
    year,
    km,
    price,
    condition: isNew ? "nuevo" : "usado",
    bodyType,
    fuel,
    transmission,
    traction,
    engine,
    doors,
    color,
    singleOwner: i % 3 === 0,
    location: { state, city },
    description: `${brand} ${model} ${trim} ${year} color ${color.toLowerCase()}, ${isNew ? "nuevo" : `${km.toLocaleString("es-MX")} km`}. ${
      i % 2 ? "Servicios de agencia al corriente." : "Excelentes condiciones, listo para entrega."
    } Unidad de prueba (datos ficticios).`,
    features,
    stockNumber: `DEMO-${String(i + 1).padStart(3, "0")}`,
    intakeDate: intake.toISOString(),
  };
}

export const DEMO_COUNT = 50;
