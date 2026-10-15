import { TIDEMARK as I, tidemarkWorld } from '../../terrain/IslandShape.js';

// Tidemark's town plan (plain data, no engine): the buildings on the quay / town terrace, the market square, the
// vendors' and lights' spots and every breakable prop, in island coordinates (terrain/IslandShape.js TIDEMARK: u from
// the bay inland, v across) with world positions added. src/world/islands/Tidemark.js builds from it,
// src/features/destruction/Sites.js plans the props from it, the tests check it.
//
// Two streets: the quay street along the waterfront (u = -140) and the market street from the pier foot inland (v = 8),
// crossing at the market square. The front row faces the bay (yaw FACE: local +z toward the water, the village
// buildings' convention); the back row stands above it on the same terrace (2.4 m).
//
//   BUILDINGS     [ { id, kind, name, u, v, w, d, stories, x, z, yaw } ]   12 town buildings (the hangar and the lookout
//                 tower are the airstrip's and the hill's, listed in EXTRA)
//   SQUARE        the market square { u0, u1, v0, v1 } (kept clear of shells)
//   SPOTS         vendors, the tavern keeper, the notice board, the market booth, the town lights { x, z, yaw }
//   TOWN_PROPS    [ { kind, u, v, yawOff, opts, deck } ] breakable props (destruction kinds); townProps( terrain ) places them

export const FACE = Math.atan2( - I.ax, - I.az ); // toward the bay (east-south-east)
const r2 = ( v ) => Math.round( v * 100 ) / 100;

export function at( u, v ) {

	const [ x, z ] = tidemarkWorld( u, v );
	return { x: r2( x ), z: r2( z ) };

}

const B = ( id, kind, name, u, v, w, d, stories = 1, extra = {} ) => ( { id, kind, name, u, v, w, d, stories, ...extra, ...at( u, v ), yaw: FACE + ( extra.yawOff || 0 ) } );

export const BUILDINGS = [
	// front row on the quay street
	B( 'warehouse', 'warehouse', 'Tidemark warehouse', - 120, - 64, 14, 10, 1 ),
	B( 'chandler', 'chandler', 'Marlow\'s chandlery', - 121, - 40, 9, 7, 2 ),
	B( 'house1', 'house', 'Net-mender\'s house', - 121, - 22, 6, 5, 1 ),
	B( 'tavern', 'tavern', 'The Tide & Tankard', - 120, 38, 11, 8, 2 ),
	B( 'house2', 'house', 'Pilot\'s house', - 121, 58, 6, 5, 1 ),
	B( 'office', 'house', 'Harbourmaster\'s hut', - 150, 26, 4.4, 4, 1 ),
	// back row
	B( 'house3', 'house', 'Fisher Abe\'s house', - 94, - 60, 6, 5, 1 ),
	B( 'house4', 'house', 'Cooper\'s house', - 94, - 40, 6.4, 5.2, 2 ),
	B( 'house5', 'house', 'Fisher Juno\'s house', - 94, - 20, 6, 5, 1 ),
	B( 'chapel', 'chapel', 'Tide Chapel', - 95, 32, 7, 12, 1 ),
	B( 'house6', 'house', 'Widow Pell\'s house', - 94, 54, 6, 5, 1 ),
	// the boatyard shed on its slip south of the town (open to the water: its doors are breakable props)
	B( 'boatyard', 'boatyard', 'Tidemark boatyard', - 140, - 102, 10, 16, 1 ),
];

export const BUILDING_BY_ID = Object.fromEntries( BUILDINGS.map( ( b ) => [ b.id, b ] ) );

// the airstrip's hangar and the hilltop lookout: shells too, outside the town
const A = I.airstrip;
export const EXTRA = [
	{ id: 'hangar', kind: 'hangar', name: 'Tidemark hangar', u: A.hangar[ 0 ], v: A.hangar[ 1 ], w: 18, d: 14, stories: 1, ...at( A.hangar[ 0 ], A.hangar[ 1 ] ), yaw: Math.atan2( I.az, - I.ax ) },
	{ id: 'lookout', kind: 'lookout', name: 'Tidemark lookout', u: 130, v: 110, w: 5, d: 5, stories: 1, ...at( 130, 110 ), yaw: FACE },
];

export const SQUARE = { u0: - 134, u1: - 106, v0: - 9, v1: 25 };

