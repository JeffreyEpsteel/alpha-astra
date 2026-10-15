// The seaplane feature: a floatplane you buy at the hangar on the beach west of the pier, board from its jetty, taxi,
// take off from and land on the water. Flight.js is the rigid-body model (pure), Pilot.js the controls and what a
// touchdown means, Site.js the hangar / slipway / jetty, Model.js the GLB, PlaneAudio.js the engine, Remote.js the
// other players' planes, Panel.js the hangar window.
//
//   const sp = features.get( 'seaplane' );
//   sp.owned, sp.hp (0..100), sp.piloted, sp.flight (Flight), sp.board() / sp.exit(), sp.buy() / sp.repair() / sp.recall()
//   sp.marker() -> { x, z, heading } | null        (maps)
//   sp.decorateState( out ) -> out                 adds out.plane = { p, q, thr } while the local player flies / taxis
//   sp.updateRemote( states )                      the other players' states (array of { id, plane }, or a Map)
//   sp.view() (panel data), sp.open() / close() / isOpen, toJSON() / fromJSON() / reset() / dispose()
//
// Events: planeTookOff { id, x, z }, planeLanded { id, onWater, x, z, sink }, planeCrashed { id, cause, x, z, cost }.
// With the death feature installed a piloted crash also emits playerDied { cause: 'seaplane', text, x, y, z } (death respawns you).
// Keys: ShiftLeft claimed (throttle up), C (throttle down: the dive key, so it follows its binding; wave 5 moved it off
// Ctrl, since Ctrl+W with W pitching closed the tab), Comma / Period claimed (rudder); W A S D and C are read only while piloting
// (the player's walk / boat code is not running then). Player.js mode 'plane' gets the camera and the seated pose
// (enterVehicle / exitVehicle); App needs no per-frame hook (the plane steps inside Player.update while piloted,
// in this feature's update otherwise).
// Wave 8, the cockpit (Systems.js the switches, Cockpit.js the live panel): the engine has to be started (O, the
// START button, or simply opening the throttle: the starter cranks ~2 s first), U master, N nav lights, ; landing
// light, [ / ] flaps, - / = trim (held), Y autopilot, 3 the cockpit's switch panel (touch), M (or the radio) the map.
// A ~25 min tank: refuel at the hangar (free in the sandbox). sp.act( id ) runs a panel control; sp.refuel();
// sp.wantsMouse() while piloting (the left button belongs to the panel, not the rod); sp.lights (nav, landing, cabin).
// Wave 10, crashes you can see (Crash.js the table, Wreck.js the pieces): a strike is judged from the physics - a rough
// landing (hull damage, a float sprung: f.sprung lists it and drags until repaired; a splash and a bang, you stay
// aboard), a wreck (the GLB's parts tear off and fly, splash, float and sink; smoke ~40 s, fire ~20 s on land; you are
// thrown clear a few metres away, blacked out 0.8 s and hurt, alive) or a direct collision (playerDied as before).
// sp.lost: the plane is gone until it is recovered at the hangar (sp.recall(): the recovery fee CRASH.recovery, then the
// repair as before; free in the sandbox); sp.wreck { x, y, z, yaw, t, parts } while the fuselage is still up; a
// worldmap marker 'seaplane-wreck'. Ships (naval hull / rigging boxes), solid colliders and destruction props are struck
// too (Flight STRIKE points; props along the nose's path). planeCrashed gains { severity, speed, water, recovery };
// seaplaneRecovered { cost }. The floating fuselage's cabin roof is a perch (a walkable collider box riding it): a swimmer
// beside it climbs on with E (or swims onto it) instead of treading water; it goes when the wreck starts to sink.
// Wave 12C, airframes and upgrades (Airframes.js): the hangar sells the Jade, the Petrel, the Albatross (a twin flying
// boat: sp.failEngine( i )) and, at the airstrip (Site.js findAirstrip: WORLD[ island ].airstrip; none and it is not
// for sale), the Kestrel on wheels. sp.af is the airframe out on the ramp / the pad; sp.fleet[ id ] the others' records
// (owned, hp, fuel, switches, sprung, lost, upgrades, cargo). sp.buy( id ), sp.takeOut( id ), sp.fit( key, tier? )
// (hangar rows, prices by class, free in the sandbox but fitted explicitly), sp.spec (the composed Flight spec).
// Cargo: sp.cargo [ { good, qty, kg, crates, cond, paid } ]: sp.loadCargo() takes crates from the trade hold at a port
// (or the ramp) up to the pod / bay (sp.capacity()), sp.unloadCargo() puts them back into the hold at any port (E at
// the cargo door: trade.takeCargo / addCargo( ..., { force } )); the load's mass and centre of gravity go into the
// spec. Radio: the world map shows ships / wrecks within 600 m (markers 'seaplane-radio-*'). Searchlight: hold ; (a
// tap still toggles the landing light), aimed where the pilot looks. Bailing out: ' twice (or the switch panel's
// Bail out) above CHUTE.minAgl: the pilot rides the parachute (Chute.js, a vehicle like the plane) down to the water /
// ground; the plane flies on, wings level, the throttle where it was, until it hits something (a wreck: Crash.js) or
// runs dry and glides down (sp.abandoned). The Kestrel brakes on B (read on the ground only, not claimed). Events:
// seaplaneBought { airframe }, seaplaneUpgraded { airframe, upgrade, tier, price }, planeBailedOut { x, y, z },
// chuteLanded { x, z, mode }, planeEngineFailed { engine }.
// Wave 14B, planes you can find: the airframes that are not out stand at their bases (Remote.js ParkedPlane): the Kestrel
// on the airstrip pad whenever another airframe is out (for sale, or yours: E flies it, the one out goes into its
// hangar), a seaplane at the ramp's berth while the Kestrel is out (the one last out there, or the Jade for sale).
// sp.parked (Map 'strip' | 'ramp' -> { af, owned, liv, x, y, z, heading, door, view }), sp.parkedAt( slot ),
// sp.useParked( slot ), sp.parkedVisual( af, liv ) (the same look for netsync's remote 'parked' entries). A toast once a
// session on reaching the airstrip points at its hangar office. Delivery: sp.takeOut( af, { at } ) / sp.recall( { at } )
// with at 'home' | 'strip' | { x, z, heading, water: true } (sp.spot( at )): a seaplane put in a bay floats moored there
// (never more than MOOR_RADIUS off) until boarded. sp.bailHint() is the chase strip's / the placard's bail-out line.

import { Vector3, Quaternion } from '../../engine/index.js';
import { Flight, GEOM } from './Flight.js';
import { AIRFRAMES, AIRFRAME_IDS, UPGRADES, LIVERIES, RADIO_RANGE, spec as composeSpec, upgradePrice, upgradeFits, capacity, defaultUpgrades, cleanUpgrades, cargoMass } from './Airframes.js';
import { Chute, CHUTE } from './Chute.js';
import { findAirstrip, stripPad, stripOffice, onStrip, StripSite } from './Site.js';
import { GOODS } from '../trade/goods.js';
import { WORLD } from '../../world/WorldLayout.js';
import { CRASH, throwPoint, wreckParts } from './Crash.js';
import { Wreck } from './Wreck.js';
import { Stun } from './Stun.js';
import { Pilot, judge, MAX_HP } from './Pilot.js';
import { SITE, SeaplaneSite, jettyPoint, distToBerth } from './Site.js';
import { PlaneModels } from './Model.js';
import { PlaneAudio } from './PlaneAudio.js';
import { RemotePlanes, ParkedPlane } from './Remote.js';
import { SeaplanePanel } from './Panel.js';
import { Systems, refuelCost, FUEL } from './Systems.js';
import { Cockpit } from './Cockpit.js';
import { t } from '../../i18n/index.js';
import { isOnlineSession } from '../../game/GameMode.js';
import { AIRPORT_FLEET, findAirport, airportRank, airportStand, AirportSite, lockAirportRank } from './Airport.js';

export const PRICE = 18000;
export const REPAIR_PER_HP = 15; // $ per point of condition: a full rebuild after a crash is $1,500
export const ID = 'seaplane';
const SIM_RANGE = 700; // m from the camera: an unattended plane further away is not simulated
// claimed for the plane (KeyC is the core dive key: read, not claimed). Nothing here ever combines Ctrl with a key.
// (wave 12: Quote, ', bails out; J, proposed, is the journal's)
export const KEYS = [ 'ShiftLeft', 'Comma', 'Period', 'KeyO', 'KeyU', 'KeyN', 'Semicolon', 'KeyY', 'BracketLeft', 'BracketRight', 'Minus', 'Equal', 'Digit3', 'Quote' ];
export const THROTTLE_DOWN = 'KeyC';
export const BRAKE = 'KeyB'; // the Kestrel's wheel brakes: read on the ground only (B is the boarding key: not claimed)
// the cockpit's keys -> Seaplane.act ids (pressed, not held; the trim keys are held: _keysNow; ; is held for the searchlight)
export const COCKPIT_KEYS = { KeyO: 'engine', KeyU: 'master', KeyN: 'nav', Semicolon: 'landing', KeyY: 'ap', BracketLeft: 'flapsUp', BracketRight: 'flapsDown', Digit3: 'panel', Quote: 'bail' };
export const SEARCH_HOLD = 0.3; // s: holding ; this long sweeps the searchlight instead of toggling the landing light
const RADIO_ID = 'seaplane-radio-';
export const MOOR_RADIUS = 15; // m: a plane put in a bay swings on its line, never further from the spot
export const STRIP_TIP_RANGE = 60; // m from the pad: "arrived at the airstrip" (the hangar office toast)
const FAR = { x: 1e9, y: - 1e9, z: 1e9 };

const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _nose = new Vector3(), _q = new Quaternion();
const WRECK_ID = 'seaplane-wreck';
const ROOF_Y = 3.1, ROOF_Z = 0.85; // the cabin roof over the seats (model frame): the wreck's perch
const PERCH_REACH = 4.2; // m from the fuselage's centre a swimmer can climb on from
const money$ = ( n ) => '$' + Math.round( n ).toLocaleString( 'en-US' );
// a point inside a naval yawBox ( { c, a: [ axes ], h: [ half extents ] } )
const inBox = ( b, x, y, z ) => {

	if ( ! b || ! b.c ) return false;
	const dx = x - b.c.x, dy = y - b.c.y, dz = z - b.c.z;
	for ( let i = 0; i < 3; i ++ ) if ( Math.abs( dx * b.a[ i ].x + dy * b.a[ i ].y + dz * b.a[ i ].z ) > b.h[ i ] ) return false;
	return true;

};

export class Seaplane {

