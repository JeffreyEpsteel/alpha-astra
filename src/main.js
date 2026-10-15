import './core/BenchSeed.js';
import './core/Quality.js'; // sets the phone budget before any loader runs
import { installErrorLog } from './core/ErrorLog.js';
const errorLog = installErrorLog(); // the in-game error log (F8) catches everything from here on
import { crewCodeFromLocation } from './net/NetClient.js';
import { App } from './App.js';
import { UI, deviceReport, showDiagPage } from './ui/UI.js';
import { AppUI } from './ui/AppUI.js';
import { MainMenu } from './ui/MainMenu.js';
import { PauseMenu, MENU_FLAG } from './ui/PauseMenu.js';
import { isMode } from './game/GameMode.js';
import { GPU } from './engine/gpu/GPU.js';

// ?bench (and ?bg) run in background tabs too (automation, hidden panes): rAF does not fire in a hidden page
if ( /[?&](bench|bg)\b/.test( location.search ) ) {

	const raf = window.requestAnimationFrame.bind( window ), caf = window.cancelAnimationFrame.bind( window );
	window.requestAnimationFrame = ( cb ) => {

		if ( document.visibilityState === 'hidden' ) return setTimeout( () => cb( performance.now() ), 16 );
		// an occluded window reports 'visible' but Chrome never fires rAF: a timer takes over after 120 ms
		let done = false, tm = 0;
		const id = raf( ( t ) => { if ( done ) return; done = true; clearTimeout( tm ); cb( t ); } );
		tm = setTimeout( () => { if ( done ) return; done = true; caf( id ); cb( performance.now() ); }, 120 );
		return id;

	};
	window.cancelAnimationFrame = ( id ) => ( clearTimeout( id ), caf( id ) );

}

// ---- where the start is, for the error card and for a start that killed the tab (phones have no console) ----
// The stage of the start is logged to the error log and kept in localStorage ('hyptile-island.boot') with the GPU memory
// and the frame: iOS ends a tab that runs out of memory without any event, and the next visit says where it stopped.
const BOOT_KEY = 'alpha-astra.boot';
const STALL_MS = 45000; // the loader not moving this long (stage text and compiled pipelines) is reported
const boot = { stage: 'loading the page', moved: performance.now(), mark: '', running: false, softShown: false, stallShown: false };
let lastBoot = null;
try { lastBoot = JSON.parse( localStorage.getItem( BOOT_KEY ) || 'null' ); } catch ( e ) { /* no storage */ }

const mb = ( n ) => Math.round( n / 1048576 );
function crumb( extra = {} ) {

	try {

		localStorage.setItem( BOOT_KEY, JSON.stringify( {
			stage: boot.stage, at: new Date().toISOString(), gpuMB: mb( GPU.memory.total ), peakMB: mb( GPU.memory.peak ), frame: GPU.frame, ...extra,
		} ) );

	} catch ( e ) { /* no storage */ }

}

function setStage( text ) {

	if ( ! text || text === boot.stage ) return;
	boot.stage = String( text );
	boot.moved = performance.now();
	errorLog.push( 'stage', boot.stage );
	crumb();

}

// the stage with the shader compile count ('Compiling shaders… 32 / 400: water main')
// (the pipeline(s) compiling NOW and for how long: a compile that hangs names itself)
function stageText() {

	const s = GPU.pipelineStats;
	if ( ! s || ! s.requested || ( ! /shader/i.test( boot.stage ) && ! s.active.size ) ) return boot.stage;
	const now = [ ...s.active ].map( ( h ) => h.label ).filter( Boolean );
	const secs = s.startedAt ? ( ( performance.now() - s.startedAt ) / 1000 ).toFixed( 0 ) : 0;
	return `${ boot.stage } ${ s.done } / ${ s.requested }${ now.length ? `: compiling ${ now.slice( 0, 3 ).join( ', ' ) } (${ secs } s)` : s.last ? ': last done ' + s.last : '' }${ s.timedOut ? ` · ${ s.timedOut } skipped (timeout)` : '' }`;

}

