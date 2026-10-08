# The emission catalog: every line in the Field Console, and its tier

**Status:** 2026-10-02 (K43) · repo-only · the inventory behind the emission
ladder in `dev/console-lighting-system.md` §5.10. When you add a surface with an
outline, give it a row here and a tier in the markup.
`tests/console-emission-ladder.test.js` fails if a tiered class has no row.

**Why this exists.** The owner's read after K42: *"there is a class of lines
that are still reading as strokes rather than emissive, contributing to the
overall light of that surface and background reveal … lines around the archive
image holder … the metadata … there are classes/levels of emission to make it
cohesive and intentional. Metadata isn't going to glow as bright … the archive
thumbs should have a low emission resting state but light up a bit when
hovered."* A sweep of `css/field-console.css` found about 360 border
declarations. Every one is now in exactly one class below.

> **K44 (2026-10-03):** every panel, card and field below that sits in a view
> (the rows marked *engine: yes*) also carries `data-backlit`, a light behind
> its glass, except the one well (`studio-stage`; the publish log joined the lit panels in K95). The rim
> profile is now hottest at the **bottom**. See the lighting contract §5.11.

> **K50 (2026-10-04):** **no line in the console is a stroke any more.** The
> owner: *"remove all the strokes from around the panels … get rid of any lines
> running along the interface … a glass screen protector: a little bit of depth
> from the side and the thickness of the glass."* Every tier's rim is
> transparent (`--seam-rim`), the structural lines (`--seam`, `--seam-v`, the
> `--seam-glow` family) are gone, and what a tier draws is the slab's thickness
> — `--glass-edge`, scaled by its halation. The classes below are still the
> LEVELS of light each surface gives (its dial and its haze share); only the
> **structure** class lost its lines (the view header, the stage rule, the nav
> divider, the sidebar foot and the buffer's day leader draw nothing now), and
> the **control** class lost its stroke (a key is a well with `--key-edge`).
> The internal **rule** class (`--rule`, between list rows) is unchanged and
> awaits the owner's read. Lighting contract §5.15.

> **K46 (2026-10-04):** a **field is a well, not a lamp.** Seven lit fields
> stacked read as seven light sources (the owner: *"a bit incoherent …
> design it as a unified panel(s) as one source of light"*). No field carries
> `data-seam` or `data-backlit` any more: fields sit inside a lit panel and
> are wells cut into its glass, and a field taking focus lifts the PANEL's
> light (`:has([data-tier="field"]:focus)`). The archive's metadata got its
> panel (`compose-fields`). Every `.btn` became a floating control in CSS
> (the top row's look; lighting contract §5.13).

## The ladder

Levels are on the `--seam-level` dial (0..1), where the structure's seams sit at
0.7. **Engine** means the host carries `data-seam="box"` too, so the canvas pools
and hazes its light onto the ground. A surface inside a pop-up never does,
because a plane sits above the scrim where the canvas cannot reach (§5.9).

| tier | rest | under a hand | haze share | what it is | written as |
|---|---|---|---|---|---|
| structure | 0.7 (sidebar 1) | — | 1 (sidebar 2.4) | the chrome and view seams (K41) | `data-seam="top\|right\|bottom\|left"` or none |
| bay | its own three states | hover = hot (K42) | 1 | the ingestion bays | `.dropzone` / `.fn-hero` + `data-seam="box"` |
| panel | `--emit-panel` 0.34 | — | `--haze-panel` 0.5 | a workspace that holds content | `data-tier="panel"` |
| card | `--emit-card` 0.2 | `--emit-card-warm` 0.55 | `--haze-card` 0.22 | a repeating item | `data-tier="card"` |
| field | `--emit-field` 0.14 | 0.24 hover · `--emit-field-hot` 0.5 focus (and its panel lifts) | none — a well (K46) | an input | `data-tier="field"` only |
| control | the floating key: `--key-body`, `--key-edge`, a dish of light behind its glass (K46; every key since K90, THE SWEEP) | `--float-glow` 1.9 + `--lit-legend` | — (CSS only) | a button, chip, pill, tab or close cap | joins the sweep's list in `css/field-console.css` |
| rule | `--rule` / `--rule-v` | — | — (CSS only) | a divider inside a surface | `border-image: var(--rule) 1` |
| signal | unchanged | unchanged | — | a colour that MEANS something | its own state rule |

A tiered outline is a **rim fed from above** (`--seam-rim`: top 0.85, sides
0.5, bottom 0.3 of the level), with halation scaled to the level
(`--seam-halo-k`). The dial is a registered `<number>`, so hover and focus
*transition* it on `--tier-rise` / `--tier-fall`, and the engine holds its
frames for the length of that transition, so the pool rises with the rim.

## Panels — `data-tier="panel"`

| class | surface | created in | engine |
|---|---|---|---|
| `preview-wrap` | Archive: the image holder | `dev/field-console.html` | yes |
| `compose-fields` | Archive: the metadata panel (K46) | `dev/field-console.html` | yes |
| `archive-tag-preview` | Archive: the metadata preview card | `dev/field-console.html` | yes |
| `entry-form-card` | Wall, Network: entry forms, the ring card | `dev/field-console.html` | yes |
| `list-table` | Wall, Network, trash lists | `dev/field-console.html` | yes |
| `fn-dock` | FN: the insert dock | `dev/field-console.html` | yes |
| `import-zone` | Publish: remote sync | `dev/field-console.html` | yes |
| `publish-action` | Publish: commit and export | `dev/field-console.html` | yes |
| `publish-log` | Publish: the commit log | `dev/field-console.html` | yes |
| `publish-changes` | Publish: the change panel | `dev/field-console.html` | yes |
| `publish-legacy` | Publish: legacy ZIP | `dev/field-console.html` | yes |
| `danger-zone` | Publish: reset | `dev/field-console.html` | yes |
| `aud-feed` | Audio: the podcast feed | `js/console/audio.js` | yes |
| `aud-playlist-banner` | Audio: the playlist banner | `js/console/audio.js` | yes |
| `pulse-rail` | Pulse: recent and starters | `js/console/pulse.js` | yes |
| `control-block` | Cards: the studio's control blocks | `js/console/cards.js` | yes |
| `studio-stage` | Cards: the well | `js/console/cards.js` | yes |
| `pulse-tray` | Pulse: the glyph tray (its own scrim) | `js/console/pulse.js` | no |
| `focal-stage` | Focal modal: the stage | `dev/field-console.html` | no (in a plane) |
| `br-ship` | Bridge: the ship station's module (K82), backlit, its own lamps on its face | `dev/field-console.html` | yes |

## The one line seam — the ship station's slot (K81)

| class | surface | created in | engine |
|---|---|---|---|
| `br-mailslot-mouth` | Bridge: the ship station's mail slot, `data-seam="bottom"` | `dev/field-console.html` | yes: the pool along its lower lip, the haze cast down |

Every other seam is a box (K50/K51 took the lines out). This one is a lip the
owner asked for ("a slit of light radiating from the slot"): its dial rests at
`--emit-panel`, warms to `--emit-card-warm` under a hand and goes to 1 for a
send (`.is-sent`, 1.5 s), and its crisp line and near spill are CSS.

## Cards — `data-tier="card"`

| class | surface | created in | engine |
|---|---|---|---|
| `archive-card` | Archive and Wall thumbs | `js/console/archive.js`, `js/console/more-views.js` | yes |
| `summary-card` | Publish: the per-surface counts | `dev/field-console.html` | yes |
| `aud-row` | Audio: a track | `js/console/audio.js` | yes |
| `aud-set` | Audio: a saved set | `js/console/audio.js` | yes |
| `bench-card` | Bench: a RAW job | `js/console/bench.js` | yes |
| `pulse-tile` | Pulse: a recent pulse or a starter | `js/console/pulse.js` | yes |
| `grid-cell` | Cards: a slot in the grid | `js/console/cards.js` | yes |
| `asset-lib-item` | Asset library picker | `js/console/asset-library.js` | no (in a plane) |
| `audio-lib-item` | Audio library picker | `js/console/audio.js` | no (in a plane) |
| `fb-thumb` | FN drawer: a frame | `js/console/fn-editor.js` | no (in a plane) |
| `fn-media-row` | FN drawer: a media row | `dev/field-console.html` | no (in a plane) |

## Fields — `data-tier="field"`

| class | surface | created in | engine |
|---|---|---|---|
| `field-input` | Archive metadata (in `compose-fields`), Wall and Network forms (in `entry-form-card`); the login gate | `dev/field-console.html` | no — a well |
| `fn-doc-select` | FN: the note picker, in the bar | `dev/field-console.html` | no — a well |
| `notes-area` | Bench detail notes | `dev/field-console.html` | no — a well |
| `pulse-input` | Pulse: the foot fields; the tray's search | `js/console/pulse.js` | no — a well |
| `composer-input` | Cards: set picker, badge text (in a `control-block`) | `js/console/cards.js` | no — a well |
| `asset-lib-search` | Asset library search | `js/console/asset-library.js` | no (in a plane) |
| `audio-lib-search` | Audio library search | `js/console/audio.js` | no (in a plane) |

## Controls — cold iron that warms

**K46:** every `.btn` is now a floating control (§5.13 of the lighting
contract): `--float-edge`, a bright legend and CSS light behind its glass,
on the registered `--float-glow`. The rest of this list keeps the
cold-to-warm grammar below.

Their rest edge is `--edge-cold` (`--lit-cold-1` in the Darkroom, `--line-3` on
the Desk) and their hover edge is `--edge-warm` with the legend light:
`.btn`, `.btn-ghost`, `.fn-btn`, `.fn-chip`, `.icon-btn`, `.uqp-btn`,
`.sidebar-toggle`, `.settings-btn`, `.focal-style-btn`, `.asset-lib-pill`,
`.asset-lib-sort`, `.audio-lib-pill`, `.audio-lib-sort`, `.aud-lib-play-btn`,
`.pulse-lane`, `.pulse-log-btn`, `.pulse-glyph`, `.pulse-glyph--clear`,
`.pulse-chip`, `.cards-seg`, `.cards-pill`, `.cards-swatch`, `.layout-chip`,
`.reuse-chip`, `.help-bar-btn`, `#bench-detail .status-btn`,
`#bench-detail .action-btn`. Already emissive before this pass: `.frame-action`
and `.modal-close` (K42, backlit caps), and the topbar and nav controls (K40).

## Rules — the seam, unbloomed

`border-image: var(--rule) 1` (horizontal) or `var(--rule-v) 1` (vertical),
fed from the left and dissolving: `.fn-bar`, `.fn-meta`, `.fn-preview-hdr`,
`.fn-preview` (vertical), `.list-row`, `.publish-changes .pc-head`,
`.publish-changes .pc-row`, `.publish-legacy-body`, `.uqp-head`, `.uqp-row`,
`.uqp-foot`, `.asset-lib-toolbar`, `.asset-lib-insert-bar`, `.aud-set-tracks`,
`.aud-set-row + .aud-set-row`, `.audio-lib-toolbar`, `.audio-lib-insert-bar`,
`.fb-toolbar`, `.ledger-head`, `.sheet-item`, `.pulse-rail-head`, `.cards-head`,
`.cards-reuse`, `.readout-row + .readout-row`, `.aud-feed-note.beta`,
`.cards-seg-btn + .cards-seg-btn` (vertical). A ruled edge that turns into a
signal (`.fn-studio.is-draft .fn-bar`, `.list-row.drag-over`) drops the image
so its colour shows. Inside a plane, the header, footer and section rules are
the full seam (K42).

## Signals — deliberately unchanged

A border whose colour carries meaning stays that colour; on a tiered surface the
state rule is more specific than the tier, so it still wins:

- **Selection and state:** `.selected`, `.is-active`, `.is-editing`, `.is-live`,
  `.has-changes`, `.changes-open`, `.fb-selected`, `.burst-active`, `.over`,
  `.btn-primary`, `.btn-stage`, `.btn-danger`, `.btn--unlit`.
- **Severity:** the toast's left edge, `.aud-row.err` (now lit in the warn
  tone: `[data-tier].err` remaps `--lit-rgb`), `.aud-feed-beta`, the bench
  badges, `.tone-badge`, `.control-block-aside[data-tone]`.
- **Instruments:** LED bezels (`--led-bezel`), the focal guides and dot, the
  help filament's own marks and cards (§5.36 of the manual).
- **Meaningful dashes:** `.frame-ref-missing`, `.danger-zone`'s dashed top
  outside Publish, `.cards-unavailable`, `.rl-day`.

## Not tiered, on purpose

- **The buffer's frames.** A frame is a photograph; it has no outline at rest,
  and its hover edge is a selection cue. Its controls are the caps (§5.8).
- **The homepage card previews** (`.card-face .wk-*`). They render the PUBLIC
  card, whose look is the site's, not the console's. Lighting them would preview
  something the visitor never sees.
- **On-media chips** (`.fn-chip--onmedia`, `.asset-lib-open`). They sit on a
  photograph in both themes.

## Type — `data-text` (2026-10-06)

Type has its own ladder, beside the lines' one: four classes on `data-text`,
chosen by four questions asked in order (lighting contract §5.17). The class
says whether a piece of type gives light; its role (`--type-*`) says how big it
is and which ink it sits in. So far the Bridge is the only surface that
classifies its type. Its inventory:

| text | role | class | why |
|---|---|---|---|
| days since, storage used, a live pulse's time left | figure | `stat` | measured numbers |
| the headline, word by word | headline | `live` | the state of the site, right now |
| LIVE · DEPLOYED, BUILDING, THIS DEVICE % | label | `live` | readouts of the deploy and the device |
| storage tiers · measured X ago | whisper (dim) | `live` | the owner: "live info, low emissive". The tap to re-measure is a convenience; its job is to be read |
| past the free tier · $ a month | whisper, `.is-needs` | `live` | the state of the bill, and news |
| "Nothing live", the live pulse's words, "next publish: changes" | line / whisper | `live` | the state of the homepage |
| empty states ("Nothing to finish…", "Reading the live site…") | whisper | `live` | they report the state |
| the waiting lines, Resume, Take it down, a slot's title | line | `act` | their job is to be tapped. Since K61 an act is the accent, with a bed of the room's light under it (the owner: "volumetric red emissive text") |
| labels (DAY SINCE LAST PUBLISH, STORAGE · OF 10 GB FREE, LEFT ON YOUR HOMEPAGE) | label | `info` | they name a figure |
| channel headers (01 WAITING ON YOU …) | label | `info` | they name a channel |
| a line's context (word counts, ages, kinds), "you were here …", the room left, the intake and pulse notes, recent work | whisper / line | `info` | they explain or give context |

**Not type, so not here:** the clock (a drawn dot-matrix tube with its own
phosphor), the SEND ▲ key (a control with its own cap light), the intake bay
(the console's `.dropzone`, with its own glyph and legend phosphor, K61), and
the status light (`.lm-smd`; the headline's calm lamp was removed in K61).

**Levels since K61:** `stat` 1, `act` 0.7 (warm 1, pool 0.55), `live` 0.45
(was 0.3: too low to see), hot 1.4. A flaring text also draws the room's
light (the bed and a 72px bloom), which white light on white letters could
not show.

**Removed rather than classified:** the count beside *waiting on you*. It
restated the lines under it, which makes it a total, and a total is not news.

## Next, if the owner asks

- **The RAW Lens** (`.rl-*`): a full-screen tool with its own topbar, toolbar,
  tiles and commit bar, about 20 rules. It is a plane, so its tiers would be
  CSS-only. Deferred because it is its own instrument and deserves its own look.
- **The help overlay's cards and bar**: they have their own lighting (the
  filament, K39). Changing them needs that system's tests moved with them.
- **Second-tier text inputs** that are not yet `data-tier`: the FN title
  (`.fn-title`) and meta row (`.fn-meta-input`) are underline-only by design
  (the manuscript), and are left as the page's own type.
