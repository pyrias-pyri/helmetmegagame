"use client";

import { useRef, useState, useTransition } from "react";
import {
  LAYER_NAMES,
  SLOT_TITLES,
  WEAPON_HANDS,
  handsOf,
  handsUsed,
} from "@lifeweb/db/lib/equipSlots";
import {
  BOAT_CONFLICT_SLUGS,
  FAST_TRAVEL_SLUGS,
  STOWABLE_SLUGS,
  WATER_TRAVEL_SLUGS,
} from "@lifeweb/db/lib/mounts";
import { armorWord, combineArmor } from "@lifeweb/db/lib/armorValue";
import { formatTagWeight } from "@/lib/formatTagWeight";
import { carryBonusLabel } from "@/lib/sheetCards";
import { toggleEquip } from "@/app/(app)/character/equipActions";
import ClickMenu from "./ClickMenu";
import FormError from "./FormError";

// The rig: what is worn, drawn as the slots it is worn in (TAGS.md,
// "equipSlot"). One row per slot, one cell per place a thing can go — three
// head layers, three body layers, an off hand, three hands, a ride and what
// it tows, and the accessories, which have no cap. A filled cell names the
// thing and the one fact about it worth a glance; an empty cell is dashed and
// named, and clicking it lists what you carry that fits there.
//
// Everything goes through the same toggleEquip the /character rack uses, and
// the server's refusal — a second helm, a fourth hand — lands in FormError
// under the board. No tooltips on this surface.

// Cell counts come from equipSlots.js rather than being written out again: a
// layered slot has one cell per layer name, the hands have WEAPON_HANDS of
// them, and anything else holds exactly one.
const ROWS = ["HEAD", "BODY", "SHIELD", "WEAPON", "MOUNT"].map((slot) => ({
  slot,
  cells: LAYER_NAMES[slot]?.length ?? (slot === "WEAPON" ? WEAPON_HANDS : 1),
}));

// The one line under a worn thing's name.
function fact(tag) {
  const melee = tag.meleeArmor ?? 0;
  const ballistic = tag.ballisticArmor ?? 0;
  if (melee || ballistic) return `${armorWord(melee)} · ${armorWord(ballistic)}`;
  if (tag.concealsIdentity) return "conceals you";
  const carry = carryBonusLabel(tag.carryBonus);
  if (carry) return carry;
  return formatTagWeight(tag) ?? null;
}

// The MOUNT row's menu. equipActions.js refuses more than the slot rule does —
// a cart or a mount is not set up indoors, a boat and a road kit are never out
// at once, and Motion Sickness rules out riding at all — so offering those and
// then failing them is a worse menu than one that leaves them out and says
// why. Everything else on the board is filtered on the slot alone, because the
// slot really is the whole rule there.
function mountMenu(fits, worn, { indoors, motionSick }) {
  const out = new Set(worn.map((ct) => ct.tag.slug));
  const boatOut = [...WATER_TRAVEL_SLUGS].some((slug) => out.has(slug));
  const rideOut = [...BOAT_CONFLICT_SLUGS].some((slug) => out.has(slug));
  const why = new Set();
  const options = fits.filter((ct) => {
    const slug = ct.tag.slug;
    if (indoors && STOWABLE_SLUGS.has(slug)) {
      why.add("there is no setting one up indoors");
      return false;
    }
    if (motionSick && (FAST_TRAVEL_SLUGS.has(slug) || WATER_TRAVEL_SLUGS.has(slug))) {
      why.add("your stomach won't have it");
      return false;
    }
    if ((boatOut && BOAT_CONFLICT_SLUGS.has(slug)) || (rideOut && WATER_TRAVEL_SLUGS.has(slug))) {
      why.add("you are either riding or poling");
      return false;
    }
    return true;
  });
  const note = why.size
    ? `Some of what you carry isn't offered here: ${[...why].join("; ")}.`
    : null;
  return { options, note };
}

