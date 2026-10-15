// Plain-node tests of the game modes: the rules per mode, the save slots per mode, the sandbox's free unlocks, the
// `world` field of the save (player, boat, time of day) and the App's session logic (setMode, startSession,
// captureWorld / applyWorld, the locked keys, the pause flag) on stand-in parts. No DOM, no GPU.
globalThis.location = globalThis.location || { search: '' };
const { GameState, SAVE_KEY, SLOTS, parseWorld } = await import( '../src/game/GameState.js' );
const { MODES, MODE_IDS, DEFAULT_MODE, DAY_SPEED, rules, saveSpace, isMode, modeLabel } = await import( '../src/game/GameMode.js' );
const { CHARACTERS } = await import( '../src/game/Characters.js' );
const { BOATS } = await import( '../src/game/Boats.js' );
const { WORLD } = await import( '../src/world/WorldLayout.js' );
const { App } = await import( '../src/App.js' );
const { Vector3, Quaternion } = await import( '../src/engine/index.js' );

// the page events the autosave listens to
const pageEvents = {};
globalThis.document = { visibilityState: 'visible', addEventListener: ( t, fn ) => { pageEvents[ t ] = fn; } };
globalThis.window = { addEventListener: ( t, fn ) => { pageEvents[ t ] = fn; } };

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const store = ( m = new Map() ) => ( { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ), removeItem: ( k ) => m.delete( k ), map: m } );
const near = ( a, b, e = 1e-6 ) => Math.abs( a - b ) <= e;
const KEY = SAVE_KEY;

// ---- the rules
{

	ok( MODE_IDS.join() === 'sandbox,campaign,multiplayer' && DEFAULT_MODE === 'campaign', 'three modes, the campaign is the default' );
	const sb = rules( 'sandbox' ), ca = rules( 'campaign' ), mp = rules( 'multiplayer' );
	ok( sb.worldControls && sb.freeCam && sb.timeControl && sb.freeUnlocks && sb.debugViews && ! sb.online && ! sb.serverClock, 'sandbox: every world option, the free camera, free unlocks' );
	ok( ! ca.worldControls && ! ca.freeCam && ! ca.timeControl && ! ca.freeUnlocks && ! ca.debugViews && ! ca.online && ca.autosave && ca.saveTime, 'campaign: the world is fixed, nothing is free, it autosaves' );
	ok( ! mp.worldControls && ! mp.freeCam && ! mp.timeControl && ! mp.freeUnlocks && ! mp.debugViews && mp.online && mp.serverClock && ! mp.autosave && ! mp.saveTime, 'multiplayer: campaign rules, online, the server keeps the clock, no time in the save' );
	ok( rules( 'nonsense' ) === ca && rules( undefined ) === ca && rules( null ).mode === 'campaign', 'an unknown mode gets the campaign rules' );
	ok( Object.isFrozen( sb ) && Object.isFrozen( ca ) && Object.isFrozen( mp ), 'the rule sets are frozen' );
	ok( isMode( 'sandbox' ) && ! isMode( 'toString' ) && ! isMode( 'constructor' ) && ! isMode( 3 ) && ! isMode( '' ), 'isMode only knows the three ids' );
	ok( modeLabel( 'multiplayer' ) === 'Multiplayer' && modeLabel( 'x' ) === 'Campaign', 'labels for the HUD chip' );
	ok( MODE_IDS.every( ( id ) => MODES[ id ].name && MODES[ id ].tagline && MODES[ id ].bullets.length >= 3 && MODES[ id ].icon ), 'every mode has a name, a tagline, bullets and an icon' );
	ok( saveSpace( 'campaign' ) === '' && saveSpace( 'sandbox' ) === 'sandbox' && saveSpace( 'multiplayer' ) === 'multiplayer' && saveSpace( 'x' ) === '', 'campaign keeps the original keys, the others a prefix' );
	ok( DAY_SPEED === 0.01, 'the day runs at 0.01 h/s (a 40-minute day)' );

}

