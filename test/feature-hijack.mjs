// Plain-node test of wave 15C: pirates keep their distance (the calm waters of naval/Routes.js, the moved south-band lane, den
// moorings, retaliation from Blackwater's quarter, the horizon warning) and every vessel can be taken (src/features/hijack):
// the boarding offer on a crippled merchant and "Take the ship" (the player's hull changes, the old boat stays moored), the
// night sneak roll and the alarm path, the mail plane, a resident's skiff, the wanted state (hunters, the home port's guards),
// laundering at the yard, the fence, recovering the old boat, the remote world event and the save round trip.
// Real: Features, Naval (no models, no HUD), Boarding, Pirates, TerrainData, GameState. Stubs: player, boat, setBoat, trade,
// customs, seaplane, avatars.
//   node test/feature-hijack.mjs
import { Vector3, Quaternion, Group, PerspectiveCamera } from '../src/engine/index.js';
import { Features } from '../src/features/Features.js';
import { Naval } from '../src/features/naval/Naval.js';
import * as boardingModule from '../src/features/boarding/index.js';
import * as piratesModule from '../src/features/pirates/index.js';
import * as hijackModule from '../src/features/hijack/index.js';
import { HIJACK, hullFor, watchChance, repaintFee, fencePrice, skiffSites, mailSpot, mailStop } from '../src/features/hijack/index.js';
import { CALM, SAFE_ZONES, PATROLS, legs, inSafeZone, nearHome, calmZones } from '../src/features/naval/Routes.js';
import { thinkPirate, keepOut } from '../src/features/naval/Brains.js';
import { Ship } from '../src/features/naval/Ship.js';
import { makeRng } from '../src/features/naval/util.js';
import { denSite } from '../src/features/pirates/Dens.js';
import { RAID_RULES } from '../src/features/pirates/Retaliation.js';
import { HORIZON } from '../src/features/pirates/index.js';
import { BlackMarket } from '../src/features/pirates/BlackMarket.js';
import { BOATS } from '../src/game/Boats.js';
import { GameState } from '../src/game/GameState.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { ensureBlackwater } from '../src/world/islands/BlackwaterTerrain.js';
import { Colliders } from '../src/world/Colliders.js';
import { WORLD } from '../src/world/WorldLayout.js';

