// Plain-node test of the crew feature (src/features/crew: Crew.js, Deck.js, index.js) with the naval feature's crew guns
// (Naval.crewTarget / crewFire): berths per hull, posting rules and the posting UI rows / HTML, the save round trip, gunner
// fire decisions (hostile, merchant, peaceful waters, crippled / struck, reload x1.6, spread x1.5, the skipper aboard, the
// skipper's own aimed side, the side pick), the gunners' HUD line, angler timing (45-90 s, trolling at half rate, not under
// way, not in port) and the cooler's capacity, the catch through the game's entry point (quests, career, fishCaught, the
// toast), bait per cast, and the deck figures (riding the boat, clips, the rod, the phone budget).
//   node test/feature-crew.mjs
import { Features } from '../src/features/Features.js';
import { Naval, GUN_LEVELS, CRIPPLE } from '../src/features/naval/Naval.js';
import * as crewModule from '../src/features/crew/index.js';
import { Crew, CREW_RULES, BERTHS, berthsOf, deckPoint, anglerRate, catchInterval } from '../src/features/crew/Crew.js';
import { CrewDeck } from '../src/features/crew/Deck.js';
import { BOATS, BOAT_IDS } from '../src/game/Boats.js';
import { CHARACTERS } from '../src/game/Characters.js';
import { FISH } from '../src/game/FishTable.js';
import { GameState } from '../src/game/GameState.js';
import { makeRng } from '../src/features/naval/util.js';
import { Vector3, Quaternion, Matrix4 } from '../src/engine/index.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const near = ( a, b, e = 1e-6 ) => Math.abs( a - b ) <= e;
const section = ( s ) => console.log( '\n== ' + s );
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ), removeItem: ( k ) => m.delete( k ) };

};

// ------------------------------------------------------------------------------------------------ stand-ins

function makeApp( { mode = 'campaign', boat = 'lobster', unlocked = [ 'hyptile', 'pepe', 'doge', 'pengu', 'bonk' ] } = {} ) {

	const toasts = [];
	const state = new GameState( store() );
	state.boat = boat;
	state.unlocked = [ ...unlocked ];
	state.character = 'hyptile';
	const caught = [];
	const input = { hit: () => false, rightDown: false, mouseDown: false, enabled: true };
	const app = {
		mode, settings: { timeOfDay: 12 },
		terrainData: { heightAt: () => - 12 }, query: null, spray: null, scene: null, audio: null,
		boatCtl: { position: new Vector3( 0, 0, 1500 ), quaternion: new Quaternion(), velocity: new Vector3(), angular: new Vector3(), driven: true, moored: false, speed: 0, enabled: true },
		boat: { dimensions: { length: 8.2, beam: 2.9, draft: 0.85, freeboard: 0.9 } },
		camera: { position: new Vector3( 0, 4, 1490 ), quaternion: new Quaternion(), fov: 60, aspect: 16 / 9 },
		player: { mode: 'boat', camMode: 'third', position: new Vector3( 0, 1, 1500 ) },
		input,
		game: {
			state, hour: 12, toast( t ) { toasts.push( t ); },
			contracts: { onCatch( info ) { caught.push( info ); } },
			habitatAtPoint: null,
		},
		toasts, caught,
	};
	return app;

}

function setup( opts = {} ) {

	const app = makeApp( opts );
	const features = new Features( app );
	const events = [];
	for ( const n of [ 'cannonFired', 'fishCaught', 'crewPosted' ] ) features.on( n, ( e ) => events.push( [ n, e ] ) );
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 5, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	const crew = features.add( 'crew', { install: ( a, f ) => crewModule.install( a, f, { rng: makeRng( 11 ), deck: false, doc: null } ) } );
	return { app, features, naval, crew, events };

}

const run = ( features, seconds, dt = 1 / 30 ) => { for ( let i = 0, n = Math.round( seconds / dt ); i < n; i ++ ) features.update( dt ); };
const shots = ( events, crewId = null ) => events.filter( ( e ) => e[ 0 ] === 'cannonFired' && e[ 1 ].by === 'player' && ( crewId === null || e[ 1 ].crew === crewId ) );

