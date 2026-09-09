"use server";

import { revalidatePath } from "next/cache";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { after } from "next/server";
import { prisma, rollDie, Prisma } from "@lifeweb/db";
import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import { TagOpError, validateTagOps } from "@lifeweb/db/lib/tagOps";
import { resolveParty, partyLabel } from "@lifeweb/db/lib/parties";
import { postMessageBatched } from "@lifeweb/db/lib/discordRest";
import { getGmSession, killCharacter, listGuildMembers, sendDm } from "@/lib/discordGuild";
import { dropCharacterTag } from "@/lib/tagEffects";
import { requireReason } from "@/lib/requests";
import { UserError, guarded } from "@/lib/actionResult";
import { deleteActionRestoringTurn, MOVE_LOCK_TTL_MS, lockIsLive } from "@/lib/moveEconomy";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { TAG_CHIP_FIELDS } from "@/lib/referenceData";
import { MOVE_REVIEW_LABELS, moveKindLabel, rollLabel } from "@/lib/moves";
import {
  MOVE_INCLUDE,
  STAGED_EFFECT_INCLUDE,
  STAGED_MESSAGE_INCLUDE,
  CAVING_ROLL_INCLUDE,
  declaredLabel,
  moveRow,
  paidLabel,
  stagedEffectRow,
  stagedMessageRow,
  cavingRollRow,
  tagsByIdFor,
} from "@/lib/moveRows";
import { DM_KIND } from "@lifeweb/db/lib/dmKinds";

// Server actions for the adjudication workspace (/gm/turns). Staged rows
// apply and deliver only at the turn-end push (db/lib/stagedPush.js);
// exceptions that act now: Reject, the FEED_PERSON kill, Request review.

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new UserError("Not authenticated.");
  if (!gm) throw new UserError("Not authorized.");
  return session;
}

// Fat-finger guard, not a player clamp — GM-staged payouts sanction past the
// player-side ±20.
const MAX_STAGED_RESOURCES = 500;
const MAX_STAGED_TAG_POINTS = 100;

async function requireOpenTurn() {
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) throw new UserError("No turn is open.");
  return openTurn;
}

// Turn-boundary race: a row created around the cron can land on a turn the
// push already swept. Re-read and retarget to the new open turn.
async function retargetIfTurnClosed(model, ids, turnId) {
  const still = await prisma.turn.findFirst({ where: { id: turnId, status: "OPEN" } });
  if (still) return;
  const fresh = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!fresh) return;
  await model.updateMany({ where: { id: { in: ids } }, data: { turnId: fresh.id } });
}

function normalizeMessageContent(raw) {
  const content = raw?.toString().trim() ?? "";
  if (!content) throw new UserError("Write the message first.");
  if (content.length > GM_MESSAGE_MAX_LENGTH) {
    throw new UserError(`Messages cap at ${GM_MESSAGE_MAX_LENGTH} characters.`);
  }
  return content;
}

async function normalizeRecipients(recipientCharacterIds) {
  const ids = [...new Set((recipientCharacterIds ?? []).filter(Boolean))];
  if (!ids.length) throw new UserError("Pick at least one recipient.");
  const found = await prisma.character.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) throw new UserError("One of those characters no longer exists.");
  return ids;
}

async function createStagedMessageImpl({ kind, content, recipientCharacterIds, moveId, cavingRollId, zoneId }) {
  const session = await requireGm();
  if (!["PRIVATE", "PUBLIC"].includes(kind)) throw new UserError("Unknown message kind.");
  const text = normalizeMessageContent(content);
  const openTurn = await requireOpenTurn();

  const recipients = kind === "PRIVATE" ? await normalizeRecipients(recipientCharacterIds) : [];
  if (kind === "PUBLIC" && !zoneId) throw new UserError("Pick a zone.");

  const row = await prisma.stagedMessage.create({
    data: {
      turnId: openTurn.id,
      moveId: moveId || null,
      cavingRollId: cavingRollId || null,
      kind,
      content: text,
      zoneId: (kind === "PUBLIC" && zoneId) || null,
      createdByDiscordUserId: session.discordUserId,
      recipients: { create: recipients.map((characterId) => ({ characterId })) },
    },
  });
  await retargetIfTurnClosed(prisma.stagedMessage, [row.id], openTurn.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_message_created",
      details: {
        stagedMessageId: row.id,
        kind,
        moveId: moveId || null,
        cavingRollId: cavingRollId || null,
        recipients: recipients.length,
      },
    },
  });

  return { id: row.id };
}

async function updateStagedMessageImpl({ stagedMessageId, content, recipientCharacterIds, zoneId }) {
  const session = await requireGm();
  const existing = await prisma.stagedMessage.findUnique({ where: { id: stagedMessageId ?? "" } });
  if (!existing) throw new UserError("That staged message is gone.");
  if (existing.sentAt) throw new UserError("That message already went out — it can't be edited.");

  const text = normalizeMessageContent(content);
  const recipients = existing.kind === "PRIVATE" ? await normalizeRecipients(recipientCharacterIds) : null;
  if (existing.kind === "PUBLIC" && !zoneId) throw new UserError("Pick a zone.");

  await prisma.$transaction(async (tx) => {
    // Conditional on sentAt: an edit racing the push loses cleanly.
    const claimed = await tx.stagedMessage.updateMany({
      where: { id: existing.id, sentAt: null },
      data: {
        content: text,
        ...(existing.kind === "PUBLIC" ? { zoneId: zoneId || null } : {}),
      },
    });
    if (!claimed.count) throw new UserError("That message just went out — it can't be edited.");
    if (recipients) {
      await tx.stagedMessageRecipient.deleteMany({ where: { stagedMessageId: existing.id } });
      await tx.stagedMessageRecipient.createMany({
        data: recipients.map((characterId) => ({ stagedMessageId: existing.id, characterId })),
      });
    }
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_message_updated",
      details: { stagedMessageId: existing.id },
    },
  });

  return {};
}

