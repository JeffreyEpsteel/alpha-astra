// The VFX recipes (no GPU here: they only fill the particle pool, src/features/vfx/VfxPool.js, which the renderer
// src/fx/VfxParticles.js uploads and draws). Plain JS so the node test can drive every effect.
//
//   const sys = new VfxSystem( { env } );     env: { seaLevel(), groundAt( x, z ), wind( out ) -> out { x, z } (m/s),
//                                               camera() -> { x, y, z } | null, spray: Spray | null }
//   sys.splash / spray / smoke / splinters / flash / debris / dust / bubbles / explosion / muzzle ( x, y, z, strength, ... )
//   sys.fire( id, x, y, z, strength, vx?, vz? ) / sys.stopFire( id )      persistent emitters (call again to move them)
//   sys.sinking( id, x, z, size )                                         a hull going down: bubbles and foam for a while
//   sys.trackShips( ships )                                               naval ships: burning under 35 % hull, sinking
//   sys.update( dt )                                                      the clock, the fires, the lights
//   sys.setQuality( 'low' | 'high' )                                      fewer particles and a smaller budget on low
//   sys.lights                                                            point lights for LocalLights (flashes, fires)
//
// strength: 1 = a cannonball-sized event (a 6-pounder hit, a ball into the sea); counts and sizes follow it.
// A call is dropped when the same kind of effect already started within DEDUP_R metres in the last DEDUP_T seconds:
// a feature may call the API and emit the matching event (cannonFired, cannonballImpact...) and it shows once.

import { VfxPool, LOOK, ORIENT, FLOOR } from './VfxPool.js';
import { SPRITE } from '../../fx/VfxAtlas.js';
import { Vector3 } from '../../engine/math/Vector3.js';
import { Color } from '../../engine/math/Color.js';

export const BUDGET = { high: 4000, low: 1600 };
export const DEDUP_T = 0.1; // s
export const DEDUP_R = 0.6; // m
const QUALITY_SCALE = { high: 1, low: 0.45 };
const MAX_FIRES = 16;
const MAX_SINKS = 6;
const G = 9.81;
const SPRAY_DROPLET = 0, SPRAY_SPRAY = 3; // Spray.js kinds

const TYPES = [ 'splash', 'spray', 'smoke', 'splinters', 'flash', 'debris', 'dust', 'bubbles', 'explosion' ];
const T = Object.fromEntries( TYPES.map( ( t, i ) => [ t, i ] ) );

// albedos (linear) and emissive radiances (scene units: the sun is ~11, a sunlit white wall ~3.5)
const C = {
	gunSmoke: [ 0.6, 0.58, 0.55 ],
	fireSmoke: [ 0.07, 0.065, 0.06 ],
	smoke: [ 0.32, 0.31, 0.3 ],
	sand: [ 0.56, 0.48, 0.37 ],
	dirt: [ 0.33, 0.27, 0.2 ],
	water: [ 0.9, 0.93, 0.95 ],
	flash: [ 1.0, 0.74, 0.42 ],
	flame: [ 1.0, 0.52, 0.17 ],
	ember: [ 1.0, 0.45, 0.12 ],
};

// debris palettes per kind: [ sprite, [ albedo... ] ]
const DEBRIS = {
	wood: [ SPRITE.SPLINTER, [ [ 0.45, 0.3, 0.16 ], [ 0.6, 0.46, 0.28 ], [ 0.3, 0.2, 0.11 ] ] ],
	stone: [ SPRITE.CHUNK, [ [ 0.42, 0.41, 0.39 ], [ 0.55, 0.53, 0.5 ], [ 0.3, 0.29, 0.28 ] ] ],
	dirt: [ SPRITE.CHUNK, [ [ 0.33, 0.27, 0.2 ], [ 0.42, 0.35, 0.26 ], [ 0.25, 0.2, 0.15 ] ] ],
	metal: [ SPRITE.CHUNK, [ [ 0.22, 0.22, 0.23 ], [ 0.35, 0.33, 0.3 ], [ 0.15, 0.15, 0.16 ] ] ],
	straw: [ SPRITE.SPLINTER, [ [ 0.7, 0.6, 0.35 ], [ 0.55, 0.45, 0.25 ], [ 0.8, 0.7, 0.45 ] ] ],
};
DEBRIS.timber = DEBRIS.wood; DEBRIS.crate = DEBRIS.wood; DEBRIS.barrel = DEBRIS.wood; DEBRIS.rock = DEBRIS.stone; DEBRIS.earth = DEBRIS.dirt;

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

export class VfxSystem {

