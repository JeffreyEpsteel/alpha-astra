import { FISH } from '../../game/FishTable.js';
import { WORLD } from '../../world/WorldLayout.js';
import { Dice } from './Dice.js';

// The tavern service (Unreal BoatServiceComponent tavern + TavernDiceFaceWidget): food and drink with short
// fishing buffs, rumours that point at fishing spots or bounties, and the no-wager dice round. One tavern
// per port that has an innkeeper (home: the Upturned Keel, cottage C; Pons: Tavi's). Logic only; the
// window is TavernPanel.js, the sound TavernAudio.js, and the harbour feature (index.js) wires them up.
//
//   const tv = new Tavern( { features, clock: () => hour, rng } );
//   tv.buy( itemId, port )   -> { ok, item?, buff?, rumour?, reason?, message? }   money via features.state.spend
//   tv.biteModifier( hour )  -> 1 .. 1.4 (the active buffs; > 1 means bites come sooner)
//   tv.buffs                 [ { id, name, bite, until (game hours), night? } ]    tv.advance( hours ) ages them
//   tv.rumour( port )        -> { id, kind: 'fish' | 'port' | 'bounty', text, x?, z? }   (tv.heard: the last few)
//   tv.dice                  Dice (Dice.js)
//
// Events emitted: harbourBuff { id, name, hours, port }, rumourHeard { kind, text, x?, z? }.

export const MENU = [
	{ id: 'stew', name: 'Fish stew', price: 14, text: 'Hot and thick. Bites come a little sooner for three hours.', buff: { id: 'fed', name: 'Full belly', bite: 1.15, hours: 3 } },
	{ id: 'rum', name: 'Cane rum', price: 9, text: 'A tot, and the regulars start talking: you hear a rumour.', buff: { id: 'rum', name: 'Warm courage', bite: 1.06, hours: 1.5 }, rumour: true },
	{ id: 'coffee', name: 'Black coffee', price: 6, text: 'Sharp eyes in the dark: bites sooner at night, dawn and dusk.', buff: { id: 'coffee', name: 'Night eyes', bite: 1.2, hours: 4, night: true } },
	{ id: 'biscuit', name: 'Sea biscuits', price: 5, text: 'Plain and lasting. A small edge for a long day at sea.', buff: { id: 'biscuit', name: 'Ship biscuits', bite: 1.05, hours: 8 } },
];
export const ASK_PRICE = 4; // a drink for whoever knows something
export const MAX_BITE = 1.4;
const MAX_HEARD = 6;

// where each habitat is, in words and on the map (the home harbour's waters)
const HABITAT = {
	shallows: { place: 'in the shallows off the beach', x: 0, z: - 38 },
	pier: { place: 'under the pier', x: 55, z: - 8 },
	reef: { place: 'on the reef west of the pier', x: WORLD.reef.center.x, z: WORLD.reef.center.z },
	bay: { place: 'out in the open bay', x: 40, z: 130 },
	deep: { place: 'in deep water past the reef', x: - 220, z: 320 },
};
const WHEN = { day: 'by day', dawnDusk: 'at dawn and dusk', night: 'after dark', nightOnly: 'only at night', any: 'at any hour' };

export const isNightish = ( h ) => h < 7 || h >= 18.5;

const r1 = ( v ) => Math.round( v * 10 ) / 10;

// fish worth a rumour: the rarer ones, each in its best habitat
export function fishRumours() {

	const out = [];
	for ( const [ id, f ] of Object.entries( FISH ) ) {

		if ( ! f.habitat ) continue;
		let best = null, bw = 0;
		for ( const [ h, w ] of Object.entries( f.habitat ) ) if ( w > bw && HABITAT[ h ] ) { bw = w; best = h; }
		if ( ! best || ! ( f.rarity <= 0.6 ) ) continue;
		const H = HABITAT[ best ];
		out.push( { id: 'fish:' + id, kind: 'fish', species: id, text: `${ f.name } are biting ${ H.place } ${ WHEN[ f.time ] || 'now and then' }, they say.`, x: H.x, z: H.z } );

	}

	return out;

}

