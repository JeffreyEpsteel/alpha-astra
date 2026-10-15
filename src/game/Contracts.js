import { FISH, FISH_IDS } from './FishTable.js';
import { CHARACTERS } from './Characters.js';

// PoorGoat's quest board (the fish buyer's stand). Three kinds of job:
//   intro   'firstCatch': land any fish
//   story   four quests that each unlock a character (Characters.js names them by id)
//   order   paid deliveries: `count` fish of a species handed over from the hold, paid at ORDER_RATE
//           times their value plus a bonus; three at a time, generated from a seed kept in the save
//           so a reload shows the same board, each replaced by the next one when delivered
//
// Progress lives in state.quests (GameState serialises it as is):
//   { seed, orderN, orders: [ k, k, k ], progress: { questId: n }, done: [ questId ] }
//
//   const contracts = new Contracts( state );
//   contracts.active  -> [ { id, title, text, progress, goal, done, reward: { money, unlock }, kind, deliverable } ]
//   contracts.onCatch( state.lastCatch )   after state.addFish
//   contracts.deliver( id ) -> { money, unlock } | null
//   contracts.claimable( id ), contracts.completed, contracts.onChange( fn )
//   contracts.story   set by the story feature (src/features/story): its chains for the vendor at hand are appended
//                     to `active` (kind 'chain', id 'story:<npc>:<chain>'); deliver( id ) of one opens that person's
//                     conversation and returns null (the story pays its own rewards)

export const ORDER_RATE = 1.6;
export const ORDER_SLOTS = 3;

// check( lastCatch ): does this catch count towards the quest?
export const QUESTS = {
	firstCatch: {
		kind: 'intro', title: 'First catch', goal: 1, reward: { money: 40, unlock: null },
		text: 'Bring me anything with fins, so I know you can. Pier\'s right there.',
		check: () => true,
	},
	reefRun: {
		kind: 'story', title: 'Reef run', goal: 3, reward: { money: 150, unlock: 'doge' },
		text: 'Three fish off the reef. Doge says he\'ll crew for whoever manages it.',
		check: ( c ) => !! ( FISH[ c.species ] && FISH[ c.species ].habitat.reef ),
	},
	nightShift: {
		kind: 'story', title: 'Night shift', goal: 3, reward: { money: 200, unlock: 'pengu' },
		text: 'Three fish landed after dark, half seven to six. PENGU only fishes nights. Impress him.',
		check: ( c ) => c.timeOfDay < 6 || c.timeOfDay >= 19.5,
	},
	deepWater: {
		kind: 'story', title: 'Deep water', goal: 2, reward: { money: 400, unlock: 'bravile' },
		text: 'Two fish from deep water, off a boat. Bravile wants to see you can handle the blue.',
		check: ( c ) => !! ( c.where && c.where.aboard && c.where.habitat === 'deep' ),
	},
	recordHunter: {
		kind: 'story', title: 'Record hunter', goal: 3, reward: { money: 500, unlock: 'heptyle' },
		text: 'Beat three of your own records. Heptyle chases big ones; show him you do too.',
		check: ( c ) => !! c.record,
	},
};

export const QUEST_IDS = Object.keys( QUESTS );
const STORY_ORDER = [ 'firstCatch', 'reefRun', 'nightShift', 'deepWater', 'recordHunter' ];

export class Contracts {

	constructor( state ) {

		this.state = state;
		this.listeners = new Set();
		this.story = null;
		this.init();

	}

	// make sure the save has a board: a seed, three orders and progress (seeded from the career
	// stats of an older save the first time)
	init() {

		const s = this.state;
		const q = s.quests && typeof s.quests === 'object' ? s.quests : ( s.quests = {} );
		let dirty = false;
		if ( ! Number.isInteger( q.seed ) ) { q.seed = ( Math.random() * 0x7fffffff ) >>> 0; dirty = true; }
		if ( ! Array.isArray( q.done ) ) { q.done = []; dirty = true; }
		if ( ! q.progress || typeof q.progress !== 'object' ) {

			const c = s.career || {};
			q.progress = {
				firstCatch: Math.min( 1, c.caught | 0 ), reefRun: Math.min( 3, c.reef | 0 ), nightShift: Math.min( 3, c.night | 0 ),
				deepWater: Math.min( 2, Math.min( c.deep | 0, c.aboard | 0 ) ), recordHunter: Math.min( 3, c.records | 0 ),
			};
			dirty = true;

		}

		if ( ! Number.isInteger( q.orderN ) ) { q.orderN = 0; dirty = true; }
		if ( ! Array.isArray( q.orders ) ) { q.orders = []; dirty = true; }
		q.orders = q.orders.filter( ( k ) => Number.isInteger( k ) );
		while ( q.orders.length < ORDER_SLOTS ) { q.orders.push( q.orderN ++ ); dirty = true; }
		if ( dirty ) s.save();
		this.quests = q;

	}

	// the k-th order of this seed: { id, species, count, bonus }
	order( k ) {

		const r1 = hash( this.quests.seed, k, 1 ), r2 = hash( this.quests.seed, k, 2 ), r3 = hash( this.quests.seed, k, 3 );
		const species = FISH_IDS[ r1 % FISH_IDS.length ];
		const f = FISH[ species ];
		const mid = ( f.kg[ 0 ] + f.kg[ 1 ] ) / 2;
		// small fish come by the handful, big ones one or two at a time
		const maxCount = mid < 0.5 ? 4 : mid < 3 ? 3 : 2;
		const count = 1 + r2 % maxCount;
		const bonus = Math.round( ( 10 + f.price * mid * count * 0.4 ) * ( 0.8 + ( r3 % 100 ) / 250 ) );
		return { id: 'order:' + k, k, species, count, bonus };

	}