	constructor( { env = {}, capacity = 4096, quality = 'high', seed = 12345 } = {} ) {

		this.env = env;
		this.pool = new VfxPool( capacity );
		this._seed = seed >>> 0;
		this.scale = 1;
		this.quality = '';
		this.setQuality( quality );
		this.wind = { x: 0, z: 0 };
		this.sea = 0;
		this.counts = Object.fromEntries( TYPES.map( ( t ) => [ t, 0 ] ) ); // started effects (tests, debug)
		this.deduped = 0;
		// recent effects for the de-duplication: type, x, y, z, time
		this._recent = new Float32Array( 48 * 5 ).fill( - 1e9 );
		this._recentI = 0;
		this.fires = [];
		for ( let i = 0; i < MAX_FIRES; i ++ ) this.fires.push( { on: false, id: null, x: 0, y: 0, z: 0, s: 1, vx: 0, vz: 0, accF: 0, accS: 0, accE: 0, t: 0, seen: 0, ship: false } );
		this.sinks = [];
		for ( let i = 0; i < MAX_SINKS; i ++ ) this.sinks.push( { on: false, id: null, x: 0, z: 0, size: 1, t: 0, next: 0 } );
		this._frame = 0;
		this._v = { x: 0, y: 0, z: 0 };
		this._p = { x: 0, y: 0, z: 0 };
		this._q = { x: 0, y: 0, z: 0 };
		this._sprayOpts = { spread: 1, jitter: 0.2, life: 1.6, sizeJitter: 0.5 };
		// point lights (LocalLights sources): two for flashes, two for the nearest fires; disabled when idle
		this.lights = [];
		for ( let i = 0; i < 4; i ++ ) {

			this.lights.push( {
				position: new Vector3(), color: new Color( 1, 0.6, 0.3 ), intensity: 0, range: 14, kind: 'vfx', enabled: false,
				flicker: i >= 2 ? 0.25 : 0, peak: 0, age: 0, dur: 0, fire: null,
			} );

		}

	}

	setQuality( q ) {

		q = q === 'low' ? 'low' : 'high';
		if ( q === this.quality ) return;
		this.quality = q;
		this.scale = QUALITY_SCALE[ q ];
		this.pool.setLimit( Math.min( BUDGET[ q ], this.pool.capacity ) );

	}

	get live() {

		return this.pool.live;

	}

	// ---------------------------------------------------------------- helpers

	rand() {

		// mulberry32
		let t = ( this._seed = ( this._seed + 0x6D2B79F5 ) >>> 0 );
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	}

	_r( a, b ) {

		return a + ( b - a ) * this.rand();

	}

	// a count scaled by the quality, rounded stochastically so small counts keep their average
	_n( c ) {

		return Math.floor( c * this.scale + this.rand() );

	}

	_floorAt( x, z ) {

		const g = this.env.groundAt ? this.env.groundAt( x, z ) : - Infinity;
		return Math.max( this.sea, Number.isFinite( g ) ? g : - Infinity );

	}

	_onLand( x, z ) {

		const g = this.env.groundAt ? this.env.groundAt( x, z ) : - Infinity;
		return Number.isFinite( g ) && g > this.sea + 0.05;

	}

	// true when the same kind of effect started here a moment ago (then it is not started again)
	_dup( type, x, y, z ) {

		const R = this._recent, now = this.pool.now, r2 = DEDUP_R * DEDUP_R;
		for ( let i = 0; i < R.length; i += 5 ) {

			if ( R[ i ] !== type || now - R[ i + 4 ] > DEDUP_T ) continue;
			const dx = R[ i + 1 ] - x, dy = R[ i + 2 ] - y, dz = R[ i + 3 ] - z;
			if ( dx * dx + dy * dy + dz * dz < r2 ) {

				this.deduped ++;
				return true;

			}

		}

		const o = this._recentI * 5;
		R[ o ] = type; R[ o + 1 ] = x; R[ o + 2 ] = y; R[ o + 3 ] = z; R[ o + 4 ] = now;
		this._recentI = ( this._recentI + 1 ) % ( R.length / 5 );
		this.counts[ TYPES[ type ] ] ++;
		return false;

	}

	// start a spawn record with the defaults
	_rec( x, y, z, life, sprite, look, orient = ORIENT.BILLBOARD ) {

		const r = this.pool.rec;
		r.px = x; r.py = y; r.pz = z;
		r.vx = 0; r.vy = 0; r.vz = 0;
		r.ax = 0; r.ay = 0; r.az = 0; r.drag = 0;
		r.life = life; r.s0 = 0.1; r.s1 = 0.1; r.floor = - 1e4; r.spin = 0;
		r.r = 1; r.g = 1; r.b = 1; r.a = 1;
		r.sprite = sprite; r.look = look; r.glow = 0; r.orient = orient; r.floorMode = FLOOR.NONE; r.seed = this.rand();
		return r;

	}

	_col( r, c, k = 1, vary = 0 ) {

		const v = vary ? 1 + ( this.rand() - 0.5 ) * 2 * vary : 1;
		r.r = c[ 0 ] * k * v; r.g = c[ 1 ] * k * v; r.b = c[ 2 ] * k * v;

	}

	// drag toward the wind (folded into the constant acceleration: the shader has no wind term)
	_wind( r, follow = 1 ) {

		r.ax += r.drag * this.wind.x * follow;
		r.az += r.drag * this.wind.z * follow;

	}

	_spray( x, y, z, vx, vy, vz, count, size, kind, spread, jitter, life ) {

		const sp = this.env.spray;
		if ( ! sp || ! sp.emit || count <= 0 ) return false;
		const p = this._p, v = this._v, o = this._sprayOpts;
		p.x = x; p.y = y; p.z = z;
		v.x = vx; v.y = vy; v.z = vz;
		o.spread = spread; o.jitter = jitter; o.life = life;
		try { sp.emit( p, v, count, size, kind, o ); } catch ( e ) { return false; }
		return true;

	}

	// ---------------------------------------------------------------- effects (public API)

