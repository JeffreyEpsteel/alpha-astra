import { WORLD } from '../../world/WorldLayout.js';
import { berthOf } from '../../game/Boats.js';

// Where Roid & Co.'s harbour agents stand and where they deliver, from the WORLD.ports docks alone (pure: no scene, no
// terrain needed; read dynamically so new ports get an agent too). Dock frame as the jetties are built
// (world/islands/Jetty.js): lz runs from dock.start (the sand) out to dock.end (the head), lx across, to the right of the
// direction of travel; world( lx, lz ) = start + lx * ( cos h, -sin h ) + lz * ( sin h, cos h ).
//
//   agentPorts()                 the WORLD.ports entries that get an agent (every port but 'home': Captain Roid is there)
//   agentSpot( port )            { x, y, z, yaw, lectern: { x, y, z, yaw }, side } on the deck near the head, on the side away
//                                from the berth (the boat lies alongside the other side), facing across the deck
//   berthSide( dock )            +1 / -1: the side of the jetty the boat moors on (sign of the berth's lx)
//   berthPoint( dock, boatId )   { x, z, heading } the mooring: dock.position, the big ships a little further off (berthOf)
//   planeSpot( port, terrain? )  { x, z, heading, water: true }: Tidemark's bay anchorage, else 40 m off the dock head (pushed
//                                further out until the water is deep enough when a terrain is given)
//   ferryBase( metres )          the yard's own price for sailing / flying your craft round to a port ($, before the fee)

export const AGENT_FEE = 0.15; // on top of the yard's price, outside the home harbour
export const HOME_RANGE = 150; // m from the home dock: further than this on foot with nothing to sail or fly, the agent is pinned
export const OFF_HEAD = 40; // m off the dock head where a recovered seaplane is left
const PLANE_DEPTH = - 1.5; // m: the sea floor at least this deep under a delivered seaplane

export function agentPorts() {

	return ( WORLD.ports || [] ).filter( ( p ) => p && p.id !== 'home' && p.dock && p.dock.start && p.dock.end );

}

export function portInfo( id ) {

	return ( WORLD.ports || [] ).find( ( p ) => p.id === id ) || null;

}

function frame( dock ) {

	const h = Number.isFinite( dock.heading ) ? dock.heading : Math.atan2( dock.end.x - dock.start.x, dock.end.z - dock.start.z );
	const c = Math.cos( h ), s = Math.sin( h );
	const L = Math.hypot( dock.end.x - dock.start.x, dock.end.z - dock.start.z );
	const world = ( lx, lz ) => [ dock.start.x + lx * c + lz * s, dock.start.z - lx * s + lz * c ];
	const lxOf = ( x, z ) => ( x - dock.start.x ) * c - ( z - dock.start.z ) * s;
	return { h, c, s, L, world, lxOf };

}

export function berthSide( dock ) {

	const f = frame( dock ), p = dock.position || dock.end;
	return f.lxOf( p.x, p.z ) < 0 ? - 1 : 1;

}

export function agentSpot( port ) {

	const D = port.dock, f = frame( D );
	const hw = ( D.width || 2 ) / 2, wide = hw >= 1.5; // Tidemark's stone pier (kerbs, a head lamp, steps on the berth side)
	const side = - berthSide( D );
	const lz = Math.max( 1.5, f.L - ( wide ? 4.5 : 3.0 ) ); // clear of the head's lantern post and bollards
	const lx = side * Math.max( 0.3, hw - ( wide ? 0.65 : 0.35 ) );
	const y = D.deckHeight || 0;
	const [ x, z ] = f.world( lx, lz );
	const [ lxx, lzz ] = f.world( side * Math.max( 0.3, hw - ( wide ? 0.6 : 0.3 ) ), Math.min( f.L - 1.4, lz + 0.85 ) ); // the lectern, seaward of him
	// facing across the deck (toward the jetty's centre line)
	const yaw = Math.atan2( - side * f.c, side * f.s );
	return { x, y, z, yaw, side, lectern: { x: lxx, y, z: lzz, yaw } };

}

export function berthPoint( dock, boatId = null ) {

	const p = dock.position || dock.end, f = frame( dock );
	const off = Math.abs( berthOf( boatId ).x || 0 ) * berthSide( dock ); // outward, away from the jetty
	return { x: p.x + off * f.c, z: p.z - off * f.s, heading: f.h };

}

export function planeSpot( port, terrain = null ) {

	const D = port.dock, f = frame( D );
	if ( port.id === 'tidemark' && WORLD.tidemark && WORLD.tidemark.bay ) {

		const b = WORLD.tidemark.bay;
		return { x: b.x, z: b.z, heading: f.h, water: true };

	}

	let out = null;
	for ( const d of [ OFF_HEAD, 55, 70, 90, 120 ] ) {

		const x = D.end.x + f.s * d, z = D.end.z + f.c * d;
		out = { x: Math.round( x * 10 ) / 10, z: Math.round( z * 10 ) / 10, heading: f.h, water: true };
		const g = terrain && terrain.heightAt ? terrain.heightAt( x, z ) : null;
		if ( ! Number.isFinite( g ) || g <= PLANE_DEPTH ) break;

	}

	return out;

}

export function ferryBase( metres ) {

	return Math.max( 60, Math.round( ( 60 + Math.max( 0, metres ) * 0.12 ) / 10 ) * 10 );

}
