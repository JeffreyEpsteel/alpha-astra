// Plain-node test of wave 20B's sounds (src/features/sfx: Voices.js, EventSounds.js, the SynthPlayer's limits): every
// inventoried event has a sound and plays it, the voice limits hold (fewer on a phone), the synth's budget caps a battle,
// far guns arrive late by the speed of sound, a wall between a sound and the listener occludes it, the loops build and
// drop, nothing throws without audio. A stand-in AudioContext with oscillators, filters and buffers records the graph.
// usage: node test/feature-sfx-w20.mjs
globalThis.location = globalThis.location || { search: '' };
const { Features } = await import( '../src/features/Features.js' );
const sfxModule = await import( '../src/features/sfx/index.js' );
const { CUES, INVENTORY, LOOPS, VOICES, VOICE_CAP, voiceLimit, SfxPlayer } = sfxModule;

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// ---------------------------------------------------------------------------------------------- stand-ins

class Param {

	constructor( v = 1 ) { this.value = v; this.events = 0; }
	setValueAtTime( v ) { this.value = v; this.events ++; }
	linearRampToValueAtTime( v ) { this.value = v; this.events ++; }
	exponentialRampToValueAtTime( v ) { if ( ! ( v > 0 ) ) throw new RangeError( 'exponential ramp to ' + v ); this.value = v; this.events ++; }
	setTargetAtTime( v ) { this.value = v; this.events ++; }

}

class Node {

	constructor( kind, ctx ) { this.kind = kind; this.ctx = ctx; this.outs = []; this.disconnected = false; ctx.nodes ++; }
	connect( d ) { this.outs.push( d ); return d; }
	disconnect() { this.disconnected = true; }

}

class FakeCtx {

	constructor() {

		this.currentTime = 0;
		this.sampleRate = 8000;
		this.state = 'running';
		this.destination = new Node( 'destination', this );
		this.nodes = 0;
		this.started = 0;

	}

	createGain() { const n = new Node( 'gain', this ); n.gain = new Param( 1 ); return n; }
	createBiquadFilter() { const n = new Node( 'filter', this ); n.frequency = new Param( 350 ); n.Q = new Param( 1 ); n.type = 'lowpass'; return n; }
	createPanner() { const n = new Node( 'panner', this ); n.positionX = new Param( 0 ); n.positionY = new Param( 0 ); n.positionZ = new Param( 0 ); return n; }
	createOscillator() {

		const n = new Node( 'osc', this );
		n.frequency = new Param( 440 );
		n.type = 'sine';
		n.start = () => { this.started ++; };
		n.stop = () => {};
		return n;

	}

	createBufferSource() {

		const n = new Node( 'source', this );
		n.playbackRate = new Param( 1 );
		n.start = () => { this.started ++; };
		n.stop = () => {};
		return n;

	}

	createBuffer( ch, len, sr ) { const d = new Float32Array( len ); return { length: len, sampleRate: sr, duration: len / sr, getChannelData: () => d }; }
	decodeAudioData( ab, res ) { const b = { duration: 0.5 }; res( b ); return Promise.resolve( b ); }

}

function makeAudio() {

	const ctx = new FakeCtx();
	return {
		ctx, muted: false, enabled: true, vols: { master: 0.8, sfx: 1, ambience: 1 },
		sfxAbove: new Node( 'sfxAbove', ctx ), ambAbove: new Node( 'ambAbove', ctx ), master: new Node( 'master', ctx ),
		env: { lx: 0, ly: 1.7, lz: 0 },
		getVolume( k ) { return this.vols[ k ]; },
	};

}

// a tavern 10 x 10 m centred on (50, 0), its hearth at (53, 0), the door's sill at (50, 5)
function makeRooms() {

	const room = { id: 'tidemark.tavern', floorY: 0, destroyed: false, R: { pieces: [ { piece: 'hearth', x: 3, z: 0 } ] } };
	return {
		room,
		rooms: {
			list: [ room ], byId: new Map( [ [ room.id, room ] ] ),
			contains: ( r, x, y, z, pad = 0 ) => Math.abs( x - 50 ) <= 5 + pad && Math.abs( z ) <= 5 + pad && y >= - 0.6 && y <= 3.2,
			world: ( r, lx, lz ) => ( { x: 50 + lx, z: lz } ),
			door: () => ( { x: 50, z: 6.5, sill: { x: 50, z: 5 } } ),
		},
	};

}