function details( error ) {

	const parts = [];
	if ( error && error.stack ) parts.push( String( error.stack ).split( '\n' ).slice( 0, 8 ).join( '\n' ) );
	if ( GPU.device ) parts.push( GPU.describe() );
	parts.push( deviceReport() );
	if ( lastBoot ) parts.push( 'previous start: ' + JSON.stringify( lastBoot ) );
	const log = errorLog.text( { header: false } ).split( '\n' );
	parts.push( 'log:\n' + log.slice( - 40 ).join( '\n' ) );
	return parts.join( '\n\n' );

}

let ui = null;
function fail( title, message, { fatal = true, error = null } = {} ) {

	try {

		if ( ! ui ) return;
		if ( ! fatal ) {

			// recoverable problems: one card per visit (the error log keeps the rest); while it is open, more lines join it
			const open = ui._fatal && ui._fatal.isConnected;
			if ( boot.softShown && ! open ) return;
			if ( open ) {

				ui.showFatal( { message: `${ title }: ${ message }`, fatal: false } );
				return;

			}

			boot.softShown = true;

		}

		ui.showFatal( { title, message, stage: stageText(), details: details( error ), fatal } );
		crumb( { error: String( message ).slice( 0, 300 ) } );

	} catch ( e ) { /* the card must never throw */ }

}

const describeError = ( e ) => ( e instanceof Error ? `${ e.name }: ${ e.message }` : e && e.message ? String( e.message ) : String( e ) );

if ( /[?&]diag\b/.test( location.search ) ) {

	// ?diag: no game, what this browser's WebGPU offers (a screenshot for a bug report)
	showDiagPage();

} else startGame();

