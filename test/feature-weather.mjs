// Plain-node test of the weather feature (src/features/weather): the deterministic schedule, the eased
// transitions, bounded storms, the Sandbox-only manual pick, the weatherChanged event, the bite modifier, the
// multiplayer clock agreement, lightning / exposure, the world parameters, the rain effect, the synthesised audio
// (a stand-in AudioContext) and the HUD chip (a stand-in DOM). No GPU, no browser.
// usage: node test/feature-weather.mjs
globalThis.location = globalThis.location || { search: '' };
const { Features } = await import( '../src/features/Features.js' );
const wx = await import( '../src/features/weather/index.js' );
const { scheduleAt, stormWindow, nextStorm, transitionSeconds, dirOffset, hash, KINDS, PRE, AFTER } = await import( '../src/features/weather/Schedule.js' );
const { climate } = await import( '../src/features/weather/Climate.js' );
const { FISH_IDS } = await import( '../src/game/FishTable.js' );
const { Vector3 } = await import( '../src/engine/index.js' );
const { G } = await import( '../src/core/Globals.js' );

// the entries of days 1-4, every 4 h at :30 (first letters): change it only when the schedule is changed on purpose
const GOLDEN = 'cccrrbcbooorocrcorbobbob';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const near = ( a, b, e = 1e-6 ) => Math.abs( a - b ) <= e;

// ---------------------------------------------------------------------------------------------- stand-ins

function makeApp( mode = 'sandbox', extra = {} ) {

	return {
		mode, rules: { serverClock: false },
		settings: { timeOfDay: 9.5, timeSpeed: 0.01, exposure: 0.55 },
		fft: {
			local: { windSpeed: 7, windDirection: 25, fetch: 120 }, swell: { scale: 0.48 },
			choppiness: { value: 0.9 }, foamBias: { value: 0.6 }, foamDecay: { value: 0.5 },
			updateSpectrumUniforms() { this.spectrumCalls = ( this.spectrumCalls || 0 ) + 1; },
		},
		shore: { amplitude: { value: 0.34 }, period: { value: 9 } },
		clouds: { coverage: { value: 0.45 }, cirrus: { value: 0.5 } },
		haze: { density: { value: 1 }, shafts: { value: 1 } },
		scene: { children: [], add( o ) { this.children.push( o ); }, remove() {} },
		camera: { position: new Vector3( 0, 2, 0 ) },
		cameraWaterHeight: 0,
		audio: null, qs: new URLSearchParams( '' ),
		...extra,
	};

}

function make( mode = 'sandbox', extra = {}, opts = {} ) {

	const app = makeApp( mode, extra );
	let seed = 12345;
	const rng = () => ( seed = ( Math.imul( seed, 1664525 ) + 1013904223 ) >>> 0 ) / 4294967296;
	const features = new Features( app );
	const w = features.add( 'weather', { install: ( a, f ) => new wx.Weather( a, f, { rng, ...opts } ) } );
	return { app, features, w };

}

// put the weather at absolute island time (day, hour) without going through the clock's wrap detection
function setTime( { app, w }, day, hour ) {

	w.day = day;
	w._lastHour = hour;
	app.settings.timeOfDay = hour;

}

function run( ctx, seconds, dt = 0.1 ) {

	const n = Math.round( seconds / dt );
	for ( let i = 0; i < n; i ++ ) ctx.w.update( dt );

}

// two times a little apart whose entries are different kinds (neither a storm): { t1, t2, a, b }
function findChange() {

	for ( let t = 48; t < 2400; t += 0.5 ) {

		const t1 = t - 0.25, t2 = t + 0.75;
		const a = scheduleAt( t1 ), b = scheduleAt( t2 );
		if ( a.id !== b.id && a.kind !== b.kind && a.kind !== 'storm' && b.kind !== 'storm' && Math.abs( a.intensity - b.intensity ) > 0.2 ) return { t1, t2, a, b };

	}

	return null;

}

function makeAudio( { bare = false } = {} ) {

	class Param {

		constructor( v = 0 ) { this.value = v; this.calls = []; }
		setValueAtTime( v, t ) { this.calls.push( [ 'set', v, t ] ); this.value = v; return this; }
		linearRampToValueAtTime( v, t ) { this.calls.push( [ 'lin', v, t ] ); return this; }
		exponentialRampToValueAtTime( v, t ) { this.calls.push( [ 'exp', v, t ] ); return this; }
		setTargetAtTime( v, t ) { this.calls.push( [ 'target', v, t ] ); this.value = v; return this; }

	}

	const starts = [];
	const created = [];
	class Node {

		constructor( kind ) {

			this.kind = kind;
			this.gain = new Param( 1 );
			this.frequency = new Param( 350 );
			this.Q = new Param( 1 );
			this.loop = false;
			created.push( this );

		}

		connect( n ) { this.connectedTo = n; return n; }
		disconnect() { this.disconnected = true; }
		start( at = 0, offset = 0 ) { this.started = true; starts.push( { node: this, at, offset } ); }
		stop() { this.stopped = true; }

	}

	const ctx = {
		currentTime: 1, sampleRate: 8000, state: 'running', destination: { destination: true },
		createGain: () => new Node( 'gain' ),
		createBiquadFilter: () => new Node( 'filter' ),
		createOscillator: () => new Node( 'osc' ),
		createBufferSource: () => new Node( 'bufferSource' ),
		createBuffer: ( ch, n, sr ) => ( { length: n, duration: n / sr, getChannelData: () => new Float32Array( n ) } ),
	};
	const ambAbove = new Node( 'gain' );
	const audio = bare ? { ctx, muted: false, volume: 0.8 } : { ctx, ambAbove, master: new Node( 'gain' ), muted: false, volume: 0.8 };
	return { ctx, audio, starts, created };

}

