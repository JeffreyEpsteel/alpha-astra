import { CHAINS, ITEMS, NPCS, portName } from './StoryData.js';
import { gate } from './Rules.js';
import { moodWord } from './Memory.js';
import { L } from './Lang.js';

// Conversations (pure: Story.js holds the state, DialogueUI.js draws them). A conversation is a node: what the person
// says (`line`) and the player's choices. The nodes are built each time from the quest chains (offers, reminders,
// hand-ins), the person's memory of the player and the authored lines below, so every choice reflects the state now.
//
//   buildModel( story, npc, node = 'root', said = null ) -> { npc, name, role, port, portName, mood, line, said, choices }
//     choices: [ { id, label, kind: 'turnin' | 'pick' | 'offer' | 'accept' | 'ask' | 'topic' | 'service' | 'gift' | 'back' | 'bye',
//                  hint?, disabled? } ]
//   applyChoice( story, npc, id ) -> { node, said, close }   runs the choice's effect through the story
//
// Wave 20: a choice step (step.choices, the court-martial) shows one 'pick:<chain>:<option>' per option where a hand-in would be;
// applyChoice runs story.decide. Chain lines, labels and names go through Lang.L (the player's language).
//
// Nodes: 'root' (greeting + everything there is to talk about), 'offer:<chain>' (the pitch; accept or not now),
// 'ask:<chain>' (a running chain: the reminder, where to go next, drop it).
//
// Authored content (GREET, TOPICS): { if: gate (Rules.gate, evaluated with the speaker's memory), line: text |
// ( ctx ) => text, label, effect: { buy: item, lend: n, repay: true, service: id, note: [ key, value ], disposition: n,
// flag: name, amends: true } }. The first GREET entry whose gate holds is the greeting.

const pick = ( v, ctx ) => ( typeof v === 'function' ? v( ctx ) : v );

export const GREET = {
	roid: [
		{ if: { note: [ 'sinks', '>=', 3 ] }, line: 'Towed in again. The sea keeps giving her back to me. One day it will not.' },
		{ if: { note: [ 'sinks', '>=', 1 ] }, line: 'She came home on a tow rope. It happens to good captains too. Mostly to good captains.' },
		{ if: { note: [ 'bounties', '>=', 1 ] }, line: 'The quay talks about your hunting. Black sails steer wide of my beach now.' },
		{ if: { boat: true, met: true }, line: 'How is she handling? Listen to her hull; she tells you before she complains.' },
	],
	orla: [
		{ if: { note: [ 'rescues', '>=', 1 ] }, line: 'The fisherman you towed home sends his thanks. Again. He will not stop.' },
		{ if: { flag: 'trusted' }, line: 'Reliable. That is still the word next to your name.' },
		{ if: { note: [ 'raiders', '>=', 3 ] }, line: 'The night watch counts you as one of theirs now.' },
	],
	joe: [
		{ if: { debt: true }, line: ( c ) => `Still owe me $${ c.mem.debt }, friend. No rush. Some rush.` },
		{ if: { mem: [ 'trades', '>=', 10 ] }, line: 'My best supplier! The hotel kitchen asks for you by name.' },
	],
	pons: [
		{ if: { chain: 'ponsMinnows', item: 'reinforcedLine' }, line: 'That line holding up? Good. Pons does not sell junk.' },
		{ if: { chain: 'ponsMinnows' }, line: 'The line is unlocked. Buying it is still your decision.' },
		{ if: { met: true }, line: 'The lights look brighter when the sky above us turns black.' },
	],
	tiber: [
		{ if: { flag: 'ponsFriend' }, line: 'Everybody on the pier knows you now. Even the gulls.' },
	],
	ansel: [
		{ if: { mem: [ 'rescues', '>=', 1 ] }, line: 'My nephew is mending nets on the jetty, thanks to you. Come up for tea some time.' },
		{ if: { night: true }, line: 'Mind the stairs. The light is turning; I can talk while it does.' },
	],
	sal: [
		{ if: { item: 'marshLantern' }, line: 'Still got my lantern? Good. It likes the dark more than I do now.' },
	],
	clownCabin: [
		{ if: { mem: [ 'pranks', '>=', 3 ] }, line: 'You keep coming back. You know what happens. I respect that.' },
	],
	// wave 13
	brine: [
		{ if: { chain: 'longWayRound' }, line: 'The bar still talks about that flight. The goats do not.' },
		{ if: { chain: 'ferryToTidemark' }, line: 'PoorGoat\'s friend! Sit. Dice? Nothing on it but pride.' },
	],
	osric: [
		{ if: { chain: 'holdTheLine' }, line: 'The pier stands because of you. Moor at the head, as ever.' },
		{ line: 'Harbourmaster. Moor at the pier head, not on my wharf.' },
	],
	fence: [
		{ if: { chain: 'blackFlag' }, line: 'Brother. The powder is cheaper for you. Keep your voice down.' },
		{ line: 'Buying or selling? Customs seized it somewhere, I pay for it here.' },
	],
	ethena: [
		{ if: { chain: 'learnToFight' }, line: 'Pouch still full? Block as the blow lands. Not before.' },
		{ line: 'Rope, reels, fuel, and good advice for free. The advice is the part people skip.' },
	],
};

