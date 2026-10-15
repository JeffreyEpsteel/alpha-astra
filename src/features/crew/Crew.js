// The crew's headless logic (wave 10): hired roster characters posted aboard as gunners or anglers. No engine, no DOM:
// test/feature-crew.mjs drives it in node; index.js wires it to the game (naval's guns, the cooler, the deck figures).
//
//   BERTHS[ boatId ]            crew berths per hull when Boats.js has no `berths` (skiff 0, canoe 0, cutter 1, launch 1,
//                               lobster 2, trawler 3, sloop 3, brigantine 4); berthsOf( id ) reads Boats.js first
//   CREW_RULES                  the numbers (gunner reload x1.6 / spread x1.5, two gunners at most: one per broadside; anglers
//                               land a fish every 45-90 s, at half rate trolling under 4 m/s, never above it)
//   const crew = new Crew( { rng } )
//   ctx = { boat, unlocked: [ ids ], character }      the save's view (GameState: boat, unlocked, character)
//   crew.canPost( id, post, ctx ) -> { ok, reason }   reason: 'unknown' | 'playing' | 'not hired' | 'no berths' | 'full' | 'guns manned'
//   crew.setPost( id, 'off' | 'gunner' | 'angler', ctx ) -> { ok, reason }
//   crew.sync( ctx ) -> [ { id, post, why: 'playing' | 'berth' } ]   drops the played character's post and the posts past the
//                               hull's berths (the most recently posted go ashore first; without a boat the posts wait)
//   crew.rows( ctx ) -> [ { id, name, hired, playing, post, side, choices: [ { post, label, on, enabled, why } ] } ]  (posting UI)
//   crew.gunners( ctx? ) / anglers( ctx? ) -> [ ids ] in posting order (with ctx: on duty only);  crew.sides  Map id -> side
//   crew.assignSides( nearSide )   the first gunner takes the side facing the nearest hostile (else keeps his), the second the other
//   crew.tickGunners( dt, { aboard, naval } ) -> [ { id, side, target } ]   each gunner fires his side through
//                               naval.crewFire( side, { reloadMul, spreadMul, crew: id } ) while the skipper is aboard
//   crew.tickAnglers( dt, { rate, habitat, hour, fits, bait } ) -> [ { id, species, kg, habitat, text } | { id, full: true, text } ]
//                               rate: anglerRate(); habitat() the water by the rail (Bites.habitatAt weights); fits( kg ) room in
//                               the cooler; bait() the delay factor of the next cast (trade's operating.useBait: it takes one)
//   crew.hudLine( naval, ctx? ) -> 'Gunners: Pepe (port, ready) · Doge (stbd, 3.2 s)' | null
//   crew.toJSON() / fromJSON( d ) / reset()
//   deckPoint( boatId, post, slot, side, deckY ) -> { x, y, z, yaw }   where a posted member stands (boat frame), facing outboard
//   anglerRate( { atSea, speed, anchored } ) -> 1 | 0.5 | 0          catchInterval( habitat, rng, bait ) -> s
//
// Wave 19C (a crew with lives, Life.js): two more posts (a cook at the stove, a lookout; one each), a life record per member
// (crew.member( id ): morale, rest, food, skills, traits, leaving / ashore / absent), tavern hands beside the roster
// (crew.sailors Map id -> { id, name, look, port, traits, wage, ... }; crew.hire( sailor ) / dismiss( id )), and the skills at
// work: a gunner's reload / spread (Life.gunneryMuls), an angler's bite rate (anglingMul); both grow with use.
//   crew.known( id ) / nameOf( id ) / lookOf( id ) (the roster GLB a hand wears)   crew.isHired( id, ctx )   crew.present( id )
//   tickAnglers( dt, { ..., onDuty: ( id ) => bool } )   an angler off duty (asleep, at a meal) leaves the line in

import { BOATS } from '../../game/Boats.js';
import { CHARACTERS } from '../../game/Characters.js';
import { FISH } from '../../game/FishTable.js';
import { pickSpecies, rollWeight } from '../../game/Bites.js';
import { LIFE, rosterMember, newMember, grow, gunneryMuls, anglingMul } from './Life.js';