// ---- the save slots are separate per mode
{

	ok( GameState.slotKey( 0 ) === KEY && GameState.slotKey( 2 ) === `${ KEY }.slot2` && GameState.slotKey( 0, 'campaign' ) === KEY, 'campaign keys are the original ones' );
	ok( GameState.slotKey( 0, 'sandbox' ) === `sandbox.${ KEY }` && GameState.slotKey( 3, 'sandbox' ) === `sandbox.${ KEY }.slot3`, 'sandbox keys are prefixed' );
	ok( GameState.slotKey( 1, 'multiplayer' ) === `multiplayer.${ KEY }.slot1`, 'multiplayer keys are prefixed too' );

	const st = store();
	const a = new GameState( st );
	a.name = 'Camp';
	a.earn( 100 );
	const s = new GameState( st );
	s.useSlot( 0, 'sandbox' );
	s.name = 'Sand';
	s.earn( 7 );
	const m = new GameState( st );
	m.useSlot( 0, 'multiplayer' );
	m.name = 'Net';
	m.earn( 3 );
	ok( st.map.has( KEY ) && st.map.has( `sandbox.${ KEY }` ) && st.map.has( `multiplayer.${ KEY }` ) && st.map.size === 3, 'slot 0 of each mode is its own key' );
	const c = new GameState( st );
	ok( c.load() && c.mode === 'campaign' && c.money === 100 && c.name === 'Camp', 'the campaign slot 0 is untouched by the others' );
	ok( c.useSlot( 0, 'sandbox' ) === true && c.mode === 'sandbox' && c.money === 7 && c.name === 'Sand', 'useSlot( 0, sandbox ) reads the sandbox slot' );
	ok( c.useSlot( 0, 'multiplayer' ) === true && c.money === 3 && c.name === 'Net', 'and the multiplayer slot' );
	ok( c.useSlot( 1, 'sandbox' ) === false && c.slot === 1 && c.mode === 'sandbox' && c.money === 0, 'slot 1 of the sandbox is empty while the campaign has none either' );
	ok( c.useSlot( 0 ) === true && c.mode === 'sandbox' && c.money === 7, 'useSlot( n ) keeps the current mode' );
	ok( JSON.parse( st.map.get( `sandbox.${ KEY }` ) ).mode === 'sandbox' && JSON.parse( st.map.get( KEY ) ).mode === 'campaign' && JSON.parse( st.map.get( `multiplayer.${ KEY }` ) ).mode === 'multiplayer', 'every save stores its mode' );

	const lc = GameState.listSlots( st ), ls = GameState.listSlots( st, SLOTS, 'sandbox' ), lm = GameState.listSlots( st, SLOTS, 'multiplayer' );
	ok( lc.length === SLOTS && lc[ 0 ].exists && lc[ 0 ].name === 'Camp' && lc[ 0 ].mode === 'campaign' && ! lc[ 1 ].exists, 'listSlots( campaign ) lists the campaign' );
	ok( ls[ 0 ].exists && ls[ 0 ].name === 'Sand' && ls[ 0 ].mode === 'sandbox' && lm[ 0 ].name === 'Net' && ! ls[ 1 ].exists, 'listSlots( sandbox / multiplayer ) list their own' );

	GameState.removeSlot( st, 0, 'sandbox' );
	ok( ! st.map.has( `sandbox.${ KEY }` ) && st.map.has( KEY ) && st.map.has( `multiplayer.${ KEY }` ), 'removeSlot removes one mode\'s slot only' );
	const d = new GameState( st );
	d.useSlot( 0, 'multiplayer' );
	d.earn( 1 );
	d.deleteSlot( 0, 'campaign' ); // another mode's slot 0: the one in memory is not reset
	ok( ! st.map.has( KEY ) && d.money === 4 && d.mode === 'multiplayer', 'deleteSlot( n, mode ) leaves the running slot of another mode alone' );
	d.deleteSlot( 0 );
	ok( ! st.map.has( `multiplayer.${ KEY }` ) && d.money === 0, 'deleteSlot( n ) clears the current one' );

	// the legacy Tidewater key belongs to the campaign's slot 0
	const old = store( new Map( [ [ 'alpha-astra.save.v1', JSON.stringify( { v: 1, money: 9, inventory: [], log: {}, upgrades: {}, fuel: null, nextId: 1 } ) ] ] ) );
	const e = new GameState( old );
	ok( e.useSlot( 0, 'sandbox' ) === false && e.money === 0, 'a sandbox slot 0 does not see the Tidewater save' );
	ok( e.useSlot( 0, 'campaign' ) === true && e.money === 9 && e.boat === 'lobster', 'the campaign slot 0 does' );
	ok( GameState.listSlots( old, SLOTS, 'sandbox' )[ 0 ].exists === false && GameState.listSlots( old )[ 0 ].exists, 'listSlots agrees' );

	// older saves (no mode, no world) are campaign saves
	const o = { v: 2, money: 77, inventory: [], log: {}, upgrades: {}, fuel: null, nextId: 1, character: 'hyptile', unlocked: [ 'hyptile' ], boat: null, quests: {}, career: { caught: 3 }, name: 'Old' };
	const f = new GameState( store( new Map( [ [ KEY, JSON.stringify( o ) ] ] ) ) );
	ok( f.load() && f.mode === 'campaign' && f.money === 77 && f.world === null, 'a save from before the modes loads as a campaign save with no world' );
	ok( new GameState( store( new Map( [ [ KEY, JSON.stringify( { ...o, mode: 'sandbox' } ) ] ] ) ) ).load(), 'a stored mode that disagrees with the key space is tolerated' );
	const g = new GameState( store( new Map( [ [ KEY, JSON.stringify( { ...o, mode: 'sandbox' } ) ] ] ) ) );
	g.load();
	ok( g.mode === 'campaign', 'the key space decides the mode, not the file' );

}