let savedDocument;
function installDom() {

	class El {

		constructor( tag ) { this.tag = tag; this.className = ''; this.children = []; this.textContent = ''; this._html = ''; this.id = ''; this.offsetWidth = 1; this.parent = null; }
		get classList() {

			const self = this;
			return {
				toggle( c, on ) { const set = new Set( self.className.split( /\s+/ ).filter( Boolean ) ); if ( on ) set.add( c ); else set.delete( c ); self.className = [ ...set ].join( ' ' ); },
				add( c ) { this.toggle( c, true ); },
				remove( c ) { this.toggle( c, false ); },
			};

		}

		set innerHTML( h ) {

			this._html = h;
			if ( h.includes( 'wx-ico' ) ) this.children = [ 'ico', 'name', 'sub' ].map( ( n ) => { const e = new El( 'span' ); e.className = 'wx-' + n; e.parent = this; return e; } );

		}

		get innerHTML() { return this._html; }
		setAttribute() {}
		append( ...n ) { for ( const x of n ) { this.children.push( x ); x.parent = this; } }
		remove() { if ( this.parent ) this.parent.children = this.parent.children.filter( ( c ) => c !== this ); this.parent = null; }
		querySelector( sel ) { const cls = sel.slice( 1 ); return this.children.find( ( c ) => c.className.split( /\s+/ ).includes( cls ) ) || null; }
		closest( sel ) { return sel === '.tw-tl' ? host : null; }
		text() { return this.children.map( ( c ) => c.textContent ).join( ' ' ); }

	}

	const host = new El( 'div' );
	host.className = 'tw-tl';
	const mode = new El( 'div' );
	const styles = [];
	savedDocument = globalThis.document;
	globalThis.document = {
		createElement: ( t ) => new El( t ),
		getElementById: ( id ) => styles.find( ( s ) => s.id === id ) || null,
		querySelector: ( sel ) => ( sel === '.tw-tl' ? host : null ),
		head: { append: ( s ) => styles.push( s ) },
	};
	return { host, mode, styles };

}

function uninstallDom() {

	if ( savedDocument === undefined ) delete globalThis.document;
	else globalThis.document = savedDocument;

}

// ---------------------------------------------------------------------------------------------- module shape
{

	const { app, features, w } = make( 'sandbox' );
	ok( typeof wx.install === 'function' && typeof wx.default.install === 'function', 'the module exports install( app, features )' );
	ok( w && w === features.get( 'weather' ), 'features.add returns the instance' );
	ok( [ 'update', 'dispose', 'toJSON', 'fromJSON', 'reset', 'biteModifier', 'setManual' ].every( ( k ) => typeof w[ k ] === 'function' ), 'update / dispose / toJSON / fromJSON / reset / biteModifier / setManual' );
	ok( app.scene.children.length === 2 && app.scene.children[ 0 ].name === 'Rain' && app.scene.children[ 1 ].name === 'StormFront', 'the rain mesh and the storm front are added to the scene' );
	w.update( 1 / 60 );
	const c = w.current;
	ok( KINDS.includes( c.kind ) && c.intensity >= 0 && c.intensity <= 1 && c.wind > 0, 'current: { kind, intensity 0..1, wind m/s }' );
	ok( w.danger >= 0 && w.danger <= 1, 'danger is 0..1' );
	const real = wx.install( makeApp( 'campaign' ), null );
	ok( real instanceof wx.Weather, 'install( app, features ) returns the instance' );
	real.dispose();
	// no parts at all: must still run
	const bare = new wx.Weather( { settings: { timeOfDay: 8, timeSpeed: 0.01 } }, null );
	for ( let i = 0; i < 100; i ++ ) bare.update( 0.1 );
	ok( bare.current.kind, 'runs with no fft / shore / clouds / haze / scene / features (headless stub)' );
	bare.dispose();
	const empty = new wx.Weather( {}, null );
	empty.update( 0.1 );
	empty.update( NaN );
	empty.dispose();
	ok( true, 'an empty app and a NaN dt do not throw' );
	w.dispose();
	ok( true, 'dispose does not throw' );

}

// ---------------------------------------------------------------------------------------------- the schedule is a function of (day, hour)
{

	let same = true;
	for ( let d = 1; d < 60; d ++ ) for ( let h = 0; h < 24; h += 0.37 ) {

		const t = d * 24 + h, a = scheduleAt( t ), b = scheduleAt( t );
		if ( a.kind !== b.kind || a.intensity !== b.intensity || a.id !== b.id ) same = false;

	}

	ok( same, 'the schedule gives the same entry for the same (day, hour), every time' );
	let golden = '';
	for ( let t = 24; t < 24 * 5; t += 4 ) golden += scheduleAt( t + 0.5 ).kind[ 0 ];
	ok( golden === GOLDEN, `the schedule is stable across releases (${ golden })` );
	ok( hash( 5, 6, 7 ) === hash( 5, 6, 7 ) && hash( 5, 6, 7 ) !== hash( 6, 5, 7 ) && hash( 1 ) >= 0 && hash( 1 ) < 1, 'the seeded hash is pure, order sensitive and in [0, 1)' );
	const bins = new Array( 10 ).fill( 0 );
	for ( let i = 0; i < 50000; i ++ ) bins[ Math.floor( hash( i, 3 ) * 10 ) ] ++;
	ok( bins.every( ( n ) => n > 4600 && n < 5400 ), 'the hash is uniform' );
	const t0 = scheduleAt( 24 * 7 + 5 );
	ok( t0.start <= 24 * 7 + 5 && t0.end > 24 * 7 + 5 && t0.intensity >= 0.25 && t0.intensity <= 1, 'an entry covers its own time with an intensity in range' );
	ok( scheduleAt( 5 ).kind === 'clear' && scheduleAt( 11 ).kind === 'breezy', 'a new game (day 0) starts on a fair morning' );
	let d0 = true;
	for ( let t = 0; t < 24; t += 0.1 ) if ( scheduleAt( t ).kind === 'storm' ) d0 = false;
	ok( d0 && stormWindow( 0 ) === null && stormWindow( - 3 ) === null, 'no storm on the first day' );
	let inRange = true;
	for ( let i = 0; i < 400; i ++ ) { const s = transitionSeconds( 'b' + i ); if ( s < 120 || s > 240 ) inRange = false; }
	ok( inRange && transitionSeconds( 's9' ) >= 120, 'every transition (400 ids) takes 120-240 s' );

}

