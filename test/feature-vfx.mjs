// Plain-node test of the VFX set (src/features/vfx, src/fx/VfxAtlas.js): the procedural atlas, the particle pool
// (budget, dirty runs, closed-form motion, clock rebase), every recipe, the de-duplication of a call plus its event,
// the low-quality budget, fires / lights / burning and sinking ships, and the feature's event wiring through
// Features (no scene: nothing is drawn). With --gpu it also renders the particles headlessly (Dawn) to
// test/out/feature-vfx.png so the WGSL is compiled and the look can be checked.
// usage: node test/feature-vfx.mjs [--gpu]
globalThis.location = globalThis.location || { search: '' };
const GPU_RUN = process.argv.includes( '--gpu' );
if ( GPU_RUN ) await import( './headless.mjs' );
const { Features } = await import( '../src/features/Features.js' );
const vfxModule = await import( '../src/features/vfx/index.js' );
const { VfxSystem, VfxPool, motionAt, STRIDE, LOOK, ORIENT, BUDGET } = vfxModule;
const { buildVfxAtlas, SPRITE, ATLAS_CELL, ATLAS_GRID } = await import( '../src/fx/VfxAtlas.js' );
const { G } = await import( '../src/core/Globals.js' );

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// ---------------------------------------------------------------------------------------------- atlas

{

	const a = buildVfxAtlas();
	ok( a.size === ATLAS_CELL * ATLAS_GRID && a.data.length === a.size * a.size * 4, 'atlas is 4 x 4 cells of 64 px, rgba8' );
	ok( buildVfxAtlas() === a, 'atlas is built once and cached' );
	let allCov = true, borders = true;
	for ( let c = 0; c < Object.keys( SPRITE ).length; c ++ ) {

		const ox = ( c % ATLAS_GRID ) * ATLAS_CELL, oy = Math.floor( c / ATLAS_GRID ) * ATLAS_CELL;
		let sum = 0;
		for ( let y = 0; y < ATLAS_CELL; y ++ ) for ( let x = 0; x < ATLAS_CELL; x ++ ) {

			const r = a.data[ ( ( oy + y ) * a.size + ox + x ) * 4 ];
			sum += r;
			if ( ( x === 0 || y === 0 || x === ATLAS_CELL - 1 || y === ATLAS_CELL - 1 ) && r !== 0 ) borders = false;

		}

		if ( sum / ( ATLAS_CELL * ATLAS_CELL ) < 2 ) { allCov = false; console.log( '   empty sprite', c ); }

	}

	ok( allCov, 'every sprite has coverage' );
	ok( borders, 'every cell is zero on its border (no bleeding)' );

}

// ---------------------------------------------------------------------------------------------- pool

{

	const p = new VfxPool( 64 );
	p.setLimit( 20 );
	ok( p.limit === 20, 'setLimit clamps the live budget' );
	p.rec.life = 1;
	let n = 0;
	for ( let i = 0; i < 40; i ++ ) if ( p.spawn() >= 0 ) n ++;
	ok( n === 20 && p.stats.dropped === 20, `budget: 20 of 40 spawned (${ n }), the rest dropped` );
	ok( p.spawn( true ) >= 0, 'a priority spawn recycles a slot when full' );
	let runs = 0, covered = 0;
	p.flushDirty( ( a, b ) => { runs ++; covered += b - a; } );
	ok( runs === 1 && covered === 20, `dirty slots flushed as one coalesced run (${ runs } / ${ covered })` );
	ok( p.flushDirty( () => {} ) === 0, 'nothing dirty after a flush' );
	p.advance( 1.01 );
	ok( p.live === 0 && p.drawCount === 0, 'slots free after their life' );

	// closed-form motion against a small-step integration
	p.rec.px = 1; p.rec.py = 2; p.rec.pz = 3; p.rec.vx = 4; p.rec.vy = 9; p.rec.vz = - 2;
	p.rec.ax = 0.3; p.rec.ay = - 9.81; p.rec.az = 0.1; p.rec.drag = 0.7; p.rec.life = 5;
	const i = p.spawn();
	const m = motionAt( p.data, i, 1.3 );
	let x = 1, y = 2, z = 3, vx = 4, vy = 9, vz = - 2;
	for ( let s = 0, h = 1e-4; s < 13000; s ++ ) {

		vx += ( 0.3 - 0.7 * vx ) * h; vy += ( - 9.81 - 0.7 * vy ) * h; vz += ( 0.1 - 0.7 * vz ) * h;
		x += vx * h; y += vy * h; z += vz * h;

	}

	ok( Math.hypot( m.x - x, m.y - y, m.z - z ) < 2e-3 && Math.abs( m.vy - vy ) < 2e-3, `motionAt matches the integrated motion (${ m.y.toFixed( 4 ) } vs ${ y.toFixed( 4 ) })` );
	p.rec.drag = 0;
	const j = p.spawn();
	const m0 = motionAt( p.data, j, 1 );
	ok( Math.abs( m0.y - ( 2 + 9 - 9.81 / 2 ) ) < 1e-4, 'zero drag: plain ballistic motion' );

	// the clock wraps; spawn times follow
	const q = new VfxPool( 8 );
	q.rec.life = 1000;
	q.advance( 599 );
	const k = q.spawn();
	const t0 = q.data[ k * STRIDE + 3 ];
	q.advance( 2 );
	ok( q.stats.rebased === 1 && q.now < 10 && Math.abs( ( q.now - q.data[ k * STRIDE + 3 ] ) - ( 601 - t0 ) ) < 1e-3, 'clock rebase keeps every age' );

}

