/**
 * Message for a failed callable. A bare "internal" / "not-found" (the SDK shows it as "internal [0]" when
 * the request never reached a function, e.g. not deployed) says nothing to the user: explain it instead.
 */
export function functionsErrorMessage(e: unknown) {
  const code = String((e as { code?: unknown })?.code ?? "");
  const message = String((e as { message?: unknown })?.message ?? "").trim();
  const bare = /^(internal|not[- ]found|unavailable)(\s*\[\d+\])?$/i.test(message) || !message;
  if (bare && /^(functions\/)?(internal|not-found|unavailable)$/.test(code || "internal"))
    return "La agenda aún no está activa en el servidor (faltan desplegar las funciones). Avisa al administrador.";
  return message || "Error desconocido";
}
