// The dressing feature: living sea ( kelp beds, baitfish, dolphin pods ), harbour props and Pons Cove's palms and rocks.
// See index.js for the contract; Marine.js, Harbour.js, Island.js and Sites.js hold the parts.
//
// App hooks it reads ( all optional, each part skips what is missing ): app.scene, app.camera, app.terrainData, app.colliders,
// app.village ( the boardwalk path ), app.spray ( splashes ), app.query ( WaterQuery: two slots for the pods' sea level ),
// app.player.mode / app.boatCtl ( the pods follow the player's boat ), app.game.vendors and the registry's interactables
// ( the harbour props keep clear of them ).
//
// Build happens on the third update, after the other features have registered their interactables, and is asynchronous
// ( GLB loads ): until then update() does nothing. A failed GLB load skips only that piece.

import { Assets } from './Assets.js';
import { Kelp, FishSchools, DolphinPods } from './Marine.js';
import { Harbour, planHarbour } from './Harbour.js';
import { PonsIsland } from './Island.js';
import { kelpSites, palmSites, rockSites, ponsKeepOut, dockFrame, dockLength } from './Sites.js';
import { WORLD } from '../../world/WorldLayout.js';
import { STALL_SITES } from '../trade/stall.js';
import { BOARD_SITES } from '../notices/Sites.js';
import { STAND } from '../../game/FishStand.js';
import { PONS_STAND } from '../../game/PonsPort.js';

const DEFAULTS = { kelp: true, fish: true, dolphins: true, harbour: true, island: true };

// circles ( x, z, r ) the harbour props keep out of: stalls, boards, every interactable and vendor
export function harbourKeepOut( app, features ) {

	const keep = [
		{ x: STAND.x, z: STAND.z, r: 3.4 }, { x: STALL_SITES.home.x, z: STALL_SITES.home.z, r: 3.4 }, { x: BOARD_SITES.home.x, z: BOARD_SITES.home.z, r: 2.2 },
		{ x: PONS_STAND.x, z: PONS_STAND.z, r: 3.2 }, { x: STALL_SITES.pons.x, z: STALL_SITES.pons.z, r: 3.4 }, { x: BOARD_SITES.pons.x, z: BOARD_SITES.pons.z, r: 2.2 },
	];
	const vendors = app && app.game && app.game.vendors ? app.game.vendors : [];
	for ( const v of vendors ) if ( v && v.position ) keep.push( { x: v.position.x, z: v.position.z, r: ( v.radius || 3 ) * 0.6 + 0.8 } );
	if ( features && features._interactables ) {

		for ( const e of features._interactables ) {

			let q = null;
			try { q = typeof e.position === 'function' ? e.position() : e.position; } catch ( err ) { q = null; }
			if ( q ) keep.push( { x: q.x, z: q.z, r: Math.min( e.radius || 2.5, 3.2 ) + 0.6 } );

		}

	}

	return keep;

}

// schools of baitfish over the kelp ( reef and Pons ) and beside Pons's dock head
export function schoolSites( terrain, kelp ) {

	const out = [];
	for ( const area of [ 'reef', 'pons' ] ) {

		const list = kelp.filter( ( k ) => k.area === area && k.depth > 4.2 );
		if ( ! list.length ) continue;
		// the kelp site with the most neighbours within 25 m
		let best = null, bn = - 1;
		for ( const k of list ) {

			let n = 0;
			for ( const o of list ) if ( Math.hypot( o.x - k.x, o.z - k.z ) < 25 ) n ++;
			if ( n > bn ) { bn = n; best = k; }

		}

		out.push( { x: best.x, z: best.z, y: - Math.min( best.depth - 1.2, 2.8 ), radius: 3.0, count: 30, area } );

	}

	// beside the dock head: 9 m to the side, where the water is 3 - 6 m deep
	const L = dockLength();
	for ( const lx of [ 9, - 9, 12, - 12 ] ) {

		const [ x, z ] = dockFrame( lx, L - 3 );
		const h = terrain.heightAt( x, z );
		if ( h < - 3.2 && h > - 7 ) { out.push( { x, z, y: - Math.min( - h - 1.0, 2.0 ), radius: 2.2, count: 22, area: 'pons dock' } ); break; }

	}

	return out;

}

export class Dressing {

	constructor( app, features, opts = {} ) {

		this.app = app;
		this.features = features;
		this.opts = { ...DEFAULTS, ...opts };
		this.assets = new Assets( { baseUrl: opts.baseUrl } );
		this.parts = {};
		this.plan = null;
		this.sites = {};
		this.t = 0;
		this.frames = 0;
		this.built = false;
		this.ready = null; // a promise once built ( tests await it )
		this.anchor = { x: 0, z: 0, vx: 0, vz: 0, onWater: false };
		this.disabled = false;
		try {

			if ( typeof location !== 'undefined' && /(^|[?&])noDressing\b/.test( location.search || '' ) ) this.disabled = true;

		} catch ( e ) { /* no location in node */ }

	}

