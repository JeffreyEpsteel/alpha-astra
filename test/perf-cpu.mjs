// Plain-node test of the wave 12D CPU / memory pass: the collision broad phase (a 64 m grid that visits the pairs in the
// brute-force order: the same contacts), satOverlap's scratch output, the HUD write guards (DomWrites), the crew's posted
// lists, the boat-swap uniform buffer leak (a FleetBoatModel built, "drawn" and disposed 20 times against a counting
// GPU device; the leak is measured as it stands and with the engine patch the report gives root), and a short run of
// tools/perf/cpu-scenarios.mjs (it runs, it is deterministic).
//   node test/perf-cpu.mjs
import { spawnSync } from 'node:child_process';
import { CollisionWorld, GRID, obb2, satOverlap, yawInertia } from '../src/features/naval/Collisions.js';
import { setText, setStyle, setNum, setClass } from '../src/features/naval/DomWrites.js';
import { Crew } from '../src/features/crew/Crew.js';
import { makeDoc } from '../tools/perf/fake-dom.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );

// ================================================================================================ 1. broad phase
section( '1. collision broad phase: the grid finds the same contacts in the same order' );
{

	const rng = ( () => { let s = 12345; return () => ( s = ( s * 16807 ) % 2147483647 ) / 2147483647; } )();
	const body = ( id, x, z, yaw, hx, hz, vx, vz ) => {

		const b = { id, x, z, yaw, hx, hz, mass: 20000, vx, vz, w: 0, maxHp: 120 };
		b.invMass = 1 / b.mass;
		b.invI = 1 / yawInertia( b.mass, hx, hz );
		b.push = ( dx, dz ) => { b.x += dx; b.z += dz; };
		b.impulse = ( jx, jz ) => { b.vx += jx * b.invMass; b.vz += jz * b.invMass; };
		return b;

	};

	const scene = ( n, spread ) => {

		const out = [];
		for ( let i = 0; i < n; i ++ ) out.push( body( 'b' + i, ( rng() - 0.5 ) * spread, ( rng() - 0.5 ) * spread, rng() * 6.28, 1.5 + rng() * 2, 4 + rng() * 6, ( rng() - 0.5 ) * 6, ( rng() - 0.5 ) * 6 ) );
		return out;

	};

	const clone = ( list ) => list.map( ( b ) => body( b.id, b.x, b.z, b.yaw, b.hx, b.hz, b.vx, b.vz ) );
	const sig = ( cs ) => cs.map( ( c ) => `${ c.a.id }|${ c.b.id }|${ c.x.toFixed( 9 ) }|${ c.z.toFixed( 9 ) }|${ c.depth.toFixed( 9 ) }|${ c.damage ? c.damage.a.toFixed( 9 ) : '-' }` ).join( ';' );
	let same = true, contacts = 0, gridUsed = 0, testedGrid = 0, testedBrute = 0;
	for ( const [ n, spread ] of [ [ 13, 300 ], [ 40, 400 ], [ 120, 900 ], [ 60, 120 ] ] ) {

		const A = scene( n, spread ), B = clone( A );
		const wa = new CollisionWorld(), wb = new CollisionWorld();
		for ( let f = 0; f < 240; f ++ ) {

			for ( const L of [ A, B ] ) for ( const b of L ) { b.x += b.vx / 60; b.z += b.vz / 60; }
			const min = GRID.min;
			GRID.min = 0; // the grid whenever it can be used
			const ca = sig( wa.step( f / 60, A ) );
			if ( wa.stats.grid ) gridUsed ++;
			GRID.min = Infinity; // brute force
			const cb = sig( wb.step( f / 60, B ) );
			GRID.min = min;
			if ( ca !== cb ) same = false;
			contacts += wa.contacts.length;

		}

		testedGrid += wa.stats.tested;
		testedBrute += wb.stats.tested;
		same = same && A.every( ( b, i ) => b.x === B[ i ].x && b.z === B[ i ].z && b.vx === B[ i ].vx );

	}

	ok( same, `grid and brute force: identical contacts, impulses and positions over 960 frames (${ contacts } contacts)` );
	ok( gridUsed > 900, `the grid was used (${ gridUsed } frames)` );
	ok( testedGrid < testedBrute / 4, `it tests far fewer pairs (${ testedGrid } against ${ testedBrute })` );
	const w = new CollisionWorld();
	w.step( 0, [ body( 'big', 0, 0, 0, 3, 40, 0, 0 ), ...scene( 80, 200 ) ] );
	ok( w.stats.grid === false, 'a hull longer than a cell falls back to the plain loop' );
	w.step( 0, scene( 13, 300 ) );
	ok( w.stats.grid === false && GRID.min >= 32, `13 hulls (the naval world): the plain loop (the grid from ${ GRID.min })` );
	w.step( 0, scene( GRID.min, 900 ) );
	ok( w.stats.grid === true, `${ GRID.min } hulls: the grid` );
	const out = {};
	const A = obb2( 0, 0, 0, 1.5, 4 ), B = obb2( 2.5, 0, 0, 1.5, 4, {} );
	ok( satOverlap( A, B, out ) === out && out.hit && Math.abs( out.depth - 0.5 ) < 1e-9 && out.nx === 1, 'satOverlap / obb2 write into the scratch objects they are given' );

}

