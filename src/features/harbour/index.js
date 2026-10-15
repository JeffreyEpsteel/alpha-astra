import { WORLD } from '../../world/WorldLayout.js';
import {
	HOMES, PLACES, TAVERN_HOME, HARBOUR_FOLK, PORT_FOLK, FOLK_NAMES, FOLK_CHARACTERS, ROLE_LINES, yawToward,
} from '../../world/residents/ResidentData.js';
import { ROLES, ROLE_IDS, SCHEDULES, scheduleOf, activityAt, nextChange } from './Roles.js';
import { Director, findLandSpot, populationFor, generatedRole, hashId, portSize } from './Schedules.js';
import { Tavern, MENU } from './Tavern.js';
import { TavernPanel } from './TavernPanel.js';
import { TavernAudio } from './TavernAudio.js';
import { clockText } from './PanelKit.js';

// Harbour life (docs/UNREAL_PARITY.md Q9 / Q10 / A5): the residents keep a day by the island clock (work, eat,
// the tavern, sleep indoors), the seven roles with their craft loops, a population scaled by port size (home,
// Pons and every port of WORLD.ports, read dynamically), residents remembering the player, and the tavern
// (food and drink buffs, rumours, the no-wager dice round, its sound). Crafting is its own feature
// (src/features/crafting); story dialogue opens either through openService.
//
//   features.add( 'harbour', harbourModule );          // after trade / notices / story; app.residents may be null
//   const hb = features.get( 'harbour' );
//   hb.services()                 [ { id, name, ports, keepers } ]  'tavern' | 'dice' | 'rumours' | 'crafting'
//   hb.openService( id, { port?, npc? } ) -> bool       opens the window (the tavern of that port / nearest)
//   hb.biteModifier()             1 .. 1.4: the tavern buffs (Game.weatherBiteDelay divides the delay by it)
//   hb.activityOf( residentId )   'sleep' | 'work' | 'eat' | 'tavern' | ...      hb.atWork( residentId )
//   hb.sites                      { tavern: [ { port, name, x, z, keeper } ], crafting: [ ... ] }
//   hb.shelf[ port ]              { bait, rope, coin } made by the residents' work loops (crafting sells it)
//   hb.memoryOf( residentId )     { talks, firstDay, lastDay } plus the story's record when the story has one
//   hb.order( item, port ) / askRumour( port ) / rollDice( port )     what the tavern window calls
//   hb.alarm( port, seconds, near? )   the port's residents run home and stay in (townlife: cannon fire, raids)
//   hb.isOpen / close() / update( dt ) / toJSON() / fromJSON() / reset() / dispose()
//
// Events emitted: residentTalked { id, name, role, port, talks }, harbourBuff { id, name, hours, port },
// rumourHeard { kind, text, x?, z? }, diceRolled { player, resident, outcome, port, residentId },
// shelfMade { port, what, by }. Hooks it takes by itself: app.residents.onTalk (chained) and residents.add.

export { ROLES, ROLE_IDS, SCHEDULES, MENU, activityAt };

const SAVE_V = 1;
const MAX_MEMORY = 96;
const CLOSE_M = 7; // walking this far from the tavern closes its window
const TAVERN_NAMES = { pons: 'The Driftwood Rest', tidemark: 'The Tide & Tankard' };

