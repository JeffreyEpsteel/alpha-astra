// The sounds of waves 13-19's new actions (wave 20B): the arsenal, the navy, the storm fronts, the interiors, the crew's life
// and the towns. Listens to the features' existing events and reads their public state, so no other feature has to call it;
// plays the synthesised voices of Voices.js through the SynthPlayer (distance gain, voice limits, the synth's budget) and keeps
// a few loops (LOOPS: a waterspout, a burning deck, the bilge, a hearth, the other towns' markets) that fade by distance.
//
// Indoor occlusion: occlusion( at ) is the SfxPlayer's occlude hook (index.js sets it), so every positional sound of the
// sfx feature (its samples, Synth.js's cues, these voices and loops) is quieter and low-passed when a wall stands between it
// and the listener: the listener in a room (interiors.inside) and the sound outside it, or the sound in a room the listener is
// not in. The interiors feature already muffles the SoundScape's sea, wind and pier beds; the weather's rain goes dull under
// its roof (shelter).
//
//   INVENTORY        [ { event, sound, source } ] every action of waves 13-19 the brief named, its sound and where it comes from
//   ev.counts[ cue ] what started (tests)        ev.loops.levels { id: level }
//
// Rate limits: each voice has its gap (Voices.js) and its own voice count; the SynthPlayer caps the whole synth (VOICE_CAP,
// fewer on a phone) so a battle's guns and hits never stack into clipping.

import { CUES } from './Synth.js';
import { cueFor } from './Cues.js';
import { hourOf, daylight, nightness, fade, marketCrowd, crowdBed, loopNoise, lfo } from './Places.js';
import { gainNode, filterNode } from './Synth.js';
import { clamp, num, smooth } from './util.js';

const BLADES = { cutlass: [ 'blade_swing', 'blade_hit' ], axe: [ 'axe_swing', 'axe_hit' ], pin: [ 'pin_swing', 'pin_hit' ], harpoon: [ 'harpoon_jab', 'blade_hit' ] };
const DISTANT = 220; // m: a gun further than this also rolls in as a far broadside, late by the speed of sound
const SOUND = 343; // m/s
const HIT_WAIT = 0.3; // s a swing waits to learn whether it landed
const ROOM_GAIN = 0.4; // a sound through a room's walls (the open doorway lets some through)
const ROOM_CUTOFF = 650; // Hz

