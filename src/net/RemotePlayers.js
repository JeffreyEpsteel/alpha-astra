// The other players of the island: one lite Avatar per peer (plus their boat from BoatFactory when
// they have one), interpolated ~120 ms behind the newest snapshot, a projected DOM name tag each and
// a small chat log in the HUD.
//
//   const remote = new RemotePlayers( { scene, camera, hud, audio: null } );
//   net.onStates = ( list, at ) => remote.applyStates( list, at );
//   net.onPeerJoin = ( peer ) => remote.addPeer( peer );     net.onPeerLeave = ( id ) => remote.removePeer( id );
//   net.onChat = ( msg ) => remote.pushChat( msg );
//   remote.update( dt );   // every frame after the camera matrices are current
//   remote.peerCount, remote.dispose()
//
// Snapshots keep the server's `at`; the render clock sits INTERP_DELAY behind the newest one so two
// snapshots almost always bracket the render time at SEND_HZ. Positions lerp, yaw takes the shortest arc,
// the boat quaternion slerps. For 'deck' / 'boat' the avatar's frame is the boat's orientation and the
// avatar stands at the sent world position (the sender already placed it on its deck / helm).
//
// Passengers: a peer in mode 'ride' (the server fills in `ride` = host id and `seat`) is a guest on that host's boat. Its
// avatar is not placed from its own snapshots but from the host boat's interpolated transform (the host peer's boat, or the
// local boat when the host is the local player: set `remote.localBoat = () => ( { id, position, quaternion } )` and
// `remote.localId`), so guest and boat never drift apart. The pose is mode 'seat' / action 'seated' in the boat's frame.
// peer.riding = { host, seat } while one is aboard (RemotePlayers.anchor( hostId ) gives the boat transform).
//
// peer.extra: the newest state's fields this file does not know (another feature's, e.g. { plane }), as sent.
// peer.inCar: the newest state has a `car` (the cars feature): the avatar is hidden (CarLink draws the car); remote.renderTime()
// the server time the avatars are drawn at (for other buffers interpolated alongside them).
// remote.setMoored( [ { captain, name, boat, p, q } ] ): the boats offline captains left in a universe, drawn where they
// were left with a "<name> · moored" tag (NetSync keeps the list).

import { Quaternion, Vector3 } from '../engine/index.js';
import { Avatar } from '../player/Avatar.js';
import { terrainGroundProbe } from '../player/ik/Ground.js';
import { createBoatModel } from '../world/boat/BoatFactory.js';
import { BOATS } from '../game/Boats.js';

export const INTERP_DELAY = 120; // ms behind the newest snapshot
const KNOWN = new Set( [ 'id', 't', 'at', 'p', 'yaw', 'mode', 'speed', 'vy', 'grounded', 'diving', 'action', 'character', 'name', 'boat', 'ride', 'seat' ] );
const EMPTY = Object.freeze( {} );
const SNAP_KEEP = 24; // snapshots kept per peer (~1.6 s at 15 Hz)
const TAG_FAR = 120; // m: tags hide beyond this
const TAG_FADE = 60; // m: tags start fading here
const CHAT_LINES = 6;
const CHAT_TTL = 8000; // ms

const CSS = /* css */`
.net-tag { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); padding: calc(2 * var(--tw-u)) var(--tw-2);
	border-radius: 999px; font: 500 var(--tw-fs-sm) var(--tw-font); color: var(--tw-ink); white-space: nowrap; pointer-events: none;
	will-change: transform, opacity; letter-spacing: 0.01em; line-height: 1.4; }
.net-tag::before { content: ''; display: inline-block; width: calc(6 * var(--tw-u)); height: calc(6 * var(--tw-u)); margin-right: calc(5 * var(--tw-u));
	border-radius: 50%; background: var(--tw-aqua); vertical-align: middle; box-shadow: 0 0 6px rgba(var(--tw-aqua-rgb), 0.7); }
.net-tag.is-boat::before { background: var(--tw-sun); box-shadow: 0 0 6px rgba(var(--tw-sun-rgb), 0.7); }
.net-tag.is-hidden { display: none; }
.net-chat { position: absolute; left: var(--tw-edge); bottom: calc(var(--tw-edge) + 150 * var(--tw-u)); display: flex; flex-direction: column; gap: calc(3 * var(--tw-u));
	max-width: min(46vw, calc(420 * var(--tw-u))); pointer-events: none; font: 400 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); }
.net-chat-line { padding: calc(3 * var(--tw-u)) var(--tw-3); border-radius: var(--tw-r-sm); line-height: 1.35; overflow-wrap: anywhere;
	opacity: 1; transition: opacity var(--tw-slow) var(--tw-ease); animation: net-chat-in var(--tw-med) var(--tw-ease); }
.net-chat-line.is-old { opacity: 0; }
.net-chat-line b { font-weight: 600; color: var(--tw-aqua); margin-right: var(--tw-1); }
.net-chat-line.is-own b { color: var(--tw-sun); }
.net-chat-line.is-system { color: var(--tw-ink-2); font-style: italic; }
@keyframes net-chat-in { from { opacity: 0; transform: translateY(4px); } }
`;