async function deleteStagedMessageImpl({ stagedMessageId }) {
  const session = await requireGm();
  const existing = await prisma.stagedMessage.findUnique({ where: { id: stagedMessageId ?? "" } });
  if (!existing) return {};
  if (existing.sentAt) throw new UserError("That message already went out.");

  await prisma.stagedMessage.delete({ where: { id: existing.id } });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_message_deleted",
      details: { stagedMessageId: existing.id, kind: existing.kind, content: existing.content.slice(0, 200) },
    },
  });

  return {};
}

// Retries a sent-but-partially-failed staged message. PRIVATE re-sends only
// the failed recipients; PUBLIC re-posts to the summary channel. A clean
// resend clears deliveryFailures with Prisma.DbNull, not JS null.
async function resendStagedMessageImpl({ stagedMessageId }) {
  const session = await requireGm();
  const existing = await prisma.stagedMessage.findUnique({
    where: { id: stagedMessageId ?? "" },
    include: {
      recipients: { include: { character: { select: { id: true, name: true, discordUserId: true } } } },
      zone: { select: { discordSummaryChannelId: true } },
    },
  });
  if (!existing) throw new UserError("That staged message is gone.");
  if (!existing.sentAt) throw new UserError("That message hasn't gone out yet.");
  const priorFailures = Array.isArray(existing.deliveryFailures) ? existing.deliveryFailures : [];
  if (!priorFailures.length) throw new UserError("Nothing failed on that message.");

  let stillFailing = [];
  let resent = 0;

  if (existing.kind === "PRIVATE") {
    const failedIds = new Set(priorFailures.map((f) => f.characterId).filter(Boolean));
    const targets = existing.recipients
      .map((r) => r.character)
      .filter((c) => failedIds.has(c.id));
    for (const target of targets) {
      try {
        await sendDm(target.discordUserId, existing.content, {
          authorDiscordUserId: existing.createdByDiscordUserId,
          source: "staged_push",
          // A turn result is GM-authored prose, just delivered in bulk.
          kind: DM_KIND.CONVERSATION,
        });
        resent += 1;
      } catch (err) {
        stillFailing.push({ characterId: target.id, name: target.name, error: String(err?.message ?? err) });
      }
    }
  } else {
    const channelId = existing.zone?.discordSummaryChannelId;
    if (!channelId) throw new UserError("That zone has no summary channel configured.");
    try {
      // Batched like the push's own loop (ADJUDICATION.md §1).
      await postMessageBatched(channelId, existing.content);
      resent += 1;
    } catch (err) {
      stillFailing = [{ error: String(err?.message ?? err) }];
    }
  }

  await prisma.stagedMessage.update({
    where: { id: existing.id },
    data: { deliveryFailures: stillFailing.length ? stillFailing : Prisma.DbNull },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_message_resent",
      details: { stagedMessageId: existing.id, resent, stillFailing: stillFailing.length },
    },
  });

  return { resent, stillFailing };
}

// The composer stages presence ops only (add/remove). Patch and equip belong
// to the Dev Panel's full editor.
function normalizeStagedOps(tagOps) {
  const ops = Array.isArray(tagOps) ? tagOps : [];
  return ops.map((op) => {
    if (!op?.tagId || !["add", "remove"].includes(op.op)) {
      throw new UserError("Only add and remove can be staged here.");
    }
    const quantity = op.quantity == null ? null : Number.parseInt(op.quantity, 10);
    if (quantity != null && (!Number.isInteger(quantity) || quantity < 1)) {
      throw new UserError("Quantities must be whole numbers of at least 1.");
    }
    return { tagId: op.tagId, op: op.op, ...(quantity != null ? { quantity } : {}) };
  });
}

function normalizeStagedResources(raw) {
  if (raw === "" || raw == null) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new UserError("Resources must be a number.");
  if (Math.abs(n) > MAX_STAGED_RESOURCES) {
    throw new UserError(`That's over the ±${MAX_STAGED_RESOURCES} ⬢ sanity cap — stage it in parts if you mean it.`);
  }
  return n;
}

function normalizeStagedTagPoints(raw) {
  if (raw === "" || raw == null) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new UserError("Tag points must be a number.");
  if (Math.abs(n) > MAX_STAGED_TAG_POINTS) {
    throw new UserError(`That's over the ±${MAX_STAGED_TAG_POINTS} tag-point sanity cap.`);
  }
  return n;
}

// The composer's "Relocate to" select. Raw relocation — no Action row, Move
// cost, adjacency check or walk cooldown (deliberately not
// performLocationMove). The push writes Character.zoneId off the Location, so
// only the Location id is staged.
async function normalizeStagedLocation(raw) {
  const locationId = raw?.toString().trim() || null;
  if (!locationId) return null;
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) throw new UserError("That location no longer exists.");
  return locationId;
}