// what the brief listed, its sound and its source. cue: a voice of this feature (Voices.js / Synth.js CUES); the others are
// another feature's own sound, named so the inventory is complete.
export const INVENTORY = [
	{ event: 'cutlass swing / hit (meleeHit weapon cutlass)', cue: 'blade_swing', also: 'blade_hit', sound: 'thin blade hiss; steel bite', source: 'sfx synth (was melee\'s paddle samples)' },
	{ event: 'axe swing / hit (meleeHit weapon axe)', cue: 'axe_swing', also: 'axe_hit', sound: 'heavy chop of air; deep chop', source: 'sfx synth (was paddle samples)' },
	{ event: 'belaying pin swing / hit (meleeHit weapon pin)', cue: 'pin_swing', also: 'pin_hit', sound: 'wooden whip; hollow knock', source: 'sfx synth (was paddle samples)' },
	{ event: 'melee harpoon jab (meleeHit weapon harpoon)', cue: 'harpoon_jab', sound: 'long thrust, barbs', source: 'sfx synth' },
	{ event: 'harpoon gun strike (gunHarpoon)', cue: 'harpoon_strike', sound: 'iron thunk, line twang', source: 'sfx synth (the shot: firearms GunAudio)' },
	{ event: 'bullet / pellet impacts (gunHit)', cue: 'bullet_hit', sound: 'plip, wood, smack, ricochet', source: 'sfx synth' },
	{ event: 'swivel gun (cannonFired while weapons.hand is swivel)', cue: 'swivel_bark', sound: 'sharp high crack + echo', source: 'sfx synth over naval\'s cannon sample' },
	{ event: 'fire bottle pool / burning deck (weapons.fires, ship.fire)', cue: 'fire_crackle', sound: 'pops and spits', source: 'sfx synth (the shatter: WeaponAudio)' },
	{ event: 'bombs: fuse, bounce, blast', cue: null, sound: 'hiss, thud, boom', source: 'weapons WeaponAudio (18D)' },
	{ event: 'fire bottle shatter / smoke pot', cue: null, sound: 'glass + whoomph; hiss', source: 'weapons WeaponAudio (18D)' },
	{ event: 'blunderbuss / rifle / harpoon gun shots, reloads', cue: null, sound: 'reports, clicks', source: 'firearms GunAudio (18D)' },
	{ event: 'a deck catching fire (fireStarted)', cue: 'fire_whoomph', sound: 'whoomph, hiss', source: 'sfx synth' },
	{ event: 'flooding (shipFlooded; the bilge while naval.flood rises)', cue: 'flood_rush', loop: 'bilge', sound: 'rush, gurgle; slosh loop', source: 'sfx synth' },
	{ event: 'a mast going by the board (mastFell)', cue: 'mast_crack', sound: 'crack, groan, crash, splash', source: 'sfx synth' },
	{ event: 'the player\'s deck burning (naval.fireState)', cue: 'fire_crackle', loop: 'shipfire', sound: 'roar loop + crackle', source: 'sfx synth' },
	{ event: 'navy hail (navyHail hail / warn / board)', cue: 'bosun_call', also: 'heave_to', sound: 'bosun\'s pipe, "Heave to!"', source: 'sfx synth' },
	{ event: 'drums to quarters (navyHail fire; a navy ship engaging)', cue: 'quarters_drum', sound: 'snare roll, three strokes', source: 'sfx synth' },
	{ event: 'frigate broadsides at distance (cannonFired > 220 m)', cue: 'distant_gun', sound: 'low roll, late by d / 343', source: 'sfx synth' },
	{ event: 'storm gusts (weather.gust)', cue: 'gust', sound: 'rushing swell, rigging whistle', source: 'sfx synth' },
	{ event: 'waterspout (weather.spout)', cue: null, loop: 'spout', sound: 'roar loop by distance', source: 'sfx synth' },
	{ event: 'rain on the deck / on a roof indoors', cue: null, sound: 'wood / canvas drops, dull under a roof', source: 'weather WeatherAudio (surfaceMix, shelter)' },
	{ event: 'thunder by distance (lightningStrike)', cue: null, sound: 'crack + roll after d / 343', source: 'weather WeatherAudio.thunder' },
	{ event: 'tavern murmur', cue: null, sound: 'crowd bed, clinks', source: 'harbour TavernAudio; Places (Rum Hole)' },
	{ event: 'hearth crackle (rooms with a hearth)', cue: 'fire_crackle', loop: 'hearth', sound: 'low roar + pops', source: 'sfx synth' },
	{ event: 'creaking boards (walking indoors)', cue: 'board_creak', sound: 'board creak', source: 'sfx synth' },
	{ event: 'a door (interiorEntered / interiorLeft)', cue: 'door', sound: 'latch, hinge, thump', source: 'sfx synth' },
	{ event: 'crew buckets (activity fire; douse channel)', cue: 'bucket_slosh', sound: 'slosh, steam', source: 'sfx synth' },
	{ event: 'crew pump (activity pump; pump channel)', cue: 'pump_stroke', sound: 'clank, gush', source: 'sfx synth' },
	{ event: 'crew dice (activity dice)', cue: 'dice_rattle', sound: 'cup rattle, roll', source: 'sfx synth' },
	{ event: 'crew snoring (activity sleep)', cue: 'snore', sound: 'snore', source: 'sfx synth' },
	{ event: 'market chatter (home plaza, Blackwater stall)', cue: null, loop: 'market_home', sound: 'crowd bed', source: 'sfx synth (Tidemark: Places)' },
	{ event: 'gulls at the quay (home pier, Blackwater docks)', cue: 'gull', sound: 'mewing calls', source: 'sfx synth (Tidemark: Places)' },
	{ event: 'dogs (town animals; gunfire nearby)', cue: 'dog_bark', sound: 'barks', source: 'sfx synth' },
	{ event: 'wet sand footsteps', cue: null, sound: 'step_wetsand', source: 'SoundScape (CC0 recording)' },
];

// ------------------------------------------------------------------ the loops

function bilgeBed( ctx, out ) {

	const sources = [], s = loopNoise( ctx, 'brown' ), lp = filterNode( ctx, 'lowpass', 380, 0.8 ), g = gainNode( ctx, 0.6 );
	s.connect( lp ); lp.connect( g ); g.connect( out );
	lfo( ctx, 0.27, 0.45, g.gain, sources ); // the water rolling in the hold
	const gl = loopNoise( ctx, 'white' ), bp = filterNode( ctx, 'bandpass', 700, 6 ), gg = gainNode( ctx, 0.05 );
	gl.connect( bp ); bp.connect( gg ); gg.connect( out );
	lfo( ctx, 3.1, 0.05, gg.gain, sources ); // gurgles
	for ( const n of [ s, gl ] ) { n.start( 0, Math.random() * 1.5 ); sources.push( n ); }
	return { sources };

}

