// Gulls that notice the fishing (docs/UNREAL_PARITY.md F8): a small flock of its own near the player (the bay's
// soaring gulls in src/world/Gulls.js are animated wholly on the GPU and cannot react, so they are left alone) that
//   cast     the lure's splash startles every bird within SCARE_R of it: they burst away, wings beating, and soar on
//   bite     a fish takes the bait (or the hook is set: 'strike'): 2-3 gulls wheel in and circle low over the line
//   miss     the fish got away: the wheeling gulls dive at the bobber (one bird if none was wheeling), then climb out
//   catch    the fish is landed: one gull swoops in to steal it, squawks, and flies off; the rest drift away
//   stow     the line comes in: everyone back to soaring
// The cues come from the game's own state (rod state, Game.fight, Game.bite edges, as features/sfx does) and the
// events 'strikeMissed' and 'fishCaught'. They roost at night (hidden) and only fly near the player.
//
//   const flock = new GullFlock( { count, rng } );  flock.anchor( x, z );  flock.cue( kind, { x, y, z } );  flock.step( dt )
//   flock.squawks: where a steal / a dive just arrived (GullCues drains them: event 'gullSquawk' + the audio's gullCall)
//   const cues = new GullCues( app, features );  cues.update( dt )  cues.flock  cues.mesh  cues.onCue  cues.dispose()
//   cues.onCue( kind, gullSpot, waterSpot ): the same edges, for the water effects (CastFx.js)
//
// Drawing: one instanced draw; per bird two vec4s (position + yaw, pitch / bank / flap gate / seed): the wings beat in
// the vertex shader, everything else is steered on the CPU (8 birds: nothing to speak of).

import { Mesh } from '../../engine/scene/Mesh.js';
import { BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute } from '../../engine/geometry/index.js';
import { Material } from '../../engine/render/Material.js';

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const TAU = Math.PI * 2;

export const STATES = [ 'idle', 'follow', 'scatter', 'swoop', 'leave' ];
export const SCARE_R = 22; // m: a cast's splash startles the gulls this close to it
export const WHEEL_MIN = 2, WHEEL_MAX = 3; // gulls that wheel in over a bite / a fight

export class GullFlock {

	constructor( { count = 8, rng = Math.random } = {} ) {

		this.rng = rng;
		this.cx = 0; this.cz = 0; // the thermal over the player
		this.focus = null; // { x, y, z } the bobber or the catch
		this.birds = [];
		for ( let i = 0; i < count; i ++ ) {

			const r = 18 + rng() * 18, th = rng() * TAU, h = 18 + rng() * 14;
			this.birds.push( {
				x: Math.cos( th ) * r, y: h, z: Math.sin( th ) * r, vx: 0, vy: 0, vz: 0,
				state: 'idle', t: 0, th, r, h, dir: rng() < 0.5 ? - 1 : 1, speed: 9 + rng() * 3,
				ox: ( rng() - 0.5 ) * 40, oz: ( rng() - 0.5 ) * 40, flap: 0, bank: 0, seed: rng(), away: null, next: 'idle', kind: null,
			} );

		}

		this.cues = { cast: 0, bite: 0, strike: 0, miss: 0, catch: 0, stow: 0 };
		this.squawks = []; // { x, y, z, kind } arrivals of a steal / a dive, drained by GullCues

	}

	anchor( x, z ) {

		this.cx = x; this.cz = z;
		// a bird left far behind (the player sailed off) rejoins out of sight, high over the new spot
		for ( const b of this.birds ) {

			if ( Math.hypot( b.x - x, b.z - z ) < 320 ) continue;
			b.x = x + ( this.rng() - 0.5 ) * 160; b.z = z + ( this.rng() - 0.5 ) * 160; b.y = 40 + this.rng() * 15;
			b.vx = b.vy = b.vz = 0;
			b.state = 'idle';

		}

	}

	_set( b, state, t = 0 ) {

		b.state = state;
		b.t = t;

	}

	nearest( p, n ) {

		return [ ...this.birds ].sort( ( a, c ) => Math.hypot( a.x - p.x, a.z - p.z ) - Math.hypot( c.x - p.x, c.z - p.z ) ).slice( 0, n );

	}

	// two or three gulls wheel in over the line (a bite, then the fight): the nearest ones circle low about `at`
	_wheel( at ) {

		this.focus = { x: at.x, y: at.y || 0, z: at.z };
		const R = this.rng, want = WHEEL_MIN + Math.floor( R() * ( WHEEL_MAX - WHEEL_MIN + 1 ) );
		let n = this.birds.filter( ( b ) => b.state === 'follow' ).length;
		for ( const b of this.nearest( at, this.birds.length ) ) {

			if ( n >= want ) break;
			if ( b.state === 'follow' ) continue;
			this._set( b, 'follow', 0 );
			b.r = 5 + R() * 4; b.h = 6 + R() * 4;
			n ++;

		}

	}

