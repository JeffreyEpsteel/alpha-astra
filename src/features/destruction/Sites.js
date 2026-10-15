// Where the destructible props stand: round every port (WORLD.ports, read live: new ports get props too), the raider camp
// on the home island's east beach, and out on the shoals (rotten pilings and wreckage, far from any harbour: the
// "Clear the wreckage" notice). Deterministic: the same terrain, colliders and ports give the same props and ids on every
// client, so a destroyed id means the same prop for everybody.
//
//   planProps( { terrain, colliders, keep: [ { x, z, r } ], ports } ) -> [ { id, kind, site, port, x, y, z, yaw, opts } ]
//
// Tidemark's town props (wave 12A) stand at their authored spots (world/islands/town/Layout.js), not scattered.
// Land props keep clear of docks, the pier, mooring berths, footpaths, the start point, every existing collider (village
// buildings, stalls, the dressing props) and the keep-out circles (interactables, vendors). Railings go on the landward half
// of a dock, on the side away from the boat's berth.

import { WORLD } from '../../world/WorldLayout.js';
import { CAMP, SLOTS } from '../melee/MeleeData.js';
import { buildKind, layoutBounds, rngFor } from './Kinds.js';
import { townProps } from '../../world/islands/town/Layout.js';
import { ensureTidemark } from '../../world/islands/town/TidemarkTerrain.js';

// what each kind of site gets
export const SITE_KINDS = {
	home: [ 'crate', 'crate', 'barrel', 'barrel', 'fishRack', 'fence', 'crate', 'barrel', 'rockStack' ],
	port: [ 'crate', 'barrel', 'crate', 'barrel', 'fishRack', 'fence', 'rockStack' ],
	camp: [ 'leanTo', 'crate', 'crate', 'barrel', 'barrel', 'fence', 'fishRack' ],
};
export const SHOAL_KINDS = [ 'piling', 'piling', 'wreck', 'piling', 'wreck', 'piling' ];
const SHOAL_CLEAR = 150; // m from every port's dock and stand

function segDist( px, pz, ax, az, bx, bz ) {

	const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
	const t = l2 > 0 ? Math.max( 0, Math.min( 1, ( ( px - ax ) * dx + ( pz - az ) * dz ) / l2 ) ) : 0;
	return Math.hypot( px - ax - dx * t, pz - az - dz * t );

}

// a port's dock line [ ax, az, bx, bz ] (home: the pier)
export function dockLine( port ) {

	if ( port.id === 'home' ) return [ WORLD.pier.x, WORLD.pier.zStart, WORLD.pier.x, WORLD.pier.zEnd ];
	const d = port.dock;
	if ( d && d.start && d.end ) return [ d.start.x, d.start.z, d.end.x, d.end.z ];
	return null;

}

// distance from ( x, z ) to the nearest existing collider whose height range meets [ y0, y1 ]
function colliderClearance( colliders, x, z, y0, y1 ) {

	if ( ! colliders ) return Infinity;
	let best = Infinity;
	for ( const b of colliders.boxes ) {

		if ( b.top < y0 || b.bottom > y1 ) continue;
		if ( Math.abs( x - b.center.x ) > b.radius + 12 || Math.abs( z - b.center.z ) > b.radius + 12 ) continue;
		const dx = x - b.center.x, dz = z - b.center.z;
		const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
		const ex = Math.max( 0, Math.abs( lx ) - b.half.x ), ez = Math.max( 0, Math.abs( lz ) - b.half.z );
		best = Math.min( best, Math.hypot( ex, ez ) );

	}

	for ( const c of colliders.cylinders ) {

		if ( c.yMax < y0 || c.yMin > y1 ) continue;
		best = Math.min( best, Math.hypot( x - c.x, z - c.z ) - c.radius );

	}

	return best;

}

