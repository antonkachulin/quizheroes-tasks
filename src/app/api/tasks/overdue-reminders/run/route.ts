import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import {
  creatorUserId,
  notifyTaskOverdueTelegram,
} from "@/lib/task-telegram-notify";

function isLegacyDateOnlyDueDate(d: Date): boolean {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

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

  const tasks = (await prisma.task.findMany({
    where: {
      dueDate: { lt: now, not: null },
      status: { not: "done" },
      overdueReminderSentAt: null,
    } as never,
    select: {
      id: true,
      title: true,
      dueDate: true,
      userId: true,
      createdById: true,
      assigneeId: true,
    },
  })) as {
    id: string;
    title: string;
    dueDate: Date | null;
    userId: string;
    createdById: string | null;
    assigneeId: string | null;
  }[];

  let checkedCount = 0;
  let notifiedCount = 0;
  let notifiedTaskCount = 0;

  for (const t of tasks) {
    if (!t.dueDate) continue;
    // Старые dueDate без времени хранились как UTC-полночь — это «весь день»,
    // считаем такие просроченными только со следующего календарного дня (UTC),
    // чтобы не отправлять уведомление в начале того же дня в восточных TZ.
    if (isLegacyDateOnlyDueDate(t.dueDate)) {
      if (now.getTime() < t.dueDate.getTime() + 24 * 60 * 60 * 1000) {
        continue;
      }
    }
    checkedCount += 1;

    try {
      const result = await notifyTaskOverdueTelegram({
        title: t.title,
        dueDate: t.dueDate,
        assigneeId: t.assigneeId,
        creatorId: creatorUserId(t),
      });

      if (result.telegramRecipients > 0) {
        notifiedCount += result.telegramRecipients;
        notifiedTaskCount += 1;
        await prisma.task.update({
          where: { id: t.id },
          data: { overdueReminderSentAt: now } as never,
        });
      }
    } catch {
      /* notification optional, leave overdueReminderSentAt = null to retry next time */
    }
  }

  return NextResponse.json({
    ok: true,
    checkedCount,
    notifiedCount,
    notifiedTaskCount,
  });
}
