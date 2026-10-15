// Meridian, the big city island west of home (wave 21A). THE SHARED PLAN: 21B (cars) and 21C (citywreck) read it, never
// edit it; its shape only grows additively. Pure maths, no engine imports (node tests import it directly).
//
//   MERIDIAN            { id, name, center: { x, z }, size: { x, z }, tile: { x0, z0, size, texel, n }, radius }
//   cityPlan( seed? )   -> the plan (deterministic: a function of the seed alone; cached per seed)
//     buildings  [ { id, kind, x, z, w, d, h, yaw, floors, style, landmark, collapsible, block, y, name?, protected?,
//                  shop?, sign? } ]
//                kind: 'tower' | 'highrise' | 'midrise' | 'lowrise' | 'shop' | 'warehouse' | 'station' | 'landmark'
//                x, z: footprint centre (world m); w: width along the building's local x, d: depth along its local z;
//                yaw: the front (the street side, local +z) faces ( sin yaw, cos yaw ) (the boatDock convention), always
//                a multiple of PI / 2, so the world footprint is axis aligned (footprint( b ) gives it);
//                h: roof height above y (masts and spires not included); y: the ground (pad) height under it;
//                floors: storeys; style: the facade family (STYLES); block: the block id it stands in;
//                landmark: a named sight (map, discovery); collapsible: may reach stage 3; protected: legacy metadata.
//     roads      { nodes: [ { id, x, z, y, signal } ], edges: [ { id, a, b, lanes, width, speed, oneWay, kind, name } ] }
//                lanes: both directions together; width: the carriageway (kerb to kerb, m); speed: the limit (m/s);
//                kind: 'avenue' | 'street' | 'quay' | 'hill' | 'access'; edges are straight between their nodes;
//                y: the road surface at the node (the terrain is graded to the roads: meridian.roadHeight( x, z ) at runtime)
//     parking    [ { x, z, yaw, kind: 'street' | 'lot' | 'garage', lot?, edge?, building? } ]  one car each. yaw: a heading,
//                ( sin yaw, cos yaw ). Convention (kept as shipped; 21B turns street bays round): a 'street' bay's yaw runs
//                AGAINST the traffic of the kerb lane beside it (right-hand traffic: add PI for the lane's direction); lot and
//                garage bays face into the lot / along the deck
//     sidewalks  [ { id, edge, a: { x, z }, b: { x, z }, width } ]   the centre line of each strip (kerb + 0.15 m)
//     plazas     [ { id, kind: 'plaza' | 'park' | 'market' | 'square' | 'apron', name, x, z, w, d } ]
//     blocks     [ { id, x, z, w, d, zone: 'downtown' | 'midtown' | 'outer' | 'docks' | 'hills' | 'airport' | 'park' | 'plaza' } ]
//     docks      [ { id, kind: 'pier' | 'quay' | 'ferry' | 'mole', a: { x, z }, b: { x, z }, width, deck } ] plus the
//                pier's berth { x, z, heading }
//     airstrip   { x, z, y, heading, length, width, pad: { x, z }, hangar: { x, z, yaw } }  (WORLD.tidemark.airstrip's shape)
//     river      { pts: [ [ x, z ] ], width }      lighthouse { x, z }      port: the port entry's spots (stand, board,
//                agent, market, chandlery, notice) in world { x, z, yaw }
//   footprint( b )            -> { x0, x1, z0, z1 } the world box of a building
//   edgeRect( plan, e, pad )  -> { ax, az, bx, bz, half } the carriageway as a capsule-free segment + half width
//   groundAt( x, z )          the designed ground (m above sea): the city plain, the hills, the docks; the terrain tile
//                             adds relief only where nothing is built
//   coastDistance( x, z )     signed (m): > 0 water, < 0 land (the designed coast, before the tile's small warp)
//   coastKind( x, z )         'seawall' | 'beach' | 'rock' (the nearest stretch of coast)
//
// Layout (from home, Meridian lies due west; its harbour faces east toward home): a street grid of 8 columns x 8 rows
// (avenues every other line), downtown round the Meridian Twins' plaza east of centre, the park west of it, city hall and
// the market square between them, the docks and the harbour basin on the east shore (two moles, the lighthouse on the
// north one, the ferry slip on the south wall), the airport on reclaimed land along the north shore, beaches and a
// promenade on the south (open ocean) side, the hills with villas and a river at the west end.

export const MERIDIAN = {
	id: 'meridian',
	name: 'Meridian',
	center: { x: - 2700, z: - 300 },
	size: { x: 1400, z: 1200 },
	radius: 760,
	// the terrain tile (MeridianTerrain): n x n height nodes, texel m apart, from ( x0, z0 )
	tile: { x0: - 3620, z0: - 1220, size: 1840, texel: 4, n: 461 },
};

const CX = MERIDIAN.center.x, CZ = MERIDIAN.center.z;

// ------------------------------------------------------------------ the designed shape (island-relative metres)

// the grid lines (relative x of the columns, relative z of the rows); avenues are 4 lanes, the rest streets
export const COLS = [ - 430, - 310, - 190, - 70, 50, 170, 290, 410 ];
export const ROWS = [ - 380, - 280, - 180, - 80, 20, 120, 220, 320 ];
const AVENUE_COLS = new Set( [ - 310, - 70, 290, 410 ] );
const AVENUE_ROWS = new Set( [ - 180, 220 ] );
const COL_NAMES = { '-430': 'West End Road', '-310': 'Park Avenue', '-190': 'Linden Street', '-70': 'Central Avenue', 50: 'Mercer Street', 170: 'Liberty Street', 290: 'Meridian Avenue', 410: 'Harbour Avenue' };
const ROW_NAMES = { '-380': 'North Street', '-280': 'Station Street', '-180': 'Meridian Boulevard', '-80': 'Church Street', 20: 'Market Street', 120: 'Hall Street', 220: 'South Boulevard', 320: 'Bay Street' };
const PROMENADE = 410; // the beach road's row

export const AVENUE = { lanes: 4, width: 14, speed: 14 };
export const STREET = { lanes: 2, width: 9, speed: 11 };
export const SIDEWALK = 4;

// the Twins' plaza (two blocks by two, the streets inside it closed) and the towers on it
const TWINS = { x0: 50, x1: 290, z0: - 80, z1: 120 };
const TOWER = { size: 46, h: 300, floors: 82, north: [ 125, - 18 ], south: [ 212, 52 ] };
const PARK = { x0: - 310, x1: - 190, z0: - 80, z1: 120 };
const HARBOUR_X = 410; // Harbour Avenue; the docks strip lies east of it

