export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6">
      <h1 className="mb-4 text-3xl font-semibold">QuizHeroes Auth Demo</h1>
      <p className="mb-6 text-zinc-700">
        Minimal auth flow: login, cookie session, and a protected tasks page
        after sign-in.
      </p>
      <div className="flex flex-wrap gap-3">
        <a className="rounded bg-black px-4 py-2 text-white" href="/tasks">
          Open /tasks
        </a>
        <a className="rounded border px-4 py-2" href="/login">
          Open /login
        </a>
      </div>
    </main>
  );
}
