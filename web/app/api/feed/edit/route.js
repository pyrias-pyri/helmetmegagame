import { prisma, feedRowShape } from "@lifeweb/db";
import { editSpeech } from "@lifeweb/db/lib/say";
import { auth } from "@/lib/auth";
import { loadFeedCharacter } from "@/lib/feedAccess";

// POST /api/feed/edit { seq, content } — change something you said, inside the
// five-minute window. db/lib/say.js owns the window, the ownership check and
// the transforms; the bot's outbox carries the change to Discord. The web
// never edits a webhook message itself.
export const dynamic = "force-dynamic";

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

export async function POST(request) {
  const session = await auth();
  if (!session?.discordUserId) return jsonResponse({ error: "Sign in first." }, 401);

  const character = await loadFeedCharacter(session.discordUserId);
  if (!character) return jsonResponse({ error: "You have no living character." }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "That didn't arrive in one piece." }, 400);
  }

  // seq crosses the wire as a string because it is a BigInt column; say.js
  // parses it, and a bad one comes back as an ordinary refusal.
  const seq = typeof body?.seq === "string" || typeof body?.seq === "number" ? String(body.seq) : null;
  const content = typeof body?.content === "string" ? body.content : "";

  // The character is the session's. Nothing about which row this is allowed
  // to touch comes from the request beyond the seq itself.
  const result = await editSpeech(prisma, { characterId: character.id, seq, content });
  if (!result?.ok) return jsonResponse({ error: result?.refusal ?? "That didn't change." }, 403);

  return jsonResponse({ row: feedRowShape(result.row) });
}
