"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthForm } from "@/components/shared/auth-form";
import { InviteForm } from "@/components/shared/invite-form";

// /register?invite=<token> is the team invitation link; plain /register creates a company account.
function RegisterContent() {
  const searchParams = useSearchParams();
  const invite = searchParams.get("invite");
  return invite ? <InviteForm token={invite} /> : <AuthForm mode="register" />;
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterContent />
    </Suspense>
  );
}
