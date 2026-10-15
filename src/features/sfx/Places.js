// Ambience beds for the new places (wave 13C), synthesised like the rest (no files): Tidemark's town, Blackwater and the
// Inverted Isles' upward waterfalls. Two halves:
//
//   pure   sources( world? )                         where each sound lives (read from WORLD / the town and stronghold plans)
//          bedWeights( x, z, hour, ctx? ) -> levels  0..1 per bed at a listener spot and hour: the distance fade (like
//                                                    the surf bed: full inside `inner`, smoothly gone by `outer`) times the
//                                                    hour's share (daylight, the working day, the night's drums...)
//          marketCrowd( hour, folk? )                 the market square's murmur: the day curve times how many of the
//                                                    residents' schedules (harbour/Roles.js) have them up and about
//          bellStrikes( prevHour, hour )              the chapel bell: 1..12 strikes when the clock passes a daylight hour
//   audio  PlaceBeds( sfx )                           loops (murmur, surf on the cliffs, falls, windsock, a plane running up)
//                                                    that fade by distance, and one-shots on timers (bell, gulls over the quay,
//                                                    hammering from the boatyard, drums and shouts at night, parrots and
//                                                    frigatebirds), all through the SoundScape's ambience node
//
// Beds: market (Tidemark square) / gulls (the quay, by day) / strip (the windsock; a plane running up on the apron) /
// yard (boatyard hammering, by day) / chapel (the hourly bell) / tavern (the Rum Hole, rowdier at night) / drums (the
// town's drums at night; quiet once the player holds the island) / fort (the alarm bell and the watch) / cliffs (surf on
// the caldera wall) / birds (parrots by day) / falls (the Inverted Isles). `places.levels` holds the last values; the
// counters (bells, gulls, hammers, drums, shouts, birds) and `places.bedNodes()` are for tests.

import { WORLD } from '../../world/WorldLayout.js';
import { BUILDING_BY_ID } from '../../world/islands/town/Layout.js';
import { strongholdLayout } from '../../world/islands/stronghold/Layout.js';
import { scheduleOf, activityAt } from '../harbour/Roles.js';
import { clamp, lerp, num, smooth } from './util.js';
import { noiseBuf, gainNode, filterNode } from './Synth.js';

// ------------------------------------------------------------------ pure: where, and when

// the hour of the day: the SoundScape's reading, else the island clock, else noon
export function hourOf( app ) {

	const e = app && app.audio && app.audio.env;
	if ( e && Number.isFinite( e.hour ) ) return e.hour;
	const s = app && app.settings;
	return s && Number.isFinite( s.timeOfDay ) ? ( ( s.timeOfDay % 24 ) + 24 ) % 24 : 12;

}

export const daylight = ( h ) => smooth( 4.5, 7, h ) * ( 1 - smooth( 18.5, 21, h ) );
// 0 by day .. 1 in the dark hours
export const nightness = ( h ) => ( h >= 12 ? smooth( 17.5, 20.5, h ) : 1 - smooth( 4, 6.5, h ) );
// the boatyard's working day, with a pause at noon
export const workday = ( h ) => smooth( 6.5, 8, h ) * ( 1 - smooth( 16.5, 18, h ) ) * ( 1 - 0.75 * smooth( 11.6, 12, h ) * ( 1 - smooth( 12.8, 13.2, h ) ) );

// full inside `inner`, smoothly gone by `outer` (metres)
export function fade( d, inner, outer ) {

	if ( ! Number.isFinite( d ) ) return 0;
	return d <= inner ? 1 : d >= outer ? 0 : 1 - smooth( inner, outer, d );

}

// what each activity of a harbour schedule adds to a crowd in the square
const CROWD = { sleep: 0, wake: 0.4, work: 1, eat: 1.35, loiter: 1, play: 0.85, tavern: 0.15, watch: 0.25 };