async function createStagedEffectsImpl({ targetCharacterIds, moveId, cavingRollId, resources, tagPoints, tagOps, locationId }) {
  const session = await requireGm();
  const targets = [...new Set((targetCharacterIds ?? []).filter(Boolean))];
  if (!targets.length) throw new UserError("Pick at least one target.");

  const delta = normalizeStagedResources(resources);
  const points = normalizeStagedTagPoints(tagPoints);
  const ops = normalizeStagedOps(tagOps);
  const place = await normalizeStagedLocation(locationId);
  if (!delta && !points && !ops.length && !place) {
    throw new UserError("Stage a resource, tag-point, tag change, or relocation.");
  }

  // Validated now with the same engine the push runs, so they can't disagree.
  if (ops.length) {
    const tags = await prisma.tag.findMany({ where: { id: { in: ops.map((o) => o.tagId) } } });
    try {
      validateTagOps(ops, new Map(tags.map((t) => [t.id, t])), new Set());
    } catch (err) {
      if (err instanceof TagOpError) throw new UserError(err.message);
      throw err;
    }
  }

  const found = await prisma.character.findMany({ where: { id: { in: targets } }, select: { id: true } });
  if (found.length !== targets.length) throw new UserError("One of those characters no longer exists.");

  const openTurn = await requireOpenTurn();
  const batchId = targets.length > 1 ? crypto.randomUUID() : null;
  const payload = {
    ...(delta ? { resources: delta } : {}),
    ...(points ? { tagPoints: points } : {}),
    ...(ops.length ? { tagOps: ops } : {}),
    ...(place ? { locationId: place } : {}),
  };

  const created = await prisma.$transaction(
    targets.map((targetCharacterId) =>
      prisma.stagedEffect.create({
        data: {
          turnId: openTurn.id,
          moveId: moveId || null,
          cavingRollId: cavingRollId || null,
          targetCharacterId,
          createdByDiscordUserId: session.discordUserId,
          batchId,
          payload,
        },
        select: { id: true },
      }),
    ),
  );
  await retargetIfTurnClosed(prisma.stagedEffect, created.map((r) => r.id), openTurn.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effects_created",
      details: { batchId, targets: targets.length, moveId: moveId || null, payload },
    },
  });

  return { count: created.length, batchId };
}

// A staged character-to-character transfer. Separate from
// createStagedEffectsImpl because the balance check runs against live
// balances at stage time, not a mint/burn delta.
async function createStagedTransferImpl({
  fromKey,
  toKey,
  amount: rawAmount,
  moveId,
  cavingRollId,
}) {
  const session = await requireGm();
  const amount = Number.parseInt(rawAmount, 10);
  if (!Number.isInteger(amount) || amount < 1) throw new UserError("Amount must be a positive whole number.");
  if (amount > MAX_STAGED_RESOURCES) {
    throw new UserError(`That's over the ±${MAX_STAGED_RESOURCES} ⬢ sanity cap — stage it in parts if you mean it.`);
  }

  const [from, to] = await Promise.all([resolveParty(prisma, fromKey), resolveParty(prisma, toKey)]);
  if (!from) throw new UserError("Unknown source.");
  if (!to) throw new UserError("Unknown recipient.");
  if (from.kind === to.kind && from.id === to.id) throw new UserError("Source and recipient are the same.");
  if (amount > from.balance) throw new UserError(`${partyLabel(from)} only has ${from.balance} ⬢.`);

  const openTurn = await requireOpenTurn();
  const targetCharacterId = to.kind === "character" ? to.id : from.kind === "character" ? from.id : null;
  // Snapshotted into the payload, never re-derived at push time.
  const payload = {
    transfer: {
      from: { kind: from.kind, id: from.id, name: from.name },
      to: { kind: to.kind, id: to.id, name: to.name },
      amount,
    },
  };

  const created = await prisma.stagedEffect.create({
    data: {
      turnId: openTurn.id,
      moveId: moveId || null,
      cavingRollId: cavingRollId || null,
      targetCharacterId,
      createdByDiscordUserId: session.discordUserId,
      payload,
    },
    select: { id: true },
  });
  await retargetIfTurnClosed(prisma.stagedEffect, [created.id], openTurn.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effects_created",
      details: { targets: 1, moveId: moveId || null, payload },
    },
  });

  return { id: created.id };
}

async function updateStagedEffectImpl({ stagedEffectId, resources, tagPoints, tagOps, locationId }) {
  const session = await requireGm();
  const existing = await prisma.stagedEffect.findUnique({ where: { id: stagedEffectId ?? "" } });
  if (!existing) throw new UserError("That staged effect is gone.");
  if (existing.appliedAt) throw new UserError("That effect already applied — it can't be edited.");

  const delta = normalizeStagedResources(resources);
  const points = normalizeStagedTagPoints(tagPoints);
  const ops = normalizeStagedOps(tagOps);
  const place = await normalizeStagedLocation(locationId);
  if (!delta && !points && !ops.length && !place) {
    throw new UserError("Stage a resource, tag-point, tag change, or relocation.");
  }
  if (ops.length) {
    const tags = await prisma.tag.findMany({ where: { id: { in: ops.map((o) => o.tagId) } } });
    try {
      validateTagOps(ops, new Map(tags.map((t) => [t.id, t])), new Set());
    } catch (err) {
      if (err instanceof TagOpError) throw new UserError(err.message);
      throw err;
    }
  }

  // Editing detaches the row from its batch — it no longer matches siblings.
  const claimed = await prisma.stagedEffect.updateMany({
    where: { id: existing.id, appliedAt: null },
    data: {
      payload: {
        ...(delta ? { resources: delta } : {}),
        ...(points ? { tagPoints: points } : {}),
        ...(ops.length ? { tagOps: ops } : {}),
        ...(place ? { locationId: place } : {}),
      },
      batchId: null,
    },
  });
  if (!claimed.count) throw new UserError("That effect just applied — it can't be edited.");

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effect_updated",
      details: { stagedEffectId: existing.id },
    },
  });

  return {};
}

