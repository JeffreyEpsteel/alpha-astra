import { InstancedMesh, Matrix4, Quaternion, Vector3, Euler, Color } from '../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, mat4 } from '../boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { mulberry32 } from '../../util/Noise.js';

// The towns' animals (wave 18B): dogs trotting about (one may tag along with the player for a while), cats sitting on
// porches and bolting from a running player, chickens pecking round the houses, goats grazing on the edge of town.
// Five draws for every animal of every town: one instanced body mesh per species (built from GeoKit boxes, white with
// dark details, tinted per animal) and one instanced mesh of all their legs (a unit leg hung from the hip, swung by
// the gait). Only the animals of towns near the viewer are simulated and drawn.
//
//   const a = new TownAnimals( { scene } );
//   a.addTown( id, { pens, animals: { dog, cat, chicken, goat }, free?( x, z ), ground( x, z ) } )
//   a.update( dt, viewer { x, z, speed, mode } | null, activeTownIds: Set )
//   a.list (plain state, the tests read it), a.dispose()

export const SPECIES = {
	dog: { legs: 4, hip: 0.36, legR: 0.035, len: 0.36, stride: 0.28, walk: 1.3, trot: 2.6, body: [ 0.42, 0.0, 0.22 ] },
	cat: { legs: 4, hip: 0.2, legR: 0.022, len: 0.2, stride: 0.16, walk: 0.55, trot: 3.2, body: [ 0.26, 0.0, 0.13 ] },
	chicken: { legs: 2, hip: 0.17, legR: 0.012, len: 0.17, stride: 0.1, walk: 0.5, trot: 1.6, body: [ 0, 0, 0 ] },
	goat: { legs: 4, hip: 0.5, legR: 0.04, len: 0.5, stride: 0.42, walk: 0.5, trot: 1.8, body: [ 0.5, 0.0, 0.26 ] },
};
const TINTS = {
	dog: [ [ 0.55, 0.38, 0.22 ], [ 0.92, 0.86, 0.72 ], [ 0.18, 0.16, 0.15 ], [ 0.8, 0.5, 0.25 ] ],
	cat: [ [ 0.95, 0.6, 0.3 ], [ 0.15, 0.14, 0.14 ], [ 0.6, 0.6, 0.62 ], [ 0.95, 0.93, 0.88 ] ],
	chicken: [ [ 1, 1, 1 ], [ 0.75, 0.45, 0.25 ], [ 0.95, 0.88, 0.7 ], [ 0.3, 0.25, 0.22 ] ],
	goat: [ [ 1, 1, 1 ], [ 0.6, 0.45, 0.32 ], [ 0.35, 0.3, 0.27 ], [ 0.92, 0.88, 0.8 ] ],
};

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _e = new Euler(), _c = new Color();
const _mh = new Matrix4(), _ml = new Matrix4();