export const TOPICS = {
	pons: [
		{ id: 'buyLine', if: { unlocked: 'reinforcedLine', not: { item: 'reinforcedLine' } }, label: `Buy the Reinforced Fishing Line ($${ ITEMS.reinforcedLine.price })`, line: 'A good choice. The catch window is a little wider with that on the reel.', effect: { buy: 'reinforcedLine' } },
	],
	joe: [
		{ id: 'lend', if: { debt: false, not: { money: 25 }, disposition: [ '>=', 0 ] }, label: 'Could you front me $50?', line: 'Fifty now, sixty when the fish come in. Deal? Deal.', effect: { lend: 50 } },
		{ id: 'repay', if: { debt: true }, label: ( c ) => `Pay back the $${ c.mem.debt }`, line: 'Square again. Pleasure doing business.', effect: { repay: true } },
	],
	orla: [
		{ id: 'standing', label: 'How does the harbour see me?', line: ( c ) => standingLine( c ) },
	],
	tiber: [
		{ id: 'standing', label: 'What does the cove think of me?', line: ( c ) => standingLine( c ) },
	],
	roid: [
		{ id: 'sinks', if: { note: [ 'sinks', '>=', 1 ] }, label: 'About my boat going down...', line: 'Patch the hull here, fit pumps if you can, and keep away from guns at close range.' },
	],
	ansel: [
		{ id: 'light', label: 'How long have you kept the light?', line: 'Forty winters. The lamp has outlived two keepers and one wife. The lamp is very patient.' },
	],
	sal: [
		{ id: 'flats', label: 'What is good on the flats?', line: 'Mullet in the day, anything at night. The roots hold fish nobody wants to lose a hook for.' },
	],
	brine: [
		{ id: 'blackwater', if: { not: { flag: 'blackwaterRumour' } }, label: 'Any word from the south?', line: 'Blackwater. A pirate town on the island past the reef, guns on the cliffs. The board pays to know more.', effect: { flag: 'blackwaterRumour' } },
	],
	osric: [
		{ id: 'standing', label: 'What does Tidemark think of me?', line: ( c ) => standingLine( c ) },
	],
	ethena: [
		{ id: 'parry', label: 'How do I parry?', line: 'Block just as the blow lands, when the amber shows, not before. They stagger, and you hit back.' },
	],
	// anyone the player has wronged: pay to set it right (story.amends)
	'*': [
		{ id: 'amends', if: { hostile: true }, label: ( c ) => `Make amends ($${ c.story.amendsCost( c.npc ) })`, line: 'Coin does not buy back what happened. But it helps. We can talk again.', effect: { amends: true } },
	],
};

// what a keeper says about the player's standing at their port
function standingLine( c ) {

	const port = c.port, r = Math.round( c.story.rep( port ) ), g = Math.round( c.story.grudge[ port ] || 0 );
	if ( c.story.hostile( port ) ) return `After what you did here? Nobody in ${ portName( port ) } will deal with you until it is put right.`;
	const word = r >= 60 ? 'They would follow you into a storm.' : r >= 30 ? 'They speak well of you.' : r >= 10 ? 'People know your face.' : 'You are still a stranger here.';
	return `${ word }${ g > 0 ? ' Some still remember the trouble, mind.' : '' }`;

}

