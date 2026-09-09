"use client";

import { useState } from "react";
import ActionButton from "./ActionButton";
import { useRequestActions } from "./RequestActionsProvider";
import { ACTION_SECTIONS, ACTION_HELP, labelFor, reasonFor } from "./actionRegistry";

// Everything a player can do to a sheet, as captioned rows of buttons. The
// list itself lives in actionRegistry.js; this only lays it out, and
// ActionButton.js draws each one.
//
// Rows, not a fixed grid. The old four-across grid left one icon stranded
// on its own row whenever the count wasn't a multiple of four, and the
// count is about to keep growing. Each section is a `flex-wrap` row under a
// small caption, so any number of icons fills left to right and wraps
// wherever the width says; a section with nothing to show (no bird, no
// literacy) is left out entirely.
//
// `variant` picks the frame, not the contents. "rack" is a captioned row of
// framed glyphs, capped narrow, which is what /character's column fits.
// "columns" is /ledger's: one column per section with a rule between them,
// each holding the glyph AND its name as a full-width row — /ledger has a
// whole screen, and a labelled verb is one fewer thing to hover to understand.
// `children` rides at the end of the strip: the Trumpet, which commits on the
// spot rather than opening a dialog, and so is not in the registry.
export default function ActionGrid({ variant = "rack", children = null }) {
  const actions = useRequestActions();
  // Before the early return, so the hook count never changes between renders.
  const [why, setWhy] = useState(null);
  if (!actions) return null;
  const { open, pools, busy } = actions;
  const columns = variant === "columns";

  const sections = ACTION_SECTIONS.map((section) => ({
    ...section,
    visible: section.actions.filter((a) => (a.show ? pools[a.show] : true)),
  })).filter((s) => s.visible.length > 0);

  const button = (a) => (
    <ActionButton
      key={a.mode}
      variant={columns ? "tile" : "icon"}
      icon={a.icon}
      label={labelFor(a, pools)}
      help={ACTION_HELP[a.mode] ?? null}
      reason={reasonFor(a, pools)}
      disabled={a.gate ? !pools[a.gate] : false}
      busy={busy === a.mode}
      onClick={() => open(a.mode)}
    />
  );

  if (variant === "strip") {
    return (
      <div className="action-strip-wrap">
        <div className="action-strip">
          {sections.map((section) => (
            <div
              key={section.key}
              className="action-strip-group"
              role="group"
              aria-label={section.label}
            >
              {section.visible.map((a) => {
                const disabled = a.gate ? !pools[a.gate] : false;
                const label = labelFor(a, pools);
                return (
                  <ActionButton
                    key={a.mode}
                    variant="strip"
                    icon={a.icon}
                    label={label}
                    disabled={disabled}
                    busy={busy === a.mode}
                    onClick={() =>
                      disabled
                        ? setWhy({
                            label,
                            text: reasonFor(a, pools) ?? ACTION_HELP[a.mode] ?? null,
                          })
                        : (setWhy(null), open(a.mode))
                    }
                  />
                );
              })}
            </div>
          ))}
          {children && <div className="action-strip-group">{children}</div>}
        </div>
        {why && (
          <p className="action-strip-why" role="status">
            <strong>{why.label}:</strong> {why.text ?? "Not something you can do right now."}
          </p>
        )}
      </div>
    );
  }

  if (columns) {
    return (
      <div className="action-columns">
        {sections.map((section) => (
          <div key={section.key} className="action-column">
            <p className="field-label mb-2">{section.label}</p>
            <div className="flex flex-col gap-1">{section.visible.map(button)}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sections.map((section) => (
        <div key={section.key}>
          <p className="field-label mb-1">{section.label}</p>
          <div className="flex flex-wrap gap-1" style={{ maxWidth: "12rem" }}>
            {section.visible.map(button)}
          </div>
        </div>
      ))}
    </div>
  );
}
