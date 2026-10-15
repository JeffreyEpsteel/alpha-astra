// Physics facade: rigid bodies, breakable joints, terrain heightfield contacts, buoyancy and drag, sleeping, a fixed 1/60
// step. The engine underneath is Rapier (src/physics/rapier/RapierBackend.js); see src/physics/README.md for why.
//
//   await initPhysics();                                    // once (App may await it before installing features)
//   const world = new PhysicsWorld( { heightAt: ( x, z ) => terrain.heightAt( x, z ), oceanHeight: ( x, z, t ) => 0,
//                                     statics: ( x0, z0, x1, z1 ) => [ ...static colliders ], maxBodies: 300 } );
//   const b = world.addBody( { shape: 'box', size: [ 1, 0.1, 0.3 ], position, quaternion, density: 600, group: 'crate.3' } );
//   const j = world.addJoint( a, b, { anchor: { x, y, z }, breakForce: 800 } );   // a null: to the world
//   world.onBreak( ( joint ) => ... );  world.step( dt );  world.alpha  (interpolation: b.prevPosition -> b.position)
//   world.raycast( ax, ay, az, bx, by, bz ) -> { t (0..1), body, x, y, z, nx, ny, nz } | null
//   world.impulse( x, y, z, radius, energy ) -> bodies pushed
//
// Shapes: 'box' (size: full widths, or hx/hy/hz), 'sphere' (radius), 'cylinder' (radius, height; axis along local y),
// 'convex' (points: flat [x, y, z, ...] in body space), 'capsule' (radius, height; kinematic proxies). Types: 'dynamic'
// (default), 'fixed', 'kinematic' (setKinematic each frame: the player's boat and feet push debris).
// Joint loads: src/physics/JointLoad.js. The body budget (maxBodies) counts dynamic bodies; addBody returns null past it.

import { buoyancy } from './Buoyancy.js';
import { solveJointLoads } from './JointLoad.js';

export const FIXED_DT = 1 / 60;
export const MAX_BODIES = 300;

let _backend = null, _loading = null, _failed = null;

// loads the backend (Rapier WASM). Resolves to true, or false when it cannot run here (the game keeps going without loose debris)
export function initPhysics() {

	if ( ! _loading ) {

		_loading = import( './rapier/RapierBackend.js' )
			.then( async ( m ) => { await m.loadRapier(); _backend = m; return true; } )
			.catch( ( e ) => { _failed = e; console.warn( 'physics: Rapier failed to load', e ); return false; } );

	}

	return _loading;

}

export const physicsReady = () => !! _backend;
export const physicsError = () => _failed;

const now = () => ( typeof performance !== 'undefined' ? performance.now() : Date.now() );
const v3 = ( x = 0, y = 0, z = 0 ) => ( { x, y, z } );
const _f = { fx: 0, fy: 0, fz: 0, frac: 0 };

// rotate ( x, y, z ) by the inverse of q (world -> body space): v + w t + r x t with r = -q.xyz, t = 2 r x v
function rotInv( q, x, y, z, out ) {

	const rx = - q.x, ry = - q.y, rz = - q.z, w = q.w;
	const tx = 2 * ( ry * z - rz * y ), ty = 2 * ( rz * x - rx * z ), tz = 2 * ( rx * y - ry * x );
	out.x = x + w * tx + ( ry * tz - rz * ty );
	out.y = y + w * ty + ( rz * tx - rx * tz );
	out.z = z + w * tz + ( rx * ty - ry * tx );
	return out;

}

export class Body {

