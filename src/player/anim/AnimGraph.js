import DEF from './AnimDef.js';
import { makeRig, deriveClip, legYaw, strideScale, poseClip, strideSpeed, footMarker, qmul, qconj, qnorm, qslerp, qaxis, qrot } from './ClipTools.js';
import { prepareSpace, spaceWeights, speedLabel } from './BlendSpace.js';

// A UE-style animation graph over a SkinnedModel (src/engine/render/Skinning.js): a state machine with timed transitions
// (crossfade or inertial), blend spaces (polar direction x speed, phase-synced; 1D speed), montages (one-shots on the full
// body or the upper-body overlay slot, blend in / out, rate, reverse, hold, root-motion flag, notifies) and a post pass
// (inertial blending, a lean into turns). The graph only decides layer weights and times: the pose is still sampled from
// the clips by SkinnedModel on the GPU-skinning path. The definition is the data module AnimDef.js (hot-reloaded by Vite).
//
//   const g = new AnimGraph( model, { cacheKey: 'hyptile', upperMask } );   // builds the derived clips into model.clips
//   g.update( dt, ctx );          // ctx: see AnimDef.js; before model.update( dt )
//   g.play( 'swing', { rate, blendIn, blendOut, slot, onEvent } ) -> handle { stop( blendOut ), onEvent, playing, time, weight }
//   g.post( model )               // in model.poseOverride, before the IK: inertial offsets + lean
//   g.capture( model )            // in model.poseOverride, after post: the output the next inertial blend starts from
//   g.state / g.weights() / g.debugLine() / g.onEvent = ( name, info ) => {}   ('footstep' { foot }, montage notifies)
//   g.footLock -> { l, r }  stance weights of the planted feet (a foot-lock hook for the IK)

let _def = DEF;
const LIVE = new Set();
const _cache = new Map(); // cacheKey -> { clips: Map, info: Map }

// hot reload: swap the definition in every live graph (derived clips rebuild)
if ( import.meta.hot ) {

	import.meta.hot.accept( './AnimDef.js', ( mod ) => {

		if ( ! mod || ! mod.default ) return;
		_def = mod.default;
		_cache.clear();
		for ( const g of LIVE ) g.setDef( _def );
		console.info( '[anim] AnimDef reloaded' );

	} );

}

export function animDef() {

	return _def;

}

const smooth = ( x ) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * ( 3 - 2 * x );
const frac = ( x ) => x - Math.floor( x );
// what play() hands back when the montage or its clip does not exist: safe to stop() or give an onEvent
const noopHandle = ( name ) => ( { name, slot: null, playing: false, time: 0, weight: 0, rootMotion: false, stop() {}, onEvent: null } );

export class AnimGraph {

	constructor( model, { def = _def, cacheKey = null, upperMask = null } = {} ) {

		this.model = model;
		this.cacheKey = cacheKey;
		this.upperMask = upperMask;
		this.onEvent = null;
		this.enabled = true;
		this.dt = 0;
		this.ctx = null;
		this._states = []; // { key, name, def, clip, time, w, target, rate, done }
		this._montages = []; // see play()
		this._layers = new Map(); // entry key -> Skinning layer object we own
		this._spaceRt = new Map(); // space name -> { phase, idleTime, times: Map, entries: [], label, dir }
		this._entries = [];
		this._inert = { pending: 0, T: 0, t: 0, active: false };
		this._prevR = null; this._prevT = null; this._havePrev = false;
		this._offR = null; this._offT = null;
		this.lean = 0;
		this._leanOn = false;
		this.footLock = { l: 0, r: 0 };
		this.label = 'idle';
		this.setDef( def );
		LIVE.add( this );

	}

	dispose() {

		LIVE.delete( this );

	}

	// (re)build the derived clips and the blend spaces for a definition
	setDef( def ) {

		this.def = def;
		this._buildClips();
		const has = ( c ) => this.model.clips.has( c );
		this.spaces = {};
		for ( const n in def.spaces ) this.spaces[ n ] = prepareSpace( def.spaces[ n ], has );
		// a state whose clip is missing falls back to the idle
		for ( const s of this._states ) s.def = def.states[ s.name ] || s.def;

	}