function fireBed( ctx, out, roar = 450 ) {

	const sources = [], s = loopNoise( ctx, 'brown' ), lp = filterNode( ctx, 'lowpass', roar, 0.7 ), g = gainNode( ctx, 0.7 );
	s.connect( lp ); lp.connect( g ); g.connect( out );
	lfo( ctx, 0.6, 0.2, g.gain, sources );
	const f = loopNoise( ctx, 'white' ), bp = filterNode( ctx, 'bandpass', 1200, 0.9 ), fg = gainNode( ctx, 0.07 );
	f.connect( bp ); bp.connect( fg ); fg.connect( out );
	lfo( ctx, 7, 0.05, fg.gain, sources ); // the flicker
	for ( const n of [ s, f ] ) { n.start( 0, Math.random() * 1.5 ); sources.push( n ); }
	return { sources };

}

function spoutBed( ctx, out ) {

	const sources = [], s = loopNoise( ctx, 'brown' ), lp = filterNode( ctx, 'lowpass', 280, 0.6 ), g = gainNode( ctx, 0.8 );
	s.connect( lp ); lp.connect( g ); g.connect( out );
	const w = loopNoise( ctx, 'white' ), bp = filterNode( ctx, 'bandpass', 900, 0.5 ), wg = gainNode( ctx, 0.25 );
	w.connect( bp ); bp.connect( wg ); wg.connect( out );
	lfo( ctx, 0.35, 0.15, wg.gain, sources ); // the column wavering
	const h = loopNoise( ctx, 'white' ), hp = filterNode( ctx, 'highpass', 3200, 0.5 ), hg = gainNode( ctx, 0.08 );
	h.connect( hp ); hp.connect( hg ); hg.connect( out );
	for ( const n of [ s, w, h ] ) { n.start( 0, Math.random() * 1.5 ); sources.push( n ); }
	return { sources };

}

// id -> { peak (linear gain at level 1), cat, build }
export const LOOPS = {
	spout: { peak: 0.5, cat: 'ambience', build: spoutBed },
	shipfire: { peak: 0.28, cat: 'sfx', build: ( c, o ) => fireBed( c, o, 450 ) },
	bilge: { peak: 0.3, cat: 'sfx', build: bilgeBed },
	hearth: { peak: 0.16, cat: 'ambience', build: ( c, o ) => fireBed( c, o, 300 ) },
	market_home: { peak: 0.16, cat: 'ambience', build: ( c, o ) => crowdBed( c, o, false ) },
	market_bw: { peak: 0.14, cat: 'ambience', build: ( c, o ) => crowdBed( c, o, true ) },
};

const LOOP_MAX = { desktop: 5, phone: 2 }; // loops built at once
const IDLE_DROP = 6; // s a silent loop keeps its nodes

export class Loops {

	constructor( sfx ) {

		this.sfx = sfx;
		this.beds = new Map(); // id -> { out, lp, pan, sources, idle }
		this.levels = {};

	}

	// wants: { id: { level 0..1, at { x, y, z } } }: every loop not named fades out
	update( wants, dt ) {

		const pl = this.sfx.player, ctx = pl.ctx;
		this.levels = {};
		for ( const id in wants ) this.levels[ id ] = wants[ id ].level;
		if ( ! ctx || typeof ctx.createOscillator !== 'function' || typeof ctx.createBufferSource !== 'function' || typeof ctx.createBuffer !== 'function' ) return;
		const t = num( ctx.currentTime, 0 ), phone = !! globalThis.__phoneBudget;
		for ( const id of new Set( [ ...Object.keys( wants ), ...this.beds.keys() ] ) ) {

			const def = LOOPS[ id ], w = wants[ id ];
			if ( ! def ) continue;
			let level = w && pl.active ? clamp( num( w.level, 0 ), 0, 1 ) : 0;
			let bed = this.beds.get( id );
			if ( ! bed ) {

				if ( level < 0.012 || this.beds.size >= ( phone ? LOOP_MAX.phone : LOOP_MAX.desktop ) ) continue;
				bed = this._build( id, def, ctx );
				if ( ! bed ) continue;

			}

			bed.idle = level < 0.004 ? bed.idle + dt : 0;
			if ( bed.idle > IDLE_DROP ) {

				this._drop( id, bed );
				continue;

			}

			const occ = w && w.at && typeof pl.occlude === 'function' ? pl.occlude( w.at, def ) : null;
			if ( occ ) level *= clamp( num( occ.gain, 1 ), 0, 1 );
			bed.out.gain.setTargetAtTime( level * def.peak, t, 0.4 );
			bed.lp.frequency.setTargetAtTime( occ ? Math.max( 120, num( occ.cutoff, 20000 ) ) : 20000, t, 0.2 );
			if ( w && w.at && bed.pan ) {

				const p = bed.pan;
				if ( p.positionX ) {

					p.positionX.value = num( w.at.x, 0 );
					p.positionY.value = num( w.at.y, 1 );
					p.positionZ.value = num( w.at.z, 0 );

				} else if ( p.setPosition ) p.setPosition( num( w.at.x, 0 ), num( w.at.y, 1 ), num( w.at.z, 0 ) );

			}

		}

	}

