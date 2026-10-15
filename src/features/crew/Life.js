// A crew with lives (wave 19C), pure logic: no engine, no DOM. Crew.js keeps one record per crew member (a roster character
// hired at Ethena's, or a sailor signed on at a port's tavern); index.js feeds it the hours, the weather and the events.
//
//   TRAITS[ id ]              { label, note }: brave, lazy, lucky, drunkard, cook, sharpEyed, seasick
//   ROSTER_LIFE[ id ]         the roster characters' traits, watch and starting skills
//   SKILLS                    gunnery (reload, aim), angling (bite rate), sailing (speed at the helm), repair (fire, flood)
//   LIFE                      the numbers: morale events and hourly rates, rest / food, the skill caps, quitting
//   newMember( init )         { morale, rest, food, skills { gunnery, angling, sailing, repair }, traits, watch, ... }
//   has( m, trait )           levelOf( m ) -> 1..10      skillCap( m, skill ) -> 100 (60 for a seasick sailor)
//   grow( m, skill, amount ) -> gained   (diminishing toward the cap; a lazy one learns at 0.7)
//   moraleEvent( m, kind ) -> delta      (wagesPaid, wagesMissed, deserted, returned, victory, hit, sunk, boarded, catch,
//                                         shipCatch, storm, fetched, hired; brave / seasick / lucky / drunkard shift them)
//   tickLife( m, hours, { activity, storm, atSea, cookFed } ) -> morale delta   (rest, food, storm hours, the cook's meals)
//   dutyAt( hour, m, { alarm, fire, flood, post, slot, day } ) -> { duty, act }   the ship's day (below)
//   gunneryMuls( m ) -> { reloadMul, spreadMul }    anglingMul( m ) -> bite rate factor    sailingBonus( m ) -> 0..0.06
//   repairPower( m ) -> 0..1                          moodWord( morale )
//   sailorsFor( portId, week ) -> [ sailor ]          the tavern's hands for hire this week (deterministic per port and week)
//   vouch( sailor, keeper ) -> "Nell vouches for Ada Kell: steady on a gun"
//
// The ship's day (dutyAt): the day watch sleeps 23-5 under the awning, eats at 7, 12 and 18.30 (the cook works the stove then),
// takes one leisure hour in the afternoon and 21-23 off (dice, a drink, mending nets, a yarn by the rail); the night watch
// (PENGU) turns it round. A lazy one sleeps an hour longer. Battle stations (a hostile in sight) wake everyone to their post;
// a fire calls everyone but the gunners in action to the buckets, a flood the rest to the pump.

export const TRAITS = {
	brave: { label: 'Brave', note: 'joins a boarding, shrugs off hits' },
	lazy: { label: 'Lazy', note: 'sleeps late, learns slower' },
	lucky: { label: 'Lucky', note: 'bites come sooner, storms bother less' },
	drunkard: { label: 'Drunkard', note: 'loves a drink; may stay at the tavern' },
	cook: { label: 'Cook', note: 'meals lift everyone' },
	sharpEyed: { label: 'Sharp-eyed', note: 'sees sails sooner, aims truer' },
	seasick: { label: 'Seasick', note: 'storms are misery' },
};
export const TRAIT_IDS = Object.keys( TRAITS );
export const SKILLS = [ 'gunnery', 'angling', 'sailing', 'repair' ];
export const SKILL_LABELS = { gunnery: 'Gunnery', angling: 'Angling', sailing: 'Sailing', repair: 'Repair' };

// the roster's crew personalities (the taglines in Characters.js)
export const ROSTER_LIFE = {
	hyptile: { traits: [ 'cook' ], skills: { angling: 20, sailing: 10 } },
	pepe: { traits: [ 'lucky', 'lazy' ], skills: { angling: 25 } },
	doge: { traits: [ 'sharpEyed' ], skills: { angling: 20, gunnery: 10 } },
	bonk: { traits: [ 'brave', 'drunkard' ], skills: { gunnery: 20 } },
	pengu: { traits: [ 'cook' ], watch: 'night', skills: { angling: 20 } },
	clown: { traits: [ 'lucky', 'drunkard' ], skills: { angling: 20 } },
	bravile: { traits: [ 'brave' ], skills: { sailing: 20, repair: 10 } },
	heptyle: { traits: [ 'sharpEyed', 'seasick' ], skills: { gunnery: 15 } },
};

