"use client";

import { ATE_MEAL_SLUG, FAST_METABOLISM_SLUG, HUNGERLESS_SLUG } from "@lifeweb/db/lib/constants";
import { chainTokens } from "@/lib/tagChains";
import ChipText from "./ChipText";

// What changes when the turn turns, as a short list: the tags that run out or
// become something worse, the crafts and builds that finish, the road you
// arrive at the end of, and whether there is dinner. Every line is derived
// from what the sheet already loaded — nothing here is a second opinion, only
// the turn passes read forward one step (db/lib/tagExpiryPass.js,
// hungerPass.js, craft and structure passes, locationTravel.js).
//
// Renders nothing when nothing changes, so a quiet turn costs no space.
export default function TurnForecast({
  tags = [],
  openTurnNumber = null,
  craftProjects = [],
  sitesHere = [],
  travellingTo = null,
  resources = 0,
}) {
  if (openTurnNumber == null) return null;
  const lines = [];

  // A tag on its last turn: either it simply ends, or its chain says what it
  // turns into (TAGS.md §5c). expiresTurn is the absolute turn it is swept
  // after, so equal to the open turn means "this close".
  for (const ct of tags) {
    if (ct.expiresTurn !== openTurnNumber) continue;
    const becomes = chainTokens(ct.tag?.expiresInto);
    lines.push(
      <li key={`tag-${ct.tag.id}`}>
        {becomes ? (
          <>
            {ct.tag.name} → <ChipText text={becomes} /> ‡
          </>
        ) : (
          `${ct.tag.name} ends.`
        )}
      </li>,
    );
  }

  // Work that lands at the close: one more turn's progress takes it over the
  // line (db/lib/structures.js counts the same way).
  for (const p of craftProjects) {
    if (p.turnsDone + 1 >= p.turnsNeeded) {
      lines.push(<li key={`project-${p.id}`}>{`${p.quantity > 1 ? `${p.quantity}× ` : ""}${p.tagName} is finished.`}</li>);
    }
  }
  for (const s of sitesHere) {
    if (s.status === "UNDER_CONSTRUCTION" && s.turnsDone + 1 >= s.turnsNeeded) {
      lines.push(<li key={`site-${s.id}`}>{`${s.typeName} is finished.`}</li>);
    }
  }

  if (travellingTo) lines.push(<li key="travel">{`You arrive at ${travellingTo}.`}</li>);

  // Dinner, the way db/lib/hungerPass.js settles it: Hungerless owes nothing,
  // a meal already eaten covers it, otherwise the flat 1 ⬢ (2 with Fast
  // Metabolism) — and under the full cost you pay nothing and go Hungry.
  const held = new Set(tags.map((ct) => ct.tag?.slug));
  if (!held.has(HUNGERLESS_SLUG) && !held.has(ATE_MEAL_SLUG)) {
    const cost = held.has(FAST_METABOLISM_SLUG) ? 2 : 1;
    lines.push(
      <li key="dinner">
        {resources >= cost
          ? `Dinner costs ${cost} ⬢, unless you eat something you're carrying.`
          : `You can't afford dinner — you'll go Hungry unless you eat something you're carrying.`}
      </li>,
    );
  }

  if (lines.length === 0) return null;
  return (
    <div className="ledger-turn">
      <span className="field-label">When the turn turns</span>
      <ul className="sheet-forecast">{lines}</ul>
    </div>
  );
}