	_build( id, def, ctx ) {

		try {

			const sink = this.sfx.player._sink( def.cat );
			if ( ! sink ) return null;
			const out = ctx.createGain();
			out.gain.value = 0;
			const lp = filterNode( ctx, 'lowpass', 20000, 0.6 );
			out.connect( lp );
			let pan = null;
			if ( typeof ctx.createPanner === 'function' ) {

				pan = ctx.createPanner();
				pan.panningModel = 'HRTF';
				pan.distanceModel = 'inverse';
				pan.refDistance = 1;
				pan.rolloffFactor = 0; // the level is the loop's own fade
				pan.maxDistance = 10000;
				lp.connect( pan );
				pan.connect( sink.node );

			} else lp.connect( sink.node );

			const made = def.build( ctx, out );
			const bed = { out, lp, pan, sources: made.sources, idle: 0 };
			this.beds.set( id, bed );
			return bed;

		} catch ( e ) {

			return null;

		}

	}

	_drop( id, bed ) {

		for ( const s of bed.sources ) try { s.stop(); } catch ( e ) { /* not started */ }
		try { bed.out.disconnect(); bed.lp.disconnect(); if ( bed.pan ) bed.pan.disconnect(); } catch ( e ) { /* gone */ }
		this.beds.delete( id );

	}

	dispose() {

		for ( const [ id, bed ] of [ ...this.beds ] ) this._drop( id, bed );

	}

}

// ------------------------------------------------------------------ the listeners and polls

const pt = ( e, y = 1 ) => ( e && Number.isFinite( e.x ) && Number.isFinite( e.z ) ? { x: e.x, y: num( e.y, y ), z: e.z } : null );
const rnd = ( a, b ) => a + Math.random() * ( b - a );

export class EventSounds {

	constructor( sfx ) {

		this.sfx = sfx;
		this.loops = new Loops( sfx );
		this.counts = {};
		this.last = {};
		this.off = [];
		this.pending = null; // a swing waiting to learn whether it landed
		this.foes = new Map(); // navy ship id -> her foe last frame
		this.gustAvg = 0;
		this.prevPos = null;
		this.hearths = new Map(); // room id -> { x, y, z } | null
		this.t = { crackle: 0, poolCrackle: 0, aiCrackle: 0, hearth: 0, creak: 2, bucket: 0, pump: 0, dice: 3, snore: 2, dog: 6, gull: 5, fit: - 1, fitAt: null };
		this._tmp = { x: 0, y: 0, z: 0 };
		const f = sfx.features;
		if ( f && f.on ) {

			const on = ( n, fn ) => this.off.push( f.on( n, ( e ) => { try { fn( e || {} ); } catch ( err ) { /* a missed sound is fine */ } } ) );
			on( 'meleeHit', ( e ) => this._meleeHit( e ) );
			on( 'gunHit', ( e ) => { const p = pt( e ); if ( p ) this.trigger( 'bullet_hit', { at: p, kind: e.kind } ); } );
			on( 'gunHarpoon', ( e ) => { const p = pt( e ); if ( p ) this.trigger( 'harpoon_strike', { at: p } ); } );
			on( 'cannonFired', ( e ) => this._cannon( e ) );
			on( 'fireStarted', ( e ) => { const p = pt( e, 2 ); if ( p ) this.trigger( 'fire_whoomph', { at: p } ); } );
			on( 'fireOut', ( e ) => { const p = this.shipAt( e.id ); if ( e.doused && p ) this.trigger( 'bucket_slosh', { at: p, hiss: true } ); } );
			on( 'shipFlooded', ( e ) => { const p = this.shipAt( e.id ); if ( p ) this.trigger( 'flood_rush', { at: p } ); } );
			on( 'mastFell', ( e ) => { const p = pt( e, 8 ); if ( p ) this.trigger( 'mast_crack', { at: { x: p.x, y: 8, z: p.z } } ); } );
			on( 'navyHail', ( e ) => this._hail( e ) );
			on( 'interiorEntered', ( e ) => this._door( e ) );
			on( 'interiorLeft', ( e ) => this._door( e ) );
			on( 'explosion', ( e ) => this._startle( pt( e ) ) );
			on( 'gunshot', ( e ) => this._startle( pt( e ) ) );

		}

	}

	_feature( name ) {

		const f = this.sfx.features;
		return f && f.get ? f.get( name ) : null;

	}

	listener() {

		return this.sfx.player.listener();

	}

