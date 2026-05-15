import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { creatorUserId, notifyTaskCommentTelegram } from "@/lib/task-telegram-notify";
import { verifySessionToken } from "@/lib/session";

const MAX_COMMENT_LEN = 4000;

async function getSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get("session")?.value;
  const session = verifySessionToken(token);
  return session?.userId ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: taskId } = await params;
  const task = await prisma.task.findFirst({
    where: { id: taskId },
    select: { id: true },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const comments = await prisma.taskComment.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      text: true,
      createdAt: true,
      userId: true,
      user: { select: { login: true } },
    },
  });

  return NextResponse.json({ comments });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: taskId } = await params;
  const task = await prisma.task.findFirst({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      assigneeId: true,
      createdById: true,
      userId: true,
    },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let body: { text?: unknown };
  try {
    body = (await request.json()) as { text?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text =
    typeof body.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "Текст комментария обязателен" }, { status: 400 });
  }

  if (text.length > MAX_COMMENT_LEN) {
    return NextResponse.json(
      { error: `Комментарий не длиннее ${MAX_COMMENT_LEN} символов` },
      { status: 400 },
    );
  }

  const comment = await prisma.taskComment.create({
    data: {
      text,
      taskId,
      userId,
    },
    select: {
      id: true,
      text: true,
      createdAt: true,
      userId: true,
      user: { select: { login: true } },
    },
  });

  const creatorId = creatorUserId(task);
  const candidateUserIds = [
    ...new Set([task.assigneeId, creatorId].filter(Boolean)),
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
  console.log("COMMENT_CREATED", {
    taskId,
    authorId: userId,
    assigneeId: task.assigneeId,
    createdById: task.createdById,
    creatorId,
    recipients,
    telegramChatId,
  });

  try {
    await notifyTaskCommentTelegram({
      taskId,
      commentText: comment.text,
    });
  } catch {
    /* notification optional */
  }

  return NextResponse.json({ comment }, { status: 201 });
}
