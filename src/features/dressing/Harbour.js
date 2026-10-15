// Harbour dressing: the naval fork's port props ( public/models/harbour/*.glb ) placed in small clusters on the home
// pier and boardwalk and at Pons Cove's dock and huts.
//
//   const plan = planHarbour( { terrain, colliders, keep, boardwalk } );   // pure: items + poles, testable
//   const h = new Harbour( { scene, assets, plan } );  h.update( cameraPosition )
//
// plan.items: [ { id, x, y, z, yaw, scale, tag } ]   id: rope-coil | bait-bowl | coin-tray | shuttle | net | bunting
// plan.poles: [ { x, z, y0, y1 } ]                    the two thin posts a bunting line is strung between
//
// The props are small ( a bait bowl is 10 cm, a coin tray 20 cm, a shuttle 12 cm ), so each carries a game-scale factor
// ( MODELS.*.scale ) that reads at third-person distance. Nothing goes on the middle of a walkway: floor props sit 0.6 - 0.95 m
// off the centreline against a rail or at a deck edge, small ones on crate tops and benches, nets hang outside the pier rail
// or on a hut wall, bunting is overhead between posts. Every spot is tested against the real colliders ( blocked() ), the
// interactables ( stalls, boards, vendors ) and, for the floor, its surface.

import { InstancedMesh, Matrix4, Quaternion, Vector3, Euler, Group, Mesh, CylinderGeometry } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { WORLD } from '../../world/WorldLayout.js';
import { PONS_HUTS } from '../../world/PonsCove.js';
import { ponsWorld } from '../../world/terrain/IslandShape.js';
import { mulberry32 } from '../../util/Noise.js';
import { dockFrame, dockLength } from './Sites.js';

const D = WORLD.pons.dock;
const P = WORLD.pier;

// file, game-scale factor ( sy: extra vertical stretch ), draw range ( m ), casts shadows, double sided, material colours by glTF
// material name ( the port GLBs ship with default grey 0.8, the colours here are this game's ); r = footprint radius at that scale
const HEMP = 0x8a6f45, WOOD = 0x7a5535;
export const MODELS = {
	'rope-coil': { file: 'harbour/rope-coil-v02.glb', scale: 1.5, sy: 1.5, range: 75, shadow: true, r: 0.42 }, // the coil is 60 x 42 cm and 0.9 cm thick: 90 cm, 1.4 cm of rope
	'bait-bowl': { file: 'harbour/bait-bowl.glb', scale: 2.4, range: 40, shadow: false, r: 0.15, colors: { Craft_Wood: WOOD } },
	'coin-tray': { file: 'harbour/coin-tray.glb', scale: 1.8, range: 40, shadow: false, r: 0.2, colors: { Craft_Wood: WOOD, Craft_CoinMetal: [ 0xd2a43a, 0.8, 0.35 ] } },
	shuttle: { file: 'harbour/mending-shuttle.glb', scale: 2.8, range: 35, shadow: false, r: 0.2, colors: { Craft_Wood: 0x8c6a42 } },
	net: { file: 'harbour/hanging-net.glb', scale: 1.2, range: 100, shadow: true, double: true, r: 1, colors: { Harbour_Net: 0x9b9272, Harbour_Hemp: HEMP } },
	bunting: { file: 'harbour/bunting.glb', scale: 1, range: 120, shadow: false, double: true, r: 1.5, colors: { Harbour_Hemp: HEMP, Harbour_Cloth_0: 0xc4452f, Harbour_Cloth_1: 0x2f8f8c, Harbour_Cloth_2: 0xe3b23c } },
};

// glTF material info -> Material options for a model ( side, colour, metalness / roughness )
export function modelMaterial( spec, info ) {

	const o = spec.double ? { side: 'double' } : {};
	const c = spec.colors && spec.colors[ info.name ];
	if ( c !== undefined ) {

		if ( Array.isArray( c ) ) { o.color = c[ 0 ]; o.metalness = c[ 1 ]; o.roughness = c[ 2 ]; } else { o.color = c; o.roughness = 0.85; }

	}

	return o;

}

// local extents of the models ( from the manifest ) the placement depends on
const BUNTING_HALF = 1.5; // m, the line spans x = -1.5 .. 1.5
const BUNTING_TOP = 1.355; // y of the line's ends
const NET_TOP = 1.607; // y of the net's top rope
const POLE_H = 2.75;

