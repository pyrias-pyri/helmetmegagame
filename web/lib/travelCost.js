// What a hop costs, in the fewest words that fit under a node.
//
// Lives here rather than in TravelNodes.js because there are two surfaces
// offering the same crossing now — the Travel panel's "ways out" grid and
// /map — and a second copy of this would drift the moment somebody tuned one.
// Pure, no Prisma, no JSX: both callers are clients, and the numbers it reads
// are already computed server-side by loadTravel/loadMap.
//
// A local hop is free full stop and never touches the header's count. A zone
// crossing while one is still available SPENDS one, which used to read as the
// identical word "free" and told a player nothing about the difference. "1
// travel" is what it actually costs — singular, because a single crossing is
// always exactly one no matter how many are left.

export function travelFoot(option, freeLeft, mounted) {
  if (!option.passable) {
    const reason = option.reason ?? "";
    if (/locked/i.test(reason)) return "locked";
    if (/shut/i.test(reason)) return "shut";
    return reason || "no way";
  }
  const cost = !option.crossesZone ? "free" : freeLeft > 0 ? "1 travel" : "the turn";
  // Only worth saying when there's something to lose — dismounts wins over
  // indoors when a way is both, since either one ends the same way and saying
  // it twice would be noise.
  if (option.dismounts) return `${cost} · on foot`;
  if (mounted && option.indoors) return `${cost} · indoors`;
  return cost;
}

// The sentence behind the trait chip on a way your own tag opens. The chip
// itself is just the tag's name — there is no room on a node for more — so this
// is what the hover and the screen reader get. Here rather than in either
// component for the same reason travelFoot is: /play and /map both say it, and
// two copies would drift.
export function openedByLabel(tagName) {
  return `Opened by your ${tagName}.`;
}