// ================================================================================================ 1. berths
section( '1. berths per hull' );
{

	const want = { skiff: 0, canoe: 0, cutter: 1, launch: 1, lobster: 2, trawler: 3, sloop: 3, brigantine: 4 };
	ok( BOAT_IDS.every( ( id ) => berthsOf( id ) === want[ id ] ), `berths: ${ BOAT_IDS.map( ( id ) => `${ id } ${ berthsOf( id ) }` ).join( ', ' ) }` );
	ok( JSON.stringify( BERTHS ) === JSON.stringify( want ), 'the fallback table carries the brief\'s numbers' );
	ok( berthsOf( null ) === 0 && berthsOf( 'raft' ) === 0, 'on foot / unknown: no berths' );
	BOATS.cutter.berths = 2;
	ok( berthsOf( 'cutter' ) === 2, 'a `berths` field in Boats.js wins (once root adds it)' );
	delete BOATS.cutter.berths;

}

// ================================================================================================ 2. posts
section( '2. posting: rules, rows, the HTML control, persistence' );
{

	const c = new Crew();
	const ctx = { boat: 'lobster', unlocked: [ 'hyptile', 'pepe', 'doge', 'pengu' ], character: 'hyptile' };
	ok( c.setPost( 'pepe', 'gunner', ctx ).ok && c.postOf( 'pepe' ) === 'gunner', 'Pepe posted as a gunner' );
	ok( c.setPost( 'hyptile', 'angler', ctx ).reason === 'playing', 'the one being played cannot be posted' );
	ok( c.setPost( 'bonk', 'angler', ctx ).reason === 'not hired', 'an unhired character cannot' );
	ok( c.setPost( 'pengu', 'angler', ctx ).ok, 'Pengu posted as an angler' );
	ok( c.setPost( 'doge', 'angler', ctx ).reason === 'full', 'the lobster boat has two berths: the third is refused' );
	ok( c.setPost( 'pengu', 'gunner', ctx ).ok && c.gunners().length === 2, 'Pengu switches posts in his own berth (gunner)' );
	const big = { ...ctx, boat: 'brigantine' };
	ok( c.setPost( 'doge', 'gunner', big ).reason === 'guns manned', 'a third gunner is refused: one per broadside' );
	ok( c.setPost( 'doge', 'angler', big ).ok, 'on the brigantine Doge takes a third berth as an angler' );
	ok( c.setPost( 'pepe', 'gunner', big ).ok, 're-posting to the same post is fine' );
	ok( c.setPost( 'doge', 'off', ctx ).ok && c.posts.size === 2, 'Doge off duty again' );
	ok( new Crew().setPost( 'pepe', 'gunner', { ...ctx, boat: 'canoe' } ).reason === 'no berths', 'a canoe has no berths' );
	const rows = c.rows( ctx );
	const pepe = rows.find( ( r ) => r.id === 'pepe' ), bonk = rows.find( ( r ) => r.id === 'bonk' ), doge = rows.find( ( r ) => r.id === 'doge' );
	ok( rows.length === Object.keys( CHARACTERS ).length && pepe.hired && pepe.post === 'gunner' && pepe.choices.find( ( x ) => x.post === 'gunner' ).on, 'rows: one per character, Pepe on Gunner' );
	ok( ! bonk.hired && bonk.choices.filter( ( x ) => x.post !== 'off' ).every( ( x ) => ! x.enabled ), 'unhired: posts greyed' );
	ok( doge.choices.find( ( x ) => x.post === 'angler' ).why === 'Every berth is taken (2)', `the greyed reason: "${ doge.choices.find( ( x ) => x.post === 'angler' ).why }"` );
	// sync: a smaller hull sends the last posted ashore; the played character leaves the post
	const dropped = c.sync( { ...ctx, boat: 'cutter' } );
	ok( dropped.length === 1 && dropped[ 0 ].id === 'pengu' && dropped[ 0 ].why === 'berth' && c.posts.size === 1 && c.postOf( 'pepe' ) === 'gunner', 'down to the cutter (1 berth): the last posted goes ashore' );
	ok( c.sync( { ...ctx, boat: null } ).length === 0 && c.posts.size === 1, 'on foot the posts wait' );
	const d2 = c.sync( { ...ctx, character: 'pepe' } );
	ok( d2.length === 1 && d2[ 0 ].why === 'playing' && c.posts.size === 0, 'playing Pepe takes him off his post' );

	// the feature: setPost toasts and emits, the HTML control, the save
	const { app, features, crew, events } = setup();
	ok( typeof crew.update === 'function' && typeof crew.toJSON === 'function' && typeof crew.fromJSON === 'function' && typeof crew.reset === 'function' && typeof crew.dispose === 'function' && typeof crew.berths === 'function' && typeof crew.rows === 'function', 'install returns { update, toJSON, fromJSON, reset, dispose, posts, berths(), setPost(), rows() }' );
	ok( crew.berths() === 2, 'berths() of the current hull' );
	const r = crew.setPost( 'pepe', 'gunner' );
	ok( r.ok && /Pepe is posted as a gunner/.test( app.toasts.pop() ) && events.some( ( e ) => e[ 0 ] === 'crewPosted' && e[ 1 ].id === 'pepe' && e[ 1 ].post === 'gunner' ), 'setPost: a toast and crewPosted { id, post }' );
	crew.setPost( 'pengu', 'angler' );
	ok( JSON.stringify( crew.posts ) === JSON.stringify( { pepe: 'gunner', pengu: 'angler' } ), 'posts: { pepe: gunner, pengu: angler }' );
	const html = crew.postHtml( 'doge' );
	ok( /data-crew-post="gunner" data-crew-id="doge" disabled/.test( html ) && /Every berth is taken/.test( html ), 'the card control: Doge\'s posts greyed (no free berth), with the reason' );
	ok( crew.postHtml( 'hyptile' ) === '' && crew.postHtml( 'clown' ) === '', 'no control for the one played or an unhired one' );
	ok( /data-crew-post="off" data-crew-id="pepe"/.test( crew.postHtml( 'pepe' ) ) && /class="is-on" data-crew-post="gunner"/.test( crew.postHtml( 'pepe' ) ), 'Pepe\'s control: Off / Gunner (on) / Angler' );
	ok( crew.berthNote() === 'Crew berths on the lobster boat: 2 of 2 taken', `the tab note: "${ crew.berthNote() }"` );
	const clicks = [];
	const btn = { dataset: { crewId: 'pepe', crewPost: 'off' }, onclick: null };
	crew.bindPosts( { querySelectorAll: () => [ btn ] }, () => clicks.push( 1 ) );
	btn.onclick();
	ok( crew.posts.pepe === undefined && clicks.length === 1, 'bindPosts: a click posts and re-renders' );
	crew.setPost( 'pepe', 'gunner' );
	const saved = JSON.parse( JSON.stringify( features.toJSON() ) );
	ok( saved.crew && saved.crew.v === 2 && saved.crew.posts.length === 2, 'the posts are in the features save (toJSON)' );
	const b = setup();
	b.features.fromJSON( saved );
	ok( JSON.stringify( b.crew.posts ) === JSON.stringify( { pengu: 'angler', pepe: 'gunner' } ), 'and come back on load, in posting order' );
	b.crew.fromJSON( { v: 1, posts: [ [ 'nobody', 'gunner' ], [ 'doge', 'captain' ], 'junk' ] } );
	ok( Object.keys( b.crew.posts ).length === 0, 'bad save data is ignored' );
	b.crew.setPost( 'pepe', 'angler' );
	b.crew.reset();
	ok( Object.keys( b.crew.posts ).length === 0, 'reset: nobody posted' );

}

