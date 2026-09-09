"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import EmptyState from "@/app/components/EmptyState";
import IconButton from "@/app/components/IconButton";
import ActionButton from "@/app/components/ActionButton";
import FormError from "@/app/components/FormError";
import LookReadout from "@/app/components/LookReadout";
import { EyeIcon } from "@/app/components/icons";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import { ACTION_HELP } from "@/app/components/actionRegistry";
import { lookAtRow } from "@/app/(app)/play/actions";
import { loadPeopleHere } from "@/app/(app)/character/rosterActions";
import useVisiblePoll from "@/app/(app)/play/useVisiblePoll";

// HERE: who is standing where you are, and what you can do to them. Drawn in
// /play's right-hand column and on /ledger's Actions panel — the same rows,
// the same menu — which is why it lives here rather than under play/.
//
// The rows come from db/lib/whosHere.js — the same function the "Who's here?"
// button on the Discord anchor answers with — so the street and the page can
// never disagree about who a stranger is.
//
// A FACE AND AN EYE ARE EARNED, and this is the rule the column is built
// around. Standing in a room is public — everyone here is listed, hooded or
// not — but what is over somebody's face is not, and drawing every mask to
// anybody who walked in announced a cult meeting to the first person through
// the door. So a row shows a face and offers a look only once you have watched
// that person SPEAK this turn (db/lib/sightings.js), and what it shows is what
// you saw: somebody who chatted bare-faced and then masked up in private is
// still listed under their own name and their own face until the turn rolls.
//
// Unseen, a named row keeps its own face — there was never anything to hide
// there — and a hood gets the question-mark plate and no eye.
//
// The eye points at the LINE, not the person: `sightingSeq` is the last thing
// you heard them say, and the server resolves the speaker off it
// (db/lib/examineRow.js). That is what lets a hood carry an eye at all — the
// browser is never told who is under it, so there is nothing for it to leak.
//
// The menu is the sheet's own people dialogs, opened through
// RequestActionsProvider with the clicked person already filled in. Nothing
// is forked: this is the same Heal dialog, the same Loot dialog, the same
// server actions. A hood's menu is Converse and nothing else — there is
// nobody there to heal or loot until the hood comes off.
//
// THE METAGAMING RULE STILL HOLDS (web/app/components/actionRegistry.js): no
// row is greyed for a fact about the person it names. Whether they can be
// looted, bound or harmed is the dialog's answer and the server's, never a
// hint you can read off a menu without opening it.
//
// Look at is NOT on this menu: the eye on the row is the Look at, on every
// row you have earned one on, and a second copy of it inside the menu was
// the same dialog one click further away. Neither is Move Player, which is
// gone entirely — taking somebody with you is the party rack below this list
// now, and it is a thing you keep rather than a thing you re-do every hop
// (docs/systemdocs/MAP.md §3a).
const PEOPLE_ACTIONS = [
  { mode: "heal", label: "Heal", preset: "patientId" },
  { mode: "transfer", label: "Transfer", preset: "toKey", prefix: "character:" },
  { mode: "loot", label: "Loot", preset: "targetId" },
  { mode: "bind", label: "Bind", preset: "targetId" },
  { mode: "free", label: "Free", preset: "targetId" },
  { mode: "harm", label: "Harm", preset: "targetId" },
];

