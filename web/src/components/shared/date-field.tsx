"use client";

import { useRef } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

/** "2026-11-03" → "03/11/2026". */
export const ddmmyyyy = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : "");

/**
 * Date picker that always shows dd/mm/yyyy. A native date input follows the browser's language
 * (mm/dd/yyyy in an English browser), so the visible part is our own text and the native input only
 * opens the calendar. Value and onChange use YYYY-MM-DD, like <input type="date">.
 */
export function DateField({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  placeholder = "dd/mm/aaaa",
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const open = () => {
    const input = ref.current;
    if (!input || disabled) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };
  return (
    <div className={cn("relative inline-flex", className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={open}
        className="flex h-8 w-full min-w-36 items-center justify-between gap-2 rounded-lg border bg-background px-2.5 text-left text-sm tabular-nums disabled:opacity-50"
      >
        <span className={value ? "" : "text-muted-foreground"}>{ddmmyyyy(value) || placeholder}</span>
        <CalendarDays className="size-4 text-muted-foreground" />
      </button>
      <input
        ref={ref}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
      />
    </div>
  );
}