	constructor( world, d, native, mass ) {

		this.world = world;
		this.id = world._nextId ++;
		this.native = native;
		this.handle = native.handle;
		this.type = d.type || 'dynamic';
		this.shape = d.shape || 'box';
		this.hx = d.hx; this.hy = d.hy; this.hz = d.hz; this.radius = d.radius || 0;
		this.volume = d.volume;
		this.mass = mass;
		this.buoyancy = d.buoyancy ?? 1; // 0: never floats
		this.group = d.group ?? null; // contacts inside a group do not anchor its joint loads
		this.userData = d.userData ?? null;
		this.bound = d.bound; // bounding radius
		const p = d.position || v3(), q = d.quaternion || { x: 0, y: 0, z: 0, w: 1 };
		this.position = v3( p.x, p.y, p.z );
		this.quaternion = { x: q.x, y: q.y, z: q.z, w: q.w };
		this.prevPosition = v3( p.x, p.y, p.z );
		this.prevQuaternion = { x: q.x, y: q.y, z: q.z, w: q.w };
		this.velocity = d.velocity ? v3( d.velocity.x, d.velocity.y, d.velocity.z ) : v3();
		this.angularVelocity = v3();
		this.force = v3(); // a steady force the game applies (N), kept until changed
		this.sleeping = false;
		this.frac = 0; // submerged fraction
		this.joints = new Set();
		this.removed = false;
		this.born = world.time;
		this.node = { phi: v3(), R: v3(), anchored: false, links: [], body: this };
		this._vPrev = v3();
		this._known = v3();
		this._imp = v3();
		this._forced = false;
		this._damp = - 1;

	}

	get dynamic() { return this.type === 'dynamic'; }

	applyImpulse( ix, iy, iz, px, py, pz ) {

		if ( this.removed || ! this.dynamic ) return;
		this.world.backend.applyImpulse( this.native, ix, iy, iz, px, py, pz );
		this._imp.x += ix; this._imp.y += iy; this._imp.z += iz;
		this.sleeping = false;

	}

	setVelocity( v, w ) {

		if ( this.removed || ! this.dynamic ) return;
		this.world.backend.setVelocity( this.native, v, w );
		if ( v ) { this.velocity.x = v.x; this.velocity.y = v.y; this.velocity.z = v.z; }
		this.sleeping = false;

	}

	wake() {

		if ( ! this.removed && this.dynamic ) { this.world.backend.wake( this.native ); this.sleeping = false; }

	}

	// kinematic bodies: where to be at the end of the next step
	setKinematic( p, q ) {

		if ( this.removed ) return;
		this.world.backend.setKinematicPose( this.native, p, q );
		this._kp = { x: p.x, y: p.y, z: p.z };
		if ( q ) this._kq = { x: q.x, y: q.y, z: q.z, w: q.w };

	}

	remove() {

		this.world.removeBody( this );

	}

}

export class Joint {

	constructor( world, a, b, anchor, breakForce, native ) {

		this.world = world;
		this.a = a; this.b = b;
		this.anchor = v3( anchor.x, anchor.y, anchor.z ); // world point at creation
		this.breakForce = breakForce;
		this.native = native;
		this.load = 0; // N, the last step's estimate
		this.peak = 0;
		this.broken = false;
		this.born = world.time;
		this.userData = null;

	}

	remove() {

		this.world.removeJoint( this );

	}

}

export class PhysicsWorld {

	static async create( opts = {} ) {

		if ( ! await initPhysics() ) throw _failed || new Error( 'physics unavailable' );
		return new PhysicsWorld( opts );

	}

	constructor( {
		gravity = - 9.81, fixedDt = FIXED_DT, maxSteps = 3, iterations = 4, maxBodies = MAX_BODIES,
		heightAt = null, oceanHeight = null, statics = null, tileSize = 16, tileCells = 16, breakGrace = 0,
	} = {} ) {

		if ( ! _backend ) throw new Error( 'PhysicsWorld: await initPhysics() first' );
		this.gravity = gravity;
		this.fixedDt = fixedDt;
		this.maxSteps = maxSteps;
		this.maxBodies = maxBodies;
		this.heightAt = heightAt;
		this.oceanHeight = oceanHeight;
		this.statics = statics;
		this.tileSize = tileSize;
		this.tileCells = tileCells;
		this.breakGrace = breakGrace * fixedDt;
		this.backend = new _backend.RapierBackend( { gravity, dt: fixedDt, iterations } );
		this._nextId = 1;
		this.bodies = new Set();
		this.byHandle = new Map(); // collider handle -> Body
		this.joints = new Set();
		this.tiles = new Map(); // "i,j" -> { native, used }
		this.tileHandles = new Set();
		this.staticMirror = new Map(); // key object -> native
		this.staticHandles = new Set();
		this.time = 0;
		this.acc = 0;
		this.alpha = 0;
		this.steps = 0;
		this.stepMs = 0;
		this.dynamicCount = 0;
		this._breakFns = new Set();
		this._tileTick = 0;

	}

