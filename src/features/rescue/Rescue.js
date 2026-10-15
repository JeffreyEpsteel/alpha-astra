// Rescue (wave 15D): distress flares and the ally vessel that answers them, and the climb-onto-anything providers.
// The user: "the ability to jump on an object when in water" and "flares that would make an ally vessel come and take
// you to shore".
//
//   features.add( 'rescue', rescue );   const r = features.get( 'rescue' );
//   r.flares                    flares carried (a pack of FLARE.pack from the chandlery / the harbour agents; FLARE.max)
//   r.buy( { port } ) -> { ok, added, price, reason }   (features.state pays; free in the sandbox)
//   r.shopRows()                HTML rows for Ethena's Gear tab (data-flare button)   r.agentRow( port ) -> agents' row
//   r.canFire() / r.situation() 'swim' | 'adrift' | 'wreck' | 'aboard' | null: where a flare may be fired (swimming; adrift in
//                               your boat: no fuel, a dead engine, a sunk hull; standing on a wreck / something afloat; aboard a
//                               crippled ship). F held FLARE.hold s fires one (FLARE.cooldown between); r.fire() does it now
//   r.wantsKey( code )          true for 'KeyF' while a flare could be fired (App's free-camera F gives way then)
//   r.job                       the answer in progress | null: { phase: 'waiting' | 'inbound' | 'alongside' | 'ride' | 'leave',
//                               by: 'launch' | 'merchant', ship, hull, port, dest: 'dock' | 'boat', tow, origin, ... }
//   r.stepAcross()              aboard the answering hull from a deck / a float (E: the interactable does it)
//   r.update( dt ) / toJSON() / fromJSON( d ) / reset() / dispose();  r.lights (the flares' red lights, the launch's lamp)
//                               the save carries the job in progress (toJSON().job: phase, by, dest, tow, port, origin, coxswain,
//                               t / delay, plan, her kind and place when she is ours); fromJSON restores it on the next update
//
// The answer (RescueData.planResponse): within RESCUE.answer s the nearest port's harbour launch (naval.spawn of the 'launch'
// class, else a trawler hull tuned fast, state 'rescue': the merchant brain leaves unknown states alone and this module steers
// her) puts out, or a passing merchant within RESCUE.passRange alters course; no port within RESCUE.portRange: a merchant on
// passage happens by after RESCUE.ocean s (until then the death feature's lost-at-sea rule stands). A high notoriety may bring a
// black sail instead (rescueAnswered { by: 'pirate' } only: the hijack / pirates side owns that). She comes alongside, you climb
// aboard (Player's climb rule: the ship provider here), ride on deck (Player mode 'aboard' on her hull) to the nearest port's
// dock, or to your boat if she is afloat and you ask the coxswain (E near the stern); she charges a fee by distance at the dock
// (free in the sandbox, the first one free in the campaign), then leaves. Adrift in your own boat: E steps across, your boat
// comes in on a line (moored at that port; the fee x RESCUE.fee.tow).
// Wave 16A: the launch is naval's 'launch' class (ShipClasses.js), an open harbour launch built procedurally (world/boat/Launch.js
// LaunchVisual: this module teaches naval's ModelSet to draw it, drawProcedural, and draws the ones it sails itself). Her coxswain
// stands at the wheel (Coxswain.js: a roster character), turns to you and speaks the lines (_say); her mast lamp is the light.
//   r.coxswain                  the Coxswain while she is out | null      r.launchEntry() -> { kind, x, z, yaw, speed, name, inNaval }
//                               | null (the boat this module sent, for netsync's RescueLink)
//   opts.avatarFactory          tests: the coxswain's figure (anything with { group, ready, dispose })
// Climbing (Player.addClimbable): naval's ships, crippled or lying still (or the answering hull, always): on her deck the hook
// features.get( 'hijack' )?.onClimb?.( ship, { player, hull } ) runs (worker 15C), else a struck pirate starts boarding's
// crossing; emits climbedAboard { ship, id, name, faction }. Floaters.js keeps rider boxes on things afloat.
// Events: flareFired { x, z, by: 'player' | 'remote' }, flaresBought { count, price }, rescueAnswered { by, x, z, port?, ship? },
//   rescueAlongside { by }, rescueDelivered { by, port, fee, dest, tow }, rescueAbandoned { by, reason }, climbedAboard.
// World event (netsync): 'flareFired' { x, z }; other players see the flare (remoteWorldEvent).
// Headless: install( app, features, { rng, naval } ) runs without a scene (tests).
import { Vector3 } from '../../engine/index.js';
import { BOATS } from '../../game/Boats.js';
import { WORLD } from '../../world/WorldLayout.js';
import { FLOAT_TAGS } from '../../player/Player.js';
import { Ship } from '../naval/Ship.js';
import { SHIP_CLASSES } from '../naval/ShipClasses.js';
import { LaunchVisual, drawProcedural } from '../../world/boat/Launch.js';
import { FLARE, RESCUE, LAUNCH, COXSWAINS, rescueFee, nearestPort, planResponse } from './RescueData.js';
import { Coxswain } from './Coxswain.js';
import { Flares } from './Flares.js';
import { Floaters } from './Floaters.js';

const SAVE_V = 1;
const MARKER = 'rescue';
const _up = new Vector3( 0, 1, 0 );
const finite = ( ...v ) => v.every( Number.isFinite );
const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

// a naval Ship as a Player hull (see Player.boardHull): yaw-only frame, +X port, +Z forward, her waterline heave
export function shipHull( ship, extra = {} ) {

	return {
		ship, id: ship.id, name: ship.name, kind: 'ship',
		get deckY() { return ship.cls.deck; },
		get length() { return ship.cls.length; },
		get beam() { return ship.cls.beam; },
		yaw: () => ship.yaw, x: () => ship.x, z: () => ship.z, y: () => ( ship.pose ? ship.pose.y : 0 ),
		alive: () => ship.alive && ship.state !== 'gone',
		prompt: extra.prompt || null, interact: extra.interact || null,
	};

}

// world ( X, Z ) into a ship's frame
function shipLocal( s, X, Z, out = {} ) {

	const dx = X - s.x, dz = Z - s.z, c = Math.cos( s.yaw ), sn = Math.sin( s.yaw );
	out.x = dx * c - dz * sn;
	out.z = dx * sn + dz * c;
	return out;

}