	// a ball (or anything heavy) into the sea: a column, a crown, drops, mist and a ring of foam; y = the water there
	splash( x, y, z, strength = 1 ) {

		const s = clamp( strength, 0.05, 6 );
		if ( this._dup( T.splash, x, y, z ) ) return;
		const ss = Math.sqrt( s ), fl = y;
		// the column: torn sheets thrown up, falling back into the water
		const nc = 1 + this._n( 2 + 1.5 * s );
		for ( let i = 0; i < nc; i ++ ) {

			const r = this._rec( x + this._r( - 0.3, 0.3 ) * s, y + 0.4 * s, z + this._r( - 0.3, 0.3 ) * s, this._r( 1.3, 1.9 ) * ss, SPRITE.SHEET, LOOK.WATER, ORIENT.UPRIGHT );
			r.vx = this._r( - 0.8, 0.8 ); r.vz = this._r( - 0.8, 0.8 ); r.vy = this._r( 7, 11 ) * ss;
			r.ay = - G; r.drag = 0.45;
			r.s0 = 0.4 * s * this._r( 0.8, 1.2 ); r.s1 = 1.15 * s;
			r.a = 0.85; r.floor = fl; r.floorMode = FLOOR.DIE;
			this._col( r, C.water );
			this.pool.spawn();

		}

		// the crown: sheets and drop clusters thrown out and up
		const nr = this._n( 6 * s );
		for ( let i = 0; i < nr; i ++ ) {

			const a = this.rand() * Math.PI * 2, h = this._r( 1.8, 4 ) * ss;
			const r = this._rec( x, y + 0.2, z, this._r( 0.9, 1.4 ), this.rand() < 0.25 ? SPRITE.SHEET : SPRITE.DROPS, LOOK.WATER );
			r.vx = Math.cos( a ) * h; r.vz = Math.sin( a ) * h; r.vy = this._r( 3, 6 ) * ss;
			r.ay = - G; r.drag = 0.6;
			r.s0 = 0.2 * s; r.s1 = 0.55 * s; r.spin = this._r( - 1, 1 );
			r.a = 0.75; r.floor = fl; r.floorMode = FLOOR.DIE;
			this._col( r, C.water );
			this.pool.spawn();

		}

		// drops: the scene's GPU spray when there is one (lit and stopped by the real water), else our own streaks
		const nd = Math.round( 26 * s * this.scale );
		if ( ! this._spray( x, y + 0.2, z, 0, 8 * ss, 0, nd, 0.03, SPRAY_DROPLET, 3 + s, 0.3 * s, 1.8 ) ) {

			for ( let i = 0, n = this._n( 16 * s ); i < n; i ++ ) {

				const a = this.rand() * Math.PI * 2, h = this._r( 0.5, 4 ) * ss;
				const r = this._rec( x, y + 0.3, z, this._r( 1.0, 1.8 ), SPRITE.EMBER, LOOK.WATER, ORIENT.STREAK );
				r.vx = Math.cos( a ) * h; r.vz = Math.sin( a ) * h; r.vy = this._r( 4, 11 ) * ss;
				r.ay = - G; r.drag = 0.2; r.s0 = r.s1 = this._r( 0.03, 0.06 );
				r.a = 0.8; r.floor = fl; r.floorMode = FLOOR.DIE;
				this._col( r, C.water );
				this.pool.spawn();

			}

		} else this._spray( x, y + 0.5, z, 0, 5 * ss, 0, Math.round( 8 * s * this.scale ), 0.18 * s, SPRAY_SPRAY, 1.5 + s, 0.3 * s, 2 );

		// mist
		for ( let i = 0, n = 1 + this._n( 1.5 * s ); i < n; i ++ ) {

			const r = this._rec( x + this._r( - 0.5, 0.5 ) * s, y + this._r( 0.5, 1.5 ) * s, z + this._r( - 0.5, 0.5 ) * s, this._r( 2.2, 3.2 ), SPRITE.DUST, LOOK.WATER );
			r.vy = this._r( 1, 2.5 ) * ss; r.drag = 1.2; r.ay = 0.2;
			r.s0 = 0.6 * s; r.s1 = 2.8 * s; r.spin = this._r( - 0.3, 0.3 );
			r.a = 0.28; r.floor = fl;
			this._wind( r );
			this._col( r, C.water );
			this.pool.spawn();

		}

		this._foam( x, fl, z, s, 1 );

	}

	// foam on the water: a spreading broken ring and a patch (y = the water)
	_foam( x, y, z, s, ring ) {

		if ( ring ) {

			const r = this._rec( x, y + 0.06, z, this._r( 2.8, 3.6 ), SPRITE.FOAM_RING, LOOK.WATER, ORIENT.FLAT );
			r.s0 = 0.5 * s; r.s1 = 3.8 * s; r.spin = this._r( - 0.15, 0.15 ); r.a = 0.85 * ring;
			this._col( r, C.water );
			this.pool.spawn();

		}

		const r = this._rec( x, y + 0.05, z, this._r( 4, 6 ), SPRITE.FOAM, LOOK.WATER, ORIENT.FLAT );
		r.s0 = 0.7 * s; r.s1 = 2.6 * s; r.spin = this._r( - 0.1, 0.1 ); r.a = 0.6;
		this._col( r, C.water );
		this.pool.spawn();

	}