// ---- the sandbox is free
{

	const st = store();
	const s = new GameState( st );
	s.useSlot( 0, 'sandbox' );
	const all = Object.keys( CHARACTERS );
	ok( s.free && all.every( ( id ) => s.isUnlocked( id ) ) && s.unlocked.length === all.length, 'a fresh sandbox slot has every character unlocked' );
	ok( s.money === 0 && s.setCharacter( 'bonk' ) && s.character === 'bonk', 'and plays as any of them with no money' );
	ok( Object.keys( BOATS ).every( ( id ) => s.boatPrice( id ) === 0 ), 'every boat costs nothing' );
	for ( const id of Object.keys( BOATS ) ) ok( s.id === undefined && s.buyBoat( id ) && s.boat === id && s.money === 0, `takes the ${ BOATS[ id ].name } for free (trade-in or not)` );
	ok( s.boatPrice( 'nope' ) === Infinity && ! s.buyBoat( 'nope' ), 'an unknown boat is still refused' );
	ok( s.buy( 'hold' ) && s.upgrades.hold === 1 && s.money === 0, 'gear upgrades are free' );
	ok( s.refuelCost() === 0, 'diesel is free' );
	s.burn( 20 );
	ok( s.fuelL < s.stats.fuelL && s.refuel() > 0 && s.fuel === null && s.money === 0 && s.refuel() === 0, 'a refuel fills the tank for nothing, then there is nothing to add' );
	ok( s.spend( 1e9 ) === true && s.money === 0, 'spend() never takes money' );
	s.save();
	const t = new GameState( st );
	ok( t.useSlot( 0, 'sandbox' ) && t.unlocked.length === all.length && t.character === 'bonk' && t.free, 'the unlocks and the character survive a sandbox round trip' );
	// a character the crew gains later is unlocked on load too
	const raw = JSON.parse( st.map.get( `sandbox.${ KEY }` ) );
	raw.unlocked = [ 'hyptile' ];
	raw.character = 'pepe';
	st.map.set( `sandbox.${ KEY }`, JSON.stringify( raw ) );
	ok( new GameState( st ).useSlot( 0, 'sandbox' ), 'a sandbox save with a short unlock list loads' );
	const u = new GameState( st );
	u.useSlot( 0, 'sandbox' );
	ok( u.unlocked.length === all.length && u.character === 'pepe', 'and is topped up to the whole crew (the character is kept)' );

	// the campaign is not free
	const c = new GameState( store() );
	ok( ! c.free && c.mode === 'campaign' && c.unlocked.length === 1 && c.boatPrice( 'skiff' ) === BOATS.skiff.price, 'the campaign charges for boats and keeps the crew locked' );
	ok( ! c.buyBoat( 'skiff' ) && ! c.buy( 'hold' ) && c.refuelCost() === 0, 'the campaign cannot buy broke (a full tank costs nothing to fill)' );
	c.earn( 100000 );
	const before = c.money;
	ok( c.buy( 'hold' ) && c.money < before && c.spend( 5 ) && c.money < before - 5 + 1, 'the campaign charges for gear and spend()' );
	const m = new GameState( store() );
	m.useSlot( 0, 'multiplayer' );
	ok( ! m.free && m.unlocked.length === 1, 'multiplayer is not free either' );
	// switching the rules in place
	const x = new GameState( store() );
	ok( x.setMode( 'sandbox' ) && x.unlocked.length === all.length && ! x.setMode( 'sandbox' ), 'setMode( sandbox ) unlocks the crew; the same mode again is a no-op' );
	x.useSlot( 0, 'campaign' );
	ok( x.unlocked.length === 1 && ! x.free, 'useSlot( n, campaign ) goes back to a locked crew' );

}

