import { cookies } from "next/headers";
import { checkPassword, createSessionToken, SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  let password: unknown;
  try {
    const body = await request.json();
    password = body?.password;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!checkPassword(password)) {
    return Response.json({ error: "Incorrect password" }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return Response.json({ ok: true });
}