	// starts a voice unless it is inside its own gap; counts what started
	trigger( cue, opts = {} ) {

		const info = CUES[ cue ];
		if ( ! info ) return null;
		const now = this.sfx.time;
		if ( cue in this.last && now - this.last[ cue ] < num( info.gap, 0 ) ) return null;
		const v = this.sfx.synth.play( cue, opts );
		if ( v ) {

			this.last[ cue ] = now;
			this.counts[ cue ] = ( this.counts[ cue ] || 0 ) + 1;

		}

		return v;

	}

	// where a ship is: the player's boat ('player'), a naval ship, a navy ship
	shipAt( id ) {

		const app = this.sfx.app;
		if ( id === 'player' || id === undefined ) {

			const b = app && ( app.boatCtl || app.boat );
			const p = b && b.position;
			return p ? { x: p.x, y: num( p.y, 0 ) + 1.5, z: p.z } : null;

		}

		const nv = this._feature( 'naval' );
		const list = nv && Array.isArray( nv.ships ) ? nv.ships : [];
		const s = list.find( ( q ) => q && q.id === id );
		return s && Number.isFinite( s.x ) ? { x: s.x, y: 2, z: s.z } : null;

	}

	// ---- indoor occlusion (the SfxPlayer's occlude hook)

	occlusion( at ) {

		const it = this._feature( 'interiors' ), R = it && it.rooms;
		if ( ! R || ! Array.isArray( R.list ) || typeof R.contains !== 'function' || ! at ) return null;
		const inside = it.inside || null;
		let src = null;
		for ( const room of R.list ) {

			if ( room.destroyed ) continue;
			if ( R.contains( room, num( at.x, 0 ), num( at.y, num( room.floorY, 0 ) + 1 ), num( at.z, 0 ), 0.3 ) ) { src = room; break; }

		}

		if ( src === inside ) return null; // the same room, or both outdoors
		const k = inside ? clamp( num( it.muffle, 1 ), 0, 1 ) : 1;
		if ( k < 0.02 ) return null;
		return { gain: 1 - ( 1 - ROOM_GAIN ) * k, cutoff: 20000 + ( ROOM_CUTOFF - 20000 ) * k };

	}

	// ---- events

	_meleeHit( e ) {

		if ( e.by !== 'player' || ! BLADES[ e.weapon ] ) return;
		const at = pt( e, 1 );
		this.trigger( BLADES[ e.weapon ][ 0 ], { at } );
		const m = this._feature( 'melee' ), st = m && m.combat && m.combat.stats;
		this.pending = { weapon: e.weapon, at, hits: st ? num( st.hits, 0 ) : null, t: this.sfx.time };

	}

	// a swing that landed (melee counted a hit since the swing's contact): the weapon's own blow
	_landed() {

		const p = this.pending;
		if ( ! p ) return;
		const m = this._feature( 'melee' ), st = m && m.combat && m.combat.stats;
		if ( st && p.hits !== null && num( st.hits, 0 ) > p.hits ) {

			this.trigger( BLADES[ p.weapon ][ 1 ], { at: p.at } );
			this.pending = null;

		} else if ( this.sfx.time - p.t > HIT_WAIT || ! st ) this.pending = null;

	}

	_cannon( e ) {

		const p = pt( e, 2 );
		if ( ! p ) return;
		const w = this._feature( 'weapons' );
		if ( e.by === 'player' && w && w.hand === 'swivel' ) this.trigger( 'swivel_bark', { at: p } );
		this._startle( p );
		const L = this.listener(), d = Math.hypot( p.x - L.x, p.z - L.z );
		if ( d < DISTANT ) return;
		if ( cueFor( 'cannonFired', e ).length ) return; // a Blackwater battery: Cues' battery_fire has its own echoes
		this.trigger( 'distant_gun', { at: p, delay: Math.min( 12, d / SOUND ), power: e.owner === 'navy' ? 1.2 : 1 } );

	}

	// the navy ship nearest the listener
	_navyShip() {

		const nv = this._feature( 'navy' ), L = this.listener();
		if ( ! nv || ! nv.ships || typeof nv.ships.values !== 'function' ) return null;
		let best = null, bd = Infinity;
		for ( const s of nv.ships.values() ) {

			if ( ! s || s.alive === false || ! Number.isFinite( s.x ) ) continue;
			const d = Math.hypot( s.x - L.x, s.z - L.z );
			if ( d < bd ) { bd = d; best = s; }

		}

		return best ? { x: best.x, y: 6, z: best.z } : null;

	}

	_hail( e ) {

		const at = this._navyShip();
		const o = at ? { at } : {};
		if ( e.say === 'fire' ) {

			this.trigger( 'quarters_drum', o );
			return;

		}

		this.trigger( 'bosun_call', o );
		if ( e.say === 'hail' || e.say === 'warn' || ! e.say ) this.trigger( 'heave_to', { ...o, delay: 1.5 } );

	}

