// Naval: AI merchant and pirate ships, cannon combat, hull damage, sinking, loot and the naval HUD.
// The Features module wraps this (index.js); everything outside the app's scene / water / audio is optional, so
// the whole simulation runs headless in node (test/feature-naval.mjs).
//
//   naval.ships                 Ship[] (merchant trawlers, pirate sloops / brigantines; see Ship.js)
//   naval.playerHull            { hp, max, sunk, boat }      the player's boat; max from the boat class (Boats.js mass)
//   naval.playerGun             { owned, level, guns, builtIn }   owned: the swivel gun is bought (the integrator sets owned = true)
//                               or the ship carries its own battery; guns: guns per side (1 for a swivel, the ship class's
//                               broadside.z.length for the sloop / brigantine); builtIn: the boat is a ship with a battery.
//                               Read the class from Boats.js; `level` rises to the battery's level on a ship.
//   naval.speedFactor           1 .. 0.35 as the hull is shot up (0 when sunk): multiply boatCtl.maxThrust by it
//   naval.fire( 'port' | 'starboard' ) -> bool   the player's broadside (keys Z / X at the helm); false if not owned / reloading.
//                               A swivel gun fires one ball; a ship fires `playerGun.guns` balls along its side in a short ripple
//   naval.damagePlayer( amount, cause )          hull damage from outside (grounding...)
//   naval.repairCost() / naval.repair( { free } ) -> bool      restore the hull (coins via features.state.spend); false while
//                               she is sinking or a wreck (salvage instead)
//
// Losing the boat (wave 4): at 0 hull she lists, settles and goes down over SINK_TIME (8 s, Ship.js sinkPose) where she
// is; the player is thrown overboard (naval.sinking while it lasts; the boat controller is frozen, its model animated).
// Her cargo crates, and the fish if you were aboard, go down with her (campaign; the sandbox keeps everything). Then she
// is a wreck on the sea floor (Wrecks.js: naval.wrecks, the hold claimable by diving, marked on the maps) and the boat
// is gone (hidden, unboardable) until Captain Roid raises her:
//   naval.wreck                 the player's current boat's wreck record | null      naval.sinking  { t, boat, x, z, ... } | null
//   naval.salvageCost() / naval.salvage( { free } ) -> bool     raise her: afloat at the berth, hull sound, her hold back
//                               (features.state pays; free in the sandbox); emits wreckSalvaged { boat, cost, x, z }
//   playerBoatSunk { cause, boat, x, z, aboard, boarded }: aboard = the player was on her (now overboard), boarded = a
//                               hostile boarding party held the deck (the death feature ends the run then)
//   naval.spawn( kind, opts ) -> Ship            add a ship by hand ('trawler' | 'sloop' | 'brigantine')
//   naval.bounties              Map id -> contract: the notices feature's bountyAccepted { id, target, tier, region, captain, ship }
//                               spawns that captain's ship (tier 1 sloop, 2 tougher sloop, 3 brigantine) in deep water near the
//                               region; sinking him emits shipSunk { name: target, target, captain, bountyId, byPlayer ... };
//                               bountyCancelled releases him; a resumed contract (after a load) respawns a missing target
//   naval.active                 false when disabled, and in multiplayer unless the room's host (netsync/NavalLink.js)
//   naval.update( dt ) / toJSON() / fromJSON( d ) / reset() / dispose()
//
// Wave 9 (collisions, aiming, cripple):
//   Hulls collide (Collisions.js): the player's boat against every alive ship and the ships against each other, as oriented
//   boxes on the water plane. They are pushed apart by inverse mass and bounce / rub (restitution 0.15, friction 0.3): the
//   boat controller takes the impulse (applyCollision), a Ship its way / drift / yaw (applyImpulse). Each new contact faster
//   than 0.8 m/s damages both hulls once (damagePlayer( n, 'ramming' ) / ship.damage), with splinters, debris, a splash,
//   a crunch, the camera kick, destruction.impulse at the spot and planks when she is stove in; ships going down shed
//   floating planks (Planks.js). Event: hullsCollided { a, b, x, z, speed, damage: { a, b }, byPlayer }.
//   Pirates heavier than their target ram while both batteries reload; merchants steer away from a contact seen 3 s ahead.
//   naval.aiming / naval.aimInfo       right mouse (or app.input.aimHeld) at the helm: the guns follow the camera look
//                               (AimAssist.lookAim); the left button fires that side (naval.fire( side, { aimed: true } ))
//   naval.playerGun.owned is always true in the sandbox (a free swivel gun); the yard sells it in the campaign
//   shipCrippled { id, name, by, x, z }   a pirate's hull fell below CRIPPLE (boarding RULES.cripple, 25 %): she stops
//                               shooting; the HUD shows the nearest pirate's hull bar with that mark. With the boarding
//                               feature installed, boarding emits it (when she strikes her colours) and naval does not
//
// Wave 10 (third-person aiming, the crew's guns):
//   naval.aimCamera( { dist, fov } ) -> { side, sign, blend, yawOffset, pitch, pitchMin, pitchMax, dist, fov, fovDelta, shoulder } | null
//                               while aiming at the helm in the chase view (Player.camMode 'third') the helm camera swings to an
//                               over-the-shoulder rig on the aimed side (AimCamera.js: 2.5 m out, 1.2 m up, 30 % closer, fov
//                               -8 deg, eased over 0.25 s in and out); Player.updateBoat reads it through app.player.aimCamera
//                               (naval sets that hook). Naval narrows the fov itself after the camera feel (restored on release).
//                               In that view the look's pitch sets the range (AimCamera.pitchToRange) and the HUD crosshair sits
//                               on the projected impact; first person keeps wave 9's look-ray ranging and centred crosshair
//   naval.crewTarget( side ) -> Ship | null      what a crew gunner would shoot from that side: a pirate afloat, not crippled /
//                               struck (the boarding prize), not alongside on purpose, inside reach and swing, nowhere in or
//                               from the peaceful waters (Routes SAFE_ZONES)
//   naval.crewFire( side, { reloadMul = 1.6, spreadMul = 1.5, crew } ) -> Ship | null   a gunner works that side's guns through
//                               the player's fire path (the player's balls, loot and bounties): the side's reload x reloadMul,
//                               the spread x spreadMul; never the side the skipper is aiming by hand. cannonFired carries crew
//   naval.reloadTotal { port, starboard }    the reload last started per side (the HUD's bar: a gunner's is longer)
//
// Wave 11A (ammunition, per-section damage, fire, flooding; Ammo.js, Sections.js, Fire.js, Flood.js, MastFall.js):
//   naval.ammo                  Magazine { rounds, max } of this hull (AMMO_MAX: skiff / canoe 8 .. brigantine 60; a new hull
//                               comes full). Every gun fired spends a round, the crew's gunners too; dry, the guns click, the
//                               HUD says "Out of shot" and crewFire returns null. A 'powder' keg in the trade hold is broken
//                               out when she runs dry at sea (+24); the sandbox refills her free while she lies moored.
//   naval.shotQuote() -> { rounds, price } / naval.buyShot( { free } ) -> { ok, added, price, reason }   the yard's
//                               "Powder and shot x12, $60" (features.state pays; free in the sandbox); emits shotBought
//   naval.usePowderKeg() -> rounds added (0 without a keg in the hold or room in the magazine)
//   naval.sections              Sections of this hull (rudder, sails or engine, mast, guns a side): a ball picks the section
//                               where it strikes (pickSection). Rudder < 40 % halves the helm (BoatController.rudderLift),
//                               0 = no steering; sails / engine < 50 % halve the top speed (speedFactor), 0 = adrift; the mast
//                               at 0 falls over the side (MastFall) and the sails go with it; a gun section at 0 silences
//                               that broadside. AI ships: Ship.sections, same rules (Ship.integrate).
//   naval.sectionRepairCost() / naval.repairSections( { free } )   "Rigging and rudder repairs" at the yard; repair() and
//                               repairCost() cover the hull, the sections and pumping her out together
//   naval.aimPart               'hull' | 'sails' | 'rudder': Tab while aiming cycles it (claimKey 'Tab'); the auto-aim lays
//                               on that part (Sections.aimPoint) and a hand-aimed shot's elevation is for its height
//   naval.fireState             Fire of this hull: a brigantine's big gun hit (10 %) or a ram faster than 7 m/s may start it;
//                               it grows, burns the hull, spreads to the sails and, with powder aboard above 0.8 for 10 s,
//                               fires the magazine (explosion; FIRE.blast of the hull; the shot is gone). E "Douse the fire"
//                               at the rail on deck (3 s bucket channel, repeatable: naval.douse()); heading into the wind
//                               at speed slows it. AI crews put their own out after 20-40 s (crew count).
//   naval.flood / floodState    0..1: below 35 % hull the water rises 0.01 / s per 10 % under the line; speed x
//                               ( 1 - 0.5 flood ), she settles lower (her model, after the controller placed it); full, she
//                               sinks through the sinking flow. E "Man the pump" on deck (-0.04 / s while held:
//                               naval.pump( true / false )); posted crew pump when no enemy is in range; repairs drain her.
//   Events: shotBought { rounds, price }, outOfShot { by: 'player' | shipId }, sectionBroken { id: 'player' | shipId, section },
//   mastFell { id, x, z }, fireStarted { id, x, z, cause }, fireOut { id, doused }, magazineExploded { id, x, z },
//   shipFlooded { id } (she filled and sank)
//
// Ship modules (Modules.js; slots per hull in Boats.js `slots`):
//   naval.fitting               the Fitting (tiers owned, the fit of every hull); naval.mods = fitting.stats() of this hull
//   naval.moduleRows( state? ) -> [ { id, label, desc, price, owned, fitted, canBuy, canFit, tier, maxTier, next, slot, kind,
//                               effect, reason } ]   for Captain Roid's yard
//   naval.moduleSlots() -> [ { index, kind, label, module, moduleLabel } ]
//   naval.buyModule( id ) -> { ok, tier, price, reason }   (features.state pays; sandbox free); fits it into a free slot
//   naval.fitModule( id, slot? ) / naval.removeModule( id ) -> bool
//   naval.holdBonus()           cargo crate multiplier (extra hold; the trade feature multiplies its capacity by it)
//   naval.fishHoldBonus()       fish hold (kg) multiplier (fish well)
//   naval.biteBonus()           bite-rate multiplier now: the lantern rig at night while aboard or beside the boat; else 1
//   naval.nightBiteBonus        the fitted lantern's multiplier (1 without one), whatever the hour
//   naval.sightRange()          how far pirates show on the HUD (the spyglass)
//   Effects run through playerHull.max (plating hpMul), damagePlayer (taken), speedFactor (x speed^2: thrust for top
//   speed), the player's guns (damage, reach, reload) and playerGun (the swivel gun's tier is the gun level).
//
// Pirates and spawning:
//   naval.spawn( classId, opts ) -> Ship    public: the pirates package spawns named captains through it. classId 'trawler' |
//                               'sloop' | 'brigantine'; opts { id, x, z, y, yaw, speed, hp, name, captain, state, route: [ [ x, z ] ],
//                               loop, index, dir }. Set ship.fleeAt / ship.dmgMul / ship.maxHp afterwards to tune a captain.
//   Pirates hunt the nearest legal player boat they can see: the local one (naval.target) or, on the room's host, another
//   player's (app.remotePlayers peers with a driven boat outside the harbour / cove). Their balls are broadcast by
//   NavalLink and hurt the boat they land on, on its owner's machine.
//   naval.remoteShot( from [ x, y, z ], dir [ x, y, z ], speed, info { owner, damage, faction, big } )   a ball from another machine
//   naval.launchFrom( x, y, z, dir { x, y, z }, opts { owner, damage, faction, big, sigma } ) -> ball | null   a ball fired here
//                               from a world point (Blackwater's shore batteries): the normal flow (_launch: cannonFired by
//                               'pirate', broadcast by NavalLink, impacts and damage like a ship's gun)
//
// Events emitted on the Features registry: shipSunk { id, name, faction, x, z, byPlayer, kind, loot },
// enemyDefeated { id, name, kind: 'pirate' } (pirate sunk by the player), playerBoatDamaged { hp, maxHp, cause },
// playerBoatSunk { cause }, lootCollected { value, x, z, source } (the last is naval's own),
// cannonFired { x, y, z, dir: { x, y, z }, side, by: 'player' | 'pirate' | 'remote', owner } (every gun, remote ones too),
// cannonballImpact { x, y, z, vx, vy, vz, energy (J), hit: 'water' | 'ship' | 'land' | 'prop', target, owner }
// (target: a ship id, 'player', a prop id or null), moduleBought { id, tier, price }, moduleFitted { id, slot },
// moduleRemoved { id }. With features.get( 'vfx' ) installed it draws the shots, impacts and sinkings from these events and
// naval's own Effects.js spawns are skipped (Effects.js is the fallback without it).
//
// Hooks the app provides (all optional): app.scene, app.camera, app.terrainData, app.query (WaterQuery), app.spray,
// app.audio (SoundScape), app.boatCtl (position, quaternion, velocity, driven, moored), app.player.mode ('boat' at the helm),
// app.game.state (boat id, earn, spend), app.game.toast, app.cameraFeel.kick, app.settings.timeOfDay, features.get( 'weather' ).

import { BOATS } from '../../game/Boats.js';
import { MUZZLE_REACH } from '../../world/boat/ShipDecks.js';
import { SHIP_CLASSES, PIRATE_CAPTAINS, PIRATE_SHIPS, MERCHANT_SHIPS, lootValue } from './ShipClasses.js';
import { Ship, SINK_TIME, sinkPose } from './Ship.js';
import { Wrecks, salvageCostFor } from './Wrecks.js';
import { strip, empty } from '../death/Belongings.js';
import { think, RAM, AVOID } from './Brains.js';
import { MERCHANT_ROUTE, PATROLS, inSafeZone, makeCursor, nearestIndex } from './Routes.js';
import { leadAim, solveElevation, quatBox, rotateByQuat, MUZZLE_SPEED } from './Ballistics.js';
import { Projectiles } from './Projectiles.js';
import { Effects } from './Effects.js';
import { Loot } from './Loot.js';
import { NavalAudio } from './NavalAudio.js';
import { WaterPool } from './WaterPool.js';
import { ModelSet } from './Models.js';
import { NavalHud, hudModel, ARROW_RANGE, NO_GUN_TEXT } from './Hud.js';
import { CollisionWorld, predictContact, yawInertia } from './Collisions.js';
import { ShipLights } from './ShipLights.js';
import { Planks } from './Planks.js';
import { lookAim } from './AimAssist.js';
import { AIM_CAM, easeAimCam, aimRig } from './AimCamera.js';
import { RULES as BOARDING_RULES } from '../boarding/BoardingData.js';
import { Fitting, SLOT_LABELS, moduleLabel } from './Modules.js';
import { ModuleMeshes } from './ModuleModels.js';
import { clamp, makeRng, normaliseSide, sideSign, angleDiff, DEG } from './util.js';
import { Magazine, ammoMaxFor, buyShot, shotQuote, POWDER_KEG, OUT_OF_SHOT } from './Ammo.js';
import { sectionsFor, pickSection, aimPoint, aimHeight, HULL_SHARE, SECTION_LABELS, MAST_STATIONS, AIM_PARTS } from './Sections.js';
import { Fire, FIRE, headwindOver, aiDouseTime } from './Fire.js';
import { Flood, FLOOD } from './Flood.js';
import { MastFall, MastVisual, hideMast } from './MastFall.js';
import { G } from '../../core/Globals.js';

// swivel gun by level: damage per ball, reload (s), one-sigma spread (rad), traverse half arc (rad)
export const GUN_LEVELS = [
	null,
	{ damage: 20, reload: 4.0, spread: 0.024, traverse: 24 * DEG },
	{ damage: 28, reload: 3.4, spread: 0.018, traverse: 24 * DEG },
	{ damage: 38, reload: 2.8, spread: 0.012, traverse: 26 * DEG },
];

export const REPAIR_PER_HP = 2; // coins
export const SECTION_REPAIR_PER_HP = 1.5; // coins per section point (rigging, rudder, guns)
export const MAST_COST = 150; // coins to step a new mast
export const GUN_RANGE = 320; // m, auto-aim reach of the player's gun
export const BALL_MASS = 2.5; // kg (cannonballImpact energy = 0.5 m v^2)
const LANTERN_REACH = 12; // m: fishing this close to the boat counts as fishing under its lantern
const MAX_SHIPS = 8;
const PARK_Y = - 400; // where a wrecked boat's (hidden) model and controller wait, out of every query and view
const ABOARD = [ 'boat', 'deck', 'seat' ];
// a pirate below this hull fraction is crippled: she strikes (boarding), stops shooting and can be boarded
export const CRIPPLE = BOARDING_RULES.cripple ?? 0.25;
// ships in these states come alongside on purpose (a grapple, a boarding): they bump without damage
const GENTLE = new Set( [ 'close', 'grapple', 'boarding', 'boarded', 'moored' ] );
export const NO_GUN = NO_GUN_TEXT;
const byDist = ( a, b ) => a.dist - b.dist;
const byFar = ( a, b ) => b.dist - a.dist;
// wave 16C: the states a ship may sleep in (setShipCap), and how many frames between a sleeper's steps (~4 Hz)
const SLEEPY = new Set( [ 'patrol', 'sail', 'moored' ] );
const SLEEP_EVERY = 15;
const isCrippled = ( s ) => s.faction === 'pirate' && s.hpFraction < CRIPPLE;

// quaternion product a * b ( [ x, y, z, w ] )
function qmul( a, b ) {

	return [
		a[ 3 ] * b[ 0 ] + a[ 0 ] * b[ 3 ] + a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ],
		a[ 3 ] * b[ 1 ] - a[ 0 ] * b[ 2 ] + a[ 1 ] * b[ 3 ] + a[ 2 ] * b[ 0 ],
		a[ 3 ] * b[ 2 ] + a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ] + a[ 2 ] * b[ 3 ],
		a[ 3 ] * b[ 3 ] - a[ 0 ] * b[ 0 ] - a[ 1 ] * b[ 1 ] - a[ 2 ] * b[ 2 ],
	];

}

// hull points of the player's boat by class: the catalog's `hp` (the ships: trawler 520, sloop 420, brigantine 760), else from
// the mass: skiff 69 ... lobster boat 264
export function hullMaxFor( boatId ) {

	const b = BOATS[ boatId ];
	if ( b && Number.isFinite( b.hp ) ) return Math.round( b.hp );
	return Math.round( 40 + 0.07 * ( b ? b.mass : 640 ) );

}

