import { KINDS, scheduleAt, nextStorm, transitionSeconds, dirOffset } from './Schedule.js';
import { climate, mix, smoothstep01, speciesSensitivity, BITE_RANGE } from './Climate.js';
import { FRONT, frontAt, influence, gustAt, strikesBetween, spoutAt, arrival, forecastText } from './Fronts.js';
import { FrontFX } from './FrontFX.js';
import { WorldLink } from './WorldLink.js';
import { RainFX } from './RainFX.js';
import { WeatherAudio } from './WeatherAudio.js';
import { WeatherHUD } from './WeatherHUD.js';
import { G } from '../../core/Globals.js';
import { FISH } from '../../game/FishTable.js';

// Dynamic weather: clear, breezy, overcast, rain, storm and fog, eased in over two to four minutes, on a
// schedule that is a pure function of the island's day and hour (Schedule.js), so every multiplayer client
// that shares the server clock sees the same weather with no extra messages. A feature module:
//
//   features.add( 'weather', weatherModule );                      // module: { install }
//   const weather = features.get( 'weather' );
//
// Read by others
//   weather.current            { kind, previous, shown, intensity 0..1, wind m/s, rain, danger, transition 0..1, manual }
//                              (one object, updated in place; kind is the weather being moved to, intensity how
//                              strongly that kind is expressed, eased in from 0 as it arrives; shown is the kind the
//                              world looks like now: the one before until the change is half way, then kind. The HUD names
//                              `shown`, so it never says Clear over the last minutes of a downpour)
//   weather.kind / .intensity / .wind / .rain (precipitation 0..1) / .danger (storm 0..1) / .lightning (flash 0..1)
//   weather.biteModifier( species )  multiplier of the bite rate: 1.2 overcast and light rain, ~0.6 in a storm
//                                    (species: a FishTable id or entry; big hard fighters feel it less); 0.5 .. 1.4
//   weather.warning            seconds to the next storm while within a minute of it, else null
//   weather.forecast( hours = 12, step = 1 )  [ { inHours, kind, intensity } ]
//   features.emit( 'weatherChanged', { kind, previous, intensity } )   when the weather turns to another kind
// Sandbox only
//   weather.setManual( kind | null, intensity? )   the owner picks (kind: one of KINDS) or releases the weather;
//                                                  false (and nothing happens) in Campaign / Multiplayer
// Instance contract (Features.js): update( dt ), dispose(), toJSON() / fromJSON(), reset()
//   toJSON() -> { manual, intensity, day }: the manual pick and the day count of a single-player clock
//
// What it moves (see WorldLink.js): the sea state (wind, direction, fetch, swell, choppiness, whitecaps, shore
// waves), clouds, cirrus, haze and sun shafts, plus a little exposure (a darker storm; the lightning flash).
// Hooks it needs from the integrator are listed in the report; none are required for it to run.
//
// Wave 19B, weather at sea (Fronts.js, FrontFX.js): storm fronts cross the map, a pure function of the island hours (the universe
// clock in multiplayer: every client sees the same line). Seen from afar, a dark cloud bank and a rain curtain on the horizon
// (FrontFX); under its band the weather where you are turns to storm (rain, wind, the sea's wave inputs: fetch, swell, chop
// through WorldLink, so the waves grow as it comes over), then the clearing behind it is calm. At its edge the squall: gusts that
// heel the boat (an impulse above her centre through boatCtl.applyCollision, at most GUST.accel m/s^2) and push the seaplane
// (flight.wind). Its lightning falls on a schedule of its own (Fronts.strikesBetween); the thunder comes distance / 343 m/s
// after the flash. A waterspout on some fronts. Read:
//   weather.front              the front crossing the sea now (Fronts.frontAt) | null
//   weather.local              { depth, rain, squall, calm, under } the front where the player is
//   weather.gust               { x, z, speed } the squall's wind over the steady wind at the player (m/s, <= FRONT.maxGust)
//   weather.gustAt( x, z, out ) the same anywhere                weather.spout   { x, z, r, life } | null
//   weather.seaForecast( x?, z? ) -> { inHours, from, strength, passHours, under } | null   (Fronts.arrival)
//   weather.forecastText( x?, z? ) -> "A squall line from the south-west, about 25 minutes out: ..."   (the harbourmaster,
//                              the navy office; the plane's radio reads it out on takeoff: planeTookOff)
// Events: frontArrived { id, from } when the band reaches the player, lightningStrike { x, z, distanceKm, delay }.

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const FLASH_GAIN = 2.2; // exposure x(1 + 2.2) at the peak of a flash
// a front's strikes (_frontStrikes): glow in the cloud bank within `glow` m, the screen flashes within `near` m under the band,
// never two screen flashes closer than `gap` s
const FLASH = { glow: 6000, near: 2500, gap: 8 };
const RADIO_GAP_MS = 90000; // the forecast on the plane's radio at most every 90 s
const MANUAL_SECONDS = 25; // an owner's pick takes effect faster than the scheduled weather
const MANUAL_INTENSITY = { clear: 0.8, breezy: 0.5, overcast: 0.7, rain: 0.6, storm: 0.9, fog: 0.8 };
const UP = { x: 0, y: 1, z: 0 };
export const GUST = { accel: 0.35, lever: 3.2, min: 0.5 }; // squall push: at most 0.35 m/s^2, 3.2 m above the hull's origin
const NO_GUST = Object.freeze( { x: 0, z: 0, speed: 0 } );

