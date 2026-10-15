// Offline publication-isolation regression. No sockets, servers or actual fetches.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
globalThis.location = { protocol: 'https:', hostname: 'jeffreyepsteel.github.io', pathname: '/alpha-astra/', search: '' };
const { App } = await import( '../src/App.js' );
const { DEFAULT_PORT, defaultServerUrl, normalizeServerUrl } = await import( '../src/net/NetClient.js' );
const { DEFAULT_UNIVERSE, SHARED_UNIVERSE, DEFAULT_UNIVERSE_PORT, defaultUniverseAddress, normalizeUniverseUrl, probeHealth, SERVER_KEY, NAME_KEY, universeToken, lastUniverseAddress } = await import( '../src/net/Universe.js' );
const { MENU_FLAG } = await import( '../src/ui/PauseMenu.js' );
const { GameState, SAVE_KEY } = await import( '../src/game/GameState.js' );
const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const reportDir = path.join( root, 'reports/codex-20261015/publish-isolation' );
const report = { startedAt: new Date().toISOString(), network: 'none; no server/socket/real fetch', checks: [], errors: [], expectationChanges: [ 'test/universe.mjs: implicit LAN port becomes8875; unconfigured public universe becomes empty; mocked health tests now name an explicit .example.test endpoint', 'test/net-protocol.mjs: no changes; explicit8765 custom URLs remain valid' ] };
function check( name, fn ) { try { fn(); report.checks.push( { name, passed: true } ); console.log( 'PASS', name ); } catch ( e ) { report.checks.push( { name, passed: false } ); report.errors.push( { name, message: e.message } ); console.error( 'FAIL', name, e.message ); } }
const at = ( loc, fn ) => { const previous = globalThis.location; globalThis.location = loc; try { return fn(); } finally { globalThis.location = previous; } };