// 0..1: the market's murmur at an hour. folk: residents ({ data } or role data) of the port; their schedules thin the crowd
// out at night and thicken it at the noon meal; without folk it is the day curve alone.
export function marketCrowd( hour, folk = null ) {

	const h = ( ( Number.isFinite( hour ) ? hour : 12 ) % 24 + 24 ) % 24;
	const base = 0.05 + 0.8 * smooth( 6.5, 10, h ) * ( 1 - 0.8 * smooth( 15, 19.5, h ) ); // (below 1: a noon meal in the square can still thicken it)
	if ( ! folk || ! folk.length ) return clamp( base, 0, 1 );
	let sum = 0, n = 0;
	for ( const f of folk ) {

		const sch = scheduleOf( f && f.data ? f.data : f );
		if ( ! sch ) continue;
		sum += CROWD[ activityAt( sch, h ) ] ?? 0.6;
		n ++;

	}

	if ( ! n ) return clamp( base, 0, 1 );
	return clamp( base * ( 0.3 + 0.7 * Math.min( 1.2, sum / n ) ), 0, 1 );

}

// strikes of the chapel bell when the clock moves from prevHour to hour: the hour (1..12) if it passed a whole hour between
// 6:00 and 22:00, else 0. A jump of more than 1.5 hours (a loaded save, the sandbox's slider) rings nothing.
export function bellStrikes( prevHour, hour ) {

	if ( ! Number.isFinite( prevHour ) || ! Number.isFinite( hour ) ) return 0;
	let d = hour - prevHour;
	if ( d < - 12 ) d += 24;
	if ( d <= 0 || d > 1.5 ) return 0;
	const a = Math.floor( prevHour ), b = Math.floor( hour );
	if ( a === b ) return 0;
	const h = b % 24;
	if ( h < 6 || h > 22 ) return 0;
	return h % 12 || 12;

}

// where each sound lives. inner / outer: the distance fade in metres.
const SRC = new WeakMap();

export function sources( world = WORLD ) {

	let out = SRC.get( world );
	if ( out ) return out;
	SRC.set( world, out = {} );
	const put = ( id, place, p, inner, outer, extra = {} ) => {

		if ( p && Number.isFinite( p.x ) && Number.isFinite( p.z ) ) out[ id ] = { id, place, x: p.x, z: p.z, inner, outer, ...extra };

	};

	const T = world.tidemark;
	if ( T ) {

		put( 'market', 'tidemark', T.market || T.town, 14, 85 );
		put( 'gulls', 'tidemark', T.dock && T.dock.start, 25, 150 );
		put( 'strip', 'tidemark', T.airstrip && T.airstrip.pad, 35, 170 );
		const yard = BUILDING_BY_ID.boatyard, chapel = BUILDING_BY_ID.chapel;
		put( 'yard', 'tidemark', yard, 14, 85 );
		put( 'chapel', 'tidemark', chapel, 40, 280 );

	}

	const B = world.blackwater;
	if ( B ) {

		let L = null;
		try { L = strongholdLayout(); } catch ( e ) { L = null; }
		const rum = L && L.town.find( ( b ) => b.kind === 'tavern' );
		put( 'tavern', 'blackwater', rum, 14, 85 );
		put( 'drums', 'blackwater', rum && { x: rum.x + 0.3 * ( B.cove.x - rum.x ), z: rum.z + 0.3 * ( B.cove.z - rum.z ) }, 50, 340 );
		put( 'fort', 'blackwater', L && L.tower, 100, 520 );
		put( 'cliffs', 'blackwater', B.center, 50, 300, { ring: B.radius * 0.75 } ); // the volcanic wall: loudest on the ring, a wash in the caldera, fading out to sea
		put( 'birds', 'blackwater', B.center, B.radius * 0.8, B.radius + 150 );

	}

	const I = world.inverted;
	if ( I && I.lagoon ) put( 'falls', 'inverted', I.lagoon, 80, 300 );
	return out;

}