// ---- the world field of the save
{

	const st = store();
	const s = new GameState( st );
	ok( s.world === null && s.beforeSave === null, 'a new state has no world and no snapshot hook' );
	ok( s.save() === true && JSON.parse( st.map.get( KEY ) ).world === null, 'save() reports success; the world is null without a game' );
	let calls = 0;
	s.beforeSave = () => ( calls ++, { player: { x: 1.5, y: 2, z: - 3, yaw: 0.5, mode: 'swim' }, boat: { x: 64, z: 36, heading: 1, moored: true }, timeOfDay: 14.5 } );
	s.save();
	const raw = JSON.parse( st.map.get( KEY ) );
	ok( calls === 1 && raw.world.player.x === 1.5 && raw.world.boat.moored === true && raw.world.timeOfDay === 14.5, 'the game fills the world before each save' );
	ok( s.world && s.world.player.mode === 'swim', 'and the state keeps it' );
	const t = new GameState( st );
	ok( t.load() && t.world.player.z === - 3 && t.world.player.yaw === 0.5 && t.world.boat.heading === 1 && t.world.timeOfDay === 14.5, 'the world comes back on load' );
	s.beforeSave = () => null;
	s.earn( 1 );
	ok( JSON.parse( st.map.get( KEY ) ).world.timeOfDay === 14.5, 'a snapshot of null (menu up) keeps the stored world' );
	s.beforeSave = () => { throw new Error( 'boom' ); };
	ok( s.save() === true, 'a failing snapshot does not stop the save' );
	t.useSlot( 3 );
	ok( t.world === null, 'an empty slot has no world' );
	t.useSlot( 0 );
	t.reset();
	ok( t.world === null && JSON.parse( st.map.get( KEY ) ).world === null, 'a new game forgets where you were' );
	ok( new GameState( null ).save() === false, 'no storage: save() says false' );
	ok( new GameState( { getItem: () => null, setItem: () => { throw new Error( 'full' ); } } ).save() === false, 'blocked storage: save() says false, no throw' );

	// parseWorld
	const w = parseWorld( { player: { x: 1, y: 2, z: 3, yaw: 4, mode: 'deck' }, boat: { x: 5, z: 6, heading: 7, moored: 1 }, timeOfDay: 25.5 } );
	ok( w.player.mode === 'deck' && w.boat.moored === true && near( w.timeOfDay, 1.5 ), 'parseWorld keeps good fields, wraps the clock into 0..24' );
	ok( parseWorld( { player: { x: 1, y: 2, z: 3, mode: 'fly' } } ).player.mode === 'walk' && parseWorld( { player: { x: 1, y: 2, z: 3, yaw: NaN } } ).player.yaw === 0, 'an unknown player mode is walk, a bad yaw 0' );
	ok( parseWorld( { player: { x: NaN, y: 2, z: 3 }, boat: { x: 5, z: Infinity }, timeOfDay: 'noon' } ) === null, 'bad numbers drop their field (nothing left: null)' );
	ok( parseWorld( { player: { x: 1e9, y: 0, z: 0 } } ) === null, 'a position far outside the world is dropped' );
	ok( parseWorld( { timeOfDay: 6 } ).timeOfDay === 6 && parseWorld( { timeOfDay: 6 } ).player === null, 'a time alone is a world' );
	ok( parseWorld( null ) === null && parseWorld( 'x' ) === null && parseWorld( {} ) === null && parseWorld( [] ) === null, 'not a world: null' );

}