// metres from a world point to her hull rectangle (0 inside it)
function hullGap( s, X, Z ) {

	const l = shipLocal( s, X, Z );
	return Math.hypot( Math.max( 0, Math.abs( l.x ) - s.cls.beam / 2 ), Math.max( 0, Math.abs( l.z ) - s.cls.length / 2 ) );

}

function shipWorld( s, lx, lz, out = {} ) {

	const c = Math.cos( s.yaw ), sn = Math.sin( s.yaw );
	out.x = s.x + lx * c + lz * sn;
	out.z = s.z - lx * sn + lz * c;
	return out;

}

export class Rescue {

	constructor( app, features, opts = {} ) {

		this.app = app;
		this.features = features;
		this.rng = opts.rng || Math.random;
		this._naval = opts.naval || null;
		this._avatarFactory = opts.avatarFactory || null;
		this._pending = null; // a saved job, restored on the next update
		this._uid = Math.floor( Math.random() * 0x7fffffff ).toString( 36 );
		this._spawned = 0;
		this.coxswain = null;
		this.flares = 0;
		this.firstFree = true; // the campaign's first rescue costs nothing
		this.stats = { fired: 0, rescued: 0, paid: 0 };
		this.cooldown = 0;
		this.job = null;
		this._hold = 0;
		this._hint = false;
		this._ownSim = []; // ships this module sails itself (no naval, or naval not simulating here)
		this._markT = 0;
		this._lamp = { position: new Vector3( 0, - 100, 0 ), color: { r: 1.0, g: 0.92, b: 0.78 }, intensity: 3.2, range: 26, kind: 'launchLamp', enabled: false, dir: null, flicker: 0 };
		this.fx = new Flares( { scene: app && app.scene || null, vfx: () => this._f( 'vfx' ), audio: app && app.audio || null, sfx: () => this._f( 'sfx' ) } );
		this.floaters = new Floaters( { app, features } );
		this.lights = [ ...this.fx.lights, this._lamp ];
		this._off = [];
		if ( features && features.claimKey ) features.claimKey( 'KeyF', 'rescue' );
		if ( features && features.on ) {

			this._off.push( features.on( 'remoteWorldEvent', ( e ) => this._onRemote( e ) ) );
			this._off.push( features.on( 'playerRespawned', () => this._abandon( 'respawn' ) ) );

		}

		if ( features && features.interactable ) {

			this._off.push( features.interactable( {
				id: 'rescue-step-across', radius: 14,
				position: () => {

					const s = this.job && this.job.ship;
					return s ? { x: s.x, y: ( s.pose ? s.pose.y : 0 ) + s.cls.deck - 1.2, z: s.z } : null;

				},
				prompt: () => ( this.job && this.job.ship ? `Step aboard the ${ this.job.ship.name }` : null ),
				when: () => this._canStepAcross(),
				onInteract: () => this.stepAcross(),
			} ) );

		}

		this._climbOff = null;
		this._hookPlayer();

	}

	_f( n ) {

		return this.features && this.features.get ? this.features.get( n ) : null;

	}

	get naval() {

		return this._naval || this._f( 'naval' );

	}

	get state() {

		return this.features ? this.features.state : null;

	}

	get free() {

		return !! ( this.features && this.features.sandbox );

	}

