import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import { taskListInclude } from "@/lib/task-list";
import {
  normalizeToUtcMondayKey,
  utcMondayKeyContaining,
  weekStartBoundsUtc,
} from "@/lib/week";
import LogoutButton from "./logout-button";
import TasksClient from "./tasks-client";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const sessionCookie = (await cookies()).get("session")?.value;
  const session = verifySessionToken(sessionCookie);

  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  const weekMondayKey =
    normalizeToUtcMondayKey(params.week ?? "") ??
    utcMondayKeyContaining(new Date());

  const bounds = weekStartBoundsUtc(weekMondayKey);

  const tasks = await prisma.task.findMany({
    where: {
      OR: [
        { status: "backlog" },
        {
          status: { in: ["todo", "in_progress", "done"] },
          weekStart: { gte: bounds.gte, lt: bounds.lt },
        },
      ],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: taskListInclude,
  });

  const dbUser = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { telegramChatId: true },
  });
  const telegramConnected =
    dbUser?.telegramChatId != null && dbUser.telegramChatId !== "";

  return (
    <>
      <main className="mx-auto w-full max-w-3xl p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-zinc-50">Tasks</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-600 bg-zinc-950/90 px-3 py-1.5 text-xs text-zinc-400 shadow-inner">
            <span className="shrink-0">Вы вошли как:</span>
            <span className="min-w-0 truncate font-semibold text-amber-400/95">
              {session.login}
            </span>
          </span>
          <LogoutButton />
        </div>
      </header>
      <TasksClient
        initialTasks={tasks}
        weekMondayKey={weekMondayKey}
        currentUserId={session.userId}
        telegramConnected={telegramConnected}
        isAdmin={session.role === "admin"}
      />
      </main>
    </>
  );
}