	_buildClips() {

		const m = this.model, def = this.def;
		// recipes changed (a hot reload, a test definition): drop what the old ones built
		if ( this._clipsDef && this._clipsDef !== def.clips ) for ( const [ n, c ] of m.clips ) if ( c.procedural ) m.clips.delete( n );
		this._clipsDef = def.clips;
		let cache = this.cacheKey ? _cache.get( this.cacheKey ) : null;
		if ( cache && cache.clipsDef !== def.clips ) cache = null;
		if ( ! cache ) {

			cache = { clips: new Map(), info: new Map(), clipsDef: def.clips };
			if ( this.cacheKey ) _cache.set( this.cacheKey, cache );

		}

		this._info = cache.info;
		let rig = null;
		const get = ( name, depth = 0 ) => {

			if ( m.clips.has( name ) ) return m.clips.get( name );
			if ( cache.clips.has( name ) ) {

				m.clips.set( name, cache.clips.get( name ) );
				return cache.clips.get( name );

			}

			const r = def.clips[ name ];
			if ( ! r || depth > 4 ) return null;
			rig = rig || makeRig( m.gltf );
			if ( ! rig.index.pelvis || ! rig.index.spine_02 ) return null;
			let clip = null;
			try {

				if ( r.keys ) {

					const base = get( r.base, depth + 1 );
					if ( base ) clip = poseClip( rig, base, name, r.keys, { loopBase: !! r.loopBase, baseTime: r.baseTime || 0 } );

				} else {

					const src = get( r.from, depth + 1 );
					if ( src && r.legYaw !== undefined ) clip = deriveClip( rig, src, name, ( loc ) => legYaw( rig, loc, r.legYaw ) );
					else if ( src && r.stride ) clip = strideScale( rig, src, name, r.stride, { lean: r.lean || 0 } );

				}

			} catch ( e ) {

				console.warn( '[anim] could not build clip', name, e );

			}

			if ( clip ) {

				cache.clips.set( name, clip );
				m.clips.set( name, clip );

			}

			return clip;

		};

		for ( const name in def.clips ) get( name );
		// stride info of the phase-synced samples: ground speed at rate 1, stride length per cycle, the left-foot marker.
		// A strafe clip keeps its source's timing and speed (the legs only turn); a longer stride keeps the marker
		const info = ( c, depth = 0 ) => {

			if ( this._info.has( c ) ) return this._info.get( c );
			const clip = m.clips.get( c );
			if ( ! clip ) return null;
			const r = def.clips[ c ], src = r && r.from && depth < 4 ? info( r.from, depth + 1 ) : null;
			let v = 1, mk = 0;
			if ( src && r.legYaw !== undefined ) { v = src.speed; mk = src.marker; } else {

				rig = rig || makeRig( m.gltf );
				try {

					v = strideSpeed( rig, clip ) || 1;
					mk = src ? src.marker : footMarker( rig, clip, 'l' ) / clip.duration;

				} catch ( e ) { /* a rig without feet: unit stride */ }

			}

			const o = { speed: v, duration: clip.duration, stride: v * clip.duration, marker: mk };
			this._info.set( c, o );
			return o;

		};

		for ( const n in def.spaces ) {

			const sp = def.spaces[ n ];
			if ( sp.sync ) for ( const col of sp.columns ) for ( const [ c ] of col.samples ) info( c );

		}

	}

	// ---- per frame

