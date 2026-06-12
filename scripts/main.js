/**
 * Injects a state-tracked Tag Team button into Daggerheart character sheets.
 */

import { MODULE_ID, FLAG_KEY } from "./constants.js";

/**
 * Registers the module socket listener.
 * Called from the init hook before world data is available.
 */
Hooks.on("init", () => {
    game.socket.on(`module.${MODULE_ID}`, (data) => {
        if (!game.user.isGM) return;
        if (data.type === "openPartySheet") _openPartySheetForGM(data.partyActorId, data.initiatorId);
    });
});

/**
 * Opens the party actor sheet on this GM client, navigates to the Party Members tab,
 * and triggers the Tag Team Roll dialog with all active Tag Team members pre-selected.
 * The latest activator is set as the initiator. Accumulates selections across multiple
 * player activations without resetting prior selections.
 * Invoked via socket when a player activates Tag Team and belongs to a party.
 * @param {string} partyActorId - The id of the party actor to open.
 * @param {string} initiatorId - The id of the character who most recently activated Tag Team.
 * @returns {Promise<void>}
 */
async function _openPartySheetForGM(partyActorId, initiatorId) {
    const partyActor = game.actors.get(partyActorId);
    if (!partyActor) return;

    // Collect all party members with an active Tag Team flag, always including the
    // triggering actor to guard against race conditions between flag update and socket.
    const activeMemberIds = new Set(
        [
            ...(partyActor.system.partyMembers ?? [])
                .filter(m => game.actors.get(m._id)?.getFlag(MODULE_ID, FLAG_KEY))
                .map(m => m._id),
            initiatorId
        ].filter(Boolean)
    );

    // Register before clicking so the hook is ready when the dialog renders.
    // The tagTeamRoll button always creates a fresh dialog instance (all members
    // start unselected), so we restore the full accumulated selection here.
    Hooks.once("renderTagTeamDialog", (app) => {
        for (const member of app.partyMembers) {
            member.selected = activeMemberIds.has(member.id);
        }
        if (initiatorId) {
            if (!app.initiator) app.initiator = { cost: 3 };
            app.initiator.memberId = initiatorId;
        }
        app.render();
    });

    await partyActor.sheet.render({ force: true });
    partyActor.sheet.changeTab("partyMembers", "primary");
    partyActor.sheet.element.querySelector('button[data-action="tagTeamRoll"]')?.click();
}

/**
 * Initializes the button injection after the core sheet HTML is built.
 * Called from the renderCharacterSheet hook.
 * @param {foundry.applications.api.ApplicationV2} app - The character sheet application.
 * @param {HTMLElement} html - The rendered root element.
 */
Hooks.on("renderCharacterSheet", (app, html) => {
    _injectTagTeamButton(html, app);
});

/**
 * Handles the DOM injection of the Tag Team button.
 * @param {HTMLElement} form - The root element of the rendered sheet.
 * @param {foundry.applications.api.ApplicationV2} app - The sheet application containing the actor reference.
 */
function _injectTagTeamButton(form, app) {
    if (!form || !app || !app.document) return;

    const actor = app.document;
    if (actor.type !== "character") return;

    // Prevent duplicate injection on re-renders
    if (form.querySelector(".tag-team-button")) return;

    const nameRow = form.querySelector(".name-row");
    if (!nameRow) return;

    const isUsed = actor.getFlag(MODULE_ID, FLAG_KEY) ?? false;
    const hopeValue = actor.system?.resources?.hope?.value ?? 0;

    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("dh-tagteam", "tag-team-button");

    if (isUsed) {
        button.dataset.used = "true";
        button.innerHTML = "Tag Team<br>(Used)";
        if (game.user.isGM) {
            button.dataset.gmReset = "true";
            button.title = "GM: Click to reset for this character";
        } else {
            button.title = "Tag Team already used this session";
            button.disabled = true;
        }
    } else if (hopeValue < 3) {
        button.dataset.used = "no-hope";
        button.innerHTML = "Tag Team<br>(No Hope)";
        button.title = "Requires 3 Hope to use";
        button.disabled = true;
    } else {
        button.dataset.used = "false";
        button.innerHTML = "Tag Team<br>(Ready)";
        button.title = "Use Tag Team";
    }

    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        _onTagTeamClick(actor, button);
    });

    nameRow.classList.add("dh-tagteam", "dh-tagteam-name-row");
    const actorName = nameRow.querySelector(".actor-name.input");
    if (actorName) actorName.after(button);
    else nameRow.appendChild(button);
}

/**
 * Processes the Tag Team button click event.
 * @param {Actor} actor - The character actor.
 * @param {HTMLElement} button - The button element.
 * @returns {Promise<void>}
 */