export const BERTHS = { skiff: 0, canoe: 0, cutter: 1, launch: 1, lobster: 2, trawler: 3, sloop: 3, brigantine: 4 };
export const POSTS = [ 'off', 'gunner', 'angler', 'cook', 'lookout' ];
export const POST_LABELS = { off: 'Off', gunner: 'Gunner', angler: 'Angler', cook: 'Cook', lookout: 'Lookout' };
const ONE_EACH = { cook: 'cook taken', lookout: 'lookout taken' }; // one cook, one lookout aboard
export const CREW_RULES = {
	reloadMul: 1.6, // a gunner's reload against the skipper's
	spreadMul: 1.5, // and his spread
	maxGunners: 2, // one per broadside
	catchMin: 45, catchMax: 90, // s between an angler's fish (rich water .. thin open water)
	still: 2.5, // m/s: under this (or at anchor) the anglers fish at full rate
	troll: 4, // m/s: under this they troll at half rate
	trollRate: 0.5,
	portRadius: 70, // m from a port's dock: in port, nobody fishes
	fullRetry: 30, // s: the cooler was full, try again (a smaller fish may fit)
	emptyRetry: 20, // s: nothing bit here
	baitMax: 1.8, // a bare hook's slowest
	phoneAnimated: 2, // crew figures animated at once on a phone
};

// per-hull deck spots where the generic layout would put someone inside a wheelhouse (boat frame, port side; mirrored)
const DECK = {
	lobster: { gunner: { x: 1.15, z: - 1.35 }, angler: { x: 1.0, z: - 2.3 }, row: 1.0, cook: { x: - 0.75, z: - 1.9, yaw: - Math.PI / 2 }, lookout: { x: 0, z: 2.9 }, rest: { z: - 2.9, r: 0.55 } },
};

// where the hands off duty gather (boat frame): a ring round a spot aft of amidships, each facing its middle (dice, a meal, a
// yarn; asleep under the awning). Small boats have no room: null (they rest at their post).
export function restPoint( boatId, slot = 0, n = 1, deckY = null ) {

	const b = BOATS[ boatId ];
	if ( ! b ) return null;
	const o = DECK[ boatId ];
	const y = Number.isFinite( deckY ) ? deckY : b.deckY;
	const c = o && o.rest ? o.rest : b.kind === 'ship' ? { z: - b.length * 0.22, r: 0.95 } : null;
	if ( ! c ) return null;
	const a = ( slot / Math.max( 1, n ) ) * Math.PI * 2 + 0.4;
	const x = Math.sin( a ) * c.r, z = c.z + Math.cos( a ) * c.r;
	return { x, y, z, yaw: Math.atan2( - x, c.z - z ) };

}

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const sideName = ( s ) => ( s === 'starboard' ? 'stbd' : 'port' );

export function berthsOf( id ) {

	const b = BOATS[ id ];
	if ( ! b ) return 0;
	if ( Number.isFinite( b.berths ) ) return Math.max( 0, Math.floor( b.berths ) );
	return BERTHS[ id ] ?? 0;

}

export function deckPoint( boatId, post, slot = 0, side = 'port', deckY = null ) {

	const b = BOATS[ boatId ] || BOATS.lobster;
	const o = DECK[ boatId ] || null;
	const y = Number.isFinite( deckY ) ? deckY : b.deckY;
	const ship = b.kind === 'ship';
	if ( post === 'gunner' ) {

		const sg = side === 'starboard' ? - 1 : 1;
		if ( o && o.gunner ) return { x: sg * o.gunner.x, y, z: o.gunner.z, yaw: sg * Math.PI / 2 };
		if ( b.broadside ) {

			// between the side's guns, just inboard of the rail
			const zs = b.broadside.z;
			const mid = zs.reduce( ( a, c ) => a + c, 0 ) / zs.length;
			return { x: sg * Math.max( 0.4, b.broadside.x - 0.75 ), y, z: mid, yaw: sg * Math.PI / 2 };

		}

		// beside the swivel gun (12 % of the length forward of amidships, Naval._gunPlan), a step aft of it
		return { x: sg * Math.max( 0.3, b.beam / 2 - 0.45 ), y, z: b.length * 0.12 - 0.55, yaw: sg * Math.PI / 2 };

	}

	// the cook at the stove (amidships on a ship, by the wheelhouse on the lobster boat, beside the helm seat on a small boat), the
	// lookout in the bows facing ahead
	if ( post === 'cook' ) {

		if ( o && o.cook ) return { x: o.cook.x, y, z: o.cook.z, yaw: o.cook.yaw ?? Math.PI };
		return ship ? { x: 0.6, y, z: - b.length * 0.05, yaw: - Math.PI / 2 } : { x: Math.max( 0.3, b.beam / 2 - 0.5 ), y, z: 0.5, yaw: Math.PI / 2 };

	}

	if ( post === 'lookout' ) {

		if ( o && o.lookout ) return { x: o.lookout.x, y, z: o.lookout.z, yaw: 0 };
		return { x: 0, y, z: b.length * ( ship ? 0.36 : 0.26 ), yaw: 0 };

	}

	// anglers at the rail toward the stern, alternating port / starboard, a row further aft every two
	const sg = slot % 2 ? - 1 : 1;
	const row = Math.floor( slot / 2 );
	if ( o && o.angler ) return { x: sg * o.angler.x, y, z: o.angler.z - row * ( o.row || 1.2 ), yaw: sg * Math.PI / 2 };
	return {
		x: sg * Math.max( 0.3, b.beam / 2 - ( ship ? 0.7 : 0.4 ) ), y,
		z: - b.length * ( ship ? 0.12 : 0.18 ) - row * 1.3, yaw: sg * Math.PI / 2,
	};

}

