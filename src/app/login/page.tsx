import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken } from "@/lib/session";
import LoginForm from "./login-form";

export default async function LoginPage() {
  const sessionCookie = (await cookies()).get("session")?.value;
  const session = verifySessionToken(sessionCookie);

  if (session) {
    redirect("/tasks");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <LoginForm />
    </main>
  );
}