// the cleats on the pier with a line trailing over the side: [ z, side ] ( Pier.js ); nets keep clear of them
const PIER_CLEATS = [ [ - 47.3, 1 ], [ - 15.4, - 1 ], [ 27.8, 1 ] ];

// ---------------------------------------------------------------------------------------------- probes

// blocked( x, z, r, y0, h ): anything solid ( collider, interactable ) overlapping the disc of radius r whose vertical
// extent meets [ y0 + 0.05, y0 + h ] ( floors at y0 do not count ).  surface( x, z, maxY ): the ground / deck height.
export function makeProbe( terrain, colliders, keep = [] ) {

	const boxes = colliders ? colliders.boxes : [], cyls = colliders ? colliders.cylinders : [];
	const blocked = ( x, z, r, y0, h = 0.3 ) => {

		for ( const k of keep ) if ( Math.hypot( x - k.x, z - k.z ) < k.r + r ) return true;
		const lo = y0 + 0.05, hi = y0 + h;
		for ( const b of boxes ) {

			if ( b.top <= lo || b.bottom >= hi || ! b.solid ) continue;
			if ( Math.abs( x - b.center.x ) > b.radius + r + 0.01 || Math.abs( z - b.center.z ) > b.radius + r + 0.01 ) continue;
			const dx = x - b.center.x, dz = z - b.center.z;
			const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
			const ex = Math.max( Math.abs( lx ) - b.half.x, 0 ), ez = Math.max( Math.abs( lz ) - b.half.z, 0 );
			if ( Math.hypot( ex, ez ) < r ) return true;

		}

		for ( const c of cyls ) {

			if ( c.yMax <= lo || c.yMin >= hi ) continue;
			if ( Math.hypot( x - c.x, z - c.z ) < c.radius + r ) return true;

		}

		return false;

	};

	const surface = ( x, z, maxY ) => {

		const g = terrain.heightAt( x, z );
		const c = colliders ? colliders.groundHeightAt( x, z, maxY ) : - Infinity;
		return Math.max( g, c );

	};

	return { blocked, surface };

}

// the boardwalk centreline as { x, z, y, tx, tz } samples every ~0.7 m ( from the Village's path, else the default polyline )
export function boardwalkSamples( terrain, path = null ) {

	const out = [];
	if ( path && path.samples && path.deck ) {

		for ( let i = 0; i < path.samples.length; i += 4 ) {

			const s = path.samples[ i ];
			out.push( { x: s.p.x, z: s.p.z, y: path.deck[ i ], tx: s.tan.x, tz: s.tan.z } );

		}

		return out;

	}

	const pts = [ [ 55, - 65 ], [ 54.6, - 72 ], [ 52.4, - 82 ], [ 48.4, - 92 ], [ 44.8, - 100.5 ], [ 42.6, - 107.2 ] ];
	for ( let k = 0; k < pts.length - 1; k ++ ) {

		const [ ax, az ] = pts[ k ], [ bx, bz ] = pts[ k + 1 ];
		const L = Math.hypot( bx - ax, bz - az ), tx = ( bx - ax ) / L, tz = ( bz - az ) / L;
		for ( let d = 0; d < L; d += 0.7 ) {

			const x = ax + tx * d, z = az + tz * d;
			out.push( { x, z, y: terrain.heightAt( x, z ) + 0.26, tx, tz } );

		}

	}

	return out;

}

// ---------------------------------------------------------------------------------------------- planning

const wrapItem = ( id, x, y, z, yaw, tag, scale = MODELS[ id ].scale ) => ( { id, x, y, z, yaw, scale, tag } );

