// Sea events (wave 19B), run by the navy feature while the player is at sea:
//   convoy     a merchant convoy under attack on the horizon (EVENTS.convoy.far m off): a trawler named after a rival convoy at
//              sea (trade.rivals), one or two pirate sloops on her (their s.foe: the AI vs AI brains, Brains.pirateWorld). Help her
//              (your shot in a raider, or close by when they are beaten) for EVENTS.convoy.reward and navy standing; the navy's
//              own ships come for the raiders too (Navy._orders reaches farther for them). She sinks: the event is lost.
//              Runs where naval simulates (solo, the room's host).
//   overboard  a man in the water (EVENTS.overboard.far m off): a red flare through the rescue feature's flares (the castaway's
//              look: rescue.fx.launch), a lifebuoy and a head in the swell; E beside him pulls him aboard: a reward, standing,
//              manOverboardRescued { x, z, name }. After EVENTS.overboard.life s a fishing boat picks him up instead.
// The press gang is the navy's (Navy._pressTick: ashore at a port while your standing is low).
//
//   ev.update( dt )   ev.startConvoy() / ev.startOverboard() -> bool (also from a console / a test)   ev.convoy / ev.overboard
//   ev.pullAboard() -> bool    ev.clear()    ev.dispose()

import { Group, Mesh } from '../../engine/index.js';
import { torus, sphere, box, prepare, mergePrepared, mat4 } from '../../world/boat/GeoKit.js';
import { launchMaterial } from '../../world/boat/Launch.js';
import { PAT } from '../../game/GameMaterials.js';
import { inSafeZone } from '../naval/Routes.js';
import { compass } from '../weather/Fronts.js';
import { EVENTS, STANDING } from './NavyData.js';

const SAILORS = [ 'Able Seaman Pike', 'Tom Garrow', 'Young Ned Fisk', 'Midshipman Orme', 'Old Haskett', 'Jory the cook' ];
const ABOARD = [ 'boat', 'deck', 'seat' ];

let SWIMMER = null;
function swimmerGeometry() {

	if ( SWIMMER ) return SWIMMER;
	const parts = [];
	const add = ( g, color, m, rough = 0.6, pattern = PAT.plain ) => parts.push( prepare( g, { color, rough, pattern, matrix: m } ) );
	// a lifebuoy (orange with white bands), his head and shoulders, an arm up
	add( torus( 0.36, 0.1, 10, 24 ), 0xe8561c, mat4( 0, 0.05, 0, Math.PI / 2, 0, 0 ), 0.5 );
	for ( let i = 0; i < 4; i ++ ) add( box( 0.1, 0.22, 0.24 ), 0xf2efe6, mat4( Math.cos( i * Math.PI / 2 ) * 0.36, 0.05, Math.sin( i * Math.PI / 2 ) * 0.36, 0, - i * Math.PI / 2, 0 ), 0.5 );
	add( sphere( 0.13, 12, 8 ), 0xc58b62, mat4( 0, 0.33, 0 ), 0.7, PAT.skin );
	add( box( 0.36, 0.2, 0.22 ), 0x2d3e63, mat4( 0, 0.14, 0 ), 0.8, PAT.cloth );
	add( box( 0.08, 0.55, 0.08 ), 0x2d3e63, mat4( 0.2, 0.45, 0, 0, 0, - 0.25 ), 0.8, PAT.cloth );
	add( sphere( 0.05, 8, 6 ), 0xc58b62, mat4( 0.27, 0.74, 0 ), 0.7, PAT.skin );
	SWIMMER = mergePrepared( parts );
	return SWIMMER;

}

export class SeaEvents {

	constructor( navy ) {

		this.navy = navy;
		this.t = EVENTS.first;
		this.convoy = null;
		this.overboard = null;
		this.stats = { convoys: 0, convoysSaved: 0, convoysLost: 0, overboard: 0, rescued: 0 };
		this._uid = Math.floor( navy.rng() * 1e6 );
		this._n = 0;
		this._off = null;

	}

	get app() { return this.navy.app; }
	get naval() { return this.navy.naval; }

