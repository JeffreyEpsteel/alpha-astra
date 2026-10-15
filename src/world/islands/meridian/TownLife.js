import { cityPlan, footprint, LAYOUT, toWorld, DOCKS_DECK } from './CityPlan.js';

// Meridian's port quarter for townlife (wave 21A): plain data in the shape of src/features/townlife/Towns.js's plans (the
// root patch adds meridianTownPlan() to townPlans() and a POPULATION entry). The walkable grid covers the harbour quay,
// the docks strip and the first blocks of the city behind it (~250 x 360 m: the town feature's 1 m grid stays the size of
// Tidemark's); the rest of the city is the cars' (21B) and the skyline's. Every position is world metres; a spot's yaw is
// the way the person faces (Player.yaw: -Z at 0); stalls / hall in Towns.js's own shapes.
//
//   meridianTownPlan() -> plan       MERIDIAN_POPULATION   the desktop roles (phones: half, the feature's rule)

const r2 = ( v ) => Math.round( v * 100 ) / 100;
const P = ( x, z, yaw = 0, extra = {} ) => ( { x: r2( x ), z: r2( z ), yaw, ...extra } );
const yawToward = ( x, z, tx, tz ) => Math.atan2( - ( tx - x ), - ( tz - z ) );
const local = ( x, z, yaw, lx, lz ) => [ x + lx * Math.cos( yaw ) + lz * Math.sin( yaw ), z - lx * Math.sin( yaw ) + lz * Math.cos( yaw ) ];
const boxOf = ( cx, cz, hx, hz, yaw, extra = {} ) => ( { x: r2( cx ), z: r2( cz ), hx, hz, yaw, ...extra } );
const ring = ( c, n, r, a0 = 0 ) => Array.from( { length: n }, ( _, i ) => {

	const a = a0 + i / n * Math.PI * 2, x = c.x + Math.cos( a ) * r, z = c.z + Math.sin( a ) * r;
	return P( x, z, yawToward( x, z, c.x, c.z ) );

} );
const W = ( u, v ) => toWorld( u, v );

export const MERIDIAN_POPULATION = { roles: { vendor: 3, fisher: 4, dockworker: 6, carter: 2, folk: 16, child: 3, regular: 4, watchman: 2, sweeper: 2 } };

// the quarter (island-relative): from Meridian Avenue's west side to the basin, Meridian Boulevard to South Boulevard
const AREA = { u0: 286, u1: 620, v0: - 186, v1: 176 }; // (to the pier head)

