// Plain-node tests of Captain Roid: the clicks (stub audio context), his placement on a stub shore,
// the vendor kind 'yard', the proximity bursts, the boat yard panel wiring and the Talk tab (topics, subtitle
// timing, chat log; stub HUD).
//   node test/roid.mjs
import { Clicks, clickGain, BURSTS, TOPICS, linePhrases } from '../src/audio/Clicks.js';
import { renderLine, LINES } from '../src/audio/RoidVoice.js';
import { CaptainRoid, ROID, placeRoid, routineStop, WalkGrid, decodeRoidClips } from '../src/game/CaptainRoid.js';
import { Colliders } from '../src/world/Colliders.js';
import { Vector3 } from '../src/engine/index.js';
import { readFileSync } from 'node:fs';
import { YARD } from '../src/game/BoatYard.js';
import { BOATS } from '../src/game/Boats.js';
import { installHudPanels } from '../src/game/HudPanels.js';
import { Group } from '../src/engine/index.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// ---- a stub AudioContext that records what is built
function param( v = 0 ) {

	return { value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} };

}

function stubContext( state = 'running' ) {

	const c = { state, currentTime: 1, sampleRate: 8000, listenerDummy: 0, destination: { kind: 'dest' }, nodes: [], resumed: 0 };
	const node = ( kind, extra = {} ) => {

		const n = { kind, connect() {}, disconnect() {}, start() {}, stop() {}, ...extra };
		c.nodes.push( n );
		return n;

	};

	c.createGain = () => node( 'gain', { gain: param( 1 ) } );
	c.createOscillator = () => node( 'osc', { frequency: param( 440 ), type: 'sine' } );
	c.createBufferSource = () => node( 'src', { buffer: null, playbackRate: param( 1 ), started: null, start( ...a ) { this.started = a; } } );
	c.createBiquadFilter = () => node( 'filter', { frequency: param(), Q: param(), type: 'lowpass' } );
	c.createBuffer = ( ch, n ) => ( { length: n, getChannelData: () => new Float32Array( n ) } );
	c.resume = () => { c.resumed ++; return Promise.resolve(); };
	c.count = ( k ) => c.nodes.filter( ( n ) => n.kind === k ).length;
	c.clicks = () => c.count( 'src' ); // one buffer source per played slice
	c.reset = () => { c.nodes.length = 0; };
	return c;

}

// ---- the clicks: his click-and-call voice (RoidVoice), one rendered line per kind
const clicksFor = ( ctx, extra = {} ) => new Clicks( { getContext: () => ctx, getAudio: () => null, ...extra } );

{

	const ctx = stubContext();
	const cl = clicksFor( ctx );
	for ( const kind of Object.keys( BURSTS ) ) {

		ctx.reset();
		ctx.currentTime += 10; // the previous line has finished
		const said = cl.burst( kind );
		ok( !! said && ctx.clicks() === 1, `'${ kind }' speaks one rendered line (${ BURSTS[ kind ].line })` );
		if ( kind !== 'hover' ) ok( said.phrases.length >= 1 && said.phrases.every( ( ph ) => ph.text && ph.end > ph.start ), `'${ kind }' has timed subtitles` );

	}

	const first = linePhrases( 'first' );
	ok( first.phrases.length === 2 && first.phrases[ 1 ].start > first.phrases[ 0 ].end, 'the first greeting is two phrases, the second after a pause' );
	ok( linePhrases( 'repeat' ).phrases.length === 1, 'the repeat greeting is one phrase' );
	// the port renders exactly as the fork: same seeds give the same samples, a 0.85 peak
	const r1 = renderLine( LINES.first, 8000 ).samples, r2 = renderLine( LINES.first, 8000 ).samples;
	let peak = 0, same = r1.length === r2.length;
	for ( let i = 0; i < r1.length; i ++ ) { peak = Math.max( peak, Math.abs( r1[ i ] ) ); if ( r1[ i ] !== r2[ i ] ) same = false; }
	ok( same && Math.abs( peak - 0.85 ) < 1e-6, 'a line renders the same every time, normalised to 0.85' );

	// a hover tick never cuts a sentence short
	ctx.reset();
	ctx.currentTime += 10;
	cl.burst( 'open' );
	ok( cl.burst( 'hover' ) === false && ctx.clicks() === 1, 'hover is skipped while he is talking' );

	ctx.reset();
	ok( cl.burst( 'nope' ) === false && ctx.nodes.length === 0, 'an unknown kind builds nothing' );

	// gain falloff by distance
	ok( clickGain( 0 ) === 1 && clickGain( 2 ) === 1, 'gain is 1 within 2 m' );
	ok( clickGain( 18 ) === 0 && clickGain( 40 ) === 0, 'gain is 0 at 18 m' );
	ok( clickGain( 6 ) > clickGain( 10 ) && clickGain( 10 ) > clickGain( 16 ) && clickGain( 6 ) < 1, 'gain falls monotonically between' );
	const at = ( x ) => {

		const c2 = stubContext();
		const k = clicksFor( c2, { getListener: () => ( { x: 0, z: 0 } ) } );
		const played = k.burst( 'hello', { x, z: 0 } );
		return played ? c2.nodes.find( ( n ) => n.kind === 'gain' ).gain.value : 0;

	};

	const g1 = at( 1 ), g6 = at( 6 ), g12 = at( 12 ), g20 = at( 20 );
	ok( g1 > g6 && g6 > g12 && g12 > 0 && g20 === 0, `burst gain follows distance (${ [ g1, g6, g12, g20 ].map( ( v ) => v.toFixed( 3 ) ).join( ' > ' ) })` );
	ok( at( 18 ) === 0, 'nothing is built at 18 m' );

	// muted, volume
	const mute = clicksFor( ctx, { getAudio: () => ( { muted: true, volume: 1 } ) } );
	ctx.reset();
	ok( mute.burst( 'hello' ) === false && ctx.nodes.length === 0, 'muted: silent' );
	const quiet = clicksFor( ctx, { getAudio: () => ( { muted: false, volume: 0.5 } ) } );
	ctx.reset();
	quiet.burst( 'hello' );
	const gq = ctx.nodes.find( ( n ) => n.kind === 'gain' ).gain.value;
	ctx.reset();
	cl.burst( 'hello' );
	ok( gq < ctx.nodes.find( ( n ) => n.kind === 'gain' ).gain.value, 'the master volume scales the clicks' );

	// never throws
	const sus = stubContext( 'suspended' );
	ok( clicksFor( sus ).burst( 'hello' ) === false && sus.nodes.length === 0 && sus.resumed === 1, 'suspended: nothing played, a resume asked' );
	ok( new Clicks( { getContext: () => null } ).burst( 'hello' ) === false, 'no context: returns' );
	ok( new Clicks( { getContext: () => { throw new Error( 'x' ); } } ).burst( 'hello' ) === false, 'getContext throws: returns' );
	ok( new Clicks().burst( 'buy', { x: 1, z: 1 } ) === false, 'no options at all: returns' );
	const broken = stubContext();
	broken.createBufferSource = () => { throw new Error( 'boom' ); };
	ok( clicksFor( broken ).burst( 'hello' ) === false, 'a failing node factory is swallowed' );

	const fs = await import( 'node:fs' );
	ok( fs.existsSync( new URL( '../public/models/npc/captain-roid.glb', import.meta.url ) ), 'public/models/npc/captain-roid.glb exists' );

}

