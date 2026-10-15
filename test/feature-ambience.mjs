// Plain-node test of the wave 13C ambience (src/features/sfx/Places.js, Cues.js, Synth.js): which bed is audible where and
// when (distance fade x the hour's share), the market on the residents' schedule, the bell on the hour, the loops being
// built and dropped, the timed one-shots, the event cues with their rate limits, the plane's wheels and the parachute.
// A stand-in AudioContext with the whole node vocabulary records what is built; no sound is made.
// usage: node test/feature-ambience.mjs
globalThis.location = globalThis.location || { search: '' };
const { Features } = await import( '../src/features/Features.js' );
const sfxModule = await import( '../src/features/sfx/index.js' );
const { SfxPlayer, SynthPlayer, CUES, bedWeights, sources, marketCrowd, bellStrikes, cueFor, wheelLevels } = sfxModule;
const { fade, daylight, nightness, workday, runupOf, hourOf, DRUM_PATTERN } = await import( '../src/features/sfx/Places.js' );
const { WORLD } = await import( '../src/world/WorldLayout.js' );
const { strongholdLayout } = await import( '../src/world/islands/stronghold/Layout.js' );

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// ---------------------------------------------------------------------------------------------- stand-ins

class Param {

	constructor( v = 0 ) { this.value = v; this.target = v; }
	setValueAtTime( v ) { this.value = v; }
	linearRampToValueAtTime( v ) { this.target = v; }
	exponentialRampToValueAtTime( v ) { this.target = v; }
	setTargetAtTime( v ) { this.target = v; }

}

class Node {

	constructor( kind, ctx ) {

		this.kind = kind;
		this.ctx = ctx;
		this.to = [];
		this.disconnected = false;
		this.stopped = false;
		this.started = false;
		this.gain = new Param( 1 );
		this.frequency = new Param( 440 );
		this.Q = new Param( 1 );
		this.positionX = new Param( 0 );
		this.positionY = new Param( 0 );
		this.positionZ = new Param( 0 );

	}

	connect( d ) { this.to.push( d ); return d; }
	disconnect() { this.disconnected = true; }
	start() { this.started = true; this.ctx.started.push( this ); }
	stop() { this.stopped = true; }

}

class FakeCtx {

	constructor() {

		this.currentTime = 0;
		this.sampleRate = 8000;
		this.state = 'running';
		this.destination = new Node( 'destination', this );
		this.made = {};
		this.started = [];

	}

	_n( kind ) { this.made[ kind ] = ( this.made[ kind ] || 0 ) + 1; return new Node( kind, this ); }
	createGain() { return this._n( 'gain' ); }
	createPanner() { return this._n( 'panner' ); }
	createOscillator() { return this._n( 'osc' ); }
	createBiquadFilter() { return this._n( 'filter' ); }
	createBufferSource() { const n = this._n( 'source' ); n.playbackRate = new Param( 1 ); return n; }
	createBuffer( ch, len ) { const d = new Float32Array( len ); return { duration: len / this.sampleRate, getChannelData: () => d }; }

}

function makeAudio() {

	const ctx = new FakeCtx();
	return {
		ctx, muted: false, enabled: true, vols: { master: 0.8, sfx: 1, ambience: 1 },
		sfxAbove: new Node( 'sfxAbove', ctx ), ambAbove: new Node( 'ambAbove', ctx ), master: new Node( 'master', ctx ),
		env: { lx: 0, ly: 1.7, lz: 0, hour: 12, surf: 0.6 },
		getVolume( k ) { return this.vols[ k ]; },
	};

}

function makeWorld( { audio = makeAudio(), hour = 12, at = { x: 0, z: 0 }, wind = 6 } = {} ) {

	if ( audio ) { audio.env.hour = hour; audio.env.lx = at.x; audio.env.lz = at.z; }
	const app = {
		audio, settings: { timeOfDay: hour },
		player: { mode: 'walk', position: { x: at.x, y: 0, z: at.z }, launched: 0 },
		game: { fight: null, bite: null, rod: { state: 'idle' }, state: { boat: 'skiff' } },
		boatCtl: null, residents: { list: [] },
	};
	const features = new Features( app );
	app.features = features;
	const sfx = features.add( 'sfx', { install: ( a, f ) => sfxModule.install( a, f, { player: new SfxPlayer( a, { fetchImpl: () => Promise.reject( new Error( 'no files' ) ) } ) } ) } );
	features.add( 'weather', { install: () => ( { wind } ) } );
	return { app, features, sfx, audio, ctx: audio ? audio.ctx : null };

}

function run( w, seconds, dt = 1 / 20, each = null ) {

	const n = Math.round( seconds / dt );
	for ( let i = 0; i < n; i ++ ) {

		w.ctx.currentTime += dt;
		if ( each ) each( i );
		w.features.update( dt );

	}

}

const here = ( w, p, hour ) => {

	w.audio.env.lx = p.x; w.audio.env.lz = p.z;
	w.app.player.position.x = p.x; w.app.player.position.z = p.z;
	if ( hour !== undefined ) { w.audio.env.hour = hour; w.app.settings.timeOfDay = hour; }

};