// the person's opening line at the root
function greeting( story, npc, ctx, pending ) {

	const spec = story.npc( npc );
	if ( story.hostileTo( npc ) ) return 'Nothing for you here. Not after what happened in our harbour.';
	if ( pending ) return pending;
	for ( const g of GREET[ npc ] || [] ) if ( gate( g.if, ctx ) ) return pick( g.line, ctx );
	const mem = ctx.mem;
	if ( ! mem.met ) return `${ spec.name }. ${ spec.role }. ${ story.offers( npc ).length ? 'You look like someone who takes work.' : 'Good to meet you.' }`;
	const chatter = story.residentLines( npc );
	if ( chatter.length ) return chatter[ ( mem.talks | 0 ) % chatter.length ];
	return mem.disposition >= 30 ? 'There you are. Always good to see you.' : mem.disposition <= - 10 ? 'Oh. It is you.' : 'Back again?';

}

function rewardText( r ) {

	if ( ! r ) return '';
	const bits = [];
	if ( r.money ) bits.push( `+$${ r.money }` );
	if ( r.xp ) bits.push( `+${ r.xp } XP` );
	for ( const [ p, n ] of Object.entries( r.rep || {} ) ) if ( n ) bits.push( `${ portName( p ) } +${ n }` );
	if ( r.item && ITEMS[ r.item ] ) bits.push( L( ITEMS[ r.item ].name ) );
	if ( r.sailor && r.sailor.name ) bits.push( `${ r.sailor.name } ${ L( 'signs on' ) }` );
	if ( r.unlockItem && ITEMS[ r.unlockItem ] ) bits.push( `${ ITEMS[ r.unlockItem ].name } for sale` );
	if ( r.unlock ) bits.push( 'a new crew member' );
	return bits.join( ' · ' );

}

export function buildModel( story, npc, node = 'root', said = null ) {

	const spec = story.npc( npc );
	if ( ! spec ) return null;
	const ctx = story.ctx( npc ), mem = ctx.mem;
	const base = { npc, name: L( spec.name ), role: L( spec.role ), port: spec.port, portName: portName( spec.port ), mood: moodWord( mem.disposition ), said: said || null };
	const back = { id: 'back', label: 'Back', kind: 'back' };
	const bye = { id: 'bye', label: 'Goodbye.', kind: 'bye' };

	if ( node.startsWith( 'offer:' ) ) {

		const id = node.slice( 6 ), c = story.chain( id );
		if ( c && story.canAccept( id ) ) {

			return { ...base, node, line: L( c.offer ), reward: rewardText( c.reward ), choices: [ { id: `accept:${ id }`, label: L( c.accept ), kind: 'accept' }, { id: 'back', label: L( 'Not now.' ), kind: 'back' } ] };

		}

		node = 'root';

	}

	if ( node.startsWith( 'ask:' ) ) {

		const id = node.slice( 4 ), c = story.chain( id );
		if ( c && story.isActive( id ) ) {

			const p = story.pendingAt( npc ).find( ( x ) => x.id === id );
			const line = L( p && p.kind === 'deliver' && ! p.ready ? p.step.missing || c.remind : c.remind );
			return { ...base, node, line, hint: story.stepText( id ), choices: [ back, { id: `drop:${ id }`, label: 'I am giving this one up.', kind: 'ask' } ] };

		}

		node = 'root';

	}

	// root: hand-ins first, then running chains, offers, the person's topics, gifts, goodbye
	const choices = [];
	const hostile = story.hostileTo( npc );
	let pendingLine = null;
	if ( ! hostile ) {

		for ( const p of story.pendingAt( npc ) ) {

			const c = story.chain( p.id );
			if ( p.ready ) {

				if ( ! pendingLine ) pendingLine = L( p.kind === 'talk' ? p.step.say : p.step.ready );
				// a choice step: one answer per option (the path the chain takes)
				if ( Array.isArray( p.step.choices ) && p.step.choices.length ) for ( const o of p.step.choices ) choices.push( { id: `pick:${ p.id }:${ o.id }`, label: L( o.label ), kind: 'pick', hint: L( c.title ) } );
				else choices.push( { id: `turnin:${ p.id }`, label: L( p.step.response || 'Here.' ), kind: 'turnin', hint: L( c.title ) } );

			} else choices.push( { id: `ask:${ p.id }`, label: `${ L( 'About' ) } ${ L( c.title ).toLowerCase() }...`, kind: 'ask', hint: story.stepText( p.id ) } );

		}

		for ( const id of story.runningFrom( npc ) ) {

			if ( choices.some( ( ch ) => ch.id.endsWith( `:${ id }` ) ) ) continue;
			choices.push( { id: `ask:${ id }`, label: `${ L( 'About' ) } ${ L( story.chain( id ).title ).toLowerCase() }...`, kind: 'ask', hint: story.stepText( id ) } );

		}

		for ( const id of story.offers( npc ) ) choices.push( { id: `offer:${ id }`, label: `${ L( 'Any work?' ) } (${ L( story.chain( id ).title ) })`, kind: 'offer' } );

	}

	for ( const t of [ ...( TOPICS[ npc ] || [] ), ...TOPICS[ '*' ] ] ) {

		if ( hostile && ! ( t.effect && t.effect.amends ) ) continue;
		if ( ! gate( t.if, ctx ) ) continue;
		choices.push( { id: `topic:${ t.id }`, label: pick( t.label, ctx ), kind: 'topic' } );

	}

	if ( ! hostile ) {

		for ( const s of story.servicesFor( npc ) ) choices.push( { id: `service:${ s.id }`, label: s.label, kind: 'service' } );
		if ( story.canGift( npc ) ) choices.push( { id: 'gift', label: `Give ${ spec.name } a fish`, kind: 'gift', hint: 'They will remember it' } );

	}

	choices.push( bye );
	return { ...base, node: 'root', line: greeting( story, npc, ctx, pendingLine ), choices };

}