check( 'unconfigured public alpha has no original shared-universe fallback', () => {
	assert.equal( DEFAULT_UNIVERSE, '' ); assert.equal( SHARED_UNIVERSE, '' );
	for ( const loc of [ globalThis.location, { protocol: 'https:', hostname: 'alpha-astra.pages.dev' }, null ] ) assert.equal( defaultUniverseAddress( loc ), '' );
} );
check( 'secure Pages has no implicit room URL, including crew-only links', () => {
	for ( const search of [ '', '?mp=1', '?crew=abcdef' ] ) assert.equal( at( { ...globalThis.location, search }, () => defaultServerUrl() ), '' );
} );
check( 'local room and universe default to separate port8875', () => {
	assert.equal( DEFAULT_PORT, 8875 ); assert.equal( DEFAULT_UNIVERSE_PORT, 8875 );
	const loc = { protocol: 'http:', hostname: '127.0.0.1', pathname: '/alpha-astra/', search: '' };
	assert.equal( at( loc, () => defaultServerUrl() ), 'ws://127.0.0.1:8875/island' );
	assert.equal( defaultUniverseAddress( loc ), '127.0.0.1:8875' );
	assert.equal( normalizeUniverseUrl( '127.0.0.1', loc ), 'ws://127.0.0.1:8875/universe' );
} );
check( 'local explicit crew links retain separate port8875', () => {
	assert.equal( at( { protocol: 'http:', hostname: '127.0.0.1', pathname: '/', search: '?crew=abcdef' }, () => defaultServerUrl() ), 'ws://127.0.0.1:8875/abcdef' );
} );
check( 'explicit secure custom server wins over crew/default and retains TLS proxy path', () => {
	assert.equal( at( { ...globalThis.location, search: '?server=wss%3A%2F%2Falpha-astra.example.test%2Fnet%2Fisland&crew=abcdef' }, () => defaultServerUrl() ), 'wss://alpha-astra.example.test/net/island' );
	assert.equal( normalizeUniverseUrl( 'alpha-astra.example.test/net', globalThis.location ), 'wss://alpha-astra.example.test/net/universe' );
} );
check( 'explicit custom port8765 remains supported instead of being silently rewritten', () => {
	assert.equal( normalizeServerUrl( 'ws://custom.example.test:8765/island' ), 'ws://custom.example.test:8765/island' );
	assert.equal( normalizeUniverseUrl( 'ws://custom.example.test:8765/universe' ), 'ws://custom.example.test:8765/universe' );
} );
for ( const mode of [ 'campaign', 'sandbox', 'multiplayer' ] ) check( `${ mode }: blank Connect does not save, disconnect or transition sessions`, () => {
	let toasts = 0; const app = { mode, session: true, game: { toast: () => toasts ++ }, saveNow: () => assert.fail( 'unexpected save' ), startSession: () => assert.fail( 'unexpected transition' ), net: { disconnect: () => assert.fail( 'unexpected disconnect' ) } };
	for ( const url of [ undefined, null, '', '   ' ] ) assert.equal( App.prototype.connect.call( app, url ), false );
	assert.equal( toasts, 4 ); assert.equal( app.mode, mode );
} );
check( 'explicit Connect still uses normal separate multiplayer session transition', () => {
	const calls = [], app = { mode: 'campaign', session: true, saveNow: () => calls.push( 'save' ), startSession: choice => { calls.push( choice ); return true; } };
	assert.equal( App.prototype.connect.call( app, 'wss://alpha-astra.example.test/island' ), true );
	assert.deepEqual( calls, [ 'save', { mode: 'multiplayer', slot: 0, server: 'wss://alpha-astra.example.test/island' } ] );
} );
check( 'menu, boot, online names and universe tokens have Alpha Astra namespaces', () => {
	assert.equal( MENU_FLAG, 'alpha-astra.menu' ); assert.equal( SERVER_KEY, 'alpha-astra.universe.server' ); assert.equal( NAME_KEY, 'alpha-astra.universe.name' );
	assert.match( fs.readFileSync( path.join( root, 'src/main.js' ), 'utf8' ), /const BOOT_KEY = 'alpha-astra\.boot'/ );
	const data = new Map(), writes = [], reads = [], storage = { getItem: k => { reads.push( k ); return data.get( k ) ?? null; }, setItem: ( k, v ) => { writes.push( k ); data.set( k, v ); } };
	universeToken( 'wss://alpha-astra-token-fixture.example.test/universe', storage );
	assert.deepEqual( reads, [ 'alpha-astra.universe.tokens' ] ); assert.deepEqual( writes, [ 'alpha-astra.universe.tokens' ] );
} );
check( 'same-origin Pages paths cannot load or overwrite original save slots implicitly', () => {
	assert.equal( SAVE_KEY, 'alpha-astra.save.v2' );
	const reads = [], writes = [], originalRaw = JSON.stringify( { v: 2, money: 999999, name: 'synthetic-original' } );
	const data = new Map( [ [ 'hyptile-island.save.v2', originalRaw ], [ 'tidewater.save.v1', originalRaw ] ] );
	const state = new GameState( { getItem: k => { reads.push( k ); return data.get( k ) ?? null; }, setItem: ( k, v ) => { writes.push( k ); data.set( k, v ); } } );
	assert.equal( state.load(), false ); state.save();
	assert.equal( data.get( 'hyptile-island.save.v2' ), originalRaw ); assert.equal( data.get( 'tidewater.save.v1' ), originalRaw );
	assert.ok( reads.every( k => k.includes( 'alpha-astra' ) ) && writes.every( k => k.includes( 'alpha-astra' ) ) );
	for ( const mode of [ 'campaign', 'sandbox', 'multiplayer' ] ) for ( let slot = 0; slot < 4; slot ++ ) assert.ok( GameState.slotKey( slot, mode ).includes( 'alpha-astra' ) );
} );
check( 'old remembered server address is ignored on the same GitHub Pages origin', () => {
	const old = globalThis.localStorage, reads = [];
	globalThis.localStorage = { getItem: k => { reads.push( k ); return k === 'hyptile-island.universe.server' ? 'wss://hyptile-universe.fly.dev/universe' : null; } };
	try { assert.equal( lastUniverseAddress( globalThis.location ), '' ); assert.deepEqual( reads, [ 'alpha-astra.universe.server' ] ); } finally { if ( old === undefined ) delete globalThis.localStorage; else globalThis.localStorage = old; }
} );
check( 'workflow targets only the new repository main branch and carries no inherited Fly automation', () => {
	const dir = path.join( root, '.github/workflows' ), files = fs.readdirSync( dir ).filter( f => /\.ya?ml$/.test( f ) );
	assert.deepEqual( files, [ 'pages.yml' ] ); const workflow = fs.readFileSync( path.join( dir, 'pages.yml' ), 'utf8' );
	assert.match( workflow, /branches:\s*\[\s*main\s*\]/ ); assert.match( workflow, /github\.repository == 'JeffreyEpsteel\/alpha-astra'/ );
	assert.doesNotMatch( workflow, /ref:\s*live|FLY_API_TOKEN|flyctl|Hyptile-Island|workflow_run:/ );
} );

try {
	let fetches = 0; const result = await probeHealth( DEFAULT_UNIVERSE, { fetchImpl: async () => { fetches ++; throw Error( 'unexpected fetch' ); } } );
	check( 'blank universe health probe refuses before making even a mocked request', () => { assert.equal( result.code, 'address' ); assert.equal( fetches, 0 ); } );
} catch ( e ) { report.errors.push( { name: 'health refusal', message: e.message } ); }
report.finishedAt = new Date().toISOString(); report.totalChecks = report.checks.length; report.passed = report.errors.length === 0;
fs.mkdirSync( reportDir, { recursive: true } ); fs.writeFileSync( path.join( reportDir, 'verification.json' ), JSON.stringify( report, null, 2 ) + '\n' );
fs.writeFileSync( path.join( reportDir, 'summary.md' ), `# Publication isolation checks\n\n${ report.checks.filter( c => c.passed ).length }/${ report.totalChecks } checks passed. No real network, server or GitHub operation ran.\n\nCovered secure Pages default/crew URLs, separate8875 local defaults, explicit custom hosts/ports, blank Connect lifecycle refusal, same-origin save/token/menu isolation and candidate-only Pages workflows.\n\nLegacy expectation edits: ${ report.expectationChanges.join( '; ' ) }. The existing full universe/network suites were not rerun during concurrent GPU QA.\n\n${ report.errors.map( e => '- ' + e.name + ': ' + e.message ).join( '\n' ) }\n` );
console.log( `${ report.checks.filter( c => c.passed ).length }/${ report.totalChecks } publication-isolation checks passed (offline).` );
if ( ! report.passed ) process.exitCode = 1;