const played = ( w, name ) => w.sfx.synth.played.filter( ( p ) => p.name === name );
const S = sources();
const L = strongholdLayout();
const far = { x: 5000, z: 5000 };
const lvl = ( p, h, c ) => bedWeights( p.x, p.z, h, c );

// ---------------------------------------------------------------------------------------------- where each sound lives

{

	const need = [ 'market', 'gulls', 'strip', 'yard', 'chapel', 'tavern', 'drums', 'fort', 'cliffs', 'birds', 'falls' ];
	ok( need.every( ( k ) => S[ k ] && Number.isFinite( S[ k ].x ) && Number.isFinite( S[ k ].z ) && S[ k ].outer > S[ k ].inner ), 'every bed has a place with a fade' );
	ok( Math.hypot( S.market.x - WORLD.tidemark.market.x, S.market.z - WORLD.tidemark.market.z ) < 1, 'the market murmur sits on the market square' );
	ok( Math.hypot( S.strip.x - WORLD.tidemark.airstrip.pad.x, S.strip.z - WORLD.tidemark.airstrip.pad.z ) < 1, 'the windsock bed sits on the apron' );
	ok( S.tavern.place === 'blackwater' && Math.hypot( S.tavern.x - L.town.find( ( b ) => b.kind === 'tavern' ).x, S.tavern.z - L.town.find( ( b ) => b.kind === 'tavern' ).z ) < 1, 'the rowdy tavern is the Rum Hole' );
	ok( Math.hypot( S.falls.x - WORLD.inverted.lagoon.x, S.falls.z - WORLD.inverted.lagoon.z ) < 1, 'the upward falls sit on the Inverted Isles lagoon' );
	ok( fade( 0, 10, 50 ) === 1 && fade( 10, 10, 50 ) === 1 && fade( 50, 10, 50 ) === 0 && fade( 30, 10, 50 ) > 0.4 && fade( 30, 10, 50 ) < 0.6, 'fade: full inside, gone outside, smooth between' );
	let mono = true, prev = 2;
	for ( let d = 0; d <= 300; d += 10 ) { const f = fade( d, 14, 85 ); if ( f > prev + 1e-9 ) mono = false; prev = f; }
	ok( mono, 'fade falls monotonically with distance' );

}

// ---------------------------------------------------------------------------------------------- bed selection by position and time

