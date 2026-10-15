import { WORLD } from '../../world/WorldLayout.js';
import { HOMES, PLACES, yawToward } from '../../world/residents/ResidentData.js';
import { TIDEMARK as TI, tidemarkWorld, tidemarkPaths } from '../../world/terrain/IslandShape.js';
import { BUILDINGS as TM_BUILDINGS, TOWN_PROPS, SPOTS as TM_SPOTS, FACE as TM_FACE, at as tm } from '../../world/islands/town/Layout.js';
import { strongholdLayout, bw, bwYaw } from '../../world/islands/stronghold/Layout.js';
import { FILLERS as TM_FILLERS } from '../../world/islands/town/Buildings.js';
import { STREET as TM_STREET } from '../../world/islands/town/Waterfront.js';
import { BLACKWATER_SHACKS } from '../../world/islands/Blackwater.js';
import { meridianTownPlan, MERIDIAN_POPULATION } from '../../world/islands/meridian/TownLife.js';

// The three towns of townlife (plain data, no engine): the home village, Tidemark and Blackwater's pirate town. Each
// plan says where the town's walkable grid lies, its decks (piers, quays, jetties), its buildings and props (obstacles:
// the grid also takes every solid Collider at runtime), the streets the routes prefer, and the places of a day:
// homes (a door: indoors at night), market stalls (a vendor behind, customers in front), the fish hall's queue, the
// tavern's door and patio, gathering spots (two or three facing each other), seats, work spots (nets on the quay,
// crates carried, a barrow pushed, a hammer at the boatyard), the watch's beat, the lamps the lamplighter visits, the
// children's play area, the animal pens and the local skiffs' runs. Positions are world metres; a spot's yaw is the
// way the person faces (Player.yaw: -Z at 0).
//
//   townPlans() -> [ home, tidemark, blackwater ]   (built once)
//   planById( id )
//   POPULATION[ id ] = { roles: { role: n }, near }  the desktop people per town (phones: half; near: the town's share of
//                       the body budget is the feature's)

const r2 = ( v ) => Math.round( v * 100 ) / 100;
const P = ( x, z, yaw = 0, extra = {} ) => ( { x: r2( x ), z: r2( z ), yaw, ...extra } );
const facing = ( p, q ) => yawToward( p.x, p.z, q.x, q.z );
// a frame (yaw: rotation.y; local +z toward (sin yaw, cos yaw)) to world
const local = ( x, z, yaw, lx, lz ) => [ x + lx * Math.cos( yaw ) + lz * Math.sin( yaw ), z - lx * Math.sin( yaw ) + lz * Math.cos( yaw ) ];
// a person's yaw facing the frame's local +z / -z
const faceZ = ( yaw ) => yaw + Math.PI;
const faceMinusZ = ( yaw ) => yaw;

// slots round a centre (gatherings, the fire pit), each facing it
function ring( c, n, r, a0 = 0 ) {

	const out = [];
	for ( let i = 0; i < n; i ++ ) {

		const a = a0 + i / n * Math.PI * 2;
		const p = { x: c.x + Math.cos( a ) * r, z: c.z + Math.sin( a ) * r };
		out.push( P( p.x, p.z, facing( p, c ) ) );

	}

	return out;

}

// a grid frame round world points: { frame: { x, z, yaw }, u0, u1, v0, v1 } covering them (+ margin) in a frame turned by yaw
function gridAround( pts, yaw, margin = 6 ) {

	const cx = pts.reduce( ( s, p ) => s + p.x, 0 ) / pts.length, cz = pts.reduce( ( s, p ) => s + p.z, 0 ) / pts.length;
	const c = Math.cos( yaw ), s = Math.sin( yaw );
	let u0 = Infinity, u1 = - Infinity, v0 = Infinity, v1 = - Infinity;
	for ( const p of pts ) {

		const dx = p.x - cx, dz = p.z - cz;
		const u = dx * c - dz * s, v = dx * s + dz * c;
		u0 = Math.min( u0, u ); u1 = Math.max( u1, u ); v0 = Math.min( v0, v ); v1 = Math.max( v1, v );

	}

	return { frame: { x: cx, z: cz, yaw }, u0: Math.floor( u0 - margin ), u1: Math.ceil( u1 + margin ), v0: Math.floor( v0 - margin ), v1: Math.ceil( v1 + margin ), cell: 1 };

}

// a rectangle as a deck / obstacle box from two corners along a frame
const boxOf = ( cx, cz, hx, hz, yaw, extra = {} ) => ( { x: r2( cx ), z: r2( cz ), hx, hz, yaw, ...extra } );