// extra reload per additional gun of a broadside: a battery of n guns reloads in base * ( 1 + SALVO_RELOAD * ( n - 1 ) )
export const SALVO_RELOAD = 0.12;
// seconds between the guns of a ripple
const RIPPLE = [ 0.08, 0.17 ];

// The player's gun record. `owned` is the swivel gun bought at the yard (and fitted in an arms slot) OR the battery a ship
// comes with (builtIn); writing owned = true / false sets the purchase only (and fits / unships the swivel), so selling
// the ship leaves the bought gun as it was. `level` is the swivel gun's tier (`swivel`), or on a ship the battery's level
// when that is higher; writing it sets the swivel's tier.
function makeGun( mounted = () => true, onBuy = null, free = () => false ) {

	const g = { swivel: 1, battery: 0, guns: 1, builtIn: false, bought: false };
	Object.defineProperty( g, 'owned', {
		// (the sandbox always has a swivel gun: free() )
		get() { return this.builtIn || ( this.bought && mounted() ) || !! free(); },
		set( v ) {

			this.bought = !! v;
			if ( onBuy ) onBuy( this.bought );

		},
		enumerable: true,
	} );
	Object.defineProperty( g, 'level', {
		get() { return this.builtIn ? Math.max( this.battery, this.swivel ) : this.swivel; },
		set( v ) { this.swivel = clamp( Math.round( v ) || 1, 1, 3 ); },
		enumerable: true,
	} );
	return g;

}

export class Naval {

	constructor( app, features, opts = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.opts = opts;
		this.rng = makeRng( opts.seed ?? ( ( Date.now() ^ 0x5eed ) & 0x7fffffff ) );
		this.enabled = opts.enabled ?? true;
		this.settings = Object.assign( { autoSpawn: true, merchants: 2, maxPirates: 3, drawRange: 600, queryRange: 250, shadowRange: 220 }, opts.settings );
		this.time = 0;
		this.ships = [];
		this.shipCap = Infinity; // wave 16C: ships awake at once (setShipCap); the farthest idle ones past it sleep
		this._asleep = 0;
		this._sleepT = 0;
		this._sleepTick = 0;
		this._sleepSeq = 0;
		this.shots = []; // volleys waiting for their turn: { t, ship, st }
		this.playerHull = { hp: 0, max: 0, sunk: false, boat: null };
		// ship modules: the swivel gun's tier lives in the gun record (hook), everything else in the fitting
		this.fitting = new Fitting( { hooks: { swivel: {
			get: () => ( this.playerGun.bought ? this.playerGun.swivel : 0 ),
			set: ( t ) => {

				if ( t > 0 ) {

					this.playerGun.bought = true;
					this.playerGun.swivel = clamp( t, 1, 3 );

				} else this.playerGun.bought = false;

			},
		} } } );
		this._mods = null;
		this._modsKey = '';
		this.playerGun = makeGun(
			() => ! this.fitting.boat || this.fitting.isFitted( 'swivel' ),
			( bought ) => {

				if ( bought ) this.fitting.fit( 'swivel' );
				else this.fitting.remove( 'swivel' );

			},
			() => !! ( this.features && this.features.sandbox ),
		);
		this.playerShots = []; // the rest of a ripple: { t, side, index, plan, target }
		this.reloadLeft = { port: 0, starboard: 0 };
		this.stats = { shipsSunk: 0, piratesSunk: 0, shots: 0, hits: 0, looted: 0 };
		this.target = { x: 0, y: 0, z: 0, vx: 0, vz: 0, ok: false, safe: false };
		this.world = { time: 0, night: false, storm: false, target: this.target, rng: this.rng, terrain: null, fire: ( s, side ) => this._shipFire( s, side ), escape: ( s ) => this._escape( s ) };
		this.keys = { port: false, starboard: false, aimPart: false };
		this._nextId = 1;
		this._spawnT = 0.5;
		this._pirateAt = 6;
		this._merchantRespawn = [];
		this._initialMerchants = true;
		this._wasActive = false;
		this._hintT = 0;
		this._frame = 0;
		this._pbox = null;
		this._pboxFrame = - 1;
		this._fp = {};
		this._m = { x: 0, y: 0, z: 0 };
		this._ctx = null;
		this._targets = []; // legal player boats this frame: naval.target and the remote ones
		this._remote = new Map(); // peer id -> target record (with a velocity estimate)

		const app2 = this.app;
		this.terrain = app2.terrainData || null;
		this.world.terrain = this.terrain;
		this.scene = app2.scene || null;
		this.models = opts.models === false ? null : ( opts.models || ( this.scene ? new ModelSet( { scene: this.scene } ) : null ) );
		this.pool = new WaterPool( app2.query || null, { ships: opts.poolShips ?? 3 } );
		this.balls = new Projectiles( { scene: this.scene } );
		this.fx = new Effects( { scene: this.scene, spray: app2.spray || null } );
		this.loot = new Loot( { scene: this.scene } );
		this.audio = new NavalAudio( app2 );
		this.hud = opts.hud === false ? null : new NavalHud( { doc: opts.doc || ( typeof document !== 'undefined' ? document : null ) } );
		this.modMeshes = opts.moduleMeshes === false || ! this.scene ? null : ( opts.moduleMeshes || new ModuleMeshes() );
		this.wrecks = new Wrecks( { app: app2, features, scene: this.scene, makeModel: opts.wreckModel || null } );
		this.sinking = null;
		this.planks = new Planks( { scene: this.scene } );
		this.collisions = new CollisionWorld();
		this.shipLights = new ShipLights( this, { ships: 3 } ); // lanterns on the nearest ships (features' lights[] -> the scene's local lights)
		this.lights = this.shipLights.sources;
		this.contacts = []; // this frame's hull contacts (Collisions.js records)
		this.aiming = false;
		this.aimInfo = null; // lookAim() while aiming
		this._lmbPrev = false;
		this._rmbPrev = false;
		this._noGunUntil = - 1;
		this._creakT = 0;
		this._avoidT = 0;
		this.crippleAt = CRIPPLE;
		this.hudTarget = null; // id of the pirate whose hull bar shows (the last one the player hit, while in range)
		// wave 10: the third-person aim rig (AimCamera.js) and the crew's guns
		this.aimCam = { blend: 0, shoulder: 1, side: 'port' };
		this._aimFovBase = null;
		this.reloadTotal = { port: 0, starboard: 0 };
		this.crewShots = 0;
		// wave 11A: the player's powder and shot, sections, fire and flooding (set per hull class in _syncBoat)
		this.ammo = new Magazine( 0 );
		this.sections = sectionsFor( 'lobster', 100 );
		this.fireState = new Fire();
		this.floodState = new Flood();
		this.aimPart = 'hull';
		this.falls = []; // falling masts: { fall, vis, ship | null, foot }
		this._outOfShotUntil = - 1;
		this._dryHintT = - 1;
		this._silentHintT = - 1;
		this._channel = null; // the deck job in hand: { kind: 'douse' | 'pump', t }
		this._burnAcc = 0;
		this._smokeT = 0;
		this._floodWarned = false;
		this._rudderBase = new WeakMap(); // controller -> its own rudderLift
		this._settle = 0;
		this._settleY = 0;
		this._mastHidden = null; // the player's mast meshes hidden (fallen), restored by the yard
		if ( this.hud && ! this.hud.root ) this.hud = null;

		if ( this.features && this.features.claimKey ) {

			this.keys.port = this.features.claimKey( 'KeyZ', 'naval' );
			this.keys.starboard = this.features.claimKey( 'KeyX', 'naval' );
			this.keys.aimPart = this.features.claimKey( 'Tab', 'naval' ); // (while aiming: hull / sails / rudder)

		}

		// bounty contracts: the notices feature announces them, the named captain's ship is spawned in the region
		this.bounties = new Map(); // id -> { id, target, captain, ship, tier, region, state: 'open' }
		this._offs = [];
		if ( this.features && this.features.on ) {

			this._offs.push( this.features.on( 'bountyAccepted', ( e ) => this._onBounty( e ) ) );
			this._offs.push( this.features.on( 'bountyCancelled', ( e ) => this._onBountyCancelled( e ) ) );

		}

		// the deck jobs (E on deck): a bucket at the rail for a fire, the pump while she is making water
		if ( this.features && typeof this.features.interactable === 'function' ) {

			this._offs.push( this.features.interactable( {
				id: 'naval-douse', radius: 3.6, position: () => this._railPoint(), prompt: () => 'Douse the fire',
				when: () => this._onDeck() && this.fireState.burning && ! this._channel, onInteract: () => this.douse(),
			} ) );
			this._offs.push( this.features.interactable( {
				id: 'naval-pump', radius: 14, position: () => this._deckPoint(), prompt: () => `Man the pump · ${ Math.round( this.floodState.level * 100 ) } % water`,
				when: () => this._onDeck() && this.floodState.level > 0.005 && ! this._channel, onInteract: () => this.pump( true ),
			} ) );

		}

		this._syncBoat( true );

		// the helm camera (Player.updateBoat, third person) reads the aim rig through this hook
		const pl = app2.player;
		if ( pl && typeof pl === 'object' && ! pl.aimCamera ) {

			this._aimHook = ( o ) => this.aimCamera( o );
			pl.aimCamera = this._aimHook;

		}

	}

	// ------------------------------------------------------------------ state

	get active() {

		return this.enabled && ! ( this.features && this.features.mode === 'multiplayer' );

	}

	// thrust multiplier: a holed hull is slower; the drive module's speed x needs speed^2 of thrust (quadratic drag)
	get speedFactor() {

		const h = this.playerHull;
		if ( h.sunk ) return 0;
		const f = h.max > 0 ? h.hp / h.max : 1;
		const sp = this.mods.speed;
		// torn sails / a wrecked engine and the water in her cut the top speed (thrust ~ speed^2)
		const dc = this.sections.speedMul * this.floodState.speedMul;
		return ( f >= 0.5 ? 1 : 0.35 + 0.65 * ( f / 0.5 ) ) * sp * sp * dc * dc;

	}

	// the helm: 1, 0.5 with the rudder below 40 %, 0 with it shot away (BoatController.rudderLift x this)
	get turnFactor() {

		return this.playerHull.sunk ? 0 : this.sections.turnMul;

	}

	get flood() {

		return this.floodState.level;

	}

	// the effects of the modules fitted on the current hull (Fitting.stats, cached per change)
	get mods() {

		// (read many times a frame: compared field by field, no key string built per read)
		const f = this.fitting, sw = this.playerGun.bought ? this.playerGun.swivel : 0, k = this._modsK || ( this._modsK = { boat: undefined, version: undefined, sw: undefined } );
		if ( ! this._mods || k.boat !== f.boat || k.version !== f.version || k.sw !== sw ) {

			this._mods = f.stats();
			k.boat = f.boat;
			k.version = f.version;
			k.sw = sw;
			this._modsKey = `${ f.boat }|${ f.version }|${ sw }`;

		}

		return this._mods;

	}

	get pirates() {

		return this.ships.filter( ( s ) => s.faction === 'pirate' );

	}

	get merchants() {

		return this.ships.filter( ( s ) => s.faction === 'merchant' );

	}

	// seconds to reload the player's broadside: the gun level's reload, longer with every extra gun of the battery
	reloadTime( level = this.playerGun.level ) {

		return GUN_LEVELS[ clamp( Math.round( level ) || 1, 1, 3 ) ].reload * ( 1 + SALVO_RELOAD * ( Math.max( 1, this.playerGun.guns ) - 1 ) ) * this.mods.reload;

	}

	get night() {

		const h = this.app.settings ? this.app.settings.timeOfDay : null;
		return typeof h === 'number' && ( h >= 20 || h < 5.5 );

	}

	get storm() {

		const w = this.features && this.features.get ? this.features.get( 'weather' ) : null;
		const kind = w && ( ( w.current && w.current.kind ) || w.kind );
		return kind === 'storm';

	}

	// pirates the sea holds right now: one by day, one more at night, one more in a storm
	wantedPirates() {

		return Math.min( this.settings.maxPirates, 1 + ( this.night ? 1 : 0 ) + ( this.storm ? 1 : 0 ) );

	}

	_boatId() {

		const g = this.app.game;
		return ( g && g.state && g.state.boat ) || this.app.boatId || 'lobster';

	}

	// the gun record follows the boat class: a ship carries its own battery, a small boat the (bought) swivel gun
	_syncGun( id ) {

		const g = this.playerGun, spec = BOATS[ id ];
		const bat = spec && spec.broadside ? spec.broadside : null;
		g.builtIn = !! bat;
		g.guns = bat ? bat.z.length : 1;
		g.battery = bat ? bat.level || 1 : 0;

	}

	// hull points of a class with the fitted plating
	_hullMax( id ) {

		return Math.round( hullMaxFor( id ) * ( this.fitting.boat === id ? this.mods.hpMul : 1 ) );

	}

	// the fit changed (plating bought or unshipped): the maximum follows, the damage taken stays
	_syncMods() {

		const h = this.playerHull;
		if ( ! h.boat ) return;
		const max = this._hullMax( h.boat );
		if ( max === h.max ) return;
		const d = max - h.max;
		h.max = max;
		h.hp = h.sunk ? Math.min( h.hp, max ) : clamp( h.hp + Math.max( 0, d ), 0.1, max );
		this.sections.rescale( max );

	}

	// the hull of the current boat class (a new boat arrives undamaged; a restored save keeps its damage)
	_syncBoat( force = false ) {

		const id = this._boatId();
		const h = this.playerHull;
		if ( id !== this._gunBoat || force ) {

			this._gunBoat = id;
			this._syncGun( id );

		}

		this.fitting.setBoat( id );
		if ( id === h.boat && ! force ) return;
		const first = h.boat === null;
		// traded away while she lay on the bottom: no salvage any more (her hold stays for a diver)
		const w = this.wrecks && this.wrecks.own;
		if ( ! first && w && w.boat !== id ) this.wrecks.abandon();
		h.boat = id;
		h.max = this._hullMax( id );
		if ( first ) {

			if ( ! ( h.hp > 0 ) && ! h.sunk ) h.hp = h.max;
			h.hp = Math.min( h.hp, h.max );

		} else {

			h.hp = h.max;
			h.sunk = false;

		}

		this._newHullSystems( id );

	}

	// a new hull: her own sections, a full magazine (her first load comes with her), no fire, dry bilges
	_newHullSystems( id ) {

		this.sections = sectionsFor( id, this.playerHull.max );
		this.ammo.setMax( ammoMaxFor( id ), { fill: true } );
		if ( this.fireState.burning ) this._fireOut( null, false, true );
		this.fireState.extinguish();
		this.floodState.drain();
		this._channel = null;
		this._restoreMast();

	}

	// size of the player's boat for hit tests and muzzle positions
	_dims() {

		const id = this.playerHull.boat;
		const b = BOATS[ id ] || BOATS.lobster;
		const m = this.app.boat && this.app.boat.dimensions;
		const length = ( m && m.length ) || b.length, beam = ( m && m.beam ) || b.beam, draft = ( m && m.draft ) || b.draft;
		const free = ( m && m.freeboard ) || b.freeboard;
		const top = b.kind === 'ship' ? b.deckY + 2.5 : free + ( b.drive === 'wheel' ? 1.6 : 0.5 );
		return { length, beam, draft, free, top, deck: b.deckY ?? 0.3 };

	}

	_playerBox() {

		if ( this._pboxFrame === this._frame ) return this._pbox;
		this._pboxFrame = this._frame;
		const b = this.app.boatCtl;
		if ( this.playerHull.sunk || ! b || ! b.position || ! b.quaternion ) return ( this._pbox = null );
		const d = this._dims();
		const cy = ( d.top - d.draft ) / 2;
		const off = rotateByQuat( b.quaternion, { x: 0, y: cy, z: 0 } );
		this._pbox = quatBox( { x: b.position.x + off.x, y: b.position.y + off.y, z: b.position.z + off.z }, b.quaternion, [ d.beam / 2 + 0.15, ( d.top + d.draft ) / 2, d.length / 2 + 0.1 ] );
		return this._pbox;

	}

	_refreshTarget() {

		const b = this.app.boatCtl, t = this.target;
		if ( ! b || ! b.position ) {

			t.ok = false;
			return;

		}

		t.x = b.position.x;
		t.y = b.position.y;
		t.z = b.position.z;
		t.vx = b.velocity ? b.velocity.x : 0;
		t.vz = b.velocity ? b.velocity.z : 0;
		t.safe = !! inSafeZone( t.x, t.z );
		t.mass = b.mass || ( BOATS[ this.playerHull.boat ] || BOATS.lobster ).mass; // (a heavier pirate rams)
		// a legal target: afloat, under way (or at least not tied up), and outside the harbour / cove
		t.ok = ! this.playerHull.sunk && ( !! b.driven || ! b.moored ) && ! t.safe;

	}

	_camPos() {

		const c = this.app.camera;
		return c && c.position ? c.position : ( this.app.boatCtl && this.app.boatCtl.position ) || null;

	}