// ---------------------------------------------------------------------------------------------- recipes

const sprayCalls = [];
const fakeSpray = { emit: ( p, v, count, size, kind ) => sprayCalls.push( { x: p.x, count, kind } ) };
const groundAt = ( x ) => ( x > 100 ? 4 : - 10 ); // land east of x = 100
const mkSys = ( o = {} ) => new VfxSystem( { env: { seaLevel: () => 0, groundAt, wind: ( out ) => { out.x = 3; out.z = 0; return out; }, camera: () => ( { x: 0, y: 5, z: 0 } ), ...o } } );

{

	const s = mkSys();
	const spawned = () => s.pool.stats.spawned;
	const calls = [
		[ 'splash', () => s.splash( 0, 0, 0, 1 ) ],
		[ 'spray', () => s.spray( 10, 0, 0, 1, 1, 0 ) ],
		[ 'smoke', () => s.smoke( 20, 2, 0, 1 ) ],
		[ 'smoke (gun)', () => s.smoke( 25, 2, 0, 1, 1, 0, 0 ) ],
		[ 'splinters', () => s.splinters( 30, 2, 0, 1 ) ],
		[ 'flash', () => s.flash( 40, 2, 0, 1, 0, 0, 1 ) ],
		[ 'debris', () => s.debris( 120, 4, 0, 1, 'stone' ) ],
		[ 'dust', () => s.dust( 130, 4, 0, 1 ) ],
		[ 'bubbles', () => s.bubbles( 50, 0, 0, 1 ) ],
		[ 'explosion', () => s.explosion( 60, 1, 0, 1 ) ],
	];
	for ( const [ name, fn ] of calls ) {

		const before = spawned();
		fn();
		ok( spawned() > before, `${ name } spawns particles (${ spawned() - before })` );

	}

	ok( s.lights.slice( 0, 2 ).some( ( l ) => l.enabled && l.intensity > 0 ), 'a flash lights a point light' );
	s.update( 0.5 );
	ok( s.lights.slice( 0, 2 ).every( ( l ) => ! l.enabled ), 'flash lights go out after their burst' );

	// splinters on land rest on the ground, at sea they sink
	const d = s.pool.data;
	let rest = 0, die = 0;
	for ( let i = 0; i < s.pool.capacity; i ++ ) {

		if ( s.pool.death[ i ] <= s.pool.now ) continue;
		const look = Math.floor( d[ i * STRIDE + 21 ] ), fm = Math.floor( d[ i * STRIDE + 23 ] );
		if ( look === LOOK.SOLID && fm === 2 ) rest ++;
		if ( look === LOOK.SOLID && fm === 1 ) die ++;

	}

	ok( rest > 0 && die > 0, `debris rests on land (${ rest }) and dies in the sea (${ die })` );

	// smoke drifts downwind (the wind is folded into its acceleration)
	const t = mkSys();
	t.update( 0.016 );
	t.smoke( 0, 2, 0, 1 );
	let drift = 0, cnt = 0;
	const out = {};
	for ( let i = 0; i < t.pool.capacity; i ++ ) if ( t.pool.death[ i ] > t.pool.now ) { motionAt( t.pool.data, i, 4, out ); drift += out.x; cnt ++; }
	ok( cnt > 0 && drift / cnt > 2, `smoke drifts downwind (${ ( drift / cnt ).toFixed( 2 ) } m in 4 s)` );

	// orientations used: columns upright, foam flat, sparks streaked
	const o = new Set();
	for ( let i = 0; i < s.pool.capacity; i ++ ) if ( s.pool.death[ i ] > s.pool.now ) o.add( s.pool.data[ i * STRIDE + 22 ] );
	ok( o.has( ORIENT.UPRIGHT ) && o.has( ORIENT.FLAT ) && o.has( ORIENT.STREAK ) && o.has( ORIENT.BILLBOARD ), 'all four orientations in use' );

}