// levels 0..1 of every bed for a listener at (x, z) at `hour`. ctx: { wind (m/s), held (the player holds Blackwater),
// folk (Tidemark's residents), surf, runup: { x, z, rpm } }
export function bedWeights( x, z, hour, ctx = {}, world = WORLD ) {

	const S = sources( world ), out = {};
	const near = ( s ) => ( s ? fade( s.ring ? Math.abs( Math.hypot( x - s.x, z - s.z ) - s.ring ) : Math.hypot( x - s.x, z - s.z ), s.inner, s.outer ) : 0 );
	const h = ( ( Number.isFinite( hour ) ? hour : 12 ) % 24 + 24 ) % 24;
	const wind = clamp( num( ctx.wind, 6 ), 0, 40 );
	const night = nightness( h ), day = daylight( h );
	out.market = near( S.market ) * marketCrowd( h, ctx.folk );
	out.gulls = near( S.gulls ) * day;
	out.strip = near( S.strip ) * smooth( 1, 9, wind );
	const r = ctx.runup;
	out.engine = r && S.strip ? fade( Math.hypot( x - r.x, z - r.z ), 25, 380 ) * clamp( num( r.rpm, 0 ), 0, 1 ) : 0;
	out.yard = near( S.yard ) * workday( h );
	out.chapel = near( S.chapel );
	out.tavern = near( S.tavern ) * ( 0.3 + 0.7 * night );
	out.drums = near( S.drums ) * night * ( ctx.held ? 0.2 : 1 );
	out.fort = near( S.fort );
	out.cliffs = near( S.cliffs ) * ( 0.55 + 0.45 * smooth( 2, 12, wind ) ) * clamp( num( ctx.surf, 0.6 ) + 0.4, 0, 1 );
	out.birds = near( S.birds ) * day;
	out.falls = near( S.falls );
	return out;

}

// the nearest plane with its engine running on the Tidemark apron that the listener is not flying: the local plane left
// running, or another player's from the newest sample they sent. -> { x, z, rpm } | null
export function runupOf( features, world = WORLD ) {

	const sp = features && features.get ? features.get( 'seaplane' ) : null;
	const strip = world.tidemark && world.tidemark.airstrip;
	if ( ! sp || ! strip ) return null;
	const near = ( x, z ) => Math.hypot( x - strip.x, z - strip.z ) < 160;
	let best = null;
	const f = sp.flight;
	if ( f && f.position && f.engineOn && num( f.rpm, 0 ) > 0.15 && ! f.airborne && ! f.onWater && ! sp.piloted && near( f.position.x, f.position.z ) ) best = { x: f.position.x, z: f.position.z, rpm: f.rpm };
	const peers = sp.remote && sp.remote.peers;
	if ( peers && typeof peers.values === 'function' ) for ( const r of peers.values() ) {

		const s = r && r.snaps && r.snaps[ r.snaps.length - 1 ];
		if ( ! s || ! s.p || num( s.thr, 0 ) < 0.15 || s.p[ 1 ] > 8 || ! near( s.p[ 0 ], s.p[ 2 ] ) ) continue;
		if ( ! best || s.thr > best.rpm ) best = { x: s.p[ 0 ], z: s.p[ 2 ], rpm: s.thr };

	}

	return best;

}

// ------------------------------------------------------------------ audio: the loops

export function loopNoise( ctx, kind ) {

	const s = ctx.createBufferSource();
	s.buffer = noiseBuf( ctx, kind );
	s.loop = true;
	return s;

}

// a slow modulator on a param: out += osc * depth
export function lfo( ctx, rate, depth, param, sources ) {

	const o = ctx.createOscillator();
	o.frequency.value = rate;
	const g = gainNode( ctx, depth );
	o.connect( g );
	g.connect( param );
	o.start();
	sources.push( o );
	return o;

}

