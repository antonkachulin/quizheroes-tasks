import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

async function getSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get("session")?.value;
  const session = verifySessionToken(token);
  return session?.userId ?? null;
}

const MAX_MESSAGES = 500;
const MAX_TEXT_LEN = 4000;

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const messages = await prisma.chatMessage.findMany({
    orderBy: { createdAt: "asc" },
    take: MAX_MESSAGES,
    include: {
      user: { select: { login: true } },
    },
  });

  return NextResponse.json({ messages });
}

type PostBody = {
  text?: string;
};

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LEN) {
    return NextResponse.json({ error: "text is too long" }, { status: 400 });
  }

  const message = await prisma.chatMessage.create({
    data: {
      text,
      userId,
    },
    include: {
      user: { select: { login: true } },
    },
  });

  return NextResponse.json({ message }, { status: 201 });
}