	update( dt, ctx ) {

		this.dt = dt;
		this.ctx = ctx;
		const def = this.def;
		// the state wanted now: the first rule that holds
		const cur = this._states.find( ( s ) => s.target === 1 ) || null;
		const curInfo = cur ? { name: cur.name, time: cur.time, done: cur.done } : { name: null, time: 0, done: false };
		let want = 'locomotion';
		for ( const [ name, rule ] of def.rules ) {

			let ok = false;
			try { ok = rule( ctx, curInfo ); } catch ( e ) { ok = false; }
			if ( ok && def.states[ name ] ) { want = name; break; }

		}

		const sdef = def.states[ want ];
		const clip = sdef.loopClip ? ctx.loopClip : sdef.clip || null;
		const key = want + ( sdef.loopClip ? ':' + clip : '' );
		if ( ! cur ) this._enter( want, key, clip, 0, 'cut' );
		else if ( cur.key !== key ) {

			const b = def.blends[ cur.name + '>' + want ] || def.blends[ cur.name + '>*' ] || def.blends[ '*>' + want ] || def.blends.default;
			this._enter( want, key, clip, b[ 0 ], b[ 1 ] || 'crossfade' );

		}

		// advance the states and their weights
		for ( const s of this._states ) {

			const step = s.rate > 0 ? dt * s.rate : 1;
			s.w = s.target > s.w ? Math.min( s.target, s.w + step ) : Math.max( s.target, s.w - step );
			const d = s.def;
			if ( d.space ) continue;
			const c = s.clip && this.model.clips.get( s.clip );
			if ( ! c ) continue;
			const from = d.from || 0, to = Math.min( d.to || c.duration, c.duration );
			s.time += dt * ( d.rate || 1 );
			if ( d.loop !== false ) s.clipTime = from + frac( ( s.time * 1 ) / Math.max( 1e-3, to - from ) ) * ( to - from );
			else {

				s.clipTime = Math.min( to, from + s.time );
				s.done = from + s.time >= to;

			}

		}

		for ( const s of this._states ) if ( s.def.space ) s.time += dt; // time in state for the rules
		this._states = this._states.filter( ( s ) => s.target === 1 || s.w > 1e-4 );
		// blend spaces in use
		for ( const s of this._states ) if ( s.def.space ) this._space( s.def.space, dt, ctx );
		const top = this._states.find( ( s ) => s.target === 1 );
		this._leanOn = !! ( top && top.def.lean && ctx.grounded );
		this.label = top ? ( top.def.label || ( top.def.space === 'ground' ? this._spaceRt.get( 'ground' ).label : top.name ) ) : 'idle';
		if ( top && top.name === 'deck' && this.label !== 'idle' ) this.label = 'deck';
		this._lean( dt, ctx );
		this._advanceMontages( dt );
		this._write();

	}

	_enter( name, key, clip, blend, mode ) {

		let s = this._states.find( ( x ) => x.key === key );
		const sdef = this.def.states[ name ];
		if ( mode === 'inertial' || mode === 'cut' || blend <= 0 ) {

			if ( mode === 'inertial' && blend > 0 ) this.inertialize( blend );
			this._states.length = 0;
			s = null;

		}

		for ( const x of this._states ) {

			x.target = 0;
			x.rate = blend > 0 ? 1 / blend : 0;

		}

		if ( ! s ) {

			s = { key, name, def: sdef, clip, time: 0, clipTime: sdef.from || 0, w: this._states.length ? 0 : 1, target: 1, rate: 0, done: false };
			this._states.push( s );

		}

		s.target = 1;
		s.rate = blend > 0 ? 1 / blend : 0;
		if ( ! this._states.some( ( x ) => x !== s && x.w > 0 ) ) s.w = 1;
		this._emit( 'state', { name, from: this.label } );

	}