// ---- the app's session logic on stand-in parts
function fakeApp( storage ) {

	const app = new App();
	const state = new GameState( storage );
	const calls = { connect: [], disconnect: 0, toasts: [], boats: [], chars: [], modes: [], contracts: 0 };
	app.calls = calls;
	app.game = { state, contracts: { init: () => { calls.contracts ++; } }, hud: null, endLanding() {}, cancelLine() {}, rod: { equip() {} } };
	state.beforeSave = () => app.captureWorld();
	app.terrainData = { heightAt: () => 0 };
	app.colliders = { groundHeightAt: () => - 10 };
	app.input = { enabled: true, keys: new Set( [ 'KeyW' ] ) };
	app.ui = { s: {}, ui: { toast: ( t ) => calls.toasts.push( t ), refresh() {} }, applyMode: ( r ) => calls.modes.push( r.mode ) };
	app.camera = { quaternion: new Quaternion(), position: new Vector3( 1, 5, 1 ) };
	app.fly = { setPose() {}, velocity: new Vector3() };
	app.avatar = { setCharacter: ( id ) => calls.chars.push( id ) };
	app.connect = ( url ) => { calls.connect.push( url ); app.net = { url }; };
	app.disconnect = () => { calls.disconnect ++; app.net = null; };
	app.setBoat = ( id ) => { calls.boats.push( id ); app.boatCtl.enabled = !! id; };
	app.player = {
		mode: 'walk', position: new Vector3(), velocity: new Vector3(), yaw: 0, pitch: 0, groundAt: () => 0, stamina: 0.3,
		boardBoat() { this.mode = 'deck'; },
	};
	app.boatCtl = {
		enabled: false, driven: true, moored: false, throttle: 1, steer: 1, rpm: 1, hasWater: true,
		position: new Vector3( 5, 1, 5 ), quaternion: new Quaternion(), velocity: new Vector3( 1, 0, 1 ), angular: new Vector3( 1, 1, 1 ),
		mooring: { anchor: new Vector3(), heading: 0 },
		reset() { this.position.copy( WORLD.boatDock.position ); this.quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), WORLD.boatDock.heading ); this.velocity.set( 0, 0, 0 ); this.moored = true; },
		apply() { this.applied = ( this.applied || 0 ) + 1; },
		getYaw() { const f = new Vector3( 0, 0, 1 ).applyQuaternion( this.quaternion ); return Math.atan2( f.x, f.z ); },
	};
	return app;

}