	// build everything now ( tests call this directly; update() calls it on the third frame )
	build() {

		if ( this.built || this.disabled ) return this.ready;
		this.built = true;
		const app = this.app, o = this.opts;
		const scene = app.scene, T = app.terrainData;
		if ( ! scene || ! T ) { this.ready = Promise.resolve(); return this.ready; }
		const tasks = [];

		if ( o.kelp || o.fish ) this.sites.kelp = kelpSites( T );
		if ( o.kelp && this.sites.kelp.length ) {

			this.parts.kelp = new Kelp( { scene, assets: this.assets, sites: this.sites.kelp } );
			tasks.push( this.parts.kelp.ready );

		}

		if ( o.fish ) {

			this.sites.schools = schoolSites( T, this.sites.kelp || [] );
			if ( this.sites.schools.length ) {

				this.parts.fish = new FishSchools( { scene, assets: this.assets, schools: this.sites.schools } );
				tasks.push( this.parts.fish.ready );

			}

		}

		if ( o.dolphins ) {

			this.parts.dolphins = new DolphinPods( { scene, assets: this.assets, terrain: T, spray: app.spray || null, query: app.query || null } );
			tasks.push( this.parts.dolphins.ready );

		}

		if ( o.harbour ) {

			const keep = harbourKeepOut( app, this.features );
			this.plan = planHarbour( { terrain: T, colliders: app.colliders || null, keep, boardwalk: app.village && app.village.path ? boardwalkOf( T, app.village.path ) : null } );
			this.parts.harbour = new Harbour( { scene, assets: this.assets, plan: this.plan } );
			tasks.push( this.parts.harbour.ready );

		}

		if ( o.island ) {

			const keepP = ponsKeepOut();
			this.sites.palms = palmSites( T, keepP );
			this.sites.rocks = rockSites( T, keepP );
			try {

				this.parts.island = new PonsIsland( { scene, terrain: T, colliders: app.colliders || null, palms: this.sites.palms, rocks: this.sites.rocks } );

			} catch ( e ) {

				console.warn( 'dressing: Pons palms and rocks failed to build', e );

			}

		}

		this.ready = Promise.all( tasks ).catch( ( e ) => console.warn( 'dressing: a part failed to load', e ) );
		return this.ready;

	}

	// where the dolphins gather: the player's boat when afloat ( at the helm, on deck or seated ), nowhere otherwise
	_anchor() {

		const a = this.anchor, app = this.app, p = app.player, b = app.boatCtl;
		const afloat = !! ( p && b && ( p.mode === 'boat' || p.mode === 'deck' || p.mode === 'seat' ) && b.position );
		a.onWater = afloat;
		if ( afloat ) {

			a.x = b.position.x; a.z = b.position.z;
			a.vx = b.velocity ? b.velocity.x : 0; a.vz = b.velocity ? b.velocity.z : 0;

		}

		return afloat ? a : null;

	}

	update( dt ) {

		if ( this.disabled ) return;
		this.t += dt;
		this.frames ++;
		if ( ! this.built ) {

			if ( this.frames >= 3 ) this.build();
			return;

		}

		const cam = this.app.camera ? this.app.camera.position : { x: 0, y: 0, z: 0 };
		const P = this.parts;
		if ( P.kelp ) P.kelp.update( cam );
		if ( P.fish ) P.fish.update( dt, this.t, cam );
		if ( P.harbour ) P.harbour.update( cam );
		if ( P.island ) P.island.update( cam );
		if ( P.dolphins ) P.dolphins.update( dt, this._anchor(), cam );

	}

	stats() {

		const P = this.parts;
		return {
			kelp: P.kelp ? { sites: this.sites.kelp.length, ...P.kelp.counts } : null,
			fish: P.fish ? { schools: this.sites.schools.length, ...P.fish.counts } : null,
			dolphins: P.dolphins ? { pods: P.dolphins.pods.length, ...P.dolphins.counts } : null,
			harbour: P.harbour ? { items: this.plan.items.length, poles: this.plan.poles.length, drawn: P.harbour.drawn } : null,
			island: P.island ? P.island.stats() : null,
		};

	}

	reset() {

		if ( this.parts.dolphins ) { this.parts.dolphins.pods.length = 0; this.parts.dolphins.timer = 8; }

	}

	dispose() {

		for ( const p of Object.values( this.parts ) ) if ( p && p.dispose ) p.dispose();
		this.parts = {};
		this.assets.dispose();

	}

}

// Village.path ( { samples, deck } ) -> Harbour.boardwalkSamples format, without importing Harbour here twice
function boardwalkOf( T, path ) {

	const out = [];
	for ( let i = 0; i < path.samples.length; i += 4 ) {

		const s = path.samples[ i ];
		out.push( { x: s.p.x, z: s.p.z, y: path.deck[ i ], tx: s.tan.x, tz: s.tan.z } );

	}

	return out;

}