async function deleteStagedEffectImpl({ stagedEffectId, batchId }) {
  const session = await requireGm();

  if (batchId) {
    const { count } = await prisma.stagedEffect.deleteMany({ where: { batchId, appliedAt: null } });
    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "staged_effects_deleted",
        details: { batchId, count },
      },
    });
    return { count };
  }

  const existing = await prisma.stagedEffect.findUnique({ where: { id: stagedEffectId ?? "" } });
  if (!existing) return { count: 0 };
  if (existing.appliedAt) throw new UserError("That effect already applied.");
  await prisma.stagedEffect.delete({ where: { id: existing.id } });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effects_deleted",
      details: { stagedEffectId: existing.id, count: 1 },
    },
  });
  return { count: 1 };
}

// Moves staged rows a resolved turn's push never got to onto the open turn.
async function retargetMissedStagingImpl({ effectIds = [], messageIds = [] }) {
  const session = await requireGm();
  const openTurn = await requireOpenTurn();

  const [effects, messages] = await Promise.all([
    effectIds.length
      ? prisma.stagedEffect.updateMany({
          where: { id: { in: effectIds }, appliedAt: null },
          data: { turnId: openTurn.id },
        })
      : { count: 0 },
    messageIds.length
      ? prisma.stagedMessage.updateMany({
          where: { id: { in: messageIds }, sentAt: null },
          data: { turnId: openTurn.id, deliveryFailures: null },
        })
      : { count: 0 },
  ]);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staging_retargeted",
      details: { toTurnNumber: openTurn.number, effects: effects.count, messages: messages.count },
    },
  });

  return { effects: effects.count, messages: messages.count };
}

async function lockHolderName(discordUserId) {
  if (!discordUserId) return "Another GM";
  const members = await listGuildMembers().catch(() => []);
  return members.find((m) => m.id === discordUserId)?.username ?? "Another GM";
}

// One conditional write: nobody holds it, I already hold it, or the TTL lapsed.
async function claimMoveLockImpl({ actionId }) {
  const session = await requireGm();

  const { count } = await prisma.action.updateMany({
    where: {
      id: actionId ?? "",
      OR: [
        { lockedByDiscordUserId: null },
        { lockedByDiscordUserId: session.discordUserId },
        { lockExpiresAt: null },
        { lockExpiresAt: { lte: new Date() } },
      ],
    },
    data: {
      lockedByDiscordUserId: session.discordUserId,
      lockExpiresAt: new Date(Date.now() + MOVE_LOCK_TTL_MS),
    },
  });

  if (!count) {
    const action = await prisma.action.findUnique({ where: { id: actionId ?? "" } });
    if (!action) throw new UserError("Move not found.");
    const holder = await lockHolderName(action.lockedByDiscordUserId);
    throw new UserError(`${holder} is adjudicating this Move.`);
  }

  return { ttlMs: MOVE_LOCK_TTL_MS };
}

async function refreshMoveLockImpl({ actionId }) {
  const session = await requireGm();
  const { count } = await prisma.action.updateMany({
    where: { id: actionId ?? "", lockedByDiscordUserId: session.discordUserId },
    data: { lockExpiresAt: new Date(Date.now() + MOVE_LOCK_TTL_MS) },
  });
  if (!count) throw new UserError("Your hold on this Move expired.");
  return {};
}

async function releaseMoveLockImpl({ actionId }) {
  const session = await requireGm();
  await prisma.action.updateMany({
    where: { id: actionId ?? "", lockedByDiscordUserId: session.discordUserId },
    data: { lockedByDiscordUserId: null, lockExpiresAt: null },
  });
  return {};
}

// A Gambit always carries a fresh roll, a Routine never does, so switching
// kind rewrites the dice rather than leaving a stale number.
function normalizeEdits(action, edits, characterTags, hungerStreak) {
  const data = {};

  const kind = ["GAMBIT", "ROUTINE", "LABOR"].includes(edits.moveKind) ? edits.moveKind : action.moveKind;
  if (kind !== action.moveKind) {
    data.moveKind = kind;
    if (kind === "ROUTINE") {
      data.diceRoll = null;
      data.diceModifier = null;
    } else {
      // Rolled from the character's current tags/hungerStreak, not whatever
      // was true when the player submitted.
      data.diceRoll = rollDie();
      data.diceModifier = gambitModifierTotal(characterTags, { hungerStreak });
    }
  }

  data.resultMessage = edits.resultMessage?.toString().trim() || null;
  return data;
}

