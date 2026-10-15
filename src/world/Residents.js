import { Quaternion, Vector3 } from '../engine/index.js';
import { Avatar } from '../player/Avatar.js';
import { CLIPS, CLIP_SPEED, CHARACTERS } from '../game/Characters.js';
import { mulberry32 } from '../util/Noise.js';
import { WORLD } from './WorldLayout.js';
import {
	RESIDENTS, GESTURE_FALLBACK, LOOP_CLIPS, PATROL_SPEED, PATROL_PAUSE, GESTURE_EVERY, LOOP_GESTURE_S,
	TALK_S, LOOK_RADIUS, LOOK_CLAMP, PRANK_WINDOW, COMMUTE_SPEED, yawToward,
} from './residents/ResidentData.js';

// The island's residents (residents/ResidentData.js): one lite Avatar each, driven by a small
// state machine instead of Avatar.update(): the resident picks its own clips (gestures the
// player avatar never plays) and only needs the SkinnedModel's play / update / hold / current.
//
//   const residents = new Residents( { scene, terrain, colliders, village } );
//   residents.update( dt, player );                 // per frame (player: Player, or a Vector3)
//   const r = residents.nearest( player.position ); // -> Resident | null (E prompt: `Talk to ${ r.name }`)
//   const res = residents.interact( r, player, game ); // -> { line, prank?: true | 'launch', dir?: { x, z } }
//   residents.add( data ) / remove( id )            // more people at runtime (the harbour feature's population)
//   residents.onTalk = ( r, res, game ) => res      // a hook on every E (memory lines, services); may replace res
//   residents.dispose()
//   residents.setRadii( { animate: 60, update: 120, hide: 260, shadow: 40 } )   (m; src/core/Quality.js)
//
// States: idle (a random gesture every 6-14 s, turning toward the player within 8 m, at most ±60°
// from the spot yaw), walk / pause (a patrol: the polyline at 0.6 m/s, a pause and a gesture at
// each node), talk (4 s of the talk loop after an E), go (walking a route to a task), away (indoors:
// hidden, no prompt). Within 60 m of the player the model animates, out to 120 m it holds its pose,
// beyond that nothing is updated except a cheap far tick (a resident on its way simply arrives), and
// beyond 260 m the avatar is hidden (setRadii: Quality's tiers shrink these on Medium / Low; beyond 40 m on
// High a resident casts no sun shadow: a person's shadow there is a few texels of the far cascade). A `lazy` resident (data.lazy) builds its avatar only when the
// player first comes within 220 m (the far islands' people cost nothing until you sail there).
//
// Tasks (the harbour feature's schedules, src/features/harbour/Schedules.js):
//   r.setTask( { id, x, z, yaw?, base?, gestures?, indoors?, work?, run? } )  walk (run: run) there (route around the
//       village buildings), then idle there with that base clip and gestures; indoors: go inside (hidden)
//   r.setTask( null )            back to the resident's own spot or patrol (walks back first)
//   r.arrived, r.taskT (s since arriving), r.task, r.hidden
//
// The prank: the clown's first E arms him for PRANK_WINDOW seconds and answers with a beckon;
// a second E inside the window returns { prank: 'launch', line: 'HAH!', dir } and he laughs;
// the caller shoves the player with player.launch( dir, speed ) and counts the prank.
//
// Tests inject `avatarFactory` (test/residents.mjs): anything with { group, model, ready, dispose }.

const _yAxis = new Vector3( 0, 1, 0 );
const SPAWN_D2 = 220 * 220; // (the animate / update / hide radii: Residents.setRadii)
const walkClipSpeed = ( v ) => Math.max( 0.6, Math.min( 2.4, v / CLIP_SPEED.walk ) );
const RUN_SPEED = 3.0; // m/s: a task with run (sheltering from a raid: harbour Director.alarm)
const GREET_R2 = 4 * 4, GREET_S = 120; // a wave to the player passing within 4 m, once per 2 minutes each
const WALK_CLIP_SPEED = walkClipSpeed( PATROL_SPEED );

const wrap = ( a ) => Math.atan2( Math.sin( a ), Math.cos( a ) );
const clamp = ( v, lo, hi ) => Math.max( lo, Math.min( hi, v ) );

