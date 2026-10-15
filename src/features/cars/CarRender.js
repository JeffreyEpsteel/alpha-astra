// The cars' looks: every car of a kind is an instance (public/models/cars/<kind>.glb, tools/cars/build_cars.py), so the
// whole city's traffic costs a few draws per kind on screen: the body's paint (tinted per car), its trim and its lamps in
// three damage variants (whole; dented; crumpled, made here by pushing the shell in, more at the ends), and the four
// wheels (one instanced wheel per kind, steered and spun). The lamps glow at night (headlights, tail lights, the taxi
// sign) and the police beacons flash in a chase (uniforms of the kind's lamp material). Without a scene nothing loads.
//
//   const r = new CarRender( scene, { base } );   await r.ready;
//   r.draw( records, { night, beacon } )   record: { kind, x, y, z, quat: { x, y, z, w }, bump, color (hex), stage 0..4,
//                                                    lights, steer, spin, hidden }
//   r.dispose()

import { InstancedMesh, Matrix4, Quaternion, Vector3, Color, BufferGeometry, BufferAttribute, BoxGeometry } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { mergeGeometries } from '../../engine/geometry/BufferGeometryUtils.js';
import { LAYERS } from '../../core/SceneRenderer.js';
import { loadStaticGLB } from '../../world/boat/StaticGLB.js';
import { KINDS, KIND_IDS } from './CarData.js';

function defaultBase() {

	try {

		return ( import.meta.env && import.meta.env.BASE_URL ) || '/';

	} catch ( e ) {

		return '/';

	}

}

// the lamp cells' glow (night) and the police beacons (the atlas's blue / red cells: u 0..0.25, v 0.75..0.875 in glTF uv)
const LAMP_SURFACE = /* wgsl */`
	let beacon = step( 0.75, in.uv.y ) * step( in.uv.y, 0.875 ) * step( in.uv.x, 0.25 );
	let red = step( 0.125, in.uv.x );
	let flash = mix( mat.beaconA, mat.beaconB, red );
	s.emissive += s.albedo * ( mat.glow * ( 1.0 - beacon ) + beacon * ( flash * 7.0 + mat.glow * 0.4 ) );
`;

const CAPS = { sedan: 140, taxi: 60, police: 24, pickup: 70, van: 70, sports: 30, bus: 8 };
const PARTS = [ 'CarPaint', 'CarTrim', 'CarLamp', 'CarGlass', 'CarCabin' ];
const DENT = [ 0, 0.07, 0.17 ]; // m: how far the shell is pushed in per variant

const _m = new Matrix4(), _mw = new Matrix4(), _mb = new Matrix4(), _q = new Quaternion(), _qw = new Quaternion(), _p = new Vector3(), _s = new Vector3( 1, 1, 1 ), _c = new Color();
const _ax = new Vector3( 1, 0, 0 ), _ay = new Vector3( 0, 1, 0 );

// the damage variant of a stage
export const variantOf = ( stage ) => ( stage <= 0 ? 0 : stage <= 2 ? 1 : 2 );

// The authored trim atlas includes opaque glass. Split triangles, preserving the atlas on all real trim.
function trianglesWhere( geo, keep ) {

	const src = geo.index ? geo.index.array : Array.from( { length: geo.attributes.position.count }, ( _, i ) => i );
	const arrays = Object.fromEntries( Object.keys( geo.attributes ).map( ( k ) => [ k, [] ] ) );
	for ( let i = 0; i < src.length; i += 3 ) {

		const ids = [ src[ i ], src[ i + 1 ], src[ i + 2 ] ];
		if ( ! keep( ids ) ) continue;
		for ( const k in arrays ) for ( const j of ids ) {

			const a = geo.attributes[ k ];
			for ( let c = 0; c < a.itemSize; c ++ ) arrays[ k ].push( a.array[ j * a.itemSize + c ] );

		}

	}
	const out = new BufferGeometry();
	for ( const k in arrays ) out.setAttribute( k, new BufferAttribute( new Float32Array( arrays[ k ] ), geo.attributes[ k ].itemSize ) );
	out.computeBoundingBox(); out.computeBoundingSphere();
	return out;

}