// ================================================================================================ 2. HUD writes
section( '2. HUD writes only on a change' );
{

	const dom = makeDoc();
	const el = dom.doc.createElement( 'div' );
	for ( let i = 0; i < 10; i ++ ) {

		setText( el, 'Shot 12 / 16' );
		setStyle( el, 'display', '' );
		setNum( el, 'width', 0.4996 * 100, 1, '', '%' );
		setClass( el, 'nv-gun is-ready' );

	}

	ok( dom.counts.text === 1 && dom.counts.style === 2 && el.textContent === 'Shot 12 / 16' && el.style.width === '50.0%', `ten frames of the same values: one text and one write per style (${ JSON.stringify( dom.counts ) })` );
	setNum( el, 'width', 0.4997 * 100, 1, '', '%' );
	ok( dom.counts.style === 2, 'a change under the shown precision builds no string and writes nothing' );
	setNum( el, 'width', 0.52 * 100, 1, '', '%' );
	setText( el, 'Shot 11 / 16' );
	ok( el.style.width === '52.0%' && el.textContent === 'Shot 11 / 16' && dom.counts.style === 3 && dom.counts.text === 2, 'a real change is written' );

}

// ================================================================================================ 3. crew lists
section( '3. the crew\'s posted lists' );
{

	const c = new Crew( { rng: () => 0.5 } );
	const ctx = { boat: 'trawler', unlocked: [ 'pepe', 'doge', 'pengu', 'bonk' ], character: 'hyptile' };
	c.setPost( 'pengu', 'gunner', ctx );
	c.setPost( 'pepe', 'angler', ctx );
	c.setPost( 'doge', 'gunner', ctx );
	ok( c.gunners( ctx ).join() === 'pengu,doge' && c.anglers( ctx ).join() === 'pepe' && c.gunners().join() === 'pengu,doge', 'posting order kept, posts filtered' );
	ok( c.gunners( { ...ctx, character: 'doge' } ).join() === 'pengu' && c.gunners( { ...ctx, unlocked: [ 'doge' ] } ).join() === 'doge', 'the played and the unhired are not on duty' );
	ok( c.sync( ctx ).length === 0 && c.posts.size === 3, 'sync: everyone has a berth, nothing changes' );
	const d = c.sync( { ...ctx, boat: 'cutter' } );
	ok( d.length === 2 && d[ 0 ].id === 'doge' && d[ 1 ].id === 'pepe' && c.posts.size === 1, 'a smaller hull sends the last posted ashore (last first)' );
	const p = c.sync( { ...ctx, character: 'pengu' } );
	ok( p.length === 1 && p[ 0 ].why === 'playing' && c.posts.size === 0, 'playing a posted character takes him off his post' );

}