export class Residents {

	constructor( { scene, terrain, colliders = null, village = null, avatarFactory = null, data = RESIDENTS } ) {

		this.scene = scene;
		this.terrain = terrain;
		this.colliders = colliders;
		this.village = village;
		this.avatarFactory = avatarFactory || ( ( o ) => new Avatar( o ) );
		this.onTalk = null;
		this.list = [];
		const byId = new Map();
		for ( const d of data ) byId.set( d.id, d );
		data.forEach( ( d, i ) => {

			// chatting pairs face each other
			let yaw = d.spot ? d.spot.yaw : 0;
			const other = d.face && byId.get( d.face );
			if ( d.spot && other && other.spot ) yaw = yawToward( d.spot.x, d.spot.z, other.spot.x, other.spot.z );
			this.list.push( new Resident( this, d, yaw, mulberry32( 1337 + i * 7919 ) ) );

		} );
		this.radii = { animate: 60, update: 120, hide: 260, shadow: 40 };
		this.setRadii( this.radii );
		this.ready = Promise.all( this.list.map( ( r ) => r.avatar ? r.avatar.ready : null ) ).then( () => this );

	}

	byId( id ) {

		return this.list.find( ( r ) => r.id === id ) || null;

	}

	// one more resident (data as in ResidentData: a spot or a patrol); an existing id returns that one
	add( data ) {

		const had = this.byId( data.id );
		if ( had ) return had;
		let h = 0;
		for ( const c of String( data.id ) ) h = ( Math.imul( h, 31 ) + c.charCodeAt( 0 ) ) >>> 0;
		const r = new Resident( this, data, data.spot ? data.spot.yaw : 0, mulberry32( 4243 + h ) );
		this.list.push( r );
		return r;

	}

	remove( id ) {

		const i = this.list.findIndex( ( r ) => r.id === id );
		if ( i < 0 ) return false;
		const [ r ] = this.list.splice( i, 1 );
		if ( r.avatar ) r.avatar.dispose();
		return true;

	}

	// the ground under (x, z): terrain, or a walkable collider (decks, boardwalks) on top of it
	groundAt( x, z, deck = false ) {

		const t = this.terrain.heightAt( x, z );
		if ( ! this.colliders ) return t;
		const c = this.colliders.groundHeightAt( x, z, deck ? t + 60 : t + 2.5 );
		return Number.isFinite( c ) ? Math.max( t, c ) : t;

	}

	// on a pier or a port's jetty (a walker there stands on the deck collider, not the sea floor)
	isDeck( x, z ) {

		const P = WORLD.pier;
		if ( Math.abs( x - P.x ) <= P.width / 2 + 0.3 && z >= P.zStart && z <= P.zEnd ) return true;
		if ( Math.abs( x - P.x ) <= P.headWidth / 2 && z >= P.zEnd - P.headDepth && z <= P.zEnd ) return true;
		for ( const port of WORLD.ports || [] ) {

			const d = port.dock;
			if ( ! d || ! d.start || ! d.end ) continue;
			const ax = d.start.x, az = d.start.z, bx = d.end.x - ax, bz = d.end.z - az;
			const L2 = bx * bx + bz * bz;
			if ( L2 < 1e-6 ) continue;
			const t = ( ( x - ax ) * bx + ( z - az ) * bz ) / L2;
			if ( t < 0 || t > 1 ) continue;
			if ( Math.hypot( x - ( ax + bx * t ), z - ( az + bz * t ) ) <= ( d.width || 2 ) / 2 + 0.3 ) return true;

		}

		return false;

	}