	constructor( app, features, opts = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.opts = opts;
		this.owned = false;
		this.hp = MAX_HP;
		this.piloted = false;
		// wave 12: the airframe out (af), the hangar's records of every airframe, the current one's upgrades and load
		this.af = 'jade';
		this.fleet = {};
		this.upgrades = defaultUpgrades();
		this.cargo = [];
		this.abandoned = false; // bailed out of: flying on by itself
		this.chute = null;
		this._bailArm = - 10;
		this._radio = new Set();
		this._radioT = 0;
		this._semi = 0;
		this.flight = new Flight();
		this.pilot = new Pilot();
		this.flight.engineOn = false;
		this.flight.place( SITE.berth.x, SITE.berth.z, SITE.berth.heading );
		this.stats = { flights: 0, landings: 0, crashes: 0, maxAlt: 0 };
		this.log = []; // the last few judged events (tests, debugging)
		this._driven = false;
		this._wasAir = false;
		this._ver = - 1;
		this._tipShown = false;
		this._sinceExit = Infinity;
		this._swimHint = false;
		this._offs = [];
		this.lost = false; // wrecked: gone until recovered at the hangar
		this._wreck = null; // the pieces (Wreck.js) while any of them is still about
		this._wfx = null; // the wreck's effects clock
		this._wq = [ false, false, false, false ]; // water probe slots pointed at wreck pieces
		this._prevNose = null;
		this._perchBox = null;
		this._perchHint = false;
		// wave 14B: the airframes standing at their bases, which one stood there last, a bay mooring, the strip's toast
		this.parked = new Map();
		this.last = { ramp: 'jade', strip: 'kestrel' };
		this._moor = null;
		this._stripTip = false;
		this._stripT = 0;
		this.stun = new Stun( this.app );

		const terrain = this.app.terrainData || null;
		this.terrain = terrain;
		// the ground: the terrain, and the airstrip's paved surface (the Kestrel rolls on it)
		this.flight.groundAt = ( x, z ) => this._groundAt( x, z, this.flight.position.y + 0.15 );

		// four float probes from the shared GPU water queries
		this.query = this.app.query || null;
		this.slot = - 1;
		if ( this.query && this.query.allocate ) {

			try { this.slot = this.query.allocate( ID, 4 ); } catch ( e ) { console.warn( 'seaplane: no water query slots left (sea level 0)', e ); }

		}

		this.flight.hasWater = false;

		const scene = this.app.scene || null;
		this.site = opts.site === false ? null : new SeaplaneSite( { scene, terrain, colliders: this.app.colliders || null, mesh: !! scene } );
		const strip = this.strip;
		this.stripSite = strip && opts.site !== false ? new StripSite( { strip, scene, terrain, colliders: this.app.colliders || null, mesh: !! scene } ) : null;
		this.airportSite = this.airport && scene && opts.site !== false ? new AirportSite( this.airport, scene ) : null;
		this.models = opts.models && typeof opts.models.create === 'function' ? opts.models : opts.models === false || ! scene ? null : new PlaneModels( { scene } );
		this.visual = this.models ? this.models.create() : null;
		this.remote = new RemotePlanes( { models: this.models } );
		this.audio = new PlaneAudio( this.app );
		this.panel = new SeaplanePanel( this );
		this.systems = new Systems( this.flight, this.pilot );
		this.lights = this.systems.lights; // the registry hands them to the scene's local lights
		this._extraLit = false;
		this.cockpit = new Cockpit( this );
		this._respec();
		this._startTip = false;
		this.autoCrank = opts.autoCrank !== false; // the throttle cranks a stopped engine (touch lever, pad trigger)

		// the Player's view of the plane while piloting (Player.enterVehicle)
		const f = this.flight;
		this.vehicle = {
			kind: 'plane',
			quaternion: f.quaternion,
			seat: GEOM.seat, // (every airframe shares the Jade's cabin: Airframes.js)
			eye: GEOM.eye,
			focus: [ 0, 2.4, - 0.6 ],
			chase: 17,
			toWorld: ( l, out ) => f.toWorldXYZ( l.x ?? l[ 0 ], l.y ?? l[ 1 ], l.z ?? l[ 2 ], out ),
			drive: ( dt ) => this.drive( dt ),
			exit: () => this.exit(),
			prompt: () => ( this.canExit() ? t( 'seaplane.climbOut', 'Climb out' ) : null ),
			speed: () => f.airspeed,
			heading: () => f.heading(),
			seaLevel: () => f.seaLevel(),
		};

		this.keys = {};
		if ( this.features && this.features.claimKey ) for ( const k of KEYS ) this.keys[ k ] = this.features.claimKey( k, ID );
		// wave 14B: X bails out too, when it is free (naval claims it for the starboard guns first: then ' alone)
		this.keys.KeyX = !! ( this.features && this.features.claimKey && this.features.claimKey( 'KeyX', ID ) );

		this._interact = [];
		if ( this.features && this.features.interactable ) {

			// the cabin door, from the jetty (or swimming beside it)
			this._interact.push( this.features.interactable( {
				id: 'seaplane-door',
				position: () => f.toWorldXYZ( f.geom.door[ 0 ], f.geom.door[ 1 ], f.geom.door[ 2 ], _v2 ),
				radius: 3.2,
				when: () => ! this.piloted && ! this._aboard() && ! this.lost && ! this.chute && this._sinceExit > 0.6, // (not the E that climbed out)
				prompt: () => ( ! this.owned ? t( 'seaplane.forSale', 'Seaplane for sale · ask at the hangar' ) : this.hp <= 0 ? t( 'seaplane.broken', 'Seaplane · needs repair at the hangar' ) : ( this.airframe && this.airframe.land ? t( 'seaplane.boardPlane', 'Fly the plane' ) : t( 'seaplane.board', 'Fly the seaplane' ) ) ),
				onInteract: () => this.board(),
			} ) );
			this._interact.push( this.features.interactable( {
				id: 'seaplane-hangar',
				position: () => ( { x: SITE.office.x, y: this.site ? this.site.floorY : undefined, z: SITE.office.z } ),
				radius: 3.0,
				when: () => ! this.piloted,
				prompt: () => t( 'seaplane.hangar', 'Seaplane hangar' ),
				onInteract: () => this.open( 'ramp' ),
			} ) );
			// wave 12: the airstrip's hangar office (the same window, scoped to the strip: the Kestrel)
			this._interact.push( this.features.interactable( {
				id: 'seaplane-strip-hangar',
				position: () => {

					const o = stripOffice( this.strip );
					return o ? { x: o.x, y: o.y, z: o.z } : { x: 1e9, y: - 1e9, z: 1e9 };

				},
				radius: 4.0, // (easy to find: wave 14B)
				when: () => ! this.piloted && !! this.strip,
				prompt: () => t( 'seaplane.stripHangar', 'Airstrip hangar' ),
				onInteract: () => this.open( 'strip' ),
			} ) );
			// the cargo door (starboard): load crates from the trade hold at a port, unload them at any port
			this._interact.push( this.features.interactable( {
				id: 'seaplane-cargo',
				position: () => f.toWorldXYZ( - Math.abs( f.geom.door[ 0 ] ), f.geom.door[ 1 ], f.geom.door[ 2 ] - 1.2, _v3 ),
				radius: 2.8,
				when: () => ! this.piloted && ! this.lost && this.owned && ! this.chute && this.capacity() > 0 && f.airspeed < 2 && !! this.cargoPort(),
				prompt: () => this.cargoPrompt(),
				onInteract: () => {

					const r = this.cargo.length ? this.unloadCargo() : this.loadCargo();
					if ( r && r.text ) this._toast( r.text, 2600 );

				},
			} ) );
			// wave 14B: the parked airframes (for sale: their hangar's window; yours: fly it)
			for ( const slot of [ 'strip', 'ramp', ...AIRPORT_FLEET.map( ( af ) => 'airport-' + af ) ] ) this._interact.push( this.features.interactable( {
				id: 'seaplane-parked-' + slot,
				position: () => ( this.parked.has( slot ) ? this.parked.get( slot ).door : FAR ),
				radius: 4.0,
				when: () => ! this.piloted && ! this.chute && ! this._aboard() && this._sinceExit > 0.6 && this.parked.has( slot ),
				prompt: () => this.parkedPrompt( slot ),
				onInteract: () => this.useParked( slot ),
			} ) );

		}

		// A marked service point stays at the stand when its aircraft is away or wrecked.
		if ( this.features?.interactable ) for ( const af of AIRPORT_FLEET ) this._interact.push( this.features.interactable( {
			id: 'airport-service-' + af,
			position: () => this.available( af ) ? { ...this.base( af ), x: this.base( af ).x + 5.5 } : FAR,
			radius: 3.2,
			when: () => this.available( af ) && ! this.piloted && ! this.chute && ! this._aboard() && this._sinceExit > 0.6,
			prompt: () => `Take / service ${ AIRFRAMES[ af ].name } · free personal airport aircraft`,
			onInteract: () => { const r = this.useAirportAircraft( af ); if ( r.text ) this._toast( r.text, 5200 ); },
		} ) );
		this._place();

	}

	// ------------------------------------------------------------------ wave 12: airframes, upgrades, cargo

	// the airstrip (the Kestrel's base), read from the world each time (an island worker may add it later)
	get strip() {

		return findAirstrip( this.opts.world || WORLD );

	}

	get airframe() {

		return AIRFRAMES[ this.af ] || AIRFRAMES.jade;

	}

	get airport() { return findAirport( this.opts.world || WORLD ); }

	// the airframe's base: the ramp's berth or the airstrip's pad
	base( af = this.af ) {

		const A = AIRFRAMES[ af ] || AIRFRAMES.jade;
		if ( A.base === 'airport' ) {
			const p = airportStand( this.airport, af, airportRank( this.app, this.airport ) );
			if ( p ) return p;
		}
		if ( A.base === 'strip' ) {

			const p = stripPad( this.strip );
			if ( p ) return { kind: 'strip', x: p.x, z: p.z, heading: p.heading, y: p.y };

		}

		return { kind: 'ramp', x: SITE.berth.x, z: SITE.berth.z, heading: SITE.berth.heading, y: - 0.2 };

	}

	// can this airframe be had here at all (the Kestrel needs an airstrip)
	available( af ) {

		const A = AIRFRAMES[ af ];
		return !! A && ( A.base === 'airport' ? !! this.airport && airportRank( this.app, this.airport ) >= 0 : A.base !== 'strip' || !! this.strip );

	}

	// ------------------------------------------------------------------ wave 14B: parked airframes, delivery

	// what stands at a base ('strip' | 'ramp') while none of its own airframes is out: the one of yours last out there
	// (not wrecked), else the first for sale; null when one of its own is out, none is had here, or yours are wrecked
	parkedAt( slot ) {

		if ( slot.startsWith( 'airport-' ) ) {
			const af = slot.slice( 8 );
			return AIRPORT_FLEET.includes( af ) && this.available( af ) && af !== this.af ? { af, owned: this.owns( af ), courtesy: true } : null;
		}
		const ids = AIRFRAME_IDS.filter( ( id ) => AIRFRAMES[ id ].base === slot && this.available( id ) );
		if ( ! ids.length || ids.includes( this.af ) ) return null;
		const mine = ids.filter( ( id ) => this.owns( id ) && ! ( this.fleet[ id ] && this.fleet[ id ].lost ) );
		if ( mine.length ) return { af: mine.includes( this.last[ slot ] ) ? this.last[ slot ] : mine[ 0 ], owned: true };
		if ( ids.some( ( id ) => this.owns( id ) ) ) return null; // (wrecked: recovered at the hangar first)
		return { af: ids[ 0 ], owned: false };

	}

	// the parked look of an airframe (also netsync's remote 'parked' entries)
	parkedVisual( af = 'jade', liv = 0 ) {

		return new ParkedPlane( this.models, AIRFRAMES[ af ] ? af : 'jade', liv );

	}

	// the parked airframes follow the fleet: placed, swapped, repainted or removed when it changes
	_syncParked() {

		if ( this.airportSite ) this.airportSite.setRank( airportRank( this.app, this.airport ) );
		for ( const slot of [ 'strip', 'ramp', ...AIRPORT_FLEET.map( ( af ) => 'airport-' + af ) ] ) {

			const want = this.parkedAt( slot );
			let w = this.parked.get( slot );
			if ( ! want ) {

				if ( w && w.view ) w.view.dispose();
				this.parked.delete( slot );
				continue;

			}

			const rec = this.fleet[ want.af ];
			const liv = want.owned && rec && rec.upgrades ? ( rec.upgrades.livery | 0 ) : ( AIRFRAMES[ want.af ].livery || 0 );
			const b = this.base( want.af ), g = b.kind === 'strip' ? this._groundAt( b.x, b.z ) : NaN;
			const y = Number.isFinite( g ) ? g : b.y;
			const sig = `${ want.af }|${ want.owned }|${ liv }|${ b.x }|${ y }|${ b.z }|${ b.heading }`;
			if ( w && w.sig === sig && ( w.view || ! this.models ) ) continue;
			if ( ! w ) {

				w = { slot, view: null };
				this.parked.set( slot, w );

			}

			if ( w.view ) w.view.set( want.af, liv );
			else if ( this.models ) w.view = this.parkedVisual( want.af, liv );
			if ( w.view ) w.view.place( b.x, y, b.z, b.heading );
			// the E spot: beside the door (port side), on the apron / the jetty where a player stands
			const dr = composeSpec( want.af ).geom.door || GEOM.door, c = Math.cos( b.heading ), sn = Math.sin( b.heading );
			const door = { x: b.x + dr[ 0 ] * c + dr[ 2 ] * sn, y: b.kind === 'strip' ? y : SITE.jetty.y, z: b.z - dr[ 0 ] * sn + dr[ 2 ] * c };
			Object.assign( w, { af: want.af, owned: want.owned, courtesy: !! want.courtesy, liv, x: b.x, y, z: b.z, heading: b.heading, door, sig } );

		}

	}

	parkedPrompt( slot ) {

		const w = this.parked.get( slot );
		if ( ! w ) return null;
		const name = AIRFRAMES[ w.af ].name;
		if ( w.courtesy ) {
			const r = this.fleet[ w.af ];
			return r?.lost || r?.hp <= 0 ? `Recover ${ name } · courtesy airport service` : `Fly ${ name } · your courtesy aircraft`;
		}
		if ( w.owned ) return t( 'seaplane.parkedFly', 'Fly the {name}', { name } );
		return slot === 'strip' ? t( 'seaplane.parkedSaleStrip', '{name} for sale · ask at the airstrip hangar', { name } ) : t( 'seaplane.parkedSaleRamp', '{name} for sale · ask at the hangar', { name } );

	}

	// E at a parked airframe: not yours -> its hangar's window; yours -> out it goes (the one out into its hangar), aboard
	useParked( slot ) {

		const w = this.parked.get( slot );
		if ( ! w || this.piloted || this.chute || this._aboard() ) return { ok: false, text: '' };
		if ( w.courtesy ) return this.useAirportAircraft( w.af );
		if ( ! w.owned ) {

			this.open( slot === 'strip' ? 'strip' : 'ramp' );
			return { ok: true, text: '', opened: this.panel.scope };

		}

		const r = this.takeOut( w.af );
		if ( ! r.ok ) {

			if ( r.text ) this._toast( r.text, 2200 );
			return r;

		}

		return { ...r, boarded: this.board() };

	}

	// Exact personal stand positions for map discovery; no guessed airport pin.
	airportMarkers() {
		return AIRPORT_FLEET.filter( ( af ) => this.available( af ) ).map( ( af ) => ( {
			id: 'airport-' + af, name: AIRFRAMES[ af ].name + ' · airport courtesy aircraft',
			...airportStand( this.airport, af, airportRank( this.app, this.airport ) ), available: true, claimed: this.owns( af ),
		} ) );
	}

	// Issues only this captain's aircraft. Remote network models have no E interaction.
	// Retrieving/services the same fleet record; cargo and fitted upgrades survive.
	useAirportAircraft( af ) {
		if ( ! AIRPORT_FLEET.includes( af ) || ! this.available( af ) || this.piloted || this.chute || this._aboard() ) return { ok: false, text: '' };
		if ( airportRank( this.app, this.airport, true ) < 0 ) return { ok: false, text: 'Airport apron is occupied; wait for a clear stand' };
		const p = this.app.player?.position, stand = this.base( af );
		if ( ! p || Math.hypot( p.x - stand.x, p.z - stand.z ) > 12 ) return { ok: false, text: 'Go to the aircraft stand at Meridian Airport' };
		lockAirportRank( this.app );
		if ( af === this.af ) this._stash();
		const r = this.fleet[ af ] || { upgrades: { ...defaultUpgrades(), livery: AIRFRAMES[ af ].livery }, cargo: [] };
		Object.assign( r, { owned: true, hp: MAX_HP, fuel: 1, lost: false, sprung: [ 0, 0 ], engineFail: [] } );
		this.fleet[ af ] = r;
		if ( af === this.af ) { this._clearWreck(); this._unstash( af ); this._place(); }
		else { const result = this.takeOut( af ); if ( ! result.ok ) return result; }
		this._save();
		const result = { ok: true, boarded: this.board(), text: `${ AIRFRAMES[ af ].name }: O starts · Shift / C throttle · follow the yellow line to the runway, turn toward its longer end · S lifts the nose · V cockpit` };
		this._toast( result.text, 5200 );
		return result;
	}

	// where a delivered plane goes (takeOut / recall at): 'home', 'strip' or nothing -> its own base (the ramp's berth
	// for a seaplane, the pad for the Kestrel: a floatplane is not left on the pad, a land plane does not float);
	// { x, z, heading, water: true } -> a bay where a seaplane floats moored (a land plane: its base); { x, z } without
	// water -> a stand on the ground for a land plane (a seaplane floats there)
	spot( at = null, af = this.af ) {

		const A = AIRFRAMES[ af ] || AIRFRAMES.jade, b = this.base( af );
		if ( ! at || typeof at !== 'object' || ! Number.isFinite( at.x ) || ! Number.isFinite( at.z ) ) return b;
		const heading = Number.isFinite( at.heading ) ? at.heading : 0;
		if ( ! A.land ) return { kind: 'bay', x: at.x, z: at.z, heading, y: - 0.2 };
		if ( at.water === true ) return b;
		return { kind: 'ground', x: at.x, z: at.z, heading, y: Number.isFinite( at.y ) ? at.y : 0 };

	}