export { KINDS };

export class Weather {

	constructor( app, features, { rng = Math.random, now = () => Date.now() } = {} ) {

		this.app = app;
		this.features = features || null;
		this.rng = rng;
		this.now = now;
		this.manual = null; // { kind, intensity }: the owner's pick (Sandbox)
		this.day = 0; // island day of a single-player clock
		this._lastHour = null;
		this._src = 'local';
		this._age = 0;
		this._settle = 6; // s: a new target is taken at once (not eased) while the world is still being set up
		this._tgt = null; // the schedule entry being moved to
		this._from = null;
		this._to = null;
		this._p = 1;
		this._dur = 1;
		this._i0 = 0;
		this._shownFrom = null; // the kind the HUD names during the first half of a change
		this.cur = climate( 'breezy', 0.5, 0 ); // the eased parameters
		this.current = { kind: 'breezy', previous: null, shown: 'breezy', intensity: 0, wind: this.cur.wind, rain: 0, danger: 0, transition: 1, manual: false };
		this.hours = 0; // absolute island hours of the last update
		this.warning = null;
		this.shelter = 0; // 0..1, a roof over the player
		this._shelterIn = 0;
		this.lightning = 0;
		this._pulses = [];
		this._ft = 0;
		this._strikeIn = 5;
		this.strikes = 0;
		// wave 19B: fronts at sea
		this.front = null;
		this.local = influence( null, 0, 0, 0, {} );
		this.gust = { x: 0, z: 0, speed: 0 };
		this.spout = null;
		this.eff = { ...this.cur }; // the parameters with the front's weather folded in (what the world shows)
		this._frontK = 0;
		this._calmK = 0;
		this._lastA = null;
		this._frontIn = false;
		this._planeWind = false;
		this._flashEv = null;
		this.gustImpulse = 0;
		this.frontFx = null;
		this._offs = [];
		if ( features && typeof features.on === 'function' ) this._offs.push( features.on( 'planeTookOff', () => this._radio() ) );

		this.world = new WorldLink( app, () => !! ( this.features && this.features.sandbox ) );
		this.audio = new WeatherAudio( app, { rng } );
		this.hud = new WeatherHUD( app );
		this.rain = null;
		const qs = app && app.qs;
		const off = qs && typeof qs.has === 'function' && qs.has( 'noWeatherFx' );
		if ( ! off && app && app.scene && typeof app.scene.add === 'function' ) {

			try {

				this.rain = new RainFX( { count: qs && typeof qs.has === 'function' && qs.has( 'lowFx' ) ? 3500 : 7000 } );
				app.scene.add( this.rain.mesh );

			} catch ( e ) {

				console.warn( 'weather: rain effect unavailable', e );
				this.rain = null;

			}

			try {

				const lite = !! ( ( qs && typeof qs.has === 'function' && qs.has( 'lowFx' ) ) || globalThis.__phoneBudget );
				this.frontFx = new FrontFX( lite ? { segments: 20, segLength: 320, lite: true } : { segments: 40, segLength: 160 } );
				app.scene.add( this.frontFx.mesh );

			} catch ( e ) {

				console.warn( 'weather: the front effect is unavailable', e );
				this.frontFx = null;

			}

		}

	}