// de-duplication: the same effect at the same spot within 0.1 s shows once
{

	const s = mkSys();
	s.splash( 5, 0, 5, 1 );
	s.splash( 5.2, 0, 5.1, 1 );
	ok( s.counts.splash === 1 && s.deduped === 1, 'a second splash at the same spot within 0.1 s is dropped' );
	s.splash( 15, 0, 5, 1 );
	ok( s.counts.splash === 2, 'a splash elsewhere is not' );
	s.update( 0.15 );
	s.splash( 5, 0, 5, 1 );
	ok( s.counts.splash === 3, 'the same spot after 0.1 s splashes again' );
	s.flash( 5, 0, 5, 1 );
	ok( s.counts.flash === 1, 'a different effect at the same spot is not de-duplicated' );

}

// budget and quality
{

	const s = mkSys();
	for ( let i = 0; i < 400; i ++ ) { s.explosion( i * 3, 1, 0, 2 ); if ( i % 20 === 0 ) s.update( 0.016 ); }
	s.update( 0.016 );
	ok( s.live <= BUDGET.high && s.live > BUDGET.high * 0.5, `high budget holds (${ s.live } live <= ${ BUDGET.high })` );
	const l = mkSys();
	l.setQuality( 'low' );
	for ( let i = 0; i < 400; i ++ ) { l.explosion( i * 3, 1, 0, 2 ); if ( i % 20 === 0 ) l.update( 0.016 ); }
	l.update( 0.016 );
	ok( l.live <= BUDGET.low, `low budget holds (${ l.live } live <= ${ BUDGET.low })` );
	const a = mkSys(), b = mkSys();
	b.setQuality( 'low' );
	a.splash( 0, 0, 0, 1 ); b.splash( 0, 0, 0, 1 );
	ok( b.pool.stats.spawned < a.pool.stats.spawned, `low quality spawns fewer (${ b.pool.stats.spawned } < ${ a.pool.stats.spawned })` );

}

// GPU spray is used for the drops when the scene has it
{

	sprayCalls.length = 0;
	const s = mkSys( { spray: fakeSpray } );
	s.splash( 0, 0, 0, 1 );
	ok( sprayCalls.length >= 1 && sprayCalls[ 0 ].kind === 0, 'splash drops go to the scene spray (droplets)' );

}

