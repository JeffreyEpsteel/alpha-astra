// Where the dressing goes: pure placement functions over TerrainData (no GPU, no scene), so the test can run them
// against the real heightmap and check the clearances.
//
//   kelpSites( terrain )            kelp clusters on the shallow seabed around the reef and around Pons
//   palmSites( terrain, keep )      palm records ( VegType format ) on Pons's land
//   rockSites( terrain, keep )      rocks on Pons's land and at its waterline
//   ponsKeepOut( terrain )          what the island's palms and rocks must stay clear of
//   dockFrame( lx, lz )             Pons dock frame ( lx across, lz along from the foot ) -> world [ x, z ]
//
// All of them are deterministic ( fixed seeds ); change a seed to reshuffle.

import { WORLD } from '../../world/WorldLayout.js';
import { PONS, PONS_STACKS, ponsWorld } from '../../world/terrain/IslandShape.js';
import { PONS_HUTS } from '../../world/PonsCove.js';
import { STALL_SITES } from '../trade/stall.js';
import { BOARD_SITES } from '../notices/Sites.js';
import { PONS_STAND } from '../../game/PonsPort.js';
import { Noise2D, mulberry32, smoothstep } from '../../util/Noise.js';

const D = WORLD.pons.dock;
const TAU = Math.PI * 2;

// dock frame -> world ( PonsCove._w: lx across the dock, lz along it from the sand )
export function dockFrame( lx, lz ) {

	const c = Math.cos( D.heading ), s = Math.sin( D.heading );
	return [ D.start.x + lx * c + lz * s, D.start.z - lx * s + lz * c ];

}

export function dockLength() {

	return Math.hypot( D.end.x - D.start.x, D.end.z - D.start.z );

}

// distance from ( x, z ) to the dock's centre segment, minus its half width ( < 0: on the deck )
export function dockDistance( x, z ) {

	const ax = D.start.x, az = D.start.z, bx = D.end.x, bz = D.end.z;
	const abx = bx - ax, abz = bz - az;
	const t = Math.max( 0, Math.min( 1, ( ( x - ax ) * abx + ( z - az ) * abz ) / ( abx * abx + abz * abz ) ) );
	return Math.hypot( x - ax - abx * t, z - az - abz * t ) - D.width / 2;

}

// A uniform grid to keep a minimum spacing between placed discs ( x, z, r ).
export class Spacing {

	constructor( cell = 4 ) {

		this.cell = cell;
		this.grid = new Map();

	}

	_k( i, j ) {

		return i * 73856093 ^ j * 19349663;

	}

	free( x, z, r, gap = 1 ) {

		const c = this.cell, reach = Math.ceil( ( r + 4 ) / c );
		const i0 = Math.floor( x / c ), j0 = Math.floor( z / c );
		for ( let j = j0 - reach; j <= j0 + reach; j ++ ) for ( let i = i0 - reach; i <= i0 + reach; i ++ ) {

			const list = this.grid.get( this._k( i, j ) );
			if ( ! list ) continue;
			for ( const o of list ) if ( Math.hypot( o.x - x, o.z - z ) < ( o.r + r ) * gap ) return false;

		}

		return true;

	}

	add( x, z, r ) {

		const k = this._k( Math.floor( x / this.cell ), Math.floor( z / this.cell ) );
		let list = this.grid.get( k );
		if ( ! list ) this.grid.set( k, list = [] );
		list.push( { x, z, r } );

	}

}

const slopeAt = ( T, x, z, e = 1.5 ) => Math.hypot( T.heightAt( x + e, z ) - T.heightAt( x - e, z ), T.heightAt( x, z + e ) - T.heightAt( x, z - e ) ) / ( 2 * e );

// ---------------------------------------------------------------------------------------------- keep-out zones
// Circles { x, z, r, name } plus the dock rectangle and the footpaths ( terrain.pathDistance ). Radii include the
// thing's own size and a walking margin.
export function ponsKeepOut() {

	const circles = [];
	for ( const [ u, v ] of PONS_HUTS ) {

		const [ x, z ] = ponsWorld( u, v );
		circles.push( { x, z, r: 5.5, name: 'hut' } );

	}

	circles.push( { x: PONS_STAND.x, z: PONS_STAND.z, r: 5.5, name: 'fish stall' } );
	circles.push( { x: STALL_SITES.pons.x, z: STALL_SITES.pons.z, r: 5.5, name: 'trade stall' } );
	circles.push( { x: BOARD_SITES.pons.x, z: BOARD_SITES.pons.z, r: 3.5, name: 'notice board' } );
	// the foot of the dock and the strip in front of the stalls, where people arrive and stand
	const [ fx, fz ] = dockFrame( 0, - 3 );
	circles.push( { x: fx, z: fz, r: 6, name: 'dock foot' } );
	return { circles, dockMargin: 5, pathMargin: 3.2 };

}

