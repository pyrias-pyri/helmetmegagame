import { bumpBlood, bumpAccount, OBOL_SLUG } from "@lifeweb/db";
import { addToStack, dropCharacterTag, grantTagSlugs, addToRoomStack, dropRoomTag } from "@lifeweb/db/lib/tagWrites";
import { moveParty, InsufficientResourcesError } from "@lifeweb/db/lib/resourceTransfer";
import { INDESTRUCTIBLE_SLUGS } from "@lifeweb/db/lib/nuke";
import { UserError } from "@/lib/actionResult";

// The shared write primitives every player action and GM microaction moves
// tags and ⬢ through. This file also held REQUEST_EFFECTS — the per-type
// Undo/Edit table behind the Requests tab — until player actions stopped
// filing Requests and there was nothing left to undo. Every function below
// runs INSIDE a prisma transaction.

// --- shared primitives ------------------------------------------------

// Moves a party's balance by a signed delta and REFUSES rather than going
// negative — the write IS the check, a conditional update that only matches
// while the balance still covers the amount, safe under concurrent requests.
export async function moveResources(tx, party, delta) {
  try {
    await moveParty(tx, party, delta);
  } catch (err) {
    if (!(err instanceof InsufficientResourcesError)) throw err;
    if (party?.kind === "room") throw new UserError(`${party.name ?? "That room"} no longer holds ${err.amount} ⬢.`);
    throw new UserError(`${party?.name ?? "That character"} no longer has ${err.amount} ⬢.`);
  }
}

// `ctx` used to feed the Silo ledger; it is accepted and ignored so the
// call sites read the same. A party of a kind moveParty doesn't know (an old
// row naming a faction Silo) is a silent no-op.
export async function creditResources(tx, party, amount) {
  if (!party || !amount) return;
  await moveResources(tx, party, amount);
}

export async function debitResources(tx, party, amount) {
  if (!party || !amount) return;
  await moveResources(tx, party, -amount);
}

async function moveBlood(tx, delta) {
  if (!delta) return;
  await bumpBlood(tx, delta);
}

// --- stacks -----------------------------------------------------------
// A stackable tag is ONE CharacterTag row carrying a count, never N rows.
// These four are the only writers that know about quantity.

export { addToStack };

// Restores a CharacterTag from a snapshot taken before removal. Uses an
// upsert since the player may have re-acquired it elsewhere; the update
// branch INCREMENTS rather than overwrites, since the snapshot quantity is
// what this request took away, not the character's total.
export async function restoreCharacterTag(tx, characterId, snapshot) {
  const n = Math.max(1, Math.trunc(snapshot.quantity ?? 1));
  const existing = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId, tagId: snapshot.tagId } },
  });
  if (existing) {
    return tx.characterTag.update({
      where: { id: existing.id },
      data: {
        quantity: existing.quantity + n,
        expiresTurn: snapshot.expiresTurn ?? null,
      },
    });
  }
  return tx.characterTag.create({
    data: {
      characterId,
      tagId: snapshot.tagId,
      source: snapshot.source ?? "GM_GRANT",
      expiresTurn: snapshot.expiresTurn ?? null,
      quantity: n,
    },
  });
}

export { dropCharacterTag };
export { grantTagSlugs };
export { addToRoomStack, dropRoomTag };

// --- party-shaped tag moves ------------------------------------------
// A TRANSFER_TAG end is a character or a Room stash (CARRY.md); these two
// branch on `party.kind` so the undo never has to.

// Takes `quantity` of a tag off a party. A room's decrement is the check
// (two players can pull the same stack in the same tick); a character's
// holding was snapshotted when the request was filed.
export async function takeTagFrom(tx, party, tagId, quantity) {
  if (!party?.id || !tagId) return;
  if (party.kind === "room") {
    const ok = await dropRoomTag(tx, party.id, tagId, quantity);
    if (!ok) throw new UserError(`${party.name ?? "That room"} no longer holds that.`);
    return;
  }
  await dropCharacterTag(tx, party.id, tagId, quantity);
}

// Puts a snapshot { tagId, quantity, expiresTurn, source } back on a party.
// Both branches INCREMENT and re-assert the snapshot's clock, so a stash-
// then-undo can't launder an expiry.
export async function giveTagTo(tx, party, snapshot) {
  if (!party?.id || !snapshot?.tagId) return;
  if (party.kind === "room") {
    // The Spillway. Nothing is written, so nothing can be fished back out —
    // which is also why the TRANSFER_TAG undo below skips its `takeTagFrom`
    // on a destroyed line rather than throwing "no longer holds that".
    //
    // Except for what the trough cannot eat. The slug lookup only runs on this
    // branch, which is two rooms in the whole map, so the ordinary transfer
    // path is untouched.
    if (party.destroysContents) {
      const tag = await tx.tag.findUnique({
        where: { id: snapshot.tagId },
        select: { slug: true },
      });
      if (!INDESTRUCTIBLE_SLUGS.has(tag?.slug)) return;
    }
    await addToRoomStack(tx, party.id, snapshot.tagId, snapshot.quantity ?? 1, {
      expiresTurn: snapshot.expiresTurn ?? null,
    });
    return;
  }
  await restoreCharacterTag(tx, party.id, snapshot);
}


