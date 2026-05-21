import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import {
  addCalendarDaysUtc,
  addRecurrenceInterval,
  isRecurrenceType,
  shiftPreservingWeekOffset,
} from "@/lib/recurrence";
import { nextSortOrderForStatus } from "@/lib/task-sort-order";
import { mondayDateFromKey, utcMondayKeyContaining } from "@/lib/week";

export async function POST() {
  const token = (await cookies()).get("session")?.value;
  const session = verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  let createdCount = 0;

  const parents = await prisma.task.findMany({
    where: {
      recurrenceActive: true,
      recurrenceNextDate: { lte: now },
      OR: [
        { recurrenceIntervalDays: { gt: 0 } },
        { recurrenceType: { not: null } },
      ],
    } as never,
  });

  for (const parent of parents) {
    const days = (parent as { recurrenceIntervalDays?: number | null })
      .recurrenceIntervalDays;
    let schedule = parent.recurrenceNextDate;
    if (!schedule) continue;

    while (schedule <= now) {
      const newWeekKey = utcMondayKeyContaining(now);
      const newWeekStart = mondayDateFromKey(newWeekKey);

      const newDue = shiftPreservingWeekOffset(
        parent.weekStart,
        parent.dueDate,
        newWeekStart,
      );
      const newEvent = shiftPreservingWeekOffset(
        parent.weekStart,
        parent.eventAt,
        newWeekStart,
      );

      const sortOrder = await nextSortOrderForStatus("todo");

      await prisma.task.create({
        data: {
          title: parent.title,
          description: parent.description,
          status: "todo",
          sortOrder,
          priority: parent.priority,
          effort: parent.effort,
          dueDate: newDue,
          eventAt: newEvent,
          weekStart: newWeekStart,
          userId: parent.userId,
          createdById: parent.createdById,
          assigneeId: parent.assigneeId,
          recurrenceParentId: parent.id,
          recurrenceActive: false,
          recurrenceType: null,
          recurrenceIntervalDays: null,
          recurrenceNextDate: null,
        } as never,
      });

      createdCount += 1;

      if (days != null && days > 0) {
        schedule = addCalendarDaysUtc(schedule, days);
      } else if (
        parent.recurrenceType &&
        isRecurrenceType(parent.recurrenceType)
      ) {
        schedule = addRecurrenceInterval(schedule, parent.recurrenceType);
      } else {
        break;
      }

      await prisma.task.update({
        where: { id: parent.id },
        data: { recurrenceNextDate: schedule },
      });
    }
  }

  return NextResponse.json({ ok: true, createdCount });
}
