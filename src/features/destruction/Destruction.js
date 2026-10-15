// The destruction feature: breakable props round the harbours, the raider camp and the shoals (see index.js for the contract).
//
// A whole prop is static: one collider in app.colliders (the player and the boat bump into it), one fixed box in the physics
// world (loose debris lands on it) and its pieces drawn at rest. Damage (cannonballs, explosions, melee, ramming, a seaplane
// crash) adds up; past the kind's toughness the prop breaks: its collider goes, its pieces become physics bodies joined
// where they touch (posts held to the world at their feet), the joints near the hit are cut and the rest break under load
// (src/physics/JointLoad.js) as the blast throws the pieces. Loose pieces settle, sleep, float if wooden and fade after
// about a minute; pieces still standing on an anchored post stay as a wreck until the prop respawns.

import { WORLD } from '../../world/WorldLayout.js';
import { Vector3 } from '../../engine/index.js';
import { KINDS, buildKind, shatterLayout, layoutBounds, pieceHalf, rockHull, quatYXZ, quatMul, rotate, rngFor } from './Kinds.js';
import { planProps, keepOutFrom } from './Sites.js';
import { strongholdPlan } from '../../world/islands/stronghold/Kinds.js';
import { initPhysics, physicsReady, PhysicsWorld } from '../../physics/World.js';

export const RESPAWN_HOURS = 6; // in-game hours (campaign)
export const FADE_AFTER = 60; // s before loose pieces fade
export const FADE_TIME = 2.5;
export const MELEE_ENERGY = 450; // J per paddle blow
export const CANNON_ENERGY = 40000; // J when an impact names none
export const EXPLOSION = { radius: 6, energy: 120000 };
export const MAX_BODIES = 300;
const CLOCK_SPEED = 0.01; // h per real second (net/Protocol.js CLOCK_SPEED): turns respawn hours into the server's seconds
const REAL_FALLBACK = 24 / 2400; // h per real second when the island clock is stopped
const RESPAWN_CLEAR = 25; // m: nothing pops back in closer than this to the player
const BOAT_MASS = 3200;
const RAM_POINTS = [ [ 0, 3.6 ], [ 1.1, 2.0 ], [ - 1.1, 2.0 ], [ 1.3, - 1 ], [ - 1.3, - 1 ] ]; // hull points (boat frame) that break props when ramming

const _v = new Vector3();

// a little swell for floating debris (the GPU ocean is not readable on the CPU every frame)
export const swell = ( x, z, t ) => 0.12 * Math.sin( 0.21 * x + 0.9 * t ) + 0.08 * Math.sin( 0.17 * z + 1.3 * t + 1.7 );

function hoursForward( a, b ) {

	let d = b - a;
	if ( d < - 12 ) d += 24;
	return d > 0 ? d : 0;

}

export class Destruction {

	constructor( app, features, opts = {} ) {

		this.app = app;
		this.features = features;
		this.opts = opts;
		this.props = [];
		this.byId = new Map();
		this.broken = new Map(); // id -> respawn hour (Infinity: only a reset brings it back)
		this.pending = null; // saved state waiting for build()
		this.groups = []; // loose debris: { prop, items: [ { body, piece, fade } ], born }
		this.world = null;
		this.render = null;
		this.built = false;
		this.frames = 0;
		this.time = 0;
		this.hours = 0;
		this._lastHour = null;
		this._swing = false;
		this._meleeEventAt = - 1;
		this._ramAt = new Map();
		this._respawnTick = 0;
		this.stats = { destroyed: 0, remote: 0, respawned: 0, jointBreaks: 0 };
		this.disposed = false;
		this.physicsState = 'off';

		const on = ( n, fn ) => features && features.on ? features.on( n, fn ) : () => {};
		this._off = [
			on( 'cannonballImpact', ( e ) => this._onCannon( e ) ),
			on( 'explosion', ( e ) => e && this.blast( e.x, e.y, e.z, e.radius ?? EXPLOSION.radius, e.energy ?? EXPLOSION.energy, e.by || 'explosion' ) ),
			on( 'meleeHit', ( e ) => { if ( e ) { this._meleeEventAt = this.time; this.strike( e.x, e.y, e.z, e.range ?? 1.4, e.energy ?? MELEE_ENERGY, e.by || 'player' ); } } ),
			on( 'planeCrashed', ( e ) => this._onCrash( e ) ),
			on( 'remoteWorldEvent', ( e ) => this._onRemote( e ) ),
		];

		if ( opts.physics !== false ) {

			this.physicsState = 'loading';
			initPhysics().then( ( okay ) => {

				if ( this.disposed ) return;
				if ( okay ) this._makeWorld(); else this.physicsState = 'failed';

			} );

		}

	}

	// ---- building