// a crowd: brown noise through voice-band filters whose levels flutter at syllable rates (rowdy: faster, deeper, louder)
export function crowdBed( ctx, out, rowdy ) {

	const sources = [];
	const bands = [ [ 420, 1.3, 3.1 ], [ 1100, 1.6, 4.7 ], [ 700, 1.0, 2.3 ], [ 1900, 2, 6.2 ] ];
	bands.forEach( ( [ f, q, rate ], i ) => {

		const s = loopNoise( ctx, 'brown' ), bp = filterNode( ctx, 'bandpass', f, q ), g = gainNode( ctx, rowdy ? 0.5 : 0.4 - i * 0.05 );
		s.connect( bp );
		bp.connect( g );
		g.connect( out );
		lfo( ctx, rate * ( rowdy ? 1.7 : 1 ) * ( 0.9 + 0.2 * i / 4 ), rowdy ? 0.45 : 0.28, g.gain, sources );
		s.start( 0, Math.random() * 1.5 );
		sources.push( s );

	} );
	const room = loopNoise( ctx, 'brown' ), lp = filterNode( ctx, 'lowpass', 260, 0.5 ), rg = gainNode( ctx, 0.5 );
	room.connect( lp );
	lp.connect( rg );
	rg.connect( out );
	room.start( 0, Math.random() * 1.5 );
	sources.push( room );
	return { sources };

}

// surf on the caldera wall: a low roar swelling every nine seconds, a hiss on the crests
function cliffBed( ctx, out ) {

	const sources = [];
	const body = loopNoise( ctx, 'brown' ), lp = filterNode( ctx, 'lowpass', 650, 0.6 ), bg = gainNode( ctx, 0.55 );
	body.connect( lp );
	lp.connect( bg );
	bg.connect( out );
	lfo( ctx, 0.11, 0.45, bg.gain, sources );
	const hiss = loopNoise( ctx, 'white' ), hp = filterNode( ctx, 'highpass', 2600, 0.5 ), hg = gainNode( ctx, 0.12 );
	hiss.connect( hp );
	hp.connect( hg );
	hg.connect( out );
	lfo( ctx, 0.17, 0.1, hg.gain, sources );
	body.start( 0, Math.random() * 1.5 );
	hiss.start( 0, Math.random() * 1.5 );
	sources.push( body, hiss );
	return { sources };

}

// the Inverted Isles' waterfalls, falling the wrong way: a steady roar, spray, and a shimmer that sweeps upward
function fallsBed( ctx, out ) {

	const sources = [];
	const body = loopNoise( ctx, 'white' ), bp = filterNode( ctx, 'bandpass', 800, 0.5 ), bg = gainNode( ctx, 0.6 );
	body.connect( bp );
	bp.connect( bg );
	bg.connect( out );
	const spray = loopNoise( ctx, 'white' ), hp = filterNode( ctx, 'highpass', 3500, 0.6 ), sg = gainNode( ctx, 0.14 );
	spray.connect( hp );
	hp.connect( sg );
	sg.connect( out );
	// rising sweeps: a sawtooth lfo on a band-pass's frequency climbs, then drops back
	const shim = loopNoise( ctx, 'white' ), sbp = filterNode( ctx, 'bandpass', 1300, 3 ), shg = gainNode( ctx, 0.2 );
	shim.connect( sbp );
	sbp.connect( shg );
	shg.connect( out );
	const sw = ctx.createOscillator();
	sw.type = 'sawtooth';
	sw.frequency.value = 0.16;
	const swg = gainNode( ctx, 600 );
	sw.connect( swg );
	swg.connect( sbp.frequency );
	sw.start();
	sources.push( sw );
	lfo( ctx, 0.23, 0.2, shg.gain, sources );
	for ( const s of [ body, spray, shim ] ) {

		s.start( 0, Math.random() * 1.5 );
		sources.push( s );

	}

	return { sources };

}

// the apron: the windsock's cloth fluttering (level follows the bed), and a plane running up in the distance
function stripBed( ctx, out ) {

	const sources = [];
	const s = loopNoise( ctx, 'white' ), bp = filterNode( ctx, 'bandpass', 1800, 2.2 ), g = gainNode( ctx, 0.3 );
	s.connect( bp );
	bp.connect( g );
	g.connect( out );
	lfo( ctx, 6.5, 0.22, g.gain, sources );
	s.start( 0, Math.random() * 1.5 );
	sources.push( s );
	return { sources };

}