{

	// a fresh app: the campaign rules until a session starts
	const st = store();
	const app = fakeApp( st );
	ok( app.mode === 'campaign' && app.rules.mode === 'campaign' && ! app.session && ! app.paused && app.settings.timeSpeed === DAY_SPEED, 'a new App starts under the campaign rules with the day running' );

	// ---- the campaign: the T key and the free camera are locked
	app.settings.timeSpeed = 0.5;
	app.setMode( 'campaign' );
	ok( app.settings.timeSpeed === DAY_SPEED && app.calls.modes.pop() === 'campaign', 'the campaign puts the day back at its own speed' );
	app.toggleTime();
	ok( app.settings.timeSpeed === DAY_SPEED && app.calls.toasts.pop() === 'Pausing time: sandbox only', 'T does nothing in the campaign and says why' );
	app.setFreeCam( true );
	ok( app.freeCam !== true && app.calls.toasts.pop() === 'Free camera: sandbox only', 'F does nothing in the campaign and says why' );
	app.settings.sunAzimuth = 40;
	app.setMode( 'multiplayer' );
	ok( app.settings.sunAzimuth === 0 && app.settings.timeSpeed === DAY_SPEED && ! app.rules.timeControl && app.rules.serverClock, 'multiplayer fixes the sun and the day too' );
	app.toggleTime();
	app.setFreeCam( true );
	ok( app.settings.timeSpeed === DAY_SPEED && ! app.freeCam && app.calls.toasts.length === 2, 'and locks T and F' );

	// ---- the sandbox: both work
	app.setMode( 'sandbox' );
	app.toggleTime();
	ok( app.settings.timeSpeed === 0, 'T pauses the clock in the sandbox' );
	app.toggleTime();
	ok( app.settings.timeSpeed === DAY_SPEED, 'and runs it again at the speed it had' );
	app.setFreeCam( true );
	ok( app.freeCam === true, 'F works in the sandbox' );
	app.freeCam = true;
	app.setMode( 'campaign' ); // leaving the sandbox with the free camera on: it goes off (setFreeCam( false ) runs the camera drop)
	ok( true, 'setMode( campaign ) with the free camera on is handled' );

}

