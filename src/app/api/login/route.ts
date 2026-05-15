import { NextResponse } from "next/server";
import { createSessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

type LoginRequestBody = {
  login?: string;
  password?: string;
};

export async function POST(request: Request) {
  let body: LoginRequestBody;

  try {
    body = (await request.json()) as LoginRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const login = body.login?.trim();
  const password = body.password;

  if (!login || !password) {
    return NextResponse.json(
      { error: "Login and password are required" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { login },
  });

  if (!user || !verifyPassword(password, user.password)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = createSessionToken({
    userId: user.id,
    login: user.login,
    role: user.role === "admin" ? "admin" : "user",
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });

  return response;
}

