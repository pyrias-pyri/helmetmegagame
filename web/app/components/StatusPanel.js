import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import { CATATONIC_SLUG, TRUMPET_SLUG } from "@lifeweb/db/lib/constants";
import TagPointsValue from "./TagPointsValue";
import ActionGrid from "./ActionGrid";
import SoundTrumpetButton from "./SoundTrumpetButton";
import StandingHerePanel from "./StandingHerePanel";
import { carryCapTitle } from "./statusBits";
import { moveKindLabel, rollLabel } from "@/lib/moves";
import ExpandableText from "./ExpandableText";

// Rendered on the server, so a viewer-local time isn't available — and the
// game's clock is Chicago anyway (turns roll at 00:00/12:00 CT), which is what
// the handbook and the Discord announcement both quote. Labelled CT so nobody
// reads it as their own wall clock.
const CT_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "numeric",
  minute: "2-digit",
});

// The Move cutoff (db/lib/turnClock.js), attached to the turn by
// app/(app)/character/page.js. Absent when there is no lock this turn — a
// manually advanced short turn, or auto-advance switched off.
function MoveCutoff({ window: moveWindow }) {
  if (!moveWindow?.hasLock) return null;
  return moveWindow.locked ? (
    <span className="text-muted">
      Moves are locked for this turn — the next turn opens at {CT_TIME.format(new Date(moveWindow.endsAt))} CT.
    </span>
  ) : (
    <span className="text-muted">Moves lock at {CT_TIME.format(new Date(moveWindow.cutoffAt))} CT.</span>
  );
}

// The player's own read of the Move they filed this turn — the same row the
// bot's DM confirms, just left standing where they can check it later
// instead of scrolling Discord. Player-facing wording, not the GM workflow
// enums (moveReviewStatus's "Passed"/"Open" mean nothing to a player).
function ThisTurn({ currentAction, openTurn, pendingOffers = [] }) {
  if (!openTurn) return <span className="text-muted">No turn is open.</span>;
  const cutoff = <MoveCutoff window={openTurn.moveWindow} />;
  // A handshake still waiting on the other side (docs/systemdocs/LESSONS.md).
  // Shown above the Move line either way: an offer you made is why your Move
  // isn't filed yet, and one made to you is waiting in your DMs.
  const waiting = pendingOffers.map((o) => (
    <span key={o.id} className="text-muted">
      {o.mine
        ? o.kind === "BIND"
          ? `Waiting for ${o.otherName} to agree to be bound.`
          : `Waiting for ${o.otherName} to accept the lesson${o.tagName ? ` in ${o.tagName}` : ""}.`
        : o.kind === "BIND"
          ? `${o.otherName} wants to bind you. Answer in your DMs.`
          : `${o.otherName} offered a lesson${o.tagName ? ` in ${o.tagName}` : ""}. Answer in your DMs.`}
    </span>
  ));
  if (!currentAction)
    return (
      <>
        {waiting}
        <span className="text-muted">Not filed yet.</span>
        {cutoff}
      </>
    );

  const { status, moveReviewStatus, resourceRollValue, resourceRollExpression } = currentAction;

  let stateLine;
  if (status === "PENDING_TYPE" || status === "PENDING" || status === "PENDING_OPPOSED") {
    stateLine = <span className="text-muted">Not locked in yet — check your Discord DMs.</span>;
  } else if (moveReviewStatus === "SOLVED") {
    stateLine = <span className="text-positive">Solved.</span>;
  } else {
    // Always empty for a Gambit now: app/(app)/character/page.js strips the
    // die server-side, and this panel's only mount is that page. Kept rather
    // than deleted so the panel stays honest about whatever it is handed —
    // a Routine has never had a die either, and this is the same branch.
    const roll = rollLabel(currentAction);
    // The range, not just the number. A bare "+7 ⬢" is unreadable: the roll's
    // floor moves with GameConfig.productionCoefficient, with the Location's
    // own yield coefficient, and with whatever tools folded into it
    // (LABORING.md), so a player who knows their tier's written rate can't
    // tell a low roll from a missing bonus — which is exactly how "Butcher
    // isn't applying" got reported. The stored expression
    // is already a plain "min-max" string; en-dash it here rather than import
    // formatRangeExpression, which would drag @lifeweb/db into this bundle.
    const range = /^\d+-\d+$/.test(resourceRollExpression ?? "")
      ? resourceRollExpression.replace("-", "–")
      : null;
    const amount = resourceRollValue != null ? `${resourceRollValue > 0 ? "+" : ""}${resourceRollValue} ⬢` : null;
    const payout = amount && range ? `${range} → ${amount}` : amount;
    // Without this the line just loses its middle and reads as if nothing was
    // rolled. Same words the confirm DM uses (bot/src/lib/moveConfirm.js), so
    // the two surfaces promise the same moment.
    const pending = !roll && currentAction.moveKind === "GAMBIT";
    stateLine = (
      <span className="text-muted">
        Locked in{roll ? ` — ${roll}` : ""}
        {payout ? ` (${payout})` : ""}.{" "}
        {pending ? "🎲 The die is cast — you'll see how it fell when the turn ends." : "Results land when the turn ends."}
      </span>
    );
  }

  return (
    <>
      {waiting}
      <span className="field-label">{moveKindLabel(currentAction.moveKind, currentAction.gmNotes)}</span>
      <ExpandableText text={currentAction.description} lines={3} />
      {stateLine}
      {cutoff}
    </>
  );
}