export function anglerRate( { atSea = false, speed = 0, anchored = false } = {} ) {

	if ( ! atSea ) return 0;
	if ( anchored || speed < CREW_RULES.still ) return 1;
	if ( speed < CREW_RULES.troll ) return CREW_RULES.trollRate;
	return 0;

}

export function richness( h ) {

	let r = 0;
	for ( const k in h ) r += h[ k ] || 0;
	return r;

}

// the habitat with the most weight ('bay' when there is none): the catch's `habitat` for the career / quests
export function mainHabitat( h ) {

	let best = 0, name = 'bay';
	for ( const k in h ) if ( h[ k ] > best ) { best = h[ k ]; name = k; }
	return name;

}

// seconds to the angler's next fish: 90 s in thin open water down to 45 s over rich water, a little jitter, and a bare hook
// (bait factor > 1) slower like the skipper's casts
export function catchInterval( h, rng = Math.random, bait = 1 ) {

	const R = CREW_RULES;
	const t = clamp( ( richness( h ) - 0.35 ) / 1.0, 0, 1 );
	const base = R.catchMax - ( R.catchMax - R.catchMin ) * t;
	const s = clamp( base * ( 0.85 + 0.3 * rng() ), R.catchMin, R.catchMax );
	return s * clamp( Number.isFinite( bait ) ? bait : 1, 1, R.baitMax );

}

export class Crew {

	constructor( { rng = Math.random } = {} ) {

		this.rng = rng;
		this.posts = new Map(); // id -> 'gunner' | 'angler' | 'cook' | 'lookout' (insertion order = posting order)
		this.sides = new Map(); // gunner id -> 'port' | 'starboard'
		this.wait = new Map(); // angler id -> { t, full }
		this.stats = new Map(); // id -> { shots, catches }
		this.life = new Map(); // id -> Life member (morale, rest, food, skills, traits, ...): made on first use
		this.sailors = new Map(); // tavern hands signed on: id -> { id, name, look, port, traits, wage, watch, hiredDay }
		this.gone = new Set(); // tavern hands who signed off (never offered again)
		this._lastSide = 'port';

	}

	known( id ) {

		return !! ( CHARACTERS[ id ] || this.sailors.has( id ) );

	}

	nameOf( id ) {

		const c = CHARACTERS[ id ], s = this.sailors.get( id );
		return c ? c.name : s ? s.name : String( id );

	}

	// the roster GLB the figure wears (a tavern hand wears one of the harbour folk's)
	lookOf( id ) {

		const s = this.sailors.get( id );
		return s && CHARACTERS[ s.look ] ? s.look : id;

	}

	member( id ) {

		let m = this.life.get( id );
		if ( ! m && this.known( id ) ) {

			const s = this.sailors.get( id );
			m = s ? newMember( { traits: s.traits, skills: s.skills, watch: s.watch } ) : rosterMember( id );
			this.life.set( id, m );

		}

		return m || null;

	}

	// aboard and able to work: not walked off, not asleep under a tavern table
	present( id ) {

		const m = this.life.get( id );
		return ! m || ( ! m.ashore && ! m.absent );

	}

