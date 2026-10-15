// Plain-node tests of town life (wave 18B: src/features/townlife, src/world/wildlife/TownAnimals.js): the day plans of
// every role resolve on every town, the town plans' places stand on reachable ground, the NavGrid routes and a whole
// simulated day keep everyone out of the sea and out of the buildings, the people budgets per tier (desktop / phone)
// and the body cap, the raid / cannon reaction (run indoors, out again later), greetings and E (a line, the event),
// the big-catch cheer, the fish hall queue (fish sold, the skiffs coming in), the clip fallbacks for wave 18E's names,
// the watch's lantern, the animals staying in town. No DOM, no GPU.
//   node test/feature-townlife.mjs
import { Vector3, Quaternion } from '../src/engine/index.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { ensureTidemark } from '../src/world/islands/town/TidemarkTerrain.js';
import { ensureBlackwater } from '../src/world/islands/BlackwaterTerrain.js';
import { Features } from '../src/features/Features.js';
import * as townlife from '../src/features/townlife/index.js';
import { townPlans, POPULATION } from '../src/features/townlife/Towns.js';
import { NavGrid } from '../src/features/townlife/NavGrid.js';
import { TOWN_SCHEDULES, validTownSchedule, townActivity } from '../src/features/townlife/Citizens.js';
import { townGround, resolveClip } from '../src/features/townlife/index.js';
import { TownAnimals } from '../src/world/wildlife/TownAnimals.js';
import { externalSeats } from '../src/features/townlife/Towns.js';
import { villageSeats } from '../src/world/Village.js';
import { tidemarkSeats } from '../src/world/islands/town/Waterfront.js';
import { blackwaterSeats } from '../src/world/islands/Blackwater.js';
import { Meridian } from '../src/world/islands/meridian/Meridian.js';

let fails = 0, n = 0;
const ok = ( c, msg, info = '' ) => {

	n ++;
	if ( ! c ) { fails ++; console.log( 'FAIL', msg, info ); } else console.log( 'ok  ', msg, info );

};
const section = ( s ) => console.log( '\n== ' + s );

const terrain = new TerrainData();
ensureTidemark( terrain );
ensureBlackwater( terrain );
const plans = townPlans();
const SEATS = {
	home: externalSeats( villageSeats( terrain ), ( x, z ) => terrain.heightAt( x, z ) ),
	tidemark: externalSeats( tidemarkSeats( terrain ), ( x, z ) => terrain.heightAt( x, z ) ),
	blackwater: externalSeats( blackwaterSeats( terrain ), ( x, z ) => terrain.heightAt( x, z ) ),
};
globalThis.__quietKit = true;
const meridianCity = new Meridian( { scene: null, terrain, colliders: null, kit: false } );
{

	const mg = plans.find( ( p ) => p.id === 'meridian' ).grid, F = mg.frame;
	SEATS.meridian = externalSeats( meridianCity.seats.filter( ( s ) => s.x - F.x > mg.u0 + 2 && s.x - F.x < mg.u1 - 2 && s.z - F.z > mg.v0 + 2 && s.z - F.z < mg.v1 - 2 ), ( x, z ) => terrain.heightAt( x, z ) );

}

const BASE = [ 'Idle_Breathe', 'Walk_InPlace', 'Run_InPlace', 'Talk', 'Wave', 'Look_Around', 'Cheer_Clap', 'Dance', 'Fishing_Hold', 'Fishing_Reel', 'Chat_Gesture',
	'Sweep_Work', 'Inspect_Catch', 'Shrug', 'Point', 'Laugh', 'Beckon', 'Swagger_Idle', 'Friendly_Wave', 'Seated_Idle' ];
function fakeFactory( made = [] ) {

	return ( { character } ) => {

		const model = { clips: new Set( BASE ), current: null, played: [], play( name ) { this.current = name; this.played.push( name ); }, update() {}, hold() {} };
		const a = { character, model, group: { position: new Vector3(), quaternion: new Quaternion(), scale: new Vector3( 1, 1, 1 ), visible: true, updateMatrixWorld() {} }, ready: Promise.resolve( model ), dispose() { this.disposed = true; } };
		made.push( a );
		return a;

	};

}