	_toast( text, ms = 3200 ) {

		const g = this.app && this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	// the coxswain's line: the toast, and he turns to you and talks
	_say( text, ms = 3200 ) {

		this._toast( text, ms );
		if ( this.coxswain ) this.coxswain.talk();

	}

	// naval's ModelSet draws the procedural classes (the launch) with world/boat/Launch.js (once per ModelSet)
	_patchModels() {

		const nv = this.naval;
		if ( nv && nv.models ) drawProcedural( nv.models );

	}

	// the climb provider on the player (once there is one)
	_hookPlayer() {

		const p = this.app && this.app.player;
		if ( this._climbOff || ! p || typeof p.addClimbable !== 'function' ) return;
		this._climbOff = p.addClimbable( ( x, z, water ) => this.shipClimb( x, z, water ) );

	}

	// ------------------------------------------------------------------ flares

	priceOf( port = null ) {

		if ( this.free ) return 0;
		const st = this._f( 'story' ), ag = this._f( 'agents' );
		let k = 1;
		if ( port && ag && ag.price ) return Math.round( ag.price( FLARE.price, port ) );
		if ( st && st.priceMod ) k = st.priceMod( port ) || 1;
		return Math.round( FLARE.price * k );

	}

	buy( { port = null } = {} ) {

		if ( this.flares >= FLARE.max ) return { ok: false, added: 0, price: 0, reason: 'full' };
		const price = this.priceOf( port ), st = this.state;
		if ( price > 0 && ( ! st || ! st.spend || ! st.spend( price ) ) ) return { ok: false, added: 0, price, reason: 'money' };
		const added = Math.min( FLARE.pack, FLARE.max - this.flares );
		this.flares += added;
		if ( this.features && this.features.emit ) this.features.emit( 'flaresBought', { count: added, price } );
		this._toast( `Distress flares: ${ this.flares } carried · hold F in trouble at sea`, 3000 );
		return { ok: true, added, price, reason: null };

	}

	shopRows() {

		const st = this.state || {}, price = this.priceOf(), money = Number.isFinite( st.money ) ? st.money : 0;
		const full = this.flares >= FLARE.max;
		const btn = full ? '<span class="gm-have">Full</span>' : `<button class="gm-btn" data-flare ${ ! this.free && price > money ? 'disabled' : '' }>${ this.free ? 'Free' : `$${ price }` }</button>`;
		return `<div class="gm-shop-row"><span>Distress flares · ${ FLARE.pack }<small>Hold F when adrift or in the water: the nearest harbour sends its launch · you carry ${ this.flares }</small></span>${ btn }</div>`;

	}

	// a row for the harbour agents' window (agents.rows), act key 'flares'
	agentRow( port ) {

		const st = this.state || {}, price = this.priceOf( port ), full = this.flares >= FLARE.max;
		return {
			key: 'flares', label: `Distress flares · ${ FLARE.pack }`, note: `Hold F when adrift or in the water · you carry ${ this.flares }`,
			price, action: 'Buy', have: full ? 'Full' : null, disabled: full || ( ! this.free && price > ( st.money || 0 ) ),
		};

	}

	// where you are, if it is somewhere a flare makes sense
	situation() {

		const p = this.app && this.app.player;
		if ( ! p ) return null;
		const d = this._f( 'death' );
		if ( d && d.dying ) return null;
		if ( p.mode === 'swim' ) return 'swim';
		if ( p.mode === 'aboard' ) return p.hull && this.job && p.hull === this.job.hull ? null : 'aboard';
		if ( p.mode === 'walk' && this._onFloat( p ) ) return 'wreck';
		if ( ( p.mode === 'boat' || p.mode === 'deck' || p.mode === 'seat' ) && this.adrift() ) return 'adrift';
		return null;

	}

	// standing on a box tagged afloat (a wreck's roof, a float, a plank...)
	_onFloat( p ) {

		const col = this.app.colliders;
		if ( ! col || ! col.boxes || ! p.position ) return false;
		const q = p.position;
		for ( const b of col.boxes ) {

			if ( ! FLOAT_TAGS.has( b.tag ) || Math.abs( b.top - q.y ) > 0.3 ) continue;
			const dx = q.x - b.center.x, dz = q.z - b.center.z;
			const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
			if ( Math.abs( lx ) <= b.half.x + 0.2 && Math.abs( lz ) <= b.half.z + 0.2 ) return true;

		}

		return false;

	}

	// your boat can't get you home: no fuel (an engine boat), the engine or sails shot away, the hull sunk or going down
	adrift() {

		const st = this.state, nv = this.naval;
		if ( ! st || ! st.boat ) return false;
		if ( nv && ( ( nv.playerHull && nv.playerHull.sunk ) || nv.sinking ) ) return true;
		if ( nv && Number.isFinite( nv.speedFactor ) && nv.speedFactor <= 0.02 ) return true;
		const spec = BOATS[ st.boat ];
		const engine = ! spec || ( spec.drive !== 'row' && spec.drive !== 'paddle' );
		return engine && !! st.stats && st.stats.fuelL > 0 && Number.isFinite( st.fuelL ) && st.fuelL <= 0.05;

	}

	canFire() {

		return this.flares > 0 && this.cooldown <= 0 && !! this.situation();

	}

	wantsKey( code ) {

		return code === 'KeyF' && this.flares > 0 && !! this.situation();

	}

	fire() {

		const sit = this.situation();
		if ( this.flares <= 0 || this.cooldown > 0 || ! sit ) return false;
		const p = this.app.player.position;
		this.flares --;
		this.cooldown = FLARE.cooldown;
		this.stats.fired ++;
		this.fx.launch( p.x, p.y + 1.2, p.z );
		const at = { x: Math.round( p.x * 10 ) / 10, z: Math.round( p.z * 10 ) / 10 };
		if ( this.features && this.features.emit ) this.features.emit( 'flareFired', { ...at, by: 'player' } );
		const net = this.app.netsync;
		if ( net && net.sendWorldEvent ) try { net.sendWorldEvent( 'flareFired', at ); } catch ( e ) { /* offline */ }
		if ( ! this.job ) this._dispatch( p.x, p.z, sit );
		else this._toast( this.job.phase === 'waiting' ? 'Another flare up · keep watching the horizon' : `The ${ this.job.ship ? this.job.ship.name : 'boat' } has you in sight`, 2400 );
		if ( this.flares === 0 ) this._toast( 'That was your last flare', 2400 );
		return true;

	}

	_onRemote( e ) {

		if ( ! e || e.kind !== 'flareFired' || e.replay || ! e.data ) return;
		const { x, z } = e.data;
		if ( ! finite( x, z ) ) return;
		this.fx.launch( x, 1, z, { remote: true } );
		if ( this.features && this.features.emit ) this.features.emit( 'flareFired', { x, z, by: 'remote', from: e.from } );
		const p = this.app.player && this.app.player.position;
		if ( p ) {

			const d = Math.hypot( x - p.x, z - p.z );
			if ( d < 4000 ) this._toast( `A red flare ${ bearingWord( x - p.x, z - p.z ) }, ${ d < 1000 ? Math.round( d / 10 ) * 10 + ' m' : ( d / 1000 ).toFixed( 1 ) + ' km' } off`, 3200 );

		}

	}

	// ------------------------------------------------------------------ the answer

	_dispatch( x, z, sit ) {

		const nv = this.naval, pir = this._f( 'pirates' );
		let notoriety = 0;
		try { notoriety = pir && pir.notorietyLevel ? pir.notorietyLevel() | 0 : 0; } catch ( e ) { notoriety = 0; }
		const plan = planResponse( { x, z, ships: nv && nv.ships ? nv.ships : [], notoriety, rng: this.rng } );
		this.job = {
			phase: 'waiting', t: 0, delay: plan.delay, by: plan.by, plan, port: plan.port || null, ship: null, hull: null,
			origin: { x, z }, tow: sit === 'adrift', dest: 'dock', sighted: false, stuckT: 0, rideT: 0, waitT: 0, own: false, prev: null,
			coxswain: COXSWAINS[ Math.floor( this.rng() * COXSWAINS.length ) % COXSWAINS.length ],
		};
		this._toast( 'Flare away · someone may have seen it', 2600 );

	}

	// the delay is up: whoever it is sets out
	_answer( j ) {

		const p = this.app.player.position, plan = j.plan;
		if ( plan.by === 'pirate' ) {

			if ( this.features && this.features.emit ) this.features.emit( 'rescueAnswered', { by: 'pirate', x: j.origin.x, z: j.origin.z } );
			this._toast( 'A black sail turns toward your flare…', 3600 );
			this.job = null;
			return;

		}

		let ship = null;
		if ( plan.ship && plan.ship.alive && plan.ship.state !== 'flee' ) {

			ship = plan.ship;
			j.prev = { state: ship.state };
			j.by = 'merchant';
			ship.setState( 'rescue' );
			this._toast( `The ${ ship.name } has seen your flare and alters course`, 3600 );

		} else if ( plan.by === 'launch' && plan.port ) {

			ship = this._spawnLaunch( plan.port, p );
			j.by = 'launch';
			j.own = true;
			const d = Math.hypot( ship.x - p.x, ship.z - p.z );
			this._toast( `The ${ plan.port.name } harbour launch is putting out · ${ fmtDist( d ) } away`, 3800 );

		} else {

			ship = this._spawnPasser( p );
			j.by = 'merchant';
			j.own = true;
			this._toast( `A merchantman on passage has seen your flare: the ${ ship.name }`, 3800 );

		}

		ship.rescuing = true;
		j.ship = ship;
		j.hull = shipHull( ship, { prompt: ( pl ) => this._hullPrompt( pl ), interact: () => this._hullInteract() } );
		j.phase = 'inbound';
		if ( this.features && this.features.emit ) this.features.emit( 'rescueAnswered', { by: j.by, x: j.origin.x, z: j.origin.z, port: j.port ? j.port.id : null, ship: ship.id } );

	}

	// a ship of this module: through naval when it simulates here, else sailed by this module (no visual)
	_spawn( kind, o ) {

		const nv = this.naval;
		this._patchModels();
		// an id of its own: a guest's boat must not share one with the host's ships (NavalLink matches the puppets by id)
		if ( ! o.id ) o = { ...o, id: `rescue-${ this._uid }-${ ++ this._spawned }` };
		if ( nv && nv.spawn && nv.active !== false ) {

			try { return nv.spawn( kind, o ); } catch ( e ) { /* unknown class: below */ }

		}

		const s = new Ship( kind, o );
		s.want = s.yaw;
		// (no naval to draw her: the launch's own visual, when there is a scene)
		if ( this.app && this.app.scene && SHIP_CLASSES[ kind ] && SHIP_CLASSES[ kind ].model === 'launch' ) s.visual = new LaunchVisual( { scene: this.app.scene } );
		this._ownSim.push( s );
		return s;

	}

	_deep( x, z ) {

		const t = this.app.terrainData;
		return ! t || ! t.heightAt || t.heightAt( x, z ) < - 2.6;

	}

	// the launch: from the port's roads (or the dock), or already out on patrol when the port is far
	_spawnLaunch( port, p ) {

		let sx = port.roads ? port.roads[ 0 ] : port.dock.position.x, sz = port.roads ? port.roads[ 1 ] : port.dock.position.z;
		let d = Math.hypot( p.x - sx, p.z - sz );
		if ( d > RESCUE.launchOut ) {

			const k = RESCUE.launchOut / d;
			sx = p.x + ( sx - p.x ) * k;
			sz = p.z + ( sz - p.z ) * k;
			d = RESCUE.launchOut;

		}

		// into water she floats in, toward the swimmer
		for ( let i = 0; i < 20 && ! this._deep( sx, sz ); i ++ ) {

			sx += ( p.x - sx ) * 0.08;
			sz += ( p.z - sz ) * 0.08;

		}

		const kind = SHIP_CLASSES[ LAUNCH.kind ] ? LAUNCH.kind : LAUNCH.fallback;
		const s = this._spawn( kind, { x: sx, z: sz, yaw: Math.atan2( p.x - sx, p.z - sz ), speed: 0, name: `${ port.name } launch`, state: 'rescue' } );
		if ( kind !== LAUNCH.kind ) s.cls = { ...s.cls, ...LAUNCH.tune }; // (this hull only: the class table is naval's)
		s.faction = 'navy'; // (not one of naval's merchants: the lanes keep their own count)
		s.captain = this.job ? this.job.coxswain : null;
		this._crew( s );
		return s;

	}

	// her coxswain at the wheel (a figure when there is a scene or a test's factory; his place either way)
	_crew( s ) {

		if ( this.coxswain ) this.coxswain.dispose();
		const av = this.app && this.app.avatar;
		this.coxswain = new Coxswain( {
			scene: this.app && this.app.scene || null, avatarFactory: this._avatarFactory,
			name: s.captain || COXSWAINS[ 0 ], avoid: av && av.character ? av.character : null,
		} );
		return this.coxswain;

	}

	// the boat this module sent (for netsync's RescueLink): the launch or the merchant it sails, while she is out
	launchEntry() {

		const j = this.job, s = j && j.ship;
		if ( ! s || ! j.own || ! s.alive || s.state === 'gone' ) return null;
		return { kind: s.kind, x: s.x, z: s.z, yaw: s.yaw, speed: s.speed, name: s.name, inNaval: !! ( this.naval && this.naval.ships && this.naval.ships.includes( s ) ) };

	}

	// open ocean: a merchant on passage, out of sight to begin with
	_spawnPasser( p ) {

		let a = this.rng() * Math.PI * 2, sx = 0, sz = 0;
		for ( let i = 0; i < 12; i ++, a += 0.52 ) {

			sx = p.x + Math.sin( a ) * RESCUE.oceanSpawn;
			sz = p.z + Math.cos( a ) * RESCUE.oceanSpawn;
			if ( this._deep( sx, sz ) ) break;

		}

		return this._spawn( 'trawler', { x: sx, z: sz, yaw: Math.atan2( p.x - sx, p.z - sz ), speed: 2, state: 'rescue' } );

	}

	// steer toward ( tx, tz ), easing off to stop `stop` m short; returns the distance
	_steer( s, tx, tz, stop, top = 1 ) {

		const d = Math.hypot( tx - s.x, tz - s.z );
		s.want = Math.atan2( tx - s.x, tz - s.z );
		s.wantSpeed = d <= stop ? 0 : clamp( ( d - stop ) / RESCUE.slowAt, 0.15, top );
		return d;

	}

	// the player's world spot (on deck: her feet; at the helm: the boat)
	_playerAt() {

		const p = this.app.player;
		return p.position;

	}

	_onboard() {

		const p = this.app.player, j = this.job;
		return !! ( p && j && j.hull && p.mode === 'aboard' && p.hull === j.hull );

	}

	_boatAfloat() {

		const b = this.app.boatCtl, st = this.state, nv = this.naval;
		if ( ! b || ! b.position || ! st || ! st.boat || b.enabled === false ) return false;
		if ( nv && ( ( nv.playerHull && nv.playerHull.sunk ) || nv.sinking || nv.wreck ) ) return false;
		return true;

	}

	_hullPrompt( pl ) {

		const j = this.job;
		if ( ! j || j.phase !== 'ride' || j.tow || ! this._boatAfloat() ) return null;
		// the coxswain stands at the stern: speak to him there
		if ( ! pl || ! pl.deckPos || pl.deckPos.z > - j.ship.cls.length * 0.2 ) return null;
		return { key: 'E', text: j.dest === 'boat' ? `${ j.coxswain }: back to the dock instead` : `${ j.coxswain }: take me to my boat` };

	}

	_hullInteract() {

		const j = this.job;
		if ( ! j || j.phase !== 'ride' ) return;
		j.dest = j.dest === 'boat' ? 'dock' : 'boat';
		j.stuckT = 0;
		j.best = Infinity;
		j.bestT = 0;
		this._say( j.dest === 'boat' ? `${ j.coxswain }: "Your boat it is."` : `${ j.coxswain }: "The dock, then."`, 2400 );

	}

	_canStepAcross() {

		const j = this.job, p = this.app.player;
		if ( ! j || ! j.ship || j.phase !== 'alongside' || ! p ) return false;
		if ( ! [ 'walk', 'deck', 'seat' ].includes( p.mode ) ) return false;
		const s = j.ship, q = p.position;
		return Math.hypot( s.x - q.x, s.z - q.z ) < s.cls.length / 2 + 10;

	}

	// aboard the answering hull from a deck, a float or a wreck (E)
	stepAcross() {

		const j = this.job, p = this.app.player;
		if ( ! j || ! j.ship || ! p || ! p.boardHull ) return false;
		if ( p.mode === 'seat' && p.standUp ) p.standUp();
		const l = shipLocal( j.ship, p.position.x, p.position.z );
		p.boardHull( j.hull, Math.sign( l.x || 1 ) * j.ship.cls.beam * 0.3, clamp( l.z, - j.ship.cls.length * 0.3, j.ship.cls.length * 0.3 ) );
		return true;

	}

	_update( j, dt ) {

		const s = j.ship;
		if ( ! s || ! s.alive ) {

			this._abandon( 'lost' );
			return;

		}

		const p = this._playerAt(), onboard = this._onboard();
		if ( j.phase === 'inbound' || j.phase === 'alongside' ) {

			if ( onboard ) {

				this._boarded( j );
				return;

			}

			// the gap from her side to you (your boat's side when she comes for a tow)
			const own = j.tow && this.app.boatCtl && this.app.boatCtl.model && this.app.boatCtl.model.dimensions ? this.app.boatCtl.model.dimensions.beam / 2 : 0;
			const gap = hullGap( s, p.x, p.z ) - own;
			const d = Math.hypot( p.x - s.x, p.z - s.z );
			if ( ! j.sighted && d < RESCUE.sight ) {

				j.sighted = true;
				this._toast( `The ${ s.name } is in sight`, 2600 );

			}

			if ( j.phase === 'alongside' ) {

				// lying stopped beside you
				s.wantSpeed = 0;
				s.want = s.yaw;
				j.waitT += dt;
				if ( gap > RESCUE.alongside + 16 ) j.phase = 'inbound';
				else if ( j.waitT > RESCUE.wait ) this._abandon( 'waited' );
				return;

			}

			if ( gap > 40 ) this._steer( s, p.x, p.z, 0 );
			else {

				// the last of it: aim her centre at a spot off your side, slowly (her side comes up to you, not her bow)
				const px = Math.cos( s.yaw ), pz = - Math.sin( s.yaw ); // (her port side in the world)
				const side = Math.sign( ( p.x - s.x ) * px + ( p.z - s.z ) * pz ) || 1;
				const off = s.cls.beam / 2 + RESCUE.alongside * 0.6 + own;
				const dP = this._steer( s, p.x - px * side * off, p.z - pz * side * off, 0.8, 0.3 );
				s.wantSpeed = Math.min( s.wantSpeed, clamp( dP / 25, 0.06, 0.3 ) );

			}

			if ( gap < RESCUE.alongside && Math.abs( s.speed ) < 2 ) {

				j.phase = 'alongside';
				j.waitT = 0;
				s.wantSpeed = 0;
				const how = this.app.player.mode === 'swim' ? 'climb aboard at her side (Space)' : 'E to step across';
				this._say( `${ j.coxswain }: "Alongside! ${ j.tow ? 'We\'ll take your boat in tow' : 'Up you come' }" · ${ how }`, 4200 );
				if ( this.coxswain ) this.coxswain.wave();
				if ( this.features && this.features.emit ) this.features.emit( 'rescueAlongside', { by: j.by } );

			}

			return;

		}

		if ( j.phase === 'ride' ) {

			if ( ! onboard ) {

				// over the side: she comes round for you
				j.phase = 'inbound';
				return;

			}

			j.rideT += dt;
			if ( j.dest === 'boat' && ! this._boatAfloat() ) j.dest = 'dock';
			const b = this.app.boatCtl;
			const tgt = j.dest === 'boat' ? b.position : j.port.dock.position;
			const reach = j.dest === 'boat' ? s.cls.beam / 2 + 6 : RESCUE.deliver;
			const d = this._steer( s, tgt.x, tgt.z, reach * 0.6 );
			if ( s.grounded > 0 || s.speed < 0.4 ) j.stuckT += dt;
			else j.stuckT = 0;
			// no headway for a while (circling the shoals off a shallow dock): the coxswain rows you the last bit
			if ( d < j.best - 2 ) { j.best = d; j.bestT = 0; } else j.bestT += dt;
			const stuck = ( j.stuckT > RESCUE.stuck && ( d < 250 || j.stuckT > RESCUE.stuck * 4 ) ) || ( j.bestT > 20 && d < 300 );
			if ( d < reach || stuck || j.rideT > RESCUE.rideMax ) this._deliver( j );
			return;

		}

		if ( j.phase === 'leave' ) {

			j.t += dt;
			s.wantSpeed = 0.7;
			if ( j.awayFrom ) s.want = Math.atan2( s.x - j.awayFrom.x, s.z - j.awayFrom.z );
			if ( j.t > RESCUE.leave ) this._release( j );

		}

	}

	_boarded( j ) {

		j.phase = 'ride';
		j.rideT = 0;
		j.stuckT = 0;
		j.best = Infinity;
		j.bestT = 0;
		const s = j.ship;
		const np = nearestPort( s.x, s.z );
		if ( np ) j.port = np.port;
		if ( j.tow ) {

			const b = this.app.boatCtl;
			if ( b ) { b.driven = false; b.throttle = 0; }

		}

		const ask = ! j.tow && this._boatAfloat() ? ` · ask ${ j.coxswain } at the stern for your boat` : '';
		this._say( `Aboard the ${ s.name } · bound for ${ j.port ? j.port.name : 'harbour' }${ ask }`, 4200 );

	}

	// at the dock (or your boat): ashore, the fee, then she leaves
	_deliver( j ) {

		const p = this.app.player, s = j.ship;
		const toBoat = j.dest === 'boat' && this._boatAfloat();
		let where = null;
		if ( toBoat ) {

			const b = this.app.boatCtl;
			p.leaveHull( b.position.x, b.position.y, b.position.z, 'walk' );
			if ( p.boat === b && p.boardBoat ) p.boardBoat();

		} else {

			where = this.landingSpot( j.port );
			p.leaveHull( where.x, where.y, where.z, 'walk' );
			p.yaw = where.yaw ?? p.yaw;
			if ( j.tow ) this._moorAt( j.port );

		}

		const dist = Math.hypot( j.origin.x - ( where ? where.x : s.x ), j.origin.z - ( where ? where.z : s.z ) );
		let fee = rescueFee( dist, { tow: j.tow } );
		let note;
		if ( this.free ) {

			fee = 0;
			note = 'No charge in the sandbox';

		} else if ( this.firstFree ) {

			fee = 0;
			this.firstFree = false;
			note = 'No charge this once: "The harbour looks after its own"';

		} else {

			const st = this.state;
			const pay = st ? Math.min( fee, Math.max( 0, st.money | 0 ) ) : 0;
			if ( pay > 0 && st.spend ) st.spend( pay );
			note = pay < fee ? `The launch takes the $${ pay } you have (the fee is $${ fee })` : `The launch charges $${ fee }`;
			fee = pay;
			this.stats.paid += pay;

		}

		this.stats.rescued ++;
		const place = toBoat ? 'your boat' : j.port ? j.port.name : 'the dock';
		this._say( `Set down at ${ place } · ${ note }`, 4200 );
		if ( this.features && this.features.emit ) this.features.emit( 'rescueDelivered', { by: j.by, port: j.port ? j.port.id : null, fee, dest: toBoat ? 'boat' : 'dock', tow: j.tow } );
		j.phase = 'leave';
		j.t = 0;
		j.awayFrom = { x: p.position.x, z: p.position.z };

	}

	// a walkable spot by the port's dock (the jetty deck, the quay, the beach), else the port's stand
	landingSpot( port ) {

		const t = this.app.terrainData, col = this.app.colliders;
		const d = port && port.dock && port.dock.position;
		if ( d ) {

			for ( const r of [ 2, 4, 6, 9, 12, 16, 22, 30 ] ) {

				for ( let i = 0; i < 16; i ++ ) {

					const a = i / 16 * Math.PI * 2, x = d.x + Math.sin( a ) * r, z = d.z + Math.cos( a ) * r;
					const g = Math.max( t && t.heightAt ? t.heightAt( x, z ) : - Infinity, col && col.groundHeightAt ? col.groundHeightAt( x, z, 6 ) : - Infinity );
					if ( g > 0.25 && g < 5 ) return { x, y: g, z, yaw: Math.atan2( x - d.x, z - d.z ) + Math.PI };

				}

			}

		}

		const st = port && port.stand ? port.stand : WORLD.start.position;
		const y = t && t.heightAt ? Math.max( 0.3, t.heightAt( st.x, st.z ) ) : 1;
		return { x: st.x, y, z: st.z, yaw: st.yaw ?? 0 };

	}

	// the towed boat moored at the port (the agent's berth there, else the dock itself)
	_moorAt( port ) {

		const ag = this._f( 'agents' ), st = this.state;
		if ( ag && ag.moor && port ) try { if ( ag.moor( port.id, st && st.boat ) ) return true; } catch ( e ) { /* below */ }
		const b = this.app.boatCtl, d = port && port.dock;
		if ( ! b || ! b.position || ! d ) return false;
		const bw = { x: d.position.x, z: d.position.z, heading: d.heading || 0, moored: true };
		if ( typeof this.app._placeBoat === 'function' ) {

			this.app._placeBoat( bw );
			return true;

		}

		b.position.set( bw.x, b.position.y, bw.z );
		if ( b.quaternion && b.quaternion.setFromAxisAngle ) b.quaternion.setFromAxisAngle( _up, bw.heading );
		if ( b.velocity ) b.velocity.set( 0, 0, 0 );
		if ( b.angular ) b.angular.set( 0, 0, 0 );
		b.throttle = 0;
		b.driven = false;
		b.moored = true;
		if ( b.mooring ) {

			b.mooring.anchor.set( bw.x, 0, bw.z );
			b.mooring.heading = bw.heading;

		}

		return true;

	}

	_abandon( reason ) {

		const j = this.job;
		if ( ! j ) return;
		if ( this._onboard() ) {

			const p = this.app.player;
			p.overboard( 1 );

		}

		if ( this.features && this.features.emit ) this.features.emit( 'rescueAbandoned', { by: j.by, reason } );
		if ( reason === 'waited' && j.ship ) this._toast( `The ${ j.ship.name } gives up waiting and turns away`, 3200 );
		if ( j.ship && j.ship.alive ) {

			j.phase = 'leave';
			j.t = 0;
			const p = this.app.player.position;
			j.awayFrom = { x: p.x, z: p.z };

		} else this._release( j );

	}

	// she goes about her business: ours sail off and are gone, a merchant goes back to her lane
	_release( j ) {

		const s = j.ship;
		if ( s ) {

			s.rescuing = false;
			if ( j.own ) s.state = 'gone';
			else if ( s.alive ) {

				s.setState( j.prev && j.prev.state && j.prev.state !== 'rescue' ? j.prev.state : 'sail' );
				if ( s.cursor ) {

					let best = 0, bd = Infinity;
					s.cursor.points.forEach( ( q, i ) => { const d = Math.hypot( q[ 0 ] - s.x, q[ 1 ] - s.z ); if ( d < bd ) { bd = d; best = i; } } );
					s.cursor.index = best;

				}

			}

		}

		if ( this.job === j ) {

			this.job = null;
			if ( this.coxswain ) this.coxswain.dispose();
			this.coxswain = null;

		}

		this._marker( null );

	}

	_marker( s ) {

		const wm = this._f( 'worldmap' );
		if ( ! wm ) return;
		if ( ! s ) {

			if ( wm.removeMarker ) wm.removeMarker( MARKER );
			return;

		}

		if ( wm.addMarker ) wm.addMarker( { id: MARKER, kind: 'pin', icon: 'flag', x: s.x, z: s.z, label: s.name, mine: true } );

	}

	// ------------------------------------------------------------------ climbing aboard ships (Player.addClimbable)

	shipClimb( x, z, water ) {

		const nv = this.naval;
		const ships = [];
		if ( nv && nv.ships ) for ( const s of nv.ships ) ships.push( s );
		for ( const s of this._ownSim ) ships.push( s );
		const j = this.job;
		for ( const s of ships ) {

			if ( ! s || ! s.alive || ! s.cls ) continue;
			const L = s.cls.length, B = s.cls.beam;
			if ( Math.abs( s.x - x ) > L || Math.abs( s.z - z ) > L ) continue;
			const l = shipLocal( s, x, z );
			if ( Math.abs( l.x ) > B / 2 + 0.3 || Math.abs( l.z ) > L / 2 ) continue;
			const ours = !! ( j && j.ship === s );
			const top = ( s.pose ? s.pose.y : water ) + s.cls.deck;
			// a ship under way can't be climbed (crippled, adrift, moored, at anchor: yes); the answering one waits for you
			if ( ! ours && Math.abs( s.speed ) > 1.2 ) return { kind: 'ship', ladder: true, top, text: `The ${ s.name } is under way` };
			return {
				kind: 'ship', ship: s, top, max: s.cls.deck + 1.2,
				text: ours ? `Climb aboard the ${ s.name }` : `Climb aboard the ${ s.name }`,
				enter: ( pl ) => this._climbed( s, l, pl ),
			};

		}

		return null;

	}

	_climbed( s, l, pl ) {

		const j = this.job;
		const hull = j && j.ship === s ? j.hull : shipHull( s );
		if ( ! pl.boardHull( hull, l.x * 0.8, clamp( l.z, - s.cls.length * 0.35, s.cls.length * 0.35 ) ) ) return false;
		if ( j && j.ship === s ) return true; // (the rescue: _update sees the player aboard)
		if ( this.features && this.features.emit ) this.features.emit( 'climbedAboard', { ship: s, id: s.id, name: s.name, faction: s.faction } );
		// worker 15C's hijack takes it from here when installed; else a struck pirate is boarding's
		const hj = this._f( 'hijack' );
		let took = false;
		try { took = !! hj?.onClimb?.( s, { player: pl, hull } ); } catch ( e ) { took = false; }
		if ( ! took && s.faction === 'pirate' && s.state === 'adrift' ) {

			const bd = this._f( 'boarding' );
			try { took = !! bd?.board?.( s ); } catch ( e ) { took = false; }

		}

		if ( ! took ) this._toast( `Aboard the ${ s.name }`, 2000 );
		return true;

	}

	// ------------------------------------------------------------------ per frame

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		this._hookPlayer();
		this._patchModels();
		if ( this.cooldown > 0 ) this.cooldown -= dt;

		// F held FLARE.hold s fires (not with the free camera, not while a panel has the keys)
		const inp = this.app.input, free = this.app.freeCam;
		// wave 16C: situation() scans (the colliders under a walker, the hull): 4 Hz, every frame while F is held
		const fDown = !! ( inp && inp.down && inp.down( 'KeyF' ) );
		this._scanT = ( this._scanT || 0 ) - dt;
		if ( fDown || this._scanT <= 0 ) {

			this._scanT = 0.25;
			this._sit = this.situation();

		}

		const can = ! free && this.flares > 0 && this.cooldown <= 0 && !! this._sit && ! ( this.features.panelOpen && this.features.panelOpen() );
		if ( can && ! this._hint && this._sit !== 'aboard' ) {

			this._hint = true;
			this._toast( `Hold F to fire a distress flare (${ this.flares } left)`, 2800 );

		}

		if ( inp && inp.down && inp.down( 'KeyF' ) && can && this._hold >= 0 ) {

			this._hold += dt;
			if ( this._hold >= FLARE.hold ) {

				this.fire();
				this._hold = - 1; // (one flare per press)

			}

		} else if ( ! inp || ! inp.down || ! inp.down( 'KeyF' ) ) this._hold = 0;

		// our own sim (no naval here): sail them
		for ( let i = this._ownSim.length - 1; i >= 0; i -- ) {

			const s = this._ownSim[ i ];
			if ( s.state === 'gone' ) {

				if ( s.visual ) s.visual.dispose();
				s.visual = null;
				this._ownSim.splice( i, 1 );
				continue;

			}

			s.integrate( dt, this.app.terrainData || null );
			if ( s.visual ) {

				s.visual.apply( s, s.pose || { y: 0, pitch: 0, roll: 0 } );
				s.visual.setVisible( true );

			}

		}

		if ( this._pending ) {

			const d = this._pending;
			this._pending = null;
			if ( ! this.job && this.app && this.app.player && this.app.player.position ) this._restore( d );

		}

		const j = this.job;
		if ( j ) {

			if ( j.phase === 'waiting' ) {

				j.t += dt;
				if ( j.t >= j.delay ) this._answer( j );

			} else this._update( j, dt );

		}

		// the answering hull: her lamp (the launch's on its mast, else at the bow), her coxswain, a blip on the maps
		const s = this.job && this.job.ship;
		if ( s && s.alive ) {

			const L = s.cls.lamp;
			const w = L ? shipWorld( s, L.x, L.z ) : shipWorld( s, 0, s.cls.length * 0.42 );
			this._lamp.position.set( w.x, ( s.pose ? s.pose.y : 0 ) + ( L ? L.y : s.cls.deck + 1.6 ), w.z );
			this._lamp.enabled = true;
			if ( this.coxswain ) {

				const cam = this.app.camera, pl = this.app.player;
				this.coxswain.update( dt, { ship: s, visual: s.visual && s.visual.kind === 'launch' ? s.visual : null, eye: cam && cam.position ? cam.position : null, player: pl ? pl.position : null } );

			}

			this._markT -= dt;
			if ( this._markT <= 0 ) {

				this._markT = 0.5;
				this._marker( s );

			}

		} else this._lamp.enabled = false;

		this.fx.update( dt, this.app.camera || null, this._wind() );
		this.floaters.update();

	}