	// from a point on a pier / jetty to the land at its foot, along the deck (null: not on a deck)
	deckLeg( x, z ) {

		const P = WORLD.pier;
		if ( Math.abs( x - P.x ) <= P.headWidth / 2 + 0.3 && z >= P.zStart && z <= P.zEnd && this.isDeck( x, z ) ) {

			return [ { x: P.x, z: Math.min( z, P.zEnd - P.headDepth / 2 ) }, { x: P.x, z: P.zStart - 1.5 } ];

		}

		for ( const port of WORLD.ports || [] ) {

			const d = port.dock;
			if ( ! d || ! d.start || ! d.end ) continue;
			const ax = d.start.x, az = d.start.z, bx = d.end.x - ax, bz = d.end.z - az;
			const L = Math.hypot( bx, bz );
			if ( L < 1e-3 ) continue;
			const t = ( ( x - ax ) * bx + ( z - az ) * bz ) / ( L * L );
			if ( t < 0 || t > 1 || Math.hypot( x - ( ax + bx * t ), z - ( az + bz * t ) ) > ( d.width || 2 ) / 2 + 0.3 ) continue;
			return [ { x: ax + bx * t, z: az + bz * t }, { x: ax - bx / L * 1.5, z: az - bz / L * 1.5 } ];

		}

		return null;

	}

	// a walking route from a to b: off a pier along its deck, around the village's building footprints
	// (a few detours at most), and onto a pier along its deck
	route( ax, az, bx, bz ) {

		const out = this.deckLeg( ax, az ) || [];
		const inn = this.deckLeg( bx, bz );
		const a = out.length ? out[ out.length - 1 ] : { x: ax, z: az };
		const b = inn ? inn[ inn.length - 1 ] : { x: bx, z: bz };
		const land = out.length || inn ? this._landRoute( a.x, a.z, b.x, b.z ) : this._landRoute( ax, az, bx, bz );
		if ( ! out.length && ! inn ) return land;
		// on the same deck: walk straight along it
		if ( out.length && inn && Math.hypot( a.x - b.x, a.z - b.z ) < 0.5 ) return [ { x: bx, z: bz } ];
		const pts = [ ...out, ...land ];
		if ( inn ) pts.push( ...inn.slice().reverse().slice( 1 ), { x: bx, z: bz } );
		return pts;

	}

	_landRoute( ax, az, bx, bz ) {

		const fps = this.village && this.village.footprints ? this.village.footprints.filter( ( f ) => f.kind === 'building' ) : [];
		const pts = [ { x: ax, z: az }, { x: bx, z: bz } ];
		for ( let guard = 0, i = 0; guard < 8 && i < pts.length - 1; guard ++ ) {

			const a = pts[ i ], b = pts[ i + 1 ];
			const hit = blocking( fps, a, b );
			if ( ! hit ) { i ++; continue; }
			// step around: the side of the footprint the segment passes on, just outside it
			const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot( dx, dz ) || 1;
			let nx = - dz / L, nz = dx / L;
			if ( ( hit.x - a.x ) * nx + ( hit.z - a.z ) * nz > 0 ) { nx = - nx; nz = - nz; }
			pts.splice( i + 1, 0, { x: hit.x + nx * ( hit.r + 1.2 ), z: hit.z + nz * ( hit.r + 1.2 ) } );

		}

		pts.shift();
		return pts;

	}

	// the animate / update / hide / shadow distances (m)
	setRadii( { animate = 60, update = 120, hide = 260, shadow = 40 } = {} ) {

		this.radii = { animate, update, hide, shadow };
		this._animateD2 = animate * animate;
		this._updateD2 = update * update;
		this._hideD2 = hide * hide;
		this._shadowD2 = shadow * shadow;

	}

	update( dt, player = null ) {

		const p = player && ( player.position || player );
		dt = Math.min( dt, 0.1 );
		for ( const r of this.list ) {

			const d2 = p ? ( p.x - r.x ) ** 2 + ( p.z - r.z ) ** 2 : Infinity;
			if ( ! r.avatar && d2 < SPAWN_D2 ) r._spawn();
			r._show( d2 < this._hideD2 );
			r._shadow( d2 < this._shadowD2 );
			if ( d2 > this._updateD2 ) {

				r.farTick();
				continue;

			}

			r.update( dt, p, d2 );

		}

	}

	// the resident within `radius` m (and 2.5 m of height) of p, the closest if several (not those indoors)
	nearest( p, radius = 2.8 ) {

		let best = null, bd = radius * radius;
		for ( const r of this.list ) {

			if ( r.hidden ) continue;
			const d2 = ( p.x - r.x ) ** 2 + ( p.z - r.z ) ** 2;
			if ( d2 < bd && Math.abs( ( p.y ?? r.y ) - r.y ) < 2.5 ) { best = r; bd = d2; }

		}

		return best;

	}