	// a rooster tail of water thrown back from something skimming the surface (a seaplane's floats, a fast hull);
	// dirX / dirZ: the way it travels (the spray goes the other way). Call it every frame while it skims.
	spray( x, y, z, strength = 1, dirX = 0, dirZ = 1 ) {

		const s = clamp( strength, 0.05, 6 );
		if ( this._dup( T.spray, x, y, z ) ) return;
		const ss = Math.sqrt( s );
		let dl = Math.hypot( dirX, dirZ );
		if ( dl < 1e-4 ) { dirX = 0; dirZ = 1; dl = 1; }
		const fx = dirX / dl, fz = dirZ / dl, bx = - fx, bz = - fz, sx = fz, sz = - fx;
		for ( let i = 0, n = 1 + this._n( 4 * s ); i < n; i ++ ) {

			const back = this._r( 4, 9 ) * ss, side = this._r( - 1.6, 1.6 ) * ss;
			const r = this._rec( x + bx * 0.6, y + 0.15, z + bz * 0.6, this._r( 0.9, 1.4 ), this.rand() < 0.6 ? SPRITE.SHEET : SPRITE.DROPS, LOOK.WATER );
			r.vx = bx * back + sx * side; r.vz = bz * back + sz * side; r.vy = this._r( 3, 6.5 ) * ss;
			r.ay = - G * 0.9; r.drag = 0.7;
			r.s0 = 0.25 * s; r.s1 = 0.9 * s; r.spin = this._r( - 1.5, 1.5 );
			r.a = 0.7; r.floor = y; r.floorMode = FLOOR.DIE;
			this._col( r, C.water );
			this.pool.spawn();

		}

		for ( let i = 0, n = this._n( 1.2 * s ); i < n; i ++ ) {

			const r = this._rec( x + bx, y + 0.6, z + bz, this._r( 1.6, 2.4 ), SPRITE.DUST, LOOK.WATER );
			r.vx = bx * 2 * ss; r.vz = bz * 2 * ss; r.vy = 1; r.drag = 1.5;
			r.s0 = 0.5 * s; r.s1 = 2.2 * s; r.a = 0.22; r.floor = y;
			this._wind( r );
			this._col( r, C.water );
			this.pool.spawn();

		}

		this._spray( x + bx * 0.5, y + 0.1, z + bz * 0.5, bx * 7 * ss, 5 * ss, bz * 7 * ss, Math.round( 26 * s * this.scale ), 0.03, SPRAY_DROPLET, 2.2 * ss, 0.4, 1.5 );
		if ( this.rand() < 0.5 * this.scale + 0.2 ) {

			const r = this._rec( x + bx, y + 0.05, z + bz, this._r( 3.5, 5 ), SPRITE.FOAM, LOOK.WATER, ORIENT.FLAT );
			r.s0 = 0.5 * s; r.s1 = 2.2 * s; r.a = 0.45; r.spin = this._r( - 0.1, 0.1 );
			this._col( r, C.water );
			this.pool.spawn();

		}

	}

	// a cloud of smoke; with a direction (dirX, dirY, dirZ: a gun's barrel) it is blown out along it
	smoke( x, y, z, strength = 1, dirX = 0, dirY = 0, dirZ = 0 ) {

		const s = clamp( strength, 0.05, 6 );
		if ( this._dup( T.smoke, x, y, z ) ) return;
		const dl = Math.hypot( dirX, dirY, dirZ );
		if ( dl > 1e-4 ) this._muzzleSmoke( x, y, z, s, dirX / dl, dirY / dl, dirZ / dl );
		else this._smokeCloud( x, y, z, s, C.smoke, 0 );

	}

	_smokeCloud( x, y, z, s, col, glow ) {

		const fl = this._floorAt( x, z );
		for ( let i = 0, n = 1 + this._n( 4 * s ); i < n; i ++ ) {

			const r = this._rec( x + this._r( - 0.4, 0.4 ) * s, y + this._r( 0, 0.5 ) * s, z + this._r( - 0.4, 0.4 ) * s, this._r( 4, 6.5 ), [ SPRITE.PUFF_A, SPRITE.PUFF_B, SPRITE.PUFF_C ][ i % 3 ], LOOK.SMOKE );
			r.vx = this._r( - 0.8, 0.8 ); r.vz = this._r( - 0.8, 0.8 ); r.vy = this._r( 0.8, 1.8 );
			r.drag = 0.8; r.ay = 0.6;
			r.s0 = 0.5 * s; r.s1 = 2.6 * s * this._r( 0.8, 1.3 ); r.spin = this._r( - 0.25, 0.25 );
			r.a = 0.55; r.glow = glow; r.floor = fl;
			this._wind( r );
			this._col( r, col, 1, 0.12 );
			this.pool.spawn();

		}

	}

	_muzzleSmoke( x, y, z, s, dx, dy, dz ) {

		const fl = this._floorAt( x, z ), ss = Math.sqrt( s );
		for ( let i = 0, n = 2 + this._n( 5 * s ); i < n; i ++ ) {

			const k = 0.3 + i * 0.35 * s, sp = Math.max( 3, 14 - i * 2 ) * ss;
			const r = this._rec( x + dx * k, y + dy * k, z + dz * k, this._r( 3.5, 5 ), [ SPRITE.PUFF_A, SPRITE.PUFF_B, SPRITE.PUFF_C ][ i % 3 ], LOOK.SMOKE );
			r.vx = dx * sp + this._r( - 1.2, 1.2 ); r.vy = dy * sp + this._r( 0, 0.6 ); r.vz = dz * sp + this._r( - 1.2, 1.2 );
			r.drag = 2.6; r.ay = 0.35;
			r.s0 = 0.3 * s; r.s1 = ( 1.6 + 0.3 * i ) * s; r.spin = this._r( - 0.3, 0.3 );
			r.a = 0.6; r.floor = fl;
			this._wind( r );
			this._col( r, C.gunSmoke, 1, 0.08 );
			this.pool.spawn();

		}

	}

