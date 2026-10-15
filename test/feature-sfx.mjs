// Plain-node test of the dynamic-audio feature (src/features/sfx): edge-triggered sounds play once, gain falls with
// distance, muted audio is silent, the category nodes are used, the slam hook is chained, nothing throws. A stand-in
// AudioContext records what is played; the files are checked on disk (present, small).
// usage: node test/feature-sfx.mjs
globalThis.location = globalThis.location || { search: '' };
const { readdirSync, statSync, existsSync } = await import( 'node:fs' );
const { Features } = await import( '../src/features/Features.js' );
const sfxModule = await import( '../src/features/sfx/index.js' );
const { FILES } = await import( '../src/features/sfx/SfxPlayer.js' );
const { G } = await import( '../src/core/Globals.js' );

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// ---------------------------------------------------------------------------------------------- stand-ins

const DURATION = { bran_workshop: 10, iona_workshop: 9.5, rigging_strain: 2.5, hull_groan: 4.5, sail_luff: 1.8, clown_prank: 1.7 };

class Param {

	constructor( v = 1 ) { this.value = v; this.ramps = 0; }
	setValueAtTime( v ) { this.value = v; }
	linearRampToValueAtTime() { this.ramps ++; }

}

class Node {

	constructor( kind, ctx ) {

		this.kind = kind;
		this.ctx = ctx;
		this.to = null;
		this.disconnected = false;

	}

	connect( d ) { this.to = d; return d; }
	disconnect() { this.disconnected = true; }

}

class FakeCtx {

	constructor() {

		this.currentTime = 0;
		this.state = 'running';
		this.destination = new Node( 'destination', this );
		this.sources = []; // every started source
		this.broken = false;

	}

	createGain() { const n = new Node( 'gain', this ); n.gain = new Param( 1 ); return n; }

	createPanner() {

		const n = new Node( 'panner', this );
		n.positionX = new Param( 0 ); n.positionY = new Param( 0 ); n.positionZ = new Param( 0 );
		return n;

	}

	createBufferSource() {

		if ( this.broken ) throw new Error( 'broken context' );
		const n = new Node( 'source', this );
		n.playbackRate = new Param( 1 );
		n.buffer = null;
		n.start = ( t ) => { n.startedAt = t; this.sources.push( n ); };
		n.stop = () => {};
		return n;

	}

	decodeAudioData( ab, res ) { const b = { duration: ab.duration, numberOfChannels: 1, name: ab.name }; res( b ); return Promise.resolve( b ); }

}

function makeAudio() {

	const ctx = new FakeCtx();
	const a = {
		ctx, muted: false, enabled: true, vols: { master: 0.8, sfx: 1, ambience: 1 },
		sfxAbove: new Node( 'sfxAbove', ctx ), ambAbove: new Node( 'ambAbove', ctx ), master: new Node( 'master', ctx ),
		env: { lx: 0, ly: 1.7, lz: 0 },
		getVolume( k ) { return this.vols[ k ]; },
	};
	return a;

}

const fetchStub = ( url ) => {

	const name = url.split( '/' ).pop().replace( '.ogg', '' );
	return Promise.resolve( { ok: true, arrayBuffer: () => Promise.resolve( { duration: DURATION[ name ] || 0.5, name } ) } );

};

const tick = () => new Promise( ( r ) => setTimeout( r, 0 ) );

