// Plain-node tests of wave 16B (no DOM, no GPU): the welcome guide's pages and their key glyphs, the controls sheet (F1)
// reading the key bindings, the contextual tips (once per save, the touch wording, the triggers) and the i18n parity of
// every new string.
let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, String( v ) ), removeItem: ( k ) => m.delete( k ), map: m };

};

globalThis.localStorage = store();

const { default: en } = await import( '../src/i18n/en.js' );
const { default: ro } = await import( '../src/i18n/ro.js' );
const i18n = await import( '../src/i18n/index.js' );
const A = await import( '../src/ui/Accessibility.js' );
const { UI, CONTROLS, TOUCH_CONTROLS, controlKeyLabel, controlRefs } = await import( '../src/ui/UI.js' );
const { PAGES, MAX_LINES, TIP_KEYS, pageKeys, pageHTML, fillCaps } = await import( '../src/game/Guide.js' );
const { Tips, TIPS, install, landNear, calmDepth, SHORE, ALONGSIDE } = await import( '../src/game/Tips.js' );
const { Features } = await import( '../src/features/Features.js' );
const { SAFE_ZONES } = await import( '../src/features/naval/Routes.js' );
const { KEYS: PLANE_KEYS } = await import( '../src/features/seaplane/Seaplane.js' );

const a11y = () => new A.Accessibility( { storage: store(), doc: null } );
const enValues = new Set( Object.values( en ) );

// ---- i18n: both tables carry the same keys, and every new string is in both
{

	const enKeys = Object.keys( en ), roKeys = Object.keys( ro );
	ok( roKeys.every( ( k ) => k in en ), `ro.js has no key en.js lacks (${ enKeys.length } English keys; the game is English only)` );
	const vars = ( s ) => ( String( s ).match( /\{\w+\}/g ) || [] ).sort().join();
	ok( enKeys.filter( ( k ) => k in ro ).every( ( k ) => vars( en[ k ] ) === vars( ro[ k ] ) ), 'placeholders (key caps too) agree where both languages have the key' );
	const mine = enKeys.filter( ( k ) => /^(guide|tips)\./.test( k ) );
	ok( mine.length > 100 && mine.every( ( k ) => typeof en[ k ] === 'string' && en[ k ].length ), `${ mine.length } guide / tip strings in English` );
	ok( ! mine.some( ( k ) => /[şţ]/.test( ro[ k ] ) ), 'no cedilla forms in the new Romanian' );

}

// ---- the guide's pages
{

	const ids = PAGES.map( ( p ) => p.id );
	for ( const id of [ 'welcome', 'fishing', 'where', 'sail', 'combat', 'crew', 'planes', 'islands', 'trade', 'water', 'multi' ] ) ok( ids.includes( id ), `the guide has the ${ id } page` );
	ok( PAGES.every( ( p ) => p.lines.length >= 1 && p.lines.length <= MAX_LINES ), `every page keeps to ${ MAX_LINES } lines` );
	const keys = PAGES.flatMap( pageKeys ).concat( TIP_KEYS, [ 'guide.where.joe', 'guide.where.marta', 'guide.where.note', 'guide.next', 'guide.done', 'guide.skip' ] );
	const missing = keys.filter( ( k ) => ! ( k in en ) );
	ok( missing.length === 0, `every page text is in en.js ${ missing.join() }` );
	ok( PAGES.every( ( p ) => p.lines.every( ( l, i ) => en[ `guide.${ p.id }.${ i + 1 }` ].length <= 110 ) ), 'every line is short (110 characters at most)' );
	// the glyphs: every key ref resolves to a printed key, never a raw code
	const refs = PAGES.flatMap( ( p ) => p.lines.flatMap( ( l ) => l.keys || [] ) );
	ok( refs.every( ( r ) => r === 'Hold' || ! /^(Key|Digit|Quote|Bracket|Semicolon)/.test( controlKeyLabel( r ) ) ), 'every guide key ref prints as a key' );
	const page = ( id ) => PAGES.find( ( p ) => p.id === id );
	const planes = pageHTML( page( 'planes' ) ), combat = pageHTML( page( 'combat' ) ), water = pageHTML( page( 'water' ) );
	ok( planes.includes( '<kbd>\'</kbd>' ) && planes.includes( '<kbd>Shift</kbd><kbd>C</kbd>' ), 'planes: \' bails out, Shift / C throttle' );
	ok( combat.includes( '<kbd>Z</kbd><kbd>X</kbd>' ) && combat.includes( '<kbd>B</kbd>' ) && combat.includes( '<kbd>G</kbd>' ) && combat.includes( '<kbd>Tab</kbd>' ) && combat.includes( '<kbd>R</kbd> reloads' ), 'combat: Z / X guns, B boards, G gun, Tab aim part, R reloads' );
	ok( water.includes( '<kbd>Space</kbd>' ) && water.includes( '<kbd>F</kbd>' ), 'water: Space climbs, F holds a flare' );
	ok( ! /\{\w+\}/.test( PAGES.map( ( p ) => pageHTML( p ) ).join( '' ) ), 'no placeholder is left unfilled' );
	const touch = pageHTML( page( 'water' ), { touch: true } );
	ok( touch.includes( 'gm-chip' ) && touch.includes( 'Flare' ) && ! touch.includes( '<kbd>F</kbd>' ), 'touch: the button names instead of the keys' );
	// a rebound key shows on the page
	const ax = a11y();
	ax.rebind( 'board', 'KeyN' );
	ok( pageHTML( page( 'combat' ), { a11y: ax } ).includes( '<kbd>N</kbd>' ), 'the pages read the bindings (boarding on N)' );
	ok( fillCaps( 'Press {interact}', ax ) === 'Press <kbd>E</kbd>', 'fillCaps: {ref} is a key cap' );
	ok( PAGES[ PAGES.length - 1 ].id === 'multi' && PAGES.find( ( p ) => p.where ).id === 'where', 'the live directions are on their own page; multiplayer closes the guide' );
	i18n.setLang( 'ro' );
	ok( pageHTML( page( 'water' ) ).includes( 'Șalupa portului' ), 'the pages speak Romanian' );
	i18n.setLang( 'en' );

}