// a body facing +z with its feet at y 0 (the legs are drawn separately); pale so the tint shows
function bodyGeometry( kind ) {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, { rough: 0.85, ...o } ) );
	const coat = { color: 0xf2efe8, pattern: PAT.cloth };
	const dark = { color: 0x1c1a18 };
	if ( kind === 'dog' ) {

		add( box( 0.22, 0.22, 0.56 ), { ...coat, matrix: mat4( 0, 0.46, 0 ) } );
		add( box( 0.17, 0.18, 0.2 ), { ...coat, matrix: mat4( 0, 0.6, 0.34, - 0.15, 0, 0 ) } );
		add( box( 0.1, 0.09, 0.13 ), { ...coat, matrix: mat4( 0, 0.56, 0.48 ) } );
		add( box( 0.05, 0.04, 0.03 ), { ...dark, matrix: mat4( 0, 0.58, 0.55 ) } );
		for ( const s of [ - 1, 1 ] ) {

			add( box( 0.05, 0.1, 0.03 ), { ...coat, matrix: mat4( s * 0.07, 0.72, 0.3, 0.2, 0, s * 0.3 ) } );
			add( box( 0.025, 0.025, 0.01 ), { ...dark, matrix: mat4( s * 0.05, 0.64, 0.44 ) } );

		}

		add( cylinder( 0.025, 0.015, 0.28, 6 ), { ...coat, matrix: mat4( 0, 0.6, - 0.36, - 0.7, 0, 0 ) } );

	} else if ( kind === 'cat' ) {

		add( box( 0.13, 0.13, 0.34 ), { ...coat, matrix: mat4( 0, 0.27, 0 ) } );
		add( sphere( 0.075, 10, 7 ), { ...coat, matrix: mat4( 0, 0.37, 0.2, 0, 0, 0, 1, 0.9, 1 ) } );
		for ( const s of [ - 1, 1 ] ) {

			add( cylinder( 0.0, 0.03, 0.06, 4 ), { ...coat, matrix: mat4( s * 0.04, 0.44, 0.2 ) } );
			add( box( 0.02, 0.015, 0.01 ), { color: 0x8fb04a, matrix: mat4( s * 0.03, 0.38, 0.27 ) } );

		}

		add( cylinder( 0.016, 0.012, 0.32, 6 ), { ...coat, matrix: mat4( 0, 0.4, - 0.22, - 0.45, 0, 0 ) } );

	} else if ( kind === 'chicken' ) {

		add( sphere( 0.1, 10, 7 ), { ...coat, matrix: mat4( 0, 0.27, 0, 0, 0, 0, 0.8, 0.85, 1.05 ) } );
		add( sphere( 0.05, 8, 6 ), { ...coat, matrix: mat4( 0, 0.4, 0.09 ) } );
		add( box( 0.015, 0.05, 0.05 ), { color: 0xc8281e, matrix: mat4( 0, 0.46, 0.09 ) } );
		add( box( 0.012, 0.03, 0.02 ), { color: 0xc8281e, matrix: mat4( 0, 0.36, 0.13 ) } );
		add( cylinder( 0.0, 0.016, 0.04, 4 ), { color: 0xe0a828, matrix: mat4( 0, 0.4, 0.15, Math.PI / 2, 0, 0 ) } );
		add( box( 0.08, 0.1, 0.06 ), { ...coat, matrix: mat4( 0, 0.33, - 0.11, - 0.5, 0, 0 ) } );

	} else {

		add( box( 0.26, 0.28, 0.66 ), { ...coat, matrix: mat4( 0, 0.66, 0 ) } );
		add( box( 0.12, 0.26, 0.12 ), { ...coat, matrix: mat4( 0, 0.85, 0.34, 0.5, 0, 0 ) } );
		add( box( 0.13, 0.14, 0.24 ), { ...coat, matrix: mat4( 0, 0.96, 0.46, 0.35, 0, 0 ) } );
		for ( const s of [ - 1, 1 ] ) {

			add( cylinder( 0.012, 0.022, 0.16, 5 ), { color: 0x6a5c4a, matrix: mat4( s * 0.04, 1.1, 0.38, - 0.6, 0, s * 0.25 ) } );
			add( box( 0.08, 0.03, 0.04 ), { ...coat, matrix: mat4( s * 0.09, 1.0, 0.4, 0, 0, s * 0.5 ) } );
			add( box( 0.02, 0.02, 0.01 ), { ...dark, matrix: mat4( s * 0.05, 0.99, 0.55 ) } );

		}

		add( box( 0.04, 0.08, 0.03 ), { color: 0xd8d2c4, matrix: mat4( 0, 0.84, 0.56 ) } );
		add( box( 0.06, 0.08, 0.04 ), { ...coat, matrix: mat4( 0, 0.74, - 0.35, - 0.8, 0, 0 ) } );

	}

	return mergePrepared( P );

}

function legGeometry() {

	// radius 1, length 1, hung from y 0 (the hip) down to -1; a darker hoof / paw band at the foot
	const P = [ prepare( cylinder( 1, 0.85, 1, 6 ), { color: 0xd8d4cc, rough: 0.9, matrix: mat4( 0, - 0.5, 0 ) } ) ];
	P.push( prepare( cylinder( 0.88, 0.9, 0.1, 6 ), { color: 0x4a4038, rough: 0.8, matrix: mat4( 0, - 0.95, 0 ) } ) );
	return mergePrepared( P );

}

