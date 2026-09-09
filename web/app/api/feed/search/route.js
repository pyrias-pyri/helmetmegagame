import { prisma, Prisma } from "@lifeweb/db";
import { withAvatarVersions } from "@lifeweb/db/lib/archive";
import { feedWipeFloors } from "@lifeweb/db/lib/feedWipe";
import { loadFeedViewer, placesFor } from "@/lib/feedAccess";

// GET /api/feed/search?q=&place= — what was said, anywhere this viewer can
// hear it.
//
// THREE letters, not two. A GIN trigram index is built out of three-character
// grams, so an ILIKE whose pattern is shorter than one gram has nothing in the
// index to match and Postgres falls back to reading every row in
// ArchiveEntry. Two letters was a sequential scan of the whole archive on
// every second keystroke.
//
// The index is already there: ArchiveEntry_content_trgm_idx, a GIN trigram
// index that lives only in raw migration SQL (which is why `prisma migrate
// diff` keeps proposing to drop it — CLAUDE.md's note). An `ILIKE '%q%'` is
// exactly the shape it covers, so this is a raw query rather than a Prisma
// `contains`: the same shape the GM desk's conversation search uses
// (web/app/(desk)/gm/players/actions.js), parameterised, never concatenated.
//
// THE GATE IS THE PLACE LIST. `placesFor` is the one answer to "where may you
// read" (CHAT.md §5a), and this searches inside it and nowhere else — so a
// zone summary a character cannot hear is not searchable from Chat, and a
// GM's search is bounded by their GmZoneView the same way their feed is.
export const dynamic = "force-dynamic";

const RESULT_ROWS = 30;
const MIN_QUERY = 3;
const MAX_QUERY = 80;

export async function GET(request) {
  const viewer = await loadFeedViewer();
  if (!viewer.discordUserId) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!viewer.character && !viewer.gm) {
    return Response.json({ error: "You have no living character." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const q = String(params.get("q") ?? "").trim();
  if (q.length < MIN_QUERY || q.length > MAX_QUERY) {
    return Response.json({ error: "Try a different search." }, { status: 400 });
  }

  const places = await placesFor(prisma, viewer.character, viewer.options);
  const wanted = params.get("place");
  // A named place has to be one of theirs, and asking for one that is not is
  // a refusal rather than a silent widening.
  const scope = wanted ? places.filter((entry) => entry.placeKey === wanted) : places;
  if (wanted && scope.length === 0) {
    return Response.json({ error: "You aren't there." }, { status: 403 });
  }
  if (scope.length === 0) return Response.json({ rows: [] });

  // Nothing from before the last wipe, the same floors the feed, the history
  // route and the place watermarks all read (db/lib/feedWipe.js). A search
  // spans every place the viewer can see, and a zone summary clears on the
  // slower Dawn schedule, so the floor is picked per row below.
  const floors = await feedWipeFloors(prisma);

  // LIKE metacharacters escaped, so a query holding % or _ searches for those
  // characters instead of turning into a wildcard. Backslash is Postgres's
  // default LIKE escape, so no ESCAPE clause is needed.
  const pattern = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const keys = Prisma.join(scope.map((entry) => entry.placeKey));

  const rows = await prisma.$queryRaw`
    SELECT ae."seq",
           ae."placeKey",
           ae."characterId",
           ae."characterName",
           ae."concealedAlias",
           ae."presentedAvatarPath",
           ae."content",
           ae."sentAt",
           ae."source",
           ae."editedAt",
           ae."deletedAt"
    FROM "ArchiveEntry" ae
    WHERE ae."placeKey" IN (${keys})
      AND ae."deletedAt" IS NULL
      AND ae."seq" > (CASE WHEN ae."placeKey" LIKE 'zone:%' THEN ${floors.summary} ELSE ${floors.turn} END)
      AND ae."content" ILIKE ${pattern}
    ORDER BY ae."seq" DESC
    LIMIT ${RESULT_ROWS}
  `;

  // The place's NAME, so a hit reads "the Council Room" rather than
  // "room:clx…". It is the viewer's own list, so nothing here names a place
  // they could not already see in their column.
  const nameByKey = new Map(scope.map((entry) => [entry.placeKey, entry.name]));
  const shaped = await withAvatarVersions(prisma, rows);
  return Response.json({
    rows: shaped.map((row) => ({ ...row, placeName: nameByKey.get(row.placeKey) ?? null })),
  });
}