	build() {

		if ( this.built ) return this;
		this.built = true;
		const app = this.app, T = app.terrainData;
		if ( ! T ) return this;
		// the scattered / authored props, then Blackwater's fort (palisade, gun platforms, powder: the stronghold feature reads them)
		const plan = this.opts.plan || [ ...planProps( { terrain: T, colliders: app.colliders || null, keep: keepOutFrom( app, this.features ), ports: WORLD.ports } ), ...strongholdPlan( T ) ];
		for ( const p of plan ) this._addProp( p );
		if ( app.scene && this.opts.render !== false ) {

			import( './Render.js' ).then( ( m ) => {

				if ( this.disposed ) return;
				try { this.render = new m.PropRender( app.scene ); this._dirty = true; } catch ( e ) { console.warn( 'destruction: props cannot be drawn', e ); }

			} );

		}

		if ( this.pending ) { this._applySaved( this.pending ); this.pending = null; }
		if ( this.world ) for ( const p of this.props ) this._fixedBody( p );
		return this;

	}

	_addProp( plan ) {

		const lay = buildKind( plan.kind, rngFor( plan.site + plan.kind + plan.id ), plan.opts || {} );
		const q = quatYXZ( plan.yaw );
		const prop = {
			...plan, K: KINDS[ plan.kind ], layout: lay, quat: q, state: 'intact', damage: 0, colliders: [], fixed: null,
			bounds: layoutBounds( lay.pieces ), world: [],
		};
		// world poses of the pieces at rest
		for ( const pc of lay.pieces ) {

			const r = rotate( q, pc.pos.x, pc.pos.y, pc.pos.z );
			prop.world.push( { pos: { x: plan.x + r.x, y: plan.y + r.y, z: plan.z + r.z }, quat: quatMul( q, pc.quat ) } );

		}

		const c = rotate( q, prop.bounds.center.x, prop.bounds.center.y, prop.bounds.center.z );
		prop.center = { x: plan.x + c.x, y: plan.y + c.y, z: plan.z + c.z };
		prop.half = prop.bounds.half;
		prop.radius = prop.bounds.radius;
		this.props.push( prop );
		this.byId.set( prop.id, prop );
		this._addColliders( prop );
		return prop;

	}

	_addColliders( prop ) {

		const C = this.app.colliders;
		if ( ! C || prop.colliders.length ) return;
		const h = prop.half;
		// Colliders turns boxes about y with the same convention as the prop yaw
		prop.colliders.push( C.addBox( _v.set( prop.center.x, prop.center.y, prop.center.z ), new Vector3( Math.max( 0.05, h.x ), Math.max( 0.05, h.y ), Math.max( 0.05, h.z ) ), prop.yaw, { solid: true, tag: 'destructible' } ) );

	}

	_removeColliders( prop ) {

		const C = this.app.colliders;
		if ( ! C ) { prop.colliders.length = 0; return; }
		for ( const b of prop.colliders ) {

			const i = C.boxes.indexOf( b );
			if ( i >= 0 ) C.boxes.splice( i, 1 );

		}

		prop.colliders.length = 0;

	}

	// ---- physics

	_makeWorld() {

		const app = this.app, T = app.terrainData;
		try {

			this.world = new PhysicsWorld( {
				heightAt: T ? ( x, z ) => T.heightAt( x, z ) : () => - 50,
				oceanHeight: this.opts.oceanHeight || swell,
				statics: ( x0, z0, x1, z1 ) => this._statics( x0, z0, x1, z1 ),
				maxBodies: this.opts.maxBodies || MAX_BODIES,
			} );

		} catch ( e ) {

			console.warn( 'destruction: physics world failed', e );
			this.physicsState = 'failed';
			return;

		}

		this.physicsState = 'ready';
		this.world.onBreak( ( j ) => this._onJointBreak( j ) );
		for ( const p of this.props ) this._fixedBody( p );

	}

	_fixedBody( prop ) {

		if ( ! this.world || prop.fixed || prop.state !== 'intact' ) return;
		const h = prop.half;
		prop.fixed = this.world.addBody( { type: 'fixed', shape: 'box', hx: Math.max( 0.05, h.x ), hy: Math.max( 0.05, h.y ), hz: Math.max( 0.05, h.z ), position: prop.center, quaternion: prop.quat, group: prop.id, userData: { prop: prop.id } } );

	}