export const POPULATION = {
	home: { roles: { vendor: 1, fisher: 2, dockworker: 1, carter: 1, folk: 3, child: 3, watchman: 1 } },
	tidemark: { roles: { vendor: 4, fisher: 5, dockworker: 4, carter: 2, carpenter: 2, folk: 15, child: 4, regular: 6, watchman: 2, lamplighter: 1, sweeper: 2 } },
	blackwater: { roles: { pirate: 10, pirateHand: 3, fence: 1, pirateWatch: 2 } },
	meridian: MERIDIAN_POPULATION,
};

// ------------------------------------------------------------------ the home village

// Village._layout's cottages and huts (centre, yaw, w, d, porch depth): the walls the routes must not cross
const HOME_HOUSES = [
	[ 'A', 13.5, - 106.5, 0.12, 6.2, 5.0, 2.1 ], [ 'B', 26.5, - 112.0, - 0.08, 5.2, 4.5, 0 ], [ 'C', 62.5, - 106.0, - 0.1, 7.0, 5.8, 2.2 ],
	[ 'D', 79.0, - 110.5, - 0.18, 6.0, 5.0, 1.9 ], [ 'E', 96.0, - 115.5, - 0.3, 5.4, 4.6, 0 ], [ 'F', - 3.0, - 125.0, 0.22, 5.6, 5.0, 1.9 ],
	[ 'G', 16.5, - 130.0, 0.1, 6.6, 5.6, 2.2 ], [ 'H', 57.5, - 128.5, - 0.05, 6.0, 5.2, 2.0 ], [ 'I', 75.5, - 132.5, - 0.2, 5.4, 4.6, 0 ],
	[ 'J', 96.5, - 135.0, - 0.32, 6.2, 5.0, 1.9 ], [ 'K', 3.5, - 151.0, 0.18, 6.0, 5.2, 2.0 ], [ 'L', 30.5, - 149.0, 0.04, 7.4, 5.6, 2.3 ],
	[ 'M', 55.0, - 152.5, - 0.06, 5.2, 4.8, 0 ], [ 'N', 78.5, - 156.0, - 0.22, 6.0, 5.0, 1.9 ],
	[ 'S1', 67.8, - 64.6, 0.05, 4.0, 4.2, 1.6 ], [ 'S2', 79.8, - 70.4, - 0.12, 4.4, 4.0, 1.6 ], [ 'S3', 37.2, - 72.4, 0.18, 4.0, 4.0, 1.6 ],
];