// ---------------------------------------------------------------------------------------------- storms are rare, short and bounded
{

	const WEEKS = 120, step = 0.25;
	let worst = 0, total = 0, maxLen = 0, bad = 0, backToBack = 0, lastStormDay = - 10;
	const kindsSeen = new Set(), perKind = {};
	for ( let day = 0; day < WEEKS * 7 + 8; day ++ ) {

		const sw = stormWindow( day );
		if ( ! sw ) continue;
		maxLen = Math.max( maxLen, sw.end - sw.start );
		if ( day - lastStormDay === 1 ) backToBack ++;
		lastStormDay = day;
		if ( sw.start < PRE - 1e-9 || sw.end + AFTER > 24 + 1e-9 ) bad ++; // the build-up and the clear-up stay inside the day

	}

	for ( let wk = 0; wk < WEEKS; wk ++ ) {

		let c = 0;
		for ( let i = 0; i < 7 * 24 / step; i ++ ) {

			const t = ( wk * 7 + 1 ) * 24 + i * step; // (offset by a day: day 0 is the quiet start)
			const e = scheduleAt( t );
			if ( e.kind === 'storm' ) { c ++; total ++; }
			kindsSeen.add( e.kind );
			perKind[ e.kind ] = ( perKind[ e.kind ] || 0 ) + 1;
			if ( e.kind === 'fog' && ( t % 24 < 4 || t % 24 >= 8 ) ) bad ++;

		}

		worst = Math.max( worst, c * step / ( 7 * 24 ) );

	}

	const share = total * step / ( WEEKS * 7 * 24 );
	ok( worst < 0.15, `storms fill less than 15% of every simulated week (worst ${ ( worst * 100 ).toFixed( 1 ) }%)` );
	ok( share > 0.005 && share < 0.08, `storms are rare overall (${ ( share * 100 ).toFixed( 2 ) }% of ${ WEEKS } weeks)` );
	ok( maxLen <= 4.5 + 1e-9 && maxLen >= 3, `a storm lasts at most 4.5 h (longest ${ maxLen.toFixed( 2 ) } h)` );
	ok( backToBack === 0, 'never a storm on two days running' );
	ok( bad === 0, 'fog only in the 04:00-08:00 slot; the storm build-up and clear-up stay inside the day' );
	ok( KINDS.every( ( k ) => kindsSeen.has( k ) ), 'all six kinds occur: ' + KINDS.map( ( k ) => `${ k } ${ ( ( perKind[ k ] || 0 ) * step / ( WEEKS * 7 * 24 ) * 100 ).toFixed( 1 ) }%` ).join( ', ' ) );
	let day = 1;
	while ( ! stormWindow( day ) ) day ++;
	const sw = stormWindow( day ), t0 = day * 24 + sw.start;
	ok( scheduleAt( t0 - 0.1 ).kind === 'rain' && scheduleAt( t0 - 0.1 ).front && scheduleAt( t0 + 0.1 ).kind === 'storm' && scheduleAt( day * 24 + sw.end + 0.1 ).kind === 'clear', 'rain builds before a storm, clear sky follows it' );
	ok( near( nextStorm( t0 - 1 ), t0, 1e-9 ) && nextStorm( t0 + 0.1 ) !== t0 && nextStorm( t0 - 30, 12 ) !== t0, 'nextStorm finds the next start within the horizon' );

}