// a distant radial engine: two saw voices a hair apart (the beat), a sub and a wash; set( rpm ) tunes it
function engineBed( ctx, out ) {

	const sources = [];
	const lp = filterNode( ctx, 'lowpass', 420, 0.8, out );
	const voices = [ 1, 1.012, 0.5 ].map( ( r, i ) => {

		const o = ctx.createOscillator();
		o.type = i === 2 ? 'square' : 'sawtooth';
		o.frequency.value = 30 * r;
		const g = gainNode( ctx, i === 2 ? 0.2 : 0.4, lp );
		o.connect( g );
		o.start();
		sources.push( o );
		return { o, r };

	} );
	const w = loopNoise( ctx, 'white' ), wb = filterNode( ctx, 'bandpass', 600, 0.6 ), wg = gainNode( ctx, 0.12 );
	w.connect( wb );
	wb.connect( wg );
	wg.connect( out );
	w.start( 0, Math.random() * 1.5 );
	sources.push( w );
	return {
		sources,
		set( rpm, t ) {

			const f = ( 600 + 1600 * clamp( rpm, 0, 1 ) ) / 60 * 4.5 / 2;
			for ( const v of voices ) v.o.frequency.setTargetAtTime( f * v.r, t, 0.15 );
			lp.frequency.setTargetAtTime( 260 + 1500 * clamp( rpm, 0, 1 ), t, 0.2 );

		},
	};

}

// bed -> { source (key in sources()), peak (linear gain at level 1), cat, rowdy?, build }
const BEDS = {
	market: { src: 'market', peak: 0.2, build: ( c, o ) => crowdBed( c, o, false ) },
	tavern: { src: 'tavern', peak: 0.26, build: ( c, o ) => crowdBed( c, o, true ) },
	cliffs: { src: 'cliffs', peak: 0.3, build: cliffBed, wide: true },
	falls: { src: 'falls', peak: 0.26, build: fallsBed, wide: true },
	strip: { src: 'strip', peak: 0.05, build: stripBed },
	engine: { src: 'strip', peak: 0.13, build: engineBed, runup: true },
};

const IDLE_DROP = 8; // s a bed stays silent before its nodes are stopped

export class PlaceBeds {

	constructor( sfx ) {

		this.sfx = sfx;
		this.levels = {};
		this.beds = new Map(); // id -> { out, pan, api, sources, idle, at }
		this.hour = null;
		this.bellLeft = 0;
		this.bellT = 0;
		this.gullT = 4;
		this.hammerT = 6;
		this.hammerLeft = 0;
		this.hammerGap = 0;
		this.drumAcc = 0;
		this.drumStep = 0;
		this.shoutT = 5;
		this.birdT = 6;
		this.bells = 0;
		this.gulls = 0;
		this.hammers = 0;
		this.drums = 0;
		this.shouts = 0;
		this.birds = 0;
		this.runup = null;
		this.held = false;

	}

	get synth() {

		return this.sfx.synth;

	}

	// built loops (tests)
	bedNodes() {

		return [ ...this.beds.keys() ];

	}

	_feature( name ) {

		const f = this.sfx.features;
		return f && f.get ? f.get( name ) : null;

	}

	_folk() {

		const R = this.sfx.app.residents;
		if ( ! R || ! R.list ) return null;
		const out = [];
		for ( const r of R.list ) if ( r && r.data && r.data.port === 'tidemark' ) out.push( r );
		return out;

	}

	_wind() {

		const w = this._feature( 'weather' );
		return clamp( w && Number.isFinite( w.wind ) ? w.wind : 6, 0, 40 );

	}

	_held() {

		const s = this._feature( 'stronghold' );
		return !! ( s && s.holder === 'player' );

	}

	update( dt ) {

		const s = this.sfx, pl = s.player, app = s.app;
		if ( ! pl.ctx ) {

			this.levels = {};
			return;

		}

		const L = pl.listener(), hour = hourOf( app );
		this.runup = runupOf( s.features );
		this.held = this._held();
		const env = app.audio && app.audio.env;
		this.levels = bedWeights( L.x, L.z, hour, { wind: this._wind(), held: this.held, folk: this._folk(), runup: this.runup, surf: env ? env.surf : 0.6 } );
		this._bells( hour, dt );
		this._loops( L, dt );
		this._oneShots( L, hour, dt );
		this.hour = hour;

	}