	_whereText( kind ) {

		return kind === 'strip' ? t( 'seaplane.whereStrip', 'on the airstrip pad' ) : kind === 'bay' ? t( 'seaplane.whereBay', 'moored in the bay' ) : kind === 'ground' ? t( 'seaplane.whereGround', 'standing here' ) : t( 'seaplane.onRamp', 'out at the ramp' );

	}

	// the chase strip's / the cockpit placard's line while bailing out is possible (null otherwise)
	bailHint() {

		if ( ! this.canBail() ) return null;
		return this.keys.KeyX ? t( 'seaplane.bailHintX', "' or X: bail out (press twice)" ) : t( 'seaplane.bailHint', "' bail out (press twice)" );

	}

	// once a session, on reaching the airstrip (on it, or near the pad): where the Kestrel is sold
	_stripTipUpdate( dt ) {

		if ( this._stripTip ) return;
		this._stripT -= dt;
		if ( this._stripT > 0 ) return;
		this._stripT = 0.5;
		const s = this.strip, p = this.app.player;
		if ( ! s || ! p || ! p.position || this.piloted || this.chute ) return;
		const pad = stripPad( s ), x = p.position.x, z = p.position.z;
		if ( ! onStrip( s, x, z ) && ! ( pad && Math.hypot( pad.x - x, pad.z - z ) < STRIP_TIP_RANGE ) ) return;
		this._stripTip = true;
		this._toast( t( 'seaplane.stripTip', 'The airstrip hangar sells the Kestrel · E at the office by the shed' ), 4200 );

	}

	// a plane moored in a bay: the line holds it within MOOR_RADIUS of the spot
	_tether() {

		const m = this._moor, f = this.flight;
		if ( ! m || f.airborne ) return;
		const dx = f.position.x - m.x, dz = f.position.z - m.z, d = Math.hypot( dx, dz );
		if ( d <= MOOR_RADIUS ) return;
		const nx = dx / d, nz = dz / d, out = f.velocity.x * nx + f.velocity.z * nz;
		f.position.x = m.x + nx * MOOR_RADIUS;
		f.position.z = m.z + nz * MOOR_RADIUS;
		if ( out > 0 ) {

			f.velocity.x -= nx * out;
			f.velocity.z -= nz * out;

		}

	}

	_groundAt( x, z, maxY = this.flight.position.y + 0.4 ) {

		const t = this.terrain;
		let g = t && t.heightAt ? t.heightAt( x, z ) : - Infinity;
		for ( const s of [ this.strip, this.airport ] ) if ( s && Number.isFinite( s.y ) && onStrip( s, x, z, 1 ) ) g = Math.max( g, s.y );
		if ( this.airport && AIRPORT_FLEET.some( ( af ) => { const b = this.base( af ); return Math.abs( b.x - x ) < 9 && Math.abs( b.z - z ) < 12; } ) ) g = Math.max( g, this.airport.y );
		// Meridian's walkable roofs exist only while their buildings remain standing.
		// Query below the airframe's current keel height so flying below a roof never
		// creates a spring all the way up to the top of a skyscraper.
		const m = this.opts.meridian || this.app.meridian;
		const roof = m?.landingSurfaceAt?.( x, z, maxY, 0 );
		if ( roof && Number.isFinite( roof.y ) ) g = Math.max( g, roof.y );
		return g;

	}

	// the composed spec (airframe + fitted upgrades + the load) into the flight model, the lights and the model
	_respec() {

		const s = composeSpec( this.af, this.upgrades, this.cargo );
		this.spec = s;
		this.flight.setSpec( s );
		if ( this.systems ) {

			this.systems.configure( s );
			// the upgrades' lamps join the scene's local lights the first time one is fitted
			if ( ! this._extraLit && ( s.lights.pair || s.lights.search ) && this.app.localLights && this.app.localLights.add ) {

				for ( const l of this.systems.extraLights ) this.app.localLights.add( l );
				this._extraLit = true;

			}

		}

		if ( this.models && this.visual && this.visual.af !== this.af ) {

			// another airframe out: its model (the cockpit face moves over: every airframe has the same panel)
			const face = this.cockpit && this.cockpit.mesh;
			this.visual.dispose();
			this.visual = this.models.create( this.af, s.livery );
			if ( face ) this.visual.body.add( face );

		}

		if ( this.visual && this.visual.setLivery && this.visual.livery !== s.livery ) this.visual.setLivery( s.livery );
		if ( this.visual ) this.visual.stopped = this.flight.engineFail.slice();
		return s;

	}

	capacity() {

		return capacity( this.af, this.upgrades );

	}

	// the live state of the airframe out -> its record
	_stash() {

		const sp = this.flight.sprung;
		this.fleet[ this.af ] = {
			owned: this.owned, hp: this.hp, fuel: this.flight.fuel, switches: this.systems ? this.systems.toJSON() : null, sprung: [ sp[ 0 ], sp[ 1 ] ], lost: this.lost,
			upgrades: { ...this.upgrades }, cargo: this.cargo.map( ( c ) => ( { ...c } ) ), engineFail: this.flight.engineFail.slice(),
		};
		return this.fleet[ this.af ];

	}

	// a record -> the live state (the airframe goes out)
	_unstash( af ) {

		const r = this.fleet[ af ] || { owned: false };
		this.af = af;
		if ( AIRFRAMES[ af ].base !== 'airport' ) this.last[ AIRFRAMES[ af ].base ] = af;
		this.owned = r.owned === true;
		if ( this.owned && AIRFRAMES[ af ].base === 'airport' ) lockAirportRank( this.app );
		this.hp = Number.isFinite( r.hp ) ? Math.max( 0, Math.min( MAX_HP, r.hp ) ) : MAX_HP;
		this.flight.fuel = Number.isFinite( r.fuel ) ? Math.max( 0, Math.min( 1, r.fuel ) ) : 1;
		if ( r.switches && this.systems ) this.systems.fromJSON( r.switches );
		const sp = Array.isArray( r.sprung ) ? r.sprung : [];
		for ( let i = 0; i < 2; i ++ ) this.flight.sprung[ i ] = Number.isFinite( sp[ i ] ) ? Math.max( 0, Math.min( 1, sp[ i ] ) ) : 0;
		this.lost = r.lost === true && this.owned;
		this.upgrades = cleanUpgrades( r.upgrades );
		this.cargo = Array.isArray( r.cargo ) ? r.cargo.filter( ( c ) => c && GOODS[ c.good ] && c.qty > 0 ).map( ( c ) => ( { ...c } ) ) : [];
		this._respec();
		const ef = Array.isArray( r.engineFail ) ? r.engineFail : [];
		this.flight.engineFail.forEach( ( _, i ) => ( this.flight.engineFail[ i ] = ef[ i ] === true ) );
		if ( this.visual ) this.visual.stopped = this.flight.engineFail.slice();

	}

	owns( af ) {

		if ( af === this.af ) return this.owned;
		return !! ( this.fleet[ af ] && this.fleet[ af ].owned );

	}

	// the airframe in the hangar goes out onto the ramp / the pad (the one out goes in: towed home if it was away);
	// wave 14B: { at } delivers it there instead (spot(): 'home' | 'strip' | { x, z, heading, water: true }); the one
	// already out with an `at` is towed there
	takeOut( af, { at = null } = {} ) {

		if ( ! AIRFRAMES[ af ] ) return { ok: false, text: '' };
		if ( this.piloted || this.chute ) return { ok: false, text: t( 'seaplane.flyingNow', 'Not while you are flying' ) };
		if ( ! this.owns( af ) ) return { ok: false, text: t( 'seaplane.notOwned', 'Not yours yet' ) };
		if ( af === this.af ) {

			if ( ! at ) return { ok: true, text: t( 'seaplane.alreadyOut', 'Already out' ) };
			if ( this.lost ) return { ok: false, text: t( 'seaplane.recoverFirst', 'Recover the wreck first' ) };
			this._place( at );
			return { ok: true, text: `${ AIRFRAMES[ af ].name }: ${ this._whereText( this.spot( at ).kind ) }` };

		}

		if ( ! this.available( af ) ) return { ok: false, text: t( 'seaplane.noStrip', 'There is no airstrip for it' ) };
		this._stash();
		this._clearWreck();
		this.abandoned = false;
		this._unstash( af );
		this._place( at );
		if ( this.lost && this.visual ) this.visual.setVisible( false );
		this._save();
		const kind = this.spot( at ).kind;
		return { ok: true, text: `${ AIRFRAMES[ af ].name }: ${ kind === 'strip' && ! at ? t( 'seaplane.onPad', 'out on the pad' ) : this._whereText( kind ) }` };

	}

	// fit the next tier of an upgrade (a livery: scheme n) in the hangar; prices by airframe class, free in the sandbox
	fit( key, tier = null ) {

		const U = UPGRADES.find( ( u ) => u.id === key );
		if ( ! U || ! upgradeFits( this.af, key ) ) return { ok: false, text: t( 'seaplane.noFit', 'That does not fit this airframe' ) };
		if ( ! this.owned || this.lost ) return { ok: false, text: t( 'seaplane.notOwned', 'Not yours yet' ) };
		if ( this.piloted || ! this.home ) return { ok: false, text: t( 'seaplane.fitAtHangar', 'Upgrades are fitted at the hangar' ) };
		const cur = this.upgrades[ key ] || 0;
		const want = U.paint ? ( Number.isFinite( tier ) ? tier : ( cur + 1 ) % ( U.tiers + 1 ) ) : cur + 1;
		if ( want === cur ) return { ok: false, text: t( 'seaplane.fitted', 'Already fitted' ) };
		if ( want < 0 || want > U.tiers ) return { ok: false, text: t( 'seaplane.maxed', 'Fully upgraded' ) };
		const price = this.free ? 0 : upgradePrice( this.af, key, want );
		const st = this.features && this.features.state;
		if ( price > 0 && ( ! st || ! st.spend || ! st.spend( price ) ) ) return { ok: false, text: t( 'seaplane.short', 'Not enough money yet' ) + ` (${ money$( price ) })` };
		this.upgrades[ key ] = want;
		this._respec();
		this._save();
		this._emit( 'seaplaneUpgraded', { airframe: this.af, upgrade: key, tier: want, price } );
		const name = t( 'seaplane.up.' + key, U.name );
		return { ok: true, text: U.paint ? `${ t( 'seaplane.repainted', 'Repainted' ) }: ${ LIVERIES[ want ].name }` : `${ name } ${ U.tiers > 1 ? want + ' ' : '' }${ t( 'seaplane.fittedNow', 'fitted' ) }` + ( price ? ` (${ money$( price ) })` : '' ) };

	}

	// a twin's engine stops (damage): the other one yaws the plane (Flight's asymmetric thrust)
	failEngine( i ) {

		const ef = this.flight.engineFail;
		if ( ef.length < 2 || i < 0 || i >= ef.length || ef[ i ] ) return false;
		ef[ i ] = true;
		if ( this.visual ) this.visual.stopped = ef.slice();
		this._emit( 'planeEngineFailed', { engine: i } );
		if ( this.piloted ) this._toast( i === 0 ? t( 'seaplane.portEngine', 'The port engine failed' ) : t( 'seaplane.starboardEngine', 'The starboard engine failed' ), 3200 );
		return true;

	}

	// the port whose dock / stand the plane is at (the home ramp counts as home's), or null
	cargoPort() {

		const f = this.flight, x = f.position.x, z = f.position.z;
		if ( ! this.owned || this.lost || f.airborne || f.airspeed >= 2 ) return null;
		const ports = ( this.opts.world || WORLD ).ports || [];
		if ( this.home ) {
			const port = this.airframe.base === 'airport' ? this.airport?.island : this.airframe.base === 'strip' ? this.strip?.island : 'home';
			return port === 'home' || ports.some( ( p ) => p.id === port ) ? port : null;
		}
		for ( const p of ports ) {

			const q = [ p.dock && p.dock.position, p.stand, p.center ];
			for ( let k = 0; k < 2; k ++ ) if ( q[ k ] && Math.hypot( q[ k ].x - x, q[ k ].z - z ) < 90 ) return p.id;

		}

		return null;

	}

	cargoCrates() {

		return cargoMass( this.cargo ).crates;

	}

	cargoPrompt() {

		const n = this.cargoCrates(), cap = this.capacity();
		if ( n > 0 ) return `${ t( 'seaplane.unload', 'Unload the cargo' ) } (${ n } / ${ cap })`;
		const tr = this._trade();
		return tr && tr.crates && tr.crates() > 0 ? `${ t( 'seaplane.load', 'Load cargo from the hold' ) } (${ cap } ${ t( 'seaplane.crates', 'crates' ) })` : null;

	}

	_trade() {

		return this.features && this.features.get ? this.features.get( 'trade' ) : null;

	}

	// crates out of the trade hold into the pod / bay (as many whole units as fit, the most valuable first)
	loadCargo() {

		const tr = this._trade();
		if ( ! tr || ! tr.cargo || ! tr.takeCargo ) return { ok: false, text: t( 'seaplane.noTrade', 'Nothing to load' ) };
		if ( ! this.cargoPort() ) return { ok: false, text: t( 'seaplane.cargoAtPort', 'Load and unload cargo at a port' ) };
		let room = this.capacity() - this.cargoCrates();
		if ( room <= 0 ) return { ok: false, text: t( 'seaplane.cargoFull', 'The cargo space is full' ) };
		const held = tr.cargo;
		const goods = Object.keys( held ).filter( ( g ) => GOODS[ g ] && held[ g ].qty > 0 ).sort( ( a, b ) => GOODS[ b ].base / GOODS[ b ].crates - GOODS[ a ].base / GOODS[ a ].crates );
		let moved = 0;
		for ( const g of goods ) {

			const G = GOODS[ g ], n = Math.min( held[ g ].qty, Math.floor( room / G.crates ) );
			if ( n < 1 ) continue;
			const got = tr.takeCargo( g, n );
			if ( ! got || ! got.qty ) continue;
			const cond = held[ g ].cond ?? 1;
			const item = this.cargo.find( ( c ) => c.good === g );
			if ( item ) {

				item.qty += got.qty;
				item.paid = ( item.paid || 0 ) + ( got.paid || 0 );

			} else this.cargo.push( { good: g, qty: got.qty, kg: G.kg, crates: G.crates, cond, paid: got.paid || 0 } );
			room -= got.qty * G.crates;
			moved += got.qty * G.crates;

		}

		if ( ! moved ) return { ok: false, text: t( 'seaplane.noTrade', 'Nothing to load' ) };
		this._respec();
		this._save();
		return { ok: true, crates: moved, text: `${ t( 'seaplane.loaded', 'Loaded' ) } ${ moved } ${ t( 'seaplane.crates', 'crates' ) } (${ Math.round( cargoMass( this.cargo ).kg ) } kg)` };

	}