	// E on a resident: { line } (and the talk loop), or the clown's { line, prank, dir? }
	interact( r, player = null, game = null ) {

		if ( ! r || r.hidden ) return null;
		const p = player && ( player.position || player );
		let res = r.interact( p, game );
		if ( this.onTalk ) {

			try { res = this.onTalk( r, res, game ) || res; } catch ( e ) { console.warn( 'resident talk hook failed', e ); }

		}

		return res;

	}

	dispose() {

		for ( const r of this.list ) if ( r.avatar ) r.avatar.dispose();
		this.list.length = 0;

	}

}

// the first building footprint the segment a-b cuts through (one holding a or b does not count)
function blocking( fps, a, b ) {

	const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
	if ( L2 < 1e-6 ) return null;
	let best = null, bt = Infinity;
	for ( const f of fps ) {

		const r = f.r + 0.3;
		if ( ( a.x - f.x ) ** 2 + ( a.z - f.z ) ** 2 < r * r || ( b.x - f.x ) ** 2 + ( b.z - f.z ) ** 2 < r * r ) continue;
		const t = clamp( ( ( f.x - a.x ) * dx + ( f.z - a.z ) * dz ) / L2, 0, 1 );
		const d2 = ( a.x + dx * t - f.x ) ** 2 + ( a.z + dz * t - f.z ) ** 2;
		if ( d2 < r * r && t < bt ) { bt = t; best = f; }

	}

	return best;

}

export class Resident {

	constructor( owner, data, homeYaw, rand ) {

		this.owner = owner;
		this.data = data;
		this.id = data.id;
		this.name = data.name;
		this.role = data.role || null;
		this.port = data.port || 'home';
		this.character = CHARACTERS[ data.character ] ? data.character : 'hyptile';
		this.prank = !! data.prank;
		this.scale = data.scale || 1;
		this.base = data.base || CLIPS.idle;
		this.gestures = data.gestures && data.gestures.length ? data.gestures : [ CLIPS.wave ];
		this.nativeGestures = this.gestures;
		this.lines = data.lines && data.lines.length ? data.lines : [ '...' ];
		this.rand = rand;
		this.deck = !! ( data.spot && data.spot.deck );
		this.patrol = data.patrol && data.patrol.length >= 2 ? data.patrol : null;
		this.speed = data.speed || PATROL_SPEED;
		this.commute = data.commute || COMMUTE_SPEED;
		const start = this.patrol ? this.patrol[ 0 ] : data.spot;
		this.x = start.x;
		this.z = start.z;
		this.y = owner.groundAt( this.x, this.z, this.deck );
		this.spotYaw = homeYaw;
		this.homeYaw = homeYaw;
		this.yaw = homeYaw;
		this.lookOff = 0;
		this.node = 0; // the patrol node just reached / being left
		this.state = this.patrol ? 'pause' : 'idle';
		this.pauseT = this.patrol ? 0.5 : 0;
		this.gesture = null; // the gesture clip playing (null: the base loop)
		this.gestureT = this._range( GESTURE_EVERY );
		this.gestureLoopT = 0;
		this.talkT = 0;
		this.resume = null; // the state a talk interrupted ('go' walks on afterwards)
		this.prankT = 0; // > 0: armed
		this.pranks = 0;
		this.lineIdx = 0;
		this.task = null; // the schedule's task (null: the resident's own spot / patrol)
		this.path = null; // route nodes still to walk in 'go'
		this.arrived = true;
		this.taskT = 0;
		this.hidden = false; // indoors
		this.greetT = 0; // s until the next wave at the passing player
		this._shown = true;
		this.model = null;
		this.avatar = null;
		if ( ! data.lazy ) this._spawn();

	}

	_spawn() {

		if ( this.avatar ) return;
		const owner = this.owner;
		this.avatar = owner.avatarFactory( { scene: owner.scene, character: this.character, lite: true } );
		this._shown = true;
		this._place();
		this._show( true, true );
		const gen = this.avatar.ready;
		if ( gen && gen.then ) gen.then( ( m ) => { if ( m && this.avatar && this.avatar.ready === gen ) this._attach( m ); } ).catch( () => {} );

	}