export const SPOTS = {
	fish: { ...at( - 126, - 6 ), yaw: FACE }, // WORLD.ports tidemark stand (the fish buyer)
	chandler: { ...at( - 131, - 40 ), yaw: FACE }, // the chandler's counter in front of the chandlery
	market: { ...at( - 124, 18 ), yaw: FACE }, // the trade booth (WORLD.tidemark.market)
	board: { ...at( - 136, 14 ), yaw: FACE + Math.PI / 2 }, // the notice board at the square's corner, facing the market street
	keeper: { ...at( - 129.5, 35.5 ), yaw: FACE }, // the tavern keeper by the tavern's porch steps
	well: { ...at( - 110, - 2 ), yaw: FACE },
	tavernLamp: { ...at( - 128.8, 32.2 ), yaw: FACE }, // at the porch's corner, on the street
	pierLamp: { ...at( - 219, 6.4 ), yaw: FACE },
};

// breakable props: every prop that is not a building shell (Sites.js registers them through the destruction feature)
const P = ( kind, u, v, yawOff = 0, opts = {}, deck = null ) => ( { kind, u, v, yawOff, opts, deck } );
const RAIL_YAW = Math.atan2( - I.az, I.ax ) - FACE; // a pier railing's local -z points out over the water (-v)
export const TOWN_PROPS = [
	// the market square: stalls, the well's roof, lamp posts, a cart, crates and barrels
	P( 'stall', - 116, - 4 ), P( 'stall', - 116, 20 ), P( 'stall', - 132, 21 ), P( 'stall', - 112, 8.5 + 6, Math.PI / 2 ),
	P( 'wellRoof', - 110, - 2 ),
	P( 'lampPost', - 135, - 9 ), P( 'lampPost', - 135, 25 ), P( 'lampPost', - 107, 25 ), P( 'lampPost', - 107, - 9 ),
	P( 'lampPost', - 137, - 48 ), P( 'lampPost', - 137, 54 ), P( 'lampPost', - 154, 2.5 ),
	P( 'cart', - 131, 30, 0.3 ), P( 'cart', - 132, - 55, - 0.2 ), P( 'cart', - 70, - 12, 1.1 ),
	P( 'crate', - 131, - 66 ), P( 'crate', - 131.5, - 69.2 ), P( 'crate', - 129.8, - 72.4 ), P( 'barrel', - 129.5, - 61.5 ), P( 'barrel', - 128.6, - 59.8 ),
	P( 'barrel', - 128.2, 44.5 ), P( 'barrel', - 128.4, 46.3 ), P( 'crate', - 129, 49 ),
	P( 'crate', - 132, - 30.5 ), P( 'barrel', - 131.5, - 33 ),
	// the timber quay's cargo (on its deck)
	P( 'barrel', - 162.4, - 52 ), P( 'barrel', - 162.6, - 49.8 ), P( 'crate', - 162, - 40, 0.2 ),
	// garden and yard fences behind the back row, round the chapel yard and the boatyard
	P( 'fence', - 84.5, - 60, 0, { spans: 3 } ), P( 'fence', - 84.5, - 40, 0, { spans: 3 } ), P( 'fence', - 84.5, - 20, 0, { spans: 3 } ),
	P( 'fence', - 84.5, 54, 0, { spans: 3 } ), P( 'fence', - 86, 32, 0, { spans: 4 } ),
	P( 'fence', - 126, - 92, Math.PI / 2, { spans: 3 } ), P( 'fence', - 126, - 112, Math.PI / 2, { spans: 3 } ),
	// the stone pier's railings on the edge away from the berth (deck 2.6 m; Sites.js adds the port's own railing at
	// 30% of the pier, u = -180, between the first two)
	P( 'railing', - 168, 5.96, RAIL_YAW, { length: 6 }, I.pier.deck ),
	P( 'railing', - 192, 5.96, RAIL_YAW, { length: 6 }, I.pier.deck ), P( 'railing', - 204, 5.96, RAIL_YAW, { length: 6 }, I.pier.deck ),
	// the boatyard shed's doors (two leaves across its open end, on the slip)
	P( 'shedDoor', - 148.3, - 102 ),
];

// world placements: [ { id, kind, site: 'town', port: 'tidemark', x, y, z, yaw, opts } ] (ids tidemark.town.<kind>.<n>)
export function townProps( terrain ) {

	const counts = {};
	return TOWN_PROPS.map( ( p ) => {

		const { x, z } = at( p.u, p.v );
		const n = counts[ p.kind ] = ( counts[ p.kind ] ?? - 1 ) + 1;
		const y = p.deck !== null ? p.deck : terrain && terrain.heightAt ? terrain.heightAt( x, z ) - 0.02 : 0;
		return { id: `tidemark.town.${ p.kind }.${ n }`, kind: p.kind, site: 'town', port: 'tidemark', x, y, z, yaw: FACE + p.yawOff, opts: p.opts };

	} );

}
