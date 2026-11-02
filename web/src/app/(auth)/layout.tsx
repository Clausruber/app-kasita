import type { ReactNode } from "react";

// Login, register and invitation pages (each card shows the logo itself).
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col">{children}</div>;
}