// ---- the controls sheet: every context, every action, the bindings
{

	const ctx = CONTROLS.map( ( s ) => s.id );
	for ( const id of [ 'foot', 'helm', 'deck', 'cockpit', 'swim', 'aim', 'ui' ] ) ok( ctx.includes( id ), `the sheet has the ${ id } context` );
	ok( TOUCH_CONTROLS.length >= 4 && TOUCH_CONTROLS.some( ( s ) => s.rows.some( ( r ) => r.chip === 'Flare' ) ) && TOUCH_CONTROLS.some( ( s ) => s.rows.some( ( r ) => r.chip === 'Bail out' ) ), 'the touch sheet has Flare and Bail out' );
	const texts = [];
	for ( const s of [ ...CONTROLS, ...TOUCH_CONTROLS ] ) {

		texts.push( s.title );
		for ( const r of s.rows ) texts.push( r.text, ...( r.small ? [ r.small ] : [] ), ...( r.chip ? [ r.chip ] : [] ) );

	}

	const untranslated = texts.filter( ( x ) => ! enValues.has( x ) );
	ok( untranslated.length === 0, `every sheet text is a value in en.js (so the DOM translator swaps it) ${ untranslated.slice( 0, 4 ).join( ' | ' ) }` );
	// every action and every key a feature reads is on the sheet
	const refs = controlRefs();
	const covered = new Set();
	for ( const r of refs ) {

		const a = A.ACTIONS.find( ( x ) => x.id === r || x.code === r );
		if ( a ) covered.add( a.id );

	}

	ok( A.ACTIONS.every( ( a ) => covered.has( a.id ) ), `every bindable action is listed ${ A.ACTIONS.filter( ( a ) => ! covered.has( a.id ) ).map( ( a ) => a.id ).join() }` );
	const codes = new Set( [ ...refs ].map( ( r ) => ( A.ACTIONS.find( ( x ) => x.id === r ) || { code: r } ).code ) );
	const feat = [ 'KeyG', 'KeyF', 'Tab', 'KeyB', 'KeyZ', 'KeyX', 'KeyQ', 'KeyJ', 'KeyM', ...PLANE_KEYS ];
	ok( feat.every( ( c ) => codes.has( c ) ), `every key the features claim is listed ${ feat.filter( ( c ) => ! codes.has( c ) ).join() }` );
	ok( [ ...refs ].every( ( r ) => r === 'mouse' || ! /^(Key|Digit|Quote|Bracket|Semicolon|Minus|Equal)/.test( controlKeyLabel( r ) ) ), 'every cap prints as a key' );
	// the bindings: a rebound action, and a raw code that follows the action owning it
	const ax = a11y();
	ok( controlKeyLabel( 'interact', ax ) === 'E' && controlKeyLabel( 'KeyF', ax ) === 'F' && controlKeyLabel( 'Quote', ax ) === '\'', 'default caps' );
	ax.rebind( 'interact', 'KeyG', { swap: true } );
	ax.rebind( 'freecam', 'KeyN' );
	ok( controlKeyLabel( 'interact', ax ) === 'G' && controlKeyLabel( 'KeyF', ax ) === 'N', 'caps follow a rebind (and a code follows the action that owns it)' );
	ax.unbind( 'time' );
	ok( controlKeyLabel( 'time', ax ) === A.keyLabel( '' ), 'an unbound action reads Unbound' );
	// the sheet's kbds refresh from the model (UI.refreshControls / bindControls, with a stub sheet)
	const kbds = [ { dataset: { key: 'interact' }, textContent: 'E' }, { dataset: { key: 'KeyF' }, textContent: 'F' }, { dataset: { key: 'LMB' }, textContent: 'LMB' } ];
	const sheet = { helpEl: { querySelectorAll: ( q ) => ( q === 'kbd[data-key]' ? kbds : [] ) }, refreshControls: UI.prototype.refreshControls };
	UI.prototype.bindControls.call( sheet, ax );
	ok( kbds[ 0 ].textContent === 'G' && kbds[ 1 ].textContent === 'N' && kbds[ 2 ].textContent === 'LMB', 'bindControls rewrites the caps' );
	ax.rebind( 'interact', 'KeyE', { swap: true } );
	ok( kbds[ 0 ].textContent === 'E', 'a rebind refreshes the open sheet' );
	ok( UI.prototype.refreshControls.call( sheet ) === 3, 'refreshControls reads every cap' );

}