	// ---- read

	get kind() { return this.current.kind; }
	get intensity() { return this.current.intensity; }
	get wind() { return this.eff.wind; }
	get rainIntensity() { return this.eff.rain; }
	get danger() { return this.eff.danger; }

	biteModifier( species ) {

		let fish = null;
		if ( species && typeof species === 'object' && Number.isFinite( species.fight ) ) fish = species;
		else {

			const id = typeof species === 'string' ? species : species && ( species.id || species.species );
			if ( id && FISH[ id ] ) fish = FISH[ id ];

		}

		const bite = this._frontK > 1e-3 ? this.eff.bite : this.cur.bite; // (under a front: the front's)
		return clamp( 1 + ( bite - 1 ) * speciesSensitivity( fish ), BITE_RANGE[ 0 ], BITE_RANGE[ 1 ] );

	}

	forecast( hours = 12, step = 1 ) {

		const out = [];
		const manual = this._manualActive();
		for ( let h = 0; h <= hours + 1e-6; h += step ) {

			const e = manual ? { kind: manual.kind, intensity: manual.intensity } : scheduleAt( this.hours + h );
			out.push( { inHours: h, kind: e.kind, intensity: e.intensity } );

		}

		return out;

	}

	// ---- Sandbox control

	setManual( kind, intensity ) {

		if ( ! this.features || ! this.features.sandbox ) return false;
		if ( kind === null || kind === undefined ) {

			this.manual = null;
			return true;

		}

		if ( ! KINDS.includes( kind ) ) return false;
		this.manual = { kind, intensity: clamp( Number.isFinite( intensity ) ? intensity : MANUAL_INTENSITY[ kind ], 0, 1 ) };
		return true;

	}

	_manualActive() {

		return this.manual && this.features && this.features.sandbox ? this.manual : null;

	}

	// ---- time

	// absolute island hours: the server's clock in Multiplayer (every client derives the same day from it),
	// else the settings clock with a day counter that follows its wraps
	_time() {

		const app = this.app, s = app && app.settings;
		const hour = s && Number.isFinite( s.timeOfDay ) ? s.timeOfDay : 12;
		const net = app && app.net;
		const c = net && net.clock;
		const server = !! ( app && app.rules && app.rules.serverClock && c && Number.isFinite( c.timeOfDay ) && Number.isFinite( c.at ) && Number.isFinite( c.timeSpeed ) );
		const src = server ? 'net' : 'local';
		if ( src !== this._src ) {

			this._src = src;
			this._settle = Math.max( this._settle, 3 ); // the day count changed basis: take the new weather at once
			this._lastHour = null;

		}

		if ( server ) {

			// (at / 1000 * speed) - timeOfDay is the same number, modulo whole days, for every client of the room
			const day = Math.floor( ( c.at / 1000 * c.timeSpeed - c.timeOfDay ) / 24 );
			this.speed = c.timeSpeed;
			return day * 24 + c.timeOfDay + ( this.now() - c.at ) / 1000 * c.timeSpeed;

		}

		if ( this._lastHour !== null ) {

			const d = hour - this._lastHour;
			if ( d < - 12 ) this.day ++;
			else if ( d > 12 ) this.day = Math.max( 0, this.day - 1 );

		}

		this._lastHour = hour;
		this.speed = s && Number.isFinite( s.timeSpeed ) ? s.timeSpeed : 0;
		return this.day * 24 + hour;

	}

	// ---- the state machine

	_retarget( entry, manual ) {

		const first = this._tgt === null;
		const prev = this._tgt ? this._tgt.kind : null;
		const to = climate( entry.kind, entry.intensity, dirOffset( entry.id, entry.kind ) );
		const cur = this.current;
		// what the HUD keeps naming until the change is half way (a pick mid-change starts from what was shown)
		this._shownFrom = first || this._settle > 0 ? entry.kind : cur.shown || prev || entry.kind;
		this._i0 = prev === entry.kind ? cur.intensity : 0;
		this._to = to;
		this._tgt = entry;
		this.world.release();
		if ( first || this._settle > 0 ) {

			this.cur = { ...to };
			this._from = to;
			this._p = 1;
			this._dur = 1;
			this._i0 = entry.intensity;
			cur.intensity = entry.intensity;

		} else {

			this._from = { ...this.cur };
			this._p = 0;
			this._dur = manual ? MANUAL_SECONDS : transitionSeconds( entry.id );

		}

		if ( prev !== entry.kind ) {

			cur.previous = prev;
			cur.kind = entry.kind;
			if ( prev !== null && this.features && typeof this.features.emit === 'function' ) this.features.emit( 'weatherChanged', { kind: entry.kind, previous: prev, intensity: entry.intensity } );

		}

	}