	get count() { return this.dynamicCount; }

	onBreak( fn ) {

		this._breakFns.add( fn );
		return () => this._breakFns.delete( fn );

	}

	// ---- bodies

	addBody( d0 ) {

		const d = { ...d0 };
		d.type = d.type || 'dynamic';
		if ( d.type === 'dynamic' && this.dynamicCount >= this.maxBodies ) return null;
		d.shape = d.shape || 'box';
		if ( d.shape === 'box' ) {

			if ( d.size ) { d.hx = d.size[ 0 ] / 2; d.hy = d.size[ 1 ] / 2; d.hz = d.size[ 2 ] / 2; }
			d.hx = d.hx || 0.25; d.hy = d.hy || 0.25; d.hz = d.hz || 0.25;
			d.volume = 8 * d.hx * d.hy * d.hz;
			d.bound = Math.hypot( d.hx, d.hy, d.hz );

		} else if ( d.shape === 'sphere' ) {

			d.radius = d.radius || 0.25;
			d.hx = d.hy = d.hz = d.radius;
			d.volume = 4 / 3 * Math.PI * d.radius ** 3;
			d.bound = d.radius;

		} else if ( d.shape === 'cylinder' || d.shape === 'capsule' ) {

			d.radius = d.radius || 0.25;
			const h = d.height || 0.5;
			d.halfHeight = d.shape === 'capsule' ? Math.max( 0.01, h / 2 - d.radius ) : h / 2;
			d.hx = d.hz = d.radius; d.hy = h / 2;
			d.volume = Math.PI * d.radius * d.radius * h;
			d.bound = Math.hypot( d.radius, h / 2 );

		} else if ( d.shape === 'convex' ) {

			const pts = d.points instanceof Float32Array ? d.points : new Float32Array( d.points || [] );
			d.points = pts;
			let mx = 0, my = 0, mz = 0, r = 0;
			for ( let i = 0; i < pts.length; i += 3 ) {

				mx = Math.max( mx, Math.abs( pts[ i ] ) ); my = Math.max( my, Math.abs( pts[ i + 1 ] ) ); mz = Math.max( mz, Math.abs( pts[ i + 2 ] ) );
				r = Math.max( r, Math.hypot( pts[ i ], pts[ i + 1 ], pts[ i + 2 ] ) );

			}

			d.hx = mx; d.hy = my; d.hz = mz;
			d.volume = 8 * mx * my * mz * 0.55; // a rounded hull fills about half its box
			d.bound = r;

		}

		const native = this.backend.createBody( d );
		const mass = d.type === 'dynamic' ? this.backend.mass( native ) : Infinity;
		const b = new Body( this, d, native, mass );
		this.bodies.add( b );
		this.byHandle.set( b.handle, b );
		if ( b.dynamic ) this.dynamicCount ++;
		return b;

	}

	removeBody( b ) {

		if ( ! b || b.removed ) return;
		for ( const j of [ ...b.joints ] ) this.removeJoint( j );
		b.removed = true;
		this.backend.removeBody( b.native );
		this.bodies.delete( b );
		this.byHandle.delete( b.handle );
		if ( b.dynamic ) this.dynamicCount --;

	}

	// ---- joints: fixed, holding the bodies as they are now; anchor: a world point (default: between the two)

	addJoint( a, b, { anchor = null, breakForce = Infinity } = {} ) {

		if ( ! b || b.removed || ( a && a.removed ) ) return null;
		const p = anchor || ( a ? v3( ( a.position.x + b.position.x ) / 2, ( a.position.y + b.position.y ) / 2, ( a.position.z + b.position.z ) / 2 ) : b.position );
		const la = a ? rotInv( a.quaternion, p.x - a.position.x, p.y - a.position.y, p.z - a.position.z, v3() ) : v3( p.x, p.y, p.z );
		const lb = rotInv( b.quaternion, p.x - b.position.x, p.y - b.position.y, p.z - b.position.z, v3() );
		const fa = a ? { x: - a.quaternion.x, y: - a.quaternion.y, z: - a.quaternion.z, w: a.quaternion.w } : { x: 0, y: 0, z: 0, w: 1 };
		const fb = { x: - b.quaternion.x, y: - b.quaternion.y, z: - b.quaternion.z, w: b.quaternion.w };
		const native = this.backend.createJoint( a ? a.native : null, b.native, la, fa, lb, fb );
		const j = new Joint( this, a, b, p, breakForce, native );
		this.joints.add( j );
		if ( a ) a.joints.add( j );
		b.joints.add( j );
		return j;

	}