// true when ( x, z ) with a footprint radius r is clear of every keep-out
export function clearOf( T, keep, x, z, r = 0 ) {

	for ( const c of keep.circles ) if ( Math.hypot( x - c.x, z - c.z ) < c.r + r ) return false;
	if ( dockDistance( x, z ) < keep.dockMargin + r ) return false;
	if ( T.pathDistance && T.pathDistance( x, z ) < keep.pathMargin + r ) return false;
	return true;

}

// ---------------------------------------------------------------------------------------------- kelp
// Clusters on the seabed 2.4 - 8.5 m down ( the fronds are 1.7 m tall, so they never reach the surface ), in a ring
// around the reef and in a ring around Pons, patchy ( noise ) rather than even; clear of the pier, the berths and
// Pons's dock and its mooring pocket and sea stacks. Each site: { x, y, z, s, yaw, depth, area }.
export function kelpSites( T, { seed = 8191, spacing = 3.8, perAreaMax = 320 } = {} ) {

	const rand = mulberry32( seed );
	const patch = new Noise2D( seed + 5 ), fine = new Noise2D( seed + 17 );
	const reef = WORLD.reef, pier = WORLD.pier, dock = WORLD.boatDock.position;
	const areas = [
		{ name: 'reef', cx: reef.center.x, cz: reef.center.z, r0: reef.radius * 0.85, r1: reef.radius + 62 },
		{ name: 'pons', cx: PONS.x, cz: PONS.z, r0: 110, r1: 235 },
	];
	const blocked = ( x, z, area ) => {

		if ( Math.abs( x - pier.x ) < 16 && z > pier.zStart - 10 && z < pier.zEnd + 24 ) return true;
		if ( Math.hypot( x - dock.x, z - dock.z ) < 38 ) return true; // the berth and the yard east of the pier head
		if ( area === 'pons' ) {

			if ( dockDistance( x, z ) < 16 ) return true;
			if ( Math.hypot( x - WORLD.pons.dock.position.x, z - WORLD.pons.dock.position.z ) < 46 ) return true; // mooring pocket and its approach
			for ( const [ sx, sz, sr ] of PONS_STACKS ) if ( Math.hypot( x - sx, z - sz ) < sr + 7 ) return true;

		}

		return false;

	};

	const out = [];
	const sp = new Spacing( 6 );
	for ( const a of areas ) {

		let count = 0;
		const n = 5200;
		for ( let i = 0; i < n && count < perAreaMax; i ++ ) {

			const ang = rand() * TAU, r = a.r0 + Math.sqrt( rand() ) * ( a.r1 - a.r0 );
			const x = a.cx + Math.cos( ang ) * r, z = a.cz + Math.sin( ang ) * r;
			const h = T.heightAt( x, z );
			if ( h > - 2.4 || h < - 8.5 ) continue;
			if ( blocked( x, z, a.name ) ) continue;
			// patches: a broad noise decides where the kelp forest stands, a fine one thins the edge
			const p = smoothstep( - 0.15, 0.3, patch.fbm( x / 38, z / 38, 2 ) ) * ( 0.55 + 0.45 * smoothstep( - 0.3, 0.4, fine.fbm( x / 11, z / 11, 2 ) ) );
			if ( rand() > p ) continue;
			if ( slopeAt( T, x, z, 2 ) > 0.4 ) continue;
			if ( ! sp.free( x, z, spacing / 2, 1 ) ) continue;
			sp.add( x, z, spacing / 2 );
			const depth = - h;
			// a cluster stays below the surface even in a trough: tops at most depth - 0.9
			const s = Math.min( 0.8 + rand() * 0.75, ( depth - 0.9 ) / 1.68 );
			out.push( { x, y: h - 0.04, z, s, yaw: rand() * TAU, depth, area: a.name } );
			count ++;

		}

	}

	return out;

}