	// a blend space's runtime: weights, the synced phase, the idle and 1d times
	_space( name, dt, ctx ) {

		let rt = this._spaceRt.get( name );
		if ( ! rt ) {

			rt = { phase: 0, idleTime: Math.random() * 2, times: new Map(), entries: [], label: 'idle', dir: 0, frame: - 1 };
			this._spaceRt.set( name, rt );

		}

		if ( rt.frame === this._frameId ) return rt;
		rt.frame = this._frameId;
		const bs = this.spaces[ name ];
		if ( ! bs ) return rt;
		const speed = Math.max( 0, ctx.speed || 0 );
		spaceWeights( bs, { forward: ctx.forward, strafe: ctx.strafe, speed }, rt.entries );
		rt.dir = Math.hypot( ctx.forward || 0, ctx.strafe || 0 ) > 1e-3 ? Math.atan2( ctx.strafe || 0, ctx.forward || 0 ) * 180 / Math.PI : 0;
		if ( bs.def.labels ) rt.label = speedLabel( bs.def.labels, speed );
		if ( bs.def.sync ) {

			// one phase for every moving sample: the cycle length is the weighted stride, so the feet match the ground speed
			let W = 0, L = 0, D = 0;
			for ( const e of rt.entries ) {

				if ( e.idle ) continue;
				const inf = this._info.get( e.clip );
				if ( ! inf ) continue;
				W += e.w; L += e.w * inf.stride; D += e.w * inf.duration;

			}

			const prev = rt.phase;
			if ( W > 1e-4 ) {

				L /= W; D /= W;
				const rate = Math.min( speed / Math.max( 1e-3, L ), ( bs.def.maxRate || 2 ) / Math.max( 1e-3, D ) );
				rt.phase = frac( rt.phase + dt * rate );

			}

			rt.idleTime += dt;
			this._footEvents( prev, rt.phase, speed, W );
			this._footLock( rt, speed, W );

		} else {

			for ( const e of rt.entries ) {

				const r = e.speed > 0 ? Math.max( bs.def.minRate || 0.5, Math.min( bs.def.maxRate || 2, speed / e.speed ) ) : 1;
				rt.times.set( e.key, ( rt.times.get( e.key ) || 0 ) + dt * r );

			}

		}

		return rt;

	}

	_footEvents( a, b, speed, moving ) {

		if ( speed < 0.5 || moving < 0.3 || ! this.ctx.grounded || a === b ) return;
		const F = this.def.footsteps || [];
		for ( let i = 0; i < F.length; i ++ ) {

			const p = F[ i ];
			const crossed = b >= a ? p > a && p <= b : p > a || p <= b;
			if ( crossed ) this._emit( 'footstep', { foot: i === 0 ? 'l' : 'r', speed } );

		}

	}

	_footLock( rt, speed, moving ) {

		const st = this.def.stance || {};
		if ( ! this.ctx.grounded || moving < 0.2 ) {

			this.footLock.l = this.footLock.r = this.ctx.grounded ? 1 : 0;
			return;

		}

		const run = smooth( ( speed - 1.6 ) / 1.2 );
		const w = st.walk || [ 0.1, 0.62 ], r = st.run || [ 0.14, 0.4 ];
		const a = w[ 0 ] + ( r[ 0 ] - w[ 0 ] ) * run, b = w[ 1 ] + ( r[ 1 ] - w[ 1 ] ) * run;
		const win = ( p ) => {

			// 1 inside [ a, b ], eased over 0.05 at the edges
			const e = 0.05;
			return p < a - e || p > b + e ? 0 : p < a ? smooth( ( p - a + e ) / e ) : p > b ? smooth( ( b + e - p ) / e ) : 1;

		};

		this.footLock.l = win( rt.phase );
		this.footLock.r = win( frac( rt.phase + 0.5 ) );

	}

	// ---- montages