	// a short burst of light (muzzle, explosion); with a direction: a flame jet and sparks along it
	flash( x, y, z, strength = 1, dirX = 0, dirY = 0, dirZ = 0 ) {

		const s = clamp( strength, 0.05, 6 );
		if ( this._dup( T.flash, x, y, z ) ) return;
		const dl = Math.hypot( dirX, dirY, dirZ );
		const dx = dl > 1e-4 ? dirX / dl : 0, dy = dl > 1e-4 ? dirY / dl : 0, dz = dl > 1e-4 ? dirZ / dl : 0;
		const fl = this._floorAt( x, z );
		const r = this._rec( x + dx * 0.45 * s, y + dy * 0.45 * s, z + dz * 0.45 * s, 0.09, SPRITE.FLASH, LOOK.GLOW );
		r.s0 = 0.7 * s; r.s1 = 1.5 * s;
		this._col( r, C.flash, 45 );
		this.pool.spawn( true );
		if ( dl > 1e-4 ) {

			for ( let i = 0; i < 2; i ++ ) {

				const j = this._rec( x + dx * 0.2, y + dy * 0.2, z + dz * 0.2, 0.11, SPRITE.FLAME, LOOK.GLOW, ORIENT.STREAK );
				const v = this._r( 22, 30 ) * Math.sqrt( s );
				j.vx = dx * v; j.vy = dy * v; j.vz = dz * v; j.drag = 28;
				j.s0 = 0.32 * s; j.s1 = 0.5 * s;
				this._col( j, C.flame, 30 );
				this.pool.spawn( true );

			}

			for ( let i = 0, n = this._n( 7 * s ); i < n; i ++ ) {

				const k = this._rec( x, y, z, this._r( 0.25, 0.6 ), SPRITE.EMBER, LOOK.GLOW, ORIENT.STREAK );
				const v = this._r( 9, 18 );
				k.vx = dx * v + this._r( - 4, 4 ); k.vy = dy * v + this._r( - 2, 4 ); k.vz = dz * v + this._r( - 4, 4 );
				k.ay = - G; k.drag = 1.5; k.s0 = k.s1 = 0.025;
				k.floor = fl; k.floorMode = FLOOR.DIE;
				this._col( k, C.ember, 25 );
				this.pool.spawn();

			}

		}

		this._flashLight( x + dx * 0.6, y + dy * 0.6 + 0.2, z + dz * 0.6, 70 * s, 14 + 6 * s, 0.12 );

	}

	// a gun firing: flash + smoke blown along the barrel (the cannonFired event)
	muzzle( x, y, z, dirX, dirY, dirZ, strength = 1 ) {

		this.flash( x, y, z, strength, dirX, dirY, dirZ );
		this.smoke( x, y, z, strength, dirX, dirY, dirZ );

	}

	// wood splinters (a ball into timber): shards tumbling out, chips and a puff of dust
	splinters( x, y, z, strength = 1 ) {

		const s = clamp( strength, 0.05, 6 );
		if ( this._dup( T.splinters, x, y, z ) ) return;
		this._chunks( x, y, z, s, DEBRIS.wood, 12, 0.12, 0.3 );
		this._dust( x, y, z, 0.5 * s, C.sand, 0.4 );

	}

	// chunks and shards of `kind` ( 'wood' | 'stone' | 'dirt' | 'metal' | 'straw' ) and a dust cloud
	debris( x, y, z, strength = 1, kind = 'wood' ) {

		const s = clamp( strength, 0.05, 6 );
		if ( this._dup( T.debris, x, y, z ) ) return;
		const pal = DEBRIS[ kind ] || DEBRIS.wood;
		this._chunks( x, y, z, s, pal, 10, 0.06, 0.22 );
		this._dust( x, y, z, 0.8 * s, kind === 'dirt' || kind === 'earth' ? C.dirt : C.sand, 0.45 );
		if ( kind === 'metal' ) this.flash( x, y, z, 0.3 * s );

	}

	_chunks( x, y, z, s, pal, count, sMin, sMax ) {

		const land = this._onLand( x, z ), fl = this._floorAt( x, z ), ss = Math.sqrt( s );
		const sizeK = Math.sqrt( Math.min( s, 1.6 ) );
		// timber breaks into long shards and a few small chips; stone and earth into chunks
		const woody = pal[ 0 ] === SPRITE.SPLINTER;
		for ( let i = 0, n = 2 + this._n( count * s ); i < n; i ++ ) {

			const a = this.rand() * Math.PI * 2, h = this._r( 2, 7 ) * ss;
			const sprite = woody && i % 4 !== 3 ? SPRITE.SPLINTER : SPRITE.CHUNK;
			const r = this._rec( x, y, z, land ? this._r( 4, 7 ) : this._r( 1.4, 2.4 ), sprite, LOOK.SOLID );
			r.vx = Math.cos( a ) * h; r.vz = Math.sin( a ) * h; r.vy = this._r( 2, 7.5 ) * ss;
			r.ay = - G; r.drag = 0.25;
			r.s0 = r.s1 = this._r( sMin, sMax ) * sizeK * ( woody && sprite === SPRITE.CHUNK ? 0.45 : 1 );
			r.spin = this._r( 6, 18 ) * ( this.rand() < 0.5 ? - 1 : 1 );
			r.floor = fl; r.floorMode = land ? FLOOR.REST : FLOOR.DIE;
			this._col( r, pal[ 1 ][ i % pal[ 1 ].length ], 1, 0.1 );
			this.pool.spawn();

		}

	}

	// a dust cloud rolling out low (a prop knocked down, a ball into the ground)
	dust( x, y, z, strength = 1 ) {

		const s = clamp( strength, 0.05, 6 );
		if ( this._dup( T.dust, x, y, z ) ) return;
		this._dust( x, y, z, s, C.sand, 0.45 );

	}

