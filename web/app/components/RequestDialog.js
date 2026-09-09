"use client";

import { useState } from "react";
import FormError from "@/app/components/FormError";
import { MAX_REASON_LENGTH } from "@/lib/constants";

import Modal from "./Modal";

// The shared confirm-with-fields modal. One of these opens for any player
// action that needs input before it fires: the caller passes its own
// type-specific fields as children, and this supplies the title, the confirm
// button and the error line. It asks for nothing itself by default — the
// reason box it used to carry unconditionally went when player actions
// stopped being Requests (there's no Undo left to point a reason at). A few
// GM actions still need one to relay to the player or the audit log — pass
// `reasonRequired` to bring the box back just for that dialog.
//
// The shell only mounts its body while open, so the fields reset between
// openings for free.
export default function RequestDialog({ open, ...props }) {
  if (!open) return null;
  return <RequestDialogBody {...props} />;
}

function RequestDialogBody({
  title,
  submitLabel = "Confirm",
  // Forwarded to Modal's own narrow/wide/widest sizes. A dialog whose body is
  // a browsable tag catalog needs the room; the ordinary two-field ones don't.
  width = undefined,
  // Forwarded to Modal too: a GM-side reason prompt on the desks floats so
  // the inspector stays browsable, while every player-facing one blocks.
  modeless = false,
  busy = false,
  error = null,
  canSubmit = true,
  reasonRequired = false,
  // Replaces the Cancel/Confirm row entirely. ActionDialog passes a lone
  // Close when a dialog's roster came back empty — a disabled Confirm under
  // "Nobody here is bound." was a dead button under an answer.
  footer = null,
  onCancel,
  onConfirm,
  children,
}) {
  const [reason, setReason] = useState("");

  const trimmed = reason.trim();
  const ready = !busy && canSubmit && (!reasonRequired || trimmed.length > 0);

  return (
    <Modal modeless={modeless} title={title} width={width} onClose={() => !busy && onCancel?.()}>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onConfirm?.(trimmed);
        }}
      >
        {reasonRequired && (
          <label className="field">
            <span className="field-label">What&apos;s your reason?</span>
            <textarea
              name="reason"
              rows={3}
              required
              autoFocus
              maxLength={MAX_REASON_LENGTH}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="The GMs will see this."
            />
          </label>
        )}

        {children && (
          <div
            className={`flex flex-col gap-3${reasonRequired ? " border-t pt-3" : ""}`}
            style={reasonRequired ? { borderColor: "var(--border)" } : undefined}
          >
            {children}
          </div>
        )}

        <FormError>{error}</FormError>

        {footer ?? (
          <div className="modal-actions">
            <button type="button" className="btn-quiet" onClick={() => onCancel?.()} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={!ready}>
              {busy ? "Working…" : submitLabel}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
