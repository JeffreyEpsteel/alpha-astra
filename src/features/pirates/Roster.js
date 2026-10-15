// The sixteen named pirate identities of the Unreal world catalog (naval fork scripts/author-world-catalog.py SPECS:
// key, captain, ship, type, hull, crew size, disposition) with the traits this game gives them, and the Roster that puts
// them to sea through the naval feature's public spawn API (naval.spawn( kind, opts ) -> Ship).
//
//   CAPTAINS[ i ]  { id, captain, ship, type: 'cutter' | 'corsair' | 'smuggler' | 'hunter' | 'patrol' | 'wreck', hull ('sloop' |
//                    'brigantine' | 'trawler'), crew, disposition (-100 hostile .. 100 friendly), tier 1..5, traits: [ ... ] }
//   TRAITS         what each trait does (applied here to the spawned Ship, read by Hostile.js, Retaliation.js and SearchZones.js)
//   const r = new Roster( pirates );   r.update( dt )   r.spawn( id, opts ) -> Ship | null   r.shipOf( id )   r.captainOfShip( ship )
//
// Types (the catalog's EPirateVesselType): cutters and corsairs hunt the player; smugglers are pirate-friendly traders (trawlers
// that sell tips, see SearchZones informants); hunters are rival bounty hunters (they can beat the player to a contract); patrols
// are the navy (they leave you alone until your notoriety is high, then they hunt you too); the wreck is The Sunken Bell, a
// crewless brigantine that drifts out at night.
// Ship states this feature adds (the naval brains ignore states they do not know, so the feature steers them itself):
// 'moored' (at a den, still), 'regroup' (sail back to the den / a patrol lane after a beating, then patrol again).
// Hostile.js (boarding) adds 'close' / 'grapple' / 'boarding'.

import { PATROLS, inSafeZone } from '../naval/Routes.js';

export const TRAITS = {
	boarder: 'closes to board the player\'s boat (Hostile.js) rather than trade broadsides',
	vengeful: 'answers any harm to her crew or den with a retaliation raid (Retaliation.js)',
	night: 'only puts to sea between dusk and dawn',
	storm: 'puts to sea in storms (and at night)',
	tough: 'hull points x1.35',
	gunner: 'shot damage x1.25',
	stubborn: 'never runs (fleeAt 0)',
	cunning: 'runs early (fleeAt 0.45) and is harder to pin down (bigger search zone)',
	informant: 'sells a tip on a wanted captain when met at sea (narrows a search zone)',
	rival: 'hunts the same bounties (can claim a contract first)',
	lawful: 'navy: leaves the player alone below notoriety 4',
	ghost: 'no crew; drifts and never fires',
};

// [ key, captain, ship, type, hull, crew, disposition, tier, traits ]
const SPECS = [
	[ 'Redwake', 'Mara Redwake', 'The Copper Gull', 'cutter', 'sloop', 3, - 65, 3, [ 'boarder' ] ],
	[ 'Brinehook', 'Brinehook Bill', 'Salt and Splinters', 'corsair', 'brigantine', 6, - 75, 5, [ 'boarder', 'vengeful', 'tough' ] ],
	[ 'ReedJack', 'Reed Jack', 'The Narrow Escape', 'cutter', 'sloop', 3, - 45, 3, [ 'cunning' ] ],
	[ 'Mossbeard', 'Mossbeard', 'Old Green Teeth', 'corsair', 'brigantine', 5, - 60, 4, [ 'stubborn', 'tough' ] ],
	[ 'PearlNell', 'Pearl Nell', 'The Quiet Pearl', 'smuggler', 'trawler', 3, 5, 1, [ 'informant' ] ],
	[ 'BlackLantern', 'Captain Black Lantern', 'Midnight Lantern', 'corsair', 'brigantine', 7, - 85, 5, [ 'night', 'boarder', 'vengeful', 'gunner' ] ],
	[ 'FlintFin', 'Flint Fin', 'Flintlock Drift', 'hunter', 'sloop', 4, 30, 2, [ 'rival', 'gunner' ] ],
	[ 'HarbourWard', 'Warden Oakes', 'Harbour Ward', 'patrol', 'brigantine', 6, 55, 3, [ 'lawful', 'tough' ] ],
	[ 'Saffron', 'Saffron Sid', 'The Spice Runner', 'smuggler', 'trawler', 3, 10, 1, [ 'informant', 'cunning' ] ],
	[ 'TinShark', 'Tin Shark', 'The Rusty Bite', 'cutter', 'sloop', 4, - 55, 4, [ 'boarder', 'vengeful', 'cunning' ] ],
	[ 'StormIris', 'Storm Iris', 'Violet Squall', 'corsair', 'brigantine', 6, - 70, 5, [ 'storm', 'gunner', 'vengeful' ] ],
	[ 'ReedWatch', 'Sergeant Reed', 'Reed Watch', 'patrol', 'sloop', 4, 45, 2, [ 'lawful' ] ],
	[ 'HookHester', 'Hook Hester', 'Honest Hooks', 'hunter', 'sloop', 4, 25, 2, [ 'rival', 'boarder' ] ],
	[ 'DriftDuke', 'Drift Duke', 'The Last Barrel', 'smuggler', 'trawler', 3, 0, 1, [ 'informant' ] ],
	[ 'Barnacle', 'Barnacle Ben', 'Barnacle Crown', 'cutter', 'sloop', 3, - 50, 3, [ 'stubborn' ] ],
	[ 'LostBell', 'Captain Lost Bell', 'The Sunken Bell', 'wreck', 'brigantine', 1, - 10, 2, [ 'ghost', 'night' ] ],
];