	// avatar visibility: hidden indoors, or far from the player
	_show( near, force = false ) {

		const want = near && ! this.hidden;
		if ( ! this.avatar || ( want === this._shown && ! force ) ) return;
		this._shown = want;
		if ( this.avatar.group ) this.avatar.group.visible = want;
		if ( 'visible' in this.avatar ) this.avatar.visible = want;

	}

	// sun shadows only near the player (the skinned meshes are drawn again in every shadow cascade)
	_shadow( on ) {

		if ( on === this._casts || ! this.model ) return;
		this._casts = on;
		const g = this.avatar && this.avatar.group;
		if ( g && g.traverse ) g.traverse( ( o ) => { if ( o.isMesh ) o.castShadow = on; } );

	}

	_range( [ a, b ] ) {

		return a + ( b - a ) * this.rand();

	}

	_attach( model ) {

		this.model = model;
		this.base = this._clip( ( this.task && ! this.task.native && this.task.base ) || this.data.base || CLIPS.idle );
		model.onClipEnd = ( name ) => {

			// a one-shot gesture (or the prank laugh) hands back to the base loop
			if ( this.gesture && name === this.gesture ) this.gesture = null;

		};
		this._place();

	}

	// a clip the loaded GLB has: the name, its fallback, or the idle
	_clip( name ) {

		const m = this.model;
		if ( ! m || ! m.clips ) return name;
		for ( let n = name, i = 0; n && i < 4; n = GESTURE_FALLBACK[ n ], i ++ ) if ( m.clips.has( n ) ) return n;
		return CLIPS.idle;

	}

	_place() {

		const g = this.avatar && this.avatar.group;
		if ( ! g ) return;
		g.position.set( this.x, this.y, this.z );
		if ( g.quaternion ) g.quaternion.setFromAxisAngle( _yAxis, this.yaw + Math.PI ); // the rig faces +Z
		if ( this.scale !== 1 && g.scale ) g.scale.set( this.scale, this.scale, this.scale );
		if ( typeof g.updateMatrixWorld === 'function' ) g.updateMatrixWorld( true );

	}

	// ---- tasks (schedules)

	// where the resident's own behaviour starts again: its spot, or the patrol node it last reached
	_nativePoint() {

		return this.patrol ? this.patrol[ this.node ] : this.data.spot;

	}

	setTask( task ) {

		if ( ! task ) {

			if ( ! this.task ) return;
			const n = this._nativePoint();
			this._go( { id: '_native', native: true, x: n.x, z: n.z, yaw: this.patrol ? null : this.spotYaw } );
			return;

		}

		const t = this.task;
		if ( t && t.id === task.id && Math.abs( t.x - task.x ) < 0.05 && Math.abs( t.z - task.z ) < 0.05 ) return;
		this._go( task );

	}

	_go( task ) {

		this.task = task;
		this.arrived = false;
		this.taskT = 0;
		this.hidden = false; // out of the door: the next update shows the avatar again (if near)
		this.gesture = null;
		this.lookOff = 0;
		this.path = this.owner.route( this.x, this.z, task.x, task.z );
		if ( this.state === 'talk' ) this.resume = 'go';
		else this.state = 'go';

	}

	_arrive() {

		const t = this.task;
		this.path = null;
		this.arrived = true;
		this.taskT = 0;
		if ( ! t ) return;
		if ( t.native ) {

			this.task = null;
			this.base = this._clip( this.data.base || CLIPS.idle );
			this.gestures = this.nativeGestures;
			this.homeYaw = this.yaw = t.yaw ?? this.yaw;
			this.state = this.patrol ? 'pause' : 'idle';
			this.pauseT = this.patrol ? this._range( PATROL_PAUSE ) * 0.5 : 0;
			this.deck = !! ( this.data.spot && this.data.spot.deck );
			this.y = this.owner.groundAt( this.x, this.z, this.deck );
			this._place();
			return;

		}

		if ( Number.isFinite( t.yaw ) ) this.yaw = t.yaw;
		this.homeYaw = this.yaw;
		this.base = this._clip( t.base || this.data.base || CLIPS.idle );
		this.gestures = t.gestures && t.gestures.length ? t.gestures : this.nativeGestures;
		this.gestureT = this._range( GESTURE_EVERY ) * 0.5;
		this.state = t.indoors ? 'away' : 'idle';
		if ( t.indoors ) {

			this.hidden = true;
			this._show( false, true );

		}

		this._place();

	}

