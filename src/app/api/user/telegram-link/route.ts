import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

async function getSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get("session")?.value;
  const session = verifySessionToken(token);
  return session?.userId ?? null;
}

function randomSixDigitCode(): string {
  return String(100000 + Math.floor(Math.random() * 900000));
}

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    const code = randomSixDigitCode();
    const taken = await prisma.user.findFirst({
      where: {
        telegramLinkCode: code,
        NOT: { id: userId },
      },
    });
    if (taken) continue;

    await prisma.user.update({
      where: { id: userId },
      data: { telegramLinkCode: code },
    });

    return NextResponse.json({ code });
  }

  return NextResponse.json({ error: "Could not generate code" }, { status: 500 });
}