// run a choice: returns where the conversation goes next and what the person answers
export function applyChoice( story, npc, id ) {

	const ctx = story.ctx( npc );
	const [ kind, arg ] = String( id ).split( /:(.*)/s );
	switch ( kind ) {

		case 'bye': return { node: 'root', said: null, close: true };
		case 'back': return { node: 'root', said: null };
		case 'offer': return { node: `offer:${ arg }`, said: null };
		case 'ask': return { node: `ask:${ arg }`, said: null };
		case 'accept': {

			const c = story.chain( arg );
			const ok = story.accept( arg, npc );
			return { node: 'root', said: ok ? L( c.accepted ) : story.lastError || 'Not now.' };

		}

		case 'drop': {

			story.abandon( arg );
			return { node: 'root', said: 'Pity. Come back if you change your mind.' };

		}

		case 'turnin': {

			const r = story.turnIn( arg, npc );
			if ( ! r ) return { node: 'root', said: story.lastError || 'Not yet.' };
			const extra = r.done ? rewardText( r.reward ) : '';
			return { node: 'root', said: `${ r.done ? L( r.said ) : r.said }${ extra ? ` (${ extra })` : '' }` };

		}

		case 'pick': {

			// a choice step: 'pick:<chain>:<option>'
			const [ chain, option ] = String( arg || '' ).split( ':' );
			const r = typeof story.decide === 'function' ? story.decide( chain, option, npc ) : null;
			if ( ! r ) return { node: 'root', said: story.lastError || 'Not yet.' };
			const extra = r.done ? rewardText( r.reward ) : '';
			return { node: 'root', said: `${ r.said }${ extra ? ` (${ extra })` : '' }` };

		}

		case 'topic': {

			const t = [ ...( TOPICS[ npc ] || [] ), ...TOPICS[ '*' ] ].find( ( x ) => x.id === arg );
			if ( ! t || ! gate( t.if, ctx ) ) return { node: 'root', said: null };
			const line = pick( t.line, ctx ); // before the effect: the line reads the state it answers
			const err = t.effect ? story.applyEffect( t.effect, npc ) : null;
			return { node: 'root', said: err || line };

		}

		case 'service': {

			const ok = story.openService( arg );
			return { node: 'root', said: ok ? null : 'That is closed right now.', close: !! ok };

		}

		case 'gift': {

			const f = story.gift( npc );
			return { node: 'root', said: f ? giftLine( story.memoryOf( npc ) ) : story.lastError || 'Nothing to give.' };

		}

		default: return { node: 'root', said: null };

	}

}

function giftLine( mem ) {

	return mem.gifts > 3 ? 'Again? You will spoil me. Thank you.' : mem.gifts > 1 ? 'Another one? You are kind.' : 'For me? That is kind of you. I will not forget it.';

}

// every chain id a person gives, in the order they offer them (the tests and the journal use it)
export function chainsOf( npc ) {

	return Object.keys( CHAINS ).filter( ( id ) => CHAINS[ id ].giver === npc );

}

export { NPCS };