	_door( e ) {

		const it = this._feature( 'interiors' ), R = it && it.rooms;
		const room = R && R.byId && R.byId.get ? R.byId.get( e.id ) : null;
		let at = null;
		if ( room && typeof R.door === 'function' ) {

			const d = R.door( room );
			const s = d && ( d.sill || d );
			if ( s && Number.isFinite( s.x ) ) at = { x: s.x, y: num( room.floorY, 0 ) + 1.2, z: s.z };

		}

		if ( ! at ) {

			const L = this.listener();
			at = { x: L.x, y: L.y, z: L.z };

		}

		this.trigger( 'door', { at } );

	}

	// gunfire or a blast near a town sets its dogs off
	_startle( p ) {

		if ( ! p ) return;
		for ( const d of this._dogs() ) if ( Math.hypot( d.x - p.x, d.z - p.z ) < 350 ) {

			this.t.fit = this.sfx.time + rnd( 0.4, 1.4 );
			this.t.fitAt = d;
			return;

		}

	}

	// ---- per frame

	update( dt ) {

		this._landed();
		const wants = {};
		this._navy();
		this._ships( dt, wants );
		this._weather( wants );
		this._rooms( dt, wants );
		this._crew( dt );
		this._towns( dt, wants );
		this.loops.update( wants, dt );

	}

	// a navy ship turning on a foe beats to quarters
	_navy() {

		const nv = this._feature( 'navy' );
		if ( ! nv || ! nv.ships || typeof nv.ships.values !== 'function' ) return;
		const L = this.listener(), seen = new Set();
		for ( const s of nv.ships.values() ) {

			if ( ! s || s.id === undefined ) continue;
			seen.add( s.id );
			const foe = s.navy && s.navy.foe ? s.navy.foe : null;
			const was = this.foes.get( s.id ) || null;
			this.foes.set( s.id, foe );
			if ( foe && ! was && s.alive !== false && Number.isFinite( s.x ) && Math.hypot( s.x - L.x, s.z - L.z ) < 1200 ) this.trigger( 'quarters_drum', { at: { x: s.x, y: 5, z: s.z } } );

		}

		for ( const id of [ ...this.foes.keys() ] ) if ( ! seen.has( id ) ) this.foes.delete( id );

	}

	// fire and water aboard: the player's deck burning and her bilge, fire pools, AI ships alight
	_ships( dt, wants ) {

		const nv = this._feature( 'naval' ), w = this._feature( 'weapons' ), L = this.listener();
		const boat = this.shipAt( 'player' );
		if ( nv && boat ) {

			const fs = nv.fireState;
			if ( fs && fs.burning ) {

				const k = clamp( num( fs.level, 0.5 ), 0.1, 1 );
				wants.shipfire = { level: 0.35 + 0.65 * k, at: boat };
				this.t.crackle -= dt;
				if ( this.t.crackle <= 0 ) {

					this.t.crackle = rnd( 0.3, 0.8 ) / ( 0.5 + k );
					this.trigger( 'fire_crackle', { at: boat, k } );

				}

			}

			const fl = num( nv.flood, 0 );
			if ( fl > 0.02 ) wants.bilge = { level: smooth( 0.02, 0.5, fl ), at: { x: boat.x, y: boat.y - 1.2, z: boat.z } };
			const ch = nv._channel && nv._channel.kind;
			if ( ch === 'pump' ) this._every( 'pump', dt, 1.25, () => this.trigger( 'pump_stroke', { at: boat } ) );
			if ( ch === 'douse' ) this._every( 'bucket', dt, 1.0, () => this.trigger( 'bucket_slosh', { at: boat, hiss: !! ( fs && fs.burning ) } ) );

		}

		// the nearest fire pool of a fire bottle
		const pools = w && Array.isArray( w.fires ) ? w.fires : [];
		let pool = null, pd = 45;
		for ( const f of pools ) {

			const d = Math.hypot( f.x - L.x, f.z - L.z );
			if ( d < pd ) { pd = d; pool = f; }

		}

		if ( pool ) this._every( 'poolCrackle', dt, rnd( 0.35, 0.8 ), () => this.trigger( 'fire_crackle', { at: { x: pool.x, y: num( pool.y, 0 ) + 0.3, z: pool.z }, k: 0.6 } ) );
		// an AI ship alight within earshot
		const ships = nv && Array.isArray( nv.ships ) ? nv.ships : [];
		let burn = null, bd = 160;
		for ( const s of ships ) {

			if ( ! s || ! s.fire || ! s.fire.burning || ! Number.isFinite( s.x ) ) continue;
			const d = Math.hypot( s.x - L.x, s.z - L.z );
			if ( d < bd ) { bd = d; burn = s; }

		}

		if ( burn ) this._every( 'aiCrackle', dt, rnd( 0.4, 0.9 ), () => this.trigger( 'fire_crackle', { at: { x: burn.x, y: 2.5, z: burn.z }, k: clamp( num( burn.fire.level, 0.5 ), 0.2, 1 ) } ) );

	}