// ---- the contextual tips
const mkApp = ( o = {} ) => {

	const said = [], toasts = [];
	const app = {
		player: { mode: 'walk', position: { x: 0, y: 0, z: 0 } },
		terrainData: { heightAt: ( x, z ) => ( Math.hypot( x - 5000, z - 5000 ) < 30 ? 2 : - 8 ) }, // one islet at (5000, 5000)
		boatLightsOn: true,
		game: { guide: o.guide === false ? null : { say: ( id, html ) => said.push( { id, html } ) }, toast: ( t ) => toasts.push( t ) },
		ui: { touch: { active: !! o.touch } },
		accessibility: o.a11y || null,
	};
	const features = new Features( app );
	const ships = [];
	let tradeOpen = false, night = false;
	features.add( 'naval', { install: () => ( { ships } ) } );
	features.add( 'trade', { install: () => ( { get isOpen() { return tradeOpen; }, openKind: 'market' } ) } );
	features.add( 'night', { install: () => ( { isNight: () => night } ) } );
	features.add( 'agents', { install: () => ( { agentOf: ( p ) => ( p === 'tidemark' ? { port: p } : null ) } ) } );
	const tips = features.add( 'tips', { install } );
	const tick = ( n = 1 ) => { for ( let i = 0; i < n; i ++ ) features.update( 0.6 ); };
	return { app, features, tips, said, toasts, ships, tick, setTrade: ( v ) => { tradeOpen = v; }, setNight: ( v ) => { night = v; } };

};