export function planProps( { terrain, colliders = null, keep = [], ports = WORLD.ports } = {} ) {

	const out = [];
	const T = terrain;
	const docks = ports.map( dockLine ).filter( Boolean );
	const berths = ports.map( ( p ) => p.dock && p.dock.position ).filter( Boolean );
	const starts = [ WORLD.start && WORLD.start.position, WORLD.spawn && WORLD.spawn.position ].filter( Boolean );
	const pathDist = typeof T.pathDistance === 'function' ? ( x, z ) => T.pathDistance( x, z ) : () => Infinity;

	const fits = ( x, z, r, land, paved = false ) => {

		for ( const s of starts ) if ( Math.hypot( x - s.x, z - s.z ) < r + 6 ) return false;
		for ( const b of berths ) if ( Math.hypot( x - b.x, z - b.z ) < r + 7 ) return false;
		for ( const d of docks ) if ( segDist( x, z, d[ 0 ], d[ 1 ], d[ 2 ], d[ 3 ] ) < r + 3.5 ) return false;
		for ( const k of keep ) if ( Math.hypot( x - k.x, z - k.z ) < k.r + r ) return false;
		for ( const p of out ) if ( Math.hypot( x - p.x, z - p.z ) < r + p.r + 0.9 ) return false;
		if ( land ) {

			if ( ! paved && pathDist( x, z ) < r + 0.8 ) return false; // (paved: a city quay, where crates belong)
			const h = T.heightAt( x, z );
			if ( colliderClearance( colliders, x, z, h - 0.3, h + 2.5 ) < r + 0.5 ) return false;

		}

		return true;

	};

	// the ground under a footprint: lowest corner, and how uneven it is
	const ground = ( x, z, r ) => {

		let lo = Infinity, hi = - Infinity;
		for ( const [ dx, dz ] of [ [ 0, 0 ], [ r, 0 ], [ - r, 0 ], [ 0, r ], [ 0, - r ] ] ) {

			const h = T.heightAt( x + dx, z + dz );
			lo = Math.min( lo, h ); hi = Math.max( hi, h );

		}

		return { lo, span: hi - lo };

	};

	const place = ( site, port, kind, cx, cz, r0, r1, rng, n, extra = {} ) => {

		const lay = buildKind( kind, rngFor( site + kind + n ), extra.opts || {} );
		const bb = layoutBounds( lay.pieces );
		const r = Math.hypot( bb.half.x, bb.half.z );
		for ( let tries = 0; tries < 80; tries ++ ) {

			const a = rng() * Math.PI * 2, d = r0 + rng() * ( r1 - r0 );
			const x = cx + Math.cos( a ) * d, z = cz + Math.sin( a ) * d;
			const g = ground( x, z, Math.min( r, 1.6 ) );
			if ( g.lo < 0.3 || g.lo > 9 || g.span > 0.45 ) continue;
			if ( extra.avoid && extra.avoid.some( ( k ) => Math.hypot( x - k.x, z - k.z ) < k.r + r ) ) continue;
			if ( ! fits( x, z, r, true, !! extra.paved ) ) continue;
			const p = { id: `${ site }.${ kind }.${ n }`, kind, site, port, x, y: g.lo - 0.02, z, yaw: rng() * Math.PI * 2, r, opts: extra.opts || {} };
			out.push( p );
			return p;

		}

		return null;

	};

	const counts = {};
	const nextN = ( site, kind ) => { const k = site + '.' + kind; counts[ k ] = ( counts[ k ] || 0 ) + 1; return counts[ k ] - 1; };

	// ---- Tidemark's town (wave 12A): every prop that is not a building shell, at its authored spot (world/islands/town/
	// Layout.js: the market stalls, the well roof, lamp posts, carts, crates, barrels, fences, the pier railings and the
	// boatyard's doors); first, so the port's scattered props keep clear of them. Only when the island is in the ports
	// (the island lies on its own terrain tile: ensureTidemark attaches it to this terrain if nothing has yet)
	const tm = ports.find( ( p ) => p.id === 'tidemark' );
	if ( tm && T && typeof T.heightAt === 'function' && T.coastDistance ) ensureTidemark( T );
	if ( tm && tm.market && T.heightAt( tm.market.x, tm.market.z ) > 0.5 ) {

		for ( const p of townProps( T ) ) {

			const bb = layoutBounds( buildKind( p.kind, rngFor( p.site + p.kind + p.id ), p.opts ).pieces );
			out.push( { ...p, r: Math.hypot( bb.half.x, bb.half.z ) } );

		}

	}

	// ---- ports
	for ( const port of ports ) {

		const line = dockLine( port );
		const ax = line ? line[ 0 ] : port.stand ? port.stand.x : port.center.x, az = line ? line[ 1 ] : port.stand ? port.stand.z : port.center.z;
		const rng = rngFor( 'port:' + port.id );
		const kinds = port.id === 'home' ? SITE_KINDS.home : SITE_KINDS.port;
		// (wave 21: Meridian's quays are paved city ground: its crates and barrels may stand on them)
		const extra = port.id === 'meridian' ? { paved: true } : {};
		for ( const kind of kinds ) place( port.id, port.id, kind, ax, az, 7, port.id === 'home' ? 38 : 28, rng, nextN( port.id, kind ), extra );
		// a railing on the dock: landward half, away from the berth
		if ( port.id !== 'home' && line && port.dock && port.dock.deckHeight ) {

			const [ sx, sz, ex, ez ] = line, L = Math.hypot( ex - sx, ez - sz );
			if ( L > 12 ) {

				const dx = ( ex - sx ) / L, dz = ( ez - sz ) / L;
				const b = port.dock.position;
				const side = b ? Math.sign( dx * ( b.z - sz ) - dz * ( b.x - sx ) ) || 1 : 1;
				const off = - side * ( ( port.dock.width || 2 ) / 2 - 0.06 );
				const len = Math.min( 6, L * 0.3 ), along = L * 0.3 + len / 2;
				// prop x runs along the dock; its outer side (-z, where the rails sit) faces away from the deck
				const nx = - dz * off / Math.abs( off ), nz = dx * off / Math.abs( off );
				const x = sx + dx * along + nx * Math.abs( off ), z = sz + dz * along + nz * Math.abs( off );
				const yaw = Math.atan2( nx, nz ) + Math.PI; // local -z points out over the water
				out.push( { id: `${ port.id }.railing.0`, kind: 'railing', site: port.id, port: port.id, x, y: port.dock.deckHeight, z, yaw, r: len / 2, opts: { length: len } } );

			}

		}

	}

	// ---- the raider camp (no harbour: it counts as "away from the harbours")
	{

		const rng = rngFor( 'camp' );
		const avoid = SLOTS.map( ( s ) => ( { x: s.x, z: s.z, r: 2.2 } ) ).concat( [ { x: CAMP.x, z: CAMP.z, r: 3 } ] );
		for ( const kind of SITE_KINDS.camp ) place( 'camp', null, kind, CAMP.x, CAMP.z, 3.5, CAMP.radius + 2, rng, nextN( 'camp', kind ), { avoid } );

	}

	// ---- the shoals: shallow water round the islands, far from every harbour
	{

		const rng = rngFor( 'shoals' );
		const anchors = [];
		for ( const p of ports ) {

			if ( p.stand ) anchors.push( p.stand );
			const l = dockLine( p );
			if ( l ) anchors.push( { x: l[ 2 ], z: l[ 3 ] } );

		}

		const islands = WORLD.islands || [];
		let k = 0;
		for ( let pass = 0; pass < 6 && k < SHOAL_KINDS.length; pass ++ ) {

			for ( const isl of islands ) {

				if ( k >= SHOAL_KINDS.length ) break;
				const kind = SHOAL_KINDS[ k ];
				const want = kind === 'wreck' ? [ - 1.5, - 0.5 ] : [ - 3, - 0.8 ];
				for ( let tries = 0; tries < 120; tries ++ ) {

					const a = rng() * Math.PI * 2, d = isl.radius * ( 0.5 + rng() * 0.9 );
					const x = isl.center.x + Math.cos( a ) * d, z = isl.center.z + Math.sin( a ) * d;
					const h = T.heightAt( x, z );
					if ( h < want[ 0 ] || h > want[ 1 ] ) continue;
					if ( anchors.some( ( q ) => Math.hypot( x - q.x, z - q.z ) < SHOAL_CLEAR ) ) continue;
					if ( out.some( ( q ) => q.site === 'shoals' && Math.hypot( x - q.x, z - q.z ) < 60 ) ) continue;
					// the seabed must be flat enough for the posts
					const g = ground( x, z, 1.4 );
					if ( g.span > 0.6 ) continue;
					if ( ! fits( x, z, 2, false ) ) continue;
					const n = nextN( 'shoals', kind );
					out.push( { id: `shoals.${ kind }.${ n }`, kind, site: 'shoals', port: null, x, y: g.lo, z, yaw: rng() * Math.PI * 2, r: 2, opts: { depth: - g.lo } } );
					k ++;
					break;

				}

			}

		}

	}

	return out;

}

// keep-out circles from the live game: every interactable (stalls, boards, NPC spots) and vendor
export function keepOutFrom( app, features ) {

	const keep = [];
	const vendors = app && app.game && app.game.vendors ? app.game.vendors : [];
	for ( const v of vendors ) if ( v && v.position ) keep.push( { x: v.position.x, z: v.position.z, r: ( v.radius || 3 ) * 0.6 + 1 } );
	if ( features && features._interactables ) {

		for ( const e of features._interactables ) {

			let q = null;
			try { q = typeof e.position === 'function' ? e.position() : e.position; } catch ( err ) { q = null; }
			if ( q && Number.isFinite( q.x ) ) keep.push( { x: q.x, z: q.z, r: Math.min( e.radius || 2.5, 3.5 ) + 1 } );

		}

	}

	return keep;

}