{

	const at = { x: S.market.x, z: S.market.z };
	const noon = lvl( at, 12 ), night = lvl( at, 3 );
	ok( noon.market > 0.6, `the market murmurs at noon on the square (${ noon.market.toFixed( 2 ) })` );
	ok( night.market < 0.1, `and is nearly quiet at 3 am (${ night.market.toFixed( 2 ) })` );
	ok( lvl( { x: at.x + 60, z: at.z }, 12 ).market < noon.market && lvl( { x: at.x + 60, z: at.z }, 12 ).market > 0, 'it fades with distance from the square' );
	ok( lvl( { x: at.x + 200, z: at.z }, 12 ).market === 0, 'and is gone 200 m away' );
	ok( lvl( at, 12 ).tavern === 0 && lvl( at, 12 ).drums === 0 && lvl( at, 12 ).falls === 0, 'Tidemark hears nothing of the other islands' );

	const q = { x: S.gulls.x, z: S.gulls.z };
	ok( lvl( q, 12 ).gulls > 0.9 && lvl( q, 2 ).gulls === 0, 'gulls cry over the quay by day and not at 2 am' );
	ok( lvl( q, 6 ).gulls > 0 && lvl( q, 6 ).gulls < 1, 'at first light they are only starting' );
	ok( daylight( 12 ) === 1 && daylight( 0 ) === 0 && nightness( 0 ) === 1 && nightness( 12 ) === 0 && nightness( 22 ) === 1, 'daylight and night curves' );

	const y = { x: S.yard.x, z: S.yard.z };
	ok( lvl( y, 10 ).yard > 0.9 && lvl( y, 22 ).yard === 0 && lvl( y, 12.4 ).yard < lvl( y, 10 ).yard, 'the boatyard hammers in the working day, rests at noon and at night' );
	ok( workday( 5 ) === 0 && workday( 14 ) > 0.95, 'working day curve' );

	const st = { x: S.strip.x, z: S.strip.z };
	ok( lvl( st, 12, { wind: 10 } ).strip > 0.95 && lvl( st, 12, { wind: 0 } ).strip === 0, 'the windsock flutters with the wind' );
	ok( lvl( st, 12, { runup: { x: st.x + 40, z: st.z, rpm: 0.8 } } ).engine > 0.5 && lvl( st, 12 ).engine === 0, 'a plane running up on the apron is heard (and only then)' );
	ok( lvl( { x: st.x + 500, z: st.z }, 12, { runup: { x: st.x, z: st.z, rpm: 1 } } ).engine === 0, 'the engine is not heard from across the island' );
	ok( lvl( st, 12, { runup: { x: st.x, z: st.z, rpm: 0.2 } } ).engine < lvl( st, 12, { runup: { x: st.x, z: st.z, rpm: 0.9 } } ).engine, 'a louder engine at higher rpm' );

	const ch = { x: S.chapel.x + 120, z: S.chapel.z };
	ok( lvl( ch, 12 ).chapel > 0.3 && lvl( { x: ch.x + 400, z: ch.z }, 12 ).chapel === 0, 'the chapel bell carries a few hundred metres' );

	const rum = { x: S.tavern.x, z: S.tavern.z };
	ok( lvl( rum, 23 ).tavern > 0.95 && lvl( rum, 12 ).tavern > 0.25 && lvl( rum, 12 ).tavern < 0.4, 'the Rum Hole is rowdy at night, murmuring by day' );
	ok( lvl( rum, 23 ).drums > 0.9 && lvl( rum, 12 ).drums === 0, 'drums at night, none by day' );
	ok( Math.abs( lvl( rum, 23, { held: true } ).drums - 0.2 * lvl( rum, 23 ).drums ) < 1e-9, 'the drums fall quiet when the player holds the island' );
	ok( lvl( { x: S.drums.x + 300, z: S.drums.z }, 23 ).drums > 0 && lvl( { x: S.drums.x + 400, z: S.drums.z }, 23 ).drums === 0, 'drums carry about 300 m' );
	ok( lvl( { x: S.fort.x + 300, z: S.fort.z }, 12 ).fort > 0 && lvl( { x: S.fort.x + 600, z: S.fort.z }, 12 ).fort === 0, 'the fort bell carries about half a kilometre' );
	ok( lvl( { x: S.birds.x, z: S.birds.z }, 12 ).birds > 0.9 && lvl( { x: S.birds.x, z: S.birds.z }, 1 ).birds === 0, 'parrots by day only' );
	{

		const R = S.cliffs.ring, c = S.cliffs;
		const onRing = lvl( { x: c.x + R, z: c.z }, 12, { wind: 8, surf: 1 } ).cliffs, inCove = lvl( { x: c.x, z: c.z }, 12, { wind: 8, surf: 1 } ).cliffs, farOut = lvl( { x: c.x + R + 450, z: c.z }, 12, { wind: 8, surf: 1 } ).cliffs;
		ok( onRing > inCove && inCove > 0 && farOut === 0, `surf on the cliffs: loudest on the ring (${ onRing.toFixed( 2 ) }), a wash in the caldera (${ inCove.toFixed( 2 ) }), gone out at sea` );

	}

	const f = { x: S.falls.x, z: S.falls.z };
	ok( lvl( f, 12 ).falls === 1 && lvl( { x: f.x + 350, z: f.z }, 12 ).falls === 0, 'the upward waterfalls roar at the Inverted Isles lagoon' );
	ok( Object.values( lvl( far, 12 ) ).every( ( v ) => v === 0 ), 'far from every place nothing is audible' );
	ok( Object.values( lvl( { x: NaN, z: 0 }, NaN ) ).every( ( v ) => Number.isFinite( v ) ), 'garbage positions and hours give finite levels' );

}

// ---------------------------------------------------------------------------------------------- the market on the residents' schedule

{

	const base = ( h ) => marketCrowd( h );
	ok( base( 12 ) > 0.8 && base( 3 ) < 0.1 && base( 8 ) > base( 6.5 ), 'the day curve without residents' );
	const fishers = [ { role: 'fisher' }, { role: 'fisher' } ], merchants = [ { role: 'merchant' } ], kids = [ { role: 'child' } ], sleepers = [ { data: { role: 'guard' } } ];
	ok( marketCrowd( 12, fishers ) > marketCrowd( 12, [ { schedule: 'innkeeper' } ] ), 'residents at their noon meal fill the square more than an innkeeper at work' );
	ok( marketCrowd( 3, fishers ) < 0.1, 'sleeping residents: no crowd at 3 am' );
	ok( marketCrowd( 9, merchants ) > 0 && marketCrowd( 9, merchants ) <= 1, 'a working merchant keeps a murmur at 9' );
	ok( marketCrowd( 18, kids ) > marketCrowd( 18, [ { role: 'merchant' } ] ), 'children are out playing at 6 pm while the merchants are heading for the tavern' );
	ok( marketCrowd( 7.5, merchants ) < marketCrowd( 7.5, sleepers ), 'a merchant only waking at 7:30 thins the square against a guard already at work' );
	ok( marketCrowd( 12, [] ) === marketCrowd( 12 ) && marketCrowd( 12, [ { nonsense: 1 } ] ) === marketCrowd( 12 ), 'no usable schedules: the day curve alone' );
	const folk = [ { data: { port: 'tidemark', role: 'fisher' } } ];
	ok( bedWeights( S.market.x, S.market.z, 3, { folk } ).market < bedWeights( S.market.x, S.market.z, 12, { folk } ).market, 'bedWeights uses the folk' );

}

// ---------------------------------------------------------------------------------------------- the bell on the hour

