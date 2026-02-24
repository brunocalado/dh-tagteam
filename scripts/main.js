/**
 * Injects a state-tracked Tag Team button into Daggerheart character sheets.
 */

const MODULE_ID = 'dh-tagteam';
const FLAG_KEY = 'tagTeamUsed';
const DEFAULT_HOPE_COST = 3;

/**
 * Resolves the hope cost from the actor's class feature.
 * Looks for a class item → its hope feature UUID → the action's hope cost.
 * @param {Actor} actor - The character actor.
 * @returns {Promise<number>} The hope cost, or DEFAULT_HOPE_COST as fallback.
 */
async function _getHopeCost(actor) {
    try {
        const classItem = actor.items.find(i => i.type === 'class');
        if (!classItem) return DEFAULT_HOPE_COST;

        const features = classItem.system?.features;
        if (!Array.isArray(features)) return DEFAULT_HOPE_COST;

        const hopeFeature = features.find(f => f.type === 'hope');
        if (!hopeFeature?.item) return DEFAULT_HOPE_COST;

        const itemRef = hopeFeature.item;
        const uuid = typeof itemRef === 'string' ? itemRef : itemRef?.uuid;
        if (!uuid) return DEFAULT_HOPE_COST;

        const hopeItem = await fromUuid(uuid);
        if (!hopeItem) return DEFAULT_HOPE_COST;

        const actions = hopeItem.system?.actions;
        if (!actions) return DEFAULT_HOPE_COST;

        const actionEntries = actions instanceof Map || typeof actions.values === 'function'
            ? [...actions.values()]
            : Object.values(actions);

        for (const action of actionEntries) {
            const costArray = Array.isArray(action.cost) ? action.cost
                : (action.cost instanceof Map || typeof action.cost?.values === 'function') ? [...action.cost.values()]
                : action.cost ? Object.values(action.cost) : [];
            const hopeCost = costArray.find(c => c.key === 'hope');
            if (hopeCost) return hopeCost.value ?? DEFAULT_HOPE_COST;
        }
    } catch (e) {
        console.warn(`${MODULE_ID} | Failed to resolve hope cost, using default`, e);
    }
    return DEFAULT_HOPE_COST;
}

/**
 * Initializes the button injection after the core sheet HTML is built.
 */
Hooks.on('renderCharacterSheet', async (app, html, data) => {
    const form = html instanceof jQuery ? html[0] : html;
    await _injectTagTeamButton(form, app);
});

/**
 * Handles the DOM injection of the Tag Team button.
 * @param {HTMLElement} form - The form element from the sheet.
 * @param {Application} app - The sheet application containing the actor reference.
 */
async function _injectTagTeamButton(form, app) {
    if (!form || !app || !app.document) return;

    const actor = app.document;
    if (actor.type !== 'character') return;

    const characterDetails = form.querySelector('.character-details');
    if (!characterDetails) return;

    if (characterDetails.querySelector('.tag-team-button')) return;

    const isUsed = actor.getFlag(MODULE_ID, FLAG_KEY) || false;
    const hopeValue = actor.system?.resources?.hope?.value || 0;
    const hopeCost = await _getHopeCost(actor);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tag-team-button';

    if (isUsed) {
        button.dataset.used = 'true';
        button.innerHTML = 'Tag Team (Used)';
        if (game.user.isGM) {
            button.title = 'GM: Click to reset for this character';
            button.disabled = false;
            button.style.pointerEvents = 'auto';
            button.style.cursor = 'pointer';
        } else {
            button.title = 'Tag Team already used this session';
            button.disabled = true;
            button.style.pointerEvents = 'auto'; // Ensures tooltip displays
            button.style.cursor = 'not-allowed';
        }
    } else if (hopeValue < hopeCost) {
        button.dataset.used = 'no-hope';
        button.innerHTML = 'Tag Team (No Hope)';
        button.title = `Requires ${hopeCost} Hope to use`;
        button.disabled = true;
    } else {
        button.dataset.used = 'false';
        button.innerHTML = 'Tag Team (Ready)';
        button.title = 'Use Tag Team';
        button.disabled = false;
    }

    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        _onTagTeamClick(actor, button);
    });

    characterDetails.style.display = 'flex';
    characterDetails.style.alignItems = 'center';
    characterDetails.style.gap = 'var(--space-8, 8px)';

    button.style.marginLeft = 'auto';
    button.style.flexShrink = '0';

    characterDetails.appendChild(button);
}