	_dust( x, y, z, s, col, alpha ) {

		const fl = this._floorAt( x, z ), ss = Math.sqrt( s );
		for ( let i = 0, n = 1 + this._n( 5 * s ); i < n; i ++ ) {

			const a = this.rand() * Math.PI * 2, h = this._r( 1.5, 3.5 ) * ss;
			const r = this._rec( x, y + this._r( 0.1, 0.5 ), z, this._r( 2.5, 4 ), i % 2 ? SPRITE.DUST : SPRITE.PUFF_C, LOOK.SMOKE );
			r.vx = Math.cos( a ) * h; r.vz = Math.sin( a ) * h; r.vy = this._r( 0.4, 1.3 );
			r.drag = 1.8; r.ay = 0.25;
			r.s0 = 0.5 * s; r.s1 = 3 * s * this._r( 0.8, 1.2 ); r.spin = this._r( - 0.3, 0.3 );
			r.a = alpha; r.floor = fl;
			this._wind( r, 0.7 );
			this._col( r, col, 1, 0.08 );
			this.pool.spawn();

		}

	}

	// bubbles breaking at the surface with foam (a hull going down, a diver, a big fish); y = the water
	bubbles( x, y, z, strength = 1 ) {

		const s = clamp( strength, 0.05, 6 );
		if ( this._dup( T.bubbles, x, y, z ) ) return;
		this._bubbles( x, y, z, s );

	}

	_bubbles( x, y, z, s ) {

		for ( let i = 0, n = 2 + this._n( 7 * s ); i < n; i ++ ) {

			const a = this.rand() * Math.PI * 2, d = Math.sqrt( this.rand() ) * 1.2 * s, h = this._r( 0.3, 1.1 );
			const r = this._rec( x + Math.cos( a ) * d, y + 0.05, z + Math.sin( a ) * d, this._r( 1.2, 2.6 ), SPRITE.BUBBLES, LOOK.WATER, ORIENT.FLAT );
			r.vx = Math.cos( a ) * h; r.vz = Math.sin( a ) * h; r.drag = 1.2;
			r.s0 = 0.25 * Math.sqrt( s ); r.s1 = 0.6 * Math.sqrt( s ); r.spin = this._r( - 0.4, 0.4 );
			r.a = 0.85;
			this._col( r, C.water );
			this.pool.spawn();

		}

		for ( let i = 0, n = 1 + this._n( 2.5 * s ); i < n; i ++ ) {

			const r = this._rec( x + this._r( - 1, 1 ) * s, y + 0.15, z + this._r( - 1, 1 ) * s, 0.6, SPRITE.SHEET, LOOK.WATER, ORIENT.UPRIGHT );
			r.vy = this._r( 1.5, 2.6 ); r.ay = - G; r.drag = 0.5;
			r.s0 = 0.15 * s; r.s1 = 0.4 * s; r.a = 0.7; r.floor = y; r.floorMode = FLOOR.DIE;
			this._col( r, C.water );
			this.pool.spawn();

		}

		this._spray( x, y + 0.1, z, 0, 2.5, 0, Math.round( 6 * s * this.scale ), 0.025, SPRAY_DROPLET, 1.2, 0.6 * s, 0.9 );
		this._foam( x, y, z, s, 0.55 );

	}

	// a blast: flash, a dark rolling cloud, debris, and water thrown up when it is at the surface
	explosion( x, y, z, strength = 1, kind = 'wood' ) {

		const s = clamp( strength, 0.05, 6 );
		if ( this._dup( T.explosion, x, y, z ) ) return;
		const fl = this._floorAt( x, z );
		const r = this._rec( x, y, z, 0.16, SPRITE.FLASH, LOOK.GLOW );
		r.s0 = 1.2 * s; r.s1 = 3 * s;
		this._col( r, C.flash, 50 );
		this.pool.spawn( true );
		const ring = this._rec( x, y, z, 0.35, SPRITE.RING, LOOK.GLOW );
		ring.s0 = 0.8 * s; ring.s1 = 5 * s; ring.a = 0.5;
		this._col( ring, C.flame, 8 );
		this.pool.spawn( true );
		for ( let i = 0, n = 2 + this._n( 5 * s ); i < n; i ++ ) {

			const a = this.rand() * Math.PI * 2;
			const f = this._rec( x, y + 0.3, z, this._r( 0.4, 0.7 ), SPRITE.FLAME, LOOK.GLOW );
			f.vx = Math.cos( a ) * this._r( 2, 5 ) * s; f.vz = Math.sin( a ) * this._r( 2, 5 ) * s; f.vy = this._r( 2, 6 ) * s;
			f.drag = 3; f.ay = 2; f.s0 = 0.7 * s; f.s1 = 1.4 * s; f.spin = this._r( - 2, 2 );
			this._col( f, C.flame, 6 );
			this.pool.spawn();

		}

		this._smokeCloud( x, y + 0.5 * s, z, 1.6 * s, C.fireSmoke, 0.8 );
		this._chunks( x, y, z, s, DEBRIS[ kind ] || DEBRIS.wood, 10, 0.08, 0.26 );
		if ( y < this.sea + 1.5 && ! this._onLand( x, z ) ) this.splash( x, this.sea, z, 1.2 * s );
		else this._dust( x, fl, z, s, C.dirt, 0.5 );
		this._flashLight( x, y + 0.5, z, 160 * s, 22 + 8 * s, 0.25 );

	}

