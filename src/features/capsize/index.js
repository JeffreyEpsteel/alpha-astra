// Capsize (wave 22B): a small boat that turns over stays over, hull up, until you right her yourself.
//
//   features.add( 'capsize', capsize );   // import * as capsize from './features/capsize/index.js' (after naval, crew, death)
//   const c = features.get( 'capsize' );
//   c.capsized()                 the player's boat is hull up (app.boatCtl.capsized: BoatController CAPSIZE, small hulls only)
//   c.game                       the Righting minigame while you work the hull (Righting.js) | null
//   c.righting()                 true while you are on the hull (TouchControls' Let go button)
//   c.trapped( player ) -> bool  swimming under the upturned hull (the death feature's breath counts it as under water)
//   c.start() -> bool            climb onto the hull now (E beside her does this)
//   c.helpers() -> n             hands pulling with you: posted crew (in the water with you) + other players holding E at her
//   c.update( dt ) / toJSON() / fromJSON( d ) / reset() / dispose()
//
// When she goes over: whoever was at the helm, on a seat or on deck is in the water beside her; the engine is drowned; in a
// campaign the catch in the cooler swims off and the cargo crates float away (naval loot crates worth half their price:
// swim or drive over them). She floats hull up, drifting, the bottom a hand out of the water.
// Righting her: swim to her, E ("Right her": the touch prompt button) climbs onto the hull (Climb_Pull); then the meter
// (Meter.js): hold E to lean back and pull in time with the swell, release to rest. Space lets go. 10-25 s for a good
// attempt in fair weather, longer and twitchier in a blow, quicker with hands helping. Done: she rolls upright (the ballast
// of BoatController takes her the rest of the way) with SWAMP.level of water in her (naval.floodState: slower, lower in
// the water; "Man the pump" on deck bails her, and she drains SWAMP.drain per s by herself), you in the water at her side.
// Slipping off puts you back in the water and she sags back over.
// Big hulls never stay over (BoatController keeps their ballast; they sink by flooding as before).
//
// Multiplayer: world events 'capsize' { captain, name, phase: 'over' | 'righting' | 'up', x, z, yaw, heel, len, beam } (on
// each change, every 0.5 s while righting, every 3 s while over) and 'capsizeHelp' { captain } (a swimmer holding E at
// another player's upturned hull, every 0.6 s: one more hand for him). The boat's pose already rides the net state.
// Events: boatCapsized { boat, x, z, aboard, lost: { fish, crates } }, rightingStarted { helpers, rough }, boatRighted
// { boat, x, z, t, helpers }, rightingSlipped { heel, letGo }.

import { Vector3 } from '../../engine/index.js';
import { BOATS } from '../../game/Boats.js';
import { Righting, RIGHTING, roughness } from './Righting.js';
import { RightingMeter } from './Meter.js';
import { strip, isEmpty } from '../death/Belongings.js';

export { Righting, RIGHTING, roughness, autoHold } from './Righting.js';
export { METER, COLORS } from './Meter.js';

export const SWAMP = { level: 0.6, drain: 0.006 }; // water in her when she comes up (naval flood level); drains per s by herself
export const REACH = 1.8; // m outside her outline where E climbs on
export const HELP = { range: 3.2, every: 0.6, ttl: 1.6 }; // a helper's reach of another player's hull, resend, how long a pull counts
export const SYNC = { righting: 0.5, over: 3, stale: 12 }; // s between 'capsize' events; a remote hull forgotten after
const SAVE_V = 1;

const finite = ( ...v ) => v.every( Number.isFinite );
const KEEL = 0.05; // m above the keel line where the feet stand
const _a = new Vector3(), _b = new Vector3();

export class Capsize {

	constructor( app, features, opts = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.game = null;
		this.remote = new Map(); // captain id -> { name, x, z, yaw, len, beam, phase, heel, t }
		this._helpers = new Map(); // remote id -> time of the last pull
		this.stats = { capsized: 0, righted: 0, slipped: 0 };
		this.swamp = 0; // the share of the boat's water that came in with the capsize (drained by itself)
		this._was = false;
		this._pending = null;
		this._time = 0;
		this._sendT = 0;
		this._helpT = 0;
		this._groanT = 0;
		this._stance = { x: 0, y: 0, z: 0, ly: 0 };
		this._prompt = null;
		this.meter = null;
		this._meterTried = false;
		this._offs = [];
		this._rand = opts.random || Math.random;
		this.hull = this._makeHull();
		const f = this.features;
		if ( f && f.on ) {

			this._offs.push( f.on( 'remoteWorldEvent', ( e ) => this._remoteEvent( e || {} ) ) );
			this._offs.push( f.on( 'playerRespawned', () => this._end( null ) ) );

		}

	}

