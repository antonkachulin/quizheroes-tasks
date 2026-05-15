import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import { hashPassword } from "@/lib/password";

const MAX_LOGIN_LEN = 128;
const MIN_PASSWORD_LEN = 8;

async function getSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get("session")?.value;
  const session = verifySessionToken(token);
  return session?.userId ?? null;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    select: { id: true, login: true, role: true },
    orderBy: { login: "asc" },
  });

  return NextResponse.json({ users });
}

type CreateUserBody = {
  login?: string;
  password?: string;
  role?: string;
};

export async function POST(request: Request) {
  const token = (await cookies()).get("session")?.value;
  const session = verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: CreateUserBody;
  try {
    body = (await request.json()) as CreateUserBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const login = typeof body.login === "string" ? body.login.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const roleRaw = body.role;
  const role =
    roleRaw === "admin" || roleRaw === "user" ? roleRaw : null;

  if (!login || !password || !role) {
    return NextResponse.json(
      { error: "login, password и role (admin | user) обязательны" },
      { status: 400 },
    );
  }

  if (login.length > MAX_LOGIN_LEN) {
    return NextResponse.json(
      { error: `Логин не длиннее ${MAX_LOGIN_LEN} символов` },
      { status: 400 },
    );
  }

  if (password.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      { error: `Пароль не короче ${MIN_PASSWORD_LEN} символов` },
      { status: 400 },
    );
  }

  const taken = await prisma.user.findUnique({
    where: { login },
    select: { id: true },
  });
  if (taken) {
    return NextResponse.json(
      { error: "Пользователь с таким логином уже есть" },
      { status: 409 },
    );
  }

  const user = await prisma.user.create({
    data: {
      login,
      password: hashPassword(password),
      role,
    },
    select: { id: true, login: true, role: true },
  });

  return NextResponse.json({ user }, { status: 201 });
}
