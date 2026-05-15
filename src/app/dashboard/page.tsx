import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken } from "@/lib/session";

export default async function DashboardPage() {
  const sessionCookie = (await cookies()).get("session")?.value;
  const session = verifySessionToken(sessionCookie);

  if (!session) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6">
      <h1 className="mb-4 text-3xl font-semibold">Dashboard</h1>
      <p className="text-zinc-700">
        You are logged in as <strong>{session.login}</strong> with role{" "}
        <strong>{session.role}</strong>.
      </p>
    </main>
  );
}

