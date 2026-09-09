// Every player action on the character sheet, declared once.
//
// ActionGrid.js renders these as captioned rows; RequestActionsProvider.js
// reads each mode's title and help from here. Adding an action to the game
// is one object literal in a section below, one dialog branch in the
// provider, and one server action — nothing else has to change, and the
// grid never has a fixed column count to overflow.
//
// The metagaming rule: a button is greyed out ONLY for a fact about your own
// sheet — nothing to destroy, no recipe you know, no Medical training. It is
// NEVER greyed for a fact about who is standing near you. A greyed-out Loot
// icon would announce "nobody here is helpless" to anyone who glanced at
// their own sheet, and a live one would announce the opposite — free
// scouting, every time the page loads. So the co-presence actions are always
// lit, and you learn who is here by opening the dialog and reading it. (The
// pickers themselves list only the people at your Location who haven't hidden
// their face — web/lib/peopleHere.js — which is a different rule: what the
// dialog shows once you chose to look.)
//
// `gate`: a key on the provider's pools that greys the button when false.
// `gateReason`: the sentence a greyed button's tooltip gives for it. Every
// gate carries one, and every one is a fact about YOUR OWN sheet — the rule
// above forbids anything else. Where the server already knows a sharper
// sentence (Look at's eyes, Extract's tools) `pools.gateReason[mode]` wins.
// `instant`: the verb runs on the click, with no dialog — a confirm at most
// (RequestActionsProvider.js#runInstant). Documentation; the behaviour is the
// INSTANT table in components/actions/index.js.
// `show`: a key that HIDES the button instead — for the rare tags (a bird,
// literacy) where a permanently dead icon would teach nothing except that
// something exists which you cannot have.
import {
  HammerIcon,
  TortureIcon,
  ShearsIcon,
  TrashIcon,
  HandOffIcon,
  MealIcon,
  BandageIcon,
  LootIcon,
  MapIcon,
  ShackleIcon,
  KeyIcon,
  WoundIcon,
  GraveIcon,
  CleaverIcon,
  HeadstoneIcon,
  BirdIcon,
  EyeIcon,
  DocumentsIcon,
  SpeakerIcon,
  ExtractIcon,
  CrateIcon,
  QuillIcon,
  SealIcon,
  CharacterIcon,
} from "./icons";

export const ACTION_HELP = {
  examine:
    "Look at someone.",
  heal: "Heal yourself or someone nearby. Gated by your Medical skill.",
  consume:
    "Use something up. You can also just click on the tag on your sheet.",
  learn:
    "Learning a skill is a Gambit. It succeeds on a 5 or a 6. It also takes the teacher's turn.",
  teach:
    "Offer to teach a skill. The learner succeeds on a 5 or a 6. It takes your turn too.",
  confess:
    "Confessing a tag is a Gambit. It succeeds on a 5 or a 6. It also takes the confessor's turn.",
  move: "Forcibly move an incapacitated or Bound person. If you're a Leader, you can also move people within your own faction.",
  bind: "Tie someone up. Bound people can be looted or forcefully moved.",
  crucify:
    "Put someone standing here on the cross. It needs a Cross built where you stand, and it doesn't spend your Move. They hang there unable to act, and in a turn they are Dying.",
  harm: "Further injure someone who is bound or incapacitated.",
  torture:
    "You can torture people, revealing all their tags on a 4 or higher. Brave or Craven characters will break on different timelines.",
  mutilate:
    "Cut a piece off somebody tied up here, or off a body you can reach. One piece each time, and it costs you nothing. The piece is yours to keep.",
  bury: "Bury someone. Removes the player's Cursed status.",
  engrave: "Memorialize someone's name. Removes the player's Cursed status.",
  disguise:
    "Put on a false name and face for 3 turns. Nobody sees who you are — not your name, not your portrait — and you cannot conceal yourself on top of it. The kit is not used up.",
  pointer:
    "Read the datacard. It names the next place on the way to the nuclear device, or tells you the device is already here. Costs nothing, takes no time, and nobody is told you looked.",
  arm:
    "Put the datacard into the device and start the countdown. It detonates at the close of the turn after next, and it will kill everyone who is not underground. You can still disarm it before then.",
  disarm:
    "Take the datacard out and stop the countdown. Safe again, and you can arm it as many times as you like.",
  extract:
    "Cut Godflesh out of the marsh. Takes your turn, and you need a hatchet, a battle-axe or a chainsaw in your hands. It rolls 1d6: a 6 gives you an extra, and a 1 means it got hold of you first. Wear your Armored Gloves.",
  package:
    "Pack up to 150 lb of what you're carrying into one crate. The crate weighs half what went into it, and you write the line on the side yourself. Anyone holding it can open it again.",
  bird: "Send a letter you're holding to someone, by bird. You have to guess their zone — guess wrong and the bird comes back with it still on.",
  seal: "Close a letter with your wax seal.",
  // The Thanati's three, Bascinet's words verbatim (docs/systemdocs/THANATI.md).
  // Purchase Gear carries none on purpose.
  recall: "Remember the other Thanati cultists in Ravenheart.",
  recover: "Recover your mask and robes from where you left them.",
  hideout: "Set your hideout room, determining where you can purchase things from.",
};