function PersonMenu({ person, onClose, onConverse, addPlace, onAddMember }) {
  const actions = useRequestActions();
  const open = actions?.open ?? null;

  const pick = useCallback(
    (entry) => {
      onClose();
      if (!open) return;
      const value = entry.prefix ? `${entry.prefix}${person.characterId}` : person.characterId;
      open(entry.mode, null, { [entry.preset]: value });
    },
    [open, onClose, person],
  );

  return (
    <div className="chat-menu" role="menu" aria-label={person.name}>
      {PEOPLE_ACTIONS.map((entry) => (
        <ActionButton
          key={entry.mode}
          variant="menu"
          label={entry.label}
          help={ACTION_HELP[entry.mode] ?? null}
          onClick={() => pick(entry)}
        />
      ))}
      {/* Letting somebody into the conversation or the private room that is
          OPEN in the feed. Only offered where there is a door to open — a
          Location, the zone summary and a public room have none — and the
          server re-checks that this character may work it. */}
      {addPlace && onAddMember && (
        <ActionButton
          variant="menu"
          label={`Add to ${addPlace.name}`}
          onClick={() => {
            onClose();
            onAddMember(person.characterId);
          }}
        />
      )}
      {onConverse && (
        <ActionButton
          variant="menu"
          label="Converse"
          onClick={() => {
            onClose();
            // Opened ON this person, so the dialog has them ticked already —
            // asking for a corner with somebody and then having to name them
            // again was the same answer typed twice.
            onConverse({ id: person.characterId, name: person.name });
          }}
        />
      )}
    </div>
  );
}

const HERE_POLL_MS = 60_000;