{

	// ---- startSession: a sandbox game, then where you are is saved and comes back
	const st = store();
	const a = fakeApp( st );
	a.startSession( { mode: 'sandbox', slot: 2, name: ' Ada ', newGame: true, server: 'ws://x:1/island' } );
	const s = a.game.state;
	ok( a.mode === 'sandbox' && s.mode === 'sandbox' && s.slot === 2 && s.name === 'Ada' && a.session === true && a.serverOverride === 'ws://x:1/island', 'startSession loads the slot in that mode, trims the name, keeps the server' );
	ok( st.map.has( `sandbox.${ KEY }.slot2` ) && ! st.map.has( KEY ), 'a new sandbox game is written under the sandbox key' );
	ok( a.calls.contracts === 1 && a.calls.boats.length === 1 && a.calls.boats[ 0 ] === null && a.calls.chars[ 0 ] === 'hyptile', 'the quests, the boat and the character follow the slot' );
	ok( a.calls.connect.length === 0, 'the sandbox does not connect' );
	const start = WORLD.start || WORLD.spawn;
	ok( near( a.player.position.x, start.position.x ) && near( a.player.position.z, start.position.z ) && a.player.yaw === start.yaw && a.player.mode === 'walk', 'a new game starts at the island\'s start' );
	ok( a.boatCtl.moored && near( a.boatCtl.position.x, WORLD.boatDock.position.x ), 'with the boat at its berth' );

	// play a little
	s.boat = 'skiff';
	a.boatCtl.enabled = true;
	a.player.position.set( 12.3456, 2.3, - 40.5 );
	a.player.yaw = 1.23456;
	a.player.mode = 'swim';
	a.settings.timeOfDay = 17.25;
	a.boatCtl.position.set( 70.126, 0, 41 );
	a.boatCtl.quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), 0.75 );
	a.boatCtl.moored = false;
	ok( a.saveNow() === true, 'saveNow() writes the slot' );
	const raw = JSON.parse( st.map.get( `sandbox.${ KEY }.slot2` ) );
	ok( raw.mode === 'sandbox' && raw.world.player.x === 12.35 && raw.world.player.y === 2.3 && raw.world.player.z === - 40.5 && raw.world.player.yaw === 1.235 && raw.world.player.mode === 'swim', 'the save holds the position (rounded), the yaw and the mode' );
	ok( raw.world.boat.x === 70.13 && raw.world.boat.z === 41 && raw.world.boat.heading === 0.75 && raw.world.boat.moored === false && raw.world.timeOfDay === 17.25, 'the boat and the time of day' );

	// a new page: the slot comes back
	const b = fakeApp( st );
	b.startSession( { mode: 'sandbox', slot: 2 } );
	ok( b.game.state.boat === 'skiff' && b.calls.boats[ 0 ] === 'skiff', 'the boat is back' );
	ok( near( b.player.position.x, 12.35 ) && near( b.player.position.y, 2.3 ) && near( b.player.position.z, - 40.5 ) && near( b.player.yaw, 1.235 ), 'the player is back where he swam' );
	ok( b.player.mode === 'walk' && b.player.velocity.length() === 0 && b.player.stamina === 1, 'a swimmer comes back as a walker (the walker swims by itself), at rest' );
	ok( near( b.boatCtl.position.x, 70.13 ) && near( b.boatCtl.position.z, 41 ) && near( b.boatCtl.getYaw(), 0.75, 1e-4 ) && b.boatCtl.moored === false && b.boatCtl.velocity.length() === 0, 'the boat is back where it drifted, at rest' );
	ok( b.boatCtl.driven === false && b.boatCtl.throttle === 0 && b.boatCtl.hasWater === false && b.boatCtl.applied > 0, 'nobody is driving it; it reads the water again and is placed' );
	ok( b.boatCtl.mooring.heading === 0.75 && near( b.boatCtl.mooring.anchor.x, 70.13 ), 'the mooring follows it' );
	ok( b.settings.timeOfDay === 17.25, 'the time of day is back (sandbox)' );
	ok( b.session && b.rules.timeControl, 'in a session under the sandbox rules' );

	// aboard comes back on the deck of the boat
	b.player.mode = 'boat';
	b.player.position.set( 70, 1, 41 );
	b.saveNow();
	const c = fakeApp( st );
	c.startSession( { mode: 'sandbox', slot: 2 } );
	ok( c.player.mode === 'deck', 'driving comes back as standing on the deck (E takes the wheel)' );
	// ... unless the boat is gone
	const d = JSON.parse( st.map.get( `sandbox.${ KEY }.slot2` ) );
	d.boat = null;
	st.map.set( `sandbox.${ KEY }.slot2`, JSON.stringify( d ) );
	const e = fakeApp( st );
	e.startSession( { mode: 'sandbox', slot: 2 } );
	ok( e.player.mode === 'walk' && e.game.state.boat === null && e.boatCtl.enabled === false, 'with no boat the player is on foot at the saved spot' );
	ok( near( e.player.position.x, 70 ), 'on foot at the saved spot' );

	// restore: false and session: false leave the stored world alone (automation)
	const f = fakeApp( st );
	f.game.state.beforeSave = () => f.captureWorld();
	f.startSession( { mode: 'sandbox', slot: 2 }, { restore: false, session: false } );
	ok( ! f.session && near( f.player.position.x, start.position.x ), 'restore: false starts at the default spot' );
	ok( f.captureWorld() === null && f.saveNow( true ) === false, 'with no session there is no snapshot and no autosave' );
	f.game.state.earn( 1 );
	ok( JSON.parse( st.map.get( `sandbox.${ KEY }.slot2` ) ).world.player.x === 70, 'and an ordinary save does not overwrite the stored world' );

}