// ---- placement on a stub terrain: deep water to z -10, then a beach rising 0.3 m per metre
const beach = ( x, z ) => ( z >= - 10 ? - 2 : - 2 + ( - 10 - z ) * 0.3 );
{

	const yard = { x: 90, z: - 10 };
	const out = placeRoid( { heightAt: beach }, yard, { x: 0, z: 0, yaw: 0 } );
	const h = beach( out.x, out.z );
	ok( h >= 0.6 && h <= 2.0, `Roid stands on sand 0.6-2.0 m high (h = ${ h.toFixed( 2 ) })` );
	ok( yard.z - out.z <= 40 && out.z < yard.z, 'within 40 m of the moorings, toward the land' );
	let first = null;
	for ( let d = 0; d <= 40 && first === null; d += 0.5 ) { const hh = beach( yard.x, yard.z - d ); if ( hh >= 0.6 && hh <= 2.0 ) first = yard.z - d; }
	ok( Math.abs( out.z - first ) < 1e-9, 'it is the first such point' );
	ok( Math.abs( out.yaw - Math.atan2( yard.x - out.x, yard.z - out.z ) ) < 1e-9, 'he faces the moorings' );
	const flat = placeRoid( { heightAt: () => - 5 }, yard, { x: 0, z: 0, yaw: 0 } );
	ok( Number.isFinite( flat.x ) && Number.isFinite( flat.z ) && flat.z < yard.z, 'no sand: a fallback spot toward the land' );
	const near = placeRoid( { heightAt: ( x, z ) => ( z < - 60 ? 1 : - 2 ) }, { x: 85.5, z: - 40 }, { x: 0, z: 0, yaw: 0 } );
	ok( Math.hypot( near.x - 85.5, near.z + 60.5 ) >= 5, 'kept clear of the chandlery' );

}


// ---- the topics: the fork's five, rewritten for this island
{

	ok( TOPICS.map( ( t ) => t.label ).join( '|' ) === 'Who are you?|Where do I berth my boat?|Where is the fishing good?|Anything dangerous around here?|Goodbye.', 'the five topics of the fork, in its order' );
	ok( TOPICS.every( ( t ) => BURSTS[ t.kind ] ), 'every topic has a click kind' );
	ok( TOPICS.filter( ( t ) => t.closes ).length === 1 && TOPICS[ 4 ].closes, 'only Goodbye closes the panel' );
	const who = linePhrases( 'who' ).phrases.map( ( p ) => p.text );
	ok( who.length === 3 && who[ 0 ] === 'I am Roid, caretaker of this quay.' && who[ 2 ].startsWith( 'Do not ask me to translate' ), 'who: the fork\'s three phrases' );
	ok( [ 3301, 3302, 3303 ].every( ( sd, i ) => LINES.who.phrases[ i ].seed === sd ), 'who keeps the fork\'s seeds' );
	for ( const k of [ 'who', 'harbour', 'fishing', 'danger', 'bye' ] ) {

		const ph = linePhrases( k ).phrases;
		ok( ph.length >= 1 && ph.length <= 3 && ph.every( ( p, i ) => p.text && p.end > p.start && ( i === 0 || p.start > ph[ i - 1 ].end ) ), `'${ k }': 1-3 timed phrases in order` );

	}

	const said = ( k ) => linePhrases( k ).phrases.map( ( p ) => p.text ).join( ' ' );
	ok( /pier head/.test( said( 'harbour' ) ) && /boats, ships and guns/.test( said( 'harbour' ) ), 'harbour: the pier head, the yard sells boats, ships and guns' );
	ok( /reef to the west/.test( said( 'fishing' ) ) && /deep water south/.test( said( 'fishing' ) ) && /drop-off/.test( said( 'fishing' ) ) && /Pons Cove/.test( said( 'fishing' ) ) && /south-east/.test( said( 'fishing' ) ), 'fishing: the reef west, the deep south past the drop-off, Pons Cove south-east' );
	ok( /Pirates/.test( said( 'danger' ) ) && /night/.test( said( 'danger' ) ) && /storm/.test( said( 'danger' ) ) && /east beach/.test( said( 'danger' ) ) && /[Bb]lock/.test( said( 'danger' ) ) && /dodge/.test( said( 'danger' ) ), 'danger: pirates (night, storms), raiders on the east beach (block, dodge)' );
	ok( ! /quay|harbour|shoals/i.test( said( 'harbour' ) + said( 'fishing' ) + said( 'danger' ) ), 'the fork\'s quay / shoals wording is gone from the rewritten topics' );
	const fresh = [ ...LINES.harbour.phrases, ...LINES.fishing.phrases, ...LINES.danger.phrases ].filter( ( p ) => p.seed >= 9000 );
	ok( fresh.length >= 3 && fresh.every( ( p ) => p.seed >= 9100 && p.seed < 10000 ), 'new phrases use seeds 9xxx' );
	const seeds = Object.values( LINES ).flatMap( ( l ) => l.phrases.map( ( p ) => p.seed ) );
	ok( new Set( seeds ).size === seeds.length, 'no two phrases share a seed' );

}