	removeJoint( j ) {

		if ( ! j || ! this.joints.has( j ) ) return;
		this.joints.delete( j );
		if ( j.a ) j.a.joints.delete( j );
		j.b.joints.delete( j );
		this.backend.removeJoint( j.native );

	}

	breakJoint( j ) {

		if ( ! j || j.broken || ! this.joints.has( j ) ) return;
		j.broken = true;
		this.removeJoint( j );
		if ( j.a ) j.a.wake();
		j.b.wake();
		for ( const fn of this._breakFns ) try { fn( j ); } catch ( e ) { console.warn( 'physics onBreak listener failed', e ); }

	}

	// ---- stepping

	step( dt ) {

		if ( ! ( dt > 0 ) ) return 0;
		this.acc += Math.min( dt, 0.25 );
		let n = 0;
		while ( this.acc >= this.fixedDt && n < this.maxSteps ) {

			this._substep();
			this.acc -= this.fixedDt;
			n ++;

		}

		if ( n === this.maxSteps && this.acc > this.fixedDt ) this.acc = this.fixedDt * 0.5; // fell behind: drop the backlog
		this.alpha = this.acc / this.fixedDt;
		return n;

	}

	_substep() {

		const t0 = now(), be = this.backend, dt = this.fixedDt, g = - this.gravity;
		const ocean = this.oceanHeight;
		let tilesDue = ( this._tileTick ++ % 6 ) === 0;
		for ( const b of this.bodies ) {

			if ( b.type === 'kinematic' ) {

				b.prevPosition.x = b.position.x; b.prevPosition.y = b.position.y; b.prevPosition.z = b.position.z;
				if ( b._kp ) { b.position.x = b._kp.x; b.position.y = b._kp.y; b.position.z = b._kp.z; }
				if ( b._kq ) Object.assign( b.quaternion, b._kq );
				continue;

			}

			if ( ! b.dynamic ) continue;
			const p = b.position;
			b.prevPosition.x = p.x; b.prevPosition.y = p.y; b.prevPosition.z = p.z;
			const q = b.quaternion, pq = b.prevQuaternion;
			pq.x = q.x; pq.y = q.y; pq.z = q.z; pq.w = q.w;
			b._vPrev.x = b.velocity.x; b._vPrev.y = b.velocity.y; b._vPrev.z = b.velocity.z;
			let fx = b.force.x, fy = b.force.y, fz = b.force.z;
			b.frac = 0;
			if ( ocean && b.buoyancy > 0 ) {

				const s = ocean( p.x, p.z, this.time );
				if ( p.y - b.bound < s ) {

					buoyancy( b, s, g, _f );
					b.frac = _f.frac;
					fx += _f.fx; fy += _f.fy; fz += _f.fz;

				}

			}

			// water damps the spin too; change the damping only when the fraction moved enough to matter
			const damp = Math.round( b.frac * 4 );
			if ( damp !== b._damp ) { be.setDamping( b.native, 0.02 + b.frac * 0.4, 0.05 + b.frac * 1.6 ); b._damp = damp; }
			const forced = fx !== 0 || fy !== 0 || fz !== 0;
			if ( forced || b._forced ) { if ( ! b.sleeping || forced ) be.setForce( b.native, fx, fy, fz ); b._forced = forced; }
			b._known.x = fx; b._known.y = fy; b._known.z = fz;
			if ( tilesDue && ! b.sleeping ) this._ensureTiles( p.x, p.z, b.bound );

		}

		if ( tilesDue ) this._dropTiles();
		be.step();
		this.time += dt;
		this.steps ++;

		// poses back, sleep flags
		for ( const b of this.bodies ) {

			if ( ! b.dynamic ) continue;
			const was = b.sleeping;
			b.sleeping = be.isSleeping( b.native );
			if ( b.sleeping && was ) { b.velocity.x = b.velocity.y = b.velocity.z = 0; continue; }
			be.readPose( b.native, b.position, b.quaternion, b.velocity, b.angularVelocity );

		}

		this._loads( dt, g );
		for ( const b of this.bodies ) { b._imp.x = 0; b._imp.y = 0; b._imp.z = 0; }
		const ms = now() - t0;
		this.stepMs = this.stepMs ? this.stepMs * 0.9 + ms * 0.1 : ms;

	}