	// ---------------------------------------------------------------- persistent fires

	fire( id, x, y, z, strength = 1, vx = 0, vz = 0 ) {

		let f = null, free = null, weakest = null;
		for ( const e of this.fires ) {

			if ( e.on && e.id === id ) { f = e; break; }
			if ( ! e.on && ! free ) free = e;
			if ( e.on && ( ! weakest || e.s < weakest.s ) ) weakest = e;

		}

		if ( ! f ) {

			f = free || weakest;
			f.on = true;
			f.id = id;
			f.accF = f.accS = f.accE = 0;
			f.t = 0;
			f.ship = false;

		}

		f.x = x; f.y = y; f.z = z;
		f.s = clamp( strength, 0.05, 4 );
		f.vx = vx; f.vz = vz;
		f.seen = this._frame;
		return f;

	}

	stopFire( id ) {

		for ( const f of this.fires ) {

			if ( ! f.on || f.id !== id ) continue;
			f.on = false;
			// the last of it: a puff of smoke where it burned
			this._smokeCloud( f.x, f.y + 0.5, f.z, 0.8 * f.s, C.fireSmoke, 0.3 );
			for ( const l of this.lights ) if ( l.fire === f ) { l.fire = null; l.enabled = false; }
			return true;

		}

		return false;

	}

	get fireCount() {

		let n = 0;
		for ( const f of this.fires ) if ( f.on ) n ++;
		return n;

	}

	_fireTick( f, dt ) {

		f.t += dt;
		const s = f.s, k = Math.pow( s, 0.6 ), sc = this.scale;
		f.accF += dt * 24 * s * sc;
		f.accS += dt * 6 * s * sc;
		f.accE += dt * 4 * s * sc;
		const fl = this._floorAt( f.x, f.z );
		for ( ; f.accF >= 1; f.accF -= 1 ) {

			const a = this.rand() * Math.PI * 2, d = Math.sqrt( this.rand() ) * 0.55 * k;
			const r = this._rec( f.x + Math.cos( a ) * d, f.y + 0.1, f.z + Math.sin( a ) * d, this._r( 0.45, 0.8 ), SPRITE.FLAME, LOOK.GLOW, ORIENT.UPRIGHT );
			r.vx = f.vx + this._r( - 0.3, 0.3 ); r.vz = f.vz + this._r( - 0.3, 0.3 ); r.vy = this._r( 1.4, 2.4 );
			r.ay = 3; r.drag = 1.4;
			r.s0 = this._r( 0.35, 0.6 ) * k; r.s1 = 0.12 * k;
			r.a = this._r( 0.8, 1 );
			this._col( r, C.flame, 2.4, 0.15 );
			this.pool.spawn();

		}

		for ( ; f.accS >= 1; f.accS -= 1 ) {

			const r = this._rec( f.x + this._r( - 0.4, 0.4 ) * k, f.y + 0.8 * k, f.z + this._r( - 0.4, 0.4 ) * k, this._r( 5, 8 ), this.rand() < 0.5 ? SPRITE.PUFF_A : SPRITE.PUFF_B, LOOK.SMOKE );
			r.vx = f.vx; r.vz = f.vz; r.vy = this._r( 2, 3 );
			r.ay = 1; r.drag = 0.6;
			r.s0 = 0.5 * k; r.s1 = this._r( 3, 4.5 ) * k; r.spin = this._r( - 0.2, 0.2 );
			r.a = this._r( 0.45, 0.6 ); r.glow = 0.5; r.floor = fl;
			this._wind( r );
			this._col( r, C.fireSmoke, 1, 0.15 );
			this.pool.spawn();

		}

		for ( ; f.accE >= 1; f.accE -= 1 ) {

			const r = this._rec( f.x + this._r( - 0.4, 0.4 ) * k, f.y + 0.4, f.z + this._r( - 0.4, 0.4 ) * k, this._r( 1, 2.2 ), SPRITE.EMBER, LOOK.GLOW, ORIENT.STREAK );
			r.vx = f.vx + this._r( - 1.5, 1.5 ); r.vz = f.vz + this._r( - 1.5, 1.5 ); r.vy = this._r( 2.5, 5 );
			r.ay = 1.2; r.drag = 0.9; r.s0 = r.s1 = 0.025;
			this._wind( r );
			this._col( r, C.ember, 22 );
			this.pool.spawn();

		}

	}

	// ---------------------------------------------------------------- sinking hulls

	// a hull going down at ( x, z ): bubbles and foam welling up for a while (size ~ the beam / 3)
	sinking( id, x, z, size = 2.5 ) {

		let e = null;
		for ( const s of this.sinks ) if ( s.id === id ) { e = s; break; }
		// this hull already went down (the slot keeps its id until it is reused): no second rush
		if ( e && ! e.on ) return e;
		if ( ! e ) e = this.sinks.find( ( s ) => ! s.on ) || this.sinks.reduce( ( a, b ) => ( a.t > b.t ? a : b ) );
		if ( ! e.on || e.id !== id ) {

			e.on = true; e.id = id; e.t = 0; e.next = 0;
			// the first rush of air and water as she goes
			this.splash( x, this.sea, z, 0.8 * size );
			this.bubbles( x, this.sea, z, size );

		}

		e.x = x; e.z = z; e.size = size;
		return e;

	}