export const ACTION_SECTIONS = [
  {
    key: "self",
    label: "You",
    actions: [
      {
        mode: "craft",
        icon: HammerIcon,
        label: "Craft",
        gate: "canCraft",
        gateReason: "You know no recipe you could make right now.",
      },
      {
        mode: "destroy",
        icon: TrashIcon,
        label: "Destroy",
        gate: "canDestroy",
        gateReason: "You're carrying nothing you could destroy.",
      },
      {
        mode: "consume",
        icon: MealIcon,
        label: "Consume",
        gate: "canConsume",
        gateReason: "Nothing you're carrying can be used up.",
      },
      // No gate: you can always move ⬢ or put something down.
      { mode: "transfer", icon: HandOffIcon, label: "Transfer" },
      // HIDDEN rather than greyed, the same reasoning Crucify and the Factory
      // verbs give: whether YOU are carrying a disguise kit is a fact about
      // your own sheet, and a dead Disguise icon on everybody else's would
      // teach them nothing except that disguise kits exist.
      {
        mode: "disguise",
        icon: CharacterIcon,
        label: "Disguise",
        show: "canDisguise",
      },
      // Both grey on a list the server already filtered to who could teach
      // YOU (or whom you could teach) — a fact about your own sheet.
      {
        mode: "learn",
        icon: DocumentsIcon,
        label: "Learn Skill",
        gate: "canLearn",
        gateReason: "Nobody here can teach you anything you haven't got.",
      },
      {
        mode: "teach",
        icon: SpeakerIcon,
        label: "Teach Skill",
        gate: "canTeach",
        gateReason: "You have nothing to teach that anyone here could learn.",
      },
      // Gated on whether YOU have anything to confess — your own sheet,
      // never on whether a chaplain happens to be standing here.
      {
        mode: "confess",
        icon: BandageIcon,
        label: "Confess",
        gate: "canConfess",
        gateReason: "You have nothing to confess.",
      },
      // The two Godard Factory verbs. Both HIDE rather than grey when the
      // place is wrong, which is a different thing from the rule at the top of
      // this file: that rule forbids leaking who is standing near you, and
      // where YOU are standing is not somebody else's fact. An Extract button
      // greyed out in the Fortress would just be furniture.
      {
        mode: "extract",
        icon: ExtractIcon,
        label: "Extract",
        show: "canSeeExtract",
        gate: "canExtract",
        gateReason: "You have nothing to cut with.",
        instant: true,
      },
      {
        mode: "package",
        icon: CrateIcon,
        label: "Package",
        show: "canSeePackage",
      },
    ],
  },
  // The bomb. Its own section rather than three more rows under "You",
  // because the datacard is the rarest thing in the game and burying it in a
  // grid of nine everyday verbs would make it read as one of them.
  //
  // All three HIDE rather than grey when you have no datacard — the Extract
  // rule: whether YOU are carrying it is a fact about your own sheet, and a
  // dead row on everybody else's would only teach them the bomb exists.
  // Arm and Disarm then additionally GREY when the device itself is not in
  // your hands, which is the one thing a card-holder needs told.
  {
    key: "device",
    label: "The device",
    actions: [
      { mode: "pointer", icon: EyeIcon, label: "Use Pointer", show: "hasDatacard", instant: true },
      {
        mode: "arm",
        icon: WoundIcon,
        label: "Arm Nuke",
        show: "hasDatacard",
        gate: "hasDevice",
        gateReason: "You have the card, but not the device.",
        instant: true,
      },
      {
        mode: "disarm",
        icon: KeyIcon,
        label: "Disarm Nuke",
        show: "hasDatacard",
        gate: "hasDevice",
        gateReason: "You have the card, but not the device.",
        instant: true,
      },
    ],
  },
  // THE THANATI (docs/systemdocs/THANATI.md). Every row HIDES rather than
  // greys — whether you are a cultist, or its leader, is your own sheet's
  // fact, and a dead row on everybody else's would only teach them the cult
  // exists. Purchase Gear then GREYS on whether you are standing at the
  // hideout's Location, which is your own ground.
  {
    key: "thanati",
    label: "THANATI",
    actions: [
      { mode: "recall", icon: SpeakerIcon, label: "Recall Comrades", show: "isThanati", instant: true },
      // The label is derived from what is missing — see labelFor() below — and
      // the button greys once both are held, which is your own sheet's fact.
      {
        mode: "recover",
        icon: CharacterIcon,
        label: "Recover Equipment",
        show: "isThanati",
        gate: "canRecover",
        gateReason: "You have both.",
        instant: true,
      },
      { mode: "hideout", icon: KeyIcon, label: "Set Hideout", show: "isThanatiLeader" },
      {
        mode: "purchase",
        icon: CrateIcon,
        label: "Purchase Gear",
        show: "isThanati",
        gate: "atHideout",
        gateReason: "You aren't standing at the hideout.",
      },
    ],
  },
  {
    key: "others",
    label: "Others",
    actions: [
      // The gate is on your EYES, never on who is standing near you — the
      // rule at the top of this file forbids the second and says nothing
      // against the first. Nearsighted with your spectacles off, or Sun
      // Sensitivity in daylight, is a fact about your own sheet and leaks
      // nothing about the room (db/lib/examineVision.js).
      {
        mode: "examine",
        icon: EyeIcon,
        label: "Look at",
        gate: "canExamine",
        gateReason: "You can't see well enough right now.",
      },
      {
        mode: "heal",
        icon: BandageIcon,
        label: "Heal",
        gate: "canHeal",
        gateReason: "You have no Medical training.",
      },
      { mode: "loot", icon: LootIcon, label: "Loot" },
      { mode: "bind", icon: ShackleIcon, label: "Bind" },
      { mode: "free", icon: KeyIcon, label: "Free" },
      // HIDDEN rather than greyed, the Extract rule: whether YOU are a
      // Fundamentalist standing at a Cross is your own fact, and a dead
      // Crucify icon on every other sheet would teach nothing.
      { mode: "crucify", icon: WoundIcon, label: "Crucify", show: "canCrucify" },
      // HIDDEN on the same rule: whether YOU are a Torturer is your own fact.
      // Who here is tied up is the dialog's answer, never the button's.
      { mode: "torture", icon: TortureIcon, label: "Torture", show: "canTorture" },
      // HIDDEN on the same rule again, and on three tags rather than one:
      // Cruel, Torturer or Thanati. Which of them you hold is your own fact.
      // Who here is tied up, and whose body is lying about, is the dialog's
      // answer — never the button's.
      {
        mode: "mutilate",
        icon: ShearsIcon,
        label: "Mutilate",
        show: "canMutilate",
      },
      { mode: "harm", icon: WoundIcon, label: "Harm" },
      // The three body actions used to sit in a section of their own, on the
      // argument that a corpse is an object rather than somebody standing
      // next to you. Two headings for one column of icons was the worse half
      // of that trade, so they live here now.
      //
      // Butcher greys only on whether YOU hold the Butcher tag — a fact about
      // your own sheet, which the metagaming rule above allows. Never on
      // whether there's a body nearby; you find that out by opening it.
      {
        mode: "butcher",
        icon: CleaverIcon,
        label: "Butcher",
        gate: "canButcher",
        gateReason: "You aren't a Butcher.",
      },
      { mode: "bury", icon: GraveIcon, label: "Bury Person" },
      // Engraving types a name rather than picking one — the reasoning that
      // used to sit on Bury, and it applies harder here: this searches every
      // zone, so a dropdown would list every unburied body in Ravenheart.
      { mode: "engrave", icon: HeadstoneIcon, label: "Engrave" },
    ],
  },
  {
    key: "letters",
    label: "Paper",
    actions: [
      // Both HIDE on literacy rather than greying, the same reasoning the
      // Factory verbs give: an eternally dead Write button would teach a
      // player nothing except that letters exist and they haven't got them.
      // The gate underneath is eyes as well as letters — blind, blind drunk,
      // nearsighted with no spectacles (db/lib/reading.js).
      {
        mode: "write",
        icon: QuillIcon,
        label: "Write",
        show: "canRead",
        gate: "canWrite",
        gateReason: "You can't see to write right now.",
      },
      // Shown only while you are actually holding a wax stamp. A seal is a
      // fact about your own sheet, so hiding it leaks nothing.
      {
        mode: "seal",
        icon: SealIcon,
        label: "Seal Letter",
        show: "hasSeal",
        gate: "canSeal",
        gateReason: "You have no written letter to close.",
      },
      {
        mode: "bird",
        icon: BirdIcon,
        label: "Send Bird",
        show: "hasBird",
        gate: "canSendBirdToday",
        gateReason: "Your bird has already flown today.",
      },
    ],
  },
];