function homePlan() {

	const buildings = HOME_HOUSES.map( ( [ id, x, z, yaw, w, d ] ) => boxOf( x, z, w / 2 + 0.2, d / 2 + 0.2, yaw, { id } ) );
	// annexes, porches (their steps are walkable, the posts are not: a box over the porch keeps routes off it)
	const porches = HOME_HOUSES.filter( ( h ) => h[ 6 ] > 0 ).map( ( [ id, x, z, yaw, w, d, pd ] ) => {

		const [ px, pz ] = local( x, z, yaw, 0, d / 2 + pd / 2 );
		return boxOf( px, pz, w / 2 - 0.4, pd / 2 - 0.25, yaw, { id: id + 'porch' } );

	} );
	const sheds = [ [ 21.5, - 119.5 ], [ 68.0, - 124.0 ], [ 89.0, - 146.0 ], [ 43.5, - 155.5 ] ].map( ( [ x, z ], i ) => ( { x, z, r: 2.3, id: 'shed' + ( i + 1 ) } ) );
	const P0 = WORLD.pier;
	const obstacles = [
		...porches, ...sheds,
		{ x: 92.5, z: - 57.5, r: 5.2, id: 'boathouse' }, boxOf( 40.2, - 113.2, 1.7, 1.2, 0.05, { id: 'stall' } ),
		boxOf( 36.2, - 108.2, 0.85, 0.3, 0.9, { id: 'bench1', seat: true } ), boxOf( 45.8, - 108.6, 0.85, 0.3, - 0.85, { id: 'bench2', seat: true } ),
		{ x: 44.3, z: - 106.2, r: 0.15 }, { x: 37.4, z: - 115.6, r: 0.35 }, { x: 38.1, z: - 116.1, r: 0.35 },
		{ x: 20.8, z: - 57.2, r: 2.1 }, { x: 17.9, z: - 59.8, r: 2.1 }, { x: 63.5, z: - 55.6, r: 2.1 }, { x: 84.6, z: - 53.2, r: 2.1 }, { x: 102.5, z: - 49.8, r: 3.6 },
		{ x: 41.8, z: - 64.2, r: 1.9 }, { x: 74.6, z: - 58.6, r: 1.9 }, { x: 86.4, z: - 64.0, r: 1.9 }, boxOf( 73.8, - 69.5, 1.45, 0.75, 0.2 ),
		boxOf( 49.9, - 74.6, 1.45, 0.95, 1.45, { id: 'fishStand' } ), { x: 85.5, z: - 60.5, r: 2.2, id: 'chandlery' },
		// the pier deck (people walk on the boardwalk, not under the pier)
		boxOf( P0.x, ( P0.zStart + P0.zEnd ) / 2, P0.width / 2 + 0.3, ( P0.zEnd - P0.zStart ) / 2, 0, { id: 'pier' } ),
	];
	const homes = Object.values( HOMES ).filter( ( h ) => h.id !== 'C' ).map( ( h ) => P( h.door.x, h.door.z, h.door.yaw, { id: 'home:' + h.id } ) );
	const plaza = { x: 41.5, z: - 110.0 };
	const gathers = [
		{ x: 33.0, z: - 103.0 }, { x: 50.5, z: - 102.0 }, { x: 70.0, z: - 98.0 }, { x: 28.0, z: - 123.5 }, { x: 64.0, z: - 116.0 }, { x: 58.5, z: - 84.5 },
	].map( ( c, i ) => ( { id: 'g' + i, x: c.x, z: c.z, slots: ring( c, 3, 1.15, i ) } ) );
	const seats = []; // the plaza benches: villageSeats() (wave 18C; the feature reads them)

	const stand = { x: 40.2, z: - 113.2, yaw: 0.05 };
	const stall = stallAt( stand.x, stand.z, stand.yaw, 'plaza', [ 'Fresh limes! Coconuts!', 'Bread from the oven, still warm!', 'Mangoes, two for a dollar!' ], 1.8, 1.95 );
	const tavernDoor = HOMES.C.door;
	return {
		id: 'home', port: 'home', name: 'Hyptile Harbour', center: { x: 50, z: - 100 }, radius: 140,
		grid: gridAround( [ { x: - 22, z: - 40 }, { x: 112, z: - 40 }, { x: - 22, z: - 166 }, { x: 112, z: - 166 } ], 0, 0 ),
		decks: [], buildings, obstacles,
		streets: [
			{ w: 1.8, pts: [ [ 53.6, - 63.5 ], [ 54.6, - 72 ], [ 52.4, - 82 ], [ 48.4, - 92 ], [ 44.8, - 100.5 ], [ 42.6, - 107.2 ] ] },
			{ w: 1.1, pts: [ [ 36.8, - 110.6 ], [ 32.0, - 109.3 ], [ 27.4, - 107.6 ] ] }, { w: 1.1, pts: [ [ 46.8, - 97.8 ], [ 53.5, - 98.5 ], [ 61.7, - 99.1 ] ] },
			{ w: 6, pts: [ [ plaza.x - 3, plaza.z ], [ plaza.x + 3, plaza.z ] ] },
		],
		homes, outskirts: [],
		stalls: [ stall ],
		hall: hallAt( 49.9, - 74.6, 1.45 ),
		tavern: { name: 'The Upturned Keel', door: P( tavernDoor.x, tavernDoor.z, tavernDoor.yaw ), patio: PLACES.patio.map( ( p ) => P( p.x, p.z, facing( p, { x: 62, z: - 97 } ) ) ) },
		gathers, seats,
		work: {
			nets: [ P( 40.5, - 62.0, facing( { x: 40.5, z: - 62 }, { x: 41.8, z: - 64.2 } ) ), P( 76.5, - 56.5, facing( { x: 76.5, z: - 56.5 }, { x: 74.6, z: - 58.6 } ) ), P( 88.6, - 61.6, facing( { x: 88.6, z: - 61.6 }, { x: 86.4, z: - 64 } ) ) ],
			carry: [ [ P( 80.0, - 54.5 ), P( 57.5, - 66.0 ) ] ],
			barrow: [ [ P( 52.6, - 84.0 ), P( 45.0, - 101.0 ), P( 30.5, - 104.5 ), P( 45.0, - 101.0 ) ] ],
			hammer: [ P( 66.4, - 54.2, facing( { x: 66.4, z: - 54.2 }, { x: 63.5, z: - 55.6 } ) ) ], sweep: [], fish: [],
		},
		patrol: [ P( 54.0, - 70.0 ), P( 46.0, - 98.0 ), P( 30.0, - 104.0 ), P( 18.0, - 101.0 ), P( 46.0, - 100.0 ), P( 75.0, - 100.0 ), P( 90.0, - 66.0 ), P( 70.0, - 60.0 ) ],
		lamps: [ P( 44.3, - 105.5 ) ],
		play: { x: 30.0, z: - 51.0, r: 6.5 },
		pens: { chickens: [ { x: 22.0, z: - 117.5, r: 3.5 }, { x: 70.5, z: - 119.0, r: 3.5 } ], goats: [ { x: 42.0, z: - 140.0, r: 6 } ], dogs: [ { x: 45.0, z: - 96.0, r: 14 } ], cats: [ { x: 60.5, z: - 101.0, r: 4 }, { x: 22.0, z: - 106.0, r: 4 } ] },
		animals: { dog: 2, cat: 2, chicken: 6, goat: 3 },
		skiffs: [ { dock: P( 74.0, - 41.0, Math.PI ), out: [ P( 74.0, - 30.0 ), P( 120.0, 30.0 ), P( 160.0, 80.0 ) ], leave: 5.5, back: 14.5 } ],
	};

}