// ================================================================================================ 3. gunners
section( '3. gunners: fire decisions through naval.crewFire' );
{

	const saved = GUN_LEVELS[ 1 ].spread;
	const { app, features, naval, crew, events } = setup();
	crew.setPost( 'pepe', 'gunner' );
	ok( naval.playerGun.owned === false, 'campaign without a swivel gun' );
	const s = naval.spawn( 'sloop', { x: 120, z: 1500, yaw: 0 } );
	s.state = 'dock';
	run( features, 1 );
	ok( shots( events ).length === 0, 'no gun: the gunner has nothing to fire' );
	naval.playerGun.owned = true;
	const sigmas = [];
	const launch = naval._launch.bind( naval );
	naval._launch = ( m, dir, sigma, o ) => { sigmas.push( [ sigma, o.crew ] ); return launch( m, dir, sigma, o ); };
	run( features, 1 / 30 );
	const first = shots( events, 'pepe' );
	ok( first.length === 1 && first[ 0 ][ 1 ].side === 'port', 'a hostile pirate 120 m off the port beam: Pepe fires the port gun (cannonFired crew: pepe)' );
	ok( near( naval.reloadLeft.port, naval.reloadTime() * 1.6, 1e-6 ) && near( naval.reloadTotal.port, naval.reloadTime() * 1.6, 1e-9 ), `reload x1.6 (${ naval.reloadTotal.port.toFixed( 2 ) } s against ${ naval.reloadTime().toFixed( 2 ) })` );
	ok( sigmas.length === 1 && near( sigmas[ 0 ][ 0 ], GUN_LEVELS[ naval.playerGun.level ].spread * 1.5, 1e-12 ) && sigmas[ 0 ][ 1 ] === 'pepe', 'spread x1.5' );
	ok( crew.crew.sides.get( 'pepe' ) === 'port', 'the gunner took the side facing the nearest hostile' );
	run( features, naval.reloadTime() * 1.6 - 0.2 );
	ok( shots( events, 'pepe' ).length === 1, 'nothing while the side reloads' );
	run( features, 0.4 );
	ok( shots( events, 'pepe' ).length === 2, 'fires again once reloaded' );
	const line = crew.hudLine();
	ok( /^Gunners: Pepe \(port, \d+\.\d s\)$/.test( line ), `the HUD line: "${ line }"` );
	naval.reloadLeft.port = 0;
	ok( crew.hudLine() === 'Gunners: Pepe (port, ready)', 'ready' );

	// the skipper on foot (ashore / swimming): the gunners hold fire
	naval.reloadLeft.port = 0;
	const n0 = shots( events ).length;
	app.player.mode = 'walk';
	run( features, 0.5 );
	ok( shots( events ).length === n0, 'the skipper not aboard: no fire' );
	app.player.mode = 'deck';
	run( features, 1 / 30 );
	ok( shots( events ).length === n0 + 1, 'on deck: they fire' );

	// the skipper laying that side by hand: the gunner leaves it to him
	naval.reloadLeft.port = 0;
	app.player.mode = 'boat';
	naval.aiming = true;
	naval.aimInfo = { side: 'port', dir: { x: 1, y: 0.05, z: 0 } };
	const n1 = shots( events ).length;
	ok( naval.crewFire( 'port', { crew: 'pepe' } ) === null && shots( events ).length === n1, 'the side the skipper aims by hand is his' );
	naval.aiming = false;
	naval.aimInfo = null;

	// crippled, struck, merchants, peace
	naval.reloadLeft.port = 0;
	s.hp = s.maxHp * ( CRIPPLE - 0.05 );
	ok( naval.crewTarget( 'port' ) === null, 'a crippled pirate is the boarding prize: no target' );
	s.hp = s.maxHp;
	s.boarding = { crewLeft: 3, crewTotal: 3 };
	ok( naval.crewTarget( 'port' ) === null, 'nor one that struck her colours' );
	s.boarding = null;
	s.state = 'grapple';
	ok( naval.crewTarget( 'port' ) === null, 'nor one alongside on a grapple' );
	s.state = 'dock';
	s.faction = 'merchant';
	ok( naval.crewTarget( 'port' ) === null, 'never a merchant' );
	s.faction = 'pirate';
	ok( naval.crewTarget( 'port' ) === s && naval.crewTarget( 'starboard' ) === null, 'the pirate is in the port swing only' );
	app.boatCtl.position.set( 80, 0, 80 ); // the harbour anchorage: the peaceful home waters
	s.x = 200; s.z = 80;
	ok( naval.crewTarget( 'port' ) === null, 'never from inside the peaceful home waters' );
	const n2 = shots( events ).length;
	run( features, 0.5 );
	ok( shots( events ).length === n2, 'and the gunners hold fire there' );
	app.boatCtl.position.set( 0, 0, 1500 );
	s.x = 120; s.z = 1500;
	s.hp = s.maxHp * 0.5;
	const far = naval.spawn( 'sloop', { x: 300, z: 1500 } );
	far.state = 'dock';
	ok( naval.crewTarget( 'port' ) === s, 'nearest first' );
	s.x = 20; s.z = 1600; // ahead, past the swing
	ok( naval.crewTarget( 'port' ) === far, 'a pirate ahead is past the swing (the next one is taken)' );
	naval.ships.splice( naval.ships.indexOf( far ), 1 );
	ok( naval.crewTarget( 'port' ) === null, 'and alone: none' );

	// two gunners: one a side; the first takes the side of the nearest hostile
	s.x = - 120; s.z = 1500; // starboard (-X)
	crew.setPost( 'doge', 'gunner' );
	naval.reloadLeft.port = naval.reloadLeft.starboard = 0;
	run( features, 1 / 30 );
	ok( crew.crew.sides.get( 'pepe' ) === 'starboard' && crew.crew.sides.get( 'doge' ) === 'port', 'two gunners: Pepe turns to starboard (the nearest hostile), Doge takes port' );
	ok( shots( events, 'pepe' ).pop()[ 1 ].side === 'starboard', 'Pepe fires the starboard gun' );
	ok( /Gunners: Pepe \(stbd, .*\) · Doge \(port, ready\)/.test( crew.hudLine() ), `"${ crew.hudLine() }"` );
	// the merchant on the other beam is never shot at
	const m = naval.spawn( 'trawler', { x: 60, z: 1500 } );
	m.state = 'dock';
	run( features, 2 );
	ok( ! shots( events, 'doge' ).length, 'Doge never fires at the merchant on his beam' );
	ok( naval.crewShots >= 4, `crew shots so far: ${ naval.crewShots }` );
	GUN_LEVELS[ 1 ].spread = saved;

	// the sandbox's free swivel works for the crew too
	const sb = setup( { mode: 'sandbox' } );
	sb.crew.setPost( 'pepe', 'gunner' );
	const p = sb.naval.spawn( 'brigantine', { x: 0, z: 1650, yaw: 0 } );
	p.state = 'dock';
	sb.app.boatCtl.quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), - Math.PI / 2 ); // heading -X: port faces +Z
	run( sb.features, 1 / 30 );
	ok( shots( sb.events, 'pepe' ).length === 1 && shots( sb.events, 'pepe' )[ 0 ][ 1 ].side === 'port', 'sandbox: the free swivel; a brigantine off the turned boat\'s port beam is engaged' );

}