// ---------------------------------------------------------------------------------------------- transitions ease
{

	const ch = findChange();
	ok( ch !== null, 'found two neighbouring entries of different kinds to test with' );
	const ctx = make( 'campaign' );
	const { app, w } = ctx;
	app.settings.timeSpeed = 0; // hold the clock: the test moves it by hand
	const day1 = Math.floor( ch.t1 / 24 );
	setTime( ctx, day1, ch.t1 - day1 * 24 );
	run( ctx, 8 ); // the world is still being set up: the first target is taken at once
	const toA = climate( ch.a.kind, ch.a.intensity, 0 );
	ok( near( app.fft.local.windSpeed, toA.wind, 1e-6 ) && near( app.clouds.coverage.value, toA.clouds, 1e-6 ), `the first weather (${ ch.a.kind }) is applied at once, not eased in from the engine defaults` );
	ok( w.current.kind === ch.a.kind && w.current.transition === 1, 'current.kind follows the schedule' );
	const kindBefore = w.current.kind;
	// the clock reaches the next entry
	setTime( ctx, day1, ch.t2 - day1 * 24 );
	const events = [];
	ctx.features.on( 'weatherChanged', ( e ) => events.push( e ) );
	const w0 = app.fft.local.windSpeed;
	const toB = climate( ch.b.kind, ch.b.intensity, 0 );
	const series = [];
	let secs = 0, doneAt = null;
	const dt = 1 / 30;
	for ( let i = 0; i < 30 * 300; i ++ ) {

		w.update( dt );
		secs += dt;
		series.push( [ app.fft.local.windSpeed, app.clouds.coverage.value, w.current.transition ] );
		if ( doneAt === null && w.current.transition >= 1 ) doneAt = secs;

	}

	const expect = transitionSeconds( scheduleAt( ch.t2 ).id );
	ok( doneAt !== null && doneAt >= 120 - 0.1 && doneAt <= 240 + 0.1 && Math.abs( doneAt - expect ) < 0.2, `the transition to ${ ch.b.kind } takes ${ doneAt && doneAt.toFixed( 1 ) } s (2-4 min; this entry's own duration is ${ expect.toFixed( 1 ) } s)` );
	const range = toB.wind - w0;
	ok( series[ 0 ][ 2 ] < 0.01 && Math.abs( series[ 0 ][ 0 ] - w0 ) < 0.01 * Math.abs( range ) + 1e-3, 'no jump at the start of a transition' );
	let maxStep = 0, monotone = true, prev = w0;
	for ( const s of series ) {

		maxStep = Math.max( maxStep, Math.abs( s[ 0 ] - prev ) );
		if ( ( s[ 0 ] - prev ) * range < - 1e-9 ) monotone = false;
		prev = s[ 0 ];

	}

	const bound = Math.abs( range ) * 1.6 / ( 120 / dt ) + 1e-6; // smoothstep: slope at most 1.5 / duration
	ok( monotone && maxStep <= bound, `wind eases monotonically (${ w0.toFixed( 2 ) } -> ${ toB.wind.toFixed( 2 ) } m/s, largest step ${ maxStep.toExponential( 2 ) } <= ${ bound.toExponential( 2 ) })` );
	const mid = series[ Math.floor( doneAt / dt / 2 ) ][ 0 ];
	ok( Math.abs( mid - ( w0 + toB.wind ) / 2 ) < Math.abs( range ) * 0.05, 'half way through, the wind is half way' );
	ok( near( app.fft.local.windSpeed, toB.wind, 1e-6 ) && near( app.clouds.coverage.value, toB.clouds, 1e-6 ) && near( app.haze.density.value, toB.haze, 1e-6 ) && near( app.shore.amplitude.value, toB.surf, 1e-6 ) && near( app.fft.choppiness.value, toB.chop, 1e-6 ), 'the world ends on the new state (wind, clouds, haze, surf, choppiness)' );
	ok( near( G.windSpeed.value, toB.wind, 1e-6 ) && near( G.windDir.value.length(), 1, 1e-6 ), 'G.windSpeed and G.windDir follow (unit direction)' );
	ok( near( app.fft.local.windDirection, 25 + dirOffset( scheduleAt( ch.t2 ).id, ch.b.kind ), 1e-6 ), 'the wind direction turns (about the world\'s own 25 degrees)' );
	ok( app.fft.spectrumCalls > 0 && app.fft.spectrumCalls <= 300 * 2 + 4, `the wave spectrum is rebuilt at most twice a second (${ app.fft.spectrumCalls } times in 300 s)` );
	ok( events.length === 1 && events[ 0 ].kind === ch.b.kind && events[ 0 ].previous === kindBefore && near( events[ 0 ].intensity, ch.b.intensity ), 'one weatherChanged { kind, previous, intensity } for the change' );
	ok( near( w.current.intensity, ch.b.intensity, 1e-6 ), 'current.intensity eased to the new entry\'s intensity' );
	// retargeting in mid-transition continues from where the world is (no jump)
	setTime( ctx, day1, ch.t1 - day1 * 24 );
	w.update( 0.1 );
	const mark = app.fft.local.windSpeed;
	run( ctx, 20 );
	ok( Math.abs( app.fft.local.windSpeed - mark ) < Math.abs( toB.wind - toA.wind ) * 0.2 + 1e-6, 'a new target in mid-air starts from the current values' );

}

// ---------------------------------------------------------------------------------------------- the event: one per change of kind
{

	const ctx = make( 'campaign' );
	const { app, features, w } = ctx;
	const events = [];
	features.on( 'weatherChanged', ( e ) => events.push( e ) );
	app.settings.timeSpeed = 0.01;
	app.settings.timeOfDay = 9.5;
	const seen = [];
	let last = null;
	const dt = 0.25;
	for ( let s = 0; s < 10 * 24 * 100; s += dt ) { // ten days at 100 s per island hour

		app.settings.timeOfDay = ( app.settings.timeOfDay + dt * 0.01 ) % 24;
		w.update( dt );
		if ( w.current.kind !== last ) { seen.push( w.current.kind ); last = w.current.kind; }

	}

	ok( events.length === seen.length - 1 && events.length > 10, `a weatherChanged for every change of kind (${ events.length } over ten simulated days)` );
	let chain = true;
	for ( let i = 0; i < events.length; i ++ ) if ( events[ i ].kind !== seen[ i + 1 ] || events[ i ].previous !== seen[ i ] || events[ i ].kind === events[ i ].previous || ! KINDS.includes( events[ i ].kind ) || ! ( events[ i ].intensity >= 0.25 && events[ i ].intensity <= 1 ) ) chain = false;
	ok( chain, 'each event: kind, previous (the one before) and an intensity of 0.25-1; never a change to the same kind' );
	ok( w.day >= 9, `the day counter follows the clock (day ${ w.day })` );
	ok( events.some( ( e ) => e.kind === 'storm' ), 'a storm turned up in the ten days' );

}