// a stall frame: the vendor behind the counter (local -z), customers in front (+z), facing each other
function stallAt( x, z, yaw, id, calls, back = 1.1, front = 1.6 ) {

	const [ vx, vz ] = local( x, z, yaw, 0, - back );
	const fronts = [ - 0.7, 0.7 ].map( ( lx ) => {

		const [ fx, fz ] = local( x, z, yaw, lx, front );
		return P( fx, fz, faceMinusZ( yaw ) );

	} );
	return { id, x: r2( x ), z: r2( z ), vendor: P( vx, vz, faceZ( yaw ) ), front: fronts, calls };

}

// a counter's queue: up to five in a line in front of it, facing it
function hallAt( x, z, yaw ) {

	const queue = [];
	for ( let k = 0; k < 5; k ++ ) {

		const [ qx, qz ] = local( x, z, yaw, 0.15 * ( k % 2 ? 1 : - 1 ), 2.0 + k * 0.9 );
		queue.push( P( qx, qz, faceMinusZ( yaw ) ) );

	}

	return { x: r2( x ), z: r2( z ), yaw, queue };

}

// ------------------------------------------------------------------ Tidemark

const tmP = ( u, v, yaw = 0, extra ) => {

	const q = tm( u, v );
	return P( q.x, q.z, yaw, extra );

};
const tmFace = ( u, v, tu, tv ) => facing( tm( u, v ), tm( tu, tv ) );

