import { FISH } from './FishTable.js';

// Line-tension fight. Hold to reel: the line shortens and the tension climbs; let go and it eases
// off, but a running fish then takes line. Keep the tension in the green band: the fish tires there
// fastest. Too much tension (above the line's strength for about half a second) snaps it; too little
// for too long and the hook falls out. Every few seconds the fish surges: ease off or it breaks you.
//
//   const g = new CatchMinigame( { species, kg, lineKg, reelSpeed, distance, rng } )
//   g.update( dt, reeling ) -> 'fighting' | 'caught' | 'snapped' | 'escaped'
//   g.tension (0..1+, 1 = breaking point), g.distance (m), g.stamina (0..1), g.surge (0..1),
//   g.band = [ lo, hi ] (the green band; narrower for strong fish)
//   g.surgeWarn (0..1, ramps for ~0.4 s before a surge starts), g.hookHold (1..0, the hook pulls free at 0:
//   it wears at high tension and when the line goes slack, and recovers slowly in between)
//
// Species with FISH[ id ].minigame === 'marker' (the Unreal game's fish) get the MarkerMinigame below
// instead: `new CatchMinigame( opts )` returns one for them (so Game.js needs no change), and
// createFight( opts ) picks explicitly. Pass { classic: true } to force the tension fight.
const WARN_TIME = 0.4;

export class CatchMinigame {

	constructor( { species, kg, lineKg = 7, reelSpeed = 1.1, distance = 15, rng = Math.random, castM, classic = false } ) {

		const f = FISH[ species ];
		// a constructor may return another object: the marker species get their own fight
		if ( ! classic && f.minigame === 'marker' ) return new MarkerMinigame( { species, kg, lineKg, reelSpeed, castM, distance, rng } );
		this.kind = 'tension';
		this.rateMul = 1; // the accessibility fishing assist slows the tension (Game sets it; marked in the save)
		this.species = species;
		this.kg = kg;
		this.rng = rng;
		this.reelSpeed = reelSpeed;
		// pull relative to the line: a fish near the line rating is hard, one far above it is a lottery
		this.power = Math.min( 1.45, 1.15 * ( 0.25 + 0.75 * f.fight ) * Math.pow( kg / Math.max( lineKg * 0.5, 0.2 ), 0.5 ) );
		this.staminaMax = f.stamina * Math.pow( Math.max( kg / f.kg[ 1 ], 0.15 ), 0.35 );
		this.stamina = 1;
		this.distance = distance;
		this.maxDistance = Math.max( 60, distance + 40 ); // spooled: the fish takes all the line
		this.tension = 0.3;
		this.surge = 0;
		this.slack = 0;
		this.time = 0;
		this.band = [ 0.3 + 0.1 * f.fight, 0.86 - 0.2 * f.fight ]; // strong fish: a narrower green band
		this.fightRating = f.fight;
		this.hookHold = 1; // the hook pulls free at 0
		this.surgeWarn = 0; // 0..1 over the ~0.4 s before a surge starts
		this.overload = 0; // seconds above the breaking point: the line snaps only if it's held there
		this.strain = 0; // the crank held down builds strain (0..0.42): the fight is pumped, not held (a tip says so)
		this.rodStress = 0; // seconds well past the line's strength: the rod itself breaks (state 'broken')
		this._nextSurge = 1.5 + rng() * 2;
		this._surgeT = 0;
		this._surgeMul = 1;
		this.state = 'fighting';

	}