export class TownAnimals {

	constructor( { scene = null, seed = 1818, render = true } = {} ) {

		this.scene = scene;
		this.rand = mulberry32( seed );
		this.list = [];
		this.towns = new Map();
		this.meshes = null;
		this.render = render && !! scene;
		this.time = 0;

	}

	addTown( id, { pens = {}, animals = {}, free = null, ground = null } ) {

		const R = this.rand;
		const town = { id, free, ground };
		this.towns.set( id, town );
		const penOf = { dog: pens.dogs, cat: pens.cats, chicken: pens.chickens, goat: pens.goats };
		for ( const [ kind, n ] of Object.entries( animals ) ) {

			const ps = penOf[ kind ] || [];
			if ( ! ps.length ) continue;
			for ( let i = 0; i < n; i ++ ) {

				const pen = ps[ i % ps.length ];
				const a = R() * Math.PI * 2, r = Math.sqrt( R() ) * pen.r * 0.8;
				const tint = TINTS[ kind ][ Math.floor( R() * TINTS[ kind ].length ) ];
				this.list.push( {
					kind, town: id, pen, x: pen.x + Math.cos( a ) * r, z: pen.z + Math.sin( a ) * r, y: 0, heading: R() * Math.PI * 2,
					speed: 0, phase: R() * 10, state: 'idle', t: R() * 4, tx: 0, tz: 0, pitch: 0, follow: 0, tint, scale: kind === 'chicken' ? 0.9 + R() * 0.2 : 0.85 + R() * 0.3,
				} );

			}

		}

		if ( this.meshes ) this._buildMeshes(); // capacity grows with the towns

	}

	_buildMeshes() {

		if ( ! this.render ) return;
		if ( this.meshes ) for ( const m of [ ...Object.values( this.meshes.body ), this.meshes.legs ] ) { this.scene.remove( m ); m.dispose(); }
		const mat = this.material || ( this.material = createPropMaterial( 'townAnimals' ) );
		const body = {};
		let legs = 0;
		for ( const kind of Object.keys( SPECIES ) ) {

			const n = Math.max( 1, this.list.filter( ( a ) => a.kind === kind ).length );
			legs += n * SPECIES[ kind ].legs;
			const m = new InstancedMesh( this._geo( kind ), mat, n );
			m.name = 'townAnimals-' + kind;
			m.frustumCulled = false;
			m.castShadow = true;
			m.count = 0;
			m.setColorAt( 0, _c.setRGB( 1, 1, 1 ) );
			this.scene.add( m );
			body[ kind ] = m;

		}

		const lm = new InstancedMesh( this._legGeo || ( this._legGeo = legGeometry() ), mat, Math.max( 1, legs ) );
		lm.name = 'townAnimals-legs';
		lm.frustumCulled = false;
		lm.castShadow = false;
		lm.count = 0;
		lm.setColorAt( 0, _c.setRGB( 1, 1, 1 ) );
		this.scene.add( lm );
		this.meshes = { body, legs: lm };

	}

	_geo( kind ) {

		this._geos = this._geos || {};
		return this._geos[ kind ] || ( this._geos[ kind ] = bodyGeometry( kind ) );

	}

	_free( t, x, z ) {

		return ! t.free || t.free( x, z );

	}

