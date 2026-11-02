import { AuthForm } from "@/components/shared/auth-form";
import { InviteForm } from "@/components/shared/invite-form";

// /register?invite=<token> is the team invitation link; plain /register creates a company account.
export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const { invite } = await searchParams;
  return typeof invite === "string" && invite ? <InviteForm token={invite} /> : <AuthForm mode="register" />;
}