	// estimate every awake joint's load and break the ones past their break force
	_loads( dt, g ) {

		if ( ! this.joints.size ) return;
		const nodes = [], joints = [];
		const seen = new Set();
		for ( const j of this.joints ) {

			const sa = ! j.a || j.a.sleeping || ! j.a.dynamic, sb = j.b.sleeping || ! j.b.dynamic;
			if ( sa && sb ) { j.load = 0; continue; } // nothing moving: nothing new to carry
			joints.push( j );
			if ( j.a && ! seen.has( j.a ) ) { seen.add( j.a ); nodes.push( j.a.node ); }
			if ( ! seen.has( j.b ) ) { seen.add( j.b ); nodes.push( j.b.node ); }

		}

		if ( ! joints.length ) return;
		const be = this.backend;
		for ( const n of nodes ) {

			const b = n.body;
			if ( ! b.dynamic ) { n.anchored = true; continue; }
			const m = b.mass, v = b.velocity, w = b._vPrev, k = b._known, J = b._imp;
			n.R.x = m * ( v.x - w.x ) / dt - k.x - J.x / dt;
			n.R.y = m * ( ( v.y - w.y ) / dt + g ) - k.y - J.y / dt;
			n.R.z = m * ( v.z - w.z ) / dt - k.z - J.z / dt;
			const grp = b.group;
			n.anchored = b.sleeping || be.touching( b.native, ( h ) => {

				if ( this.tileHandles.has( h ) || this.staticHandles.has( h ) ) return false;
				const o = this.byHandle.get( h );
				if ( ! o ) return false;
				if ( grp !== null && o.group === grp ) return true;
				for ( const j of b.joints ) if ( j.a === o || j.b === o ) return true;
				return false;

			} );

		}

		solveJointLoads( nodes, joints );
		const broken = [];
		for ( const j of joints ) {

			j.peak = Math.max( j.peak, j.load );
			if ( j.load > j.breakForce && this.time - j.born > this.breakGrace ) broken.push( j );

		}

		for ( const j of broken ) this.breakJoint( j );

	}

	// ---- terrain: heightfield tiles appear under awake bodies and go after a while unused

	_ensureTiles( x, z, r ) {

		if ( ! this.heightAt ) return;
		const T = this.tileSize, m = r + 1.5;
		const i0 = Math.floor( ( x - m ) / T ), i1 = Math.floor( ( x + m ) / T ), j0 = Math.floor( ( z - m ) / T ), j1 = Math.floor( ( z + m ) / T );
		for ( let i = i0; i <= i1; i ++ ) for ( let j = j0; j <= j1; j ++ ) this._tile( i, j );

	}

	_tile( i, j ) {

		const key = i + ',' + j;
		let t = this.tiles.get( key );
		if ( t ) { t.used = this.time; return t; }
		const T = this.tileSize, n = this.tileCells, c = T / n, x0 = i * T, z0 = j * T;
		const hs = new Float32Array( ( n + 1 ) * ( n + 1 ) );
		for ( let ix = 0; ix <= n; ix ++ ) for ( let iz = 0; iz <= n; iz ++ ) hs[ iz + ix * ( n + 1 ) ] = this.heightAt( x0 + ix * c, z0 + iz * c );
		const native = this.backend.createHeightfield( n, hs, T, x0 + T / 2, z0 + T / 2 );
		t = { native, used: this.time, key };
		this.tiles.set( key, t );
		this.tileHandles.add( native.handle );
		if ( this.statics ) this._mirror( x0, z0, x0 + T, z0 + T );
		return t;

	}

	_dropTiles() {

		for ( const [ key, t ] of this.tiles ) {

			if ( this.time - t.used < 30 ) continue;
			this.backend.removeCollider( t.native );
			this.tileHandles.delete( t.native.handle );
			this.tiles.delete( key );

		}

	}