function tidemarkPlan() {

	const F = TM_FACE;
	const buildings = [ ...TM_BUILDINGS, ...TM_FILLERS ].map( ( b ) => boxOf( b.x, b.z, b.w / 2 + 0.15, b.d / 2 + 0.15, b.yaw, { id: b.id } ) );
	const obstacles = [];
	// wave 18C's street furniture: the square's fountain, the planters, the iron lamps, the net racks (benches: colliders)
	const S = TM_STREET;
	obstacles.push( { ...tm( S.fountain.u, S.fountain.v ), r: S.fountain.r, id: 'fountain' } );
	for ( const q of S.planters ) obstacles.push( { ...tm( q.u, q.v ), r: 0.45, id: 'planter' } );
	for ( const q of S.lamps ) obstacles.push( { ...tm( q.u, q.v ), r: 0.15, id: 'lamp' } );
	for ( const q of S.netracks ) obstacles.push( { ...tm( q.u, q.v ), r: 1.6, id: 'netrack' } );
	const R = { stall: 1.6, wellRoof: 1.3, lampPost: 0.2, cart: 1.4, crate: 0.6, barrel: 0.45 };
	for ( const p of TOWN_PROPS ) {

		if ( R[ p.kind ] === undefined ) continue;
		const q = tm( p.u, p.v );
		if ( p.kind === 'stall' ) obstacles.push( boxOf( q.x, q.z, 1.35, 0.95, F + p.yawOff, { id: 'stall' } ) );
		else obstacles.push( { x: q.x, z: q.z, r: R[ p.kind ] } );

	}

	// the traders' counters (TidemarkPort), the trade booth, the notice board, the timber quay's cargo
	for ( const s of [ TM_SPOTS.fish, TM_SPOTS.chandler ] ) {

		const [ cx, cz ] = local( s.x, s.z, s.yaw, 0, - 0.6 );
		obstacles.push( boxOf( cx, cz, 1.35, 1.25, s.yaw ) );

	}

	obstacles.push( boxOf( TM_SPOTS.market.x, TM_SPOTS.market.z, 1.6, 1.2, F ), { x: TM_SPOTS.board.x, z: TM_SPOTS.board.z, r: 0.7 } );
	const deckBox = ( u0, u1, v0, v1, y, id ) => {

		const c = tm( ( u0 + u1 ) / 2, ( v0 + v1 ) / 2 );
		return boxOf( c.x, c.z, Math.abs( v1 - v0 ) / 2, Math.abs( u1 - u0 ) / 2, F, { y, id } );

	};
	const decks = [
		deckBox( TI.pier.u1, TI.pier.u0 + 1, TI.pier.v - TI.pier.width / 2, TI.pier.v + TI.pier.width / 2, TI.pier.deck, 'pier' ),
		deckBox( - 166, - 157, - 82, 70, 2.45, 'quay' ),
	];
	// lanes of the town: the back lane between the rows, the passages through the front row
	const lanes = [
		{ w: 2.0, pts: [ [ - 104, - 72 ], [ - 104, 58 ] ] },
		{ w: 1.6, pts: [ [ - 140, - 50 ], [ - 104, - 50 ] ] }, { w: 1.6, pts: [ [ - 140, - 27.5 ], [ - 104, - 27.5 ] ] }, { w: 1.6, pts: [ [ - 140, 51.5 ], [ - 104, 51.5 ] ] },
		{ w: 2.6, pts: [ [ - 222, 8 ], [ - 156, 8 ] ] },
	].map( ( s ) => ( { w: s.w, pts: s.pts.map( ( [ u, v ] ) => { const q = tm( u, v ); return [ q.x, q.z ]; } ) } ) );
	const streets = [ ...tidemarkPaths().map( ( p ) => ( { w: p.w, pts: p.pts } ) ), ...lanes ];
	// homes: the doors of the houses (front row facing the quay street, back row facing the lane), the harbourmaster's
	// hut, and the outskirts up the road (people who live out of town walk off up it)
	const door = ( id ) => {

		const b = TM_BUILDINGS.find( ( q ) => q.id === id );
		const [ x, z ] = local( b.x, b.z, b.yaw, 0, b.d / 2 + 0.8 );
		return P( x, z, b.yaw + Math.PI, { id: 'home:' + id } );

	};
	const homes = [ 'house1', 'house2', 'house3', 'house4', 'house5', 'house6', 'office' ].map( door );
	// the infill houses (18C): doors on their bay side like the rows
	for ( const b of TM_FILLERS ) {

		const [ x, z ] = local( b.x, b.z, b.yaw, 0, b.d / 2 + 0.8 );
		homes.push( P( x, z, b.yaw + Math.PI, { id: 'home:' + b.id } ) );

	}
	const outskirts = [ tmP( - 64, - 22, 0, { id: 'out:road' } ), tmP( - 48, 52, 0, { id: 'out:hill' } ), tmP( - 72, - 8, 0, { id: 'out:field' } ) ];
	const stalls = TOWN_PROPS.filter( ( p ) => p.kind === 'stall' ).map( ( p, i ) => {

		const q = tm( p.u, p.v );
		return stallAt( q.x, q.z, F + p.yawOff, 'stall' + i, [
			[ 'Fresh bread! Rye and barley!', 'Pies, hot pies!', 'Onions, carrots, good roots!' ],
			[ 'Rope by the fathom!', 'Lamp oil, candles, wicks!', 'Buttons, needles, thread!' ],
			[ 'Salt fish! Dried and good for a voyage!', 'Smoked mackerel, three a coin!', 'Oysters from the point!' ],
			[ 'Apples from the downs!', 'Honey! Wax! Mead!', 'Eggs, a dozen fresh!' ],
		][ i % 4 ], 1.15, 1.7 );

	} );
	const tav = TM_BUILDINGS.find( ( b ) => b.id === 'tavern' );
	const [ tdx, tdz ] = local( tav.x, tav.z, tav.yaw, 0, tav.d / 2 + 0.8 );
	const patioC = tm( - 133, 40.5 );
	const patio = [ [ - 131.5, 39.5 ], [ - 133.5, 37.0 ], [ - 131.0, 42.2 ], [ - 134.0, 41.8 ], [ - 133.0, 44.5 ], [ - 135.5, 39.0 ] ].map( ( [ u, v ] ) => tmP( u, v, facing( tm( u, v ), patioC ) ) );
	const gathers = [ [ - 128, 4 ], [ - 129, 11 ], [ - 146, - 38 ], [ - 144, 31 ], [ - 108, 44 ], [ - 109, - 44 ], [ - 147, - 12 ], [ - 108, - 14 ] ]
		.map( ( [ u, v ], i ) => {

			const c = tm( u, v );
			return { id: 'g' + i, x: c.x, z: c.z, slots: ring( c, 3, 1.15, i * 0.7 ) };

		} );
	const pierFace = ( u ) => tmFace( u, 6.8, u, 0 );
	return {
		id: 'tidemark', port: 'tidemark', name: 'Tidemark', center: tm( - 125, 0 ), radius: 160,
		grid: gridAround( [ tm( - 228, - 116 ), tm( - 228, 84 ), tm( - 38, - 116 ), tm( - 38, 84 ) ], F, 0 ),
		decks, buildings, obstacles, streets, homes, outskirts, stalls,
		hall: hallAt( TM_SPOTS.fish.x, TM_SPOTS.fish.z, TM_SPOTS.fish.yaw ),
		tavern: { name: 'The Tide & Tankard', door: P( tdx, tdz, tav.yaw + Math.PI ), patio },
		gathers, seats: [],
		work: {
			nets: [ tmP( - 153, - 18, tmFace( - 153, - 18, - 160, - 18 ) ), tmP( - 153, - 12.5, tmFace( - 153, - 12.5, - 160, - 12.5 ) ), tmP( - 153, 46, tmFace( - 153, 46, - 160, 46 ) ) ],
			fish: [ tmP( - 186, 6.7, pierFace( - 186 ) ), tmP( - 199, 6.7, pierFace( - 199 ) ) ],
			carry: [ [ tmP( - 155, - 60 ), tmP( - 126.4, - 58.5 ) ], [ tmP( - 155, - 44 ), tmP( - 126.4, - 58.5 ) ] ],
			barrow: [ [ tmP( - 140, - 76 ), tmP( - 140, 62 ) ], [ tmP( - 152, 8 ), tmP( - 90, 8 ), tmP( - 104, 8 ), tmP( - 104, - 64 ), tmP( - 104, 8 ) ] ],
			hammer: [ tmP( - 138, - 94.3, tmFace( - 138, - 94.3, - 138, - 100 ) ), tmP( - 129.5, - 104, tmFace( - 129.5, - 104, - 135, - 104 ) ) ],
			sweep: [ [ tmP( - 126, - 1 ), tmP( - 112, 6 ), tmP( - 128, 20 ) ], [ tmP( - 140, 30 ), tmP( - 140, 46 ) ] ],
		},
		patrol: [ tmP( - 152, 8 ), tmP( - 140, 8 ), tmP( - 140, - 76 ), tmP( - 104, - 70 ), tmP( - 104, 56 ), tmP( - 140, 64 ), tmP( - 140, 8 ), tmP( - 200, 8 ) ],
		lamps: [ ...TOWN_PROPS.filter( ( p ) => p.kind === 'lampPost' ), ...S.lamps.filter( ( q ) => q.light ) ].map( ( p ) => {

			const at = tm( p.u + 1.0, p.v );
			return P( at.x, at.z, facing( at, tm( p.u, p.v ) ) );

		} ),
		play: { ...tm( - 109, 38 ), r: 4.5 },
		pens: {
			chickens: [ { ...tm( - 81, - 50 ), r: 3.5 }, { ...tm( - 81, - 30 ), r: 3.5 }, { ...tm( - 82, 44 ), r: 3.2 } ],
			goats: [ { ...tm( - 70, 20 ), r: 8 }, { ...tm( - 66, - 40 ), r: 7 } ],
			dogs: [ { ...tm( - 125, 0 ), r: 18 }, { ...tm( - 140, - 40 ), r: 14 } ], cats: [ { ...tm( - 132, 46 ), r: 3 }, { ...tm( - 106, - 30 ), r: 4 }, { ...tm( - 128, - 66 ), r: 3 } ],
		},
		animals: { dog: 3, cat: 3, chicken: 8, goat: 4 },
		skiffs: [
			{ dock: tmP( - 168, - 56, tmFace( - 168, - 56, - 240, - 56 ) ), out: [ tmP( - 185, - 56 ), tmP( - 260, - 70 ), tmP( - 330, - 40 ) ], leave: 5.2, back: 13.5 },
			{ dock: tmP( - 168, - 40, tmFace( - 168, - 40, - 240, - 40 ) ), out: [ tmP( - 185, - 40 ), tmP( - 250, 40 ), tmP( - 320, 70 ) ], leave: 6.0, back: 15.5 },
		],
	};

}