let cssInjected = false;
const _v = new Vector3(), _v2 = new Vector3(), _q = new Quaternion();
const _anchor = { id: null, position: new Vector3(), quaternion: new Quaternion() };

const lerpAngle = ( a, b, t ) => {

	let d = b - a;
	d = ( ( d + Math.PI ) % ( 2 * Math.PI ) + 2 * Math.PI ) % ( 2 * Math.PI ) - Math.PI;
	return a + d * t;

};

const esc = ( s ) => String( s == null ? '' : s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );

export class RemotePlayers {

	constructor( { scene, camera, hud = null, audio = null, terrain = null, colliders = null } ) {

		this.scene = scene;
		// foot IK on land for other players' avatars (player/ik): no deck data for them, so only on foot
		this.groundProbe = terrain ? terrainGroundProbe( terrain, colliders ) : null;
		this.camera = camera;
		this.hud = hud;
		this.audio = audio;
		this.peers = new Map(); // id -> peer record
		this.localId = null; // set to ignore the local player's own states
		this.localBoat = null; // () => { id, position, quaternion } of the local boat, or null (a guest riding with the local player)
		this._offset = null; // local performance.now() - server at (ms), tracks the earliest-arrival packet
		this._now = 0;
		this.chatEl = null;
		this._chatLines = [];
		this.moored = new Map(); // captain -> { name, boatId, model, tag, pos, quat }
		if ( hud ) {

			if ( ! cssInjected && typeof document !== 'undefined' ) {

				const style = document.createElement( 'style' );
				style.textContent = CSS;
				document.head.append( style );
				cssInjected = true;

			}

			this.chatEl = document.createElement( 'div' );
			this.chatEl.className = 'net-chat';
			this.chatEl.setAttribute( 'aria-live', 'polite' );
			hud.append( this.chatEl );

		}

	}

	// the server time ( ms, the snapshots' `at` ) the avatars are drawn at now (null before the first snapshot): other
	// interpolated views (netsync CarLink's cars) sample their own buffers at the same time
	renderTime() {

		return this._offset === null ? null : ( this._now || performance.now() ) - this._offset - INTERP_DELAY;

	}

	get peerCount() {

		return this.peers.size;

	}

	// ---- peers

	addPeer( { id, name, character, boat } ) {

		if ( ! id || id === this.localId ) return null;
		let p = this.peers.get( id );
		if ( p ) {

			if ( name ) this._setName( p, name );
			if ( character && character !== p.character ) this._setCharacter( p, character );
			return p;

		}

		p = {
			id, name: name || '?', character: character || 'hyptile', boatId: null, ownedBoat: boat || null,
			avatar: null, boat: null, boatReady: false, snaps: [], tag: null,
			pose: { position: new Vector3(), yaw: 0, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, frame: null, action: null },
			boatPos: new Vector3(), boatQuat: new Quaternion(), frame: new Quaternion(), hasPose: false, lastAt: 0,
		};
		this.peers.set( id, p );
		try {

			p.avatar = new Avatar( { scene: this.scene, character: p.character, lite: true } );
			if ( this.groundProbe && p.avatar.setGroundProbe ) p.avatar.setGroundProbe( this.groundProbe );
			p.avatar.visible = false; // until the first snapshot places it

		} catch ( e ) {

			console.warn( 'RemotePlayers: avatar failed', id, e );

		}

		if ( this.hud ) {

			p.tag = document.createElement( 'div' );
			p.tag.className = 'net-tag tw-glass is-hidden';
			p.tag.textContent = p.name;
			this.hud.append( p.tag );

		}

		return p;

	}

	removePeer( id ) {

		const p = this.peers.get( id );
		if ( ! p ) return;
		this.peers.delete( id );
		if ( p.avatar ) p.avatar.dispose();
		this._disposeBoat( p );
		if ( p.tag ) p.tag.remove();

	}