function world( { hour = 10, at = null, phone = false, made = [] } = {} ) {

	const p = at || plans[ 0 ].center;
	const app = {
		settings: { timeOfDay: hour }, terrainData: terrain, residents: null, mode: 'campaign',
		game: { toasts: [], toast( t ) { this.toasts.push( t ); } },
		player: { mode: 'walk', position: new Vector3( p.x, terrain.heightAt( p.x, p.z ), p.z ) },
		meridian: meridianCity,
	};
	const features = new Features( app );
	const tl = townlife.install( app, features, { avatarFactory: fakeFactory( made ), phone, rand: seq() } );
	features.list.set( 'townlife', { module: townlife, instance: tl } );
	return { app, features, tl, made };

}

function seq( seed = 5 ) {

	let a = seed >>> 0;
	return () => {

		a = ( a + 0x6d2b79f5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

// run frames of dt; the clock advances `hoursPerSec` island hours a real second (the game's default: 0.01)
async function run( w, seconds, dt = 0.1, hoursPerSec = 0, each = null ) {

	for ( let t = 0; t < seconds; t += dt ) {

		w.app.settings.timeOfDay = ( w.app.settings.timeOfDay + dt * hoursPerSec ) % 24;
		w.tl.update( dt );
		if ( each ) each( t );

	}

	await Promise.resolve();

}

async function ready( w ) {

	for ( let k = 0; k < 400 && ( k < 2 || ! w.tl.towns.every( ( t ) => t.ready || ! t.grid ) ); k ++ ) w.tl.update( 0.05 );
	await Promise.resolve();

}

// the walls and the sea, independent of the grid: inside a building's footprint (not inflated) or an obstacle, or on water
function inWall( plan, x, z ) {

	for ( const b of plan.buildings ) {

		const dx = x - b.x, dz = z - b.z, c = Math.cos( b.yaw ), s = Math.sin( b.yaw );
		if ( Math.abs( dx * c - dz * s ) < b.hx - 0.2 && Math.abs( dx * s + dz * c ) < b.hz - 0.2 ) return b.id || 'building';

	}

	for ( const o of plan.obstacles ) {

		// a bench: sitting on it (or the step on and off it at a seat) is the point
		if ( o.seat && SEATS[ plan.id ].some( ( q ) => Math.hypot( q.x - x, q.z - z ) < 0.9 ) ) continue;
		if ( o.r !== undefined ) { if ( Math.hypot( x - o.x, z - o.z ) < o.r - 0.05 ) return o.id || 'prop'; continue; }
		const dx = x - o.x, dz = z - o.z, c = Math.cos( o.yaw || 0 ), s = Math.sin( o.yaw || 0 );
		if ( Math.abs( dx * c - dz * s ) < o.hx - 0.05 && Math.abs( dx * s + dz * c ) < o.hz - 0.05 ) return o.id || 'prop';

	}

	return null;

}

const grounds = Object.fromEntries( plans.map( ( p ) => [ p.id, townGround( terrain, p.decks.map( ( d ) => ( { ...d, c: Math.cos( d.yaw ), s: Math.sin( d.yaw ), top: d.foot ? Math.max( d.y, terrain.heightAt( d.foot.x, d.foot.z ) + 0.3 ) : d.y } ) ) ) ] ) );
const wet = ( plan, x, z ) => {

	const g = grounds[ plan.id ]( x, z );
	return ! g || ( ! g.deck && g.y <= 0.3 );

};

// ---------------------------------------------------------------- day plans
section( 'day plans' );
{

	for ( const [ id, s ] of Object.entries( TOWN_SCHEDULES ) ) ok( validTownSchedule( s ), `schedule ${ id } covers the day` );
	for ( const [ town, pop ] of Object.entries( POPULATION ) ) for ( const role of Object.keys( pop.roles ) ) ok( !! TOWN_SCHEDULES[ role ], `${ town }: role ${ role } has a schedule` );
	ok( townActivity( 'vendor', 9 ) === 'work' && townActivity( 'vendor', 2 ) === 'sleep', 'vendors work the morning, sleep at night' );
	ok( townActivity( 'regular', 20 ) === 'tavern' && townActivity( 'regular', 23.6 ) === 'drunk', 'regulars drink the evening and stagger home' );
	ok( townActivity( 'watchman', 23 ) === 'watch' && townActivity( 'watchman', 10 ) === 'sleep', 'the watch walks the night' );
	ok( townActivity( 'lamplighter', 18 ) === 'lamps', 'the lamplighter at dusk' );
	ok( townActivity( 'pirate', 22 ) === 'tavern' && townActivity( 'pirate', 8 ) === 'sleep', 'pirates carouse at night, sleep the morning' );
	ok( townActivity( 'child', 10 ) === 'play' && townActivity( 'child', 22 ) === 'sleep', 'children play by day' );

}

// ---------------------------------------------------------------- the plans and their grids
section( 'plans on the ground, the NavGrid' );
const grids = {};
for ( const plan of plans ) {

	const t0 = performance.now();
	const g = new NavGrid( plan.grid, { ground: grounds[ plan.id ], obstacles: [ ...plan.buildings, ...plan.obstacles ], streets: plan.streets, pathDistance: ( x, z ) => terrain.pathDistance( x, z ) } );
	let steps = 0;
	while ( ! g.buildStep( 3500 ) ) steps ++;
	grids[ plan.id ] = g;
	let free = 0, street = 0;
	for ( let k = 0; k < g.n; k ++ ) { if ( g.cost[ k ] > 0 ) free ++; if ( g.cost[ k ] === 1 ) street ++; }
	ok( free > 3000 && street > 300, `${ plan.id }: grid ${ g.nu } x ${ g.nv }, ${ free } free cells, ${ street } on streets`, `(${ ( performance.now() - t0 ).toFixed( 0 ) } ms in ${ steps + 1 } slices)` );
	const places = [];
	for ( const h of [ ...plan.homes, ...plan.outskirts ] ) places.push( [ h.id, h ] );
	for ( const s of plan.stalls ) { places.push( [ s.id + ' vendor', s.vendor ] ); s.front.forEach( ( f, i ) => places.push( [ s.id + ' customer ' + i, f ] ) ); }
	if ( plan.hall ) plan.hall.queue.forEach( ( q, i ) => places.push( [ 'queue ' + i, q ] ) );
	plan.tavern.patio.forEach( ( q, i ) => places.push( [ 'patio ' + i, q ] ) );
	for ( const ga of plan.gathers ) ga.slots.forEach( ( q, i ) => places.push( [ ga.id + ' slot ' + i, q ] ) );
	for ( const [ k, list ] of Object.entries( plan.work ) ) list.forEach( ( q, i ) => ( Array.isArray( q ) ? q : [ q ] ).forEach( ( p, j ) => places.push( [ `${ k } ${ i }.${ j }`, p ] ) ) );
	plan.patrol.forEach( ( q, i ) => places.push( [ 'beat ' + i, q ] ) );
	plan.lamps.forEach( ( q, i ) => places.push( [ 'lamp ' + i, q ] ) );
	if ( plan.play ) places.push( [ 'play', plan.play ] );
	SEATS[ plan.id ].forEach( ( q, i ) => places.push( [ 'seat ' + ( q.id || i ), q ] ) );
	ok( SEATS[ plan.id ].length >= 4 && SEATS[ plan.id ].every( ( q ) => q.h > 0.3 && q.h < 0.95 ), `${ plan.id }: wave 18C's ${ SEATS[ plan.id ].length } seats read (height ${ SEATS[ plan.id ].map( ( q ) => q.h.toFixed( 2 ) ).filter( ( v, i, a ) => a.indexOf( v ) === i ).join( ' / ' ) } m)` );
	const from = g.nearestFree( plan.center.x, plan.center.z, 10 );
	let bad = [], wall = [], sea = [];
	for ( const [ id, p ] of places ) {

		const r = from && g.route( from.x, from.z, p.x, p.z );
		if ( ! r ) { bad.push( id ); continue; }
		// sample the route every 0.4 m
		let px = from.x, pz = from.z;
		for ( const q of r ) {

			const L = Math.hypot( q.x - px, q.z - pz ), m = Math.max( 1, Math.ceil( L / 0.4 ) );
			for ( let s = 0; s <= m; s ++ ) {

				const x = px + ( q.x - px ) * s / m, z = pz + ( q.z - pz ) * s / m;
				const w = inWall( plan, x, z );
				if ( w && ! wall.includes( id ) ) wall.push( `${ id } (${ w })` );
				if ( wet( plan, x, z ) && ! sea.includes( id ) ) sea.push( id );

			}

			px = q.x; pz = q.z;

		}

	}

	ok( bad.length === 0, `${ plan.id }: all ${ places.length } places of the day are reachable`, bad.join( ', ' ) );
	ok( wall.length === 0, `${ plan.id }: no route goes through a wall or a prop`, wall.slice( 0, 6 ).join( ', ' ) );
	ok( sea.length === 0, `${ plan.id }: no route goes into the sea`, sea.slice( 0, 6 ).join( ', ' ) );

}

// ---------------------------------------------------------------- budgets
section( 'budgets per tier' );
{

	const want = { home: 12, tidemark: 47, blackwater: 16, meridian: 42 };
	const d = world();
	for ( const t of d.tl.towns ) ok( t.sim.list.length === want[ t.plan.id ], `desktop: ${ t.plan.id } has ${ t.sim.list.length } townsfolk` );
	const ph = world( { phone: true } );
	for ( const t of ph.tl.towns ) ok( t.sim.list.length <= Math.ceil( want[ t.plan.id ] / 2 ) + 3 && t.sim.list.length >= Math.floor( want[ t.plan.id ] / 2 ) - 1, `phone: ${ t.plan.id } has about half (${ t.sim.list.length })` );
	ok( d.tl.bodyCap === 24 && ph.tl.bodyCap === 12, 'avatar budget: 24 desktop, 12 phone' );
	ok( d.tl.lights.length >= 3, `the watch carries lanterns (${ d.tl.lights.length } lamps)` );

}

// ---------------------------------------------------------------- a whole day in every town
section( 'a day in each town: nobody in the sea or the walls' );
for ( const plan of plans ) {

	const made = [];
	const w = world( { hour: 0, at: plan.center, made } );
	await ready( w );
	const t = w.tl.towns.find( ( q ) => q.plan.id === plan.id );
	ok( t.ready, `${ plan.id }: the grid built in slices as the player arrived` );
	const sim = t.sim;
	let wall = 0, sea = 0, maxBodies = 0, hidden = 0, samples = 0, firstWall = '', firstSea = '';
	const acts = new Set(), kinds = new Set();
	let night = 0, tavernNight = 0, watchOut = 0, lampOn = 0, boundWatch = 0;
	await run( w, 2400, 0.25, 0.01, () => {

		maxBodies = Math.max( maxBodies, w.tl.bound.size );
		for ( const c of sim.list ) {

			acts.add( c.act );
			if ( c.goal ) kinds.add( c.goal.kind );
			if ( c.hidden ) { hidden ++; continue; }
			samples ++;
			const wl = inWall( plan, c.x, c.z );
			if ( wl ) { wall ++; if ( ! firstWall ) firstWall = `${ c.id } at ${ c.x.toFixed( 1 ) }, ${ c.z.toFixed( 1 ) } in ${ wl } (${ c.act } / ${ c.goal && c.goal.kind })`; }
			if ( wet( plan, c.x, c.z ) ) { sea ++; if ( ! firstSea ) firstSea = `${ c.id } at ${ c.x.toFixed( 1 ) }, ${ c.z.toFixed( 1 ) } (${ c.act } / ${ c.goal && c.goal.kind })`; }

		}

		const h = w.app.settings.timeOfDay;
		if ( h > 19 && h < 20.8 ) {

			night ++;
			tavernNight += sim.crowd();

		}

		if ( h > 21 || h < 5 ) for ( const c of sim.list ) {

			if ( c.act !== 'watch' || c.hidden ) continue;
			watchOut ++;
			if ( c.body && c.light ) { c.light.update(); boundWatch ++; if ( c.light.scale > 0 ) lampOn ++; }

		}

	} );
	ok( wall === 0, `${ plan.id }: ${ samples } positions over the day, none inside a building or a prop`, firstWall );
	ok( sea === 0, `${ plan.id }: nobody walked into the sea`, firstSea );
	ok( hidden > 0, `${ plan.id }: people go indoors (night, the tavern)` );
	ok( maxBodies <= 24 && maxBodies > 0, `${ plan.id }: at most 24 avatars at once (${ maxBodies })` );
	ok( [ 'sleep', 'work', 'eat', 'tavern' ].every( ( a ) => acts.has( a ) ), `${ plan.id }: the day had sleep, work, eat and the tavern`, [ ...acts ].join( ' ' ) );
	ok( tavernNight / Math.max( 1, night ) >= 3, `${ plan.id }: the tavern is busy in the evening (${ ( tavernNight / Math.max( 1, night ) ).toFixed( 1 ) } there on average)` );
	if ( plan.id !== 'blackwater' ) ok( kinds.has( 'gather' ) && kinds.has( 'stall' ), `${ plan.id }: people gathered to talk and kept the stalls`, [ ...kinds ].join( ' ' ) );
	if ( plan.id === 'tidemark' ) {

		ok( kinds.has( 'nets' ) && kinds.has( 'carry' ) && kinds.has( 'barrow' ) && kinds.has( 'lamp' ) && kinds.has( 'patrol' ), 'Tidemark: nets mended, crates carried, a barrow pushed, the lamps lit, the watch walked', [ ...kinds ].join( ' ' ) );
		ok( watchOut > 0 && lampOn === boundWatch, `Tidemark: the watch is out at night, the lantern lit whenever it is near (${ lampOn } / ${ boundWatch } frames)` );

	}

	if ( plan.id === 'home' ) ok( kinds.has( 'play' ), 'home: the children played on the beach' );
	ok( kinds.has( 'seat' ), `${ plan.id }: people sat on the benches (${ sim.seats.length } seats)` );
	// the clips the bodies played: wave 18E names resolve to clips the GLB has
	const played = new Set( made.flatMap( ( a ) => a.model.played ) );
	ok( [ ...played ].every( ( c ) => BASE.includes( c ) ), `${ plan.id }: every clip played exists on the GLB (${ played.size } different)`, [ ...played ].filter( ( c ) => ! BASE.includes( c ) ).join( ' ' ) );

}

// ---------------------------------------------------------------- reactions
section( 'raids, cannon fire, cheers, the queue, greetings' );
{

	const tm = plans.find( ( p ) => p.id === 'tidemark' );
	const w = world( { hour: 10, at: tm.center } );
	await ready( w );
	await run( w, 60, 0.1 );
	const sim = w.tl.sims.tidemark;
	const out = () => sim.list.filter( ( c ) => ! c.hidden ).length;
	const before = out();
	w.features.emit( 'cannonFired', { x: tm.center.x + 20, y: 3, z: tm.center.z, by: 'pirate' } );
	ok( sim.list.filter( ( c ) => c.fleeing ).length > before * 0.6, `cannon fire: most of the ${ before } outside run (${ sim.list.filter( ( c ) => c.fleeing ).length })` );
	await run( w, 50, 0.1 );
	const runners = w.made.map( ( a ) => a.model.played ).flat();
	ok( runners.includes( 'Run_InPlace' ), 'the near ones run (the run clip)' );
	ok( out() <= Math.max( 2, before * 0.25 ), `within 50 s they are indoors (${ out() } still out)` );
	await run( w, 120, 0.25 );
	ok( out() >= before * 0.5, `after the alarm they come out again (${ out() })` );

	// a raid on the home harbour
	const home = plans.find( ( p ) => p.id === 'home' );
	const h = world( { hour: 10, at: home.center } );
	await ready( h );
	await run( h, 40, 0.1 );
	h.features.emit( 'retaliationRaid', { at: 'harbour', captain: 'Redbeard' } );
	await run( h, 60, 0.1 );
	ok( h.tl.sims.home.list.every( ( c ) => c.hidden || c.fleeing ), 'a raid on the harbour: the whole village shelters' );

	// a big catch near the quay
	const w2 = world( { hour: 10, at: tm.center } );
	await ready( w2 );
	await run( w2, 40, 0.1 );
	const p = w2.app.player.position;
	const near = w2.tl.sims.tidemark.list.filter( ( c ) => ! c.hidden && Math.hypot( c.x - p.x, c.z - p.z ) < 20 ).length;
	w2.features.emit( 'fishCaught', { species: 'tarpon', kg: 14, value: 320 } );
	const clapping = w2.tl.sims.tidemark.list.filter( ( c ) => c.react && /Clap/.test( c.react.clip ) ).length;
	ok( near < 2 || clapping >= 2, `a big catch: the folk around clap (${ clapping } of ${ near })` );
	w2.features.emit( 'fishCaught', { species: 'grunt', kg: 0.6, value: 8 } );
	ok( true, 'a small one: nothing (no throw)' );

	// fish sold at Tidemark: a queue at the fish hall
	w2.features.emit( 'fishSold', { count: 3, total: 90, port: 'tidemark' } );
	const q = w2.tl.sims.tidemark.list.filter( ( c ) => c.queueSlot >= 0 );
	ok( q.length >= 2 && q.every( ( c ) => c.goal.kind === 'queue' ), `fish sold: ${ q.length } queue at the fish hall` );
	await run( w2, 40, 0.1 );
	const lined = q.filter( ( c ) => c.queueSlot >= 0 && c.arrived );
	ok( lined.every( ( c ) => Math.hypot( c.x - tm.hall.queue[ c.queueSlot ].x, c.z - tm.hall.queue[ c.queueSlot ].z ) < 0.6 ), `they stand in line, one behind the other (${ lined.length })` );
	await run( w2, 100, 0.25 );
	ok( w2.tl.sims.tidemark.list.every( ( c ) => c.queueSlot < 0 ), 'served, the queue empties' );

	// the skiffs come in: the queue again
	const w3 = world( { hour: 0, at: tm.center } );
	await ready( w3 );
	const sk = w3.tl.towns.find( ( t ) => t.plan.id === 'tidemark' );
	w3.app.settings.timeOfDay = sk.plan.skiffs[ 0 ].back + 0.05;
	await run( w3, 1, 0.1 );
	ok( sk.skiffs[ 0 ].phase === 'in', 'a skiff rows home in the afternoon' );
	w3.app.settings.timeOfDay = 12;
	await run( w3, 30, 0.1 );
	w3.app.settings.timeOfDay = sk.plan.skiffs[ 0 ].back + 0.05;
	await run( w3, 0.2, 0.1 );
	w3.app.settings.timeOfDay = sk.plan.skiffs[ 0 ].back + sk.skiffs[ 0 ].tr + 0.1;
	await run( w3, 0.2, 0.1 );
	ok( sk.skiffs[ 0 ].phase === 'dock' && w3.tl.sims.tidemark.queueT > 0, 'it lands: folk queue at the fish hall' );

	// greetings and E
	const w4 = world( { hour: 10, at: tm.center } );
	await ready( w4 );
	await run( w4, 30, 0.1 );
	const c = [ ...w4.tl.bound.keys() ].find( ( q ) => ! q.hidden && ! q.sitting && ! q.fleeing );
	ok( !! c, 'someone near has a body' );
	if ( c ) {

		c.react = null; c.greetAt = undefined;
		const pp = w4.app.player.position;
		pp.set( c.x + 2.0, terrain.heightAt( c.x + 2, c.z ), c.z );
		w4.tl._prev = null;
		w4.tl._lodT = 0;
		w4.tl.update( 0.05 );
		ok( c.react && c.react.clip === 'Friendly_Wave', `${ c.name } waves as the player passes` );
		const e = w4.features.nearestInteractable( pp );
		ok( e && e.id === 'townlife:talk' && /^Talk to /.test( e.prompt() ), 'E: "Talk to …"', e ? e.prompt() : '' );
		let ev = null;
		w4.features.on( 'townsfolkTalked', ( x ) => { ev = x; } );
		const toasts = w4.app.game.toasts.length;
		e.onInteract();
		ok( ev && ev.port === 'tidemark' && w4.app.game.toasts.length > toasts && c.talkT > 0, 'a line of their role, the event, and they talk', w4.app.game.toasts[ w4.app.game.toasts.length - 1 ] );

	}

}

// ---------------------------------------------------------------- clips, animals
section( 'clip fallbacks, animals' );
{

	const m = { clips: new Set( BASE ) };
	ok( resolveClip( m, 'Fish_Net' ) === 'Inspect_Catch' && resolveClip( m, 'Sit_Chair_Idle' ) === 'Seated_Idle' && resolveClip( m, 'Talk_Group' ) === 'Chat_Gesture', 'wave 18E names fall back to the phase-1 clips' );
	const m2 = { clips: new Set( [ ...BASE, 'Fish_Net', 'Drunk_Walk' ] ) };
	ok( resolveClip( m2, 'Fish_Net' ) === 'Fish_Net' && resolveClip( m2, 'Drunk_Walk' ) === 'Drunk_Walk', 'and play themselves once the GLB has them' );
	ok( resolveClip( m, 'Nonsense_Clip' ) === 'Idle_Breathe', 'an unknown name idles' );

	const plan = plans[ 0 ];
	const g = grids.home;
	const A = new TownAnimals( { render: false } );
	A.addTown( 'home', { pens: plan.pens, animals: plan.animals, free: ( x, z ) => g.free( x, z ), ground: ( x, z ) => terrain.heightAt( x, z ) } );
	ok( A.list.length === Object.values( plan.animals ).reduce( ( s, v ) => s + v, 0 ), `home: ${ A.list.length } animals (dogs, cats, chickens, goats)` );
	const viewer = { x: plan.center.x, z: plan.center.z, speed: 1.2, mode: 'walk' };
	let off = 0, moved = 0;
	const start = A.list.map( ( a ) => [ a.x, a.z ] );
	for ( let k = 0; k < 1200; k ++ ) {

		A.update( 0.1, viewer, new Set( [ 'home' ] ) );
		for ( const a of A.list ) if ( Math.hypot( a.x - a.pen.x, a.z - a.pen.z ) > a.pen.r + 32 ) off ++;

	}

	A.list.forEach( ( a, i ) => { if ( Math.hypot( a.x - start[ i ][ 0 ], a.z - start[ i ][ 1 ] ) > 0.5 ) moved ++; } );
	ok( off === 0, 'the animals stay in town (a dog may tag along, not wander off)' );
	ok( moved >= A.list.length * 0.6, `they move about (${ moved } of ${ A.list.length })` );

}

console.log( `\n${ n - fails } / ${ n } passed` );
process.exit( fails ? 1 : 0 );