export const LIFE = {
	start: 60, // a new hand's morale
	cap: 100, // skill points
	seasickSailCap: 60,
	lazyLearn: 0.7,
	quitAt: 10, // morale at or under this: leaves at the next port
	stayAt: 25, // back over this before the port: stays after all
	backAt: 40, // a roster hand who left comes back to the crew once ashore morale reaches this
	ashoreGain: 3, // morale / h ashore (a roster hand who left)
	drift: 0.02, // of the gap to `rest` (50) per hour
	settle: 50,
	rest: { duty: - 3, awake: 2, sleep: 14, low: 20, lowMorale: - 1.5 },
	food: { burn: - 4, meal: 50, cookMul: 1.5, low: 25, lowMorale: - 2, cookFed: 0.5 },
	storm: { normal: - 2, seasick: - 5, brave: - 1, lucky: - 1 },
	drink: { normal: 1, drunkard: 3 },
	events: {
		wagesPaid: 3, wagesMissed: - 8, deserted: - 15, returned: 6, victory: 6, hit: - 0.5, sunk: - 15, boarded: - 10,
		catch: 2, shipCatch: 0.5, storm: - 2, fetched: 2, hired: 5, fire: - 2,
	},
	xp: { shot: 1.5, catch: 3, sailHour: 2, douse: 3, pumpSecond: 0.06, cook: 0.5 },
	levelPer: 40, // skill points (all four together) per level
	maxLevel: 10,
	drunkChance: 0.4, // a drunkard in port of an evening goes ashore for one more
	maxHands: 6, // tavern hands signed on at once
};

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

export function has( m, trait ) {

	return !! ( m && m.traits && m.traits.includes( trait ) );

}

export function newMember( init = {} ) {

	const skills = {};
	for ( const s of SKILLS ) skills[ s ] = clamp( Number( init.skills && init.skills[ s ] ) || 0, 0, LIFE.cap );
	return {
		morale: Number.isFinite( init.morale ) ? clamp( init.morale, 0, 100 ) : LIFE.start,
		rest: Number.isFinite( init.rest ) ? clamp( init.rest, 0, 100 ) : 80,
		food: Number.isFinite( init.food ) ? clamp( init.food, 0, 100 ) : 80,
		skills,
		traits: Array.isArray( init.traits ) ? init.traits.filter( ( t ) => TRAITS[ t ] ) : [],
		watch: init.watch === 'night' ? 'night' : 'day',
		leaving: !! init.leaving, // morale bottomed out: leaves at the next port
		ashore: !! init.ashore, // left the ship (a roster hand: back once the morale recovers)
		absent: init.absent && typeof init.absent === 'object' ? { port: String( init.absent.port || 'home' ) } : null, // drunk at that port's tavern
		drinks: 0, // hours of drink today (a drunkard's aim wobbles)
	};

}

export function rosterMember( id ) {

	const r = ROSTER_LIFE[ id ] || {};
	return newMember( { traits: r.traits || [], watch: r.watch, skills: r.skills || {} } );

}

export function skillCap( m, skill ) {

	return skill === 'sailing' && has( m, 'seasick' ) ? LIFE.seasickSailCap : LIFE.cap;

}

// a skill grows with use, slower the closer it is to its cap, never past it
export function grow( m, skill, amount ) {

	if ( ! m || ! SKILLS.includes( skill ) || ! ( amount > 0 ) ) return 0;
	const cap = skillCap( m, skill ), s = m.skills[ skill ] || 0;
	if ( s >= cap ) return 0;
	const k = has( m, 'lazy' ) ? LIFE.lazyLearn : 1;
	const gain = Math.min( cap - s, amount * k * ( 1 - s / LIFE.cap ) );
	m.skills[ skill ] = s + gain;
	return gain;

}

export function levelOf( m ) {

	if ( ! m ) return 1;
	let t = 0;
	for ( const s of SKILLS ) t += m.skills[ s ] || 0;
	return clamp( 1 + Math.floor( t / LIFE.levelPer ), 1, LIFE.maxLevel );

}

export function addMorale( m, d ) {

	if ( ! m || ! Number.isFinite( d ) ) return 0;
	const was = m.morale;
	m.morale = clamp( m.morale + d, 0, 100 );
	if ( m.morale <= LIFE.quitAt ) m.leaving = true;
	else if ( m.morale > LIFE.stayAt ) m.leaving = false;
	return m.morale - was;

}

// the delta an event makes to one member's morale (applied: addMorale)
export function moraleEvent( m, kind ) {

	const E = LIFE.events;
	let d = E[ kind ];
	if ( ! Number.isFinite( d ) ) return 0;
	if ( has( m, 'brave' ) ) {

		if ( kind === 'hit' || kind === 'fire' ) d = 0;
		else if ( kind === 'victory' ) d *= 1.5;
		else if ( kind === 'sunk' || kind === 'boarded' ) d *= 0.5;

	}

	if ( kind === 'storm' ) d = has( m, 'seasick' ) ? - 5 : has( m, 'lucky' ) ? - 1 : d;
	if ( kind === 'wagesPaid' && has( m, 'drunkard' ) ) d += 1; // money for the tavern
	return addMorale( m, d );

}