	isHired( id, ctx = {} ) {

		return this.sailors.has( id ) || ( !! CHARACTERS[ id ] && ( ctx.unlocked || [] ).includes( id ) );

	}

	postOf( id ) {

		return this.posts.get( id ) || 'off';

	}

	hired( ctx = {} ) {

		const out = ( ctx.unlocked || [] ).filter( ( id ) => CHARACTERS[ id ] && id !== ctx.character );
		for ( const id of this.sailors.keys() ) out.push( id );
		return out;

	}

	// the posted members of a post, in posting order; with ctx only the ones on duty (hired, aboard, not the one being played)
	_of( post, ctx ) {

		// (a plain walk in posting order: this runs several times a frame; no entry arrays, no spread copies)
		const out = [], un = ctx ? ( ctx.unlocked || [] ) : null;
		for ( const id of this.posts.keys() ) {

			if ( this.posts.get( id ) !== post ) continue;
			if ( ctx && ( id === ctx.character || ! ( this.sailors.has( id ) || un.includes( id ) ) || ! this.present( id ) ) ) continue;
			out.push( id );

		}

		return out;

	}

	gunners( ctx = null ) {

		return this._of( 'gunner', ctx );

	}

	anglers( ctx = null ) {

		return this._of( 'angler', ctx );

	}

	// every posted hand aboard (any post), in posting order
	aboard( ctx = null ) {

		const out = [];
		for ( const p of POSTS ) if ( p !== 'off' ) for ( const id of this._of( p, ctx ) ) out.push( id );
		return out;

	}

	canPost( id, post, ctx = {} ) {

		if ( ! POSTS.includes( post ) ) return { ok: false, reason: 'unknown' };
		if ( post === 'off' ) return { ok: true };
		if ( ! this.known( id ) ) return { ok: false, reason: 'unknown' };
		if ( id === ctx.character ) return { ok: false, reason: 'playing' };
		if ( ! this.isHired( id, ctx ) ) return { ok: false, reason: 'not hired' };
		const m = this.life.get( id );
		if ( m && m.ashore ) return { ok: false, reason: 'ashore' };
		const berths = berthsOf( ctx.boat );
		if ( berths <= 0 ) return { ok: false, reason: 'no berths' };
		const cur = this.postOf( id );
		if ( cur === post ) return { ok: true };
		const used = this.posts.size - ( cur !== 'off' ? 1 : 0 );
		if ( used >= berths ) return { ok: false, reason: 'full' };
		if ( post === 'gunner' && this.gunners().length - ( cur === 'gunner' ? 1 : 0 ) >= CREW_RULES.maxGunners ) return { ok: false, reason: 'guns manned' };
		if ( ONE_EACH[ post ] && this._of( post, null ).length ) return { ok: false, reason: ONE_EACH[ post ] };
		return { ok: true };

	}

	// a tavern hand signs on (the money is the caller's); false when the crew is full or he is already aboard
	hire( s, day = 0 ) {

		if ( ! s || ! s.id || this.sailors.has( s.id ) || this.gone.has( s.id ) || this.sailors.size >= LIFE.maxHands ) return false;
		this.sailors.set( s.id, { id: s.id, name: s.name, look: s.look, port: s.port, traits: [ ...( s.traits || [] ) ], skills: { ...( s.skills || {} ) }, wage: s.wage | 0, watch: s.watch || 'day', hiredDay: day } );
		this.life.delete( s.id );
		this.member( s.id );
		return true;

	}

	// a tavern hand signs off (dismissed, or fed up): off the ship for good
	dismiss( id ) {

		if ( ! this.sailors.has( id ) ) return false;
		this._clear( id );
		this.sailors.delete( id );
		this.life.delete( id );
		this.stats.delete( id );
		this.gone.add( id );
		return true;

	}

	setPost( id, post, ctx = {} ) {

		const r = this.canPost( id, post, ctx );
		if ( ! r.ok ) return r;
		const cur = this.postOf( id );
		if ( cur === post ) return { ok: true, same: true };
		this._clear( id );
		if ( post !== 'off' ) this.posts.set( id, post );
		return { ok: true };

	}

	_clear( id ) {

		this.posts.delete( id );
		this.sides.delete( id );
		this.wait.delete( id );

	}