// the home harbour: pier rails, pier / boardwalk edges, sand beside the boardwalk, crate tops, bunting over the boardwalk
export function planHome( { terrain, colliders, keep = [], boardwalk = null, seed = 4101 } ) {

	const rnd = mulberry32( seed );
	const probe = makeProbe( terrain, colliders, keep );
	const items = [], poles = [];
	const spots = [];
	const apart = ( x, z, d ) => spots.every( ( s ) => Math.hypot( s.x - x, s.z - z ) >= d );
	const mark = ( x, z ) => spots.push( { x, z } );
	const DK = P.deckHeight;

	// -- nets hung over the outside of the pier rail ( odd bays, clear of the cleats' trailing lines )
	if ( colliders ) {

		const rails = colliders.boxes.filter( ( b ) => b.tag === 'pierRail' && b.half.z > 1.2 && b.center.z < P.zEnd - 8 ).sort( () => rnd() - 0.5 );
		let nets = 0;
		for ( const b of rails ) {

			if ( nets >= 3 ) break;
			const side = Math.sign( b.center.x - P.x );
			if ( PIER_CLEATS.some( ( [ cz, s ] ) => s === side && Math.abs( cz - b.center.z ) < b.half.z + 0.5 ) ) continue;
			if ( ! apart( P.x + side * 1.7, b.center.z, 13 ) ) continue;
			const sc = Math.min( MODELS.net.scale, ( b.half.z * 2 - 0.5 ) / 1.82 );
			const x = P.x + side * 1.74;
			const top = DK + 0.97;
			// the model's front ( +Z ) faces outward ( +-X ): yaw so that local +Z points along side * X
			items.push( wrapItem( 'net', x, top - NET_TOP * sc, b.center.z, side > 0 ? Math.PI / 2 : - Math.PI / 2, 'pier net', sc ) );
			mark( x, b.center.z );
			nets ++;

		}

	}

	// -- rope coils flat on the deck, against a rail side ( not in the middle )
	{

		const cand = [];
		for ( let z = - 58; z < 26; z += 0.7 ) for ( const side of [ - 1, 1 ] ) cand.push( [ P.x + side * 0.82, z ] );
		cand.sort( () => rnd() - 0.5 );
		let n = 0;
		for ( const [ x, z ] of cand ) {

			if ( n >= 3 ) break;
			if ( ! apart( x, z, 11 ) ) continue;
			if ( probe.blocked( x, z, MODELS[ 'rope-coil' ].r + 0.04, DK, 0.2 ) ) continue;
			items.push( wrapItem( 'rope-coil', x, DK, z, rnd() * 6.283, 'pier coil' ) );
			mark( x, z );
			n ++;

		}

	}

	// -- the boardwalk: coils at the edge, a mending spot on the sand beside it
	const bw = boardwalk || boardwalkSamples( terrain );
	{

		let n = 0, m = 0;
		const order = bw.map( ( s, i ) => i ).sort( () => rnd() - 0.5 );
		for ( const i of order ) {

			const s = bw[ i ];
			const side = rnd() < 0.5 ? - 1 : 1;
			const nx = - s.tz, nz = s.tx;
			if ( n < 2 ) {

				const x = s.x + nx * side * 0.6, z = s.z + nz * side * 0.6;
				const y = probe.surface( x, z, s.y + 0.2 );
				if ( Math.abs( y - s.y ) < 0.15 && apart( x, z, 9 ) && ! probe.blocked( x, z, 0.4, y, 0.2 ) ) {

					items.push( wrapItem( 'rope-coil', x, y, z, rnd() * 6.283, 'boardwalk coil' ) );
					mark( x, z ); n ++; continue;

				}

			}

			if ( m < 2 ) {

				// beside the boardwalk, on the sand: a net-mending spot ( coil, shuttle and a bowl )
				const x = s.x + nx * side * 2.7, z = s.z + nz * side * 2.7;
				const y = terrain.heightAt( x, z );
				if ( y > 1.9 && y < 6.5 && terrain.pathDistance( x, z ) > 1.4 && apart( x, z, 6 ) && ! items.some( ( q ) => /mending/.test( q.tag ) && q.id === 'rope-coil' && Math.hypot( q.x - x, q.z - z ) < 14 ) && ! probe.blocked( x, z, 0.9, y, 0.5 ) && slope( terrain, x, z ) < 0.25 ) {

					mendingSpot( items, x, y, z, rnd, 'mending spot' );
					mark( x, z ); m ++;

				}

			}

		}

	}

	// -- on the crate tops: a bait bowl and a shuttle on one, a coin tray on the other
	if ( colliders ) {

		const crates = colliders.boxes.filter( ( b ) => b.tag === 'crate' && Math.abs( b.center.x - P.x ) < 3 );
		crates.forEach( ( b, i ) => {

			const x = b.center.x, z = b.center.z, y = b.top;
			if ( i % 2 === 0 ) {

				items.push( wrapItem( 'bait-bowl', x - 0.09, y, z + 0.04, rnd() * 6.283, 'crate bowl' ) );
				items.push( wrapItem( 'shuttle', x + 0.1, y, z - 0.08, 0.6 + rnd() * 0.4, 'crate shuttle' ) );

			} else {

				items.push( wrapItem( 'coin-tray', x, y, z, rnd() * 6.283, 'crate tray' ) );

			}

		} );

	}

	// -- bunting across the boardwalk between two slim posts ( at two places, away from the stalls' awnings )
	{

		const rigs = [];
		for ( const f of [ 0.34, 0.8, 0.5, 0.65, 0.42, 0.9 ] ) {

			if ( rigs.length >= 2 ) break;
			const i = Math.min( bw.length - 2, Math.floor( bw.length * f ) );
			const s = bw[ i ];
			// overhead, so only the posts matter: not on top of a coil or mending spot, and the lines well apart
			if ( rigs.some( ( r ) => Math.hypot( r.x - s.x, r.z - s.z ) < 16 ) || spots.some( ( q ) => Math.hypot( q.x - s.x, q.z - s.z ) < 2.2 ) ) continue;
			const rig = buntingRig( probe, s, 1.4 );
			if ( ! rig ) continue;
			items.push( rig.item ); poles.push( ...rig.poles );
			rigs.push( { x: s.x, z: s.z } );

		}

	}

	return { items, poles };

}

