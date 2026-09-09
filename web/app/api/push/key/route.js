import { vapidPublicKey } from "@lifeweb/db/lib/webPush";

// GET /api/push/key — the VAPID public half, which the browser needs before it
// can subscribe at all. A 404 is the honest answer on a deployment with no keys
// set, and it is what hides the toggle in Chat (CHAT.md §5a).
//
// No session gate: the public key is public by definition — it is handed to
// every push service the browser talks to.
export const dynamic = "force-dynamic";

export async function GET() {
  const key = vapidPublicKey();
  if (!key) return Response.json({ error: "Notifications are not set up here." }, { status: 404 });
  return Response.json({ key });
}