	sync( ctx = {} ) {

		const out = [];
		// (the played character holds at most one post: no copy of the posts every frame)
		if ( this.posts.has( ctx.character ) ) {

			const post = this.posts.get( ctx.character );
			this._clear( ctx.character );
			out.push( { id: ctx.character, post, why: 'playing' } );

		}

		// (no boat known: keep the posts; they are ashore with the skipper)
		if ( ! BOATS[ ctx.boat ] ) return out;
		const berths = berthsOf( ctx.boat );
		if ( this.posts.size <= berths ) return out; // everyone has a berth (the usual frame)
		const list = [ ...this.posts ];
		for ( let i = list.length - 1; i >= berths; i -- ) {

			this._clear( list[ i ][ 0 ] );
			out.push( { id: list[ i ][ 0 ], post: list[ i ][ 1 ], why: 'berth' } );

		}

		return out;

	}

	rows( ctx = {} ) {

		const berths = berthsOf( ctx.boat );
		return [ ...Object.keys( CHARACTERS ), ...this.sailors.keys() ].map( ( id ) => {

			const playing = id === ctx.character, hired = this.isHired( id, ctx );
			const post = this.postOf( id );
			const choices = POSTS.map( ( p ) => {

				const r = this.canPost( id, p, ctx );
				return { post: p, label: POST_LABELS[ p ], on: post === p, enabled: r.ok, why: r.ok ? null : WHY[ r.reason ] ? WHY[ r.reason ]( ctx, berths ) : r.reason };

			} );
			return { id, name: this.nameOf( id ), hired, playing, post, side: this.sides.get( id ) || null, choices, sailor: this.sailors.has( id ) };

		} );

	}

	assignSides( nearSide = null, ctx = null ) {

		const g = this.gunners( ctx );
		if ( ! g.length ) return this.sides;
		const first = nearSide || this.sides.get( g[ 0 ] ) || this._lastSide;
		this._lastSide = first;
		this.sides.set( g[ 0 ], first );
		if ( g[ 1 ] ) this.sides.set( g[ 1 ], first === 'port' ? 'starboard' : 'port' );
		return this.sides;

	}

	_stat( id ) {

		let s = this.stats.get( id );
		if ( ! s ) this.stats.set( id, s = { shots: 0, catches: 0 } );
		return s;

	}

	tickGunners( dt, { aboard = false, naval = null, ctx = null } = {} ) {

		const out = [];
		if ( ! aboard || ! naval || typeof naval.crewFire !== 'function' ) return out;
		for ( const id of this.gunners( ctx ) ) {

			const side = this.sides.get( id );
			if ( ! side ) continue;
			// the gunner's own hand: reload x1.6 / spread x1.5 for a green one, down to x1.1 / x1.0 at full gunnery (Life.gunneryMuls)
			const m = this.member( id );
			const k = m ? gunneryMuls( m ) : { reloadMul: CREW_RULES.reloadMul, spreadMul: CREW_RULES.spreadMul };
			const t = naval.crewFire( side, { reloadMul: k.reloadMul, spreadMul: k.spreadMul, crew: id } );
			if ( ! t ) continue;
			this._stat( id ).shots ++;
			if ( m ) grow( m, 'gunnery', LIFE.xp.shot );
			out.push( { id, side, target: t.id ?? null } );

		}

		return out;

	}

	tickAnglers( dt, { rate = 0, habitat = () => ( {} ), hour = 12, fits = () => true, bait = () => 1, ctx = null, onDuty = null } = {} ) {

		const out = [];
		for ( const id of this.anglers( ctx ) ) {

			const m = this.member( id );
			// a better angler (and a lucky one) gets bites sooner (Life.anglingMul)
			const mul = m ? anglingMul( m ) : 1;
			let w = this.wait.get( id );
			if ( ! w ) {

				// a fresh line goes over the side: the first fish takes a full wait
				w = { t: catchInterval( habitat(), this.rng, bait() ) / mul, full: false };
				this.wait.set( id, w );

			}

			if ( ! ( rate > 0 ) || ( onDuty && ! onDuty( id ) ) ) continue;
			w.t -= dt * rate;
			if ( w.t > 0 ) continue;
			const h = habitat();
			const species = pickSpecies( h, hour, this.rng );
			if ( ! species ) {

				w.t = CREW_RULES.emptyRetry;
				continue;

			}

			const kg = Math.round( rollWeight( species, this.rng ) * 100 ) / 100;
			const name = this.nameOf( id );
			if ( ! fits( kg ) ) {

				// no room: it goes back; say so once until a fish fits again
				w.t = CREW_RULES.fullRetry;
				if ( ! w.full ) out.push( { id, full: true, text: `${ name } lets a fish go: the cooler is full` } );
				w.full = true;
				continue;

			}

			w.full = false;
			w.t = catchInterval( h, this.rng, bait() ) / mul;
			this._stat( id ).catches ++;
			if ( m ) grow( m, 'angling', LIFE.xp.catch );
			out.push( { id, species, kg, habitat: mainHabitat( h ), text: `${ name } landed a ${ kg.toFixed( 1 ) } kg ${ FISH[ species ] ? FISH[ species ].name : species }` } );

		}

		return out;

	}