// A labelled row, so Zone / Resources / Gambit line up on one grid instead
// of each being its own ad-hoc flex line. `stacked` swaps the value cell to a
// column for content that clamps onto multiple lines (the Move description)
// — the default flex-wrap row fights a CSS line-clamp otherwise.
function Row({ label, children, stacked = false }) {
  return (
    <>
      <dt className="field-label" style={{ alignSelf: stacked ? "start" : "center" }}>
        {label}
      </dt>
      <dd className={`m-0 text-sm ${stacked ? "flex flex-col items-start gap-1" : "flex flex-wrap items-center gap-2"}`}>
        {children}
      </dd>
    </>
  );
}

export default function StatusPanel({
  character,
  isSelf,
  currentAction,
  openTurn,
  carry = null,
  zoneMoves = null,
  zoneMovesReason = null,
  travellingTo = null,
  pendingOffers = [],
  // What stands at this Location (db/lib/structures.js), built in
  // character/page.js. Empty on someone else's sheet.
  sitesHere = [],
  // This character's own ACTIVE CraftProjects (db/lib/structures.js is the
  // Structure half; CraftProject is the pocket-item half), also built in
  // character/page.js and otherwise only visible by opening the Craft
  // dialog. Empty on someone else's sheet — CharacterSheet only ever mounts
  // this component for the sheet's own owner.
  craftProjects = [],
}) {
  // Hunger is the only Gambit contributor, and this is the same module the bot
  // rolls against (db/lib/gambitModifier.js) — so what a player reads here is
  // exactly what gets applied.
  const total = gambitModifierTotal(character.tags, { hungerStreak: character.hungerStreak });

  // Same shape tolerance as gambitModifierTotal above: CharacterTag[] with a
  // joined tag. The catatonic tag is granted/cleared only by the turn pass
  // (db/lib/catatonicPass.js), so this row explains itself rather than
  // leaving the player to find one grey chip among their tags.
  const catatonic = character.tags?.some((ct) => (ct?.tag?.slug ?? ct?.slug) === CATATONIC_SLUG);

  // Held, not equipped: you pick a trumpet up to blow it.
  const hasTrumpet = character.tags?.some((ct) => (ct?.tag?.slug ?? ct?.slug) === TRUMPET_SLUG);

  // Standing work, without opening the Craft dialog: a CraftProject is a
  // pocket item in progress, a build site UNDER_CONSTRUCTION here is a
  // Structure in progress (a half-built wall — leaving it off this list
  // would read as a bug, not as "nothing to report"). A finished or ruined
  // site isn't "in progress", so it's left to StandingHerePanel below.
  const sitesInProgress = sitesHere.filter(
    (s) => s.status === "UNDER_CONSTRUCTION",
  );
  const hasWorkInProgress =
    craftProjects.length > 0 || sitesInProgress.length > 0;

  return (
    <>
    <section className="panel p-4">
      <h2 className="panel-header">Status</h2>

      {/* The readout and the Actions block side by side, rather than the
          actions stacked under a divider at the bottom. Everything a player
          does now lives in that grid, so it earns the space next to the
          numbers it acts on — and the panel stays about as tall as the <dl>
          alone used to be. Below `sm` the grid drops underneath. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <dl
          className="grid min-w-0 flex-1 gap-x-4 gap-y-2"
          style={{ gridTemplateColumns: "auto minmax(0, 1fr)", margin: 0 }}
        >
          {catatonic && (
            <Row label="Condition">
              <span className="text-muted">
                Catatonic — lifts the moment {isSelf ? "you" : "they"} act or speak in character.
              </span>
            </Row>
          )}

          {/* Where they stand is the Location; the zone is the region it
              sits in, and what the #summary channel belongs to. */}
          <Row label="Location">{character.location?.name ?? "Nowhere"}</Row>

          <Row label="Zone">{character.zone?.name ?? "Unassigned"}</Row>

          {/* A crossing that cost the Move is a day's walk, and the character
              stays put until the next turn opens (MAP.md §3). */}
          {travellingTo && (
            <Row label="On the road">
              <span title="You arrive at the start of next turn.">
                walking to {travellingTo}
              </span>
            </Row>
          )}

          {/* Free zone crossings left this turn (CARRY.md §2). Past these a
              crossing spends the Move; at zero — which is what Overburdened
              does — the first one already does. */}
          {zoneMoves != null && (
            <Row label="Zone moves">
              {/* The reason rides in the hover for the same reason the carry
                  cap's breakdown does: a bare 0 leaves a lamed or overloaded
                  player with nothing to act on. */}
              <span
                className="mono"
                title={zoneMovesReason ?? undefined}
                style={zoneMoves === 0 ? { color: "var(--accent-text)" } : undefined}
              >
                {zoneMoves} free
              </span>
            </Row>
          )}

          {/* Load against the carry caps (CARRY.md). `carry` is computed
              server-side by character/page.js for the owner's own sheet
              only; another player's sheet shows the bare balance. Over a
              cap reads in accent — the Overburdened tag says the rest. */}
          <Row label="Resources">
            {carry ? (
              <span className="mono" style={carry.resources > carry.resourcesCap ? { color: "var(--accent-text)" } : undefined}>
                {carry.resources} / {carry.resourcesCap} ⬢
              </span>
            ) : (
              <>{character.resources} ⬢</>
            )}
          </Row>

          {carry && (
            <Row label="Carrying">
              {/* The cap carries a title= breakdown so a player can see what is
                  holding it up — the base, then one line per active
                  multiplier. Native tooltip on purpose: it needs no state, no
                  portal, and it works on the desk and the phone alike. */}
              <span
                className="mono"
                title={carryCapTitle(carry)}
                style={carry.weightUsed > carry.weightCap ? { color: "var(--accent-text)" } : undefined}
              >
                {carry.weightUsed} / {carry.weightCap} lb
              </span>
            </Row>
          )}

          <Row label="Gambit">
            {total ? (
              <span style={{ color: "var(--accent-text)" }}>{total} to the die</span>
            ) : (
              <span className="text-muted">No modifier</span>
            )}
          </Row>

          <Row label="Tag Points">
            <TagPointsValue points={character.tagPoints} />
          </Row>

          {hasWorkInProgress && (
            <Row label="In progress">
              <div className="flex flex-wrap gap-2">
                {craftProjects.map((p) => (
                  <span key={`project-${p.id}`} className="chip">
                    {p.quantity > 1 ? `${p.quantity}× ` : ""}
                    {p.tagName} —{" "}
                    <span className="mono">
                      {p.turnsDone}/{p.turnsNeeded}
                    </span>{" "}
                    turns
                  </span>
                ))}
                {sitesInProgress.map((s) => (
                  <span key={`site-${s.id}`} className="chip">
                    {s.typeName} —{" "}
                    <span className="mono">
                      {s.turnsDone}/{s.turnsNeeded}
                    </span>{" "}
                    turns
                  </span>
                ))}
              </div>
            </Row>
          )}

          <Row label="This turn" stacked>
            <ThisTurn currentAction={currentAction} openTurn={openTurn} pendingOffers={pendingOffers} />
          </Row>
        </dl>

        {isSelf && <ActionGrid />}
        {/* Only if you are carrying one. Derived here off the same held-tags
            array the catatonic row above reads, so no slug matching reaches
            the browser — and the server action re-checks it anyway. */}
        {isSelf && hasTrumpet && <SoundTrumpetButton />}
      </div>
    </section>

    {/* Its own panel rather than a row in the <dl> above: what stands on the
        ground is a fact about the place, not about the person, and it is a
        list rather than a value. Renders nothing when the ground is bare. */}
    <StandingHerePanel sites={sitesHere} />
    </>
  );
}