	update( dt, reeling ) {

		if ( this.state !== 'fighting' ) return this.state;
		this.time += dt;
		const tired = 1 - this.stamina; // 0 fresh .. 1 exhausted

		// surges: sudden runs, rarer and weaker as the fish tires; a short warning comes first
		this._nextSurge -= dt;
		if ( this._nextSurge <= 0 && this._surgeT <= 0 ) {

			this._surgeMul = 0.85 + this.rng() * 0.6; // some runs hit much harder than others
			this._surgeT = 0.8 + this.rng() * 1.2 * ( 1 - tired * 0.6 );
			this._nextSurge = ( 1.6 + this.rng() * 2.6 ) * ( 1 + tired );

		}

		this.surgeWarn = this._surgeT > 0 ? 0 : Math.max( 0, Math.min( 1, 1 - this._nextSurge / WARN_TIME ) );
		this._surgeT -= dt;
		const surgeTarget = this._surgeT > 0 ? 1 : 0;
		this.surge += ( surgeTarget - this.surge ) * ( 1 - Math.exp( - dt * 6 ) );

		// the fish's pull (0..~1.6) and the tension it and the reel make
		const pull = this.power * ( 0.35 + 0.65 * this.surge * this._surgeMul ) * ( 1 - 0.65 * tired );
		// reeling without a pause piles strain on top of the fish's pull: ease off between pulls or the line goes
		this.strain = reeling ? Math.min( 0.26, this.strain + dt * 0.2 ) : Math.max( 0, this.strain - dt * 1.2 );
		const target = reeling ? 0.25 + pull * 0.95 + 0.3 + this.strain : pull * 0.62;
		const rate = ( reeling ? 3.4 : 3.0 ) * this.rateMul;
		this.tension += ( target - this.tension ) * ( 1 - Math.exp( - dt * rate ) );

		// line in / out: a surging fish runs line out fast, so letting go during a run still costs you
		if ( reeling ) this.distance -= this.reelSpeed * dt * ( 1.15 - 0.6 * this.surge * ( 1 - tired ) );
		else this.distance += pull * ( 1.4 + 3 * this.surge ) * dt;
		this.distance = Math.max( 0, this.distance );

		// tiring: fastest in the band, slowly otherwise
		const inBand = this.tension >= this.band[ 0 ] && this.tension <= this.band[ 1 ];
		this.stamina = Math.max( 0, this.stamina - dt / this.staminaMax * ( inBand ? 1 : 0.3 ) );

		// the hook hold: high tension tears it, slack lets it work loose, steady pressure resets it slowly
		const wear = ( 0.6 + 0.8 * this.fightRating );
		if ( this.tension > 0.9 ) this.hookHold -= dt * wear * ( this.tension - 0.9 ) * 3;
		else if ( this.tension < 0.15 ) this.hookHold -= dt * 0.1 * wear;
		else this.hookHold += dt * 0.05;
		this.hookHold = Math.min( 1, this.hookHold );

		// outcomes
		this.overload = this.tension > 1 ? this.overload + dt : Math.max( 0, this.overload - dt * 2 );
		this.rodStress = this.tension > 1.14 ? this.rodStress + dt : Math.max( 0, this.rodStress - dt * 2 );
		if ( this.rodStress > 0.16 ) this.state = 'broken'; // hauled far past the line's strength: the rod cracks (Ethena fixes it)
		else if ( this.overload > 0.22 ) this.state = 'snapped';
		else {

			this.slack = this.tension < 0.12 ? this.slack + dt : Math.max( 0, this.slack - dt * 2 );
			if ( this.slack > 3 || this.hookHold <= 0 || this.distance > this.maxDistance ) this.state = 'escaped';
			else if ( this.distance < 1.2 ) this.state = 'caught';

		}

		return this.state;

	}

}


// ---------------------------------------------------------------------------
// Marker timing (UpsideDownFishing's UFishingComponent, ported): a marker sweeps back and forth
// along a bar; press (the reel button) while it is inside the target zone. Each good strike eases
// the line strain, brings the fish closer and moves the zone to the other side; a mistimed strike
// strains the line and lets the fish run. The fish pulls all the time, so waiting never lands it.
// Lost: three misses (the hook pulls free), the strain reaching 1 (the line snaps) or the time
// running out (the fish works loose).
//
//   const g = new MarkerMinigame( { species, kg, lineKg, reelSpeed, castM, distance, rng } )
//   g.update( dt, reeling ) -> 'fighting' | 'caught' | 'snapped' | 'escaped'   (a press = reeling going true)
//   g.strike() -> null (cooling down) | { hit, accuracy }   (update calls it on a press)
//   g.marker (0..1), g.zone = [ lo, hi ], g.hits / g.required, g.misses / g.maxMisses, g.strain (0..1),
//   g.timeLeft (s), g.cooldown (s), g.lastStrike ({ hit, accuracy, t }) and, for the shared fight HUD
//   and the rod: tension, band, stamina, distance, surge, surgeWarn, hookHold, call ({ text, cls })
//
// Difficulty: the Unreal CatchDifficulty (FISH[ id ].difficulty, 1..5) sets the marker speed and the
// zone width as in the Unreal tuning (0.9 + 0.15 d, 0.22 - 0.02 d); the gear softens it: a smoother
// reel slows the marker, a stronger line and a longer rod widen the zone; a heavy fish on light line
// strains it faster. Difficulty 4+ fish shift the zone while you aim; difficulty 5 needs a fourth strike.
export const MARKER = {
	speed: 0.9, speedPerDifficulty: 0.15,
	zone: 0.22, zoneShrink: 0.02, minZone: 0.05,
	strikes: 3, maxMisses: 3,
	time: 25, // s per attempt
	missStrain: 0.26, passiveStrain: 0.014, hitRelief: 0.12,
	cooldown: 0.45,
};