	hudLine( naval = null, ctx = null ) {

		const g = this.gunners( ctx );
		if ( ! g.length ) return null;
		const parts = g.map( ( id ) => {

			const side = this.sides.get( id );
			const name = this.nameOf( id );
			if ( ! side ) return `${ name } (standing by)`;
			const left = naval && naval.reloadLeft ? Math.max( 0, naval.reloadLeft[ side ] || 0 ) : 0;
			return `${ name } (${ sideName( side ) }, ${ left > 0 ? left.toFixed( 1 ) + ' s' : 'ready' })`;

		} );
		return 'Gunners: ' + parts.join( ' · ' );

	}

	toJSON() {

		const r1 = ( v ) => Math.round( v * 10 ) / 10;
		const life = {};
		for ( const [ id, m ] of this.life ) {

			const sk = {};
			for ( const k in m.skills ) sk[ k ] = r1( m.skills[ k ] );
			life[ id ] = { morale: r1( m.morale ), rest: r1( m.rest ), food: r1( m.food ), skills: sk, leaving: m.leaving || undefined, ashore: m.ashore || undefined, absent: m.absent || undefined };

		}

		return {
			v: 2, posts: [ ...this.posts ].map( ( [ id, post ] ) => [ id, post ] ), life,
			sailors: [ ...this.sailors.values() ].map( ( s ) => ( { ...s, traits: [ ...s.traits ], skills: { ...s.skills } } ) ), gone: [ ...this.gone ].slice( - 64 ),
		};

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		// the hands first (their posts need them known), then the posts, then each one's life
		if ( Array.isArray( d.sailors ) ) for ( const s of d.sailors ) if ( s && typeof s.id === 'string' && typeof s.name === 'string' && ! CHARACTERS[ s.id ] ) this.hire( s, s.hiredDay | 0 );
		if ( Array.isArray( d.gone ) ) for ( const id of d.gone ) if ( typeof id === 'string' ) this.gone.add( id );
		if ( Array.isArray( d.posts ) ) for ( const e of d.posts ) {

			if ( ! Array.isArray( e ) ) continue;
			const [ id, post ] = e;
			if ( this.known( id ) && POSTS.includes( post ) && post !== 'off' && ! this.posts.has( id ) ) this.posts.set( id, post );

		}

		if ( d.life && typeof d.life === 'object' ) for ( const id in d.life ) {

			const base = this.member( id ), x = d.life[ id ];
			if ( ! base || ! x || typeof x !== 'object' ) continue;
			// traits and watch are the character's own (never from the save); the rest is the life lived
			this.life.set( id, newMember( { ...x, traits: base.traits, watch: base.watch, skills: { ...base.skills, ...( x.skills || {} ) } } ) );

		}

	}

	reset() {

		this.posts.clear();
		this.sides.clear();
		this.wait.clear();
		this.stats.clear();
		this.life.clear();
		this.sailors.clear();
		this.gone.clear();
		this._lastSide = 'port';

	}

}

// why a post is greyed out (the posting UI's title text)
const WHY = {
	'unknown': () => 'Not a crew member',
	'playing': () => 'You are playing this one',
	'not hired': () => 'Not hired yet',
	'no berths': ( ctx ) => ( BOATS[ ctx.boat ] ? `The ${ BOATS[ ctx.boat ].name.toLowerCase() } has no crew berths` : 'No boat to crew' ),
	'full': ( ctx, n ) => `Every berth is taken (${ n })`,
	'guns manned': () => 'Both broadsides are manned',
	'ashore': () => 'Ashore: left the ship (morale)',
	'cook taken': () => 'There is a cook aboard already',
	'lookout taken': () => 'There is a lookout aboard already',
};