// ------------------------------------------------------------------ Blackwater

function blackwaterPlan() {

	const L = strongholdLayout();
	const buildings = [ ...L.town, ...BLACKWATER_SHACKS ].map( ( b ) => boxOf( b.x, b.z, b.w / 2 + 0.15, b.d / 2 + 0.15, b.yaw, { id: b.id } ) );
	const obstacles = [];
	const town = Object.fromEntries( [ ...L.town, ...BLACKWATER_SHACKS ].map( ( b ) => [ b.id, b ] ) );
	const front = ( b, lz, lx = 0 ) => {

		const [ x, z ] = local( b.x, b.z, b.yaw, lx, lz );
		return { x, z };

	};
	// the tavern's barrels and bench, the market's awning posts and table, the stores' crates (Blackwater._town)
	const rum = town.rumHole, mk = town.blackMarket, st = town.stores;
	for ( const s of [ - 1, 1 ] ) obstacles.push( { ...front( rum, rum.d / 2 + 0.9, s * ( rum.w / 2 - 0.3 ) ), r: 0.4 } );
	obstacles.push( { ...boxOf( 0, 0, 1.1, 0.25, rum.yaw, { id: 'bench', seat: true } ), ...front( rum, rum.d / 2 + 1.4, 1.6 ) } );
	for ( const s of [ - 1, 1 ] ) obstacles.push( { ...front( mk, mk.d / 2 + 2.2, s * ( mk.w / 2 + 0.1 ) ), r: 0.15 } );
	obstacles.push( { ...boxOf( 0, 0, 1.3, 0.45, mk.yaw ), ...front( mk, mk.d / 2 + 1.3 ) }, { ...front( mk, mk.d / 2 + 0.6, mk.w / 2 + 0.6 ), r: 0.35 } );
	obstacles.push( { ...boxOf( 0, 0, 2.1, 0.4, st.yaw ), ...front( st, st.d / 2 + 0.8, - 0.2 ) } );
	const pit = bw( - 112, 18 );
	obstacles.push( { x: pit.x, z: pit.z, r: 1.1, id: 'firepit' } );
	const decks = L.docks.map( ( d ) => {

		const L2 = Math.hypot( d.end.x - d.start.x, d.end.z - d.start.z );
		return boxOf( ( d.start.x + d.end.x ) / 2, ( d.start.z + d.end.z ) / 2, d.width / 2, L2 / 2, d.heading, { y: 0.9, id: 'dock' + d.id, foot: d.start } );

	} );
	const homes = [ 'hut1', 'hut2', 'hut3', 'hut4', 'stores', 'rumHole', ...BLACKWATER_SHACKS.map( ( b ) => b.id ) ].map( ( id ) => {

		const b = town[ id ];
		const q = front( b, b.d / 2 + 0.8, id === 'stores' ? 2.6 : 0 ); // (the stores' crates are stacked before its middle)
		return P( q.x, q.z, b.yaw + Math.PI, { id: 'home:' + id } );

	} );
	// the street: in front of the buildings, sorted round the cove
	const cove = { x: L.cove.x, z: L.cove.z };
	const fr = L.town.map( ( b ) => front( b, b.d / 2 + 3.5 ) ).sort( ( a, b ) => Math.atan2( a.z - cove.z, a.x - cove.x ) - Math.atan2( b.z - cove.z, b.x - cove.x ) );
	const streets = [ { w: 2.4, pts: fr.map( ( q ) => [ q.x, q.z ] ) }, ...L.docks.map( ( d ) => ( { w: 2.0, pts: [ [ d.start.x, d.start.z ], [ d.end.x, d.end.z ] ] } ) ) ];
	// the fence stands at the end of his table, customers along its front
	const tv = front( mk, mk.d / 2 + 1.3, 1.95 ), tc = front( mk, mk.d / 2 + 1.3 );
	const sell = {
		id: 'blackMarket', x: tc.x, z: tc.z, vendor: P( tv.x, tv.z, facing( tv, front( mk, mk.d / 2 + 3 ) ) ),
		front: [ - 0.6, 0.6 ].map( ( lx ) => { const q = front( mk, mk.d / 2 + 2.45, lx ); return P( q.x, q.z, facing( q, tc ) ); } ),
		calls: [ 'Psst. Silk, no questions.', 'Fine rum, finer for the asking price.', 'Powder and shot, sold by the keg.' ],
	};
	const rumDoor = front( rum, rum.d / 2 + 0.8 );
	const pc = front( rum, rum.d / 2 + 4.5 );
	const patio = ring( pc, 5, 1.6, 0.3 );
	// (the logs round the fire pit are wave 18C's seats: blackwaterSeats)
	const gathers = [];
	for ( const [ u, v ] of [ [ - 104, - 40 ], [ - 100, 40 ], [ - 108, - 10 ] ] ) {

		const c = bw( u, v );
		gathers.push( { id: 'g' + u + v, x: c.x, z: c.z, slots: ring( c, 3, 1.15, u ) } );

	}

	const dockFace = ( d, t, side ) => {

		const x = d.start.x + ( d.end.x - d.start.x ) * t, z = d.start.z + ( d.end.z - d.start.z ) * t;
		const nx = Math.cos( d.heading ) * side, nz = - Math.sin( d.heading ) * side; // the dock's local x
		const p = { x: x + nx * 0.7, z: z + nz * 0.7 };
		return P( p.x, p.z, facing( p, { x: p.x + nx, z: p.z + nz } ) );

	};
	return {
		id: 'blackwater', port: 'blackwater', name: 'Blackwater', center: { x: r2( pc.x ), z: r2( pc.z ) }, radius: 115,
		grid: gridAround( [ bw( - 145, - 110 ), bw( - 145, 110 ), bw( - 40, - 110 ), bw( - 40, 110 ) ], bwYaw( 1, 0 ), 0 ),
		decks, buildings, obstacles, streets, homes, outskirts: [],
		stalls: [ sell ], hall: null,
		tavern: { name: 'the Rum Hole', door: P( rumDoor.x, rumDoor.z, rum.yaw + Math.PI ), patio },
		gathers, seats: [], // the Rum Hole's bench and the fire's logs: blackwaterSeats() (the feature reads them)
		work: {
			nets: [], fish: [ dockFace( L.docks[ 1 ], 0.85, 1 ), dockFace( L.docks[ 2 ], 0.8, - 1 ) ],
			carry: [ [ P( L.docks[ 0 ].start.x, L.docks[ 0 ].start.z ), P( front( st, st.d / 2 + 1.8 ).x, front( st, st.d / 2 + 1.8 ).z ) ], [ P( L.docks[ 1 ].start.x, L.docks[ 1 ].start.z ), P( front( st, st.d / 2 + 1.8 ).x, front( st, st.d / 2 + 1.8 ).z ) ] ],
			barrow: [], hammer: [ dockFace( L.docks[ 0 ], 0.5, 1 ), dockFace( L.docks[ 2 ], 0.4, 1 ) ], sweep: [],
		},
		patrol: fr.map( ( q ) => P( q.x, q.z ) ),
		lamps: [],
		play: null,
		pens: { chickens: [ { ...front( town.hut2, - 4.5 ), r: 3 } ], goats: [ { ...bw( - 92, 90 ), r: 6 } ], dogs: [ { x: pc.x, z: pc.z, r: 16 } ], cats: [ { ...front( rum, rum.d / 2 + 2.5, - 2.5 ), r: 2.5 } ] },
		animals: { dog: 2, cat: 1, chicken: 4, goat: 2 },
		skiffs: [ { dock: dockFace( L.docks[ 1 ], 1.0, 1 ), out: [ P( L.cove.x, L.cove.z ), P( L.entrance.x, L.entrance.z ), P( L.entrance.x + 120, L.entrance.z + 40 ) ], leave: 15.0, back: 22.5 } ],
	};

}