// the other ports' waters (WORLD.ports grows: read it every time)
export function portRumours() {

	const out = [];
	for ( const p of WORLD.ports || [] ) {

		if ( p.id === 'home' ) continue;
		const at = p.dock && ( p.dock.end || p.dock.position );
		if ( ! at ) continue;
		out.push( { id: 'port:' + p.id, kind: 'port', port: p.id, text: `Fish school off ${ p.name } this week. Try the water by the jetty.`, x: r1( at.x ), z: r1( at.z ) } );

	}

	return out;

}

// wanted captains on the boards (and the ones the player is hunting)
export function bountyRumours( notices ) {

	if ( ! notices ) return [];
	const posts = [];
	try {

		if ( Array.isArray( notices.active ) ) posts.push( ...notices.active );
		for ( const p of WORLD.ports || [] ) {

			let b = null;
			try { b = notices.board ? notices.board( p.id ) : null; } catch ( e ) { b = null; }
			if ( Array.isArray( b ) ) posts.push( ...b );

		}

	} catch ( e ) { /* the notices feature may be missing or busy */ }

	const seen = new Set(), out = [];
	for ( const p of posts ) {

		if ( ! p || ( p.kind !== 'bounty' && p.type !== 'bounty' ) || seen.has( p.id ) ) continue;
		seen.add( p.id );
		const who = p.captain || p.target || 'A wanted captain';
		const reg = p.region || null;
		const where = reg && reg.compass ? `${ reg.distance ? Math.round( reg.distance ) + ' m ' : '' }${ reg.compass } of the harbour` : 'past the reef';
		out.push( { id: 'bounty:' + p.id, kind: 'bounty', bounty: p.id, text: `${ who } was seen ${ where }. There is a price on that head at the board.`, x: reg ? reg.x : undefined, z: reg ? reg.z : undefined } );

	}

	return out;

}

export class Tavern {

	constructor( { features = null, clock = () => 12, rng = Math.random } = {} ) {

		this.features = features;
		this.clock = clock;
		this.rng = rng;
		this.hours = 0; // game hours since the start (buff timers)
		this.buffs = [];
		this.heard = [];
		this.dice = new Dice( { rng } );
		this.served = 0;

	}

	get state() {

		return this.features ? this.features.state : null;

	}

	advance( hours ) {

		if ( ! ( hours > 0 ) ) return;
		this.hours += hours;
		const before = this.buffs.length;
		this.buffs = this.buffs.filter( ( b ) => b.until > this.hours );
		return before !== this.buffs.length;

	}

	item( id ) {

		return MENU.find( ( m ) => m.id === id ) || null;

	}

	_pay( price ) {

		const st = this.state;
		if ( ! st || ! st.spend ) return true; // tests without a wallet
		return st.spend( price );

	}

	buy( id, port = 'home' ) {

		const item = this.item( id );
		if ( ! item ) return { ok: false, reason: 'unknown', message: 'Not on the menu.' };
		if ( ! this._pay( item.price ) ) return { ok: false, reason: 'money', message: 'Not enough money.' };
		this.served ++;
		const buff = this.addBuff( item.buff, port );
		const out = { ok: true, item, buff };
		if ( item.rumour ) out.rumour = this.rumour( port );
		return out;

	}

	ask( port = 'home' ) {

		if ( ! this._pay( ASK_PRICE ) ) return { ok: false, reason: 'money', message: 'Not enough money.' };
		return { ok: true, rumour: this.rumour( port ) };

	}

	addBuff( b, port = 'home' ) {

		if ( ! b ) return null;
		this.buffs = this.buffs.filter( ( x ) => x.id !== b.id );
		const buff = { id: b.id, name: b.name, bite: b.bite, until: this.hours + b.hours, night: !! b.night };
		this.buffs.push( buff );
		if ( this.features && this.features.emit ) this.features.emit( 'harbourBuff', { id: b.id, name: b.name, hours: b.hours, port } );
		return buff;

	}