	play( name, opts = {} ) {

		const def = this.def;
		let md = def.montages[ name ];
		if ( name === 'hit' && opts.dir && def.montages[ 'hit' + opts.dir[ 0 ].toUpperCase() + opts.dir.slice( 1 ) ] ) md = def.montages[ 'hit' + opts.dir[ 0 ].toUpperCase() + opts.dir.slice( 1 ) ];
		if ( ! md && this.model.clips.has( name ) ) md = { clip: name, slot: 'full' }; // a clip name works too
		if ( ! md ) return noopHandle( name );
		const clip = this.model.clips.get( opts.clip || md.clip );
		if ( ! clip ) return noopHandle( name );
		const slot = opts.slot || md.slot || 'full';
		const rev = !! ( opts.reverse ?? md.reverse );
		const from = opts.from ?? md.from ?? 0, to = Math.min( clip.duration, opts.to ?? md.to ?? clip.duration );
		const mt = {
			name, slot, clip, from, to, reverse: rev,
			rate: ( md.rate || 1 ) * ( opts.rate || 1 ),
			loop: !! ( opts.loop ?? md.loop ), hold: !! ( opts.hold ?? md.hold ),
			blendIn: opts.blendIn ?? md.blendIn ?? 0.15, blendOut: opts.blendOut ?? md.blendOut ?? 0.2,
			notifies: md.notifies || [], rootMotion: !! ( opts.rootMotion ?? md.rootMotion ),
			time: rev ? to : from, w: 0, target: 1, fade: 0, ended: false, outStarted: false, layer: null, fromAction: !! opts.fromAction,
			onEvent: opts.onEvent || null,
		};
		mt.fade = mt.blendIn;
		// one montage per slot: the one playing blends out over the new one's blend-in
		for ( const o of this._montages ) if ( o.slot === slot && o.target === 1 ) this._stopMontage( o, mt.blendIn, 'interrupted' );
		if ( slot === 'upper' ) {

			mt.layer = this.model.setOverlay( clip.name, { mask: this.upperMask, fade: Math.max( mt.blendIn, 0.01 ), loop: false, restart: true, from: mt.time } );
			mt.layer.speed = 0;
			mt.w = 1; // the overlay amount does the blend-in

		} else if ( mt.blendIn <= 0 ) mt.w = 1;
		this._montages.push( mt );
		const g = this;
		const h = {
			name, slot, rootMotion: mt.rootMotion, onEvent: null,
			get playing() { return ! mt.ended && mt.target === 1; },
			get time() { return mt.time; },
			get weight() { return mt.w; },
			stop( blendOut = mt.blendOut ) { if ( ! mt.ended ) g._stopMontage( mt, blendOut, 'interrupted' ); },
		};
		mt.handle = h;
		this._mEmit( mt, 'start' );
		return h;

	}

	_mEmit( mt, name, info = null ) {

		const ev = { montage: mt.name, slot: mt.slot, time: mt.time, ...( info || {} ) };
		try {

			if ( mt.handle && mt.handle.onEvent ) mt.handle.onEvent( name, ev );
			if ( mt.onEvent ) mt.onEvent( name, ev );

		} catch ( e ) { console.warn( '[anim] montage event handler', e ); }

		this._emit( name, ev );

	}

	_emit( name, info ) {

		if ( this.onEvent ) try { this.onEvent( name, info ); } catch ( e ) { console.warn( '[anim] event handler', e ); }

	}

	_stopMontage( mt, blendOut, why ) {

		if ( mt.target === 0 ) return;
		mt.target = 0;
		mt.fade = Math.max( 0, blendOut );
		mt.stopWhy = why;
		if ( mt.slot === 'upper' && this.upperOwner() === mt ) this.model.setOverlay( null, { fade: Math.max( 0.01, blendOut ) } );
		if ( ! mt.outStarted ) {

			mt.outStarted = true;
			this._mEmit( mt, 'blendOut', { why } );

		}

	}

	// the upper-slot montage that owns the overlay now (playing or blending out), or null
	upperOwner() {

		for ( let i = this._montages.length - 1; i >= 0; i -- ) if ( this._montages[ i ].slot === 'upper' && ! this._montages[ i ].ended ) return this._montages[ i ];
		return null;

	}

	get upperBusy() {

		return this._montages.some( ( m ) => m.slot === 'upper' && m.target === 1 && ! m.ended );

	}

	// a full-body montage is playing (not blending out)
	get fullBusy() {

		return this._montages.some( ( m ) => m.slot === 'full' && m.target === 1 && ! m.ended );

	}

	montage( slot = 'full' ) {

		const m = this._montages.find( ( x ) => x.slot === slot && x.target === 1 && ! x.ended );
		return m ? m.handle : null;

	}

	stopMontages( slot = null, blendOut = 0.2 ) {

		for ( const m of this._montages ) if ( ! slot || m.slot === slot ) this._stopMontage( m, blendOut, 'interrupted' );

	}

