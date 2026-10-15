// Righting a capsized small boat (wave 22B), the minigame's maths: pure, no DOM, no engine.
//
// Standing on the upturned hull (the keel, then the centreboard as she comes over) you lean back on a line to the far
// gunwale. A balance meter: the marker is your lean (hold: lean back / pull, it rises; release: it falls back and you get
// your breath and strength back), the sweet spot is where the swell helps (it swings with the waves, wider and slower in
// calm water, narrower, faster and gustier in rough). Pulling with the marker in the sweet spot raises her heel (more the
// closer to its middle); pulling outside it strains your grip (and leaning far past it more so) and she sags back; let the
// strain fill up and you slip off into the water. Each hand helping (crew in the water, other players) pulls too and widens
// the spot. Stamina drains while you pull: at none you cannot pull until you rest. Heel 1: she comes over.
//
//   const g = new Righting( { rough, helpers, seed } )   rough 0..1 (roughness( weather )), helpers 0..RIGHTING.maxHelpers
//   g.update( dt, { hold, rough?, helpers? } ) -> null | 'up' (she is coming over) | 'slipped' (you fell off)
//   g.phase 'climb' (RIGHTING.climb s onto the hull: no pulling yet) | 'pull' | 'up' | 'slipped'
//   g.heel 0..1   g.marker 0..1   g.stamina 0..1   g.strain 0..1   g.t s of pulling   g.centre() / g.half()   g.model()
//   roughness( weather ) -> 0..1 from the weather feature (wind, storm danger)

export const RIGHTING = {
	climb: 0.9, // s of the climb onto the hull (the Climb_Pull clip)
	period: 5.2, roughPeriod: 3.2, // s of a swell cycle: calm, rough
	amp: 0.2, roughAmp: 0.3, // the sweet spot's swing about the middle
	half: 0.15, roughHalf: 0.085, helperHalf: 0.012, // half width of the sweet spot
	rise: 0.8, fall: 0.95, // marker per s while pulling / resting
	push: 0.18, // the swell shoves the marker (x rough)
	rate: 0.13, roughRate: 0.45, helper: 0.35, maxHelpers: 4, // heel per s pulling in the spot; rough takes off up to roughRate; per hand
	sag: 0.03, // heel lost per s while nobody pulls well (helpers hold her: halved with two)
	drain: 0.22, recover: 0.32, // stamina per s pulling / resting
	strainUp: 0.65, strainDown: 0.45, overLean: 0.14, // strain per s pulling past the spot (a quarter under it); this far past it x3
	pullMax: 0.6, // ctl.pull at heel 1 (0.6 of the way from hull up to upright: past the small hull's ballast limit)
};

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

// the sea for the minigame: wind past a breeze and the storm danger
export function roughness( weather ) {

	if ( ! weather ) return 0;
	const w = Number.isFinite( weather.wind ) ? weather.wind : weather.current && Number.isFinite( weather.current.wind ) ? weather.current.wind : 0;
	const d = Number.isFinite( weather.danger ) ? weather.danger : weather.current && Number.isFinite( weather.current.danger ) ? weather.current.danger : 0;
	return clamp( Math.max( ( w - 5 ) / 11, d ), 0, 1 );

}