// an hour (or part) of life aboard: rest and food move with the activity, the morale with them
export function tickLife( m, hours, { activity = 'post', storm = false, atSea = false, cookFed = false, ashore = false } = {} ) {

	if ( ! m || ! ( hours > 0 ) ) return 0;
	const R = LIFE.rest, F = LIFE.food;
	let d = 0;
	if ( ashore ) {

		// a roster hand who walked off: ashore the morale comes back
		m.rest = clamp( m.rest + R.awake * hours, 0, 100 );
		m.food = 80;
		return addMorale( m, LIFE.ashoreGain * hours );

	}

	const sleep = activity === 'sleep', duty = activity === 'post' || activity === 'cook' || activity === 'fire' || activity === 'pump';
	m.rest = clamp( m.rest + ( sleep ? R.sleep : duty ? R.duty : R.awake ) * hours, 0, 100 );
	m.food = clamp( m.food + ( activity === 'eat' ? F.meal * ( cookFed ? F.cookMul : 1 ) : F.burn ) * hours, 0, 100 );
	if ( m.rest < R.low ) d += R.lowMorale * hours;
	if ( m.food < F.low ) d += F.lowMorale * hours;
	if ( cookFed && m.food >= F.low ) d += F.cookFed * hours;
	if ( activity === 'drink' ) {

		d += ( has( m, 'drunkard' ) ? LIFE.drink.drunkard : LIFE.drink.normal ) * hours;
		m.drinks += hours;

	} else m.drinks = Math.max( 0, m.drinks - 0.25 * hours ); // it wears off

	if ( storm && atSea ) {

		const S = LIFE.storm;
		d += ( has( m, 'seasick' ) ? S.seasick : has( m, 'brave' ) ? S.brave : has( m, 'lucky' ) ? S.lucky : S.normal ) * hours;

	}

	d += ( LIFE.settle - m.morale ) * LIFE.drift * hours;
	return addMorale( m, d );

}

// the ship's day: [ from, to, act ] for each watch (acts off duty: sleep, eat, leisure, evening)
const DAY = [ [ 0, 5, 'sleep' ], [ 5, 7, 'post' ], [ 7, 7.5, 'eat' ], [ 7.5, 12, 'post' ], [ 12, 12.75, 'eat' ], [ 12.75, 18.5, 'post' ],
	[ 18.5, 19.25, 'eat' ], [ 19.25, 21, 'post' ], [ 21, 23, 'evening' ], [ 23, 24, 'sleep' ] ];
const NIGHT = [ [ 0, 3, 'post' ], [ 3, 3.5, 'eat' ], [ 3.5, 8, 'post' ], [ 8, 9, 'evening' ], [ 9, 15, 'sleep' ], [ 15, 18.5, 'post' ],
	[ 18.5, 19.25, 'eat' ], [ 19.25, 24, 'post' ] ];
const LEISURE = [ 'dice', 'mend', 'talk', 'drink' ];
export const OFF_DUTY = new Set( [ 'sleep', 'eat', 'dice', 'mend', 'talk', 'drink' ] );

const hash = ( s ) => {

	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 );
	return h >>> 0;

};

export function dutyAt( hour, m, { alarm = false, fire = false, flood = false, post = 'off', slot = 0, day = 0, id = '' } = {} ) {

	const gunAction = alarm && post === 'gunner';
	if ( fire && ! gunAction ) return { duty: true, act: 'fire' };
	if ( flood && ! gunAction ) return { duty: true, act: 'pump' };
	if ( alarm ) return { duty: true, act: 'post' };
	const h = ( ( hour % 24 ) + 24 ) % 24;
	const table = m && m.watch === 'night' ? NIGHT : DAY;
	let act = 'post';
	for ( const [ a, b, x ] of table ) if ( h >= a && h < b ) { act = x; break; }
	// a lazy one sleeps an hour past the call
	if ( has( m, 'lazy' ) && act === 'post' ) {

		const wake = table === DAY ? 5 : 15;
		if ( h >= wake && h < wake + 1 ) act = 'sleep';

	}

	// the cook works the stove at meal times
	if ( act === 'eat' && post === 'cook' ) return { duty: true, act: 'cook' };
	// one leisure hour in the afternoon (14..17 by member), the evening off: dice, mending, a yarn, a drink
	const lh = 14 + ( ( slot + ( hash( id ) % 3 ) ) % 3 );
	if ( act === 'post' && table === DAY && h >= lh && h < lh + 1 ) act = 'evening';
	if ( act === 'evening' ) {

		if ( has( m, 'drunkard' ) && h >= 21 ) act = 'drink';
		else act = LEISURE[ ( hash( id ) + day + Math.floor( h ) ) % ( has( m, 'drunkard' ) ? 4 : 3 ) ];

	}

	return { duty: ! OFF_DUTY.has( act ), act };

}