function makeWorld( { sailing = false, audio = makeAudio() } = {} ) {

	const app = {
		audio,
		player: { mode: 'walk', position: { x: 0, y: 0, z: 0 }, launched: 0 },
		game: { fight: null, bite: null, rod: { state: 'idle' }, state: { boat: sailing ? 'cutter' : 'skiff' } },
		boatCtl: { position: { x: 4, y: 0, z: 3 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, angular: { x: 0, y: 0, z: 0 }, speed: 0, onSlam: null },
		residents: { list: [] },
	};
	const features = new Features( app );
	app.features = features;
	const sfx = features.add( 'sfx', { install: ( a, f ) => sfxModule.install( a, f, { player: new sfxModule.SfxPlayer( a, { fetchImpl: fetchStub } ) } ) } );
	return { app, features, sfx, audio, ctx: audio ? audio.ctx : null };

}

async function loadAll( w ) {

	await w.sfx.player.preload( Object.keys( FILES ) );
	await tick();

}

function run( w, seconds, dt = 1 / 30, each = null ) {

	const n = Math.round( seconds / dt );
	for ( let i = 0; i < n; i ++ ) {

		w.ctx.currentTime += dt;
		if ( each ) each( i );
		w.features.update( dt );

	}

}

const count = ( w, name ) => w.sfx.player.played.filter( ( p ) => p.name === name ).length;
const last = ( w, name ) => w.sfx.player.played.filter( ( p ) => p.name === name ).pop();
const reset = ( w ) => { w.sfx.player.played.length = 0; };

// ---------------------------------------------------------------------------------------------- files

{

	const dir = new URL( '../public/audio/sfx/', import.meta.url );
	const files = readdirSync( dir ).filter( ( f ) => f.endsWith( '.ogg' ) );
	ok( Object.keys( FILES ).every( ( n ) => existsSync( new URL( n + '.ogg', dir ) ) ), 'every sound of the bank has its ogg file' );
	ok( files.every( ( f ) => FILES[ f.replace( '.ogg', '' ) ] ), 'no stray ogg files' );
	const total = files.reduce( ( s, f ) => s + statSync( new URL( f, dir ) ).size, 0 );
	ok( total < 200 * 1024 && files.every( ( f ) => statSync( new URL( f, dir ) ).size < 60 * 1024 ), `files are small (${ Math.round( total / 1024 ) } KB total)` );

}

// ---------------------------------------------------------------------------------------------- no audio

{

	const w = makeWorld( { audio: null } );
	w.app.audio = null;
	let threw = false;
	try {

		w.app.game.fight = { tension: 0.9, state: 'fighting' };
		for ( let i = 0; i < 60; i ++ ) w.features.update( 1 / 30 );
		ok( w.sfx.play( 'thwack' ) === null, 'no audio: play returns null' );

	} catch ( e ) { threw = true; }

	ok( ! threw, 'no audio: updates do not throw' );

}

// ---------------------------------------------------------------------------------------------- lazy decode

{

	const w = makeWorld();
	ok( w.sfx.play( 'thwack' ) === null && ! w.sfx.player.has( 'thwack' ), 'a sound that is not decoded yet is skipped' );
	await tick(); await tick();
	ok( w.sfx.player.has( 'thwack' ), 'the skipped play started the lazy load' );
	ok( !! w.sfx.play( 'thwack' ), 'then it plays' );
	ok( ! w.sfx.player.has( 'splinter' ), 'sounds nobody asked for stay undecoded' );

}

// ---------------------------------------------------------------------------------------------- fishing

{

	const w = makeWorld();
	await loadAll( w );
	const g = w.app.game;
	// a nibble then a take
	g.bite = { phase: 'wait', t: 3 };
	run( w, 0.5 );
	g.bite = { phase: 'take', t: 1 };
	run( w, 0.5 );
	ok( count( w, 'thwack' ) === 0 && count( w, 'thud' ) === 0, 'waiting and a take make no strike sound' );
	// clean strike: Game.strike() clears the bite and creates the fight in one go
	g.bite = null;
	g.fight = { tension: 0.3, state: 'fighting' };
	run( w, 0.1 );
	ok( count( w, 'thwack' ) === 1, 'hooking a fish plays the thwack once' );
	run( w, 1 );
	ok( count( w, 'thwack' ) === 1 && count( w, 'thud' ) === 0, 'the fight going on does not retrigger it' );

	// line creaks: more often and higher with tension
	reset( w );
	g.fight.tension = 0.2;
	run( w, 4 );
	ok( count( w, 'line_creak' ) === 0, 'a slack line does not creak' );
	g.fight.tension = 0.5;
	run( w, 8 );
	const mid = count( w, 'line_creak' );
	const midRate = mid ? last( w, 'line_creak' ).rate : 0;
	reset( w );
	g.fight.tension = 1.0;
	run( w, 8 );
	const hi = count( w, 'line_creak' );
	const hiRate = hi ? last( w, 'line_creak' ).rate : 0;
	ok( mid >= 1 && hi > mid * 1.8, `creaks come faster as tension climbs (${ mid } at 0.5, ${ hi } at 1.0 in 8 s)` );
	ok( hiRate > midRate + 0.2, `and higher (rate ${ midRate.toFixed( 2 ) } -> ${ hiRate.toFixed( 2 ) })` );

	// the fish escapes (hook thrown): a thud
	reset( w );
	const f = g.fight;
	f.state = 'escaped';
	g.fight = null;
	run( w, 0.1 );
	ok( count( w, 'thud' ) === 1 && count( w, 'thwack' ) === 0, 'a thrown hook plays the dull thud once' );

	// a missed take: the bite times out into a new wait
	reset( w );
	run( w, 1 );
	g.bite = { phase: 'take', t: 0.5 };
	run( w, 0.3 );
	g.bite = { phase: 'wait', t: 6 };
	run( w, 0.3 );
	ok( count( w, 'thud' ) === 1, 'a take that ran out plays the thud' );
	run( w, 2 );
	ok( count( w, 'thud' ) === 1, 'and only once' );

	// cancelled line (mode change): no sound
	reset( w );
	g.bite = { phase: 'take', t: 0.5 };
	run( w, 0.3 );
	g.bite = null;
	run( w, 0.3 );
	ok( count( w, 'thud' ) === 0, 'cancelling the line is not a miss' );

	// an explicit miss event, and the dedupe window
	run( w, 1 );
	w.features.emit( 'strikeMissed' );
	w.features.emit( 'strikeMissed' );
	ok( count( w, 'thud' ) === 1, 'strikeMissed plays one thud (duplicates within a moment are merged)' );

	// caught: nothing from this layer
	reset( w );
	g.fight = { tension: 0.4, state: 'fighting' };
	run( w, 0.1 );
	const c = g.fight;
	c.state = 'caught';
	g.fight = null;
	run( w, 0.1 );
	ok( count( w, 'thud' ) === 0, 'landing a fish plays no thud' );

}

// ---------------------------------------------------------------------------------------------- ship

const quatY = ( deg ) => ( { x: 0, y: Math.sin( deg * Math.PI / 360 ), z: 0, w: Math.cos( deg * Math.PI / 360 ) } );

{

	// ambience only when aboard; rigging only on sail boats
	const w = makeWorld( { sailing: true } );
	await loadAll( w );
	w.features.add( 'weather', { install: () => ( { wind: 12 } ) } );
	G.windDir.value.set( 1, 0 );
	w.app.boatCtl.quaternion = quatY( 90 ); // bow along +x: downwind
	run( w, 30 );
	ok( count( w, 'rigging_strain' ) === 0 && count( w, 'hull_groan' ) === 0, 'ashore: no ship ambience' );
	w.app.player.mode = 'deck';
	run( w, 40 );
	const rig = count( w, 'rigging_strain' );
	ok( rig >= 3, `aboard a sail boat in wind the rigging strains (${ rig } in 40 s)` );
	ok( last( w, 'rigging_strain' ).gain > 0.2, 'at a real level' );
	ok( count( w, 'sail_luff' ) === 0, 'running downwind: no luffing' );

	// head to wind: luffing
	w.app.boatCtl.quaternion = quatY( - 90 ); // bow along -x, into a wind blowing towards +x
	reset( w );
	run( w, 8 );
	const luff = count( w, 'sail_luff' );
	ok( luff >= 4, `head to wind the canvas luffs (${ luff } in 8 s)` );
	// lighter wind: quieter or none
	w.features.get( 'weather' ).wind = 1.5;
	reset( w );
	run( w, 8 );
	ok( count( w, 'sail_luff' ) === 0, 'in a calm there is no luffing' );

	// more wind and more speed: stronger and more frequent rigging strain
	w.features.get( 'weather' ).wind = 4;
	reset( w );
	run( w, 120 );
	const calmRig = count( w, 'rigging_strain' );
	w.features.get( 'weather' ).wind = 16;
	w.app.boatCtl.speed = 7;
	reset( w );
	run( w, 120 );
	const gale = count( w, 'rigging_strain' );
	ok( gale > calmRig, `the rigging strains more in a fresh wind (${ calmRig } -> ${ gale } in 120 s)` );

	// positional: the mast head, near the listener
	ok( last( w, 'rigging_strain' ).dist < 6, 'it sounds at the boat' );

}

{

	// no rigging on a motor boat, but hull groans from roll and slams
	const w = makeWorld( { sailing: false } );
	await loadAll( w );
	w.app.player.mode = 'boat';
	let slamSeen = 0;
	w.app.boatCtl.onSlam = ( s ) => { slamSeen += s; };
	run( w, 1 );
	ok( w.app.boatCtl.onSlam !== null && w.app.boatCtl.onSlam.name !== '' || typeof w.app.boatCtl.onSlam === 'function', 'the slam hook is chained' );
	w.app.boatCtl.onSlam( 0.5 );
	ok( slamSeen === 0.5, 'the original slam hook (hull slap) still runs' );
	// the App replaces the hook: it is chained again
	w.app.boatCtl.onSlam = ( s ) => { slamSeen += s * 10; };
	run( w, 0.2 );
	w.app.boatCtl.onSlam( 0.1 );
	ok( Math.abs( slamSeen - 1.5 ) < 1e-9 && w.sfx.ship.slams === 2, 'a replaced hook is chained again and every slam is counted' );

	reset( w );
	run( w, 60 );
	ok( count( w, 'rigging_strain' ) === 0 && count( w, 'sail_luff' ) === 0, 'a motor boat has no rigging' );
	ok( count( w, 'hull_groan' ) === 0, 'a flat calm: no groans' );

	// rolling: stress builds, groans play, louder when rougher
	w.app.boatCtl.angular = { x: 0.1, y: 0, z: 0.45 };
	run( w, 30 );
	const gA = count( w, 'hull_groan' );
	ok( gA >= 2, `rolling makes the hull groan (${ gA } in 30 s)` );
	reset( w );
	for ( let i = 0; i < 6; i ++ ) { w.app.boatCtl.onSlam( 1 ); run( w, 1 ); }
	run( w, 20 );
	ok( count( w, 'hull_groan' ) >= 1, 'slams make it groan' );
	const loud = Math.max( ...w.sfx.player.played.filter( ( p ) => p.name === 'hull_groan' ).map( ( p ) => p.gain ) );
	ok( loud > 0.4, 'louder under heavy slamming' );

	// damage: splinters, scaled by the hit; a hurt hull groans soon
	reset( w );
	w.app.boatCtl.angular = { x: 0, y: 0, z: 0 };
	run( w, 10 );
	reset( w );
	w.features.emit( 'playerBoatDamaged', { hp: 90, maxHp: 100, cause: 'cannon' } );
	w.features.emit( 'playerBoatDamaged', { hp: 40, maxHp: 100, cause: 'cannon' } );
	run( w, 4 );
	ok( count( w, 'splinter' ) === 2, 'each hit plays wood splinters' );
	const sp = w.sfx.player.played.filter( ( p ) => p.name === 'splinter' );
	ok( sp[ 1 ].gain > sp[ 0 ].gain, 'a bigger hit splinters louder' );
	ok( count( w, 'hull_groan' ) >= 1, 'a hull below half groans after the hit' );

	// cannon reload
	reset( w );
	const nv = { reloadLeft: { port: 0, starboard: 0 } };
	w.features.add( 'naval', { install: () => nv } );
	run( w, 0.5 );
	nv.reloadLeft.port = 3;
	run( w, 1 );
	ok( count( w, 'cannon_reload' ) === 0, 'while reloading: no clank yet' );
	nv.reloadLeft.port = 0;
	run( w, 0.2 );
	ok( count( w, 'cannon_reload' ) === 1, 'reload complete: one clank' );
	run( w, 2 );
	ok( count( w, 'cannon_reload' ) === 1, 'and only once' );
	nv.reloadLeft.starboard = 2;
	run( w, 0.1 );
	nv.reloadLeft.starboard = 0;
	run( w, 0.1 );
	ok( count( w, 'cannon_reload' ) === 2, 'the other side too' );

	// dispose restores the original hook
	const before = w.app.boatCtl.onSlam;
	w.features.dispose();
	ok( w.app.boatCtl.onSlam !== before, 'dispose removes the slam chain' );

}

// ---------------------------------------------------------------------------------------------- folk

{

	const w = makeWorld();
	await loadAll( w );
	const clown = { id: 'clownCabin', name: 'The Clown', x: 6, y: 0, z: 0, prank: true, state: 'idle', gesture: null, base: 'Idle', data: { prank: true } };
	w.app.residents.list = [ clown ];
	run( w, 1 );
	ok( count( w, 'clown_prank' ) === 0, 'no prank, no voice line' );
	w.app.player.launched = 0.9;
	run( w, 0.1 );
	w.app.player.launched = 0.8;
	run( w, 0.5 );
	w.app.player.launched = 0;
	run( w, 0.5 );
	ok( count( w, 'clown_prank' ) === 1, 'the launch plays the clown line once' );
	const cp = last( w, 'clown_prank' );
	ok( cp.at && cp.at.x === 6 && cp.dist > 5 && cp.dist < 7, 'at the clown, not at the player' );
	run( w, 2 );
	w.app.player.launched = 0.9;
	run( w, 0.2 );
	ok( count( w, 'clown_prank' ) === 2, 'a second shove plays it again' );
	w.app.player.launched = 0;

	// workshop lines: positional, near a working resident, one at a time, alternating
	reset( w );
	const sweeper = { id: 'pepeSweeper', x: 10, y: 0, z: 0, state: 'pause', gesture: 'Sweep_Work', base: 'Idle', data: {} };
	const idler = { id: 'idler', x: 12, y: 0, z: 2, state: 'idle', gesture: null, base: 'Idle_Breathe', data: {} };
	const farWorker = { id: 'far', x: 200, y: 0, z: 0, state: 'pause', gesture: 'Sweep_Work', base: 'Idle', data: {} };
	w.app.residents.list = [ idler, farWorker ];
	w.sfx.folk.nextT = 0;
	run( w, 20 );
	ok( count( w, 'bran_workshop' ) + count( w, 'iona_workshop' ) === 0, 'idlers and far workers do not speak' );
	w.app.residents.list = [ idler, farWorker, sweeper ];
	w.sfx.folk.nextT = 0;
	run( w, 5 );
	const first = [ 'bran_workshop', 'iona_workshop' ].filter( ( n ) => count( w, n ) === 1 );
	ok( first.length === 1, 'a working resident in range speaks a workshop line' );
	const wl = last( w, first[ 0 ] );
	ok( wl.at.x === 10 && wl.gain > 0.1 && wl.gain < 0.85, `positionally, with distance gain (${ wl.gain.toFixed( 2 ) } at ${ wl.dist.toFixed( 1 ) } m)` );
	ok( w.sfx.folk.nextT > 35, 'the next one is 40+ s away' );
	w.sfx.folk.nextT = 0;
	run( w, 3 );
	ok( count( w, 'bran_workshop' ) + count( w, 'iona_workshop' ) === 1, 'never over its own line' );
	run( w, 20 );
	const second = [ 'bran_workshop', 'iona_workshop' ].filter( ( n ) => count( w, n ) === 1 );
	ok( second.length === 2, 'the next line is the other voice' );
	// the resident was one pace outside the range
	sweeper.x = 40;
	w.sfx.folk.nextT = 0;
	reset( w );
	run( w, 30 );
	ok( count( w, 'bran_workshop' ) + count( w, 'iona_workshop' ) === 0, 'out of hearing range: silence' );

}

// ---------------------------------------------------------------------------------------------- distance, categories, mute

{

	const w = makeWorld();
	await loadAll( w );
	const near = w.sfx.play( 'splinter', { at: { x: 5, y: 1.7, z: 0 } } );
	const mid = w.sfx.play( 'splinter', { at: { x: 40, y: 1.7, z: 0 }, gain: 1 } );
	const far = w.sfx.play( 'splinter', { at: { x: 400, y: 1.7, z: 0 } } );
	ok( near && mid && near.gain > mid.gain * 3, `gain falls with distance (${ near && near.gain.toFixed( 2 ) } at 5 m, ${ mid && mid.gain.toFixed( 2 ) } at 40 m)` );
	ok( far === null, 'past the audible range: not played' );
	ok( near.src.to && near.src.to.kind === 'gain' && near.node.to.kind === 'panner' && near.node.to.to === w.audio.sfxAbove, 'sfx sounds go source > gain > panner > the SoundScape sfx path' );
	const a = w.sfx.play( 'hull_groan', { at: { x: 1, y: 1, z: 0 } } );
	ok( a && a.node.to.to === w.audio.ambAbove, 'ship ambience goes to the ambience path' );
	const head = w.sfx.play( 'thud' );
	ok( head && head.node.to === w.audio.sfxAbove && head.dist === 0, 'a sound without a position is heard in the head, at full gain' );
	const pn = near.node.to;
	ok( pn.positionX.value === 5 && pn.positionZ.value === 0, 'the panner sits at the source' );

	// the listener moves: the same source is quieter
	w.audio.env.lx = 30;
	w.ctx.currentTime += 5;
	const moved = w.sfx.play( 'splinter', { at: { x: 5, y: 1.7, z: 0 } } );
	ok( moved && moved.gain < near.gain * 0.5, 'distance is measured from the listener of the SoundScape' );
	w.audio.env.lx = 0;

	// voice limits
	w.ctx.currentTime += 10;
	const clowns = [ w.sfx.play( 'clown_prank' ), w.sfx.play( 'clown_prank' ) ];
	ok( clowns[ 0 ] && ! clowns[ 1 ], 'a single-voice sound does not stack on itself' );

	// muted / master zero / disabled
	w.ctx.currentTime += 10;
	w.audio.muted = true;
	ok( w.sfx.play( 'thud' ) === null, 'muted: silence' );
	w.audio.muted = false;
	w.audio.vols.master = 0;
	ok( w.sfx.play( 'thud' ) === null, 'master volume 0: silence' );
	w.audio.vols.master = 0.8;
	w.audio.enabled = false;
	ok( w.sfx.play( 'thud' ) === null, 'audio not enabled (suspended context): silence' );
	w.audio.enabled = true;
	w.ctx.state = 'suspended';
	ok( w.sfx.play( 'thud' ) === null, 'a suspended context: silence' );
	w.ctx.state = 'running';
	ok( !! w.sfx.play( 'thud' ), 'and back on' );

	// muted during gameplay: edges consume no sounds
	w.audio.muted = true;
	reset( w );
	w.app.game.fight = { tension: 1, state: 'fighting' };
	run( w, 3 );
	ok( w.sfx.player.played.length === 0, 'muted: a whole fight plays nothing' );
	w.audio.muted = false;

	// a bare context (no SoundScape nodes) gets the volumes applied here
	const bare = makeWorld( { audio: { ctx: new FakeCtx(), muted: false, vols: { master: 0.5, sfx: 0.5, ambience: 1 }, getVolume( k ) { return this.vols[ k ]; } } } );
	await loadAll( bare );
	const bv = bare.sfx.play( 'thud' );
	ok( bv && Math.abs( bv.gain - FILES.thud.gain * 0.25 * 0.25 ) < 1e-9 && bv.node.to === bare.audio.ctx.destination, 'a bare context: the master and sfx volumes are applied here' );

	// a broken context never throws
	w.ctx.broken = true;
	let threw = false;
	try { w.sfx.play( 'thud' ); run( w, 1 ); w.features.emit( 'playerBoatDamaged', { hp: 1, maxHp: 100 } ); } catch ( e ) { threw = true; }
	ok( ! threw, 'a context that throws is survived' );
	w.ctx.broken = false;

	// bad state values never throw
	w.app.game.fight = { tension: NaN, state: 'fighting' };
	w.app.boatCtl.angular = { x: NaN, y: 0, z: undefined };
	w.app.player.launched = undefined;
	w.app.player.mode = 'deck';
	threw = false;
	try { run( w, 2 ); } catch ( e ) { threw = true; }
	ok( ! threw && w.sfx.failed.size === 0, 'garbage state does not throw or disable a part' );

}

// ---------------------------------------------------------------------------------------------- wave 13C parts (test/feature-ambience.mjs has the detail)

{

	const w = makeWorld();
	ok( !! w.sfx.places && !! w.sfx.cues && !! w.sfx.synth, 'the place beds, the event cues and the synth player are part of the feature' );
	// this stand-in context has no oscillators: the synthesised parts stay quietly out of it
	let threw = false;
	try {

		w.app.audio.env.lx = 1840; w.app.audio.env.lz = - 24; w.app.audio.env.hour = 12;
		run( w, 2 );
		w.features.emit( 'strongholdClaimed', {} );
		w.features.emit( 'cannonFired', { x: 0, y: 1, z: 0, by: 'pirate' } );
		w.features.emit( 'explosion', { x: 0, y: 1, z: 0, by: 'powder' } );
		w.features.emit( 'planeBailedOut', { x: 0, y: 90, z: 0 } );
		run( w, 3 );

	} catch ( e ) { threw = true; }

	ok( ! threw && w.sfx.synth.count === 0 && w.sfx.places.bedNodes().length === 0 && w.sfx.failed.size === 0, 'synthesised cues and beds are skipped without oscillators, nothing throws' );
	ok( count( w, 'thwack' ) === 0 && w.sfx.player.played.length === 0, 'and the sample bank is untouched by them' );
	w.sfx.reset();
	w.sfx.dispose();
	ok( true, 'reset and dispose are safe' );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall ok' );
process.exit( fails ? 1 : 0 );
