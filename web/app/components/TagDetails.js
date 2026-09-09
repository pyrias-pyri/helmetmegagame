import { formatCost, costColor, prerequisiteNames } from "@/lib/characterCreation";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { formatTagArmor } from "@/lib/formatTagArmor";
import { formatTagWeight } from "@/lib/formatTagWeight";
import { turnsLeft, tagDuration } from "@/lib/turnFormat";
import { chainTokens } from "@/lib/tagChains";
import DesireUnlocks from "./DesireUnlocks";
import ChipText from "./ChipText";
import PaperSheet from "./PaperSheet";

// Everything a tag has to say about itself, as one block: name, description,
// the label/value rows, what it unlocks. TagChip.js renders it inside a
// HoverCard; the sheet's rows (TagRow.js) render it inline under the row when
// clicked, and the band's status chips do the same. One block, so the three
// can never disagree about what a tag is.
//
// No hooks and no "use client", so TagChip keeps rendering on the server.

// The countdown a held tag shows, or the catalog wording for a bare one, or
// the bomb's own clock. Exported because the chip's face and this block both
// read it and must agree.
export function tagDurationFor({ tag, expiresTurn = null, currentTurn = null, armedTurn = null }) {
  if (armedTurn != null) {
    return {
      label: `Armed. It fires as turn ${armedTurn} closes.`,
      badge: `armed · ${turnsLeft(armedTurn, currentTurn) ?? "?"}t`,
      armed: true,
    };
  }
  // The CharacterTag's expiresTurn, not the Tag's defaultDurationTurns — the
  // clock started when it was granted. Null for a bare catalog reference,
  // which is what makes tagDuration fall back to the catalog wording.
  return tagDuration(turnsLeft(expiresTurn, currentTurn), tag?.defaultDurationTurns);
}

// One label/value row. Labels are muted and values carry --text, so the block
// reads as answers rather than a flat run of grey <p>s.
function Meta({ label, children }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export default function TagDetails({
  tag,
  quantity = 1,
  expiresTurn = null,
  currentTurn = null,
  armedTurn = null,
  // Whether {tag:…} tokens inside may become real, hoverable chips. True
  // inside a pinned HoverCard panel and inline on the sheet; TagChip passes it
  // through as before.
  inTooltip = true,
  // Slot for a control that acts on the holding — TagChip's Consume button and
  // its error line — rendered between the description and the rows.
  children = null,
  // The name row is the chip's own face on a row, so the row can drop it.
  showName = true,
}) {
  const stack = quantity > 1 ? quantity : null;
  const requirement = formatTagRequirement(tag);
  const armor = formatTagArmor(tag);
  const weight = formatTagWeight(tag, quantity);
  const duration = tagDurationFor({ tag, expiresTurn, currentTurn, armedTurn });
  const becomes = chainTokens(tag.expiresInto);
  const treated = chainTokens(tag.removesInto);

  return (
    <>
      {showName && (
        <div className="flex items-start justify-between gap-2">
          <strong>
            {tag.name}
            {stack ? ` ×${stack}` : ""}
          </strong>
          {(tag.group?.name || tag.category) && (
            <span className="text-muted whitespace-nowrap text-xs">
              {[tag.group?.name, tag.category].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
      )}
      {tag.paper ? (
        <PaperSheet paper={tag.paper} />
      ) : (
        tag.description && <ChipText text={tag.description} as="p" inTooltip={inTooltip} />
      )}
      {children}
      <dl className="tag-meta">
        {duration && <Meta label={duration.armed ? "Armed" : "Expires"}>{duration.label}</Meta>}
        {becomes && (
          <Meta label="Becomes">
            <ChipText text={becomes} inTooltip={inTooltip} />
          </Meta>
        )}
        {treated && (
          <Meta label="Treated">
            <ChipText text={treated} inTooltip={inTooltip} />
          </Meta>
        )}
        {/* Labelled, not bare: formatTagRequirement's leading "1t" is turns of
            WORK, which collided with the expiry countdown's own "1t" when both
            sat unlabelled in the same panel. Which work it is depends on the
            tag — on a wound the block is the cost to remove it, on a craftable
            it is the recipe to make one. */}
        {requirement && (
          <Meta label={tag.craftable ? "Recipe" : tag.healable ? "Cure" : "Requirement"}>
            {requirement}
          </Meta>
        )}
        {armor && <Meta label="Armour">{armor}</Meta>}
        {weight && <Meta label="Weight">{weight}</Meta>}
        {tag.equipSlot && tag.twoHanded && <Meta label="Hands">Two</Meta>}
        {tag.inspectVisibility && tag.inspectVisibility !== "HIDDEN" && (
          <Meta label="Seen by others">{tag.inspectVisibility === "WORN" ? "Only while worn" : "Yes"}</Meta>
        )}
        {tag.concealsIdentity && (
          <Meta label="Conceals you">{tag.forcesConceal ? "Always, while worn" : "Optional, while worn"}</Meta>
        )}
        {prerequisiteNames(tag).length > 0 && (
          <Meta label="Requires">{prerequisiteNames(tag).join(", ")}</Meta>
        )}
        <Meta label="Cost">
          <span style={{ color: costColor(tag.pointCost) }}>
            {formatCost(tag.pointCost)} {Math.abs(tag.pointCost ?? 0) === 1 ? "pt" : "pts"}
          </span>
        </Meta>
      </dl>
      <DesireUnlocks tag={tag} />
    </>
  );
}
