import { SCENARIOS, SCOPES, DEFAULT_WARM, DEFAULT_FRAMES, parsePerfQuery, summarize, budget, rankScopes, cullingCandidates } from './scenarios.js';
import { WORLD } from '../../src/world/WorldLayout.js';
import { CHARACTER_IDS } from '../../src/game/Characters.js';

// All-features performance scenarios in the browser (P1 of docs/UNREAL_PARITY.md): loaded by main.js on a ?bench page
// with &perf=<ids> (see scenarios.js; 'all', 'every' or a list), it stops the render loop like core/Bench.js, sets each
// scenario up (time, weather, place, ships, guns, a crowd of stand-in players), renders warm-up frames, then measured
// frames with a timer around every system's update / render (SCOPES plus one scope per feature), the CPU time of each
// frame, and the GPU time from the bench's timestamp queries when the adapter has them.
//
//   const report = await runPerf( app, { scenarios: 'navalFight,storm', bench: window.__bench, url, tag } )
//   report = { tag, at, ua, size, scenarios: { id: { name, frames, cpu, gpu, budget, scopes, passes, setup } }, candidates, unverified }
//   url (e.g. 'http://127.0.0.1:5190/', tools/perf/collect.mjs) receives perf-<tag>.json; window.__perf holds the report
//
// The page's saves are switched off for the run (state.storage = null): the scenarios buy boats and move the player.
// Everything a scenario adds (ships, peers, the weather pick) is taken away after it.

const now = () => ( typeof performance !== 'undefined' ? performance.now() : Date.now() );
const at = ( obj, path ) => ( path ? path.split( '.' ).reduce( ( o, k ) => ( o ? o[ k ] : undefined ), obj ) : obj );

// wraps obj[ method ] with a timer adding to sink[ label ]; returns the undo
export function wrapScope( obj, method, label, sink ) {

	if ( ! obj || typeof obj[ method ] !== 'function' ) return null;
	const own = Object.prototype.hasOwnProperty.call( obj, method );
	const orig = obj[ method ];
	obj[ method ] = function ( ...args ) {

		const t = now();
		try {

			return orig.apply( this, args );

		} finally {

			sink[ label ] = ( sink[ label ] || 0 ) + ( now() - t );

		}

	};

	return () => {

		if ( own ) obj[ method ] = orig;
		else delete obj[ method ];

	};

}

// every scope that exists on this app (the features' aggregate is left out when each feature has its own)
export function installScopes( app, sink ) {

	const undo = [];
	const feats = app.features && app.features.list instanceof Map ? app.features.list : null;
	for ( const [ label, path, method ] of SCOPES ) {

		if ( label === 'features' && feats && feats.size ) continue;
		const u = wrapScope( at( app, path ), method, label, sink );
		if ( u ) undo.push( u );

	}

	// every mesh pass by its label ('pass:opaque', 'pass:shadow cascade 0', ...): CPU time of the collect + draw recording,
	// and the draws it issued ('draws:<label>', a count per frame, not ms)
	const mr = app.engine && app.engine.meshRenderer;
	if ( mr && typeof mr.render === 'function' ) {

		const own = Object.prototype.hasOwnProperty.call( mr, 'render' );
		const orig = mr.render;
		mr.render = function ( scene, pass ) {

			const t = now(), d0 = this.stats ? this.stats.draws : 0, t0 = this.stats ? this.stats.triangles : 0;
			try {

				return orig.call( this, scene, pass );

			} finally {

				const label = ( pass && pass.label ) || ( pass && pass.kind ) || 'pass';
				sink[ 'pass:' + label ] = ( sink[ 'pass:' + label ] || 0 ) + ( now() - t );
				if ( this.stats ) sink[ 'draws:' + label ] = ( sink[ 'draws:' + label ] || 0 ) + ( this.stats.draws >= d0 ? this.stats.draws - d0 : this.stats.draws ); // (the first pass of a frame resets the counter)
				if ( this.stats ) sink[ 'tris:' + label ] = ( sink[ 'tris:' + label ] || 0 ) + ( this.stats.triangles >= t0 ? this.stats.triangles - t0 : this.stats.triangles ); // (wave 19A: triangles, a count)

			}

		};
		undo.push( () => { if ( own ) mr.render = orig; else delete mr.render; } );

	}

	if ( feats ) for ( const [ name, f ] of feats ) {

		const u = wrapScope( f && f.instance, 'update', 'feature:' + name, sink );
		if ( u ) undo.push( u );

	}

	return () => { for ( const u of undo.reverse() ) u(); };

}