	// static world colliders near new terrain tiles: decks, walls, piles (not ours: intact props have their own fixed boxes)
	_statics( x0, z0, x1, z1 ) {

		const C = this.app.colliders, out = [];
		if ( ! C ) return out;
		for ( const b of C.boxes ) {

			if ( b.tag === 'destructible' ) continue;
			const c = b.center;
			if ( c.x + b.radius < x0 || c.x - b.radius > x1 || c.z + b.radius < z0 || c.z - b.radius > z1 ) continue;
			out.push( { key: b, shape: 'box', position: { x: c.x, y: c.y, z: c.z }, quaternion: { x: 0, y: Math.sin( b.rotY / 2 ), z: 0, w: Math.cos( b.rotY / 2 ) }, hx: b.half.x, hy: b.half.y, hz: b.half.z } );

		}

		for ( const c of C.cylinders ) {

			if ( c.x + c.radius < x0 || c.x - c.radius > x1 || c.z + c.radius < z0 || c.z - c.radius > z1 ) continue;
			out.push( { key: c, shape: 'cylinder', position: { x: c.x, y: ( c.yMin + c.yMax ) / 2, z: c.z }, radius: c.radius, height: Math.max( 0.1, c.yMax - c.yMin ) } );

		}

		return out;

	}

	_onJointBreak( j ) {

		this.stats.jointBreaks ++;
		const vfx = this.features && this.features.get ? this.features.get( 'vfx' ) : null;
		if ( vfx && ( this._splinterAt || 0 ) < this.time - 0.08 ) {

			this._splinterAt = this.time;
			const p = j.b.position;
			vfx.splinters?.( p.x, p.y, p.z, 0.25 );

		}

	}

	// ---- damage

	// world-space distance from a point to a whole prop's box (0 inside)
	_distToProp( prop, x, y, z ) {

		const dx = x - prop.center.x, dy = y - prop.center.y, dz = z - prop.center.z;
		const c = Math.cos( prop.yaw ), s = Math.sin( prop.yaw );
		// into the prop frame (inverse yaw)
		const lx = dx * c - dz * s, lz = dx * s + dz * c;
		const h = prop.half;
		const ex = Math.max( 0, Math.abs( lx ) - h.x ), ey = Math.max( 0, Math.abs( dy ) - h.y ), ez = Math.max( 0, Math.abs( lz ) - h.z );
		return Math.hypot( ex, ey, ez );

	}

	// damage one prop; breaks it past its toughness. Returns true when it broke now
	damage( id, energy, at = null, by = 'player' ) {

		const prop = typeof id === 'string' ? this.byId.get( id ) : id;
		if ( ! prop || prop.state !== 'intact' || ! ( energy > 0 ) ) return false;
		prop.damage += energy;
		const p = at || prop.center;
		if ( prop.damage < prop.K.toughness ) {

			const vfx = this.features && this.features.get ? this.features.get( 'vfx' ) : null;
			if ( vfx ) ( prop.K.mat === 'stone' ? vfx.dust : vfx.splinters )?.call( vfx, p.x, p.y, p.z, Math.min( 0.6, energy / prop.K.toughness ) );
			return false;

		}

		this._break( prop, { x: p.x, y: p.y, z: p.z, energy: prop.damage, by } );
		return true;

	}

	// an area hit: every intact prop within radius takes energy * (1 - d / radius)^2; loose pieces are thrown
	blast( x, y, z, radius = EXPLOSION.radius, energy = EXPLOSION.energy, by = 'explosion', except = null ) {

		if ( ! Number.isFinite( x ) || ! ( radius > 0 ) ) return 0;
		let n = 0;
		for ( const prop of this.props ) {

			if ( prop.state !== 'intact' || prop === except ) continue;
			if ( Math.hypot( prop.center.x - x, prop.center.z - z ) > radius + prop.radius + 1 ) continue;
			const d = this._distToProp( prop, x, y, z );
			if ( d >= radius ) continue;
			if ( this.damage( prop, energy * ( 1 - d / radius ) ** 2, { x, y, z }, by ) ) n ++;

		}

		if ( this.world ) this.world.impulse( x, y, z, radius * 1.3, Math.min( energy * 0.05, 6000 ) );
		return n;

	}

	// the public impulse API (cross-worker): damage props and push debris
	impulse( x, y, z, radius, energy ) {

		return this.blast( x, y, z, radius, energy, 'impulse' );

	}

	// a melee blow at a point: props within range take energy; loose pieces get a shove
	strike( x, y, z, range = 1.4, energy = MELEE_ENERGY, by = 'player' ) {

		let hit = null, bd = Infinity;
		for ( const prop of this.props ) {

			if ( prop.state !== 'intact' || Math.hypot( prop.center.x - x, prop.center.z - z ) > range + prop.radius + 0.5 ) continue;
			const d = this._distToProp( prop, x, y, z );
			if ( d < range && d < bd ) { bd = d; hit = prop; }

		}

		if ( hit ) this.damage( hit, energy, { x, y, z }, by );
		if ( this.world ) this.world.impulse( x, y, z, range, energy * 0.6, { maxDv: 6 } );
		return hit ? hit.id : null;

	}