	update( dt, viewer = null, active = null ) {

		dt = Math.min( Math.max( dt || 0, 0 ), 0.1 );
		this.time += dt;
		if ( this.render && ! this.meshes && this.list.length ) this._buildMeshes();
		const R = this.rand;
		const counts = this.meshes ? ( this._counts || ( this._counts = {} ) ) : null;
		if ( counts ) for ( const k in SPECIES ) counts[ k ] = 0;
		let legN = 0;
		for ( const a of this.list ) {

			if ( active && ! active.has( a.town ) ) continue;
			const town = this.towns.get( a.town );
			if ( viewer && ( a.x - viewer.x ) ** 2 + ( a.z - viewer.z ) ** 2 > 160 * 160 ) continue;
			this._step( a, town, dt, viewer, R );
			if ( town.ground ) a.y = town.ground( a.x, a.z );
			if ( counts ) legN = this._draw( a, counts, legN );

		}

		if ( this.meshes ) {

			for ( const [ k, m ] of Object.entries( this.meshes.body ) ) {

				m.count = counts[ k ];
				m.instanceMatrix.needsUpdate = true;
				if ( m.instanceColor ) m.instanceColor.needsUpdate = true;
				m.visible = counts[ k ] > 0;

			}

			const lm = this.meshes.legs;
			lm.count = legN;
			lm.instanceMatrix.needsUpdate = true;
			if ( lm.instanceColor ) lm.instanceColor.needsUpdate = true;
			lm.visible = legN > 0;

		}

	}

	_step( a, town, dt, viewer, R ) {

		const S = SPECIES[ a.kind ];
		a.t -= dt;
		const vd = viewer ? Math.hypot( viewer.x - a.x, viewer.z - a.z ) : Infinity;
		const running = viewer && viewer.mode === 'walk' && ( viewer.speed || 0 ) > 3;
		// a cat (or a chicken) bolts from someone running at it
		if ( ( a.kind === 'cat' || a.kind === 'chicken' ) && vd < ( running ? 4 : 1.6 ) && a.state !== 'flee' ) {

			a.state = 'flee';
			a.t = 1.2 + R();
			const d = vd || 1;
			a.tx = a.x + ( a.x - viewer.x ) / d * 5; a.tz = a.z + ( a.z - viewer.z ) / d * 5;

		}

		// a dog takes to the player for a while
		if ( a.kind === 'dog' && viewer && viewer.mode === 'walk' && vd < 7 && a.state !== 'follow' && a.follow <= 0 && R() < dt * 0.3 ) {

			a.state = 'follow';
			a.t = 15 + R() * 20;

		}

		if ( a.follow > 0 ) a.follow -= dt;
		let speed = 0;
		if ( a.state === 'follow' ) {

			if ( ! viewer || a.t <= 0 || Math.hypot( a.x - a.pen.x, a.z - a.pen.z ) > a.pen.r + 30 ) { a.state = 'walk'; a.follow = 40; a.tx = a.pen.x; a.tz = a.pen.z; a.t = 20; }
			else {

				// heel at ~2 m, a little to the side
				const side = Math.sin( this.time * 0.3 + a.phase ) * 1.2;
				a.tx = viewer.x + side; a.tz = viewer.z + 1.4;
				speed = vd > 2.4 ? Math.min( S.trot, 0.8 + ( vd - 2 ) * 1.2 ) : 0;

			}

		} else if ( a.state === 'flee' ) {

			speed = S.trot;
			if ( a.t <= 0 ) { a.state = 'idle'; a.t = 2 + R() * 3; }

		} else if ( a.state === 'walk' ) {

			speed = S.walk * ( a.kind === 'dog' ? 1 : 1 );
			if ( Math.hypot( a.tx - a.x, a.tz - a.z ) < 0.25 || a.t <= 0 ) {

				a.state = a.kind === 'chicken' ? 'peck' : a.kind === 'goat' ? 'graze' : a.kind === 'cat' ? ( R() < 0.6 ? 'sit' : 'idle' ) : 'idle';
				a.t = a.kind === 'cat' ? 8 + R() * 20 : a.kind === 'goat' ? 6 + R() * 10 : 1.5 + R() * 3;

			}

		} else if ( a.t <= 0 ) {

			// idle / peck / graze / sit: off somewhere else in the pen
			const ang = R() * Math.PI * 2, r = Math.sqrt( R() ) * a.pen.r;
			a.tx = a.pen.x + Math.cos( ang ) * r; a.tz = a.pen.z + Math.sin( ang ) * r;
			a.state = 'walk';
			a.t = 12;

		}

		if ( speed > 0 ) {

			const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot( dx, dz );
			if ( d > 0.05 ) {

				const want = Math.atan2( dx, dz );
				let dh = want - a.heading;
				dh = Math.atan2( Math.sin( dh ), Math.cos( dh ) );
				a.heading += dh * Math.min( 1, dt * 6 );
				const s = Math.min( d, speed * dt );
				const nx = a.x + Math.sin( a.heading ) * s, nz = a.z + Math.cos( a.heading ) * s;
				if ( this._free( town, nx, nz ) ) { a.x = nx; a.z = nz; } else { a.state = 'idle'; a.t = 0.5 + R(); speed = 0; }

			}

		}

		a.speed += ( speed - a.speed ) * Math.min( 1, dt * 8 );
		a.phase += dt * a.speed / Math.max( 0.05, S.stride ) * 1.6;
		const pitchWant = a.state === 'peck' ? ( Math.sin( this.time * 9 + a.phase ) > 0.3 ? 0.55 : 0.1 ) : a.state === 'graze' ? 0.3 : a.state === 'sit' ? - 0.35 : 0;
		a.pitch += ( pitchWant - a.pitch ) * Math.min( 1, dt * 10 );

	}