export class MarkerMinigame {

	constructor( { species, kg, lineKg = 7, reelSpeed = 1.1, castM = 22, distance = 15, rng = Math.random } ) {

		const f = FISH[ species ], M = MARKER;
		this.kind = 'marker';
		this.species = species;
		this.kg = kg;
		this.rng = rng;
		this.fightRating = f.fight;
		const d = this.difficulty = f.difficulty ?? Math.max( 1, Math.min( 5, Math.round( 1 + f.fight * 5 ) ) );
		const heavy = Math.min( 1, Math.max( 0, kg / f.kg[ 1 ] ) );
		const reelMul = Math.pow( 1.1 / Math.max( reelSpeed, 0.5 ), 0.35 ); // 1, 0.88, 0.78 for the three reels
		this.speed = ( M.speed + M.speedPerDifficulty * d ) * reelMul * ( 0.92 + 0.16 * heavy );
		const lineBonus = 0.02 * Math.log2( Math.max( lineKg, 1 ) / 7 );
		const rodBonus = 0.02 * Math.min( 1, Math.max( 0, ( ( castM ?? 22 ) - 22 ) / 23 ) );
		this.zoneWidth = Math.max( M.minZone, M.zone - M.zoneShrink * d + lineBonus + rodBonus );
		// the fish's pull against the line (as CatchMinigame's power): the passive strain grows with it
		this.pull = Math.min( 1.5, ( 0.25 + 0.75 * f.fight ) * Math.sqrt( kg / Math.max( lineKg * 0.5, 0.2 ) ) );
		this.passive = M.passiveStrain * ( 1 + 1.5 * this.pull );
		this.missStrain = M.missStrain + 0.08 * f.fight;
		this.required = M.strikes + ( d >= 5 ? 1 : 0 );
		this.maxMisses = M.maxMisses;
		this.drift = Math.max( 0, d - 3 ) * 0.035;
		this.timeLeft = M.time;
		this.marker = 0;
		this.dir = 1;
		this.zoneCenter = 0.5;
		this._zoneBase = 0.5;
		this._driftPhase = rng() * Math.PI * 2;
		this.hits = 0;
		this.misses = 0;
		this.strain = 0.08;
		this.cooldown = 0;
		this.distance = distance;
		this.startDistance = distance;
		this.maxDistance = Math.max( 60, distance + 40 );
		this.surge = 0; // 1 right after a miss (the fish runs), decays
		this.surgeWarn = 0;
		this.lastStrike = null;
		this.time = 0;
		this.band = [ 0.18, 0.78 ]; // the strain the line takes comfortably, on the shared tension gauge
		this._held = true; // the press that hooked the fish is still down: a strike needs a fresh press
		this.state = 'fighting';

	}

	get zone() {

		const w = this.zoneWidth * 0.5;
		return [ Math.max( 0, this.zoneCenter - w ), Math.min( 1, this.zoneCenter + w ) ];

	}

	// the shared fight HUD and the rod read these
	get tension() { return 0.18 + 0.82 * this.strain; }
	get stamina() { return 1 - this.hits / this.required; }
	get hookHold() { return 1 - this.misses / this.maxMisses; }
	get inZone() {

		const [ lo, hi ] = this.zone;
		return this.marker >= lo && this.marker <= hi;

	}

	// the fight panel's call line (GameHUD shows it when present)
	get call() {

		const ls = this.lastStrike;
		if ( ls && this.time - ls.t < 0.7 ) return ls.hit ? { text: ls.accuracy > 0.7 ? 'Perfect strike!' : 'Good strike!', cls: 'is-good' } : { text: 'Too soon! The line strains', cls: 'is-warn' };
		if ( this.strain > 0.75 ) return { text: 'The line is about to snap', cls: 'is-warn' };
		if ( this.misses === this.maxMisses - 1 ) return { text: 'One more miss and it is gone', cls: 'is-warn' };
		if ( this.timeLeft < 5 ) return { text: 'It is working loose', cls: 'is-warn' };
		return { text: `Strike in the zone · ${ this.hits } / ${ this.required }`, cls: '' };

	}