// ---------------------------------------------------------------------------------------------- the manual pick: Sandbox only
{

	const camp = make( 'campaign' );
	setTime( camp, 20, 12 );
	camp.app.settings.timeSpeed = 0;
	run( camp, 8 );
	const kind0 = camp.w.current.kind;
	ok( camp.w.setManual( 'storm' ) === false && camp.w.manual === null && camp.w.setManual( null ) === false, 'campaign: setManual is refused' );
	run( camp, 60 );
	ok( camp.w.current.kind === kind0, 'campaign: the weather stays automatic' );
	const mp = make( 'multiplayer' );
	ok( mp.w.setManual( 'rain' ) === false, 'multiplayer: setManual is refused' );
	const nof = new wx.Weather( makeApp( 'sandbox' ), null );
	ok( nof.setManual( 'rain' ) === false, 'without the features registry there is no sandbox to ask: refused' );

	const sb = make( 'sandbox' );
	setTime( sb, 20, 12 );
	sb.app.settings.timeSpeed = 0;
	run( sb, 8 );
	const scheduled = sb.w.current.kind;
	ok( sb.w.setManual( 'sparkles' ) === false && sb.w.manual === null, 'sandbox: an unknown kind is refused' );
	ok( sb.w.setManual( 'storm' ) === true && sb.w.manual.kind === 'storm', 'sandbox: the owner can pick a storm' );
	const events = [];
	sb.features.on( 'weatherChanged', ( e ) => events.push( e ) );
	run( sb, 40 );
	ok( sb.w.current.kind === 'storm' && sb.w.current.manual === true && events.length === 1 && events[ 0 ].previous === scheduled && scheduled !== 'storm', 'the pick takes over (event fired, current.manual)' );
	ok( sb.w.danger > 0.8 && sb.app.fft.local.windSpeed > 16 && sb.w.biteModifier() < 0.75, `a picked storm is a storm (danger ${ sb.w.danger.toFixed( 2 ) }, wind ${ sb.app.fft.local.windSpeed.toFixed( 1 ) } m/s, bite x${ sb.w.biteModifier().toFixed( 2 ) })` );
	ok( sb.w.setManual( 'fog', 0.5 ) === true && sb.w.manual.intensity === 0.5, 'a pick can carry an intensity' );
	ok( sb.w.setManual( null ) === true && sb.w.manual === null, 'null releases the weather' );
	run( sb, 40 );
	ok( sb.w.current.kind === scheduled && sb.w.current.manual === false, 'released: back on the schedule' );
	sb.w.setManual( 'rain', 0.7 );
	const json = JSON.parse( JSON.stringify( sb.features.toJSON() ) );
	ok( json.weather && json.weather.manual === 'rain' && near( json.weather.intensity, 0.7 ), 'toJSON keeps the manual pick' );
	const camp2 = make( 'campaign' );
	camp2.features.fromJSON( json );
	ok( camp2.w.manual && camp2.w.manual.kind === 'rain' && camp2.w._manualActive() === null, 'a saved pick is held but has no effect outside the Sandbox' );
	const sb2 = make( 'sandbox' );
	sb2.features.fromJSON( json );
	sb2.w.update( 0.1 );
	ok( sb2.w.current.kind === 'rain' && sb2.w.current.manual, 'fromJSON restores the pick in the Sandbox' );
	sb2.w.fromJSON( null );
	sb2.w.fromJSON( 5 );
	sb2.w.fromJSON( { manual: 'lava', day: 'x', intensity: 'y' } );
	ok( sb2.w.manual === null, 'garbage in fromJSON is ignored' );
	sb2.w.setManual( 'fog' );
	sb2.w.reset();
	ok( sb2.w.manual === null && sb2.w.day === 0, 'reset clears the pick and the day' );

}

// ---------------------------------------------------------------------------------------------- bite modifier
{

	const sb = make( 'sandbox' );
	let lo = 9, hi = 0;
	const by = {};
	for ( const kind of KINDS ) for ( const i of [ 0, 0.1, 0.5, 0.8, 1 ] ) {

		sb.w.cur = climate( kind, i, 0 );
		for ( const id of [ undefined, ...FISH_IDS ] ) {

			const m = sb.w.biteModifier( id );
			lo = Math.min( lo, m );
			hi = Math.max( hi, m );

		}

		if ( i === 0.8 ) by[ kind ] = sb.w.biteModifier();

	}

	ok( lo >= 0.5 && hi <= 1.4, `biteModifier stays in 0.5 .. 1.4 for every kind, intensity and species (${ lo.toFixed( 2 ) } .. ${ hi.toFixed( 2 ) })` );
	ok( by.storm <= 0.7 && by.storm >= 0.5, `a storm cuts bites by about 40% (x${ by.storm.toFixed( 2 ) })` );
	ok( by.overcast >= 1.1 && by.overcast <= 1.3, `overcast adds about 20% (x${ by.overcast.toFixed( 2 ) })` );
	sb.w.cur = climate( 'rain', 0.2, 0 );
	ok( sb.w.biteModifier() > 1.1 && sb.w.biteModifier() < 1.3, `light rain adds about 20% (x${ sb.w.biteModifier().toFixed( 2 ) })` );
	sb.w.cur = climate( 'rain', 1, 0 );
	ok( sb.w.biteModifier() < 1.0, 'a downpour does not' );
	sb.w.cur = climate( 'clear', 0.5, 0 );
	ok( near( sb.w.biteModifier(), 1, 0.01 ), 'clear weather leaves the bites alone' );
	sb.w.cur = climate( 'storm', 1, 0 );
	ok( sb.w.biteModifier( 'silverside' ) < sb.w.biteModifier( 'tarpon' ), 'small shallow fish feel a storm more than a hard-fighting tarpon' );
	ok( sb.w.biteModifier( { id: 'tarpon' } ) === sb.w.biteModifier( 'tarpon' ) && sb.w.biteModifier( 'no-such-fish' ) === sb.w.biteModifier(), 'species may be an id, an entry or unknown' );

}

// ---------------------------------------------------------------------------------------------- multiplayer: clients with the shared clock agree
{

	// a stand-in server room (server/index.mjs): clock() = { timeOfDay mod 24 (to 1e-4), timeSpeed, at }
	const room = { start: 9.5, speed: 0.01, at: 1767225600000 + 123456 };
	const clock = ( t ) => ( { timeOfDay: Math.round( ( ( room.start + ( t - room.at ) / 1000 * room.speed ) % 24 + 24 ) % 24 * 1e4 ) / 1e4, timeSpeed: room.speed, at: t } );
	let now = room.at + 3 * 3600 * 1000 + 777;
	const client = ( joinedAt, skewMs ) => {

		const ctx = make( 'multiplayer', {}, { now: () => now + skewMs } );
		ctx.app.rules = { serverClock: true };
		ctx.app.net = { online: true, clock: clock( joinedAt ) };
		return ctx;

	};

	const a = client( now - 5000, 0 ), b = client( now - 9 * 60 * 1000, 0 ), c = client( now - 200000, 400 );
	let agree = true, n = 0, compared = 0;
	const kinds = new Set();
	for ( let i = 0; i < 4000; i ++ ) {

		now += 37 * 1000; // 37 s steps: about 40 island days
		// the server resends its clock every 10 s: each client has its own latest message
		a.app.net.clock = clock( now - 3000 );
		if ( i % 3 === 0 ) b.app.net.clock = clock( now - 8000 );
		if ( i % 5 === 0 ) c.app.net.clock = clock( now - 1000 + 400 );
		for ( const x of [ a, b, c ] ) x.w.update( 0.05 );
		if ( Math.abs( a.w.hours - b.w.hours ) > 0.01 || Math.abs( a.w.hours - c.w.hours ) > 0.01 ) agree = false;
		const ea = scheduleAt( a.w.hours );
		if ( Math.min( a.w.hours - ea.start, ea.end - a.w.hours ) > 0.02 ) { // (not right at an entry boundary)

			compared ++;
			if ( scheduleAt( b.w.hours ).id !== ea.id || scheduleAt( c.w.hours ).id !== ea.id ) agree = false;

		}

		kinds.add( ea.kind );
		n ++;

	}

	ok( agree && compared > 3900, `three clients (different join times, one with a skewed clock) compute the same island time and weather entry over ${ n } samples` );
	ok( kinds.size >= 5, `the shared schedule varies (${ [ ...kinds ].join( ', ' ) })` );
	// the day is the server's, not a local count
	ok( a.w.hours > 1e5 && Math.floor( a.w.hours / 24 ) === Math.floor( b.w.hours / 24 ), 'the day number comes from the shared clock' );
	// a client switching from its local clock to the server's takes the weather at once
	const solo = make( 'multiplayer', {}, { now: () => now } );
	solo.app.settings.timeSpeed = 0;
	run( solo, 8 );
	solo.app.rules = { serverClock: true };
	solo.app.net = { online: true, clock: clock( now ) };
	solo.w.update( 0.1 );
	ok( solo.w.current.kind === scheduleAt( solo.w.hours ).kind && solo.w.current.transition === 1, 'switching to the server clock snaps to the shared weather' );

}