// the coast: a rounded box (the main body), the harbour basin cut into the east shore, the airport's reclaimed land on the
// north shore, two moles round the harbour mouth
const BODY = { cu: - 40, hx: 720, hz: 530, r: 240 }; // centred 40 m west of the island centre: 1.44 x 1.06 km
const BASIN = { x0: 540, x1: 940, z0: - 170, z1: 150 };
const AIRPORT = { x0: - 140, x1: 580, z0: - 665, z1: - 470 };
const MOLES = [ [ [ 676, - 170 ], [ 778, - 124 ], 8 ], [ [ 676, 150 ], [ 768, 108 ], 8 ] ];
// the docks' square corners (seawalls) north and south of the basin
const DOCK_BOXES = [ [ 420, 680, - 530, - 170 ], [ 420, 680, 150, 440 ] ];
export const DOCKS_DECK = 2.8; // the docks, the quays and the airport apron (m above sea)
const PIER = { a: [ 532, - 24 ], b: [ 612, - 24 ], width: 5, deck: 2.6 }; // (its foot 8 m onto the quay: no gap at the wall)
const FERRY = { x: 612, z: 150, width: 12 };

// the hills (gaussian humps, west end) and the river (from the hills' south flank to the south beach)
const HILLS = [ [ - 640, - 190, 120, 150, 48 ], [ - 645, 115, 110, 120, 40 ], [ - 560, - 440, 80, 70, 18 ] ];
const RIVER = { pts: [ [ - 600, 236 ], [ - 586, 300 ], [ - 566, 370 ], [ - 548, 440 ], [ - 536, 520 ], [ - 530, 600 ] ], width: 10 };
// the hill road: a loop off the west end of Meridian Boulevard round the hills and back onto Hall Street
const HILL_ROAD = [ [ - 430, - 180 ], [ - 492, - 214 ], [ - 548, - 262 ], [ - 602, - 296 ], [ - 650, - 262 ], [ - 668, - 190 ], [ - 666, - 110 ], [ - 644, - 36 ], [ - 602, 20 ], [ - 560, 70 ], [ - 500, 108 ], [ - 430, 120 ] ];
// the airport road: Harbour Avenue on north past North Street to the terminal forecourt
const AIR_ROAD = [ [ 410, - 380 ], [ 410, - 452 ], [ 470, - 492 ] ];
const RUNWAY = { x: 190, z: - 600, length: 520, width: 30 };

const smooth = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};
// a cheap deterministic wobble for the natural coast (no RNG state: plain sines)
const wobble = ( x, z ) => Math.sin( x * 0.011 + z * 0.004 ) * 9 + Math.sin( x * 0.027 - z * 0.019 + 1.7 ) * 5 + Math.sin( z * 0.041 + x * 0.013 + 4.1 ) * 2.5;
const boxDist = ( x, z, x0, x1, z0, z1 ) => {

	const dx = Math.max( x0 - x, x - x1 ), dz = Math.max( z0 - z, z - z1 );
	return Math.hypot( Math.max( dx, 0 ), Math.max( dz, 0 ) ) + Math.min( Math.max( dx, dz ), 0 );

};
const roundBox = ( x, z, hx, hz, r ) => {

	const qx = Math.abs( x ) - hx + r, qz = Math.abs( z ) - hz + r;
	return Math.hypot( Math.max( qx, 0 ), Math.max( qz, 0 ) ) + Math.min( Math.max( qx, qz ), 0 ) - r;

};
export const segDist = ( x, z, ax, az, bx, bz ) => {

	const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
	const t = L > 0 ? Math.min( 1, Math.max( 0, ( ( x - ax ) * dx + ( z - az ) * dz ) / L ) ) : 0;
	return Math.hypot( x - ax - dx * t, z - az - dz * t );

};
export const polyDist = ( pts, x, z ) => {

	let best = Infinity;
	for ( let k = 1; k < pts.length; k ++ ) best = Math.min( best, segDist( x, z, pts[ k - 1 ][ 0 ], pts[ k - 1 ][ 1 ], pts[ k ][ 0 ], pts[ k ][ 1 ] ) );
	return best;

};

// engineered (seawall) coast: the docks east of Harbour Avenue, the basin, the moles and the airport
const seawallZone = ( u, v ) => {

	let w = Math.max( smooth( 380, 470, u ) * ( 1 - smooth( 380, 470, Math.abs( v ) ) ), 1 - smooth( 0, 60, boxDist( u, v, AIRPORT.x0, AIRPORT.x1, AIRPORT.z0, AIRPORT.z1 ) ) );
	for ( const B of DOCK_BOXES ) w = Math.max( w, 1 - smooth( 0, 60, boxDist( u, v, B[ 0 ], B[ 1 ], B[ 2 ], B[ 3 ] ) ) );
	return w;

};

// signed coast distance in island-relative metres (> 0 water)
export function coastDistanceRel( u, v ) {

	const wall = seawallZone( u, v );
	let d = roundBox( u - BODY.cu, v, BODY.hx, BODY.hz, BODY.r ) + wobble( u, v ) * ( 1 - wall );
	d = Math.max( d, - boxDist( u, v, BASIN.x0, BASIN.x1, BASIN.z0, BASIN.z1 ) ); // the basin cut out
	d = Math.min( d, boxDist( u, v, AIRPORT.x0, AIRPORT.x1, AIRPORT.z0, AIRPORT.z1 ) ); // the reclaimed land
	for ( const B of DOCK_BOXES ) d = Math.min( d, boxDist( u, v, B[ 0 ], B[ 1 ], B[ 2 ], B[ 3 ] ) );
	for ( const [ a, b, r ] of MOLES ) d = Math.min( d, segDist( u, v, a[ 0 ], a[ 1 ], b[ 0 ], b[ 1 ] ) - r );
	return d;

}

export function coastKindRel( u, v ) {

	if ( seawallZone( u, v ) > 0.5 ) return 'seawall';
	for ( const [ a, b, r ] of MOLES ) if ( segDist( u, v, a[ 0 ], a[ 1 ], b[ 0 ], b[ 1 ] ) < r + 30 ) return 'seawall';
	// beaches along the south shore (the open ocean) and round the south-west; rock under the hills and on the north-west
	if ( v > 260 && u > - 640 && u < 470 ) return 'beach';
	return 'rock';

}

// the designed ground (island-relative): the city plain rising gently west from the docks, the docks / apron level, the
// hills at the west end; 0 at the waterline handled by the terrain's coast profile
export function plainRel( u ) {

	return u >= 430 ? DOCKS_DECK : DOCKS_DECK + ( 430 - u ) * 0.0065;

}