	update( dt ) {

		this._convoyTick( dt );
		this._overboardTick( dt );
		if ( this.convoy || this.overboard ) return;
		this.t -= dt;
		if ( this.t > 0 ) return;
		const [ a, b ] = EVENTS.every;
		this.t = a + ( b - a ) * this.navy.rng();
		if ( ! this.navy.playerAtSea() ) return;
		const nv = this.naval;
		if ( this.navy.rng() < 0.55 && nv && nv.active !== false && nv.spawn ) this.startConvoy();
		else this.startOverboard();

	}

	// a spot in open water `far` m from the player (deep, out of the calm), or null
	_spot( [ lo, hi ], deep = - 5 ) {

		const p = this.navy.boatPos();
		if ( ! p ) return null;
		const T = this.app && this.app.terrainData;
		for ( let i = 0; i < 10; i ++ ) {

			const a = this.navy.rng() * Math.PI * 2, r = lo + ( hi - lo ) * this.navy.rng();
			const x = p.x + Math.sin( a ) * r, z = p.z + Math.cos( a ) * r;
			if ( inSafeZone( x, z ) ) continue;
			if ( T && typeof T.heightAt === 'function' && ! [ [ 0, 0 ], [ 30, 0 ], [ - 30, 0 ], [ 0, 30 ], [ 0, - 30 ] ].every( ( o ) => T.heightAt( x + o[ 0 ], z + o[ 1 ] ) < deep ) ) continue;
			return { x, z, quarter: compass( a ) };

		}

		return null;

	}

	// ------------------------------------------------------------------ the convoy

	startConvoy() {

		const nv = this.naval;
		if ( this.convoy || ! nv || ! nv.spawn || nv.active === false ) return false;
		const at = this._spot( EVENTS.convoy.far, - 6 );
		if ( ! at ) return false;
		const tr = this.navy.get( 'trade' ), rivals = tr && tr.rivals && Array.isArray( tr.rivals.list ) ? tr.rivals.list : [];
		const r = rivals.find( ( q ) => q.convoy && q.phase === 'sea' ) || rivals.find( ( q ) => q.phase === 'sea' ) || null;
		const name = r ? ( r.convoy ? `${ r.name }'s hulk` : `${ r.name }'s ${ r.ship || 'trawler' }` ) : 'Tidemark guild hulk';
		const yaw = this.navy.rng() * Math.PI * 2;
		const id = `navy-convoy-${ this._uid }-${ ++ this._n }`;
		let ship = null;
		try {

			ship = nv.spawn( 'trawler', {
				id, x: at.x, z: at.z, yaw, speed: 2.5, name,
				route: [ [ at.x, at.z ], [ at.x + Math.sin( yaw ) * 1400, at.z + Math.cos( yaw ) * 1400 ] ], index: 1,
			} );

		} catch ( e ) { return false; }

		ship.convoy = true;
		ship.raid = 'convoy'; // (kept awake: Naval's ship cap never puts her to sleep)
		const pirates = [];
		const [ n0, n1 ] = EVENTS.convoy.pirates, n = n0 + Math.floor( this.navy.rng() * ( n1 - n0 + 1 ) );
		for ( let i = 0; i < n; i ++ ) {

			const a = yaw + Math.PI * ( 0.6 + 0.8 * i ) + this.navy.rng() * 0.4, d = 170 + 60 * this.navy.rng();
			const px = at.x + Math.sin( a ) * d, pz = at.z + Math.cos( a ) * d;
			try {

				const p = nv.spawn( 'sloop', {
					id: `navy-raider-${ this._uid }-${ this._n }-${ i }`, x: px, z: pz, yaw: Math.atan2( at.x - px, at.z - pz ), speed: 5,
					route: [ [ px, pz ], [ at.x, at.z ] ], loop: true, index: 1, state: 'chase',
				} );
				p.foe = ship;
				p.foeBy = 'event';
				p.raid = 'convoy';
				pirates.push( p );

			} catch ( e ) { /* a class this build does not have */ }

		}

		this.convoy = { ship, pirates, t: 0, name, quarter: at.quarter, helped: false, done: false, reward: EVENTS.convoy.reward };
		this.stats.convoys ++;
		this.navy.toast( `A convoy under attack on the horizon to the ${ at.quarter }: the ${ name } · help her for a reward`, 4600 );
		this.navy.marker( 'navy-convoy', { kind: 'sail', x: at.x, z: at.z, label: `Convoy under attack: the ${ name }` } );
		this.navy.emit( 'convoyAttacked', { id, name, x: Math.round( at.x ), z: Math.round( at.z ), pirates: pirates.map( ( p ) => p.id ) } );
		return true;

	}