// ---------------------------------------------------------------------------------------------- the sandbox panel keeps its sliders
{

	const sb = make( 'sandbox' );
	sb.app.settings.timeSpeed = 0;
	setTime( sb, 3, 10 );
	run( sb, 8 );
	sb.app.fft.choppiness.value = 1.5; // the player drags the slider
	run( sb, 5 );
	ok( sb.app.fft.choppiness.value === 1.5, 'sandbox: a slider the player moved is left alone' );
	const camp = make( 'campaign' );
	camp.app.settings.timeSpeed = 0;
	setTime( camp, 3, 10 );
	run( camp, 8 );
	const c0 = camp.app.fft.choppiness.value;
	camp.app.fft.choppiness.value = 1.5;
	run( camp, 1 );
	ok( near( camp.app.fft.choppiness.value, c0, 1e-9 ), 'campaign: the weather always wins (the panel is locked there)' );
	sb.w.setManual( 'rain' );
	run( sb, 40 );
	ok( sb.app.fft.choppiness.value !== 1.5 && near( sb.app.fft.choppiness.value, climate( 'rain', 0.6, 0 ).chop, 1e-6 ), 'a new weather takes the slider back' );

}

// ---------------------------------------------------------------------------------------------- lightning, thunder, exposure
{

	const aud = makeAudio();
	const sb = make( 'sandbox', { audio: aud.audio } );
	sb.app.settings.timeSpeed = 0;
	sb.w.setManual( 'storm', 1 );
	run( sb, 30 );
	ok( sb.w.danger > 0.95, 'a full storm has danger ~1' );
	const dark = 0.55 * sb.w.cur.light;
	ok( dark < 0.55 && dark > 0.3, `a storm is a little darker (exposure x${ sb.w.cur.light.toFixed( 2 ) })` );
	sb.w._strikeIn = 1e9; // (the test strikes by hand from here)
	while ( sb.w.lightning > 0 ) sb.w.update( 0.05 );
	const s = sb.w.strike( 1.2 );
	ok( near( s.delay, 1200 / 343, 1e-9 ) && s.power > 0 && s.power <= 1, `strike(): thunder ${ s.delay.toFixed( 1 ) } s after the flash at 1.2 km` );
	let peak = 0;
	for ( let i = 0; i < 40; i ++ ) { sb.w.update( 0.05 ); peak = Math.max( peak, sb.app.settings.exposure ); }
	for ( let i = 0; i < 40; i ++ ) sb.w.update( 0.05 );
	ok( peak > dark * 1.5 && sb.w.lightning === 0 && near( sb.app.settings.exposure, dark, 1e-6 ), `the flash lifts the exposure (x${ ( peak / dark ).toFixed( 2 ) }) and it comes back` );
	ok( aud.starts.some( ( x ) => x.at > aud.ctx.currentTime ) && sb.w.audio.thunderCount >= 1, 'thunder is scheduled on the audio context, later than the flash' );
	sb.app.settings.exposure = 1; // the settings panel's slider
	sb.w.update( 0.05 );
	ok( near( sb.app.settings.exposure, sb.w.cur.light, 1e-6 ), 'a new exposure from the settings panel becomes the base' );
	sb.w.dispose();
	ok( near( sb.app.settings.exposure, 1, 1e-9 ), 'dispose gives the exposure back' );
	// storms fire lightning on their own
	const auto = make( 'campaign' );
	auto.app.settings.timeSpeed = 0;
	let d = 1;
	while ( ! stormWindow( d ) ) d ++;
	const w0 = stormWindow( d );
	setTime( auto, d, ( w0.start + w0.end ) / 2 );
	run( auto, 400 );
	ok( auto.w.current.kind === 'storm' && auto.w.strikes >= 3, `a storm strikes by itself (${ auto.w.strikes } strikes in 400 s)` );
	const clear = make( 'campaign' );
	clear.app.settings.timeSpeed = 0;
	setTime( clear, 0, 7 );
	run( clear, 200 );
	ok( clear.w.strikes === 0 && clear.w.lightning === 0, 'no lightning in clear weather' );

}