let cache = null;
export function townPlans() {

	if ( ! cache ) cache = [ homePlan(), tidemarkPlan(), blackwaterPlan(), meridianTownPlan() ];
	return cache;

}

export function planById( id ) {

	return townPlans().find( ( p ) => p.id === id ) || null;

}

// wave 18C's seats ({ id, x, y: the seat's height, z, yaw: the way the sitter faces, as a frame's rotation.y }) normalised
// to townlife's { x, z, yaw (Player.yaw: -Z at 0), h (seat height over the ground) }; `ground( x, z )` the terrain
export function externalSeats( list, ground = null ) {

	if ( ! Array.isArray( list ) ) return [];
	const out = [];
	for ( const s of list ) {

		if ( ! s ) continue;
		const x = s.x ?? ( s.position && s.position.x ), z = s.z ?? ( s.position && s.position.z );
		if ( ! Number.isFinite( x ) || ! Number.isFinite( z ) ) continue;
		const yaw = ( Number.isFinite( s.yaw ) ? s.yaw : 0 ) + Math.PI;
		const g = ground ? ground( x, z ) : null;
		const h = Number.isFinite( s.y ) && Number.isFinite( g ) ? Math.max( 0.3, Math.min( 1.0, s.y - g ) ) : 0.45;
		out.push( { id: s.id || null, x, z, yaw, h, ext: true } );

	}

	return out;

}

export { local, ring, facing, gridAround, tidemarkWorld };
