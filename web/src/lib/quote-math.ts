// Financing math for catalogs/quotes. Pure: the drawer's live preview and the PDF use the same numbers.

export const IVA = 0.16; // Mexican financieras charge VAT on the interest
export const TERM_OPTIONS = [12, 24, 36, 48, 60, 72] as const;
export const MAX_CATALOG_VEHICLES = 5;

export type Financing = {
  downMode: "pct" | "amount";
  down: number; // % of the price, or MXN
  rate: number; // annual %, before VAT
  terms: number[]; // months
  ivaOnInterest: boolean;
};
export type TradeIn = { description: string; value: number };

export type QuoteDefaults = {
  rate: number;
  minDownPct: number;
  terms: number[];
  ivaOnInterest: boolean;
  validDays: number;
  conditions: string;
};

export const QUOTE_DEFAULTS: QuoteDefaults = {
  rate: 14.9,
  minDownPct: 20,
  terms: [24, 36, 48, 60],
  ivaOnInterest: true,
  validDays: 7,
  conditions:
    "Precios en pesos mexicanos (MXN), sujetos a cambio sin previo aviso y a disponibilidad de la unidad. El valor del auto a cuenta está sujeto a revisión física y documental.",
};

/** Fixed monthly payment (French amortisation) for `principal` over `months` at `annualPct`. */
export function monthlyPayment(principal: number, annualPct: number, months: number, ivaOnInterest: boolean) {
  if (principal <= 0 || months <= 0) return 0;
  const r = ((annualPct / 100) * (ivaOnInterest ? 1 + IVA : 1)) / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export type VehicleQuote = {
  price: number;
  tradeIn: number;
  cashDown: number; // enganche en efectivo
  totalDown: number; // efectivo + auto a cuenta
  totalDownPct: number;
  financed: number;
  credit: number; // saldo a favor when the trade-in is worth more than the car
  rows: { months: number; payment: number; total: number }[]; // total = down + payments
  warnings: string[];
};

/** Quote of one car: what is financed and the payment for each term. */
export function quoteFor(price: number, f: Financing | null, trade: TradeIn | null, minDownPct = QUOTE_DEFAULTS.minDownPct): VehicleQuote {
  const tradeIn = Math.max(0, trade?.value ?? 0);
  const warnings: string[] = [];
  const wanted = !f ? 0 : f.downMode === "pct" ? (price * f.down) / 100 : f.down;
  // The trade-in already covers part of the price; cash down never takes it below zero.
  const cashDown = Math.max(0, Math.min(wanted, price - tradeIn));
  const credit = Math.max(0, tradeIn - price);
  const financed = f ? Math.max(0, price - tradeIn - cashDown) : 0;
  const totalDown = Math.min(price, cashDown + tradeIn);
  const totalDownPct = price ? (totalDown / price) * 100 : 0;
  if (credit > 0) warnings.push("El auto a cuenta vale más que este auto: queda saldo a favor del cliente.");
  if (f && financed > 0 && totalDownPct < minDownPct) warnings.push(`El enganche (${totalDownPct.toFixed(0)} %) es menor al mínimo de ${minDownPct} %.`);
  const rows = !f
    ? []
    : [...f.terms]
        .sort((a, b) => a - b)
        .map((months) => {
          const payment = monthlyPayment(financed, f.rate, months, f.ivaOnInterest);
          return { months, payment, total: totalDown + payment * months };
        });
  return { price, tradeIn, cashDown, totalDown, totalDownPct, financed, credit, rows, warnings };
}
