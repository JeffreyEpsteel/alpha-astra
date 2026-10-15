// Crew banter (wave 19C): short lines on events, by personality, never spammy. Pure logic; index.js shows a line as a speech
// bubble over the speaker's head on deck (a toast when the figure is out of sight and the line matters: a lookout's call).
//
//   const b = new Banter( { rng } )
//   b.say( kind, candidates, { now, prefer } ) -> { id, kind, text } | null
//       candidates: [ { id, name, member } ]  (the hands aboard and awake); prefer: an id that speaks first if it can
//       kinds: catch, shipCatch, sail, whale, storm, hit, win, board, loss, fire, fireOut, flood, hired, quit, drunk, paid, unpaid, dawn
//   COOLDOWN    { global: 14 s between any two lines, member: 60 s, kind: 30 s }  (urgent kinds skip the global wait)

import { has } from './Life.js';

export const COOLDOWN = { global: 14, member: 60, kind: 30 };
const URGENT = new Set( [ 'fire', 'flood', 'sail', 'whale' ] );

// lines: the general ones, then trait-flavoured ones (a hand with the trait says one of those half the time)
export const LINES = {
	catch: { any: [ 'Fish on the deck!', 'Another for the cooler.', 'That one fought.', 'Not bad, not bad at all.' ], lucky: [ 'Told you this spot was lucky.', 'They just jump on my hook.' ], lazy: [ 'Barely had to move for that one.' ] },
	shipCatch: { any: [ 'Nice fish, skipper!', 'Look at the size of it!' ], cook: [ 'That one is going in the pot.' ], drunkard: [ 'A toast to that fish!' ] },
	sail: { any: [ 'Sail ho!', 'Ship on the horizon!', 'Sail off the beam!' ], sharpEyed: [ 'Sail ho! Two points off the bow.', 'Topsails, far out. Coming our way.' ], brave: [ 'Sail ho! Let them come.' ] },
	whale: { any: [ 'Whale! There she blows!', 'Look, a whale!' ], sharpEyed: [ 'Blow off the quarter: a humpback.' ] },
	storm: { any: [ 'Weather coming. Lash it down.', 'Here comes the blow.' ], seasick: [ 'Oh no. Not again.', 'Somebody hold my hat. And my lunch.' ], brave: [ 'A bit of wind never hurt.' ], lucky: [ 'It will pass us by. You will see.' ] },
	hit: { any: [ 'We are hit!', 'That one hurt her.', 'Splinters everywhere!' ], brave: [ 'Is that all they have?' ], seasick: [ 'I want to go home.' ] },
	win: { any: [ 'Huzzah!', 'That will teach them!', 'Drinks on the skipper tonight!' ], brave: [ 'Who is next?' ], drunkard: [ 'This calls for rum.' ] },
	board: { any: [ 'Over the rail!', 'With you, skipper!' ], brave: [ 'Follow me, lads!', 'Cutlasses out!' ] },
	loss: { any: [ 'We lost her...', 'A bad day at sea.' ], brave: [ 'We go again.' ] },
	fire: { any: [ 'Fire! Buckets!', 'Fire on deck! Water, quick!' ], brave: [ 'Fire! I have got it, stand back!' ] },
	fireOut: { any: [ 'Fire is out.', 'Phew. Out.' ] },
	flood: { any: [ 'Taking water! To the pump!', 'She is filling. Pump!' ] },
	hired: { any: [ 'Glad to be aboard, skipper.', 'Where is my hammock?' ], drunkard: [ 'Does this ship carry rum?' ], cook: [ 'Who has been cooking here? Never mind, I am here now.' ] },
	quit: { any: [ 'I have had enough. I am off at the next port.', 'Find another hand, skipper.' ] },
	drunk: { any: [ 'Just one more, then I am back aboard...' ] },
	paid: { any: [ 'Pay day!', 'Coins in the pocket.' ], drunkard: [ 'Pay day! To the tavern!' ] },
	unpaid: { any: [ 'Where is our pay, skipper?', 'No coin, no work.' ] },
	dawn: { any: [ 'Morning, skipper.', 'Coffee, anyone?' ], lazy: [ 'Five more minutes...' ], cook: [ 'Breakfast in a bit.' ] },
};

export class Banter {

	constructor( { rng = Math.random } = {} ) {

		this.rng = rng;
		this.last = - Infinity; // time of the last line
		this.byMember = new Map();
		this.byKind = new Map();
		this.said = 0;

	}

	ready( kind, now ) {

		if ( now - ( this.byKind.get( kind ) ?? - Infinity ) < COOLDOWN.kind ) return false;
		return URGENT.has( kind ) || now - this.last >= COOLDOWN.global;

	}

	line( kind, member ) {

		const L = LINES[ kind ];
		if ( ! L ) return null;
		const flavoured = Object.keys( L ).filter( ( t ) => t !== 'any' && has( member, t ) );
		const pool = flavoured.length && this.rng() < 0.5 ? L[ flavoured[ Math.floor( this.rng() * flavoured.length ) % flavoured.length ] ] : L.any;
		return pool[ Math.floor( this.rng() * pool.length ) % pool.length ];

	}

	say( kind, candidates = [], { now = 0, prefer = null } = {} ) {

		if ( ! LINES[ kind ] || ! candidates.length || ! this.ready( kind, now ) ) return null;
		const free = candidates.filter( ( c ) => now - ( this.byMember.get( c.id ) ?? - Infinity ) >= COOLDOWN.member );
		if ( ! free.length ) return null;
		const who = free.find( ( c ) => c.id === prefer ) || free[ Math.floor( this.rng() * free.length ) % free.length ];
		const text = this.line( kind, who.member );
		if ( ! text ) return null;
		this.last = now;
		this.byMember.set( who.id, now );
		this.byKind.set( kind, now );
		this.said ++;
		return { id: who.id, name: who.name, kind, text };

	}

	reset() {

		this.last = - Infinity;
		this.byMember.clear();
		this.byKind.clear();

	}

}