	// buffer the snapshots of a `states` message (list from NetClient.onStates, at = server time)
	applyStates( list, at ) {

		if ( ! Array.isArray( list ) ) return;
		const now = performance.now();
		if ( typeof at !== 'number' ) at = Date.now();
		// the earliest-arriving packet defines the offset; it creeps up slowly so a clock drift is followed
		const off = now - at;
		if ( this._offset === null || off < this._offset ) this._offset = off;
		for ( const s of list ) {

			if ( ! s || typeof s.id !== 'string' || s.id === this.localId || ! Array.isArray( s.p ) ) continue;
			let p = this.peers.get( s.id );
			if ( ! p ) p = this.addPeer( { id: s.id, name: s.name, character: s.character, boat: s.boat ? s.boat.id : null } );
			if ( ! p ) continue;
			if ( s.name && s.name !== p.name ) this._setName( p, s.name );
			if ( s.character && s.character !== p.character ) this._setCharacter( p, s.character );
			if ( at <= p.lastAt ) continue; // stale / duplicate
			p.lastAt = at;
			const snap = {
				t: at, x: s.p[ 0 ], y: s.p[ 1 ], z: s.p[ 2 ], yaw: s.yaw || 0, mode: s.mode || 'walk', speed: s.speed || 0, vy: s.vy || 0,
				grounded: s.grounded !== false, diving: s.diving === true, action: s.action || null, boat: null,
				ride: typeof s.ride === 'string' ? s.ride : null, seat: s.seat | 0,
			};
			if ( s.boat && Array.isArray( s.boat.p ) && Array.isArray( s.boat.q ) ) {

				const b = s.boat;
				snap.boat = { id: b.id, x: b.p[ 0 ], y: b.p[ 1 ], z: b.p[ 2 ], qx: b.q[ 0 ], qy: b.q[ 1 ], qz: b.q[ 2 ], qw: b.q[ 3 ], throttle: b.throttle || 0, steer: b.steer || 0, rpm: b.rpm || 0, driven: b.driven === true };

			}

			let extra = null;
			for ( const k of Object.keys( s ) ) if ( ! KNOWN.has( k ) ) ( extra || ( extra = {} ) )[ k ] = s[ k ];
			p.extra = extra || EMPTY;
			p.inCar = !! ( extra && extra.car ); // (wave 22A: driving a car; the driver is not drawn, CarLink draws the car)
			p.snaps.push( snap );
			if ( p.snaps.length > SNAP_KEEP ) p.snaps.splice( 0, p.snaps.length - SNAP_KEEP );

		}

	}

	// ---- per frame

	update( dt ) {

		const now = performance.now();
		this._now = now;
		if ( this._offset !== null ) this._offset += dt * 1000 * 0.002; // 2 ms/s creep so a later, faster packet can lower it again
		const renderT = this._offset === null ? 0 : now - this._offset - INTERP_DELAY;
		for ( const p of this.peers.values() ) this._interpolate( p, renderT );
		for ( const p of this.peers.values() ) if ( p.riding ) this._seatRider( p ); // after every boat is placed
		for ( const p of this.peers.values() ) {

			if ( p.boat ) {

				p.boat.group.position.copy( p.boatPos );
				p.boat.group.quaternion.copy( p.boatQuat );
				const b = p.boatState;
				if ( b ) {

					if ( p.boat.setThrottle ) p.boat.setThrottle( b.driven ? b.throttle : 0 );
					if ( p.boat.setSteering ) p.boat.setSteering( b.steer );
					if ( p.boat.setPropellerRPM ) p.boat.setPropellerRPM( b.driven ? b.rpm : 0 );

				}

				if ( p.boat.update ) p.boat.update( dt );

			}

			if ( p.avatar ) {

				p.avatar.visible = p.hasPose && ! p.hiddenIndoor && ! p.inCar; // (wave 20E: inside a room you are not in; 22A: in a car)
				if ( p.hasPose ) p.avatar.update( dt, p.pose );

			}

			this._updateTag( p );

		}

		for ( const m of this.moored.values() ) {

			if ( m.model && m.model.update ) m.model.update( dt );
			this._placeTag( m.tag, m.pos, 2.4 );

		}

		this._expireChat( now );

	}

	// ---- boats of offline captains (a universe)