// ---------------------------------------------------------------------------------------------- storm warning and the HUD chip
{

	const dom = installDom();
	const sb = make( 'campaign', { ui: { ui: { modeEl: dom.mode } } } );
	let d = 1;
	while ( ! stormWindow( d ) ) d ++;
	const w0 = stormWindow( d );
	setTime( sb, d, w0.start - 0.5 ); // 0.5 h = 50 s at the default 100 s per island hour
	sb.w.update( 0.1 );
	ok( sb.w.warning !== null && sb.w.warning <= 60 && sb.w.warning > 40, `a storm warning in the last minute (${ sb.w.warning && sb.w.warning.toFixed( 1 ) } s)` );
	const chip = dom.host.children.find( ( c ) => c.className.includes( 'wx-chip' ) );
	ok( chip && chip.className.includes( 'is-warn' ) && chip.text().includes( 'Storm warning' ), 'the chip pulses "Storm warning"' );
	ok( dom.styles.filter( ( s ) => s.id === 'wx-style' ).length === 1 && dom.styles[ 0 ].textContent.includes( '.wx-chip' ) && dom.styles[ 0 ].textContent.includes( 'var(--tw-' ), 'its CSS is injected once, classes prefixed wx-, the --tw-* tokens' );
	setTime( sb, d, w0.start - 0.8 );
	sb.w.update( 0.1 );
	ok( sb.w.warning === null && ! chip.className.includes( 'is-warn' ), 'no warning earlier than that' );
	setTime( sb, d, w0.start + 0.3 );
	sb.w.update( 0.1 );
	ok( sb.w.current.kind === 'storm' && sb.w.warning === null && chip.text().includes( 'Storm' ) && ! chip.text().includes( 'warning' ), 'during the storm the chip says Storm' );
	setTime( sb, 0, 7 );
	for ( let i = 0; i < 12; i ++ ) sb.w.update( 0.1 );
	ok( chip.text().includes( 'Clear' ) && chip.text().includes( 'm/s' ), 'the chip shows the weather and the wind' );
	sb.w.dispose();
	ok( ! dom.host.children.includes( chip ), 'dispose removes the chip' );
	const manualApp = make( 'sandbox', { ui: { ui: { modeEl: dom.mode } } } );
	manualApp.w.setManual( 'storm' );
	manualApp.w.update( 0.1 );
	ok( manualApp.w.warning === null, 'a picked weather gives no warning' );
	uninstallDom();

}

// ---------------------------------------------------------------------------------------------- the HUD names the sky you see (wave 5)
// Alpha report: rain kept falling under a chip that said "Clear 13 m/s". The chip named the weather being moved to from
// the first frame of a two to four minute change, while the rain, the wind and the clouds were still the old weather's.
{

	const dom = installDom();
	const sb = make( 'sandbox', { ui: { ui: { modeEl: dom.mode } } } );
	sb.app.settings.timeSpeed = 0;
	setTime( sb, 3, 7 );
	sb.w.setManual( 'rain', 0.8 );
	run( sb, 8 ); // past the start-up settle: from here on changes are eased
	const chip = dom.host.children.find( ( c ) => c.className.includes( 'wx-chip' ) );
	ok( sb.w.current.shown === 'rain' && chip && chip.text().includes( 'Rain' ) && sb.w.cur.rain > 0.8, 'a downpour, and the chip says Rain' );
	sb.w.setManual( 'clear' );
	run( sb, 1 );
	ok( sb.w.current.kind === 'clear' && sb.w.current.shown === 'rain' && chip.text().includes( 'Rain' ) && ! chip.text().includes( 'Clear' ), 'the moment it turns, the chip still says Rain (it is still pouring)' );
	let lie = 0, seen = 0;
	for ( let i = 0; i < 400; i ++ ) {

		sb.w.update( 0.1 );
		const shown = sb.w.current.shown, rain = sb.w.cur.rain;
		if ( shown === 'clear' && ( rain > 0.01 || chip.text().includes( 'Rain' ) ) ) lie ++;
		if ( shown === 'clear' ) seen ++;

	}

	ok( lie === 0 && seen > 0, `never "Clear" while rain falls (${ lie } frames of ${ seen })` );
	ok( sb.w.rain.geometry.instanceCount === 0 && sb.w.rain.mesh.visible === false && chip.text().includes( 'Clear' ), 'and once clear, no streaks are drawn' );
	// a scheduled change (two to four minutes) and a change of intensity only
	const camp = make( 'campaign', { ui: { ui: { modeEl: dom.mode } } } );
	camp.app.settings.timeSpeed = 0;
	const ch = findChange(), t1 = ch.t1, t2 = ch.t2, a = ch.a.kind, b = ch.b.kind;
	setTime( camp, Math.floor( t1 / 24 ), t1 % 24 );
	run( camp, 8 );
	ok( camp.w.current.shown === a, `scheduled ${ a } shown` );
	setTime( camp, Math.floor( t2 / 24 ), t2 % 24 );
	run( camp, 2 );
	ok( camp.w.current.kind === b && camp.w.current.shown === a, `a scheduled turn to ${ b } names ${ a } until it is half way` );
	run( camp, 250 );
	ok( camp.w.current.shown === b && camp.w.current.transition === 1, `then ${ b }` );
	const sb2 = make( 'sandbox' );
	sb2.w.setManual( 'rain', 0.4 );
	run( sb2, 8 );
	sb2.w.setManual( 'rain', 1 );
	run( sb2, 2 );
	ok( sb2.w.current.shown === 'rain', 'heavier rain of the same kind keeps saying Rain' );
	sb.w.dispose();
	camp.w.dispose();
	uninstallDom();

}

