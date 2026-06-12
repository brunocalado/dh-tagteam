# 0.1.1

[Added] When a player activates Tag Team, the module now automatically opens the party sheet for the GM on the Party Members tab and triggers the Tag Team Roll dialog with all active Tag Team participants pre-selected. The last player to activate is pre-set as the initiator. Multiple activations accumulate: each new activation adds that player's card without removing previous selections.

# 0.1.0

[Changed] Migrated module to full Foundry VTT v14 compliance.
[Added] `scripts/constants.js` — single source of truth for `MODULE_ID` and `FLAG_KEY`; imported everywhere instead of string literals.
[Changed] `_resetAllTagTeams` now batches all flag clears into a single `Actor.implementation.updateDocuments()` call instead of sequential awaits.
[Changed] Replaced `ui.windows` iteration with `foundry.applications.instances` (v14 API).
[Changed] Removed jQuery compatibility checks (`html instanceof jQuery`); v14 always provides `HTMLElement`.
[Changed] Removed manual `actor.sheet.render()` calls — AppV2 sheets re-render automatically on document updates.
[Changed] Removed inline styles from JS; button cursor/pointer-events and menu button layout moved to CSS via `data-gm-reset` attribute and `.dh-tagteam-menu-btn` class.
[Changed] CSS: all rules now wrapped inside `.dh-tagteam { }` module scope; nesting depth capped at 3 levels.