	setMoored( list ) {

		const keep = new Set();
		for ( const b of Array.isArray( list ) ? list : [] ) {

			if ( ! b || typeof b.captain !== 'string' || ! BOATS[ b.boat ] || ! Array.isArray( b.p ) || b.p.length < 3 ) continue;
			keep.add( b.captain );
			let m = this.moored.get( b.captain );
			if ( m && m.boatId !== b.boat ) {

				this._disposeMoored( m );
				this.moored.delete( b.captain );
				m = null;

			}

			if ( ! m ) {

				m = { captain: b.captain, name: b.name || '?', boatId: b.boat, model: null, tag: null, pos: new Vector3(), quat: new Quaternion() };
				try {

					const model = createBoatModel( b.boat );
					if ( model && model.group ) {

						m.model = model;
						model.group.name = `MooredBoat:${ b.captain }`;
						this.scene.add( model.group );

					}

				} catch ( e ) {

					console.warn( 'RemotePlayers: moored boat failed', b.boat, e );

				}

				if ( this.hud ) {

					m.tag = document.createElement( 'div' );
					m.tag.className = 'net-tag tw-glass is-hidden is-moored';
					this.hud.append( m.tag );

				}

				this.moored.set( b.captain, m );

			}

			m.name = b.name || m.name;
			if ( m.tag ) m.tag.textContent = `${ m.name } · moored`;
			m.pos.set( b.p[ 0 ], b.p[ 1 ], b.p[ 2 ] );
			const q = Array.isArray( b.q ) && b.q.length === 4 ? b.q : [ 0, 0, 0, 1 ];
			m.quat.set( q[ 0 ], q[ 1 ], q[ 2 ], q[ 3 ] );
			if ( m.model ) {

				m.model.group.position.copy( m.pos );
				m.model.group.quaternion.copy( m.quat );

			}

		}

		for ( const [ k, m ] of [ ...this.moored ] ) if ( ! keep.has( k ) ) {

			this._disposeMoored( m );
			this.moored.delete( k );

		}

	}

	_disposeMoored( m ) {

		try {

			if ( m.model ) {

				this.scene.remove( m.model.group );
				if ( m.model.dispose ) m.model.dispose();

			}

		} catch ( e ) {

			console.warn( 'RemotePlayers: moored boat dispose failed', e );

		}

		if ( m.tag ) m.tag.remove();
		m.model = null;
		m.tag = null;

	}

	// a tag over a world point (+lift m), hidden behind the camera or far away
	_placeTag( tag, pos, lift ) {

		if ( ! tag || ! this.hud || ! this.camera ) return;
		_v.copy( pos );
		_v.y += lift;
		_v.applyMatrix4( this.camera.matrixWorldInverse );
		const dist = _v.length();
		if ( _v.z >= - 0.1 || dist > TAG_FAR ) {

			tag.classList.add( 'is-hidden' );
			return;

		}

		_v2.copy( _v ).applyMatrix4( this.camera.projectionMatrix );
		if ( _v2.x < - 1.2 || _v2.x > 1.2 || _v2.y < - 1.2 || _v2.y > 1.2 ) {

			tag.classList.add( 'is-hidden' );
			return;

		}

		const w = this.hud.clientWidth || window.innerWidth, h = this.hud.clientHeight || window.innerHeight;
		const x = ( _v2.x * 0.5 + 0.5 ) * w, y = ( 0.5 - _v2.y * 0.5 ) * h;
		const fade = dist <= TAG_FADE ? 1 : 1 - ( dist - TAG_FADE ) / ( TAG_FAR - TAG_FADE );
		tag.classList.remove( 'is-hidden' );
		tag.style.opacity = ( fade * 0.8 ).toFixed( 2 );
		tag.style.transform = `translate(${ x.toFixed( 1 ) }px, ${ y.toFixed( 1 ) }px) translate(-50%, -100%) scale(0.85)`;

	}