	// ---- the loops: built when audible, stopped after a while of silence

	_loops( L, dt ) {

		const pl = this.sfx.player, ctx = pl.ctx;
		if ( typeof ctx.createOscillator !== 'function' || typeof ctx.createBufferSource !== 'function' ) return;
		const t = num( ctx.currentTime, 0 ), S = sources();
		for ( const id in BEDS ) {

			const def = BEDS[ id ], src = S[ def.src ];
			let level = this.levels[ id ] || 0;
			if ( ! src || ! pl.active ) level = 0;
			let bed = this.beds.get( id );
			if ( ! bed ) {

				if ( level < 0.012 ) continue;
				bed = this._build( id, def, ctx );
				if ( ! bed ) continue;

			}

			bed.idle = level < 0.004 ? bed.idle + dt : 0;
			if ( bed.idle > IDLE_DROP ) {

				this._drop( id, bed );
				continue;

			}

			bed.out.gain.setTargetAtTime( level * def.peak, t, 0.5 );
			if ( bed.api && bed.api.set ) bed.api.set( def.runup && this.runup ? this.runup.rpm : 0, t );
			if ( bed.pan && src ) this._place( bed, def, src, def.runup && this.runup ? this.runup : src, L );

		}

	}

	_build( id, def, ctx ) {

		try {

			const sink = this.sfx.player._sink( 'ambience' );
			if ( ! sink ) return null;
			const out = ctx.createGain();
			out.gain.value = 0;
			let pan = null;
			if ( ! def.wide && typeof ctx.createPanner === 'function' ) {

				pan = ctx.createPanner();
				pan.panningModel = 'HRTF';
				pan.distanceModel = 'inverse';
				pan.refDistance = 1;
				pan.rolloffFactor = 0; // the level is the bed's own fade
				pan.maxDistance = 10000;
				out.connect( pan );
				pan.connect( sink.node );

			} else out.connect( sink.node );

			const made = def.build( ctx, out );
			const bed = { out, pan, api: made, sources: made.sources, idle: 0, at: null };
			this.beds.set( id, bed );
			return bed;

		} catch ( e ) {

			return null;

		}

	}

	_drop( id, bed ) {

		for ( const s of bed.sources ) try { s.stop(); } catch ( e ) { /* not started */ }
		try { bed.out.disconnect(); if ( bed.pan ) bed.pan.disconnect(); } catch ( e ) { /* gone */ }
		this.beds.delete( id );

	}

	// the bed sounds from its place; inside the fade's core it surrounds the listener instead
	_place( bed, def, src, at, L ) {

		const d = Math.hypot( at.x - L.x, at.z - L.z ), k = smooth( src.inner, src.outer * 0.6, d );
		const x = lerp( L.x + 3, at.x, k ), z = lerp( L.z, at.z, k );
		if ( bed.at && Math.abs( bed.at.x - x ) < 0.5 && Math.abs( bed.at.z - z ) < 0.5 ) return;
		bed.at = { x, z };
		const p = bed.pan;
		if ( p.positionX ) {

			p.positionX.value = x;
			p.positionY.value = L.y;
			p.positionZ.value = z;

		} else if ( p.setPosition ) p.setPosition( x, L.y, z );

	}

	// ---- the bell on the hour

	_bells( hour, dt ) {

		if ( this.hour !== null ) {

			const n = bellStrikes( this.hour, hour );
			if ( n > 0 ) {

				this.bellLeft = n;
				this.bellT = 0;

			}

		}

		if ( this.bellLeft <= 0 ) return;
		this.bellT -= dt;
		if ( this.bellT > 0 ) return;
		const c = sources().chapel;
		if ( ! c ) { this.bellLeft = 0; return; }
		this.bellLeft --;
		this.bellT = 2.6;
		this.bells ++;
		this.synth.play( 'chapel_bell', { at: { x: c.x, y: 14, z: c.z } } );

	}