export function splitCarTrimGeometry( geo ) {

	const uv = geo.attributes.uv;
	const isGlass = ( ids ) => {

		const u = ids.reduce( ( s, i ) => s + uv.array[ i * 2 ], 0 ) / 3;
		const v = ids.reduce( ( s, i ) => s + uv.array[ i * 2 + 1 ], 0 ) / 3;
		const col = Math.floor( u * 8 ), row = Math.floor( ( 1 - v ) * 8 );
		return col === 0 && row === 0 || col === 3 && row === 2;

	};
	return { trim: trianglesWhere( geo, ( ids ) => ! isGlass( ids ) ), glass: trianglesWhere( geo, isGlass ) };

}

export function carCabinBounds( spec, glassGeometry ) {

	const bounds = glassGeometry.boundingBox.clone();
	// Bus doors use the window atlas cell down to the steps, below the actual window belt.
	bounds.min.y = Math.max( bounds.min.y, spec.hgt * 0.4 );
	return bounds;

}

export function openCarCabin( geo, bounds ) {

	const p = geo.attributes.position.array, n = geo.attributes.normal.array;
	const src = geo.index ? geo.index.array : Array.from( { length: geo.attributes.position.count }, ( _, i ) => i );
	const arrays = Object.fromEntries( Object.keys( geo.attributes ).map( ( k ) => [ k, [] ] ) );
	const vertex = ( i ) => Object.fromEntries( Object.entries( geo.attributes ).map( ( [ k, a ] ) => [ k, Array.from( a.array.slice( i * a.itemSize, ( i + 1 ) * a.itemSize ) ) ] ) );
	const clip = ( poly, axis, edge, sign ) => {

		const out = [];
		for ( let i = 0; i < poly.length; i ++ ) {

			const a = poly[ i ], b = poly[ ( i + 1 ) % poly.length ];
			const da = ( a.position[ axis ] - edge ) * sign, db = ( b.position[ axis ] - edge ) * sign;
			if ( da >= 0 ) out.push( a );
			if ( ( da >= 0 ) !== ( db >= 0 ) ) {

				const t = da / ( da - db );
				out.push( Object.fromEntries( Object.keys( arrays ).map( ( k ) => [ k, a[ k ].map( ( v, j ) => v + ( b[ k ][ j ] - v ) * t ) ] ) ) );

			}

		}
		return out;

	};
	const emit = ( poly ) => {

		for ( let j = 1; j + 1 < poly.length; j ++ ) for ( const v of [ poly[ 0 ], poly[ j ], poly[ j + 1 ] ] ) for ( const k in arrays ) arrays[ k ].push( ...v[ k ] );

	};
	for ( let i = 0; i < src.length; i += 3 ) {

		const ids = [ src[ i ], src[ i + 1 ], src[ i + 2 ] ];
		const y = ids.reduce( ( s, i ) => s + p[ i * 3 + 1 ], 0 ) / 3;
		const up = ids.every( ( i ) => n[ i * 3 + 1 ] > 0.65 );
		let poly = ids.map( vertex );
		if ( ! up || y >= bounds.min.y + 0.1 || y <= bounds.min.y - 0.2 ) { emit( poly ); continue; }
		// Subtract the greenhouse opening, clipping large body-cap triangles rather than deleting the bonnet.
		for ( const [ axis, edge, sign ] of [ [ 0, bounds.min.x + 0.04, 1 ], [ 0, bounds.max.x - 0.04, - 1 ], [ 2, bounds.min.z, 1 ], [ 2, bounds.max.z, - 1 ] ] ) {

			emit( clip( poly, axis, edge, - sign ) );
			poly = clip( poly, axis, edge, sign );
			if ( ! poly.length ) break;

		}

	}
	const out = new BufferGeometry();
	for ( const k in arrays ) out.setAttribute( k, new BufferAttribute( new Float32Array( arrays[ k ] ), geo.attributes[ k ].itemSize ) );
	out.computeBoundingBox(); out.computeBoundingSphere();
	return out;

}