	// the player's shot landed in one of the raiders (Navy forwards its cannonballImpact)
	onPlayerHit( shipId ) {

		const c = this.convoy;
		if ( c && ! c.done && c.pirates.some( ( p ) => p.id === shipId ) ) c.helped = true;

	}

	_convoyTick( dt ) {

		const c = this.convoy;
		if ( ! c ) return;
		c.t += dt;
		const s = c.ship;
		if ( ! c.done ) {

			for ( const p of c.pirates ) if ( p.alive && s.alive && p.foeBy === 'event' ) p.foe = s;
			const beaten = c.pirates.every( ( p ) => ! p.alive || p.state === 'flee' || p.escaped );
			const b = this.navy.boatPos();
			const near = b && s.alive && Math.hypot( b.x - s.x, b.z - s.z ) < 450;
			if ( ! s.alive ) this._convoyEnd( false );
			else if ( beaten ) this._convoyEnd( true, c.helped || near );
			else if ( c.t > 30 && b && Math.hypot( b.x - s.x, b.z - s.z ) > EVENTS.convoy.lose ) this._convoyEnd( null );
			if ( s.alive ) this.navy.marker( 'navy-convoy', { kind: 'sail', x: s.x, z: s.z, label: `Convoy under attack: the ${ c.name }` } );

		}

		// done: she sails on until nobody sees her, then she is gone
		if ( c.done ) {

			const cam = this.app && this.app.camera && this.app.camera.position;
			if ( ! s.alive || ! cam || Math.hypot( cam.x - s.x, cam.z - s.z ) > 1300 ) {

				if ( s.alive ) s.state = 'gone';
				this.convoy = null;

			}

		}

	}

	// saved: true (her raiders sunk or running), false (she sank), null (the player sailed away from it)
	_convoyEnd( saved, helped = false ) {

		const c = this.convoy;
		c.done = true;
		this.navy.marker( 'navy-convoy', null );
		for ( const p of c.pirates ) if ( p.foeBy === 'event' ) { p.foe = null; p.foeBy = null; p.raid = false; }
		c.ship.raid = false;
		if ( saved === true ) {

			this.stats.convoysSaved ++;
			if ( helped ) {

				this.navy.pay( c.reward, 'convoy' );
				this.navy.addStanding( EVENTS.convoy.standing, 'convoy saved' );
				this.navy.toast( `The ${ c.name } dips her flag to you: $${ c.reward } for the rescue`, 4200 );

			} else this.navy.toast( `The navy drove the raiders off the ${ c.name }`, 3200 );
			this.navy.emit( 'convoySaved', { name: c.name, helped: !! helped, reward: helped ? c.reward : 0 } );

		} else if ( saved === false ) {

			this.stats.convoysLost ++;
			this.navy.toast( `The ${ c.name } went down with her cargo`, 3400 );
			this.navy.emit( 'convoyLost', { name: c.name } );

		}

	}

	// ------------------------------------------------------------------ the man overboard

	startOverboard() {

		if ( this.overboard ) return false;
		const at = this._spot( EVENTS.overboard.far, - 1.5 );
		if ( ! at ) return false;
		const name = SAILORS[ Math.floor( this.navy.rng() * SAILORS.length ) % SAILORS.length ];
		const o = this.overboard = { x: at.x, z: at.z, t: 0, flareT: 0, name, quarter: at.quarter, group: null };
		const scene = this.app && this.app.scene;
		if ( scene && typeof scene.add === 'function' && this.navy.opts.models !== false ) {

			try {

				const g = new Group();
				g.name = 'navy-overboard';
				const m = new Mesh( swimmerGeometry(), launchMaterial() );
				m.castShadow = false;
				g.add( m );
				g.position.set( o.x, 0, o.z );
				scene.add( g );
				o.group = g;

			} catch ( e ) { o.group = null; }

		}

		const f = this.navy.features;
		if ( f && typeof f.interactable === 'function' ) {

			this._off = f.interactable( {
				id: 'navy-overboard', radius: EVENTS.overboard.reach + 2,
				position: () => ( this.overboard ? { x: this.overboard.x, y: this._playerY(), z: this.overboard.z } : null ),
				prompt: () => ( this.overboard ? `Pull ${ this.overboard.name } aboard` : null ),
				when: () => !! this.overboard,
				onInteract: () => this.pullAboard(),
			} );

		}

		this._flare();
		this.stats.overboard ++;
		this.navy.toast( `A red flare to the ${ at.quarter }: a man overboard · pull him out of the water`, 4400 );
		this.navy.marker( 'navy-overboard', { kind: 'flare', x: o.x, z: o.z, label: 'Man overboard' } );
		return true;

	}