	// counts a timer down; runs fn and restarts it at `every` s when it runs out
	_every( key, dt, every, fn ) {

		this.t[ key ] = num( this.t[ key ], 0 ) - dt;
		if ( this.t[ key ] > 0 ) return;
		this.t[ key ] = every;
		fn();

	}

	// a gust rising over the wind's slow average; the waterspout's roar
	_weather( wants ) {

		const wx = this._feature( 'weather' ), L = this.listener();
		if ( ! wx ) return;
		const g = wx.gust, sp = num( g && g.speed, 0 );
		const rise = sp - this.gustAvg;
		this.gustAvg += ( sp - this.gustAvg ) * 0.02; // (~1.5 s at 30 fps)
		if ( sp > 3 && rise > 2 ) {

			// heard from upwind: the gust comes in from where it blows from
			const l = Math.hypot( num( g.x, 0 ), num( g.z, 0 ) ) || 1;
			const at = { x: L.x - num( g.x, 0 ) / l * 25, y: L.y + 4, z: L.z - num( g.z, 0 ) / l * 25 };
			this.trigger( 'gust', { at, k: clamp( sp / 14, 0.2, 1 ) } );

		}

		const s = wx.spout;
		if ( s && Number.isFinite( s.x ) ) {

			const d = Math.max( 0, Math.hypot( s.x - L.x, s.z - L.z ) - num( s.r, 6 ) );
			wants.spout = { level: clamp( num( s.life, 1 ), 0, 1 ) * fade( d, 25, 1800 ), at: { x: s.x, y: 6, z: s.z } };

		}

	}

	_hearthOf( R, room ) {

		if ( this.hearths.has( room.id ) ) return this.hearths.get( room.id );
		let at = null;
		const pc = room.R && Array.isArray( room.R.pieces ) ? room.R.pieces.find( ( q ) => q.piece === 'hearth' ) : null;
		if ( pc && typeof R.world === 'function' ) {

			const w = R.world( room, pc.x, pc.z );
			at = { x: w.x, y: num( room.floorY, 0 ) + 0.6, z: w.z };

		}

		this.hearths.set( room.id, at );
		return at;

	}

	// the hearth's fire, the floorboards under a walking player
	_rooms( dt, wants ) {

		const it = this._feature( 'interiors' ), R = it && it.rooms, L = this.listener();
		if ( ! R || ! Array.isArray( R.list ) ) return;
		let best = null, bd = 30;
		for ( const room of R.list ) {

			if ( room.destroyed ) continue;
			const h = this._hearthOf( R, room );
			if ( ! h ) continue;
			const d = Math.hypot( h.x - L.x, h.z - L.z );
			if ( d < bd ) { bd = d; best = h; }

		}

		if ( best ) {

			const level = fade( bd, 2, 16 );
			wants.hearth = { level, at: best };
			if ( level > 0.05 ) this._every( 'hearth', dt, rnd( 0.5, 1.4 ), () => this.trigger( 'fire_crackle', { at: best, k: 0.35 } ) );

		}

		const p = this.sfx.app && this.sfx.app.player, pos = p && p.position;
		const prev = this.prevPos;
		this.prevPos = pos ? { x: pos.x, z: pos.z } : null;
		if ( ! it.inside || ! pos || ! prev || dt <= 0 || p.mode !== 'walk' ) return;
		const v = Math.hypot( pos.x - prev.x, pos.z - prev.z ) / dt;
		if ( v < 0.6 ) return;
		this.t.creak -= dt * clamp( v / 2.5, 0.3, 1.6 );
		if ( this.t.creak > 0 ) return;
		this.t.creak = rnd( 1.6, 4 );
		this.trigger( 'board_creak', { at: { x: pos.x, y: num( pos.y, 0 ) + 0.05, z: pos.z } } );

	}

