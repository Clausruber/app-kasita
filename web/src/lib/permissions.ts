// Access catalog for team members: every menu item, its sub-items and each settings tab.
// Keep in sync with functions/src/actor.ts (the keys the callables check).

export type TeamRole = "team" | "supervisor" | "admin";
export const TEAM_ROLES: { id: TeamRole; label: string; description: string }[] = [
  { id: "team", label: "Equipo", description: "Atiende el inbox, clientes y agenda" },
  { id: "supervisor", label: "Supervisor", description: "Además configura empresa, redes, agendas y agente IA" },
  { id: "admin", label: "Administrador", description: "Acceso completo, incluida la gestión de usuarios" },
];
export const roleLabel = (r: string) => TEAM_ROLES.find((x) => x.id === r)?.label ?? r;

export type PermNode = { key: string; label: string; children?: PermNode[] };

/** Menu → sub-items / tabs. A child key only counts if its parent is also granted. */
export const PERMISSIONS: PermNode[] = [
  {
    key: "inbox",
    label: "Inbox",
    children: [
      { key: "inbox.comments", label: "Comentarios" },
      { key: "inbox.dms", label: "Mensajes directos" },
      { key: "inbox.reply", label: "Responder y ocultar" },
      { key: "inbox.agentMode", label: "Cambiar modo del agente" },
    ],
  },
  { key: "posts", label: "Publicaciones", children: [{ key: "posts.create", label: "Nueva publicación" }, { key: "posts.delete", label: "Borrar publicaciones" }] },
  { key: "clients", label: "Clientes", children: [{ key: "clients.edit", label: "Editar fichas" }] },
  {
    key: "inventory",
    label: "Propiedades",
    children: [
      { key: "inventory.edit", label: "Alta y edición de propiedades" },
      { key: "inventory.delete", label: "Borrar propiedades" },
      { key: "inventory.private", label: "Ver dirección exacta y propietario" },
    ],
  },
  {
    key: "deals",
    label: "Pipeline (ventas)",
    children: [
      { key: "deals.edit", label: "Crear y mover oportunidades" },
      { key: "deals.assignAll", label: "Ver y reasignar las de todo el equipo" },
      { key: "deals.reserve", label: "Registrar apartados" },
      { key: "deals.sell", label: "Registrar ventas" },
      { key: "deals.void", label: "Liberar apartados" },
    ],
  },
  { key: "tasks", label: "Seguimientos", children: [{ key: "tasks.all", label: "Ver los de todo el equipo" }] },
  { key: "calendar", label: "Calendario" },
  { key: "agenda", label: "Agenda", children: [{ key: "agenda.book", label: "Agendar, confirmar y cancelar citas" }] },
  {
    key: "settings",
    label: "Ajustes",
    children: [
      { key: "settings.empresa", label: "Empresa" },
      { key: "settings.usuarios", label: "Usuarios" },
      { key: "settings.redes", label: "Redes" },
      { key: "settings.agendas", label: "Agendas" },
      { key: "settings.agente", label: "Agente IA" },
      { key: "settings.imagenes", label: "Imágenes (logo en los posts)" },
    ],
  },
];

export const ALL_PERMS = PERMISSIONS.flatMap((n) => [n.key, ...(n.children ?? []).map((c) => c.key)]);

const TEAM: string[] = [
  ...["inbox", "inbox.comments", "inbox.dms", "inbox.reply", "posts", "clients", "clients.edit", "calendar", "agenda", "agenda.book"],
  ...["inventory", "deals", "deals.edit", "deals.reserve", "tasks"],
];
const SUPERVISOR: string[] = [
  ...TEAM,
  ...["inbox.agentMode", "posts.create", "posts.delete", "settings", "settings.empresa", "settings.redes", "settings.agendas", "settings.agente", "settings.imagenes"],
  ...["inventory.edit", "inventory.delete", "inventory.private", "deals.assignAll", "deals.sell", "deals.void", "tasks.all"],
];

/** Default access of each role; the admin can then tick/untick items per person. */
export const ROLE_PRESETS: Record<TeamRole, string[]> = { team: TEAM, supervisor: SUPERVISOR, admin: ALL_PERMS };

/** Keeps only known keys, and drops children whose parent is not granted. */
export function normalisePerms(perms: unknown): string[] {
  const set = new Set((Array.isArray(perms) ? perms : []).filter((p): p is string => typeof p === "string" && ALL_PERMS.includes(p)));
  return ALL_PERMS.filter((p) => set.has(p) && (!p.includes(".") || set.has(p.split(".")[0])));
}

/** Owners (perms = null) can do everything; members only what was granted. */
export const can = (perms: string[] | null | undefined, key: string) =>
  perms == null || (perms.includes(key) && (!key.includes(".") || perms.includes(key.split(".")[0])));