	_wind() {

		const w = this._f( 'weather' );
		const v = w && w.wind;
		if ( v && finite( v.x, v.z ) ) return v;
		return null;

	}

	// ------------------------------------------------------------------ save

	toJSON() {

		const out = { v: SAVE_V, flares: this.flares, firstFree: this.firstFree, stats: { ...this.stats } };
		const job = this._jobJSON();
		if ( job ) out.job = job;
		return out;

	}

	// the answer in progress (wave 16A, for a reload mid-rescue): the phase and its timers, who, where to, the vessel she is
	// (our own: her kind and place; a merchant of naval's: only that one was coming)
	_jobJSON() {

		const j = this.job ? this.job : this._pending;
		if ( ! j || j.phase === 'leave' ) return null;
		if ( ! this.job ) return j; // (loaded, not restored yet: as it came)
		const r1 = ( v ) => Math.round( v * 10 ) / 10, s = j.ship;
		const out = {
			phase: j.phase, by: j.by, dest: j.dest, tow: !! j.tow, port: j.port ? j.port.id : null, origin: { x: r1( j.origin.x ), z: r1( j.origin.z ) },
			coxswain: j.coxswain, t: r1( j.t || 0 ), delay: r1( j.delay || 0 ), sighted: !! j.sighted,
			plan: { by: j.plan.by, port: j.plan.port ? j.plan.port.id : null, ocean: !! j.plan.ocean },
		};
		if ( s && s.alive && j.own ) out.ship = { kind: s.kind, x: r1( s.x ), z: r1( s.z ), yaw: Math.round( s.yaw * 1000 ) / 1000, name: s.name };
		return out;

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this.flares = clamp( Math.round( Number( d.flares ) || 0 ), 0, FLARE.max );
		this.firstFree = d.firstFree !== false;
		const s = d.stats || {};
		this.stats = { fired: s.fired | 0, rescued: s.rescued | 0, paid: s.paid | 0 };
		// a job in progress comes back on the next frame (naval and the player are settled by then)
		const j = d.job;
		this._pending = j && typeof j === 'object' && j.origin && finite( Number( j.origin.x ), Number( j.origin.z ) ) && typeof j.phase === 'string' ? j : null;

	}