export const CAPTAINS = SPECS.map( ( [ key, captain, ship, type, hull, crew, disposition, tier, traits ] ) => ( {
	id: key, captain, ship, type, hull, crew, disposition, tier, traits,
	hostile: type === 'cutter' || type === 'corsair',
} ) );

export const CAPTAIN_BY_ID = Object.fromEntries( CAPTAINS.map( ( c ) => [ c.id, c ] ) );
export const captainByName = ( name ) => CAPTAINS.find( ( c ) => c.captain === name || c.ship === name ) || null;
export const hasTrait = ( c, t ) => !! ( c && c.traits && c.traits.includes( t ) );

// the faction the naval feature should give a type (its brains: 'pirate' hunts and fires, anything else sails its route)
export function factionFor( c, { notoriety = 0, standing = 0 } = {} ) {

	if ( c.type === 'patrol' ) return notoriety >= 4 ? 'pirate' : 'navy';
	if ( c.type === 'smuggler' || c.type === 'wreck' ) return 'merchant';
	if ( c.type === 'hunter' ) return notoriety >= 3 ? 'pirate' : 'merchant'; // a hunter takes a shot at a notorious skipper
	// a corsair who likes you enough lets you pass
	return c.disposition + standing > 20 ? 'merchant' : 'pirate';

}

export const AMBIENT = { day: 1, night: 2, storm: 1, max: 3, every: 24, minDist: 340, roomFor: 7 };

export class Roster {

	constructor( pirates ) {

		this.p = pirates;
		this.live = new Map(); // captain id -> Ship
		this._t = 8; // s to the first ambient check
		this.spawned = 0;

	}

	get naval() {

		return this.p.naval;

	}

	shipOf( id ) {

		const s = this.live.get( id );
		return s && s.alive ? s : null;

	}

	captainOfShip( ship ) {

		if ( ! ship ) return null;
		if ( ship.pirateId && CAPTAIN_BY_ID[ ship.pirateId ] ) return CAPTAIN_BY_ID[ ship.pirateId ];
		return this.captainOfShipId( ship.id );

	}

	captainOfShipId( shipId ) {

		for ( const [ id, s ] of this.live ) if ( s.id === shipId ) return CAPTAIN_BY_ID[ id ];
		return null;

	}