{

	ok( bellStrikes( 8.99, 9.01 ) === 9 && bellStrikes( 11.9, 12.1 ) === 12 && bellStrikes( 12.9, 13.1 ) === 1 && bellStrikes( 17.99, 18.02 ) === 6, 'strikes: the hour, twelve at noon, one at one' );
	ok( bellStrikes( 9.1, 9.5 ) === 0 && bellStrikes( 9.5, 9.1 ) === 0, 'no strike inside an hour or on the clock running back' );
	ok( bellStrikes( 23.9, 0.1 ) === 0 && bellStrikes( 2.9, 3.1 ) === 0 && bellStrikes( 22.9, 23.1 ) === 0, 'the bell rests between 11 pm and 6 am' );
	ok( bellStrikes( 5.99, 6.01 ) === 6 && bellStrikes( 21.99, 22.01 ) === 10, 'but rings at 6 am and 10 pm' );
	ok( bellStrikes( 9, 15 ) === 0 && bellStrikes( 8, 20 ) === 0, 'a jump of hours (a loaded save, the slider) rings nothing' );
	ok( bellStrikes( NaN, 9 ) === 0 && bellStrikes( 8, undefined ) === 0, 'bad hours ring nothing' );

}

// ---------------------------------------------------------------------------------------------- beds are built, faded and dropped

{

	const w = makeWorld( { at: far, hour: 12 } );
	run( w, 2 );
	ok( w.sfx.places.bedNodes().length === 0 && ! w.ctx.made.osc, 'far from every place no loop is built' );

	here( w, { x: S.market.x, z: S.market.z }, 12 );
	run( w, 2 );
	ok( w.sfx.places.bedNodes().includes( 'market' ), 'on the square the market loop is built' );
	const bed = w.sfx.places.beds.get( 'market' );
	ok( bed.out.gain.target > 0.05 && bed.out.gain.target <= 0.2 + 1e-9, `with a gain that follows the level (${ bed.out.gain.target.toFixed( 3 ) })` );
	ok( bed.sources.length >= 6 && bed.sources.every( ( s ) => s.started ), 'its sources are running' );
	ok( bed.out.to[ 0 ] && bed.out.to[ 0 ].kind === 'panner' && bed.out.to[ 0 ].to[ 0 ] === w.audio.ambAbove, 'it plays through a panner into the ambience path' );
	ok( ! w.sfx.places.bedNodes().includes( 'tavern' ) && ! w.sfx.places.bedNodes().includes( 'cliffs' ), 'and only that loop' );

	here( w, { x: S.market.x, z: S.market.z }, 3 );
	run( w, 2 );
	ok( bed.out.gain.target < 0.02, 'at 3 am the same spot drives it nearly silent' );
	here( w, far );
	run( w, 11 );
	ok( ! w.sfx.places.bedNodes().includes( 'market' ) && bed.sources.every( ( s ) => s.stopped ) && bed.out.disconnected, 'after a while of silence the loop is stopped and freed' );

	here( w, { x: S.tavern.x, z: S.tavern.z }, 23 );
	run( w, 2 );
	ok( w.sfx.places.bedNodes().includes( 'tavern' ), 'the Rum Hole loop is built at night' );
	here( w, { x: S.falls.x, z: S.falls.z }, 12 );
	run( w, 2 );
	ok( w.sfx.places.bedNodes().includes( 'falls' ), 'the waterfall loop is built at the Inverted Isles' );
	here( w, { x: S.cliffs.x + S.cliffs.ring, z: S.cliffs.z }, 12 );
	run( w, 2 );
	ok( w.sfx.places.bedNodes().includes( 'cliffs' ), 'the cliff surf loop is built on the volcanic ring' );
	w.sfx.dispose();
	ok( w.sfx.places.bedNodes().length === 0, 'dispose frees every loop' );

}

// ---------------------------------------------------------------------------------------------- muted / no audio

{

	const w = makeWorld( { at: { x: S.market.x, z: S.market.z }, hour: 12 } );
	w.audio.muted = true;
	run( w, 3 );
	ok( w.sfx.places.bedNodes().length === 0, 'muted audio builds no loops' );
	const w2 = makeWorld( { audio: null, at: { x: 0, z: 0 } } );
	w2.app.audio = null;
	let threw = false;
	try { run( { ...w2, ctx: { currentTime: 0 } }, 2 ); w2.features.emit( 'cannonFired', { x: L.batteries[ 0 ].x, y: 20, z: L.batteries[ 0 ].z } ); } catch ( e ) { threw = true; console.log( e ); }
	ok( ! threw, 'no audio: nothing throws' );
	const w3 = makeWorld( { at: { x: S.market.x, z: S.market.z } } );
	w3.audio.ctx.createOscillator = undefined;
	w3.audio.ctx.createBufferSource = undefined;
	threw = false;
	try { run( w3, 2 ); w3.features.emit( 'blackFlagBought', {} ); } catch ( e ) { threw = true; }
	ok( ! threw && w3.sfx.places.bedNodes().length === 0 && w3.sfx.synth.count === 0, 'a context without oscillators is skipped quietly' );

}

// ---------------------------------------------------------------------------------------------- timed one-shots

