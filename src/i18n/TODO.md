# Localization: what is translated and what is left

Done (en.js / ro.js, 372 keys): the settings panel (all tabs, presets and tooltips), the Controls and Access tabs,
the pause menu, the HUD mode line, the on-screen prompts (matched as whole strings through `tx`), the controls sheet
and the start overlay (translated in the DOM by value, no change to ui/UI.js), rank and reputation titles.

How other UI joins in, cheapest first:
1. `import { t } from '../i18n/index.js'` and write `t( 'area.key', 'English text', { n: 3 } )`; add the key to en.js
   (same English text as the fallback) and ro.js. `node test/feature-a11y.mjs` checks every `t()` call in the
   files it lists against en.js.
2. Text built elsewhere in English: `tx( text )` for a whole string that is a value in a table, or add the string to
   the tables and call `observeDom( panelElement )` once on a panel that is rebuilt (never on per-frame HUD text).
3. Never build a key from translated text. One English text must have one Romanian translation (the test checks).

Not translated yet (owner, strings to key):
- src/ui/MainMenu.js (universe worker): mode cards, slot list, character names and blurbs, buttons. Add a language
  choice there: `import { LANGS, getLang, setLang } from '../i18n/index.js'`.
- src/game/GameHUD.js, src/game/HudPanels.js (root): the inventory, fish stand, chandlery, roster, Captain Roid
  chat topics, catch card, tips. `observeDom( hud.root )` once translates fixed labels; strings with numbers need `t()`.
- src/game/Game.js toasts (`this.toast( ... )`), src/game/Guide.js, src/game/CaptainRoid.js phrases (the subtitles:
  `phrases` text is data, translate it with `tx` / keys `roid.*`), src/game/CatchMinigame.js calls.
- Fish, species, boat, upgrade and crew names (src/game/*.js data): translate at display time with `tx`.
- src/ui/WorldMap.js already looks for `t` on its own; give it keys `map.*`.
- Feature modules (naval, melee, boarding, notices, trade, story, seaplane): prompts and panels.
- The Romanian plural form is `[ one, few, other ]` in a table value, picked by `vars.n`.
