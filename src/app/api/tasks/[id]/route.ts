import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { taskListInclude } from "@/lib/task-list";
import { verifySessionToken } from "@/lib/session";
import { creatorUserId, notifyTaskDoneTelegram } from "@/lib/task-telegram-notify";
import {
  computeInitialRecurrenceNextDateDays,
} from "@/lib/recurrence";
import { mondayDateFromKey, normalizeToUtcMondayKey } from "@/lib/week";

const ALLOWED_STATUSES = ["todo", "in_progress", "done", "backlog"] as const;
const ALLOWED_EFFORTS = [1, 2, 3, 5, 8, 13] as const;

type UpdateTaskBody = {
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  effort?: number;
  dueDate?: string | null;
  eventAt?: string | null;
  assigneeId?: string | null;
  weekStart?: string | null;
  recurrenceStop?: boolean;
  recurrenceIntervalDays?: number | null;
};

function isAllowedStatus(status: string): boolean {
  return (ALLOWED_STATUSES as readonly string[]).includes(status);
}

function isAllowedEffort(effort: number): boolean {
  return (ALLOWED_EFFORTS as readonly number[]).includes(effort);
}

async function getSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get("session")?.value;
  const session = verifySessionToken(token);
  return session?.userId ?? null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existingTask = await prisma.task.findFirst({ where: { id } });
  if (!existingTask) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as UpdateTaskBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: {
    title?: string;
    description?: string;
    status?: string;
    priority?: number;
    effort?: number;
    dueDate?: Date | null;
    eventAt?: Date | null;
    assigneeId?: string | null;
    weekStart?: Date | null;
    recurrenceActive?: boolean;
    recurrenceNextDate?: Date | null;
    recurrenceIntervalDays?: number | null;
    overdueReminderSentAt?: Date | null;
  } = {};

  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) {
      return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    }
    data.title = title;
  }

  if (typeof body.description === "string") {
    const description = body.description.trim();
    if (!description) {
      return NextResponse.json(
        { error: "description cannot be empty" },
        { status: 400 },
      );
    }
    data.description = description;
  }

  if (typeof body.status === "string") {
    if (!isAllowedStatus(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    data.status = body.status;
  }

  if (typeof body.priority !== "undefined") {
    if (!Number.isInteger(body.priority) || body.priority < 1 || body.priority > 5) {
      return NextResponse.json(
        { error: "Priority must be from 1 to 5" },
        { status: 400 },
      );
    }
    data.priority = body.priority;
  }

  if (typeof body.effort !== "undefined") {
    if (!Number.isInteger(body.effort) || !isAllowedEffort(body.effort)) {
      return NextResponse.json(
        { error: "Effort must be one of 1,2,3,5,8,13" },
        { status: 400 },
      );
    }
    data.effort = body.effort;
  }

  if (typeof body.dueDate !== "undefined") {
    if (body.dueDate === null) {
      data.dueDate = null;
    } else {
      const dueDate = new Date(body.dueDate);
      if (Number.isNaN(dueDate.getTime())) {
        return NextResponse.json({ error: "Invalid dueDate" }, { status: 400 });
      }
      data.dueDate = dueDate;
      if (dueDate.getTime() > Date.now()) {
        data.overdueReminderSentAt = null;
      }
    }
  }

  if (typeof body.eventAt !== "undefined") {
    if (body.eventAt === null || body.eventAt === "") {
      data.eventAt = null;
    } else {
      const eventAt = new Date(body.eventAt);
      if (Number.isNaN(eventAt.getTime())) {
        return NextResponse.json({ error: "Invalid eventAt" }, { status: 400 });
      }
      data.eventAt = eventAt;
    }
  }

  if (typeof body.assigneeId !== "undefined") {
    if (body.assigneeId === null) {
      data.assigneeId = null;
    } else if (typeof body.assigneeId === "string") {
      const trimmed = body.assigneeId.trim();
      const asNone = trimmed.toLowerCase() === "none";
      if (trimmed === "" || asNone) {
        data.assigneeId = null;
      } else {
        const assignee = await prisma.user.findUnique({
          where: { id: trimmed },
        });
        data.assigneeId = assignee ? assignee.id : null;
      }
    } else {
      data.assigneeId = null;
    }
  }

  if (typeof body.weekStart !== "undefined") {
    if (body.weekStart === null || body.weekStart === "") {
      data.weekStart = null;
    } else {
      const raw = String(body.weekStart).trim();
      const weekKey = normalizeToUtcMondayKey(raw);
      if (!weekKey) {
        return NextResponse.json({ error: "Invalid weekStart" }, { status: 400 });
      }
      data.weekStart = mondayDateFromKey(weekKey);
    }
  }

  if (typeof body.recurrenceIntervalDays !== "undefined") {
    if (body.recurrenceIntervalDays === null) {
      data.recurrenceActive = false;
      data.recurrenceNextDate = null;
      data.recurrenceIntervalDays = null;
    } else if (typeof body.recurrenceIntervalDays === "number") {
      const n = Math.floor(body.recurrenceIntervalDays);
      if (!Number.isFinite(n) || n <= 0) {
        data.recurrenceActive = false;
        data.recurrenceNextDate = null;
        data.recurrenceIntervalDays = null;
      } else {
        const effectiveStatus =
          typeof data.status === "string" ? data.status : existingTask.status;
        if (effectiveStatus === "backlog") {
          return NextResponse.json(
            { error: "Повторение недоступно для задач в бэклоге" },
            { status: 400 },
          );
        }
        data.recurrenceActive = true;
        data.recurrenceIntervalDays = n;
        data.recurrenceNextDate = computeInitialRecurrenceNextDateDays(n);
      }
    }
  }

  if (body.recurrenceStop === true) {
    data.recurrenceActive = false;
    data.recurrenceNextDate = null;
    data.recurrenceIntervalDays = null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const oldStatus = (existingTask.status ?? "").trim();

  const task = await prisma.task.update({
    where: { id },
    data: data as never,
    include: taskListInclude as never,
  });

  const newStatus = (task.status ?? "").trim();
  const becameDone = oldStatus !== "done" && newStatus === "done";

  const creatorIdForLog = creatorUserId(task);
  const candidateUserIds = [
    ...new Set([task.assigneeId, creatorIdForLog].filter(Boolean)),
  ] as string[];
  const recipients = [...candidateUserIds];
  const tgRows =
    candidateUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: candidateUserIds } },
          select: { id: true, telegramChatId: true },
        })
      : [];
  const telegramChatId = Object.fromEntries(
    tgRows.map((u) => [
      u.id,
      Boolean(u.telegramChatId && u.telegramChatId !== ""),
    ]),
  );
  console.log("TASK_STATUS_PATCH", {
    oldStatus: existingTask.status,
    newStatus: task.status,
    actorId: userId,
    assigneeId: task.assigneeId,
    createdById: task.createdById,
    creatorId: creatorIdForLog,
    recipients,
    telegramChatId,
  });

  if (becameDone) {
    try {
      await notifyTaskDoneTelegram({
        taskId: id,
      });
    } catch {
      /* notification optional */
    }
  }

  return NextResponse.json({ task });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existingTask = await prisma.task.findFirst({ where: { id } });
  if (!existingTask) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  await prisma.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