// ================================================================================================ 4. anglers
section( '4. anglers: timing, water, capacity' );
{

	ok( anglerRate( { atSea: true, speed: 1 } ) === 1 && anglerRate( { atSea: true, speed: 3 } ) === 0.5 && anglerRate( { atSea: true, speed: 5 } ) === 0, 'full rate under 2.5 m/s, half trolling under 4, none faster' );
	ok( anglerRate( { atSea: true, speed: 6, anchored: true } ) === 1 && anglerRate( { atSea: false, speed: 0 } ) === 0, 'at anchor: full; not at sea: none' );
	const reef = { shallows: 0, reef: 1, pier: 0, bay: 0.3, deep: 0 }, thin = { shallows: 0, reef: 0, pier: 0, bay: 0, deep: 0.2 };
	const rng = makeRng( 4 );
	let lo = Infinity, hi = 0;
	for ( let i = 0; i < 400; i ++ ) { const t = catchInterval( i % 2 ? reef : thin, rng ); lo = Math.min( lo, t ); hi = Math.max( hi, t ); }
	ok( lo >= 45 && hi <= 90, `intervals within 45-90 s (${ lo.toFixed( 1 ) } .. ${ hi.toFixed( 1 ) })` );
	ok( catchInterval( reef, () => 0.5 ) < catchInterval( thin, () => 0.5 ), 'richer water bites sooner' );
	ok( near( catchInterval( reef, () => 0.5, 1.8 ), catchInterval( reef, () => 0.5 ) * 1.8, 1e-9 ), 'a bare hook (bait factor 1.8) is slower, like the skipper\'s casts' );

	// the Crew loop on its own
	const c = new Crew( { rng: makeRng( 7 ) } );
	const ctx = { boat: 'lobster', unlocked: [ 'hyptile', 'pengu' ], character: 'hyptile' };
	c.setPost( 'pengu', 'angler', ctx );
	let t = 0, times = [], baits = 0;
	const opts = { rate: 1, hour: 12, habitat: () => reef, fits: () => true, bait: () => { baits ++; return 1; }, ctx };
	for ( ; t < 600; t += 0.5 ) for ( const e of c.tickAnglers( 0.5, opts ) ) if ( e.species ) times.push( { t: t + 0.5, e } );
	const gaps = times.map( ( x, i ) => x.t - ( i ? times[ i - 1 ].t : 0 ) );
	ok( times.length >= 6 && times.length <= 14, `10 minutes at rest: ${ times.length } fish` );
	// (wave 19C: the angler's skill shortens the wait, x1.08 for PENGU's 20 angling up to x1.4 at full; Life.anglingMul)
	ok( gaps.every( ( g ) => g >= 45 / 1.4 - 0.5 && g <= 90.5 ), `every fish 45-90 s after the last, less the angler's skill (${ gaps.map( ( g ) => g.toFixed( 0 ) ).join( ', ' ) })` );
	ok( times.every( ( x ) => FISH[ x.e.species ] && ( FISH[ x.e.species ].habitat.reef || FISH[ x.e.species ].habitat.bay ) ), 'over the reef: reef (and bay) fish' );
	ok( times.every( ( x ) => x.e.kg >= FISH[ x.e.species ].kg[ 0 ] - 0.01 && x.e.kg <= FISH[ x.e.species ].kg[ 1 ] + 0.01 ), 'weights from the species\' own roll' );
	ok( baits === times.length + 1, `a bait per cast (${ baits } for ${ times.length } fish)` );
	ok( /^PENGU landed a \d+\.\d kg .+$/.test( times[ 0 ].e.text ), `the toast: "${ times[ 0 ].e.text }"` );
	// half rate trolling, nothing under way
	const c2 = new Crew( { rng: makeRng( 7 ) } );
	c2.setPost( 'pengu', 'angler', ctx );
	let n2 = 0;
	for ( let i = 0; i < 1200; i ++ ) n2 += c2.tickAnglers( 0.5, { ...opts, rate: 0.5 } ).filter( ( e ) => e.species ).length;
	ok( Math.abs( n2 - times.length / 2 ) <= 1.5, `trolling: half the fish (${ n2 } against ${ times.length })` );
	const c3 = new Crew( { rng: makeRng( 7 ) } );
	c3.setPost( 'pengu', 'angler', ctx );
	let n3 = 0;
	for ( let i = 0; i < 1200; i ++ ) n3 += c3.tickAnglers( 0.5, { ...opts, rate: 0 } ).length;
	ok( n3 === 0, 'under way (rate 0): no fish' );
	// a full cooler: the fish goes back, one note, and the line stays out
	const c4 = new Crew( { rng: makeRng( 7 ) } );
	c4.setPost( 'pengu', 'angler', ctx );
	const notes = [];
	for ( let i = 0; i < 1200; i ++ ) notes.push( ...c4.tickAnglers( 0.5, { ...opts, fits: () => false } ) );
	ok( notes.length === 1 && notes[ 0 ].full && /cooler is full/.test( notes[ 0 ].text ) && notes.every( ( e ) => ! e.species ), 'the cooler full: nothing kept, said once' );
	const room = c4.tickAnglers( 31, { ...opts, fits: () => true } );
	ok( room.length === 1 && room[ 0 ].species, 'room again: the next fish goes in' );

	// through the feature and the game: GameState, quests, fishCaught, the toast, at sea or not
	const { app, features, crew, events } = setup();
	const trade = { operating: { n: 0, useBait() { this.n ++; return 1; } } };
	features.add( 'trade', { install: () => trade } );
	crew.setPost( 'pengu', 'angler' );
	const st = app.game.state;
	app.game.hour = 16; // (wave 19C: PENGU keeps the night watch and sleeps 9-15; at 16 he is at his post)
	run( features, 100, 0.25 );
	const fc = events.filter( ( e ) => e[ 0 ] === 'fishCaught' );
	ok( fc.length >= 1 && fc.every( ( e ) => e[ 1 ].crew === 'pengu' && e[ 1 ].aboard === true && Number.isFinite( e[ 1 ].x ) ), `fishCaught { crew: pengu, aboard, x, z } (${ fc.length } in 100 s)` );
	ok( st.inventory.length === fc.length && st.career.caught === fc.length && app.caught.length === fc.length, 'into the cooler, the career and the quests (contracts.onCatch) like a player catch' );
	ok( app.toasts.some( ( t ) => /^PENGU landed a \d+\.\d kg /.test( t ) ), `the toast: "${ app.toasts.find( ( t ) => /landed/.test( t ) ) }"` );
	ok( trade.operating.n === fc.length + 1, 'trade\'s bait: one per cast' );
	ok( fc.every( ( e ) => FISH[ e[ 1 ].species ].habitat.deep || FISH[ e[ 1 ].species ].habitat.bay ), 'open deep water (12 m under the keel): deep / bay species' );
	const k0 = st.inventory.length;
	app.boatCtl.speed = 6;
	run( features, 200, 0.25 );
	ok( st.inventory.length === k0, 'under way at 6 m/s: nothing' );
	app.boatCtl.speed = 0;
	app.boatCtl.moored = true;
	run( features, 200, 0.25 );
	ok( st.inventory.length === k0, 'moored: nothing' );
	app.boatCtl.moored = false;
	app.boatCtl.position.set( 49.9, 0, - 74.6 ); // by the home port's stand / dock
	const home = ( await import( '../src/world/WorldLayout.js' ) ).WORLD.ports.find( ( p ) => p.id === 'home' );
	app.boatCtl.position.set( home.dock.position.x + 20, 0, home.dock.position.z );
	run( features, 200, 0.25 );
	ok( st.inventory.length === k0, 'in port (20 m off the dock): nothing' );
	// Game.landCatch, when root adds it, is the entry point
	app.boatCtl.position.set( 0, 0, 1500 );
	const landed = [];
	app.game.landCatch = ( sp, kg, where ) => landed.push( { sp, kg, where } );
	run( features, 200, 0.25 );
	ok( landed.length >= 1 && landed[ 0 ].where.by === 'pengu' && landed[ 0 ].where.aboard && landed[ 0 ].where.habitat, 'with game.landCatch( species, kg, { habitat, aboard, by, x, z } ) the crew uses it' );
	delete app.game.landCatch;
	// a full cooler through the real GameState
	while ( st.fits( 0.01 ) ) st.inventory.push( { id: 999, species: 'mullet', kg: 5, value: 1 } );
	const inv = st.inventory.length;
	app.toasts.length = 0;
	run( features, 300, 0.25 );
	ok( st.inventory.length === inv && app.toasts.filter( ( t ) => /cooler is full/.test( t ) ).length === 1, 'the cooler full: nothing added, one toast' );

}