	update( dt ) {

		dt = clamp( Number.isFinite( dt ) ? dt : 0, 0, 0.25 );
		this._age += dt;
		if ( this._settle > 0 ) this._settle -= dt;

		const A = this.hours = this._time();
		const manual = this._manualActive();
		const entry = manual ? { kind: manual.kind, intensity: manual.intensity, id: 'm:' + manual.kind + ':' + manual.intensity, front: false } : scheduleAt( A );
		if ( this._tgt === null || entry.id !== this._tgt.id ) this._retarget( entry, !! manual );

		if ( this._p < 1 ) this._p = Math.min( 1, this._p + dt / this._dur );
		const e = smoothstep01( this._p );
		if ( this._p < 1 || this._from !== this._to ) {

			mix( this._from, this._to, e, this.cur );
			// drying out: the rain stops within the first half of the change (cloud and wind take all of it), by
			// the time the HUD names the new, drier sky
			const f = this._from, t = this._to;
			if ( t.rain < f.rain ) this.cur.rain = f.rain + ( t.rain - f.rain ) * smoothstep01( this._p * 2 );

		}

		if ( this._p >= 1 ) this._from = this._to;

		this._fronts( A, dt );
		const cur = this.current, p = this.eff;
		cur.intensity = this._i0 + ( this._tgt.intensity - this._i0 ) * e;
		cur.wind = p.wind;
		cur.rain = p.rain;
		cur.danger = p.danger;
		cur.transition = this._p;
		cur.manual = !! manual;
		cur.shown = e < 0.5 && this._shownFrom ? this._shownFrom : cur.kind;
		// under a front the sky over you is the front's
		if ( this._frontK > 0.55 ) cur.shown = 'storm';
		else if ( this._frontK > 0.2 && cur.shown !== 'storm' ) cur.shown = 'rain';

		// storm warning: the last minute (of real time) before a scheduled storm
		this.warning = null;
		if ( ! manual && this.speed > 1e-6 ) {

			const st = nextStorm( A, 12 );
			if ( st !== null && ( st - A ) / this.speed <= 60 && cur.kind !== 'storm' ) this.warning = ( st - A ) / this.speed;
			// a front about to reach the player
			const fa = this._arrivalHere;
			if ( this.warning === null && fa && ! fa.under && fa.inHours / this.speed <= 60 ) this.warning = fa.inHours / this.speed;

		}

		this.world.apply( p, dt );
		this._shelterTick( dt );
		this._lightningTick( dt );
		this._frontStrikes( A );
		this._exposure();
		this._applyGusts( dt, A );

		const app = this.app;
		if ( this.rain && app && app.camera ) {

			this.rain.update( dt, app.camera, {
				rain: p.rain, windSpeed: p.wind, windDir: G.windDir ? G.windDir.value : null,
				waterHeight: Number.isFinite( app.cameraWaterHeight ) ? app.cameraWaterHeight : 0,
				sunMix: 1 - clamp( ( p.clouds - 0.4 ) / 0.55, 0, 1 ) * 0.9, shelter: this.shelter,
			} );

		}

		this.audio.update( dt, { rain: p.rain, wind: p.wind + this.gust.speed * 0.5, danger: p.danger, shelter: this.shelter } );
		if ( this.frontFx && app && app.camera ) {

			const cam = app.camera.position, ci = this._camInf || ( this._camInf = {} );
			influence( this.front, cam.x, cam.z, A, ci );
			this.frontFx.update( dt, app.camera, this.front, A, {
				strength: this.front ? this.front.strength : 0, inside: ci.depth > - 60 && ci.depth < FRONT.width + 200 ? 1 : 0,
				spout: this.spout, flash: this._flashEv,
			} );
			this._flashEv = null;

		}

		this.hud.update( { kind: cur.shown, wind: p.wind, warning: this.warning, manual: !! manual }, dt );

	}

