"use client";

import { useState } from "react";
import TurnCard from "@/app/(app)/play/TurnCard";
import MoveDialog from "@/app/(app)/play/MoveDialog";
import useMyMove from "@/app/(app)/play/useMyMove";
import { useRefresh } from "./useRefresh";

// The turn card the Chat's YOU column carries, on the sheet's band: when it
// is, whether Moves have locked, and the Move you filed — with the same File
// and Edit that open the same dialog. Same server action, same poll
// (play/useMyMove.js), so the sheet and the chat cannot disagree.
//
// Pending offers (a lesson, a binding) still read under it, in the words
// StatusPanel.js#ThisTurn has always used — they are why a Move may not be
// filed yet, and the card alone would not say so.
export default function SheetTurn({ moveState, pendingOffers = [] }) {
  const state = useMyMove(moveState ?? { turn: null, move: null });
  const [dialog, setDialog] = useState(null);
  const [refresh] = useRefresh();

  const waiting = pendingOffers.map((o) => (
    <span key={o.id} className="chat-quiet-line">
      {o.mine
        ? o.kind === "BIND"
          ? `Waiting for ${o.otherName} to agree to be bound.`
          : `Waiting for ${o.otherName} to accept the lesson${o.tagName ? ` in ${o.tagName}` : ""}.`
        : o.kind === "BIND"
          ? `${o.otherName} wants to bind you. Answer in your DMs.`
          : `${o.otherName} offered a lesson${o.tagName ? ` in ${o.tagName}` : ""}. Answer in your DMs.`}
    </span>
  ));

  function done() {
    state.refresh();
    // The rest of the sheet reads the Move too (hasMoved gates Craft and the
    // lesson verbs), so the page re-renders as well.
    refresh();
  }

  return (
    <div className="sheet-turn">
      <TurnCard turn={state.turn} move={state.move} onFile={() => setDialog("move")} onEdit={() => setDialog("edit")} />
      {waiting}
      {dialog === "move" && <MoveDialog onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "edit" && state.move && (
        <MoveDialog
          initial={{
            actionId: state.move.id,
            kind: state.move.kind,
            description: state.move.description,
            kindLocked: state.move.kindLocked,
          }}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
    </div>
  );
}