export function carCabinGeometry( spec, bounds ) {

	const parts = [];
	const box = ( x, y, z, w, h, d, rgb ) => {

		const g = new BoxGeometry( w, h, d ).translate( x, y, z );
		const c = new Float32Array( g.attributes.position.count * 3 );
		for ( let i = 0; i < c.length; i += 3 ) c.set( rgb, i );
		g.setAttribute( 'color', new BufferAttribute( c, 3 ) );
		parts.push( g );

	};
	const w = spec.wid - 0.28, z0 = bounds.min.z + 0.12, z1 = bounds.max.z - 0.12;
	const belt = Math.max( spec.seat[ 1 ] + 0.35, bounds.min.y ), floor = belt - 0.55;
	const seatY = floor + 0.22, seatZ = spec.eye[ 2 ] - 0.18;
	const dashY = spec.eye[ 1 ] - 0.28, dashZ = z1 - 0.18;
	box( 0, floor, ( z0 + z1 ) / 2, w, 0.08, z1 - z0, [ 0.11, 0.12, 0.13 ] );
	for ( const x of [ spec.seat[ 0 ], - spec.seat[ 0 ] ] ) {

		box( x, seatY, seatZ, 0.5, 0.16, 0.48, [ 0.32, 0.25, 0.18 ] );
		box( x, seatY + 0.22, seatZ - 0.27, 0.5, 0.5, 0.13, [ 0.27, 0.21, 0.15 ] );

	}
	box( 0, dashY, dashZ, w - 0.1, 0.16, 0.3, [ 0.12, 0.14, 0.16 ] );
	// A legible instrument binnacle and steering rim below the driver's sight line.
	box( spec.eye[ 0 ], dashY + 0.06, dashZ - 0.17, 0.35, 0.08, 0.025, [ 0.18, 0.43, 0.34 ] );
	for ( const x of [ - 0.15, 0.15 ] ) box( spec.eye[ 0 ] + x, dashY - 0.08, dashZ - 0.32, 0.035, 0.2, 0.035, [ 0.2, 0.21, 0.22 ] );
	for ( const y of [ - 0.18, 0.02 ] ) box( spec.eye[ 0 ], dashY + y, dashZ - 0.32, 0.33, 0.035, 0.035, [ 0.2, 0.21, 0.22 ] );
	for ( const side of [ - 1, 1 ] ) box( side * w / 2, ( floor + belt ) / 2, ( z0 + z1 ) / 2, 0.06, belt - floor, z1 - z0, [ 0.23, 0.24, 0.25 ] );
	const out = mergeGeometries( parts );
	for ( const p of parts ) p.dispose();
	out.computeBoundingBox(); out.computeBoundingSphere();
	return out;

}

// a dented copy of a shell (positions hashed so the copies of a vertex on every face move together)
export function dentGeometry( geo, amount, spec ) {

	const g = geo.clone();
	const pos = g.attributes.position, a = pos.array;
	const L = spec.len / 2, H = spec.hgt;
	for ( let i = 0; i < pos.count; i ++ ) {

		const x = a[ i * 3 ], y = a[ i * 3 + 1 ], z = a[ i * 3 + 2 ];
		const k = Math.round( x * 50 ) * 73856093 ^ Math.round( y * 50 ) * 19349663 ^ Math.round( z * 50 ) * 83492791;
		const n = ( ( k >>> 0 ) % 1000 ) / 1000;
		const ends = Math.min( 1, Math.max( 0, ( Math.abs( z ) / L - 0.45 ) / 0.55 ) );
		const m = amount * ( 0.25 + 0.75 * n ) * ( 0.35 + 0.65 * ends );
		// in toward the middle of the car (a crumple, not a shrink): mostly across and along
		const cx = x, cy = y - H * 0.45, cz = z * 0.35;
		const d = Math.hypot( cx, cy, cz ) || 1;
		a[ i * 3 ] -= cx / d * m;
		a[ i * 3 + 1 ] -= cy / d * m * ( y > H * 0.7 ? 1.6 : 0.6 );
		a[ i * 3 + 2 ] -= cz / d * m;

	}

	pos.needsUpdate = true;
	if ( g.computeVertexNormals ) g.computeVertexNormals();
	return g;

}