function groundAt( app, x, z ) {

	const td = app.terrainData, col = app.colliders;
	return Math.max( td && td.heightAt ? td.heightAt( x, z ) : 0, col && col.groundHeightAt ? col.groundHeightAt( x, z, 50 ) : - Infinity );

}

function placeOf( place ) {

	if ( place.port !== undefined ) {

		const port = ( WORLD.ports || [] ).find( ( p ) => p.id === place.port );
		const s = port ? ( port.stand || port.center ) : WORLD.start.position;
		return { x: s.x, z: s.z, heading: Number.isFinite( place.heading ) ? place.heading : Number.isFinite( s.yaw ) ? s.yaw : 0 }; // (wave 22A: a view may face its own way)

	}

	// an island's dock (WORLD.blackwater: not a port), else the scenario's own x, z
	const isl = place.at ? WORLD[ place.at ] : null;
	if ( isl && isl.dock && isl.dock.position ) return { x: isl.dock.position.x, z: isl.dock.position.z, heading: place.heading ?? isl.dock.heading ?? 0 };
	return { x: place.x, z: place.z, heading: place.heading || 0 };

}

// sets a scenario up; returns { undo(), tick( dt, t ), info }
export async function setupScenario( app, s ) {

	const undo = [];
	const info = { ships: 0, peers: 0, weather: null, place: s.place.kind, notes: [] };
	const p = app.player, b = app.boatCtl, st = app.game && app.game.state;
	if ( app.freeCam && app.setFreeCam && s.place.kind !== 'fly' ) app.setFreeCam( false );
	if ( app.settings ) {

		app.settings.timeOfDay = s.time;
		const speed = app.settings.timeSpeed;
		app.settings.timeSpeed = 0; // the clock holds still while measured
		undo.push( () => { app.settings.timeSpeed = speed; } );

	}

	// weather (sandbox: a manual pick)
	const w = app.features && app.features.get ? app.features.get( 'weather' ) : null;
	if ( w && w.setManual ) {

		const ok = w.setManual( s.weather && s.weather !== 'clear' ? s.weather : 'clear', s.intensity ?? 1 );
		info.weather = ok === false ? 'refused' : s.weather;
		undo.push( () => w.setManual( null ) );

	} else if ( s.weather && s.weather !== 'clear' ) info.notes.push( 'no weather feature' );

	// the place
	const pl = placeOf( s.place );
	try {

		if ( p && p.mode === 'boat' && p.leaveHelm ) p.leaveHelm();
		if ( p && ( p.mode === 'deck' || p.mode === 'seat' ) && p.exitBoat ) p.exitBoat( null, 1 );
		if ( s.place.kind === 'fly' ) {

			const q = s.place.pose;
			if ( app.setFreeCam ) app.setFreeCam( true );
			if ( app.fly && app.fly.setPose && app.fly.camera ) app.fly.setPose( app.fly.camera.position.clone().set( q.x, q.y, q.z ), q.yaw || 0, q.pitch || 0 );

		} else if ( s.place.kind === 'walk' ) {

			// wave 20A: inside a room (the interiors feature's spawn point and floor), else on the ground at x, z
			const it = s.place.interior && app.features && app.features.get ? app.features.get( 'interiors' ) : null;
			const room = it && it.enter ? it.enter( s.place.interior ) : null;
			if ( s.place.interior && ! room ) info.notes.push( 'no interior ' + s.place.interior );
			const y = room ? room.y + 0.05 : groundAt( app, pl.x, pl.z ) + 0.1;
			const x = room ? room.x : pl.x, z = room ? room.z : pl.z, yaw = room ? room.yaw : pl.heading;
			if ( typeof app._placePlayer === 'function' ) app._placePlayer( x, y, z, yaw );
			else if ( p && p.position ) p.position.set( x, y, z );

		} else {

			// aboard: the scenario's boat (free in the sandbox), held on a mooring out in open water
			if ( st && s.place.boat && st.boat !== s.place.boat && st.buyBoat ) st.buyBoat( s.place.boat );
			if ( app.setBoat && st ) app.setBoat( st.boat );
			if ( typeof app._placeBoat === 'function' ) app._placeBoat( { x: pl.x, z: pl.z, heading: pl.heading, moored: true } );
			else if ( b && b.position ) b.position.set( pl.x, 0, pl.z );
			if ( p ) {

				if ( s.place.kind === 'helm' && p.enterBoat ) p.enterBoat();
				else if ( p.boardBoat ) p.boardBoat();

			}

		}

	} catch ( e ) {

		info.notes.push( 'place failed: ' + ( e && e.message ) );

	}

	// wave 22A: a car driven for the run (the cars feature: a sedan at the spot, the player at its wheel, coasting)
	if ( s.car ) {

		const cars = app.features && app.features.get ? app.features.get( 'cars' ) : null;
		try {

			if ( cars && cars._record && cars.enter ) {

				const y = groundAt( app, pl.x, pl.z );
				const rec = cars._record( s.car, { x: pl.x, y, z: pl.z, yaw: pl.heading, state: 'idle' } );
				rec.mine = true;
				cars.records.push( rec );
				const r = cars.enter( rec );
				if ( r && r.ok ) {

					info.notes.push( 'driving ' + s.car );
					undo.push( () => { try { cars.exit( { force: true } ); cars._drop( rec ); } catch ( e ) { /* gone */ } } );

				} else info.notes.push( 'car refused: ' + ( r && r.reason ) );

			} else info.notes.push( 'no cars feature' );

		} catch ( e ) { info.notes.push( 'car failed: ' + ( e && e.message ) ); }

	}

	// ships
	const nv = app.features && app.features.get ? app.features.get( 'naval' ) : null;
	const spawned = [];
	if ( s.ships.length ) {

		if ( ! nv || ! nv.spawn ) info.notes.push( 'no naval feature' );
		else for ( const sh of s.ships ) {

			try {

				const x = pl.x + sh.dx, z = pl.z + sh.dz;
				spawned.push( nv.spawn( sh.kind, { x, z, yaw: Math.atan2( - sh.dx, - sh.dz ), state: sh.state } ) );

			} catch ( e ) { info.notes.push( `spawn ${ sh.kind } failed` ); }

		}

		info.ships = spawned.length;
		undo.push( () => {

			for ( let i = nv.ships.length - 1; i >= 0; i -- ) {

				if ( ! spawned.includes( nv.ships[ i ] ) ) continue;
				if ( typeof nv._removeShip === 'function' ) nv._removeShip( i );
				else nv.ships.splice( i, 1 );

			}

		} );

	}

	if ( s.fire && nv && nv.playerGun && ! nv.playerGun.owned ) {

		try { nv.playerGun.owned = true; } catch ( e ) { /* a read-only record */ }
		undo.push( () => { try { nv.playerGun.owned = false; } catch ( e ) { /* ignore */ } } );

	}

	// wave 19A: a melee weapon drawn (owned for the run; slot 1 = the melee hand)
	const wp = s.weapon && app.features && app.features.get ? app.features.get( 'weapons' ) : null;
	if ( s.weapon && ! wp ) info.notes.push( 'no weapons feature' );
	else if ( wp ) {

		try {

			const had = wp.owned ? !! wp.owned[ s.weapon ] : false;
			if ( wp.owned ) wp.owned[ s.weapon ] = true;
			wp.melee = s.weapon;
			if ( wp.hand !== 'melee' && wp.slot ) wp.slot( 'melee' );
			info.weapon = wp.hand === 'melee' ? wp.melee : 'not drawn';
			undo.push( () => { if ( wp.hand === 'melee' && wp.slot ) { wp.hand = null; } if ( wp.owned && ! had ) wp.owned[ s.weapon ] = false; } );

		} catch ( e ) { info.notes.push( 'weapon failed: ' + ( e && e.message ) ); }

	}

	// a crowd of stand-in players (the multiplayer avatars and name tags), walking circles around the player
	let rp = app.remotePlayers, made = false;
	if ( s.peers > 0 && ! rp ) {

		try {

			const { RemotePlayers } = await import( '../../src/net/RemotePlayers.js' );
			const ui = app.ui && app.ui.ui;
			rp = new RemotePlayers( { scene: app.scene, camera: app.camera, hud: ui ? ( ui.hud || ui.root ) : null } );
			app.remotePlayers = rp;
			made = true;

		} catch ( e ) { info.notes.push( 'no remote players: ' + ( e && e.message ) ); rp = null; }

	}

	const peers = [];
	if ( rp && s.peers > 0 ) {

		for ( let i = 0; i < s.peers; i ++ ) peers.push( { id: `perf-${ i }`, name: `Bench ${ i + 1 }`, character: CHARACTER_IDS[ i % CHARACTER_IDS.length ], r: 6 + ( i % 5 ) * 3.5, a: ( i / s.peers ) * Math.PI * 2, w: 0.12 + ( i % 3 ) * 0.04 } );
		info.peers = peers.length;
		undo.push( () => {

			for ( const q of peers ) if ( rp.removePeer ) rp.removePeer( q.id );
			if ( made ) {

				if ( rp.dispose ) rp.dispose();
				app.remotePlayers = null;

			}

		} );

	}

	let fireT = 0, side = 'port';
	const tick = ( dt, t ) => {

		if ( peers.length && rp && rp.applyStates ) {

			const list = peers.map( ( q ) => {

				const a = q.a + t * q.w;
				const x = pl.x + Math.cos( a ) * q.r, z = pl.z + Math.sin( a ) * q.r;
				return { id: q.id, name: q.name, character: q.character, p: [ x, groundAt( app, x, z ), z ], yaw: a + Math.PI, mode: 'walk', speed: q.r * q.w, grounded: true };

			} );
			rp.applyStates( list, Date.now() );

		}

		if ( s.fire && nv && nv.fire ) {

			fireT += dt;
			if ( fireT >= s.fire.every ) {

				fireT = 0;
				nv.fire( side );
				side = side === 'port' ? 'starboard' : 'port';

			}

		}

	};

	return { undo: () => { for ( const u of undo.reverse() ) try { u(); } catch ( e ) { /* best effort */ } }, tick, info };

}

