import { prisma } from "@/lib/prisma";
import { sendTelegramChatMessage, telegramBot } from "@/lib/telegram";

export function creatorUserId(task: {
  createdById: string | null;
  userId: string;
}): string {
  return task.createdById ?? task.userId;
}

async function sendTelegramToUsers(
  sends: { userId: string; text: string }[],
): Promise<void> {
  if (!telegramBot || sends.length === 0) return;

  const mergedByUser = new Map<string, string>();
  for (const { userId, text } of sends) {
    if (!mergedByUser.has(userId)) mergedByUser.set(userId, text);
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...mergedByUser.keys()] } },
    select: { id: true, telegramChatId: true },
  });
  const idToChat = new Map<string, string>();
  for (const u of users) {
    if (u.telegramChatId != null && u.telegramChatId !== "") {
      idToChat.set(u.id, u.telegramChatId);
    }
  }

  for (const [userId, text] of mergedByUser) {
    const chatId = idToChat.get(userId);
    if (!chatId) {
      console.log("TELEGRAM_SKIP", "no telegramChatId", userId);
      continue;
    }
    console.log("TELEGRAM_SENT", userId);
    await sendTelegramChatMessage(chatId, text);
  }
}

/** Исполнитель и постановщик; при совпадении — одно сообщение в формате «назначена» (как раньше). */
export async function notifyTaskCreatedTelegram(params: {
  assigneeId: string | null;
  creatorId: string;
  title: string;
  description: string;
}): Promise<void> {
  const desc = params.description.trim();
  let assigneeText = `🆕 Вам назначена новая задача:\n${params.title}`;
  if (desc) {
    assigneeText += `\n\nОписание:\n${desc}`;
  }
  let creatorText = `🆕 Вы поставили задачу:\n${params.title}`;
  if (desc) {
    creatorText += `\n\nОписание:\n${desc}`;
  }

  const sends: { userId: string; text: string }[] = [];
  if (params.assigneeId && params.assigneeId === params.creatorId) {
    sends.push({ userId: params.assigneeId, text: assigneeText });
  } else {
    if (params.assigneeId) {
      sends.push({ userId: params.assigneeId, text: assigneeText });
    }
    sends.push({ userId: params.creatorId, text: creatorText });
  }

  await sendTelegramToUsers(sends);
}

export async function notifyTaskCommentTelegram(params: {
  taskId: string;
  commentText: string;
}): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: {
      id: true,
      title: true,
      userId: true,
      createdById: true,
      assigneeId: true,
      assignee: { select: { id: true } },
      createdBy: { select: { id: true } },
    },
  });
  if (!task) return;

  const creatorId = creatorUserId(task);
  const recipientIds = [task.assigneeId, creatorId].filter(
    (id): id is string => Boolean(id),
  );
  const uniqueRecipients = [...new Set(recipientIds)];
  const text = `💬 Новый комментарий в задаче:\n${task.title}\n\n${params.commentText}`;
  await sendTelegramToUsers(
    uniqueRecipients.map((userId) => ({ userId, text })),
  );
}

/**
 * Старые dueDate сохранялись как UTC-полночь (date-only). Для таких показываем
 * только дату; для новых — дату и время.
 */
function isLegacyDateOnlyDueDate(d: Date): boolean {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

function formatOverdueDueDate(dueDate: Date): string {
  if (isLegacyDateOnlyDueDate(dueDate)) {
    return dueDate.toLocaleDateString("ru-RU");
  }
  return dueDate.toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Уведомление о просроченной задаче исполнителю и постановщику.
 * Возвращает число фактически отправленных сообщений (в чаты с telegramChatId).
 */
export async function notifyTaskOverdueTelegram(params: {
  title: string;
  dueDate: Date;
  assigneeId: string | null;
  creatorId: string;
}): Promise<{ telegramRecipients: number }> {
  const text = `⏰ Просрочена задача:\n${params.title}\n\nСрок был: ${formatOverdueDueDate(params.dueDate)}`;

  const recipientIds = [
    ...new Set([params.assigneeId, params.creatorId].filter(Boolean)),
  ] as string[];

  if (recipientIds.length === 0 || !telegramBot) {
    return { telegramRecipients: 0 };
  }

  const users = await prisma.user.findMany({
    where: { id: { in: recipientIds } },
    select: { id: true, telegramChatId: true },
  });

  let sent = 0;
  for (const u of users) {
    if (u.telegramChatId != null && u.telegramChatId !== "") {
      await sendTelegramChatMessage(u.telegramChatId, text);
      sent += 1;
    } else {
      console.log("TELEGRAM_SKIP", "no telegramChatId (overdue)", u.id);
    }
  }

  return { telegramRecipients: sent };
}

export async function notifyTaskDoneTelegram(params: {
  taskId: string;
}): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: {
      id: true,
      title: true,
      userId: true,
      createdById: true,
      assigneeId: true,
      assignee: { select: { id: true } },
      createdBy: { select: { id: true } },
    },
  });
  if (!task) return;

  const creatorId = creatorUserId(task);
  const recipientIds = [task.assigneeId, creatorId].filter(
    (id): id is string => Boolean(id),
  );
  const uniqueRecipients = [...new Set(recipientIds)];
  const text = `✅ Задача закрыта:\n${task.title}`;
  await sendTelegramToUsers(
    uniqueRecipients.map((userId) => ({ userId, text })),
  );
}