const slope = ( T, x, z, e = 1.2 ) => Math.hypot( T.heightAt( x + e, z ) - T.heightAt( x - e, z ), T.heightAt( x, z + e ) - T.heightAt( x, z - e ) ) / ( 2 * e );

// a coil, a shuttle on it and a bait bowl beside: where somebody sat mending
function mendingSpot( items, x, y, z, rnd, tag ) {

	const a = rnd() * 6.283;
	items.push( wrapItem( 'rope-coil', x, y, z, a, tag ) );
	items.push( wrapItem( 'shuttle', x + Math.cos(a) * 0.12, y + 0.045, z + Math.sin(a) * 0.12, a + 1.1, tag ) );
	items.push( wrapItem( 'bait-bowl', x - Math.sin( a ) * 0.62, y, z + Math.cos( a ) * 0.62, rnd() * 6.283, tag ) );

}

// two posts across a walkway at sample s ( lateral +-half ), the line strung between their tops; null when anything is in the way
function buntingRig( probe, s, half ) {

	const nx = - s.tz, nz = s.tx;
	const a = [ s.x + nx * half, s.z + nz * half ], b = [ s.x - nx * half, s.z - nz * half ];
	const ya = probe.surface( a[ 0 ], a[ 1 ], s.y + 0.4 ), yb = probe.surface( b[ 0 ], b[ 1 ], s.y + 0.4 );
	if ( probe.blocked( a[ 0 ], a[ 1 ], 0.2, ya, POLE_H ) || probe.blocked( b[ 0 ], b[ 1 ], 0.2, yb, POLE_H ) ) return null;
	// the line itself is overhead ( >= 2.2 m ) but the poles need ground: both within 0.5 m of the walkway deck
	if ( Math.abs( ya - s.y ) > 0.5 || Math.abs( yb - s.y ) > 0.5 ) return null;
	const span = Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ] );
	const scale = span / ( BUNTING_HALF * 2 );
	const top = Math.max( ya, yb ) + POLE_H - 0.1;
	const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ];
	return {
		item: wrapItem( 'bunting', ( a[ 0 ] + b[ 0 ] ) / 2, top - BUNTING_TOP * scale, ( a[ 1 ] + b[ 1 ] ) / 2, Math.atan2( - dz, dx ), 'bunting', scale ),
		poles: [ { x: a[ 0 ], z: a[ 1 ], y0: ya - 0.1, y1: top + 0.1 }, { x: b[ 0 ], z: b[ 1 ], y0: yb - 0.1, y1: top + 0.1 } ],
	};

}