	strike() {

		if ( this.state !== 'fighting' || this.cooldown > 0 ) return null;
		const [ lo, hi ] = this.zone;
		const hit = this.marker >= lo && this.marker <= hi;
		const half = Math.max( 0.001, ( hi - lo ) * 0.5 );
		const accuracy = hit ? Math.max( 0, Math.min( 1, 1 - Math.abs( this.marker - ( lo + hi ) * 0.5 ) / half ) ) : 0;
		this.cooldown = MARKER.cooldown;
		this.lastStrike = { hit, accuracy, t: this.time };
		if ( hit ) {

			this.hits ++;
			this.strain = Math.max( 0.04, this.strain - MARKER.hitRelief );
			if ( this.hits >= this.required ) this.state = 'caught';
			// the next pocket on the other side: another deliberate strike
			else this._zoneBase = this.hits % 2 ? 0.68 : 0.32;

		} else {

			this.misses ++;
			this.strain = Math.min( 1, this.strain + this.missStrain );
			this.surge = 1;
			this.distance = Math.min( this.maxDistance, this.distance + 1.5 + 2 * this.pull );
			if ( this.strain >= 1 ) this.state = 'snapped';
			else if ( this.misses >= this.maxMisses ) this.state = 'escaped';

		}

		return { hit, accuracy };

	}

	update( dt, reeling ) {

		if ( this.state !== 'fighting' ) return this.state;
		this.time += dt;
		const press = reeling && ! this._held;
		this._held = reeling;
		this.cooldown = Math.max( 0, this.cooldown - dt );
		this.timeLeft -= dt;

		// the marker sweeps 0 .. 1 and back
		this.marker += this.dir * this.speed * dt;
		if ( this.marker >= 1 ) {

			this.marker = 1;
			this.dir = - 1;

		} else if ( this.marker <= 0 ) {

			this.marker = 0;
			this.dir = 1;

		}

		// slippery fish shift the zone while you aim
		const c = this._zoneBase + this.drift * Math.sin( this.time * 1.7 + this._driftPhase );
		this.zoneCenter += ( c - this.zoneCenter ) * ( 1 - Math.exp( - dt * 8 ) );

		// the fish pulls all the time; it comes in a stretch with every good strike
		this.strain = Math.min( 1, this.strain + this.passive * dt );
		this.surge = Math.max( 0, this.surge - dt * 1.6 );
		const target = Math.max( 1.5, this.startDistance * ( 1 - this.hits / this.required ) );
		this.distance += ( target - this.distance ) * ( 1 - Math.exp( - dt * 2.5 ) ) + this.pull * 0.2 * dt;

		if ( press ) this.strike();
		if ( this.state !== 'fighting' ) return this.state;
		if ( this.strain >= 1 ) this.state = 'snapped';
		else if ( this.timeLeft <= 0 ) this.state = 'escaped';
		return this.state;

	}

}

// the fight for this fish: the marker game for marker species, the tension fight otherwise
export function createFight( opts ) {

	return FISH[ opts.species ].minigame === 'marker' ? new MarkerMinigame( opts ) : new CatchMinigame( { ...opts, classic: true } );

}

// ---------------------------------------------------------------------------
// The marker bar in the fight panel (GameHUD's .gm-fight): a thin track with the target zone, the
// sweeping marker, strike pips and miss pips. Shown only while a marker fight is on. Colours are CSS
// variables set from MARKER_PALETTE (setMarkerPalette swaps them: the accessibility hook).
//
//   const gauge = new MarkerGauge( parentElement )   (no-op without a DOM)
//   gauge.update( fight )                            every HUD update (fight may be null)
export const MARKER_PALETTE = {
	track: 'var(--tw-fill-2, rgba(255,255,255,0.12))',
	zone: 'rgba(var(--tw-aqua-rgb, 94, 234, 212), 0.42)',
	zoneEdge: 'rgba(var(--tw-aqua-rgb, 94, 234, 212), 0.85)',
	marker: 'var(--tw-ink, #f4f7fa)',
	markerHot: 'var(--tw-aqua, #5eead4)',
	hit: 'var(--tw-aqua, #5eead4)',
	miss: 'var(--tw-coral, #ff7a85)',
	pip: 'var(--tw-fill-2, rgba(255,255,255,0.18))',
};