	// a bird goes for a spot: a dive at the bobber or a grab at the landed fish ('steal' squawks on arrival)
	_dive( b, to, kind ) {

		b.away = { x: to.x, y: ( to.y || 0 ) + ( kind === 'steal' ? 1.4 : 1.2 ), z: to.z };
		b.kind = kind;
		this._set( b, 'swoop', 5 );

	}

	// kind: 'cast' | 'bite' | 'strike' | 'miss' | 'catch' | 'stow'; at: where it happened
	cue( kind, at = null ) {

		if ( ! ( kind in this.cues ) ) return;
		this.cues[ kind ] ++;
		const R = this.rng;
		if ( kind === 'cast' && at ) {

			// the splash startles the birds near it (they do not come back for the lure)
			this.focus = null;
			for ( const b of this.birds ) {

				if ( b.state === 'swoop' ) continue;
				const d = Math.hypot( b.x - at.x, b.z - at.z );
				if ( d > SCARE_R ) continue;
				const ax = d > 0.5 ? ( b.x - at.x ) / d : Math.cos( b.th ), az = d > 0.5 ? ( b.z - at.z ) / d : Math.sin( b.th );
				b.away = { x: at.x + ax * 45, y: ( at.y || 0 ) + 22 + R() * 10, z: at.z + az * 45 };
				b.next = 'idle';
				this._set( b, 'scatter', 3 + R() * 2 );

			}

		} else if ( ( kind === 'bite' || kind === 'strike' ) && at ) {

			this._wheel( at );

		} else if ( kind === 'miss' ) {

			// the wheeling gulls dive at the bait; with none about, the nearest one in range comes for it
			const spot = at || this.focus;
			let divers = this.birds.filter( ( b ) => b.state === 'follow' );
			if ( ! divers.length && spot ) divers = this.nearest( spot, 1 ).filter( ( b ) => Math.hypot( b.x - spot.x, b.z - spot.z ) < 70 );
			if ( spot ) for ( const b of divers ) this._dive( b, spot, 'dive' );
			this.focus = null;

		} else if ( kind === 'catch' && at ) {

			// one thief takes the fish; any other gull on the line gives up
			const thief = this.birds.filter( ( b ) => b.state === 'follow' ).concat( this.nearest( at, 1 ) )
				.sort( ( x, y ) => Math.hypot( x.x - at.x, x.z - at.z ) - Math.hypot( y.x - at.x, y.z - at.z ) )[ 0 ];
			for ( const b of this.birds ) if ( b !== thief && b.state === 'follow' ) this._set( b, 'leave', 1.5 + R() );
			if ( thief ) this._dive( thief, at, 'steal' );
			this.focus = null;

		} else if ( kind === 'stow' ) {

			for ( const b of this.birds ) if ( b.state === 'follow' ) this._set( b, 'leave', 1.5 );
			this.focus = null;

		}

	}

