"use client";

import { useEffect, useState } from "react";
import EmptyState from "@/app/components/EmptyState";
import Feed from "@/app/(app)/play/Feed";
import { seedRows, applyRow, removeRow } from "@/app/(app)/play/feedStore";
import { noteTyping } from "@/app/(app)/play/typingStore";
import { getCharacterScene } from "./actions";

// The Scene tab: what is being said where this character is standing, live, in
// the inspector column (docs/systemdocs/CHAT.md §8).
//
// It is Chat's own `Feed` — not a GM-flavoured copy of it. The runs, the
// faces, the subtext lines, the `-#`, the tinted speech and the typing line all
// come out identically, which is the whole point: a GM reading a scene should
// be reading the same page the players are, not a transcript of it.
//
// Read-only twice over. `readOnly` drops the composer, and the GM place list
// carries `canSpeak: false` on every entry anyway (db/lib/feedAccess.js) — a
// GM speaks nowhere, and watching is not standing there.
//
// One place at a time, through `/api/feed?place=`. A GM's full place list is
// every place in every zone they may see, which is hundreds of subscriptions
// to watch one room; the parameter narrows the stream without touching the
// gate behind it.

const SELF = { characterId: null, name: null, avatarVersion: null };

export default function SceneTab({ characterId }) {
  const [state, setState] = useState({ status: "loading", places: [], locationName: null, error: null });
  const [selected, setSelected] = useState(null);

  // The place list for this character. Refetched per mount rather than cached
  // with the base tabs: where somebody is standing is exactly the fact that
  // changes while a GM has the desk open.
  //
  // Nothing is set synchronously in here — react-hooks/set-state-in-effect is
  // an error in this repo. Switching to another person REMOUNTS this component
  // (InspectorHost keys it on the character), so there is no stale state to
  // clear on the way in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getCharacterScene({ characterId });
      if (cancelled) return;
      if (!res?.ok) {
        setState({ status: "error", places: [], locationName: null, error: res?.error ?? "Couldn't load that." });
        return;
      }
      setState({ status: "ready", places: res.places, locationName: res.locationName, error: null });
      setSelected(res.places[0]?.placeKey ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  // What was said before now, then the stream for what happens next — the same
  // two halves Chat uses, and in the same order.
  useEffect(() => {
    if (!selected) return undefined;
    let cancelled = false;

    fetch(`/api/feed/history?place=${encodeURIComponent(selected)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.rows) return;
        seedRows(selected, data.rows);
      })
      .catch(() => {
        // The stream fills the place in as people speak. An empty scene says
        // everything an error message would.
      });

    const source = new EventSource(`/api/feed?place=${encodeURIComponent(selected)}`);
    source.addEventListener("message", (event) => {
      try {
        const row = JSON.parse(event.data);
        applyRow(row.placeKey, row);
      } catch {
        // A malformed frame is not worth tearing the stream down over.
      }
    });
    source.addEventListener("delete", (event) => {
      try {
        const data = JSON.parse(event.data);
        removeRow(data?.placeKey, data?.seq);
      } catch {
        // Same.
      }
    });
    source.addEventListener("typing", (event) => {
      try {
        noteTyping(JSON.parse(event.data));
      } catch {
        // Same.
      }
    });

    return () => {
      cancelled = true;
      source.close();
    };
  }, [selected]);

  if (state.status === "loading") return <p className="p-3 text-sm text-muted">Loading…</p>;
  if (state.status === "error") return <p className="p-3 text-sm form-error">{state.error}</p>;
  if (state.places.length === 0) {
    return (
      <div className="p-3">
        <EmptyState>They are nowhere you can see.</EmptyState>
      </div>
    );
  }

  const place = state.places.find((entry) => entry.placeKey === selected) ?? null;

  return (
    <div className="p-2">
      <div className="tab-bar" role="tablist" aria-label="Places">
        {state.places.map((entry) => (
          <button
            key={entry.placeKey}
            type="button"
            role="tab"
            className="tab-item"
            aria-selected={entry.placeKey === selected}
            data-active={entry.placeKey === selected ? "true" : "false"}
            onClick={() => setSelected(entry.placeKey)}
          >
            {entry.name}
          </button>
        ))}
      </div>
      <div className="chat-embed">
        <Feed place={place} self={SELF} readOnly />
      </div>
    </div>
  );
}