	// the nearest intact prop within range of ( x, z ) (melee asks before allowing a swing with no raider about)
	nearProp( x, z, range = 1.6 ) {

		let best = null, bd = Infinity;
		for ( const prop of this.props ) {

			if ( prop.state !== 'intact' ) continue;
			const d = this._distToProp( prop, x, prop.center.y, z );
			if ( d < range && d < bd ) { bd = d; best = prop.id; }

		}

		return best;

	}

	breakProp( id, opts = {} ) {

		const prop = this.byId.get( id );
		if ( ! prop ) return false;
		const e = opts.energy ?? prop.K.toughness * 1.5;
		return this._break( prop, { x: opts.x ?? prop.center.x, y: opts.y ?? prop.center.y, z: opts.z ?? prop.center.z, energy: e, by: opts.by || 'script', remote: !! opts.remote, silent: !! opts.silent } );

	}

	_break( prop, { x, y, z, energy, by = 'player', remote = false, silent = false, respawnAt = null } ) {

		if ( prop.state !== 'intact' ) return false; // idempotent: a replayed or repeated event is a no-op
		prop.state = 'broken';
		prop.brokenAt = this.time;
		this._removeColliders( prop );
		if ( prop.fixed ) { prop.fixed.remove(); prop.fixed = null; }
		const due = respawnAt ?? ( this.features && this.features.sandbox ? Infinity : this.hours + RESPAWN_HOURS );
		this.broken.set( prop.id, due );
		this._dirty = true;
		if ( silent ) return true;
		this.stats.destroyed ++;
		if ( remote ) this.stats.remote ++;
		this._spawnDebris( prop, x, y, z, energy );

		const vfx = this.features && this.features.get ? this.features.get( 'vfx' ) : null;
		if ( vfx ) {

			const s = Math.min( 1.6, 0.5 + energy / prop.K.toughness * 0.25 );
			vfx.debris?.( prop.center.x, prop.center.y, prop.center.z, s, prop.K.mat === 'stone' ? 'stone' : 'wood' );
			if ( prop.K.mat === 'stone' ) vfx.dust?.( prop.center.x, prop.center.y, prop.center.z, s );
			else vfx.splinters?.( x, y, z, s );
			if ( prop.center.y - prop.half.y < 0.3 && prop.site === 'shoals' ) vfx.splash?.( prop.center.x, 0, prop.center.z, s * 0.7 );

		}

		if ( ! remote ) {

			const payload = { id: prop.id, kind: prop.kind, x: round2( prop.center.x ), y: round2( prop.center.y ), z: round2( prop.center.z ), by, port: prop.port, site: prop.site };
			if ( this.features && this.features.emit ) this.features.emit( 'propDestroyed', payload );
			const seconds = Number.isFinite( due ) ? Math.round( RESPAWN_HOURS / CLOCK_SPEED ) : 86400;
			this.app.netsync?.sendWorldEvent?.( 'propDestroyed', { ...payload, respawn: seconds } );

		}

		return true;

	}