	// beyond the update radius: someone on the way just gets there (no walking, no animation)
	farTick() {

		if ( this.state === 'go' || ( this.state === 'talk' && this.resume === 'go' ) ) {

			const t = this.task;
			if ( t ) {

				this.x = t.x;
				this.z = t.z;
				this.y = this.owner.groundAt( this.x, this.z, this.owner.isDeck( this.x, this.z ) );

			}

			this.state = 'idle';
			this.resume = null;
			this._arrive();

		}

	}

	update( dt, p, d2 ) {

		// a resident standing on a deck built after him (the navy's jetty comes after the harbour's folk) stood on
		// the sand under it: the ground under an idle stander is re-read now and then
		if ( this.state === 'idle' && ! this.task && ( this._groundT = ( this._groundT || 0 ) + dt ) > 2 ) {

			this._groundT = 0;
			this.y = this.owner.groundAt( this.x, this.z, this.deck );

		}

		if ( this.prankT > 0 ) this.prankT -= dt;
		if ( this.greetT > 0 ) this.greetT -= dt;
		if ( this.arrived ) this.taskT += dt;
		if ( this.gesture && this.gestureLoopT > 0 ) {

			this.gestureLoopT -= dt;
			if ( this.gestureLoopT <= 0 ) this.gesture = null;

		}

		switch ( this.state ) {

			case 'talk':
				this.talkT -= dt;
				if ( this.talkT <= 0 ) {

					if ( this.resume === 'go' ) {

						this.state = 'go';
						this.resume = null;
						break;

					}

					this.resume = null;
					this.state = this.patrol && ! this.task ? 'pause' : 'idle';
					this.pauseT = this.patrol ? this._range( PATROL_PAUSE ) * 0.5 : 0;
					this.gestureT = this._range( GESTURE_EVERY );

				}

				break;

			case 'away':
				break;

			case 'go': {

				const n = this.path && this.path[ 0 ];
				if ( ! n ) {

					this._arrive();
					break;

				}

				const dx = n.x - this.x, dz = n.z - this.z, dist = Math.hypot( dx, dz );
				const step = ( this.task && this.task.run ? RUN_SPEED : this.commute ) * dt;
				if ( dist <= step + 1e-6 ) {

					this.x = n.x; this.z = n.z;
					this.path.shift();
					if ( ! this.path.length ) this._arrive();

				} else {

					this.x += dx / dist * step;
					this.z += dz / dist * step;
					const want = yawToward( 0, 0, dx, dz );
					this.yaw += wrap( want - this.yaw ) * ( 1 - Math.exp( - dt * 6 ) );

				}

				this.y = this.owner.groundAt( this.x, this.z, this.owner.isDeck( this.x, this.z ) );
				break;

			}

			case 'walk': {

				const n = this.patrol[ ( this.node + 1 ) % this.patrol.length ];
				const dx = n.x - this.x, dz = n.z - this.z, dist = Math.hypot( dx, dz );
				const step = this.speed * dt;
				if ( dist <= step + 1e-6 ) {

					this.x = n.x; this.z = n.z;
					this.node = ( this.node + 1 ) % this.patrol.length;
					this.homeYaw = this.yaw;
					this.state = 'pause';
					this.pauseT = this._range( PATROL_PAUSE );
					this._gesture();

				} else {

					this.x += dx / dist * step;
					this.z += dz / dist * step;
					const want = yawToward( 0, 0, dx, dz );
					this.yaw += wrap( want - this.yaw ) * ( 1 - Math.exp( - dt * 6 ) );

				}

				this.y = this.owner.groundAt( this.x, this.z, this.deck );
				break;

			}

			case 'pause':
				this.pauseT -= dt;
				if ( this.pauseT <= 0 ) {

					this.state = 'walk';
					this.gesture = null;

				}

				break;

			default: // idle
				// a wave to the player walking past
				if ( p && d2 < GREET_R2 && this.greetT <= 0 && ! this.gesture && ! this.prank ) {

					this.greetT = GREET_S;
					this._gesture( 'Friendly_Wave' );

				}

				this.gestureT -= dt;
				if ( this.gestureT <= 0 ) {

					this.gestureT = this._range( GESTURE_EVERY );
					if ( ! this.gesture ) this._gesture();

				}

		}

		const moving = this.state === 'walk' || this.state === 'go';
		// look at the player when near (not while walking); at most ±60° off the spot yaw
		if ( ! moving ) {

			let want = 0;
			if ( p && d2 < LOOK_RADIUS * LOOK_RADIUS ) want = clamp( wrap( yawToward( this.x, this.z, p.x, p.z ) - this.homeYaw ), - LOOK_CLAMP, LOOK_CLAMP );
			this.lookOff += ( want - this.lookOff ) * ( 1 - Math.exp( - dt * 3 ) );
			this.yaw = this.homeYaw + this.lookOff;

		} else this.lookOff = 0;

		this._place();

		const m = this.model;
		if ( ! m || this.hidden ) return;
		if ( d2 > this.owner._animateD2 ) {

			m.hold();
			return;

		}

		let clip = this.base, speed = 1, loop = true, fade = 0.3;
		if ( this.state === 'walk' ) { clip = this._clip( CLIPS.walk ); speed = WALK_CLIP_SPEED; }
		else if ( this.state === 'go' && this.task && this.task.run ) { clip = this._clip( CLIPS.run ); speed = Math.max( 0.8, Math.min( 1.6, RUN_SPEED / CLIP_SPEED.run ) ); }
		else if ( this.state === 'go' ) { clip = this._clip( CLIPS.walk ); speed = walkClipSpeed( this.commute ); }
		else if ( this.state === 'talk' ) clip = this.gesture || this._clip( 'Chat_Gesture' );
		else if ( this.gesture ) { clip = this.gesture; loop = LOOP_CLIPS.has( clip ); fade = 0.2; }
		if ( m.current !== clip ) m.play( clip, { fade, loop, speed } );
		m.update( dt );

	}