	_draw( a, counts, legN ) {

		const S = SPECIES[ a.kind ];
		const sc = a.scale;
		const m = this.meshes.body[ a.kind ];
		const i = counts[ a.kind ] ++;
		if ( i >= m.instanceMatrix.count ) return legN;
		const bob = Math.abs( Math.sin( a.phase ) ) * 0.02 * Math.min( 1, a.speed ) * sc;
		const sit = a.state === 'sit' ? - 0.08 * sc : 0;
		// a seated cat tips back on its haunches; pecking and grazing pitch forward about the hips
		_e.set( a.pitch, a.heading, 0, 'YXZ' );
		_q.setFromEuler( _e );
		_m.compose( _p.set( a.x, a.y + bob + sit, a.z ), _q, _s.set( sc, sc, sc ) );
		m.setMatrixAt( i, _m );
		m.setColorAt( i, _c.setRGB( a.tint[ 0 ], a.tint[ 1 ], a.tint[ 2 ] ) );
		const lm = this.meshes.legs;
		const H = S.body;
		for ( let k = 0; k < S.legs; k ++ ) {

			if ( legN >= lm.instanceMatrix.count ) break;
			const side = k % 2 ? 1 : - 1, front = k < 2 ? 1 : - 1;
			const lx = side * ( a.kind === 'chicken' ? 0.04 : H[ 2 ] * 0.35 ), lz = a.kind === 'chicken' ? 0 : front * H[ 0 ] * 0.5;
			const swing = Math.sin( a.phase + ( k === 0 || k === 3 ? 0 : Math.PI ) ) * 0.55 * Math.min( 1, a.speed / Math.max( 0.1, S.walk ) );
			const fold = a.state === 'sit' && k >= 2 ? - 1.2 : a.state === 'sit' ? 0.2 : 0;
			// hip in the body frame -> world, then the leg's own swing about its local x
			_e.set( a.pitch, a.heading, 0, 'YXZ' );
			_q.setFromEuler( _e );
			_mh.compose( _p.set( a.x, a.y + bob + sit, a.z ), _q, _s.set( sc, sc, sc ) );
			_ml.makeRotationX( swing + fold ).setPosition( lx, S.hip, lz );
			_m.multiplyMatrices( _mh, _ml );
			_m.scale( _s.set( S.legR, S.len, S.legR ) );
			lm.setMatrixAt( legN, _m );
			lm.setColorAt( legN, _c.setRGB( a.tint[ 0 ] * 0.85, a.tint[ 1 ] * 0.85, a.tint[ 2 ] * 0.85 ) );
			legN ++;

		}

		return legN;

	}

	dispose() {

		if ( this.meshes && this.scene ) for ( const m of [ ...Object.values( this.meshes.body ), this.meshes.legs ] ) { this.scene.remove( m ); m.dispose(); }
		this.meshes = null;
		this.list.length = 0;

	}

}
