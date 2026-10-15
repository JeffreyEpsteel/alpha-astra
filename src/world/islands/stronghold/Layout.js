import { ISLETS_BY_ID, isletWorld } from '../../terrain/IslandShape.js';

// Where everything on Blackwater stands (terrain/IslandShape.js BLACKWATER; the pads there level the town and the fort).
// Plain data in world metres, made once from the island frame: u runs from the town (west) through the cove to the
// entrance (east-south-east), v across. Heights come from the terrain where they are needed (the pads give the fort 27 m).
// Read by src/world/islands/Blackwater.js (the meshes), stronghold/Kinds.js (the destructible props) and
// src/features/pirates/Stronghold.js (the guns, the bell, the guards, the ships, the black market).
//
//   const L = strongholdLayout();
//   L.fort { x, z, y, r }  L.flag  L.tower { x, z, h }  L.blockhouse  L.gate (the stockade's opening, toward the town path)
//   L.palisade [ { id, x, z, yaw, length } ]   L.batteries [ { id, name, x, z, y, yaw (facing), platform, powder, guns: [ { x, z } ] } ]
//   L.powder [ { id, battery, x, z, yaw } ]   L.town [ { id, kind, name, x, z, yaw, w, d, y } ]   L.docks [ { start, end, heading, width } ]
//   L.moorings [ { x, z, yaw, cls } ]   L.routes { town, fort, front, rim } (guard beats, [ [ x, z ] ])   L.sailOut (the ships' way out)
//   L.cove { x, z, r }  L.entrance { x, z }  L.center { x, z }  L.radius

export const BW = ISLETS_BY_ID.blackwater;
const r1 = ( v ) => Math.round( v * 10 ) / 10;
export const bw = ( u, v ) => {

	const [ x, z ] = isletWorld( BW, u, v );
	return { x: r1( x ), z: r1( z ) };

};

// a world yaw (frameAt convention: facing (sin yaw, cos yaw)) for a direction given in island (u, v)
export const bwYaw = ( du, dv ) => Math.atan2( du * BW.ax - dv * BW.az, du * BW.az + dv * BW.ax );

const FORT = [ 185, - 64 ], FORT_Y = 27, PALISADE_R = 19, SEGMENTS = 20;
// the crescent: the inner shore scaled by s, at angle a (radians) off the -u axis
const crescent = ( a, s ) => [ - 105 * s * Math.cos( a ), 85 * s * Math.sin( a ) ];
const DEG = Math.PI / 180;

let cache = null;

