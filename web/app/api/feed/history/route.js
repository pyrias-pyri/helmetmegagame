import { prisma, FEED_ROW_SELECT } from "@lifeweb/db";
import { withAvatarVersions } from "@lifeweb/db/lib/archive";
import { feedWipeFloors, floorForPlace, seqFilterAbove } from "@lifeweb/db/lib/feedWipe";
import { loadFeedViewer, findPlace } from "@/lib/feedAccess";

// GET /api/feed/history?place=<key> — the last hundred things said in one
// place.
//
// The stream carries what happens NEXT; this is what happened before. They are
// separate on purpose: a Chat has half a dozen places and a GM has hundreds,
// and pushing every one of their backlogs down one stream would spend a
// player's first second of the page on rooms they never opened. So the page
// server-renders the place it opens on, and this fills in the rest as they are
// selected.
export const dynamic = "force-dynamic";

const HISTORY_ROWS = 100;
// Either side of a search hit. Fifty is enough to read what led up to a line
// and what came of it without pulling the whole day down the wire.
const AROUND_ROWS = 50;
// The largest value a Postgres bigint holds. ArchiveEntry.seq is one.
const MAX_SEQ = 9223372036854775807n;

export async function GET(request) {
  const viewer = await loadFeedViewer();
  if (!viewer.discordUserId) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!viewer.character && !viewer.gm) {
    return Response.json({ error: "You have no living character." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const place = params.get("place");
  // The same gate the stream uses, derived from the same place list.
  const found = await findPlace(prisma, viewer.character, place, viewer.options);
  if (!found) return Response.json({ error: "You aren't there." }, { status: 403 });

  // Nothing from before the last wipe of THIS place (db/lib/feedWipe.js).
  // Discord's half of that pass deleted its messages outright; Chat keeps
  // the rows for /archive and reads past them. One place, so one floor: a
  // zone summary reads the Dawn watermark, everywhere else the turn one.
  const floor = floorForPlace(await feedWipeFloors(prisma), place);

  // ?around=<seq> — the window either side of one line, which is what a
  // search hit needs: the newest hundred would usually not hold something
  // said three days ago. Two queries rather than one, because "50 below and
  // 50 above, inclusive" is not a thing one findMany can say.
  const around = params.get("around");
  if (around) {
    let anchor;
    try {
      anchor = BigInt(around);
    } catch {
      // BigInt() throws a SyntaxError on anything that is not a whole number,
      // and the query string is whatever somebody typed. Answered rather than
      // thrown: an unparseable anchor is a bad request, not a 500.
      return Response.json({ error: "That isn't a line." }, { status: 400 });
    }
    // …and a number that PARSES can still be out of range. `seq` is a bigint
    // column, so anything past its bounds is not a line either, and handing it
    // to Prisma is an error from inside the driver instead of an answer.
    if (anchor < 0n || anchor > MAX_SEQ) {
      return Response.json({ error: "That isn't a line." }, { status: 400 });
    }
    const base = { placeKey: place, deletedAt: null };
    const [below, above] = await Promise.all([
      prisma.archiveEntry.findMany({
        // The anchor itself rides in this half, so a hit whose seq is the
        // oldest thing left above the wipe floor still comes back.
        where: { ...base, seq: seqFilterAbove(floor, { lte: anchor }) },
        orderBy: { seq: "desc" },
        take: AROUND_ROWS + 1,
        select: FEED_ROW_SELECT,
      }),
      prisma.archiveEntry.findMany({
        where: { ...base, seq: seqFilterAbove(floor, { gt: anchor }) },
        orderBy: { seq: "asc" },
        take: AROUND_ROWS,
        select: FEED_ROW_SELECT,
      }),
    ]);
    const window = [...below.reverse(), ...above];
    return Response.json({ place, rows: await withAvatarVersions(prisma, window) });
  }

  const rows = await prisma.archiveEntry.findMany({
    where: { placeKey: place, deletedAt: null, seq: seqFilterAbove(floor) },
    orderBy: { seq: "desc" },
    take: HISTORY_ROWS,
    select: FEED_ROW_SELECT,
  });

  // One `?v=` per character across the page, rather than the per-row sentAt
  // fallback that made the same face refetch on every line.
  return Response.json({ place, rows: await withAvatarVersions(prisma, rows.reverse()) });
}
