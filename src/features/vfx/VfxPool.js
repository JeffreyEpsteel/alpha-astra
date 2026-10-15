// The particle pool behind the VFX set: a fixed Float32Array mirror of the GPU storage buffer (src/fx/VfxParticles.js),
// slot allocation under a live budget, dirty-range tracking for partial uploads, and the analytic motion the vertex
// shader evaluates (motionAt is its CPU twin, used by the tests and by the lights that follow a burst).
//
// A particle is written once, when it is spawned; the GPU moves it in closed form from its spawn state, so nothing
// is simulated or uploaded per frame on the CPU besides the new slots.
//   motion: dv/dt = acc - drag * v (acc already holds the wind's pull, drag * wind, folded in at spawn)
//     v(t) = v0 e^(-k t) + acc E1,  p(t) = p0 + v0 E1 + acc G2,  E1 = (1 - e^(-k t)) / k,  G2 = (t - E1) / k
//   size: s0 -> s1 with an ease-out; alpha / colour over life per look (see the shader)
//
// Layout: STRIDE floats (6 vec4) per slot
//   0 p0.xyz  t0 (spawn time on the pool clock)   1 v0.xyz  life (s)        2 acc.xyz  drag (1/s)
//   3 size0  size1  floorY  spin (rad/s)          4 rgb (albedo; radiance for GLOW)  alpha
//   5 sprite  look (+ glow in the fraction)  orient  floorMode + seed (seed in the fraction)

export const STRIDE = 24;
export const LOOK = { SMOKE: 0, GLOW: 1, WATER: 2, SOLID: 3 };
export const ORIENT = { BILLBOARD: 0, STREAK: 1, FLAT: 2, UPRIGHT: 3 };
export const FLOOR = { NONE: 0, DIE: 1, REST: 2 };

const REBASE = 600; // s: the clock is wrapped back so f32 spawn times keep their precision

export class VfxPool {

	constructor( capacity = 4096 ) {

		this.capacity = capacity;
		this.data = new Float32Array( capacity * STRIDE );
		this.death = new Float32Array( capacity ); // pool time when the slot frees (<= now: free)
		this.dirty = new Uint8Array( capacity );
		this.dirtyMin = capacity;
		this.dirtyMax = - 1;
		this.limit = capacity; // live budget; slots are taken from [ 0, limit )
		this.cursor = 0;
		this.now = 0;
		this.live = 0;
		this.drawCount = 0; // instances worth drawing (highest live slot + 1)
		this.stats = { spawned: 0, dropped: 0, recycled: 0, rebased: 0 };
		// the spawn record: recipes fill it, spawn() copies it into a slot (reused: no allocation)
		this.rec = {
			px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, life: 1, ax: 0, ay: 0, az: 0, drag: 0,
			s0: 0.1, s1: 0.1, floor: - 1e4, spin: 0, r: 1, g: 1, b: 1, a: 1,
			sprite: 0, look: 0, glow: 0, orient: 0, floorMode: 0, seed: 0,
		};

	}

	// the live budget (quality presets); slots above it drain naturally
	setLimit( n ) {

		this.limit = Math.max( 16, Math.min( this.capacity, Math.floor( n ) ) );
		if ( this.cursor >= this.limit ) this.cursor = 0;

	}

	// a free slot, or - 1 when the budget is full; priority effects (flashes) recycle the next slot instead
	alloc( priority = false ) {

		const lim = this.limit, death = this.death, now = this.now;
		if ( this.live >= lim && ! priority ) {

			this.stats.dropped ++;
			return - 1;

		}

		// the ring hands out slots in order; skip a few still-live ones (long-lived smoke) before recycling
		for ( let k = 0; k < 24; k ++ ) {

			const i = ( this.cursor + k ) % lim;
			if ( death[ i ] <= now ) {

				this.cursor = ( i + 1 ) % lim;
				this.live ++;
				return i;

			}

		}

		if ( ! priority && this.live >= lim * 0.9 ) {

			this.stats.dropped ++;
			return - 1;

		}

		const i = this.cursor;
		this.cursor = ( i + 1 ) % lim;
		this.stats.recycled ++;
		return i;

	}