export function strongholdLayout() {

	if ( cache ) return cache;
	const fort = { ...bw( ...FORT ), y: FORT_Y, r: PALISADE_R };
	// the gate faces the rim path that comes over from the town (it ends at u 172, v -72)
	const gateA = Math.atan2( - 72 - FORT[ 1 ], 172 - FORT[ 0 ] );
	const palisade = [];
	for ( let i = 0; i < SEGMENTS; i ++ ) {

		const a = ( i + 0.5 ) / SEGMENTS * Math.PI * 2;
		const da = Math.atan2( Math.sin( a - gateA ), Math.cos( a - gateA ) );
		if ( Math.abs( da ) < 0.2 ) continue; // the gate
		const u = FORT[ 0 ] + Math.cos( a ) * PALISADE_R, v = FORT[ 1 ] + Math.sin( a ) * PALISADE_R;
		// the wall runs along the tangent (prop x), its local +z faces outward
		palisade.push( { id: `blackwater.palisade.${ i }`, ...bw( u, v ), yaw: bwYaw( Math.cos( a ), Math.sin( a ) ), length: 2 * Math.PI * PALISADE_R / SEGMENTS - 0.15 } );

	}

	const gate = bw( FORT[ 0 ] + Math.cos( gateA ) * PALISADE_R, FORT[ 1 ] + Math.sin( gateA ) * PALISADE_R );
	// the two shore batteries, outside the stockade on their own platforms at the cliff edges: the seaward one covers the
	// approach, the channel one the gap and the cove mouth. Three guns each across the platform's front.
	const batteries = [
		{ id: 'seaward', name: 'the seaward battery', at: [ 218, - 46 ], face: [ 1, - 0.3 ], powder: [ 203, - 60 ], y: 26.5 },
		{ id: 'channel', name: 'the channel battery', at: [ 158, - 36 ], face: [ 0.9, 0.42 ], powder: [ 146, - 50 ], y: 27 },
	].map( ( b ) => {

		const l = Math.hypot( b.face[ 0 ], b.face[ 1 ] ), fu = b.face[ 0 ] / l, fv = b.face[ 1 ] / l;
		const guns = [ - 2.6, 0, 2.6 ].map( ( s ) => bw( b.at[ 0 ] + fu * 1.6 - fv * s, b.at[ 1 ] + fv * 1.6 + fu * s ) );
		return {
			id: b.id, name: b.name, ...bw( ...b.at ), y: b.y, yaw: bwYaw( fu, fv ), guns,
			platform: `blackwater.gunPlatform.${ b.id }`, powder: `blackwater.powder.${ b.id }`, powderAt: { ...bw( ...b.powder ), yaw: bwYaw( fu, fv ) },
		};

	} );
	const powder = batteries.map( ( b ) => ( { id: b.powder, battery: b.id, x: b.powderAt.x, z: b.powderAt.z, yaw: b.powderAt.yaw } ) );

	// the town on the black-sand crescent: everything faces the cove (yaw toward its middle)
	const coveC = [ - 10, 0 ];
	const face = ( u, v ) => bwYaw( coveC[ 0 ] - u, coveC[ 1 ] - v );
	const B = ( id, kind, name, u, v, w, d, y ) => ( { id, kind, name, ...bw( u, v ), yaw: face( u, v ), w, d, y } );
	const town = [
		B( 'rumHole', 'tavern', 'the Rum Hole', - 128, 0, 8, 6, 2.4 ),
		B( 'blackMarket', 'market', 'the black market', - 117, 38, 6, 4.5, 2.3 ),
		B( 'stores', 'store', 'the plunder store', - 117, - 38, 6, 4.5, 2.3 ),
		B( 'hut1', 'hut', 'a hut', - 97, 66, 4.2, 3.6, 2.3 ),
		B( 'hut2', 'hut', 'a hut', - 97, - 66, 4.2, 3.6, 2.3 ),
		B( 'hut3', 'hut', 'a hut', - 72, 84, 4, 3.4, 2.2 ),
		B( 'hut4', 'hut', 'a hut', - 72, - 84, 4, 3.4, 2.2 ),
	];

	// three docks out from the crescent: the main one (WORLD.blackwater.dock) and one either side
	const docks = [ 0, - 26 * DEG, 26 * DEG ].map( ( a, i ) => {

		const [ su, sv ] = i === 0 ? [ BW.dock.u0, BW.dock.v ] : crescent( a, 1.07 );
		const [ eu, ev ] = i === 0 ? [ BW.dock.u1, BW.dock.v ] : crescent( a, 0.8 );
		const s = bw( su, sv ), e = bw( eu, ev );
		return { id: i, start: s, end: e, heading: Math.atan2( e.x - s.x, e.z - s.z ), width: 2.2 };

	} );
	// the pirate ships lie in the cove off the dock ends, bows toward the entrance
	const moorings = [ [ - 55, - 36, 'sloop' ], [ - 46, 32, 'brigantine' ], [ - 18, - 6, 'sloop' ] ].map( ( [ u, v, cls ] ) => ( { ...bw( u, v ), yaw: bwYaw( 1, 0 ), cls } ) );
	const P = ( pts ) => pts.map( ( [ u, v ] ) => { const q = bw( u, v ); return [ q.x, q.z ]; } );
	cache = {
		center: { x: BW.x, z: BW.z }, radius: 235,
		cove: { ...bw( - 10, 0 ), r: 85 }, entrance: bw( 255, 0 ),
		fort, gate, palisade, batteries, powder, town, docks, moorings,
		flag: bw( FORT[ 0 ] + 3, FORT[ 1 ] + 2 ),
		tower: { ...bw( 178, - 74 ), h: 11 },
		blockhouse: { ...bw( 194, - 72 ), yaw: bwYaw( - 1, 0.3 ) },
		routes: {
			town: P( [ [ - 97, - 66 ], [ - 113, - 44 ], [ - 121, - 20 ], [ - 121, 20 ], [ - 113, 44 ], [ - 97, 66 ] ] ),
			fort: P( [ [ 176, - 62 ], [ 186, - 52 ], [ 197, - 62 ], [ 188, - 74 ] ] ),
			front: P( [ [ 152, - 42 ], [ 170, - 44 ], [ 192, - 44 ], [ 212, - 52 ] ] ),
			rim: P( [ [ - 70, - 100 ], [ - 30, - 116 ], [ 20, - 122 ], [ 70, - 116 ], [ 120, - 98 ] ] ),
		},
		sailOut: P( [ [ 40, 0 ], [ 130, 0 ], [ 255, 0 ], [ 320, 0 ], [ 380, 40 ] ] ),
	};
	return cache;

}