	// pick the pair of snapshots around renderT and blend them into p.pose / p.boatPos / p.boatQuat
	_interpolate( p, renderT ) {

		const snaps = p.snaps;
		if ( ! snaps.length ) return;
		let a = snaps[ 0 ], b = snaps[ 0 ], t = 0;
		if ( snaps.length > 1 ) {

			let i = snaps.length - 1;
			while ( i > 0 && snaps[ i - 1 ].t > renderT ) i --;
			if ( i === 0 ) {

				a = b = snaps[ 0 ];

			} else if ( snaps[ i ].t <= renderT ) {

				// render time past the newest: hold it (a hesitant peer stops rather than overshoots)
				a = b = snaps[ snaps.length - 1 ];

			} else {

				a = snaps[ i - 1 ];
				b = snaps[ i ];
				const span = b.t - a.t;
				t = span > 0 ? Math.min( 1, Math.max( 0, ( renderT - a.t ) / span ) ) : 1;

			}

			// drop snapshots older than `a` (keep one before for safety)
			const idx = snaps.indexOf( a );
			if ( idx > 1 ) snaps.splice( 0, idx - 1 );

		}

		const pose = p.pose;
		const mode = t < 0.5 ? a.mode : b.mode;
		pose.position.set( a.x + ( b.x - a.x ) * t, a.y + ( b.y - a.y ) * t, a.z + ( b.z - a.z ) * t );
		pose.yaw = lerpAngle( a.yaw, b.yaw, t );
		pose.mode = mode;
		pose.speed = a.speed + ( b.speed - a.speed ) * t;
		pose.vy = a.vy + ( b.vy - a.vy ) * t;
		pose.grounded = b.grounded;
		pose.diving = b.diving;
		pose.action = b.action;
		const bs = b.boat || a.boat;
		if ( bs ) {

			const ba = a.boat || bs, bb = b.boat || bs;
			this._ensureBoat( p, bb.id );
			p.boatPos.set( ba.x + ( bb.x - ba.x ) * t, ba.y + ( bb.y - ba.y ) * t, ba.z + ( bb.z - ba.z ) * t );
			p.boatQuat.set( ba.qx, ba.qy, ba.qz, ba.qw );
			if ( t > 0 && ba !== bb ) p.boatQuat.slerp( _q.set( bb.qx, bb.qy, bb.qz, bb.qw ), t );
			p.boatQuat.normalize();
			p.boatState = bb;
			if ( mode === 'deck' || mode === 'boat' || mode === 'seat' ) pose.frame = p.frame.copy( p.boatQuat );
			else pose.frame = null;

		} else {

			if ( p.boat ) this._disposeBoat( p );
			p.boatState = null;
			pose.frame = null;

		}

		p.riding = mode === 'ride' && ( b.ride || a.ride ) ? { host: b.ride || a.ride, seat: b.seat | 0 } : null;
		if ( p.riding ) {

			pose.frame = null; // (until _seatRider finds the host boat)
			pose.mode = 'seat';
			pose.action = 'seated';

		}

		p.hasPose = true;

	}

	// the transform of a host's boat as this client shows it: { id, position: Vector3, quaternion: Quaternion } or null
	anchor( hostId ) {

		if ( hostId === this.localId ) {

			const lb = this.localBoat ? this.localBoat() : null;
			if ( ! lb || ! lb.position || ! lb.quaternion ) return null;
			_anchor.position.set( lb.position.x, lb.position.y, lb.position.z );
			_anchor.quaternion.set( lb.quaternion.x, lb.quaternion.y, lb.quaternion.z, lb.quaternion.w );
			_anchor.id = lb.id;
			return _anchor;

		}

		const h = this.peers.get( hostId );
		if ( ! h || ! h.boatState || ! h.hasPose ) return null; // (the model may still be loading: the transform is known)
		_anchor.position.copy( h.boatPos );
		_anchor.quaternion.copy( h.boatQuat );
		_anchor.id = h.boatState.id;
		return _anchor;

	}

	// a guest sits on its host's seat (boat frame -> world through the host boat's quaternion)
	_seatRider( p ) {

		const a = this.anchor( p.riding.host );
		if ( ! a ) return; // the host boat is not here (yet): the avatar stays where its own snapshots put it
		const spec = BOATS[ a.id ];
		const seats = spec && spec.seats && spec.seats.length ? spec.seats : [ { x: 0, z: 0, yaw: 0 } ];
		const seat = seats[ Math.min( p.riding.seat, seats.length - 1 ) ];
		const pose = p.pose;
		pose.position.set( seat.x, spec && spec.deckY !== undefined ? spec.deckY : 0.3, seat.z ).applyQuaternion( a.quaternion ).add( a.position );
		pose.frame = p.frame.copy( a.quaternion );
		pose.yaw = seat.yaw + Math.PI;
		pose.speed = 0;
		pose.vy = 0;
		pose.grounded = true;

	}