// ---------------------------------------------------------------------------------------------- rain effect
{

	const sb = make( 'sandbox' );
	sb.app.settings.timeSpeed = 0;
	const rain = sb.w.rain;
	setTime( sb, 3, 7 );
	sb.w.setManual( 'clear', 1 );
	run( sb, 40 );
	ok( rain.geometry.instanceCount === 0 && rain.mesh.visible === false, 'no rain streaks in clear weather' );
	sb.w.setManual( 'rain', 1 );
	run( sb, 40 );
	const heavy = rain.geometry.instanceCount;
	ok( heavy > 5000 && rain.mesh.visible, `a downpour draws many streaks (${ heavy })` );
	sb.w.setManual( 'rain', 0.1 );
	run( sb, 40 );
	ok( rain.geometry.instanceCount > 0 && rain.geometry.instanceCount < heavy * 0.7, `drizzle draws fewer (${ rain.geometry.instanceCount })` );
	sb.w.setManual( 'storm', 1 );
	run( sb, 40 );
	sb.w._strikeIn = 1e9;
	sb.app.cameraWaterHeight = 5; // the camera under water: nothing is drawn
	sb.w.update( 0.1 );
	ok( rain.mesh.visible === false, 'hidden with the camera under water' );
	sb.app.cameraWaterHeight = 0;
	sb.w.update( 0.1 );
	ok( rain.mesh.visible === true, 'and back above it' );
	sb.app.colliders = { raycast: () => 3 }; // a roof: a solid collider overhead
	sb.app.player = { position: new Vector3( 0, 0, 0 ) };
	run( sb, 4 );
	ok( sb.w.shelter > 0.9 && rain.geometry.instanceCount < 500, 'under a roof the streaks stop' );
	sb.app.colliders = { raycast: () => Infinity };
	run( sb, 4 );
	ok( sb.w.shelter < 0.05 && rain.geometry.instanceCount > 5000, 'out from under it, they return' );
	const quiet = new wx.Weather( makeApp( 'campaign', { qs: new URLSearchParams( 'noWeatherFx' ) } ), null );
	ok( quiet.rain === null, '?noWeatherFx builds no rain mesh' );

}

// ---------------------------------------------------------------------------------------------- audio: the synthesised rain, wind and thunder
{

	const aud = makeAudio();
	const sb = make( 'sandbox', { audio: aud.audio } );
	sb.app.settings.timeSpeed = 0;
	sb.w.setManual( 'storm', 1 );
	run( sb, 40 );
	ok( sb.w.audio.ready, 'the graph is built when the audio context exists' );
	const g = sb.w.audio.n;
	ok( g.patter.gain.value > 0.02 && g.body.gain.value > 0.01 && g.rumble.gain.value > 0.05 && g.howl.gain.value > 0.03, `a storm: patter ${ g.patter.gain.value.toFixed( 3 ) }, body ${ g.body.gain.value.toFixed( 3 ) }, rumble ${ g.rumble.gain.value.toFixed( 3 ) }, howl ${ g.howl.gain.value.toFixed( 3 ) }` );
	ok( aud.created.filter( ( n ) => n.kind === 'bufferSource' && n.loop && n.started ).length >= 4, 'four looping noise sources run' );
	ok( g.bus.connectedTo === aud.audio.ambAbove, 'the bus hangs off the SoundScape\'s ambience path (volume, mute and the underwater muffle apply)' );
	sb.w.setManual( 'clear', 1 );
	run( sb, 60 );
	ok( g.patter.gain.value < 0.001 && g.rumble.gain.value < 0.001 && g.howl.gain.value < 0.02, 'clear: the rain and the rumble are silent' );
	aud.audio.muted = true;
	const before = sb.w.audio.thunderCount;
	ok( sb.w.audio.thunder( 2, 1 ) === false && sb.w.audio.thunderCount === before, 'muted: no thunder is scheduled' );
	run( sb, 1 );
	ok( g.bus.gain.value === 0, 'muted: the bus is silent' );
	aud.audio.muted = false;
	const bare = makeAudio( { bare: true } ); // no ambience node, no master: volume and mute are applied here
	const sb2 = make( 'sandbox', { audio: bare.audio } );
	sb2.app.settings.timeSpeed = 0;
	sb2.w.setManual( 'rain', 1 );
	run( sb2, 40 );
	ok( sb2.w.audio.n.bus.connectedTo === bare.ctx.destination && near( sb2.w.audio.n.bus.gain.value, 0.64, 1e-6 ), 'a bare context: connected to the destination at the app\'s volume squared' );
	bare.audio.volume = 0.5;
	run( sb2, 1 );
	ok( near( sb2.w.audio.n.bus.gain.value, 0.25, 1e-6 ), 'the app\'s volume is followed' );
	const late = { ctx: null, muted: false, volume: 0.8 }; // no context yet (autoplay policy)
	const sb3 = make( 'sandbox', { audio: late } );
	sb3.app.settings.timeSpeed = 0;
	sb3.w.setManual( 'rain', 1 );
	run( sb3, 5 );
	ok( ! sb3.w.audio.ready && ! sb3.w.audio.failed, 'before the audio context exists the weather is silent, not broken' );
	const lateAud = makeAudio();
	late.ctx = lateAud.ctx;
	late.ambAbove = lateAud.audio.ambAbove;
	run( sb3, 3 );
	ok( sb3.w.audio.ready, 'the graph is built once the context appears' );
	const bad = { ctx: { createGain() { throw new Error( 'boom' ); }, createBuffer() { throw new Error( 'boom' ); } }, muted: false };
	const sb4 = make( 'sandbox', { audio: bad } );
	let threw = false;
	try {

		sb4.w.setManual( 'storm' );
		for ( let i = 0; i < 400; i ++ ) sb4.w.update( 0.1 );
		sb4.w.strike();
		sb4.w.dispose();

	} catch ( e ) { threw = true; }

	ok( ! threw, 'a failing audio context never throws' );
	sb.w.dispose();
	ok( g.bus.disconnected, 'dispose disconnects the graph' );

}

// ---------------------------------------------------------------------------------------------- reset and lifecycle
{

	const ctx = make( 'campaign' );
	setTime( ctx, 9, 12 );
	run( ctx, 10 );
	ctx.features.reset();
	ok( ctx.w.day === 0, 'features.reset() restarts the weather clock' );
	for ( let i = 0; i < 2000; i ++ ) { ctx.app.settings.timeOfDay = ( ctx.app.settings.timeOfDay + 0.01 ) % 24; ctx.w.update( 0.1 ); }
	ok( ctx.w.day >= 1, `time can run past midnight and the day counter counts (day ${ ctx.w.day })` );
	const f = ctx.features.toJSON();
	ok( typeof f.weather.day === 'number' && f.weather.manual === null, 'the day counter is saved with the manual pick' );
	ctx.features.dispose();
	ok( true, 'features.dispose() disposes the weather' );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall weather checks passed' );
process.exit( fails ? 1 : 0 );