// a small deterministic random (the gusts): mulberry32
function rng( seed ) {

	let a = ( seed >>> 0 ) || 1;
	return () => {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

export class Righting {

	constructor( { rough = 0, helpers = 0, seed = 1 } = {} ) {

		this.rough = clamp( rough, 0, 1 );
		this.helpers = clamp( helpers | 0, 0, RIGHTING.maxHelpers );
		this.rand = rng( seed );
		this.phase = 'climb';
		this.time = 0; // s since the start (climb included)
		this.t = 0; // s of the pull phase
		this.swell = this.rand() * Math.PI * 2;
		this.gust = 0;
		this._gustT = 0;
		this.heel = 0;
		this.marker = 0.2;
		this.stamina = 1;
		this.strain = 0;
		this.pulling = false;
		this.inSpot = false;

	}

	half() {

		const r = this.rough;
		return RIGHTING.half + ( RIGHTING.roughHalf - RIGHTING.half ) * r + RIGHTING.helperHalf * this.helpers;

	}

	centre() {

		const r = this.rough, h = this.half();
		const amp = RIGHTING.amp + ( RIGHTING.roughAmp - RIGHTING.amp ) * r;
		const c = 0.5 + amp * Math.sin( this.swell ) + 0.35 * amp * r * Math.sin( 2.3 * this.swell + 1 ) + this.gust;
		return clamp( c, h + 0.03, 1 - h - 0.03 );

	}

	update( dt, { hold = false, rough = this.rough, helpers = this.helpers } = {} ) {

		if ( ! ( dt > 0 ) || this.phase === 'up' || this.phase === 'slipped' ) return null;
		dt = Math.min( dt, 0.1 );
		this.rough = clamp( Number.isFinite( rough ) ? rough : 0, 0, 1 );
		this.helpers = clamp( helpers | 0, 0, RIGHTING.maxHelpers );
		this.time += dt;
		const R = RIGHTING, r = this.rough;
		this.swell += dt * 2 * Math.PI / ( R.period + ( R.roughPeriod - R.period ) * r );
		// gusts in rough water: the spot jumps a little every second or two
		this._gustT -= dt;
		if ( this._gustT <= 0 ) {

			this._gustT = 0.8 + this.rand() * 1.4;
			this._gustTo = ( this.rand() * 2 - 1 ) * 0.09 * r;

		}

		this.gust += ( ( this._gustTo || 0 ) - this.gust ) * Math.min( 1, dt * 3 );
		if ( this.phase === 'climb' ) {

			this.stamina = Math.min( 1, this.stamina + R.recover * dt );
			if ( this.time >= R.climb ) this.phase = 'pull';
			return null;

		}

		this.t += dt;
		const pull = this.pulling = !! hold && this.stamina > 0;
		const c = this.centre(), h = this.half();
		this.marker = clamp( this.marker + ( pull ? R.rise : - R.fall ) * dt + R.push * r * Math.cos( this.swell * 1.3 ) * dt, 0, 1 );
		const off = this.marker - c;
		this.inSpot = Math.abs( off ) <= h;
		const help = 1 + R.helper * this.helpers;
		if ( pull ) {

			this.stamina = Math.max( 0, this.stamina - R.drain * dt );
			if ( this.inSpot ) {

				const q = 1 - 0.5 * Math.abs( off ) / h;
				this.heel += R.rate * ( 1 - R.roughRate * r ) * help * q * dt;
				this.strain = Math.max( 0, this.strain - R.strainDown * dt );

			} else {

				// leaning back while the spot is under you strains the grip (far past it, three times as fast); still rising
				// towards it only wastes the pull
				const k = off > h + R.overLean ? 3 : off > 0 ? 1 : 0.25;
				this.strain += R.strainUp * k * ( 1 + 0.5 * r ) / Math.sqrt( help ) * dt;
				this.heel -= R.sag * 0.5 * dt;

			}

		} else {

			this.stamina = Math.min( 1, this.stamina + R.recover * dt );
			this.strain = Math.max( 0, this.strain - R.strainDown * dt );
			if ( ! this.inSpot ) this.heel -= R.sag * ( 1 - 0.25 * Math.min( this.helpers, 2 ) ) * dt;

		}

		this.heel = clamp( this.heel, 0, 1 );
		this.strain = clamp( this.strain, 0, 1 );
		if ( this.heel >= 1 ) {

			this.phase = 'up';
			return 'up';

		}

		if ( this.strain >= 1 ) {

			this.phase = 'slipped';
			return 'slipped';

		}

		return null;

	}

	// what the meter draws (Meter.js; the captures draw the same)
	model() {

		return { phase: this.phase, centre: this.centre(), half: this.half(), marker: this.marker, heel: this.heel, stamina: this.stamina,
			strain: this.strain, inSpot: this.inSpot, pulling: this.pulling, helpers: this.helpers, rough: this.rough };

	}

}

// a player for tests and the captures: pulls while the marker is under the middle of the spot (good), always (greedy), or
// on a fixed beat that ignores the swell (off-beat)
export function autoHold( g, style = 'good' ) {

	if ( style === 'greedy' ) return true;
	if ( style === 'offbeat' ) return ( g.time % 2.4 ) < 1.6;
	if ( style === 'idle' ) return false;
	return g.marker < g.centre() - g.half() * 0.15 && g.stamina > 0.05;

}