function makeWorld( { audio = makeAudio(), stubs = {} } = {} ) {

	const app = {
		audio,
		settings: { timeOfDay: 12 },
		player: { mode: 'walk', position: { x: 0, y: 0, z: 0 }, launched: 0 },
		game: { fight: null, bite: null, rod: { state: 'idle' }, state: { boat: 'skiff' } },
		boatCtl: { position: { x: 4, y: 0, z: 3 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, angular: { x: 0, y: 0, z: 0 }, speed: 0, onSlam: null },
		residents: { list: [] },
	};
	const features = new Features( app );
	app.features = features;
	for ( const [ name, inst ] of Object.entries( stubs ) ) features.add( name, { install: () => inst } );
	const sfx = features.add( 'sfx', { install: ( a, f ) => sfxModule.install( a, f, { player: new SfxPlayer( a, { fetchImpl: () => Promise.resolve( { ok: true, arrayBuffer: () => Promise.resolve( {} ) } ) } ) } ) } );
	return { app, features, sfx, audio, ctx: audio ? audio.ctx : null, ev: sfx.events };

}

function run( w, seconds, dt = 1 / 30, each = null ) {

	const n = Math.round( seconds / dt );
	for ( let i = 0; i < n; i ++ ) {

		if ( w.ctx ) w.ctx.currentTime += dt;
		if ( each ) each( i );
		w.features.update( dt );

	}

}

const played = ( w, name ) => w.sfx.synth.played.filter( ( p ) => p.name === name );
const lastOf = ( w, name ) => played( w, name ).pop();

// ---------------------------------------------------------------------------------------------- the inventory

{

	ok( INVENTORY.length >= 30, `the inventory lists ${ INVENTORY.length } actions` );
	ok( INVENTORY.every( ( r ) => r.event && r.sound && r.source ), 'every row names its event, sound and source' );
	ok( INVENTORY.every( ( r ) => ( ! r.cue || CUES[ r.cue ] ) && ( ! r.also || CUES[ r.also ] ) && ( ! r.loop || LOOPS[ r.loop ] ) ), 'every cue and loop of the inventory exists' );
	const need = [ 'cutlass', 'axe', 'pin', 'harpoon gun', 'bomb', 'fire bottle', 'smoke', 'swivel', 'blunderbuss', 'rifle', 'reload', 'hail', 'broadside',
		'drums', 'gust', 'rain', 'roof', 'thunder', 'waterspout', 'tavern', 'hearth', 'creaking', 'door', 'bucket', 'pump', 'dice', 'snoring', 'market', 'gulls', 'dogs', 'wet sand' ];
	const missing = need.filter( ( k ) => ! INVENTORY.some( ( r ) => r.event.toLowerCase().includes( k ) ) );
	ok( ! missing.length, 'the brief\'s list is covered' + ( missing.length ? ': missing ' + missing.join( ', ' ) : '' ) );

}

// ---------------------------------------------------------------------------------------------- every voice builds

{

	const ctx = new FakeCtx();
	let bad = [];
	for ( const [ name, def ] of Object.entries( VOICES ) ) {

		try {

			const out = ctx.createGain();
			const d = def.build( ctx, out, 1, { kind: 'water', k: 0.7, hiss: true, size: 1, n: 2, power: 1 } );
			if ( ! ( d > 0 && d < 10 ) ) bad.push( name + ' (length ' + d + ')' );
			if ( ! def.gap || ! def.voices || ! ( def.max > def.ref ) ) bad.push( name + ' (limits)' );

		} catch ( e ) { bad.push( name + ': ' + e.message ); }

	}

	ok( ! bad.length, `the ${ Object.keys( VOICES ).length } new voices build on the context` + ( bad.length ? ': ' + bad.join( '; ' ) : '' ) );
	for ( const k of [ 'stone', 'ship', 'raider' ] ) VOICES.bullet_hit.build( ctx, ctx.createGain(), 1, { kind: k } );
	ok( true, 'bullet_hit builds every kind' );
	let loopBad = [];
	for ( const [ id, def ] of Object.entries( LOOPS ) ) {

		try { const m = def.build( ctx, ctx.createGain() ); if ( ! m.sources.length ) loopBad.push( id ); } catch ( e ) { loopBad.push( id + ': ' + e.message ); }

	}

	ok( ! loopBad.length, 'every loop builds' + ( loopBad.length ? ': ' + loopBad.join( '; ' ) : '' ) );

}

// ---------------------------------------------------------------------------------------------- events -> sounds

{

	const { rooms, room } = makeRooms();
	const stubs = {
		melee: { combat: { stats: { hits: 0 } } },
		weapons: { hand: null, fires: [] },
		naval: { fireState: { burning: false, level: 0 }, flood: 0, _channel: null, ships: [ { id: 's1', x: 30, z: 0, fire: { burning: false } } ] },
		navy: { ships: new Map( [ [ 'n1', { id: 'n1', x: 100, z: 0, alive: true, navy: { foe: null } } ] ] ) },
		weather: { wind: 6, gust: { x: 1, z: 0, speed: 0 }, spout: null },
		interiors: { rooms, inside: null, muffle: 0 },
		crew: { _acts: new Map(), deck: null },
		townlife: { towns: [ { plan: { id: 'home', stalls: [ { x: 0, z: 5 } ], skiffs: [ { dock: { x: 0, z: 20 } } ] } } ], animals: { list: [ { kind: 'dog', x: 10, y: 0, z: 0, state: 'idle', scale: 1 } ] } },
	};
	const w = makeWorld( { stubs } );
	const f = w.features, c = () => w.ev.counts;
	run( w, 0.5 );

	// melee: the swing at once, the blow once melee counted a hit
	f.emit( 'meleeHit', { x: 1, y: 1, z: 0, by: 'player', weapon: 'cutlass' } );
	ok( c().blade_swing === 1, 'a cutlass swing hisses' );
	stubs.melee.combat.stats.hits ++;
	run( w, 0.1 );
	ok( c().blade_hit === 1, 'and its blow bites when it lands' );
	run( w, 0.5 );
	f.emit( 'meleeHit', { x: 1, y: 1, z: 0, by: 'player', weapon: 'axe' } );
	run( w, 0.5 );
	ok( c().axe_swing === 1 && ! c().axe_hit, 'an axe that whiffs chops the air only' );
	f.emit( 'meleeHit', { x: 1, y: 1, z: 0, by: 'player', weapon: 'pin' } );
	stubs.melee.combat.stats.hits ++;
	run( w, 0.1 );
	ok( c().pin_swing === 1 && c().pin_hit === 1, 'the belaying pin whips and knocks' );
	f.emit( 'meleeHit', { x: 1, y: 1, z: 0, by: 'player', weapon: 'harpoon' } );
	ok( c().harpoon_jab === 1, 'the harpoon jabs' );
	f.emit( 'meleeHit', { x: 1, y: 1, z: 0, by: 'player', weapon: 'paddle' } );
	f.emit( 'meleeHit', { x: 1, y: 1, z: 0, by: 'raider', weapon: 'cutlass' } );
	ok( c().blade_swing === 1, 'the paddle keeps melee\'s own samples; others\' swings are melee\'s' );

	// guns
	for ( const kind of [ 'water', 'ship', 'raider', 'rock' ] ) { f.emit( 'gunHit', { weapon: 'rifle', kind, x: 8, y: 1, z: 0 } ); run( w, 0.1 ); }
	ok( c().bullet_hit === 4, 'bullet impacts sound on water, wood, flesh and stone' );
	f.emit( 'gunHarpoon', { kind: 'fish', x: 6, y: 0, z: 0 } );
	ok( c().harpoon_strike === 1, 'the harpoon gun\'s iron strikes home' );
	stubs.weapons.hand = 'swivel';
	f.emit( 'cannonFired', { x: 2, y: 2, z: 0, by: 'player', dir: { x: 1, y: 0, z: 0 } } );
	ok( c().swivel_bark === 1, 'the swivel gun barks over the cannon' );
	stubs.weapons.hand = null;
	run( w, 0.5 );
	f.emit( 'cannonFired', { x: 2, y: 2, z: 0, by: 'player' } );
	ok( c().swivel_bark === 1 && ! c().distant_gun, 'a near great gun: no swivel crack, no far roll' );

	// far broadsides arrive late
	f.emit( 'cannonFired', { x: 1372, y: 2, z: 0, by: 'pirate', owner: 'navy' } );
	const dg = lastOf( w, 'distant_gun' );
	ok( c().distant_gun === 1 && dg && Math.abs( dg.delay - 4 ) < 0.05, `a frigate's broadside 1.4 km off rolls in ${ dg && dg.delay.toFixed( 2 ) } s later` );
	ok( dg && dg.gain < CUES.distant_gun.gain * 0.1, 'and quietly, by its distance' );

	// ships: fire, water, masts
	f.emit( 'fireStarted', { id: 's1', x: 30, z: 0 } );
	f.emit( 'shipFlooded', { id: 'player' } );
	f.emit( 'mastFell', { id: 's1', x: 30, z: 0 } );
	f.emit( 'fireOut', { id: 's1', doused: true } );
	ok( c().fire_whoomph === 1 && c().flood_rush === 1 && c().mast_crack === 1 && c().bucket_slosh === 1, 'fire catching, flooding, a mast falling, a fire doused each sound' );
	stubs.naval.fireState = { burning: true, level: 0.7 };
	stubs.naval.flood = 0.3;
	stubs.naval._channel = { kind: 'pump' };
	stubs.naval.ships[ 0 ].fire = { burning: true, level: 0.5 };
	stubs.weapons.fires = [ { x: 3, y: 0, z: 1 } ];
	const crackles = c().fire_crackle || 0, pumps = c().pump_stroke || 0;
	run( w, 4 );
	ok( ( c().fire_crackle || 0 ) - crackles >= 4, 'the burning deck, the fire pool and the burning pirate crackle' );
	ok( ( c().pump_stroke || 0 ) - pumps >= 2, 'the pump strokes while the player mans it' );
	ok( w.ev.loops.beds.has( 'shipfire' ) && w.ev.loops.beds.has( 'bilge' ), 'the deck fire roars and the bilge sloshes (loops)' );
	stubs.naval.fireState = { burning: false, level: 0 };
	stubs.naval.flood = 0;
	stubs.naval._channel = null;
	stubs.naval.ships[ 0 ].fire = { burning: false };
	stubs.weapons.fires = [];
	run( w, 8 );
	ok( ! w.ev.loops.beds.has( 'shipfire' ) && ! w.ev.loops.beds.has( 'bilge' ), 'the loops drop once silent' );

	// the navy
	f.emit( 'navyHail', { ship: 'HMS Tern', say: 'hail' } );
	const hv = lastOf( w, 'heave_to' );
	ok( c().bosun_call === 1 && c().heave_to === 1 && hv && hv.delay === 1.5, 'a hail: the bosun\'s pipe, then "Heave to!"' );
	ok( hv && Math.abs( hv.at.x - 100 ) < 1e-6, 'from the navy ship' );
	f.emit( 'navyHail', { ship: 'HMS Tern', say: 'fire' } );
	ok( c().quarters_drum === 1, 'running from her: drums to quarters' );
	run( w, 9 );
	stubs.navy.ships.get( 'n1' ).navy.foe = { id: 'p9' };
	run( w, 0.1 );
	ok( c().quarters_drum === 2, 'a navy ship engaging a pirate beats to quarters' );
	run( w, 0.5 );
	ok( c().quarters_drum === 2, 'once per engagement' );

	// weather
	stubs.weather.gust.speed = 8;
	run( w, 0.1 );
	ok( c().gust === 1, 'a squall\'s gust rushes by' );
	stubs.weather.spout = { x: 400, z: 0, r: 8, life: 1 };
	run( w, 0.2 );
	ok( w.ev.loops.levels.spout > 0.5 && w.ev.loops.beds.has( 'spout' ), 'a waterspout 400 m off roars' );
	stubs.weather.spout = null;

	// crew life
	stubs.crew._acts = new Map( [ [ 'a', 'fire' ], [ 'b', 'pump' ], [ 'c', 'dice' ], [ 'd', 'sleep' ] ] );
	const before = { ...c() };
	run( w, 12 );
	for ( const k of [ 'bucket_slosh', 'pump_stroke', 'dice_rattle', 'snore' ] ) ok( ( c()[ k ] || 0 ) > ( before[ k ] || 0 ), `the crew: ${ k }` );
	stubs.crew._acts = new Map();

	// the towns
	run( w, 25 );
	ok( ( c().dog_bark || 0 ) >= 1, 'a dog barks in the village' );
	ok( ( c().gull || 0 ) >= 1, 'gulls over the home pier by day' );
	ok( w.ev.loops.levels.market_home > 0.3, 'the home plaza\'s market murmurs at noon' );
	const barks = c().dog_bark;
	f.emit( 'explosion', { x: 15, y: 0, z: 0 } );
	run( w, 1.6 );
	ok( c().dog_bark > barks, 'a blast sets the dogs off' );

	// rooms: the door, the hearth, the floorboards
	w.audio.env = { lx: 50, ly: 1.7, lz: 6 }; // on the step
	f.emit( 'interiorEntered', { id: room.id, port: 'tidemark' } );
	const door = lastOf( w, 'door' );
	ok( c().door === 1 && door && door.at.x === 50 && door.at.z === 5, 'the door, at its sill' );
	w.audio.env = { lx: 50, ly: 1.7, lz: 0 };
	w.app.player.position = { x: 50, y: 0, z: 0 };
	stubs.interiors.inside = room;
	stubs.interiors.muffle = 1;
	const creaks = c().board_creak || 0;
	run( w, 8, 1 / 30, () => { w.app.player.position = { x: 50 + Math.sin( w.ctx.currentTime ) * 3, y: 0, z: Math.cos( w.ctx.currentTime ) * 3 }; } );
	ok( ( c().board_creak || 0 ) > creaks, 'the boards creak under a walking player indoors' );
	ok( w.ev.loops.beds.has( 'hearth' ) && w.ev.loops.levels.hearth > 0.5, 'the hearth burns' );
	ok( played( w, 'fire_crackle' ).some( ( p ) => Math.abs( p.at.x - 53 ) < 1e-6 && ! p.occluded ), 'and crackles, unmuffled in its own room' );

}

// ---------------------------------------------------------------------------------------------- indoor occlusion

{

	const { rooms, room } = makeRooms();
	const it = { rooms, inside: room, muffle: 1 };
	const w = makeWorld( { stubs: { interiors: it } } );
	w.audio.env = { lx: 50, ly: 1.7, lz: 0 };
	w.sfx.synth.play( 'gull', { at: { x: 60, y: 8, z: 0 } } );
	const out = lastOf( w, 'gull' );
	ok( out && out.occluded && Math.abs( out.occluded.gain - 0.4 ) < 1e-6 && out.occluded.cutoff === 650, 'inside: a gull outside is quieter and low-passed' );
	w.sfx.synth.play( 'dice_rattle', { at: { x: 51, y: 0.8, z: 1 } } );
	ok( ! lastOf( w, 'dice_rattle' ).occluded, 'a sound in the same room is not' );
	w.sfx.synth.play( 'gull', { at: { x: 60, y: 8, z: 0 }, gain: 1 } );
	const g1 = lastOf( w, 'gull' ).gain;
	it.inside = null;
	w.audio.env = { lx: 50, ly: 1.7, lz: 9 }; // just outside the door
	w.ctx.currentTime += 5;
	w.sfx.synth.play( 'dice_rattle', { at: { x: 51, y: 0.8, z: 1 } } );
	ok( lastOf( w, 'dice_rattle' ).occluded, 'outside: a sound in the room is muffled by its walls' );
	w.sfx.synth.play( 'gull', { at: { x: 60, y: 8, z: 9 } } );
	ok( ! lastOf( w, 'gull' ).occluded, 'outside, a sound outside is clear' );
	ok( g1 > 0, 'occluded sounds still play' );
	// the samples of the sfx bank too
	it.inside = room;
	w.audio.env = { lx: 50, ly: 1.7, lz: 0 };
	w.sfx.player.buffers.set( 'splinter', { duration: 0.5 } );
	w.sfx.play( 'splinter', { at: { x: 70, y: 1, z: 0 } } );
	const sp = w.sfx.player.played.pop();
	ok( sp && sp.occluded && sp.occluded.cutoff === 650, 'a sample outside is occluded too' );
	ok( played( w, 'gull' ).length >= 2, 'the graph took the low-pass (no throw)' );
	// the loops: a market outside heard from inside
	const { Loops } = await import( '../src/features/sfx/EventSounds.js' );
	const L = new Loops( w.sfx );
	L.update( { market_home: { level: 1, at: { x: 70, y: 1.6, z: 0 } } }, 0.1 );
	const bed = L.beds.get( 'market_home' );
	ok( bed && bed.lp.frequency.value === 650 && Math.abs( bed.out.gain.value - LOOPS.market_home.peak * 0.4 ) < 1e-6, 'a loop outside is occluded indoors' );
	L.dispose();

}

// ---------------------------------------------------------------------------------------------- voice limits

{

	const w = makeWorld();
	for ( let i = 0; i < 40; i ++ ) w.sfx.synth.play( 'bullet_hit', { at: { x: 3, y: 1, z: 0 }, kind: 'ship' } );
	const live = w.sfx.synth.voices.get( 'bullet_hit' ).length;
	ok( live === CUES.bullet_hit.voices, `40 pellets at once: ${ live } voices (its limit)` );
	// a battle: every voice at once, many times
	for ( let r = 0; r < 6; r ++ ) for ( const n of Object.keys( CUES ) ) w.sfx.synth.play( n, { at: { x: 5, y: 1, z: 2 } } );
	ok( w.sfx.synth.live() <= VOICE_CAP.desktop, `a battle stays within the synth's budget (${ w.sfx.synth.live() } <= ${ VOICE_CAP.desktop })` );
	ok( w.sfx.synth.capped > 0, 'the extra voices were refused' );
	w.ctx.currentTime += 30;
	ok( w.sfx.synth.live() === 0 && !! w.sfx.synth.play( 'door', {} ), 'the voices free themselves' );

	globalThis.__phoneBudget = { tier: 'phone' };
	const p = makeWorld();
	for ( let i = 0; i < 40; i ++ ) p.sfx.synth.play( 'bullet_hit', { at: { x: 3, y: 1, z: 0 }, kind: 'ship' } );
	ok( p.sfx.synth.voices.get( 'bullet_hit' ).length === voiceLimit( CUES.bullet_hit, true ) && voiceLimit( CUES.bullet_hit, true ) === 2, 'a phone: half a voice\'s count' );
	for ( let r = 0; r < 6; r ++ ) for ( const n of Object.keys( CUES ) ) p.sfx.synth.play( n, { at: { x: 5, y: 1, z: 2 } } );
	ok( p.sfx.synth.live() <= VOICE_CAP.phone, `a phone's battle stays within its budget (${ p.sfx.synth.live() } <= ${ VOICE_CAP.phone })` );
	const { Loops } = await import( '../src/features/sfx/EventSounds.js' );
	const L = new Loops( p.sfx );
	const all = Object.fromEntries( Object.keys( LOOPS ).map( ( k ) => [ k, { level: 1, at: { x: 2, y: 1, z: 0 } } ] ) );
	L.update( all, 0.1 );
	ok( L.beds.size === 2, `a phone builds ${ L.beds.size } loops at once` );
	L.dispose();
	delete globalThis.__phoneBudget;
	const D = new Loops( w.sfx );
	D.update( all, 0.1 );
	ok( D.beds.size === 5, `a desktop builds ${ D.beds.size } loops at once` );
	D.dispose();

	// the rate limit: the gap between two of the same
	const before = w.ev.counts.harpoon_strike || 0;
	for ( let i = 0; i < 5; i ++ ) w.features.emit( 'gunHarpoon', { x: 2, y: 0, z: 0 } );
	ok( ( w.ev.counts.harpoon_strike || 0 ) - before === 1, 'five strikes in one frame: one sound (the gap)' );

}

// ---------------------------------------------------------------------------------------------- muted / no audio

{

	const w = makeWorld();
	w.audio.muted = true;
	w.features.emit( 'gunHit', { kind: 'water', x: 1, y: 0, z: 0 } );
	ok( ! w.ev.counts.bullet_hit, 'muted: nothing plays' );
	const n = makeWorld( { audio: null } );
	n.app.audio = null;
	let threw = false;
	try {

		for ( const [ name, e ] of [ [ 'meleeHit', { by: 'player', weapon: 'axe', x: 0, z: 0 } ], [ 'cannonFired', { x: 900, z: 0 } ], [ 'navyHail', { say: 'hail' } ], [ 'interiorEntered', { id: 'x' } ], [ 'shipFlooded', { id: 'player' } ] ] ) n.features.emit( name, e );
		for ( let i = 0; i < 30; i ++ ) n.features.update( 1 / 30 );

	} catch ( e ) { threw = true; console.log( e ); }

	ok( ! threw, 'no audio: events and updates do not throw' );
	n.features.get( 'sfx' ).dispose();
	ok( true, 'dispose is clean' );

}

console.log( fails ? `${ fails } FAILED` : 'all ok' );
process.exit( fails ? 1 : 0 );