	get completed() {

		return this.quests.done.slice();

	}

	isDone( id ) {

		return this.quests.done.includes( id );

	}

	// ids of fish in the hold that match the order, cheapest first (PoorGoat takes those)
	matching( order ) {

		return this.state.inventory.filter( ( f ) => f.species === order.species ).sort( ( a, b ) => a.value - b.value ).map( ( f ) => f.id );

	}

	get active() {

		const list = [];
		for ( const id of STORY_ORDER ) {

			if ( this.isDone( id ) ) continue;
			const q = QUESTS[ id ];
			const progress = Math.min( q.goal, this.quests.progress[ id ] | 0 );
			list.push( { id, kind: q.kind, title: q.title, text: q.text, progress, goal: q.goal, done: progress >= q.goal, reward: { ...q.reward }, deliverable: null } );

		}

		for ( const k of this.quests.orders ) {

			const o = this.order( k );
			const ids = this.matching( o );
			const f = FISH[ o.species ];
			const progress = Math.min( o.count, ids.length );
			list.push( {
				id: o.id, kind: 'order', title: `${ o.count } × ${ f.name }`, species: o.species, count: o.count, bonus: o.bonus,
				text: orderLine( o, f ), progress, goal: o.count, done: progress >= o.count,
				reward: { money: null, rate: ORDER_RATE, bonus: o.bonus, unlock: null }, deliverable: ids.slice( 0, o.count ),
			} );

		}

		if ( this.story && typeof this.story.vendorQuests === 'function' ) {

			try { for ( const q of this.story.vendorQuests() ) list.push( q ); } catch ( e ) { /* the story is optional */ }

		}

		return list;

	}

	find( id ) {

		return this.active.find( ( q ) => q.id === id ) || null;

	}

	// after state.addFish: count the catch towards every open quest it fits
	onCatch( c ) {

		if ( ! c ) return;
		let changed = false;
		for ( const id of STORY_ORDER ) {

			if ( this.isDone( id ) ) continue;
			const q = QUESTS[ id ];
			const n = this.quests.progress[ id ] | 0;
			if ( n >= q.goal || ! q.check( c ) ) continue;
			this.quests.progress[ id ] = n + 1;
			changed = true;

		}

		if ( changed ) {

			this.state.save();
			this.emit();
			this.state.emit();

		}

	}

	claimable( id ) {

		const q = this.find( id );
		return !! q && q.done;

	}

	// hand over the fish / claim the reward; { money, unlock } or null when it isn't ready
	deliver( id ) {

		if ( typeof id === 'string' && id.startsWith( 'story:' ) ) {

			if ( this.story && typeof this.story.talkTo === 'function' ) this.story.talkTo( id.split( ':' )[ 1 ], { force: true } );
			return null;

		}

		const q = this.find( id );
		if ( ! q || ! q.done ) return null;
		const s = this.state;
		if ( q.kind === 'order' ) {

			const taken = s.takeFish( q.deliverable );
			if ( taken.length < q.count ) return null;
			let value = 0;
			for ( const f of taken ) value += f.value;
			const money = Math.round( value * ORDER_RATE ) + q.bonus;
			const k = Number( id.slice( 6 ) );
			const i = this.quests.orders.indexOf( k );
			if ( i >= 0 ) this.quests.orders[ i ] = this.quests.orderN ++;
			s.earn( money );
			this.emit();
			return { money, unlock: null };

		}

		this.quests.done.push( id );
		const { money, unlock } = q.reward;
		s.earn( money );
		if ( unlock && CHARACTERS[ unlock ] ) s.unlockCharacter( unlock, { free: true } );
		this.emit();
		return { money, unlock: unlock || null };

	}

	onChange( fn ) {

		this.listeners.add( fn );
		return () => this.listeners.delete( fn );

	}

	emit() {

		for ( const fn of this.listeners ) fn( this );

	}

}

// PoorGoat's line for an order
function orderLine( o, f ) {

	const r1 = hash( o.k, 7, 9 ) % 5;
	const who = [ 'the Saturday table', 'the hotel kitchen', 'a wedding up the hill', 'the ferry crew', 'my cousin\'s bar' ][ r1 ];
	return `${ o.count === 1 ? 'One' : o.count } ${ f.name.toLowerCase() }${ o.count > 1 ? 's' : '' } for ${ who }. ${ ORDER_RATE }× the going rate, $${ o.bonus } on top.`;

}

// deterministic 31-bit hash of three integers (the order board)
function hash( a, b, c ) {

	let h = ( a | 0 ) ^ 0x9e3779b9;
	h = Math.imul( h ^ ( b | 0 ), 0x85ebca6b );
	h ^= h >>> 13;
	h = Math.imul( h ^ ( c | 0 ), 0xc2b2ae35 );
	h ^= h >>> 16;
	h = Math.imul( h, 0x27d4eb2f );
	h ^= h >>> 15;
	return h >>> 1;

}