	// pieces become bodies; joints near the hit are cut, the rest hold until their load breaks them
	_spawnDebris( prop, x, y, z, energy ) {

		const W = this.world;
		if ( ! W ) return;
		const ratio = energy / prop.K.toughness;
		const rng = rngFor( prop.id + ':' + this.stats.destroyed );
		let layout = prop.layout, worldPoses = prop.world, joints = layout.joints, anchors = layout.anchors;
		if ( ratio >= prop.K.shatterAt ) {

			// a heavy hit: burst barrels, split rocks, no joints left
			const pieces = shatterLayout( prop.kind, layout.pieces, rng );
			layout = { pieces };
			worldPoses = pieces.map( ( pc ) => {

				const r = rotate( prop.quat, pc.pos.x, pc.pos.y, pc.pos.z );
				return { pos: { x: prop.x + r.x, y: prop.y + r.y, z: prop.z + r.z }, quat: quatMul( prop.quat, pc.quat ) };

			} );
			joints = []; anchors = [];

		}

		const pieces = layout.pieces;
		this._makeRoom( pieces.length );
		const group = { prop, items: [], born: this.time };
		const bodies = pieces.map( ( pc, i ) => {

			const wp = worldPoses[ i ];
			const d = { position: wp.pos, quaternion: wp.quat, density: pc.density, group: prop.id, buoyancy: pc.float ?? 1, friction: 0.7, userData: { prop: prop.id } };
			if ( pc.type === 'barrel' ) Object.assign( d, { shape: 'cylinder', radius: pc.size[ 0 ] / 2, height: pc.size[ 1 ] } );
			else if ( pc.type === 'rock' ) Object.assign( d, { shape: 'convex', points: rockHull( pc.size ) } );
			else Object.assign( d, { shape: 'box', size: pc.size } );
			const b = W.addBody( d );
			if ( b ) group.items.push( { body: b, piece: pc, fade: FADE_AFTER + rng() * 5 } );
			return b;

		} );

		// joints: cut inside the break radius around the hit, kept outside it
		const toWorld = ( a ) => { const r = rotate( prop.quat, a.x, a.y, a.z ); return { x: prop.x + r.x, y: prop.y + r.y, z: prop.z + r.z }; };
		const cut = prop.radius * Math.min( 2.5, Math.max( 0.15, ratio - 0.4 ) );
		for ( const [ i, k, force, anchor ] of joints ) {

			if ( ! bodies[ i ] || ! bodies[ k ] ) continue;
			const p = toWorld( anchor );
			if ( Math.hypot( p.x - x, p.y - y, p.z - z ) < cut * ( 0.7 + rng() * 0.6 ) ) continue;
			W.addJoint( bodies[ i ], bodies[ k ], { anchor: p, breakForce: force } );

		}

		for ( const [ i, force, anchor ] of anchors ) {

			if ( ! bodies[ i ] ) continue;
			const p = toWorld( anchor );
			if ( Math.hypot( p.x - x, p.y - y, p.z - z ) < cut * 0.8 ) continue;
			W.addJoint( null, bodies[ i ], { anchor: p, breakForce: force } );

		}

		// the blast throws what came loose (kinetic energy capped: most of a cannonball's goes into breaking)
		const ek = Math.min( energy, prop.K.toughness * 3 ) * 0.6;
		W.impulse( x, y, z, Math.max( 1.5, prop.radius * 1.6 ), ek, { maxDv: 14, filter: ( b ) => b.group === prop.id } );
		this.groups.push( group );

	}

	// keep under the body budget: the oldest loose debris goes first
	_makeRoom( need ) {

		const W = this.world;
		while ( W.count + need > W.maxBodies && this.groups.length ) {

			const g = this.groups.shift();
			for ( const it of g.items ) it.body.remove();

		}

	}

	_onCannon( e ) {

		if ( ! e || ! Number.isFinite( e.x ) ) return;
		const sp = Math.hypot( e.vx || 0, e.vy || 0, e.vz || 0 );
		const E = e.energy > 0 ? e.energy : sp > 0 ? 0.5 * 2.7 * sp * sp : CANNON_ENERGY;
		const by = e.by || ( e.target && e.target.by ) || 'cannon';
		const target = e.hit === 'prop' ? this.byId.get( typeof e.target === 'string' ? e.target : e.target && e.target.id ) : null;
		if ( target ) this.damage( target, E, { x: e.x, y: e.y, z: e.z }, by );
		this.blast( e.x, e.y, e.z, 2.2, E * ( target ? 0.4 : 1 ), by, target );

	}

	_onCrash( e ) {

		if ( ! e || ! Number.isFinite( e.x ) ) return;
		const v = e.speed ?? 20, m = e.mass ?? 900;
		this.blast( e.x, e.y ?? 1, e.z, e.radius ?? 5, 0.5 * m * v * v, 'seaplane' );

	}

	// propDestroyed from another player (or replayed on join: stored events come back with replay: true) and the server's
	// propRespawned. Never re-broadcast; breaking twice is a no-op.
	_onRemote( e ) {

		if ( ! e || ! e.data ) return;
		const d = e.data, prop = this.byId.get( d.id );
		if ( ! prop ) return;
		if ( e.kind === 'propDestroyed' ) {

			if ( prop.state !== 'intact' ) return;
			// a replay is old news: the prop is simply gone, no debris, no effects
			this._break( prop, { x: d.x ?? prop.center.x, y: d.y ?? prop.center.y, z: d.z ?? prop.center.z, energy: prop.K.toughness * 1.4, by: 'remote', remote: true, silent: !! e.replay } );

		} else if ( e.kind === 'propRespawned' ) this.respawn( prop.id, true );

	}

	// ---- respawn

	respawn( id, force = false ) {

		const prop = this.byId.get( id );
		if ( ! prop ) return false;
		this.broken.delete( id );
		this.groups = this.groups.filter( ( g ) => {

			if ( g.prop !== prop ) return true;
			for ( const it of g.items ) it.body.remove();
			return false;

		} );
		if ( prop.state === 'intact' ) return false;
		prop.state = 'intact';
		prop.damage = 0;
		this._addColliders( prop );
		this._fixedBody( prop );
		this._dirty = true;
		this.stats.respawned ++;
		if ( this.features && this.features.emit ) this.features.emit( 'propRespawned', { id, kind: prop.kind, forced: !! force } );
		return true;

	}

