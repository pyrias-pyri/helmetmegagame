"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { useConfirm } from "./ConfirmProvider";
import { soundTrumpet } from "@/app/(app)/character/trumpetActions";

// Its own control rather than an entry in ActionGrid, because everything in
// that grid opens a dialog through RequestActionsProvider and this commits
// straight away — the same shape as the equip toggle. Threading a direct-fire
// case through the generic grid for one button would complicate the machinery
// for every other action in it.
//
// It asks first. One click is heard across most of the barony and cannot be
// taken back, which is the same reason the bell rope makes you type RING into
// a modal before it will ring.
export default function SoundTrumpetButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [sounded, setSounded] = useState(false);
  const confirm = useConfirm();

  async function onClick() {
    setError(null);
    // Awaited OUTSIDE startTransition, or the dialog never renders — the rule
    // RequestActionsProvider.js documents.
    const ok = await confirm({
      title: "Sound the trumpet?",
      message: "It will be heard for a long way around, and everyone will know something is happening here.",
      confirmLabel: "Sound it",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await soundTrumpet();
      if (result?.ok) setSounded(true);
      else setError(result?.error ?? "Couldn't sound it.");
    });
  }

  return (
    <div className="mt-2">
      <p className="field-label mb-1">The trumpet</p>
      <button type="button" className="btn" onClick={onClick} disabled={pending}>
        {pending ? "Sounding…" : "Sound Trumpet"}
      </button>
      {sounded && !error ? (
        <p className="text-muted mt-1 text-sm">You sound it.</p>
      ) : null}
      <FormError className="mt-1">{error}</FormError>
    </div>
  );
}