const GAUGE_CSS = `
.mk-gauge { display: none; margin: 0 0 var(--tw-2, 6px); }
.mk-gauge.is-on { display: block; }
.mk-track { position: relative; height: calc(10 * var(--tw-u, 1px)); border-radius: 99px; background: var(--mk-track); overflow: hidden; }
.mk-zone { position: absolute; top: 0; bottom: 0; background: var(--mk-zone); border-left: 1px solid var(--mk-zone-edge); border-right: 1px solid var(--mk-zone-edge); }
.mk-marker { position: absolute; top: -2px; bottom: -2px; width: 3px; margin-left: -1.5px; border-radius: 2px; background: var(--mk-marker); }
.mk-marker.is-in { background: var(--mk-marker-hot); }
.mk-pips { display: flex; justify-content: space-between; margin-top: var(--tw-1, 4px); }
.mk-pips span span { display: inline-block; width: calc(7 * var(--tw-u, 1px)); height: calc(7 * var(--tw-u, 1px)); margin-right: calc(4 * var(--tw-u, 1px)); border-radius: 99px; background: var(--mk-pip); }
.mk-pips .mk-hits span.is-on { background: var(--mk-hit); }
.mk-pips .mk-misses span.is-on { background: var(--mk-miss); }
`;

let _palette = { ...MARKER_PALETTE };
const _gauges = new Set();

export function setMarkerPalette( p ) {

	_palette = { ...MARKER_PALETTE, ...p };
	for ( const g of _gauges ) g.applyPalette();

}

export class MarkerGauge {

	constructor( parent ) {

		this.el = null;
		if ( ! parent || typeof document === 'undefined' || ! document.createElement ) return;
		if ( ! document.getElementById( 'mk-gauge-css' ) ) {

			const st = document.createElement( 'style' );
			st.id = 'mk-gauge-css';
			st.textContent = GAUGE_CSS;
			document.head.appendChild( st );

		}

		const el = this.el = document.createElement( 'div' );
		el.className = 'mk-gauge';
		el.innerHTML = '<div class="mk-track"><span class="mk-zone"></span><span class="mk-marker"></span></div><div class="mk-pips"><span class="mk-hits"></span><span class="mk-misses"></span></div>';
		// under the panel's head line, above the tension gauge
		const head = parent.firstElementChild;
		if ( head && head.nextSibling ) parent.insertBefore( el, head.nextSibling );
		else parent.appendChild( el );
		this.zoneEl = el.querySelector( '.mk-zone' );
		this.markerEl = el.querySelector( '.mk-marker' );
		this.hitsEl = el.querySelector( '.mk-hits' );
		this.missEl = el.querySelector( '.mk-misses' );
		this._pips = '';
		_gauges.add( this );
		this.applyPalette();

	}

	applyPalette() {

		if ( ! this.el ) return;
		const s = this.el.style, p = _palette;
		s.setProperty( '--mk-track', p.track );
		s.setProperty( '--mk-zone', p.zone );
		s.setProperty( '--mk-zone-edge', p.zoneEdge );
		s.setProperty( '--mk-marker', p.marker );
		s.setProperty( '--mk-marker-hot', p.markerHot );
		s.setProperty( '--mk-hit', p.hit );
		s.setProperty( '--mk-miss', p.miss );
		s.setProperty( '--mk-pip', p.pip );

	}

	update( fight ) {

		if ( ! this.el ) return;
		const on = !! ( fight && fight.kind === 'marker' );
		this.el.classList.toggle( 'is-on', on );
		if ( ! on ) return;
		const [ lo, hi ] = fight.zone;
		this.zoneEl.style.left = `${ lo * 100 }%`;
		this.zoneEl.style.width = `${ ( hi - lo ) * 100 }%`;
		this.markerEl.style.left = `${ fight.marker * 100 }%`;
		this.markerEl.classList.toggle( 'is-in', fight.inZone );
		const key = fight.hits + '/' + fight.required + ':' + fight.misses + '/' + fight.maxMisses;
		if ( key !== this._pips ) {

			this._pips = key;
			const pips = ( n, of ) => Array.from( { length: of }, ( _, i ) => `<span class="${ i < n ? 'is-on' : '' }"></span>` ).join( '' );
			this.hitsEl.innerHTML = pips( fight.hits, fight.required );
			this.missEl.innerHTML = pips( fight.misses, fight.maxMisses );

		}

	}

	dispose() {

		_gauges.delete( this );
		if ( this.el ) this.el.remove();
		this.el = null;

	}

}