// frames back to back, at most two in flight (like core/Bench.js)
async function frames( app, n, dt, tick, t0, onFrame, waitGpu ) {

	let pending = null;
	let t = t0;
	for ( let i = 0; i < n; i ++ ) {

		tick( dt, t );
		const a = now();
		app.frame( dt );
		const cpu = now() - a;
		if ( onFrame ) onFrame( cpu );
		t += dt;
		const done = waitGpu ? waitGpu() : null;
		if ( pending ) await pending;
		pending = done;

	}

	if ( pending ) await pending;
	return t;

}

export async function runPerf( app, { scenarios = 'default', frames: nFrames = null, warm = null, dt = 1 / 60, bench = null, url = null, tag = 'perf', waitGpu = undefined, memory = null, onMeasure = null } = {} ) {

	const ids = Array.isArray( scenarios ) ? scenarios.filter( ( id ) => SCENARIOS[ id ] ) : parsePerfQuery( scenarios );
	if ( app.engine && app.engine.stop ) app.engine.stop();
	if ( bench && bench.setSize ) bench.setSize();
	const st = app.game && app.game.state;
	const storage = st ? st.storage : null;
	if ( st ) st.storage = null; // no saves from a bench run
	if ( waitGpu === undefined ) waitGpu = app.gpu && app.gpu.queue ? () => app.gpu.queue.onSubmittedWorkDone() : null;
	const gpuOn = !! ( bench && bench.enabled );
	const report = {
		tag, at: new Date().toISOString(), ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
		size: app.engine && app.engine.canvas ? [ app.engine.canvas.width, app.engine.canvas.height ] : null, gpuTimestamps: gpuOn, scenarios: {},
	};
	try {

		for ( const id of ids ) {

			const s = { ...SCENARIOS[ id ] };
			const set = await setupScenario( app, s );
			try {

				let t = await frames( app, warm ?? s.warm ?? DEFAULT_WARM, dt, set.tick, 0, null, waitGpu );
				const n = nFrames ?? s.frames ?? DEFAULT_FRAMES;
				const cpu = [], perFrame = [];
				const sink = {};
				const unscope = installScopes( app, sink );
				if ( onMeasure ) onMeasure( 'begin', id );
				if ( gpuOn ) { bench.frames = []; bench._capture = true; }
				try {

					t = await frames( app, n, dt, set.tick, t, ( ms ) => {

						cpu.push( ms );
						perFrame.push( { ...sink } );
						for ( const k in sink ) delete sink[ k ];

					}, waitGpu );

				} finally {

					unscope();
					if ( onMeasure ) await onMeasure( 'end', id, n );

				}

				let gpu = null, passes = null;
				if ( gpuOn ) {

					for ( let k = 0; k < 25 && bench.frames.length < n; k ++ ) await new Promise( ( r ) => setTimeout( r, 20 ) );
					bench._capture = false;
					const fs = bench.frames.slice();
					gpu = summarize( fs.map( ( f ) => f.gpu ) );
					const acc = new Map();
					for ( const f of fs ) for ( const [ k, v ] of f.passes ) acc.set( k, ( acc.get( k ) || 0 ) + v / fs.length );
					passes = [ ...acc ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 25 ).map( ( [ k, v ] ) => [ k, + v.toFixed( 3 ) ] );

				}

				report.scenarios[ id ] = {
					name: s.name, frames: n, cpu: summarize( cpu ), gpu, budget: budget( cpu ),
					scopes: rankScopes( perFrame ), passes, setup: set.info,
				};
				// wave 16C: the vegetation drawn at the end of the run (instances near / far per type, triangles)
				if ( app.vegetation && app.vegetation.stats ) try {

					const v = app.vegetation.stats(), types = {};
					for ( const [ k, t ] of Object.entries( v.types ) ) types[ k ] = t.near || t.far ? [ t.near ? t.near.instances : 0, t.far ? t.far.instances : 0 ] : [ t.nearCells, t.midCells, t.farCells ];
					report.scenarios[ id ].vegetation = { triangles: v.triangles, drawCalls: v.drawCalls, types };

				} catch ( e ) { /* (a stand-in app) */ }

				// wave 16C: the GPU memory (MB) while the scenario is up (memory(): GPU.memory in the headless harness)
				if ( memory ) {

					const m = memory(), r = ( x ) => Math.round( x / 1048576 * 10 ) / 10;
					if ( m ) report.scenarios[ id ].memory = { total: r( m.total ), buffers: r( m.buffers ), textures: r( m.textures ), peak: r( m.peak ), ...( m.groups ? { groups: m.groups } : {} ) };

				}

			} finally {

				set.undo();

			}

		}

	} finally {

		if ( st ) st.storage = storage;

	}

	Object.assign( report, cullingCandidates( report ) );
	if ( typeof window !== 'undefined' ) window.__perf = report;
	if ( url && typeof fetch === 'function' ) {

		try { await fetch( url + 'perf-' + tag + '.json', { method: 'POST', body: JSON.stringify( report, null, '\t' ) } ); } catch ( e ) { report.postError = String( e && e.message ); }

	}

	return report;

}