	_tickClock( dt ) {

		const st = this.app.settings;
		const h = st && typeof st.timeOfDay === 'number' && Number.isFinite( st.timeOfDay ) ? ( ( st.timeOfDay % 24 ) + 24 ) % 24 : null;
		let adv = 0;
		if ( h !== null ) {

			if ( this._lastHour !== null ) {

				adv = hoursForward( this._lastHour, h );
				if ( adv > 0.5 + dt * 0.1 ) adv = 0; // the clock was set, not run
				if ( adv === 0 && st.timeSpeed === 0 ) adv = dt * REAL_FALLBACK;

			}

			this._lastHour = h;

		} else adv = dt * REAL_FALLBACK;

		this.hours += adv;

	}

	_checkRespawns() {

		if ( ! this.broken.size ) return;
		const p = this.app.player && this.app.player.position;
		for ( const [ id, due ] of this.broken ) {

			if ( due > this.hours ) continue;
			const prop = this.byId.get( id );
			if ( ! prop ) { this.broken.delete( id ); continue; }
			if ( p && Math.hypot( p.x - prop.center.x, p.z - prop.center.z ) < RESPAWN_CLEAR ) continue;
			this.respawn( id );

		}

	}

	// ---- per frame

	update( dt ) {

		if ( this.disposed || ! ( dt > 0 ) ) return;
		dt = Math.min( dt, 0.1 );
		this.frames ++;
		// after the other features registered their interactables (the keep-out list)
		if ( ! this.built && this.frames >= 3 ) this.build();
		this.time += dt;
		this._tickClock( dt );
		if ( ( this._respawnTick += dt ) > 1 ) { this._respawnTick = 0; this._checkRespawns(); }
		if ( ! this.built ) return;
		this._pollMelee();
		this._ram();
		const W = this.world;
		if ( W && W.count > 0 ) {

			this._proxies();
			W.step( dt );
			this._ageDebris( dt );
			this._dirty = true;

		}

		if ( this.render && this._dirty ) this._draw();

	}

	// melee without its hook: the paddle's contact moment, read off the combat state (skipped when meleeHit events come)
	_pollMelee() {

		const m = this.features && this.features.get ? this.features.get( 'melee' ) : null;
		const c = m && m.combat, p = this.app.player;
		if ( ! c || ! p || ! p.position ) return;
		const contact = c.state === 'swing' && !! c.swingContact;
		if ( contact && ! this._swing && this.time - this._meleeEventAt > 0.5 ) {

			const fx = - Math.sin( p.yaw || 0 ), fz = - Math.cos( p.yaw || 0 );
			this.strike( p.position.x + fx * 1.0, p.position.y + 0.9, p.position.z + fz * 1.0, 1.3, MELEE_ENERGY, 'player' );

		}

		this._swing = contact;

	}

	// the player's boat at speed breaks what its hull reaches (before the hull's collider push stops it)
	_ram() {

		const b = this.app.boatCtl;
		if ( ! b || ! b.position || ! b.velocity || ! b.quaternion ) return;
		const v = b.velocity, sp = Math.hypot( v.x, v.z );
		if ( sp < 2.2 ) return;
		const q = b.quaternion, f = rotate( q, 0, 0, 1 ), r = rotate( q, 1, 0, 0 );
		const pts = RAM_POINTS;
		const bp = b.position;
		for ( const prop of this.props ) {

			if ( prop.state !== 'intact' ) continue;
			// a loose square reject before the exact test (every prop, every frame at speed: no Math.hypot for the far ones)
			const ex = prop.center.x - bp.x, ez = prop.center.z - bp.z, er = prop.radius + 6;
			if ( ex * ex + ez * ez > er * er * 1.001 ) continue;
			if ( Math.hypot( ex, ez ) > er ) continue;
			if ( prop.center.y - prop.half.y > 1.5 || prop.center.y + prop.half.y < - 0.5 ) continue; // not at the waterline
			let hit = false;
			for ( const [ lx, lz ] of pts ) {

				const x = bp.x + r.x * lx + f.x * lz, z = bp.z + r.z * lx + f.z * lz;
				if ( this._distToProp( prop, x, Math.min( prop.center.y, 0.3 ), z ) < 1.0 ) { hit = true; break; }

			}

			if ( ! hit || ( this._ramAt.get( prop.id ) || - 9 ) > this.time - 0.5 ) continue;
			this._ramAt.set( prop.id, this.time );
			const m = b.mass || BOAT_MASS;
			this.damage( prop, 0.5 * m * sp * sp * 0.6, { x: prop.center.x, y: 0.4, z: prop.center.z }, 'ram' );

		}

	}