	// ------------------------------------------------------------------ queries

	_boat() {

		const b = this.app.boatCtl;
		if ( ! b || b.enabled === false || ! b.position || ! b.quaternion ) return null;
		return b;

	}

	_boatId() {

		const st = this.features && this.features.state;
		return this.app.boatId || ( st && st.boat ) || ( this.app.boatCtl && this.app.boatCtl.model && this.app.boatCtl.model.id ) || null;

	}

	_dims( b ) {

		const d = b && b.model && b.model.dimensions;
		const spec = BOATS[ this._boatId() ] || {};
		return { length: ( d && d.length ) || spec.length || 4.5, beam: ( d && d.beam ) || spec.beam || 2, draft: ( d && d.draft ) || spec.draft || 0.25 };

	}

	capsized() {

		const b = this._boat();
		return !! ( b && b.capsized );

	}

	righting() {

		return !! this.game;

	}

	// the player's position in the boat's yaw frame (+X port, +Z forward)
	_local( b, x, z ) {

		const yaw = b.getYaw(), c = Math.cos( yaw ), s = Math.sin( yaw );
		const dx = x - b.position.x, dz = z - b.position.z;
		return { lx: dx * c - dz * s, lz: dx * s + dz * c };

	}

	trapped( p ) {

		const b = this._boat();
		if ( ! b || ! b.capsized || ! p || p.mode !== 'swim' || ! p.position ) return false;
		const d = this._dims( b ), q = this._local( b, p.position.x, p.position.z );
		if ( Math.abs( q.lx ) > d.beam / 2 - 0.2 || Math.abs( q.lz ) > d.length / 2 - 0.35 ) return false;
		return p.position.y < b.position.y + 0.2;

	}

	_near( b, p ) {

		if ( ! p || ! p.position ) return false;
		const d = this._dims( b ), q = this._local( b, p.position.x, p.position.z );
		return Math.abs( q.lx ) < d.beam / 2 + REACH && Math.abs( q.lz ) < d.length / 2 + 0.5 && Math.abs( p.position.y - b.position.y ) < 2.5;

	}

	helpers() {

		let n = 0;
		const crew = this.features && this.features.get ? this.features.get( 'crew' ) : null;
		try { if ( crew && crew.crew && crew.crew.aboard ) n += crew.crew.aboard( crew.ctx ? crew.ctx() : null ).length; } catch ( e ) { /* no crew */ }
		for ( const [ id, t ] of this._helpers ) {

			if ( this._time - t <= HELP.ttl ) n ++;
			else this._helpers.delete( id );

		}

		return Math.min( n, RIGHTING.maxHelpers );

	}

	_rough() {

		return roughness( this.features && this.features.get ? this.features.get( 'weather' ) : null );

	}

	_input() {

		const p = this.app.player;
		return ( p && p.input ) || this.app.input || null;

	}

	// ------------------------------------------------------------------ frame

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		dt = Math.min( dt, 0.1 );
		this._time += dt;
		const b = this._boat(), p = this.app.player;
		// a boat that was over in the save goes over again once she is in the water
		if ( this._pending && b ) {

			const pend = this._pending;
			this._pending = null;
			if ( pend.capsized && b.capsize && b.capsize( pend.side ) ) this._was = true;

		}

		const cap = !! ( b && b.capsized );
		if ( cap && ! this._was ) this._onCapsized( b, p );
		if ( ! cap && this._was ) this._end( null );
		this._was = cap;
		this._prompt = null;
		if ( cap && p ) {

			// nobody stays at the helm or on the deck of an upturned boat (a Player that boarded her with E: the climb)
			if ( p.mode === 'boat' || p.mode === 'seat' ) this._throwOff( b, p );
			else if ( p.mode === 'deck' && ! this.game ) this.start();
			else if ( ! this.game && p.mode === 'swim' && this._near( b, p ) && ! p.busy ) {

				p.prompt = { key: 'E', text: 'Right her · climb onto the upturned hull' };
				const inp = this._input();
				if ( inp && inp.hit && inp.hit( 'KeyE' ) ) this.start();

			}

		}

