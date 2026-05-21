import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { applyTaskOrderForStatus } from "@/lib/task-sort-order";
import { verifySessionToken } from "@/lib/session";

const ALLOWED_STATUSES = ["todo", "in_progress", "done", "backlog"] as const;

type ReorderBody = {
  status?: string;
  taskIds?: string[];
};

export async function PATCH(request: Request) {
  const token = (await cookies()).get("session")?.value;
  const session = verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ReorderBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status = body.status?.trim();
  const taskIds = body.taskIds;

  if (!status || !(ALLOWED_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return NextResponse.json({ error: "taskIds required" }, { status: 400 });
  }

  const ids = taskIds.filter(
    (id): id is string => typeof id === "string" && id.trim() !== "",
  );
  if (ids.length !== taskIds.length) {
    return NextResponse.json({ error: "Invalid taskIds" }, { status: 400 });
  }

  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    return NextResponse.json({ error: "Duplicate taskIds" }, { status: 400 });
  }

  const tasks = await prisma.task.findMany({
    where: { id: { in: ids }, status },
    select: { id: true },
  });

  if (tasks.length !== ids.length) {
    return NextResponse.json(
      { error: "Tasks not found or status mismatch" },
      { status: 400 },
    );
  }

  await applyTaskOrderForStatus(status, ids);

  return NextResponse.json({ ok: true });
}