// Pons Cove: coils and a crate-top still life on the dock, a bunting line across its foot, nets and bench things at the huts
export function planPons( { terrain, colliders, keep = [], seed = 4202 } ) {

	const rnd = mulberry32( seed );
	const probe = makeProbe( terrain, colliders, keep );
	const items = [], poles = [];
	const top = D.deckHeight;
	const L = dockLength();
	const hw = D.width / 2;

	// dock: the crate stack at ( hw - 0.4, 6.05 ) has its top at deck + 0.7 ( PonsCove ): bowl and shuttle on it
	{

		const [ x, z ] = dockFrame( hw - 0.4, 6.05 );
		items.push( wrapItem( 'bait-bowl', x, top + 0.7, z, rnd() * 6.283, 'dock crate' ) );
		const [ sx, sz ] = dockFrame( hw - 0.52, 6.0 );
		items.push( wrapItem( 'shuttle', sx, top + 0.7, sz, D.heading + 0.4, 'dock crate' ) );
		// coils on the other side of the deck, out of the way of the bollards and lantern posts
		for ( const [ lx, lz ] of [ [ - 0.55, 8.4 ], [ 0.55, L - 5.2 ] ] ) {

			// the coil's trailing end ( local +x ) lies along the dock
			const [ cx, cz ] = dockFrame( lx, lz );
			items.push( wrapItem( 'rope-coil', cx, top, cz, D.heading - Math.PI / 2 + ( rnd() - 0.5 ) * 0.5, 'dock coil' ) );

		}

		// bunting across the dock foot: two posts on the sand either side, the line over the first boards
		const [ ax, az ] = dockFrame( - hw - 0.35, 1.6 ), [ bx, bz ] = dockFrame( hw + 0.35, 1.6 );
		const ya = terrain.heightAt( ax, az ), yb = terrain.heightAt( bx, bz );
		const span = Math.hypot( bx - ax, bz - az ), scale = span / ( BUNTING_HALF * 2 );
		const ptop = Math.max( ya, yb, top ) + POLE_H;
		items.push( wrapItem( 'bunting', ( ax + bx ) / 2, ptop - 0.1 - BUNTING_TOP * scale, ( az + bz ) / 2, Math.atan2( - ( bz - az ), bx - ax ), 'dock bunting', scale ) );
		poles.push( { x: ax, z: az, y0: ya - 0.1, y1: ptop }, { x: bx, z: bz, y0: yb - 0.1, y1: ptop } );

	}

	// huts ( PonsCove._hut ): yaw = dock heading, local +x along the hut, +z toward the water / door
	const yaw = D.heading, c = Math.cos( yaw ), s = Math.sin( yaw );
	PONS_HUTS.forEach( ( [ u, v ], i ) => {

		const [ hx0, hz0 ] = ponsWorld( u, v );
		const W = ( lx, lz ) => [ hx0 + lx * c + lz * s, hz0 - lx * s + lz * c ];
		let y0 = Infinity;
		for ( const [ ox, oz ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ - 1, 1 ], [ 1, 1 ] ] ) { const [ x, z ] = W( ox * 1.8, oz * 1.5 ); y0 = Math.min( y0, terrain.heightAt( x, z ) ); }
		y0 = Math.max( y0, 0.2 );
		// a net drying on the side wall that is free ( the walls are at lx = +-1.8 ), its front facing out
		const side = i % 2 === 0 ? - 1 : 1;
		const [ nx, nz ] = W( side * 1.87, 0 );
		items.push( wrapItem( 'net', nx, y0 + 2.2 - NET_TOP * 1.0, nz, yaw + side * Math.PI / 2, 'hut net', 1.0 ) );
		// the bench by the door ( top at y0 + 0.535 ): shuttle + bowl on the first, coin tray on the second
		const benchTop = y0 + 0.535;
		const [ b1x, b1z ] = W( - 1.25, 1.5 + 0.45 ), [ b2x, b2z ] = W( - 0.75, 1.5 + 0.45 );
		if ( i === 0 ) {

			items.push( wrapItem( 'bait-bowl', b1x, benchTop, b1z, rnd() * 6.283, 'hut bench' ) );
			items.push( wrapItem( 'shuttle', b2x, benchTop, b2z, yaw + 0.3, 'hut bench' ) );

		} else {

			items.push( wrapItem( 'coin-tray', b1x, benchTop, b1z, yaw, 'hut bench' ) );
			items.push( wrapItem( 'bait-bowl', b2x, benchTop, b2z, rnd() * 6.283, 'hut bench' ) );

		}

		// a coil on the ground beside the barrel
		const [ kx, kz ] = W( 2.35, 1.5 + 1.0 );
		items.push( wrapItem( 'rope-coil', kx, terrain.heightAt( kx, kz ), kz, rnd() * 6.283, 'hut coil' ) );

	} );

	return { items, poles };

}