	_advanceMontages( dt ) {

		for ( const mt of this._montages ) {

			if ( mt.ended ) continue;
			const t0 = mt.time;
			const span = mt.to - mt.from;
			if ( mt.reverse ) mt.time -= dt * mt.rate;
			else mt.time += dt * mt.rate;
			let atEnd = false;
			if ( mt.loop && span > 0 ) {

				if ( mt.time > mt.to ) mt.time = mt.from + ( mt.time - mt.from ) % span;
				if ( mt.time < mt.from ) mt.time = mt.to - ( mt.to - mt.time ) % span;

			} else if ( ! mt.reverse && mt.time >= mt.to ) { mt.time = mt.to; atEnd = true; } else if ( mt.reverse && mt.time <= mt.from ) { mt.time = mt.from; atEnd = true; }
			// notifies crossed this frame (clip time)
			for ( const [ nt, nn ] of mt.notifies ) {

				const hit = mt.reverse ? nt < t0 && nt >= mt.time : nt > t0 && nt <= mt.time;
				if ( hit ) this._mEmit( mt, nn );

			}

			// the blend-out starts so that it ends with the clip
			const left = mt.reverse ? ( mt.time - mt.from ) / mt.rate : ( mt.to - mt.time ) / mt.rate;
			if ( mt.target === 1 && ! mt.loop && ! mt.hold && ( left <= mt.blendOut || atEnd ) ) this._stopMontage( mt, Math.max( 1e-3, Math.min( mt.blendOut, left ) ), 'end' );
			// weight
			if ( mt.slot === 'full' ) {

				const step = mt.fade > 0 ? dt / mt.fade : 1;
				mt.w = mt.target > mt.w ? Math.min( mt.target, mt.w + step ) : Math.max( mt.target, mt.w - step );

			} else if ( mt.target === 0 ) mt.w = Math.max( 0, mt.w - ( mt.fade > 0 ? dt / mt.fade : 1 ) );
			if ( mt.layer ) mt.layer.time = Math.min( mt.time, mt.clip.duration - 1e-4 );
			if ( mt.target === 0 && mt.w <= 0 ) {

				mt.ended = true;
				this._mEmit( mt, 'end', { why: mt.stopWhy || 'end' } );

			}

		}

		this._montages = this._montages.filter( ( m ) => ! m.ended );

	}

	// ---- layers: the weighted entries of the states and montages become SkinnedModel base layers

	_write() {

		const m = this.model, E = this._entries;
		E.length = 0;
		// montages on the full body take their weight off the state machine
		let MW = 0;
		for ( const mt of this._montages ) if ( mt.slot === 'full' ) MW += smooth( mt.w );
		const mScale = MW > 1 ? 1 / MW : 1;
		const sScale = Math.max( 0, 1 - Math.min( 1, MW ) );
		let SW = 0;
		for ( const s of this._states ) SW += smooth( s.w );
		for ( const s of this._states ) {

			const w = smooth( s.w ) / ( SW || 1 ) * sScale;
			if ( w <= 1e-5 ) continue;
			if ( s.def.space ) {

				const rt = this._spaceRt.get( s.def.space );
				if ( ! rt ) continue;
				const sync = this.spaces[ s.def.space ] && this.spaces[ s.def.space ].def.sync;
				for ( const e of rt.entries ) {

					let t;
					const c = m.clips.get( e.clip );
					if ( ! c ) continue;
					if ( e.idle ) t = rt.idleTime % c.duration;
					else if ( sync ) {

						const inf = this._info.get( e.clip );
						const mk = inf ? inf.marker : 0;
						t = frac( e.reverse ? mk - rt.phase : mk + rt.phase ) * c.duration;

					} else t = ( rt.times.get( e.key ) || 0 ) % c.duration;
					E.push( { key: 's:' + e.key, clip: c, time: t, w: w * e.w } );

				}

			} else {

				const c = s.clip && m.clips.get( s.clip ) || m.clips.get( this.def.spaces.ground && this.def.spaces.ground.idle ) || null;
				if ( c ) E.push( { key: 'c:' + s.key, clip: c, time: s.clipTime || 0, w } );

			}

		}

		for ( const mt of this._montages ) if ( mt.slot === 'full' ) {

			const w = smooth( mt.w ) * mScale;
			if ( w > 1e-5 ) E.push( { key: 'm:' + mt.name + ':' + this._montages.indexOf( mt ), clip: mt.clip, time: mt.time, w } );

		}

		// merge by key, normalise
		const byKey = this._byKey || ( this._byKey = new Map() );
		byKey.clear();
		let W = 0;
		for ( const e of E ) {

			const o = byKey.get( e.key );
			if ( o ) o.w += e.w; else byKey.set( e.key, e );
			W += e.w;

		}

		// layers someone else started (the ragdoll's get-up, a direct model.play): cut over with an inertial blend
		for ( const l of m.layers ) if ( ! l._graph && l.weight > 0.01 ) { this.inertialize( this.def.inertial || 0.25 ); break; }
		const out = [];
		let best = null;
		for ( const e of byKey.values() ) {

			let l = this._layers.get( e.key );
			if ( ! l || l.clip !== e.clip ) {

				l = { clip: e.clip, time: 0, weight: 0, target: 0, fade: 1e9, loop: true, speed: 0, ended: false, _graph: true };
				this._layers.set( e.key, l );

			}

			l.weight = e.w / ( W || 1 );
			l.time = Math.min( Math.max( 0, e.time ), e.clip.duration - 1e-4 );
			l.fade = 1e9; l.speed = 0; l.loop = true; l.ended = false;
			l.target = l.weight;
			if ( ! best || l.weight > best.weight ) best = l;
			out.push( l );

		}

		if ( best ) best.target = 1; // SkinnedModel.current names the heaviest layer
		for ( const k of this._layers.keys() ) if ( ! byKey.has( k ) ) this._layers.delete( k );
		if ( out.length ) m.layers = out; // never an empty list: that would show the bind (A-) pose
		this._frameId = ( this._frameId || 0 ) + 1;

	}

