// Life cues feature (docs/UNREAL_PARITY.md F8, W6, W10): small signs that the world notices you.
//   gulls       a reactive flock: scatters from a cast's splash, wheels in at a bite, dives at a miss, one steals a catch (GullCues.js)
//   castFx      the lure's splash + one ripple ring, a strike ripple, a big catch burst, a small miss plop (CastFx.js, via the VFX set)
//   puddles     gather on flat open ground in the rain and dry out after it (Decals.js)
//   footprints  your steps on the sand, fading, washed out by the swash and the rain (Decals.js)
//   chimneys    smoke from every stack through the VFX set, a firelight glow at night and in fog (Chimneys.js)
//   laundry     lines swinging in the wind beside the Pons Cove huts (Laundry.js; the home village has its own)
// Fireflies, bioluminescence and the lighthouse beam are the night feature's; splashes and smoke particles the VFX set's.
//
//   features.add( 'life', life );                 // import * as life from './features/life/index.js'
//   const L = features.get( 'life' );
//   L.gulls (GullCues)  L.castFx (CastFx)  L.puddles  L.footprints  L.chimneys  L.laundry  L.lights (chimney glows)  L.stats()
//
// Built on the third update (the world and the other features exist by then); each part skips what is missing.
// `?noLife` in the URL turns it all off. Nothing is saved. Hooks the root needs: the MODULES entry (its lights are
// picked up by installFeatures like every feature's).

import { GullCues } from './GullCues.js';
import { CastFx } from './CastFx.js';
import { Puddles, Footprints, puddleSites } from './Decals.js';
import { Chimneys, chimneySites, makeGlowLights } from './Chimneys.js';
import { Laundry, laundrySites } from './Laundry.js';
import { WORLD } from '../../world/WorldLayout.js';

export class Life {

	constructor( app, features, { rng = Math.random } = {} ) {

		this.app = app;
		this.features = features || null;
		this.rng = rng;
		this.frames = 0;
		this.built = false;
		this.disabled = false;
		try {

			if ( typeof location !== 'undefined' && /(^|[?&])noLife\b/.test( location.search || '' ) ) this.disabled = true;

		} catch ( e ) { /* no location */ }

		this.gulls = this.disabled ? null : new GullCues( app, features, { rng } );
		this.castFx = this.disabled ? null : new CastFx( features );
		if ( this.gulls && this.castFx ) this.gulls.onCue = ( kind, at, water ) => this.castFx.cue( kind, water || at );
		this.puddles = null;
		this.footprints = null;
		this.chimneys = null;
		this.laundry = null;
		// the glows exist from the start so installFeatures hands them to LocalLights; they wake once built
		this.lights = makeGlowLights();

	}

	_weather() {

		const w = this.features && this.features.get ? this.features.get( 'weather' ) : null;
		const c = w && w.current;
		return {
			rain: w && Number.isFinite( w.rain ) ? w.rain : c && Number.isFinite( c.rain ) ? c.rain : 0,
			kind: c && c.kind ? c.kind : 'clear',
			fog: c && c.kind === 'fog' ? c.intensity || 0.8 : 0,
		};

	}

	build() {

		if ( this.built || this.disabled ) return;
		this.built = true;
		const app = this.app || {}, scene = app.scene, T = app.terrainData;
		if ( ! scene ) return;
		const add = ( o ) => { if ( o && o.mesh ) scene.add( o.mesh ); return o; };
		try {

			const centres = [ { x: WORLD.village.center.x, z: WORLD.village.center.z, r: WORLD.village.radius * 0.8 } ];
			for ( const p of WORLD.ports || [] ) if ( p.id !== 'home' && p.stand ) centres.push( { x: p.stand.x, z: p.stand.z, r: 30 } );
			if ( T ) this.puddles = add( new Puddles( puddleSites( T, app.colliders || null, { centres, rng: this.rng } ) ) );

		} catch ( e ) { console.warn( 'life: puddles failed', e ); }

		try { this.footprints = add( new Footprints() ); } catch ( e ) { console.warn( 'life: footprints failed', e ); }
		try {

			this.chimneys = new Chimneys( { sites: chimneySites( app.colliders ), vfx: () => ( this.features ? this.features.get( 'vfx' ) : null ), rng: this.rng, lights: this.lights } );

		} catch ( e ) { console.warn( 'life: chimneys failed', e ); }

		try {

			const sites = laundrySites( T );
			if ( sites.length ) this.laundry = add( new Laundry( sites ) );

		} catch ( e ) { console.warn( 'life: laundry failed', e ); }

	}

	update( dt ) {

		if ( this.disabled ) return;
		this.frames ++;
		if ( ! this.built ) {

			if ( this.frames >= 3 ) this.build();
			return;

		}

		const app = this.app || {};
		const w = this._weather();
		if ( this.gulls ) this.gulls.update( dt );
		if ( this.castFx ) this.castFx.update( dt );
		if ( this.puddles ) this.puddles.update( dt, w.rain );
		if ( this.footprints ) this.footprints.update( dt, { player: app.player, terrain: app.terrainData, colliders: app.colliders, rain: w.rain } );
		if ( this.chimneys ) {

			const s = app.settings || {};
			const hour = Number.isFinite( s.timeOfDay ) ? s.timeOfDay : 12;
			const night = hour > 19.5 || hour < 5.5 ? 1 : 0;
			this.chimneys.update( dt, { camera: app.camera, hour, kind: w.kind, fog: w.fog, night } );

		}

	}

	stats() {

		return {
			gulls: this.gulls ? this.gulls.flock.counts() : null,
			castFx: this.castFx ? this.castFx.stats() : null,
			puddles: this.puddles ? { sites: this.puddles.sites.length, wet: this.puddles.wet } : null,
			footprints: this.footprints ? { laid: this.footprints.count, alive: this.footprints.alive() } : null,
			chimneys: this.chimneys ? { sites: this.chimneys.sites.length, puffs: this.chimneys.puffs } : null,
			laundry: this.laundry ? { triangles: this.laundry.triangles } : null,
		};

	}

	reset() {

		if ( this.puddles ) this.puddles.wet = 0;

	}

	dispose() {

		for ( const k of [ 'gulls', 'puddles', 'footprints', 'laundry' ] ) if ( this[ k ] && this[ k ].dispose ) this[ k ].dispose();
		for ( const l of this.lights ) l.enabled = false;

	}

}

export function install( app, features, opts = {} ) {

	return new Life( app, features, opts );

}

export { GullFlock, GullCues } from './GullCues.js';
export { CastFx } from './CastFx.js';
export { Puddles, Footprints, puddleSites, onSand } from './Decals.js';
export { Chimneys, chimneySites, smokeRate } from './Chimneys.js';
export { Laundry, laundrySites } from './Laundry.js';

export default { install };