	// a roof over the player (a solid collider within 10 m overhead): rain stops falling on the camera and the
	// sound dulls. Looked for four times a second; the answer eases in.
	_shelterTick( dt ) {

		const app = this.app;
		// (wave 19E) inside a room (src/world/interiors: its shell has hollow walls, no roof collider): fully sheltered at
		// once, so no streak falls through the ceiling and the flash and the rain's sound stay outside
		const it = this.features && this.features.get ? this.features.get( 'interiors' ) : null;
		if ( it && it.inside ) {

			this._cover = 1;
			this.shelter = 1;
			this._shelterIn = 0;
			return;

		}

		this._shelterIn -= dt;
		if ( this._shelterIn <= 0 ) {

			this._shelterIn = 0.25;
			let covered = 0;
			const col = app && app.colliders;
			const pos = ( app && app.player && app.player.position ) || ( app && app.camera && app.camera.position );
			if ( col && typeof col.raycast === 'function' && pos && this.cur.rain > 0.02 ) {

				try {

					const o = this._o || ( this._o = { x: 0, y: 0, z: 0 } );
					o.x = pos.x; o.y = pos.y + 1.7; o.z = pos.z;
					covered = col.raycast( o, UP, 10 ) < 10 ? 1 : 0;

				} catch ( e ) { covered = 0; }

			}

			this._cover = covered;

		}

		this.shelter += ( ( this._cover || 0 ) - this.shelter ) * Math.min( 1, dt * 3 );

	}

	// ---- lightning (storms): a flash of exposure, a flicker, thunder after the sound has travelled

	_lightningTick( dt ) {

		if ( this._pulses.length ) {

			this._ft += dt;
			let v = 0;
			for ( const q of this._pulses ) {

				const x = this._ft - q.at;
				if ( x < 0 ) continue;
				v = Math.max( v, q.amp * ( x < q.rise ? x / q.rise : Math.exp( - ( x - q.rise ) / q.fall ) ) );

			}

			this.lightning = v;
			if ( this._ft > 1.2 ) { this._pulses.length = 0; this.lightning = 0; }

		} else this.lightning = 0;

		if ( this.cur.danger > 0.45 ) {

			this._strikeIn -= dt;
			if ( this._strikeIn <= 0 ) {

				this.strike();
				this._strikeIn = ( 4 + this.rng() * 13 ) / ( 0.5 + this.cur.danger );

			}

		} else this._strikeIn = 4;

	}

	// one lightning strike now (the storm calls this; also usable from a console / test). distanceKm
	// decides how bright it is and how long the thunder takes (343 m/s)
	strike( distanceKm ) {

		const d = Number.isFinite( distanceKm ) ? distanceKm : 0.4 + this.rng() * this.rng() * 5;
		const delay = d * 1000 / 343;
		const power = clamp( 1.15 - d / 4.5, 0.15, 1 );
		const amp = 0.45 + 0.55 * power;
		const r = this.rng;
		const pulses = [
			{ at: 0, amp, rise: 0.02, fall: 0.05 + 0.05 * power },
			{ at: 0.15 + r() * 0.12, amp: amp * 0.6, rise: 0.015, fall: 0.08 },
		];
		if ( r() < 0.5 ) pulses.push( { at: 0.4 + r() * 0.15, amp: amp * 0.35, rise: 0.015, fall: 0.07 } );
		this._pulses = pulses;
		this._ft = 0;
		this.strikes ++;
		this.audio.thunder( delay, power );
		return { distanceKm: d, delay, power };

	}

	// exposure: the scene's own value times the weather's darkness times the flash. The settings panel's slider
	// writes app.settings.exposure too: a value that is not the one written here last frame is the new base.
	_exposure() {

		const s = this.app && this.app.settings;
		if ( ! s || ! Number.isFinite( s.exposure ) ) return;
		if ( this._expLast === undefined || s.exposure !== this._expLast ) this._expBase = s.exposure;
		const k = this.cur.light * ( 1 + FLASH_GAIN * this.lightning * ( 1 - 0.6 * this.shelter ) );
		this._expLast = s.exposure = this._expBase * k;

	}