	// ---- post pass (inside model.poseOverride, before the IK)

	inertialize( duration = this.def.inertial || 0.25 ) {

		this._inert.pending = Math.max( this._inert.pending, duration );

	}

	_lean( dt, ctx ) {

		const L = this.def.lean || { k: 0, max: 0, rate: 6 };
		const target = this._leanOn ? Math.max( - L.max, Math.min( L.max, ( ctx.turn || 0 ) * ( ctx.speed || 0 ) * L.k ) ) : 0;
		this.lean += ( target - this.lean ) * ( 1 - Math.exp( - dt * L.rate ) );
		if ( Math.abs( this.lean ) < 2e-3 && target === 0 ) this.lean = 0; // 0.1 deg: done

	}

	post( m ) {

		const N = m.nodeCount, L = m.local;
		// lean into a turn: the whole body rolls about the feet (the root origin), toward the inside of the turn
		if ( this.lean !== 0 ) {

			const pi = this._pelvis ?? ( this._pelvis = m.gltf.nodes.findIndex( ( n ) => n.name === 'pelvis' ) );
			if ( pi >= 0 ) {

				let P = [ 0, 0, 0, 1 ];
				for ( let a = m.parent[ pi ]; a >= 0; a = m.parent[ a ] ) P = qmul( Array.from( L[ a ].r ), P );
				// turning left (+turn) leans left: the top toward +X = a negative roll about +Z
				const k = qmul( qmul( qconj( P ), qaxis( 'z', - this.lean ) ), P );
				const r = qnorm( qmul( k, Array.from( L[ pi ].r ) ) ), t = qrot( k, Array.from( L[ pi ].t ) );
				L[ pi ].r.set( r );
				L[ pi ].t.set( t );

			}

		}

		// inertial blend: at a cut the offset from the last output pose to the new one decays to nothing
		const I = this._inert;
		if ( I.pending > 0 && this._havePrev && this._prevR.length === N * 4 ) {

			if ( ! this._offR || this._offR.length !== N * 4 ) { this._offR = new Float32Array( N * 4 ); this._offT = new Float32Array( N * 3 ); }
			const pr = this._prevR, pt = this._prevT, oR = this._offR, oT = this._offT;
			for ( let i = 0; i < N; i ++ ) {

				const c = L[ i ].r, o = i * 4;
				// off = prev * conj( cur )
				const q = qmul( [ pr[ o ], pr[ o + 1 ], pr[ o + 2 ], pr[ o + 3 ] ], [ - c[ 0 ], - c[ 1 ], - c[ 2 ], c[ 3 ] ] );
				if ( q[ 3 ] < 0 ) { q[ 0 ] = - q[ 0 ]; q[ 1 ] = - q[ 1 ]; q[ 2 ] = - q[ 2 ]; q[ 3 ] = - q[ 3 ]; }
				oR[ o ] = q[ 0 ]; oR[ o + 1 ] = q[ 1 ]; oR[ o + 2 ] = q[ 2 ]; oR[ o + 3 ] = q[ 3 ];
				const tt = L[ i ].t;
				oT[ i * 3 ] = pt[ i * 3 ] - tt[ 0 ]; oT[ i * 3 + 1 ] = pt[ i * 3 + 1 ] - tt[ 1 ]; oT[ i * 3 + 2 ] = pt[ i * 3 + 2 ] - tt[ 2 ];

			}

			I.T = I.pending; I.t = 0; I.active = true;

		}

		I.pending = 0;
		if ( I.active ) {

			const f = 1 - smooth( I.t / I.T );
			const oR = this._offR, oT = this._offT;
			const id = [ 0, 0, 0, 1 ];
			for ( let i = 0; i < N; i ++ ) {

				const o = i * 4;
				if ( oR[ o + 3 ] > 0.99999 && Math.abs( oT[ i * 3 ] ) + Math.abs( oT[ i * 3 + 1 ] ) + Math.abs( oT[ i * 3 + 2 ] ) < 1e-6 ) continue;
				const q = qslerp( id, [ oR[ o ], oR[ o + 1 ], oR[ o + 2 ], oR[ o + 3 ] ], f );
				const r = qnorm( qmul( q, Array.from( L[ i ].r ) ) );
				L[ i ].r.set( r );
				const tt = L[ i ].t;
				tt[ 0 ] += oT[ i * 3 ] * f; tt[ 1 ] += oT[ i * 3 + 1 ] * f; tt[ 2 ] += oT[ i * 3 + 2 ] * f;

			}

			I.t += this.dt;
			if ( I.t >= I.T ) I.active = false;

		}

	}