	// kinematic stand-ins for the boat hull and the player's legs push loose pieces about
	_proxies() {

		const W = this.world, app = this.app;
		const b = app.boatCtl;
		if ( b && b.position && b.quaternion ) {

			if ( ! this._boatBody ) this._boatBody = W.addBody( { type: 'kinematic', shape: 'box', size: [ 2.4, 1.3, 7.4 ], position: b.position, quaternion: b.quaternion } );
			if ( this._boatBody ) this._boatBody.setKinematic( { x: b.position.x, y: b.position.y + 0.1, z: b.position.z }, b.quaternion );

		}

		const p = app.player;
		if ( p && p.position ) {

			if ( ! this._footBody ) this._footBody = W.addBody( { type: 'kinematic', shape: 'capsule', radius: 0.28, height: 1.6, position: p.position } );
			const onFoot = p.mode === 'walk' || p.mode === 'swim' || p.mode === undefined;
			if ( this._footBody ) this._footBody.setKinematic( onFoot ? { x: p.position.x, y: p.position.y + 0.8, z: p.position.z } : { x: p.position.x, y: - 500, z: p.position.z } );

		}

	}

	// pieces settle and sleep; loose ones fade after a minute; standing wrecks stay until the respawn
	_ageDebris( dt ) {

		const keep = [];
		for ( const g of this.groups ) {

			const age = this.time - g.born;
			const items = [];
			for ( const it of g.items ) {

				const b = it.body;
				if ( b.removed ) continue;
				if ( b.position.y < - 60 ) { b.remove(); continue; }
				if ( age > it.fade ) {

					if ( it.scale === undefined && this._standing( b ) ) { it.fade = age + 30; items.push( it ); continue; } // re-checked later
					it.scale = Math.max( 0, ( it.scale ?? 1 ) - dt / FADE_TIME );
					if ( it.scale <= 0 ) { b.remove(); continue; }

				}

				items.push( it );

			}

			g.items = items;
			if ( items.length ) keep.push( g );

		}

		this.groups = keep;

	}

	// still held to the world through a chain of intact joints
	_standing( body ) {

		const seen = new Set( [ body ] ), stack = [ body ];
		while ( stack.length ) {

			const b = stack.pop();
			for ( const j of b.joints ) {

				if ( ! j.a ) return true;
				for ( const o of [ j.a, j.b ] ) if ( ! seen.has( o ) ) { seen.add( o ); stack.push( o ); }

			}

		}

		return false;

	}

	_draw() {

		const R = this.render, W = this.world;
		this._dirty = false;
		R.begin();
		for ( const prop of this.props ) {

			if ( prop.state !== 'intact' ) continue;
			const pcs = prop.layout.pieces;
			for ( let i = 0; i < pcs.length; i ++ ) R.push( pcs[ i ].type, prop.world[ i ].pos, prop.world[ i ].quat, pcs[ i ].size, pcs[ i ].color );

		}

		const a = W ? W.alpha : 1;
		const P = { x: 0, y: 0, z: 0 }, Q = { x: 0, y: 0, z: 0, w: 1 };
		for ( const g of this.groups ) {

			for ( const it of g.items ) {

				const b = it.body;
				lerpPose( b, a, P, Q );
				R.push( it.piece.type, P, Q, it.piece.size, it.piece.color, it.scale ?? 1 );

			}

		}

		R.end();

	}

	// ---- queries (cross-worker API)

	// first destructible hit along the segment a -> b: whole props (their boxes) and loose pieces (physics)
	raycastSegment( ax, ay, az, bx, by, bz ) {

		const dx = bx - ax, dy = by - ay, dz = bz - az;
		const len2 = dx * dx + dy * dy + dz * dz;
		if ( ! ( len2 > 1e-10 ) ) return null;
		let best = null;
		for ( const prop of this.props ) {

			if ( prop.state !== 'intact' ) continue;
			// sphere reject
			const cx = prop.center.x - ax, cy = prop.center.y - ay, cz = prop.center.z - az;
			const t0 = Math.max( 0, Math.min( 1, ( cx * dx + cy * dy + cz * dz ) / len2 ) );
			const ox = cx - dx * t0, oy = cy - dy * t0, oz = cz - dz * t0;
			if ( ox * ox + oy * oy + oz * oz > prop.radius * prop.radius * 1.001 ) continue; // (loose square reject first)
			if ( Math.hypot( ox, oy, oz ) > prop.radius ) continue;
			const t = slab( prop, ax, ay, az, dx, dy, dz );
			if ( t !== null && ( ! best || t < best.t ) ) best = { t, id: prop.id };

		}

		if ( this.world && this.world.count > 0 ) {

			const h = this.world.raycast( ax, ay, az, bx, by, bz, { filter: ( b ) => b.dynamic } );
			if ( h && ( ! best || h.t < best.t ) ) best = { t: h.t, id: h.body && h.body.userData ? h.body.userData.prop : null };

		}

		if ( ! best ) return null;
		return { t: best.t, id: best.id, x: ax + dx * best.t, y: ay + dy * best.t, z: az + dz * best.t };

	}

