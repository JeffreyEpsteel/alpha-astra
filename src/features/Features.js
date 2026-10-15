// Feature registry: the v2 systems (weather, trade, naval combat, notices / bounties, melee, ship audio)
// plug into the game through this one object, so each lives in its own folder (src/features/<name>/)
// and the core files (App.js, Game.js, GameState.js) only need a few generic hooks.
//
//   const features = new Features( app );
//   features.add( 'weather', weatherModule );          // module: { install( app, features ) -> instance }
//   features.update( dt );                               // per frame, after game.update
//   features.on( 'shipSunk', ( e ) => ... ); features.emit( 'shipSunk', { ... } );
//
// Instances may implement: update( dt ), dispose(), toJSON() / fromJSON( data ) (their part of the save),
// reset() (a new game), and keys they handle themselves (see claimKey).
//
// Interactables: features register things the player can use with E. Game asks for the nearest one when
// nothing else (vendor, boat, resident) has the prompt:
//   features.interactable( { id, position: { x, y, z } | () => ( { x, y, z } ), radius = 2.5, prompt: () => text | null,
//                            onInteract: () => void, when: () => bool } )   -> returns a remover
//   features.nearestInteractable( playerPosition ) -> entry | null
//
// Events (the shared vocabulary; payloads are plain objects):
//   fishCaught   { species, kg, value, habitat, aboard }     fishSold   { count, total, port }
//   cargoBought  { good, qty, price, port }                  cargoSold  { good, qty, price, port, profit }
//   shipSunk     { id, name, faction: 'pirate' | 'merchant' | 'navy', x, z, byPlayer }
//   playerBoatDamaged { hp, maxHp, cause }                   playerBoatSunk { cause }
//   enemyDefeated { id, name, kind }                         playerKnockedDown { by }
//   weatherChanged { kind, previous, intensity }             portVisited { port }
//   bountyClaimed { id, target, reward }                     noticeCompleted { id, reward }
//   (v3) cannonFired { x, y, z, dir: { x, y, z }, side, by: 'player' | 'pirate' | 'remote' }
//   cannonballImpact { x, y, z, vx, vy, vz, energy, hit: 'water' | 'ship' | 'land' | 'prop', target }
//   propDestroyed { id, kind, x, y, z, by, port }   propRespawned { id, kind }   meleeHit { x, y, z, range, energy, by }   planeCrashed { x, y, z, speed, mass }                  planeTookOff { id } / planeLanded { id, onWater }
//   remoteWorldEvent { kind, data, from, at, replay }         universeJoined { bountySeed } (netsync; replay = stored event on join)
//   questAccepted / questStep / questCompleted / questAbandoned { id, ... }   reputationChanged { port, rep, delta }
//   denRaided / captainKilled / notorietyChanged / retaliationRaid / highBountyAccepted / highBountyFailed (pirates)
//   hostileBoarding / grappleBroken / boardersRepelled / boardersWon / ransomPaid (boarding Hostile)
//   residentTalked / harbourBuff / rumourHeard / diceRolled / shelfMade (harbour)   townsfolkTalked { id, name, role, port } (townlife)   itemCrafted / lureWorn (crafting)
//   treasureFound { id, kind, how } / treasureClaimed { id, kind, money, trinket } (exploration)   invertedEgg (world event)
//   planeCrashed { id, cause, x, z, cost }   seaplaneBought { id, price }
//   crewHired / crewQuit / crewDrunk / crewFetched / crewBanter / crewLevel (crew life, wave 19C)
//   (death) playerDied { cause, by, x, y, z } / playerRespawned / crateClaimed / crateExpired / wreckSalvaged / wreckLooted; world events wreck / wreckSalvaged
//   (trade v3) marketEvent, loanTaken / loanRepaid / loanOverdue / loanDefaulted / debtCollected, merchantStanding, haulAccepted / haulDelivered /
//   haulFailed, licenceBought, rivalVoyage / rivalArrived / rivalLost, smugglerDeal / smugglerGear, baitBought / baitOut, wagesPaid / wagesMissed,
//   crewDeserted / crewReturned   (customs) customsInspected, contrabandSeized, customsBribed, contrabandDumped, harbourBan
//   storyItem { id }   residentPrank { id }   moduleBought { id, tier, price } / moduleFitted { id, slot } / moduleRemoved { id }   nightPhase { phase, previous, night }
//   waypointChanged { waypoint }                             (worldmap: a map click, null when cleared)
//   explosion { x, y, z, radius, energy }                    (destruction listens to impacts and explosions)
//   hullsCollided { a, b, x, z, speed, damage: { a, b }, byPlayer }   shipCrippled { id, name, by?, x?, z? } (naval / boarding)
//   gunshot { ... }                                          (firearms: a pistol / musket shot, synced as a world event)
//   gullSquawk { x, y, z }   emote { id }                    (life cues; emotes, synced as a world event)
//   seaplaneUpgraded { airframe, upgrade }   planeBailedOut   chuteLanded { x, y, z, water }   planeEngineFailed { engine }   (seaplane)
//   hostRequest { kind, data, from, local }   (netsync: a guest asked the host to run something; local when this is the host)
//   harbourDues { port, amount }   insuranceBought / insuranceClaim   warehouseStored / warehouseWithdrawn / warehouseRent   fishHallBonus   (trade, wave 15B)
//   climbedAboard { ship }   flaresBought   rescueAnswered { by }   rescueAlongside   rescueDelivered   rescueAbandoned   flareFired { x, z }   (rescue, wave 15D)
//   vesselTaken { id, class, by }   sailSighted   (hijack / pirates, wave 15C)
//   castawayRescued { x, z }   routeRun { from, to, good, profit }   (story, wave 16D)
//   practiceStarted { count }   practiceEnded { result }   rockThrown { by, x, z }   (melee: the practice fight, the rock thrower)
//   questPin { id, x, z, label }   questPinClear { id }        (story -> the maps: a quest step's place)
//   (navy) navyHail navyBoarded navyBounty navyBountyPaid navyStanding pressGang convoyAttacked convoySaved convoyLost manOverboardRescued; world events navyWanted / navyHail   (weather) frontArrived lightningStrike
//   (citywreck, wave 21C) buildingDamaged buildingCollapsed buildingDestroyed buildingRespawned buildingRepaired cityFire cityFireCall cityCrew
//   cityFireSpread cityRepair roadBlocked { id, edges, x, z, radius } roadCleared cityDebris cityMood cityWanted { level } towerMarked; firePool { id, x, y, z, by }
//   (weapons); world event cityStages (host -> all); hostRequest cityHit / citySnap
//
// Mode rules (Sandbox / Campaign / Multiplayer): features.mode is app.mode or 'campaign'; features.sandbox.
// Money and the save stay in GameState: features.state is app.game.state (money, earn, spend, career...).
import { isOnlineSession } from '../game/GameMode.js';

