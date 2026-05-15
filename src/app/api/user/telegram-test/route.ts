import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import { telegramBot } from "@/lib/telegram";

async function getSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get("session")?.value;
  const session = verifySessionToken(token);
  return session?.userId ?? null;
}

const TEST_MESSAGE =
  "✅ Telegram уведомления QuizHeroes Tasks работают.";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true },
  });

  if (!user?.telegramChatId) {
    return NextResponse.json(
      { error: "Telegram not connected" },
      { status: 400 },
    );
  }

  if (!telegramBot) {
    return NextResponse.json(
      { error: "Telegram bot unavailable" },
      { status: 503 },
    );
  }

  try {
    await telegramBot.sendMessage(user.telegramChatId, TEST_MESSAGE);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
