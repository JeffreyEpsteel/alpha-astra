// The three ways to play Hyptile Island and what each one allows. Plain data and pure functions (no
// DOM, no engine) so the save, the HUD, the panels and the tests all read the same rules.
//
//   MODES[ id ]         { id, name, tagline, bullets[], icon, space }   id: 'sandbox' | 'campaign' | 'multiplayer'
//   rules( mode )       frozen { mode, worldControls, freeCam, timeControl, freeUnlocks, debugViews, online,
//                               serverClock, autosave, saveTime }  (an unknown mode gets the campaign rules)
//   saveSpace( mode )   storage-key prefix of the mode's save slots ('' = the original keys of the campaign)
//   modeLabel( mode )   'Sandbox' | 'Campaign' | 'Multiplayer'
//   DAY_SPEED           hours of island time per real second where the player does not control the clock
//
// Sandbox is free play: every world option (time, sun, sea, weather, clouds, free camera), every character
// and every boat free. Campaign is the progression game (money, quests, unlocks) with the world fixed so
// nothing can be set to make it easier. Multiplayer is the campaign's rules on a shared island: the clock
// comes from the server. Each mode has its own save slots (the campaign keeps the original keys, so older
// saves are campaign saves). A multiplayer universe (src/net/Universe.js) keeps the captain's game on its server instead
// of a slot; the island and crew rooms use the multiplayer slots.

export const DEFAULT_MODE = 'campaign';

// Use the running connection as well as the menu mode: a connected session must
// never inherit local save/debug privileges from a stale mode selection.
export function isOnlineSession( app ) {

	return !! ( app && ( app.mode === 'multiplayer' || app.rules?.online || app.net?.online || app.game?.state?.storage?.universe ) );

}

// a 40-minute day: the island clock where the player does not control it (also the server's default)
export const DAY_SPEED = 0.01;

// the tooltip / badge of every sandbox-only control
export const SANDBOX_ONLY = 'Sandbox only';

export const MODES = {
	sandbox: {
		id: 'sandbox', name: 'Sandbox', icon: 'sun', space: 'sandbox',
		tagline: 'Free play on the island.',
		bullets: [ 'Every character and every boat, free', 'Set the time, sun, weather and sea', 'Free camera and a stopped clock' ],
	},
	campaign: {
		id: 'campaign', name: 'Campaign', icon: 'anchor', space: '',
		tagline: 'Fish, earn and unlock the island.',
		bullets: [ 'Money, PoorGoat\'s quests and unlocks', 'The island\'s weather and clock run on their own', 'Missions are coming' ],
	},
	multiplayer: {
		id: 'multiplayer', name: 'Multiplayer', icon: 'gauge', space: 'multiplayer',
		tagline: 'The campaign on a shared island.',
		bullets: [ 'Join a hosted universe: the server keeps your captain', 'Or crew up with a code on an island room', 'The server keeps the island clock' ],
	},
};

export const MODE_IDS = Object.keys( MODES );

const RULES = {
	sandbox: { mode: 'sandbox', worldControls: true, freeCam: true, timeControl: true, freeUnlocks: true, debugViews: true, online: false, serverClock: false, autosave: true, saveTime: true },
	campaign: { mode: 'campaign', worldControls: false, freeCam: false, timeControl: false, freeUnlocks: false, debugViews: false, online: false, serverClock: false, autosave: true, saveTime: true },
	multiplayer: { mode: 'multiplayer', worldControls: false, freeCam: false, timeControl: false, freeUnlocks: false, debugViews: false, online: true, serverClock: true, autosave: false, saveTime: false },
};
for ( const r of Object.values( RULES ) ) Object.freeze( r );

export function isMode( id ) {

	return typeof id === 'string' && Object.prototype.hasOwnProperty.call( MODES, id );

}

// worldControls : time of day, sun azimuth, advance / speed of time, sea state, weather, clouds and haze
// freeCam       : the free (debug) camera, F
// timeControl   : T pauses time, the clock sliders move it
// freeUnlocks   : every character unlocked, boats / gear / fuel cost nothing
// debugViews    : window.__view( name ) review cameras
// online        : connects to a server (the menu asks for a server); serverClock: the server sets the time
// autosave      : the minute autosave; saveTime: the time of day is part of the save
export function rules( mode ) {

	return isMode( mode ) ? RULES[ mode ] : RULES[ DEFAULT_MODE ];

}

// the storage-key prefix of a mode's slots ('' for the campaign: its keys are the original ones)
export function saveSpace( mode ) {

	return isMode( mode ) ? MODES[ mode ].space : '';

}

export function modeLabel( mode ) {

	return isMode( mode ) ? MODES[ mode ].name : MODES[ DEFAULT_MODE ].name;

}