	// remember the pose the frame ended with (before the IK), where the next inertial blend starts
	capture( m ) {

		const N = m.nodeCount;
		if ( ! this._prevR || this._prevR.length !== N * 4 ) { this._prevR = new Float32Array( N * 4 ); this._prevT = new Float32Array( N * 3 ); }
		for ( let i = 0; i < N; i ++ ) {

			this._prevR.set( m.local[ i ].r, i * 4 );
			this._prevT.set( m.local[ i ].t, i * 3 );

		}

		this._havePrev = true;

	}

	get inertialActive() {

		return this._inert.active || this._inert.pending > 0;

	}

	// ---- inspection

	get state() {

		return this.label;

	}

	get stateName() {

		const s = this._states.find( ( x ) => x.target === 1 );
		return s ? s.name : null;

	}

	// [ [ clipName, weight ], ... ] of the base layers, heaviest first
	weights() {

		return this.model.layers.filter( ( l ) => l._graph ).map( ( l ) => [ l.clip.name, l.weight ] ).sort( ( a, b ) => b[ 1 ] - a[ 1 ] );

	}

	debugLine() {

		const c = this.ctx || {};
		const g = this._spaceRt.get( 'ground' );
		const w = this.weights().slice( 0, 4 ).map( ( [ n, x ] ) => n + ' ' + x.toFixed( 2 ) ).join( ', ' );
		const mt = this._montages.map( ( x ) => `${ x.name }(${ x.slot } ${ x.w.toFixed( 2 ) } t=${ x.time.toFixed( 2 ) })` ).join( ' ' );
		return `[anim] ${ this.label } (${ this.stateName }) v=${ ( c.speed || 0 ).toFixed( 2 ) } dir=${ g ? g.dir.toFixed( 0 ) : 0 } phase=${ g ? g.phase.toFixed( 2 ) : '-' } lean=${ this.lean.toFixed( 3 ) }${ this._inert.active ? ' inertial' : '' } | ${ w }${ mt ? ' | ' + mt : '' } | overlay ${ this.model.overlay || '-' }`;

	}

}