let fails = 0, passes = 0;
const ok = ( c, msg, extra = '' ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg, extra ); } else { passes ++; console.log( 'ok  ', msg, extra ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const DT = 1 / 30;
const terrain = new TerrainData();
ensureBlackwater( terrain );
const DOCK = WORLD.boatDock.position, LANDING = WORLD.landing.center;
const homeDist = ( x, z ) => Math.min( Math.hypot( x - DOCK.x, z - DOCK.z ), Math.hypot( x - LANDING.x, z - LANDING.z ) );
const segDist = ( px, pz, a, b ) => {

	const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ];
	const f = Math.max( 0, Math.min( 1, ( ( px - a[ 0 ] ) * dx + ( pz - a[ 1 ] ) * dz ) / ( dx * dx + dz * dz ) ) );
	return Math.hypot( px - a[ 0 ] - dx * f, pz - a[ 1 ] - dz * f );

};

// ---------------------------------------------------------------- stubs and a world

function avatarFactory( o ) {

	const model = { clips: new Set(), play() { return { time: 0 }; }, update() {}, hold() {}, materials: [] };
	return { group: new Group(), model, character: o.character, ready: Promise.resolve( model ), update() {}, dispose() { this.disposed = true; } };

}

class FakeInput {

	constructor() { this.keys = new Set(); this.pressed = new Set(); this.mouseDown = false; this.rightDown = false; this.enabled = true; }
	down( c ) { return this.keys.has( c ); }
	hit( c ) { return this.pressed.has( c ); }
	endFrame() { this.pressed.clear(); }

}

function makeWorld( o = {} ) {

	const events = [], toasts = [], shared = [], setBoats = [], offences = [], cargo = [];
	const state = new GameState( { getItem: () => null, setItem: () => {} } );
	state.boat = 'lobster';
	state.money = o.money ?? 50000;
	const boat = {
		position: new Vector3( 8.6, 0, 520 ), quaternion: new Quaternion(), velocity: new Vector3(), speed: 0.4, driven: true, moored: false, enabled: true,
		mooring: { anchor: new Vector3( 5, 0, 5 ), heading: 1 }, throttle: 0.5, yaw: 0,
		getYaw() { return this.yaw; },
		toWorld( l, out ) { return out.copy( l ).add( this.position ); },
		reset() { this.moored = true; },
	};
	const player = {
		mode: 'boat', position: new Vector3( 8.6, 1, 520 ), velocity: new Vector3(), yaw: 0, pitch: 0, stamina: 1, grounded: true, prompt: null, busy: false,
		seat: null, action: null, deckYaw: 0, launched: 0,
		leaveHelm() { this.mode = 'deck'; }, boardBoat() { this.mode = 'deck'; this.position.copy( boat.position ); },
		enterBoat() { this.mode = 'boat'; boat.moored = false; boat.driven = true; this.position.copy( boat.position ); },
		exitBoat() { this.mode = 'walk'; boat.driven = false; },
		groundAt: ( x, z ) => terrain.heightAt( x, z ),
	};
	const app = {
		player, input: new FakeInput(), boatCtl: boat, camera: new PerspectiveCamera( 60, 16 / 9, 0.1, 2000 ), scene: { add() {}, remove() {} },
		game: { state, rod: { equipped: false, equip() {} }, toast: ( t ) => toasts.push( t ), cancelLine() {} },
		terrainData: terrain, colliders: new Colliders(), settings: { timeOfDay: o.hour ?? 12, timeSpeed: 0 }, mode: o.mode || 'campaign', paused: false,
		avatar: { character: 'hyptile' }, ui: null, cameraFeel: { kick() {} },
		boat: { dimensions: { length: 8.2, beam: 2.9, draft: 0.85, freeboard: 0.9 } },
		netsync: { id: 'me', sendWorldEvent: ( kind, data ) => shared.push( { kind, data } ) },
		setBoat( id, { dock = null } = {} ) {

			setBoats.push( { id, dock } );
			this.boatId = id;
			boat.enabled = !! id;
			if ( dock && dock.position ) { boat.position.set( dock.position.x, 0, dock.position.z ); boat.yaw = dock.heading || 0; boat.moored = true; boat.driven = false; }

		},
	};
	app.camera.position.set( 8, 4, 520 );
	const features = new Features( app );
	for ( const n of [ 'vesselTaken', 'hijackAlarm', 'stolenSpotted', 'vesselLaundered', 'stolenSold', 'boatRecovered', 'shipSunk', 'shipCrippled', 'boardingEnded', 'sailSighted', 'retaliationRaid', 'merchantStanding' ] ) features.on( n, ( e ) => events.push( [ n, e ] ) );
	const credit = { standing: 40, adjust( n ) { this.standing = Math.max( 0, Math.min( 100, this.standing + n ) ); return this.standing; } };
	features.add( 'trade', { install: () => ( { cargo: {}, credit, addCargo( good, qty ) { cargo.push( { good, qty } ); return qty; }, takeCargo() { return { qty: 0 }; } } ) } );
	features.add( 'customs', { install: () => ( { _offence( port ) { offences.push( port ); } } ) } );
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 7, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	const boarding = features.add( 'boarding', { install: ( a, f ) => boardingModule.install( a, f, { avatarFactory, hud: false, seed: 11 } ) } );
	const pirates = o.pirates === false ? null : features.add( 'pirates', { install: ( a, f ) => piratesModule.install( a, f, { seed: 3, hud: false, avatarFactory } ) } );
	const seaplane = o.seaplane || null;
	if ( seaplane ) features.add( 'seaplane', { install: () => seaplane } );
	const hijack = features.add( 'hijack', { install: ( a, f ) => hijackModule.install( a, f, { models: false, seed: 5, ...( o.hijack || {} ) } ) } );
	return { app, features, player, boat, state, naval, boarding, pirates, hijack, events, toasts, shared, setBoats, offences, cargo, credit };

}

const evs = ( w, name ) => w.events.filter( ( e ) => e[ 0 ] === name ).map( ( e ) => e[ 1 ] );
const run = ( w, seconds ) => { for ( let i = 0, n = Math.round( seconds / DT ); i < n; i ++ ) { w.features.update( DT ); w.app.input.endFrame(); } };
const sail = ( w, x, z ) => { w.player.mode = 'boat'; w.boat.moored = false; w.boat.driven = true; w.boat.position.set( x, 0, z ); w.player.position.set( x, 1, z ); };

// ================================================================ 1. the calm waters
section( '1. the calm waters (Routes.CALM)' );
{

	ok( CALM.home === 450 && CALM.port === 250 && CALM.spawn === 600, `calm radii: ${ CALM.home } m round Jade Landing and the home dock, ${ CALM.port } m round every port, spawns ${ CALM.spawn } m off home` );
	ok( SAFE_ZONES.some( ( s ) => s.id === 'landing' && s.r === 450 ) && SAFE_ZONES.some( ( s ) => s.id === 'harbour' && s.r === 450 ), 'SAFE_ZONES holds Jade Landing and the home harbour at 450 m' );
	ok( inSafeZone( DOCK.x, DOCK.z + 440 ) && ! inSafeZone( DOCK.x, DOCK.z + 460 ), '440 m south of the pier head is calm, 460 m is not' );
	ok( inSafeZone( LANDING.x + 445, LANDING.z ) !== null, 'and 445 m east of Jade Landing' );
	const others = ( WORLD.ports || [] ).filter( ( p ) => p.id !== 'home' );
	const circles = [ ...SAFE_ZONES, ...calmZones() ];
	ok( others.length >= 5 && others.every( ( p ) => inSafeZone( p.dock.position.x + 240, p.dock.position.z ) && circles.some( ( z ) => z.id === p.id && z.r === CALM.port && Math.hypot( z.x - p.dock.position.x, z.z - p.dock.position.z ) < 0.01 ) ), `every other port (${ others.map( ( p ) => p.id ).join( ', ' ) }) has its 250 m circle on its dock` );
	ok( calmZones().every( ( z ) => z.r === CALM.port ) && ! SAFE_ZONES.some( ( s ) => s.id === 'tidemark' ), 'the port circles are read from WORLD.ports (Tidemark is not a static SAFE_ZONES entry)' );
	let wp = Infinity, leg = Infinity;
	for ( const r of PATROLS ) {

		for ( const q of r ) wp = Math.min( wp, homeDist( q[ 0 ], q[ 1 ] ) );
		for ( const [ a, b ] of legs( r, true ) ) leg = Math.min( leg, segDist( DOCK.x, DOCK.z, a, b ), segDist( LANDING.x, LANDING.z, a, b ) );

	}

	ok( wp >= CALM.spawn && leg >= CALM.spawn, `every patrol waypoint and leg lies 600+ m from home (nearest waypoint ${ wp.toFixed( 0 ) } m, leg ${ leg.toFixed( 0 ) } m)` );
	let portLeg = Infinity;
	for ( const r of PATROLS ) for ( const [ a, b ] of legs( r, true ) ) for ( const p of others ) portLeg = Math.min( portLeg, segDist( p.dock.position.x, p.dock.position.z, a, b ) );
	ok( portLeg > CALM.port, `and no lane crosses a port's calm circle (nearest ${ portLeg.toFixed( 0 ) } m)` );
	ok( nearHome( DOCK.x, DOCK.z + 590 ) && ! nearHome( DOCK.x, DOCK.z + 610 ), 'nearHome: 600 m round the pier head' );

	// the den moorings: out of every calm circle, in deep water; the camps where they were
	for ( const isl of WORLD.islands ) {

		if ( isl.id === 'home' || isl.den === false ) continue;
		const port = WORLD.ports.find( ( p ) => p.id === isl.id );
		const d = denSite( isl, terrain, port );
		ok( ! inSafeZone( d.mx, d.mz ) && terrain.heightAt( d.mx, d.mz ) < - 4 && terrain.heightAt( d.x, d.z ) > 0.3, `${ isl.id }: the den's mooring is clear of the calm circles and deep (${ terrain.heightAt( d.mx, d.mz ).toFixed( 1 ) } m), the camp ashore` );

	}

	// naval spawns its pirates at patrol waypoints: none inside 600 m of home
	const w = makeWorld( { pirates: false } );
	w.app.camera.position.set( - 1500, 4, 1500 );
	const s = w.naval.spawnPirate( 'sloop' );
	ok( s && homeDist( s.x, s.z ) >= CALM.spawn, `an ambient pirate is put to sea ${ s ? homeDist( s.x, s.z ).toFixed( 0 ) : '-' } m from home` );

	// no hunt, no fire: a target in calm water, or a pirate lying in it
	const calls = { fire: 0 };
	const wd = { time: 0, night: false, storm: false, rng: makeRng( 3 ), terrain: null, target: { x: DOCK.x, z: DOCK.z + 300, vx: 0, vz: 0, ok: true }, fire: () => { calls.fire ++; return true; }, escape: () => {} };
	const p = new Ship( 'sloop', { x: DOCK.x, z: DOCK.z + 560, yaw: Math.PI, speed: 4 } );
	p.alertT = 30;
	for ( let i = 0; i < 40; i ++ ) thinkPirate( p, wd, 0.05 );
	ok( p.state === 'patrol' && calls.fire === 0, 'a player 300 m off the pier head (calm) is not hunted from 260 m outside it' );
	const q = new Ship( 'sloop', { x: DOCK.x + 30, z: DOCK.z + 420, yaw: 0, speed: 4 } );
	q.setState( 'broadside' );
	wd.target = { x: DOCK.x + 30, z: DOCK.z + 520, vx: 0, vz: 0, ok: true };
	q.reload.port = q.reload.starboard = 0;
	for ( let i = 0; i < 100; i ++ ) thinkPirate( q, wd, 0.05 );
	ok( calls.fire === 0 && q.state === 'patrol', 'a pirate lying inside the calm does not fire, even at a target outside it' );
	// she turns back at the edge: a chase toward the harbour never crosses into it
	const r = new Ship( 'sloop', { x: DOCK.x, z: DOCK.z + 720, yaw: Math.PI, speed: 6 } );
	r.setState( 'chase' );
	let deepest = - Infinity;
	for ( let i = 0; i < 1600; i ++ ) {

		r.want = Math.PI; r.wantSpeed = 1; // (straight at the pier head)
		keepOut( r );
		r.integrate( 0.05, null );
		deepest = Math.max( deepest, CALM.home - Math.hypot( r.x - DOCK.x, r.z - DOCK.z ) );

	}

	ok( deepest < 25, `a pirate driven at the harbour turns along the calm edge (at most ${ Math.max( 0, deepest ).toFixed( 0 ) } m inside it)` );

}

// ================================================================ 2. retaliation and the horizon warning
section( '2. retaliation from Blackwater\'s quarter, the horizon warning' );
{

	ok( RAID_RULES.distance > HORIZON.range && HORIZON.range === 500, `raiders appear ${ RAID_RULES.distance } m off, past the ${ HORIZON.range } m horizon warning` );
	const w = makeWorld();
	const R = w.pirates.retaliation;
	let worst = Infinity, south = 0, n = 0;
	for ( const [ x, z ] of [ [ 0, 560 ], [ 300, 620 ], [ - 300, 560 ], [ 200, 900 ] ] ) {

		const at = R._spot( { x, z }, RAID_RULES.distance );
		if ( ! at ) continue;
		n ++;
		worst = Math.min( worst, homeDist( at.x, at.z ) );
		if ( at.z > z ) south ++;
		ok( ! inSafeZone( at.x, at.z ) && terrain.heightAt( at.x, at.z ) < - 6, `from (${ x }, ${ z }) the avenger appears at (${ at.x.toFixed( 0 ) }, ${ at.z.toFixed( 0 ) }) in open deep water` );

	}

	ok( n >= 3 && worst >= CALM.spawn && south === n, `always to the south (Blackwater's quarter), never inside 600 m of home (nearest ${ worst.toFixed( 0 ) } m)` );

	// a raid: launched at sea, warned at 500 m, never followed into the calm
	sail( w, 0, 560 );
	const q = R.trigger( 'Mossbeard', 'raid', { force: true } );
	q.t = 0.05;
	run( w, 0.3 );
	const s = w.pirates.roster.shipOf( 'Mossbeard' );
	ok( s && s.raid && Math.hypot( s.x, s.z - 560 ) > HORIZON.range, `the raid appears ${ s ? Math.hypot( s.x, s.z - 560 ).toFixed( 0 ) : '-' } m off` );
	ok( evs( w, 'sailSighted' ).length === 0, 'no warning yet beyond the horizon range' );
	s.x = 0; s.z = 560 + 480;
	run( w, 0.2 );
	const sg = evs( w, 'sailSighted' );
	ok( sg.length === 1 && sg[ 0 ].id === s.id && sg[ 0 ].quarter === 'south' && w.toasts.some( ( t ) => /A sail on the horizon to the south/.test( t ) ), 'at 480 m: "A sail on the horizon to the south" (sailSighted)' );
	ok( w.pirates.searchZones().some( ( z ) => z.kind === 'sail' && z.id === 'sail:' + s.id ), 'and a blip on the maps (searchZones kind sail)' );
	run( w, 0.2 );
	ok( evs( w, 'sailSighted' ).length === 1, 'once per ship' );
	// the player runs for home: she breaks off at the calm edge
	sail( w, DOCK.x, DOCK.z + 300 );
	s.x = DOCK.x; s.z = DOCK.z + 620; s.setState( 'chase' );
	let inside = 0;
	for ( let i = 0; i < 60 * 30; i ++ ) {

		w.features.update( DT );
		if ( Math.hypot( s.x - DOCK.x, s.z - DOCK.z ) < CALM.home - 25 ) inside ++;

	}

	ok( inside === 0 && s.state !== 'broadside', `the raider turns back at the edge of the home calm (${ s.state })` );
	// a due raid waits while you are afloat in calm water
	const w2 = makeWorld();
	sail( w2, DOCK.x, DOCK.z + 380 );
	const q2 = w2.pirates.retaliation.trigger( 'BlackLantern', 'sunk', { force: true } );
	q2.t = 0;
	run( w2, 0.5 );
	ok( evs( w2, 'retaliationRaid' ).length === 0 && w2.pirates.retaliation.pending.length === 1 && q2.wait === 0, 'a raid due while you are afloat in calm water waits (the ashore grace does not run)' );

}

// ================================================================ 3. hull mapping and the rules
section( '3. hulls and rules' );
{

	ok( hullFor( 'trawler' ) === 'trawler' && hullFor( 'sloop' ) === 'sloop' && hullFor( 'brigantine' ) === 'brigantine', 'each AI class is a player hull already (Boats.js shipClass)' );
	ok( hullFor( 'skiff' ) === 'skiff' && hullFor( 'nothing' ) === null, 'a small boat id maps to itself, an unknown class to nothing' );
	ok( watchChance( { night: true } ) < watchChance( {} ) && watchChance( { night: true, level: 3 } ) > watchChance( { night: true } ) && watchChance( { night: true, blackwater: true } ) > watchChance( { night: true } ), `the watch: night ${ watchChance( { night: true } ) }, day ${ watchChance( {} ) }, more with notoriety and at Blackwater` );
	ok( repaintFee( 'trawler' ) === 2640 && repaintFee( 'skiff' ) === HIJACK.repaint.min && fencePrice( 'sloop' ) === 2880, `repaint $${ repaintFee( 'trawler' ) } (trawler), the fence pays $${ fencePrice( 'sloop' ) } for a sloop` );
	const sk = skiffSites( terrain );
	ok( sk.length === WORLD.ports.length && sk.every( ( k ) => BOATS[ k.kind ] && ( k.kind === 'skiff' || k.kind === 'canoe' ) ), `a resident's skiff or canoe at every port (${ sk.length })` );
	ok( sk.filter( ( k ) => terrain.heightAt( k.x, k.z ) < - 0.4 ).length >= sk.length - 2, 'afloat beside the jetties', sk.map( ( k ) => k.port + ' ' + terrain.heightAt( k.x, k.z ).toFixed( 1 ) ).join( ' ' ) );
	ok( mailStop( 9 ).port === 'tidemark' && mailStop( 16 ).port === 'home' && mailStop( 13 ) === null && mailStop( 22 ) === null, 'the mail Petrel: Tidemark 8-12, home 15-18.30' );
	const ms = mailSpot( 'home', terrain );
	ok( ms && terrain.heightAt( ms.x, ms.z ) < - 1.5, `she lies in ${ ( - terrain.heightAt( ms.x, ms.z ) ).toFixed( 1 ) } m of water off the home pier` );

}

// ================================================================ 4. at sea: board a crippled merchant, take her
section( '4. a crippled merchant: board, take the ship' );
let saved = null;
{

	const w = makeWorld();
	const m = w.naval.spawn( 'trawler', { x: 0, z: 520, yaw: 0, name: 'Patient Mary' } );
	m.state = 'sail';
	m.cursor = null;
	m.damage( m.hp - m.maxHp * 0.2, { by: 'player' } );
	run( w, 0.1 );
	ok( m.state === 'adrift' && w.toasts.some( ( t ) => /Patient Mary heaves to and strikes/.test( t ) ), 'a merchant shot below 25 % heaves to and strikes (adrift)' );
	run( w, 2 );
	ok( m.state === 'adrift' && m.speed < 0.5, 'and the merchant brain leaves her lying there (no running off under the boarders)' );
	ok( w.boarding.offer === m && /Board the Patient Mary · 1 crew/.test( w.boarding.view().prompt ), `the Board offer: ${ w.boarding.view().prompt }` );
	ok( w.hijack.canTake( m ), 'canTake: a struck merchant can be climbed aboard too' );
	ok( w.boarding.board( m ), 'board her' );
	run( w, 1.2 );
	const ch = w.boarding.view().choice;
	ok( w.boarding.phase === 'surrender' && ch && ch.options.length === 3, 'no melee here: the master gives up at once; three choices', ch && ch.options.map( ( o ) => o.label ).join( ' / ' ) );
	ok( ch.options[ 0 ].disabled && /Only a pirate/.test( ch.options[ 0 ].sub ) && /Take the ship/.test( ch.options[ 2 ].label ) && ! ch.options[ 2 ].disabled, `1 prisoner disabled (a merchant), 3 Take the ship: ${ ch.options[ 2 ].sub }` );
	ok( w.boarding.choose( 0 ) === false, 'a merchant master fetches no ransom' );
	const bx = w.boat.position.x, bz = w.boat.position.z;
	ok( w.boarding.choose( 2 ) === true, 'choose 3: take the ship' );
	run( w, 1.5 );
	ok( w.state.boat === 'trawler' && w.setBoats.some( ( c ) => c.id === 'trawler' && Math.abs( c.dock.position.x - m.x ) < 0.01 && Math.abs( c.dock.position.z - m.z ) < 0.01 ), 'your hull is the trawler, swapped in where she lay (app.setBoat( hull, { dock } ))' );
	ok( w.player.mode === 'boat' && ! w.boat.moored, 'you are at her helm' );
	const left = w.hijack.left[ 0 ];
	ok( left && left.boat === 'lobster' && Math.abs( left.x - bx ) < 0.01 && Math.abs( left.z - bz ) < 0.01, 'your lobster boat stays moored where she lay (hijack.left)' );
	ok( m.taken && ! w.naval.ships.includes( m ), 'the AI ship is gone from the sea' );
	const hull = w.naval.playerHull;
	ok( hull.boat === 'trawler' && hull.hp / hull.max >= HIJACK.minHull - 0.01 && hull.hp < hull.max, `she keeps her damage, patched to ${ ( hull.hp / hull.max * 100 ).toFixed( 0 ) } %` );
	ok( w.cargo.length > 0, `her cargo is in your hold: ${ w.cargo.map( ( c ) => c.qty + ' ' + c.good ).join( ', ' ) }` );
	const vt = evs( w, 'vesselTaken' )[ 0 ];
	ok( vt && vt.id === m.id && vt.class === 'trawler' && vt.by === 'player' && vt.faction === 'merchant', 'vesselTaken { id, class, by }' );
	ok( w.shared.some( ( s ) => s.kind === 'vesselTaken' && s.data.id === m.id && s.data.class === 'trawler' && s.data.by === 'me' ), 'shared as a world event (the host removes her)' );
	ok( evs( w, 'boardingEnded' ).pop().outcome === 'taken' && w.boarding.stats.taken === 1, 'boardingEnded { outcome: taken }' );
	const v = w.hijack.vessel;
	ok( v && v.name === 'Patient Mary' && v.wanted && v.faction === 'merchant' && v.port === 'home', 'she is wanted: a merchant out of the home port' );
	ok( w.credit.standing < 40 && w.hijack.bounty > 0 && w.offences.includes( 'home' ), `merchant standing ${ w.credit.standing }, a $${ w.hijack.bounty } bounty, an offence at home` );
	// the faction answers: the navy comes for her (a patrol captain, warned on the horizon)
	const hunter = w.pirates.retaliation.active.find( ( s ) => s.hunt );
	ok( hunter && [ 'HarbourWard', 'ReedWatch' ].includes( hunter.pirateId ) && hunter.faction === 'pirate' && homeDist( hunter.x, hunter.z ) >= CALM.spawn, `the navy sends the ${ hunter ? hunter.name : '-' } after her` );
	ok( w.toasts.some( ( t ) => /out after the ship you took/.test( t ) ), 'with its own toast' );
	// the home port's guards know her
	const off0 = w.offences.length;
	sail( w, DOCK.x + 30, DOCK.z + 120 );
	run( w, 0.1 );
	ok( evs( w, 'stolenSpotted' ).length === 1 && w.offences.length === off0 + 1 && w.toasts.some( ( t ) => /guards at Hyptile Harbour know the Patient Mary/.test( t ) ), 'sailing her into the home harbour: the guards know her (an offence, a bounty)' );
	run( w, 0.1 );
	ok( evs( w, 'stolenSpotted' ).length === 1, 'once a visit' );
	// laundering: the yard repaints her, clean a day later
	const row = w.hijack.yardRow();
	ok( row && row.price === repaintFee( 'trawler' ) && /Repaint the Patient Mary/.test( row.label ), `the yard row: ${ row && row.label } $${ row && row.price }` );
	const money = w.state.money;
	ok( w.hijack.repaint().ok && w.state.money === money - repaintFee( 'trawler' ) && w.hijack.vessel.wanted, 'repainted (paid); still wanted while the paint dries' );
	ok( w.hijack.repaint().reason === 'drying', 'once' );
	w.hijack.advance( HIJACK.repaint.hours + 0.5 );
	run( w, 0.1 );
	ok( ! w.hijack.vessel.wanted && w.hijack.vessel.laundered && evs( w, 'vesselLaundered' ).length === 1, 'a day later she is clean' );
	ok( w.hijack.yardRow() === null, 'no repaint row for a clean hull' );
	saved = { json: JSON.parse( JSON.stringify( w.hijack.toJSON() ) ), w };

}

// ================================================================ 5. moored at night: sneak aboard, cast off
section( '5. a moored ship: the night sneak and the alarm' );
{

	// the roll comes out quiet (rand 0.99): she is yours
	const w = makeWorld( { hour: 23, hijack: { rand: () => 0.99 } } );
	const m = w.naval.spawn( 'trawler', { x: 300, z: 700, yaw: 0, name: 'Brine & Barley', state: 'moored', speed: 0 } );
	m.state = 'moored';
	run( w, 1 );
	ok( m.state === 'moored' && Math.hypot( m.x - 300, m.z - 700 ) < 0.5, 'a moored merchant lies still' );
	ok( w.hijack.canTake( m ), 'canTake: a moored ship' );
	w.player.mode = 'walk';
	w.player.position.set( 300, 3, 700 );
	const c = w.hijack.onClimb( m );
	ok( c.ok && c.how === 'sneak' && Math.abs( c.chance - watchChance( { night: true } ) ) < 1e-9 && /her crew sleeps/.test( w.toasts.at( - 1 ) ), `climbed aboard at night: the watch's chance ${ c.chance }` );
	const helm = w.hijack._helmPoint();
	w.player.position.set( helm.x, helm.y, helm.z );
	const it = w.features.nearestInteractable( w.player.position );
	ok( it && it.id === 'hijack-helm' && /Cast off the Brine & Barley/.test( it.prompt() ), 'E at the helm: "Cast off the Brine & Barley"' );
	it.onInteract();
	ok( w.state.boat === 'trawler' && m.taken && w.hijack.stats.sneaked === 1 && evs( w, 'hijackAlarm' ).length === 0, 'nobody stirred: she is yours' );
	ok( evs( w, 'vesselTaken' )[ 0 ].how === 'sneaked' && w.hijack.left[ 0 ].boat === 'lobster', 'vesselTaken how sneaked; your own boat left where she lay' );

	// the roll fails (rand 0): the alarm, the crew fight (boarding, from her deck)
	const w2 = makeWorld( { hour: 23, hijack: { rand: () => 0 } } );
	const m2 = w2.naval.spawn( 'sloop', { x: 300, z: 700, yaw: 0, name: 'Grey Cormorant', state: 'moored', speed: 0 } );
	m2.state = 'moored';
	w2.player.mode = 'walk';
	w2.player.position.set( 300, 3, 700 );
	w2.hijack.onClimb( m2 );
	const st0 = w2.credit.standing;
	const r = w2.hijack.castOff();
	ok( r.alarm && r.fight && evs( w2, 'hijackAlarm' ).length === 1 && w2.toasts.some( ( t ) => /The watch wakes aboard the Grey Cormorant/.test( t ) ), 'the watch wakes: hijackAlarm, a toast' );
	ok( w2.credit.standing < st0 && w2.hijack.bounty >= HIJACK.alarm.bounty, `standing lost, a $${ w2.hijack.bounty } bounty` );
	ok( w2.boarding.phase === 'cross-out' && w2.boarding.sneak === true && w2.boat.moored === false, 'her crew turn out (boarding from her deck: your own boat is left alone)' );
	run( w2, 1.2 );
	ok( w2.boarding.phase === 'surrender' && w2.boarding.view().choice.options.length === 3, 'beaten (no melee here): the surrender offers Take the ship' );
	w2.boarding.choose( 2 );
	run( w2, 1.5 );
	ok( w2.state.boat === 'sloop' && m2.taken && evs( w2, 'shipSunk' ).some( ( e ) => e.taken && e.id === m2.id ), 'taken after the fight; a pirate taken counts as beaten (shipSunk taken)' );
	ok( w2.hijack.vessel.faction === 'pirate' && w2.hijack.vessel.wanted, 'a pirate hull: her brothers want her back' );

	// by day the watch is mostly awake
	const w3 = makeWorld( { hour: 12 } );
	const m3 = w3.naval.spawn( 'trawler', { x: 300, z: 700, yaw: 0, state: 'moored', speed: 0 } );
	m3.state = 'moored';
	ok( Math.abs( w3.hijack.onClimb( m3 ).chance - watchChance( {} ) ) < 1e-9 && /the watch is about/.test( w3.toasts.at( - 1 ) ), 'by day the chance is the day watch\'s' );
	w3.player.position.set( 600, 0, 700 );
	run( w3, 0.1 );
	ok( w3.hijack.sneak === null, 'swimming off ends the sneak' );
	const s4 = w3.naval.spawn( 'sloop', { x: 900, z: 700, yaw: 0 } );
	ok( ! w3.hijack.canTake( s4 ), 'a sound ship under way cannot be climbed and taken' );

}

// ================================================================ 6. the mail plane
section( '6. the mail Petrel' );
{

	const calls = [];
	const sp = {
		fleet: {}, piloted: false, models: null,
		owns( af ) { return !! ( this.fleet[ af ] && this.fleet[ af ].owned ); },
		takeOut( af, o ) { calls.push( [ 'takeOut', af, o ] ); return { ok: true, text: '' }; },
		board() { calls.push( [ 'board' ] ); return true; },
	};
	const w = makeWorld( { hour: 8.1, seaplane: sp } );
	run( w, 0.1 );
	const m = w.hijack.mail;
	ok( m.at && m.port === 'tidemark', `at 8 h she lies in Tidemark's bay (${ m.at ? m.at.x.toFixed( 0 ) + ', ' + m.at.z.toFixed( 0 ) : '-' })` );
	ok( w.hijack.stealPlane().reason === 'pilot', 'the pilot is still aboard at 8.1 h' );
	w.app.settings.timeOfDay = 10;
	run( w, 0.1 );
	w.player.mode = 'walk';
	const door = w.hijack._mailDoor();
	w.player.position.set( door.x, 0.4, door.z );
	const it = w.features.nearestInteractable( w.player.position );
	ok( it && it.id === 'hijack-mail' && /pilot is at the tavern/.test( it.prompt() ), `E at her door: ${ it && it.prompt() }` );
	it.onInteract();
	ok( sp.fleet.petrel && sp.fleet.petrel.stolen && sp.fleet.petrel.owned && calls[ 0 ][ 0 ] === 'takeOut' && calls[ 0 ][ 1 ] === 'petrel' && calls[ 0 ][ 2 ].at.water === true && calls[ 1 ][ 0 ] === 'board', 'the stolen Petrel: a fleet entry { stolen }, sp.takeOut( petrel, { at: her water } ), aboard' );
	const vt = evs( w, 'vesselTaken' )[ 0 ];
	ok( vt && vt.class === 'petrel' && vt.id === 'mail-petrel' && w.hijack.bounty >= HIJACK.cost.mail.bounty && w.offences.includes( 'tidemark' ), `vesselTaken (petrel), a $${ w.hijack.bounty } bounty, an offence at Tidemark` );
	ok( ! w.hijack.mail.at && w.hijack.mail.until > w.hijack.hours, 'the mail service sends another later' );
	w.app.settings.timeOfDay = 16;
	run( w, 0.1 );
	ok( ! w.hijack.mail.at, 'not this afternoon' );
	const w2 = makeWorld( { hour: 10, seaplane: { ...sp, fleet: { petrel: { owned: true } }, owns() { return true; } } } );
	run( w2, 0.1 );
	ok( w2.hijack.stealPlane().reason === 'owned', 'with a Petrel of your own the hangar would know her twin' );

}

// ================================================================ 7. a resident's skiff, recovering your boat, the fence
section( '7. a resident\'s skiff, your boat back, the fence' );
{

	const w = makeWorld();
	const k = w.hijack.skiffs.find( ( q ) => q.port === 'pons' );
	const st0 = w.credit.standing;
	const r = w.hijack.takeSkiff( k.id );
	ok( r.ok && w.state.boat === k.kind && w.hijack.left[ 0 ].boat === 'lobster', `the ${ k.kind } off Pons Cove's jetty is yours at once; the lobster boat is left where she lay` );
	ok( w.credit.standing === st0 + HIJACK.cost.resident.merchant && w.hijack.vessel.faction === 'resident' && w.hijack.vessel.port === 'pons', 'a small loss of standing; wanted at Pons' );
	ok( w.hijack.takeSkiff( k.id ).ok === false && w.hijack._nearestSkiff( k, 5 ) === null, 'gone from the jetty until the resident gets another' );
	// back to the lobster boat (E beside her)
	const L = w.hijack.left[ 0 ];
	w.player.mode = 'swim';
	w.player.position.set( L.x + 2, 0, L.z );
	const it = w.features.nearestInteractable( w.player.position );
	ok( it && it.id === 'hijack-left' && /Take back your lobster boat/.test( it.prompt() ), `E beside her: ${ it && it.prompt() }` );
	it.onInteract();
	ok( w.state.boat === 'lobster' && w.hijack.left.length === 1 && w.hijack.left[ 0 ].boat === k.kind && w.hijack.vessel === null, 'back aboard the lobster boat; the skiff is left in her place' );
	ok( w.hijack.left[ 0 ].vessel && w.hijack.left[ 0 ].vessel.faction === 'resident', 'the skiff\'s wanted record stays with her' );
	// an agent delivers a left boat to a dock
	const dock = WORLD.ports.find( ( p ) => p.id === 'gull' ).dock;
	ok( w.hijack.recover( w.hijack.left[ 0 ].id, { dock } ) && w.state.boat === k.kind && Math.abs( w.boat.position.x - dock.position.x ) < 0.01 && w.hijack.vessel.faction === 'resident', 'recover( id, { dock } ): delivered and moored at that dock (the agents\' row)' );
	// the fence buys a stolen hull
	const w2 = makeWorld();
	const s = w2.naval.spawn( 'sloop', { x: 300, z: 700, yaw: 0, state: 'moored', speed: 0 } );
	s.state = 'moored';
	w2.hijack.takeShip( s, { how: 'sneaked' } );
	const q = w2.hijack.stolenQuote();
	ok( q && q.price === fencePrice( 'sloop' ) && q.hull === 'sloop', `the fence's quote: $${ q && q.price }` );
	const bm = new BlackMarket( {} );
	const rows = bm.rows( { standing: 50, stolen: q } );
	ok( rows.some( ( x ) => x.id === 'sellship' && x.price === q.price && x.ok ), 'the black market lists it (row sellship)' );
	ok( ! bm.rows( { standing: 0, stolen: q } ).find( ( x ) => x.id === 'sellship' ).ok, 'for those the brotherhood lets in' );
	const money = w2.state.money;
	const sold = w2.hijack.sellStolen();
	ok( sold.ok && w2.state.money === money + q.price && w2.state.boat === 'skiff' && w2.setBoats.at( - 1 ).dock.position === WORLD.blackwater.dock.position && evs( w2, 'stolenSold' ).length === 1, 'sold: the money, and a skiff moored at Blackwater\'s dock' );

}

// ================================================================ 8. Tidemark's moored merchant, multiplayer
section( '8. the merchant in Tidemark\'s bay, another crew\'s theft' );
{

	const w = makeWorld();
	const bay = WORLD.tidemark.bay;
	sail( w, bay.x + 300, bay.z );
	run( w, 0.1 );
	const h = w.hijack.harbour.ship;
	ok( h && h.state === 'moored' && h.kind === 'trawler' && w.hijack.canTake( h ), 'near Tidemark a merchant lies moored in the bay (takeable)' );
	sail( w, bay.x + 1500, bay.z );
	run( w, 0.1 );
	ok( ! w.hijack.harbour.ship && h.state === 'gone', 'and is gone when you are far' );
	// another player took a ship: the host removes her
	const t = w.naval.spawn( 'trawler', { x: 300, z: 700, yaw: 0 } );
	w.features.emit( 'remoteWorldEvent', { kind: 'vesselTaken', data: { id: t.id, class: 'trawler', by: 'other' }, from: 'other' } );
	ok( t.taken && t.state === 'gone', 'a remote vesselTaken removes the AI ship here' );
	const k = w.hijack.skiffs[ 0 ];
	w.features.emit( 'remoteWorldEvent', { kind: 'vesselTaken', data: { id: k.id, class: k.kind, by: 'other' }, from: 'other' } );
	ok( ! w.hijack._skiffFree( k ), 'and a resident\'s skiff another crew took' );

}

// ================================================================ 9. save round trip
section( '9. save' );
{

	const { json, w } = saved;
	ok( json.v === 1 && json.vessel && json.vessel.name === 'Patient Mary' && json.left.length === 1 && json.left[ 0 ].boat === 'lobster', 'toJSON: the vessel record, the boats left' );
	const w2 = makeWorld();
	w2.state.boat = 'trawler';
	w2.hijack.fromJSON( json );
	const a = w2.hijack.toJSON();
	ok( JSON.stringify( a ) === JSON.stringify( json ), 'fromJSON( toJSON() ) round-trips' );
	ok( w2.hijack.vessel.laundered && ! w2.hijack.vessel.wanted && w2.hijack.left[ 0 ].x === json.left[ 0 ].x, 'the laundered vessel and the moored lobster boat come back' );
	w2.hijack.fromJSON( { v: 1, vessel: { hull: 'nope' }, left: [ { boat: 'x', x: 1, z: 2 }, null, { boat: 'skiff', x: 'a' } ], bounty: - 5 } );
	ok( w2.hijack.vessel === null && w2.hijack.left.length === 0 && w2.hijack.bounty === 0, 'junk is ignored' );
	w.hijack.reset();
	ok( ! w.hijack.vessel && ! w.hijack.left.length && w.hijack.bounty === 0, 'reset() clears it all' );
	// installed through Features
	ok( w.features.get( 'hijack' ) === w.hijack && typeof hijackModule.install === 'function', 'listed on the registry (install( app, features ))' );

}

// ================================================================ 10. wave 16A: the mail plane's look and pilot, the left boats' pins
section( '10. the mail Petrel at her stops, her pilot, the left boats on the maps' );
{

	ok( hullFor( 'launch' ) === 'launch', 'a taken harbour launch sails as the cabin launch (class hull)' );
	const placed = [], residents = { list: [], removed: [],
		add( d ) { const r = { id: d.id, data: d, tasks: [], setTask( t ) { this.tasks.push( t ); } }; this.list.push( r ); return r; },
		remove( id ) { this.removed.push( id ); this.list = this.list.filter( ( r ) => r.id !== id ); return true; },
	};
	const sp = {
		fleet: {}, piloted: false, models: null,
		owns() { return false; },
		parkedVisual( af, liv ) { const v = { af, liv, visual: { group: new Group() }, disposed: false, place( x, y, z, h ) { placed.push( { x, y, z, h } ); }, dispose() { this.disposed = true; } }; this.last = v; return v; },
	};
	const T = WORLD.ports.find( ( p ) => p.id === 'tidemark' );
	const w = makeWorld( { hour: 8.1, seaplane: sp, hijack: { drawMail: true, residents } } );
	w.player.mode = 'walk';
	w.player.position.set( T.dock.position.x, 1, T.dock.position.z );
	w.boat.position.set( T.dock.position.x + 5, 0, T.dock.position.z );
	const tavern = { port: 'tidemark', x: T.stand.x + 20, z: T.stand.z + 4 };
	w.features.list.set( 'harbour', { module: null, instance: { sites: { tavern: [ tavern ] } } } );
	run( w, 0.3 );
	const m = w.hijack.mail, v = w.hijack.view().mail;
	ok( v && v.port === 'tidemark' && v.livery === HIJACK.mail.liv && v.lettering === 'MAIL' && v.drawn && v.letters, `she lies in Tidemark's bay in the mail livery with MAIL on her sides (${ JSON.stringify( v ) })` );
	ok( sp.last.af === 'petrel' && sp.last.liv === HIJACK.mail.liv && placed[ 0 ] && Math.abs( placed[ 0 ].x - m.at.x ) < 1e-9 && placed[ 0 ].y === 0, 'a parked Petrel on the water at her spot' );
	const letters = sp.last.visual.group.children.find( ( c ) => c.name === 'mail-lettering' );
	letters.geometry.computeBoundingBox();
	const lb = letters.geometry.boundingBox;
	ok( letters && lb.max.x > 0.5 && lb.min.x < - 0.5 && lb.min.y > 2 && lb.max.y < 2.6 && lb.max.z < - 0.9 && lb.min.z > - 2.6, 'MAIL in block letters on both sides of her fuselage, aft of the wing' );
	ok( w.toasts.some( ( t ) => /mail Petrel is in at Tidemark/.test( t ) ), 'a toast when the mail comes in near you' );
	const pr = residents.list[ 0 ];
	ok( pr && pr.id === HIJACK.mail.pilot.id && pr.data.character === HIJACK.mail.pilot.character && ( Math.hypot( pr.data.spot.x - T.dock.position.x, pr.data.spot.z - T.dock.position.z ) < 31 || ( pr.data.spot.x === T.stand.x && pr.data.spot.z === T.stand.z ) ) && w.hijack.view().mail.pilot === 'aboard', `her pilot ${ pr && pr.data.name } comes ashore at the dock (a resident)` );
	w.app.settings.timeOfDay = 9;
	run( w, 0.3 );
	const tv = pr.tasks.at( - 1 );
	ok( w.hijack.view().mail.pilot === 'tavern' && w.hijack.view().mail.pilotAway && tv && tv.indoors && tv.x === tavern.x && tv.z === tavern.z, `on the schedule he walks to the tavern (${ tv && tv.x.toFixed( 0 ) }, ${ tv && tv.z.toFixed( 0 ) }) and goes in` );
	w.app.settings.timeOfDay = 11.9;
	run( w, 0.3 );
	ok( w.hijack.view().mail.pilot === 'back' && pr.tasks.at( - 1 ) === null && ! w.hijack.view().mail.pilotAway, 'and back to the dock before she leaves' );
	w.app.settings.timeOfDay = 12.5;
	run( w, 0.3 );
	ok( ! w.hijack.mail.at && sp.last.disposed && residents.removed.includes( HIJACK.mail.pilot.id ) && w.hijack.view().mail === null, 'gone at noon: the plane and her pilot' );
	const far = makeWorld( { hour: 8.1, seaplane: { ...sp }, hijack: { drawMail: true, residents: { add() { return null; }, remove() {} } } } );
	run( far, 0.3 );
	ok( far.hijack.mail.at && ! far.toasts.some( ( t ) => /mail Petrel is in/.test( t ) ), 'far away: no toast' );

	// the boats you left: pins on the maps (kind boat), gone when you take her back
	const marks = new Map();
	const w2 = makeWorld();
	w2.features.list.set( 'worldmap', { module: null, instance: { addMarker: ( mk ) => marks.set( mk.id, { ...mk } ), removeMarker: ( id ) => marks.delete( id ) } } );
	const k = w2.hijack.skiffs.find( ( q ) => q.port === 'pons' );
	w2.hijack.takeSkiff( k.id );
	run( w2, 1.1 );
	const e = w2.hijack.left[ 0 ], mk = marks.get( 'left:' + e.id );
	ok( mk && mk.kind === 'boat' && mk.icon === 'boat' && mk.mine && mk.x === e.x && mk.z === e.z && /Your lobster boat/.test( mk.label ), `a pin on the maps: "${ mk && mk.label }"` );
	w2.hijack.recover( e.id );
	run( w2, 1.1 );
	ok( ! marks.has( 'left:' + e.id ) && marks.has( 'left:' + w2.hijack.left[ 0 ].id ), 'taken back: her pin goes, the skiff left in her place gets one' );

	// the fence's sale is shared (the host and the others learn the hull is gone)
	const w3 = makeWorld();
	const s3 = w3.naval.spawn( 'sloop', { x: 300, z: 700, yaw: 0, state: 'moored', speed: 0 } );
	s3.state = 'moored';
	w3.hijack.takeShip( s3, { how: 'sneaked' } );
	w3.hijack.sellStolen();
	const sh = w3.shared.find( ( x ) => x.kind === 'stolenSold' );
	ok( sh && sh.data.hull === 'sloop' && sh.data.price === fencePrice( 'sloop' ), 'sellStolen() shares stolenSold { hull, price }' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