export class CarRender {

	constructor( scene, { base = defaultBase(), kinds = KIND_IDS, caps = CAPS, shadows = true } = {} ) {

		this.scene = scene;
		this.base = base.endsWith( '/' ) ? base : base + '/';
		this.sets = new Map(); // kind -> { parts: [ [ InstancedMesh x3 ] x PARTS ], wheel, wheelPos, n: [ per variant ], nw }
		this.loaded = [];
		this.derived = [];
		this.cabinMats = [];
		this.lampMats = new Map();
		this.caps = caps;
		this.shadows = shadows;
		this.drawn = 0;
		this.ready = Promise.all( kinds.map( ( k ) => this._load( k ).catch( ( e ) => {

			console.warn( 'cars: could not load ' + k, e && e.message ? e.message : e );
			return null;

		} ) ) );

	}

	async _load( kind ) {

		const K = KINDS[ kind ];
		const glb = await loadStaticGLB( this.base + 'models/' + K.glb, {
			prefix: 'car-',
			shadows: false,
			materials: ( info ) => {

				if ( /CarLamp/.test( info.name ) ) return { uniforms: { glow: [ 'f32', 0 ], beaconA: [ 'f32', 0 ], beaconB: [ 'f32', 0 ] }, surface: LAMP_SURFACE, roughness: 0.25 };
				if ( /CarPaint/.test( info.name ) ) return { roughness: 0.32, metalness: 0.2, color: new Color( 1, 1, 1 ), side: 'double' };
				return {};

			},
		} );
		this.loaded.push( glb );
		const cap = this.caps[ kind ] || 40;
		const set = { kind, parts: [], wheel: null, wheelPos: [], n: [ 0, 0, 0 ], nw: 0, cap };
		const trimSrc = glb.meshes.find( ( m ) => m.material.name === 'car-CarTrim' );
		const extras = new Map();
		if ( trimSrc ) {

			const split = splitCarTrimGeometry( trimSrc.geometry );
			this.derived.push( split.trim, split.glass );
			extras.set( 'CarTrim', { geometry: split.trim, material: trimSrc.material } );
			if ( split.glass.attributes.position.count ) {

				const glassMat = new Material( { name: 'car-clearGlass', color: new Color( 0.45, 0.57, 0.65 ), transparent: true, opacity: 0.16, depthWrite: false, side: 'double', roughness: 0.16, metalness: 0, velocityWeight: 0 } );
				const cabinMat = new Material( { name: 'car-cabin', vertexColors: true, roughness: 0.9, side: 'double', surface: 's.emissive += s.albedo * 0.025;' } );
				this.cabinMats.push( glassMat, cabinMat );
				extras.set( 'CarGlass', { geometry: split.glass, material: glassMat } );
				const bounds = carCabinBounds( K, split.glass );
				const cabin = carCabinGeometry( K, bounds );
				this.derived.push( cabin );
				extras.set( 'CarCabin', { geometry: cabin, material: cabinMat } );
				const paint = glb.meshes.find( ( m ) => m.material.name === 'car-CarPaint' );
				if ( paint ) {

					const open = openCarCabin( paint.geometry, bounds );
					this.derived.push( open );
					extras.set( 'CarPaint', { geometry: open, material: paint.material } );

				}

			}

		}
		const wheels = [];
		for ( const part of PARTS ) {

			const src = extras.get( part ) || glb.meshes.find( ( m ) => m.name === 'car-' + part || m.material.name === 'car-' + part );
			if ( ! src ) { set.parts.push( null ); continue; }
			if ( part === 'CarLamp' ) this.lampMats.set( kind, src.material );
			const variants = DENT.map( ( d, v ) => {

				const geo = v === 0 ? src.geometry : dentGeometry( src.geometry, d, K );
				const im = new InstancedMesh( geo, src.material, cap );
				im.name = `car-${ kind }-${ part }-${ v }`;
				if ( part === 'CarGlass' ) { im.layers.set( LAYERS.TRANSPARENT ); im.renderOrder = 1; }
				im.frustumCulled = false;
				im.castShadow = this.shadows && part === 'CarPaint';
				im.receiveShadow = true;
				im.count = 0;
				im.visible = false;
				im.setColorAt( 0, _c.setRGB( 1, 1, 1 ) );
				this.scene.add( im );
				return im;

			} );
			set.parts.push( variants );

		}

		for ( const m of glb.meshes ) if ( /CarWheel/.test( m.name ) ) wheels.push( m );
		if ( wheels.length ) {

			// one wheel geometry about its hub; the hubs' model points FL, FR, RL, RR (+X is the car's left, +Z the nose)
			const hubs = wheels.map( ( w ) => {

				w.geometry.computeBoundingBox();
				const b = w.geometry.boundingBox;
				return { mesh: w, x: ( b.min.x + b.max.x ) / 2, y: ( b.min.y + b.max.y ) / 2, z: ( b.min.z + b.max.z ) / 2 };

			} );
			const pick = ( sx, sz ) => hubs.find( ( h ) => Math.sign( h.x ) === sx && Math.sign( h.z ) === sz ) || hubs[ 0 ];
			set.wheelPos = [ pick( 1, 1 ), pick( - 1, 1 ), pick( 1, - 1 ), pick( - 1, - 1 ) ].map( ( h ) => [ h.x, h.y, h.z ] );
			const fl = pick( 1, 1 );
			const geo = fl.mesh.geometry.clone();
			geo.translate( - fl.x, - fl.y, - fl.z );
			const im = new InstancedMesh( geo, fl.mesh.material, cap * 4 );
			im.name = `car-${ kind }-wheels`;
			im.frustumCulled = false;
			im.castShadow = false;
			im.receiveShadow = true;
			im.count = 0;
			im.visible = false;
			this.scene.add( im );
			set.wheel = im;

		}

		this.sets.set( kind, set );
		return set;

	}