// mode: "save" keeps edits and leaves it open; "solve" marks SOLVED (nothing
// applies until the push); "unsolve" goes back to OPEN.
async function resolveMoveImpl({ actionId, mode, edits = {} }) {
  const session = await requireGm();
  if (!["save", "solve", "unsolve"].includes(mode)) throw new UserError("Unknown mode.");

  const action = await prisma.action.findUnique({
    where: { id: actionId ?? "" },
    include: { character: { include: { tags: { include: { tag: true } } } } },
  });
  if (!action) throw new UserError("Move not found.");
  if (lockIsLive(action) && action.lockedByDiscordUserId !== session.discordUserId) {
    throw new UserError(`${await lockHolderName(action.lockedByDiscordUserId)} is adjudicating this Move.`);
  }

  // Check and transition in one statement, stopping two GMs from silently
  // overwriting each other's verdicts.
  const result = await prisma.$transaction(async (tx) => {
    // Every branch renews the lock rather than clearing it — release happens
    // separately (unmount, pagehide beacon, or TTL lapse in moveEconomy.js).
    const renewedLock = { lockedByDiscordUserId: session.discordUserId, lockExpiresAt: new Date(Date.now() + MOVE_LOCK_TTL_MS) };

    if (mode === "unsolve") {
      const claimed = await tx.action.updateMany({
        where: { id: actionId ?? "", moveReviewStatus: "SOLVED" },
        data: {
          moveReviewStatus: "OPEN",
          reviewedAt: null,
          reviewedByDiscordUserId: null,
          ...renewedLock,
        },
      });
      if (!claimed.count) throw new UserError("That Move isn't solved.");
      return { status: "OPEN", note: "Reopened." };
    }

    const data = normalizeEdits(action, edits, action.character.tags, action.character.hungerStreak);

    if (mode === "save") {
      // Save keeps the edits and leaves status wherever it was.
      await tx.action.update({
        where: { id: actionId },
        data: { ...data, ...renewedLock },
      });
      return { status: action.moveReviewStatus, note: "Saved." };
    }

    // Solve: nothing applies now, it lands at the push. Conditional claim
    // stops two GMs racing from a stale view.
    const claimed = await tx.action.updateMany({
      where: { id: actionId ?? "", moveReviewStatus: { not: "SOLVED" } },
      data: { moveReviewStatus: "SOLVED" },
    });
    if (!claimed.count) {
      const fresh = await tx.action.findUnique({ where: { id: actionId } });
      if (fresh?.reviewedByDiscordUserId === session.discordUserId) {
        throw new UserError("You already solved this Move — it's marked and will push.");
      }
      throw new UserError(`${await lockHolderName(fresh?.reviewedByDiscordUserId)} already solved this Move.`);
    }

    await tx.action.update({
      where: { id: actionId },
      data: {
        ...data,
        reviewedAt: new Date(),
        reviewedByDiscordUserId: session.discordUserId,
        ...renewedLock,
      },
    });
    return { status: "SOLVED", note: "Staged for the push." };
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: `move_${mode}`,
      targetCharacterId: action.characterId,
      details: { actionId, note: result.note },
    },
  });

  return result;
}

// "Mark resolved" on a TROUBLE roll — a one-way stamp, no unsolve. Idempotent
// for a QUIET/FIND row (already resolved at creation).
async function resolveCavingRollImpl({ cavingRollId, gmNotes: rawNotes }) {
  const session = await requireGm();
  const roll = await prisma.cavingRoll.findUnique({ where: { id: cavingRollId ?? "" } });
  if (!roll) throw new UserError("Caving roll not found.");

  const gmNotes = rawNotes?.toString().trim() || null;
  await prisma.cavingRoll.update({
    where: { id: roll.id },
    data: {
      resolvedAt: roll.resolvedAt ?? new Date(),
      resolvedByDiscordUserId: session.discordUserId,
      gmNotes,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "caving_roll_resolved",
      targetCharacterId: roll.characterId,
      details: { cavingRollId: roll.id, die: roll.die, kind: roll.kind },
    },
  });

  return { status: "RESOLVED" };
}

// "Reject" on the desk. Deletes the Action outright, since the turn-economy
// checks look for any Action on the open turn — only deletion frees the
// player to act again. Staged rows detach via SetNull.
async function rejectMoveImpl({ actionId, reason: rawReason }) {
  const session = await requireGm();
  const reason = requireReason(rawReason);

  const action = await prisma.action.findUnique({ where: { id: actionId }, include: { character: true } });
  if (!action) throw new UserError("Move not found.");
  if (lockIsLive(action) && action.lockedByDiscordUserId !== session.discordUserId) {
    throw new UserError(`${await lockHolderName(action.lockedByDiscordUserId)} is adjudicating this Move.`);
  }

  // A lesson's partner Moves may go with this one (db/lib/lessons.js); the
  // learners it strands are told after commit.
  let lessonDms = [];
  await prisma.$transaction(async (tx) => {
    lessonDms = await deleteActionRestoringTurn(tx, action);
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "move_rejected",
        targetCharacterId: action.characterId,
        reason,
        details: {
          actionId,
          description: action.description,
          moveKind: action.moveKind,
          appliedEffects: action.appliedEffects ?? null,
        },
      },
    });
  for (const dm of lessonDms) {
    after(() => sendDm(dm.discordUserId, dm.content).catch((err) => console.error("Lesson cancel DM failed:", err)));
  }
  });

  // Sent directly, not deferred to the push — a freed turn the player
  // doesn't know about is a wasted day.
  let deliveryFailed = false;
  try {
    await sendDm(
      action.character.discordUserId,
      `Your Move was returned to you — you can act again this turn.\n${reason}`,
      // The GM's typed reason rides in the body, so this is a person
      // writing even though the wrapper around it is canned.
      { authorDiscordUserId: session.discordUserId, source: "move_unlock", kind: DM_KIND.CONVERSATION },
    );
  } catch (err) {
    console.error(`Failed to DM the reject reason to ${action.character.discordUserId}:`, err);
    deliveryFailed = true;
  }

  revalidatePath("/character");
  return { description: action.description, deliveryFailed };
}