{

	const w = makeWorld( { at: { x: S.chapel.x, z: S.chapel.z }, hour: 8.97 } );
	run( w, 0.2 );
	w.audio.env.hour = 9.02;
	run( w, 0.5 );
	ok( w.sfx.places.bellLeft > 0, 'the clock passing nine arms nine strikes' );
	run( w, 30 );
	ok( w.sfx.places.bells === 9 && played( w, 'chapel_bell' ).length === 9, `the chapel bell strikes nine times (${ w.sfx.places.bells })` );
	const times = played( w, 'chapel_bell' );
	ok( times.every( ( p ) => p.at && Math.hypot( p.at.x - S.chapel.x, p.at.z - S.chapel.z ) < 1 && p.cat === 'ambience' ), 'from the chapel, on the ambience path' );

	const night = makeWorld( { at: { x: S.chapel.x, z: S.chapel.z }, hour: 2.97 } );
	run( night, 0.2 );
	night.audio.env.hour = 3.02;
	run( night, 30 );
	ok( night.sfx.places.bells === 0, 'no bell at 3 am' );

	const q = makeWorld( { at: { x: S.gulls.x, z: S.gulls.z }, hour: 12 } );
	run( q, 90 );
	ok( q.sfx.places.gulls >= 4 && played( q, 'gull' ).length >= 4, `gulls call over the quay by day (${ q.sfx.places.gulls })` );
	const qn = makeWorld( { at: { x: S.gulls.x, z: S.gulls.z }, hour: 1 } );
	run( qn, 90 );
	ok( qn.sfx.places.gulls === 0, 'and not at night' );
	const qf = makeWorld( { at: { x: S.gulls.x + 600, z: S.gulls.z }, hour: 12 } );
	run( qf, 90 );
	ok( qf.sfx.places.gulls === 0 && played( qf, 'gull' ).length === 0, 'nor from the far side of the island' );

	const y = makeWorld( { at: { x: S.yard.x, z: S.yard.z }, hour: 10 } );
	run( y, 60 );
	ok( y.sfx.places.hammers >= 6, `the boatyard hammers in runs by day (${ y.sfx.places.hammers })` );
	const yn = makeWorld( { at: { x: S.yard.x, z: S.yard.z }, hour: 21 } );
	run( yn, 60 );
	ok( yn.sfx.places.hammers === 0, 'and rests in the evening' );

	const d = makeWorld( { at: { x: S.drums.x, z: S.drums.z }, hour: 23 } );
	run( d, 20 );
	const beat = DRUM_PATTERN.filter( Boolean ).length;
	ok( d.sfx.places.drums >= beat * 3 && played( d, 'drum' ).some( ( p ) => p.gain > 0 ), `drums keep a pattern at night (${ d.sfx.places.drums } hits in 20 s)` );
	ok( d.sfx.places.shouts >= 2 && played( d, 'tavern_shout' ).length >= 2, 'the tavern roars now and then' );
	const dd = makeWorld( { at: { x: S.drums.x, z: S.drums.z }, hour: 12 } );
	run( dd, 20 );
	ok( dd.sfx.places.drums === 0, 'no drums by day' );
	const held = makeWorld( { at: { x: S.drums.x, z: S.drums.z }, hour: 23 } );
	held.features.add( 'stronghold', { install: () => ( { holder: 'player', alarm: { state: 'calm' } } ) } );
	run( held, 20 );
	ok( held.sfx.places.drums < d.sfx.places.drums, 'a held island is quieter' );

	const b = makeWorld( { at: { x: S.birds.x, z: S.birds.z }, hour: 11 } );
	run( b, 90 );
	ok( b.sfx.places.birds >= 4 && ( played( b, 'parrot' ).length > 0 ), `parrots call over Blackwater by day (${ b.sfx.places.birds })` );
	const bn = makeWorld( { at: { x: S.birds.x, z: S.birds.z }, hour: 1 } );
	run( bn, 90 );
	ok( bn.sfx.places.birds === 0, 'not at night' );

}

// ---------------------------------------------------------------------------------------------- the plane running up

{

	const strip = WORLD.tidemark.airstrip;
	const feats = ( flight, remote, piloted = false ) => ( { get: ( n ) => n === 'seaplane' ? { flight, remote, piloted } : null } );
	const run1 = { position: { x: strip.x, z: strip.z }, engineOn: true, rpm: 0.7, airborne: false, onWater: false };
	ok( runupOf( feats( run1 ) ).rpm === 0.7, 'a parked plane left running is a run-up' );
	ok( runupOf( feats( run1, null, true ) ) === null, 'the plane you fly is PlaneAudio\'s, not the bed\'s' );
	ok( runupOf( feats( { ...run1, airborne: true } ) ) === null && runupOf( feats( { ...run1, engineOn: false } ) ) === null && runupOf( feats( { ...run1, rpm: 0.05 } ) ) === null, 'airborne, stopped or idling planes are not' );
	ok( runupOf( feats( { ...run1, position: { x: strip.x + 900, z: strip.z } } ) ) === null, 'a plane far from the apron is not' );
	const peers = new Map( [ [ 'a', { snaps: [ { p: [ strip.x + 20, 0.5, strip.z ], thr: 0.9 } ] } ], [ 'b', { snaps: [ { p: [ strip.x, 120, strip.z ], thr: 1 } ] } ] ] );
	ok( runupOf( feats( null, { peers } ) ).rpm === 0.9, 'another player\'s plane running up on the ground is heard; one in the air is not' );
	ok( runupOf( null ) === null && runupOf( { get: () => null } ) === null, 'no seaplane feature: no run-up' );

	const w = makeWorld( { at: { x: strip.x + 60, z: strip.z }, hour: 12 } );
	w.features.add( 'seaplane', { install: () => ( { flight: run1, piloted: false } ) } );
	run( w, 2 );
	ok( w.sfx.places.bedNodes().includes( 'engine' ), 'the engine bed is built beside a running plane' );
	const e = w.sfx.places.beds.get( 'engine' );
	ok( e.out.gain.target > 0.03, `at a level that follows the distance and rpm (${ e.out.gain.target.toFixed( 3 ) })` );

}

