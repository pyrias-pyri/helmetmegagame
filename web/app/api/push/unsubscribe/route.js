import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";

// POST /api/push/unsubscribe — stop notifying this browser.
//
// Scoped to the signed-in account, so posting somebody else's endpoint deletes
// nothing. A row that is already gone is a success: the browser's state and the
// table's agree either way.
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

  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return Response.json({ error: "Which browser?" }, { status: 400 });

  await prisma.pushSubscription.deleteMany({
    where: { endpoint, discordUserId: session.discordUserId },
  });

  return Response.json({ ok: true });
}