export class Features {

	constructor( app ) {

		this.app = app;
		this.list = new Map(); // name -> { module, instance }
		this._listeners = new Map();
		this._interactables = new Set();
		this._keys = new Map(); // key code -> feature name
		this.data = {}; // saved per-feature data (toJSON / fromJSON), mirrored into the save by the game

	}

	get state() {

		return this.app && this.app.game ? this.app.game.state : null;

	}

	get mode() {

		return ( this.app && this.app.mode ) || 'campaign';

	}

	get sandbox() {

		return this.mode === 'sandbox' && ! isOnlineSession( this.app );

	}

	add( name, module ) {

		if ( this.list.has( name ) ) return this.list.get( name ).instance;
		let instance = null;
		try {

			instance = module.install ? module.install( this.app, this ) : null;

		} catch ( e ) {

			console.warn( `feature ${ name } failed to install`, e );
			return null;

		}

		this.list.set( name, { module, instance } );
		if ( instance && instance.fromJSON && this.data[ name ] !== undefined ) {

			try { instance.fromJSON( this.data[ name ] ); } catch ( e ) { console.warn( `feature ${ name }: bad save data`, e ); }

		}

		return instance;

	}

	get( name ) {

		const f = this.list.get( name );
		return f ? f.instance : null;

	}