export function gunneryMuls( m ) {

	const g = m ? ( m.skills.gunnery || 0 ) / LIFE.cap : 0;
	let spread = 1.5 - 0.5 * g;
	if ( has( m, 'sharpEyed' ) ) spread *= 0.9;
	if ( m && m.drinks >= 1 ) spread *= 1.15; // an hour's drinking or more in him
	return { reloadMul: 1.6 - 0.5 * g, spreadMul: spread };

}

export function anglingMul( m ) {

	const a = m ? ( m.skills.angling || 0 ) / LIFE.cap : 0;
	return ( 1 + 0.4 * a ) * ( has( m, 'lucky' ) ? 1.1 : 1 );

}

export function sailingBonus( m ) {

	return m ? 0.06 * ( m.skills.sailing || 0 ) / LIFE.cap : 0;

}

export function repairPower( m ) {

	return m ? ( m.skills.repair || 0 ) / LIFE.cap : 0;

}

export function moodWord( morale ) {

	return morale >= 80 ? 'Cheerful' : morale >= 55 ? 'Content' : morale >= 35 ? 'Grumbling' : morale > LIFE.quitAt ? 'Sullen' : 'Fed up';

}

// ------------------------------------------------------------------------------------------------ tavern hands

const GIVEN = [ 'Ada', 'Bram', 'Cora', 'Dov', 'Edda', 'Fen', 'Gil', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lio', 'Moss', 'Nia', 'Oki', 'Pell', 'Rue', 'Sami', 'Tam', 'Wren', 'Yara', 'Zeb' ];
const FAMILY = [ 'Kell', 'Marlow', 'Brine', 'Hollis', 'Teague', 'Varga', 'Quayle', 'Dunmore', 'Sorrel', 'Penhale', 'Rook', 'Ashby', 'Calloway', 'Fitch' ];
const LOOKS = [ 'hyptile', 'pepe', 'doge', 'bonk', 'pengu', 'bravile', 'heptyle' ]; // roster GLBs the harbour folk wear (ResidentData.FOLK_CHARACTERS)
const TRAIT_PRICE = { brave: 30, lucky: 25, cook: 20, sharpEyed: 20, lazy: - 25, drunkard: - 20, seasick: - 30 };
const VOUCH = {
	gunnery: 'steady on a gun', angling: 'never comes home without a fish', sailing: 'can trim a sail in her sleep', repair: 'patched half the boats in this harbour',
	brave: 'first over the rail in a fight', lazy: 'a slow riser, mind', lucky: 'the luckiest hand on the quay', drunkard: 'keep the rum locked',
	cook: 'cooks a stew that brings men home', sharpEyed: 'spots a sail before the gulls do', seasick: 'goes green in a swell, but works',
};

export function seeded( seed ) {

	let a = seed >>> 0;
	return () => {

		a = ( a + 0x6d2b79f5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

export function sailorsFor( portId, week = 0, n = 3 ) {

	const rng = seeded( hash( String( portId ) ) ^ Math.imul( ( week | 0 ) + 1, 0x9e3779b1 ) );
	const pick = ( a ) => a[ Math.floor( rng() * a.length ) % a.length ];
	const out = [], names = new Set();
	for ( let i = 0; i < n; i ++ ) {

		let name = `${ pick( GIVEN ) } ${ pick( FAMILY ) }`;
		while ( names.has( name ) ) name = `${ pick( GIVEN ) } ${ pick( FAMILY ) }`;
		names.add( name );
		const special = SKILLS[ Math.floor( rng() * SKILLS.length ) % SKILLS.length ];
		const skills = { gunnery: 5, angling: 5, sailing: 5, repair: 5 };
		skills[ special ] = 20 + Math.round( rng() * 25 );
		const traits = [ pick( TRAIT_IDS ) ];
		if ( rng() < 0.4 ) {

			const t = pick( TRAIT_IDS );
			if ( ! traits.includes( t ) ) traits.push( t );

		}

		let price = 80 + 4 * skills[ special ];
		for ( const t of traits ) price += TRAIT_PRICE[ t ] || 0;
		out.push( {
			id: `s-${ portId }-${ week | 0 }-${ i }`, name, look: pick( LOOKS ), port: String( portId ), traits, skills, special,
			price: Math.max( 40, Math.round( price / 5 ) * 5 ), wage: 6 + Math.round( skills[ special ] / 10 ) + ( traits.includes( 'cook' ) ? 2 : 0 ),
			watch: 'day',
		} );

	}

	return out;

}

export function vouch( s, keeper = 'The keeper' ) {

	const bits = [ VOUCH[ s.special ] ];
	for ( const t of s.traits ) bits.push( VOUCH[ t ] );
	return `${ keeper } vouches for ${ s.name }: ${ bits.filter( Boolean ).join( '; ' ) }`;

}