// ---------------------------------------------------------------------------------------------- event cues

{

	const g0 = L.batteries[ 0 ].guns[ 1 ];
	ok( cueFor( 'cannonFired', { x: g0.x, y: 27, z: g0.z, by: 'pirate' } )[ 0 ].cue === 'battery_fire', 'cueFor: a shot from a battery gun is the battery\'s' );
	ok( cueFor( 'cannonFired', { x: 0, y: 3, z: 0, by: 'player' } ).length === 0 && cueFor( 'cannonFired', {} ).length === 0, 'a swivel gun elsewhere is not' );
	ok( cueFor( 'explosion', { x: 10, y: 2, z: 10, by: 'powder' } )[ 0 ].cue === 'powder_blast' && cueFor( 'explosion', { x: L.powder[ 0 ].x, y: 2, z: L.powder[ 0 ].z } )[ 0 ].cue === 'powder_blast', 'cueFor: a powder store going up' );
	ok( cueFor( 'explosion', { x: 0, y: 2, z: 0, by: 'cannon' } ).length === 0, 'other explosions are not' );
	ok( cueFor( 'strongholdAlarm', { state: 'alarm' } )[ 0 ].cue === 'fort_bell' && cueFor( 'strongholdAlarm', { state: 'calm' } ).length === 0, 'cueFor: the bell on the alarm, not on the all-clear' );
	ok( cueFor( 'blackFlagBought' )[ 0 ].cue === 'black_flag' && cueFor( 'strongholdClaimed' )[ 0 ].cue === 'claim', 'cueFor: the flag and the claim' );
	ok( cueFor( 'meleeHit', { x: 1, y: 1, z: 1 } ).length === 0 && cueFor( 'meleeHit', { x: 1, y: 1, z: 1 }, { practice: true } )[ 0 ].cue === 'sword_clack', 'cueFor: wooden clack only in the practice fight' );
	ok( cueFor( 'nope', {} ).length === 0, 'unknown events call for nothing' );

	const w = makeWorld( { at: { x: g0.x - 120, z: g0.z }, hour: 12 } );
	const fireAt = ( g ) => w.features.emit( 'cannonFired', { x: g.x, y: 27, z: g.z, dir: { x: 1, y: 0, z: 0 }, by: 'pirate' } );
	fireAt( g0 );
	ok( played( w, 'battery_fire' ).length === 1, 'a battery firing starts its report' );
	const v = played( w, 'battery_fire' )[ 0 ];
	ok( v.at && v.dist > 100 && v.gain > 0.1 && v.cat === 'sfx', 'positioned at the gun, audible 120 m away, on the sfx path' );
	fireAt( L.batteries[ 0 ].guns[ 2 ] );
	ok( played( w, 'battery_fire' ).length === 1, 'a second shot inside the rate limit is skipped' );
	run( w, 0.3 );
	fireAt( L.batteries[ 0 ].guns[ 2 ] );
	ok( played( w, 'battery_fire' ).length === 2, 'and one after it plays (guns of a battery fire in turn)' );
	w.features.emit( 'cannonFired', { x: 1000, y: 3, z: 1000, by: 'pirate' } );
	ok( played( w, 'battery_fire' ).length === 2, 'a pirate gun at sea is not a battery' );

	const far2 = makeWorld( { at: { x: g0.x + 1500, z: g0.z }, hour: 12 } );
	far2.features.emit( 'cannonFired', { x: g0.x, y: 27, z: g0.z, by: 'pirate' } );
	ok( played( far2, 'battery_fire' ).length === 0, 'a battery is not heard 1.5 km away' );
	ok( CUES.battery_fire.max > 800, 'but it carries far (over 800 m)' );

	w.features.emit( 'explosion', { x: L.powder[ 0 ].x, y: 2, z: L.powder[ 0 ].z, radius: 8, energy: 5e4, by: 'powder' } );
	ok( played( w, 'powder_blast' ).length === 1, 'the powder store exploding' );

	w.features.emit( 'strongholdAlarm', { state: 'alarm', why: 'battery' } );
	ok( played( w, 'fort_bell' ).length === 1, 'the alarm rings the fort bell' );
	w.features.emit( 'strongholdAlarm', { state: 'alarm', why: 'again' } );
	ok( played( w, 'fort_bell' ).length === 1, 'a second alarm inside the limit does not stack bells' );
	w.features.emit( 'strongholdAlarm', { state: 'calm' } );

	w.features.emit( 'blackFlagBought', { price: 800 } );
	w.features.emit( 'blackFlagBought', { price: 800 } );
	ok( played( w, 'black_flag' ).length === 1 && played( w, 'black_flag' )[ 0 ].at === null, 'the black flag purchase plays once, in the head' );
	w.features.emit( 'strongholdClaimed', { coins: 1 } );
	ok( played( w, 'claim' ).length === 1, 'the claim fanfare' );

	w.features.emit( 'meleeHit', { x: g0.x - 120, y: 1, z: g0.z, by: 'player' } );
	ok( played( w, 'sword_clack' ).length === 0, 'a melee hit outside the practice fight makes no clack' );
	w.features.emit( 'practiceStarted', { count: 3 } );
	w.features.emit( 'meleeHit', { x: g0.x - 118, y: 1, z: g0.z, by: 'player' } );
	w.features.emit( 'meleeHit', { x: g0.x - 118, y: 1, z: g0.z, by: 'player' } );
	ok( played( w, 'sword_clack' ).length === 1, 'in the practice fight a hit clacks (twice at once: once)' );
	run( w, 0.2 );
	w.features.emit( 'meleeHit', { x: g0.x - 118, y: 1, z: g0.z, by: 'player' } );
	ok( played( w, 'sword_clack' ).length === 2, 'the next clack follows' );
	w.features.emit( 'practiceEnded', { result: 'won' } );
	run( w, 0.2 );
	w.features.emit( 'meleeHit', { x: g0.x - 118, y: 1, z: g0.z, by: 'player' } );
	ok( played( w, 'sword_clack' ).length === 2, 'and stops when the practice ends' );
	w.sfx.reset();
	ok( ! w.sfx.cues.practice, 'a reset clears the practice flag' );

	const m = makeWorld( { at: { x: g0.x - 120, z: g0.z } } );
	m.audio.muted = true;
	m.features.emit( 'strongholdClaimed', {} );
	m.audio.muted = false;
	m.audio.vols.master = 0;
	m.features.emit( 'strongholdClaimed', {} );
	ok( played( m, 'claim' ).length === 0, 'muted or silenced audio plays no cues' );

}