	step( dt ) {

		dt = clamp( dt, 0, 0.1 );
		if ( dt <= 0 ) return;
		const R = this.rng;
		for ( const b of this.birds ) {

			let tx, ty, tz, speed = b.speed, flap = 0;
			if ( b.state === 'follow' && ! this.focus ) this._set( b, 'leave', 1.5 ); // (the line is gone)
			if ( b.state === 'follow' ) {

				// circle the bobber low
				b.th += b.dir * dt * speed / b.r;
				tx = this.focus.x + Math.cos( b.th + 0.4 * b.dir ) * b.r; tz = this.focus.z + Math.sin( b.th + 0.4 * b.dir ) * b.r;
				ty = this.focus.y + b.h;
				speed *= 0.85;

			} else if ( b.state === 'scatter' || b.state === 'swoop' ) {

				const a = b.away || { x: b.x, y: b.y + 10, z: b.z };
				tx = a.x; ty = a.y; tz = a.z;
				speed = b.state === 'scatter' ? 15 : 16;
				flap = 1;
				b.t -= dt;
				const there = Math.hypot( b.x - a.x, b.y - a.y, b.z - a.z ) < 3;
				if ( b.state === 'swoop' && there ) {

					this.squawks.push( { x: b.x, y: b.y, z: b.z, kind: b.kind } );
					b.kind = null;
					b.away = { x: b.x + b.vx * 2, y: b.y + 18, z: b.z + b.vz * 2 };
					b.next = 'idle';
					this._set( b, 'scatter', 2 );

				} else if ( b.t <= 0 ) this._set( b, 'idle', 0 );

			} else {

				// idle (and leave): soar on the thermal over the player
				if ( b.state === 'leave' ) { flap = 1; b.t -= dt; if ( b.t <= 0 ) this._set( b, 'idle' ); }
				if ( b.r < 15 ) { b.r = 18 + R() * 18; b.h = 18 + R() * 14; }
				b.th += b.dir * dt * speed / b.r;
				tx = this.cx + b.ox + Math.cos( b.th + 0.35 * b.dir ) * b.r; tz = this.cz + b.oz + Math.sin( b.th + 0.35 * b.dir ) * b.r;
				ty = b.h + Math.sin( b.th * 2 + b.seed * 9 ) * 3;

			}

			// steer: the velocity eases toward the target at the state's speed
			let dx = tx - b.x, dy = ty - b.y, dz = tz - b.z;
			const d = Math.hypot( dx, dy, dz ) || 1;
			const k = Math.min( speed, d * 2 ) / d;
			dx *= k; dy *= k; dz *= k;
			const e = 1 - Math.exp( - dt * ( flap ? 3 : 1.6 ) );
			const pvx = b.vx, pvz = b.vz;
			b.vx += ( dx - b.vx ) * e; b.vy += ( dy - b.vy ) * e; b.vz += ( dz - b.vz ) * e;
			b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
			b.y = Math.max( b.y, 1.2 ); // never into the sea
			// bank into the turn (lateral acceleration), flap when climbing hard or told to
			const sp = Math.hypot( b.vx, b.vz ) || 1;
			const lat = ( ( b.vx - pvx ) * - b.vz + ( b.vz - pvz ) * b.vx ) / ( sp * dt );
			b.bank += ( clamp( lat * 0.08, - 0.8, 0.8 ) - b.bank ) * Math.min( 1, dt * 4 );
			const climb = b.vy > 1.5 ? 1 : 0;
			// gliders beat now and then (a slow gate), like the bay's gulls
			const gate = ( Math.sin( ( b.seed * 50 + b.th * 3 ) ) > 0.7 ) ? 1 : 0;
			b.flap += ( Math.max( flap, climb, gate ) - b.flap ) * Math.min( 1, dt * 5 );

		}

	}

	counts() {

		const c = Object.fromEntries( STATES.map( ( s ) => [ s, 0 ] ) );
		for ( const b of this.birds ) c[ b.state ] ++;
		return c;

	}

}

// ~1.3 m gull: body diamonds and bent wings (gSide -1 / 1 wings, 0 body; gSpan 0 shoulder .. 1 tip), nose +z
function gullGeometry() {

	const pos = [], col = [], side = [], span = [], idx = [];
	const W = [ 0.93, 0.93, 0.91 ], GREY = [ 0.56, 0.59, 0.63 ], TIP = [ 0.06, 0.06, 0.07 ], BILL = [ 0.88, 0.72, 0.2 ];
	const v = ( x, y, z, c, s, sp ) => { pos.push( x, y, z ); col.push( ...c ); side.push( s ); span.push( sp ); return pos.length / 3 - 1; };
	const nose = v( 0, 0.01, 0.27, BILL, 0, 0 ), tail = v( 0, 0, - 0.25, W, 0, 0 );
	const lt = v( - 0.045, 0.03, 0.02, W, 0, 0 ), rt = v( 0.045, 0.03, 0.02, W, 0, 0 );
	const lb = v( - 0.04, - 0.03, 0.02, W, 0, 0 ), rb = v( 0.04, - 0.03, 0.02, W, 0, 0 );
	idx.push( nose, rt, lt, nose, lb, rb, nose, lt, lb, nose, rb, rt, tail, lt, rt, tail, rb, lb, tail, lb, lt, tail, rt, rb );
	for ( const s of [ - 1, 1 ] ) {

		const ls = v( s * 0.04, 0.02, 0.07, GREY, s, 0 ), ts = v( s * 0.04, 0.02, - 0.08, GREY, s, 0 );
		const le = v( s * 0.33, 0.05, 0.05, GREY, s, 0.5 ), te = v( s * 0.33, 0.05, - 0.09, GREY, s, 0.5 );
		const tip = v( s * 0.67, 0, - 0.06, TIP, s, 1 ), tt = v( s * 0.56, 0.01, - 0.1, TIP, s, 0.85 );
		if ( s > 0 ) idx.push( ls, le, ts, ts, le, te, le, tip, te, te, tip, tt );
		else idx.push( ls, ts, le, ts, te, le, le, te, tip, te, tt, tip );

	}

	const g = new BufferGeometry();
	g.setIndex( idx );
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'color', new Float32BufferAttribute( col, 3 ) );
	g.setAttribute( 'gSide', new Float32BufferAttribute( side, 1 ) );
	g.setAttribute( 'gSpan', new Float32BufferAttribute( span, 1 ) );
	g.computeVertexNormals();
	return g;

}

