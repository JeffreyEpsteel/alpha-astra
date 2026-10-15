// Plain-node test of the shared universe's hosting files (wave 15, no Docker, no network, no deploy): the Dockerfile copies
// every source file the server imports (the import graph of server/index.mjs against its COPY lines and .dockerignore's
// allow-list) and runs it the way fly.toml expects (port 8080, /data, 24 players, 120 s reconnects); fly.toml parses with the
// app, region, internal port, the volume, the always-on machine and the /health check; the deploy workflow follows the
// Pages build and stamps the commit; the server process reads PORT / BUILD_HASH, binds 0.0.0.0, keeps the console off
// without a terminal and (not on Windows, where there are no signals) saves the universe on SIGTERM.
//
//   node test/deploy-config.mjs

import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const repo = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const read = ( f ) => readFileSync( join( repo, f ), 'utf8' );
const posix = ( p ) => p.split( sep ).join( '/' );

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const watchdog = setTimeout( () => {

	console.log( 'FAIL timeout: the test did not finish in 60 s' );
	process.exit( 1 );

}, 60000 );

// ---- the server's import graph (relative imports: files to copy; bare ones: packages to install)

function importGraph( entry ) {

	const files = new Set(), packages = new Set();
	const todo = [ resolve( repo, entry ) ];
	const spec = /(?:^|[\s;])(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
	while ( todo.length ) {

		const f = todo.pop();
		const rel = posix( relative( repo, f ) );
		if ( files.has( rel ) ) continue;
		files.add( rel );
		const text = readFileSync( f, 'utf8' ).replace( /\/\*[\s\S]*?\*\//g, '' ).replace( /^\s*\/\/.*$/gm, '' );
		for ( const m of text.matchAll( spec ) ) {

			const s = m[ 1 ] || m[ 2 ] || m[ 3 ];
			if ( s.startsWith( 'node:' ) ) continue;
			if ( s.startsWith( '.' ) ) todo.push( resolve( dirname( f ), s ) );
			else packages.add( s.startsWith( '@' ) ? s.split( '/' ).slice( 0, 2 ).join( '/' ) : s.split( '/' )[ 0 ] );

		}

	}

	return { files: [ ...files ].sort(), packages: [ ...packages ].sort() };

}

// ---- the Dockerfile

const dockerfile = read( 'Dockerfile' );
const lines = dockerfile.replace( /\\\r?\n/g, ' ' ).split( /\r?\n/ ).map( ( l ) => l.trim() ).filter( ( l ) => l && ! l.startsWith( '#' ) );
const stages = [];
for ( const l of lines ) {

	const [ op, ...rest ] = l.split( /\s+/ );
	if ( /^FROM$/i.test( op ) ) stages.push( { from: rest.join( ' ' ), copies: [], runs: [], env: {}, cmd: null } );
	const st = stages[ stages.length - 1 ];
	if ( ! st ) continue;
	if ( /^COPY$/i.test( op ) ) {

		const fromStage = rest.find( ( a ) => a.startsWith( '--from=' ) );
		const args = rest.filter( ( a ) => ! a.startsWith( '--' ) );
		st.copies.push( { from: fromStage ? fromStage.slice( 7 ) : null, srcs: args.slice( 0, - 1 ), dest: args[ args.length - 1 ] } );

	} else if ( /^RUN$/i.test( op ) ) st.runs.push( rest.join( ' ' ) );
	else if ( /^ENV$/i.test( op ) ) for ( const kv of rest ) { const i = kv.indexOf( '=' ); if ( i > 0 ) st.env[ kv.slice( 0, i ) ] = kv.slice( i + 1 ); }
	else if ( /^CMD$/i.test( op ) ) st.cmd = JSON.parse( rest.join( ' ' ) );

}

const graph = importGraph( 'server/index.mjs' );
{

	ok( stages.length === 2 && /^node:22-alpine/.test( stages[ 0 ].from ) && /^node:22-alpine/.test( stages[ 1 ].from ), 'two node:22-alpine stages (install + pack, then run)' );
	ok( graph.files.includes( 'src/net/Protocol.js' ) && graph.files.includes( 'src/features/firearms/FirearmsData.js' ) && graph.files.includes( 'src/game/Boats.js' ) && graph.files.includes( 'server/universe.mjs' ),
		`the import graph of server/index.mjs is resolved (${ graph.files.length } files: ${ graph.files.join( ', ' ) })` );
	// every imported file is under a COPY source of the first stage (from the build context)
	const ctx = stages[ 0 ].copies.filter( ( c ) => ! c.from ).flatMap( ( c ) => c.srcs.map( ( s ) => s.replace( /\/$/, '' ) ) );
	const covered = ( f ) => ctx.some( ( s ) => f === s || f.startsWith( s + '/' ) );
	const missing = graph.files.filter( ( f ) => ! covered( f ) );
	ok( ! missing.length, `the Dockerfile copies every file the server imports${ missing.length ? ' (missing: ' + missing.join( ', ' ) + ')' : '' }` );
	ok( ctx.includes( 'package.json' ) && ctx.includes( 'package-lock.json' ) && ctx.includes( 'tools/host/pack-server-deps.mjs' ), 'and package*.json plus the dependency packer' );
	for ( const s of ctx ) ok( existsSync( join( repo, s ) ), `COPY source ${ s } exists` );
	const run0 = stages[ 0 ].runs.join( ' && ' );
	ok( /npm ci --omit=dev/.test( run0 ) && /pack-server-deps\.mjs \/app --verify/.test( run0 ), 'stage 1 installs the production dependencies and packs the server\'s closure (verified by a start)' );
	// the bare imports are production dependencies (directly, or of colyseus), never dev ones
	const pkg = JSON.parse( read( 'package.json' ) );
	const prod = new Set( Object.keys( pkg.dependencies || {} ) );
	for ( const d of [ ...prod ] ) {

		try { for ( const k of Object.keys( JSON.parse( read( `node_modules/${ d }/package.json` ) ).dependencies || {} ) ) prod.add( k ); } catch ( e ) { /* not installed here */ }

	}

	const notProd = graph.packages.filter( ( p ) => ! prod.has( p ) || ( pkg.devDependencies && p in pkg.devDependencies ) );
	ok( ! notProd.length && graph.packages.includes( '@colyseus/core' ), `the server's packages come with --omit=dev (${ graph.packages.join( ', ' ) })${ notProd.length ? ' missing: ' + notProd.join( ', ' ) : '' }` );
	const run = stages[ 1 ];
	ok( run.copies.some( ( c ) => c.from === 'deps' && c.srcs[ 0 ] === '/app/' ) && /^\s*FROM\s+node:22-alpine\s+AS\s+deps/im.test( dockerfile ), 'the run stage takes the packed folder from the deps stage' );
	ok( run.env.PORT === '8080' && run.env.HOST === '0.0.0.0' && /BUILD_HASH/.test( run.env.BUILD_HASH || '' ) && /ARG BUILD_HASH/.test( dockerfile ), 'PORT 8080, HOST 0.0.0.0 and BUILD_HASH from the build argument' );
	const cmd = run.cmd || [];
	const flag = ( f ) => { const i = cmd.indexOf( f ); return i >= 0 ? cmd[ i + 1 ] : undefined; };
	ok( cmd[ 0 ] === 'node' && cmd[ 1 ] === 'server/index.mjs' && flag( '--universe' ) === 'hyptile' && flag( '--data' ) === '/data' && flag( '--max-players' ) === '24' && flag( '--reconnect-seconds' ) === '120' && cmd.includes( '--no-console' ),
		`CMD: ${ cmd.join( ' ' ) }` );
	ok( ! cmd.includes( '--port' ), 'the port comes from PORT (fly.toml [env] and internal_port agree)' );

}

// ---- .dockerignore: an allow-list that lets every copied file through

{

	const pats = read( '.dockerignore' ).split( /\r?\n/ ).map( ( l ) => l.trim() ).filter( ( l ) => l && ! l.startsWith( '#' ) );
	// a glob (Go's filepath.Match plus **) as a regular expression, token by token
	const toRe = ( p ) => new RegExp( '^' + p.replace( /\/$/, '' ).split( /(\*\*\/|\*\*|\*|\?)/ ).map( ( t ) => ( {
		'**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]',
	} )[ t ] ?? t.replace( /[.+^${}()|[\]\\]/g, '\\$&' ) ).join( '' ) + '$' );
	// Docker's rule: the last pattern that matches the path (or one of its parent folders) decides
	const excluded = ( path ) => {

		const parts = path.split( '/' );
		const prefixes = parts.map( ( _, i ) => parts.slice( 0, i + 1 ).join( '/' ) );
		let out = false;
		for ( const p of pats ) {

			const neg = p.startsWith( '!' );
			const re = toRe( neg ? p.slice( 1 ) : p );
			if ( prefixes.some( ( x ) => re.test( x ) ) ) out = ! neg;

		}

		return out;

	};

	const needed = [ ...graph.files, 'package.json', 'package-lock.json', 'tools/host/pack-server-deps.mjs' ];
	const blocked = needed.filter( excluded );
	ok( ! blocked.length, `.dockerignore lets every file the image needs through${ blocked.length ? ' (blocked: ' + blocked.join( ', ' ) + ')' : '' }` );
	const kept = [ 'node_modules/ws/package.json', 'public/ui/menu/hyptile-menu-2560.jpg', 'releases/x/server/index.mjs', 'dist/index.html', 'test/universe.mjs', 'server/server-data/x/universe.json', 'src/game/Game.js', 'server/x.log' ].filter( ( f ) => ! excluded( f ) );
	ok( ! kept.length, `and keeps node_modules, assets, releases, builds, tests, saves and the rest of the game out${ kept.length ? ' (let through: ' + kept.join( ', ' ) + ')' : '' }` );

}

// ---- fly.toml (a TOML subset: tables, arrays of tables, strings, numbers, booleans, string arrays)

function parseToml( text ) {

	const root = {};
	let cur = root;
	const val = ( v ) => {

		v = v.trim();
		if ( /^'[^']*'$/.test( v ) || /^"[^"]*"$/.test( v ) ) return v.slice( 1, - 1 );
		if ( v === 'true' || v === 'false' ) return v === 'true';
		if ( /^-?\d+(\.\d+)?$/.test( v ) ) return Number( v );
		if ( /^\[.*\]$/.test( v ) ) return v.slice( 1, - 1 ).split( ',' ).map( ( x ) => x.trim() ).filter( Boolean ).map( val );
		throw new Error( `fly.toml: cannot read the value ${ v }` );

	};

	const walk = ( path, makeArray ) => {

		let o = root;
		path.forEach( ( k, i ) => {

			const last = i === path.length - 1;
			if ( last && makeArray ) {

				if ( ! Array.isArray( o[ k ] ) ) o[ k ] = [];
				o[ k ].push( {} );
				o = o[ k ][ o[ k ].length - 1 ];

			} else {

				if ( o[ k ] === undefined ) o[ k ] = {};
				o = Array.isArray( o[ k ] ) ? o[ k ][ o[ k ].length - 1 ] : o[ k ];

			}

		} );
		return o;

	};

	for ( const raw of text.split( /\r?\n/ ) ) {

		const l = raw.replace( /\s+#.*$/, '' ).trim();
		if ( ! l || l.startsWith( '#' ) ) continue;
		let m;
		if ( ( m = /^\[\[([\w.]+)\]\]$/.exec( l ) ) ) cur = walk( m[ 1 ].split( '.' ), true );
		else if ( ( m = /^\[([\w.]+)\]$/.exec( l ) ) ) cur = walk( m[ 1 ].split( '.' ), false );
		else if ( ( m = /^([\w-]+)\s*=\s*(.+)$/.exec( l ) ) ) cur[ m[ 1 ] ] = val( m[ 2 ] );
		else throw new Error( `fly.toml: cannot read the line ${ l }` );

	}

	return root;

}

let fly = null;
try {

	fly = parseToml( read( 'fly.toml' ) );

} catch ( e ) {

	ok( false, e.message );

}

if ( fly ) {

	ok( fly.app === 'hyptile-universe' && [ 'fra', 'ams' ].includes( fly.primary_region ), `fly.toml: app ${ fly.app } in ${ fly.primary_region } (closest to Bucharest)` );
	const hs = fly.http_service || {};
	ok( hs.internal_port === 8080 && fly.env && fly.env.PORT === '8080', 'the internal port is 8080, and so is PORT' );
	ok( hs.force_https === true && hs.auto_stop_machines === false && hs.min_machines_running === 1, 'https only, never stopped, one machine always running (the clock and the respawns run with nobody on)' );
	ok( hs.concurrency && hs.concurrency.type === 'connections' && hs.concurrency.hard_limit >= 64, 'the connection limit is raised above Fly\'s default 25 (one WebSocket per captain)' );
	const mounts = [].concat( fly.mounts || [] );
	ok( mounts.length === 1 && mounts[ 0 ].source === 'universe_data' && mounts[ 0 ].destination === '/data', 'the volume universe_data is mounted at /data (the CMD\'s --data)' );
	const checks = [].concat( hs.checks || [] );
	ok( checks.some( ( c ) => c.path === '/health' && c.method === 'GET' ), 'a health check on GET /health' );
	ok( fly.kill_signal === 'SIGTERM' && parseInt( fly.kill_timeout, 10 ) >= 10, 'SIGTERM with time to save before the kill' );
	const vm = [].concat( fly.vm || [] )[ 0 ] || {};
	ok( vm.size === 'shared-cpu-1x', `the machine: ${ vm.size }, ${ vm.memory }` );
	ok( fly.build && fly.build.dockerfile === 'Dockerfile', 'built from the Dockerfile' );

}

// ---- the deploy workflow

{

	const wf = read( '.github/workflows/deploy-universe.yml' );
	const pages = read( '.github/workflows/pages.yml' );
	const pagesName = ( /^name:\s*(.+)$/m.exec( pages ) || [] )[ 1 ].trim();
	ok( wf.includes( `workflows: [ "${ pagesName }" ]` ) && /types: \[ completed \]/.test( wf ) && /branches: \[ main \]/.test( wf ) && /conclusion == 'success'/.test( wf ), `it runs after a successful "${ pagesName }" on main` );
	// (2026-10-15: both workflows build the `live` branch, the release, so the game and the universe stay one commit)
	ok( /ref: live/.test( wf ) && /ref: live/.test( pages ) && /git rev-parse --short=7 HEAD/.test( wf ) && /flyctl deploy --remote-only --build-arg BUILD_HASH=/.test( wf ), 'from the same commit, stamped into the image' );
	ok( /secrets\.FLY_API_TOKEN/.test( wf ) && /FLY_API_TOKEN is not set/.test( wf ), 'with the FLY_API_TOKEN secret (a notice, not a red build, until it is set)' );
	ok( /\.fly\.dev\/health/.test( wf ) && /\\"build\\":/.test( wf ), 'and it checks /health reports that commit' );
	const vite = read( 'vite.config.js' );
	const ui = read( 'src/net/Universe.js' );
	ok( /typeof __BUILD_HASH__ !== 'undefined'/.test( ui ), 'the game reads __BUILD_HASH__ safely (dev without it)' );
	if ( ! /__BUILD_HASH__/.test( vite ) ) console.log( 'note vite.config.js does not define __BUILD_HASH__ yet (root patch in the wave 15 report): builds compare as "dev"' );
	ok( existsSync( join( repo, 'deploy', 'setup-fly.ps1' ) ) && existsSync( join( repo, 'deploy', 'SETUP_FLY.cmd' ) ), 'deploy/SETUP_FLY.cmd runs the owner\'s one-time steps' );
	const hosting = read( 'docs/HOSTING.md' );
	ok( /^## The shared universe/m.test( hosting ) && hosting.indexOf( '## The shared universe' ) < hosting.indexOf( '## 1.' ) && /fly volumes create universe_data --size 1 --region fra/.test( hosting ) && /FLY_API_TOKEN/.test( hosting ), 'docs/HOSTING.md opens with the shared universe and the exact Fly steps' );

}

// ---- the server process: PORT, BUILD_HASH, 0.0.0.0, no console without a terminal, SIGTERM saves

const freePort = () => new Promise( ( r ) => { const s = createServer(); s.listen( 0, '127.0.0.1', () => { const p = s.address().port; s.close( () => r( p ) ); } ); } );

try {

	const port = await freePort();
	const data = mkdtempSync( join( tmpdir(), 'hyptile-deploy-' ) );
	const child = spawn( process.execPath, [ 'server/index.mjs', '--universe', 'flytest', '--data', data, '--max-players', '24', '--reconnect-seconds', '120' ], {
		cwd: repo, stdio: [ 'pipe', 'pipe', 'pipe' ], env: { ...process.env, PORT: String( port ), HOST: '', BUILD_HASH: 'feed123', ADMIN_TOKEN: '' },
	} );
	let out = '';
	child.stdout.on( 'data', ( d ) => { out += d; } );
	child.stderr.on( 'data', ( d ) => { out += d; } );
	const exited = new Promise( ( r ) => child.on( 'exit', ( code, sig ) => r( { code, sig } ) ) );
	for ( let i = 0; i < 100 && ! /listening on/.test( out ); i ++ ) await new Promise( ( r ) => setTimeout( r, 100 ) );
	ok( new RegExp( `listening on ws://0\\.0\\.0\\.0:${ port }/` ).test( out ), `the server reads PORT and binds 0.0.0.0 (${ ( /listening on \S+/.exec( out ) || [ out.slice( 0, 120 ) ] )[ 0 ] })` );
	ok( /No terminal: the admin console is off/.test( out ), 'stdin is not a terminal: the console is off (nothing waits on it)' );
	const h = await ( await fetch( `http://127.0.0.1:${ port }/health` ) ).json();
	ok( h.ok && h.build === 'feed123' && h.universe && h.universe.cap === 24, '/health: the BUILD_HASH, the universe, 24 seats' );
	if ( process.platform !== 'win32' ) {

		child.kill( 'SIGTERM' );
		const e = await exited;
		const saved = existsSync( join( data, 'universe.json' ) ) && JSON.parse( readFileSync( join( data, 'universe.json' ), 'utf8' ) ).savedAt > 0;
		ok( e.code === 0 && /SIGTERM: saving and closing/.test( out ) && saved, 'SIGTERM (a Fly deploy) saves the universe and exits 0' );

	} else {

		console.log( 'note SIGTERM is not a signal on Windows: the save on SIGTERM is checked on Linux (CI) only' );
		child.kill();
		await exited;

	}

	try { rmSync( data, { recursive: true, force: true } ); } catch ( e ) { /* the OS cleans the temp dir */ }

} catch ( e ) {

	fails ++;
	console.log( 'FAIL exception', e && e.stack ? e.stack : e );

}

clearTimeout( watchdog );
console.log( fails ? `\n${ fails } FAILED` : '\nall deploy config tests passed' );
process.exit( fails ? 1 : 0 );
