import { NextResponse } from "next/server";
import { sessionCookieSecure } from "@/lib/session";

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("session", "", {
    httpOnly: true,
    secure: sessionCookieSecure(request),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