// ---- the whole character
{

	const added = [];
	const scene = { add: ( o ) => added.push( o ) };
	const boxes = [];
	const colliders = { addBox: ( c, hlf, rot, o ) => { boxes.push( { c, hlf, rot, o } ); } };
	YARD.x = 92; YARD.z = - 10;
	const ctx = stubContext();
	const clicks = clicksFor( ctx, { getListener: () => ( { x: ROID.x, z: ROID.z } ) } );
	const roid = new CaptainRoid( { scene, terrain: { heightAt: beach }, colliders, clicks } );
	const v = roid.vendor;
	ok( v.kind === 'yard' && v.name === 'Captain Roid · Boat yard', 'the vendor is kind yard, named Captain Roid · Boat yard' );
	ok( v.greeting.includes( 'I am Captain Roid. Norwood class three.' ), 'his first greeting is the first-encounter line of the fork' );
	ok( Math.abs( v.position.x - ROID.x ) < 1e-9 && Math.abs( v.position.z - ROID.z ) < 1e-9, 'the vendor stands at ROID' );
	ok( added.length === 2 && added.every( ( o ) => o instanceof Group ), 'a prop group and the vendor are added to the scene' );
	ok( boxes.length >= 3 && boxes.every( ( b ) => b.o.tag ), `the sign posts and props are colliders (${ boxes.length })` );
	ok( roid.lights.length === 1 && roid.lights[ 0 ].kind === 'lantern' && roid.lights[ 0 ].position.y > v.position.y + 1, 'a lantern light for the root' );
	ok( v.inRange( { x: ROID.x + 2, y: v.position.y, z: ROID.z } ) && ! v.inRange( { x: ROID.x + 6, y: v.position.y, z: ROID.z } ), 'talk radius' );

	// proximity bursts
	const far = { x: ROID.x + 30, y: 0, z: ROID.z };
	const close = { x: ROID.x + 3, y: 0, z: ROID.z };
	ctx.reset();
	roid.update( 0.1, far );
	ok( ctx.clicks() === 0, 'nothing while the player is far' );
	roid.update( 0.1, close );
	const hello = ctx.clicks();
	ok( hello === 1, `a hello (the recording) when the player comes near (${ hello })` );
	roid.update( 0.1, close );
	ok( ctx.clicks() === hello, 'only once while they stay' );
	roid.update( 1, far );
	ok( ctx.clicks() === hello, 'no bye inside the 6 s cooldown' );
	roid.update( 7, far );
	roid.update( 0.1, close );
	ok( ctx.clicks() > hello, 'after the cooldown, coming back says hello again' );
	const n2 = ctx.clicks();
	roid.update( 7, { position: far } );
	ok( ctx.clicks() > n2, 'a bye when they leave (a body with .position works too)' );
	const n3 = ctx.clicks();
	roid.update( 7, null );
	ok( ctx.clicks() === n3, 'not on foot: nothing' );


	// first meeting: FirstEncounter once (remembered), afterwards Repeat; the panel greeting follows
	{

		const stubChar = { current: 'Idle' };
		v.character = stubChar;
		v.clips = { idle: 'Idle', talk: 'Repeat', greet: 'FirstEncounter' };
		let met = false, sets = 0;
		roid.hooks = { isMet: () => met, setMet: () => { met = true; sets ++; } };
		roid._seen = false;
		roid._opened = false;
		roid._scenes();
		ok( v.clips.greet === 'FirstEncounter' && v.greeting.includes( 'Norwood class three' ), 'not met: the greet clip is FirstEncounter' );
		stubChar.current = 'FirstEncounter';
		roid._scenes();
		ok( sets === 1 && met, 'when FirstEncounter plays the meeting is remembered' );
		ok( v.clips.greet === 'FirstEncounter', 'the first scene is not cut short' );
		stubChar.current = 'Idle';
		roid._scenes();
		ok( v.clips.greet === 'Repeat', 'afterwards the greet clip is Repeat' );
		ok( v.greeting.includes( 'Norwood class three' ), 'the panel keeps the first line until it has been opened' );
		roid.opened();
		roid._scenes();
		ok( v.greeting.includes( 'Back again?' ), 'then the repeat line' );
		// a loaded save that already met him
		roid._seen = false;
		roid._opened = false;
		roid._scenes();
		ok( v.clips.greet === 'Repeat' && v.greeting.includes( 'Back again?' ), 'met in the save: Repeat from the start' );
		v.character = null;
		v.clips = null;

	}

	// ---- the panel, on a stub HUD
	const els = [];
	function rows( html, sel ) {

		const attr = sel.slice( 1, - 1 );
		const out = [];
		for ( const m of html.matchAll( new RegExp( attr + '="([^"]*)"', 'g' ) ) ) {

			const key = attr.slice( 5 ).replace( /-(\w)/g, ( _, c ) => c.toUpperCase() );
			const e = { dataset: { boat: m[ 1 ], [ key ]: m[ 1 ] }, onclick: null, onmouseenter: null };
			out.push( e );
			els.push( e );

		}

		return out;

	}

	class StubHUD {

	_keepScroll( fn ) { fn(); } // (GameHUD keeps the stand list scrolled across re-renders; the stub just renders)

		constructor() {

			this.stand = { innerHTML: '', classList: { add() {}, remove() {} }, querySelector: () => ( {} ), querySelectorAll: ( sel ) => rows( this.stand.innerHTML, sel ) };

		}

		refresh() {

			if ( this.standOpen ) this.vendor && this.vendor.kind === 'shop' ? this.renderShop() : this.renderStand();

		}

		openStand( vendor ) {

			this.standOpen = true;
			this.vendor = vendor;
			if ( vendor.kind === 'shop' ) this.renderShop();
			else this.renderStand();

		}

		closeStand() { this.standOpen = false; }
		toggleInventory() {}
		renderStand() { this.joe = ( this.joe || 0 ) + 1; }
		renderShop() { this.stand.innerHTML = '<h2>shop</h2>'; }

	}

	installHudPanels( StubHUD );
	const state = { money: 5000, boat: null, boatPrice: ( id ) => BOATS[ id ].price };
	const buys = [];
	let buyOk = true;
	const hud = new StubHUD();
	hud.game = { state, roid, buyBoat: ( id ) => { buys.push( id ); return buyOk; } };
	ctx.reset();
	hud.openStand( v );
	const html = hud.stand.innerHTML;
	ok( hud.joe === undefined, 'the yard does not render as PoorGoat\'s stand' );
	ok( html.includes( 'Captain Roid' ) && Object.values( BOATS ).every( ( b ) => html.includes( b.name ) ), 'the panel lists every boat under Roid\'s name' );
	ok( Object.keys( BOATS ).every( ( id ) => html.includes( 'data-boat-id="' + id + '"' ) && html.includes( 'data-boat="' + id + '"' ) ), 'each row has data-boat-id and a buy button' );
	ok( html.includes( '*click click*' ), 'his greeting is in the panel' );
	const openClicks = ctx.clicks();
	ok( openClicks === 1, `a burst when the panel opens (${ openClicks })` );
	ok( html.includes( '$9,000' ) || html.includes( '$9000' ), 'prices show' );

	hud.refresh();
	ok( ctx.clicks() === openClicks, 'a refresh (money change) re-renders without the open burst' );
	ok( hud.joe === undefined, 'refresh keeps the yard panel for a yard vendor' );

	// hover: throttled to 150 ms
	els.length = 0;
	hud.renderYard();
	const rowEls = els.filter( ( e ) => e.onmouseenter );
	ok( rowEls.length === Object.keys( BOATS ).length, 'every boat row has a hover handler' );
	ctx.reset();
	ctx.currentTime += 10; // his 'open' line has finished
	rowEls[ 0 ].onmouseenter();
	const hv = ctx.clicks();
	ok( hv === 1, `hovering a row ticks (${ hv })` );
	rowEls[ 1 ].onmouseenter();
	ok( ctx.clicks() === hv, 'a second hover within 150 ms is throttled' );
	hud._yardHover -= 200;
	ctx.currentTime += 10;
	rowEls[ 1 ].onmouseenter();
	ok( ctx.clicks() === hv * 2, 'after 150 ms it ticks again' );

	// buying
	const btns = els.filter( ( e ) => e.onclick && e.dataset.boat in BOATS );
	ctx.reset();
	buyOk = false;
	btns[ 0 ].onclick();
	ok( buys.length === 1 && ctx.clicks() === 0, 'a refused purchase is silent' );
	buyOk = true;
	btns[ 0 ].onclick();
	ok( buys.length === 2 && buys[ 1 ] === btns[ 0 ].dataset.boat && ctx.clicks() === 1, `a purchase calls game.buyBoat and plays his buy line (${ ctx.clicks() })` );

	// Ethena's panel has lost the boats tab
	const marta = new StubHUD();
	marta.game = { state: { ...state, upgrades: {}, stats: { fuelL: 10 }, fuelL: 10, unlocked: [], refuelCost: () => 0, isUnlocked: () => false, character: 'hyptile' }, roid: null };
	marta.stand = { innerHTML: '', querySelector: () => ( {} ), querySelectorAll: () => [] };
	marta.vendor = { name: 'Ethena Prosper', greeting: 'hi', kind: 'shop' };
	marta.shopTab = 'boats';
	marta.renderShop();
	ok( ! marta.stand.innerHTML.includes( 'Boat yard' ) && ! marta.stand.innerHTML.includes( 'data-boat' ), 'Ethena no longer sells boats' );
	ok( marta.stand.innerHTML.includes( 'data-tab="gear"' ) && marta.stand.innerHTML.includes( 'data-tab="crew"' ), 'Ethena keeps gear and crew' );


		// ---- the Talk tab
		{

			const hudT = new StubHUD();
			const stateT = { ...state, money: 5000 };
			hudT.game = { state: stateT, roid, buyBoat: () => true };
			const subs = [];
			roid.hooks = { isMet: () => true, setMet() {}, subtitle: ( a ) => subs.push( a[ 0 ] ) };
			const timers = [], realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
			globalThis.setTimeout = ( fn, ms ) => { const t = { fn, ms, dead: false }; timers.push( t ); return t; };
			globalThis.clearTimeout = ( t ) => { if ( t ) t.dead = true; };
			const flush = () => { for ( const t of timers.sort( ( a, b ) => a.ms - b.ms ) ) if ( ! t.dead ) { t.dead = true; t.fn(); } };
			const topicBtn = ( id ) => { els.length = 0; hudT.renderYard(); return els.find( ( e ) => e.dataset.topic === id ); };

			try {

				ctx.reset();
				hudT.openStand( v );
				const h0 = hudT.stand.innerHTML;
				ok( h0.includes( 'data-tab="yard"' ) && h0.includes( 'data-tab="talk"' ), 'the yard panel has Yard and Talk tabs' );
				ok( h0.includes( 'data-boat-id=' ) && ! h0.includes( 'data-topic=' ), 'it opens on the Yard tab (boats, no topics)' );
				els.length = 0;
				hudT.renderYard();
				const tabEl = els.find( ( e ) => e.dataset.tab === 'talk' );
				tabEl.onclick();
				const h1 = hudT.stand.innerHTML;
				ok( hudT.yardTab === 'talk' && TOPICS.every( ( t ) => h1.includes( 'data-topic="' + t.id + '"' ) && h1.includes( t.label ) ), 'the Talk tab lists the five topics' );
				ok( ! h1.includes( 'data-boat-id=' ) && h1.includes( 'data-close' ), 'no boat rows on the Talk tab, Leave stays' );
				ok( h1.includes( 'Ask him something' ), 'an empty chat log says to ask' );

				subs.length = 0; // the 'open' line's subtitle
				// asking "Who are you?": the question at once, the first phrase with its calls, the rest on their timing
				ctx.reset();
				topicBtn( 'who' ).onclick();
				ok( ctx.clicks() === 1, 'choosing a topic speaks it (one rendered line)' );
				ok( subs.length === 1 && subs[ 0 ] === 'I am Roid, caretaker of this quay.', 'the first phrase is a subtitle at once' );
				const ph = linePhrases( 'who' ).phrases;
				const waits = timers.filter( ( t ) => ! t.dead && Math.abs( t.ms - ph[ 1 ].start * 1000 ) < 1e-6 || Math.abs( t.ms - ph[ 2 ].start * 1000 ) < 1e-6 );
				ok( waits.length === 2 && ph[ 1 ].start > 0.3 && ph[ 2 ].start > ph[ 1 ].start, `the other two subtitles wait for their calls (${ ph[ 1 ].start.toFixed( 2 ) } s, ${ ph[ 2 ].start.toFixed( 2 ) } s)` );
				let h2 = hudT.stand.innerHTML;
				ok( h2.includes( 'is-you">Who are you?' ) && h2.includes( 'is-roid">I am Roid, caretaker of this quay.' ), 'the chat log shows your question and his first phrase' );
				ok( ! h2.includes( 'The clicks and calls' ), 'the later phrases are not in the log before their time' );
				flush();
				h2 = hudT.stand.innerHTML;
				ok( subs.length === 3 && subs[ 1 ].startsWith( 'The clicks and calls' ) && subs[ 2 ].startsWith( 'Do not ask me' ), 'all three subtitles were shown, in order' );
				ok( h2.indexOf( 'caretaker' ) < h2.indexOf( 'The clicks and calls' ) && h2.indexOf( 'The clicks and calls' ) < h2.indexOf( 'Do not ask me to translate' ), 'the chat log has his phrases in order' );

				// a second topic cuts the first one's pending phrases short
				const before = subs.length;
				timers.length = 0;
				ctx.currentTime += 10;
				topicBtn( 'danger' ).onclick();
				const dangerStarts = linePhrases( 'danger' ).phrases.slice( 1 ).map( ( p ) => p.start * 1000 );
				const live = ( starts ) => timers.filter( ( t ) => ! t.dead && starts.some( ( m ) => Math.abs( m - t.ms ) < 1e-6 ) ).length;
				const pending = live( dangerStarts );
				topicBtn( 'fishing' ).onclick();
				const fishStarts = linePhrases( 'fishing' ).phrases.slice( 1 ).map( ( p ) => p.start * 1000 );
				ok( pending === 2 && live( dangerStarts.filter( ( m ) => ! fishStarts.some( ( f ) => Math.abs( f - m ) < 1e-6 ) ) ) === 0 && live( fishStarts ) >= 2 && subs.slice( before ).filter( ( x ) => /Pirates/.test( x ) ).length === 1, 'asking again cancels the earlier answer pending subtitles' );
				flush();
				const h3 = hudT.stand.innerHTML;
				ok( h3.includes( 'Fish the reef' ) && ! h3.includes( 'Raiders camp' ), 'only the latest answer finishes in the log' );
				ok( subs.slice( before ).every( ( x ) => ! /Raiders camp/.test( x ) ), 'the cut-off answer\'s later phrases never show' );

				// a purchase on the Yard tab still works after talking
				hudT.yardTab = 'yard';
				hudT.renderYard();
				ok( hudT.stand.innerHTML.includes( 'data-boat-id=' ), 'back on the Yard tab the boats are listed' );

				// a new visit starts on the Yard tab with an empty log
				hudT.closeStand();
				hudT.openStand( v );
				ok( hudT.yardTab === 'yard' && hudT.roidLog.length === 0, 'reopening the panel starts clean' );

				// Goodbye: his farewell, then the panel closes; nothing is added to a closed panel
				hudT.yardTab = 'talk';
				hudT.renderYard();
				ctx.reset();
				ctx.currentTime += 10;
				subs.length = 0;
				timers.length = 0;
				topicBtn( 'leave' ).onclick();
				ok( ctx.clicks() === 1 && subs[ 0 ] === 'Fair winds. Watch the tide and keep your lines dry.', 'Goodbye speaks the farewell with its subtitle' );
				ok( hudT.standOpen === false, 'Goodbye closes the panel' );
				ok( hudT.roidLog.length === 0, 'the farewell is not a chat line' );

				// without game.roid the answer's text is shown whole
				const bareT = new StubHUD();
				bareT.game = { state: stateT, buyBoat: () => true };
				bareT.openStand( v );
				bareT.yardTab = 'talk';
				bareT.renderYard();
				els.length = 0;
				bareT.renderYard();
				els.find( ( e ) => e.dataset.topic === 'harbour' ).onclick();
				const hb = bareT.stand.innerHTML;
				ok( hb.includes( 'Berth her at the pier head' ) && hb.includes( 'My yard sells boats, ships and guns' ), 'no game.roid: the answer is shown in full in the log' );

				// CaptainRoid.say without clicks (no audio at all) still gives the subtitles
				const mute = new CaptainRoid( { scene: { add() {} }, terrain: { heightAt: beach }, colliders: null, clicks: null } );
				const seen = [];
				mute.hooks = { subtitle: ( a ) => seen.push( a[ 0 ] ) };
				const log = [];
				ok( mute.say( 'danger', ( p ) => log.push( p.text ) ) === false && seen.length === 1 && log.length === 1, 'say() with no audio: false, but the first subtitle and chat phrase come' );
				flush();
				ok( seen.length === 3 && log.length === 3, 'and the rest follow on their timing' );

			} finally {

				globalThis.setTimeout = realSet;
				globalThis.clearTimeout = realClear;

			}

		}

	// no game.roid: the yard still opens
	const bare = new StubHUD();
	bare.game = { state, buyBoat: () => true };
	bare.stand = hud.stand;
	let threw = false;
	try { bare.openStand( v ); } catch ( e ) { threw = true; console.log( e ); }
	ok( ! threw, 'no game.roid: opening the yard does not throw' );

}