// ================================================================================================ 4. boat-swap buffers
section( '4. boat swaps: uniform buffers of the disposed materials' );
{

	globalThis.GPUBufferUsage = globalThis.GPUBufferUsage || { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256 };
	const live = new Set();
	const realDevice = GPU.device;
	GPU.device = { createBuffer( d ) { const b = { label: d && d.label, destroy() { live.delete( b ); } }; live.add( b ); return b; } };
	const { createBoatModel } = await import( '../src/world/boat/BoatFactory.js' );
	const { UniformBlock } = await import( '../src/engine/gpu/Uniforms.js' );
	const { Material } = await import( '../src/engine/render/Material.js' );
	// what the renderer does on a model's first draw: every material's uniform block gets its buffer
	const swaps = async ( id, n ) => {

		const before = live.size;
		for ( let i = 0; i < n; i ++ ) {

			const m = createBoatModel( id );
			await m.ready.catch( () => {} );
			const mats = new Set();
			m.group.traverse( ( o ) => { if ( o.material ) for ( const x of [].concat( o.material ) ) mats.add( x ); } );
			for ( const x of mats ) if ( x.uniformBlock ) x.uniformBlock.getBuffer();
			m.dispose();

		}

		return ( live.size - before ) / n;

	};

	const asIs = await swaps( 'cutter', 20 );
	console.log( `     as the engine stands: ${ asIs } uniform buffer(s) left per swap of the cutter (FleetBoatModel; the GLB's own materials add more in the browser)` );
	// the engine patch of the report (Uniforms.js destroyBuffer, Material.dispose frees it), applied here when absent
	const patched = typeof UniformBlock.prototype.destroyBuffer === 'function';
	if ( ! patched ) {

		UniformBlock.prototype.destroyBuffer = function () {

			if ( ! this.buffer ) return;
			this.buffer.destroy();
			this.buffer = null;
			this._last = null;
			this.bufferVersion = ( this.bufferVersion || 0 ) + 1;

		};
		const dispose = Material.prototype.dispose;
		Material.prototype.dispose = function () {

			dispose.call( this );
			if ( this.uniformBlock && this.uniformBlock.destroyBuffer ) this.uniformBlock.destroyBuffer();

		};

	}

	ok( await swaps( 'cutter', 20 ) === 0, `with the patch${ patched ? ' (in the engine)' : ' (applied by the test)' }: 20 swaps of the cutter leave no buffer` );
	ok( await swaps( 'lobster', 5 ) === 0 && await swaps( 'sloop', 5 ) === 0, 'and the procedural lobster boat and a ship hull neither' );
	const blk = new UniformBlock( 'LeakProbe', { a: [ 'f32', 1 ] } );
	const b1 = blk.getBuffer();
	blk.destroyBuffer();
	const b2 = blk.getBuffer();
	ok( b1 !== b2 && live.has( b2 ) && ! live.has( b1 ) && blk.bufferVersion === 1, 'a block used again after its material was disposed gets a new buffer (and a new version for the bind groups)' );
	GPU.device = realDevice;

}

// ================================================================================================ 5. the runner
section( '5. tools/perf/cpu-scenarios.mjs' );
{

	const run = () => spawnSync( process.execPath, [ 'tools/perf/cpu-scenarios.mjs', '--frames=240', '--repeat=1', '--no-alloc', '--scenario=sea,shore' ], { encoding: 'utf8', timeout: 240000 } );
	const a = run(), b = run();
	const fps = ( r ) => [ ...String( r.stdout ).matchAll( /"fingerprint":"([-\d.]+)"/g ) ].map( ( m ) => m[ 1 ] );
	ok( a.status === 0 && /== sea: 240 frames/.test( a.stdout ) && /== shore: 240 frames/.test( a.stdout ) && /\nframe +\d/.test( a.stdout ), 'both scenarios run and report ms per module' );
	ok( fps( a ).length === 2 && fps( a ).join() === fps( b ).join(), `deterministic: the same end state twice (${ fps( a ).join( ', ' ) })` );

}

console.log( `\n${ passes } checks passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