	update( dt ) {

		for ( const [ name, f ] of this.list ) {

			if ( ! f.instance || ! f.instance.update ) continue;
			try {

				f.instance.update( dt );

			} catch ( e ) {

				// one broken feature must not stop the frame: report once, then keep it quiet
				if ( ! f.failed ) console.warn( `feature ${ name } update failed`, e );
				f.failed = true;

			}

		}

	}

	// ---- events

	on( name, fn ) {

		if ( ! this._listeners.has( name ) ) this._listeners.set( name, new Set() );
		this._listeners.get( name ).add( fn );
		return () => this._listeners.get( name ).delete( fn );

	}

	emit( name, payload = {} ) {

		const set = this._listeners.get( name );
		if ( ! set ) return;
		for ( const fn of [ ...set ] ) {

			try { fn( payload ); } catch ( e ) { console.warn( `listener of ${ name } failed`, e ); }

		}

	}

	// ---- interactables (E)

	interactable( entry ) {

		const e = { radius: 2.5, when: () => true, ...entry };
		this._interactables.add( e );
		return () => this._interactables.delete( e );

	}

	nearestInteractable( p ) {

		let best = null, bd = Infinity;
		for ( const e of this._interactables ) {

			let ok = true;
			try { ok = e.when(); } catch ( err ) { ok = false; }
			if ( ! ok ) continue;
			const q = typeof e.position === 'function' ? e.position() : e.position;
			if ( ! q ) continue;
			const d = Math.hypot( q.x - p.x, q.z - p.z );
			if ( d > e.radius || Math.abs( ( q.y ?? p.y ) - p.y ) > 3 ) continue;
			if ( d < bd ) { bd = d; best = e; }

		}

		return best;

	}

	// ---- keys: a feature claims a key code so two features never fight over one
	claimKey( code, name ) {

		const owner = this._keys.get( code );
		if ( owner && owner !== name ) {

			console.warn( `key ${ code } is already used by ${ owner }; ${ name } did not get it` );
			return false;

		}

		this._keys.set( code, name );
		return true;

	}

	// ---- panels and the mouse: a feature window open (isOpen) blocks fishing input; Escape closes them;
	// a feature that wants the left button this frame (melee) takes it from the rod
	panelOpen() {

		for ( const f of this.list.values() ) {

			const i = f.instance;
			if ( ! i ) continue;
			const open = typeof i.isOpen === 'function' ? i.isOpen() : i.isOpen;
			if ( open ) return true;

		}

		return false;

	}

	closePanels() {

		for ( const f of this.list.values() ) if ( f.instance && f.instance.close ) try { f.instance.close(); } catch ( e ) { /* ignore */ }

	}

	wantsMouse() {

		for ( const f of this.list.values() ) if ( f.instance && f.instance.wantsMouse ) try { if ( f.instance.wantsMouse() ) return true; } catch ( e ) { /* ignore */ }
		return false;

	}

	// ---- save
	toJSON() {

		const out = { ...this.data };
		for ( const [ name, f ] of this.list ) {

			if ( f.instance && f.instance.toJSON ) {

				try { out[ name ] = f.instance.toJSON(); } catch ( e ) { /* keep the last good data */ }

			}

		}

		return out;

	}

	fromJSON( d ) {

		this.data = d && typeof d === 'object' ? { ...d } : {};
		for ( const [ name, f ] of this.list ) {

			if ( f.instance && f.instance.fromJSON && this.data[ name ] !== undefined ) {

				try { f.instance.fromJSON( this.data[ name ] ); } catch ( e ) { console.warn( `feature ${ name }: bad save data`, e ); }

			}

		}

	}

	reset() {

		this.data = {};
		for ( const f of this.list.values() ) if ( f.instance && f.instance.reset ) f.instance.reset();

	}

	dispose() {

		for ( const f of this.list.values() ) if ( f.instance && f.instance.dispose ) f.instance.dispose();
		this.list.clear();
		this._listeners.clear();
		this._interactables.clear();

	}

}