// fires, lights, ships
{

	const s = mkSys();
	s.fire( 'a', 0, 2, 0, 1 );
	s.fire( 'a', 0.5, 2, 0, 1 );
	ok( s.fireCount === 1, 'calling fire again moves it (one fire per id)' );
	const before = s.pool.stats.spawned;
	for ( let i = 0; i < 30; i ++ ) s.update( 1 / 30 );
	ok( s.pool.stats.spawned - before > 20, `a fire emits flames, smoke and embers (${ s.pool.stats.spawned - before } in 1 s)` );
	ok( s.lights[ 2 ].enabled && s.lights[ 2 ].intensity > 0, 'the nearest fire has a flickering light' );
	ok( s.stopFire( 'a' ) && s.fireCount === 0 && ! s.lights[ 2 ].enabled, 'stopFire puts it out and frees its light' );
	ok( ! s.stopFire( 'nope' ), 'stopFire of an unknown id is harmless' );
	for ( let i = 0; i < 30; i ++ ) s.fire( 'f' + i, i, 2, 0, 1 );
	ok( s.fireCount <= 16, 'fires are capped' );

	const ship = { id: 'p1', hp: 100, maxHp: 400, alive: true, state: 'patrol', x: 0, z: 0, sinkT: 0, cls: { beam: 6, length: 16, deck: 2.4 },
		toWorld( lx, ly, lz, out ) { out.x = this.x + lx; out.y = ly; out.z = this.z + lz; return out; }, velocity( out ) { out.x = 1; out.z = 0; return out; } };
	Object.defineProperty( ship, 'hpFraction', { get() { return this.hp / this.maxHp; } } );
	const t = mkSys();
	t.trackShips( [ ship ] ); t.update( 0.1 );
	ok( t.fires.some( ( f ) => f.on && f.id === 'ship:p1' ), 'a ship under 35 % hull burns' );
	ship.hp = 300;
	t.trackShips( [ ship ] ); t.update( 0.1 );
	ok( ! t.fires.some( ( f ) => f.on && f.id === 'ship:p1' ), 'repaired, the fire goes out' );
	ship.hp = 0; ship.state = 'sinking'; ship.alive = false;
	t.trackShips( [ ship ] ); t.update( 0.1 );
	ok( t.sinks.some( ( e ) => e.on && e.id === 'ship:p1' ) && t.counts.bubbles >= 1, 'a sinking ship bubbles' );
	for ( let i = 0; i < 40; i ++ ) { ship.sinkT += 0.25; t.trackShips( [ ship ] ); t.update( 0.25 ); }
	ok( ! t.sinks.some( ( e ) => e.on ) && ! t.fires.some( ( f ) => f.on ), 'the sinking and its fire end' );
	t.reset();
	ok( t.live === 0 && t.fireCount === 0, 'reset clears everything' );

}

// ---------------------------------------------------------------------------------------------- the feature