export default function HereList({
  // The server's list, or null to read it on mount — /ledger passes null,
  // because navigating there is the click that asks who is standing here.
  people,
  selfId,
  strip = false,
  onConverse = null,
  poll = false,
  // The open place, when it is one somebody can be let into: { placeKey,
  // name }. Null everywhere else, which is what keeps the row off the menu.
  addPlace = null,
  onAddMember = null,
}) {
  // Seeded from the server and replaced by the poll. ChatAside keys this
  // component on the server list, so a move remounts it with the new street's
  // people rather than leaving a stale poll answer in place.
  const [live, setLive] = useState(people);
  const named = live?.named ?? [];
  const concealed = live?.concealed ?? [];
  const [openId, setOpenId] = useState(null);

  const pollPeople = useCallback(() => {
    loadPeopleHere()
      .then((res) => {
        if (res?.ok) setLive({ named: res.named, concealed: res.concealed });
      })
      .catch(() => {
        // A missed read costs one stale minute. The next one fixes it.
      });
  }, []);
  // No seed means nobody has asked yet; ask now, then on the minute — and
  // only while the tab is in front of somebody (play/useVisiblePoll.js).
  useEffect(() => {
    if (poll && people == null) pollPeople();
  }, [poll, people, pollPeople]);
  useVisiblePoll(pollPeople, HERE_POLL_MS, { enabled: poll });
  const [hood, setHood] = useState(null);
  // "Add to …" refused, or never reached the server. Chat.js answers with
  // the action's { ok, error }; this is where the sentence is shown, under
  // the list the row was on.
  const [addError, setAddError] = useState(null);
  const addAndReport = useCallback(
    (characterId) => {
      if (!onAddMember) return;
      setAddError(null);
      Promise.resolve(onAddMember(characterId))
        .then((res) => {
          if (res && !res.ok) setAddError(res.error ?? "Something went wrong.");
        })
        .catch(() => setAddError("Could not reach the server. Nothing was changed."));
    },
    [onAddMember],
  );
  const actions = useRequestActions();
  // The one place a click outside has to close something. Kept on the
  // wrapper rather than on the document: the menu is inside the column, and
  // a document listener would need an effect to attach.
  const wrapRef = useRef(null);

  const close = useCallback(() => setOpenId(null), []);

  // One look for every row, hooded or not: the seq of the last line you heard
  // them say. Fetch-then-set from a click rather than an effect — the readout
  // is one round trip and the dialog is open the whole time it is in flight.
  const lookAtSeq = useCallback(
    (seq) => {
      close();
      setHood({ loading: true });
      lookAtRow(seq)
        .then((res) => {
          if (res?.ok) setHood({ readout: res.readout });
          else setHood({ error: res?.error ?? "You can't see them." });
        })
        .catch(() => setHood({ error: "You can't see them." }));
    },
    [close],
  );

  const total = named.length + concealed.length;

  return (
    <div
      className={strip ? "chat-strip" : "chat-here"}
      ref={wrapRef}
      onBlur={(event) => {
        if (!wrapRef.current?.contains(event.relatedTarget)) close();
      }}
    >
      {!strip && <p className="chat-section-title">Here · {total}</p>}
      {total === 0 && !strip && <EmptyState>Nobody is here.</EmptyState>}

      {named.map((person) => (
        <div key={person.characterId} className="chat-person-wrap">
          <div className={strip ? undefined : "chat-person-row"}>
            <button
              type="button"
              className="chat-person"
              aria-haspopup="menu"
              aria-expanded={openId === person.characterId}
              onClick={() => setOpenId(openId === person.characterId ? null : person.characterId)}
            >
              {/* Unseen, this falls through to their own face — a name has
                  nothing to hide, and withholding it would only make the
                  column harder to read. `avatarPath` is set only for a forced
                  name's plaque or a face frozen at the last line you heard. */}
              <CharacterAvatar
                characterId={person.characterId}
                name={person.name}
                version={person.avatarVersion}
                src={person.avatarPath ?? undefined}
                size={24}
              />
              {!strip && (
                <span className="chat-person-name">
                  {person.name}
                  {person.roleTitle ? <span className="text-muted"> · {person.roleTitle}</span> : null}
                  {person.characterId === selfId ? <span className="text-muted"> · you</span> : null}
                </span>
              )}
            </button>
            {/* No eye until you have heard them. Absent rather than greyed:
                the row above already drops it for yourself, so that is one
                rule instead of two, and a disabled eye would need a sentence
                explaining itself. */}
            {!strip && person.characterId !== selfId && person.sightingSeq && (
              <span className="chat-person-eye">
                <IconButton icon={EyeIcon} label="Look at" onClick={() => lookAtSeq(person.sightingSeq)} />
              </span>
            )}
          </div>
          {openId === person.characterId && (
            <PersonMenu
              person={person}
              onClose={close}
              onConverse={onConverse}
              addPlace={addPlace}
              onAddMember={onAddMember ? addAndReport : null}
            />
          )}
        </div>
      ))}

      {/* Keyed by POSITION rather than by token: db/lib/whosHere.js mints no
          token at all when there is no AUTH_SECRET to key the HMAC with, and
          two hoods would then share the key `hooded-null`. */}
      {concealed.map((person, index) => (
        <div key={`hooded-${index}`} className="chat-person-wrap">
          <div className={strip ? undefined : "chat-person-row"}>
            <button
              type="button"
              className="chat-person"
              aria-haspopup="menu"
              aria-expanded={openId === `hooded-${index}`}
              onClick={() => setOpenId(openId === `hooded-${index}` ? null : `hooded-${index}`)}
            >
              {/* The mask, but only if you watched them wear it. Otherwise
                  the question-mark plate: a room full of hoods should not
                  publish which cult is standing in it (PROXYING.md §5). */}
              <CharacterAvatar
                characterId={null}
                name={person.alias}
                src={person.avatarPath ?? undefined}
                unknown={person.unknownFace}
                size={24}
              />
              {!strip && <span className="chat-person-name text-muted">{person.alias}</span>}
            </button>
            {!strip && person.sightingSeq && (
              <span className="chat-person-eye">
                <IconButton icon={EyeIcon} label="Look at" onClick={() => lookAtSeq(person.sightingSeq)} />
              </span>
            )}
          </div>
          {openId === `hooded-${index}` && onConverse && (
            <div className="chat-menu" role="menu" aria-label={person.alias}>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  close();
                  // No id under a hood, so nobody to tick — the dialog opens
                  // the way the place card's Converse opens it.
                  onConverse();
                }}
              >
                Converse
              </button>
            </div>
          )}
        </div>
      ))}

      <FormError>{addError}</FormError>

      {hood && <LookReadout state={hood} onClose={() => setHood(null)} />}
    </div>
  );
}