	// a saved job again: waiting goes on waiting; a vessel of ours is out again where she was (coming for you: a ride or
	// alongside become inbound, you are not aboard after a load); a merchant of naval's (not saved) or a hull that cannot be
	// raised again: the wait starts over with whoever answers now
	_restore( d ) {

		const port = ( id ) => ( WORLD.ports || [] ).find( ( p ) => p.id === id ) || null;
		const num = ( v, def = 0 ) => ( Number.isFinite( Number( v ) ) ? Number( v ) : def );
		const origin = { x: num( d.origin.x ), z: num( d.origin.z ) };
		const P = d.plan && typeof d.plan === 'object' ? d.plan : {};
		let plan = null;
		if ( P.by === 'launch' && port( P.port ) ) plan = { by: 'launch', port: port( P.port ) };
		else if ( P.by === 'pirate' ) plan = { by: 'pirate' };
		else {

			const np = nearestPort( origin.x, origin.z );
			plan = { by: 'merchant', ocean: true, port: np ? np.port : null };

		}

		plan.delay = clamp( num( d.delay, RESCUE.answer[ 0 ] ), 0, RESCUE.ocean[ 1 ] );
		const coxswain = typeof d.coxswain === 'string' && d.coxswain ? d.coxswain.slice( 0, 40 ) : COXSWAINS[ 0 ];
		const j = {
			phase: 'waiting', t: 0, delay: plan.delay, by: plan.by, plan, port: port( d.port ) || plan.port || null, ship: null, hull: null,
			origin, tow: !! d.tow, dest: d.dest === 'boat' ? 'boat' : 'dock', sighted: !! d.sighted, stuckT: 0, rideT: 0, waitT: 0, own: false, prev: null, coxswain,
		};
		this.job = j;
		if ( d.phase === 'waiting' ) {

			j.t = clamp( num( d.t ), 0, j.delay );
			return j;

		}

		const S = d.ship;
		if ( S && SHIP_CLASSES[ S.kind ] && finite( num( S.x, NaN ), num( S.z, NaN ) ) ) {

			try {

				const sh = this._spawn( S.kind, { x: num( S.x ), z: num( S.z ), yaw: num( S.yaw ), speed: 0, name: typeof S.name === 'string' ? S.name.slice( 0, 60 ) : undefined, state: 'rescue' } );
				if ( S.kind === LAUNCH.fallback && plan.by === 'launch' ) sh.cls = { ...sh.cls, ...LAUNCH.tune };
				sh.setState( 'rescue' );
				sh.faction = plan.by === 'launch' ? 'navy' : sh.faction;
				sh.captain = coxswain;
				if ( plan.by === 'launch' ) this._crew( sh );
				sh.rescuing = true;
				j.ship = sh;
				j.own = true;
				j.by = plan.by === 'launch' ? 'launch' : 'merchant';
				j.hull = shipHull( sh, { prompt: ( pl ) => this._hullPrompt( pl ), interact: () => this._hullInteract() } );
				j.phase = 'inbound';
				this._toast( `The ${ sh.name } is still coming for you`, 3000 );
				return j;

			} catch ( e ) { /* the wait again, below */ }

		}

		j.t = 0; // (her hull is gone: the flare is answered again)
		return j;

	}