	info() {

		let intact = 0, pieces = 0;
		for ( const p of this.props ) if ( p.state === 'intact' ) intact ++;
		for ( const g of this.groups ) pieces += g.items.length;
		return { props: this.props.length, intact, broken: this.broken.size, loose: pieces, physics: this.physicsState, world: this.world ? this.world.stats() : null, ...this.stats };

	}

	// ---- save

	toJSON() {

		if ( this.pending && ! this.built ) return this.pending; // wave 16D: saved before the world was built: pass it on
		const broken = [];
		for ( const [ id, due ] of this.broken ) broken.push( [ id, Number.isFinite( due ) ? Math.round( due * 100 ) / 100 : null ] );
		return { v: 1, hours: Math.round( this.hours * 100 ) / 100, broken };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		if ( Number.isFinite( d.hours ) ) this.hours = d.hours;
		if ( this.built ) this._applySaved( d ); else this.pending = d;

	}

	_applySaved( d ) {

		// a loaded save replaces the broken set
		for ( const id of [ ...this.broken.keys() ] ) this.respawn( id, true );
		for ( const e of Array.isArray( d.broken ) ? d.broken : [] ) {

			if ( ! Array.isArray( e ) || typeof e[ 0 ] !== 'string' ) continue;
			const prop = this.byId.get( e[ 0 ] );
			if ( ! prop ) continue;
			this._break( prop, { x: prop.center.x, y: prop.center.y, z: prop.center.z, energy: 0, silent: true, respawnAt: e[ 1 ] === null ? Infinity : Number( e[ 1 ] ) } );

		}

	}

	// a new game (and the sandbox's way back): everything stands again
	reset() {

		this.pending = null;
		for ( const id of [ ...this.broken.keys() ] ) this.respawn( id, true );
		for ( const g of this.groups ) for ( const it of g.items ) it.body.remove();
		this.groups = [];
		this.hours = 0;
		this._lastHour = null;

	}

	dispose() {

		this.disposed = true;
		for ( const off of this._off ) try { off(); } catch ( e ) { /* gone */ }
		for ( const p of this.props ) this._removeColliders( p );
		if ( this.render ) this.render.dispose();
		if ( this.world ) this.world.dispose();
		this.world = null;

	}

}

const round2 = ( v ) => Math.round( v * 100 ) / 100;

// the slab test of a segment against a prop's yawed box: entry t in [0, 1] or null
function slab( prop, ax, ay, az, dx, dy, dz ) {

	const c = Math.cos( prop.yaw ), s = Math.sin( prop.yaw );
	const ox = ax - prop.center.x, oy = ay - prop.center.y, oz = az - prop.center.z;
	const o = [ ox * c - oz * s, oy, ox * s + oz * c ], d = [ dx * c - dz * s, dy, dx * s + dz * c ];
	const h = [ prop.half.x, prop.half.y, prop.half.z ];
	let t0 = 0, t1 = 1;
	for ( let i = 0; i < 3; i ++ ) {

		if ( Math.abs( d[ i ] ) < 1e-9 ) { if ( Math.abs( o[ i ] ) > h[ i ] ) return null; continue; }
		let a = ( - h[ i ] - o[ i ] ) / d[ i ], b = ( h[ i ] - o[ i ] ) / d[ i ];
		if ( a > b ) { const t = a; a = b; b = t; }
		t0 = Math.max( t0, a ); t1 = Math.min( t1, b );
		if ( t0 > t1 ) return null;

	}

	return t0;

}

function lerpPose( b, a, P, Q ) {

	const p0 = b.prevPosition, p1 = b.position, q0 = b.prevQuaternion, q1 = b.quaternion;
	P.x = p0.x + ( p1.x - p0.x ) * a; P.y = p0.y + ( p1.y - p0.y ) * a; P.z = p0.z + ( p1.z - p0.z ) * a;
	const sg = q0.x * q1.x + q0.y * q1.y + q0.z * q1.z + q0.w * q1.w < 0 ? - 1 : 1;
	let x = q0.x + ( q1.x * sg - q0.x ) * a, y = q0.y + ( q1.y * sg - q0.y ) * a, z = q0.z + ( q1.z * sg - q0.z ) * a, w = q0.w + ( q1.w * sg - q0.w ) * a;
	const l = Math.hypot( x, y, z, w ) || 1;
	Q.x = x / l; Q.y = y / l; Q.z = z / l; Q.w = w / l;

}

export { physicsReady, pieceHalf };