	_ensureBoat( p, id ) {

		if ( p.boat && p.boatId === id ) return;
		this._disposeBoat( p );
		if ( ! BOATS[ id ] ) return;
		try {

			const model = createBoatModel( id );
			if ( ! model || ! model.group ) return;
			p.boat = model;
			p.boatId = id;
			p.boatReady = ! model.ready;
			if ( model.ready && typeof model.ready.then === 'function' ) model.ready.then( () => { p.boatReady = true; }, ( e ) => console.warn( 'RemotePlayers: boat failed', id, e ) );
			model.group.name = `RemoteBoat:${ p.id }`;
			this.scene.add( model.group );

		} catch ( e ) {

			console.warn( 'RemotePlayers: boat model failed', id, e );
			p.boat = null;
			p.boatId = null;

		}

	}

	_disposeBoat( p ) {

		if ( ! p.boat ) return;
		try {

			this.scene.remove( p.boat.group );
			if ( p.boat.dispose ) p.boat.dispose();

		} catch ( e ) {

			console.warn( 'RemotePlayers: boat dispose failed', e );

		}

		p.boat = null;
		p.boatId = null;
		p.boatReady = false;

	}

	_setName( p, name ) {

		p.name = name;
		if ( p.tag ) p.tag.textContent = name;

	}

	_setCharacter( p, id ) {

		p.character = id;
		if ( p.avatar ) p.avatar.setCharacter( id );

	}

	// project the head (+0.3 m) with the camera's matrices; hide behind the camera or beyond TAG_FAR
	_updateTag( p ) {

		const tag = p.tag;
		if ( ! tag ) return;
		if ( ! p.hasPose || p.hiddenIndoor || ! p.avatar || ! this.hud ) {

			tag.classList.add( 'is-hidden' );
			return;

		}

		p.avatar.headPosition( _v );
		_v.y += 0.3;
		_v.applyMatrix4( this.camera.matrixWorldInverse ); // view space: the camera looks down -z
		const dist = _v.length();
		if ( _v.z >= - 0.1 || dist > TAG_FAR ) {

			tag.classList.add( 'is-hidden' );
			return;

		}

		_v2.copy( _v ).applyMatrix4( this.camera.projectionMatrix );
		if ( _v2.x < - 1.2 || _v2.x > 1.2 || _v2.y < - 1.2 || _v2.y > 1.2 ) {

			tag.classList.add( 'is-hidden' );
			return;

		}

		const w = this.hud.clientWidth || window.innerWidth, h = this.hud.clientHeight || window.innerHeight;
		const x = ( _v2.x * 0.5 + 0.5 ) * w, y = ( 0.5 - _v2.y * 0.5 ) * h;
		const fade = dist <= TAG_FADE ? 1 : 1 - ( dist - TAG_FADE ) / ( TAG_FAR - TAG_FADE );
		const scale = 0.75 + 0.25 * Math.min( 1, 12 / Math.max( 1, dist ) );
		tag.classList.remove( 'is-hidden' );
		tag.classList.toggle( 'is-boat', p.pose.mode === 'boat' || p.pose.mode === 'deck' );
		tag.style.opacity = fade.toFixed( 2 );
		tag.style.transform = `translate(${ x.toFixed( 1 ) }px, ${ y.toFixed( 1 ) }px) translate(-50%, -100%) scale(${ scale.toFixed( 3 ) })`;

	}

	// ---- chat

	// msg: { id, name, text, own? } from NetClient.onChat, or { system: true, text }
	pushChat( msg ) {

		if ( ! this.chatEl || ! msg ) return;
		const line = document.createElement( 'div' );
		line.className = 'net-chat-line tw-glass' + ( msg.own ? ' is-own' : '' ) + ( msg.system ? ' is-system' : '' );
		line.innerHTML = msg.system ? esc( msg.text ) : `<b>${ esc( msg.name || '?' ) }</b>${ esc( msg.text ) }`;
		this.chatEl.append( line );
		this._chatLines.push( { el: line, at: performance.now(), old: false } );
		while ( this._chatLines.length > CHAT_LINES ) this._chatLines.shift().el.remove();

	}

	_expireChat( now ) {

		for ( let i = this._chatLines.length - 1; i >= 0; i -- ) {

			const l = this._chatLines[ i ];
			const age = now - l.at;
			if ( age > CHAT_TTL + 600 ) {

				l.el.remove();
				this._chatLines.splice( i, 1 );

			} else if ( age > CHAT_TTL && ! l.old ) {

				l.old = true;
				l.el.classList.add( 'is-old' );

			}

		}

	}

	dispose() {

		for ( const id of [ ...this.peers.keys() ] ) this.removePeer( id );
		this.setMoored( [] );
		if ( this.chatEl ) this.chatEl.remove();
		this.chatEl = null;
		this._chatLines.length = 0;

	}

}