	// copy the spawn record into a new slot; returns the slot or - 1
	spawn( priority = false ) {

		const i = this.alloc( priority );
		if ( i < 0 ) return - 1;
		const s = this.rec, d = this.data, o = i * STRIDE;
		d[ o ] = s.px; d[ o + 1 ] = s.py; d[ o + 2 ] = s.pz; d[ o + 3 ] = this.now;
		d[ o + 4 ] = s.vx; d[ o + 5 ] = s.vy; d[ o + 6 ] = s.vz; d[ o + 7 ] = s.life;
		d[ o + 8 ] = s.ax; d[ o + 9 ] = s.ay; d[ o + 10 ] = s.az; d[ o + 11 ] = s.drag;
		d[ o + 12 ] = s.s0; d[ o + 13 ] = s.s1; d[ o + 14 ] = s.floor; d[ o + 15 ] = s.spin;
		d[ o + 16 ] = s.r; d[ o + 17 ] = s.g; d[ o + 18 ] = s.b; d[ o + 19 ] = s.a;
		d[ o + 20 ] = s.sprite; d[ o + 21 ] = s.look + Math.min( Math.max( s.glow, 0 ), 0.99 );
		d[ o + 22 ] = s.orient; d[ o + 23 ] = s.floorMode + Math.min( Math.max( s.seed, 0 ), 0.999 );
		this.death[ i ] = this.now + s.life;
		this._mark( i );
		this.stats.spawned ++;
		if ( i + 1 > this.drawCount ) this.drawCount = i + 1;
		return i;

	}

	_mark( i ) {

		this.dirty[ i ] = 1;
		if ( i < this.dirtyMin ) this.dirtyMin = i;
		if ( i > this.dirtyMax ) this.dirtyMax = i;

	}

	// advance the clock, count the live slots and the draw range, wrap the clock now and then
	advance( dt ) {

		this.now += Math.max( 0, dt );
		const death = this.death, now = this.now;
		let live = 0, top = 0;
		for ( let i = 0; i < this.capacity; i ++ ) {

			if ( death[ i ] > now ) {

				live ++;
				top = i + 1;

			}

		}

		this.live = live;
		this.drawCount = top;
		if ( this.now > REBASE ) this._rebase( REBASE );
		return live;

	}

	_rebase( by ) {

		this.now -= by;
		const d = this.data;
		for ( let i = 0; i < this.capacity; i ++ ) {

			this.death[ i ] = Math.max( 0, this.death[ i ] - by );
			d[ i * STRIDE + 3 ] -= by;

		}

		this.dirtyMin = 0;
		this.dirtyMax = this.capacity - 1;
		this.dirty.fill( 1 );
		this.stats.rebased ++;

	}

	// hand the dirty slots out as coalesced runs [ start, end ) (gaps under `gap` slots are bridged), then clear
	flushDirty( fn, gap = 32 ) {

		if ( this.dirtyMax < 0 ) return 0;
		const dirty = this.dirty;
		let runs = 0, start = - 1, last = - 1;
		for ( let i = this.dirtyMin; i <= this.dirtyMax; i ++ ) {

			if ( ! dirty[ i ] ) continue;
			dirty[ i ] = 0;
			if ( start < 0 ) start = i;
			else if ( i - last > gap ) {

				fn( start, last + 1 );
				runs ++;
				start = i;

			}

			last = i;

		}

		if ( start >= 0 ) {

			fn( start, last + 1 );
			runs ++;

		}

		this.dirtyMin = this.capacity;
		this.dirtyMax = - 1;
		return runs;

	}

	clear() {

		this.death.fill( 0 );
		this.live = 0;
		this.drawCount = 0;
		this.cursor = 0;

	}

}

// CPU twin of the vertex shader's motion (keep in sync with src/fx/VfxParticles.js): position and velocity of slot i
// at `age` seconds after its spawn, into out { x, y, z, vx, vy, vz }
export function motionAt( data, i, age, out = {} ) {

	const o = i * STRIDE;
	const k = data[ o + 11 ];
	const t = Math.max( 0, age );
	let E1, G2;
	const kt = k * t;
	if ( kt < 0.01 ) {

		// series: no cancellation for weak drag
		E1 = t - k * t * t / 2 + k * k * t * t * t / 6;
		G2 = t * t / 2 - k * t * t * t / 6;

	} else {

		E1 = ( 1 - Math.exp( - kt ) ) / k;
		G2 = ( t - E1 ) / k;

	}

	const ek = Math.exp( - kt );
	out.x = data[ o ] + data[ o + 4 ] * E1 + data[ o + 8 ] * G2;
	out.y = data[ o + 1 ] + data[ o + 5 ] * E1 + data[ o + 9 ] * G2;
	out.z = data[ o + 2 ] + data[ o + 6 ] * E1 + data[ o + 10 ] * G2;
	out.vx = data[ o + 4 ] * ek + data[ o + 8 ] * E1;
	out.vy = data[ o + 5 ] * ek + data[ o + 9 ] * E1;
	out.vz = data[ o + 6 ] * ek + data[ o + 10 ] * E1;
	return out;

}