/**
 * Processes the Tag Team button click event.
 * @param {Actor} actor - The character actor.
 * @param {HTMLElement} button - The button element.
 */
async function _onTagTeamClick(actor, button) {
    const isUsed = actor.getFlag(MODULE_ID, FLAG_KEY) || false;

    if (isUsed) {
        if (game.user.isGM) {
            await actor.setFlag(MODULE_ID, FLAG_KEY, false);
            return;
        }
        return;
    }

    // Plays the sound locally for the triggering user
    AudioHelper.play({ src: 'modules/dh-tagteam/assets/sfx/pipchange.mp3', volume: 0.5, autoplay: true }, false);

    _sendTagTeamMessage(actor);

    // Awaits flag persistence to trigger automatic Foundry re-rendering
    await actor.setFlag(MODULE_ID, FLAG_KEY, true);
}

/**
 * Dispatches the Tag Team activation message to the chat.
 * @param {Actor} actor - The actor using Tag Team.
 */
function _sendTagTeamMessage(actor) {
    const actorName = actor.name;
    const actorImg = actor.img;

    const content = `
    <div class="chat-card dh-tagteam-card">
        <header class="card-header flexrow dh-tagteam-header">
            <h3 class="noborder dh-tagteam-title">Tag Team Activated</h3>
        </header>
        <div class="card-content dh-tagteam-content" style="background-image: url('${actorImg}');">
            <div class="dh-tagteam-overlay"></div>
            <div class="dh-tagteam-inner">
                <div class="dh-tagteam-actor-name">${actorName}</div>
                <div class="dh-tagteam-action-text"><span class="dh-tagteam-highlight">Stepped in to help!</span></div>
            </div>
        </div>
    </div>`;

    ChatMessage.create({
        user: game.user.id,
        speaker: { actor: actor.id },
        content: content,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
}

/**
 * Dispatches the global reset message to the chat.
 * @param {number} resetCount - Number of characters reset.
 */
function _sendResetMessage(resetCount) {
    const content = `
    <div class="chat-card dh-tagteam-card">
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
        content: content,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
}

/**
 * Clears the Tag Team flag for all valid characters.
 */
async function _resetAllTagTeams() {
    if (!game.user.isGM) {
        ui.notifications.warn("Only the GM can reset Tag Teams.");
        return;
    }

    const characters = game.actors.filter(a => a.type === 'character');
    let resetCount = 0;

    for (const actor of characters) {
        if (actor.getFlag(MODULE_ID, FLAG_KEY)) {
            await actor.setFlag(MODULE_ID, FLAG_KEY, false);
            resetCount++;
        }
    }

    if (resetCount > 0) {
        _sendResetMessage(resetCount);
    }

    Object.values(ui.windows).forEach(win => {
        if (win.document && win.document.type === 'character') {
            win.render(false);
        }
    });
}

/**
 * Resets the Tag Team flag upon completing a long rest.
 */
Hooks.on('daggerheartLongRest', (actor) => {
    if (actor.type === 'character') {
        actor.setFlag(MODULE_ID, FLAG_KEY, false);
        actor.sheet?.render(false);
    }
});

/**
 * Injects the global reset button into the GM's Daggerheart Menu.
 */
Hooks.on("renderDaggerheartMenu", (app, html, data) => {
    if (!game.user.isGM) return;

    const element = (html instanceof jQuery) ? html[0] : html;
    const myButton = document.createElement("button");
    myButton.type = "button";
    myButton.innerHTML = `<i class="fas fa-sync"></i> Reset All Tag Teams`;
    myButton.classList.add("dh-custom-btn"); 
    myButton.style.marginTop = "10px";
    myButton.style.width = "100%";

    myButton.onclick = async (event) => {
        event.preventDefault();
        await _resetAllTagTeams();
    };

    const fieldset = element.querySelector("fieldset");
    if (fieldset) {
        const newFieldset = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.innerText = "Tag Team Module";
        newFieldset.appendChild(legend);
        newFieldset.appendChild(myButton);
        fieldset.after(newFieldset);
    } else {
        element.appendChild(myButton);
    }
});

window.DHTagTeam = {
    onTagTeamClick: _onTagTeamClick,
    sendMessage: _sendTagTeamMessage,
    resetAll: _resetAllTagTeams,
    FLAG_KEY: FLAG_KEY,
    MODULE_ID: MODULE_ID
};