	// put a named captain to sea. o: x, z, yaw, route ([ [ x, z ] ]), loop, index, state, speed, alert (s of hunting the player)
	spawn( id, o = {} ) {

		const c = CAPTAIN_BY_ID[ id ], nv = this.naval;
		if ( ! c || ! nv || ! nv.spawn || ! this.p.ledger.isFree( id ) || this.shipOf( id ) ) return null;
		let s = null;
		try {

			s = nv.spawn( c.hull, {
				id: `pirate-${ c.id }-${ ++ this.spawned }`, x: o.x ?? 0, z: o.z ?? 0, yaw: o.yaw ?? 0, name: c.ship, captain: c.captain,
				route: o.route, loop: o.loop ?? true, index: o.index ?? 0, state: o.state, speed: o.speed ?? 0,
			} );

		} catch ( e ) {

			console.warn( 'pirates: naval.spawn failed', e );
			return null;

		}

		if ( ! s ) return null;
		s.pirateId = c.id;
		s.traits = c.traits.slice();
		s.crewSize = c.crew;
		s.faction = factionFor( c, this.p.standingInfo() );
		s.homeFaction = s.faction;
		if ( hasTrait( c, 'tough' ) ) s.maxHp = Math.round( s.maxHp * 1.35 );
		s.maxHp = Math.round( s.maxHp * ( 1 + 0.06 * ( c.tier - 1 ) ) );
		s.hp = s.maxHp;
		if ( hasTrait( c, 'gunner' ) ) s.dmgMul = ( s.dmgMul || 1 ) * 1.25;
		if ( hasTrait( c, 'stubborn' ) || hasTrait( c, 'ghost' ) ) s.fleeAt = 0;
		else if ( hasTrait( c, 'cunning' ) ) s.fleeAt = 0.45;
		if ( o.alert ) s.alertT = o.alert; // naval's brains: she hunts from farther while > 0
		s._lastHp = s.hp;
		this.live.set( c.id, s );
		return s;

	}

	// a patrol lane point far from the player (no pop-in) and out of the safe harbours
	lanePoint( minDist = AMBIENT.minDist ) {

		const pl = this.p.playerPos(), nv = this.naval;
		let best = null, bd = - 1;
		for ( let r = 0; r < PATROLS.length; r ++ ) PATROLS[ r ].forEach( ( q, i ) => {

			const d = pl ? Math.hypot( q[ 0 ] - pl.x, q[ 1 ] - pl.z ) : 1e6;
			const taken = nv && nv.ships.some( ( s ) => s.alive && Math.hypot( s.x - q[ 0 ], s.z - q[ 1 ] ) < 120 );
			if ( d > bd && ! taken && ! inSafeZone( q[ 0 ], q[ 1 ] ) ) { bd = d; best = { r, i, q }; }

		} );
		if ( ! best || bd < minDist ) return null;
		const pts = PATROLS[ best.r ], nxt = ( best.i + 1 ) % pts.length;
		return { x: best.q[ 0 ], z: best.q[ 1 ], yaw: Math.atan2( pts[ nxt ][ 0 ] - best.q[ 0 ], pts[ nxt ][ 1 ] - best.q[ 1 ] ), route: pts, index: nxt };

	}

	// who may sail now: free, not at sea, not kept for a den or a contract, the night / storm traits respected
	candidates() {

		const night = this.p.night, storm = this.p.storm;
		return CAPTAINS.filter( ( c ) => {

			if ( ! this.p.ledger.isFree( c.id ) || this.shipOf( c.id ) || this.p.reserved( c.id ) ) return false;
			if ( hasTrait( c, 'night' ) && ! night ) return false;
			if ( hasTrait( c, 'storm' ) ) return storm || night;
			return true;

		} );

	}

	wanted() {

		return Math.min( AMBIENT.max, AMBIENT.day + ( this.p.night ? AMBIENT.night - 1 : 0 ) + ( this.p.storm ? AMBIENT.storm : 0 ) );

	}

	update( dt ) {

		// forget ships the naval feature let go (a sinking is handled by the shipSunk listener first)
		for ( const [ id, s ] of this.live ) {

			if ( s.state !== 'gone' && this.naval && this.naval.ships.includes( s ) ) continue;
			this.live.delete( id );
			if ( s.escaped ) this.p._onCaptainEscaped( CAPTAIN_BY_ID[ id ], s );

		}

		this._t -= dt;
		if ( this._t > 0 ) return;
		this._t = AMBIENT.every;
		const nv = this.naval;
		if ( ! nv || nv.active === false || nv.ships.length >= AMBIENT.roomFor ) return; // leave naval room for its own ships
		let ambient = 0;
		for ( const s of this.live.values() ) if ( s.alive && ! s.raid && ! s.denGuard && ! s.highBounty ) ambient ++;
		if ( ambient >= this.wanted() ) return;
		const list = this.candidates();
		if ( ! list.length ) return;
		const at = this.lanePoint();
		if ( ! at ) return;
		const c = list[ Math.floor( this.p.rng() * list.length ) % list.length ];
		this.spawn( c.id, { ...at, speed: 3 } );

	}

	clear() {

		this.live.clear();

	}

}