	biteModifier( hour = this.clock() ) {

		let m = 1;
		for ( const b of this.buffs ) {

			if ( b.until <= this.hours ) continue;
			if ( b.night && ! isNightish( hour ) ) continue;
			m *= b.bite;

		}

		return Math.min( MAX_BITE, m );

	}

	// game hours left on a buff
	left( b ) {

		return Math.max( 0, b.until - this.hours );

	}

	pool() {

		const notices = this.features && this.features.get ? this.features.get( 'notices' ) : null;
		// wave 20C: the story's quest givers are talked about too (pinned on the map)
		const story = this.features && this.features.get ? this.features.get( 'story' ) : null;
		let quests = [];
		try { quests = ( story && story.rumours && story.rumours() ) || []; } catch ( e ) { /* the story is optional */ }
		return [ ...quests, ...bountyRumours( notices ), ...fishRumours(), ...portRumours() ];

	}

	// one rumour: a bounty when there is one the player has not heard yet (half the time), else a fish or a port
	rumour( port = 'home' ) {

		const pool = this.pool();
		if ( ! pool.length ) return null;
		const fresh = pool.filter( ( r ) => ! this.heard.some( ( h ) => h.id === r.id ) );
		const from = fresh.length ? fresh : pool;
		const bounties = from.filter( ( r ) => r.kind === 'bounty' );
		const quests = from.filter( ( q ) => q.kind === 'quest' );
		const pick = quests.length && this.rng() < 0.5 ? quests : bounties.length && this.rng() < 0.5 ? bounties : from;
		const r = { ...pick[ Math.floor( this.rng() * pick.length ) % pick.length ], port, at: r1( this.hours ) };
		this.heard = [ r, ...this.heard.filter( ( h ) => h.id !== r.id ) ].slice( 0, MAX_HEARD );
		if ( this.features && this.features.emit ) this.features.emit( 'rumourHeard', { id: r.id, kind: r.kind, text: r.text, x: r.x, z: r.z } );
		return r;

	}

	toJSON() {

		return {
			hours: r1( this.hours ),
			buffs: this.buffs.map( ( b ) => ( { id: b.id, name: b.name, bite: b.bite, until: Math.round( b.until * 100 ) / 100, night: b.night } ) ),
			heard: this.heard.map( ( h ) => ( { id: h.id, kind: h.kind, text: h.text, x: h.x, z: h.z } ) ),
			dice: this.dice.toJSON(),
			served: this.served,
		};

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this.hours = Number.isFinite( d.hours ) ? Math.max( 0, d.hours ) : 0;
		const known = new Map( MENU.map( ( m ) => [ m.buff.id, m.buff ] ) );
		this.buffs = Array.isArray( d.buffs ) ? d.buffs.filter( ( b ) => b && known.has( b.id ) && Number.isFinite( b.until ) && b.until > this.hours )
			.map( ( b ) => ( { id: b.id, name: known.get( b.id ).name, bite: known.get( b.id ).bite, until: Math.min( b.until, this.hours + 12 ), night: !! known.get( b.id ).night } ) ) : [];
		this.heard = Array.isArray( d.heard ) ? d.heard.filter( ( h ) => h && typeof h.text === 'string' ).slice( 0, MAX_HEARD )
			.map( ( h ) => ( { id: String( h.id ).slice( 0, 60 ), kind: String( h.kind ).slice( 0, 12 ), text: h.text.slice( 0, 200 ), x: Number.isFinite( h.x ) ? h.x : undefined, z: Number.isFinite( h.z ) ? h.z : undefined } ) ) : [];
		this.dice.fromJSON( d.dice );
		this.served = Number.isFinite( d.served ) ? Math.max( 0, Math.floor( d.served ) ) : 0;

	}

	reset() {

		this.hours = 0;
		this.buffs = [];
		this.heard = [];
		this.served = 0;
		this.dice.reset();

	}

}