async function getCharacterInspectorImpl({ characterId }) {
  await requireGm();
  const character = await prisma.character.findUnique({
    where: { id: characterId ?? "" },
    include: {
      faction: { select: { id: true, name: true } },
      zone: { select: { name: true } },
      location: { select: { name: true } },
      tags: {
        select: { tagId: true, quantity: true, expiresTurn: true, equipped: true, tag: { select: TAG_CHIP_FIELDS } },
      },
    },
  });
  if (!character) throw new UserError("Character not found.");

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const acted = openTurn
    ? Boolean(await prisma.action.findFirst({ where: { characterId: character.id, turnId: openTurn.id }, select: { id: true } }))
    : false;

  return {
    id: character.id,
    name: character.name,
    status: character.status,
    discordUserId: character.discordUserId,
    roleTitle: character.roleTitle ?? null,
    factionId: character.faction?.id ?? null,
    factionName: character.faction?.name ?? null,
    isLeader: character.isLeader,
    // Zone · Location, because Character.locationId is where a ruling
    // actually happens — a placed structure, a stash, a fight are all
    // Location-grain facts (MAP.md §1). Same shape moveRows.js now carries.
    locationLabel: character.location?.name
      ? `${character.zone?.name ?? "?"} · ${character.location.name}`
      : character.zone?.name || "Unassigned",
    resources: character.resources,
    tagPoints: character.tagPoints,
    gambitModifier: gambitModifierTotal(character.tags, { hungerStreak: character.hungerStreak }),
    acted,
    currentTurnNumber: openTurn?.number ?? null,
    tags: character.tags.map((ct) => ({
      tagId: ct.tagId,
      quantity: ct.quantity,
      expiresTurn: ct.expiresTurn,
      equipped: ct.equipped,
      tag: ct.tag,
    })),
  };
}

const ARCHIVE_SLICE = 30;

// Keyset-paged, same shape as getDmThreadPage: newest-first cursor, reversed
// to reading order. ArchiveView's "Load older" bumps beforeMs/beforeId back.
async function getArchiveSliceImpl({ characterId, beforeMs, beforeId }) {
  await requireGm();
  const where = { characterId: characterId ?? "" };
  if (beforeMs) {
    const beforeDate = new Date(Number(beforeMs));
    where.OR = [
      { sentAt: { lt: beforeDate } },
      beforeId ? { sentAt: beforeDate, id: { lt: String(beforeId) } } : undefined,
    ].filter(Boolean);
  }
  const rows = await prisma.archiveEntry.findMany({
    where,
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    take: ARCHIVE_SLICE + 1,
  });
  const hasMore = rows.length > ARCHIVE_SLICE;
  // Wrapped in an object: guarded() spreads the payload, so a bare array
  // would come back as indices.
  return {
    entries: rows
      .slice(0, ARCHIVE_SLICE)
      .reverse()
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        content: e.content,
        characterName: e.characterName,
        concealedAlias: e.concealedAlias,
        zoneName: e.zoneName,
        turnNumber: e.turnNumber,
        turnPhase: e.turnPhase,
        sentAt: e.sentAt.toISOString(),
      })),
    hasMore,
  };
}

// The Inspector's DMs tab uses web/app/(app)/gm/messages/actions.js
// #getDmThreadPage and #sendGmDm directly, the same path /gm/messages uses.

const CONTEXT_SLICE = 30;