	// the crates back into the trade hold at a port (sell them there as usual)
	unloadCargo() {

		const tr = this._trade(), port = this.cargoPort();
		if ( ! port ) return { ok: false, text: t( 'seaplane.cargoAtPort', 'Load and unload cargo at a port' ) };
		if ( ! this.cargo.length ) return { ok: false, text: t( 'seaplane.noCargo', 'No cargo aboard' ) };
		if ( ! tr || ! tr.addCargo ) return { ok: false, text: t( 'seaplane.noTrade', 'Nothing to load' ) };
		let n = 0;
		for ( const c of this.cargo ) n += tr.addCargo( c.good, c.qty, { cond: c.cond ?? 1, paid: c.paid || 0, port: port === 'home' ? 'home' : port, force: true } ) * ( c.crates || 1 );
		this.cargo = [];
		this._respec();
		this._save();
		return { ok: true, crates: n, text: `${ t( 'seaplane.unloaded', 'Unloaded' ) } ${ n } ${ t( 'seaplane.crates', 'crates' ) } ${ t( 'seaplane.intoHold', 'into the hold' ) }` };

	}

	// ------------------------------------------------------------------ state

	get free() {

		const st = this.features && this.features.state;
		return !! ( ( st && st.free ) || ( this.features && this.features.sandbox ) );

	}

	get home() {

		const b = this.base();
		if ( b.kind === 'strip' ) return Math.hypot( this.flight.position.x - b.x, this.flight.position.z - b.z ) < SITE.homeRadius;
		return distToBerth( this.flight.position.x, this.flight.position.z ) < SITE.homeRadius;

	}

	// what raising and towing the wreck costs (the repair comes on top)
	recoveryCost() {

		return this.free ? 0 : CRASH.recovery;

	}

	// the wreck while its fuselage is still up (it sinks after CRASH.afloat s at sea; on land it stays), else null
	get wreck() {

		const w = this._wreck;
		return w && ! w.sunk ? w : null;

	}

	repairCost() {

		return this.free ? 0 : Math.round( ( MAX_HP - this.hp ) * REPAIR_PER_HP );

	}

	view( scope = this.panel ? this.panel.scope : 'ramp' ) {

		const st = this.features && this.features.state;
		const money = st ? st.money : 0;
		const litres = this.spec.litres || FUEL.litres;
		const fuel = this.flight.fuel, fuelCost = refuelCost( fuel, this.free, litres ), s = this.systems, f = this.flight;
		const price = this.airframe.price;
		// wave 12: the hangar's airframes for this scope (the ramp: the seaplanes; the strip: the Kestrel)
		const airframes = AIRFRAME_IDS.filter( ( id ) => AIRFRAMES[ id ].base === scope && this.available( id ) ).map( ( id ) => {

			const A = AIRFRAMES[ id ], owned = this.owns( id ), rec = id === this.af ? null : this.fleet[ id ];
			const price = this.airframePrice( id );
			return { id, name: A.name, sub: A.sub, price, owned, current: id === this.af, lost: id === this.af ? this.lost : !! ( rec && rec.lost ), seats: A.seats, crates: A.crates, canBuy: ! owned && ( this.free || money >= price ), canTake: owned && id !== this.af && ! this.piloted };

		} );
		// wave 13: the airstrip hangar lists the engine row once "Wings" is done (the story opens 'engine:strip')
		const story = this._story();
		const engineAtStrip = ! ( scope === 'strip' && story && story.opens && story.opens( 'engine:strip' ) === false );
		const upgrades = UPGRADES.filter( ( U ) => upgradeFits( this.af, U.id ) && ( U.id !== 'engine' || engineAtStrip ) ).map( ( U ) => {

			const tier = this.upgrades[ U.id ] || 0, next = U.paint ? ( tier + 1 ) % ( U.tiers + 1 ) : tier + 1;
			const cost = next > U.tiers || ( U.paint && next === 0 ) ? 0 : this.free ? 0 : upgradePrice( this.af, U.id, next );
			const label = U.id === 'floats' && this.spec.landplane ? 'Undercarriage' : U.id === 'floats' && this.spec.hull ? 'Hull' : U.name;
			return { id: U.id, name: label, note: U.note, tier, tiers: U.tiers, next, paint: !! U.paint, scheme: U.paint ? LIVERIES[ tier ].name : null, nextScheme: U.paint ? LIVERIES[ next ].name : null, cost, maxed: ! U.paint && tier >= U.tiers, canFit: this.owned && ! this.lost && this.home && ! this.piloted && ( U.paint || tier < U.tiers ) && ( this.free || money >= cost ) };

		} );
		return {
			scope, af: this.af, name: this.airframe.name, airframes, upgrades, inScope: this.airframe.base === scope,
			cargo: { crates: this.cargoCrates(), capacity: this.capacity(), kg: Math.round( cargoMass( this.cargo ).kg ), items: this.cargo.map( ( c ) => ( { good: c.good, name: GOODS[ c.good ] ? GOODS[ c.good ].name : c.good, qty: c.qty } ) ) },
			engineOut: f.engineFail.some( Boolean ),
			owned: this.owned, free: this.free, price, money, hp: this.hp, home: this.home, piloted: this.piloted,
			canBuy: ! this.owned && ( this.free || money >= price ), repairCost: this.repairCost(),
			canRepair: this.owned && ! this.lost && this.hp < MAX_HP && ( this.free || money >= this.repairCost() ),
			lost: this.lost, wreck: !! this.wreck, recoveryCost: this.recoveryCost(), canRecover: this.lost && ( this.free || money >= this.recoveryCost() ),
			sprung: this.flight.sprung[ 0 ] > 0 || this.flight.sprung[ 1 ] > 0,
			fuel, litres: fuel * litres, tank: litres, refuelCost: fuelCost,
			canRefuel: this.owned && this.home && fuel < 0.995 && ! f.airborne && ( this.free || money >= fuelCost ),
			cockpit: { master: s.master, engine: f.engineOn, cranking: s.cranking, nav: s.nav, landing: s.landing, ap: s.apOn, flaps: f.flaps, notches: f.notches, trim: this.pilot.trim, canExit: this.canExit(), search: s.search, hasSearch: s.fit.search, canBail: this.canBail(), radio: !! this.spec.radio },
		};

	}

	isOpen() {

		return this.panel.isOpen;

	}

	open( scope = null ) {

		if ( scope ) this.panel.scope = scope;
		else if ( ! this.piloted ) this.panel.scope = this.airframe.base;
		return this.panel.open();

	}

	close() {

		this.panel.close();

	}