	// start a random idle gesture (a one-shot ends by itself, a loop runs LOOP_GESTURE_S)
	_gesture( name = null ) {

		const pick = name || this.gestures[ Math.floor( this.rand() * this.gestures.length ) % this.gestures.length ];
		const clip = this._clip( pick );
		if ( clip === this.base || ( this.model && this.model.current === clip ) ) {

			this.gesture = null;
			return null;

		}

		this.gesture = clip;
		this.gestureLoopT = LOOP_CLIPS.has( clip ) ? LOOP_GESTURE_S : 0;
		return clip;

	}

	_say() {

		const line = this.lines[ this.lineIdx % this.lines.length ];
		this.lineIdx ++;
		return line;

	}

	interact( p, game = null ) {

		if ( this.prank ) {

			if ( this.prankT > 0 ) {

				// the second E in the window: the shove
				this.prankT = 0;
				this.pranks ++;
				this.state = this.task && ! this.arrived ? 'go' : this.patrol && ! this.task ? 'pause' : 'idle';
				this.resume = null;
				this.pauseT = 3;
				this.gestureT = this._range( GESTURE_EVERY ) + 3;
				this._gesture( 'Prank_Laugh' );
				const l = this.data.launch || { x: 0, z: 1 };
				const len = Math.hypot( l.x, l.z ) || 1;
				return { line: 'HAH!', prank: 'launch', dir: { x: l.x / len, z: l.z / len } };

			}

			// the first E: arm, beckon (a one-shot over the talk loop), lines[ 0 ] is the come-closer
			this.prankT = PRANK_WINDOW;
			this._talk();
			this._gesture( 'Beckon' );
			return { line: this._say(), prank: true };

		}

		this._talk();
		return { line: this._say() };

	}

	_talk() {

		if ( this.state === 'go' ) this.resume = 'go';
		else if ( this.state !== 'talk' ) this.resume = null;
		this.state = 'talk';
		this.talkT = TALK_S;
		this.gesture = null;
		this.homeYaw = this.yaw - this.lookOff; // a walk interrupted: face where it was heading

	}

}