	// lamps: glow (night) and the beacons' two phases
	_lamps( night, beacon, time ) {

		for ( const [ kind, m ] of this.lampMats ) {

			const ph = Math.floor( time * 4 ) % 2;
			const on = kind === 'police' && beacon;
			const set = ( k, v ) => { if ( m.uniforms && m.uniforms[ k ] ) m.uniforms[ k ].value = v; };
			set( 'glow', night ? 2.2 : 0 );
			set( 'beaconA', on ? ( ph ? 1 : 0.05 ) : 0 );
			set( 'beaconB', on ? ( ph ? 0.05 : 1 ) : 0 );

		}

	}

	draw( list, { night = false, beacon = false, time = 0 } = {} ) {

		this._lamps( night, beacon, time );
		for ( const set of this.sets.values() ) { set.n[ 0 ] = set.n[ 1 ] = set.n[ 2 ] = 0; set.nw = 0; }
		let drawn = 0;
		for ( const r of list ) {

			if ( r.hidden ) continue;
			const set = this.sets.get( r.kind );
			if ( ! set ) continue;
			const v = variantOf( r.stage || 0 );
			const i = set.n[ v ];
			if ( i >= set.cap ) continue;
			set.n[ v ] ++;
			drawn ++;
			const q = r.quat;
			_q.set( q.x, q.y, q.z, q.w );
			_mb.compose( _p.set( r.x, r.y + ( r.bump || 0 ), r.z ), _q, _s.set( 1, 1, 1 ) );
			const wreck = ( r.stage || 0 ) >= 4;
			for ( let k = 0; k < PARTS.length; k ++ ) {

				const vs = set.parts[ k ];
				if ( ! vs ) continue;
				const im = PARTS[ k ] === 'CarLamp' ? vs[ 0 ] : vs[ v ];
				const idx = PARTS[ k ] === 'CarLamp' ? set.n[ 0 ] + set.n[ 1 ] + set.n[ 2 ] - 1 : i;
				im.setMatrixAt( idx, _mb );
				if ( k === 0 ) {

					if ( wreck ) _c.setRGB( 0.06, 0.055, 0.05 );
					else _c.setHex( r.color ?? 0xcccccc );
					// (the scorch of a burning car)
					if ( ! wreck && r.stage === 3 ) _c.multiplyScalar( 0.55 );
					im.setColorAt( idx, _c );

				} else if ( k === 1 ) im.setColorAt( idx, _c.setRGB( wreck ? 0.2 : 1, wreck ? 0.2 : 1, wreck ? 0.2 : 1 ) );
				else if ( k === 2 ) im.setColorAt( idx, wreck ? _c.setRGB( 0.1, 0.1, 0.1 ) : r.lights ? _c.setRGB( 1, 1, 1 ) : _c.setRGB( 0.42, 0.42, 0.42 ) );
				else im.setColorAt( idx, _c.setRGB( wreck ? 0.15 : 1, wreck ? 0.15 : 1, wreck ? 0.15 : 1 ) );

			}

			// the wheels: steered (front), spun, under the body
			if ( set.wheel && set.nw + 4 <= set.cap * 4 ) {

				for ( let w = 0; w < 4; w ++ ) {

					const hp = set.wheelPos[ w ];
					if ( ! hp ) continue;
					_qw.setFromAxisAngle( _ay, w < 2 ? ( r.steer || 0 ) : 0 );
					_q.setFromAxisAngle( _ax, r.spin || 0 );
					_qw.multiply( _q );
					_mw.compose( _p.set( hp[ 0 ], hp[ 1 ] - ( r.bump || 0 ), hp[ 2 ] ), _qw, _s.set( 1, 1, 1 ) );
					_m.multiplyMatrices( _mb, _mw );
					set.wheel.setMatrixAt( set.nw ++, _m );

				}

			}

		}

		for ( const set of this.sets.values() ) {

			const total = set.n[ 0 ] + set.n[ 1 ] + set.n[ 2 ];
			set.parts.forEach( ( vs, k ) => {

				if ( ! vs ) return;
				vs.forEach( ( im, v ) => {

					const n = PARTS[ k ] === 'CarLamp' ? ( v === 0 ? total : 0 ) : set.n[ v ];
					im.count = n;
					im.visible = n > 0;
					if ( n ) {

						im.instanceMatrix.needsUpdate = true;
						if ( im.instanceColor ) im.instanceColor.needsUpdate = true;

					}

				} );

			} );
			if ( set.wheel ) {

				set.wheel.count = set.nw;
				set.wheel.visible = set.nw > 0;
				if ( set.nw ) set.wheel.instanceMatrix.needsUpdate = true;

			}

		}

		this.drawn = drawn;
		return drawn;

	}

	// draws in use (instanced meshes with something to show)
	draws() {

		let n = 0;
		for ( const set of this.sets.values() ) {

			for ( const vs of set.parts ) if ( vs ) for ( const im of vs ) if ( im.visible ) n ++;
			if ( set.wheel && set.wheel.visible ) n ++;

		}

		return n;

	}

	dispose() {

		for ( const set of this.sets.values() ) {

			for ( const vs of set.parts ) if ( vs ) for ( const im of vs ) { this.scene.remove( im ); if ( im.geometry !== vs[ 0 ].geometry ) im.geometry.dispose && im.geometry.dispose(); }
			if ( set.wheel ) { this.scene.remove( set.wheel ); set.wheel.geometry.dispose && set.wheel.geometry.dispose(); }

		}

		for ( const g of this.loaded ) g && g.dispose && g.dispose();
		for ( const g of this.derived ) g.dispose();
		for ( const m of this.cabinMats ) m.dispose();
		this.derived.length = this.cabinMats.length = 0;
		this.sets.clear();

	}

}