{

	ok( Object.keys( TIPS ).length === 11 && Object.values( TIPS ).every( ( x ) => x.text in en && ( ! x.touch || x.touch in en ) ), 'eleven tips (wave 20D: crew, navy, front, inside), each in en.js (with a touch wording where keys are named)' );
	const w = mkApp();
	const p = w.app.player;
	// the first take-off: once
	w.features.emit( 'planeTookOff', { id: 'seaplane' } );
	w.features.emit( 'planeTookOff', { id: 'seaplane' } );
	ok( w.said.length === 1 && w.said[ 0 ].id === 'tips.bail' && w.said[ 0 ].html.includes( '<kbd>\'</kbd>' ) && w.said[ 0 ].html.includes( '35 m' ), 'take-off: \' twice bails out above the chute\'s height, once' );
	// a foreign dock with an agent (not home, not a dock without one)
	w.features.emit( 'portVisited', { port: 'home' } );
	w.features.emit( 'portVisited', { port: 'gull' } );
	ok( ! w.tips.seen.has( 'agent' ), 'no agent tip at home or where there is no agent' );
	w.features.emit( 'portVisited', { port: 'tidemark' } );
	ok( w.tips.seen.has( 'agent' ) && w.said.at( - 1 ).html.includes( 'Roid &amp; Co.' ) === false && w.said.at( - 1 ).html.includes( 'Roid & Co.' ), 'a foreign dock: Roid & Co.\'s agent' );
	// the market window
	w.setTrade( true );
	w.tick();
	ok( w.tips.seen.has( 'market' ) && w.said.at( - 1 ).html.includes( 'best loads' ), 'the first market window: the best loads' );
	w.setTrade( false );
	// swimming: near land nothing, 20 m out the tip
	p.mode = 'swim';
	p.position.x = 5000; p.position.z = 5040; // 10 m off the islet's shore
	w.tick( 2 );
	ok( ! w.tips.seen.has( 'swim' ), `within ${ SHORE } m of land: no swim tip` );
	p.position.z = 5100;
	w.tick();
	ok( w.tips.seen.has( 'swim' ) && w.said.at( - 1 ).html.includes( '<kbd>Space</kbd>' ) && w.said.at( - 1 ).html.includes( '<kbd>F</kbd>' ), 'out in the water: Space climbs, F holds a flare' );
	// a crippled pirate alongside (a merchant does nothing)
	p.mode = 'boat';
	w.ships.push( { id: 7, alive: true, faction: 'merchant', x: 5010, z: 5100 }, { id: 8, alive: true, faction: 'pirate', x: 5300, z: 5100 } );
	w.features.emit( 'shipCrippled', { id: 7 } );
	w.features.emit( 'shipCrippled', { id: 8 } );
	w.tick();
	ok( ! w.tips.seen.has( 'board' ), `a crippled merchant alongside or a pirate ${ 300 } m off: no board tip` );
	w.ships[ 1 ].x = 5000 + ALONGSIDE / 2;
	w.tick();
	ok( w.tips.seen.has( 'board' ) && w.said.at( - 1 ).html.includes( '<kbd>B</kbd>' ), 'a crippled pirate alongside: B boards her' );
	// night at the helm with the lights off
	w.setNight( true );
	w.tick();
	ok( ! w.tips.seen.has( 'lights' ), 'lights on at night: no tip' );
	w.app.boatLightsOn = false;
	w.tick();
	ok( w.tips.seen.has( 'lights' ) && w.said.at( - 1 ).html.includes( '<kbd>L</kbd>' ), 'night at sea with the lights off: L lights the boat' );
	// heading out across the calm rim round home
	const z0 = SAFE_ZONES.find( ( s ) => s.id === 'landing' );
	p.position.x = z0.x; p.position.z = z0.z;
	w.tick();
	ok( ! w.tips.seen.has( 'calm' ) && calmDepth( z0.x, z0.z ) > 400, 'deep in the calm waters: nothing' );
	let steps = 0;
	while ( ! w.tips.seen.has( 'calm' ) && steps < 200 ) {

		p.position.x -= 5; // west, away from the home dock too
		w.tick();
		steps ++;

	}

	const d = calmDepth( p.position.x, p.position.z );
	ok( w.tips.seen.has( 'calm' ) && d > 0 && d < 45, `heading out: the calm tip at the rim (${ d.toFixed( 1 ) } m inside)` );
	ok( w.said.length === 7 && new Set( w.said.map( ( s ) => s.id ) ).size === 7, 'each of the seven tips fired once' );
	// the save: once per save
	const saved = w.features.toJSON().tips;
	ok( saved && saved.seen.length === 7, 'the seen tips are saved' );
	const w2 = mkApp();
	w2.features.fromJSON( { tips: saved } );
	ok( ! w2.tips.fire( 'bail' ) && w2.said.length === 0, 'a loaded save does not repeat a tip' );
	w2.features.reset();
	ok( w2.tips.fire( 'bail' ) && w2.said.length === 1, 'a new game shows them again' );
	ok( w2.tips.fire( 'nope' ) === false, 'an unknown tip is ignored' );

}

// ---- touch wording, the toast fallback, the bindings, Romanian
{

	const t = mkApp( { touch: true } );
	t.features.emit( 'planeTookOff', {} );
	ok( t.said[ 0 ].html.includes( '<b>Bail out</b>' ) && ! t.said[ 0 ].html.includes( '<kbd>' ), 'touch: the button names, no keys' );
	const n = mkApp( { guide: false } );
	n.features.emit( 'planeTookOff', {} );
	ok( n.toasts.length === 1 && ! n.toasts[ 0 ].includes( '<' ), 'no guide: a plain toast' );
	const ax = a11y();
	ax.rebind( 'jump', 'KeyK', { swap: true } );
	const b = mkApp( { a11y: ax } );
	ok( b.tips.html( 'swim', false ).startsWith( '<kbd>K</kbd>' ), 'the tip names the bound key' );
	i18n.setLang( 'ro' );
	ok( b.tips.html( 'calm', false ).includes( 'pirații' ) && b.tips.html( 'swim', true ).includes( 'Rachetă' ), 'Romanian tips (and touch buttons)' );
	i18n.setLang( 'en' );
	ok( landNear( null, 0, 0 ) === true && landNear( { heightAt: () => - 9 }, 0, 9999 ) === false, 'landNear: no map is never stranded; open sea is open' );
	ok( new Tips( {}, null ).fire( 'calm' ) === true, 'headless, without features or a game' );

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