const ABOARD = new Set( [ 'boat', 'deck', 'seat', 'ride' ] );

export class GullCues {

	constructor( app, features, { count = 8, rng = Math.random } = {} ) {

		this.app = app;
		this.features = features;
		this.flock = new GullFlock( { count, rng } );
		this.mesh = null;
		this._rod = null; this._fight = null; this._phase = null; this._lineOut = false;
		this._off = [];
		this.onCue = null; // ( kind, gullSpot, waterSpot ): the water effects (CastFx) ride the same edges
		if ( features && features.on ) {

			this._off.push( features.on( 'strikeMissed', () => { const w = this._water(); this._cue( 'miss', w, w ); } ) );
			// a crew angler's catch (x, z in the event) is landed over there, the player's at the player's hands
			this._off.push( features.on( 'fishCaught', ( e ) => {

				const crew = e && e.crew && Number.isFinite( e.x ) && Number.isFinite( e.z );
				const w = crew ? { x: e.x, y: 0, z: e.z } : this._water();
				this._cue( 'catch', crew ? w : this._catchSpot(), w );

			} ) );

		}

	}

	// one cue: the flock, then whoever listens (the water effects)
	_cue( kind, at, water ) {

		this.flock.cue( kind, at );
		if ( this.onCue ) try { this.onCue( kind, at, water || at ); } catch ( e ) { /* effects must not stop the birds */ }

	}

	_water() {

		const b = this._bobber();
		return b && Number.isFinite( b.x ) && Number.isFinite( b.z ) ? { x: b.x, y: b.y, z: b.z } : null;

	}

	_build() {

		if ( this.mesh || ! this.app || ! this.app.scene ) return;
		const n = this.flock.birds.length;
		const geo = gullGeometry();
		this.gA = new InstancedBufferAttribute( new Float32Array( n * 4 ), 4 );
		this.gB = new InstancedBufferAttribute( new Float32Array( n * 4 ), 4 );
		geo.setAttribute( 'gA', this.gA );
		geo.setAttribute( 'gB', this.gB );
		geo.instanceCount = n;
		const mat = new Material( {
			name: 'GullCues',
			roughness: 0.75, metalness: 0,
			vertexColors: true,
			side: 'double',
			underwaterLighting: 'none',
			attributes: { gA: 'vec4f', gB: 'vec4f', gSide: 'f32', gSpan: 'f32' },
			vertex: /* wgsl */`
	let A = v.gA; let B = v.gB;
	let side = v.gSide; let span = v.gSpan;
	// wing beat (3 Hz) gated by the flap weight, a slight dihedral when gliding
	let beat = sin( frame.time * 19.5 + B.w * 40.0 );
	let lift = B.z * beat * 0.6 + 0.1 - ( 1.0 - B.z ) * span * span * 0.2;
	var p = v.position;
	let ang = lift * ( span * 0.6 + 0.4 );
	let ax = abs( p.x );
	p = vec3f( select( p.x, p.x * cos( ang ), side != 0.0 ), select( p.y, p.y + ax * sin( ang ), side != 0.0 ), p.z );
	// roll (bank), pitch, then yaw (nose +z)
	let cb = cos( B.y ); let sb = sin( B.y );
	p = vec3f( p.x * cb - p.y * sb, p.x * sb + p.y * cb, p.z );
	let cp = cos( B.x ); let sp = sin( B.x );
	p = vec3f( p.x, p.y * cp - p.z * sp, p.y * sp + p.z * cp );
	let cy = cos( A.w ); let sy = sin( A.w );
	p = vec3f( p.x * cy + p.z * sy, p.y, - p.x * sy + p.z * cy );
	v.useWorld = true;
	v.worldPos = A.xyz + p * 1.15;
	v.worldNormal = normalize( vec3f( 0.0, 1.0, 0.0 ) );
	v.prevWorldPos = v.worldPos;
`,
		} );
		this.mesh = new Mesh( geo, mat );
		this.mesh.name = 'GullCues';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.visible = false;
		this.app.scene.add( this.mesh );

	}

