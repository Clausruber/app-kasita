// Mortgage math for catalogs/quotes. Pure: the drawer's live preview and the PDF use the same numbers.

export const TERM_OPTIONS = [60, 120, 180, 240] as const; // months: 5, 10, 15 and 20 years
export const MAX_CATALOG_PROPERTIES = 5;
export const MAX_QUOTE_PHOTOS = 6; // photos per property in the quote (PDF grid of 3 × 2)
export const termLabel = (months: number) => `${months / 12} años`;

export type Financing = {
  downMode: "pct" | "amount";
  down: number; // % of the price, or MXN
  rate: number; // annual %
  terms: number[]; // months
};

export type QuoteDefaults = {
  rate: number;
  minDownPct: number;
  terms: number[];
  validDays: number;
  conditions: string;
};

export const QUOTE_DEFAULTS: QuoteDefaults = {
  rate: 10.5,
  minDownPct: 10,
  terms: [120, 180, 240],
  validDays: 15,
  conditions:
    "Precios en pesos mexicanos (MXN), sujetos a cambio sin previo aviso y a disponibilidad del inmueble. La simulación de crédito es informativa: la tasa, el plazo y el monto los define la institución financiera. No incluye gastos notariales, avalúo ni comisiones de apertura.",
};

/** Fixed monthly payment (French amortisation) for `principal` over `months` at `annualPct`. */
export function monthlyPayment(principal: number, annualPct: number, months: number) {
  if (principal <= 0 || months <= 0) return 0;
  const r = annualPct / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export type PropertyQuote = {
  price: number;
  down: number; // enganche
  downPct: number;
  financed: number;
  rows: { months: number; payment: number; total: number }[]; // total = down + payments
  warnings: string[];
};

/** Mortgage quote of one property for sale: what is financed and the payment for each term. */
export function quoteFor(price: number, f: Financing | null, minDownPct = QUOTE_DEFAULTS.minDownPct): PropertyQuote {
  const warnings: string[] = [];
  const wanted = !f ? 0 : f.downMode === "pct" ? (price * f.down) / 100 : f.down;
  const down = Math.max(0, Math.min(wanted, price));
  const financed = f ? Math.max(0, price - down) : 0;
  const downPct = price ? (down / price) * 100 : 0;
  if (f && financed > 0 && downPct < minDownPct) warnings.push(`El enganche (${downPct.toFixed(0)} %) es menor al mínimo de ${minDownPct} %.`);
  const rows = !f
    ? []
    : [...f.terms]
        .sort((a, b) => a - b)
        .map((months) => {
          const payment = monthlyPayment(financed, f.rate, months);
          return { months, payment, total: down + payment * months };
        });
  return { price, down, downPct, financed, rows, warnings };
}