{

	G.seaLevel.value = 0;
	const app = { terrainData: { heightAt: groundAt }, camera: { position: { x: 0, y: 5, z: 0 } }, game: { rod: { bobber: { x: 3, y: 0, z: 4 } } }, settings: { renderScale: 1 } };
	const features = new Features( app );
	const naval = { ships: [] };
	features.add( 'naval', { install: () => naval } );
	const vfx = features.add( 'vfx', vfxModule );
	ok( !! vfx && features.get( 'vfx' ) === vfx, 'installs headless (no scene: nothing drawn)' );
	for ( const k of [ 'splash', 'spray', 'smoke', 'splinters', 'flash', 'debris', 'fire', 'stopFire', 'bubbles' ] ) ok( typeof vfx[ k ] === 'function', `vfx.${ k } exists` );
	ok( Array.isArray( vfx.lights ) && vfx.lights.length === 4, 'exposes its point lights' );

	const c = vfx.counts;
	features.emit( 'cannonFired', { x: 0, y: 3, z: 0, dir: { x: 1, y: 0, z: 0 }, side: 'port', by: 'player' } );
	ok( c.flash === 1 && c.smoke === 1, 'cannonFired -> flash + smoke' );
	vfx.flash( 0, 3, 0, 1, 1, 0, 0 );
	ok( c.flash === 1, 'a direct call right after the event at the same spot shows once' );
	features.emit( 'cannonballImpact', { x: 10, y: 0, z: 0, vx: 100, vy: - 10, vz: 0, energy: 20000, hit: 'water' } );
	ok( c.splash === 1, 'impact on water -> splash' );
	features.emit( 'cannonballImpact', { x: 20, y: 2, z: 0, energy: 20000, hit: 'ship', target: 'p1' } );
	ok( c.splinters === 1, 'impact on a ship -> splinters' );
	features.emit( 'cannonballImpact', { x: 120, y: 4, z: 0, energy: 20000, hit: 'land' } );
	ok( c.debris === 1, 'impact on land -> debris + dust' );
	features.emit( 'cannonballImpact', { x: 130, y: 4, z: 0, energy: 20000, hit: 'prop', target: 'crate1' } );
	ok( c.debris === 2, 'impact on a prop -> debris' );
	features.emit( 'explosion', { x: 40, y: 1, z: 0, radius: 4, energy: 1e5 } );
	ok( c.explosion === 1, 'explosion -> flash + smoke + debris' );
	features.emit( 'propDestroyed', { id: 'barrel3', kind: 'barrel', x: 140, y: 4, z: 0, by: 'player' } );
	ok( c.dust >= 1, 'propDestroyed -> dust' );
	features.emit( 'shipSunk', { id: 'm7', name: 'Hope', faction: 'merchant', x: 60, z: 0, byPlayer: true } );
	ok( c.bubbles >= 1 && vfx.sys.sinks.some( ( e ) => e.on ), 'shipSunk -> bubbles + foam' );
	features.emit( 'planeTookOff', { id: 'sp', x: 70, z: 0, heading: 0 } );
	ok( c.spray === 1, 'planeTookOff -> spray' );
	features.emit( 'planeLanded', { id: 'sp', onWater: false, x: 75, z: 0 } );
	ok( c.spray === 1, 'landing on the ground: no spray' );
	const before = c.splash;
	features.emit( 'fishCaught', { species: 'cod', kg: 4 } );
	ok( c.splash === before + 1, 'fishCaught -> a small splash at the bobber' );
	features.emit( 'remoteWorldEvent', { kind: 'explosion', data: { x: 300, y: 0, z: 300, radius: 3 }, from: 'p2', replay: true } );
	ok( c.explosion === 1, 'replayed remote events make no effects' );
	features.emit( 'remoteWorldEvent', { kind: 'explosion', data: { x: 300, y: 0, z: 300, radius: 3 }, from: 'p2' } );
	ok( c.explosion === 2, 'a live remote explosion shows' );
	features.emit( 'cannonballImpact', { hit: 'water' } );
	features.emit( 'cannonFired', null );
	ok( true, 'bad payloads are ignored' );

	features.update( 1 / 60 );
	ok( vfx.live > 0, `particles live after the events (${ vfx.live })` );
	app.settings.renderScale = 0.5;
	for ( let i = 0; i < 5; i ++ ) features.update( 0.25 );
	ok( vfx.sys.quality === 'low' && vfx.sys.pool.limit === BUDGET.low, 'the Low preset (render scale 0.5) switches to the low budget' );
	vfx.reset();
	ok( vfx.live === 0, 'reset' );
	vfx.dispose();
	features.emit( 'explosion', { x: 0, y: 0, z: 0, radius: 2 } );
	ok( c.explosion === 2, 'no listeners after dispose' );

}

// ---------------------------------------------------------------------------------------------- GPU (optional)

if ( GPU_RUN ) await gpuRender();

console.log( fails ? `\n${ fails } FAILED` : '\nall ok' );
process.exit( fails ? 1 : 0 );

