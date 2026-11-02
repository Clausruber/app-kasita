import { redirect } from "next/navigation";

// Accounts now live in Ajustes → Cuentas.
export default function AccountsRedirect() {
  redirect("/dashboard/settings#redes");
}