	reset() {

		this._pending = null;
		this._abandon( 'reset' );
		if ( this.job ) this._release( this.job );
		this.flares = 0;
		this.firstFree = true;
		this.stats = { fired: 0, rescued: 0, paid: 0 };
		this.cooldown = 0;
		this.fx.clear();

	}

	dispose() {

		if ( this.job ) this._release( this.job );
		for ( const s of this._ownSim ) if ( s.visual ) s.visual.dispose();
		for ( const off of this._off ) if ( typeof off === 'function' ) off();
		this._off.length = 0;
		if ( this._climbOff ) this._climbOff();
		this._climbOff = null;
		this.fx.dispose();
		this.floaters.clear();

	}

}

function fmtDist( d ) {

	return d < 1000 ? `${ Math.round( d / 10 ) * 10 } m` : `${ ( d / 1000 ).toFixed( 1 ) } km`;

}

// compass word for a world offset (+z is south, -z north)
function bearingWord( dx, dz ) {

	const a = ( Math.atan2( dx, - dz ) * 180 / Math.PI + 360 ) % 360;
	return [ 'to the north', 'to the north-east', 'to the east', 'to the south-east', 'to the south', 'to the south-west', 'to the west', 'to the north-west' ][ Math.round( a / 45 ) % 8 ];

}