	_sinkTick( e, dt ) {

		e.t += dt;
		e.next -= dt;
		if ( e.t > 9 ) { e.on = false; return; }
		if ( e.next > 0 ) return;
		e.next = 0.35 + this.rand() * 0.25;
		const fade = 1 - e.t / 9, d = e.size * 0.8;
		this._bubbles( e.x + this._r( - d, d ), this.sea, e.z + this._r( - d, d ), 0.4 + 0.8 * e.size * fade );

	}

	// naval ships: fire and smoke under 35 % hull, doused as she goes down; a sinking ship bubbles
	trackShips( ships ) {

		if ( ! ships ) return;
		const p = this._q, v = this._v;
		for ( const s of ships ) {

			if ( ! s || ! s.id ) continue;
			const id = 'ship:' + s.id;
			const frac = s.hpFraction ?? ( s.maxHp ? s.hp / s.maxHp : 1 );
			const sinking = s.state === 'sinking';
			if ( s.state === 'gone' ) continue;
			if ( ( s.alive !== false && ! sinking && frac < 0.35 ) || ( sinking && ( s.sinkT ?? 0 ) < 3 ) ) {

				// a seeded spot on deck, amidships-aft (the same one every frame)
				const cls = s.cls || {};
				const h = hashId( s.id );
				const lx = ( h - 0.5 ) * ( cls.beam || 4 ) * 0.4, lz = ( ( h * 7.13 ) % 1 - 0.6 ) * ( cls.length || 12 ) * 0.4;
				if ( s.toWorld ) s.toWorld( lx, ( cls.deck ?? cls.sheer ?? 1.5 ) + 0.2, lz, p );
				else { p.x = s.x; p.y = ( s.pose ? s.pose.y : 0 ) + 2; p.z = s.z; }
				if ( s.velocity ) s.velocity( v ); else { v.x = 0; v.z = 0; }
				const strength = sinking ? 0.6 * ( 1 - ( s.sinkT ?? 0 ) / 3 ) : 0.6 + ( 0.35 - frac ) / 0.35 * 1.4;
				const f = this.fire( id, p.x, p.y, p.z, Math.max( 0.15, strength ), v.x, v.z );
				f.ship = true;

			}

			if ( sinking ) {

				const cls = s.cls || {};
				this.sinking( id, s.x, s.z, Math.max( 1, ( cls.beam || 4 ) / 2.5 ) );

			}

		}

		// fires of ships that are gone, repaired or doused
		for ( const f of this.fires ) if ( f.on && f.ship && f.seen !== this._frame ) this.stopFire( f.id );

	}

	// ---------------------------------------------------------------- lights

	_flashLight( x, y, z, peak, range, dur ) {

		let l = this.lights[ 0 ];
		if ( this.lights[ 1 ].dur - this.lights[ 1 ].age < l.dur - l.age ) l = this.lights[ 1 ];
		l.position.set( x, y, z );
		l.color.setRGB( 1, 0.72, 0.42 );
		l.peak = peak; l.age = 0; l.dur = dur; l.range = range;
		l.intensity = peak; l.enabled = true;

	}

	_updateLights( dt ) {

		for ( let i = 0; i < 2; i ++ ) {

			const l = this.lights[ i ];
			if ( ! l.enabled ) continue;
			l.age += dt;
			const u = l.age / Math.max( l.dur, 1e-3 );
			if ( u >= 1 ) { l.enabled = false; l.intensity = 0; continue; }
			l.intensity = l.peak * ( 1 - u ) * ( 1 - u );

		}

		// the two fires nearest the camera get a light
		const cam = this.env.camera ? this.env.camera() : null;
		let a = null, b = null, da = Infinity, db = Infinity;
		for ( const f of this.fires ) {

			if ( ! f.on ) continue;
			const d = cam ? ( f.x - cam.x ) ** 2 + ( f.y - cam.y ) ** 2 + ( f.z - cam.z ) ** 2 : - f.s;
			if ( d < da ) { b = a; db = da; a = f; da = d; } else if ( d < db ) { b = f; db = d; }

		}

		for ( let i = 0; i < 2; i ++ ) {

			const l = this.lights[ 2 + i ], f = i === 0 ? a : b;
			l.fire = f;
			l.enabled = !! f;
			if ( ! f ) { l.intensity = 0; continue; }
			l.position.set( f.x, f.y + 1.2 * Math.pow( f.s, 0.6 ), f.z );
			l.color.setRGB( 1, 0.55, 0.22 );
			l.range = 12 + 6 * f.s;
			// a quick ragged flicker on top of LocalLights' slow one
			const t = f.t;
			l.intensity = 28 * f.s * ( 0.8 + 0.12 * Math.sin( t * 23 + f.x ) + 0.08 * Math.sin( t * 37.7 + f.z ) ) * Math.min( 1, t * 3 );

		}

	}

	// ---------------------------------------------------------------- frame

	update( dt ) {

		this._frame ++;
		this.pool.advance( dt );
		const env = this.env;
		this.sea = env.seaLevel ? env.seaLevel() : 0;
		if ( env.wind ) env.wind( this.wind );
		for ( const f of this.fires ) if ( f.on ) this._fireTick( f, dt );
		for ( const e of this.sinks ) if ( e.on ) this._sinkTick( e, dt );
		this._updateLights( dt );

	}

	reset() {

		for ( const f of this.fires ) f.on = false;
		for ( const e of this.sinks ) { e.on = false; e.id = null; }
		for ( const l of this.lights ) { l.enabled = false; l.intensity = 0; l.fire = null; }
		this.pool.clear();

	}

}

// a stable 0..1 hash of an id (string or number)
function hashId( id ) {

	const s = String( id );
	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 );
	return ( h >>> 0 ) / 4294967296;

}