let cache = null;
export function meridianTownPlan() {

	if ( cache ) return cache;
	const plan = cityPlan();
	const inArea = ( x, z, m = 0 ) => {

		const u = x - plan.center.x, v = z - plan.center.z;
		return u > AREA.u0 - m && u < AREA.u1 + m && v > AREA.v0 - m && v < AREA.v1 + m;

	};
	const corners = [ W( AREA.u0, AREA.v0 ), W( AREA.u1, AREA.v0 ), W( AREA.u0, AREA.v1 ), W( AREA.u1, AREA.v1 ) ];
	const cx = corners.reduce( ( s, p ) => s + p.x, 0 ) / 4, cz = corners.reduce( ( s, p ) => s + p.z, 0 ) / 4;
	const grid = { frame: { x: cx, z: cz, yaw: 0 }, u0: Math.floor( W( AREA.u0, 0 ).x - cx ), u1: Math.ceil( W( AREA.u1, 0 ).x - cx ), v0: Math.floor( W( 0, AREA.v0 ).z - cz ), v1: Math.ceil( W( 0, AREA.v1 ).z - cz ), cell: 1 };
	const B = plan.buildings.filter( ( b ) => inArea( b.x, b.z, 30 ) );
	const buildings = B.map( ( b ) => {

		const f = footprint( b );
		return boxOf( b.x, b.z, ( f.x1 - f.x0 ) / 2 + 0.15, ( f.z1 - f.z0 ) / 2 + 0.15, 0, { id: b.id } );

	} );
	const pier = plan.docks.find( ( d ) => d.kind === 'pier' );
	const pierL = Math.hypot( pier.b.x - pier.a.x, pier.b.z - pier.a.z );
	const decks = [ boxOf( ( pier.a.x + pier.b.x ) / 2, pier.a.z, pier.width / 2, pierL / 2, Math.PI / 2, { y: pier.deck, id: 'pier', foot: pier.a } ) ];
	const S = plan.port;
	const obstacles = [ { x: S.notice.x, z: S.notice.z, r: 1.1, id: 'board' } ];
	for ( const v of S.vendors ) obstacles.push( boxOf( v.x, v.z, 1.35, 0.95, v.yaw, { id: 'stall' } ) );
	obstacles.push( boxOf( S.stand.x, S.stand.z, 1.3, 0.5, S.stand.yaw, { id: 'fishmarket' } ) );
	// the streets the routes prefer: the road edges inside the quarter (their sidewalks: the carriageway is the cars')
	const N = plan.roads.byId;
	const streets = [];
	for ( const e of plan.roads.edges ) {

		const a = N[ e.a ], b = N[ e.b ];
		if ( ! inArea( a.x, a.z, 4 ) && ! inArea( b.x, b.z, 4 ) ) continue;
		const L = Math.hypot( b.x - a.x, b.z - a.z ), tx = ( b.x - a.x ) / L, tz = ( b.z - a.z ) / L, o = e.width / 2 + 2;
		for ( const s of [ 1, - 1 ] ) streets.push( { w: 1.6, pts: [ [ r2( a.x - tz * o * s ), r2( a.z + tx * o * s ) ], [ r2( b.x - tz * o * s ), r2( b.z + tx * o * s ) ] ] } );

	}

	// homes: the doors of the lowrises and midrises (and the flats over the shops) in the quarter
	const homes = [];
	for ( const b of B ) {

		if ( ! [ 'lowrise', 'midrise', 'shop' ].includes( b.kind ) || b.style === 'garage' || b.shop === 'fishmarket' ) continue;
		const f = footprint( b ), fx = Math.round( Math.sin( b.yaw ) ), fz = Math.round( Math.cos( b.yaw ) );
		const half = fx ? ( f.x1 - f.x0 ) / 2 : ( f.z1 - f.z0 ) / 2;
		const x = b.x + fx * ( half + 0.8 ), z = b.z + fz * ( half + 0.8 );
		if ( inArea( x, z ) ) homes.push( P( x, z, b.yaw + Math.PI, { id: 'home:' + b.id } ) );

	}

	const outskirts = [ P( W( AREA.u0 + 2, - 176 ).x, W( 0, - 176 ).z, 0, { id: 'out:boulevard' } ), P( W( AREA.u0 + 2, 216 ).x, W( 0, 168 ).z, 0, { id: 'out:south' } ), P( W( AREA.u0 + 2, 20 ).x, W( 0, 24 ).z, 0, { id: 'out:market' } ) ];
	const stalls = S.vendors.map( ( v, i ) => {

		// the kit's stall_market: the counter at its front (local +z), the vendor behind
		const [ vx, vz ] = local( v.x, v.z, v.yaw, 0, - 1.1 );
		const front = [ - 0.7, 0.7 ].map( ( lx ) => {

			const [ fx, fz ] = local( v.x, v.z, v.yaw, lx, 1.6 );
			return P( fx, fz, v.yaw );

		} );
		return { id: 'mstall' + i, x: r2( v.x ), z: r2( v.z ), vendor: P( vx, vz, v.yaw + Math.PI ), front, calls: [
			[ 'Hot pretzels! Coffee!', 'Fresh oysters, a dollar a dozen!', 'Lemonade, ice cold!' ],
			[ 'Flowers for the lady!', 'Postcards of the Twins!', 'Maps of the islands!' ],
			[ 'Shrimp on ice!', 'Crab, fresh off the boat!', 'Smoked fish, best in the city!' ],
		][ i % 3 ] };

	} );
	const queue = [];
	for ( let k = 0; k < 5; k ++ ) {

		const [ qx, qz ] = local( S.stand.x, S.stand.z, S.stand.yaw, 0.15 * ( k % 2 ? 1 : - 1 ), 2.0 + k * 0.9 );
		queue.push( P( qx, qz, S.stand.yaw ) );

	}

	const hall = { x: r2( S.stand.x ), z: r2( S.stand.z ), yaw: S.stand.yaw, queue };
	// the dockers' bar: the nearest 'Bar' / 'Diner' shop in the quarter, else the Roid & Co. office's neighbour on the quay
	const bar = B.find( ( b ) => b.sign === 'Bar' ) || B.find( ( b ) => b.sign === 'Diner' ) || B.find( ( b ) => b.id === 'roid-office' );
	const bf = footprint( bar ), bx = Math.round( Math.sin( bar.yaw ) ), bz = Math.round( Math.cos( bar.yaw ) );
	const bh = bx ? ( bf.x1 - bf.x0 ) / 2 : ( bf.z1 - bf.z0 ) / 2;
	const door = P( bar.x + bx * ( bh + 0.8 ), bar.z + bz * ( bh + 0.8 ), bar.yaw + Math.PI );
	const patioC = { x: bar.x + bx * ( bh + 3.5 ), z: bar.z + bz * ( bh + 3.5 ) };
	const tavern = { name: bar.sign === 'Bar' ? 'The Harbour Bar' : bar.sign === 'Diner' ? 'The Quay Diner' : 'The Roid & Co. bench', door, patio: ring( patioC, 5, 1.6 ) };
	const gathers = [ [ 524, - 100 ], [ 524, - 70 ], [ 526, 30 ], [ 524, 120 ], [ 470, - 175 ], [ 470, 168 ] ].map( ( [ u, v ], i ) => {

		const c = W( u, v );
		return { id: 'mg' + i, x: c.x, z: c.z, slots: ring( c, 3, 1.15, i * 0.7 ) };

	} );
	const face = ( u, v, tu, tv ) => {

		const a = W( u, v ), b = W( tu, tv );
		return yawToward( a.x, a.z, b.x, b.z );

	};
	const Q = ( u, v, yaw = 0 ) => {

		const c = W( u, v );
		return P( c.x, c.z, yaw );

	};
	const work = {
		nets: [ Q( 534, - 130, face( 534, - 130, 545, - 130 ) ), Q( 534, 100, face( 534, 100, 545, 100 ) ), Q( 534, 136, face( 534, 136, 545, 136 ) ) ],
		fish: [ Q( 580, - 24 + pier.width / 2 - 0.6, face( 580, - 20, 580, 0 ) ), Q( 600, - 24 + pier.width / 2 - 0.6, face( 600, - 20, 600, 0 ) ) ],
		carry: [ [ Q( 530, - 150 ), Q( 470, - 120 ) ], [ Q( 530, 60 ), Q( 470, 50 ) ] ],
		barrow: [ [ Q( 520, - 160 ), Q( 520, 140 ) ] ],
		hammer: [],
		sweep: [ [ Q( 518, - 60 ), Q( 518, - 20 ), Q( 518, 20 ) ] ],
	};
	const patrol = [ Q( 520, - 160 ), Q( 520, 140 ), Q( 420, 140 ), Q( 420, - 160 ), Q( 520, - 160 ) ];
	cache = {
		id: 'meridian', port: 'meridian', name: 'Meridian', center: W( 470, 0 ), radius: 220,
		grid, decks, buildings, obstacles, streets, homes, outskirts, stalls, hall, tavern, gathers, seats: [],
		work, patrol, lamps: [], play: { ...W( 526, 150 ), r: 4 },
		pens: { chickens: [], goats: [], dogs: [ { ...W( 500, 0 ), r: 30 } ], cats: [ { ...W( 470, - 60 ), r: 4 } ] },
		animals: { dog: 2, cat: 2, chicken: 0, goat: 0 },
		skiffs: [],
		ground: DOCKS_DECK, layout: LAYOUT.QX,
	};
	return cache;

}