	// static world colliders (decks, walls, piles) near the debris: { key, shape, position, quaternion, hx, hy, hz, radius, height }
	_mirror( x0, z0, x1, z1 ) {

		let list = null;
		try { list = this.statics( x0, z0, x1, z1 ); } catch ( e ) { list = null; }
		if ( ! list ) return;
		for ( const s of list ) {

			const k = s.key || s;
			if ( this.staticMirror.has( k ) ) continue;
			const d = { ...s };
			if ( d.shape === 'cylinder' ) d.halfHeight = ( d.height || 1 ) / 2;
			const native = this.backend.createStatic( d );
			this.staticMirror.set( k, native );
			if ( native ) this.staticHandles.add( native.handle );

		}

	}

	removeStatic( key ) {

		const n = this.staticMirror.get( key );
		if ( ! n ) return;
		this.staticMirror.delete( key );
		this.staticHandles.delete( n.handle );
		this.backend.removeCollider( n );

	}

	// ---- queries

	// nearest body along the segment a -> b (dynamic and fixed bodies; not the terrain, statics or kinematic proxies)
	raycast( ax, ay, az, bx, by, bz, { filter = null, terrain = false } = {} ) {

		const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot( dx, dy, dz );
		if ( len < 1e-6 ) return null;
		const keep = ( h ) => {

			if ( terrain && this.tileHandles.has( h ) ) return true;
			const b = this.byHandle.get( h );
			if ( ! b || b.type === 'kinematic' ) return false;
			return filter ? filter( b ) : true;

		};
		if ( terrain ) this._ensureTiles( ( ax + bx ) / 2, ( az + bz ) / 2, len / 2 );
		const hit = this.backend.castRay( ax, ay, az, dx / len, dy / len, dz / len, len, keep );
		if ( ! hit ) return null;
		const t = hit.t / len;
		return { t, body: this.byHandle.get( hit.handle ) || null, x: ax + dx * t, y: ay + dy * t, z: az + dz * t, nx: hit.nx, ny: hit.ny, nz: hit.nz };

	}

	// a blast: every dynamic body within radius gets a share of `energy` (J) as kinetic energy, pushed away from the centre
	// (a little upward), applied off-centre so it tumbles. maxDv caps the speed it can give.
	impulse( x, y, z, radius, energy, { maxDv = 18, up = 0.35, filter = null } = {} ) {

		if ( ! ( radius > 0 ) || ! ( energy > 0 ) ) return 0;
		const hits = [];
		let wsum = 0;
		for ( const b of this.bodies ) {

			if ( ! b.dynamic || ( filter && ! filter( b ) ) ) continue;
			const p = b.position, d = Math.hypot( p.x - x, p.y - y, p.z - z );
			const e = Math.max( 0, d - b.bound * 0.5 );
			if ( e >= radius ) continue;
			const w = ( 1 - e / radius ) ** 2;
			hits.push( [ b, w, d ] );
			wsum += w;

		}

		for ( const [ b, w, d ] of hits ) {

			const E = energy * w / Math.max( 1, wsum );
			const dv = Math.min( maxDv, Math.sqrt( 2 * E / b.mass ) );
			const p = b.position;
			let nx = d > 1e-4 ? ( p.x - x ) / d : 0, ny = d > 1e-4 ? ( p.y - y ) / d : 1, nz = d > 1e-4 ? ( p.z - z ) / d : 0;
			ny += up;
			const l = Math.hypot( nx, ny, nz ) || 1;
			nx /= l; ny /= l; nz /= l;
			const J = b.mass * dv, o = b.bound * 0.4;
			b.applyImpulse( nx * J, ny * J, nz * J, p.x - nx * o, p.y - ny * o, p.z - nz * o );

		}

		return hits.length;

	}

	stats() {

		let awake = 0;
		for ( const b of this.bodies ) if ( b.dynamic && ! b.sleeping ) awake ++;
		return { bodies: this.dynamicCount, awake, joints: this.joints.size, tiles: this.tiles.size, statics: this.staticMirror.size, stepMs: this.stepMs, steps: this.steps };

	}

	dispose() {

		this.backend.dispose();
		this.bodies.clear();
		this.joints.clear();
		this.tiles.clear();
		this.byHandle.clear();

	}

}