// The scene around one archived line: ~30 messages before/after in the same
// Discord channel/thread.
async function getArchiveContextImpl({ archiveEntryId }) {
  await requireGm();
  const anchor = await prisma.archiveEntry.findUnique({ where: { id: archiveEntryId ?? "" } });
  if (!anchor) throw new UserError("That transcript row is gone.");

  // Two ways to identify "the same channel": the snapshot column, and the
  // legacy zoneId/channelKind/threadName triple for pre-backfill rows.
  const identity = [];
  if (anchor.discordChannelId) identity.push({ discordChannelId: anchor.discordChannelId });
  if (anchor.zoneId != null || anchor.channelKind != null) {
    identity.push({ zoneId: anchor.zoneId, channelKind: anchor.channelKind, threadName: anchor.threadName });
  }
  if (!identity.length) throw new UserError("That row carries no channel identity.");

  const channelWhere = { kind: "MESSAGE", OR: identity };

  const [before, after] = await Promise.all([
    prisma.archiveEntry.findMany({
      where: {
        AND: [
          channelWhere,
          { OR: [{ sentAt: { lt: anchor.sentAt } }, { sentAt: anchor.sentAt, id: { lt: anchor.id } }] },
        ],
      },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: CONTEXT_SLICE,
    }),
    prisma.archiveEntry.findMany({
      where: {
        AND: [
          channelWhere,
          { OR: [{ sentAt: { gt: anchor.sentAt } }, { sentAt: anchor.sentAt, id: { gt: anchor.id } }] },
        ],
      },
      orderBy: [{ sentAt: "asc" }, { id: "asc" }],
      take: CONTEXT_SLICE,
    }),
  ]);

  // Server-only env, so the URL is built here, never client-side.
  const guildId = process.env.DISCORD_GUILD_ID || null;
  const channelLabel =
    [anchor.zoneName, anchor.threadName].filter(Boolean).join(" · ") || anchor.channelKind || "unknown channel";
  const jumpUrl =
    guildId && anchor.discordChannelId && anchor.discordMessageId
      ? `https://discord.com/channels/${guildId}/${anchor.discordChannelId}/${anchor.discordMessageId}`
      : null;

  const entries = [...before.reverse(), anchor, ...after].map((e) => ({
    id: e.id,
    content: e.content,
    characterName: e.characterName,
    concealedAlias: e.concealedAlias,
    turnNumber: e.turnNumber,
    sentAt: e.sentAt.toISOString(),
  }));

  return { anchorId: anchor.id, channelLabel, jumpUrl, entries };
}

// The History lens, one resolved turn at a time, loaded on demand so the
// open turn's desk and its 45s router.refresh() never pay for it. Uses the
// same mappers as page.js (web/lib/moveRows.js).
async function getMoveHistoryImpl({ turnId }) {
  await requireGm();
  const id = turnId?.toString().trim() ?? "";
  if (!id) throw new UserError("No turn specified.");

  const turn = await prisma.turn.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!turn) throw new UserError("That turn no longer exists.");
  if (turn.status !== "RESOLVED") throw new UserError("That turn hasn't been pushed yet.");

  const [actions, cavingRolls, members, stagingLocations, openTurn] = await Promise.all([
    prisma.action.findMany({ where: { turnId: id }, orderBy: { createdAt: "desc" }, include: MOVE_INCLUDE }),
    prisma.cavingRoll.findMany({ where: { turnId: id }, orderBy: { createdAt: "desc" }, include: CAVING_ROLL_INCLUDE }),
    listGuildMembers(),
    prisma.location.findMany({
      orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      select: { id: true, name: true, zoneId: true, zone: { select: { name: true } } },
    }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } }),
  ]);

  const moveIds = actions.map((a) => a.id);
  const cavingIds = cavingRolls.map((c) => c.id);
  // Staged rows attach to either a Move or a Caving roll.
  const [stagedEffects, stagedMessages] =
    moveIds.length || cavingIds.length
      ? await Promise.all([
          prisma.stagedEffect.findMany({
            where: { OR: [{ moveId: { in: moveIds } }, { cavingRollId: { in: cavingIds } }] },
            orderBy: { createdAt: "asc" },
            include: STAGED_EFFECT_INCLUDE,
          }),
          prisma.stagedMessage.findMany({
            where: { OR: [{ moveId: { in: moveIds } }, { cavingRollId: { in: cavingIds } }] },
            orderBy: { createdAt: "asc" },
            include: STAGED_MESSAGE_INCLUDE,
          }),
        ])
      : [[], []];

  const usernameById = new Map(members.map((m) => [m.id, m.username]));
  const locationNameById = new Map(stagingLocations.map((l) => [l.id, l.name]));
  const now = new Date();

  return {
    // structuresByLocationId is deliberately not passed: this lens shows a
    // PAST turn, and today's ground under a months-old Move would lie. The
    // history desk renders no Standing-here line, so nothing is missing it.
    moves: actions.map((a) => moveRow(a, { usernameById, now })),
    cavingRolls: cavingRolls.map((c) => cavingRollRow(c, { usernameById, catatonicIds: new Set() })),
    effects: stagedEffects.map((e) => stagedEffectRow(e, { usernameById, locationNameById, openTurn })),
    messages: stagedMessages.map((m) => stagedMessageRow(m, { usernameById, openTurn })),
    tagsById: tagsByIdFor(actions),
  };
}

// The inspector's Moves tab: one character, past turns only (the player
// desk's Canon tab owns the open one). Newest first, capped, with each
// Move's sent private messages.
const MOVE_HISTORY_LIMIT = 40;
const MOVE_HISTORY_PREVIEW_CHARS = 140;