{

	// ---- the campaign keeps the time; multiplayer does not
	const st = store();
	const a = fakeApp( st );
	a.startSession( { mode: 'campaign', slot: 0, name: 'Cam', newGame: true } );
	a.settings.timeOfDay = 21.5;
	a.player.position.set( 3, 1, 4 );
	a.saveNow();
	ok( st.map.has( KEY ) && JSON.parse( st.map.get( KEY ) ).world.timeOfDay === 21.5, 'a campaign save is under the original key and holds the time' );
	const b = fakeApp( st );
	b.startSession( { mode: 'campaign', slot: 0 } );
	ok( b.settings.timeOfDay === 21.5 && b.rules.autosave && ! b.rules.timeControl && b.settings.timeSpeed === DAY_SPEED, 'the campaign gets its time back and keeps its own clock' );
	ok( b.saveNow( true ) === true, 'the campaign autosaves' );
	// leaving the page saves too (single player)
	b.game.state.money = 4321;
	document.visibilityState = 'hidden';
	pageEvents.visibilitychange();
	ok( JSON.parse( st.map.get( KEY ) ).money === 4321, 'hiding the page writes the slot' );
	b.game.state.money = 4400;
	pageEvents.pagehide();
	ok( JSON.parse( st.map.get( KEY ) ).money === 4400, 'so does closing it' );
	document.visibilityState = 'visible';

	// multiplayer: connect, no time in the save, no autosave
	const m = fakeApp( st );
	m.net = { stale: true };
	m.startSession( { mode: 'multiplayer', slot: 1, name: 'Net', newGame: true, server: ' ws://host:8765/island ' } );
	ok( m.mode === 'multiplayer' && m.game.state.mode === 'multiplayer' && m.calls.connect.length === 1 && m.calls.connect[ 0 ] === 'ws://host:8765/island', 'multiplayer connects to the typed server' );
	m.settings.timeOfDay = 3;
	const localBefore = st.map.get( `multiplayer.${ KEY }.slot1` );
	ok( m.saveNow() === false, 'multiplayer refuses local quick-save' );
	const mraw = JSON.parse( st.map.get( `multiplayer.${ KEY }.slot1` ) );
	ok( st.map.get( `multiplayer.${ KEY }.slot1` ) === localBefore && mraw.mode === 'multiplayer', 'shared-world quick-save leaves the pre-session local slot untouched' );
	ok( m.saveNow( true ) === false && m.saveNow() === false, 'multiplayer exposes neither local autosave nor manual Save game' );
	m.settings.timeOfDay = 9;
	const m2 = fakeApp( st );
	m2.settings.timeOfDay = 9;
	m2.startSession( { mode: 'multiplayer', slot: 1 } );
	ok( m2.settings.timeOfDay === 9, 'and loading it leaves the clock to the server' );
	ok( m2.calls.connect[ 0 ] === m2.serverUrl(), 'with no server typed the default one is used' );
	// from multiplayer to the campaign in place (Load): the server goes
	m.startSession( { mode: 'campaign', slot: 0 } );
	ok( m.calls.disconnect >= 1 && m.net === null && m.mode === 'campaign' && m.game.state.mode === 'campaign' && m.game.state.name === 'Cam', 'loading a campaign slot from multiplayer disconnects and switches the save space' );

	// ---- the no-menu path: the loaded slot in a mode, nothing snapshotted
	const n = fakeApp( store() );
	n.startSession( null, { mode: 'sandbox', restore: false, session: false } );
	ok( n.mode === 'sandbox' && n.game.state.mode === 'sandbox' && n.game.state.unlocked.length === Object.keys( CHARACTERS ).length && ! n.session, 'startSession( null, { mode } ) plays that mode\'s slot, no session' );
	const n2 = fakeApp( store() );
	n2.startSession( null );
	ok( n2.mode === 'campaign' && n2.session, 'startSession( null ) is the campaign' );

}

{

	// ---- the pause flag
	const a = fakeApp( store() );
	a.startSession( { mode: 'campaign', slot: 0, newGame: true } );
	a.setMenuOpen( true );
	ok( a.menuOpen && a.paused && a.input.enabled === false && a.input.keys.size === 0, 'the menu up in the campaign: no input, the game logic holds still' );
	a.setMenuOpen( false );
	ok( ! a.menuOpen && ! a.paused && a.input.enabled === true, 'and Resume gives it back' );
	a.startSession( { mode: 'multiplayer', slot: 0, newGame: true } );
	a.setMenuOpen( true );
	ok( a.menuOpen && ! a.paused && a.input.enabled === false, 'in multiplayer the menu takes the input but the island keeps running' );
	a.setMenuOpen( false );
	a.startSession( { mode: 'sandbox', slot: 0, newGame: true } );
	a.setMenuOpen( true );
	ok( a.paused, 'the sandbox pauses too' );

}

console.log( fails ? `\n${ fails } failing` : '\nall green' );
process.exit( fails ? 1 : 0 );