async function _onTagTeamClick(actor, button) {
    const isUsed = actor.getFlag(MODULE_ID, FLAG_KEY) ?? false;

    if (isUsed) {
        if (game.user.isGM) await actor.setFlag(MODULE_ID, FLAG_KEY, false);
        return;
    }

    // Plays the sound locally for the triggering user only
    foundry.audio.AudioHelper.play({ src: `modules/${MODULE_ID}/assets/sfx/pipchange.mp3`, volume: 0.5, autoplay: true }, false);

    _sendTagTeamMessage(actor);

    // Flag persistence triggers automatic AppV2 sheet re-render
    await actor.setFlag(MODULE_ID, FLAG_KEY, true);

    // If the character belongs to a party, notify all active GMs to open the party sheet
    const party = game.actors.find(
        a => a.type === "party" && a.system.partyMembers?.some(m => m._id === actor.id)
    );
    if (party) {
        game.socket.emit(`module.${MODULE_ID}`, { type: "openPartySheet", partyActorId: party.id, initiatorId: actor.id });
    }
}

/**
 * Dispatches the Tag Team activation message to the chat.
 * @param {Actor} actor - The actor using Tag Team.
 */
function _sendTagTeamMessage(actor) {
    const content = `
    <div class="chat-card dh-tagteam dh-tagteam-card">
        <header class="card-header flexrow dh-tagteam-header">
            <h3 class="noborder dh-tagteam-title">Tag Team Activated</h3>
        </header>
        <div class="card-content dh-tagteam-content" style="background-image: url('${actor.img}');">
            <div class="dh-tagteam-overlay"></div>
            <div class="dh-tagteam-inner">
                <div class="dh-tagteam-actor-name">${actor.name}</div>
                <div class="dh-tagteam-action-text"><span class="dh-tagteam-highlight">Stepped in to help!</span></div>
            </div>
        </div>
    </div>`;

    ChatMessage.create({
        user: game.user.id,
        speaker: { actor: actor.id },
        content,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
}

/**
 * Dispatches the global reset message to the chat.
 * @param {number} resetCount - Number of characters reset.
 */
function _sendResetMessage(resetCount) {
    const content = `
    <div class="chat-card dh-tagteam dh-tagteam-card">
        <header class="card-header flexrow dh-tagteam-header">
            <h3 class="noborder dh-tagteam-title">The Fall Ends</h3>
        </header>
        <div class="card-content dh-tagteam-content dh-tagteam-reset-bg">
            <div class="dh-tagteam-overlay"></div>
            <div class="dh-tagteam-inner">
                <div class="dh-tagteam-actor-name">Tag Team Reset</div>
                <div class="dh-tagteam-action-text"><span class="dh-tagteam-highlight">${resetCount}</span> Characters Recovered</div>
            </div>
        </div>
    </div>`;

    ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker(),
        content,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
}

/**
 * Clears the Tag Team flag for all valid characters in a single batched update.
 * @returns {Promise<void>}
 */
async function _resetAllTagTeams() {
    if (!game.user.isGM) {
        ui.notifications.warn("Only the GM can reset Tag Teams.");
        return;
    }

    const characters = game.actors.filter(a => a.type === "character" && a.getFlag(MODULE_ID, FLAG_KEY));
    if (characters.length === 0) return;

    // Batch all flag clears into a single database round-trip
    const updates = characters.map(a => ({ _id: a.id, [`flags.${MODULE_ID}.${FLAG_KEY}`]: false }));
    await Actor.implementation.updateDocuments(updates);

    _sendResetMessage(characters.length);
}

/**
 * Resets the Tag Team flag upon completing a long rest.
 * Called from the daggerheartLongRest hook.
 * @param {Actor} actor - The actor completing the long rest.
 */
Hooks.on("daggerheartLongRest", (actor) => {
    if (actor.type === "character") {
        // AppV2 sheet re-renders automatically on document update
        actor.setFlag(MODULE_ID, FLAG_KEY, false);
    }
});

/**
 * Injects the global reset button into the GM's Daggerheart Menu.
 * Called from the renderDaggerheartMenu hook.
 * @param {foundry.applications.api.ApplicationV2} app - The DaggerheartMenu application.
 * @param {HTMLElement} html - The rendered root element.
 */
Hooks.on("renderDaggerheartMenu", (app, html) => {
    if (!game.user.isGM) return;

    const myButton = document.createElement("button");
    myButton.type = "button";
    myButton.innerHTML = `<i class="fas fa-sync"></i> Reset All Tag Teams`;
    myButton.classList.add("dh-tagteam", "dh-tagteam-menu-btn");

    myButton.addEventListener("click", async (event) => {
        event.preventDefault();
        await _resetAllTagTeams();
    });

    const fieldset = html.querySelector("fieldset");
    if (fieldset) {
        const newFieldset = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = "Tag Team Module";
        newFieldset.appendChild(legend);
        newFieldset.appendChild(myButton);
        fieldset.after(newFieldset);
    } else {
        html.appendChild(myButton);
    }
});

window.DHTagTeam = {
    onTagTeamClick: _onTagTeamClick,
    sendMessage: _sendTagTeamMessage,
    resetAll: _resetAllTagTeams,
    FLAG_KEY,
    MODULE_ID
};