// ---------------------------------------------------------------------------------------------- the watch and the bell while the alarm stands

{

	const w = makeWorld( { at: { x: L.tower.x - 80, z: L.tower.z }, hour: 12 } );
	const sh = { holder: 'pirates', alarm: { state: 'calm' } };
	w.features.add( 'stronghold', { install: () => sh } );
	run( w, 1 );
	sh.alarm.state = 'spotted';
	run( w, 1 );
	ok( played( w, 'watch_call' ).length === 1, 'calm -> spotted: the watchtower calls out' );
	run( w, 8 );
	ok( played( w, 'watch_call' ).length === 1, 'once' );
	sh.alarm.state = 'alarm';
	run( w, 1 );
	ok( played( w, 'fort_bell' ).length === 1, 'spotted -> alarm: the fort bell rings' );
	run( w, 22 );
	const n = played( w, 'fort_bell' ).length;
	ok( n >= 3 && n <= 5, `and keeps ringing every few seconds while the alarm stands (${ n })` );
	sh.alarm.state = 'calm';
	run( w, 1 );
	const after = played( w, 'fort_bell' ).length;
	run( w, 20 );
	ok( played( w, 'fort_bell' ).length === after, 'it stops at the all-clear' );

}

// ---------------------------------------------------------------------------------------------- the wheels

{

	const flight = { geom: { wheels: [ {}, {}, {} ] }, airborne: false, onWater: false, airspeed: 0, controls: { brake: 0 }, position: { x: 1650, y: 1, z: 50 } };
	ok( wheelLevels( flight ).roll === 0 && wheelLevels( flight ).brake === 0, 'a parked plane makes no wheel noise' );
	ok( wheelLevels( { ...flight, airspeed: 12 } ).roll > 0.3 && wheelLevels( { ...flight, airspeed: 25 } ).roll > wheelLevels( { ...flight, airspeed: 12 } ).roll, 'rolling rises with ground speed' );
	ok( wheelLevels( { ...flight, airspeed: 12, controls: { brake: 1 } } ).brake > 0.8 && wheelLevels( { ...flight, airspeed: 1, controls: { brake: 1 } } ).brake === 0, 'a squeal under hard braking at speed, not when nearly stopped' );
	ok( wheelLevels( { ...flight, airspeed: 20, controls: { brake: 0.1 } } ).brake === 0, 'a light touch does not squeal' );
	ok( wheelLevels( { ...flight, airspeed: 20, airborne: true } ).roll === 0 && wheelLevels( { ...flight, airspeed: 20, onWater: true } ).roll === 0, 'airborne or on the water: no wheels' );
	ok( wheelLevels( { ...flight, geom: { wheels: null }, airspeed: 20 } ).roll === 0 && wheelLevels( null ).roll === 0, 'a floatplane has none' );
	ok( wheelLevels( { ...flight, airspeed: 12 } ).pitch > wheelLevels( { ...flight, airspeed: 4 } ).pitch, 'the squeal falls in pitch as the plane slows' );

	const w = makeWorld( { at: { x: 1650, z: 50 }, hour: 12 } );
	const f = { ...flight };
	w.features.add( 'seaplane', { install: () => ( { flight: f, piloted: true } ) } );
	run( w, 1 );
	ok( ! w.sfx.cues.nodes, 'the wheel loops are not built while the plane stands' );
	f.airspeed = 15;
	run( w, 1 );
	ok( !! w.sfx.cues.nodes && w.sfx.cues.nodes.roll.gain.target > 0.05, 'they are built when the wheels roll' );
	f.controls.brake = 1;
	run( w, 1 );
	const sq = w.sfx.cues.nodes.squeal.gain.target;
	ok( sq > 0.02, `and the brakes squeal (${ sq.toFixed( 3 ) })` );
	f.airborne = true;
	run( w, 1 );
	ok( w.sfx.cues.nodes.roll.gain.target === 0 && w.sfx.cues.nodes.squeal.gain.target === 0, 'lift-off silences them' );
	w.sfx.dispose();
	ok( ! w.sfx.cues.nodes, 'dispose stops the wheel loops' );

}