	_say( text, ms = 2600 ) {

		const g = this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	// ------------------------------------------------------------------ ships

	spawn( kind, o = {} ) {

		const cls = SHIP_CLASSES[ kind ];
		if ( ! cls ) throw new Error( 'naval.spawn: unknown class ' + kind );
		const rng = this.rng;
		const id = o.id || `${ kind }-${ this._nextId ++ }`;
		const pirate = cls.faction === 'pirate';
		const ship = new Ship( kind, {
			id, x: o.x ?? 0, z: o.z ?? 0, yaw: o.yaw ?? 0, speed: o.speed, hp: o.hp,
			name: o.name || ( pirate ? rng.pick( PIRATE_SHIPS ) : rng.pick( MERCHANT_SHIPS ) ),
			captain: o.captain || ( pirate ? rng.pick( PIRATE_CAPTAINS ) : null ),
			state: o.state,
		} );
		if ( o.route ) ship.cursor = makeCursor( o.route, { loop: !! o.loop, index: o.index ?? 0, dir: o.dir ?? 1 } );
		ship.want = ship.yaw;
		ship.pose.y = ship.pose.ty = o.y ?? 0;
		this.ships.push( ship );
		return ship;

	}

	// wave 16C: at most n ships think and sail every frame (Infinity, the default: all of them). Past the cap the farthest
	// ships with no business with anyone (patrolling, on a lane or moored; no bounty, hunt, raid, rescue, prize or remote
	// puppet), beyond the draw range so nobody sees it, sleep: they think and sail ~4 times a second with the time they
	// missed, so the sea stays where it would have been. Quality sets it (Low 8, phones 6).
	setShipCap( n ) {

		this.shipCap = n > 0 ? n : Infinity;

	}

	_pickSleepers() {

		const list = this._sleepList || ( this._sleepList = [] );
		list.length = 0;
		const far = this.settings.drawRange;
		for ( const s of this.ships ) {

			if ( s.alive && s.dist > far && ! s.puppet && ! s.bounty && ! s.rescuing && ! s.hunt && ! s.raid && ! s.taken && SLEEPY.has( s.state ) ) list.push( s );
			else if ( s._sleep ) s._sleep = false;

		}

		let k = this.ships.length - this.shipCap; // how many must sleep
		if ( k > 1 ) list.sort( byFar );
		this._asleep = 0;
		for ( const s of list ) {

			const sleep = k > 0;
			k --;
			if ( sleep && ! s._sleep ) {

				s._sleepDt = 0;
				s._sleepK = ( this._sleepSeq = ( this._sleepSeq + 1 ) % SLEEP_EVERY );

			}

			s._sleep = sleep;
			if ( sleep ) this._asleep ++;

		}

	}

	_spawnMerchant( end ) {

		const n = MERCHANT_ROUTE.length;
		const first = end ? n - 1 : 0, next = end ? n - 2 : 1;
		const a = MERCHANT_ROUTE[ first ], b = MERCHANT_ROUTE[ next ];
		return this.spawn( 'trawler', {
			x: a[ 0 ], z: a[ 1 ], yaw: Math.atan2( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ),
			route: MERCHANT_ROUTE, index: next, dir: end ? - 1 : 1, speed: 0,
		} );

	}

	// a pirate at the patrol waypoint farthest from the player (and at least 300 m away: no pop-in)
	spawnPirate( kind = null ) {

		const cam = this._camPos();
		let best = null, bd = - 1;
		for ( let r = 0; r < PATROLS.length; r ++ ) {

			PATROLS[ r ].forEach( ( p, i ) => {

				const d = cam ? Math.hypot( p[ 0 ] - cam.x, p[ 1 ] - cam.z ) : 1e6;
				const taken = this.ships.some( ( s ) => s.alive && s.faction === 'pirate' && Math.hypot( s.x - p[ 0 ], s.z - p[ 1 ] ) < 120 );
				if ( d > bd && ! taken ) { bd = d; best = { r, i, p }; }

			} );

		}

		if ( ! best || bd < 300 ) return null;
		if ( ! kind ) {

			const bri = this.ships.some( ( s ) => s.kind === 'brigantine' && s.alive );
			kind = ! bri && ( this.wantedPirates() >= 3 ? this.rng() < 0.75 : this.night && this.rng() < 0.25 ) ? 'brigantine' : 'sloop';

		}

		const pts = PATROLS[ best.r ];
		const nxt = ( best.i + 1 ) % pts.length;
		return this.spawn( kind, {
			x: best.p[ 0 ], z: best.p[ 1 ], yaw: Math.atan2( pts[ nxt ][ 0 ] - best.p[ 0 ], pts[ nxt ][ 1 ] - best.p[ 1 ] ),
			route: pts, loop: true, index: nxt, speed: SHIP_CLASSES[ kind ].speed * 0.6,
		} );

	}

	// ------------------------------------------------------------------ bounties

	_onBounty( e ) {

		if ( ! e || typeof e !== 'object' || e.id === undefined || ! e.region ) return;
		const id = String( e.id );
		const old = this.bounties.get( id );
		const b = {
			id, target: String( e.target || e.captain || id ), captain: String( e.captain || e.target || id ),
			ship: String( e.ship || 'Black Gull' ), tier: clamp( Math.round( e.tier ) || 1, 1, 3 ),
			region: { x: +e.region.x || 0, z: +e.region.z || 0 },
		};
		this.bounties.set( id, b );
		// a resumed contract (after a load) whose target is still afloat is left alone
		if ( old && this._bountyShip( id ) ) return;
		if ( this.active ) this._spawnBounty( b );

	}

	_onBountyCancelled( e ) {

		if ( ! e || e.id === undefined ) return;
		const id = String( e.id );
		this.bounties.delete( id );
		const s = this._bountyShip( id );
		if ( s ) s.state = 'gone'; // the target is released: he sails off

	}

	_bountyShip( id ) {

		return this.ships.find( ( s ) => s.bounty && s.bounty.id === id && s.alive ) || null;

	}

	// deep open water near (x, z): the contract's region is only a "last known" spot and may sit on a shoal
	_deepWaterNear( x, z ) {

		const T = this.terrain;
		if ( ! T ) return { x, z };
		const deep = ( px, pz ) => T.heightAt( px, pz ) < - 6 && ! inSafeZone( px, pz )
			&& [ [ 25, 0 ], [ - 25, 0 ], [ 0, 25 ], [ 0, - 25 ] ].every( ( o ) => T.heightAt( px + o[ 0 ], pz + o[ 1 ] ) < - 4 );
		for ( let r = 0; r <= 600; r += 30 ) {

			const n = r === 0 ? 1 : Math.max( 8, Math.round( r / 12 ) );
			for ( let i = 0; i < n; i ++ ) {

				const a = ( i / n ) * Math.PI * 2;
				const px = x + Math.sin( a ) * r, pz = z + Math.cos( a ) * r;
				if ( deep( px, pz ) ) return { x: px, z: pz };

			}

		}

		// nothing close: the nearest patrol waypoint
		let best = PATROLS[ 0 ][ 0 ], bd = Infinity;
		for ( const r of PATROLS ) for ( const p of r ) {

			const d = Math.hypot( p[ 0 ] - x, p[ 1 ] - z );
			if ( d < bd ) { bd = d; best = p; }

		}

		return { x: best[ 0 ], z: best[ 1 ] };

	}

	// the named pirate: tier 1 a sloop, tier 2 a tougher sloop, tier 3 a brigantine; he patrols a loop round the region,
	// never flees, and is not part of the ambient pirate count
	_spawnBounty( b ) {

		if ( this._bountyShip( b.id ) ) return null;
		const p = this._deepWaterNear( b.region.x, b.region.z );
		const kind = b.tier >= 3 ? 'brigantine' : 'sloop';
		// a loop of waypoints 80 m round the spot (those that are deep water); with fewer than two, the nearest patrol lane
		const T = this.terrain;
		let pts = [ 0, 1, 2, 3 ].map( ( i ) => [ p.x + Math.sin( i * Math.PI / 2 ) * 80, p.z + Math.cos( i * Math.PI / 2 ) * 80 ] )
			.filter( ( q ) => ! T || ( T.heightAt( q[ 0 ], q[ 1 ] ) < - 5 && ! inSafeZone( q[ 0 ], q[ 1 ] ) ) );
		let idx = 0;
		if ( pts.length < 2 ) {

			let bd = Infinity;
			for ( const r of PATROLS ) {

				const q = r[ nearestIndex( r, p.x, p.z ) ];
				const d = Math.hypot( q[ 0 ] - p.x, q[ 1 ] - p.z );
				if ( d < bd ) { bd = d; pts = r; }

			}

			idx = nearestIndex( pts, p.x, p.z );

		}

		const nxt = ( idx + 1 ) % pts.length;
		const s = this.spawn( kind, {
			x: p.x, z: p.z, yaw: Math.atan2( pts[ nxt ][ 0 ] - p.x, pts[ nxt ][ 1 ] - p.z ),
			name: b.ship, captain: b.captain, route: pts, loop: true, index: nxt, speed: SHIP_CLASSES[ kind ].speed * 0.5,
		} );
		s.bounty = b;
		s.fleeAt = 0; // a named captain fights to the end
		s.dmgMul = b.tier === 2 ? 1.2 : 1;
		s.maxHp = Math.round( s.maxHp * ( b.tier === 2 ? 1.5 : b.tier === 1 ? 1.1 : 1.15 ) );
		s.hp = s.maxHp;
		return s;

	}

	// a contract whose ship is not afloat (not spawned yet, or the world was cleared) gets one
	_manageBounties() {

		for ( const b of this.bounties.values() ) if ( ! this._bountyShip( b.id ) ) this._spawnBounty( b );

	}

	_manage( dt ) {

		this._spawnT -= dt;
		if ( this._spawnT > 0 ) return;
		const step = 2;
		this._spawnT = step;
		const cfg = this.settings;
		this._manageBounties();
		if ( this.ships.length >= MAX_SHIPS ) return;

		// merchants: the first pair sail at once, a sunk one is replaced after four minutes
		const merchants = this.ships.filter( ( s ) => s.faction === 'merchant' && s.alive ).length;
		if ( this._initialMerchants ) {

			this._initialMerchants = false;
			for ( let i = merchants; i < cfg.merchants; i ++ ) this._spawnMerchant( i % 2 === 1 );

		} else {

			for ( let i = this._merchantRespawn.length - 1; i >= 0; i -- ) {

				this._merchantRespawn[ i ] -= step;
				if ( this._merchantRespawn[ i ] <= 0 && merchants + 1 <= cfg.merchants ) {

					this._merchantRespawn.splice( i, 1 );
					this._spawnMerchant( this.rng() < 0.5 );

				}

			}

		}

		// pirates
		const wanted = this.wantedPirates();
		const pirates = this.ships.filter( ( s ) => s.faction === 'pirate' && s.alive && ! s.bounty );
		if ( pirates.length < wanted && this.time >= this._pirateAt ) {

			if ( this.spawnPirate() ) this._pirateAt = this.time + 20;

		} else if ( pirates.length > wanted ) {

			// the surplus (day broke, the storm passed) slips away once nobody can see it
			const cam = this._camPos();
			const s = pirates.find( ( p ) => p.state === 'patrol' && ( ! cam || Math.hypot( p.x - cam.x, p.z - cam.z ) > 800 ) );
			if ( s ) s.state = 'gone';

		}

	}

	_escape( s ) {

		if ( s.bounty ) {

			s.setState( 'patrol' ); // a contract target never leaves the sea
			return;

		}

		s.escaped = true;
		s.state = 'gone';
		this._pirateAt = Math.max( this._pirateAt, this.time + 45 );

	}

	// think + sail every ship, then dress them
	_sail( dt ) {

		const w = this.world;
		w.time = this.time;
		w.night = this.night;
		w.storm = this.storm;
		const cam = this._camPos();
		const amp = w.storm ? 2.2 : 1;
		const near = this._near || ( this._near = [] ); // (one list for the life of the feature)
		near.length = 0;
		// wave 16C: the awake cap (setShipCap): the sleepers are re-picked 4 times a second and step on their own frame
		if ( this.shipCap < Infinity || this._asleep ) {

			this._sleepT -= dt;
			if ( this._sleepT <= 0 ) {

				this._sleepT = 0.25;
				this._pickSleepers();

			}

		}

		const tick = this._sleepTick = ( this._sleepTick + 1 ) % SLEEP_EVERY;
		for ( const s of this.ships ) {

			if ( s._sleep ) {

				// asleep: the time she missed in one step, every SLEEP_EVERY frames (the sleepers on different frames)
				s._sleepDt += dt;
				if ( s._sleepK === tick ) {

					w.target = this._targetFor( s );
					think( s, w, s._sleepDt );
					s.integrate( s._sleepDt, this.terrain );
					s._sleepDt = 0;

				}

			} else {

				w.target = s.puppet ? this.target : this._targetFor( s );
				think( s, w, dt );
				s.integrate( dt, this.terrain );

			}

			s.dist = cam ? Math.hypot( s.x - cam.x, s.z - cam.z ) : 0;
			if ( s.state !== 'gone' && s.dist < this.settings.queryRange ) near.push( s );

		}

		if ( near.length > 1 ) near.sort( byDist );
		this.pool.assign( near );

		const night = this.night ? 1 : 0;
		if ( this.models ) this.models.setNight( night );
		for ( let i = this.ships.length - 1; i >= 0; i -- ) {

			const s = this.ships[ i ];
			if ( s.state === 'gone' ) {

				this._removeShip( i );
				continue;

			}

			if ( s.dist > this.settings.drawRange ) {

				s._far = true;
				if ( s.visual ) s.visual.setVisible( false );
				continue;

			}

			const have = this.pool.ready && s.poolGroup >= 0 && this.pool.read( s );
			if ( ! have ) this.pool.procedural( s, this.time, amp );
			if ( s._far ) {

				s.pose.y = s.pose.ty;
				s.pose.pitch = s.pose.tpitch;
				s.pose.roll = s.pose.troll;
				s._far = false;

			}

			if ( this.pool.ready && s.poolGroup >= 0 ) this.pool.queue( s );
			s.updatePose( dt );
			s.near = s.dist < this.settings.shadowRange;

			if ( ! s.visual && this.models ) s.visual = this.models.create( s.kind );
			if ( s.visual ) {

				s.visual.apply( s, s.finalPose( this._fp ) );
				s.visual.setNear( s.near );
				s.visual.setVisible( true );

			}

			// past half her points a hull smokes (and lists: Ship.finalPose); under 35 % the vfx feature burns her itself
			if ( s.alive && s.hpFraction < 0.5 ) {

				s._smokeT = ( s._smokeT ?? 0 ) - dt;
				if ( s._smokeT <= 0 ) {

					s._smokeT = 0.7;
					const p = s.toWorld( 0, s.cls.deck + 1.5, - s.cls.length * 0.15, this._m );
					const v = this._vfx( 'smoke' );
					if ( ! v ) this.fx.smoke( p.x, p.y, p.z, 1 );
					else if ( s.hpFraction >= 0.35 ) v.smoke( p.x, p.y, p.z, 0.7 );

				}

			}

		}

	}

	_removeShip( i ) {

		const s = this.ships[ i ];
		if ( s.fire.burning || s._fireVfx ) this._fireOut( s, false, true );
		for ( let k = this.falls.length - 1; k >= 0; k -- ) {

			const f = this.falls[ k ];
			if ( f.ship !== s ) continue;
			if ( f.vis ) f.vis.dispose();
			this.falls.splice( k, 1 );

		}

		this.pool.release( s );
		if ( s.visual ) {

			s.visual.dispose();
			s.visual = null;

		}

		this.ships.splice( i, 1 );

	}

	// ------------------------------------------------------------------ targets

	// the legal player boats: ours (naval.target) and, unless we only mirror the host's ships, the other players'
	_gatherTargets( dt ) {

		const list = this._targets;
		list.length = 0;
		if ( this.target.ok ) list.push( this.target );
		const rp = this.app.remotePlayers, seen = new Set();
		if ( rp && rp.peers && typeof rp.peers.forEach === 'function' && this.netRole !== 'puppet' ) {

			rp.peers.forEach( ( p, id ) => {

				if ( ! p || ! p.boat || ! p.boatPos || ! p.hasPose ) return;
				seen.add( id );
				let t = this._remote.get( id );
				if ( ! t ) {

					t = { x: p.boatPos.x, y: p.boatPos.y, z: p.boatPos.z, vx: 0, vz: 0, ok: false, safe: false, remote: id, mass: ( BOATS[ p.boat ] && BOATS[ p.boat ].mass ) || 3200 };
					this._remote.set( id, t );

				}

				const jx = p.boatPos.x - t.x, jz = p.boatPos.z - t.z;
				if ( dt > 0 && Math.hypot( jx, jz ) < 40 * dt + 2 ) {

					// a smoothed velocity from the interpolated pose (the snapshots carry none); a jump (a respawn, a
					// teleport) resets it instead of aiming the guns a mile ahead
					const k = 1 - Math.exp( - dt * 3 );
					t.vx = clamp( t.vx + ( jx / dt - t.vx ) * k, - 30, 30 );
					t.vz = clamp( t.vz + ( jz / dt - t.vz ) * k, - 30, 30 );

				} else t.vx = t.vz = 0;

				t.x = p.boatPos.x;
				t.y = p.boatPos.y;
				t.z = p.boatPos.z;
				t.safe = !! inSafeZone( t.x, t.z );
				const st = p.boatState || null;
				t.ok = ! t.safe && !! ( st ? st.driven || Math.hypot( t.vx, t.vz ) > 0.8 : false );
				if ( t.ok ) list.push( t );

			} );

		}

		for ( const id of this._remote.keys() ) if ( ! seen.has( id ) ) this._remote.delete( id );

	}

	// the boat ship `s` goes for: the nearest legal one in reach (her current quarry while it is not much farther than the
	// nearest), else the local target (not ok: the brains then patrol / sail on)
	_targetFor( s ) {

		const list = this._targets;
		if ( ! list.length ) return ( s.tgt = this.target );
		const c = s.cls;
		const reach = Math.max( c.lose || 0, c.sight || 0, 300 );
		let best = null, bd = Infinity, cur = Infinity;
		for ( const t of list ) {

			const d = Math.hypot( t.x - s.x, t.z - s.z );
			if ( d > reach ) continue;
			if ( d < bd ) { bd = d; best = t; }
			if ( t === s.tgt ) cur = d;

		}

		if ( s.tgt && s.tgt.ok && cur < Infinity && cur < bd * 1.3 + 20 ) best = s.tgt;
		return ( s.tgt = best || this.target );

	}

	// ------------------------------------------------------------------ cannons

	// a pirate asks to fire one broadside ( called from the brain when the side is loaded )
	_shipFire( ship, side ) {

		const t = ship.tgt || this.target, c = ship.cls;
		if ( ! t.ok || ! c.guns || ship.reload[ side ] > 0 || ! ship.alive || isCrippled( ship ) ) return false; // (crippled: her guns are silent)
		if ( ship.ammo.rounds <= 0 || ! ship.sections.gunsOk( side ) ) return false; // dry, or that battery shot to pieces
		const range = Math.hypot( t.x - ship.x, t.z - ship.z );
		if ( range > c.engage * 1.35 || range < 20 ) return false;
		// the target must lie within the traverse of this side's guns
		const rel = angleDiff( Math.atan2( t.x - ship.x, t.z - ship.z ), ship.yaw );
		const az = Math.abs( angleDiff( rel, sideSign( side ) * Math.PI / 2 ) );
		if ( az > c.traverse ) return false;
		ship.reload[ side ] = c.reload * this.rng.range( 0.9, 1.2 );
		let delay = this.rng.range( 0, 0.25 );
		for ( const st of ship.gunStations( side ) ) {

			this.shots.push( { t: delay, ship, st } );
			delay += this.rng.range( 0.12, 0.35 );

		}

		return true;

	}

	_updateShots( dt ) {

		for ( let i = this.shots.length - 1; i >= 0; i -- ) {

			const sh = this.shots[ i ];
			sh.t -= dt;
			if ( sh.t > 0 ) continue;
			this.shots.splice( i, 1 );
			this._fireShipGun( sh.ship, sh.st );

		}

	}

	_fireShipGun( s, st ) {

		const t = s.tgt || this.target;
		if ( ! s.alive || ! t.ok || isCrippled( s ) || ! s.sections.gunsOk( st.side ) ) return;
		// every gun fired spends a round of her own stock
		if ( s.ammo.spend( 1 ) < 1 ) return;
		if ( s.ammo.rounds <= 0 ) this._emit( 'outOfShot', { by: s.id } );
		const m = s.toWorld( st.x, st.y, st.z, { x: 0, y: 0, z: 0 } );
		// the brains' choice (Brains AIM_PREF): his sails while he runs, else the hull
		const ty = s.mem && s.mem.aim === 'sails' ? this._sailHeightOf( t ) : 0.9;
		const aim = leadAim( m, s.velocity( {} ), { x: t.x, y: t.y + ty, z: t.z }, { x: t.vx, y: 0, z: t.vz }, MUZZLE_SPEED );
		if ( ! aim ) return;
		// the traverse limit of the carriage
		const sg = sideSign( st.side ), nx = Math.cos( s.yaw ) * sg, nz = - Math.sin( s.yaw ) * sg;
		const hz = Math.hypot( aim.dir.x, aim.dir.z ) || 1;
		const az = Math.acos( clamp( ( aim.dir.x * nx + aim.dir.z * nz ) / hz, - 1, 1 ) );
		if ( az > s.cls.traverse * 1.2 ) return;
		const range = Math.hypot( t.x - m.x, t.z - m.z );
		const sigma = s.cls.shot * ( 0.7 + range / 120 ) * ( 1 + Math.abs( s.yawRate ) * 3 );
		this._launch( m, aim.dir, sigma, { damage: s.cls.damage * ( s.dmgMul || 1 ), owner: s.id, faction: s.faction, vel: s.velocity( {} ), big: s.kind === 'brigantine', side: st.side } );

	}

	// how high a pirate lays his guns to cut a boat's canvas: our own boat's rig (its hit box), another player's a guess
	_sailHeightOf( t ) {

		if ( t === this.target ) return Math.max( 1.2, this._dims().top * 0.8 );
		return 2.5;

	}

	// spawn a ball from `m` along `dir` with gaussian spread (sigma, rad); returns the ball
	_launch( m, dir, sigma, { damage, owner, faction, vel, big = false, level = 1, side = null, crew = null } ) {

		const r = this.rng;
		// two perpendiculars: horizontal and the other one up-ish
		let ux = - dir.z, uz = dir.x;
		const ul = Math.hypot( ux, uz ) || 1;
		ux /= ul; uz /= ul;
		const vx = dir.y * - dir.x, vy = dir.x * dir.x + dir.z * dir.z, vz = dir.y * - dir.z;
		const vl = Math.hypot( vx, vy, vz ) || 1;
		const g1 = r.gauss() * sigma, g2 = r.gauss() * sigma * 0.6;
		let dx = dir.x + ux * g1 + ( vx / vl ) * g2, dy = dir.y + ( vy / vl ) * g2, dz = dir.z + uz * g1 + ( vz / vl ) * g2;
		const l = Math.hypot( dx, dy, dz );
		dx /= l; dy /= l; dz /= l;
		const speed = MUZZLE_SPEED * ( 1 + r.gauss() * 0.012 );
		this.stats.shots += owner === 'player' ? 1 : 0;
		this._muzzle( m.x, m.y, m.z, dx, dy, dz, big );
		this.audio.cannon( m.x, m.y, m.z, owner === 'player' ? 0.9 : 0.8 );
		const ev = { x: m.x, y: m.y, z: m.z, dir: { x: dx, y: dy, z: dz }, side, by: owner === 'player' ? 'player' : 'pirate', owner };
		if ( crew ) ev.crew = crew;
		this._emit( 'cannonFired', ev );
		return this.balls.spawn( {
			x: m.x, y: m.y, z: m.z,
			vx: dx * speed + ( vel ? vel.x : 0 ), vy: dy * speed + ( vel ? vel.y : 0 ), vz: dz * speed + ( vel ? vel.z : 0 ),
			damage, owner, faction, level, big, // (big: a brigantine's gun - its hits can start a fire)
		} );

	}

	// the vfx feature when it is installed: it draws from cannonFired / cannonballImpact / shipSunk, so naval's own
	// Effects.js spawns are only the fallback without it (else every shot draws twice). With `name`: only if it has it.
	_vfx( name = null ) {

		const f = this.features, v = f && f.get ? f.get( 'vfx' ) : null;
		return v && ( ! name || typeof v[ name ] === 'function' ) ? v : null;

	}

	_emit( name, e ) {

		const f = this.features;
		if ( f && f.emit ) f.emit( name, e );

	}

	_muzzle( x, y, z, dx, dy, dz, big ) {

		if ( ! this._vfx() ) this.fx.muzzle( x, y, z, dx, dy, dz, big ); // (vfx: from the cannonFired event)

	}

	// A ball fired on this machine from a world point, not a ship (a shore battery): the same flow as a ship's gun, so every
	// client sees it (NavalLink hooks _launch) and it is not tagged by: 'remote'. The caller has already aimed and spread
	// it (opts.sigma adds more, default none).
	launchFrom( x, y, z, dir, opts = {} ) {

		if ( ! dir || ! [ x, y, z, dir.x, dir.y, dir.z ].every( Number.isFinite ) ) return null;
		const l = Math.hypot( dir.x, dir.y, dir.z );
		if ( ! ( l > 1e-6 ) ) return null;
		const owner = typeof opts.owner === 'string' && opts.owner !== 'player' ? opts.owner : 'battery';
		return this._launch( { x, y, z }, { x: dir.x / l, y: dir.y / l, z: dir.z / l }, Math.max( 0, + opts.sigma || 0 ), {
			damage: Math.max( 0, Math.min( 60, + opts.damage || 0 ) ), owner, faction: opts.faction || 'pirate', big: !! opts.big,
		} );

	}

	// A ball fired on another machine (NavalLink): drawn and flown here, never re-broadcast. info.damage > 0 (a ship's
	// gun) lets it hurt this boat; a player's ball (damage 0) only splashes and splinters.
	remoteShot( from, dir, speed, info = {} ) {

		if ( ! Array.isArray( from ) || ! Array.isArray( dir ) ) return null;
		const [ x, y, z ] = from.map( Number ), [ dx, dy, dz ] = dir.map( Number );
		if ( ! [ x, y, z, dx, dy, dz ].every( Number.isFinite ) ) return null;
		const v = Number.isFinite( speed ) && speed > 1 ? speed : MUZZLE_SPEED;
		const owner = info.owner || 'remote';
		this._muzzle( x, y, z, dx, dy, dz, !! info.big );
		this.audio.cannon( x, y, z, 0.8 );
		this._emit( 'cannonFired', { x, y, z, dir: { x: dx, y: dy, z: dz }, side: null, by: 'remote', owner } );
		return this.balls.spawn( {
			x, y, z, vx: dx * v, vy: dy * v, vz: dz * v,
			damage: Math.max( 0, Math.min( 60, + info.damage || 0 ) ), owner, faction: info.faction || 'pirate', level: 1,
		} );

	}

	// The player's broadside: 'port' (Z) or 'starboard' (X). Aims at the best ship inside the gun's arc (auto-aim),
	// else fires level with a little elevation. With { aimed: true } (or while aiming that side by hand) the guns fire
	// along naval.aimInfo instead (the camera look, AimAssist.lookAim). A swivel gun fires one ball at once; a ship's battery fires one ball
	// per gun along its side, the first now and the rest in a short ripple (bow to stern). Returns true when the
	// broadside is on its way (a ball left the first muzzle).
	fire( side, { aimed = false } = {} ) {

		const sd = normaliseSide( side );
		if ( ! sd ) return false;
		const b = this.app.boatCtl;
		if ( ! this.active || ! b || ! b.position || ! b.quaternion ) return false;
		const gun = this.playerGun;
		if ( ! gun.owned ) {

			this._noGun();
			return false;

		}

		if ( this.playerHull.sunk || this.reloadLeft[ sd ] > 0 ) return false;
		// that battery shot to pieces, or no powder and shot left (a keg in the hold is broken out first)
		if ( ! this.sections.gunsOk( sd ) ) {

			this._silenced( sd );
			return false;

		}

		if ( this.ammo.rounds <= 0 && ! this.usePowderKeg() ) {

			this._outOfShot();
			return false;

		}

		const plan = this._gunPlan( sd );
		const L = plan.L;
		// aimed by hand: every gun of the side along the look (no auto target)
		const ai = this.aimInfo;
		if ( ( aimed || this.aiming ) && ai && ai.side === sd ) {

			this.reloadLeft[ sd ] = this.reloadTotal[ sd ] = this.reloadTime( gun.level );
			const dir = { ...ai.dir };
			this._fireMount( sd, plan, 0, null, dir );
			let t = 0;
			for ( let i = 1; i < plan.mounts.length; i ++ ) {

				t += this.rng.range( RIPPLE[ 0 ], RIPPLE[ 1 ] );
				this.playerShots.push( { t, side: sd, index: i, plan, target: null, dir } );

			}

			return true;

		}

		// target selection: a pirate (else any ship within 150 m) inside the arc, nearest first, from the middle of the battery
		const m = this._muzzleWorld( plan.mounts[ Math.floor( ( plan.mounts.length - 1 ) / 2 ) ], b, this._m );
		const normal = rotateByQuat( b.quaternion, { x: plan.sg, y: 0, z: 0 } );
		let best = null, bs = Infinity;
		for ( const s of this.ships ) {

			if ( ! s.alive ) continue;
			const dx = s.x - m.x, dz = s.z - m.z, range = Math.hypot( dx, dz );
			if ( range < 15 || range > GUN_RANGE * this.mods.range || ( s.faction !== 'pirate' && range > 150 ) ) continue;
			const nl = Math.hypot( normal.x, normal.z ) || 1;
			const az = Math.acos( clamp( ( dx * normal.x + dz * normal.z ) / ( range * nl ), - 1, 1 ) );
			if ( az > L.traverse ) continue;
			const score = range + ( s.faction === 'pirate' ? 0 : 200 );
			if ( score < bs ) { bs = score; best = s; }

		}

		this.reloadLeft[ sd ] = this.reloadTotal[ sd ] = this.reloadTime( gun.level );
		this._fireMount( sd, plan, 0, best );
		if ( plan.mounts.length > 1 ) {

			// the ripple: later guns go off a moment apart, bow first
			let t = 0;
			for ( let i = 1; i < plan.mounts.length; i ++ ) {

				t += this.rng.range( RIPPLE[ 0 ], RIPPLE[ 1 ] );
				this.playerShots.push( { t, side: sd, index: i, plan, target: best } );

			}

		}

		// (the recoil kick comes from CameraFeel's own cannonFired listener)
		return true;

	}

	// The guns of the player's boat on one side: { sg, L (gun level record), mounts [ { x, y, z } muzzle in the boat frame ],
	// big }. A ship uses the catalog's battery (Boats.js broadside, ordered bow to stern); every other boat one swivel gun
	// 12 % of the length forward of amidships, just outside the beam.
	_gunPlan( sd ) {

		const sg = sideSign( sd );
		const L = GUN_LEVELS[ clamp( Math.round( this.playerGun.level ) || 1, 1, 3 ) ];
		const spec = BOATS[ this.playerHull.boat ] || BOATS.lobster;
		if ( spec.broadside ) {

			const bat = spec.broadside;
			const zs = [ ...bat.z ].sort( ( a, c ) => c - a );
			return { sg, L, big: spec.shipClass === 'brigantine', mounts: zs.map( ( z ) => ( { x: sg * ( bat.x + MUZZLE_REACH ), y: spec.deckY + ( bat.y ?? 1.2 ), z } ) ) };

		}

		const d = this._dims();
		return { sg, L, big: false, mounts: [ { x: sg * ( d.beam / 2 + 0.05 ), y: d.deck + 0.55, z: d.length * 0.12 } ] };

	}

	_muzzleWorld( mount, b, out ) {

		const off = rotateByQuat( b.quaternion, mount );
		out.x = b.position.x + off.x;
		out.y = b.position.y + off.y;
		out.z = b.position.z + off.z;
		return out;

	}

	// one gun of a broadside: along `aimDir` (aimed by hand), else at `target` if it is still in the arc, else level for
	// ~90 m; recoil along the beam. opt { spreadMul, crew }: a crew gunner's shot (wider, named on cannonFired)
	_fireMount( sd, plan, index, target, aimDir = null, opt = null ) {

		const b = this.app.boatCtl;
		if ( ! b || ! b.position || ! b.quaternion ) return;
		// one round a gun: a ripple that runs the magazine dry ends in a click
		if ( this.ammo.spend( 1 ) < 1 ) {

			this._outOfShot( true );
			return;

		}

		const m = this._muzzleWorld( plan.mounts[ index ], b, { x: 0, y: 0, z: 0 } );
		const normal = rotateByQuat( b.quaternion, { x: plan.sg, y: 0, z: 0 } );
		const bvel = b.velocity ? { x: b.velocity.x, y: b.velocity.y, z: b.velocity.z } : { x: 0, y: 0, z: 0 };
		const nl = Math.hypot( normal.x, normal.z ) || 1;

		let dir = aimDir;
		if ( ! dir && target && target.alive ) {

			// laid on the part the skipper picked (Tab while aiming); a crew gunner always goes for the hull
			const aim = leadAim( m, bvel, aimPoint( target, opt && opt.crew ? 'hull' : this.aimPart, {} ), target.velocity( {} ), MUZZLE_SPEED );
			if ( aim ) {

				const hz = Math.hypot( aim.dir.x, aim.dir.z ) || 1;
				const az = Math.acos( clamp( ( aim.dir.x * normal.x + aim.dir.z * normal.z ) / ( hz * nl ), - 1, 1 ) );
				if ( az <= plan.L.traverse * 1.5 ) dir = aim.dir;

			}

		}

		if ( ! dir ) {

			const el = solveElevation( MUZZLE_SPEED, 90 * this.mods.range, - m.y ) ?? 0.03;
			dir = { x: normal.x / nl * Math.cos( el ), y: Math.sin( el ), z: normal.z / nl * Math.cos( el ) };

		}

		const spread = plan.L.spread * ( opt && opt.spreadMul > 0 ? opt.spreadMul : 1 );
		this._launch( m, dir, spread, { damage: plan.L.damage * this.mods.dmg, owner: 'player', faction: 'player', vel: bvel, level: this.playerGun.level, big: plan.big, side: sd, crew: opt ? opt.crew : null } );
		// recoil along the beam: a 2.5 kg ball at 120 m/s, shared by the boat's mass
		const mass = ( BOATS[ this.playerHull.boat ] || BOATS.lobster ).mass;
		const dv = clamp( 300 / mass, 0, 0.9 );
		if ( b.velocity && b.velocity.x !== undefined ) {

			b.velocity.x -= normal.x * dv;
			b.velocity.z -= normal.z * dv;

		}

	}

	_updatePlayerShots( dt ) {

		for ( let i = this.playerShots.length - 1; i >= 0; i -- ) {

			const sh = this.playerShots[ i ];
			sh.t -= dt;
			if ( sh.t > 0 ) continue;
			this.playerShots.splice( i, 1 );
			if ( this.playerHull.sunk ) continue;
			// a hand-aimed ripple follows the look while the side is still aimed
			const dir = sh.dir ? ( this.aiming && this.aimInfo && this.aimInfo.side === sh.side ? this.aimInfo.dir : sh.dir ) : null;
			this._fireMount( sh.side, sh.plan, sh.index, sh.target, dir, sh.opt || null );

		}

	}

	_readKeys() {

		const inp = this.app.input, p = this.app.player;
		if ( ! inp || ! inp.hit || ! p || p.mode !== 'boat' ) return;
		if ( this.keys.port && inp.hit( 'KeyZ' ) ) this.fire( 'port' );
		if ( this.keys.starboard && inp.hit( 'KeyX' ) ) this.fire( 'starboard' );

	}

	// the guns click: no powder and shot. "Out of shot" in the naval HUD for a few seconds, a toast at most every 8 s
	_outOfShot( quiet = false ) {

		this._outOfShotUntil = this.time + 4;
		const b = this.app.boatCtl;
		if ( b && b.position ) this.audio.click( b.position.x, b.position.y + 1, b.position.z );
		if ( quiet || this.time < this._dryHintT ) return;
		this._dryHintT = this.time + 8;
		this._say( `${ OUT_OF_SHOT } · Captain Roid sells powder and shot` );
		this._emit( 'outOfShot', { by: 'player' } );

	}

	_silenced( sd ) {

		if ( this.time < this._silentHintT ) return;
		this._silentHintT = this.time + 6;
		this._say( `The ${ sd === 'port' ? 'port' : 'starboard' } guns are out of action · the yard can repair them` );

	}

	// a 'powder' keg out of the trade hold: +POWDER_KEG rounds (only when there is room and a keg). Returns the rounds added.
	usePowderKeg() {

		const tr = this.features && this.features.get ? this.features.get( 'trade' ) : null;
		if ( ! tr || typeof tr.takeCargo !== 'function' || this.ammo.room <= 0 ) return 0;
		const c = tr.cargo && tr.cargo.powder;
		if ( ! c || ! ( c.qty > 0 ) ) return 0;
		const r = tr.takeCargo( 'powder', 1 );
		if ( ! r || ! ( r.qty >= 1 ) ) return 0;
		const added = this.ammo.add( POWDER_KEG );
		this._say( `Broke out a keg of powder: +${ added } rounds` );
		return added;

	}

	shotQuote() {

		return shotQuote( this.ammo );

	}

	// the yard's "Powder and shot x12" (free in the sandbox)
	buyShot( { free = false } = {} ) {

		const st = this.features ? this.features.state : null;
		const r = buyShot( this.ammo, { state: st, free: free || !! ( this.features && this.features.sandbox ) } );
		if ( r.ok ) this._emit( 'shotBought', { rounds: r.added, price: r.price } );
		return r;

	}

	// Tab while aiming: hull -> sails -> rudder
	cycleAimPart() {

		const i = AIM_PARTS.indexOf( this.aimPart );
		this.aimPart = AIM_PARTS[ ( i + 1 ) % AIM_PARTS.length ];
		return this.aimPart;

	}

	// no gun to fire: a short tip (toast + a few seconds in the naval HUD), at most every 10 s
	_noGun() {

		this._noGunUntil = this.time + 4;
		if ( this.time > this._hintT ) {

			this._hintT = this.time + 10;
			this._say( NO_GUN );

		}

	}

	// Direct aiming at the helm: while the right mouse button (or the touch layer's input.aimHeld) is held, the guns follow
	// the camera look (aimInfo: side, bearing inside the traverse, the range under the look, the elevation for it) and the
	// left button fires that side. Not while the rod is out (its buttons are the rod's) or a panel has the mouse.
	_updateAim() {

		const app = this.app, inp = app.input, p = app.player, b = app.boatCtl, cam = app.camera, f = this.features;
		const held = !! ( inp && ( inp.rightDown || inp.aimHeld ) );
		const lmb = !! ( inp && inp.mouseDown );
		const edgeR = held && ! this._rmbPrev, edgeL = lmb && ! this._lmbPrev;
		this._rmbPrev = held;
		this._lmbPrev = lmb;
		let can = held && !! p && p.mode === 'boat' && inp.enabled !== false && ! this.playerHull.sunk && ! this.sinking
			&& !! b && !! b.position && !! b.quaternion && !! cam && !! cam.position && !! cam.quaternion;
		if ( can && f && ( ( f.panelOpen && f.panelOpen() ) || ( f.wantsMouse && f.wantsMouse() ) ) ) can = false;
		const rod = app.game && app.game.rod;
		if ( can && rod && rod.equipped ) can = false;
		// a boarding fight has the buttons (the right one is the guard there)
		const bo = f && f.get ? f.get( 'boarding' ) : null;
		if ( can && bo && ( ( bo.phase && bo.phase !== 'idle' ) || ( bo.hostile && bo.hostile.phase && bo.hostile.phase !== 'idle' ) ) ) can = false;
		// a drawn hand weapon (the firearms feature) owns the buttons too
		const fa = f && f.get ? f.get( 'firearms' ) : null;
		if ( can && fa && fa.drawn ) can = false;
		if ( can && ! this.playerGun.owned ) {

			if ( edgeR || edgeL ) this._noGun();
			can = false;

		}

		this.aiming = can;
		if ( ! can ) {

			this.aimInfo = null;
			return;

		}

		const look = rotateByQuat( cam.quaternion, { x: 0, y: 0, z: - 1 } );
		const L = GUN_LEVELS[ clamp( Math.round( this.playerGun.level ) || 1, 1, 3 ) ];
		this.aimInfo = lookAim( look, cam.position, ( side ) => {

			const plan = this._gunPlan( side );
			const m = this._muzzleWorld( plan.mounts[ Math.floor( ( plan.mounts.length - 1 ) / 2 ) ], b, { x: 0, y: 0, z: 0 } );
			const n = rotateByQuat( b.quaternion, { x: plan.sg, y: 0, z: 0 } ), nl = Math.hypot( n.x, n.z ) || 1;
			return { m, n: { x: n.x / nl, z: n.z / nl } };

		}, { traverse: L.traverse, maxRange: GUN_RANGE * this.mods.range, minRange: 20, speed: MUZZLE_SPEED, pitchMap: this._thirdPerson() } );
		if ( this.keys.aimPart && inp.hit && inp.hit( 'Tab' ) ) this.cycleAimPart();
		this._aimForPart( this.aimInfo );
		if ( edgeL ) this.fire( this.aimInfo.side, { aimed: true } );

	}

	// the elevation for the aimed part's height at the look's range (lookAim lays for the waterline: the hull)
	_aimForPart( ai ) {

		ai.part = this.aimPart;
		if ( this.aimPart === 'hull' ) return;
		const el = solveElevation( MUZZLE_SPEED, ai.range, aimHeight( this.aimPart, { sheer: 3.3, top: 12 } ) - ai.from.y );
		if ( el === null || el === undefined || ! Number.isFinite( el ) ) return;
		const hl = Math.hypot( ai.dir.x, ai.dir.z ) || 1, ce = Math.cos( el );
		ai.dir = { x: ai.dir.x / hl * ce, y: Math.sin( el ), z: ai.dir.z / hl * ce };
		ai.el = el;

	}

	// at the helm in the chase view (Player.camMode 'third'): the over-the-shoulder rig and pitch ranging apply
	_thirdPerson() {

		const p = this.app.player;
		return !! p && p.mode === 'boat' && p.camMode === 'third';

	}

	// The aim rig for the helm camera (AimCamera.aimRig): null in first person and while the rig is fully eased out.
	// dist: the chase arm's length now; fov: the field to narrow (the result's fov), if the caller wants it absolute.
	aimCamera( { dist = 13, fov = null } = {} ) {

		if ( ! this._thirdPerson() ) return null;
		const ai = this.aiming ? this.aimInfo : null;
		return aimRig( this.aimCam, { dist, fov, pitch: ai ? ai.pitch : 0, az: ai ? ai.az : 0 } );

	}

	// eases the rig in / out (0.25 s) and narrows the fov with it
	_updateAimCam( dt ) {

		const third = this._thirdPerson();
		easeAimCam( this.aimCam, { aiming: this.aiming && third, side: this.aimInfo ? this.aimInfo.side : null }, dt );
		this._aimFov( third ? this.aimCam.blend : 0 );

	}

	// the rig's narrower field, on top of what the camera feel set this frame (it runs before the features; the firearms' zoom
	// works the same way), handed back to the slider's value on release
	_aimFov( blend ) {

		const cam = this.app.camera;
		if ( ! cam || ! Number.isFinite( cam.fov ) ) return;
		const cf = this.app.cameraFeel, ui = this.app.ui;
		const kick = cf && Number.isFinite( cf.fovKick ) ? cf.fovKick : 0;
		const slider = ui && ui.s && Number.isFinite( ui.s.fov ) ? ui.s.fov : null;
		const b = Math.max( 0, Math.min( 1, blend ) );
		const d = AIM_CAM.fov * b * b * ( 3 - 2 * b );
		if ( d !== 0 ) {

			if ( this._aimFovBase === null ) this._aimFovBase = slider ?? ( cf && cf.baseFov ? cf.baseFov() : cam.fov - kick );
			cam.fov = ( slider ?? this._aimFovBase ) + kick + d;
			if ( typeof cam.updateProjectionMatrix === 'function' ) cam.updateProjectionMatrix();

		} else if ( this._aimFovBase !== null ) {

			cam.fov = ( slider ?? this._aimFovBase ) + kick;
			if ( typeof cam.updateProjectionMatrix === 'function' ) cam.updateProjectionMatrix();
			this._aimFovBase = null;

		}

	}

	// ------------------------------------------------------------------ the crew's guns (src/features/crew)

	// what a gunner would fire at from `side`: a pirate afloat, neither crippled nor struck (she is the boarding prize), not
	// alongside on purpose (a grapple, a boarding), inside the gun's reach and swing, nearest first; nothing while either of us
	// is in the peaceful waters
	crewTarget( side ) {

		const sd = normaliseSide( side ), b = this.app.boatCtl;
		if ( ! sd || ! b || ! b.position || ! b.quaternion ) return null;
		if ( inSafeZone( b.position.x, b.position.z ) ) return null;
		const plan = this._gunPlan( sd );
		const m = this._muzzleWorld( plan.mounts[ Math.floor( ( plan.mounts.length - 1 ) / 2 ) ], b, { x: 0, y: 0, z: 0 } );
		const n = rotateByQuat( b.quaternion, { x: plan.sg, y: 0, z: 0 } ), nl = Math.hypot( n.x, n.z ) || 1;
		const reach = GUN_RANGE * this.mods.range;
		let best = null, bd = Infinity;
		for ( const s of this.ships ) {

			if ( ! s.alive || s.faction !== 'pirate' || isCrippled( s ) || s.boarding || GENTLE.has( s.state ) ) continue;
			if ( inSafeZone( s.x, s.z ) ) continue;
			const dx = s.x - m.x, dz = s.z - m.z, r = Math.hypot( dx, dz );
			if ( r < 15 || r > reach ) continue;
			if ( Math.acos( clamp( ( dx * n.x + dz * n.z ) / ( r * nl ), - 1, 1 ) ) > plan.L.traverse ) continue;
			if ( r < bd ) { bd = r; best = s; }

		}

		return best;

	}

	// a crew gunner fires `side` at crewTarget( side ) through the player's own fire path (the same muzzles, balls, hits, loot
	// and bounties), with a longer reload and a wider spread; returns the target or null (no gun, reloading, the skipper
	// aiming that side by hand, nothing legal to shoot)
	crewFire( side, { reloadMul = 1.6, spreadMul = 1.5, crew = null } = {} ) {

		const sd = normaliseSide( side ), b = this.app.boatCtl;
		if ( ! sd || ! this.active || ! b || ! b.position || ! b.quaternion ) return null;
		if ( ! this.playerGun.owned || this.playerHull.sunk || this.sinking || this.reloadLeft[ sd ] > 0 ) return null;
		if ( this.aiming && this.aimInfo && this.aimInfo.side === sd ) return null;
		// the gunners work the same stock: dry (no keg to break out), or the side shot away, they stand by
		if ( ! this.sections.gunsOk( sd ) || ( this.ammo.rounds <= 0 && ! this.usePowderKeg() ) ) return null;
		const target = this.crewTarget( sd );
		if ( ! target ) return null;
		const plan = this._gunPlan( sd );
		this.reloadLeft[ sd ] = this.reloadTotal[ sd ] = this.reloadTime( this.playerGun.level ) * reloadMul;
		const opt = { spreadMul, crew };
		this._fireMount( sd, plan, 0, target, null, opt );
		let t = 0;
		for ( let i = 1; i < plan.mounts.length; i ++ ) {

			t += this.rng.range( RIPPLE[ 0 ], RIPPLE[ 1 ] );
			this.playerShots.push( { t, side: sd, index: i, plan, target, opt } );

		}

		this.crewShots ++;
		return target;

	}

	// ------------------------------------------------------------------ hits

	_updateBalls( dt ) {

		if ( ! this.balls.count ) return;
		if ( ! this._ctx ) {

			this._ctx = {
				ships: this.ships,
				playerBox: () => this._playerBox(),
				waterHeight: () => 0,
				terrain: this.terrain,
				raycastProps: null,
				onShipHit: ( ball, ship, part, pt ) => {

					this._impact( ball, pt, 'ship', ship.id );
					this._shipHit( ball, ship, part, pt );

				},
				onPlayerHit: ( ball, pt ) => {

					this._impact( ball, pt, 'ship', 'player' );
					this._playerHit( ball, pt );

				},
				onWater: ( ball, pt ) => {

					this._impact( ball, pt, 'water', null );
					this._waterHit( ball, pt );

				},
				onLand: ( ball, pt ) => {

					this._impact( ball, pt, 'land', null );
					if ( ! this._vfx() ) this.fx.smoke( pt.x, pt.y + 0.3, pt.z, 0.9 );

				},
				onProp: ( ball, pt, hit ) => {

					this._impact( ball, pt, 'prop', hit.id ?? null );
					if ( ! this._vfx() ) this.fx.hit( pt.x, pt.y, pt.z );
					this.audio.impact( pt.x, pt.y, pt.z, 0.8 );

				},
			};

		}

		this._ctx.ships = this.ships;
		this._ctx.terrain = this.terrain;
		// destructible props (the destruction feature) stop balls too
		const de = this.features && this.features.get ? this.features.get( 'destruction' ) : null;
		// (wave 21C) and Meridian's buildings: the nearer of the two
		const cw = this.features && this.features.get ? this.features.get( 'citywreck' ) : null;
		const rays = [ de, cw ].filter( ( f ) => f && typeof f.raycastSegment === 'function' );
		this._ctx.raycastProps = rays.length
			? ( a, b ) => {

				let best = null;
				for ( const f of rays ) {

					let h = null;
					try { h = f.raycastSegment( a.x, a.y, a.z, b.x, b.y, b.z ); } catch ( e ) { h = null; }
					if ( h && ( ! best || h.t < best.t ) ) best = h;

				}

				return best;

			}
			: null;
		this.balls.update( dt, this._ctx );

	}

	// every ball's end: the cannonballImpact event (destruction and vfx listen)
	_impact( ball, pt, hit, target ) {

		const v2 = ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz;
		this._emit( 'cannonballImpact', {
			x: pt.x, y: pt.y, z: pt.z, vx: ball.vx, vy: ball.vy, vz: ball.vz, energy: Math.round( 0.5 * BALL_MASS * v2 ),
			hit, target, owner: ball.owner,
		} );
	}

	_falloff( ball ) {

		const reach = 400 * ( ball.owner === 'player' ? this.mods.range : 1 ); // long guns keep their punch farther
		return 1 - 0.4 * clamp( ball.travelled / reach, 0, 1 );

	}

	_shipHit( ball, ship, part, pt ) {

		const byPlayer = ball.owner === 'player';
		const dmg = ball.damage * this._falloff( ball );
		// the section the ball struck (Sections.pickSection: above the sheer guns / mast / sails, below the hull or the rudder)
		const local = this._shipLocal( ship, pt );
		const sec = pickSection( local, this._shipGeo( ship ), this.rng );
		const sunk = ship.damage( dmg, { part: sec, by: byPlayer ? 'player' : ball.owner } );
		const lh = ship.lastHit;
		if ( ! sunk && lh ) {

			if ( lh.broke ) this._emit( 'sectionBroken', { id: ship.id, section: lh.part } );
			if ( lh.mastFell ) this._shipMastFell( ship, local );

		}

		// a brigantine's big guns can set her alight
		if ( ball.big && ship.alive && this.rng() < FIRE.bigChance ) this._igniteShip( ship, local, 'cannon' );
		if ( ! this._vfx() ) this.fx.hit( pt.x, pt.y, pt.z );
		this.audio.impact( pt.x, pt.y, pt.z, 0.9 );
		if ( byPlayer ) {

			this.stats.hits ++;
			this.hudTarget = ship.id;
			if ( this.hud ) this.hud.hitMarker( sunk ? 'sunk' : 'hit' );

		}

		if ( sunk ) this._onSunk( ship, byPlayer );

	}

	// a world point in ship s's frame (the inverse of Ship.toWorld)
	_shipLocal( s, p ) {

		const dx = p.x - s.x, dz = p.z - s.z, sn = Math.sin( s.yaw ), cs = Math.cos( s.yaw );
		return { x: dx * cs - dz * sn, y: p.y - s.pose.y, z: dx * sn + dz * cs };

	}

	_shipGeo( s ) {

		const c = s.cls, sec = s.sections;
		return { length: c.length, beam: c.beam, sheer: c.sheer, guns: sec.has( 'gunsPort' ), mast: sec.has( 'mast' ) && ! sec.mastDown, masts: MAST_STATIONS[ s.kind ], propulsion: sec.layout.propulsion };

	}

	// a world point in the player's boat frame (null without a boat)
	_playerLocal( p ) {

		const b = this.app.boatCtl;
		if ( ! b || ! b.position || ! b.quaternion ) return null;
		const q = b.quaternion;
		return rotateByQuat( { x: - q.x, y: - q.y, z: - q.z, w: q.w }, { x: p.x - b.position.x, y: p.y - b.position.y, z: p.z - b.position.z } );

	}

	_playerGeo() {

		const d = this._dims(), sec = this.sections;
		return { length: d.length, beam: d.beam, sheer: d.free, guns: sec.has( 'gunsPort' ), mast: sec.has( 'mast' ) && ! sec.mastDown, masts: MAST_STATIONS[ this.playerHull.boat ], propulsion: sec.layout.propulsion };

	}

	_onSunk( ship, byPlayer ) {

		const f = this.features, cls = ship.cls;
		this.stats.shipsSunk ++;
		if ( ship.faction === 'pirate' && byPlayer ) this.stats.piratesSunk ++;
		let total = 0;
		for ( let i = 0; i < cls.loot.crates; i ++ ) {

			const v = lootValue( cls, this.rng );
			total += v;
			this.loot.drop( ship.x + this.rng.range( - 5, 5 ), ship.z + this.rng.range( - 5, 5 ), v, ship.id );

		}

		// she lists, settles and goes down over SINK_TIME (Ship.finalPose); the vfx feature adds bubbles and foam from shipSunk
		if ( ! this._vfx() ) this.fx.splash( ship.x, 0, ship.z, 3.2 );
		this._wreckage( ship.x, ship.pose.y + cls.deck, ship.z, cls.length, cls.beam, ship.yaw );
		this.audio.impact( ship.x, 2, ship.z, 1 );
		if ( f && f.emit ) {

			const bt = ship.bounty;
			const ev = { id: ship.id, name: bt ? bt.target : ship.name, faction: ship.faction, x: ship.x, z: ship.z, byPlayer, kind: ship.kind, loot: total };
			if ( bt ) Object.assign( ev, { target: bt.target, captain: bt.captain, bountyId: bt.id, shipName: ship.name } );
			f.emit( 'shipSunk', ev );
			if ( ship.faction === 'pirate' && byPlayer ) f.emit( 'enemyDefeated', { id: ship.id, name: ship.captain || ship.name, kind: 'pirate' } );

		}

		if ( ship.bounty ) this.bounties.delete( ship.bounty.id );
		else if ( ship.faction === 'merchant' ) this._merchantRespawn.push( 240 );
		else this._pirateAt = Math.max( this._pirateAt, this.time + 75 );
		if ( byPlayer ) this._say( ship.faction === 'pirate' ? `The ${ ship.name } is going down!` : `You sank the ${ ship.name }` );

	}

	_playerHit( ball, pt ) {

		const owner = this.ships.find( ( s ) => s.id === ball.owner );
		if ( ! this._vfx() ) this.fx.hit( pt.x, pt.y, pt.z );
		this.audio.impact( pt.x, pt.y, pt.z, 1 );
		const local = this._playerLocal( pt );
		const sec = local ? pickSection( local, this._playerGeo(), this.rng ) : 'hull';
		this.hitPlayerSection( sec, ball.damage * this._falloff( ball ), owner ? `cannon:${ owner.name }` : 'cannon', owner ? { x: owner.x, z: owner.z } : { x: ball.x0, z: ball.z0 }, local );
		if ( ball.big && local && ! this.playerHull.sunk && this.rng() < FIRE.bigChance ) this._ignitePlayer( local, 'cannon' );

	}

	// a blow to one section of the player's boat: the section takes it (armour applies), the hull its HULL_SHARE
	hitPlayerSection( sec, amount, cause = 'cannon', from = null, local = null ) {

		const h = this.playerHull;
		if ( h.sunk || ! ( amount > 0 ) ) return;
		if ( sec === 'hull' || ! this.sections.has( sec ) ) {

			this.damagePlayer( amount, cause, from );
			return;

		}

		const r = this.sections.hit( sec, amount * this.mods.taken );
		this.damagePlayer( amount * ( HULL_SHARE[ sec ] ?? 1 ), cause, from );
		if ( ! r || h.sunk ) return;
		if ( r.broke ) {

			this._emit( 'sectionBroken', { id: 'player', section: sec } );
			const say = { rudder: 'The rudder is shot away: she will not answer the helm', sails: 'The sails are in rags: she is adrift', engine: 'The engine is wrecked: she is adrift', gunsPort: 'The port guns are out of action', gunsStarboard: 'The starboard guns are out of action' };
			if ( say[ sec ] ) this._say( say[ sec ], 3200 );

		}

		if ( r.mastFell ) this._playerMastFell( local );

	}

	_waterHit( ball, pt ) {

		if ( ! this._vfx() ) this.fx.splash( pt.x, pt.y, pt.z, 1 );
		// a miss that lands close shakes the camera a little
		const b = this.app.boatCtl;
		if ( ball.owner !== 'player' && b && b.position && Math.hypot( b.position.x - pt.x, b.position.z - pt.z ) < 14 ) {

			const cf = this.app.cameraFeel;
			if ( cf && cf.kick ) cf.kick( 'snap' );

		}

	}

	// hull damage to the player's boat; from = { x, z } of the attacker for the HUD wedge; { quiet }: no camera kick (a fire
	// burning, not a blow)
	damagePlayer( amount, cause = 'cannon', from = null, { quiet = false } = {} ) {

		const h = this.playerHull;
		if ( h.sunk || ! ( amount > 0 ) ) return;
		amount *= this.mods.taken; // armour plating
		h.hp = Math.max( 0, h.hp - amount );
		const f = this.features;
		if ( f && f.emit ) f.emit( 'playerBoatDamaged', { hp: Math.round( h.hp * 10 ) / 10, maxHp: h.max, cause } );
		const cf = this.app.cameraFeel;
		if ( cf && cf.kick && ! quiet ) cf.kick( 'snap' );
		if ( from && this.hud ) this.hud.damageFrom( this._screenAngle( from.x, from.z ) );
		if ( h.hp <= 0 ) this._sinkPlayer( cause );

	}

	// she goes down (the hull gave out, or she filled with water): splash, wreckage, the sinking sequence, playerBoatSunk
	_sinkPlayer( cause ) {

		const h = this.playerHull, f = this.features;
		if ( h.sunk && this.sinking ) return;
		h.sunk = true;
		this._channel = null;
		if ( this.fireState.burning ) this._fireOut( null, false, true );
		const b = this.app.boatCtl;
		const v = this._vfx( 'splash' ); // (no event covers our own hull going down)
		if ( b && b.position ) {

			if ( v ) v.splash( b.position.x, 0, b.position.z, 2.5 );
			else this.fx.splash( b.position.x, 0, b.position.z, 2.5 );
			const d = this._dims();
			this._wreckage( b.position.x, b.position.y + d.free, b.position.z, d.length, d.beam, typeof b.getYaw === 'function' ? b.getYaw() : 0 );

		}

		const info = this._beginSinking( cause );
		if ( f && f.emit ) f.emit( 'playerBoatSunk', { cause, ...info } );
		this._say( cause === 'flooding' ? 'She is full of water and going down!' : 'Your boat is sinking!', 3600 );

	}

	// angle of a world point on the screen, clockwise from straight up the view (for the damage wedge)
	_screenAngle( x, z ) {

		const cam = this.app.camera;
		if ( ! cam || ! cam.position || ! cam.quaternion ) return 0;
		const f = rotateByQuat( cam.quaternion, { x: 0, y: 0, z: - 1 } );
		const yaw = Math.atan2( f.x, f.z );
		return yaw - Math.atan2( x - cam.position.x, z - cam.position.z );

	}

	repairCost() {

		const h = this.playerHull;
		return Math.ceil( ( h.max - h.hp ) * REPAIR_PER_HP ) + this.sectionRepairCost();

	}

	// restore the hull; with { free: true } nothing is charged. false when it can't be afforded, and while she is going
	// down or lies on the bottom (salvage() raises a wreck)
	repair( { free = false } = {} ) {

		if ( this.sinking || this.wreck ) return false;
		const h = this.playerHull;
		const cost = this.repairCost();
		const st = this.features ? this.features.state : null;
		if ( ! free && cost > 0 && st && st.spend && ! st.spend( cost ) ) return false;
		h.hp = h.max;
		h.sunk = false;
		this._repairSystems();
		return true;

	}

	// the yard's work besides the hull: re-rig her (sections, a new mast), pump her out, the fire (if any) put out
	_repairSystems() {

		this.sections.repair();
		this._restoreMast();
		this.floodState.drain();
		this._floodWarned = false;
		if ( this.fireState.burning ) this._fireOut( null, true );

	}

	// "Rigging and rudder repairs": the section points at SECTION_REPAIR_PER_HP, a new mast MAST_COST
	sectionRepairCost() {

		const sec = this.sections;
		return Math.ceil( sec.missing() * SECTION_REPAIR_PER_HP ) + ( sec.mastDown ? MAST_COST : 0 );

	}

	repairSections( { free = false } = {} ) {

		if ( this.sinking || this.wreck || ! this.sections.damaged ) return false;
		const cost = this.sectionRepairCost();
		const st = this.features ? this.features.state : null;
		if ( ! free && cost > 0 && st && st.spend && ! st.spend( cost ) ) return false;
		this.sections.repair();
		this._restoreMast();
		return true;

	}

	// towed home after sinking: afloat again with a patched hull (a quarter of its points); repair() does the rest
	rescue() {

		if ( this.sinking || this.wreck ) return false; // (a wreck is raised by salvage())
		const h = this.playerHull;
		h.hp = Math.max( h.hp, Math.ceil( h.max * 0.25 ) );
		h.sunk = false;
		this.floodState.drain(); // (pumped out on the tow)
		return true;

	}

	// ------------------------------------------------------------------ losing the boat: sinking, wreck, salvage

	// the wreck of the boat the player owns now (an abandoned one, after a trade, does not count)
	get wreck() {

		const w = this.wrecks && this.wrecks.own;
		return w && ! w.abandoned && w.boat === this._boatId() ? w : null;

	}

	salvageCost() {

		const w = this.wreck;
		if ( ! w ) return 0;
		return this.features && this.features.sandbox ? 0 : salvageCostFor( w.boat );

	}

	// Captain Roid raises her: afloat at her berth with a sound hull and her hold back. false when there is nothing to
	// raise or it can't be afforded (features.state.spend; the sandbox and { free } pay nothing).
	salvage( { free = false } = {} ) {

		const w = this.wreck;
		if ( ! w ) return false;
		const cost = free ? 0 : this.salvageCost();
		const st = this.features ? this.features.state : null;
		if ( cost > 0 && st && st.spend && ! st.spend( cost ) ) return false;
		this.wrecks.salvaged();
		const h = this.playerHull;
		h.hp = h.max;
		h.sunk = false;
		this._repairSystems();
		const app = this.app, b = app.boatCtl;
		if ( typeof app.setBoat === 'function' ) app.setBoat( w.boat ); // (same id: visible, controller on, boardable again)
		else {

			if ( b ) b.enabled = true;
			if ( app.boat && app.boat.group ) app.boat.group.visible = true;
			if ( app.player && app.player.setBoat ) app.player.setBoat( b || null );

		}

		if ( b && b.reset ) b.reset(); // at her berth
		if ( b && b.apply && b.model ) try { b.apply(); } catch ( e ) { /* the next frame places her */ }
		this._emit( 'wreckSalvaged', { boat: w.boat, cost, x: w.x, z: w.z } );
		this._say( `The ${ w.name } is raised and moored at her berth`, 3600 );
		return true;

	}

	// the hull just went to 0: freeze the controller (her model is animated from here), the hold goes down with her, the
	// player goes over the side. Returns the playerBoatSunk extras.
	_beginSinking( cause ) {

		const app = this.app, b = app.boatCtl, p = app.player, h = this.playerHull;
		const pos = b && b.position ? b.position : { x: 0, y: 0, z: 0 };
		const aboard = !! ( p && ABOARD.includes( p.mode ) );
		const bo = this.features && this.features.get ? this.features.get( 'boarding' ) : null;
		const phase = bo && bo.hostile ? bo.hostile.phase : null;
		const boarded = aboard && !! phase && phase !== 'idle';
		// the crates are in her hold; the fish too if you were aboard (the sandbox keeps everything)
		const loot = this.features && ! this.features.sandbox ? strip( this.features, { fish: aboard, cargo: true } ) : empty();
		const q = b && b.quaternion ? [ b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w ] : [ 0, 0, 0, 1 ];
		const yaw = b && typeof b.getYaw === 'function' ? b.getYaw() : 2 * Math.atan2( q[ 1 ], q[ 3 ] );
		const list = b && b.angular && b.angular.z < 0 ? - 1 : ( Math.round( pos.x + pos.z ) & 1 ) ? 1 : - 1;
		const d = this._dims();
		this.sinking = { t: 0, boat: h.boat, cause, x: pos.x, y: pos.y, z: pos.z, q, yaw, list, depth: d.draft + d.free + 2.5, loot };
		if ( aboard ) this._overboard( p, list );
		if ( b ) {

			b.driven = false;
			b.throttle = 0;
			if ( b.velocity && b.velocity.set ) b.velocity.set( 0, 0, 0 );
			if ( b.angular && b.angular.set ) b.angular.set( 0, 0, 0 );
			b.enabled = false; // (App skips the controller: her pose is ours until she is gone)

		}

		// nobody climbs back aboard a sinking boat
		if ( p && p.setBoat && p.boat && p.boat === b ) p.setBoat( null );
		const v = this._vfx( 'sinking' );
		if ( v ) v.sinking( 'player-boat', pos.x, pos.z, Math.max( 1, d.length / 8 ) );
		return { boat: h.boat, x: pos.x, z: pos.z, aboard, boarded };

	}

	// over the high side into the water (or onto the pier when she went down alongside it)
	_overboard( p, list ) {

		try {

			if ( p.mode === 'boat' && p.leaveHelm ) p.leaveHelm();
			if ( ( p.mode === 'deck' || p.mode === 'seat' ) && p.exitBoat ) p.exitBoat( null, list > 0 ? - 1 : 1 );
			if ( ABOARD.includes( p.mode ) ) p.mode = 'swim';
			const cf = this.app.cameraFeel;
			if ( cf && cf.kick ) cf.kick( 'snap' );

		} catch ( e ) { console.warn( 'naval: overboard failed', e ); }

	}

	_updateSinking( dt ) {

		const s = this.sinking, app = this.app;
		s.t += dt;
		const k = sinkPose( s.t / SINK_TIME, s.list, s.depth, this._sk || ( this._sk = {} ) );
		const g = app.boat && app.boat.group, b = app.boatCtl;
		// (only her own model: a boat bought meanwhile is left alone)
		if ( s.boat === this._boatId() ) {

			const y = s.y + k.dy;
			if ( b && b.position && b.position.set ) b.position.set( s.x, y, s.z );
			if ( g && g.position && g.quaternion && g.quaternion.set ) {

				// her heading and wave pose when the hull gave out, then the pitch and the list (boat frame)
				const ax = - k.pitch / 2, az = k.roll / 2;
				const r = qmul( qmul( s.q, [ Math.sin( ax ), 0, 0, Math.cos( ax ) ] ), [ 0, 0, Math.sin( az ), Math.cos( az ) ] );
				g.position.set( s.x, y, s.z );
				g.quaternion.set( r[ 0 ], r[ 1 ], r[ 2 ], r[ 3 ] );
				if ( g.updateMatrixWorld ) g.updateMatrixWorld( true );

			}

		}

		if ( s.t < SINK_TIME ) return;
		this.sinking = null;
		const w = this.wrecks.create( { boat: s.boat, x: s.x, z: s.z, yaw: s.yaw, list: s.list, loot: s.loot, abandoned: s.boat !== this._boatId() } );
		this._holdWreck();
		if ( w && ! w.abandoned ) this._say( `The ${ w.name } is on the bottom. Captain Roid's yard can raise her (Salvage)`, 5200 );

	}

	// while the owned boat is a wreck: her model and controller stay hidden and parked, nobody can board her
	_holdWreck() {

		const w = this.wreck;
		if ( ! w ) return;
		const app = this.app, b = app.boatCtl, g = app.boat && app.boat.group, p = app.player;
		const h = this.playerHull;
		h.sunk = true;
		h.hp = 0;
		if ( b ) {

			b.enabled = false;
			b.driven = false;
			if ( b.position && b.position.set ) b.position.set( w.x, PARK_Y, w.z );

		}

		if ( g ) {

			g.visible = false;
			if ( g.position && g.position.set && g.position.y !== PARK_Y ) {

				g.position.set( w.x, PARK_Y, w.z );
				if ( g.updateMatrixWorld ) g.updateMatrixWorld( true );

			}

		}

		if ( p && p.setBoat && p.boat && p.boat === b ) p.setBoat( null );

	}

	// ------------------------------------------------------------------ collisions (wave 9, Collisions.js)

	// the player's boat as a collision body (null while she is sinking, a wreck or parked)
	_playerBody() {

		const b = this.app.boatCtl, h = this.playerHull;
		if ( h.sunk || this.sinking || ! b || ! b.position || ! b.quaternion || b.enabled === false || b.position.y < PARK_Y / 2 ) return null;
		const d = this._dims(), spec = BOATS[ h.boat ] || BOATS.lobster;
		const f = rotateByQuat( b.quaternion, { x: 0, y: 0, z: 1 } );
		const r = this._pb || ( this._pb = this._makePlayerBody() );
		r._b = b;
		r.x = b.position.x;
		r.z = b.position.z;
		r.yaw = Math.atan2( f.x, f.z );
		r.hx = d.beam / 2;
		r.hz = d.length / 2;
		r.mass = b.mass || spec.mass;
		r.invMass = 1 / r.mass;
		r.invI = 1 / ( ( b.inertia && b.inertia.y ) || yawInertia( r.mass, r.hx, r.hz ) );
		r.vx = b.velocity ? b.velocity.x : 0;
		r.vz = b.velocity ? b.velocity.z : 0;
		r.w = b.angular ? b.angular.y : 0;
		r.maxHp = h.max;
		return r;

	}

	// the controller takes the push and the impulse (BoatController.applyCollision); a bare stand-in gets them directly
	_makePlayerBody() {

		const r = { id: 'player', player: true, gentle: false, _b: null };
		const sync = () => {

			const b = r._b;
			r.x = b.position.x;
			r.z = b.position.z;
			if ( b.velocity ) { r.vx = b.velocity.x; r.vz = b.velocity.z; }
			if ( b.angular ) r.w = b.angular.y;

		};

		r.push = ( dx, dz ) => {

			const b = r._b;
			if ( typeof b.applyCollision === 'function' ) b.applyCollision( dx, dz, 0, 0 );
			else { b.position.x += dx; b.position.z += dz; }
			sync();

		};

		r.impulse = ( jx, jz, px, pz ) => {

			const b = r._b;
			if ( typeof b.applyCollision === 'function' ) b.applyCollision( 0, 0, jx, jz, px, b.position.y + 0.4, pz );
			else {

				if ( b.velocity ) { b.velocity.x += jx * r.invMass; b.velocity.z += jz * r.invMass; }
				r.w += ( ( pz - r.z ) * jx - ( px - r.x ) * jz ) * r.invI;
				if ( b.angular ) b.angular.y = r.w;

			}

			sync();

		};

		return r;

	}

	// a ship as a collision body: grounded or moored she does not move (but still blocks), mirrored puppets neither
	_shipBody( s ) {

		const c = s.cls, r = s._body || ( s._body = this._makeShipBody( s ) );
		const fixed = s.grounded > 0 || s.state === 'moored' || !! s.puppet;
		r.x = s.x;
		r.z = s.z;
		r.yaw = s.yaw;
		r.hx = c.beam / 2;
		r.hz = c.length / 2 * 0.97;
		r.mass = c.mass || c.hp * 200;
		r.invMass = fixed ? 0 : 1 / r.mass;
		r.invI = fixed ? 0 : 1 / yawInertia( r.mass, r.hx, r.hz );
		const v = s.velocity( this._sv || ( this._sv = {} ) );
		r.vx = v.x;
		r.vz = v.z;
		r.w = s.yawRate;
		r.maxHp = s.maxHp;
		r.gentle = GENTLE.has( s.state );
		return r;

	}

	_makeShipBody( s ) {

		const r = { id: s.id, ship: s };
		const v = {};
		const sync = () => {

			r.x = s.x;
			r.z = s.z;
			s.velocity( v );
			r.vx = v.x;
			r.vz = v.z;
			r.w = s.yawRate;

		};

		r.push = ( dx, dz ) => { s.shift( dx, dz ); sync(); };
		r.impulse = ( jx, jz, px, pz ) => { s.applyImpulse( jx, jz, px, pz, r.invMass, r.invI ); sync(); };
		return r;

	}

	_bodies() {

		const list = this._bodyList || ( this._bodyList = [] );
		list.length = 0;
		const pb = this._playerBody();
		if ( pb ) list.push( pb );
		for ( const s of this.ships ) if ( s.alive ) list.push( this._shipBody( s ) );
		return list;

	}

	// every hull against every other: separate, bounce, and on a new blow the damage and the show
	_collide() {

		this.contacts = this.collisions.step( this.time, this._bodies() );
		for ( const c of this.contacts ) this._onContact( c );

	}

	_onContact( c ) {

		const a = c.a, b = c.b, player = !! ( a.player || b.player );
		// a ramming pirate breaks off after the blow (Brains: s.mem.ram)
		for ( const r of [ a, b ] ) {

			const m = r.ship && r.ship.mem;
			if ( m && m.ram ) { m.ram = false; m.ramCool = RAM.cool; }

		}

		if ( ! c.damage ) {

			// grinding alongside: the timbers creak now and then
			if ( player && this.time > this._creakT ) {

				this._creakT = this.time + 1.4;
				this.audio.creak( c.x, 1, c.z, 0.45 );

			}

			return;

		}

		const v = c.vClose, k = clamp( v / 4, 0.3, 3 ), y = 1;
		const vfx = this._vfx();
		if ( vfx ) {

			if ( vfx.splinters ) vfx.splinters( c.x, y + 0.4, c.z, k );
			if ( vfx.debris ) vfx.debris( c.x, y, c.z, k * 0.8, 'wood' );
			if ( vfx.splash ) vfx.splash( c.x, 0, c.z, k * 0.8 );

		} else {

			this.fx.hit( c.x, y, c.z );
			this.fx.splash( c.x, 0, c.z, k * 0.8 );

		}

		this.audio.crunch( c.x, y, c.z, clamp( 0.45 + v / 10, 0.45, 1 ) );
		const mu = a.mass * b.mass / Math.max( 1, a.mass + b.mass ), energy = 0.5 * mu * v * v;
		// dock props near the crash fly (the destruction feature)
		const de = this.features && this.features.get ? this.features.get( 'destruction' ) : null;
		if ( de && typeof de.impulse === 'function' ) {

			try { de.impulse( c.x, y, c.z, 4 + v, energy ); } catch ( e ) { /* decoration */ }

		}

		for ( const [ self, other, d ] of [ [ a, b, c.damage.a ], [ b, a, c.damage.b ] ] ) {

			if ( ! ( d > 0 ) ) continue;
			if ( self.player ) this.damagePlayer( d, 'ramming', { x: other.x, z: other.z } );
			else if ( self.ship && self.ship.alive ) {

				const s = self.ship;
				const sunk = s.damage( d, { part: 'hull', by: other.player ? 'player' : other.id } );
				if ( other.player ) {

					this.hudTarget = s.id;
					if ( this.hud ) this.hud.hitMarker( sunk ? 'sunk' : 'hit' );

				}

				if ( sunk ) this._onSunk( s, !! other.player );

			}

			// stove in: planks off the side
			if ( d > 0.04 * ( self.maxHp || 100 ) ) this.planks.burst( c.x, c.z, 2, 1.5 );

		}

		if ( player ) {

			const cf = this.app.cameraFeel;
			if ( cf && cf.kick ) cf.kick( v > 4 ? 'broadside' : 'hit', { scale: clamp( v / 5, 0.4, 1.6 ) } );

		}

		// a hard crash can set either hull alight at the contact
		if ( v > FIRE.ramSpeed ) {

			for ( const r of [ a, b ] ) {

				if ( this.rng() >= FIRE.ramChance ) continue;
				if ( r.player ) {

					const l = this._playerLocal( { x: c.x, y: ( this.app.boatCtl.position.y || 0 ) + this._dims().deck, z: c.z } );
					if ( l && ! this.playerHull.sunk ) this._ignitePlayer( l, 'ramming' );

				} else if ( r.ship && r.ship.alive ) this._igniteShip( r.ship, this._shipLocal( r.ship, { x: c.x, y: r.ship.pose.y + r.ship.cls.deck, z: c.z } ), 'ramming' );

			}

		}

		this._emit( 'hullsCollided', {
			a: a.id, b: b.id, x: c.x, z: c.z, speed: Math.round( v * 10 ) / 10,
			damage: { a: Math.round( c.damage.a * 10 ) / 10, b: Math.round( c.damage.b * 10 ) / 10 }, byPlayer: player,
		} );

	}

	// a hull breaking up: wood debris along her length, splinters, and floating planks
	_wreckage( x, y, z, length = 8, beam = 3, yaw = 0 ) {

		const v = this._vfx(), fx = Math.sin( yaw ), fz = Math.cos( yaw );
		if ( v && v.debris ) {

			for ( let i = 0; i < 6; i ++ ) {

				const k = ( i / 5 - 0.5 ) * length * 0.8, sd = ( i % 2 ? 1 : - 1 ) * beam * 0.3;
				v.debris( x + fx * k + fz * sd, y, z + fz * k - fx * sd, 1.2, 'wood' );

			}

		}

		if ( v && v.splinters ) v.splinters( x, y, z, 2 );
		else if ( ! v ) this.fx.hit( x, y, z );
		this.planks.burst( x, z, 6 + Math.round( length / 4 ), Math.max( 2, length * 0.3 ) );

	}

	// merchants look 3 s ahead and turn away from a hull they would hit (Brains: s.mem.avoidT / avoidDir)
	_avoidance( dt ) {

		this._avoidT -= dt;
		if ( this._avoidT > 0 ) return;
		this._avoidT = 0.25;
		const list = this._bodies();
		for ( const s of this.ships ) {

			if ( s.faction !== 'merchant' || ! s.alive || ( s.state !== 'sail' && s.state !== 'flee' ) ) continue;
			const me = this._shipBody( s );
			let best = null;
			for ( const o of list ) {

				if ( o === me ) continue;
				const p = predictContact( me, o, AVOID.horizon );
				if ( p && ( ! best || p.t < best.t ) ) best = p;

			}

			if ( best ) {

				s.mem.avoidT = AVOID.hold;
				s.mem.avoidDir = - best.side; // the other passes to port: turn to starboard, and the other way round

			}

		}

	}

	// a pirate whose hull falls below CRIPPLE: shipCrippled once (boarding strikes her colours; her guns go quiet)
	_checkCripple() {

		for ( const s of this.ships ) {

			if ( s.faction !== 'pirate' ) continue;
			const f = s.alive ? s.hpFraction : 0;
			const prev = s._cripSeen ?? f;
			s._cripSeen = f;
			if ( ! s.alive || s.crippled || ! ( prev >= CRIPPLE && f < CRIPPLE ) ) continue;
			s.crippled = true;
			// with the boarding feature installed it announces the crossing itself (she strikes her colours: one event)
			const bo = this.features && this.features.get ? this.features.get( 'boarding' ) : null;
			if ( bo ) continue;
			this._emit( 'shipCrippled', { id: s.id, name: s.name, by: s.lastHitBy, x: s.x, z: s.z } );
			if ( s.lastHitBy === 'player' ) this._say( `The ${ s.name } is crippled: her guns are silent` );

		}

	}

	// ------------------------------------------------------------------ damage control (wave 11A: fire, flooding, masts)

	// the wind (m/s, the way it blows): app.wind { x, z } when given (tests), else the sky's globals
	_wind() {

		const o = this._windV || ( this._windV = { x: 0, z: 0 } );
		const w = this.app.wind;
		if ( w && Number.isFinite( w.x ) && Number.isFinite( w.z ) ) {

			o.x = w.x;
			o.z = w.z;
			return o;

		}

		try {

			const sp = G.windSpeed && Number.isFinite( G.windSpeed.value ) ? G.windSpeed.value : 0, d = G.windDir && G.windDir.value;
			o.x = d ? d.x * sp : 0;
			o.z = d ? d.y * sp : 0;

		} catch ( e ) { o.x = o.z = 0; }

		return o;

	}

	_boatYaw( b ) {

		if ( typeof b.getYaw === 'function' ) return b.getYaw();
		const f = rotateByQuat( b.quaternion, { x: 0, y: 0, z: 1 } );
		return Math.atan2( f.x, f.z );

	}

	// a point of the player's boat frame in the world
	_boatWorld( l, out = {} ) {

		const b = this.app.boatCtl;
		const o = rotateByQuat( b.quaternion, l );
		out.x = b.position.x + o.x;
		out.y = b.position.y + o.y;
		out.z = b.position.z + o.z;
		return out;

	}

	_onDeck() {

		const p = this.app.player, b = this.app.boatCtl, h = this.playerHull;
		return !! p && p.mode === 'deck' && ! h.sunk && ! this.sinking && !! b && !! b.position && !! b.quaternion && ( ! p.boat || p.boat === b );

	}

	// the rail nearest the player (the bucket goes over the side there)
	_railPoint() {

		const p = this.app.player;
		if ( ! this._onDeck() || ! p.position ) return null;
		const l = this._playerLocal( p.position ), d = this._dims();
		const pt = this._boatWorld( { x: ( l.x >= 0 ? 1 : - 1 ) * d.beam / 2, y: l.y, z: clamp( l.z, - d.length / 2 + 0.4, d.length / 2 - 0.4 ) } );
		pt.y = p.position.y;
		return pt;

	}

	// the pump stands amidships
	_deckPoint() {

		const p = this.app.player;
		if ( ! this._onDeck() || ! p.position ) return null;
		const pt = this._boatWorld( { x: 0, y: this._dims().deck, z: 0 } );
		pt.y = p.position.y;
		return pt;

	}

	// E "Douse the fire" at the rail: a 3 s bucket channel (repeatable) knocks it down FIRE.douseAmount
	douse() {

		if ( ! this.fireState.burning || ! this._onDeck() ) return false;
		this._channel = { kind: 'douse', t: 0 };
		this._say( 'Buckets over the side…', 1800 );
		return true;

	}

	// E "Man the pump": pumps while E is held (a tap pumps a moment); pump( false ) stops
	pump( on = true ) {

		if ( ! on ) {

			if ( this._channel && this._channel.kind === 'pump' ) this._channel = null;
			return false;

		}

		if ( ! ( this.floodState.level > 0 ) || ! this._onDeck() ) return false;
		this._channel = { kind: 'pump', t: 0 };
		return true;

	}

	get channel() {

		const c = this._channel;
		return c ? { kind: c.kind, t: c.t, frac: c.kind === 'douse' ? clamp( c.t / FIRE.douseTime, 0, 1 ) : null } : null;

	}

	_updateChannel( dt ) {

		const ch = this._channel;
		if ( ! ch ) return;
		if ( ! this._onDeck() ) {

			this._channel = null;
			return;

		}

		ch.t += dt;
		if ( ch.kind === 'douse' ) {

			if ( ! this.fireState.burning ) {

				this._channel = null;
				return;

			}

			if ( ch.t < FIRE.douseTime ) return;
			this._channel = null;
			const left = this.fireState.douse();
			if ( left <= 0 ) this._fireOut( null, true );
			else this._say( `The fire is knocked down · ${ Math.round( left * 100 ) } %`, 1800 );

		} else {

			const inp = this.app.input;
			const held = !! ( inp && typeof inp.down === 'function' && inp.down( 'KeyE' ) );
			if ( ( ! held && ch.t > 0.6 ) || ! ( this.floodState.level > 0 ) ) this._channel = null;

		}

	}

	_ignitePlayer( local, cause ) {

		if ( ! this.fireState.ignite( local ) ) return false;
		this._smokeT = 0;
		const b = this.app.boatCtl, p = b && b.position ? b.position : { x: 0, z: 0 };
		this._emit( 'fireStarted', { id: 'player', x: p.x, z: p.z, cause } );
		this._say( 'Fire aboard! Douse it at the rail (E on deck)', 3200 );
		return true;

	}

	// public: set a ship's deck alight at a world point (wave 18D: the fire bottle)
	igniteShip( s, world, cause = 'fire' ) {

		if ( ! s || ! s.alive ) return false;
		this._igniteShip( s, this._shipLocal( s, world ), cause );
		return true;

	}

	_igniteShip( s, local, cause ) {

		if ( ! s.fire.ignite( local ) ) return false;
		s._douseAt = aiDouseTime( s.hands );
		this._emit( 'fireStarted', { id: s.id, x: s.x, z: s.z, cause } );
		return true;

	}

	// public: the player's fire put out by hand (the crew's bucket line, wave 19C)
	fireDoused() {

		this._fireOut( null, true );

	}

	// the fire is out (ship null: the player's); doused or burnt out
	_fireOut( ship, doused = false, silent = false ) {

		const v = this._vfx( 'stopFire' );
		if ( ship ) {

			ship.fire.extinguish();
			if ( ship._fireVfx && v ) v.stopFire( ship._fireVfx );
			ship._fireVfx = null;
			if ( ! silent ) this._emit( 'fireOut', { id: ship.id, doused } );
			return;

		}

		this.fireState.extinguish();
		this._channel = this._channel && this._channel.kind === 'douse' ? null : this._channel;
		if ( v ) v.stopFire( 'naval-fire-player' );
		if ( silent ) return;
		this._emit( 'fireOut', { id: 'player', doused } );
		this._say( doused ? 'The fire is out' : 'The fire has burnt itself out', 2200 );

	}

	// the fire reached the powder: an explosion, splinters, a great hole in her, and the shot is gone
	_magazine( ship ) {

		const p = ship ? ship.toWorld( ship.fire.at.x, ship.fire.at.y, ship.fire.at.z, {} ) : this._boatWorld( this.fireState.at );
		const v = this._vfx();
		if ( v ) {

			if ( v.flash ) v.flash( p.x, p.y + 0.5, p.z, 3 );
			if ( v.explosion ) v.explosion( p.x, p.y, p.z, 2.5, 'wood' );
			if ( v.splinters ) v.splinters( p.x, p.y + 0.5, p.z, 3 );
			if ( v.debris ) v.debris( p.x, p.y, p.z, 2.5, 'wood' );

		} else {

			this.fx.hit( p.x, p.y, p.z );
			this.fx.smoke( p.x, p.y + 1, p.z, 2 );

		}

		this.audio.cannon( p.x, p.y, p.z, 1 );
		this.audio.crunch( p.x, p.y, p.z, 1 );
		this._emit( 'explosion', { x: p.x, y: p.y, z: p.z, radius: 8, energy: 2e6 } );
		this._emit( 'magazineExploded', { id: ship ? ship.id : 'player', x: p.x, z: p.z } );
		if ( ship ) {

			ship.ammo.rounds = 0;
			if ( ship.burn( ship.maxHp * FIRE.blast ) ) this._onSunk( ship, ship.lastHitBy === 'player' );
			return;

		}

		this.ammo.rounds = 0;
		const cf = this.app.cameraFeel;
		if ( cf && cf.kick ) cf.kick( 'broadside', { scale: 1.6 } );
		this._say( 'The magazine went up!', 3200 );
		this.damagePlayer( this.playerHull.max * FIRE.blast, 'magazine' );

	}

	// a hostile pirate (afloat, not crippled, not alongside on purpose) within r of the boat: the crew stay at their posts
	_enemyNear( r = GUN_RANGE ) {

		const b = this.app.boatCtl;
		if ( ! b || ! b.position ) return false;
		return this.ships.some( ( s ) => s.alive && s.faction === 'pirate' && ! isCrippled( s ) && ! GENTLE.has( s.state ) && Math.hypot( s.x - b.position.x, s.z - b.position.z ) < r );

	}

	// the posted crew pump while no enemy is in range
	_crewPump() {

		const c = this.features && this.features.get ? this.features.get( 'crew' ) : null;
		let n = 0;
		try { n = c && c.posts ? Object.keys( c.posts ).length : 0; } catch ( e ) { n = 0; }
		if ( ! n || this._enemyNear() ) return 0;
		return n * FLOOD.crewPump;

	}

	// the player's hull, every frame: the helm, the fire, the water, the deck job, the sandbox ramp's free powder
	_playerSystems( dt ) {

		const h = this.playerHull, b = this.app.boatCtl;
		this._applyRudder();
		if ( h.sunk || this.sinking || ! b || ! b.position || ! b.quaternion ) {

			this._channel = null;
			return;

		}

		// sandbox: free but finite - she is topped up while she lies moored at the ramp
		if ( this.features && this.features.sandbox && b.moored && this.ammo.room > 0 ) {

			const n = this.ammo.fill();
			if ( n >= 4 ) this._say( `Powder and shot topped up at the ramp (+${ n })`, 2200 );

		}

		this._updateChannel( dt );

		const fs = this.fireState;
		if ( fs.burning ) {

			const w = this._wind(), vel = b.velocity || { x: 0, z: 0 };
			const head = headwindOver( vel.x || 0, vel.z || 0, this._boatYaw( b ), w.x, w.z );
			const sails = this.sections.has( 'sails' ) && this.sections.frac( 'sails' ) > 0;
			const r = fs.update( dt, { headwind: head, ammo: this.ammo.rounds, sails } );
			this._burnAcc += r.hull;
			if ( r.sails > 0 ) {

				const hs = this.sections.hit( 'sails', r.sails );
				if ( hs && hs.broke ) this._say( 'The sails have burnt away', 2600 );

			}

			// the hull burns in whole points (one quiet damage event a point, not one a frame)
			if ( this._burnAcc >= 1 ) {

				const n = Math.floor( this._burnAcc );
				this._burnAcc -= n;
				this.damagePlayer( n, 'fire', null, { quiet: true } );

			}

			if ( r.magazine && ! h.sunk ) this._magazine( null );
			if ( r.out ) this._fireOut( null, false );
			else if ( fs.burning && ! h.sunk ) {

				const p = this._boatWorld( { x: fs.at.x, y: Math.max( fs.at.y, this._dims().deck ), z: fs.at.z } );
				const v = this._vfx( 'fire' );
				if ( v ) v.fire( 'naval-fire-player', p.x, p.y, p.z, 0.4 + 1.4 * fs.level, vel.x || 0, vel.z || 0 );
				this._smokeT -= dt;
				if ( this._smokeT <= 0 ) {

					this._smokeT = 0.6;
					const vs = this._vfx( 'smoke' );
					if ( vs ) vs.smoke( p.x, p.y + 1, p.z, 0.5 + fs.level );
					else this.fx.smoke( p.x, p.y + 1, p.z, 0.5 + fs.level );

				}

			}

		} else this._burnAcc = 0;

		if ( h.sunk || this.sinking ) return;
		// the water: in below the line, out by the pump (the skipper's channel, the posted crew)
		const fl = this.floodState;
		const pump = ( this._channel && this._channel.kind === 'pump' ? FLOOD.pump : 0 ) + ( fl.level > 0 ? this._crewPump() : 0 );
		const r = fl.update( dt, { hpFrac: h.max > 0 ? h.hp / h.max : 1, pump } );
		if ( fl.level > 0.05 && ! this._floodWarned ) {

			this._floodWarned = true;
			this._say( 'She is taking on water · man the pump (E on deck)', 3200 );

		} else if ( fl.level <= 0 ) this._floodWarned = false;

		if ( r.sunk ) {

			this._emit( 'shipFlooded', { id: 'player' } );
			this._sinkPlayer( 'flooding' );

		}

	}

	// the rudder section on the boat controller (its rudderLift, scaled from its own value; restored at full)
	_applyRudder() {

		const b = this.app.boatCtl;
		if ( ! b || typeof b !== 'object' || ! Number.isFinite( b.rudderLift ) ) return;
		let base = this._rudderBase.get( b );
		if ( base === undefined ) {

			base = b.rudderLift;
			this._rudderBase.set( b, base );

		}

		const want = base * this.turnFactor;
		if ( b.rudderLift !== want ) b.rudderLift = want;

	}

	// water in her: her model sits lower (after the controller placed it this frame; undone if nobody placed it again)
	_settleModel() {

		const g = this.app.boat && this.app.boat.group;
		if ( ! g || ! g.position || this.sinking ) {

			this._settle = 0;
			return;

		}

		if ( this._settle && g.position.y === this._settleY ) g.position.y += this._settle;
		const want = this.playerHull.sunk ? 0 : this.floodState.settle( this._dims().draft );
		if ( want > 0 ) {

			g.position.y -= want;
			if ( g.updateMatrixWorld ) g.updateMatrixWorld( true );

		}

		this._settle = want;
		this._settleY = g.position.y;

	}

	// the AI ships: their fires (doused by their crews after 20-40 s), the water in them (their crews pump), the masts
	_shipSystems( dt ) {

		const v = this._vfx( 'fire' );
		for ( const s of this.ships ) {

			if ( ! s.alive || s.puppet ) {

				if ( s.fire.burning || s._fireVfx ) this._fireOut( s, false, true );
				continue;

			}

			const f = s.fire;
			if ( f.burning ) {

				const w = this._wind(), vel = s.velocity( this._sv3 || ( this._sv3 = {} ) );
				const r = f.update( dt, { headwind: headwindOver( vel.x, vel.z, s.yaw, w.x, w.z ), ammo: s.ammo.rounds, sails: s.sections.frac( 'sails' ) > 0 } );
				if ( r.sails > 0 ) s.sections.hit( 'sails', r.sails );
				if ( s.burn( r.hull ) ) {

					this._fireOut( s, false, true );
					this._onSunk( s, s.lastHitBy === 'player' );
					continue;

				}

				if ( r.magazine ) {

					this._magazine( s );
					if ( ! s.alive ) {

						this._fireOut( s, false, true );
						continue;

					}

				}

				if ( r.out || ( f.burning && f.t >= ( s._douseAt ?? aiDouseTime( s.hands ) ) ) ) this._fireOut( s, ! r.out );
				else if ( v && s.dist < this.settings.drawRange ) {

					const p = s.toWorld( f.at.x, Math.max( f.at.y, s.cls.deck ), f.at.z, this._m );
					s._fireVfx = `naval-fire-${ s.id }`;
					v.fire( s._fireVfx, p.x, p.y, p.z, 0.5 + 1.5 * f.level, vel.x, vel.z );

				}

			}

			// water: not while she lies alongside on purpose (a grapple, a boarding: the prize is kept afloat)
			if ( ! GENTLE.has( s.state ) ) {

				const fr = s.flood.update( dt, { hpFrac: s.hpFraction, pump: s.hands * FLOOD.crewPump } );
				if ( fr.sunk ) {

					s.startSinking();
					this._emit( 'shipFlooded', { id: s.id } );
					this._onSunk( s, s.lastHitBy === 'player' );
					continue;

				}

			}

			// a mast that fell while she was out of sight: her model shows her dismasted when it comes back
			if ( s.sections.mastDown && s.visual && s.visual.loaded && ! s._mastGone ) s._mastGone = hideMast( s.visual.group );

		}

	}

	// ---- masts

	_mastHeight( kind ) {

		const c = SHIP_CLASSES[ kind ];
		return c ? c.mast - c.deck : 6;

	}

	// an AI ship's mast came down: it topples away from the blow (the clones fall; her own spars are hidden)
	_shipMastFell( s, local ) {

		const c = s.cls, side = local && local.x >= 0 ? - 1 : 1;
		const foot = { x: 0, y: c.deck, z: ( ( MAST_STATIONS[ s.kind ] || [ 0.1 ] )[ 0 ] ) * c.length };
		const fall = new MastFall( { height: c.mast - c.deck, side } );
		const vis = s.visual && s.visual.loaded ? MastVisual.from( s.visual.group, this.scene, { foot } ) : null;
		if ( vis ) s._mastGone = true;
		this.falls.push( { fall, vis, ship: s, foot } );
		this._emit( 'mastFell', { id: s.id, x: s.x, z: s.z } );
		if ( s.lastHitBy === 'player' ) this._say( `The ${ s.name }'s mast is down!` );

	}

	_playerMastFell( local ) {

		const d = this._dims(), id = this.playerHull.boat, spec = BOATS[ id ] || {};
		const side = local && local.x >= 0 ? - 1 : 1;
		const foot = { x: 0, y: d.deck, z: ( ( MAST_STATIONS[ id ] || [ 0.1 ] )[ 0 ] ) * d.length };
		const height = spec.shipClass && SHIP_CLASSES[ spec.shipClass ] ? this._mastHeight( spec.shipClass ) : Math.max( 3, d.length * 0.8 );
		const fall = new MastFall( { height, side } );
		const g = this.app.boat && this.app.boat.group;
		const vis = g ? MastVisual.from( g, this.scene, { foot } ) : null;
		if ( vis ) this._mastHidden = vis.originals;
		this.falls.push( { fall, vis, ship: null, foot } );
		const b = this.app.boatCtl, p = b && b.position ? b.position : { x: 0, z: 0 };
		this._emit( 'mastFell', { id: 'player', x: p.x, z: p.z } );
		this._say( 'The mast is down! Her canvas went with it', 3200 );

	}

	_updateFalls( dt ) {

		for ( let i = this.falls.length - 1; i >= 0; i -- ) {

			const f = this.falls[ i ];
			for ( const e of f.fall.update( dt ) ) this._fallEvent( f, e );
			if ( f.vis ) f.vis.update( f.fall, dt );
			if ( f.fall.phase === 'gone' ) this.falls.splice( i, 1 );

		}

		// the player's mast down from a save: hide her spars once her model is there
		if ( this.sections.mastDown && ! this._mastHidden && ( this._frame % 30 ) === 0 ) {

			const g = this.app.boat && this.app.boat.group;
			const list = g ? hideMast( g ) : null;
			if ( list && list.length ) this._mastHidden = list;

		}

	}

	_fallEvent( f, e ) {

		const s = f.ship;
		if ( s ? ! s.alive && e.type !== 'gone' : ! this.app.boatCtl || ! this.app.boatCtl.position ) return;
		const tip = f.fall.tip(), l = { x: f.foot.x + tip.x, y: f.foot.y + tip.y, z: f.foot.z + tip.z };
		const at = e.type === 'crack' ? f.foot : l;
		const p = s ? s.toWorld( at.x, at.y, at.z, {} ) : this._boatWorld( at );
		const v = this._vfx();
		if ( e.type === 'crack' ) {

			if ( v && v.splinters ) v.splinters( p.x, p.y + 0.5, p.z, 2 );
			if ( v && v.debris ) v.debris( p.x, p.y, p.z, 1.4, 'wood' );
			if ( ! v ) this.fx.hit( p.x, p.y, p.z );
			this.audio.crunch( p.x, p.y, p.z, 0.9 );

		} else if ( e.type === 'splash' ) {

			if ( v && v.splash ) v.splash( p.x, 0, p.z, 2.4 );
			else if ( ! v ) this.fx.splash( p.x, 0, p.z, 2.4 );
			if ( v && v.splinters ) v.splinters( p.x, 0.5, p.z, 1.5 );

		}

	}

	// the yard steps a new mast: the player's spars back (the fallen one, if still in the water, is left to sink)
	_restoreMast() {

		if ( this._mastHidden ) for ( const m of this._mastHidden ) m.visible = true;
		this._mastHidden = null;
		for ( let i = this.falls.length - 1; i >= 0; i -- ) {

			const f = this.falls[ i ];
			if ( f.ship ) continue;
			// (her own spars are visible again; a mast still toppling with her goes)
			if ( f.vis && ! f.vis.free ) {

				f.vis.dispose();
				this.falls.splice( i, 1 );

			}

		}

	}

	// ------------------------------------------------------------------ loot

	_updateLoot() {

		const b = this.app.boatCtl, p = this.app.player;
		const reach = Math.max( 3.2, this._dims().length * 0.5 );
		const st = this.features ? this.features.state : null;
		this.loot.update( this._dt, this.time, ( c ) => {

			let near = false;
			if ( b && b.position && ! this.playerHull.sunk ) near = this.loot.near( c, b.position.x, b.position.z, reach );
			if ( ! near && p && p.mode === 'swim' && p.position ) near = this.loot.near( c, p.position.x, p.position.z, 2.2 );
			if ( ! near ) return false;
			if ( st && st.earn ) st.earn( c.value );
			this.stats.looted += c.value;
			if ( this.features && this.features.emit ) this.features.emit( 'lootCollected', { value: c.value, x: c.x, z: c.z, source: c.source } );
			if ( this.app.audio && this.app.audio.coin ) this.app.audio.coin();
			this._say( `+$${ c.value } salvage` );
			return true;

		} );

	}

	// ------------------------------------------------------------------ ship modules (Captain Roid's yard)

	moduleRows( state = this.features ? this.features.state : null ) {

		this._syncBoat();
		return this.fitting.rows( state );

	}

	moduleSlots() {

		this._syncBoat();
		const boat = this.fitting.boat;
		return this.fitting.slots().map( ( s ) => ( {
			...s, label: SLOT_LABELS[ s.kind ] || s.kind,
			moduleLabel: s.module ? moduleLabel( s.module, boat, this.fitting.tierOf( s.module ) ) : null,
		} ) );

	}

	// buy the next tier of module `id` (features.state pays; free in sandbox); a new module is fitted into a free slot
	buyModule( id ) {

		this._syncBoat();
		const st = this.features ? this.features.state : null;
		const r = this.fitting.buy( id, st );
		if ( r.ok ) {

			this._syncMods();
			this._emit( 'moduleBought', { id, tier: r.tier, price: r.price } );
			this._say( `${ moduleLabel( id, this.fitting.boat, r.tier ) } ${ r.fitted ? 'fitted' : 'bought: fit it when a slot is free' }` );

		}

		return r;

	}

	fitModule( id, slot = null ) {

		this._syncBoat();
		const ok = this.fitting.fit( id, slot );
		if ( ok ) {

			this._syncMods();
			this._emit( 'moduleFitted', { id, slot: this.fitting.fitted( id ) } );

		}

		return ok;

	}

	removeModule( id ) {

		this._syncBoat();
		const ok = this.fitting.remove( id );
		if ( ok ) {

			this._syncMods();
			this._emit( 'moduleRemoved', { id } );

		}

		return ok;

	}

	// cargo crate multiplier of the extra hold (the trade feature's capacity x this)
	holdBonus() {

		return this.mods.cargo || 1;

	}

	// fish hold (kg) multiplier of the fish well
	fishHoldBonus() {

		return this.mods.holdKg || 1;

	}

	get nightBiteBonus() {

		return this.mods.nightBite || 1;

	}

	// the lantern rig: bites come faster at night while fishing aboard or beside the boat
	biteBonus() {

		const k = this.nightBiteBonus;
		if ( ! ( k > 1 ) || ! this.night || this.playerHull.sunk ) return 1;
		const p = this.app.player, b = this.app.boatCtl;
		if ( ! p ) return 1;
		if ( p.mode === 'boat' || p.mode === 'deck' || p.mode === 'seat' ) return k;
		if ( b && b.position && p.position && Math.hypot( p.position.x - b.position.x, p.position.z - b.position.z ) < LANTERN_REACH ) return k;
		return 1;

	}

	// how far pirates show on the HUD (Hud.js arrows): farther with the spyglass
	sightRange() {

		return this.mods.sight || ARROW_RANGE;

	}

	// ------------------------------------------------------------------ frame

	update( dt ) {

		if ( this.shipLights ) this.shipLights.update( this.app && this.app.camera );

		if ( ! ( dt > 0 ) ) return;
		dt = Math.min( dt, 0.1 );
		this._dt = dt;
		this._frame ++;
		this.time += dt;
		const act = this.active;
		if ( this._wasActive && ! act ) this._clearWorld();
		this._wasActive = act;

		if ( act ) {

			this._syncBoat();
			this._syncMods();
			this._refreshTarget();
			this._gatherTargets( dt );
			this._readKeys();
			this._updateAim();
			this.reloadLeft.port = Math.max( 0, this.reloadLeft.port - dt );
			this.reloadLeft.starboard = Math.max( 0, this.reloadLeft.starboard - dt );
			if ( this.settings.autoSpawn ) this._manage( dt );
			this._sail( dt );
			this._avoidance( dt );
			this._collide();
			this._checkCripple();
			this._updateShots( dt );
			this._updatePlayerShots( dt );
			this._updateBalls( dt );
			this._shipSystems( dt );
			this._updateLoot();

		}

		this._updateAimCam( dt );
		// her own fire and water run for every role (the hits on our boat land on our machine)
		if ( this.enabled ) this._playerSystems( dt );
		this._updateFalls( dt );
		this._settleModel();

		// her own hull: sinking, then a wreck (runs for every role: the hits on our boat land on our machine)
		if ( this.sinking ) this._updateSinking( dt );
		else this._holdWreck();
		this.wrecks.update( dt );

		this.fx.update( dt );
		this.planks.update( dt, this.time );
		if ( this.modMeshes ) {

			try {

				this.modMeshes.sync( this.fitting, this.app.boat, this.night );

			} catch ( e ) { /* the meshes are decoration */ }

		}

		if ( this.hud ) this.hud.update( hudModel( this ), dt );

	}

	_clearWorld() {

		for ( let i = this.ships.length - 1; i >= 0; i -- ) this._removeShip( i );
		this.shots.length = 0;
		this.balls.clear();
		this.loot.clear();
		this.planks.clear();
		this.collisions.clear();
		this.aiming = false;
		this.aimInfo = null;
		this.aimCam.blend = 0;
		this._aimFov( 0 );
		// (the ships' fires and fallen masts went with them; the player's own mast stays down)
		for ( let i = this.falls.length - 1; i >= 0; i -- ) {

			const f = this.falls[ i ];
			if ( ! f.ship ) continue;
			if ( f.vis ) f.vis.dispose();
			this.falls.splice( i, 1 );

		}

	}

	// ------------------------------------------------------------------ save / lifecycle

	toJSON() {

		const h = this.playerHull;
		return {
			v: 1,
			boat: h.boat, hp: Math.round( h.hp * 10 ) / 10, sunk: h.sunk,
			gun: { owned: !! this.playerGun.bought, level: this.playerGun.level, swivel: this.playerGun.swivel }, // bought: a ship's own battery is not saved; swivel: the bought gun's own tier
			modules: this.fitting.toJSON(),
			stats: { ...this.stats },
			wreck: this.wrecks.toJSON() || this._sinkingRecord(), // (saved mid-sinking: she is on the bottom when loaded)
			// wave 11A: the magazine, the sections, the water in her and a fire still burning; the aimed part
			ammo: this.ammo.rounds, sections: this.sections.toJSON(), flood: this.floodState.toJSON(), fire: this.fireState.toJSON(), aimPart: this.aimPart,
		};

	}

	// a save taken while she goes down records her as the wreck she is about to be
	_sinkingRecord() {

		const s = this.sinking;
		if ( ! s ) return null;
		return { boat: s.boat, x: Math.round( s.x * 100 ) / 100, z: Math.round( s.z * 100 ) / 100, yaw: Math.round( s.yaw * 100 ) / 100, loot: s.loot, abandoned: false };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		const h = this.playerHull;
		const id = typeof d.boat === 'string' && BOATS[ d.boat ] ? d.boat : h.boat;
		const g = d.gun && typeof d.gun === 'object' ? d.gun : {};
		this.playerGun.bought = !! g.owned; // (not the setter: the fit comes from the save)
		const lv = Number.isFinite( g.swivel ) ? g.swivel : g.level; // (older saves: level, raised to a ship's battery)
		this.playerGun.level = Number.isFinite( lv ) ? clamp( Math.round( lv ), 1, 3 ) : 1;
		this.fitting.fromJSON( d.modules );
		this.fitting.setBoat( id );
		// a save from before the modules: the bought swivel gun goes into an arms slot
		if ( ! d.modules && this.playerGun.bought ) this.fitting.fit( 'swivel' );
		h.boat = id;
		h.max = this._hullMax( id );
		h.hp = Number.isFinite( d.hp ) ? clamp( d.hp, 0, h.max ) : h.max;
		h.sunk = h.hp <= 0;
		this.sinking = null;
		// wave 11A (a save from before it: a full magazine, a sound rig, dry)
		this._restoreMast();
		this.sections = sectionsFor( id, h.max );
		this.sections.fromJSON( d.sections );
		this.ammo.setMax( ammoMaxFor( id ), { fill: true } );
		if ( Number.isFinite( d.ammo ) ) this.ammo.rounds = clamp( Math.round( d.ammo ), 0, this.ammo.max );
		this.floodState.fromJSON( d.flood );
		if ( this.fireState.burning ) this._fireOut( null, false, true );
		this.fireState.fromJSON( h.sunk ? null : d.fire );
		this.aimPart = AIM_PARTS.includes( d.aimPart ) ? d.aimPart : 'hull';
		this._channel = null;
		this.wrecks.fromJSON( d.wreck );
		if ( this.wrecks.own && ! this.wrecks.own.abandoned && this.wrecks.own.boat === id ) {

			h.hp = 0;
			h.sunk = true;

		}
		this._gunBoat = null; // re-read the class's battery on the next update
		this._syncGun( id );
		if ( d.stats && typeof d.stats === 'object' ) {

			for ( const k of Object.keys( this.stats ) ) if ( Number.isFinite( d.stats[ k ] ) ) this.stats[ k ] = Math.max( 0, d.stats[ k ] );

		}

	}

	reset() {

		this._clearWorld();
		this.sinking = null;
		this.wrecks.reset();
		this.fitting.reset();
		this.playerGun.owned = false;
		this.playerGun.level = 1;
		this.reloadLeft.port = this.reloadLeft.starboard = 0;
		this.reloadTotal.port = this.reloadTotal.starboard = 0;
		this.stats = { shipsSunk: 0, piratesSunk: 0, shots: 0, hits: 0, looted: 0 };
		this._merchantRespawn.length = 0;
		this.bounties.clear();
		this._initialMerchants = true;
		this._pirateAt = this.time + 6;
		this._spawnT = 0.5;
		this.playerHull.boat = null;
		this.playerHull.sunk = false;
		this.playerHull.hp = 0;
		this.aimPart = 'hull';
		for ( const f of this.falls ) if ( f.vis ) f.vis.dispose();
		this.falls.length = 0;
		this._syncBoat( true );

	}

	dispose() {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		this._clearWorld();
		this.balls.dispose();
		this.fx.dispose();
		this.loot.dispose();
		this.planks.dispose();
		this.wrecks.dispose();
		this.audio.dispose();
		if ( this.models ) this.models.dispose();
		if ( this.modMeshes ) this.modMeshes.dispose();
		if ( this.hud ) this.hud.dispose();
		const pl = this.app.player;
		if ( this._aimHook && pl && pl.aimCamera === this._aimHook ) pl.aimCamera = null;
		// the controller's own rudder back; the fire's vfx off; the masts
		const b = this.app.boatCtl, base = b && typeof b === 'object' ? this._rudderBase.get( b ) : undefined;
		if ( base !== undefined ) b.rudderLift = base;
		if ( this.fireState.burning ) this._fireOut( null, false, true );
		this._restoreMast();
		for ( const f of this.falls ) if ( f.vis ) f.vis.dispose();
		this.falls.length = 0;

	}

}