// ================================================================================================ 5. deck figures
section( '5. crew on deck' );
{

	const lob = deckPoint( 'lobster', 'gunner', 0, 'starboard', 0.4 );
	ok( lob.x < 0 && near( lob.yaw, - Math.PI / 2 ) && lob.z < - 0.95 && near( lob.y, 0.4 ), 'lobster gunner: starboard rail aft of the wheelhouse, facing out' );
	const sl = deckPoint( 'sloop', 'gunner', 0, 'port' );
	ok( near( sl.x, BOATS.sloop.broadside.x - 0.75 ) && near( sl.z, 0 ) && near( sl.y, BOATS.sloop.deckY ), 'sloop gunner: between the port guns, inboard of the rail' );
	const a0 = deckPoint( 'brigantine', 'angler', 0 ), a1 = deckPoint( 'brigantine', 'angler', 1 ), a2 = deckPoint( 'brigantine', 'angler', 2 );
	ok( a0.x > 0 && a1.x < 0 && a2.z < a0.z && Math.abs( a0.x ) < BOATS.brigantine.beam / 2, 'anglers at the rails, alternating, a row aft every two' );

	// stand-in avatars: { group, ready -> model }
	const made = [];
	const mkModel = ( clips ) => {

		const m = { clips: new Set( clips ), current: null, played: [], updates: 0, holds: 0, socket: new Matrix4().makeTranslation( 0.2, 1.1, 0.3 ) };
		m.play = ( name, o ) => { m.current = name; m.played.push( [ name, o ] ); };
		m.update = () => { m.updates ++; };
		m.hold = () => { m.holds ++; };
		m.clipDuration = () => 1.2;
		m.nodeMatrix = ( n, out ) => ( n === 'weapon_r' ? out.copy( m.socket ) : null );
		return m;

	};

	const factory = ( o ) => {

		const model = mkModel( [ 'Idle_Breathe', 'Fishing_Hold', 'Catch_Celebrate', 'Point' ] );
		const group = { position: new Vector3(), quaternion: new Quaternion(), visible: true, matrixWorld: new Matrix4(), updateMatrixWorld() { this.matrixWorld.compose( this.position, this.quaternion, new Vector3( 1, 1, 1 ) ); } };
		const av = { character: o.character, lite: o.lite, group, model, ready: Promise.resolve( model ), disposed: false, dispose() { this.disposed = true; } };
		made.push( av );
		return av;

	};

	const rods = [];
	const deck = new CrewDeck( { scene: { add() {}, remove() {} }, avatarFactory: factory, rodFactory: () => { const r = { position: new Vector3(), quaternion: new Quaternion(), visible: false }; rods.push( r ); return r; }, phone: false } );
	deck.sync( [ { id: 'pepe', post: 'gunner', side: 'port', slot: 0 }, { id: 'pengu', post: 'angler', side: 'port', slot: 0 } ] );
	await Promise.resolve();
	await Promise.resolve();
	ok( made.length === 2 && made.every( ( a ) => a.lite ) && made[ 0 ].character === 'pepe', 'one lite avatar per posted member, from the roster id' );
	const boat = { position: new Vector3( 10, 0, 20 ), quaternion: new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), Math.PI / 2 ), toWorld( l, out ) { return out.copy( l ).applyQuaternion( this.quaternion ).add( this.position ); } };
	deck.update( 1 / 30, { boat, boatId: 'lobster', deckY: 0.4, visible: true, eye: new Vector3( 10, 3, 25 ) } );
	const gp = deckPoint( 'lobster', 'gunner', 0, 'port', 0.4 );
	const want = new Vector3( gp.x, gp.y, gp.z ).applyQuaternion( boat.quaternion ).add( boat.position );
	ok( made[ 0 ].group.position.distanceTo( want ) < 1e-6, `the gunner rides the boat's pose (${ made[ 0 ].group.position.x.toFixed( 2 ) }, ${ made[ 0 ].group.position.z.toFixed( 2 ) })` );
	const face = new Vector3( 0, 0, 1 ).applyQuaternion( made[ 0 ].group.quaternion );
	const port = new Vector3( 1, 0, 0 ).applyQuaternion( boat.quaternion );
	ok( face.dot( port ) > 0.999, 'facing outboard to port' );
	ok( made[ 0 ].model.current === 'Idle_Breathe' && made[ 1 ].model.current === 'Fishing_Hold', 'gunner idle (no ramming clip in the GLB), angler holding the rod' );
	ok( rods.length === 1 && rods[ 0 ].visible && rods[ 0 ].position.distanceTo( new Vector3( 0.2, 1.1, 0.3 ).applyMatrix4( made[ 1 ].group.matrixWorld ) ) < 1e-5, 'the rod in the angler\'s weapon_r socket' );
	boat.position.x += 5;
	deck.update( 1 / 30, { boat, boatId: 'lobster', deckY: 0.4, visible: true, eye: new Vector3( 15, 3, 25 ) } );
	ok( near( made[ 0 ].group.position.x - want.x, 5, 1e-6 ), 'and moves with her' );
	ok( deck.caught( 'pengu' ) && ( deck.update( 1 / 30, { boat, boatId: 'lobster', visible: true } ), made[ 1 ].model.current === 'Catch_Celebrate' ), 'a catch: the celebration' );
	for ( let i = 0; i < 50; i ++ ) deck.update( 1 / 30, { boat, boatId: 'lobster', visible: true } );
	ok( made[ 1 ].model.current === 'Fishing_Hold', 'then back to the rod' );
	ok( deck.fired( 'pepe' ) && ( deck.update( 1 / 30, { boat, boatId: 'lobster', visible: true } ), made[ 0 ].model.current === 'Point' ), 'a broadside: the gunner points' );
	deck.update( 1 / 30, { boat, boatId: 'lobster', visible: false } );
	ok( made.every( ( a ) => a.group.visible === false ) && ! rods[ 0 ].visible, 'hidden with the boat (no boat / wrecked)' );
	const u0 = made[ 0 ].model.updates;
	deck.update( 1 / 30, { boat, boatId: 'lobster', visible: true, eye: new Vector3( 500, 0, 500 ) } );
	ok( made[ 0 ].model.updates === u0 && made[ 0 ].model.holds > 0, 'far from the eye: the pose holds (no animation cost)' );
	deck.sync( [ { id: 'pengu', post: 'angler', side: 'port', slot: 0 } ] );
	ok( made[ 0 ].disposed && deck.figures.size === 1, 'off duty: the figure is removed' );
	deck.dispose();
	ok( made[ 1 ].disposed && deck.figures.size === 0, 'dispose' );

	// a phone animates at most two
	made.length = 0;
	const ph = new CrewDeck( { scene: { add() {}, remove() {} }, avatarFactory: factory, rodFactory: () => null, phone: true } );
	ph.sync( [ 'pepe', 'doge', 'pengu', 'bonk' ].map( ( id, i ) => ( { id, post: i < 2 ? 'gunner' : 'angler', side: i % 2 ? 'starboard' : 'port', slot: i % 2 } ) ) );
	await Promise.resolve();
	await Promise.resolve();
	ph.update( 1 / 30, { boat, boatId: 'brigantine', visible: true, eye: boat.position } );
	ok( made.filter( ( a ) => a.model.updates > 0 ).length === CREW_RULES.phoneAnimated && made.filter( ( a ) => a.model.holds > 0 ).length === 2, 'phone budget: two crew animated, the rest hold their pose' );
	ph.dispose();

	// the feature builds the deck figures from the posts
	const app = makeApp();
	app.scene = { add() {}, remove() {} };
	made.length = 0;
	const features = new Features( app );
	features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 5, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	const crew = features.add( 'crew', { install: ( a, f ) => crewModule.install( a, f, { rng: makeRng( 3 ), avatarFactory: factory, rodFactory: () => null, doc: null } ) } );
	crew.setPost( 'pepe', 'gunner' );
	crew.setPost( 'pengu', 'angler' );
	features.update( 1 / 30 );
	ok( made.length === 2 && crew.deck.figures.size === 2, 'the feature stands the posted crew on deck' );
	app.game.state.character = 'pepe';
	features.update( 1 / 30 );
	ok( crew.deck.figures.size === 1 && crew.posts.pepe === undefined && app.toasts.some( ( t ) => /Pepe leaves the gunner's post/.test( t ) ), 'playing Pepe: he leaves his post and the deck' );
	crew.dispose();

}

console.log( `\n${ passes } checks passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