function seeded( seed ) {

	let a = seed >>> 0;
	return () => {

		a = ( a + 0x6d2b79f5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

export class Harbour {

	constructor( app, features, opts = {} ) {

		this.app = app;
		this.features = features;
		this.opts = opts;
		this.rng = opts.rng || Math.random;
		this.R = opts.residents !== undefined ? opts.residents : ( app && app.residents ) || null;
		this.time = 0;
		this.hour = this._clockHour();
		this._lastHour = this.hour;
		this.hours = 0;
		this.day = 0;
		this.shelf = { home: { bait: 0, rope: 0, coin: 0 } };
		this.memory = {};
		this.places = { home: { homes: HOMES, plaza: PLACES.plaza, patio: PLACES.patio, mouth: PLACES.mouth, tavern: TAVERN_HOME } };
		this.sites = {
			tavern: [ { port: 'home', name: TAVERN_HOME.name, x: TAVERN_HOME.x, z: TAVERN_HOME.z, keeper: 'nell' } ],
			crafting: [ { port: 'home', name: 'Boathouse workbench', x: PLACES.workshop.x, z: PLACES.workshop.z, keeper: 'bran' } ],
		};
		this.added = [];
		this.populated = new Set();
		this.director = new Director( {
			places: this.places, shelf: this.shelf,
			onMake: ( e ) => this.features && this.features.emit && this.features.emit( 'shelfMade', e ),
		} );
		this.tavern = new Tavern( { features, clock: () => this.hour, rng: this.rng } );
		this.panel = new TavernPanel( this );
		this.panel.onClose = () => {};
		this.audio = opts.audio === false ? null : new TavernAudio( app, { rng: this.rng } );
		this._removers = [];
		this._portT = 0;
		this._refreshT = 0;
		this.openSite = null;
		this._populateAll();
		this._registerSites();
		if ( this.R ) {

			this._prevTalk = this.R.onTalk;
			this.R.onTalk = ( r, res, game ) => {

				let out = res;
				if ( this._prevTalk ) out = this._prevTalk( r, out, game ) || out;
				return this._onTalk( r, out, game );

			};

		}

	}

	_clockHour() {

		const s = this.app && this.app.settings;
		return s && Number.isFinite( s.timeOfDay ) ? s.timeOfDay : 12;

	}

	get isOpen() {

		return this.panel.isOpen;

	}

	close() {

		this.panel.close();
		this.openSite = null;

	}

	_toast( text, ms = 3200 ) {

		if ( this.opts.toasts === false ) return;
		const g = this.app && this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	// ------------------------------------------------------------------ population

	_ground() {

		const t = this.app && this.app.terrainData;
		if ( ! t || ! t.heightAt ) return null;
		const col = this.app.colliders;
		return {
			height: ( x, z ) => t.heightAt( x, z ),
			blocked: col && col.resolveCapsule ? ( x, z, h ) => col.resolveCapsule( { x, y: h, z }, 0.6, 1.7 ) : null,
		};

	}

	_populateAll() {

		for ( const p of WORLD.ports || [] ) this._populate( p );

	}

	_populate( port ) {

		if ( ! port || this.populated.has( port.id ) ) return;
		if ( port.id === 'home' ) {

			this.populated.add( 'home' );
			if ( this.R ) for ( const d of HARBOUR_FOLK ) this._add( { ...d, port: 'home' } );
			return;

		}

		const ground = this._ground();
		const c = port.stand || ( port.dock && port.dock.start ) || port.center;
		if ( ! ground || ! c ) return; // try again when the terrain exists
		this.populated.add( port.id );
		const rand = seeded( hashId( 'harbour:' + port.id ) );
		const taken = [ { x: c.x, z: c.z } ];
		if ( port.dock && port.dock.start ) taken.push( { x: port.dock.start.x, z: port.dock.start.z } );
		const spot = ( r0, r1, cx = c.x, cz = c.z ) => {

			const s = findLandSpot( ground, cx, cz, r0, r1, rand, taken );
			if ( s ) taken.push( s );
			return s;

		};

		const P = { homes: {}, plaza: [], patio: [], mouth: [], tavern: null };
		for ( let i = 0; i < 3; i ++ ) {

			const s = spot( 4, 11 );
			if ( s ) P.plaza.push( s );

		}

		const folk = [];
		for ( const d of PORT_FOLK ) {

			if ( d.port !== port.id ) continue;
			// a named resident with its own spot in a town (Tidemark) stands there; the rest by rings round the stand
			const s = d.at ? { x: d.at.x, z: d.at.z, ...( d.at.deck ? { deck: true } : {} ) } : spot( d.near[ 0 ], d.near[ 1 ] ); // (deck: on a jetty's planks)
			if ( d.at ) taken.push( s );
			if ( s ) folk.push( { ...d, spot: { ...s, yaw: yawToward( s.x, s.z, c.x, c.z ) } } );

		}

		const want = Math.max( 0, populationFor( port ) - folk.length );
		let craftsman = false;
		for ( let n = 0; n < want; n ++ ) {

			const role = generatedRole( n );
			const s = spot( 5, 18 );
			if ( ! s ) continue;
			const h = hashId( port.id + ':' + n );
			const name = FOLK_NAMES[ h % FOLK_NAMES.length ];
			const d = {
				id: `${ port.id }_${ role }${ n }`, name, port: port.id, role, character: FOLK_CHARACTERS[ ( h >>> 5 ) % FOLK_CHARACTERS.length ],
				scale: role === 'child' ? 0.68 : 0.94 + ( ( h >>> 9 ) % 12 ) / 100, generated: true,
				spot: { ...s, yaw: yawToward( s.x, s.z, c.x, c.z ) }, gestures: ROLES[ role ].work.gestures, base: role === 'tavern' ? 'Chat_Gesture' : undefined,
				lines: ROLE_LINES[ role ],
			};
			if ( role === 'fisher' && port.dock && port.dock.start && port.dock.end ) {

				// on the jetty, two thirds of the way out, and back to the stand with the catch
				const t = 0.66, j = { x: port.dock.start.x + ( port.dock.end.x - port.dock.start.x ) * t, z: port.dock.start.z + ( port.dock.end.z - port.dock.start.z ) * t };
				d.work = [
					{ x: j.x, z: j.z, yaw: ( port.dock.heading || 0 ) + Math.PI / 2, base: 'Fishing_Hold', gestures: [ 'Fishing_Reel', 'Inspect_Catch' ], dwell: 60 },
					{ x: s.x, z: s.z, base: 'Idle_Breathe', gestures: [ 'Inspect_Catch' ], dwell: 12, makes: 'bait' },
				];

			} else if ( role === 'dockworker' ) {

				const s2 = spot( 3, 9, port.dock && port.dock.start ? port.dock.start.x : c.x, port.dock && port.dock.start ? port.dock.start.z : c.z ) || s;
				d.work = [ { x: s.x, z: s.z, base: 'Idle_Breathe', gestures: [ 'Sweep_Work', 'Inspect_Catch' ], dwell: 40, makes: 'rope', work: true }, { x: s2.x, z: s2.z, base: 'Idle_Breathe', gestures: [ 'Inspect_Catch', 'Sweep_Work' ], dwell: 25, work: true } ];
				if ( ! craftsman ) {

					craftsman = true;
					d.service = 'crafting';
					this.sites.crafting.push( { port: port.id, name: `${ name }'s bench`, x: s.x, z: s.z, keeper: d.id } );

				}

			} else if ( role === 'guard' ) {

				d.work = [ s, spot( 6, 20 ) || s, spot( 6, 20 ) || s ].map( ( q ) => ( { x: q.x, z: q.z, base: 'Idle_Breathe', gestures: [ 'Look_Around' ], dwell: 7 } ) );

			} else if ( role === 'smuggler' ) {

				const w = spot( 20, 40 );
				if ( w ) P.mouth.push( w );

			} else if ( role === 'merchant' ) {

				d.work = [ { x: s.x, z: s.z, base: 'Talk', gestures: [ 'Point', 'Shrug' ], dwell: 40 }, { ...( spot( 3, 8 ) || s ), base: 'Idle_Breathe', gestures: [ 'Inspect_Catch' ], dwell: 12, makes: 'coin' } ];

			}

			folk.push( d );

		}

		// homes: a door somewhere up the island for each (they go inside at night)
		for ( const d of folk ) {

			const h = spot( 14, 36 );
			if ( h ) {

				P.homes[ d.id ] = { door: { ...h, yaw: yawToward( c.x, c.z, h.x, h.z ) } };
				d.home = d.id;

			}

			if ( d.service === 'tavern' && ! P.tavern ) {

				P.tavern = { x: d.spot.x, z: d.spot.z };
				d.work = [ { x: d.spot.x, z: d.spot.z, yaw: d.spot.yaw, base: d.base || 'Idle_Breathe', gestures: d.gestures, dwell: 60 } ];
				for ( let i = 0; i < 3; i ++ ) {

					const q = spot( 2.5, 6, d.spot.x, d.spot.z );
					if ( q ) P.patio.push( q );

				}

				this.sites.tavern.push( { port: port.id, name: TAVERN_NAMES[ port.id ] || `${ port.name } tavern`, x: d.spot.x, z: d.spot.z, keeper: d.id } );

			}

		}

		this.places[ port.id ] = P;
		this.shelf[ port.id ] = this.shelf[ port.id ] || { bait: 0, rope: 0, coin: 0 };
		if ( this.R ) for ( const d of folk ) this._add( { ...d, lazy: true } );

	}

	_add( d ) {

		if ( ! this.R || this.R.byId( d.id ) ) return null;
		const r = this.R.add( d );
		this.added.push( d.id );
		return r;

	}

	// ------------------------------------------------------------------ sites (E) and services

	_registerSites() {

		if ( ! this.features || ! this.features.interactable ) return;
		for ( const s of this.sites.tavern ) this._registerTavern( s );

	}

	_registerTavern( s ) {

		if ( s._reg ) return;
		s._reg = true;
		this._removers.push( this.features.interactable( {
			id: 'tavern:' + s.port, position: () => ( { x: s.x, y: this._siteY( s ), z: s.z } ), radius: 2.6,
			prompt: () => ( this.openSite === s ? `Leave ${ s.name }` : this.siteOpen( s ) ? `Visit ${ s.name }` : `${ s.name } (closed)` ),
			onInteract: () => this._toggleTavern( s ),
			when: () => ! this.app || ! this.app.player || this.app.player.mode === 'walk',
		} ) );

	}

	_siteY( s ) {

		const t = this.app && this.app.terrainData;
		const p = this.app && this.app.player && this.app.player.position;
		return t && t.heightAt ? t.heightAt( s.x, s.z ) : p ? p.y : 0;

	}

	residentName( id ) {

		const r = this.R && this.R.byId( id );
		if ( r ) return r.name;
		const d = [ ...HARBOUR_FOLK, ...PORT_FOLK ].find( ( f ) => f.id === id );
		return d ? d.name : null;

	}

	activityOf( id ) {

		const r = this.R && this.R.byId( id );
		return r ? this.director.activityOf( r ) : null;

	}

	atWork( id ) {

		const r = this.R && this.R.byId( id );
		return r ? this.director.atWork( r ) : true; // no residents (or not this one): the service is just there

	}

	// a keeper's service is open while the keeper works (the sandbox never closes)
	siteOpen( s ) {

		if ( this.features && this.features.sandbox ) return true;
		if ( ! s.keeper || ! this.R || ! this.R.byId( s.keeper ) ) return true;
		const r = this.R.byId( s.keeper );
		return ! this.director.info.has( r.id ) || this.director.atWork( r );

	}

	// when a closed site opens again (hour), from the keeper's schedule
	opensAt( s ) {

		const r = s.keeper && this.R && this.R.byId( s.keeper );
		if ( ! r ) return null;
		return nextChange( scheduleOf( r.data ), this.hour, 'work' );

	}

	_toggleTavern( s, tab = 'menu' ) {

		if ( this.openSite === s && this.panel.isOpen ) {

			this.close();
			return false;

		}

		if ( ! this.siteOpen( s ) ) {

			const at = this.opensAt( s );
			this._toast( `${ s.name } is closed${ at !== null ? ` (opens ${ clockText( at ) })` : '' }.`, 2600 );
			return false;

		}

		this.openSite = s;
		return this.panel.show( s, tab );

	}

	_siteFor( kind, port = null ) {

		const list = this.sites[ kind ] || [];
		if ( port ) return list.find( ( s ) => s.port === port ) || null;
		const p = this.app && this.app.player && this.app.player.position;
		if ( ! p ) return list[ 0 ] || null;
		let best = null, bd = Infinity;
		for ( const s of list ) {

			const d = ( s.x - p.x ) ** 2 + ( s.z - p.z ) ** 2;
			if ( d < bd ) { bd = d; best = s; }

		}

		return best;

	}

	services() {

		const crafting = this.features && this.features.get ? this.features.get( 'crafting' ) : null;
		const tv = this.sites.tavern.map( ( s ) => s.port ), keepers = this.sites.tavern.map( ( s ) => s.keeper );
		const out = [
			{ id: 'tavern', name: 'Tavern: food and drink', ports: tv, keepers },
			{ id: 'dice', name: 'A round of dice (no wager)', ports: tv, keepers },
			{ id: 'rumours', name: 'Rumours', ports: tv, keepers },
		];
		if ( crafting ) out.push( { id: 'crafting', name: 'Crafting', ports: this.sites.crafting.map( ( s ) => s.port ), keepers: this.sites.crafting.map( ( s ) => s.keeper ) } );
		return out;

	}

	// opens a service window; story dialogue calls this (npc: a resident id picks that keeper's port)
	openService( id, { port = null, npc = null } = {} ) {

		if ( npc && ! port ) {

			const r = this.R && this.R.byId( npc );
			const site = [ ...this.sites.tavern, ...this.sites.crafting ].find( ( s ) => s.keeper === npc );
			port = site ? site.port : r ? r.port : null;

		}

		if ( id === 'crafting' ) {

			const c = this.features && this.features.get ? this.features.get( 'crafting' ) : null;
			return !! ( c && c.open && c.open( port || ( this._siteFor( 'crafting' ) || {} ).port || 'home' ) );

		}

		const tab = id === 'dice' ? 'dice' : id === 'rumours' ? 'rumours' : id === 'tavern' || id === 'menu' ? 'menu' : null;
		if ( ! tab ) return false;
		const s = this._siteFor( 'tavern', port );
		if ( ! s ) return false;
		this.openSite = s;
		return this.panel.show( s, tab );

	}

	// ------------------------------------------------------------------ the tavern's actions

	order( id, port = 'home' ) {

		const r = this.tavern.buy( id, port );
		if ( r.ok && this.app && this.app.audio && this.app.audio.coin ) try { this.app.audio.coin(); } catch ( e ) { /* ignore */ }
		return r;

	}

	askRumour( port = 'home' ) {

		return this.tavern.ask( port );

	}

	rollDice( port = 'home' ) {

		const s = this._siteFor( 'tavern', port ) || this.sites.tavern[ 0 ];
		const who = ( s && s.keeper && this.residentName( s.keeper ) ) || 'The innkeeper';
		const r = this.tavern.dice.roll( this.time, who );
		if ( r.ok && this.features && this.features.emit ) this.features.emit( 'diceRolled', { player: r.player, resident: r.resident, outcome: r.outcome, port, residentId: s ? s.keeper : null } );
		return r;

	}

	biteModifier() {

		return this.tavern.biteModifier( this.hour );

	}

	// how full a tavern is (0..1): residents on its patio or inside, and the townsfolk there (townlife)
	crowd( port = 'home' ) {

		const tl = this.features && this.features.get ? this.features.get( 'townlife' ) : null;
		const town = tl && tl.crowd ? tl.crowd( port ) : 0;
		if ( ! this.R ) return town ? Math.min( 1, town / 8 ) : 0.3;
		let n = 0;
		for ( const r of this.R.list ) if ( ( r.port || 'home' ) === port && this.director.activityOf( r ) === 'tavern' ) n ++;
		return Math.min( 1, n / 6 + town / 10 );

	}

	// a raid or cannon fire at a port: its residents run home and stay in (townlife calls this)
	alarm( port = 'home', seconds = 90, near = null ) {

		return this.R ? this.director.alarm( this.R.list, port, seconds, near ) : 0;

	}

	// ------------------------------------------------------------------ memory

	storyMemory( id ) {

		const s = this.features && this.features.get ? this.features.get( 'story' ) : null;
		const m = s && s.memory;
		if ( ! m ) return null;
		try {

			if ( typeof m.get === 'function' ) return m.get( id ) || null;
			if ( typeof m.of === 'function' ) return m.of( id ) || null;
			if ( m.npcs && m.npcs[ id ] ) return m.npcs[ id ];
			return m[ id ] && typeof m[ id ] === 'object' ? m[ id ] : null;

		} catch ( e ) { return null; }

	}

	memoryOf( id ) {

		const own = this.memory[ id ] || { talks: 0, firstDay: - 1, lastDay: - 1 };
		const story = this.storyMemory( id );
		return story ? { ...own, story, disposition: Number.isFinite( story.disposition ) ? story.disposition : 0 } : { ...own, disposition: 0 };

	}

	_remember( r ) {

		const m = this.memory[ r.id ] || ( this.memory[ r.id ] = { talks: 0, firstDay: this.day, lastDay: - 1 } );
		const prevDay = m.lastDay;
		m.talks ++;
		m.lastDay = this.day;
		const keys = Object.keys( this.memory );
		if ( keys.length > MAX_MEMORY ) delete this.memory[ keys[ 0 ] ];
		return { ...m, prevDay };

	}

	// a line that shows the resident remembers the player (null: say the usual line)
	greeting( r, m, roll = this.rng() ) {

		const mem = this.memoryOf( r.id );
		const disp = mem.disposition || 0;
		const act = this.director.activityOf( r );
		if ( disp <= - 10 && roll < 0.6 ) return [ 'Hmph. You again.', 'I remember what you did. Keep walking.', 'Say what you want and go.' ][ m.talks % 3 ];
		if ( m.talks === 1 && r.data && r.data.generated ) return `I am ${ r.name }. ${ ROLES[ r.role ] ? ROLES[ r.role ].label : 'Islander' } here at ${ portName( r.port ) }.`;
		if ( m.prevDay >= 0 && this.day - m.prevDay >= 2 ) return `There you are! ${ this.day - m.prevDay } days since I saw you at ${ portName( r.port ) }.`;
		if ( m.talks === 5 ) return disp >= 30 ? 'Always good to see you, friend.' : 'You again! Good. The harbour likes a familiar face.';
		if ( act === 'tavern' && roll < 0.35 ) return 'Evening! Pull up a stool, the stew is on.';
		if ( act === 'eat' && roll < 0.3 ) return 'Lunch. Talk to me after, I am chewing.';
		if ( act === 'wake' && roll < 0.3 ) return ( this.hour < 12 ? 'Barely awake. Ask me later.' : 'Off home soon. Long day.' );
		return null;

	}

	_onTalk( r, res, game ) {

		if ( ! r ) return res;
		const m = this._remember( r );
		if ( this.features && this.features.emit ) this.features.emit( 'residentTalked', { id: r.id, name: r.name, role: r.role || null, port: r.port || 'home', talks: m.talks } );
		let out = res;
		if ( res && ! res.prank ) {

			const g = this.greeting( r, m );
			if ( g ) out = { ...res, line: g };

		}

		const svc = r.data && r.data.service;
		if ( svc === 'tavern' ) {

			const s = this.sites.tavern.find( ( x ) => x.keeper === r.id );
			if ( s ) {

				if ( this.openSite === s && this.panel.isOpen ) this.close();
				else {

					this.openSite = s;
					this.panel.show( s, 'menu' );

				}

			}

		} else if ( svc === 'crafting' ) {

			const c = this.features && this.features.get ? this.features.get( 'crafting' ) : null;
			if ( c ) {

				if ( c.isOpen && c.close ) c.close();
				else if ( c.open ) c.open( r.port || 'home' );

			}

		} else if ( svc === 'trade' ) {

			const t = this.features && this.features.get ? this.features.get( 'trade' ) : null;
			if ( t && t.toggle ) try { t.toggle( r.port || 'home' ); } catch ( e ) { /* that port has no market */ }

		}

		return out;

	}

	// ------------------------------------------------------------------ frame

	update( dt ) {

		dt = Math.min( Math.max( Number.isFinite( dt ) ? dt : 0, 0 ), 0.25 );
		this.time += dt;
		const h = this._clockHour();
		let dh = h - this._lastHour;
		if ( dh < - 12 ) { dh += 24; this.day ++; } else if ( dh < 0 ) dh = 0; // the clock set back: no time passes
		if ( dh > 1.5 ) dh = 0; // a jump (a loaded save, the sandbox slider) does not age the buffs
		this._lastHour = h;
		this.hour = h;
		if ( dh > 0 ) {

			this.hours += dh;
			if ( this.tavern.advance( dh ) && this.panel.isOpen ) this.panel.refresh();

		}

		this._portT -= dt;
		if ( this._portT <= 0 ) {

			this._portT = 5;
			const before = this.sites.tavern.length;
			this._populateAll();
			if ( this.sites.tavern.length !== before ) this._registerSites();

		}

		if ( this.R ) this.director.tick( this.R.list, h, dt );

		const p = this.app && this.app.player && this.app.player.position;
		if ( this.panel.isOpen && this.openSite && p && Math.hypot( p.x - this.openSite.x, p.z - this.openSite.z ) > CLOSE_M ) this.close();
		this._refreshT -= dt;
		if ( this._refreshT <= 0 && this.panel.isOpen ) {

			this._refreshT = 0.5;
			this.panel.refresh();

		}

		if ( this.audio && p ) {

			let best = null, bd = Infinity;
			for ( const s of this.sites.tavern ) {

				const d = Math.hypot( s.x - p.x, s.z - p.z );
				if ( d < bd ) { bd = d; best = s; }

			}

			const open = best && this.siteOpen( best );
			this.audio.update( dt, { distance: open ? bd : Infinity, crowd: best ? this.crowd( best.port ) : 0, inside: this.panel.isOpen } );

		}

	}

	// ------------------------------------------------------------------ save

	toJSON() {

		return { v: SAVE_V, day: this.day, tavern: this.tavern.toJSON(), shelf: JSON.parse( JSON.stringify( this.shelf ) ), memory: JSON.parse( JSON.stringify( this.memory ) ) };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this.day = Number.isFinite( d.day ) ? Math.max( 0, Math.floor( d.day ) ) : 0;
		this.tavern.fromJSON( d.tavern );
		if ( d.shelf && typeof d.shelf === 'object' ) {

			for ( const [ port, s ] of Object.entries( d.shelf ) ) {

				if ( ! s || typeof s !== 'object' || port.length > 24 ) continue;
				const t = this.shelf[ port ] || ( this.shelf[ port ] = { bait: 0, rope: 0, coin: 0 } );
				for ( const k of [ 'bait', 'rope', 'coin' ] ) t[ k ] = Number.isFinite( s[ k ] ) ? Math.max( 0, Math.min( 999, Math.floor( s[ k ] ) ) ) : 0;

			}

		}

		this.memory = {};
		if ( d.memory && typeof d.memory === 'object' ) {

			for ( const [ id, m ] of Object.entries( d.memory ).slice( 0, MAX_MEMORY ) ) {

				if ( ! m || typeof m !== 'object' || id.length > 40 ) continue;
				this.memory[ id ] = { talks: Math.max( 0, Math.floor( m.talks ) || 0 ), firstDay: Math.floor( m.firstDay ) || 0, lastDay: Number.isFinite( m.lastDay ) ? Math.floor( m.lastDay ) : - 1 };

			}

		}

	}

	reset() {

		this.close();
		this.tavern.reset();
		this.memory = {};
		this.day = 0;
		for ( const s of Object.values( this.shelf ) ) for ( const k of Object.keys( s ) ) s[ k ] = 0;

	}

	dispose() {

		this.close();
		for ( const r of this._removers ) r();
		this._removers.length = 0;
		if ( this.R ) {

			for ( const id of this.added ) this.R.remove( id );
			this.R.onTalk = this._prevTalk || null;

		}

		this.added.length = 0;
		if ( this.audio ) this.audio.dispose();
		this.panel.dispose();

	}

}

function portName( id ) {

	const p = ( WORLD.ports || [] ).find( ( q ) => q.id === ( id || 'home' ) );
	return p ? p.name : 'the harbour';

}

export function install( app, features, opts = {} ) {

	return new Harbour( app, features, opts );

}

export { portSize, populationFor };