// ---- wave 5: his day (the routine on the island clock, the walk grid, standing on decks, the retargeted clips)
{

	// the schedule
	const day = new Set();
	for ( let h = 6; h < 21; h += 0.05 ) day.add( routineStop( h ) );
	ok( [ 'sign', 'boats', 'sea', 'crate', 'pier' ].every( ( s ) => day.has( s ) ), `the day visits the sign, the boats, the sea, the crate and the pier head (${ [ ...day ].join( ', ' ) })` );
	ok( routineStop( 15 ) === 'pier' && routineStop( 15.9 ) === 'pier' && routineStop( 14.99 ) !== 'pier' && routineStop( 16 ) !== 'pier', 'the pier head from 15 to 16 h' );
	const night = new Set();
	for ( let h = 21; h < 30; h += 0.05 ) night.add( routineStop( h ) );
	ok( [ ...night ].every( ( s ) => s === 'crate' || s === 'sign' ) && night.has( 'crate' ), 'at night: the crate and the sign only' );
	ok( routineStop( NaN ) === 'sign' && routineStop( null ) === 'sign' && routineStop( 34.2 ) === routineStop( 10.2 ) && routineStop( - 13.8 ) === routineStop( 10.2 ), 'no clock: the sign; hours wrap' );

	// placement: a boardwalk across the first sand puts him (and his props) beside it, not on it
	const walkLayout = { landing: { boardwalk: [ [ 70, - 19.5 ], [ 110, - 19.5 ] ] } };
	const onWalk = placeRoid( { heightAt: beach }, { x: 90, z: - 10 }, { x: 0, z: 0, yaw: 0 }, null, walkLayout );
	const hw = beach( onWalk.x, onWalk.z );
	ok( Math.abs( onWalk.z + 19.5 ) >= 2.1 && hw >= 0.6 && hw <= 2.0, `the yard is off the boardwalk, still on the sand (${ ( - 19.5 - onWalk.z ).toFixed( 1 ) } m inland of it, h ${ hw.toFixed( 2 ) })` );
	const free = placeRoid( { heightAt: beach }, { x: 90, z: - 10 }, { x: 0, z: 0, yaw: 0 }, null, { landing: null } );
	ok( free.z > onWalk.z, 'without the boardwalk he stands at the first sand' );

	// the walk grid: around a wall, onto a deck, nowhere when walled off
	const cols = new Colliders();
	cols.addBox( new Vector3( 5, 2, 0 ), new Vector3( 0.2, 1, 4 ), 0, { tag: 'wall' } );
	cols.addBox( new Vector3( 10, 0.9, 0 ), new Vector3( 1.5, 0.4, 1.5 ), 0, { walkable: true, tag: 'deck' } );
	const flat = { heightAt: () => 1 };
	const grid = new WalkGrid( { terrain: flat, colliders: cols, x0: - 5, z0: - 10, x1: 15, z1: 10 } );
	const path = grid.find( 0, 0, 10, 0 );
	let hits = 0, around = false, px = 0, pz = 0;
	for ( const q of path || [] ) {

		for ( let s = 1; s <= 20; s ++ ) {

			const x = px + ( q.x - px ) * s / 20, z = pz + ( q.z - pz ) * s / 20;
			if ( cols.resolveCapsule( { x, y: grid.groundAt( x, z, 1 ), z }, 0.3, 1.7, 0.4 ) ) hits ++;
			if ( Math.abs( z ) > 4 ) around = true;

		}

		px = q.x;
		pz = q.z;

	}

	ok( path && path.length >= 2 && Math.hypot( px - 10, pz ) < 0.01, `a grid path reaches the deck (${ path ? path.length : 0 } corners)` );
	ok( around && hits === 0, 'it goes round the wall, a 0.3 m capsule never touching it' );
	ok( Math.abs( grid.groundAt( 10, 0, 1 ) - 1.3 ) < 1e-9 && grid.groundAt( 0, 0, 1 ) === 1, 'on the deck the ground is the deck top, beside it the terrain' );
	const walled = new Colliders();
	walled.addBox( new Vector3( 5, 2, 0 ), new Vector3( 0.2, 1, 30 ), 0 );
	ok( new WalkGrid( { terrain: flat, colliders: walled, x0: - 5, z0: - 10, x1: 15, z1: 10 } ).find( 0, 0, 10, 0 ) === null, 'walled off: no path' );

	// the routine on the stub beach, with a stub character (clips by name)
	YARD.x = 92; YARD.z = - 10;
	const hourOf = ( stop, from = 6 ) => {

		for ( let h = from; h < 21; h += 0.01 ) if ( routineStop( h ) === stop ) return h;
		return null;

	};

	let hour = hourOf( 'sign' );
	const c2 = new Colliders();
	const r2 = new CaptainRoid( { scene: { add() {} }, terrain: { heightAt: beach }, colliders: c2, clock: () => hour, viewer: () => null, walk: true } );
	const v2 = r2.vendor;
	const played = [];
	const stub = {
		clips: new Map( [ 'Idle', 'FirstEncounter', 'Repeat', 'Talk', 'Idle_Breathe', 'Walk_InPlace', 'Look_Around', 'Sit_Down', 'Point' ].map( ( n ) => [ n, { name: n, duration: n === 'Sit_Down' ? 1.2 : 4 } ] ) ),
		layers: [], current: 'Idle', updates: 0,
		play( n, o = {} ) {

			this.current = n;
			played.push( n );
			const l = { clip: this.clips.get( n ), time: o.from || 0, target: 1, speed: o.speed ?? 1, loop: o.loop ?? true };
			this.layers = [ l ];
			return l;

		},
		clipDuration( n ) { return this.clips.get( n ).duration; },
		update() { this.updates ++; },
		hold() { this.held = true; },
	};
	v2.character = stub;
	v2.clips = { idle: 'Idle', talk: 'Repeat', greet: 'FirstEncounter' };
	r2._rt = true;
	r2.update( 0.1, null );
	const S = r2.stops;
	ok( Object.keys( S ).join() === 'sign,crate,boats,sea,pier' && Math.hypot( r2.pos.x - S.sign.x, r2.pos.z - S.sign.z ) < 1e-9, 'nobody near: he is at the stop of the hour (the sign)' );
	ok( v2.driven && stub.held, 'the vendor is driven by him (Game\'s loop skips it) and the far pose is held' );
	const before = v2.position.clone();
	v2.update( 1, { x: v2.position.x + 1, y: 0, z: v2.position.z } );
	ok( v2.position.equals( before ), 'Vendor.update does nothing for a driven vendor (no double animation)' );

	// a deck under the sea stop: he must stand on its planks, not in them
	const sea = S.sea, deckTop = beach( sea.x, sea.z ) + 0.35;
	c2.addBox( new Vector3( sea.x, deckTop - 0.3, sea.z ), new Vector3( 2.5, 0.3, 2.5 ), 0, { walkable: true, tag: 'testDeck' } );
	r2.grid = null;
	hour = hourOf( 'sea' );
	const watcher = { x: S.sign.x - 20, y: 0, z: S.sign.z - 20 }; // 28 m off: close enough to see him walk
	let maxStep = 0, last = { ...r2.pos }, steps = 0;
	for ( let i = 0; i < 400 && ! ( r2.arrived && r2.stopName === 'sea' ); i ++ ) {

		r2.update( 0.05, watcher );
		maxStep = Math.max( maxStep, Math.hypot( r2.pos.x - last.x, r2.pos.z - last.z ) );
		last = { ...r2.pos };
		steps ++;

	}

	ok( r2.arrived && Math.hypot( r2.pos.x - sea.x, r2.pos.z - sea.z ) < 0.01, `with someone near he walks to the next stop (${ ( steps * 0.05 ).toFixed( 1 ) } s)` );
	ok( maxStep <= 1.25 * 0.05 + 1e-6, `at a stroll (at most ${ ( maxStep / 0.05 ).toFixed( 2 ) } m/s)` );
	ok( played.includes( 'Walk_InPlace' ), 'the walk clip played on the way' );
	ok( Math.abs( r2.pos.y - deckTop ) < 1e-6 && Math.abs( v2.position.y - deckTop ) < 1e-6, `on the deck he stands on its top (${ r2.pos.y.toFixed( 2 ) } m, terrain ${ beach( sea.x, sea.z ).toFixed( 2 ) } m)` );
	ok( v2.position.x === r2.pos.x && v2.group.position.x === r2.pos.x, 'the vendor (prompt, panel, clicks) follows his live position' );
	for ( let i = 0; i < 20; i ++ ) r2.update( 0.05, watcher );
	ok( stub.current === 'Look_Around', 'at the sea he looks around' );

	// the player walks up while he is on the way: he stops, turns to them, greets
	hour = hourOf( 'boats' );
	for ( let i = 0; i < 6; i ++ ) r2.update( 0.05, watcher );
	const mid = { ...r2.pos };
	const player = { x: mid.x + 4, y: mid.y, z: mid.z };
	r2.update( 0.05, player );
	const stopAt = { ...r2.pos };
	for ( let i = 0; i < 40; i ++ ) r2.update( 0.05, player );
	const face = Math.atan2( player.x - r2.pos.x, player.z - r2.pos.z );
	ok( Math.hypot( r2.pos.x - stopAt.x, r2.pos.z - stopAt.z ) < 1e-9 && Math.hypot( mid.x - S.boats.x, mid.z - S.boats.z ) > 0.5, 'within 6 m of the player he stops (on his way)' );
	ok( Math.abs( Math.atan2( Math.sin( r2.yaw - face ), Math.cos( r2.yaw - face ) ) ) < 0.05, 'and turns to face them' );
	ok( played.includes( 'FirstEncounter' ), 'and greets (FirstEncounter the first time)' );
	ok( v2.inRange( { x: r2.pos.x + 2, y: r2.pos.y, z: r2.pos.z } ), 'the talk range is round where he is' );
	v2.talking = true;
	r2.update( 0.05, player );
	ok( stub.current === 'Talk', 'with his panel open he talks (the retargeted Talk)' );
	v2.talking = false;
	// they leave: he goes on to his stop
	for ( let i = 0; i < 400 && ! ( r2.arrived && r2.stopName === 'boats' ); i ++ ) r2.update( 0.05, watcher );
	ok( r2.arrived && Math.hypot( r2.pos.x - S.boats.x, r2.pos.z - S.boats.z ) < 0.01, 'when the player leaves he walks on to the boats' );

	// the crate: he sits, and stands up when the player comes
	hour = hourOf( 'crate' );
	for ( let i = 0; i < 600 && r2.pose !== 'sitting'; i ++ ) r2.update( 0.05, watcher );
	ok( r2.pose === 'sitting' && stub.current === 'Sit_Down' && Math.hypot( r2.pos.x - S.crate.x, r2.pos.z - S.crate.z ) < 0.01, 'at the crate he sits down' );
	r2.update( 0.05, { x: r2.pos.x + 3, y: r2.pos.y, z: r2.pos.z } );
	ok( r2.pose === 'rising' && stub.layers[ 0 ].speed === - 1, 'the player comes: he gets up (Sit_Down backward)' );

	// the clips file: six retargeted clips that decode onto his node names
	const data = JSON.parse( readFileSync( new URL( '../public/models/npc/captain-roid-clips.json', import.meta.url ), 'utf8' ) );
	const names = [ ...new Set( Object.values( data.clips ).flatMap( ( c ) => c.channels.map( ( ch ) => ch.node ) ) ), 'pelvis' ];
	const clips = decodeRoidClips( data, names );
	const unit = clips.every( ( c ) => c.channels.filter( ( ch ) => ch.path === 'rotation' ).every( ( ch ) => {

		for ( let k = 0; k < ch.values.length; k += 4 ) if ( Math.abs( Math.hypot( ch.values[ k ], ch.values[ k + 1 ], ch.values[ k + 2 ], ch.values[ k + 3 ] ) - 1 ) > 2e-3 ) return false;
		return ch.times.length * 4 === ch.values.length;

	} ) );
	ok( [ 'Idle_Breathe', 'Walk_InPlace', 'Look_Around', 'Sit_Down', 'Talk', 'Point' ].every( ( n ) => clips.some( ( c ) => c.name === n ) ), 'the clips file has Idle_Breathe, Walk_InPlace, Look_Around, Sit_Down, Talk and Point' );
	ok( unit, 'every decoded key is a unit quaternion' );
	const walkClip = clips.find( ( c ) => c.name === 'Walk_InPlace' ), pel = walkClip.channels.find( ( ch ) => ch.path === 'translation' );
	ok( pel && pel.values.length === pel.times.length * 3 && walkClip.channels.filter( ( ch ) => ch.times.length > 1 ).length >= 15, 'the walk moves the legs and the pelvis' );
	const idleMoves = clips.find( ( c ) => c.name === 'Idle_Breathe' ).channels.filter( ( ch ) => ch.path === 'rotation' && ch.times.length > 1 ).length;
	ok( idleMoves >= 10, `his idle breathes (${ idleMoves } moving bones; his own Idle has none)` );
	ok( data.walkSpeed > 1.2 && data.walkSpeed < 2.2, `the walk's stride speed on his longer legs (${ data.walkSpeed } m/s at rate 1)` );

}

console.log( fails ? '\n' + fails + ' failed' : '\nall passed' );
process.exit( fails ? 1 : 0 );
