"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { CHAT_PLUGINS, DISCORD_COMPONENTS } from "./markdownPlugins";
import InfoIcon from "./InfoIcon";
import CharacterAvatar from "./CharacterAvatar";
import { useCharacterMentions } from "./CharacterMentionsProvider";

// One line of a scene, rendered. MarkdownContent.js stays exactly as it is for
// DMs — a DM is a GM and a player talking, and none of what follows belongs
// there.
//
// What this adds over plain Markdown: the {kind:payload} tokens (remarkTokens),
// chat's own three (remarkChat) — ||spoilers||, `-#` subtext and quoted speech —
// and Discord's angle-bracket vocabulary (remarkDiscord), which reaches a scene
// line whenever somebody types one into Discord. Every plugin feeds ONE tree,
// which is the reason these are remark plugins rather than string passes: a
// mention inside a spoiler inside a quote has to still be a mention.

// A {char:<id>} in a feed row. The map comes from CharacterMentionsProvider,
// which /play now fills from two lists: the people standing here, and the
// wider directory of everybody whose name is safe to print
// (web/lib/mentionDirectory.js). It used to be the first list alone, so a ping
// arriving from Discord — where anybody can mention anybody's name role —
// resolved to nothing and the line printed the raw `{char:<cuid>}`.
//
// A miss now means somebody behind a mask, or a character since gone. Either
// way it draws a person-shaped blank, because a cuid in braces is not a
// visible unresolved reference, it is a line that looks broken.
function CharMention({ payload }) {
  const mentionsById = useCharacterMentions();
  const character = mentionsById.get(payload.trim());
  if (!character) return <span className="chat-mention chat-mention--unknown">someone</span>;
  return (
    <span className="chat-mention">
      <CharacterAvatar
        characterId={character.id}
        name={character.name}
        version={character.updatedAt}
        size={16}
      />
      <span>{character.name}</span>
    </span>
  );
}

// Deliberately a short list. A feed row is a player writing, and the catalog
// tokens ({tag:…}, {resource:…}, {document:…}) are authored reference syntax —
// resolving them here would let anyone mint a live chip mid-scene. An
// unresolved token falls back to its literal text, the contract richTokens.js
// states for every kind.
function ChatTokenRenderer({ kind, payload, raw }) {
  if (kind === "char") return <CharMention payload={payload} />;
  if (kind === "info") return <InfoIcon text={payload.trim()} />;
  if (kind === "cmd") return <code className="cmd-chip">/{payload.trim()}</code>;
  return raw;
}

// Hidden until it is clicked, and it stays open after — the same as Discord's,
// and the same as what a reader expects from anything they had to ask to see.
// A button rather than a span with an onClick, so a keyboard gets it too.
function ChatSpoiler({ children }) {
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      className="chat-spoiler"
      data-shown={shown ? "true" : "false"}
      aria-label={shown ? undefined : "Hidden. Click to show it"}
      onClick={() => setShown(true)}
    >
      {children}
    </button>
  );
}

// The plugin list and its ordering rule now live in markdownPlugins.js, so
// this renderer and the DM one cannot drift apart again — which is how a
// Discord timestamp ended up as raw text in somebody's thread.
const PLUGINS = CHAT_PLUGINS;
const COMPONENTS = { richtoken: ChatTokenRenderer, chatspoiler: ChatSpoiler, ...DISCORD_COMPONENTS };

// memo'd on the text, which is what makes "parsed once per row" true: a row is
// keyed by seq in feedStore.js and its content only changes on an edit, so a
// hundred rows on screen re-parse nothing when the hundred-and-first lands.
function ChatMarkdown({ content }) {
  if (!content) return null;
  return (
    <div className="markdown-content chat-markdown">
      <ReactMarkdown remarkPlugins={PLUGINS} disallowedElements={["img"]} unwrapDisallowed components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);