async function gpuRender() {

	const { mkdirSync } = await import( 'node:fs' );
	const { dirname } = await import( 'node:path' );
	const { writePNG } = await import( './headless.mjs' );
	const { GPU } = await import( '../src/engine/gpu/GPU.js' );
	const { RenderTarget } = await import( '../src/engine/gpu/Texture.js' );
	const { readTexture } = await import( '../src/engine/gpu/Readback.js' );
	const { setFrameCamera } = await import( '../src/engine/render/Frame.js' );
	const { Material } = await import( '../src/engine/render/Material.js' );
	const { MeshRenderer } = await import( '../src/engine/render/MeshRenderer.js' );
	const { FullscreenPass } = await import( '../src/engine/render/FullscreenPass.js' );
	const { SunShadows } = await import( '../src/engine/render/Shadows.js' );
	const E = await import( '../src/engine/index.js' );
	const { VfxParticles } = await import( '../src/fx/VfxParticles.js' );
	await GPU.init( { headless: true } );
	const W = 960, H = 540;
	const scene = new E.Scene();
	const sea = new E.Mesh( new E.PlaneGeometry( 400, 400 ).rotateX( - Math.PI / 2 ), new Material( { name: 'sea', color: 0x1d4a66, roughness: 0.3 } ) );
	const land = new E.Mesh( new E.BoxGeometry( 30, 8, 30 ), new Material( { name: 'land', color: 0x8a7a5a, roughness: 0.9 } ) );
	land.position.set( 115, 0, 0 );
	scene.add( sea, land );
	const sys = mkSys();
	const fx = new VfxParticles( { pool: sys.pool } );
	scene.add( fx.mesh );
	const camera = new E.PerspectiveCamera( 50, W / H, 0.1, 2000 );
	// VFX_CAM=x,y,z,tx,ty,tz looks elsewhere (close-ups)
	const cv = ( process.env.VFX_CAM || '45,8,42,45,3,0' ).split( ',' ).map( Number );
	camera.position.set( cv[ 0 ], cv[ 1 ], cv[ 2 ] ); camera.lookAt( cv[ 3 ], cv[ 4 ], cv[ 5 ] );
	G.sunDir.value.set( 0.4, 0.6, 0.5 ).normalize();
	G.sunColor.value.setRGB( 11, 10.5, 9.8 );
	G.skyIrradiance.value.setRGB( 0.9, 1.1, 1.5 );
	G.horizonColor.value.setRGB( 1.4, 1.6, 1.9 );
	// a row of effects, each caught at a telling moment: a fire burns for 3 s first, then the others are started
	// oldest first so that each has its age when the frame is drawn
	sys.update( 0.016 );
	for ( let i = 0; i < 90; i ++ ) { sys.fire( 'f', 56, 2, 0, 1.4 ); sys.update( 1 / 30 ); }
	const shots = [
		[ 0.6, () => sys.bubbles( 64, 0, 0, 1.4 ) ],
		[ 0.45, () => sys.splash( 27, 0, 0, 1.2 ) ],
		[ 0.4, () => sys.explosion( 46, 1, 0, 1 ) ],
		[ 0.3, () => sys.spray( 72, 0, 0, 1.5, 1, 0 ) ],
		[ 0.25, () => sys.splinters( 36, 2.5, 0, 1.5 ) ],
		[ 0.05, () => sys.muzzle( 18, 3, 0, 1, 0.05, 0.3, 1.2 ) ],
		[ 0, null ],
	];
	for ( let i = 0; i < shots.length - 1; i ++ ) {

		shots[ i ][ 1 ]();
		for ( let t = shots[ i ][ 0 ] - shots[ i + 1 ][ 0 ]; t > 1e-6; t -= 0.01 ) { sys.fire( 'f', 56, 2, 0, 1.4 ); sys.update( Math.min( 0.01, t ) ); }

	}

	const rt = new RenderTarget( W, H, { colors: [ 'rgba16float', 'rgba16float', 'rgba8unorm' ], depth: 'depth32float', label: 'scene' } );
	const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );
	const mr = new MeshRenderer();
	const shadows = new SunShadows();
	const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => rt.texture } },
		code: `fn fragment( in: FSIn ) -> vec4f {
			let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb;
			let a = c * 0.25; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
			return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );
	for ( let f = 0; f < 2; f ++ ) {

		fx.sync();
		GPU.beginFrame();
		setFrameCamera( camera, W, H );
		shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
		mr.render( scene, { camera, kind: 'main', colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
			clearColors: [ [ 1.4, 1.6, 1.9, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0 } );
		tonemap.render( { colorViews: [ ldr.texture ] } );
		GPU.submit();

	}

	const img = await readTexture( ldr.texture );
	const px = new Uint8Array( img.data );
	const OUT = new URL( './out/feature-vfx.png', import.meta.url ).pathname.replace( /^\/([A-Za-z]:)/, '$1' );
	mkdirSync( dirname( OUT ), { recursive: true } );
	writePNG( OUT, W, H, px );
	ok( fx.mesh.visible && fx.geometry.instanceCount > 100, `GPU: particles drawn (${ fx.geometry.instanceCount } instances, ${ mr.stats.draws } draws) -> ${ OUT }` );

}
