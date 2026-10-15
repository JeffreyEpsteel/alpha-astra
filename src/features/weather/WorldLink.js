import { G } from '../../core/Globals.js';

// The weather's hands on the world: the same parameters the settings panel (ui/AppUI.js) sets, written
// directly (the panel's math is replicated here, not imported):
//   fft.local.windSpeed / windDirection / fetch, fft.swell.scale  -> fft.updateSpectrumUniforms()
//   fft.choppiness, fft.foamBias / foamDecay (whitecaps), shore.amplitude / period
//   clouds.coverage / cirrus, haze.density / shafts, G.windSpeed / G.windDir
// Every part may be missing (?noHaze, no clouds, a test stand-in): a missing one is skipped.
//
// In the Sandbox the panel and the weather share these parameters: when a value is no longer the one the
// weather wrote last frame the player moved a slider, and the weather leaves that parameter alone until it
// next changes its mind (release()). In Campaign and Multiplayer the weather always wins (the panel is
// locked there and a mode switch resets its values).
//
//   const link = new WorldLink( app, () => features.sandbox );
//   link.apply( params, dt )      params: Climate.js parameters, windDir as an offset from the world's own direction

const BASE_DIR = 25; // degrees: OceanFFT's own default wind direction

export class WorldLink {

	constructor( app, isSandbox = () => false ) {

		this.app = app;
		this.isSandbox = isSandbox;
		this.last = {};
		this.yielded = new Set();
		this._sinceSpectrum = 1;
		this._dirty = false;
		this.spectrumUpdates = 0;
		const fft = app && app.fft;
		this.baseDir = fft && fft.local && Number.isFinite( fft.local.windDirection ) ? fft.local.windDirection : BASE_DIR;
		const A = app || {};
		const num = ( v ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : undefined );
		// [ live value, writer, feeds the wave spectrum ]
		this.bind = {
			wind: [ () => num( A.fft && A.fft.local && A.fft.local.windSpeed ), ( v ) => { A.fft.local.windSpeed = v; }, true ],
			windDir: [ () => num( A.fft && A.fft.local && A.fft.local.windDirection ), ( v ) => { A.fft.local.windDirection = v; }, true ],
			fetch: [ () => num( A.fft && A.fft.local && A.fft.local.fetch ), ( v ) => { A.fft.local.fetch = v; }, true ],
			swell: [ () => num( A.fft && A.fft.swell && A.fft.swell.scale ), ( v ) => { A.fft.swell.scale = v; }, true ],
			chop: [ () => num( A.fft && A.fft.choppiness && A.fft.choppiness.value ), ( v ) => { A.fft.choppiness.value = v; }, false ],
			surf: [ () => num( A.shore && A.shore.amplitude && A.shore.amplitude.value ), ( v ) => { A.shore.amplitude.value = v; }, false ],
			period: [ () => num( A.shore && A.shore.period && A.shore.period.value ), ( v ) => { A.shore.period.value = v; }, false ],
			clouds: [ () => num( A.clouds && A.clouds.coverage && A.clouds.coverage.value ), ( v ) => { A.clouds.coverage.value = v; }, false ],
			cirrus: [ () => num( A.clouds && A.clouds.cirrus && A.clouds.cirrus.value ), ( v ) => { A.clouds.cirrus.value = v; }, false ],
			haze: [ () => num( A.haze && A.haze.density && A.haze.density.value ), ( v ) => { A.haze.density.value = v; }, false ],
			shafts: [ () => num( A.haze && A.haze.shafts && A.haze.shafts.value ), ( v ) => { A.haze.shafts.value = v; }, false ],
		};

	}

	// the weather picked something new: the sliders the player moved are the weather's again
	release() {

		for ( const k of this.yielded ) delete this.last[ k ]; // (so the next write is not mistaken for the player's)
		this.yielded.clear();

	}

	apply( p, dt = 0 ) {

		const app = this.app;
		if ( ! app || ! p ) return;
		const sandbox = !! this.isSandbox();
		for ( const k in this.bind ) {

			if ( sandbox && this.yielded.has( k ) ) continue;
			const [ get, set, spec ] = this.bind[ k ];
			const live = get();
			if ( live === undefined ) continue;
			const value = k === 'windDir' ? this.baseDir + p.windDir : p[ k ];
			if ( ! Number.isFinite( value ) ) continue;
			const w = this.last[ k ];
			if ( sandbox && w !== undefined && Math.abs( live - w ) > 1e-3 * Math.max( 1, Math.abs( w ) ) ) {

				this.yielded.add( k );
				continue;

			}

			if ( Math.abs( live - value ) > 1e-7 ) {

				try { set( value ); } catch ( e ) { continue; }
				if ( spec ) this._dirty = true;

			}

			this.last[ k ] = value;

		}

		const wind = this.yielded.has( 'wind' ) ? null : p.wind;
		const dir = this.yielded.has( 'windDir' ) ? null : this.baseDir + p.windDir;
		if ( wind !== null && G.windSpeed ) G.windSpeed.value = wind;
		if ( dir !== null && G.windDir ) {

			const a = dir * Math.PI / 180;
			G.windDir.value.set( Math.cos( a ), Math.sin( a ) );

		}

		// whitecaps (AppUI whitecaps()): foam starts at less compression in fresh wind and lasts longer
		const fft = app.fft;
		if ( wind !== null && fft && fft.foamBias && fft.foamDecay ) {

			fft.foamBias.value = 0.5 + 0.16 * p.whitecaps + 0.01 * Math.min( 12, Math.max( - 5, p.wind - 7 ) );
			fft.foamDecay.value = 0.6 - 0.35 * p.whitecaps;

		}

		// the wave spectrum is regenerated on the GPU: at most twice a second while the sea state eases
		this._sinceSpectrum += dt;
		if ( this._dirty && this._sinceSpectrum >= 0.5 && fft && typeof fft.updateSpectrumUniforms === 'function' ) {

			try { fft.updateSpectrumUniforms(); } catch ( e ) { /* keep the old spectrum */ }
			this._dirty = false;
			this._sinceSpectrum = 0;
			this.spectrumUpdates ++;

		}

	}

}