export function planHarbour( ctx ) {

	const a = planHome( ctx ), b = planPons( ctx );
	return { items: [ ...a.items, ...b.items ], poles: [ ...a.poles, ...b.poles ], home: a, pons: b };

}

// ---------------------------------------------------------------------------------------------- drawing

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _e = new Euler();

export class Harbour {

	constructor( { scene, assets, plan } ) {

		this.scene = scene;
		this.plan = plan;
		this.group = new Group();
		this.group.name = 'dress-harbour';
		this.sets = [];
		this.drawn = 0;
		this._last = new Vector3( 1e9, 0, 0 );
		this.ready = this._build( assets );

	}

	async _build( assets ) {

		const byId = new Map();
		for ( const it of this.plan.items ) {

			if ( ! byId.has( it.id ) ) byId.set( it.id, [] );
			byId.get( it.id ).push( it );

		}

		await Promise.all( [ ...byId ].map( async ( [ id, list ] ) => {

			const spec = MODELS[ id ];
			const glb = await assets.load( spec.file, { materials: ( info ) => modelMaterial( spec, info ) } );
			if ( ! glb ) return;
			const mats = list.map( ( it ) => {

				_e.set( 0, it.yaw, 0 );
				_q.setFromEuler( _e );
				return _m.compose( _p.set( it.x, it.y, it.z ), _q, _s.set( it.scale, it.scale * ( MODELS[ id ].sy || 1 ), it.scale ) ).toArray( [] );

			} );
			const meshes = glb.meshes.map( ( src ) => {

				const im = new InstancedMesh( src.geometry, src.material, list.length );
				im.name = 'harbour-' + id + '-' + src.material.name;
				im.frustumCulled = false;
				im.staticVelocity = true;
				im.castShadow = !! spec.shadow;
				im.receiveShadow = true;
				this.group.add( im );
				return im;

			} );
			this.sets.push( { id, list, mats, meshes, range: spec.range } );

		} ) );

		// slim posts for the bunting lines: one instanced cylinder
		if ( this.plan.poles.length ) {

			const geo = new CylinderGeometry( 0.045, 0.06, 1, 7 );
			geo.translate( 0, 0.5, 0 );
			const mat = new Material( { name: 'harbour-pole', color: 0x6a5a45, roughness: 0.92, underwaterLighting: 'lite' } );
			const im = new InstancedMesh( geo, mat, this.plan.poles.length );
			im.name = 'harbour-poles';
			im.frustumCulled = false;
			im.staticVelocity = true;
			im.castShadow = true;
			this.plan.poles.forEach( ( p, i ) => {

				_e.set( 0, 0, 0 );
				_q.setFromEuler( _e );
				_m.compose( _p.set( p.x, p.y0, p.z ), _q, _s.set( 1, p.y1 - p.y0, 1 ) );
				im.setMatrixAt( i, _m );

			} );
			im.count = this.plan.poles.length;
			this.group.add( im );
			this.poles = im;

		}

		this.scene.add( this.group );
		this._last.set( 1e9, 0, 0 );

	}

	// only the props within each model's range are in the instance buffers ( refilled when the camera has moved 5 m )
	update( cam ) {

		if ( ! this.sets.length ) return;
		if ( Math.hypot( cam.x - this._last.x, cam.z - this._last.z ) < 5 ) return;
		this._last.set( cam.x, 0, cam.z );
		let drawn = 0;
		for ( const set of this.sets ) {

			const r2 = set.range * set.range;
			let c = 0;
			for ( let i = 0; i < set.list.length; i ++ ) {

				const it = set.list[ i ];
				const dx = it.x - cam.x, dz = it.z - cam.z;
				if ( dx * dx + dz * dz > r2 ) continue;
				for ( const im of set.meshes ) im.instanceMatrix.array.set( set.mats[ i ], c * 16 );
				c ++;

			}

			for ( const im of set.meshes ) {

				im.count = c;
				im.instanceMatrix.needsUpdate = true;
				im.visible = c > 0;

			}

			drawn += c;

		}

		this.drawn = drawn;

	}

	dispose() {

		this.scene.remove( this.group );

	}

}