export function hillsRel( u, v ) {

	let h = 0;
	for ( const [ hu, hv, su, sv, H ] of HILLS ) {

		const du = ( u - hu ) / su, dv = ( v - hv ) / sv;
		h += H * Math.exp( - du * du - dv * dv );

	}

	return h * smooth( - 448, - 520, u );

}

// the airport's reclaimed land is level at the docks' height (blending into the plain over 60 m south of it)
export function groundRel( u, v ) {

	const g = plainRel( u ) + hillsRel( u, v );
	const a = 1 - smooth( 0, 60, boxDist( u, v, AIRPORT.x0, AIRPORT.x1, AIRPORT.z0, AIRPORT.z1 ) );
	return g + ( DOCKS_DECK - g ) * a;

}

export const groundAt = ( x, z ) => groundRel( x - CX, z - CZ );
export const coastDistance = ( x, z ) => coastDistanceRel( x - CX, z - CZ );
export const coastKind = ( x, z ) => coastKindRel( x - CX, z - CZ );
export const toWorld = ( u, v ) => ( { x: CX + u, z: CZ + v } );

export function footprint( b ) {

	const q = Math.round( ( ( b.yaw % Math.PI ) + Math.PI ) % Math.PI / ( Math.PI / 2 ) ) % 2; // 1: turned a quarter
	const hx = ( q ? b.d : b.w ) / 2, hz = ( q ? b.w : b.d ) / 2;
	return { x0: b.x - hx, x1: b.x + hx, z0: b.z - hz, z1: b.z + hz };

}

export function edgeRect( plan, e, pad = 0 ) {

	const A = plan.roads.byId[ e.a ], B = plan.roads.byId[ e.b ];
	return { ax: A.x, az: A.z, bx: B.x, bz: B.z, half: e.width / 2 + pad };

}

// ------------------------------------------------------------------ the plan

const cache = new Map();
const r1 = ( v ) => Math.round( v * 10 ) / 10;

export function cityPlan( seed = 2110 ) {

	if ( cache.has( seed ) ) return cache.get( seed );
	const plan = build( seed );
	cache.set( seed, plan );
	return plan;

}