// ---------------------------------------------------------------------------------------------- Pons palms
// Palm records for a VegType ( { x, y, z, s, yaw, la, l, H, seed } ): clumps along the back of the beach leaning to the sea,
// a few inland on the hills. Land between 2.2 and 12 m, not steep, clear of the dock, huts, stalls and the footpath.
export function palmSites( T, keep, { seed = 3301, count = 26, spacing = 6 } = {} ) {

	const rand = mulberry32( seed );
	const clump = new Noise2D( seed + 9 );
	const sp = new Spacing( 6 );
	const out = [];
	const c = { x: PONS.x, z: PONS.z };
	for ( let i = 0; i < 4000 && out.length < count; i ++ ) {

		const u = - 112 + rand() * 250, v = - 150 + rand() * 300;
		const [ x, z ] = ponsWorld( u, v );
		const h = T.heightAt( x, z );
		if ( h < 2.2 || h > 12 ) continue;
		if ( slopeAt( T, x, z ) > 0.45 ) continue;
		if ( ! clearOf( T, keep, x, z, 1.2 ) ) continue;
		// the back of the beach is the favourite place; inland only in clumps
		const beach = 1 - smoothstep( 3.5, 7, h );
		const p = 0.12 + 0.5 * beach + 0.5 * smoothstep( 0.0, 0.5, clump.fbm( x / 45, z / 45, 2 ) ) * ( 1 - beach );
		if ( rand() > p ) continue;
		if ( ! sp.free( x, z, spacing / 2, 1 ) ) continue;
		sp.add( x, z, spacing / 2 );
		const s = 0.85 + rand() * 0.32;
		// lean away from the island centre ( toward the sea ), more at the water's edge
		const la = Math.atan2( z - c.z, x - c.x ) + ( rand() - 0.5 ) * 1.1;
		const lean = ( 0.1 + 0.3 * beach ) * ( 0.55 + 0.75 * rand() );
		let g = h;
		for ( let a = 0; a < 5; a ++ ) g = Math.min( g, T.heightAt( x + Math.cos( a * 1.26 ) * 0.35, z + Math.sin( a * 1.26 ) * 0.35 ) );
		out.push( { x, y: g - 0.05, z, s, yaw: rand() * TAU, la, l: lean, H: ( 7 + rand() * 6.5 ) * ( 0.9 + 0.2 * s ), seed: rand() } );

	}

	return out;

}

// ---------------------------------------------------------------------------------------------- Pons rocks
// Rocks ( size = radius in m, style = RockGeometry style ): boulders on the rocky ground, a scatter at the waterline
// ( half sunk ), and a few bigger ones on the far side. Each: { x, y, z, size, sy, style, yaw, tiltX, tiltZ, sink }.
export function rockSites( T, keep, { seed = 5503, count = 38 } = {} ) {

	const rand = mulberry32( seed );
	const sp = new Spacing( 4 );
	const out = [];
	const rockAt = ( x, z ) => {

		const fx = ( x - T.origin ) / T.texel - 0.5, fz = ( z - T.origin ) / T.texel - 0.5;
		const i = Math.max( 0, Math.min( T.res - 2, Math.floor( fx ) ) ), j = Math.max( 0, Math.min( T.res - 2, Math.floor( fz ) ) );
		return T.rock ? T.rock[ j * T.res + i ] : 0;

	};

	for ( let i = 0; i < 6000 && out.length < count; i ++ ) {

		const u = - 125 + rand() * 300, v = - 160 + rand() * 320;
		const [ x, z ] = ponsWorld( u, v );
		const h = T.heightAt( x, z );
		const waterline = h > - 0.7 && h < 0.9;
		const rocky = h > 0.9 && h < 16 && rockAt( x, z ) > 0.45;
		const stray = h > 0.9 && h < 6 && rand() < 0.012; // a lone boulder on the grass / sand now and then
		if ( ! waterline && ! rocky && ! stray ) continue;
		// the far ( rocky ) side gets the larger ones
		const far = smoothstep( 40, 120, u );
		const size = ( 0.55 + Math.pow( rand(), 1.8 ) * 1.7 ) * ( 1 + 1.0 * far * rand() );
		if ( ! clearOf( T, keep, x, z, size ) ) continue;
		if ( waterline && rand() > 0.2 + 0.5 * far ) continue;
		if ( ! sp.free( x, z, size + 1, 1 ) ) continue;
		sp.add( x, z, size + 1 );
		const sy = 0.75 + rand() * 0.5;
		let g = h;
		for ( let a = 0; a < 6; a ++ ) g = Math.min( g, T.heightAt( x + Math.cos( a * 1.05 ) * size * 0.7, z + Math.sin( a * 1.05 ) * size * 0.7 ) );
		out.push( { x, y: g, z, size, sy, style: Math.floor( rand() * 4 ), yaw: rand() * TAU, tiltX: ( rand() - 0.5 ) * 0.4, tiltZ: ( rand() - 0.5 ) * 0.4, sink: 0.25 + rand() * 0.2, waterline } );

	}

	return out;

}