	_toast( text, ms = 2600 ) {

		const g = this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	_emit( name, data ) {

		if ( this.features && this.features.emit ) this.features.emit( name, { id: ID, ...data } );

	}

	// buy an airframe (the one out when none is named: the Jade in a new game); a new one goes out at once
	// wave 13: what an airframe costs here (the story's "Wings" reward takes 20 % off the Kestrel)
	airframePrice( af ) {

		const A = AIRFRAMES[ af ];
		if ( ! A ) return 0;
		const story = this._story();
		const off = af === 'kestrel' && story && story.discount ? story.discount( 'kestrel' ) || 0 : 0;
		return Math.round( A.price * ( 1 - off ) );

	}

	_story() {

		try { return this.features && this.features.get ? this.features.get( 'story' ) : null; } catch ( e ) { return null; }

	}

	buy( af = null ) {

		af = af || this.af;
		if ( AIRPORT_FLEET.includes( af ) ) return this.useAirportAircraft( af );
		const A = AIRFRAMES[ af ];
		if ( ! A ) return { ok: false, text: '' };
		if ( this.owns( af ) ) return { ok: false, text: t( 'seaplane.owned', 'The seaplane is already yours' ) };
		if ( ! this.available( af ) ) return { ok: false, text: t( 'seaplane.noStrip', 'There is no airstrip for it' ) };
		if ( af !== this.af && ( this.piloted || this.chute ) ) return { ok: false, text: t( 'seaplane.flyingNow', 'Not while you are flying' ) };
		const st = this.features && this.features.state;
		const price = this.airframePrice( af );
		if ( ! this.free ) {

			if ( ! st || ! st.spend || ! st.spend( price ) ) return { ok: false, text: t( 'seaplane.short', 'Not enough money yet' ) };

		}

		if ( af !== this.af ) {

			this._stash();
			this._clearWreck();
			this.abandoned = false;
			this.fleet[ af ] = { owned: true, hp: MAX_HP, fuel: 1, upgrades: defaultUpgrades(), cargo: [] };
			this._unstash( af );
			this._place();

		}

		this.owned = true;
		this.hp = MAX_HP;
		this._save();
		this._emit( 'seaplaneBought', { price: this.free ? 0 : price, airframe: af } );
		if ( af === 'jade' ) return { ok: true, text: t( 'seaplane.bought', 'The seaplane is yours. Board it at the door from the jetty.' ) };
		return { ok: true, text: `${ t( 'seaplane.boughtA', 'The' ) } ${ A.name } ${ t( 'seaplane.boughtB', 'is yours' ) }: ${ A.base === 'strip' ? t( 'seaplane.onPad', 'out on the pad' ) : t( 'seaplane.onRamp', 'out at the ramp' ) }` };

	}

	repair() {

		if ( this.lost ) return { ok: false, text: t( 'seaplane.recoverFirst', 'Recover the wreck first' ) };
		if ( ! this.owned || this.hp >= MAX_HP ) return { ok: false, text: t( 'seaplane.noRepair', 'Nothing to repair' ) };
		const cost = this.repairCost();
		const st = this.features && this.features.state;
		if ( cost > 0 && ( ! st || ! st.spend || ! st.spend( cost ) ) ) return { ok: false, text: t( 'seaplane.short', 'Not enough money yet' ) };
		this.hp = MAX_HP;
		this.flight.sprung[ 0 ] = this.flight.sprung[ 1 ] = 0;
		this.flight.engineFail.fill( false );
		if ( this.visual ) this.visual.stopped = null;
		this._save();
		return { ok: true, text: t( 'seaplane.repaired', 'Repaired: good as new' ) };

	}

	// fill the tank at the ramp ($1 a litre in a campaign, free in the sandbox)
	refuel() {

		const f = this.flight;
		if ( ! this.owned ) return { ok: false, text: '' };
		if ( ! this.home || f.airborne ) return { ok: false, text: t( 'seaplane.refuelAway', 'Refuel at the ramp' ) };
		if ( f.fuel >= 0.995 ) return { ok: false, text: t( 'seaplane.full', 'The tank is full' ) };
		const cost = refuelCost( f.fuel, this.free, this.spec.litres || FUEL.litres );
		const st = this.features && this.features.state;
		if ( cost > 0 && ( ! st || ! st.spend || ! st.spend( cost ) ) ) return { ok: false, text: t( 'seaplane.short', 'Not enough money yet' ) };
		f.fuel = 1;
		this._save();
		return { ok: true, text: t( 'seaplane.refuelled', 'Tank full' ) + ( cost ? ` ($${ cost })` : '' ) };

	}

	// tow it home (left out at sea, or drifted off); a wreck is raised and towed by Captain Roid's crew for the recovery
	// fee and comes back to the ramp in pieces (the repair as before)
	// wave 14B: { at } ('home' | 'strip' | { x, z, heading, water: true }: spot()) delivers it there instead of its base
	recall( { at = null } = {} ) {

		if ( this.piloted ) return { ok: false, text: '' };
		const kind = this.spot( at ).kind;
		if ( this.lost ) {

			const cost = this.recoveryCost();
			const st = this.features && this.features.state;
			if ( cost > 0 && ( ! st || ! st.spend || ! st.spend( cost ) ) ) return { ok: false, text: t( 'seaplane.short', 'Not enough money yet' ) + ` (${ money$( cost ) })` };
			this._clearWreck();
			this.lost = false;
			this._place( at );
			this._save();
			this._emit( 'seaplaneRecovered', { cost, at: kind } );
			const rep = this.repairCost();
			const said = kind === 'ramp' ? t( 'seaplane.recovered', "Captain Roid's crew raised the wreck and towed it to the ramp" ) : t( 'seaplane.recoveredTo', "Captain Roid's crew raised the wreck: {where}", { where: this._whereText( kind ) } );
			return { ok: true, text: said + ( rep > 0 ? ` · ${ t( 'seaplane.repairNext', 'repair' ) } ${ money$( rep ) }` : '' ) };

		}

		this._place( at );
		return { ok: true, text: kind === 'ramp' ? t( 'seaplane.towed', 'Towed back to the ramp' ) : t( 'seaplane.towedTo', 'Towed: {where}', { where: this._whereText( kind ) } ) };

	}

	_save() {

		const st = this.features && this.features.state;
		if ( isOnlineSession( this.app ) && ! st?.storage?.universe ) return false;
		if ( st && st.save ) try { return st.save(); } catch ( e ) { /* the next autosave keeps it */ }

	}

	_place( at = null ) {

		const f = this.flight, b = this.spot( at );
		this.parkBrake = false;
		if ( b.kind === 'strip' || b.kind === 'ground' ) {

			// on the pad (or a stand), nose down the runway, the wheels on the ground (brakes set)
			const g = this._groundAt( b.x, b.z );
			f.place( b.x, b.z, b.heading, Number.isFinite( g ) ? g : b.y );
			f.controls.brake = 1;

		} else f.place( b.x, b.z, b.heading );
		this._moor = b.kind === 'bay' ? { x: b.x, z: b.z, heading: b.heading } : null;
		this.abandoned = false;
		f.engineOn = false;
		f.flaps = f.flapPos = 0;
		f.clearStrikes();
		this.pilot.reset();
		if ( this.systems ) this.systems.reset();
		this._wasAir = false;
		this._syncVisual( 0 );
		this._syncParked();

	}

	// ------------------------------------------------------------------ boarding

	board() {

		const p = this.app.player;
		if ( this.piloted || ( p && p.mode === 'plane' ) ) return false;
		if ( ! this.owned || this.hp <= 0 || this.lost ) {

			this.open();
			return false;

		}

		if ( ! p || ! p.enterVehicle || this._aboard() || this.chute ) return false;
		const f = this.flight;
		this.piloted = true;
		this.abandoned = false;
		this._moor = null; // (aboard: the mooring line is cast off)
		// the engine is cold: it starts on the starter (O, the panel's START, or opening the throttle)
		f.clearStrikes();
		this.pilot.reset();
		this.systems.ack();
		p.enterVehicle( this.vehicle );
		if ( ! this._tipShown ) {

			this._tipShown = true;
			this._toast( t( 'seaplane.tip', 'O or Shift starts the engine · Shift / C throttle · S pulls up near 28 m/s · V cockpit view' ), 4600 );

		}

		return true;

	}

	// aboard a boat (or riding another player's): the plane waits
	_aboard() {

		const p = this.app.player;
		return !! p && [ 'boat', 'deck', 'seat', 'ride', 'plane' ].includes( p.mode );

	}

	// a swimmer beside the door climbs in with E (the game offers feature interactions only on foot / on deck)
	_swimmerBoard() {

		const p = this.app.player, inp = this.app.input;
		if ( ! p || p.mode !== 'swim' || ! this.owned || this.hp <= 0 || this.lost || this._sinceExit < 0.6 ) return;
		const dr = this.flight.geom.door;
		const d = this.flight.toWorldXYZ( dr[ 0 ], dr[ 1 ], dr[ 2 ], _v2 );
		if ( Math.hypot( d.x - p.position.x, d.z - p.position.z ) > 3.2 ) {

			this._swimHint = false;
			return;

		}

		if ( ! this._swimHint ) {

			this._swimHint = true;
			this._toast( t( 'seaplane.swimBoard', 'E: climb into the seaplane' ), 1800 );

		}

		if ( inp && inp.hit && inp.hit( 'KeyE' ) ) this.board();

	}

	canExit() {

		const f = this.flight;
		return this.piloted && ! f.airborne && f.airspeed < 3 && ( f.onWater || f.grounded );

	}

	// E while piloting: out onto the jetty at the ramp, into the water elsewhere, onto the sand when beached
	exit() {

		if ( ! this.piloted ) return false;
		if ( ! this.canExit() ) {

			this._toast( t( 'seaplane.slowDown', 'Slow down on the water to climb out' ), 1800 );
			return false;

		}

		this._leave();
		return true;

	}

	_leave() {

		const p = this.app.player, f = this.flight;
		this.piloted = false;
		this._sinceExit = 0; // (the same E press must not climb straight back in)
		this.systems.stop();
		f.controls.throttle = 0;
		if ( this.isOpen() ) this.close();
		this.pilot.reset();
		if ( ! p || ! p.exitVehicle ) return;
		const dr = f.geom.door;
		const door = f.toWorldXYZ( dr[ 0 ] + 0.6, dr[ 1 ], dr[ 2 ], _v );
		const yaw = f.heading() + Math.PI;
		const jp = jettyPoint( door.x, door.z );
		const sea = f.seaLevel();
		const ground = this._groundAt( door.x, door.z );
		if ( Math.hypot( jp.x - door.x, jp.z - door.z ) < 4 ) p.exitVehicle( jp.x, jp.y, jp.z, yaw - Math.PI / 2, 'walk' );
		else if ( ground > sea - 1.1 ) p.exitVehicle( door.x, Math.max( ground, sea - 1.1 ), door.z, yaw, 'walk' );
		else p.exitVehicle( door.x, sea - 0.2, door.z, yaw, 'swim', sea );

	}

	// ------------------------------------------------------------------ per frame

	// the pilot's keys / pad (Player.updatePlane calls this before it places the camera)
	_keysNow() {

		const inp = this.app.input;
		if ( ! inp || ! inp.down || ( this.features && this.features.panelOpen && this.features.panelOpen() ) ) return {};
		const d = ( c ) => !! inp.down( c );
		return {
			up: d( 'KeyW' ), down: d( 'KeyS' ), left: d( 'KeyA' ), right: d( 'KeyD' ),
			throttleUp: d( 'ShiftLeft' ) || d( 'ShiftRight' ), throttleDown: d( THROTTLE_DOWN ),
			yawLeft: d( 'Comma' ), yawRight: d( 'Period' ),
			trimUp: d( 'Equal' ) || d( 'NumpadAdd' ), trimDown: d( 'Minus' ) || d( 'NumpadSubtract' ),
			brake: d( BRAKE ), semicolon: d( 'Semicolon' ),
		};

	}

	_padNow() {

		if ( typeof navigator === 'undefined' || ! navigator.getGamepads ) return null;
		let p = null;
		try { for ( const g of navigator.getGamepads() ) if ( g && g.connected ) { p = g; break; } } catch ( e ) { return null; }
		if ( ! p ) return null;
		const dz = ( v ) => ( Math.abs( v || 0 ) < 0.18 ? 0 : ( v - Math.sign( v ) * 0.18 ) / 0.82 );
		const bv = ( i ) => ( p.buttons[ i ] ? p.buttons[ i ].value || ( p.buttons[ i ].pressed ? 1 : 0 ) : 0 );
		// left stick: roll and pitch (pulled back = nose up), triggers: throttle, d-pad left / right: rudder
		return { roll: dz( p.axes[ 0 ] ), pitch: dz( p.axes[ 1 ] ), throttle: bv( 7 ) - bv( 6 ), yaw: bv( 15 ) - bv( 14 ) };

	}

	drive( dt ) {

		this._driven = true;
		const panelOpen = () => this.isOpen() || !! this.features?.panelOpen?.();
		const wasModal = panelOpen();
		this._cockpitKeys();
		// 3 may open or close the tray in this frame. In either transition the
		// modal owns the frame; a held pad trigger/stick must not leak through.
		const modal = wasModal || panelOpen();
		const keys = modal ? {} : this._keysNow(), pad = modal ? null : this._padNow();
		// opening the throttle with the engine off cranks it (the touch lever and a pad trigger have no START key)
		const f = this.flight;
		if ( ! modal && ! f.engineOn && ! this.systems.cranking && f.fuel > 0 && ( keys.throttleUp || ( pad && pad.throttle > 0.3 ) ) && this.autoCrank ) this.act( 'engine', 'throttle' );
		this.pilot.read( keys, pad, f, dt );
		// the wheel brakes (a land plane on the ground: B held, or the throttle closed and nearly stopped)
		f.controls.brake = f.geom.wheels && f.grounded && ( keys.brake || this.parkBrake || ( this.pilot.throttle < 0.02 && f.airspeed < 0.6 ) ) ? 1 : 0;
		this._searchKey( keys, dt );
		const drop = this.pilot.ap.dropped;
		if ( drop ) {

			this.pilot.ap.dropped = null;
			this.audio.click( 'switch' );
			this._toast( drop === 'water' ? t( 'seaplane.apWater', 'Autopilot off: on the water' ) : t( 'seaplane.apOff', 'Autopilot off: you have the stick' ), 1800 );

		}

		this._step( dt );

	}

	// the cockpit's keys (pressed this frame) while piloting
	_cockpitKeys() {

		const inp = this.app.input;
		if ( ! inp || ! inp.hit ) return;
		const open = !! ( this.features && this.features.panelOpen && this.features.panelOpen() );
		for ( const code in COCKPIT_KEYS ) {

			// with a panel open only 3 (closing the switch panel) is ours
			if ( open && code !== 'Digit3' ) continue;
			// with the searchlight fitted ; acts on release (a tap: the landing light; held: the searchlight)
			if ( code === 'Semicolon' && this.systems.fit.search ) continue;
			if ( inp.hit( code ) ) this.act( COCKPIT_KEYS[ code ], 'key' );

		}

		if ( this.keys.KeyX && ! open && inp.hit( 'KeyX' ) ) this.act( 'bail', 'keyX' );

	}

	// ; with the searchlight: held past SEARCH_HOLD it sweeps where the pilot looks; a tap toggles the landing light
	_searchKey( keys, dt ) {

		const s = this.systems;
		if ( ! s.fit.search ) {

			this._semi = 0;
			return;

		}

		if ( keys.semicolon ) {

			this._semi += dt;
			if ( this._semi >= SEARCH_HOLD && ! s.search ) {

				s.search = true;
				s.syncLights();

			}

		} else if ( this._semi > 0 ) {

			if ( this._semi < SEARCH_HOLD ) this.act( 'landing', 'key' );
			else if ( ! this._searchLatched ) {

				s.search = false;
				s.syncLights();

			}

			this._semi = 0;

		}

		if ( s.search ) this._aimSearch();

	}

	// the searchlight follows the camera's line of sight (into the model frame)
	_aimSearch() {

		const cam = this.app.camera;
		if ( ! cam || ! cam.quaternion ) return;
		const d = _v.set( 0, 0, - 1 ).applyQuaternion( cam.quaternion ).applyQuaternion( _q.copy( this.flight.quaternion ).invert() );
		this.systems.aim( d.x, d.y, d.z );

	}

	canBail() {

		const f = this.flight;
		return this.piloted && f.airborne && f.agl > CHUTE.minAgl;

	}

	// out of the plane on the parachute (Chute.js); the plane flies on by itself (sp.abandoned)
	bail() {

		const f = this.flight, p = this.app.player;
		if ( ! this.piloted || ! f.airborne ) return { ok: false, why: 'ground' };
		if ( f.agl <= CHUTE.minAgl ) return { ok: false, why: 'low' };
		if ( ! p || ! p.enterVehicle ) return { ok: false, why: 'player' };
		const dr = f.geom.door;
		const door = f.toWorldXYZ( dr[ 0 ] + 0.8, Math.max( dr[ 1 ], 1.2 ), dr[ 2 ], new Vector3() );
		// out of the port door: the plane's way and a shove clear of the wing strut
		const side = _v.set( 1, 0, 0 ).applyQuaternion( f.quaternion );
		const vel = f.velocity.clone().multiplyScalar( 0.85 ).addScaledVector( side, 3 );
		const sea = f.seaLevel();
		const agl = f.agl;
		this.piloted = false;
		this.abandoned = true;
		this.pilot.disengageAutopilot();
		if ( this.isOpen() ) this.close();
		this.systems.search = false;
		this.systems.syncLights();
		const cam = this.app.camera;
		this.chute = new Chute( {
			position: door, velocity: vel, heading: f.heading(), agl, scene: this.app.scene || null,
			seaAt: () => sea, groundAt: ( x, z ) => this._groundAt( x, z ),
			look: () => this._chuteLook(),
		} );
		this.chute.onDrive = ( ev ) => this._chuteEvents( ev );
		p.enterVehicle( this.chute.vehicle );
		this._emit( 'planeBailedOut', { x: door.x, y: door.y, z: door.z, airframe: this.af } );
		this._toast( t( 'seaplane.bailed', 'Bailed out! Look where you want to drift.' ), 2600 );
		this.audio.click( 'clunk' );
		return { ok: true };

	}

	// where the parachute drifts: W / A / S / D relative to its heading (the touch drag sends them too), else where the
	// camera looks
	_chuteLook() {

		const inp = this.app.input, c = this.chute, cam = this.app.camera;
		if ( inp && inp.down && c ) {

			const f = ( inp.down( 'KeyW' ) ? 1 : 0 ) - ( inp.down( 'KeyS' ) ? 1 : 0 ), l = ( inp.down( 'KeyA' ) ? 1 : 0 ) - ( inp.down( 'KeyD' ) ? 1 : 0 );
			if ( f || l ) {

				const h = c.yaw, sn = Math.sin( h ), cs = Math.cos( h );
				return _v2.set( sn * f + cs * l, 0, cs * f - sn * l );

			}

		}

		return cam && cam.quaternion ? _v2.set( 0, 0, - 1 ).applyQuaternion( cam.quaternion ) : null;

	}

	_chuteEvents( ev ) {

		const c = this.chute, p = this.app.player;
		if ( ! c ) return;
		for ( const e of ev ) {

			if ( e.type === 'open' ) this.audio.click( 'clunk' );
			if ( e.type !== 'landed' ) continue;
			if ( p && p.exitVehicle && p.vehicle === c.vehicle ) p.exitVehicle( e.x, e.y, e.z, c.yaw + Math.PI, e.mode, e.mode === 'swim' ? e.sea : null );
			this._sinceExit = 0;
			c.dispose();
			this.chute = null;
			this._emit( 'chuteLanded', { x: e.x, z: e.z, mode: e.mode } );

		}

	}

	// the abandoned plane: the assist keeps the wings level, the throttle stays where it was; it ends in a wreck, or
	// adrift once it has glided down and stopped
	_flyAbandoned( dt ) {

		const f = this.flight;
		this.pilot.read( {}, null, f, dt );
		this._step( dt );
		if ( ! this.lost && ! f.airborne && f.airspeed < 1.5 ) {

			this.abandoned = false;
			this.systems.stop();

		}

	}

	// a panel control (the cockpit's click, its key, the touch switch panel): what it does, a click and a word
	act( id, how = 'click' ) {

		const f = this.flight, s = this.systems, pilot = this.pilot;
		if ( ! this.piloted ) return false;
		let ok = true, text = null, sound = 'switch';
		switch ( id ) {

			case 'engine': {

				if ( f.engineOn || s.cranking ) {

					s.stop();
					text = t( 'seaplane.engineOff', 'Engine off' );
					break;

				}

				const r = s.start();
				ok = r.ok;
				sound = 'clunk';
				if ( r.why === 'master' ) text = t( 'seaplane.needMaster', 'The master switch is off (U)' );
				else if ( r.why === 'fuel' ) text = t( 'seaplane.noFuel', 'The tank is empty: refuel at the ramp, or tow it home from the hangar' );
				else if ( r.ok && how === 'throttle' && ! this._startTip ) {

					this._startTip = true;
					text = t( 'seaplane.cranking', 'Starting the engine...' );

				}

				break;

			}

			case 'master': case 'nav': case 'landing': {

				const on = s.toggle( id );
				if ( id === 'master' ) text = on ? t( 'seaplane.masterOn', 'Master on' ) : t( 'seaplane.masterOff', 'Master off: panel and lights dark' );
				else if ( ! s.master ) text = t( 'seaplane.needMaster', 'The master switch is off (U)' );
				break;

			}

			case 'flapsUp': case 'flapsDown': {

				const was = f.flaps;
				f.flaps = Math.max( 0, Math.min( f.notches, Math.round( f.flaps ) + ( id === 'flapsDown' ? 1 : - 1 ) ) );
				ok = f.flaps !== was;
				sound = 'clunk';
				if ( ok ) text = [ t( 'seaplane.flaps0', 'Flaps up' ), t( 'seaplane.flaps1', 'Flaps 1: takeoff' ), t( 'seaplane.flaps2', 'Flaps 2: landing' ), t( 'seaplane.flaps3', 'Flaps 3: STOL' ) ][ f.flaps ];
				break;

			}

			case 'search':
				ok = s.fit.search && s.master;
				if ( ok ) {

					// (the switch panel / touch: latched on, aimed by the look)
					s.search = ! s.search;
					this._searchLatched = s.search;
					s.syncLights();
					text = s.search ? t( 'seaplane.searchOn', 'Searchlight on: it follows your look' ) : t( 'seaplane.searchOff', 'Searchlight off' );

				} else text = s.fit.search ? t( 'seaplane.needMaster', 'The master switch is off (U)' ) : t( 'seaplane.noSearch', 'No searchlight fitted (the hangar sells one)' );
				break;

			case 'bail': {

				// twice within 2 s (an accidental press only warns)
				const now = this.systems.time;
				if ( ! this.canBail() ) {

					ok = false;
					text = this.flight.airborne ? t( 'seaplane.bailLow', 'Too low to bail out' ) : t( 'seaplane.bailGround', 'Bail out in the air (climb out on the water)' );

				} else if ( now - this._bailArm > 2 ) {

					this._bailArm = now;
					text = how === 'key' ? t( 'seaplane.bailArm', "Press ' again to bail out" ) : how === 'keyX' ? t( 'seaplane.bailArmX', 'Press X again to bail out' ) : t( 'seaplane.bailArmPanel', 'Bail out? Press again' );

				} else {

					this._bailArm = - 10;
					this.bail();
					return true;

				}

				break;

			}

			case 'trimUp': case 'trimDown':
				pilot.trim = Math.max( - 1, Math.min( 1, pilot.trim + ( id === 'trimUp' ? 0.1 : - 0.1 ) ) );
				break;

			case 'ap':
				if ( s.apOn ) {

					pilot.disengageAutopilot();
					text = t( 'seaplane.apOffShort', 'Autopilot off' );

				} else if ( ! s.master ) {

					ok = false;
					text = t( 'seaplane.needMaster', 'The master switch is off (U)' );

				} else if ( pilot.engageAutopilot( f ) ) text = t( 'seaplane.apOn', 'Autopilot on: wings level, holding' ) + ` ${ Math.round( Math.max( 0, f.position.y - f.seaLevel() ) ) } m`;
				else {

					ok = false;
					text = t( 'seaplane.apGround', 'The autopilot works in the air' );

				}

				break;

			// wave 14A: the Albatross's feather / restart switches and the Kestrel's parking brake (cockpit switches)
			case 'feather1': case 'feather2': {

				const i = id === 'feather1' ? 0 : 1, ef = f.engineFail;
				this._feathered = this._feathered || [];
				if ( ! ef || ef.length < 2 ) { ok = false; break; }
				if ( ! ef[ i ] ) { ef[ i ] = true; this._feathered[ i ] = true; text = t( 'seaplane.feathered', 'Engine feathered' ); }
				else if ( this._feathered[ i ] && s.master && f.fuel > 0 ) { ef[ i ] = false; this._feathered[ i ] = false; sound = 'clunk'; text = t( 'seaplane.restarted', 'Engine restarted' ); }
				else { ok = false; text = t( 'seaplane.noRestart', 'It will not restart: the hangar can fix it' ); }
				if ( this.visual ) this.visual.stopped = ef.slice();
				break;

			}
			case 'brake':
				ok = !! f.geom.wheels;
				if ( ok ) { this.parkBrake = ! this.parkBrake; text = this.parkBrake ? t( 'seaplane.parkOn', 'Parking brake set' ) : t( 'seaplane.parkOff', 'Parking brake off' ); }
				break;
			case 'warn':
				s.ack();
				break;

			case 'map': {

				const wm = this.features && this.features.get ? this.features.get( 'worldmap' ) : null;
				ok = !! ( wm && wm.toggle );
				if ( ok ) {

					if ( this.isOpen() ) this.close();
					wm.toggle();

				}

				break;

			}

			case 'panel':
				if ( this.isOpen() ) this.close();
				else this.open();
				break;

			case 'exit':
				if ( this.isOpen() ) this.close();
				ok = this.exit();
				break;

			default:
				return false;

		}

		this.audio.click( ok ? sound : 'switch' );
		if ( text ) this._toast( text, 1600 );
		if ( this.isOpen() && id !== 'panel' ) this.panel.render();
		return ok;

	}

	_readWater() {

		const q = this.query, f = this.flight;
		if ( ! q || this.slot < 0 || ! q.cpuValid ) {

			f.hasWater = false;
			return;

		}

		if ( q.version === this._ver ) return;
		this._ver = q.version;
		for ( let i = 0; i < 4; i ++ ) {

			const h = q.cpu[ ( this.slot + i ) * 4 ];
			if ( Number.isFinite( h ) ) f.setWater( i, h, 0 );

		}

		f.hasWater = true;
		f.resetWaterAge();

	}

	_queueWater() {

		const q = this.query, f = this.flight;
		if ( ! q || this.slot < 0 || ! q.setPoint ) return;
		const lead = q.latency || 0.05;
		for ( let i = 0; i < 4; i ++ ) {

			f.probeWorld( i, _v, lead );
			q.setPoint( this.slot + i, _v.x, _v.z );

		}

	}

	_step( dt ) {

		const f = this.flight;
		this._readWater();
		if ( this.visual ) this.visual.stopped = f.engineFail.some( Boolean ) ? f.engineFail : null; // (a dead engine's propeller stands still)
		for ( const ev of this.systems.update( dt, { hp: this.hp } ) ) {

			if ( ev === 'noStart' && this.piloted ) this._toast( t( 'seaplane.noStart', 'The engine did not catch' ), 1600 );

		}

		f.update( dt );
		this._obstacles();
		const crashes = this.stats.crashes;
		for ( const e of f.drainEvents() ) {

			if ( e.type === 'fuelOut' ) {

				this.systems.stop();
				if ( this.piloted ) this._toast( t( 'seaplane.fuelOut', 'Out of fuel: the engine stopped. Glide down onto the water.' ), 4200 );
				continue;

			}

			this._event( e );
			if ( this.stats.crashes !== crashes ) break; // the rest of that step's strikes belong to the same wreck

		}

		if ( this.lost ) return; // (wrecked this step: the wreck draws itself now)
		this._queueWater();
		if ( f.airborne ) this.stats.maxAlt = Math.max( this.stats.maxAlt, f.agl );
		this._syncVisual( dt );

	}

	_syncVisual( dt ) {

		const f = this.flight;
		if ( this.visual ) {

			this.visual.setPose( f.position, f.quaternion );
			this.visual.spin( dt, f.rpm ); // (winding down after a stop, turning over on the starter)

		}

		const pr = f.geom.prop || GEOM.prop;
		const c = f.toWorldXYZ( pr[ 0 ], pr[ 1 ], pr[ 2 ], _v2 );
		const p = this.app.player;
		const s = this.systems;
		this.audio.update( dt, {
			running: f.engineOn, rpm: f.rpm, airspeed: f.airspeed, x: c.x, y: c.y, z: c.z, inside: this.piloted && p && p.view === 'first',
			cranking: !! ( s && s.cranking ), flaps: Math.abs( f.flapPos - f.flaps ) > 0.01, horn: !! ( s && this.piloted && s.stallWarn ),
			engines: f.geom && f.geom.engines ? f.geom.engines.length : 1, failed: f.engineFail || null,
		} );

	}

	_event( e ) {

		// (the airframe's thresholds: fragile floats, a hull, a land plane; armour: more hull points to lose)
		const f = this.flight, hpts = this.spec.hullPoints || 1;
		const r = judge( e, this.hp * hpts, { rough: this.spec.rough, landplane: this.spec.landplane } );
		if ( r.damage ) r.damage /= hpts;
		this.log.push( { e, r } );
		if ( this.log.length > 24 ) this.log.shift();
		const x = f.position.x, z = f.position.z;
		const vfx = this.features && this.features.get ? this.features.get( 'vfx' ) : null;
		const fwd = _v.set( 0, 0, 1 ).applyQuaternion( f.quaternion );
		if ( r.kind === 'tookOff' ) {

			this.stats.flights ++;
			this._emit( 'planeTookOff', { x, z } );
			vfx?.spray?.( x, f.seaLevel(), z, 0.8, - fwd.x, - fwd.z );
			return;

		}

		if ( r.kind === 'landed' || r.kind === 'bounce' ) {

			if ( e.type === 'touch' ) {

				this.stats.landings ++;
				this._emit( 'planeLanded', { onWater: !! r.onWater, x, z, sink: e.sink } );
				if ( r.onWater ) vfx?.spray?.( x, f.seaLevel(), z, Math.min( 1.5, 0.6 + ( e.sink || 0 ) * 0.25 ), - fwd.x, - fwd.z );

			}

			if ( r.kind === 'bounce' ) this._rough( r, e );
			return;

		}

		if ( r.kind === 'crash' ) this._crash( r.text || 'The seaplane crashed', e, r );

	}

	// a rough landing (or a part dipped / clipped): hull damage, a float sprung, a splash and a bang; the pilot stays aboard
	_rough( r, e ) {

		const f = this.flight, x = f.position.x, z = f.position.z;
		const vfx = this.features && this.features.get ? this.features.get( 'vfx' ) : null;
		this.hp = Math.max( 1, this.hp - r.damage );
		// a twin: a hard knock on one side can stop that side's engine
		if ( f.engineFail.length > 1 && r.damage >= 20 ) this.failEngine( ( r.sprung === 'R' || e.side < 0 ) ? 1 : 0 );
		if ( r.sprung ) {

			const i = r.sprung === 'L' ? 0 : 1;
			f.sprung[ i ] = Math.min( 1, f.sprung[ i ] + 0.6 );

		}

		const water = ! e.surface || e.surface === 'water';
		if ( water ) vfx?.splash?.( x, f.seaLevel(), z, 1.1 );
		else vfx?.splinters?.( x, f.position.y + 2, z, 0.7 );
		this.audio.crunch( 0.45, x, f.position.y + 1, z, water );
		this._toast( `${ r.text } (${ Math.round( this.hp ) }%)`, 2600 );
		if ( this.piloted ) this.app.cameraFeel?.kick?.( 'hit' );

	}

	// a wreck (or a direct collision): the plane breaks up where it hit and is gone until recovered; the pilot is thrown
	// clear (alive) unless it was a direct collision (playerDied, or the jetty without the death feature)
	_crash( cause, e = null, r = null ) {

		const f = this.flight;
		const x = f.position.x, y = f.position.y, z = f.position.z;
		const sea = f.seaLevel();
		const ground = this.terrain && this.terrain.heightAt ? this.terrain.heightAt( x, z ) : - Infinity;
		const surf = e && e.surface;
		const water = surf === 'water' || ( surf !== 'ground' && ground < sea - 0.5 );
		// (a bare _crash( cause ), without a judged event, is the old fatal crash: test/feature-death.mjs drives it so)
		// (nobody aboard - bailed out, adrift - nobody dies: a fatal impact is just a wreck)
		const severity = r ? ( r.severity === 'death' && this.piloted ? 'death' : 'wreck' ) : 'death';
		const speed = r && Number.isFinite( r.speed ) && r.speed > 0 ? r.speed : f.velocity.length();
		this.stats.crashes ++;
		this.hp = this.free ? MAX_HP : 0;
		const cost = this.repairCost();
		const wasPiloted = this.piloted;
		this.piloted = false;
		this.abandoned = false;
		this.systems.stop();
		f.controls.throttle = 0;
		this.pilot.reset();
		if ( this.isOpen() ) this.close();
		this.lost = true;
		this._breakUp( e, severity, water, wasPiloted );
		const p = this.app.player;
		const death = this.features && this.features.get ? this.features.get( 'death' ) : null;
		let died = false, thrown = null;
		if ( wasPiloted && p && p.exitVehicle ) {

			if ( severity === 'death' && death ) {

				// a direct collision kills the pilot: out of the cockpit where it hit, and the death feature
				// (src/features/death) cuts to black, leaves the sea chest there and wakes you at Jade Landing
				if ( water ) p.exitVehicle( x, sea - 0.3, z, p.yaw, 'swim', sea );
				else p.exitVehicle( x, y, z, p.yaw, 'walk' );
				died = true;

			} else if ( severity === 'death' ) {

				// (no death feature) rescued and set down on the jetty
				const jp = jettyPoint( SITE.berth.x + 3, SITE.berth.z - 4 );
				p.exitVehicle( jp.x, jp.y, jp.z, Math.PI, 'walk' );

			} else thrown = this._throwClear( e, r, water, sea );

		}

		const recovery = this.recoveryCost();
		this._emit( 'planeCrashed', { cause, x, y, z, cost, severity, speed, water, recovery } );
		if ( died ) this._emit( 'playerDied', { cause: 'seaplane', text: cause, x, y: water ? sea : y, z } );
		this._save();
		const bill = this.free ? '' : ` ${ t( 'seaplane.recoverAt', 'Recover it at the hangar' ) } (${ money$( recovery ) } + ${ t( 'seaplane.repairNext', 'repair' ) } ${ money$( cost ) }).`;
		if ( ! died ) this._toast( thrown ? `${ cause }. ${ t( 'seaplane.thrownClear', 'You were thrown clear.' ) }${ bill || ' ' + t( 'seaplane.recoverWhere', 'Recover the wreck at the seaplane hangar on the beach, or at the boat yard.' ) }` : `${ cause }.${ bill || ' ' + t( 'seaplane.recoverFree', 'Recover it at the hangar.' ) }`, 5600 );
		return thrown;

	}

	// out of the breaking plane: a few metres clear of the hull into the water or onto the ground, a black-out, hurt
	_throwClear( e, r, water, sea ) {

		const p = this.app.player, w = this._wreck;
		const o = { x: w.x, y: w.y, z: w.z, yaw: w.yaw };
		const terrain = this.terrain;
		const env = {
			seaLevel: sea,
			groundAt: ( x, z ) => ( terrain && terrain.heightAt ? terrain.heightAt( x, z ) : - Infinity ),
			jetty: ( x, z ) => jettyPoint( x, z ),
			solidAt: ( x, y, z ) => !! this._solidAt( x, y, z ),
		};
		// away from the side that hit (the port door otherwise)
		const side = e && e.side > 0 ? - 1 : 1;
		const tp = throwPoint( o, side, env, this._rand || Math.random );
		const yaw = Math.atan2( o.x - tp.x, o.z - tp.z ) + Math.PI; // facing the wreck (Player yaw 0 faces -Z)
		p.exitVehicle( tp.x, tp.y, tp.z, yaw, tp.mode, tp.mode === 'swim' ? sea : null );
		this._sinceExit = 0;
		this.stun.start( CRASH.stun );
		const hurt = r && r.hurt ? r.hurt : CRASH.hurt[ 0 ];
		const melee = this.features && this.features.get ? this.features.get( 'melee' ) : null;
		const c = melee && melee.combat;
		if ( c && Number.isFinite( c.hp ) ) {

			c.hp = Math.max( 1, c.hp - hurt ); // hurt, never killed by the throw
			if ( 'sinceHurt' in c ) c.sinceHurt = 0;

		}

		this.thrown = { ...tp, hurt };
		return this.thrown;

	}

	// the wreck: the pieces (Wreck.js), the GLB's parts torn off the visual, the impact's effects
	_breakUp( e, severity, water, piloted ) {

		const f = this.flight;
		const seed = Number.isFinite( this.opts.seed ) ? this.opts.seed + this.stats.crashes : ( Math.random() * 1e9 ) | 0;
		if ( this._wreck ) this._clearWreck(); // (a second wreck replaces a first that was never recovered)
		const w = new Wreck( { position: f.position, quaternion: f.quaternion, velocity: f.velocity, angular: f.angular, seed, airframe: this.af } );
		this._rand = w.rand;
		for ( const n of wreckParts( e || {}, severity, w.rand ) ) w.detach( n );
		this._wreck = w;
		this._wq.fill( false );
		if ( this.visual ) for ( const n of w.detached ) this.visual.detach( n );
		const sea = f.seaLevel();
		this._wSea = sea;
		this._wfx = { t: 0, smokeT: 0, bubbleT: 0, markT: 0, fire: false, water, rpm: f.rpm };
		f.velocity.set( 0, 0, 0 );
		f.angular.set( 0, 0, 0 );
		f.engineOn = false;
		f.rpm = 0;
		// the impact
		const vfx = this.features && this.features.get ? this.features.get( 'vfx' ) : null;
		const x = w.x, y = w.y, z = w.z;
		const eng = _v3.copy( w.fuselage.c ).add( _v.set( 0, 0.4, 2.6 ).applyQuaternion( w.fuselage.q ) );
		if ( water ) {

			vfx?.splash?.( x, sea, z, 2.6 );

		} else {

			const g = this.terrain && this.terrain.heightAt ? this.terrain.heightAt( x, z ) : y;
			vfx?.dust?.( x, g, z, 2.2 );
			vfx?.debris?.( x, g + 1, z, 1.3, 'dirt' );
			vfx?.flash?.( eng.x, eng.y, eng.z, 1.2 );
			vfx?.fire?.( WRECK_ID, eng.x, eng.y, eng.z, 1.2 );
			this._wfx.fire = true;

		}

		vfx?.splinters?.( x, y + 1.5, z, 1.6 );
		vfx?.debris?.( x, y + 1.5, z, 1.3, 'wood' );
		vfx?.debris?.( x, y + 1.5, z, 0.8, 'metal' );
		vfx?.smoke?.( eng.x, eng.y, eng.z, 1.2 );
		this.audio.crunch( 1.7, x, y, z, water );
		const cf = this.app.cameraFeel;
		if ( cf && cf.kick ) {

			if ( piloted ) cf.kick( 'broadside', { scale: 1.6 } );
			else cf.kick( 'explosion', { x, y, z, radius: 8, energy: 2e5 } );

		}

		this._syncWreck();
		this._mark( true );

	}

	// the water under a wreck piece: the plane's four probe slots follow the first four pieces, the rest (and a missing
	// query) use the sea level where it went down
	_seaAt( x, z, i ) {

		const q = this.query;
		let h = this._wSea ?? 0;
		if ( q && this.slot >= 0 && i < 4 && q.setPoint ) {

			if ( this._wq[ i ] && q.cpuValid ) {

				const v = q.cpu[ ( this.slot + i ) * 4 ];
				if ( Number.isFinite( v ) ) h = v;

			}

			q.setPoint( this.slot + i, x, z );
			this._wq[ i ] = true;

		}

		return h;

	}

	_updateWreck( dt ) {

		const w = this._wreck, fx = this._wfx;
		if ( ! w ) return;
		const terrain = this.terrain;
		const events = w.update( dt, { seaAt: ( x, z, i ) => this._seaAt( x, z, i ), groundAt: ( x, z ) => ( terrain && terrain.heightAt ? terrain.heightAt( x, z ) : - Infinity ) } );
		const vfx = this.features && this.features.get ? this.features.get( 'vfx' ) : null;
		for ( const ev of events ) this._wreckEvent( ev, vfx );
		fx.t += dt;
		const fus = w.fuselage, up = fus.state !== 'gone';
		// the engine dies: a last cough, then quiet
		this.audio.update( dt, { running: fx.t < 0.35 && fx.rpm > 0.1, rpm: fx.rpm * Math.exp( - fx.t * 2 ), airspeed: 0, x: w.x, y: w.y, z: w.z, inside: false } );
		const eng = _v3.copy( fus.c ).add( _v.set( 0, 0.4, 2.6 ).applyQuaternion( fus.q ) );
		if ( fx.fire && ( fx.t > CRASH.fire || ! up || fus.state === 'sinking' ) ) {

			vfx?.stopFire?.( WRECK_ID );
			fx.fire = false;

		} else if ( fx.fire ) vfx?.fire?.( WRECK_ID, eng.x, eng.y, eng.z, 1.2 * ( 1 - fx.t / CRASH.fire ) + 0.3 );

		fx.smokeT -= dt;
		if ( up && fx.t < CRASH.smoke && fx.smokeT <= 0 && eng.y > ( this._wSea ?? 0 ) - 0.2 ) {

			fx.smokeT = 0.3;
			vfx?.smoke?.( eng.x, eng.y + 0.3, eng.z, 0.25 + 0.9 * ( 1 - fx.t / CRASH.smoke ) );

		}

		fx.bubbleT -= dt;
		if ( fus.state === 'sinking' && fx.bubbleT <= 0 ) {

			fx.bubbleT = 0.45;
			vfx?.bubbles?.( fus.c.x, this._wSea ?? 0, fus.c.z, 1.2 );

		}

		fx.markT -= dt;
		if ( fx.markT <= 0 ) {

			fx.markT = 1;
			this._mark( true );

		}

		this._syncWreck();
		this._perch( fus );
		// everything gone under: the pieces are done (the plane stays lost until recovered)
		let left = false;
		for ( const b of w.bodies.values() ) if ( b.state !== 'gone' ) left = true;
		if ( ! left ) {

			this._dropPerch();
			vfx?.stopFire?.( WRECK_ID );
			this._mark( true );
			this._wreck = null;
			this._wfx = null;

		}

	}

	_wreckEvent( ev, vfx ) {

		const big = ev.name === 'fuselage';
		if ( ev.type === 'splash' ) {

			vfx?.splash?.( ev.x, ev.y, ev.z, ev.strength * ( big ? 1 : 0.7 ) );
			if ( ! big ) vfx?.splinters?.( ev.x, ev.y + 0.3, ev.z, 0.5 );

		} else if ( ev.type === 'land' ) {

			vfx?.dust?.( ev.x, ev.y, ev.z, ev.strength );
			vfx?.debris?.( ev.x, ev.y + 0.4, ev.z, ev.strength * 0.6, big ? 'metal' : 'wood' );

		} else if ( ev.type === 'sinking' && big ) {

			vfx?.sinking?.( WRECK_ID, ev.x, ev.z, 1.8 );
			if ( this._near( ev.x, ev.z, 120 ) ) this._toast( t( 'seaplane.wreckSinking', 'The seaplane wreck is going down' ), 2600 );

		} else if ( ev.type === 'sunk' && big ) {

			this._mark( true ); // (relabelled: where it went down)
			if ( this._near( ev.x, ev.z, 200 ) ) this._toast( t( 'seaplane.wreckSunk', "The wreck sank. Captain Roid's crew can raise it: see the hangar." ), 4200 );

		}

	}

	_near( x, z, r ) {

		const p = this.app.player && this.app.player.position;
		return ! p || Math.hypot( p.x - x, p.z - z ) < r;

	}

	// the visual follows the pieces: the plane's group is the fuselage, the torn-off parts their own groups
	_syncWreck() {

		const w = this._wreck, v = this.visual;
		if ( ! w || ! v ) return;
		if ( w.pose( 'fuselage', _v, _q ) ) v.setPose( _v, _q );
		v.setVisible( w.fuselage.state !== 'gone' );
		for ( const n of w.detached ) {

			const on = w.pose( n, _v, _q );
			v.setPart( n, _v, _q );
			v.partVisible( n, on );

		}

	}

	// the wreck's pin on the world map and the minimap
	_mark( on ) {

		const wm = this.features && this.features.get ? this.features.get( 'worldmap' ) : null;
		if ( ! wm || ! wm.addMarker ) return;
		const w = this._wreck;
		if ( on && w ) wm.addMarker( { id: WRECK_ID, kind: 'wreck', icon: 'wreck', x: w.x, z: w.z, label: w.sunk ? t( 'seaplane.wreckSunkPin', 'Seaplane wreck (sunk)' ) : t( 'seaplane.wreckPin', 'Seaplane wreck' ) } );
		else if ( ! on && wm.removeMarker ) wm.removeMarker( WRECK_ID );

	}

	// the floating fuselage's cabin roof is a perch: a walkable collider box that rides it (a swimmer beside it climbs on
	// with E, or swims onto it); it goes when the fuselage starts to sink (you are back in the water) or on land
	_perch( fus ) {

		const col = this.app.colliders, p = this.app.player;
		const want = !! ( fus && fus.state === 'afloat' && col && col.addBox );
		let b = this._perchBox;
		if ( ! want ) {

			if ( b ) this._dropPerch();
			return;

		}

		const yaw = this._wreck.yaw;
		const top = _v3.copy( fus.c ).add( _v.set( 0, ROOF_Y - GEOM.com[ 1 ], ROOF_Z ).applyQuaternion( fus.q ) );
		if ( ! b ) b = this._perchBox = col.addBox( new Vector3( top.x, top.y - 0.15, top.z ), new Vector3( 0.55, 0.15, 1.75 ), yaw, { walkable: true, solid: false, tag: 'seaplane-wreck' } );
		b.center.set( top.x, top.y - 0.15, top.z );
		b.rotY = yaw;
		b.cos = Math.cos( yaw );
		b.sin = Math.sin( yaw );
		b.top = top.y;
		b.bottom = top.y - 0.3;
		// a swimmer beside it: E climbs onto the roof
		if ( ! p || p.mode !== 'swim' || ! p.exitVehicle ) return;
		if ( Math.hypot( p.position.x - fus.c.x, p.position.z - fus.c.z ) > PERCH_REACH ) {

			this._perchHint = false;
			return;

		}

		if ( ! this._perchHint ) {

			this._perchHint = true;
			this._toast( t( 'seaplane.perchHint', 'E: climb onto the wreck' ), 1800 );

		}

		const inp = this.app.input;
		if ( inp && inp.hit && inp.hit( 'KeyE' ) ) p.exitVehicle( top.x, top.y, top.z, p.yaw, 'walk' );

	}

	_dropPerch() {

		const b = this._perchBox, col = this.app.colliders;
		this._perchBox = null;
		if ( ! b || ! col || ! col.boxes ) return;
		const i = col.boxes.indexOf( b );
		if ( i >= 0 ) col.boxes.splice( i, 1 );

	}

	// the pieces gone (recovered, a new game): the plane whole again
	_clearWreck() {

		this._dropPerch();
		const vfx = this.features && this.features.get ? this.features.get( 'vfx' ) : null;
		if ( this._wfx && this._wfx.fire ) vfx?.stopFire?.( WRECK_ID );
		this._wreck = null;
		this._wfx = null;
		this._wq.fill( false );
		if ( this.visual ) {

			this.visual.reassemble();
			this.visual.setVisible( true );

		}

		this._mark( false );

	}

	// ships, buildings and rocks: what a STRIKE point is inside of ('ship' | 'object' | null)
	_solidAt( x, y, z ) {

		const nv = this.features && this.features.get ? this.features.get( 'naval' ) : null;
		if ( nv && nv.ships ) {

			for ( const sh of nv.ships ) {

				if ( ! sh || sh.alive === false || Math.abs( sh.x - x ) > 45 || Math.abs( sh.z - z ) > 45 ) continue;
				try {

					if ( inBox( sh.hullBox && sh.hullBox(), x, y, z ) || inBox( sh.riggingBox && sh.riggingBox(), x, y, z ) ) return 'ship';

				} catch ( err ) { /* a ship without its pose yet */ }

			}

		}

		// solid colliders (buildings, rocks, the hangar); decks and jetties are walkable and left out
		const col = this.app.colliders;
		if ( col && col.boxes ) {

			for ( const b of col.boxes ) {

				if ( ! b.solid || b.walkable || y > b.top || y < b.bottom ) continue;
				const dx = x - b.center.x, dz = z - b.center.z;
				if ( dx * dx + dz * dz > b.radius * b.radius ) continue;
				const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
				if ( Math.abs( lx ) <= b.half.x && Math.abs( lz ) <= b.half.z ) return 'object';

			}

		}

		return null;

	}

	// strikes against ships / buildings (the STRIKE points) and destruction props (along the nose's path this frame)
	_obstacles() {

		const f = this.flight, v = f.velocity.length();
		const nose = f.toWorldXYZ( 0, 2.2, 4.0, _nose );
		const prev = this._prevNose;
		if ( v < CRASH.dip ) {

			this._prevNose = null;
			return;

		}

		const nf = f.noseFirst();
		for ( const [ part, x, y, z ] of f.geom.strike ) {

			const key = part + 'S';
			if ( f._struck.has( key ) ) continue;
			const pw = f.toWorldXYZ( x, y, z, _v3 );
			const kind = this._solidAt( pw.x, pw.y, pw.z );
			if ( ! kind ) continue;
			f._struck.add( key );
			f.events.push( { type: 'strike', part, surface: kind, speed: v, nose: nf, side: Math.sign( x ) } );

		}

		const d = this.features && this.features.get ? this.features.get( 'destruction' ) : null;
		if ( prev && d && d.raycastSegment && ! f._struck.has( 'noseP' ) ) {

			const hit = d.raycastSegment( prev.x, prev.y, prev.z, nose.x, nose.y, nose.z );
			if ( hit ) {

				f._struck.add( 'noseP' );
				f.events.push( { type: 'strike', part: 'nose', surface: 'prop', speed: v, nose: nf, side: 0, prop: hit.id } );

			}

		}

		this._prevNose = ( prev || new Vector3() ).copy( nose );

	}

	update( dt ) {

		const f = this.flight, p = this.app.player;
		this._sinceExit += dt;
		this.stun.update( dt );
		// the parachute: something else took the player out of it (a respawn) -> it is gone
		if ( this.chute && p && p.vehicle !== this.chute.vehicle ) {

			this.chute.dispose();
			this.chute = null;

		}
		// something else took the player out of the cockpit (a rescue, a respawn, the free camera reset)
		if ( this.piloted && p && ( p.mode !== 'plane' || p.vehicle !== this.vehicle ) ) {

			this.piloted = false;
			this.systems.stop();
			this.pilot.reset();
			if ( this.isOpen() ) this.close();

		}

		if ( this.lost ) {

			// wrecked: the pieces float, burn and sink (Wreck.js); the plane itself is gone until recovered
			this._driven = false;
			this._updateWreck( dt );

		} else if ( this.piloted ) {

			// Player.updatePlane already stepped it this frame; otherwise (free camera, paused player) keep it flying
			if ( ! this._driven ) this._step( dt );
			this._driven = false;

		} else if ( this.abandoned ) {

			this._flyAbandoned( dt );

		} else {

			this._idle( dt );
			this._swimmerBoard();

		}

		this._radioUpdate( dt );
		this._syncParked();
		this._stripTipUpdate( dt );
		this.cockpit.update( dt );
		this.remote.update( dt );

	}

	// the radio upgrade: while flying, ships and wrecks within RADIO_RANGE go on the world map (refreshed every 2 s)
	radioContacts() {

		const f = this.flight, out = [], x = f.position.x, z = f.position.z;
		const nv = this.features && this.features.get ? this.features.get( 'naval' ) : null;
		for ( const s of ( nv && nv.ships ) || [] ) {

			if ( ! s || ! Number.isFinite( s.x ) || Math.hypot( s.x - x, s.z - z ) > RADIO_RANGE ) continue;
			out.push( { kind: s.alive === false ? 'wreck' : 'ship', x: s.x, z: s.z, label: s.name || t( 'seaplane.radioShip', 'Ship' ) } );

		}

		const sd = this.features && this.features.get ? this.features.get( 'shipdamage' ) : null;
		const wl = sd && typeof sd.wrecks === 'function' ? sd.wrecks() : [];
		for ( const w of Array.isArray( wl ) ? wl : [] ) if ( w && Number.isFinite( w.x ) && Math.hypot( w.x - x, w.z - z ) <= RADIO_RANGE ) out.push( { kind: 'wreck', x: w.x, z: w.z, label: w.name || t( 'seaplane.radioWreck', 'Wreck' ) } );
		return out;

	}

	_radioUpdate( dt ) {

		const wm = this.features && this.features.get ? this.features.get( 'worldmap' ) : null;
		const on = this.piloted && !! this.spec.radio && this.systems.master;
		if ( ! wm || ! wm.addMarker ) return;
		if ( ! on ) {

			if ( this._radio.size && wm.removeMarker ) for ( const id of this._radio ) wm.removeMarker( id );
			this._radio.clear();
			return;

		}

		this._radioT -= dt;
		if ( this._radioT > 0 ) return;
		this._radioT = 2;
		const seen = new Set();
		this.radioContacts().forEach( ( c, i ) => {

			const id = RADIO_ID + i;
			seen.add( id );
			wm.addMarker( { id, kind: c.kind, icon: c.kind, x: Math.round( c.x ), z: Math.round( c.z ), label: `${ c.label } · ${ t( 'seaplane.radio', 'radio' ) }` } );

		} );
		for ( const id of this._radio ) if ( ! seen.has( id ) && wm.removeMarker ) wm.removeMarker( id );
		this._radio = seen;

	}

	// while flying the left button works the panel (Game skips the rod's cast / strike)
	wantsMouse() {

		return this.piloted;

	}

	// unattended: the engine is off; at the ramp the mooring lines hold it at the berth, elsewhere a sea anchor
	_idle( dt ) {

		const f = this.flight;
		if ( f.engineOn || this.systems.cranking ) this.systems.stop();
		const c = f.controls;
		c.throttle = c.pitch = c.roll = c.yaw = c.waterRudder = 0;
		c.brake = f.geom.wheels ? 1 : 0; // (parked: the brakes set)
		const cam = this.app.camera && this.app.camera.position;
		if ( cam && Math.hypot( cam.x - f.position.x, cam.z - f.position.z ) > SIM_RANGE && ! f.airborne ) {

			this._syncVisual( dt );
			return;

		}

		if ( ! f.airborne && f.onWater ) {

			const k = 1 - Math.exp( - dt * ( this.home ? 0.9 : 0.4 ) );
			if ( this.home && this.base().kind === 'ramp' ) {

				// mooring lines: pull to the berth and turn to its heading
				const b = SITE.berth;
				f.velocity.x += ( ( b.x - f.position.x ) * 0.25 - f.velocity.x ) * k;
				f.velocity.z += ( ( b.z - f.position.z ) * 0.25 - f.velocity.z ) * k;
				let dh = b.heading - f.heading();
				dh = Math.atan2( Math.sin( dh ), Math.cos( dh ) );
				f.angular.y += ( dh * 0.4 - f.angular.y ) * k;

			} else if ( this._moor ) {

				// moored in a bay: the line draws it gently back towards the spot
				const m = this._moor;
				f.velocity.x += ( ( m.x - f.position.x ) * 0.05 - f.velocity.x ) * k;
				f.velocity.z += ( ( m.z - f.position.z ) * 0.05 - f.velocity.z ) * k;

			} else {

				f.velocity.x -= f.velocity.x * k;
				f.velocity.z -= f.velocity.z * k;

			}

		}

		this._step( dt );
		this._tether();

	}

	// ------------------------------------------------------------------ maps and multiplayer

	marker() {

		if ( this.lost ) return null; // (the wreck has its own pin)
		const f = this.flight;
		return { x: f.position.x, z: f.position.z, heading: f.heading(), owned: this.owned, flying: this.piloted && f.airborne };

	}

	decorateState( out ) {

		if ( ! out || ! this.piloted ) return out;
		const f = this.flight, p = f.position, q = f.quaternion;
		const r = ( v ) => Math.round( v * 1000 ) / 1000;
		out.plane = { p: [ r( p.x ), r( p.y ), r( p.z ) ], q: [ r( q.x ), r( q.y ), r( q.z ), r( q.w ) ], thr: r( f.rpm ), af: this.af, liv: this.upgrades.livery || 0 };
		// the avatar faces the nose for clients that do not know mode 'plane' yet (Player yaw convention: 0 faces -Z)
		out.yaw = f.heading() + Math.PI;
		return out;

	}

	updateRemote( states ) {

		const net = this.app.net;
		if ( net && net.id ) this.remote.localId = net.id;
		this.remote.ingest( states );

	}

	// ------------------------------------------------------------------ save

	// the airframe out in the top-level fields (older saves read them), every airframe's record in `fleet`
	toJSON() {

		const sp = this.flight.sprung;
		this._stash();
		const fleet = {};
		for ( const id of Object.keys( this.fleet ) ) {

			const r = this.fleet[ id ];
			if ( ! r || ! r.owned ) continue;
			fleet[ id ] = { owned: true, stolen: !! r.stolen, hp: Math.round( r.hp ), fuel: Math.round( ( r.fuel ?? 1 ) * 1000 ) / 1000, switches: r.switches || null, sprung: r.sprung || [ 0, 0 ], lost: !! r.lost, upgrades: { ...cleanUpgrades( r.upgrades ) }, cargo: ( r.cargo || [] ).map( ( c ) => ( { ...c } ) ), engineFail: ( r.engineFail || [] ).slice() };

		}

		return { owned: this.owned, hp: Math.round( this.hp ), fuel: Math.round( this.flight.fuel * 1000 ) / 1000, switches: this.systems.toJSON(), stats: { ...this.stats }, lost: this.lost, sprung: [ sp[ 0 ], sp[ 1 ] ], af: this.af, fleet, last: { ...this.last } };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		// wave 12: the fleet (every airframe's record) and the one out; an older save is the Jade's
		this.fleet = {};
		if ( d.fleet && typeof d.fleet === 'object' ) for ( const id of AIRFRAME_IDS ) if ( d.fleet[ id ] && typeof d.fleet[ id ] === 'object' ) this.fleet[ id ] = { ...d.fleet[ id ] };
		const af = AIRFRAMES[ d.af ] && this.available( d.af ) ? d.af : 'jade';
		// wave 14B: which airframe stands at each base (the one last out there)
		if ( d.last && typeof d.last === 'object' ) for ( const k of [ 'ramp', 'strip' ] ) if ( AIRFRAMES[ d.last[ k ] ] && ( AIRFRAMES[ d.last[ k ] ].base === 'strip' ) === ( k === 'strip' ) ) this.last[ k ] = d.last[ k ];
		if ( AIRFRAMES[ af ].base !== 'airport' ) this.last[ AIRFRAMES[ af ].base ] = af;
		if ( af !== this.af ) {

			this._clearWreck();
			this.af = af;

		}

		this.upgrades = cleanUpgrades( this.fleet[ af ] && this.fleet[ af ].upgrades );
		const rc = this.fleet[ af ] && this.fleet[ af ].cargo;
		this.cargo = Array.isArray( rc ) ? rc.filter( ( c ) => c && GOODS[ c.good ] && c.qty > 0 ).map( ( c ) => ( { ...c } ) ) : [];
		this._respec();
		const ef = this.fleet[ af ] && Array.isArray( this.fleet[ af ].engineFail ) ? this.fleet[ af ].engineFail : [];
		this.flight.engineFail.forEach( ( _, i ) => ( this.flight.engineFail[ i ] = ef[ i ] === true ) );
		this.abandoned = false;
		this.owned = d.owned === true;
		if ( this.owned && AIRFRAMES[ af ].base === 'airport' ) lockAirportRank( this.app );
		this.hp = Number.isFinite( d.hp ) ? Math.max( 0, Math.min( MAX_HP, d.hp ) ) : MAX_HP;
		this.flight.fuel = Number.isFinite( d.fuel ) ? Math.max( 0, Math.min( 1, d.fuel ) ) : 1; // (older saves: a full tank)
		this.systems.fromJSON( d.switches );
		if ( d.stats && typeof d.stats === 'object' ) for ( const k of Object.keys( this.stats ) ) if ( Number.isFinite( d.stats[ k ] ) ) this.stats[ k ] = d.stats[ k ];
		// a wreck left unrecovered: gone (its pieces are not saved: it sank / was picked over while you were away)
		this._clearWreck();
		this.lost = d.lost === true && this.owned;
		const sp = Array.isArray( d.sprung ) ? d.sprung : [];
		for ( let i = 0; i < 2; i ++ ) this.flight.sprung[ i ] = Number.isFinite( sp[ i ] ) ? Math.max( 0, Math.min( 1, sp[ i ] ) ) : 0;
		if ( ! this.piloted ) this._place();
		if ( this.lost && this.visual ) this.visual.setVisible( false );

	}

	reset() {

		const p = this.app.player;
		if ( this.piloted && p && p.exitVehicle ) {

			this.piloted = false;
			const jp = jettyPoint( SITE.berth.x + 3, SITE.berth.z );
			p.exitVehicle( jp.x, jp.y, jp.z, Math.PI, 'walk' );

		}

		this.piloted = false;
		this.owned = false;
		this.hp = MAX_HP;
		this.flight.fuel = 1;
		this.lost = false;
		this._clearWreck();
		if ( this.chute ) {

			this.chute.dispose();
			this.chute = null;

		}

		this.abandoned = false;
		this.fleet = {};
		this.af = 'jade';
		this.last = { ramp: 'jade', strip: 'kestrel' };
		this.upgrades = defaultUpgrades();
		this.cargo = [];
		this._respec();
		this.flight.engineFail.fill( false );
		this.flight.sprung[ 0 ] = this.flight.sprung[ 1 ] = 0;
		for ( const k of Object.keys( this.stats ) ) this.stats[ k ] = 0;
		this._place();

	}

	dispose() {

		for ( const off of this._interact ) off();
		for ( const off of this._offs ) off();
		this._interact = [];
		this._clearWreck();
		if ( this.chute ) this.chute.dispose();
		if ( this.stripSite ) this.stripSite.dispose();
		if ( this.airportSite ) this.airportSite.dispose();
		this.stun.dispose();
		this.cockpit.dispose();
		this.panel.dispose();
		this.audio.dispose();
		this.remote.dispose();
		if ( this.visual ) this.visual.dispose();
		for ( const w of this.parked.values() ) if ( w.view ) w.view.dispose();
		this.parked.clear();
		if ( this.models && this.models.dispose ) this.models.dispose();
		if ( this.site ) this.site.dispose();

	}

}