	// ---- timers: gulls, hammering, drums, shouts, birds

	_oneShots( L, hour, dt ) {

		const S = sources(), lv = this.levels, play = ( n, o ) => this.synth.play( n, o );
		const scatter = ( p, r, y ) => {

			const a = Math.random() * Math.PI * 2, d = Math.sqrt( Math.random() ) * r;
			return { x: p.x + Math.cos( a ) * d, y, z: p.z + Math.sin( a ) * d };

		};

		// gulls over the quay
		if ( lv.gulls > 0.04 && S.gulls ) {

			this.gullT -= dt;
			if ( this.gullT <= 0 ) {

				this.gullT = 4 + Math.random() * 9;
				if ( play( 'gull', { at: scatter( S.gulls, 45, 9 + Math.random() * 8 ) } ) ) this.gulls ++;

			}

		}

		// hammering: a run of blows, a pause
		if ( lv.yard > 0.04 && S.yard ) {

			if ( this.hammerLeft > 0 ) {

				this.hammerGap -= dt;
				if ( this.hammerGap <= 0 ) {

					this.hammerLeft --;
					this.hammerGap = 0.42 + Math.random() * 0.16;
					if ( play( 'hammer', { at: { x: S.yard.x, y: 2, z: S.yard.z } } ) ) this.hammers ++;

				}

			} else {

				this.hammerT -= dt;
				if ( this.hammerT <= 0 ) {

					this.hammerT = 7 + Math.random() * 12;
					this.hammerLeft = 3 + Math.floor( Math.random() * 4 );
					this.hammerGap = 0;

				}

			}

		}

		// the town's drums at night: an eighth-note pattern in six, a fill every other bar
		if ( lv.drums > 0.04 && S.drums ) {

			this.drumAcc += dt;
			const step = 60 / 104 / 2;
			while ( this.drumAcc >= step ) {

				this.drumAcc -= step;
				const i = this.drumStep ++ % 16, p = DRUM_PATTERN[ i ];
				// once the player holds the island only a lone drum keeps time, softly
				if ( p && ( ! this.held || i % 8 === 0 ) ) {

					const v = play( 'drum', { at: { x: S.drums.x, y: 3, z: S.drums.z }, gain: ( p === 2 ? 0.6 : 1 ) * ( this.held ? 0.4 : 1 ), kind: p === 2 ? 'high' : 'low' } );
					if ( v ) this.drums ++;

				}

			}

		} else this.drumAcc = 0;

		// the Rum Hole turns rowdy
		if ( lv.tavern > 0.05 && S.tavern ) {

			this.shoutT -= dt;
			if ( this.shoutT <= 0 ) {

				this.shoutT = ( 3 + Math.random() * 6 ) / ( 0.4 + nightness( hour ) );
				if ( play( 'tavern_shout', { at: { x: S.tavern.x, y: 2, z: S.tavern.z } } ) ) this.shouts ++;

			}

		}

		// parrots in the trees by day, a frigatebird over the cliffs now and then
		if ( lv.birds > 0.05 && S.birds ) {

			this.birdT -= dt;
			if ( this.birdT <= 0 ) {

				this.birdT = 5 + Math.random() * 10;
				const frigate = Math.random() < 0.3;
				const ring = frigate ? S.birds.inner + 30 : S.birds.inner * 0.7;
				if ( play( frigate ? 'frigate' : 'parrot', { at: scatter( S.birds, ring, frigate ? 40 : 10 ) } ) ) this.birds ++;

			}

		}

	}

	reset() {

		this.bellLeft = 0;
		this.hammerLeft = 0;
		this.hour = null;

	}

	dispose() {

		for ( const [ id, bed ] of [ ...this.beds ] ) this._drop( id, bed );

	}

}

// 1 low thump, 2 high tap, 0 rest: sixteen eighth notes (two bars) of a marching pirate beat
export const DRUM_PATTERN = [ 1, 0, 2, 0, 1, 0, 2, 2, 1, 0, 2, 0, 1, 2, 2, 1 ];