// ---------------------------------------------------------------------------------------------- the parachute

{

	const chute = { state: 'free', position: { x: 10, y: 80, z: 10 }, velocity: { x: 0, y: -30, z: 0 } };
	const w = makeWorld( { at: { x: 10, z: 10 } } );
	w.features.add( 'seaplane', { install: () => ( { chute, flight: null } ) } );
	run( w, 1 );
	ok( played( w, 'canopy_snap' ).length === 0, 'free fall: no canopy yet' );
	chute.state = 'open';
	chute.velocity.y = -5.5;
	run( w, 0.2 );
	ok( played( w, 'canopy_snap' ).length === 1, 'the canopy opens with a snap' );
	run( w, 14 );
	ok( played( w, 'chute_creak' ).length >= 2, `the lines creak while it hangs (${ played( w, 'chute_creak' ).length })` );
	ok( played( w, 'canopy_snap' ).length === 1, 'the snap is once per descent' );
	chute.state = 'landed';
	const c = played( w, 'chute_creak' ).length;
	run( w, 10 );
	ok( played( w, 'chute_creak' ).length === c, 'no creaking after landing' );

	// the chute cannot be read: the bail-out event stands in for the opening
	const w2 = makeWorld( { at: { x: 0, z: 0 } } );
	w2.features.emit( 'planeBailedOut', { x: 0, y: 100, z: 0 } );
	run( w2, 0.8 );
	ok( played( w2, 'canopy_snap' ).length === 0, 'the bail-out event alone waits for the canopy' );
	run( w2, 1 );
	ok( played( w2, 'canopy_snap' ).length === 1, 'then plays the snap when the chute cannot be read' );

}

// ---------------------------------------------------------------------------------------------- every cue builds

{

	const w = makeWorld( { at: { x: 0, z: 0 } } );
	let allOk = true, shortfall = [];
	for ( const name of Object.keys( CUES ) ) {

		w.ctx.currentTime += 20; // clear the voice limits
		w.ctx.made = {};
		const v = w.sfx.synth.play( name, { at: { x: 1, y: 1, z: 1 }, power: 1, strikes: 4, strain: 0.5, kind: 'low' } );
		if ( ! v || ! ( v.end > w.ctx.currentTime ) || ! ( w.ctx.made.osc || w.ctx.made.source ) ) { allOk = false; shortfall.push( name ); }

	}

	ok( allOk, 'every cue builds nodes and reports a length' + ( shortfall.length ? ' (not: ' + shortfall.join( ', ' ) + ')' : '' ) );
	ok( Object.values( CUES ).every( ( c ) => [ 'sfx', 'ambience' ].includes( c.cat ) && c.voices >= 1 && c.max > c.ref && c.gain > 0 && c.gain <= 1 ), 'cue table entries are well formed' );
	const sp = w.sfx.synth;
	ok( sp.distanceGain( 'battery_fire', 20 ) === 1 && sp.distanceGain( 'battery_fire', 2000 ) === 0 && sp.distanceGain( 'battery_fire', 200 ) < 1, 'distance gain: full inside ref, culled past max' );
	ok( sp.play( 'no_such_cue' ) === null, 'an unknown cue is null' );
	const sink = w.sfx.synth.player._sink( 'sfx' );
	ok( sink.node === w.audio.sfxAbove, 'sfx cues go to the sfx category node' );
	// the voice limit
	w.ctx.currentTime += 50;
	let started = 0;
	for ( let i = 0; i < 5; i ++ ) if ( sp.play( 'canopy_snap', { at: { x: 1, y: 1, z: 1 } } ) ) started ++;
	ok( started === CUES.canopy_snap.voices, `the voice limit holds (${ started })` );

}

// ---------------------------------------------------------------------------------------------- hour helper

{

	const a = { audio: { env: { hour: 7 } }, settings: { timeOfDay: 13 } };
	ok( hourOf( a ) === 7 && hourOf( { settings: { timeOfDay: 25 } } ) === 1 && hourOf( {} ) === 12 && hourOf( null ) === 12, 'hourOf: the sound scape, else the island clock, else noon' );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall ok' );
process.exitCode = fails ? 1 : 0;