	// the crew's life aboard: buckets, the pump, dice, snoring
	_crew( dt ) {

		const c = this._feature( 'crew' ), acts = c && c._acts;
		if ( ! acts || typeof acts.forEach !== 'function' || ! acts.size ) return;
		const by = { fire: [], pump: [], dice: [], sleep: [] };
		acts.forEach( ( act, id ) => { if ( by[ act ] ) by[ act ].push( id ); } );
		const where = ( id ) => {

			const h = c.deck && typeof c.deck.headOf === 'function' ? c.deck.headOf( id, this._tmp ) : null;
			return h ? { x: h.x, y: h.y - 0.6, z: h.z } : this.shipAt( 'player' );

		};

		const pick = ( list ) => list[ Math.floor( Math.random() * list.length ) ];
		if ( by.fire.length ) this._every( 'bucket', dt, Math.max( 1.0, 6 / by.fire.length ), () => {

			const at = where( pick( by.fire ) );
			if ( at ) this.trigger( 'bucket_slosh', { at, hiss: true } );

		} );
		if ( by.pump.length ) this._every( 'pump', dt, 1.25, () => {

			const at = where( by.pump[ 0 ] );
			if ( at ) this.trigger( 'pump_stroke', { at, gain: Math.min( 1, 0.7 + 0.15 * by.pump.length ) } );

		} );
		if ( by.dice.length ) this._every( 'dice', dt, rnd( 4, 9 ), () => {

			const at = where( pick( by.dice ) );
			if ( at ) this.trigger( 'dice_rattle', { at } );

		} );
		if ( by.sleep.length ) this._every( 'snore', dt, rnd( 3.5, 6 ) / Math.min( 2, by.sleep.length ), () => {

			const at = where( pick( by.sleep ) );
			if ( at ) this.trigger( 'snore', { at: { x: at.x, y: at.y - 0.6, z: at.z } } );

		} );

	}

	_dogs() {

		const tl = this._feature( 'townlife' ), list = tl && tl.animals && Array.isArray( tl.animals.list ) ? tl.animals.list : [];
		return list.filter( ( a ) => a && a.kind === 'dog' && Number.isFinite( a.x ) );

	}

	// the other towns' markets and quays (Tidemark's are Places'), the dogs
	_towns( dt, wants ) {

		const tl = this._feature( 'townlife' ), L = this.listener(), app = this.sfx.app;
		if ( ! tl ) return;
		const hour = hourOf( app ), day = daylight( hour );
		const plans = Array.isArray( tl.towns ) ? tl.towns.map( ( t ) => t && t.plan ).filter( Boolean ) : [];
		let gullAt = null, gullLv = 0;
		for ( const plan of plans ) {

			if ( plan.id !== 'home' && plan.id !== 'blackwater' ) continue;
			const st = plan.stalls && plan.stalls[ 0 ];
			if ( st ) {

				const lv = fade( Math.hypot( st.x - L.x, st.z - L.z ), 10, 70 ) * marketCrowd( hour ) * ( plan.id === 'blackwater' ? 0.8 : 1 );
				wants[ plan.id === 'home' ? 'market_home' : 'market_bw' ] = { level: lv, at: { x: st.x, y: 1.6, z: st.z } };

			}

			const dock = plan.skiffs && plan.skiffs[ 0 ] && plan.skiffs[ 0 ].dock;
			if ( dock ) {

				const lv = fade( Math.hypot( dock.x - L.x, dock.z - L.z ), 25, 150 ) * day;
				if ( lv > gullLv ) { gullLv = lv; gullAt = dock; }

			}

		}

		if ( gullAt && gullLv > 0.04 ) this._every( 'gull', dt, rnd( 5, 13 ), () => {

			const a = Math.random() * Math.PI * 2, r = Math.random() * 40;
			this.trigger( 'gull', { at: { x: gullAt.x + Math.cos( a ) * r, y: 9 + Math.random() * 8, z: gullAt.z + Math.sin( a ) * r } } );

		} );

		// dogs: now and then (more at dusk and at night, and one following the player), a fit of barking at gunfire
		const dogs = this._dogs().filter( ( d ) => Math.hypot( d.x - L.x, d.z - L.z ) < 150 );
		if ( this.t.fit >= 0 && this.sfx.time >= this.t.fit ) {

			const d = this.t.fitAt;
			this.t.fit = - 1;
			if ( d ) this.trigger( 'dog_bark', { at: { x: d.x, y: 0.6, z: d.z }, n: 3, size: d.scale || 1 } );

		}

		if ( ! dogs.length ) return;
		const follow = dogs.find( ( d ) => d.state === 'follow' );
		const every = follow ? rnd( 4, 9 ) : rnd( 8, 20 ) / ( 0.7 + 0.6 * nightness( hour ) );
		this._every( 'dog', dt, every, () => {

			const d = follow || dogs[ Math.floor( Math.random() * dogs.length ) ];
			this.trigger( 'dog_bark', { at: { x: d.x, y: num( d.y, 0 ) + 0.6, z: d.z }, size: num( d.scale, 1 ) } );

		} );

	}

	reset() {

		this.pending = null;
		this.foes.clear();
		this.gustAvg = 0;
		this.prevPos = null;
		this.t.fit = - 1;

	}

	dispose() {

		for ( const f of this.off ) try { if ( typeof f === 'function' ) f(); } catch ( e ) { /* ignore */ }
		this.off.length = 0;
		this.loops.dispose();

	}

}
