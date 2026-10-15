// Plain-node test of wave 21B, the cars (src/features/cars): the arcade physics stays bounded (no flips on flat roads, kerbs,
// a wall, a ledge, a hill held by the brake), getting in / out / taking a car (a parked one, a stopped one with its driver
// thrown out: wanted), damage stages to the explosion, walls and breakable props, the townsfolk in the road, the police
// chase and the bust, the traffic on a small road graph of our own (lights obeyed, giving way, honks, reroutes round a
// blocked road, buses) and on Meridian's plan (connected, lanes clear of the parking), the dealer and the save round trip,
// the budgets (phones a third), the GLBs' nodes and the remote cars.
//   node test/feature-cars.mjs
import { readFileSync } from 'node:fs';
import { Vector3 } from '../src/engine/index.js';
import { Features } from '../src/features/Features.js';
import * as carsModule from '../src/features/cars/index.js';
import { KINDS, KIND_IDS, DAMAGE, WANTED, TRAFFIC, stageOf, impactDamage, wantedLevel, CarBody, CarWorld, RoadGraph, Traffic } from '../src/features/cars/index.js';
import { Colliders } from '../src/world/Colliders.js';
import { cityPlan, MERIDIAN } from '../src/world/islands/meridian/CityPlan.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';

let fails = 0, passes = 0;
const ok = ( c, msg, extra = '' ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg, extra ); } else { passes ++; console.log( 'ok  ', msg, extra ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const DT = 1 / 60;

// ---------------------------------------------------------------- a small road graph of our own (3 x 3, 120 m blocks)

function testRoads() {

	const nodes = [], edges = [];
	for ( let i = 0; i < 3; i ++ ) for ( let j = 0; j < 3; j ++ ) nodes.push( { id: `n${ i }${ j }`, x: i * 120, z: j * 120, y: 0, signal: i === 1 && j === 1 } );
	nodes.push( { id: 'dead', x: 360, z: 120, y: 0, signal: false } );
	const E = ( a, b, lanes = 2, width = 9, speed = 11, kind = 'street' ) => edges.push( { id: `${ a }~${ b }`, a, b, lanes, width, speed, oneWay: false, kind } );
	for ( let i = 0; i < 3; i ++ ) for ( let j = 0; j < 3; j ++ ) {

		if ( i < 2 ) E( `n${ i }${ j }`, `n${ i + 1 }${ j }`, j === 1 ? 4 : 2, j === 1 ? 14 : 9, j === 1 ? 14 : 11, j === 1 ? 'avenue' : 'street' );
		if ( j < 2 ) E( `n${ i }${ j }`, `n${ i }${ j + 1 }` );

	}

	E( 'n21', 'dead' );
	const byId = Object.fromEntries( nodes.map( ( n ) => [ n.id, n ] ) );
	return { nodes, edges, byId };

}

const testPlan = () => {

	const roads = testRoads();
	const parking = [ { x: 60, z: 3.4, yaw: Math.PI / 2, kind: 'street', edge: 'n00~n10' }, { x: 100, z: 243.4, yaw: Math.PI / 2, kind: 'street', edge: 'n02~n12' }, { x: 60, z: 236.6, yaw: - Math.PI / 2, kind: 'street', edge: 'n02~n12' } ];
	return { roads, parking, buildings: [ { id: 'g1', kind: 'midrise', style: 'garage', x: 60, z: - 30, w: 30, d: 20, yaw: 0, h: 14 } ], port: null };

};

class FakeInput {

	constructor() { this.keys = new Set(); this.pressed = new Set(); }
	down( c ) { return this.keys.has( c ); }
	hit( c ) { return this.pressed.has( c ); }

}

function makeWorld( o = {} ) {

	const events = [], toasts = [], shared = [];
	const input = new FakeInput();
	const player = {
		mode: 'walk', position: new Vector3( o.px ?? 60, 0, o.pz ?? 6 ), vehicle: null, prompt: null,
		enterVehicle( v ) { this.vehicle = v; this.mode = 'plane'; return true; },
		exitVehicle( x, y, z, yaw, m ) { this.vehicle = null; this.mode = m; this.position.set( x, y, z ); },
	};
	const state = { money: o.money ?? 20000, spend( n ) { if ( this.money < n ) return false; this.money -= n; return true; }, earn( n ) { this.money += n; } };
	const app = { player, input, settings: { timeOfDay: o.hour ?? 12 }, game: { toast: ( t ) => toasts.push( t ), state }, colliders: o.colliders || new Colliders(),
		netsync: { sendWorldEvent: ( k, d ) => shared.push( { k, d } ) }, mode: o.mode || 'campaign' };
	const f = new Features( app );
	for ( const n of [ 'carEntered', 'carExited', 'carJacked', 'carDamaged', 'carWrecked', 'carExploded', 'explosion', 'pedestrianHit', 'playerKnockedDown', 'carWanted', 'cityBusted', 'carBought', 'carSold' ] ) f.on( n, ( e ) => events.push( { n, e } ) );
	if ( o.extra ) for ( const [ k, v ] of Object.entries( o.extra ) ) f.list.set( k, { module: {}, instance: v } );
	const cars = f.add( 'cars', { install: ( a, fe ) => carsModule.install( a, fe, {
		render: false, seed: o.seed ?? 7, plan: o.plan || testPlan(), terrain: o.terrain || { heightAt: () => 0 }, roadHeight: () => null,
		alwaysActive: true, scale: o.scale ?? 1, citizens: o.citizens, flatRoads: true, traffic: o.traffic || ( o.plan ? undefined : { fill: 1, cars: 46 } ),
	} ) } );
	return { app, f, cars, events, toasts, shared, input, player, state };

}

const has = ( ev, n ) => ev.filter( ( x ) => x.n === n );

// ---------------------------------------------------------------- physics

section( 'physics: bounded on flat roads, kerbs, walls, ledges and hills' );
{

	const flat = { ground: () => 0 };
	for ( const k of KIND_IDS ) {

		const b = new CarBody( KINDS[ k ], {} );
		let maxTilt = 0, maxV = 0, rng = 1;
		for ( let i = 0; i < 60 * 40; i ++ ) {

			rng = ( rng * 16807 ) % 2147483647;
			const r = rng / 2147483647;
			const inp = { throttle: i % 600 < 400 ? 1 : 0, brake: i % 600 >= 500 ? 1 : 0, steer: Math.sin( i * 0.013 ) * ( r > 0.5 ? 1 : - 1 ), handbrake: i % 900 > 820 };
			b.step( DT, inp, flat );
			maxTilt = Math.max( maxTilt, Math.abs( b.pitch ), Math.abs( b.roll ) );
			maxV = Math.max( maxV, Math.abs( b.speed ) );

		}

		ok( maxTilt < 1e-6 && b.grounded && Math.abs( b.y ) < 1e-6 && maxV <= KINDS[ k ].top * 1.15 + 1e-6, `${ k }: 40 s of wild driving on a flat road: no pitch / roll, grounded, under its top speed`, `(tilt ${ maxTilt.toFixed( 4 ) }, max ${ maxV.toFixed( 1 ) } m/s)` );

	}

	let b = new CarBody( KINDS.sedan, {} );
	for ( let i = 0; i < 300; i ++ ) b.step( DT, { throttle: 1 }, flat );
	ok( b.speed > 15 && b.speed < 30, 'a sedan reaches town speed in 5 s', `(${ b.speed.toFixed( 1 ) } m/s)` );
	for ( let i = 0; i < 180; i ++ ) b.step( DT, { throttle: 0.6, steer: 1 }, flat );
	ok( b.yawRate > 0.2, 'A steers it left (yaw rate +)', `(${ b.yawRate.toFixed( 2 ) })` );
	let slid = 0;
	for ( let i = 0; i < 90; i ++ ) { b.step( DT, { throttle: 0.4, steer: 1, handbrake: true }, flat ); slid = Math.max( slid, b.slip ); }
	ok( slid > 2, 'the handbrake slides the tail out', `(slip ${ slid.toFixed( 1 ) } m/s)` );
	b = new CarBody( KINDS.sedan, {} );
	for ( let i = 0; i < 240; i ++ ) b.step( DT, { brake: 1 }, flat );
	ok( b.speed < - 3, 'S from standstill reverses', `(${ b.speed.toFixed( 1 ) })` );

	// a kerb: 15 cm up and back down
	const kerb = { ground: ( x, z ) => ( z > 20 && z < 26 ? 0.15 : 0 ) };
	b = new CarBody( KINDS.sedan, {} );
	let tilt = 0;
	for ( let i = 0; i < 420; i ++ ) { b.step( DT, { throttle: 0.7 }, kerb ); tilt = Math.max( tilt, Math.abs( b.pitch ) ); }
	ok( b.z > 30 && tilt < 0.12 && b.grounded, 'over a kerb: a bump, no launch, grounded after', `(pitch max ${ tilt.toFixed( 3 ) })` );

	// a wall of rock 2 m high: stops the car, an impact
	const wall = { ground: ( x, z ) => ( z > 15 ? 2 : 0 ) };
	b = new CarBody( KINDS.sedan, {} );
	let hit = 0;
	for ( let i = 0; i < 400; i ++ ) { b.step( DT, { throttle: 1 }, wall ); for ( const e of b.impacts ) hit = Math.max( hit, e.speed ); }
	ok( b.z < 15 && hit > 5, 'a 2 m step is a wall: stopped before it, an impact', `(z ${ b.z.toFixed( 1 ) }, ${ hit.toFixed( 1 ) } m/s)` );

	// off a 6 m ledge: airborne, lands, still upright
	const ledge = { ground: ( x, z ) => ( z > 30 ? - 6 : 0 ) };
	b = new CarBody( KINDS.sedan, {} );
	let air = false;
	for ( let i = 0; i < 400; i ++ ) { b.step( DT, { throttle: 1 }, ledge ); if ( ! b.grounded ) air = true; }
	ok( air && b.grounded && Math.abs( b.y + 6 ) < 0.05 && b.landing > 5, 'off a ledge: airborne, lands on its wheels', `(landing ${ b.landing.toFixed( 1 ) } m/s)` );

	// a 20 % hill: the handbrake holds it; S stops a car rolling down it
	const hill = { ground: ( x, z ) => z * 0.2 };
	b = new CarBody( KINDS.pickup, { yaw: Math.PI } );
	for ( let i = 0; i < 600; i ++ ) b.step( DT, { handbrake: true }, hill );
	ok( Math.abs( b.z ) < 0.01 && Math.abs( b.speed ) < 0.01 && b.pitch < - 0.15, 'parked nose down a 20 % hill with the handbrake: it does not move', `(z ${ b.z.toFixed( 3 ) }, pitch ${ b.pitch.toFixed( 2 ) })` );
	b = new CarBody( KINDS.sedan, { yaw: Math.PI } );
	for ( let i = 0; i < 120; i ++ ) b.step( DT, { throttle: 0.5 }, hill );
	let t = 0;
	while ( b.speed > 0.05 && t < 8 ) { b.step( DT, { brake: 1 }, hill ); t += DT; }
	const z0 = b.z;
	for ( let i = 0; i < 300; i ++ ) b.step( DT, { handbrake: true }, hill );
	ok( t < 4 && Math.abs( b.z - z0 ) < 0.01, 'rolling down the hill, the brake stops it and it stays put', `(${ t.toFixed( 2 ) } s)` );
	b = new CarBody( KINDS.sedan, {} );
	for ( let i = 0; i < 300; i ++ ) b.step( DT, {}, hill );
	ok( Math.abs( b.speed ) < 0.01, 'a car left with no input on a hill stays where it is (parked)' );

}

section( 'the solid world: buildings, breakable props' );
{

	const C = new Colliders();
	C.addBox( new Vector3( 0, 5, 40 ), new Vector3( 20, 5, 5 ), 0, { solid: true, tag: 'meridian' } );
	C.addBox( new Vector3( 0, 0.05, 20 ), new Vector3( 3, 0.05, 3 ), 0, { solid: true, walkable: false } ); // a kerb-high slab: driven over
	C.addBox( new Vector3( 30, 1, 0 ), new Vector3( 4, 1, 4 ), 0.3, { solid: false, walkable: true } ); // a deck
	const world = new CarWorld( C, { terrain: { heightAt: () => 0 } } );
	ok( world.ground( 30, 0, 5 ) === 2 && world.ground( 30, 0, 1 ) === 0, 'a walkable deck under the car is its ground (below the reference height only)' );
	const b = new CarBody( KINDS.sedan, {} );
	let hit = null;
	for ( let i = 0; i < 400; i ++ ) { b.step( DT, { throttle: 1 }, world ); for ( const e of b.impacts ) if ( e.what === 'wall' ) hit = hit || e; }
	ok( hit && b.z < 35 - KINDS.sedan.len / 2 + 0.3 && b.z > 30, 'into a building: stopped at its wall, a wall impact', `(z ${ b.z.toFixed( 2 ) }, ${ hit ? hit.speed.toFixed( 1 ) : 0 } m/s)` );
	// a lamp post of the destruction feature: breaks, the car ploughs on
	const C2 = new Colliders();
	const box = C2.addBox( new Vector3( 0, 2, 25 ), new Vector3( 0.15, 2, 0.15 ), 0, { solid: true, tag: 'destructible' } );
	let broke = null;
	const dest = { props: [ { id: 'lamp-1', colliders: [ box ] } ], damage( id, e ) { if ( e > 700 ) { broke = id; C2.boxes.splice( C2.boxes.indexOf( box ), 1 ); return true; } return false; } };
	const w2 = new CarWorld( C2, { terrain: { heightAt: () => 0 }, destruction: () => dest } );
	const b2 = new CarBody( KINDS.sedan, {} );
	for ( let i = 0; i < 360; i ++ ) b2.step( DT, { throttle: 1 }, w2 );
	ok( broke === 'lamp-1' && b2.z > 40, 'a lamp post in the way breaks (destruction.damage) and the car drives on', `(z ${ b2.z.toFixed( 1 ) })` );
	ok( w2.rebuilds >= 2, 'the collider grid rebuilds when the colliders change' );

}

// ---------------------------------------------------------------- traffic on our own graph

section( 'traffic on a small road graph: lanes, lights, giving way, honks, reroutes, buses' );
{

	const roads = testRoads();
	const g = new RoadGraph( roads );
	const L = g.lane( 'n00~n10', 1, 0 ), Lr = g.lane( 'n00~n10', - 1, 0 );
	ok( L.az > 0 && Lr.az < 0, 'right-hand lanes: eastbound on the +z side (its right: +X is the car left), westbound on the -z side' );
	ok( Math.abs( L.az ) === 1.5, 'a two-lane street keeps its cars 1.5 m off the centre line (clear of the kerb bays)' );
	const route = g.route( 'n00', 'n22' );
	ok( route && route.length === 4, 'the quickest route corner to corner: four edges', `(${ route && route.map( ( p ) => p.edge ).join( ' ' ) })` );
	g.block( [ 'n10~n11', 'n01~n11' ] );
	const r2 = g.route( 'n00', 'n11' );
	ok( r2 && ! r2.some( ( p ) => p.edge === 'n10~n11' || p.edge === 'n01~n11' ), 'blocked edges are routed round' );
	g.unblock( [ 'n10~n11', 'n01~n11' ] );
	const lights = new Set();
	for ( let t = 0; t < g.cycle(); t += 0.5 ) lights.add( g.light( 'n11', 'n10~n11', t ) + '/' + g.light( 'n11', 'n01~n11', t ) );
	ok( ! lights.has( 'green/green' ) && ! lights.has( 'green/amber' ) && ! lights.has( 'amber/green' ) && lights.has( 'red/green' ) && lights.has( 'green/red' ), 'the crossing roads never have green at once', `(${ [ ...lights ].join( ' ' ) })` );

	// a busy grid: 40 cars, a bus, 6 minutes
	let rng = 3;
	const rand = () => ( ( rng = ( rng * 16807 ) % 2147483647 ) / 2147483647 );
	const tr = new Traffic( g, { rng: rand } );
	let id = 0;
	const mk = ( kind = 'sedan' ) => ( { id: 't' + ( id ++ ), kind, spec: KINDS[ kind ], x: 0, y: 0, z: 0, yaw: 0, speed: 0, steer: 0 } );
	for ( let i = 0; i < 40; i ++ ) tr.add( mk( i % 9 === 0 ? 'van' : 'sedan' ) );
	const bus = tr.add( mk( 'bus' ), null, { bus: [ 'n00', 'n20', 'n22', 'n02' ] } );
	// watch every car entering a junction: at the lights only on green / amber; elsewhere never with another crossing
	let redRuns = 0, conflicts = 0, entries = 0, busStops = 0;
	const enter = tr._enterJunction.bind( tr );
	tr._enterJunction = ( car, node ) => {

		entries ++;
		const n = g.nodes.get( node );
		if ( n.phase && g.light( node, car.ai.L.edge, tr.time ) === 'red' && ! car.ai.commit ) redRuns ++;
		if ( ! n.phase && n.out.length >= 3 ) {

			const occ = tr.junction.get( node );
			if ( occ ) for ( const o of occ ) if ( o !== car && o.ai.turn && o.ai.turn.from.edge + o.ai.turn.from.dir !== car.ai.L.edge + car.ai.L.dir ) conflicts ++;

		}

		enter( car, node );

	};
	let wasStop = false;
	for ( let i = 0; i < 60 * 360; i ++ ) {

		tr.update( DT, { viewer: { x: 120, z: 120 } } );
		const st = bus.ai.bus.stopT > 0;
		if ( st && ! wasStop ) busStops ++;
		wasStop = st;

	}

	const moving = tr.cars.filter( ( c ) => c.ai.v > 0.5 ).length;
	const stuck = tr.cars.filter( ( c ) => c.ai.waitT > 60 ).length;
	ok( entries > 400 && redRuns === 0, 'six minutes of traffic: nobody enters a junction on red (but one committed on amber)', `(${ entries } junction entries, ${ tr.stats.redStops } red stops)` );
	ok( conflicts === 0, 'at junctions without lights a car waits while another lane\'s car is crossing' );
	ok( stuck === 0 && moving > 10, 'no gridlock: nobody waits over a minute', `(${ moving } moving)` );
	ok( busStops >= 3, 'the bus works its loop of stops', `(${ busStops } stops made)` );
	let minGap = Infinity;
	for ( const a of tr.cars ) for ( const b of tr.cars ) if ( a !== b && ! a.ai.turn && ! b.ai.turn && a.ai.L === b.ai.L ) minGap = Math.min( minGap, Math.abs( a.ai.s - b.ai.s ) - ( a.spec.len + b.spec.len ) / 2 );
	ok( minGap > 0.5, 'cars in a lane keep a gap (no overlaps)', `(closest ${ minGap.toFixed( 2 ) } m)` );

	// something that does not move stands in a lane: they honk, then turn back
	const target = tr.cars.find( ( c ) => ! c.ai.turn && c.ai.L.len - c.ai.s > 40 && c.ai.v > 3 );
	const obstacle = { id: 'wreck', x: target.x + Math.sin( target.yaw ) * 25, z: target.z + Math.cos( target.yaw ) * 25, len: 4.6, wid: 1.8, speed: 0, kind: 'wreck', static: true };
	const h0 = tr.stats.honks, u0 = tr.stats.uturns;
	for ( let i = 0; i < 60 * 15; i ++ ) tr.update( DT, { viewer: { x: 120, z: 120 }, obstacles: [ obstacle ] } );
	ok( tr.stats.honks > h0 && tr.stats.uturns > u0, 'a wreck in the lane: the car behind honks, then turns back', `(+${ tr.stats.honks - h0 } honks, +${ tr.stats.uturns - u0 } U-turns)` );

	// 21C's roadBlocked: cars on the edge turn back, nobody routes through it any more
	const blocked = [ 'n10~n11', 'n11~n21' ];
	tr.block( blocked );
	let usedBlocked = 0;
	const enter2 = tr._enterJunction;
	tr._enterJunction = ( car, node ) => { if ( car.ai.turn && blocked.includes( car.ai.turn.to.edge ) ) usedBlocked ++; enter2( car, node ); };
	for ( let i = 0; i < 60 * 120; i ++ ) tr.update( DT, { viewer: { x: 120, z: 120 } } );
	ok( usedBlocked === 0 && ! tr.cars.some( ( c ) => c.ai.path.some( ( p ) => blocked.includes( p.edge ) ) ), 'blocked roads: no car turns into them or plans through them', `(${ tr.stats.reroutes } reroutes)` );

}

// ---------------------------------------------------------------- the feature: getting in, taking, the law

section( 'getting in and out, taking cars, the wanted level' );
{

	const W = makeWorld( { px: 60, pz: 1.6 } );
	const { cars, f, events, player } = W;
	for ( let i = 0; i < 60; i ++ ) f.update( DT );
	ok( cars.traffic.cars.length >= 46 * 0.9, 'the traffic fills in round the player', `(${ cars.traffic.cars.length } cars)` );
	const parked = cars.records.filter( ( r ) => r.state === 'parked' );
	ok( parked.length >= 1, 'parked cars stand in the plan\'s bays', `(${ parked.length })` );
	const near = f.nearestInteractable( player.position );
	ok( near && near.id === 'car-door' && /Take the/.test( near.prompt() ), 'E at a parked car\'s door: "Take the …"', `(${ near && near.prompt() })` );
	const heat0 = cars.heat;
	near.onInteract();
	ok( cars.driving && player.mode === 'plane' && player.vehicle === cars.vehicle && cars.drive.state === 'player', 'in: the player drives it (Player vehicle mode)' );
	ok( cars.heat - heat0 <= WANTED.gain.alarm + WANTED.gain.parked, 'a parked car costs little heat (an alarm at most)' );
	W.input.keys.add( 'KeyW' );
	const x0 = cars.drive.x, z0 = cars.drive.z;
	for ( let i = 0; i < 120; i ++ ) { cars.vehicle.drive( DT ); f.update( DT ); }
	W.input.keys.delete( 'KeyW' );
	const moved = Math.hypot( cars.drive.x - x0, cars.drive.z - z0 );
	ok( moved > 5, 'W drives it off', `(${ moved.toFixed( 1 ) } m)` );
	const spd = Math.abs( cars.drive.body.speed );
	ok( spd > 3 && cars.exit() === false, 'no getting out at speed', `(${ spd.toFixed( 1 ) } m/s, ${ cars.stats.crashes } crashes)` );
	W.input.keys.add( 'KeyS' );
	for ( let i = 0; i < 240 && Math.abs( cars.drive.body.speed ) > 0.3; i ++ ) { cars.vehicle.drive( DT ); f.update( DT ); }
	W.input.keys.delete( 'KeyS' );
	const rec = cars.drive;
	ok( cars.exit() === true && player.mode === 'walk' && ! cars.driving && rec.state === 'idle', 'stopped: E gets out beside the car, which stays there' );
	ok( Math.hypot( player.position.x - rec.x, player.position.z - rec.z ) < 3, 'out at the driver\'s door' );

	// a stopped traffic car: the driver is thrown out, the city wants you
	const victim = cars.traffic.cars.find( ( c ) => c.kind === 'sedan' );
	victim.ai.v = 0;
	player.position.set( victim.x, victim.y, victim.z );
	cars._doorT = - 1;
	const d = cars._doorCandidate();
	ok( d && d.rec === victim && /driver gets out/.test( cars._doorPrompt( victim ) ), 'a stopped car in the traffic offers its door: "(the driver gets out)"' );
	const r = cars.enter( victim );
	ok( r.ok && r.how === 'jack' && ! cars.traffic.cars.includes( victim ) && has( events, 'carJacked' ).length === 1, 'taken: out of the traffic, carJacked' );
	ok( cars.level >= 2 && has( events, 'carWanted' ).length >= 1, 'the city\'s wanted level rises', `(heat ${ cars.heat }, level ${ cars.level })` );
	for ( let i = 0; i < 60 * 3; i ++ ) { cars.vehicle.drive( DT ); f.update( DT ); }
	const chasing = cars.records.filter( ( x ) => x.state === 'pursuit' );
	ok( chasing.length >= 1, 'police cars come after you', `(${ chasing.length })` );
	// stopped with a police car alongside: busted
	const cop = chasing[ 0 ];
	cop.body.place( cars.drive.x + 4, cars.drive.y, cars.drive.z, cars.drive.yaw );
	cop.x = cop.body.x; cop.z = cop.body.z;
	const money0 = W.state.money;
	for ( let i = 0; i < 60 * 4 && cars.level > 0; i ++ ) {

		cop.body.place( cars.drive ? cars.drive.x + 4 : cop.x, cop.y, cars.drive ? cars.drive.z : cop.z, cop.yaw );
		if ( cars.drive ) cars.vehicle.drive( DT );
		f.update( DT );

	}

	ok( cars.level === 0 && cars.stats.busted === 1 && W.state.money < money0 && ! cars.driving, 'stopped beside a police car: busted, fined, out of the car', `($${ money0 - W.state.money })` );
	// the heat cools when no police car sees you
	cars._addHeat( 30, 'test' );
	for ( const x of cars.records ) if ( x.state === 'pursuit' ) cars._drop( x );
	for ( const c of [ ...cars.traffic.cars ] ) if ( c.kind === 'police' ) cars.traffic.remove( c );
	cars.T.police = 0;
	const lv = cars.level;
	for ( let i = 0; i < 60 * 40; i ++ ) { for ( const x of cars.records ) if ( x.state === 'pursuit' ) cars._drop( x ); f.update( DT ); }
	ok( lv >= 1 && cars.heat < 30, 'out of sight the heat cools', `(heat ${ cars.heat.toFixed( 1 ) })` );

}

section( 'damage stages, fire and the powder keg' );
{

	const W = makeWorld();
	const { cars, f, events } = W;
	for ( let i = 0; i < 30; i ++ ) f.update( DT );
	ok( stageOf( 1 ) === 0 && stageOf( 0.6 ) === 1 && stageOf( 0.3 ) === 2 && stageOf( 0.1 ) === 3 && stageOf( 0 ) === 4, 'stages by the hit points left: whole, dented, smoking, burning, wreck' );
	ok( impactDamage( 3 ) === 0 && impactDamage( 10 ) > 10 && impactDamage( 20 ) > impactDamage( 10 ) * 2, 'bumps are free, hard hits cost more than their speed' );
	const a = cars._record( 'sedan', { x: 60, z: 30, state: 'idle' } ), b = cars._record( 'van', { x: 64, z: 30, state: 'idle' } ), c = cars._record( 'sedan', { x: 90, z: 30, state: 'idle' } );
	cars.records.push( a, b, c );
	const seen = [];
	for ( const hp of [ 30, 30, 25 ] ) { cars.damage( a, hp ); seen.push( a.stage ); }
	ok( seen.join() === '1,2,3', 'dents, smoke, then fire', `(${ seen })` );
	let t = 0;
	while ( a.stage < 4 && t < 20 ) { f.update( DT ); t += DT; }
	ok( a.stage === 4 && a.state === 'wreck' && t > 2, 'a burning car burns down to a wreck', `(${ t.toFixed( 1 ) } s)` );
	const b0 = b.hp;
	while ( ! a.exploded && t < 30 ) { f.update( DT ); t += DT; }
	const ex = has( events, 'explosion' ).find( ( x ) => x.e.by === 'car' );
	ok( a.exploded && ex && ex.e.radius === DAMAGE.explosion.radius && has( events, 'carExploded' ).length === 1, 'the wreck explodes like a powder keg (an explosion event)' );
	ok( b.hp < b0 && c.hp === c.maxHp, 'the van alongside is hurt, the car 30 m off is not', `(van ${ b.hp.toFixed( 0 ) } / ${ b.maxHp })` );
	for ( let i = 0; i < ( DAMAGE.charred + 5 ) * 10; i ++ ) f.update( 0.1 );
	ok( ! cars.records.includes( a ), 'the charred shell is towed away later' );
	// an outside explosion (a bomb, a powder store) dents cars round it
	const d0 = c.hp;
	f.emit( 'explosion', { x: 92, y: 0, z: 30, radius: 6, energy: 120000 } );
	ok( c.hp < d0, 'a bomb\'s explosion damages the cars round it' );

}

section( 'the townsfolk in the road dive aside; a car into a building' );
{

	const alarms = [];
	const folk = { list: [ { id: 'f1', name: 'Ada', x: 60, z: 40, hidden: false }, { id: 'f2', name: 'Bo', x: 60, z: 80, hidden: false } ], alarm( x, z, s, r ) { alarms.push( { x, z } ); return 1; } };
	const W = makeWorld( { citizens: () => [ folk ], px: 60, pz: 0 } );
	const { cars, f, events, player } = W;
	const car = cars._record( 'sedan', { x: 60, z: 10, yaw: 0, state: 'idle' } );
	cars.records.push( car );
	player.position.set( 60 + 1.5, 0, 10 - 0.15 );
	cars.enter( car );
	W.input.keys.add( 'KeyW' );
	for ( let i = 0; i < 60 * 6; i ++ ) { cars.vehicle.drive( DT ); f.update( DT ); }
	ok( alarms.length >= 1, 'townsfolk ahead of a moving car run for it (townlife alarm)', `(${ alarms.length })` );
	const hits = has( events, 'pedestrianHit' );
	ok( hits.length >= 1 && Math.abs( folk.list[ 0 ].x - 60 ) > 1.5, 'one who stays in the way is knocked aside (no worse), pedestrianHit', `(${ hits.length })` );
	ok( cars.heat >= WANTED.gain.pedestrian, 'and the law minds' );

}

section( "21C's city events: roads blocked by rubble, the buildings' wanted level, falling debris" );
{

	const W = makeWorld();
	const { cars, f } = W;
	for ( let i = 0; i < 30; i ++ ) f.update( DT );
	f.emit( 'roadBlocked', { id: 'mer-1', edges: [ 'n10~n11' ], x: 120, z: 60, radius: 12 } );
	ok( cars.graph.blocked.has( 'n10~n11' ), 'roadBlocked closes the edge to the traffic' );
	f.emit( 'roadCleared', { id: 'mer-1', edges: [ 'n10~n11' ] } );
	ok( ! cars.graph.blocked.has( 'n10~n11' ), 'roadCleared opens it again' );
	f.emit( 'cityWanted', { level: 3, previous: 0, heat: 50 } );
	ok( cars.level === 0 && cars.policeLevel() === 3, "the buildings' wanted level sends the police too (policeLevel: the higher)" );
	for ( let i = 0; i < 60 * 2; i ++ ) f.update( DT );
	ok( cars.records.some( ( r ) => r.state === 'pursuit' ), 'police cars answer it' );
	cars.bust();
	ok( cars.policeLevel() === 0, 'after a bust the police leave you be for a while' );
	const victim = cars._record( 'sedan', { x: 200, z: 200, state: 'idle' } );
	cars.records.push( victim );
	f.emit( 'cityDebris', { id: 'mer-2', x: 201, y: 0, z: 200, radius: 6, energy: 60000 } );
	ok( victim.hp < victim.maxHp, 'falling rubble dents the cars under it' );

}

// ---------------------------------------------------------------- the dealer and the save

section( 'the dealer, your cars, the save round trip' );
{

	const W = makeWorld( { money: 10000 } );
	const { cars, f, player } = W;
	for ( let i = 0; i < 10; i ++ ) f.update( DT );
	const spot = cars.dealerSpot();
	player.position.set( spot.x, 0, spot.z );
	const dn = f.nearestInteractable( player.position );
	ok( dn && dn.id === 'car-dealer', 'E at the showroom: Meridian Motors' );
	const v = cars.dealerView();
	ok( v.sale.length >= 4 && v.sale.every( ( s ) => s.price >= 3000 && s.price <= 20000 ), 'cars for sale at the economy\'s prices', `(${ v.sale.map( ( s ) => s.kind + ' $' + s.price ).join( ', ' ) })` );
	ok( ! cars.buy( 'sports' ).ok && W.state.money === 10000, 'a sports car is beyond $10,000' );
	const r = cars.buy( 'pickup' );
	ok( r.ok && W.state.money === 10000 - KINDS.pickup.price && cars.owned().length === 1, 'a pickup bought: at the kerb outside' );
	const own = cars.owned()[ 0 ];
	ok( Math.hypot( own.x - spot.x, own.z - spot.z ) < 80, 'parked near the showroom' );
	ok( /Drive your pickup/.test( cars._doorPrompt( own ) ), 'its door says "Drive your pickup"' );
	ok( ! cars.ship( own.id, 'tidemark' ).ok, 'no shipping: no roads on the other islands, cars stay in Meridian' );
	cars.damage( own, 40 );
	const fix = cars.repair( own.id );
	ok( fix.ok && own.hp === own.maxHp && fix.price === Math.round( 40 * 18 ), 'repaired at the showroom', `($${ fix.price })` );
	// drive it somewhere, leave it, save
	player.position.set( own.x, 0, own.z );
	cars.enter( own );
	W.input.keys.add( 'KeyW' );
	for ( let i = 0; i < 90; i ++ ) { cars.vehicle.drive( DT ); f.update( DT ); }
	W.input.keys.delete( 'KeyW' );
	W.input.keys.add( 'Space' );
	for ( let i = 0; i < 240; i ++ ) { cars.vehicle.drive( DT ); f.update( DT ); }
	W.input.keys.delete( 'Space' );
	cars.exit();
	cars.damage( own, 20 );
	const save = JSON.parse( JSON.stringify( cars.toJSON() ) );
	const W2 = makeWorld( { money: 0 } );
	W2.cars.fromJSON( save );
	const back = W2.cars.owned();
	ok( back.length === 1 && back[ 0 ].kind === 'pickup' && Math.abs( back[ 0 ].x - own.x ) < 0.02 && Math.abs( back[ 0 ].z - own.z ) < 0.02 && Math.abs( back[ 0 ].yaw - own.yaw ) < 0.02, 'save round trip: your pickup stands where you left it', `(${ own.x.toFixed( 1 ) }, ${ own.z.toFixed( 1 ) })` );
	ok( Math.abs( back[ 0 ].hp - own.hp ) < 0.02 && back[ 0 ].stage === own.stage && back[ 0 ].color === own.color, '…with its dents and its paint' );
	ok( W2.cars.buy( 'sedan' ).ok === false, 'money is checked on the loaded game too' );
	W2.f.data = { cars: save };
	own.x += 300;
	const s1 = cars.sell( own.id );
	own.x -= 300;
	const m0 = W.state.money, s2 = cars.sell( own.id );
	ok( ! s1.ok && s2.ok && W.state.money === m0 + s2.price && s2.price > 1000 && cars.owned().length === 0, 'sold back only at the showroom', `($${ s2.price })` );

}

// ---------------------------------------------------------------- Meridian's plan, budgets, models, remote cars

section( 'the law: heat for crimes the police know of, none for honest driving or your own car' );
{

	// a stranger's parked car with nobody about: the alarm whoops, no heat (and no "the police want a word")
	const W = makeWorld( { px: 60, pz: 1.6 } );
	const { cars, f, player, toasts } = W;
	for ( let i = 0; i < 60; i ++ ) f.update( DT );
	cars.rng = () => 0; // the alarm always goes off
	const police = []; // the patrols we put within reach
	cars._policeNear = ( x, z, r ) => police.find( ( c ) => Math.hypot( c.x - x, c.z - z ) < r ) || null;
	const near = f.nearestInteractable( player.position );
	const n0 = toasts.length;
	near.onInteract();
	ok( cars.driving && cars.heat === 0 && cars.level === 0, 'a stranger\'s parked car taken with no patrol about: no heat', `(heat ${ cars.heat })` );
	ok( toasts.slice( n0 ).some( ( t ) => /alarm/.test( t ) ) && ! toasts.slice( n0 ).some( ( t ) => /police want a word/.test( t ) ), 'the alarm whoops, the police do not want a word' );
	// driven into a wall: the taken car is wrecked, which is a crime (another's car); your own bought car is not
	const taken = cars.drive;
	taken.hp = 1; taken.stage = 4;
	cars._staged( taken, 2, 'crash' );
	ok( cars.heat === WANTED.gain.wreck, 'wrecking the car you took costs heat', `(heat ${ cars.heat })` );
	cars.exit( { force: true } );
	cars.heat = 0; cars.level = 0;
	W.state.money = 20000;
	const own = cars.buy( 'pickup' ).ok ? cars.owned()[ 0 ] : null;
	ok( !! own && own.own, 'a pickup bought' );
	cars.enter( own );
	ok( cars.drive === own && cars.heat === 0, 'driving your own car: no heat' );
	own.hp = 1; own.stage = 4;
	cars._staged( own, 2, 'crash' );
	ok( cars.heat === 0, 'wrecking your own car against a wall: no heat' );
	cars.exit( { force: true } );
	// the same taking within a patrol's earshot: the alarm is heard, and within its sight the taking is seen
	const idle = cars._record( 'sedan', { x: 60, y: 0, z: 30, yaw: 0, state: 'idle', id: null } );
	cars.records.push( idle );
	police.push( { x: idle.x + 120, z: idle.z } );
	cars.enter( idle );
	ok( cars.heat === WANTED.gain.alarm && cars.level === 1, 'a patrol 120 m off hears the alarm: heat, level 1', `(heat ${ cars.heat })` );
	cars.exit( { force: true } );
	cars.heat = 0; cars.level = 0;
	// a shot fired in the city with a patrol in sight; none out of sight
	cars._localNear = true;
	police.push( { x: idle.x + 120, z: idle.z } );
	f.emit( 'gunFired', { by: 'player', x: idle.x, y: 1.5, z: idle.z } );
	ok( cars.heat === WANTED.gain.shot, 'a gun fired with a patrol in sight: heat', `(heat ${ cars.heat })` );
	police.length = 0;
	cars.heat = 0; cars.level = 0;
	f.emit( 'gunFired', { by: 'player', x: idle.x, y: 1.5, z: idle.z } );
	ok( cars.heat === 0, 'a gun fired with no patrol in sight: none' );
	ok( WANTED.earshot > WANTED.witness, 'an alarm carries farther than a patrol sees' );

}

section( 'Meridian: the real plan, the budgets, the models' );
{

	const plan = cityPlan();
	const g = new RoadGraph( plan.roads );
	const ids = [ ...g.nodes.keys() ];
	let unreachable = 0;
	for ( const b of ids.slice( 0, 30 ) ) if ( ! g.route( ids[ 0 ], b ) && b !== ids[ 0 ] ) unreachable ++;
	ok( unreachable === 0, 'the city\'s roads are connected for the traffic', `(${ g.nodes.size } nodes, ${ g.edges.size } edges, ${ [ ...g.nodes.values() ].filter( ( n ) => n.phase ).length } signals)` );
	// lanes against the parking bays (a car in a lane must not overlap a parked one)
	let worst = Infinity;
	for ( const p of plan.parking ) {

		if ( p.kind !== 'street' ) continue;
		const e = g.edges.get( p.edge );
		for ( const dir of [ 1, - 1 ] ) {

			const L = g.lane( e.id, dir, 0 );
			const vx = L.bx - L.ax, vz = L.bz - L.az;
			const t = Math.max( 0, Math.min( 1, ( ( p.x - L.ax ) * vx + ( p.z - L.az ) * vz ) / ( L.len * L.len ) ) );
			worst = Math.min( worst, Math.hypot( p.x - L.ax - vx * t, p.z - L.az - vz * t ) );

		}

	}

	ok( worst > KINDS.sedan.wid + 0.05, 'street lanes run clear of the parking bays', `(closest bay ${ worst.toFixed( 2 ) } m from a lane line)` );

	const run = ( scale ) => {

		const W = makeWorld( { plan, scale, px: plan.roads.nodes[ 20 ].x + 12, pz: plan.roads.nodes[ 20 ].z + 12 } );
		const t0 = performance.now();
		for ( let i = 0; i < 60 * 30; i ++ ) W.f.update( DT );
		return { W, ms: ( performance.now() - t0 ) / ( 60 * 30 ) };

	};
	const desk = run( 1 ), phone = run( 1 / 3 );
	const nd = desk.W.cars.traffic.cars.length, np = phone.W.cars.traffic.cars.length;
	const pd = desk.W.cars.records.filter( ( r ) => r.state === 'parked' ).length, pp = phone.W.cars.records.filter( ( r ) => r.state === 'parked' ).length;
	ok( np <= Math.ceil( nd / 3 ) + 3 && pp < pd * 0.6, 'phones run a third of the traffic and fewer parked cars', `(desktop ${ nd } moving / ${ pd } parked, phone ${ np } / ${ pp })` );
	ok( desk.ms < 2, 'the city\'s traffic costs little CPU', `(${ desk.ms.toFixed( 3 ) } ms a frame desktop, ${ phone.ms.toFixed( 3 ) } phone)` );
	const C = desk.W.cars, view = C.playerPos();
	const far = C.traffic.cars.filter( ( c ) => Math.hypot( c.x - view.x, c.z - view.z ) > TRAFFIC.near ).length;
	ok( far > 0, 'far cars run on the slow tick', `(${ far } beyond ${ TRAFFIC.near } m)` );
	ok( C.dealerSpot() && plan.buildings.some( ( b ) => b.style === 'garage' ), 'the dealer stands at a garage of the plan' );
	ok( Math.hypot( C.dealerSpot().x - MERIDIAN.center.x, C.dealerSpot().z - MERIDIAN.center.z ) < MERIDIAN.radius, 'in Meridian' );

	// the GLBs: wheels as their own nodes, the three body materials and the wheel's
	for ( const k of KIND_IDS ) {

		const buf = readFileSync( new URL( `../public/models/${ KINDS[ k ].glb }`, import.meta.url ) );
		const gl = parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) );
		const names = gl.nodes.map( ( n ) => n.name );
		const mats = gl.materials.map( ( m ) => m.name );
		const tris = gl.meshes.flat().reduce( ( s, p ) => s + ( p.indices ? p.indices.length / 3 : 0 ), 0 );
		ok( [ 'Body', 'Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR' ].every( ( n ) => names.includes( n ) ) && [ 'CarPaint', 'CarTrim', 'CarLamp', 'CarWheel' ].every( ( m ) => mats.includes( m ) ) && tris < 1500 && buf.length < 100000,
			`${ k }.glb: Body + four wheel nodes, the shared materials, low poly`, `(${ tris } tris, ${ ( buf.length / 1024 ).toFixed( 0 ) } KB)` );

	}

	// the other players' cars
	const W = makeWorld();
	const out = {};
	W.player.position.set( 60, 0, - 6 );
	W.cars.enter( W.cars._record( 'taxi', { x: 60, z: - 3.4, state: 'idle' } ) );
	W.cars.decorateState( out );
	ok( out.car && out.car.k === 'taxi' && out.car.p.length === 3, 'decorateState adds the driven car for netsync' );
	W.cars.updateRemote( [ { id: 'peer1', car: out.car } ] );
	ok( W.cars.remote.size === 1 && W.cars.remote.get( 'peer1' ).kind === 'taxi', 'a peer\'s car is drawn from its state' );
	for ( let i = 0; i < 150; i ++ ) W.f.update( DT );
	ok( W.cars.remote.size === 0, 'and dropped when its updates stop' );
	ok( wantedLevel( 0 ) === 0 && wantedLevel( 1 ) === 1 && wantedLevel( 100 ) === 5, 'wanted levels 0..5' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