		if ( this.game ) this._play( dt, b, p );
		else this._showMeter( null );
		this._drain( dt, b );
		this._helpRemote( dt, p );
		this._sync( dt, b );

	}

	// ------------------------------------------------------------------ going over

	_onCapsized( b, p ) {

		this.stats.capsized ++;
		const aboard = !! ( p && [ 'boat', 'deck', 'seat' ].includes( p.mode ) );
		if ( aboard ) this._throwOff( b, p );
		// loose gear: the catch swims off, the crates float away (campaign; the sandbox keeps everything)
		const lost = { fish: 0, crates: 0 };
		if ( aboard && this.features && ! this.features.sandbox ) {

			const got = strip( this.features, { fish: true, cargo: true, money: false } );
			if ( ! isEmpty( got ) ) {

				lost.fish = got.fish.length;
				const nv = this.features.get ? this.features.get( 'naval' ) : null;
				for ( const c of got.cargo ) {

					for ( let i = 0; i < Math.min( c.qty, 4 ); i ++ ) {

						lost.crates ++;
						const v = Math.max( 1, Math.round( ( c.paid || 0 ) / Math.max( 1, c.qty ) * 0.5 ) );
						if ( nv && nv.loot && nv.loot.drop ) try { nv.loot.drop( b.position.x + ( this._rand() * 2 - 1 ) * 3, b.position.z + ( this._rand() * 2 - 1 ) * 3, v, 'capsize' ); } catch ( e ) { /* loot is optional */ }

					}

				}

			}

		}

		const x = b.position.x, z = b.position.z;
		this._splash( x, b.position.y, z, 1.6 );
		this._sfx( 'flood_rush', x, z );
		const g = this.app.game;
		const what = [ lost.fish ? `${ lost.fish } fish lost` : '', lost.crates ? `${ lost.crates } crates afloat` : '' ].filter( Boolean ).join( ', ' );
		if ( g && g.toast ) g.toast( `She turned turtle! Swim to her and press E to right her${ what ? ` (${ what })` : '' }`, 4200 );
		if ( this.features && this.features.emit ) this.features.emit( 'boatCapsized', { boat: this._boatId(), x, z, aboard, lost } );
		this._send( 'over', b );

	}

	_throwOff( b, p ) {

		try {

			if ( p.mode === 'boat' && p.leaveHelm ) p.leaveHelm();
			if ( p.exitBoat ) p.exitBoat( null, - b.capsizeSide || 1 );

		} catch ( e ) { console.warn( 'capsize: could not put the player in the water', e ); }

		if ( p.mode !== 'swim' ) p.mode = 'swim';
		p.floating = true;

	}

	// ------------------------------------------------------------------ the righting

	start() {

		const b = this._boat(), p = this.app.player;
		if ( ! b || ! b.capsized || ! p || this.game || ! p.boardHull ) return false;
		const helpers = this.helpers(), rough = this._rough();
		this.game = new Righting( { rough, helpers, seed: Math.floor( this._rand() * 1e9 ) } );
		this._stancePoint( b );
		if ( ! p.boardHull( this.hull, this._stance.x, this._stance.z ) ) {

			this.game = null;
			return false;

		}

		// facing across her, leaning back away from the gunwale she will lift
		p.deckYaw = b.capsizeSide > 0 ? - Math.PI / 2 : Math.PI / 2;
		this._lock( p );
		const inp = this._input();
		if ( inp && inp.pressed && inp.pressed.delete ) inp.pressed.delete( 'Space' );
		if ( this.app.audio && this.app.audio.splash ) try { this.app.audio.splash( 0.3 ); } catch ( e ) { /* sound */ }
		if ( this.features && this.features.emit ) this.features.emit( 'rightingStarted', { helpers, rough } );
		this._send( 'righting', b );
		return true;

	}

	// where the feet go: the keel line amidships (it swings down towards the water as she comes over)
	_stancePoint( b ) {

		const d = this._dims( b );
		// (hull up the keel line is her top: a little further out along -Y of her frame is a little above it in the world)
		const w = b.toWorld( _a.set( 0, - d.draft - KEEL, b.com ? b.com.z : 0 ), _b );
		const q = this._local( b, w.x, w.z );
		this._stance.x = q.lx;
		this._stance.z = q.lz;
		this._stance.ly = w.y - b.position.y;
		return this._stance;

	}

	// the yaw-only hull the Player walks in 'aboard' mode while on her (Player.boardHull): her keel is the deck
	_makeHull() {

		const self = this;
		return {
			get deckY() { return self._stance.ly; },
			length: 6, beam: 4,
			yaw: () => { const b = self._boat(); return b ? b.getYaw() : 0; },
			x: () => { const b = self._boat(); return b ? b.position.x : 0; },
			z: () => { const b = self._boat(); return b ? b.position.z : 0; },
			y: () => { const b = self._boat(); return b ? b.position.y : 0; },
			alive: () => !! self.game && self.capsized(),
			prompt: () => self._prompt,
			interact: () => {},
		};

	}

	// on the keel: the feet stay at the stance (WASD does not walk her)
	_lock( p ) {

		p.deckPos.set( this._stance.x, this._stance.ly, this._stance.z );
		p.deckVel.set( 0, 0, 0 );
		p.deckGrounded = true;
		if ( p.hullToWorld ) p.hullToWorld();

	}

	_play( dt, b, p ) {

		if ( ! b || ! b.capsized ) {

			this._end( null );
			return;

		}

		if ( ! p || p.mode !== 'aboard' || p.hull !== this.hull ) {

			// something took the player off her (a death, a teleport, Player's own overboard)
			this._end( 'left', b );
			return;

		}

		const g = this.game, inp = this._input();
		if ( inp && inp.hit && inp.hit( 'Space' ) && g.phase !== 'climb' ) {

			this._slip( b, p, true );
			return;

		}

		const hold = !! ( inp && inp.down && inp.down( 'KeyE' ) );
		const ev = g.update( dt, { hold, rough: this._rough(), helpers: this.helpers() } );
		b.pull = g.heel * RIGHTING.pullMax;
		this._stancePoint( b );
		this._lock( p );
		this._prompt = g.phase === 'climb' ? null : { key: 'E', text: 'Hold to pull, in time with the swell · release to rest · Space lets go' };
		p.prompt = this._prompt;
		p.action = g.phase === 'climb' ? 'climbUp' : 'keelPull';
		this._showMeter( g.phase === 'climb' ? null : g.model() );
		// she groans as she comes up
		this._groanT -= dt;
		if ( g.pulling && g.inSpot && this._groanT <= 0 ) {

			this._groanT = 2.2 + this._rand();
			this._sfx( 'hull_groan', b.position.x, b.position.z );

		}

		if ( ev === 'up' ) this._righted( b, p );
		else if ( ev === 'slipped' ) this._slip( b, p, false );

	}

	_water( b ) {

		return b.sampleWaterAt ? b.sampleWaterAt( b.position ) : b.position.y;

	}

	// off the hull into the water on her lifting side
	_toWater( b, p ) {

		const d = this._dims( b ), yaw = b.getYaw(), s = - ( b.capsizeSide || 1 );
		const ox = ( d.beam / 2 + 0.7 ) * s;
		const x = b.position.x + ox * Math.cos( yaw ), z = b.position.z - ox * Math.sin( yaw );
		const w = this._water( b );
		if ( p.leaveHull ) p.leaveHull( x, w - 0.2, z, 'swim', w );
		else p.mode = 'swim';
		p.floating = true;
		p.action = null;

	}

	_righted( b, p ) {

		const g = this.game, helpers = g.helpers;
		this.game = null;
		this._showMeter( null );
		b.right();
		this.stats.righted ++;
		// she comes up full of water: naval's flood level (slower, lower; the pump bails her), draining by herself
		const nv = this.features && this.features.get ? this.features.get( 'naval' ) : null;
		const fl = nv && nv.floodState;
		const add = fl ? Math.max( 0, SWAMP.level - fl.level ) : SWAMP.level;
		if ( fl ) fl.level = Math.max( fl.level, SWAMP.level );
		this.swamp = Math.min( 1, this.swamp + add );
		this._toWater( b, p );
		this._splash( b.position.x, b.position.y, b.position.z, 1.2 );
		this._sfx( 'bucket_slosh', b.position.x, b.position.z );
		const gm = this.app.game;
		if ( gm && gm.toast ) gm.toast( 'She\'s up! Climb in and bail her out (the pump on deck); she\'s slow until she\'s dry', 4200 );
		if ( this.features && this.features.emit ) this.features.emit( 'boatRighted', { boat: this._boatId(), x: b.position.x, z: b.position.z, t: Math.round( g.t * 10 ) / 10, helpers } );
		this._send( 'up', b );

	}

	_slip( b, p, letGo ) {

		const heel = this.game ? this.game.heel : 0;
		this.game = null;
		this._showMeter( null );
		b.pull = 0;
		this.stats.slipped ++;
		this._toWater( b, p );
		if ( this.app.audio && this.app.audio.splash ) try { this.app.audio.splash( 0.6 ); } catch ( e ) { /* sound */ }
		const g = this.app.game;
		if ( g && g.toast ) g.toast( letGo ? 'You let go' : 'You slipped off the hull · catch your breath and try again (E)', 2600 );
		if ( this.features && this.features.emit ) this.features.emit( 'rightingSlipped', { heel, letGo: !! letGo } );
		this._send( 'over', b );

	}

	_end( why, b = this._boat() ) {

		if ( ! this.game ) return;
		this.game = null;
		this._showMeter( null );
		if ( b ) b.pull = 0;
		if ( why === 'left' && b ) this._send( 'over', b );

	}

	// ------------------------------------------------------------------ the water in her

	_drain( dt, b ) {

		if ( ! ( this.swamp > 0 ) ) return;
		const nv = this.features && this.features.get ? this.features.get( 'naval' ) : null;
		const fl = nv && nv.floodState;
		if ( ! b || ( nv && nv.playerHull && nv.playerHull.sunk ) ) {

			this.swamp = 0;
			return;

		}

		if ( b.capsized ) return;
		if ( fl ) this.swamp = Math.min( this.swamp, fl.level ); // (the pump took some)
		const d = Math.min( this.swamp, SWAMP.drain * dt );
		this.swamp -= d;
		if ( fl ) fl.level = Math.max( 0, fl.level - d );

	}

	// ------------------------------------------------------------------ multiplayer

	_net() {

		const n = this.app.netsync;
		return n && n.sendWorldEvent ? n : null;

	}

	_send( phase, b ) {

		const n = this._net();
		if ( ! n || ! b ) return;
		const d = this._dims( b ), r = ( v ) => Math.round( v * 10 ) / 10;
		const st = this.features && this.features.state;
		try {

			n.sendWorldEvent( 'capsize', { captain: n.id || null, name: ( st && st.name ) || 'Fisher', phase, x: r( b.position.x ), z: r( b.position.z ),
				yaw: Math.round( b.getYaw() * 100 ) / 100, heel: this.game ? Math.round( this.game.heel * 100 ) / 100 : 0, len: r( d.length ), beam: r( d.beam ) } );

		} catch ( e ) { /* offline */ }

		this._sendT = phase === 'righting' ? SYNC.righting : SYNC.over;

	}

	_sync( dt, b ) {

		if ( ! b || ! b.capsized || ! this._net() ) return;
		this._sendT -= dt;
		if ( this._sendT <= 0 ) this._send( this.game ? 'righting' : 'over', b );

	}

	_remoteEvent( e ) {

		const d = e.data || {};
		if ( e.kind === 'capsize' ) {

			const id = e.from || d.captain;
			if ( ! id || ! finite( d.x, d.z ) ) return;
			if ( d.phase === 'up' ) this.remote.delete( id );
			else this.remote.set( id, { name: typeof d.name === 'string' ? d.name.slice( 0, 24 ) : 'a fisher', x: d.x, z: d.z, yaw: Number.isFinite( d.yaw ) ? d.yaw : 0,
				len: Number.isFinite( d.len ) ? d.len : 4.5, beam: Number.isFinite( d.beam ) ? d.beam : 2, phase: d.phase, heel: Number.isFinite( d.heel ) ? d.heel : 0, t: this._time } );

		} else if ( e.kind === 'capsizeHelp' ) {

			const n = this._net();
			if ( n && d.captain && d.captain === n.id && e.from ) this._helpers.set( e.from, this._time );

		}

	}

	// beside another player's upturned hull: hold E to pull with him
	_helpRemote( dt, p ) {

		for ( const [ id, r ] of this.remote ) if ( this._time - r.t > SYNC.stale ) this.remote.delete( id );
		if ( this.game || ! p || p.mode !== 'swim' || ! p.position || ! this.remote.size || ( p.prompt && p.prompt.key === 'E' ) ) return;
		let best = null, bd = Infinity;
		for ( const [ id, r ] of this.remote ) {

			const dist = Math.hypot( r.x - p.position.x, r.z - p.position.z ) - r.beam / 2;
			if ( dist < HELP.range && dist < bd ) { bd = dist; best = [ id, r ]; }

		}

		if ( ! best ) return;
		const [ id, r ] = best;
		p.prompt = { key: 'E', text: r.phase === 'righting' ? `Help ${ r.name } right her · hold E` : `${ r.name }'s boat is over · hold E to help when they pull` };
		const inp = this._input();
		this._helpT -= dt;
		if ( inp && inp.down && inp.down( 'KeyE' ) && this._helpT <= 0 ) {

			this._helpT = HELP.every;
			const n = this._net();
			if ( n ) try { n.sendWorldEvent( 'capsizeHelp', { captain: id } ); } catch ( e ) { /* offline */ }

		}

	}

	// ------------------------------------------------------------------ fx

	_splash( x, y, z, s ) {

		const vfx = this.features && this.features.get ? this.features.get( 'vfx' ) : null;
		if ( vfx && vfx.splash ) try { vfx.splash( x, y, z, s ); } catch ( e ) { /* fx are optional */ }
		if ( this.app.audio && this.app.audio.splash ) try { this.app.audio.splash( Math.min( 1, s * 0.6 ) ); } catch ( e ) { /* sound */ }

	}

	_sfx( name, x, z ) {

		const sfx = this.features && this.features.get ? this.features.get( 'sfx' ) : null;
		if ( ! sfx ) return;
		try {

			const at = { x, y: 0.5, z };
			if ( sfx.events && sfx.events.trigger && ( name === 'flood_rush' || name === 'bucket_slosh' ) ) sfx.events.trigger( name, { at } );
			else if ( sfx.play ) sfx.play( name, { at } );

		} catch ( e ) { /* sound is optional */ }

	}

	_showMeter( m ) {

		// (the meter is the view: a DOM problem never stops the righting)
		try {

			if ( ! this.meter && ! this._meterTried && m ) {

				const ui = this.app.ui && this.app.ui.ui;
				if ( ui ) {

					this._meterTried = true;
					const parent = ui.hud || ui.root;
					if ( parent ) this.meter = new RightingMeter( parent );

				}

			}

			if ( this.meter ) this.meter.set( m );

		} catch ( e ) {

			if ( this.meter ) console.warn( 'capsize: the meter failed', e );
			this.meter = null;
			this._meterTried = true;

		}

	}

	// ------------------------------------------------------------------ save

	toJSON() {

		const b = this._boat();
		return { v: SAVE_V, capsized: !! ( b && b.capsized ), side: b && b.capsizeSide < 0 ? - 1 : 1, swamp: Math.round( this.swamp * 1000 ) / 1000, stats: { ...this.stats } };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this._end( null );
		this._pending = { capsized: !! d.capsized, side: d.side < 0 ? - 1 : 1 };
		this.swamp = Number.isFinite( d.swamp ) ? Math.max( 0, Math.min( 1, d.swamp ) ) : 0;
		if ( d.stats && typeof d.stats === 'object' ) for ( const k of Object.keys( this.stats ) ) if ( Number.isFinite( d.stats[ k ] ) ) this.stats[ k ] = Math.max( 0, d.stats[ k ] );

	}

	reset() {

		this._end( null );
		this._pending = null;
		this.swamp = 0;
		this.remote.clear();
		this._helpers.clear();
		this.stats = { capsized: 0, righted: 0, slipped: 0 };

	}

	dispose() {

		this._end( null );
		for ( const off of this._offs ) off();
		this._offs.length = 0;
		if ( this.meter ) this.meter.dispose();
		this.meter = null;

	}

}

export function install( app, features, opts = {} ) {

	return new Capsize( app, features, opts );

}

export default { install };
