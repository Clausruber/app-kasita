import { redirect } from "next/navigation";

// Moved to Publicaciones → Nueva publicación.
export default function ComposeRedirect() {
  redirect("/dashboard/posts/new");
}