function startGame() {

	ui = new UI();
	// Phones and WebKit (every iOS browser): pipelines compile one at a time with a 12 s limit each, each name logged
	// before it starts, and the loading frame compiles only the mesh pipelines its view draws. An iPhone 17 Pro stopped at
	// 'Compiling shaders… 113 / 282' with all of them started at once. ?compile=N (at once), ?compile=all, ?lazy=0|1 override.
	{

		const ua = navigator.userAgent || '';
		const ios = /iPhone|iPad|iPod/.test( ua ) || ( /Macintosh/.test( ua ) && navigator.maxTouchPoints > 1 );
		const safari = ios || ( /AppleWebKit/.test( ua ) && /Safari/.test( ua ) && ! /Chrome|Chromium|Edg|OPR/.test( ua ) );
		const mobile = !! ( ui.device && ui.device.mobile ) || ios;
		const q = new URLSearchParams( location.search );
		if ( safari || mobile ) {

			GPU.compileConcurrency = 1;
			GPU.compileTimeout = mobile ? 12000 : 30000;

		}

		GPU.lazyPipelines = mobile;
		// Android (Adreno 8xx, Chrome 152): every pipeline whose vertex stage writes clip_distances failed with
		// VK_ERROR_UNKNOWN (the refraction pass of 17 materials); the fragment discard path replaces it there
		if ( /Android/i.test( ua ) && ! q.has( 'clip' ) ) GPU.skipFeatures.add( 'clip-distances' );
		if ( q.has( 'nofeat' ) ) for ( const f of String( q.get( 'nofeat' ) ).split( ',' ) ) if ( f ) GPU.skipFeatures.add( f );
		if ( q.has( 'compile' ) ) GPU.compileConcurrency = q.get( 'compile' ) === 'all' ? Infinity : Math.max( 1, Number( q.get( 'compile' ) ) || 1 );
		if ( q.has( 'lazy' ) ) GPU.lazyPipelines = q.get( 'lazy' ) !== '0';
		GPU.onCompileStart = ( label, index ) => {

			// (the breadcrumb, not the error log: 280 lines would push the errors out of its 60)
			crumb( { compiling: label, compileIndex: index } );

		};

	}

	const app = new App();
	window.__ui = ui;

	// the GPU's own errors: a lost device, out of memory and internal errors end the game; a pipeline that failed or a
	// validation error is shown once (the game may still run without it)
	GPU.onError( ( e ) => {

		const fatal = e.kind === 'lost' || e.kind === 'out-of-memory' || e.kind === 'internal';
		const what = { lost: 'The graphics device was lost', 'out-of-memory': 'The graphics card ran out of memory', internal: 'The graphics driver failed',
			pipeline: 'A shader failed to build', shader: 'A shader failed to compile', validation: 'The graphics card refused a command' }[ e.kind ] || 'Graphics error';
		fail( what, `${ e.kind }${ e.label ? ' (' + e.label + ')' : '' }: ${ e.message }`, { fatal } );

	} );
	// anything thrown while loading or in the first frames (later: the error log, F8)
	const early = () => ! boot.running || GPU.frame - boot.startFrame < 600;
	window.addEventListener( 'error', ( ev ) => {

		if ( ev && ev.error && early() ) fail( 'Something went wrong', describeError( ev.error ), { fatal: false, error: ev.error } );

	} );
	window.addEventListener( 'unhandledrejection', ( ev ) => {

		if ( early() ) fail( 'Something went wrong', describeError( ev && ev.reason ), { fatal: false, error: ev && ev.reason } );

	} );
	window.addEventListener( 'pagehide', () => crumb( { ok: true, closed: true } ) );

	// the last visit's start did not finish (the tab was ended: on iOS usually memory): say where, once
	// (only a start that had reached the game or the shader compile: a tab closed during the loading stages is normal)
	if ( lastBoot && ! lastBoot.ok && lastBoot.stage && ( lastBoot.frame > 0 || /shader/i.test( lastBoot.stage ) ) ) {

		setTimeout( () => fail( 'The last start did not finish',
			`It stopped during "${ lastBoot.stage }"${ lastBoot.compiling && /shader/i.test( lastBoot.stage ) ? ` while compiling #${ lastBoot.compileIndex } "${ lastBoot.compiling }"` : '' } (GPU memory ${ lastBoot.gpuMB } MB, frame ${ lastBoot.frame }${ lastBoot.error ? ', ' + lastBoot.error : '' }). If the page crashed or reloaded by itself, copy this and send it to us.`,
			{ fatal: false } ), 0 );

	}

	crumb();
	// the loader watchdog: a stage that does not move (no new stage, no pipeline compiled) for 45 s is reported
	const watch = setInterval( () => {

		const s = GPU.pipelineStats;
		const mark = boot.stage + '|' + ( s ? s.done : 0 );
		if ( mark !== boot.mark ) {

			boot.mark = mark;
			boot.moved = performance.now();
			if ( s && s.requested && /shader/i.test( boot.stage ) ) ui.setLoadingDetail( s.done, s.requested );

		} else if ( ! boot.stallShown && performance.now() - boot.moved > STALL_MS ) {

			boot.stallShown = true;
			fail( 'Loading is stuck', `Nothing has moved for ${ STALL_MS / 1000 } s.${ s && s.requested ? ` Shaders compiled: ${ s.done } of ${ s.requested } (last: ${ s.last || 'none' }).` : '' } You can wait (Continue) or reload.`, { fatal: false } );

		}

	}, 1000 );

	app.init( ( p, text, until ) => {

		setStage( text );
		ui.setLoading( p, text, until );

	} ).then( async () => {

		clearInterval( watch );
		setStage( 'building the HUD' );
		app.ui = new AppUI( app, ui );
		ui.setLoading( 1, 'Ready' );
		await ui.hideLoader();
		// the main menu (the mode, then the slot) before the start overlay; Esc in game opens the pause menu
		setStage( 'main menu' );
		app.menu = new MainMenu( { ui, app } );
		app.pauseMenu = new PauseMenu( { ui, app } );
		// ?nomenu, ?bench and ?bg skip the menu so automation works (Pause > Main menu still brings it back)
		let forceMenu = false;
		try {

			forceMenu = sessionStorage.getItem( MENU_FLAG ) === '1';
			sessionStorage.removeItem( MENU_FLAG );

		} catch ( e ) { /* no session storage */ }

		if ( app.qs.has( 'bench' ) || ( /[?&](nomenu|bg)(?![A-Za-z0-9_])/.test( location.search ) && ! forceMenu ) ) {

			// no menu: the slot that is loaded is played, nothing is snapshotted or autosaved (automation must not touch the player's
			// saves). ?mode=sandbox|campaign|multiplayer picks the mode: the sandbox for ?bench and ?fly (the free camera), the
			// multiplayer for ?mp / ?server, else the campaign
			const q = app.qs.get( 'mode' );
			const mode = isMode( q ) ? q : app.qs.has( 'bench' ) || app.qs.has( 'fly' ) ? 'sandbox' : app.pendingServer ? 'multiplayer' : 'campaign';
			setStage( 'starting the session' );
			app.startSession( null, { mode, restore: false, session: false } );

		} else {

			// a crew link (?crew=abcdef or the code in the path) goes straight to the multiplayer slots
			const crew = crewCodeFromLocation();
			const choice = await app.menu.show( crew ? { mode: 'multiplayer', step: 'slots' } : undefined );
			setStage( 'starting the session' );
			app.startSession( choice );

		}

		// frame-time benchmark and reference shots (see core/Bench.js): it drives the frames itself
		if ( app.qs.has( 'bench' ) ) {

			window.__bench = new ( await import( './core/Bench.js' ) ).Bench( app );
			// ?bench&perf=all|naval|storm|night|crowd: the all-features scenario runner (tools/perf)
			if ( app.qs.has( 'perf' ) ) window.__job = ( await import( '../tools/perf/runner.js' ) ).runPerf( app, { scenarios: app.qs.get( 'perf' ), bench: window.__bench, tag: app.qs.get( 'tag' ) || 'perf', url: 'http://127.0.0.1:5190/' } );
			if ( app.qs.has( 'auto' ) ) window.__job = window.__bench.auto( app.qs.get( 'auto' ), { runs: Number( app.qs.get( 'runs' ) ) || 1 } );
			// ?bench&shots=view1,view2[&tag=name][&dt=seconds][&seq=n&every=frames]: reference shots of the named views only (core/DebugViews.js; dt > 0: the clock runs, e.g. for the eased lens flare)
			// &wdbg=N: the water shader's debug view (WaterMaterial debugMode) in the shots
			if ( app.qs.has( 'wdbg' ) && app.waterMaterial ) app.waterMaterial.debugMode.value = Number( app.qs.get( 'wdbg' ) );
			if ( app.qs.has( 'shots' ) ) window.__job = window.__bench.shots( app.qs.get( 'shots' ).split( ',' ), { tag: app.qs.get( 'tag' ) || 'shot', dt: Number( app.qs.get( 'dt' ) ) || 0, seq: Number( app.qs.get( 'seq' ) ) || 1, every: Number( app.qs.get( 'every' ) ) || 1 } );

		} else {

			// a frame that throws shows the card instead of freezing the picture (engine/Engine.js keeps the loop going)
			app.engine.onFrameError = ( e, n ) => {

				console.error( e );
				if ( n === 1 ) fail( 'A frame failed', describeError( e ), { fatal: false, error: e } );

			};
			setStage( 'first frames' );
			boot.running = true;
			boot.startFrame = GPU.frame;
			app.start();
			// the first 20 s of play leave a breadcrumb every 2 s (memory, frame), then the start counts as good
			const t0 = performance.now();
			const tick = setInterval( () => {

				if ( performance.now() - t0 > 20000 ) {

					clearInterval( tick );
					setStage( 'playing' );
					crumb( { ok: true } );

				} else crumb();

			}, 2000 );

		}

		ui.showStartOverlay( () => {

			// (iOS has no pointer lock, keyboard lock or element fullscreen: each guarded where it is made; a throw here
			// must still not stop the game)
			try { app.input.requestLock(); } catch ( e ) { console.warn( 'pointer lock', e ); }
			try { if ( app.audio ) app.audio.resume(); } catch ( e ) { console.warn( 'audio resume', e ); }

		} );

	} ).catch( ( e ) => {

		clearInterval( watch );
		console.error( e );
		// no WebGPU at all (the browser or no adapter): the page that says which browsers work
		if ( typeof navigator === 'undefined' || ! navigator.gpu || /No WebGPU adapter|WebGPU is not available/i.test( String( e && e.message ) ) ) {

			ui.setLoadingError( 'Something went wrong: ' + ( e && e.message ) );
			return;

		}

		ui.setLoadingError( 'Something went wrong: ' + describeError( e ) );
		fail( 'The game could not start', describeError( e ), { fatal: true, error: e } );

	} );

}
