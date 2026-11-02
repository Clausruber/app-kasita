"use client";

import { useSyncExternalStore } from "react";
import { Bot, Building2, CalendarClock, Share2, UserRound, UsersRound } from "lucide-react";
import { AiAgentCard } from "@/components/settings/ai-agent-card";
import { KnowledgeCard } from "@/components/settings/knowledge-card";
import { AgendasCard } from "@/components/settings/agendas-card";
import { AccountsCard } from "@/components/settings/accounts-card";
import { ProfileCard } from "@/components/settings/profile-card";
import { CompanyCard } from "@/components/settings/company-card";
import { UserCard } from "@/components/settings/user-card";
import { TeamCard } from "@/components/settings/team-card";
import { useCan } from "@/hooks/use-me";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { id: "perfil", label: "Perfil", icon: UserRound, perm: null },
  { id: "empresa", label: "Empresa", icon: Building2, perm: "settings.empresa" },
  { id: "usuarios", label: "Usuarios", icon: UsersRound, perm: "settings.usuarios" },
  { id: "redes", label: "Redes", icon: Share2, perm: "settings.redes" },
  { id: "agendas", label: "Agendas", icon: CalendarClock, perm: "settings.agendas" },
  { id: "agente", label: "Agente IA", icon: Bot, perm: "settings.agente" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const ALIASES: Record<string, TabId> = { cuentas: "redes", usuario: "perfil" }; // old links

// The active tab lives in the URL hash so links like /dashboard/settings#redes open it directly.
const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const readTab = (): TabId => {
  const h = window.location.hash.slice(1);
  return ALIASES[h] ?? (TABS.some((t) => t.id === h) ? (h as TabId) : "perfil");
};

export default function SettingsPage() {
  const can = useCan();
  const tabs = TABS.filter((t) => !t.perm || can(t.perm));
  const hashTab = useSyncExternalStore(subscribe, readTab, () => "perfil" as TabId);
  // A tab this user has no access to falls back to Perfil.
  const tab = tabs.some((t) => t.id === hashTab) ? hashTab : "perfil";
  const select = (id: TabId) => {
    history.replaceState(null, "", `#${id}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Ajustes</h1>
      <Tabs value={tab} onValueChange={(v) => select(v as TabId)}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
            {tabs.map(({ id, label, icon: Icon }) => (
              <TabsTrigger key={id} value={id} className="px-2.5">
                <Icon /> {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="perfil" className="space-y-4">
          <ProfileCard />
          <UserCard />
        </TabsContent>
        <TabsContent value="empresa">
          <CompanyCard />
        </TabsContent>
        <TabsContent value="usuarios">
          <TeamCard />
        </TabsContent>
        <TabsContent value="redes">
          <AccountsCard />
        </TabsContent>
        <TabsContent value="agendas">
          <AgendasCard />
        </TabsContent>
        <TabsContent value="agente" className="space-y-4">
          <AiAgentCard />
          <KnowledgeCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