	// ---- wave 19B: fronts at sea

	// where the front's weather is measured: the player (on foot, at the helm, flying), else the camera
	_here() {

		const app = this.app;
		const sp = this.features && this.features.get ? this.features.get( 'seaplane' ) : null;
		if ( sp && sp.piloted && sp.flight && sp.flight.position ) return sp.flight.position;
		return ( app && app.player && app.player.position ) || ( app && app.camera && app.camera.position ) || null;

	}

	_fronts( A, dt ) {

		const f = this.front = frontAt( A );
		const here = this._here();
		const L = influence( f, here ? here.x : 0, here ? here.z : 0, A, this.local );
		if ( here ) gustAt( f, here.x, here.z, A, this.gust );
		else Object.assign( this.gust, NO_GUST );
		this.spout = spoutAt( f, A );
		this._arrivalHere = here ? arrival( here.x, here.z, A, 2 ) : null;
		// eased (a few seconds): a jump of the clock does not slam the sea state
		const k = this._settle > 0 ? 1 : Math.min( 1, dt / 3 );
		this._frontK += ( clamp( L.rain, 0, 1 ) - this._frontK ) * k;
		this._calmK += ( clamp( L.calm, 0, 1 ) - this._calmK ) * k;
		const eff = this.eff;
		Object.assign( eff, this.cur );
		if ( this._frontK > 1e-3 ) {

			const st = this._stormP || ( this._stormP = climate( 'storm', 0.85, 0 ) );
			mix( this.cur, st, this._frontK, eff );
			eff.windDir = this.cur.windDir;

		}

		if ( this._calmK > 1e-3 ) {

			const cl = this._calmP || ( this._calmP = climate( 'clear', 1, 0 ) );
			const d = eff.windDir, from = this._calmFrom || ( this._calmFrom = {} );
			Object.assign( from, eff );
			mix( from, cl, this._calmK * 0.7, eff );
			eff.windDir = d;

		}

		const inBand = L.under;
		if ( inBand && ! this._frontIn && f ) {

			const a = arrival( here.x, here.z, A - 0.05, 1 );
			this._emit( 'frontArrived', { id: f.id, from: a ? a.from : null } );

		}

		this._frontIn = inBand;

	}

	// the front's lightning: deterministic strikes along its band; those within 9 km of the camera flash and thunder
	_frontStrikes( A ) {

		const f = this.front, last = this._lastA;
		this._lastA = A;
		if ( ! f || last === null || ! ( A > last ) || A - last > 0.05 ) return;
		const cam = ( this.app && this.app.camera && this.app.camera.position ) || this._here();
		if ( ! cam ) return;
		strikesBetween( f, last, A, ( s ) => {

			const d = Math.hypot( s.x - cam.x, s.z - cam.z );
			// a faint glow in the cloud bank for a strike a few km off; the screen itself flashes only for one close by, when
			// the storm is over the player (the band's rain here), and not while the storm's own lightning (_lightningTick)
			// already runs its schedule: lightning is rare and near, never a strobe over a clear sea
			if ( d > FLASH.glow ) return;
			this._flashEv = { amount: Math.max( 0.15, 0.6 * ( 1 - d / FLASH.glow ) ), x: s.x, z: s.z };
			if ( d > FLASH.near || this.cur.danger > 0.45 || this._frontK < 0.2 || this._age - ( this._lastFlashAt ?? - 1e9 ) < FLASH.gap ) return;
			this._lastFlashAt = this._age;
			const r = this.strike( Math.max( 0.1, d / 1000 ) );
			this._emit( 'lightningStrike', { x: Math.round( s.x ), z: Math.round( s.z ), distanceKm: r.distanceKm, delay: r.delay } );

		} );

	}

	gustAt( x, z, out = {} ) {

		return gustAt( this.front, x, z, this.hours, out );

	}