	_playerY() {

		const p = this.app && this.app.player && this.app.player.position;
		return p ? p.y : 0; // (he is at the waterline; the boat's rail is close enough)

	}

	_flare() {

		const o = this.overboard, r = this.navy.get( 'rescue' );
		if ( ! o ) return;
		try { if ( r && r.fx && typeof r.fx.launch === 'function' ) r.fx.launch( o.x, 1, o.z, { remote: true } ); } catch ( e ) { /* no flares headless */ }

	}

	_overboardTick( dt ) {

		const o = this.overboard;
		if ( ! o ) return;
		o.t += dt;
		o.flareT += dt;
		const p = this.navy.boatPos() || ( this.app && this.app.player && this.app.player.position );
		const d = p ? Math.hypot( p.x - o.x, p.z - o.z ) : Infinity;
		if ( o.flareT > EVENTS.overboard.flareEvery && d > 120 ) {

			o.flareT = 0;
			this._flare();

		}

		if ( o.group ) {

			const q = this.app && this.app.query;
			let y = 0;
			try { y = q && typeof q.heightAt === 'function' ? q.heightAt( o.x, o.z ) || 0 : Math.sin( o.t * 1.3 ) * 0.25; } catch ( e ) { y = 0; }
			o.group.position.set( o.x, y - 0.1, o.z );
			o.group.rotation.set( Math.sin( o.t * 1.1 ) * 0.12, o.t * 0.2, Math.cos( o.t * 0.9 ) * 0.1 );

		}

		if ( o.t > EVENTS.overboard.life ) {

			this.navy.toast( `A fishing boat picked ${ o.name } out of the water`, 3000 );
			this._clearOverboard();

		}

	}

	// E beside him (or a test): he is aboard
	pullAboard( { force = false } = {} ) {

		const o = this.overboard;
		if ( ! o ) return false;
		const p = this.navy.boatPos() || ( this.app && this.app.player && this.app.player.position );
		if ( ! force && ( ! p || Math.hypot( p.x - o.x, p.z - o.z ) > EVENTS.overboard.reach + 6 ) ) return false;
		this.stats.rescued ++;
		this.navy.pay( EVENTS.overboard.reward, 'rescue' );
		this.navy.addStanding( STANDING.rescue, 'man overboard' );
		this.navy.toast( `${ o.name } is aboard, coughing up the sea · the navy pays $${ EVENTS.overboard.reward } for him`, 4000 );
		this.navy.emit( 'manOverboardRescued', { x: Math.round( o.x ), z: Math.round( o.z ), name: o.name, by: 'player' } );
		this._clearOverboard();
		return true;

	}

	_clearOverboard() {

		const o = this.overboard;
		if ( o && o.group && o.group.parent ) o.group.parent.remove( o.group );
		if ( this._off ) { try { this._off(); } catch ( e ) { /* gone */ } this._off = null; }
		this.navy.marker( 'navy-overboard', null );
		this.overboard = null;

	}

	clear() {

		if ( this.convoy ) {

			const c = this.convoy;
			for ( const p of c.pirates ) if ( p.foeBy === 'event' ) { p.foe = null; p.foeBy = null; p.raid = false; }
			if ( c.ship.alive ) c.ship.state = 'gone';
			this.navy.marker( 'navy-convoy', null );
			this.convoy = null;

		}

		this._clearOverboard();
		this.t = EVENTS.first;

	}

	dispose() {

		this.clear();

	}

}

export { ABOARD };
