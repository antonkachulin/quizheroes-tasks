import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { taskListInclude } from "@/lib/task-list";
import { verifySessionToken } from "@/lib/session";
import { nextSortOrderForStatus } from "@/lib/task-sort-order";
import { notifyTaskCreatedTelegram } from "@/lib/task-telegram-notify";
import { computeInitialRecurrenceNextDateDays } from "@/lib/recurrence";
import {
  normalizeToUtcMondayKey,
  utcMondayKeyContaining,
  mondayDateFromKey,
  weekStartBoundsUtc,
} from "@/lib/week";

const ALLOWED_STATUSES = ["todo", "in_progress", "done", "backlog"] as const;
const ALLOWED_EFFORTS = [1, 2, 3, 5, 8, 13] as const;

type CreateTaskBody = {
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  effort?: number;
  dueDate?: string | null;
  eventAt?: string | null;
  assigneeId?: string | null;
  weekStart?: string;
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

export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawWeek = url.searchParams.get("week");
  const weekKey =
    normalizeToUtcMondayKey(rawWeek ?? "") ?? utcMondayKeyContaining(new Date());
  const bounds = weekStartBoundsUtc(weekKey);

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

  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreateTaskBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = body.title?.trim();
  const description = body.description?.trim();
  const status = body.status ?? "todo";
  const priority = body.priority ?? 3;
  const effort = body.effort ?? 3;

  if (!title || !description) {
    return NextResponse.json(
      { error: "title and description are required" },
      { status: 400 },
    );
  }

  if (!isAllowedStatus(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
    return NextResponse.json({ error: "Priority must be from 1 to 5" }, { status: 400 });
  }

  if (!Number.isInteger(effort) || !isAllowedEffort(effort)) {
    return NextResponse.json(
      { error: "Effort must be one of 1,2,3,5,8,13" },
      { status: 400 },
    );
  }

  let dueDate: Date | undefined;
  if (body.dueDate) {
    dueDate = new Date(body.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      return NextResponse.json({ error: "Invalid dueDate" }, { status: 400 });
    }
  }

  let eventAt: Date | null = null;
  if (body.eventAt != null) {
    if (typeof body.eventAt !== "string") {
      return NextResponse.json({ error: "Invalid eventAt" }, { status: 400 });
    }
    const raw = body.eventAt.trim();
    if (raw !== "") {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid eventAt" }, { status: 400 });
      }
      eventAt = parsed;
    }
  }

  let assigneeId: string | null = null;
  if (typeof body.assigneeId === "string") {
    const trimmed = body.assigneeId.trim();
    const asNone = trimmed.toLowerCase() === "none";
    if (trimmed !== "" && !asNone) {
      const assignee = await prisma.user.findUnique({
        where: { id: trimmed },
      });
      if (assignee) {
        assigneeId = assignee.id;
      }
    }
  }

  let weekStartDate: Date | null = null;
  if (status !== "backlog") {
    const weekKey = normalizeToUtcMondayKey(body.weekStart?.trim() ?? "");
    if (!weekKey) {
      return NextResponse.json(
        { error: "weekStart is required for tasks not in backlog" },
        { status: 400 },
      );
    }
    weekStartDate = mondayDateFromKey(weekKey);
  }

  let recurrenceActive = false;
  let recurrenceIntervalDaysValue: number | null = null;
  let recurrenceNextDateValue: Date | null = null;

  const ridRaw = body.recurrenceIntervalDays;
  const n =
    typeof ridRaw === "number" && Number.isFinite(ridRaw)
      ? Math.floor(ridRaw)
      : NaN;
  if (Number.isFinite(n) && n > 0) {
    if (status === "backlog") {
      return NextResponse.json(
        { error: "Повторение недоступно для задач в бэклоге" },
        { status: 400 },
      );
    }
    if (!weekStartDate) {
      return NextResponse.json(
        { error: "weekStart required for recurrence" },
        { status: 400 },
      );
    }
    recurrenceActive = true;
    recurrenceIntervalDaysValue = n;
    recurrenceNextDateValue = computeInitialRecurrenceNextDateDays(n);
  }

  try {
    const sortOrder = await nextSortOrderForStatus(status);

    const task = await prisma.task.create({
      data: {
        title,
        description,
        status,
        sortOrder,
        priority,
        effort,
        dueDate,
        eventAt,
        weekStart: weekStartDate,
        recurrenceActive,
        recurrenceIntervalDays: recurrenceIntervalDaysValue,
        recurrenceNextDate: recurrenceNextDateValue,
        user: { connect: { id: userId } },
        createdBy: { connect: { id: userId } },
        ...(assigneeId ? { assignee: { connect: { id: assigneeId } } } : {}),
      },
      include: taskListInclude,
    });

    try {
      await notifyTaskCreatedTelegram({
        assigneeId,
        creatorId: userId,
        title,
        description,
      });
    } catch {
      /* notification optional */
    }

    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error creating task";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