	// the squall pushes the boat (an impulse above her centre: she heels and is set downwind) and the seaplane (its air)
	_applyGusts( dt, A ) {

		this.gustImpulse = 0;
		if ( ! ( dt > 0 ) ) return;
		const app = this.app, b = app && app.boatCtl;
		const g = this._gb || ( this._gb = {} );
		if ( b && b.position && typeof b.applyCollision === 'function' && ! b.moored && ! b.frozen ) {

			gustAt( this.front, b.position.x, b.position.z, A, g );
			if ( g.speed > GUST.min ) {

				const m = Number.isFinite( b.mass ) && b.mass > 0 ? b.mass : 3200;
				const area = clamp( 4 + m / 600, 6, 70 ); // m^2 of windage and canvas
				const F = Math.min( 0.5 * 1.225 * 1.2 * area * g.speed * g.speed, m * GUST.accel );
				const k = F * dt / g.speed;
				try { b.applyCollision( 0, 0, g.x * k, g.z * k, b.position.x, b.position.y + GUST.lever, b.position.z ); } catch ( e ) { /* optional */ }
				this.gustImpulse = F * dt;

			}

		}

		const sp = this.features && this.features.get ? this.features.get( 'seaplane' ) : null, fl = sp && sp.flight;
		if ( fl && fl.wind && typeof fl.wind.set === 'function' && fl.position ) {

			gustAt( this.front, fl.position.x, fl.position.z, A, g );
			if ( g.speed > 0.05 ) {

				fl.wind.set( g.x, 0, g.z );
				this._planeWind = true;

			} else if ( this._planeWind ) {

				fl.wind.set( 0, 0, 0 );
				this._planeWind = false;

			}

		}

	}

	seaForecast( x, z ) {

		const h = this._here();
		const px = Number.isFinite( x ) ? x : h ? h.x : 0, pz = Number.isFinite( z ) ? z : h ? h.z : 0;
		return arrival( px, pz, this.hours, 12 );

	}

	forecastText( x, z ) {

		const h = this._here();
		const px = Number.isFinite( x ) ? x : h ? h.x : 0, pz = Number.isFinite( z ) ? z : h ? h.z : 0;
		return forecastText( px, pz, this.hours, { speed: this.speed || 0 } );

	}

	// the plane's radio on takeoff: the forecast where she flies
	_radio() {

		// once a take-off: a plane hopping off the chop fires planeTookOff every bounce (six readings in one run)
		const now = this.now();
		if ( now - ( this._radioAt || - 1e12 ) < RADIO_GAP_MS ) return;
		this._radioAt = now;
		const g = this.app && this.app.game;
		if ( g && typeof g.toast === 'function' ) g.toast( `Radio: ${ this.forecastText() }`, 4600 );

	}

	_emit( name, e ) {

		if ( this.features && typeof this.features.emit === 'function' ) this.features.emit( name, e );

	}

	// ---- save and lifecycle

	toJSON() {

		return { manual: this.manual ? this.manual.kind : null, intensity: this.manual ? this.manual.intensity : null, day: this.day };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this.manual = typeof d.manual === 'string' && KINDS.includes( d.manual ) ? { kind: d.manual, intensity: clamp( Number.isFinite( d.intensity ) ? d.intensity : MANUAL_INTENSITY[ d.manual ], 0, 1 ) } : null;
		if ( Number.isFinite( d.day ) ) this.day = Math.max( 0, Math.floor( d.day ) );
		this._settle = Math.max( this._settle, 3 ); // the loaded world takes its weather at once
		this._tgt = null;

	}

	reset() {

		this.manual = null;
		this.day = 0;
		this._lastHour = null;
		this._tgt = null;
		this._settle = 3;
		this._pulses.length = 0;
		this.lightning = 0;
		this._lastA = null;
		this._frontK = this._calmK = 0;

	}

	dispose() {

		const s = this.app && this.app.settings;
		if ( s && this._expLast !== undefined && s.exposure === this._expLast ) s.exposure = this._expBase;
		if ( this.rain ) this.rain.dispose();
		this.rain = null;
		if ( this.frontFx ) this.frontFx.dispose();
		this.frontFx = null;
		for ( const off of this._offs ) try { off(); } catch ( e ) { /* gone */ }
		this._offs.length = 0;
		const sp = this.features && this.features.get ? this.features.get( 'seaplane' ) : null;
		if ( this._planeWind && sp && sp.flight && sp.flight.wind ) sp.flight.wind.set( 0, 0, 0 );
		this.audio.dispose();
		this.hud.dispose();

	}

}

export function install( app, features ) {

	return new Weather( app, features );

}

export default { install };