	_bobber() {

		const g = this.app && this.app.game, r = g && g.rod;
		return r && r.bobber ? r.bobber : null;

	}

	_catchSpot() {

		const p = this.app && this.app.player;
		const b = this._bobber();
		return p && p.position ? { x: p.position.x, y: p.position.y, z: p.position.z } : b ? { x: b.x, y: b.y, z: b.z } : null;

	}

	// edges of the rod / bite / fight state -> cues (the events cover the rest)
	_watch() {

		const g = this.app && this.app.game;
		if ( ! g ) return;
		const rod = g.rod ? g.rod.state : null;
		const fight = g.fight || null;
		const phase = g.bite ? g.bite.phase : null;
		const b = this._bobber();
		const at = b ? { x: b.x, y: b.y, z: b.z } : null;
		if ( rod === 'floating' && this._rod !== 'floating' && this._rod !== 'fighting' && at ) this._cue( 'cast', at, at );
		// the fish takes the bait: the gulls see the bobber go under
		if ( ! fight && phase === 'take' && this._phase !== 'take' && at ) this._cue( 'bite', at, at );
		if ( fight && ! this._fight ) this._cue( 'strike', at, at );
		else if ( ! fight && this._fight && this._fight.state === 'escaped' ) this._cue( 'miss', at, at );
		else if ( ! fight && this._phase === 'take' && phase === 'wait' ) this._cue( 'miss', at, at );
		const lineOut = !! ( g.rod && 'lineInWater' in g.rod ? g.rod.lineInWater : rod && rod !== 'idle' && rod !== 'stowed' && rod !== 'windup' );
		if ( this._lineOut && ! lineOut && ! fight ) this._cue( 'stow', null, null );
		if ( this.flock.focus && at && ( rod === 'floating' || rod === 'fighting' ) ) { this.flock.focus.x = at.x; this.flock.focus.z = at.z; }
		this._rod = rod; this._fight = fight; this._phase = phase; this._lineOut = lineOut;

	}

	// a thief reaching the fish squawks (the dive at a lost bait is silent): an event for anyone, the audio's gull call
	_squawk() {

		const q = this.flock.squawks;
		if ( ! q.length ) return;
		const list = q.splice( 0, q.length );
		if ( this.roosting ) return;
		for ( const s of list ) {

			if ( s.kind !== 'steal' ) continue;
			this.squawked = ( this.squawked | 0 ) + 1;
			if ( this.features && this.features.emit ) this.features.emit( 'gullSquawk', { x: s.x, y: s.y, z: s.z } );
			const au = this.app && this.app.audio;
			if ( au && typeof au.gullCall === 'function' ) try { au.gullCall( s ); } catch ( e ) { /* no sound */ }

		}

	}

	get roosting() {

		const s = this.app && this.app.settings;
		const h = s && Number.isFinite( s.timeOfDay ) ? s.timeOfDay : 12;
		return h < 5.5 || h > 20;

	}

	update( dt ) {

		const app = this.app;
		const p = app && app.player;
		if ( ! p || ! p.position ) return;
		this._watch();
		const ax = ABOARD.has( p.mode ) && app.boatCtl && app.boatCtl.position ? app.boatCtl.position : p.position;
		this.flock.anchor( ax.x, ax.z );
		this.flock.step( dt );
		this._squawk();
		if ( ! this.mesh ) this._build();
		if ( ! this.mesh ) return;
		this.mesh.visible = ! this.roosting && ! ( app.camera && app.camera.position.y < ( app.cameraWaterHeight ?? 0 ) );
		if ( ! this.mesh.visible ) return;
		const A = this.gA.array, B = this.gB.array;
		this.flock.birds.forEach( ( b, i ) => {

			const sp = Math.hypot( b.vx, b.vz );
			A[ i * 4 ] = b.x; A[ i * 4 + 1 ] = b.y; A[ i * 4 + 2 ] = b.z; A[ i * 4 + 3 ] = Math.atan2( b.vx, b.vz );
			B[ i * 4 ] = - clamp( Math.atan2( b.vy, sp || 1 ), - 0.6, 0.6 ); B[ i * 4 + 1 ] = b.bank; B[ i * 4 + 2 ] = b.flap; B[ i * 4 + 3 ] = b.seed;

		} );
		this.gA.needsUpdate = true;
		this.gB.needsUpdate = true;

	}

	dispose() {

		for ( const off of this._off ) try { off(); } catch ( e ) { /* gone */ }
		this._off.length = 0;
		if ( this.mesh && this.mesh.parent ) this.mesh.parent.remove( this.mesh );
		this.mesh = null;

	}

}