function mulberry( seed ) {

	let a = seed >>> 0;
	return () => {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

// facade families the builder knows (MeridianKit): everything in the plan uses one of these
export const STYLES = [ 'pinstripe', 'glass', 'glassBlue', 'stone', 'concrete', 'brick', 'brickRed', 'stucco', 'shopfront', 'warehouse', 'villa', 'civic', 'station', 'terminal', 'hangar', 'garage', 'lighthouse', 'market' ];

const SIGNS = [ 'Bakery', 'Pharmacy', 'Café', 'Books', 'Diner', 'Hardware', 'Tailor', 'Grocer', 'Bar', 'Barber', 'Florist', 'Radio', 'Shoes', 'Deli', 'Bank', 'Hotel', 'Cinema', 'Pawn', 'Tackle', 'Noodles' ];

function build( seed ) {

	const rnd = mulberry( seed );
	const pick = ( a ) => a[ Math.floor( rnd() * a.length ) ];
	const W = ( u, v ) => [ r1( CX + u ), r1( CZ + v ) ];

	// ---- roads
	const nodes = [], edges = [], byId = {};
	const addNode = ( id, u, v, extra = {} ) => {

		const [ x, z ] = W( u, v );
		const n = { id, x, z, y: Math.round( groundRel( u, v ) * 100 ) / 100, signal: false, ...extra };
		nodes.push( n );
		byId[ id ] = n;
		return n;

	};
	const addEdge = ( a, b, cls, kind, name ) => {

		const id = `${ a }~${ b }`;
		edges.push( { id, a, b, lanes: cls.lanes, width: cls.width, speed: cls.speed, oneWay: false, kind, name } );

	};
	const nid = ( i, j ) => `n${ i }_${ j }`;
	const inTwins = ( u, v ) => u > TWINS.x0 && u < TWINS.x1 && v > TWINS.z0 && v < TWINS.z1;
	COLS.forEach( ( u, i ) => ROWS.forEach( ( v, j ) => {

		if ( inTwins( u, v ) ) return; // the plaza's middle junction is gone
		addNode( nid( i, j ), u, v );

	} ) );
	// the promenade row along the south beaches
	COLS.forEach( ( u, i ) => addNode( nid( i, ROWS.length ), u, PROMENADE ) );
	const has = ( id ) => !! byId[ id ];
	const midInside = ( a, b, R ) => {

		const mu = ( a[ 0 ] + b[ 0 ] ) / 2, mv = ( a[ 1 ] + b[ 1 ] ) / 2;
		return mu > R.x0 && mu < R.x1 && mv > R.z0 && mv < R.z1;

	};
	// along the columns (north - south)
	COLS.forEach( ( u, i ) => {

		for ( let j = 0; j < ROWS.length; j ++ ) {

			const v0 = ROWS[ j ], v1 = j + 1 < ROWS.length ? ROWS[ j + 1 ] : PROMENADE;
			const a = nid( i, j ), b = nid( i, j + 1 );
			if ( ! has( a ) || ! has( b ) || midInside( [ u, v0 ], [ u, v1 ], TWINS ) ) continue;
			const av = AVENUE_COLS.has( u ) && j + 1 < ROWS.length;
			addEdge( a, b, av ? AVENUE : STREET, av ? 'avenue' : 'street', COL_NAMES[ u ] );

		}

	} );
	// along the rows (west - east), and the promenade
	for ( let j = 0; j <= ROWS.length; j ++ ) {

		const v = j < ROWS.length ? ROWS[ j ] : PROMENADE;
		for ( let i = 0; i + 1 < COLS.length; i ++ ) {

			const a = nid( i, j ), b = nid( i + 1, j );
			if ( ! has( a ) || ! has( b ) || midInside( [ COLS[ i ], v ], [ COLS[ i + 1 ], v ], TWINS ) || midInside( [ COLS[ i ], v ], [ COLS[ i + 1 ], v ], PARK ) ) continue;
			const av = AVENUE_ROWS.has( v );
			addEdge( a, b, av ? AVENUE : STREET, av ? 'avenue' : 'street', j < ROWS.length ? ROW_NAMES[ v ] : 'The Promenade' );

		}

	}

	// the docks: Church / Market / Hall Streets run on east to the quay road along the basin's west quay
	const QX = 505;
	// (only the boulevards and Hall Street reach the quay: the port block between them stays whole)
	const quayRows = [ - 180, 120, 220 ];
	quayRows.forEach( ( v, k ) => addNode( `q${ k }`, QX, v ) );
	quayRows.forEach( ( v, k ) => {

		const j = ROWS.indexOf( v );
		addEdge( nid( COLS.length - 1, j ), `q${ k }`, AVENUE_ROWS.has( v ) ? AVENUE : STREET, AVENUE_ROWS.has( v ) ? 'avenue' : 'street', ROW_NAMES[ v ] );
		if ( k > 0 ) addEdge( `q${ k - 1 }`, `q${ k }`, STREET, 'quay', 'Quay Road' );

	} );
	// the north docks road (to the container yard) and the south docks road (the ferry terminal)
	addNode( 'dn0', 600, - 280 ); addEdge( nid( COLS.length - 1, 1 ), 'dn0', STREET, 'street', 'Dock Road' );
	addNode( 'ds0', 600, 220 ); addEdge( `q${ quayRows.length - 1 }`, 'ds0', STREET, 'street', 'Ferry Road' );

	// the hill road (a loop off the boulevard's west end, back onto Hall Street) and the airport road
	const hillIds = HILL_ROAD.map( ( p, k ) => {

		if ( k === 0 ) return nid( 0, ROWS.indexOf( - 180 ) );
		if ( k === HILL_ROAD.length - 1 ) return nid( 0, ROWS.indexOf( 120 ) );
		const id = `h${ k }`;
		addNode( id, p[ 0 ], p[ 1 ] );
		return id;

	} );
	for ( let k = 1; k < hillIds.length; k ++ ) addEdge( hillIds[ k - 1 ], hillIds[ k ], { lanes: 2, width: 7.5, speed: 10 }, 'hill', 'Hill Road' );
	const airIds = AIR_ROAD.map( ( p, k ) => {

		if ( k === 0 ) return nid( COLS.length - 1, 0 );
		const id = `a${ k }`;
		addNode( id, p[ 0 ], p[ 1 ] );
		return id;

	} );
	for ( let k = 1; k < airIds.length; k ++ ) addEdge( airIds[ k - 1 ], airIds[ k ], AVENUE, 'access', 'Airport Road' );

	// the hill road's grade: the terrain under it is cut / filled to a smoothed profile (MeridianTerrain does the same)
	for ( const n of nodes ) if ( n.id[ 0 ] === 'h' ) {

		const u = n.x - CX, v = n.z - CZ;
		n.y = Math.round( hillRoadProfile( u, v ) * 100 ) / 100;

	}

	// signals: where avenues cross (and the boulevards meet Harbour Avenue), and the Twins' plaza corners
	const degree = {}, avDeg = {};
	for ( const e of edges ) for ( const k of [ e.a, e.b ] ) {

		degree[ k ] = ( degree[ k ] || 0 ) + 1;
		if ( e.kind === 'avenue' || e.kind === 'access' ) avDeg[ k ] = ( avDeg[ k ] || 0 ) + 1;

	}

	for ( const n of nodes ) {

		const u = n.x - CX, v = n.z - CZ;
		const corner = ( u === TWINS.x0 || u === TWINS.x1 ) && ( v === TWINS.z0 || v === TWINS.z1 );
		n.signal = degree[ n.id ] >= 3 && ( ( avDeg[ n.id ] || 0 ) >= 3 || corner );

	}

	// ---- sidewalks (both sides of every city edge; none on the hill road or the quay road's water side)
	const sidewalks = [];
	for ( const e of edges ) {

		if ( e.kind === 'hill' ) continue;
		const A = byId[ e.a ], B = byId[ e.b ];
		const L = Math.hypot( B.x - A.x, B.z - A.z ), tx = ( B.x - A.x ) / L, tz = ( B.z - A.z ) / L;
		const o = e.width / 2 + SIDEWALK / 2;
		for ( const s of [ 1, - 1 ] ) {

			if ( e.kind === 'quay' && s * - tz > 0 ) continue; // the quay road's east side is the open apron
			sidewalks.push( { id: `${ e.id }:${ s > 0 ? 'l' : 'r' }`, edge: e.id, a: { x: r1( A.x - tz * o * s ), z: r1( A.z + tx * o * s ) }, b: { x: r1( B.x - tz * o * s ), z: r1( B.z + tx * o * s ) }, width: SIDEWALK } );

		}

	}

	// ---- blocks: the space between grid lines, less the half roads and the sidewalks
	const halfAt = ( list, avSet, k ) => ( avSet.has( list[ k ] ) ? AVENUE.width : STREET.width ) / 2 + SIDEWALK;
	const blocks = [];
	for ( let i = 0; i + 1 < COLS.length; i ++ ) for ( let j = 0; j < ROWS.length; j ++ ) {

		const u0 = COLS[ i ] + halfAt( COLS, AVENUE_COLS, i ), u1 = COLS[ i + 1 ] - halfAt( COLS, AVENUE_COLS, i + 1 );
		const v0 = ROWS[ j ] + halfAt( ROWS, AVENUE_ROWS, j ), v1 = ( j + 1 < ROWS.length ? ROWS[ j + 1 ] - halfAt( ROWS, AVENUE_ROWS, j + 1 ) : PROMENADE - STREET.width / 2 - SIDEWALK );
		const mu = ( u0 + u1 ) / 2, mv = ( v0 + v1 ) / 2;
		let zone;
		if ( mu > TWINS.x0 && mu < TWINS.x1 && mv > TWINS.z0 && mv < TWINS.z1 ) zone = 'plaza';
		else if ( mu > PARK.x0 && mu < PARK.x1 && mv > PARK.z0 && mv < PARK.z1 ) zone = 'park';
		else {

			const dd = Math.hypot( mu - 170, mv - 20 );
			zone = dd < 270 ? 'downtown' : dd < 470 ? 'midtown' : 'outer';

		}

		blocks.push( { id: `b${ i }_${ j }`, u0, u1, v0, v1, zone } );

	}

	// the plaza and the park are single blocks (their inner streets closed): merge their quarters
	const merge = ( zone, R, id ) => {

		const parts = blocks.filter( ( b ) => b.zone === zone );
		for ( const p of parts ) blocks.splice( blocks.indexOf( p ), 1 );
		blocks.push( { id, u0: R.x0 + halfAt( COLS, AVENUE_COLS, COLS.indexOf( R.x0 ) ), u1: R.x1 - halfAt( COLS, AVENUE_COLS, COLS.indexOf( R.x1 ) ),
			v0: R.z0 + halfAt( ROWS, AVENUE_ROWS, ROWS.indexOf( R.z0 ) ), v1: R.z1 - halfAt( ROWS, AVENUE_ROWS, ROWS.indexOf( R.z1 ) ), zone } );

	};
	merge( 'plaza', TWINS, 'twins' );
	merge( 'park', PARK, 'park' );
	// the docks (east of Harbour Avenue, north and south of the basin) and the hills
	const dockU0 = HARBOUR_X + AVENUE.width / 2 + SIDEWALK;
	blocks.push( { id: 'docksN', u0: dockU0, u1: 660, v0: - 500, v1: - 190, zone: 'docks' } );
	blocks.push( { id: 'docksS', u0: dockU0, u1: 650, v0: 232, v1: 470, zone: 'docks' } );
	blocks.push( { id: 'port', u0: dockU0, u1: QX - STREET.width / 2 - SIDEWALK, v0: - 168, v1: 108, zone: 'docks' } );
	blocks.push( { id: 'hills', u0: - 720, u1: - 450, v0: - 330, v1: 140, zone: 'hills' } );
	blocks.push( { id: 'airport', u0: AIRPORT.x0, u1: AIRPORT.x1, v0: AIRPORT.z0, v1: - 470, zone: 'airport' } );

	// ---- buildings
	const buildings = [];
	let seq = 0;
	const add = ( b ) => {

		const [ x, z ] = W( b.u, b.v );
		const yaw = b.yaw || 0;
		const out = {
			id: b.id || `mer-${ String( ++ seq ).padStart( 3, '0' ) }`,
			kind: b.kind, x, z, w: r1( b.w ), d: r1( b.d ), h: r1( b.h ), yaw, floors: b.floors || Math.max( 1, Math.round( b.h / 3.4 ) ),
			style: b.style, landmark: !! b.landmark, collapsible: b.collapsible !== false, block: b.block,
			y: Math.round( ( b.y ?? groundRel( b.u, b.v ) ) * 100 ) / 100,
		};
		if ( b.name ) out.name = b.name;
		if ( b.protected ) out.protected = true;
		if ( b.sign ) out.sign = b.sign;
		if ( b.shop ) out.shop = b.shop;
		buildings.push( out );
		return out;

	};

	// the Meridian Twins: identical square towers, the tallest things in the world (destructible landmarks)
	const tw = blocks.find( ( b ) => b.id === 'twins' );
	add( { id: 'twin-north', kind: 'tower', u: TOWER.north[ 0 ], v: TOWER.north[ 1 ], w: TOWER.size, d: TOWER.size, h: TOWER.h, floors: TOWER.floors, style: 'pinstripe', landmark: true, collapsible: true, protected: false, block: tw.id, name: 'Meridian Twins (North)', yaw: Math.PI } );
	add( { id: 'twin-south', kind: 'tower', u: TOWER.south[ 0 ], v: TOWER.south[ 1 ], w: TOWER.size, d: TOWER.size, h: TOWER.h, floors: TOWER.floors, style: 'pinstripe', landmark: true, collapsible: true, protected: false, block: tw.id, name: 'Meridian Twins (South)' } );

	// the civic buildings
	const blockAt = ( u, v ) => blocks.find( ( b ) => u > b.u0 && u < b.u1 && v > b.v0 && v < b.v1 );
	const hall = blockAt( - 10, 70 ), market = blockAt( - 10, - 30 ), station = blockAt( - 130, - 330 );
	hall.zone = 'civic'; market.zone = 'market'; station.zone = 'civic';
	// city hall in the middle of its block, its front (north) on the square that runs up to Market Street and the market
	add( { id: 'city-hall', kind: 'landmark', u: ( hall.u0 + hall.u1 ) / 2, v: hall.v1 - 26, w: 74, d: 40, h: 24, floors: 4, style: 'civic', landmark: true, block: hall.id, name: 'City Hall', yaw: Math.PI } );
	add( { id: 'station', kind: 'station', u: ( station.u0 + station.u1 ) / 2, v: station.v1 - 24, w: 96, d: 40, h: 22, floors: 2, style: 'station', landmark: true, block: station.id, name: 'Central Station' } );
	add( { id: 'market-hall', kind: 'shop', u: ( market.u0 + market.u1 ) / 2, v: market.v0 + 15, w: 60, d: 22, h: 9, floors: 1, style: 'market', block: market.id, name: 'Market Hall', yaw: 0, shop: 'market' } );

	// the port entry on the basin's west quay: the fish market, the chandlery, the Roid & Co. office, warehouses
	const port = blocks.find( ( b ) => b.id === 'port' );
	add( { id: 'fish-market', kind: 'shop', u: port.u1 - 13, v: - 52, w: 40, d: 24, h: 10, floors: 1, style: 'market', block: 'port', name: 'Fish Market', yaw: Math.PI / 2, shop: 'fishmarket' } );
	add( { id: 'chandlery', kind: 'shop', u: port.u1 - 16, v: 10, w: 26, d: 18, h: 8, floors: 2, style: 'shopfront', block: 'port', name: 'Chandlery', yaw: Math.PI / 2, shop: 'chandlery', sign: 'Chandlery' } );
	add( { id: 'roid-office', kind: 'shop', u: port.u1 - 16, v: 44, w: 22, d: 16, h: 8, floors: 2, style: 'brick', block: 'port', name: 'Roid & Co.', yaw: Math.PI / 2, shop: 'agent', sign: 'Roid & Co.' } );
	add( { kind: 'warehouse', u: port.u0 + 20, v: - 120, w: 36, d: 60, h: 12, floors: 2, style: 'warehouse', block: 'port' } );
	add( { kind: 'warehouse', u: port.u0 + 20, v: - 40, w: 36, d: 60, h: 11, floors: 2, style: 'warehouse', block: 'port' } );
	add( { kind: 'warehouse', u: port.u0 + 20, v: 50, w: 36, d: 70, h: 12, floors: 2, style: 'warehouse', block: 'port' } );
	// the lighthouse on the north mole's head
	const LH = [ 770, - 128 ];
	add( { id: 'lighthouse', kind: 'landmark', u: LH[ 0 ], v: LH[ 1 ], w: 9, d: 9, h: 30, floors: 6, style: 'lighthouse', landmark: true, block: 'docksN', name: 'Meridian Light', y: DOCKS_DECK } );
	// the ferry terminal on the south docks, the airport terminal and hangar
	add( { id: 'ferry-terminal', kind: 'station', u: FERRY.x, v: FERRY.z + 46, w: 50, d: 26, h: 12, floors: 2, style: 'terminal', block: 'docksS', name: 'Ferry Terminal', yaw: Math.PI } );
	add( { id: 'terminal', kind: 'station', u: 500, v: - 536, w: 64, d: 30, h: 14, floors: 2, style: 'terminal', landmark: true, block: 'airport', name: 'Meridian Airport' } );
	add( { id: 'hangar', kind: 'warehouse', u: 420, v: - 560, w: 52, d: 38, h: 15, floors: 1, style: 'hangar', block: 'airport', name: 'Hangar', yaw: Math.PI } );

	// docks warehouses (the container yard between them is parking / open apron)
	for ( const [ bid, rows ] of [ [ 'docksN', [ - 470, - 395, - 320, - 245 ] ], [ 'docksS', [ 262, 330, 400 ] ] ] ) {

		const B = blocks.find( ( b ) => b.id === bid );
		for ( const v of rows ) {

			for ( let u = B.u0 + 30; u + 30 < B.u1 - 10; u += 74 ) {

				if ( bid === 'docksS' && Math.abs( u - FERRY.x ) < 46 && v < 300 ) continue; // the ferry terminal's forecourt
				if ( bid === 'docksN' && v > - 300 && u > 560 ) continue; // the Dock Road's turning space
				if ( bid === 'docksS' && v > 370 && u > 600 ) continue; // the corner the beach takes
				if ( [ [ - 30, - 25 ], [ 30, - 25 ], [ - 30, 25 ], [ 30, 25 ] ].some( ( [ a, c ] ) => coastDistanceRel( u + a, v + c ) > - 6 ) ) { rnd(); rnd(); rnd(); rnd(); continue; }
				if ( polyDist( AIR_ROAD, u, v ) < 48 ) { rnd(); rnd(); rnd(); rnd(); continue; } // (the airport road's diagonal)
				add( { kind: 'warehouse', u, v, w: 54 + rnd() * 8, d: 44 + rnd() * 10, h: 9 + rnd() * 6, floors: 2, style: 'warehouse', block: bid, yaw: rnd() < 0.5 ? 0 : Math.PI } );

			}

		}

	}

	// the city blocks: lots along the block's edges facing the streets
	const garages = [];
	for ( const B of blocks ) {

		if ( ! [ 'downtown', 'midtown', 'outer', 'civic', 'market' ].includes( B.zone ) ) continue;
		const W0 = B.u1 - B.u0, D0 = B.v1 - B.v0;
		if ( B.zone === 'market' ) continue; // the square is open: the market hall and stalls only
		const ncol = B.zone === 'downtown' ? 2 : B.zone === 'midtown' ? 3 : 4;
		const lotW = W0 / ncol;
		// civic: city hall on the north half, offices on the south
		const rowsHere = B.zone === 'civic' && B.id === hall.id ? [] : B.zone === 'civic' ? [ 'N' ] : [ 'N', 'S' ];
		for ( const side of rowsHere ) {

			for ( let c = 0; c < ncol; c ++ ) {

				const gap = 2.5 + rnd() * 2;
				const u = B.u0 + lotW * ( c + 0.5 );
				let w = lotW - gap, d;
				let kind, h, style, sign;
				const onAvenue = AVENUE_COLS.has( nearestCol( u ) ) || ( side === 'N' ? AVENUE_ROWS.has( nearestRow( B.v0 ) ) : AVENUE_ROWS.has( nearestRow( B.v1 ) ) );
				const r = rnd();
				if ( B.zone === 'downtown' ) {

					d = D0 / 2 - 3;
					if ( r < 0.72 ) { kind = 'highrise'; h = 64 + rnd() * 116; style = pick( [ 'glass', 'glassBlue', 'stone', 'concrete', 'glass' ] ); }
					else { kind = 'midrise'; h = 30 + rnd() * 24; style = pick( [ 'stone', 'brick', 'concrete' ] ); }
					// taller toward the Twins (a skyline that climbs to them)
					const dd = Math.hypot( u - 170, ( side === 'N' ? B.v0 : B.v1 ) - 20 );
					if ( kind === 'highrise' ) h *= 1.15 - 0.45 * smooth( 120, 300, dd );

				} else if ( B.zone === 'midtown' || B.zone === 'civic' ) {

					d = Math.min( 34, D0 / 2 - 4 );
					if ( onAvenue && r < 0.5 ) { kind = 'shop'; h = 10 + rnd() * 6; style = 'shopfront'; sign = pick( SIGNS ); }
					else if ( r < 0.82 ) { kind = 'midrise'; h = 18 + rnd() * 30; style = pick( [ 'brick', 'brickRed', 'stone', 'concrete', 'stucco' ] ); }
					else { kind = 'lowrise'; h = 9 + rnd() * 5; style = pick( [ 'brick', 'stucco' ] ); }

				} else {

					d = Math.min( 24, D0 / 2 - 6 );
					w = Math.min( w, 24 );
					if ( onAvenue && r < 0.55 ) { kind = 'shop'; h = 7 + rnd() * 4; style = 'shopfront'; sign = pick( SIGNS ); }
					else { kind = 'lowrise'; h = 7 + rnd() * 7; style = pick( [ 'brick', 'brickRed', 'stucco', 'stucco' ] ); }

				}

				const v = side === 'N' ? B.v0 + d / 2 + 1 : B.v1 - d / 2 - 1;
				const b = add( { kind, u, v, w, d, h, style, block: B.id, yaw: side === 'N' ? Math.PI : 0, sign, shop: kind === 'shop' ? 'shop' : undefined } );
				// one multi-storey car park in two midtown blocks (21B parks cars inside)
				if ( B.zone === 'midtown' && kind === 'midrise' && garages.length < 2 && c === 1 && side === 'S' && rnd() < 0.6 ) {

					b.style = 'garage'; b.h = 14; b.floors = 4;
					garages.push( b );

				}

			}

		}

	}

	// villas on the hills, along the hill road's outer side, on graded pads
	for ( let k = 1; k + 1 < HILL_ROAD.length; k ++ ) {

		const [ au, av ] = HILL_ROAD[ k ], [ bu, bv ] = HILL_ROAD[ k + 1 ];
		const L = Math.hypot( bu - au, bv - av ), tu = ( bu - au ) / L, tv = ( bv - av ) / L;
		for ( const s of [ 1, - 1 ] ) {

			const t = 0.5;
			const off = 30;
			const u = au + ( bu - au ) * t - tv * off * s, v = av + ( bv - av ) * t + tu * off * s;
			if ( coastDistanceRel( u, v ) > - 40 || polyDist( RIVER.pts, u, v ) < 40 || u > - 455 ) continue;
			if ( polyDist( HILL_ROAD, u, v ) < 22 ) continue;
			// the front faces the road: quarter-turned to the nearest axis
			const fu = tv * s, fv = - tu * s;
			const yaw = Math.round( Math.atan2( fu, fv ) / ( Math.PI / 2 ) ) * ( Math.PI / 2 );
			const w = 16 + rnd() * 6, d = 13 + rnd() * 4, h = 7 + rnd() * 3;
			const [ wx, wz ] = W( u, v );
			if ( buildings.some( ( q ) => q.block === 'hills' && Math.abs( q.x - wx ) < ( q.w + w ) / 2 + 6 && Math.abs( q.z - wz ) < ( q.w + w ) / 2 + 6 ) ) continue;
			add( { kind: 'lowrise', u, v, w, d, h, floors: 2, style: 'villa', block: 'hills', yaw, y: villaPad( u, v ) } );

		}

	}

	// ---- parking: street bays along the streets (not the avenues), lots, the garages
	const parking = [];
	for ( const e of edges ) {

		if ( e.kind !== 'street' ) continue;
		const A = byId[ e.a ], B = byId[ e.b ];
		const L = Math.hypot( B.x - A.x, B.z - A.z ), tx = ( B.x - A.x ) / L, tz = ( B.z - A.z ) / L;
		const o = e.width / 2 - 1.1;
		for ( const s of [ 1, - 1 ] ) {

			// right-hand traffic: the bay on each side heads the way its lane runs
			const yaw = Math.atan2( tx * s, tz * s );
			for ( let t = 18; t < L - 18; t += 7 ) {

				if ( rnd() < 0.45 ) continue;
				parking.push( { x: r1( A.x + tx * t + tz * o * s ), z: r1( A.z + tz * t - tx * o * s ), yaw: Math.round( yaw * 1e4 ) / 1e4, kind: 'street', edge: e.id } );

			}

		}

	}

	const lot = ( id, u0, v0, cols, rows, yaw = 0 ) => {

		for ( let i = 0; i < cols; i ++ ) for ( let j = 0; j < rows; j ++ ) {

			const [ x, z ] = W( u0 + i * 2.8, v0 + j * 7 );
			parking.push( { x, z, yaw, kind: 'lot', lot: id } );

		}

	};
	lot( 'airport', 432, - 506, 14, 2, Math.PI );
	lot( 'ferry', 560, 250, 10, 2, 0 );
	lot( 'docks', 560, - 230, 12, 3, Math.PI );
	lot( 'station', - 168, - 300, 12, 2, 0 );
	lot( 'beach', - 300, 432, 20, 2, 0 );
	for ( const g of garages ) for ( let k = 0; k < 8; k ++ ) parking.push( { x: r1( g.x - g.w / 2 + 3 + k * ( g.w - 6 ) / 7 ), z: g.z, yaw: g.yaw, kind: 'garage', building: g.id } );

	// ---- plazas, docks, the airstrip, the port entry's spots
	const P = ( id, kind, name, R ) => {

		const [ x, z ] = W( ( R.u0 + R.u1 ) / 2, ( R.v0 + R.v1 ) / 2 );
		return { id, kind, name, x, z, w: r1( R.u1 - R.u0 ), d: r1( R.v1 - R.v0 ) };

	};
	const plazas = [
		P( 'twins', 'plaza', 'Twins Plaza', tw ),
		P( 'park', 'park', 'Meridian Park', blocks.find( ( b ) => b.id === 'park' ) ),
		P( 'market', 'market', 'Market Square', market ),
		P( 'apron', 'apron', 'Harbour Quay', { u0: QX + STREET.width / 2 + SIDEWALK, u1: BASIN.x0, v0: - 168, v1: 148 } ),
		P( 'hall', 'square', 'City Hall Square', { u0: hall.u0, u1: hall.u1, v0: hall.v0, v1: hall.v1 - 48 } ),
	];
	const pt = ( u, v ) => { const [ x, z ] = W( u, v ); return { x, z }; };
	const docks = [
		{ id: 'pier', kind: 'pier', a: pt( ...PIER.a ), b: pt( ...PIER.b ), width: PIER.width, deck: PIER.deck,
			berth: { ...pt( PIER.b[ 0 ] - 6, PIER.a[ 1 ] + PIER.width / 2 + 2.8 ), heading: Math.PI / 2 } },
		{ id: 'quay-west', kind: 'quay', a: pt( BASIN.x0, BASIN.z0 ), b: pt( BASIN.x0, BASIN.z1 ), width: 4, deck: DOCKS_DECK },
		{ id: 'quay-north', kind: 'quay', a: pt( BASIN.x0, BASIN.z0 ), b: pt( 676, BASIN.z0 ), width: 4, deck: DOCKS_DECK },
		{ id: 'quay-south', kind: 'quay', a: pt( BASIN.x0, BASIN.z1 ), b: pt( 676, BASIN.z1 ), width: 4, deck: DOCKS_DECK },
		{ id: 'ferry', kind: 'ferry', a: pt( FERRY.x, FERRY.z + 10 ), b: pt( FERRY.x, FERRY.z - 22 ), width: FERRY.width, deck: DOCKS_DECK,
			berth: { ...pt( FERRY.x, FERRY.z - 40 ), heading: 0 } },
		...MOLES.map( ( [ a, b, r ], k ) => ( { id: k ? 'mole-south' : 'mole-north', kind: 'mole', a: pt( ...a ), b: pt( ...b ), width: r * 2, deck: DOCKS_DECK } ) ),
	];
	const rw = pt( RUNWAY.x, RUNWAY.z );
	const airstrip = {
		x: rw.x, z: rw.z, y: DOCKS_DECK, heading: - Math.PI / 2, length: RUNWAY.length, width: RUNWAY.width,
		pad: pt( 488, - 590 ), hangar: { ...pt( 420, - 560 ), yaw: Math.PI },
	};
	const spots = {
		stand: { ...pt( 528, - 40 ), yaw: Math.PI / 2 }, // the fish market's stall on the apron (faces the water)
		market: pt( 520, - 52 ),
		chandlery: pt( port.u1 - 16 + 14, 10 ),
		agent: { ...pt( 532, - 14 ), yaw: Math.PI / 2 }, // Roid & Co.'s man at the pier foot
		notice: { ...pt( 518, 30 ), yaw: Math.PI / 2 },
		vendors: [ { ...pt( 526, 66 ), yaw: Math.PI / 2 }, { ...pt( 526, 84 ), yaw: Math.PI / 2 }, { ...pt( 526, 102 ), yaw: Math.PI / 2 } ],
	};

	const plan = {
		id: MERIDIAN.id, seed, center: { ...MERIDIAN.center },
		buildings, roads: { nodes, edges, byId }, parking, sidewalks, plazas,
		blocks: blocks.map( ( b ) => {

			const [ x, z ] = W( ( b.u0 + b.u1 ) / 2, ( b.v0 + b.v1 ) / 2 );
			return { id: b.id, x, z, w: r1( b.u1 - b.u0 ), d: r1( b.v1 - b.v0 ), zone: b.zone };

		} ),
		docks, airstrip, port: spots,
		river: { pts: RIVER.pts.map( ( [ u, v ] ) => W( u, v ) ), width: RIVER.width },
		lighthouse: pt( ...LH ),
		hillRoad: HILL_ROAD.map( ( [ u, v ] ) => W( u, v ) ),
	};
	// roads.byId is a lookup, not data: keep it out of JSON dumps
	Object.defineProperty( plan.roads, 'byId', { value: byId, enumerable: false } );
	return plan;

	function nearestCol( u ) { return COLS.reduce( ( a, c ) => ( Math.abs( c - u ) < Math.abs( a - u ) ? c : a ), COLS[ 0 ] ); }
	function nearestRow( v ) { return ROWS.reduce( ( a, c ) => ( Math.abs( c - v ) < Math.abs( a - v ) ? c : a ), ROWS[ 0 ] ); }

}

// the hill road's surface (island-relative): the designed ground along the road, its grade limited to MAX_GRADE by cut
// and fill (a forward and a backward pass over 2 m stations); the terrain tile grades a band round the road to it
const MAX_GRADE = 0.11;
let hillProfile = null;
function hillStations() {

	if ( hillProfile ) return hillProfile;
	const st = [];
	let s = 0;
	for ( let k = 1; k < HILL_ROAD.length; k ++ ) {

		const [ au, av ] = HILL_ROAD[ k - 1 ], [ bu, bv ] = HILL_ROAD[ k ];
		const L = Math.hypot( bu - au, bv - av ), n = Math.max( 1, Math.ceil( L / 2 ) );
		for ( let i = k === 1 ? 0 : 1; i <= n; i ++ ) {

			const t = i / n;
			st.push( { s: s + L * t, h: groundRel( au + ( bu - au ) * t, av + ( bv - av ) * t ) } );

		}

		s += L;

	}

	// both ends sit on the city grid's junctions: pinned
	st[ 0 ].h = groundRel( ...HILL_ROAD[ 0 ] );
	st[ st.length - 1 ].h = groundRel( ...HILL_ROAD[ HILL_ROAD.length - 1 ] );
	const p = st.map( ( q ) => q.h );
	const lim = () => {

		// (the ends stay pinned: the junctions with the grid)
		for ( let i = 1; i < p.length - 1; i ++ ) { const ds = st[ i ].s - st[ i - 1 ].s; p[ i ] = Math.min( Math.max( p[ i ], p[ i - 1 ] - MAX_GRADE * ds ), p[ i - 1 ] + MAX_GRADE * ds ); }
		for ( let i = p.length - 2; i > 0; i -- ) { const ds = st[ i + 1 ].s - st[ i ].s; p[ i ] = Math.min( Math.max( p[ i ], p[ i + 1 ] - MAX_GRADE * ds ), p[ i + 1 ] + MAX_GRADE * ds ); }

	};
	for ( let pass = 0; pass < 4; pass ++ ) lim();
	// a light smoothing (no kinks at the stations), then the limit again
	for ( let it = 0; it < 4; it ++ ) for ( let i = 1; i + 1 < p.length; i ++ ) p[ i ] = ( p[ i - 1 ] + 2 * p[ i ] + p[ i + 1 ] ) / 4;
	lim();
	hillProfile = { s: st.map( ( q ) => q.s ), h: p, length: s };
	return hillProfile;

}

// the road surface at the station nearest ( u, v ) (and the distance from the centre line)
export function hillRoadAt( u, v ) {

	const P = hillStations();
	let best = Infinity, bs = 0, acc = 0;
	for ( let k = 1; k < HILL_ROAD.length; k ++ ) {

		const [ au, av ] = HILL_ROAD[ k - 1 ], [ bu, bv ] = HILL_ROAD[ k ];
		const du = bu - au, dv = bv - av, L2 = du * du + dv * dv, L = Math.sqrt( L2 );
		const t = Math.min( 1, Math.max( 0, ( ( u - au ) * du + ( v - av ) * dv ) / L2 ) );
		const d = Math.hypot( u - au - du * t, v - av - dv * t );
		if ( d < best ) { best = d; bs = acc + L * t; }
		acc += L;

	}

	const i = Math.min( P.s.length - 2, Math.max( 0, Math.floor( bs / P.length * ( P.s.length - 1 ) ) ) );
	let j = i;
	while ( j > 0 && P.s[ j ] > bs ) j --;
	while ( j + 2 < P.s.length && P.s[ j + 1 ] < bs ) j ++;
	const f = Math.min( 1, Math.max( 0, ( bs - P.s[ j ] ) / ( P.s[ j + 1 ] - P.s[ j ] ) ) );
	return { h: P.h[ j ] + ( P.h[ j + 1 ] - P.h[ j ] ) * f, d: best, s: bs };

}

export function hillRoadProfile( u, v ) {

	return hillRoadAt( u, v ).h;

}

// a villa's level pad: the ground at its centre (MeridianTerrain flattens the footprint to it)
function villaPad( u, v ) {

	return Math.round( groundRel( u, v ) * 10 ) / 10;

}

export const HILL_ROAD_REL = HILL_ROAD;
export const RIVER_REL = RIVER;
export const LAYOUT = { DOCK_BOXES, TWINS, TOWER, PARK, BODY, BASIN, AIRPORT, MOLES, PIER, FERRY, HILLS, RUNWAY, PROMENADE, HARBOUR_X, QX: 505 };

// ------------------------------------------------------------------ traffic signals (additive, wave 21A)
// One fixed cycle for every signalled junction, offset per junction (a green wave of sorts): the signal heads Meridian.js
// draws light from this same function on the GPU (frame.time), so cars that ask it see what the player sees.
//   signalState( node, axis, t ) -> 'green' | 'yellow' | 'red'   node: a roads node (or its id); axis: 'ns' (traffic along
//   z) | 'ew' (along x); t: seconds (meridian.signalState passes the frame's simulation time)
export const SIGNAL_CYCLE = { period: 40, green: 16, yellow: 3 }; // ns green 0-16, yellow 16-19, all red 19-20; ew from 20
export function signalOffset( node ) {

	const id = typeof node === 'string' ? node : node && node.id || '';
	let h = 0;
	for ( let i = 0; i < id.length; i ++ ) h = ( h * 31 + id.charCodeAt( i ) ) % 9973;
	return ( h * 7.3 ) % SIGNAL_CYCLE.period;

}

export function signalState( node, axis, t ) {

	const P = SIGNAL_CYCLE.period, half = P / 2;
	let q = ( ( t + signalOffset( node ) ) % P + P ) % P;
	if ( axis === 'ew' ) q = ( q + half ) % P;
	return q < SIGNAL_CYCLE.green ? 'green' : q < SIGNAL_CYCLE.green + SIGNAL_CYCLE.yellow ? 'yellow' : 'red';

}