async function getCharacterMoveHistoryImpl({ characterId }) {
  await requireGm();
  const id = characterId?.toString().trim() ?? "";
  if (!id) throw new UserError("No character specified.");

  const actions = await prisma.action.findMany({
    // Confirmed only — a PENDING_TYPE row is an abandoned draft.
    where: {
      characterId: id,
      status: { in: ["CONFIRMED", "ADJUDICATED"] },
      turn: { status: "RESOLVED" },
    },
    orderBy: [{ turn: { number: "desc" } }, { createdAt: "desc" }],
    take: MOVE_HISTORY_LIMIT,
    include: {
      turn: { select: { number: true, phase: true } },
      stagedMessages: {
        where: { kind: "PRIVATE", sentAt: { not: null } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          content: true,
          recipients: { select: { character: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  // See getArchiveSliceImpl: guarded() spreads the payload.
  return {
    rows: actions.map((a) => ({
      id: a.id,
      turnLabel: a.turn ? `${a.turn.number} · ${a.turn.phase === "DAWN" ? "Dawn" : "Dusk"}` : "—",
      kindLabel: moveKindLabel(a.moveKind, a.gmNotes),
      reviewLabel: MOVE_REVIEW_LABELS[a.moveReviewStatus] ?? "Open",
      rollLabel: rollLabel(a),
      declaredLabel: declaredLabel(a),
      paidLabel: paidLabel(a.appliedEffects),
      description: a.description ?? "",
      resultMessage: truncateHistoryText(a.resultMessage),
      messages: a.stagedMessages.map((m) => ({
        id: m.id,
        content: truncateHistoryText(m.content),
        recipientNames: m.recipients.map((r) => r.character.name),
      })),
    })),
  };
}

function truncateHistoryText(text) {
  const clean = (text ?? "").trim();
  return clean.length > MOVE_HISTORY_PREVIEW_CHARS
    ? `${clean.slice(0, MOVE_HISTORY_PREVIEW_CHARS - 1)}…`
    : clean;
}

// The composer's held-tags panel: lean rows for one character, keyed by tag.
async function getHeldTagsImpl({ characterId }) {
  await requireGm();
  const rows = await prisma.characterTag.findMany({
    where: { characterId: characterId ?? "" },
    select: { tagId: true, quantity: true, tag: { select: { name: true, stackable: true } } },
    orderBy: { tag: { name: "asc" } },
  });
  return { tags: rows.map((r) => ({ tagId: r.tagId, name: r.tag.name, quantity: r.quantity, stackable: r.tag.stackable })) };
}

export async function createStagedMessage(input) {
  return guarded(() => createStagedMessageImpl(input));
}
export async function updateStagedMessage(input) {
  return guarded(() => updateStagedMessageImpl(input));
}
export async function deleteStagedMessage(input) {
  return guarded(() => deleteStagedMessageImpl(input));
}
export async function resendStagedMessage(input) {
  return guarded(() => resendStagedMessageImpl(input));
}
export async function createStagedEffects(input) {
  return guarded(() => createStagedEffectsImpl(input));
}
export async function createStagedTransfer(input) {
  return guarded(() => createStagedTransferImpl(input));
}
export async function updateStagedEffect(input) {
  return guarded(() => updateStagedEffectImpl(input));
}
export async function deleteStagedEffect(input) {
  return guarded(() => deleteStagedEffectImpl(input));
}
export async function retargetMissedStaging(input) {
  return guarded(() => retargetMissedStagingImpl(input));
}
export async function claimMoveLock(input) {
  return guarded(() => claimMoveLockImpl(input));
}
export async function refreshMoveLock(input) {
  return guarded(() => refreshMoveLockImpl(input));
}
export async function releaseMoveLock(input) {
  return guarded(() => releaseMoveLockImpl(input));
}
export async function resolveMove(input) {
  return guarded(() => resolveMoveImpl(input));
}
export async function rejectMove(input) {
  return guarded(() => rejectMoveImpl(input));
}
// Taking a Caving find back off the sheet. The roll itself stands — a GM is
// undoing the loot, not the die. lootUndoneAt is the claim: the update only
// matches while it is still null, so two clicks drop one tag (CAVING.md §4).
async function undoCavingFindImpl({ rollId }) {
  const session = await requireGm();
  const roll = await prisma.cavingRoll.findUnique({
    where: { id: rollId ?? "" },
    include: { lootTag: { select: { name: true } } },
  });
  if (!roll) throw new UserError("That roll is gone.");
  if (!roll.lootTagId) throw new UserError("That roll found nothing.");
  if (roll.lootUndoneAt) throw new UserError("That find has already been taken back.");

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.cavingRoll.updateMany({
      where: { id: roll.id, lootUndoneAt: null },
      data: { lootUndoneAt: new Date() },
    });
    if (claimed.count === 0) throw new UserError("That find has already been taken back.");
    await dropCharacterTag(tx, roll.characterId, roll.lootTagId, 1);
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "caving_loot_undone",
        targetCharacterId: roll.characterId,
        turnId: roll.turnId,
        details: { rollId: roll.id, tagId: roll.lootTagId, tagName: roll.lootTag?.name ?? null },
      },
    });
  });

  await afterInventoryChange(roll.characterId);
  revalidatePath("/gm/turns");
  return { ok: true };
}

export async function resolveCavingRoll(input) {
  return guarded(() => resolveCavingRollImpl(input));
}
export async function undoCavingFind(input) {
  return guarded(() => undoCavingFindImpl(input));
}
export async function getCharacterInspector(input) {
  return guarded(() => getCharacterInspectorImpl(input));
}
export async function getArchiveSlice(input) {
  return guarded(() => getArchiveSliceImpl(input));
}
export async function getHeldTags(input) {
  return guarded(() => getHeldTagsImpl(input));
}
export async function getMoveHistory(input) {
  return guarded(() => getMoveHistoryImpl(input));
}
export async function getCharacterMoveHistory(input) {
  return guarded(() => getCharacterMoveHistoryImpl(input));
}
export async function getArchiveContext(input) {
  return guarded(() => getArchiveContextImpl(input));
}