const BY_MODE = new Map(
  ACTION_SECTIONS.flatMap((s) => s.actions).map((a) => [a.mode, a]),
);

// The dialog title and submit label for a mode — the button's own name.
export function titleFor(mode) {
  return BY_MODE.get(mode)?.label ?? "Request";
}

export function actionFor(mode) {
  return BY_MODE.get(mode) ?? null;
}

// Names for the two things Recover Equipment hands back, keyed by slug. The
// slugs are db/lib/thanati.js#RECOVERABLE_SLUGS; the names are what the
// button says, so it reads "Recover Mask" when the robes are already on.
const RECOVER_NAMES = { "black-robes": "Robes", "thanati-mask": "Mask" };

// The button's label, given the pools — the same word for every action but
// Recover, whose label is what it would actually do.
export function labelFor(action, pools) {
  if (action.mode !== "recover") return action.label;
  const missing = (pools?.recoverMissing ?? []).map((slug) => RECOVER_NAMES[slug]).filter(Boolean);
  if (missing.length === 0) return action.label;
  return `Recover ${missing.join(" & ")}`;
}

// Why a greyed button is greyed: the server's sharper sentence when it has
// one, the registry's otherwise.
export function reasonFor(action, pools) {
  return pools?.gateReason?.[action.mode] ?? action.gateReason ?? null;
}