// A dashed, named empty place. Its click menu lists the carried things that
// fit; nothing fits and it says so. `note` is the MOUNT row's reason for
// having left something out — never a silent omission.
function EmptyCell({ label, options, onPick, pending, span = 1, note = null }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <div
      className="equip-cell is-empty"
      style={span > 1 ? { gridColumn: `span ${span}` } : undefined}
    >
      <button
        ref={ref}
        type="button"
        className="equip-cell-face"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="equip-cell-name text-muted">{label}</span>
        <span className="equip-cell-fact text-muted">empty</span>
      </button>
      {open && (
        <ClickMenu triggerRef={ref} onClose={() => setOpen(false)} ariaLabel={label}>
          {options.length === 0 && !note ? (
            <span className="chat-quiet-line">Nothing you carry goes here.</span>
          ) : (
            options.map((ct) => (
              <button
                key={ct.id}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  onPick(ct);
                }}
              >
                {ct.tag.name}
                {ct.tag.twoHanded ? " (two hands)" : ""}
              </button>
            ))
          )}
          {note && <span className="chat-quiet-line">{note}</span>}
        </ClickMenu>
      )}
    </div>
  );
}

function WornCell({ ct, onUnequip, pending, span = 1, canAct }) {
  const line = fact(ct.tag);
  return (
    <div className="equip-cell" style={span > 1 ? { gridColumn: `span ${span}` } : undefined}>
      <div className="equip-cell-face">
        <span className="equip-cell-name">
          {ct.tag.name}
          {(ct.quantity ?? 1) > 1 ? <span className="text-muted"> ×{ct.quantity}</span> : null}
        </span>
        {line && <span className="equip-cell-fact text-muted">{line}</span>}
      </div>
      {canAct && (
        <button
          type="button"
          className="equip-cell-off"
          disabled={pending}
          onClick={onUnequip}
          aria-label={`Unequip ${ct.tag.name}`}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export default function EquipBoard({ characterTags, isSelf, indoors = false, motionSick = false }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  const equippable = characterTags.filter((ct) => ct.tag.equippable);
  const worn = equippable.filter((ct) => ct.equipped);
  const carried = equippable.filter((ct) => !ct.equipped);

  function toggle(ct) {
    if (!isSelf || !ct.id) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await toggleEquip(ct.id);
        if (res?.error) setError(res.error);
      } catch {
        setError("Could not reach the server. Nothing was changed.");
      }
    });
  }

  const melee = combineArmor(worn, "meleeArmor");
  const ballistic = combineArmor(worn, "ballisticArmor");
  const hands = handsUsed(worn);
  const freeHands = Math.max(0, WEAPON_HANDS - hands);

  if (equippable.length === 0) {
    return (
      <section className="panel p-4">
        <div className="section-title">
          <h2>Equipped</h2>
        </div>
        <p className="text-sm text-muted">
          You&apos;re not carrying anything that can be worn or readied.
        </p>
      </section>
    );
  }

  return (
    <section className="panel p-4 equip-board">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-title">Equipped</h2>
        <span className="mono text-sm text-muted">
          Melee: {armorWord(melee)} · Ballistic: {armorWord(ballistic)}
        </span>
      </div>

      {ROWS.map(({ slot, cells }) => {
        const inSlot = worn.filter((ct) => ct.tag.equipSlot === slot);
        const fits = carried.filter((ct) => ct.tag.equipSlot === slot);
        const layered = Boolean(LAYER_NAMES[slot]);
        let drawn;
        if (layered) {
          drawn = Array.from({ length: cells }, (_, i) => {
            const layer = i + 1;
            const ct = inSlot.find((row) => row.tag.equipLayer === layer);
            const label = `${LAYER_NAMES[slot][i]}`;
            return ct ? (
              <WornCell
                key={ct.id}
                ct={ct}
                onUnequip={() => toggle(ct)}
                pending={pending}
                canAct={isSelf}
              />
            ) : (
              <EmptyCell
                key={`${slot}-${layer}`}
                label={label}
                options={fits.filter((row) => row.tag.equipLayer === layer)}
                onPick={toggle}
                pending={pending}
              />
            );
          });
          // Anything worn at a layer this row has no cell for still gets one,
          // on the end. The catalog is the only thing that says how deep a
          // slot goes, and the catalog is synced separately from the code
          // (TAGS.md) — so between a deploy and its `db:sync-tags` a helm can
          // be worn at a layer that no longer exists. Drawing only the named
          // layers would leave it on the character's head with nothing to
          // take it off with.
          for (const ct of inSlot) {
            const layer = ct.tag.equipLayer;
            if (Number.isInteger(layer) && layer >= 1 && layer <= cells) continue;
            drawn.push(
              <WornCell
                key={ct.id}
                ct={ct}
                onUnequip={() => toggle(ct)}
                pending={pending}
                canAct={isSelf}
              />,
            );
          }
        } else if (slot === "WEAPON") {
          drawn = inSlot.map((ct) => (
            <WornCell
              key={ct.id}
              ct={ct}
              span={handsOf(ct.tag)}
              onUnequip={() => toggle(ct)}
              pending={pending}
              canAct={isSelf}
            />
          ));
          if (freeHands > 0) {
            drawn.push(
              <EmptyCell
                key="hands-free"
                label={freeHands === 1 ? "One hand" : `${freeHands} hands`}
                span={freeHands}
                options={fits.filter((row) => handsOf(row.tag) <= freeHands)}
                onPick={toggle}
                pending={pending}
              />,
            );
          }
        } else {
          const ct = inSlot[0];
          const menu =
            slot === "MOUNT"
              ? mountMenu(fits, worn, { indoors, motionSick })
              : { options: fits, note: null };
          drawn = ct ? (
            <WornCell
              key={ct.id}
              ct={ct}
              onUnequip={() => toggle(ct)}
              pending={pending}
              canAct={isSelf}
            />
          ) : (
            <EmptyCell
              key={slot}
              label={SLOT_TITLES[slot]}
              options={menu.options}
              note={menu.note}
              onPick={toggle}
              pending={pending}
            />
          );
        }
        // A ride nobody owns is not worth a row of dashes.
        if (slot === "MOUNT" && inSlot.length === 0 && fits.length === 0) return null;
        return (
          <div key={slot} className="equip-row">
            <span className="field-label equip-row-title">
              {SLOT_TITLES[slot]}
              {slot === "WEAPON" ? (
                <span className="mono" data-over={hands > WEAPON_HANDS ? "true" : undefined}>
                  {" "}
                  {hands}/{WEAPON_HANDS}
                </span>
              ) : null}
            </span>
            {/* The named layers, plus any stray one the loop above had to add
                on the end — a hand's cell spans two, so only a layered row can
                ever draw more cells than its own count. */}
            <div
              className="equip-cells"
              style={{
                gridTemplateColumns: `repeat(${layered ? Math.max(cells, drawn.length) : cells}, minmax(0, 1fr))`,
              }}
            >
              {drawn}
            </div>
            {/* A character who filled their hands before the three-hand rule
                existed can equip nothing at all until they put something
                down, and the refusal they would otherwise meet arrives from
                the server on an unrelated click. Say it here instead. */}
            {slot === "WEAPON" && hands > WEAPON_HANDS && (
              <span className="chat-quiet-line">
                You are holding more than {WEAPON_HANDS} hands&apos; worth — put something away
                before you ready anything else.
              </span>
            )}
          </div>
        );
      })}

      {(() => {
        const inSlot = worn.filter((ct) => ct.tag.equipSlot === "ACCESSORY");
        const fits = carried.filter((ct) => ct.tag.equipSlot === "ACCESSORY");
        if (inSlot.length === 0 && fits.length === 0) return null;
        return (
          <div className="equip-row">
            <span className="field-label equip-row-title">{SLOT_TITLES.ACCESSORY}</span>
            <div className="equip-cells equip-cells-wrap">
              {inSlot.map((ct) => (
                <WornCell
                  key={ct.id}
                  ct={ct}
                  onUnequip={() => toggle(ct)}
                  pending={pending}
                  canAct={isSelf}
                />
              ))}
              {isSelf && fits.length > 0 && (
                <EmptyCell label="Add" options={fits} onPick={toggle} pending={pending} />
              )}
            </div>
          </div>
        );
      })()}

      {/* Whatever is carried and fits nowhere drawn above: a slotless custom
          tag. Still equippable, still one click. */}
      {(() => {
        const stray = equippable.filter((ct) => !ct.tag.equipSlot);
        if (stray.length === 0) return null;
        return (
          <div className="equip-row">
            <span className="field-label equip-row-title">Other</span>
            <div className="equip-cells equip-cells-wrap">
              {stray.map((ct) =>
                ct.equipped ? (
                  <WornCell
                    key={ct.id}
                    ct={ct}
                    onUnequip={() => toggle(ct)}
                    pending={pending}
                    canAct={isSelf}
                  />
                ) : (
                  <div key={ct.id} className="equip-cell is-empty">
                    <button
                      type="button"
                      className="equip-cell-face"
                      disabled={pending || !isSelf}
                      onClick={() => toggle(ct)}
                    >
                      <span className="equip-cell-name text-muted">{ct.tag.name}</span>
                      <span className="equip-cell-fact text-muted">equip</span>
                    </button>
                  </div>
                ),
              )}
            </div>
          </div>
        );
      })()}

      <FormError>{error}</FormError>
    </section>
  );
}
