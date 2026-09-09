import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";

// POST /api/push/subscribe — record this browser as one to notify.
//
// The subscription belongs to the signed-in Discord account, never to anything
// the client posted: a server action is a public endpoint, and so is this.
// Upserted on the endpoint, which is the push service's own id for the browser
// — re-subscribing in the same browser rewrites its row instead of piling up.
export const dynamic = "force-dynamic";

export async function POST(request) {
  const session = await auth();
  if (!session?.discordUserId) return Response.json({ error: "Sign in first." }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "That didn't arrive in one piece." }, { status: 400 });
  }

  const sub = body?.subscription;
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const authKey = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
  if (!endpoint || !p256dh || !authKey) {
    return Response.json({ error: "That subscription is incomplete." }, { status: 400 });
  }

  // Trimmed hard: it is only ever read by a person looking at the table to
  // work out which of their devices a row is.
  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 200) || null;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    // A rotated endpoint reused by a different account is the case this
    // covers: the row moves to whoever is signed in now.
    update: { discordUserId: session.discordUserId, p256dh, auth: authKey, userAgent },
    create: { discordUserId: session.discordUserId, endpoint, p256dh, auth: authKey, userAgent },
  });

  return Response.json({ ok: true });
}
