// Plain-node tests of the physics facade (src/physics: Rapier backend, joint loads, buoyancy, heightfield tiles) and the
// destruction feature (src/features/destruction: placement on the real heightmap, damage, joints breaking, persistence,
// multiplayer events, raycastSegment / impulse). No GPU: the feature runs without a scene (nothing is drawn).
//   node test/feature-destruction.mjs
import { initPhysics, PhysicsWorld } from '../src/physics/World.js';
import { strongholdPlan } from '../src/world/islands/stronghold/Kinds.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const run = ( w, seconds ) => { for ( let i = 0; i < Math.round( seconds * 60 ); i ++ ) w.step( 1 / 60 ); };

section( 'physics init' );
const t0 = performance.now();
ok( await initPhysics(), `Rapier loads (${ ( performance.now() - t0 ).toFixed( 0 ) } ms)` );

section( 'stacking on a heightfield' );
{

	const w = new PhysicsWorld( { heightAt: () => 0 } );
	const boxes = [];
	for ( let i = 0; i < 6; i ++ ) boxes.push( w.addBody( { shape: 'box', size: [ 0.8, 0.4, 0.8 ], position: { x: 0.01 * ( i % 2 ), y: 0.2 + i * 0.401, z: 0 }, density: 600 } ) );
	run( w, 5 );
	const top = boxes[ 5 ];
	ok( Math.abs( top.position.x ) < 0.05 && Math.abs( top.position.z ) < 0.05 && Math.abs( top.position.y - ( 0.2 + 5 * 0.4 ) ) < 0.05, `a six-box stack stands (top at ${ top.position.x.toFixed( 3 ) }, ${ top.position.y.toFixed( 3 ) }, ${ top.position.z.toFixed( 3 ) })` );
	ok( boxes.every( ( b ) => b.sleeping ), 'the settled stack sleeps' );
	ok( w.tiles.size >= 1, `heightfield tiles appear under the bodies (${ w.tiles.size })` );
	w.dispose();

}

section( 'a box resting on a sloped heightfield' );
{

	const h = ( x, z ) => 3 + 0.08 * x + 0.03 * z;
	const w = new PhysicsWorld( { heightAt: h } );
	const b = w.addBody( { shape: 'box', size: [ 0.6, 0.3, 0.6 ], position: { x: 5.3, y: 8, z: - 2.2 }, density: 700, friction: 1 } );
	run( w, 4 );
	const g = h( b.position.x, b.position.z );
	// on a slope the box's lowest point sits on the ground: centre about hy / cos(slope) above it
	ok( Math.abs( b.position.y - g - 0.15 ) < 0.06, `rests on the terrain (centre ${ ( b.position.y - g ).toFixed( 3 ) } m above the ground)` );
	ok( Math.hypot( b.velocity.x, b.velocity.y, b.velocity.z ) < 0.05, 'and stays put (friction holds it on the 5 deg slope)' );
	w.dispose();

}

section( 'joints break above their threshold' );
{

	const w = new PhysicsWorld( { heightAt: () => - 50 } );
	// a 0.5 m cube hanging from the world by a joint at its top face
	const mk = ( x, breakForce ) => {

		const b = w.addBody( { shape: 'box', size: [ 0.5, 0.5, 0.5 ], position: { x, y: 5, z: 0 }, density: 400, buoyancy: 0 } );
		const j = w.addJoint( null, b, { anchor: { x, y: 5.25, z: 0 }, breakForce } );
		return { b, j };

	};
	const weak = mk( 0, 0 ), strong = mk( 3, 0 );
	const mg = weak.b.mass * 9.81;
	weak.j.breakForce = 1.6 * mg; strong.j.breakForce = 6 * mg;
	const broken = [];
	w.onBreak( ( j ) => broken.push( j ) );
	run( w, 1 );
	ok( ! weak.j.broken && ! strong.j.broken, `both hold their own weight (load ${ weak.j.load.toFixed( 1 ) } N vs m g ${ mg.toFixed( 1 ) } N)` );
	ok( Math.abs( weak.j.load - mg ) < 0.1 * mg || weak.b.sleeping, 'the estimated load is the hanging weight' );
	weak.b.force.y = - 2 * mg; strong.b.force.y = - 2 * mg; // pull down with twice the weight: 3 m g in the joint
	weak.b.wake(); strong.b.wake();
	run( w, 1 );
	ok( weak.j.broken && broken.includes( weak.j ), 'the 1.6 m g joint snaps under 3 m g' );
	ok( ! strong.j.broken, `the 6 m g joint holds (peak ${ ( strong.j.peak / mg ).toFixed( 2 ) } m g)` );
	ok( weak.b.position.y < 4.5, 'the freed cube falls' );
	// an impulse on one piece drags its neighbour: the joint between them breaks
	const a = w.addBody( { shape: 'box', size: [ 1, 0.1, 0.3 ], position: { x: 10, y: 5, z: 0 }, density: 600, buoyancy: 0 } );
	const c = w.addBody( { shape: 'box', size: [ 1, 0.1, 0.3 ], position: { x: 11.002, y: 5, z: 0 }, density: 600, buoyancy: 0 } );
	w.addJoint( null, a, { anchor: { x: 9.5, y: 5, z: 0 }, breakForce: 1e9 } );
	const ac = w.addJoint( a, c, { anchor: { x: 10.501, y: 5, z: 0 }, breakForce: 400 } );
	run( w, 0.5 );
	ok( ! ac.broken, `a plank cantilevered from another holds (load ${ ac.load.toFixed( 0 ) } N)` );
	w.impulse( 11, 4.6, 0, 1.2, 4000 );
	run( w, 0.2 );
	ok( ac.broken, 'a blast under it snaps the joint' );
	w.dispose();

}

section( 'raycasts, impulses and sleep' );
{

	const w = new PhysicsWorld( { heightAt: () => 0 } );
	const b = w.addBody( { shape: 'box', size: [ 1, 1, 1 ], position: { x: 2, y: 0.5, z: 0 }, density: 500 } );
	const s = w.addBody( { shape: 'sphere', radius: 0.4, position: { x: - 3, y: 0.4, z: 1 }, density: 500 } );
	run( w, 0.1 );
	const hit = w.raycast( 0, 0.5, 0, 4, 0.5, 0 );
	ok( hit && hit.body === b && Math.abs( hit.t - 0.375 ) < 0.01 && Math.abs( hit.x - 1.5 ) < 0.02, `raycast hits the box face (t ${ hit && hit.t.toFixed( 3 ) })` );
	ok( w.raycast( 0, 3, 0, 4, 3, 0 ) === null, 'a ray above it misses' );
	const hs = w.raycast( - 3, 3, 1, - 3, - 1, 1 );
	ok( hs && hs.body === s && Math.abs( hs.y - 0.8 ) < 0.03, 'raycast hits the sphere top' );
	run( w, 3 );
	ok( b.sleeping && s.sleeping, 'resting bodies fall asleep' );
	const n = w.impulse( 2, 0.2, - 1.5, 3, 800 );
	w.step( 1 / 60 );
	ok( n === 1 && ! b.sleeping && b.velocity.z > 0.5, `an impulse wakes and pushes what is in range (${ n } body, vz ${ b.velocity.z.toFixed( 2 ) })` );
	run( w, 6 );
	ok( b.sleeping, 'and it sleeps again once settled' );
	w.dispose();

}

section( 'buoyancy and drag' );
{

	const w = new PhysicsWorld( { heightAt: () => - 6, oceanHeight: () => 0 } );
	const plank = w.addBody( { shape: 'box', size: [ 1.2, 0.1, 0.3 ], position: { x: 0, y: 2, z: 0 }, density: 550 } );
	const crate = w.addBody( { shape: 'box', size: [ 0.8, 0.8, 0.8 ], position: { x: 3, y: 1, z: 0 }, density: 500 } );
	const rock = w.addBody( { shape: 'sphere', radius: 0.3, position: { x: - 3, y: 1, z: 0 }, density: 2400 } );
	run( w, 8 );
	ok( Math.abs( plank.position.y - ( 0.05 - 0.1 * 0.55 ) ) < 0.05, `a plank floats (centre ${ plank.position.y.toFixed( 3 ) })` );
	ok( Math.abs( crate.position.y ) < 0.08, `a 500 kg/m3 crate floats half under (centre ${ crate.position.y.toFixed( 3 ) })` );
	ok( rock.position.y < - 5.5, `a rock sinks to the seabed (${ rock.position.y.toFixed( 2 ) })` );
	ok( Math.hypot( crate.velocity.x, crate.velocity.y, crate.velocity.z ) < 0.05, 'drag settles the bobbing' );
	w.dispose();

}

section( 'budget and step cost' );
{

	const w = new PhysicsWorld( { heightAt: ( x, z ) => 0.05 * Math.sin( x * 0.3 ) * 4, maxBodies: 300 } );
	for ( let i = 0; i < 100; i ++ ) w.addBody( { shape: i % 3 ? 'box' : 'sphere', size: [ 0.9, 0.12, 0.3 ], radius: 0.2, position: { x: ( i % 10 ) * 1.3 - 6, y: 2 + Math.floor( i / 10 ) * 0.5, z: ( ( i * 7 ) % 10 ) * 1.1 - 5 }, density: 600 } );
	run( w, 0.1 );
	let ms = 0, n = 0;
	for ( let i = 0; i < 90; i ++ ) { const a = performance.now(); w.step( 1 / 60 ); ms += performance.now() - a; n ++; }
	const st = w.stats();
	ok( st.awake >= 60, `most of the 100 bodies are awake while falling (${ st.awake })` );
	ok( ms / n < 2, `100 awake bodies: ${ ( ms / n ).toFixed( 3 ) } ms per step (< 2 ms)` );
	for ( let i = 0; i < 205; i ++ ) w.addBody( { shape: 'box', size: [ 0.2, 0.2, 0.2 ], position: { x: i * 0.3, y: 10, z: 20 } } );
	ok( w.count === 300, `the budget stops at 300 bodies (${ w.count })` );
	w.dispose();

}

// ---------------------------------------------------------------------------------------------------- the feature
const { TerrainData } = await import( '../src/world/TerrainData.js' );
const { Colliders } = await import( '../src/world/Colliders.js' );
const { Features } = await import( '../src/features/Features.js' );
const { WORLD } = await import( '../src/world/WorldLayout.js' );
const { Vector3, Quaternion } = await import( '../src/engine/index.js' );
const destruction = await import( '../src/features/destruction/index.js' );
const { buildKind, KINDS, planProps } = destruction;
const { dockLine } = await import( '../src/features/destruction/Sites.js' );
const RESPAWN = destruction.RESPAWN_HOURS;

section( 'kinds' );
{

	let seed = 1;
	const rng = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
	const crate = buildKind( 'crate', rng );
	ok( crate.pieces.length === 12 && crate.joints.length >= 16, `a crate is 12 planks with ${ crate.joints.length } joints` );
	const fence = buildKind( 'fence', rng, { spans: 2 } );
	ok( fence.anchors.length === 3 && fence.joints.length >= 8, `a two-span fence: 3 anchored posts, ${ fence.joints.length } joints` );
	const hut = buildKind( 'leanTo', rng );
	ok( hut.pieces.length === 14 && hut.anchors.length === 4 && hut.joints.length >= 14, `a lean-to: 14 pieces, 4 anchored posts, ${ hut.joints.length } joints` );
	const rack = buildKind( 'fishRack', rng );
	ok( rack.joints.filter( ( j ) => j[ 2 ] === 90 ).length === 6, 'every drying fish hangs from the ridge by a weak joint' );
	for ( const k of Object.keys( KINDS ) ) {

		const l = buildKind( k, rng, { depth: 2 } );
		ok( l.pieces.every( ( p ) => p.size.every( ( v ) => v > 0.01 ) && Math.abs( Math.hypot( p.quat.x, p.quat.y, p.quat.z, p.quat.w ) - 1 ) < 1e-6 ), `${ k }: ${ l.pieces.length } valid pieces, ${ l.joints.length } joints` );

	}

}

section( 'placement on the real heightmap' );
const T = new TerrainData();
const plan = planProps( { terrain: T, colliders: new Colliders(), keep: [] } );
{

	const ids = new Set( plan.map( ( p ) => p.id ) );
	ok( ids.size === plan.length && plan.length >= 35, `${ plan.length } props with unique ids` );
	const again = planProps( { terrain: T, colliders: new Colliders(), keep: [] } );
	const sig = ( l ) => JSON.stringify( l.map( ( p ) => [ p.id, p.x.toFixed( 3 ), p.z.toFixed( 3 ) ] ) );
	ok( sig( again ) === sig( plan ), 'deterministic: the same ids at the same spots' );
	for ( const port of WORLD.ports ) ok( plan.filter( ( p ) => p.port === port.id ).length >= 5, `${ port.id }: ${ plan.filter( ( p ) => p.port === port.id ).map( ( p ) => p.kind ).join( ', ' ) }` );
	const camp = plan.filter( ( p ) => p.site === 'camp' );
	ok( camp.length >= 5 && camp.some( ( p ) => p.kind === 'leanTo' ) && camp.every( ( p ) => Math.hypot( p.x - 127, p.z + 71 ) < 18 ), `the raider camp: ${ camp.map( ( p ) => p.kind ).join( ', ' ) }` );
	const shoal = plan.filter( ( p ) => p.site === 'shoals' );
	const far = shoal.every( ( p ) => WORLD.ports.every( ( q ) => Math.hypot( p.x - q.stand.x, p.z - q.stand.z ) > 150 ) );
	ok( shoal.length >= 4 && far && shoal.every( ( p ) => p.port === null && T.heightAt( p.x, p.z ) < - 0.3 ), `${ shoal.length } shoal props (${ shoal.map( ( p ) => p.kind ).join( ', ' ) }) in shallow water, 150 m+ from every harbour` );
	const land = plan.filter( ( p ) => p.site !== 'shoals' && p.kind !== 'railing' );
	ok( land.every( ( p ) => T.heightAt( p.x, p.z ) > 0.25 ), 'land props stand on dry ground' );
	const segClear = ( p, l ) => {

		const dx = l[ 2 ] - l[ 0 ], dz = l[ 3 ] - l[ 1 ];
		const t = Math.max( 0, Math.min( 1, ( ( p.x - l[ 0 ] ) * dx + ( p.z - l[ 1 ] ) * dz ) / ( dx * dx + dz * dz ) ) );
		return Math.hypot( p.x - l[ 0 ] - dx * t, p.z - l[ 1 ] - dz * t ) > 3 + p.r;

	};
	ok( land.every( ( p ) => WORLD.ports.every( ( q ) => ! dockLine( q ) || segClear( p, dockLine( q ) ) ) ), 'and keep clear of every dock and the pier' );
	const rails = plan.filter( ( p ) => p.kind === 'railing' );
	ok( rails.length >= 1 && rails.every( ( p ) => Math.abs( p.y - WORLD.ports.find( ( q ) => q.id === p.port ).dock.deckHeight ) < 1e-6 ), `${ rails.length } dock railings at deck height` );

}

section( 'the feature' );
{

	const sent = [], events = [];
	const colliders = new Colliders();
	const app = {
		terrainData: T, colliders, settings: { timeOfDay: 10, timeSpeed: 1 }, mode: 'campaign',
		player: { position: new Vector3( 0, 5, - 300 ), yaw: 0, mode: 'walk' },
		netsync: { sendWorldEvent: ( kind, data ) => sent.push( { kind, data } ) },
	};
	const features = new Features( app );
	for ( const n of [ 'propDestroyed', 'propRespawned' ] ) features.on( n, ( e ) => events.push( { n, e } ) );
	const d = features.add( 'destruction', destruction );
	await initPhysics();
	await new Promise( ( r ) => setTimeout( r, 0 ) );
	for ( let i = 0; i < 3; i ++ ) features.update( 1 / 60 );
	const fort = strongholdPlan( T );
	ok( d.built && d.props.length === plan.length + fort.length && fort.every( ( q ) => d.byId.has( q.id ) && d.byId.get( q.id ).K === KINDS[ q.kind ] ) && d.physicsState === 'ready', `built ${ d.props.length } props (Blackwater's fort: ${ fort.length }), physics ${ d.physicsState }` );
	ok( colliders.boxes.filter( ( b ) => b.tag === 'destructible' ).length === d.props.length, 'every prop registered a collider' );
	ok( d.world.bodies.size >= d.props.length && d.world.count === 0, 'whole props are fixed boxes in the physics world (no dynamic bodies yet)' );

	const crate = d.props.find( ( p ) => p.kind === 'crate' && p.port === 'home' );
	const c = crate.center;
	const hit = d.raycastSegment( c.x - 5, c.y, c.z, c.x + 5, c.y, c.z );
	ok( hit && hit.id === crate.id && hit.t > 0.3 && hit.t < 0.5, `raycastSegment hits the crate (t ${ hit && hit.t.toFixed( 3 ) })` );
	ok( d.raycastSegment( c.x - 5, c.y + 8, c.z, c.x + 5, c.y + 8, c.z ) === null, 'a segment over it misses' );

	d.strike( c.x, c.y, c.z, 1.2, 450 );
	ok( crate.state === 'intact' && crate.damage === 450, 'one paddle blow dents the crate' );
	features.emit( 'meleeHit', { x: c.x, y: c.y, z: c.z, range: 1.2 } );
	ok( crate.state === 'broken', 'the second blow (meleeHit) breaks it' );
	const ev = events.find( ( x ) => x.n === 'propDestroyed' && x.e.id === crate.id );
	ok( ev && ev.e.kind === 'crate' && ev.e.by === 'player' && ev.e.port === 'home', 'propDestroyed { id, kind, x, y, z, by, port }' );
	ok( sent.length === 1 && sent[ 0 ].kind === 'propDestroyed' && sent[ 0 ].data.id === crate.id && sent[ 0 ].data.respawn === 600, 'sent to the other players with a 600 s respawn' );
	ok( crate.colliders.length === 0 && ! crate.fixed && colliders.boxes.filter( ( b ) => b.tag === 'destructible' ).length === d.props.length - 1, 'its collider and fixed box are gone' );
	ok( d.world.count === 12 && d.groups.length === 1, `12 loose planks in the physics world (${ d.world.count })` );
	for ( let i = 0; i < 180; i ++ ) features.update( 1 / 60 );
	const planks = d.groups[ 0 ].items.map( ( it ) => it.body );
	const rest = planks.every( ( b ) => b.position.y > T.heightAt( b.position.x, b.position.z ) - 0.2 && b.position.y < T.heightAt( b.position.x, b.position.z ) + 1.3 );
	ok( rest, 'the pieces come to rest on the terrain' );
	ok( d.stats.jointBreaks > 0, `joints broke under load as it fell apart (${ d.stats.jointBreaks })` );
	for ( let i = 0; i < 420; i ++ ) features.update( 1 / 60 );
	ok( planks.filter( ( b ) => b.sleeping ).length >= 9, `and fall asleep (${ planks.filter( ( b ) => b.sleeping ).length } / 12)` );
	const p0 = planks[ 0 ].position;
	const hp = d.raycastSegment( p0.x, p0.y + 3, p0.z, p0.x, p0.y - 3, p0.z );
	ok( hp && hp.id === crate.id, 'raycastSegment hits loose pieces too (id of their prop)' );

	// cannon, explosion, ramming
	const fence = d.props.find( ( p ) => p.kind === 'fence' );
	features.emit( 'cannonballImpact', { x: fence.center.x, y: fence.center.y, z: fence.center.z, vx: 120, vy: 0, vz: 0, hit: 'prop', target: fence.id, by: 'player' } );
	ok( fence.state === 'broken', 'a cannonball breaks the fence it hits' );
	const rocks = d.props.find( ( p ) => p.kind === 'rockStack' );
	features.emit( 'explosion', { x: rocks.center.x + 1, y: rocks.center.y, z: rocks.center.z, radius: 6, energy: 120000 } );
	ok( rocks.state === 'broken', 'an explosion topples a rock stack' );
	const piling = d.props.find( ( p ) => p.kind === 'piling' );
	const q = new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), 0 );
	app.boatCtl = { position: new Vector3( piling.center.x, 0, piling.center.z - 6 - piling.half.z ), velocity: new Vector3( 0, 0, 5 ), quaternion: q, mass: 3200 };
	for ( let i = 0; i < 60 && piling.state === 'intact'; i ++ ) { app.boatCtl.position.z += 5 / 60; features.update( 1 / 60 ); }
	ok( piling.state === 'broken' && events.some( ( x ) => x.e.id === piling.id && x.e.by === 'ram' && x.e.port === null ), 'ramming at 5 m/s breaks shoal pilings (away from the harbours: port null)' );
	app.boatCtl = null;
	for ( let i = 0; i < 360; i ++ ) features.update( 1 / 60 );
	const pg = d.groups.find( ( g ) => g.prop === piling );
	const floating = pg ? pg.items.filter( ( it ) => Math.abs( it.body.position.y ) < 0.8 && it.body.frac > 0 ) : [];
	ok( floating.length >= 1, `broken-off timber floats (${ floating.length } pieces at the surface)` );
	const st = d.world.stats();
	ok( st.bodies <= 300, `body budget respected (${ st.bodies } bodies, ${ st.awake } awake, ${ st.stepMs.toFixed( 3 ) } ms per step)` );

	// remote events: idempotent, never re-sent
	const nSent = sent.length, nEv = events.filter( ( x ) => x.n === 'propDestroyed' ).length;
	const barrel = d.props.find( ( p ) => p.kind === 'barrel' && p.state === 'intact' );
	features.emit( 'remoteWorldEvent', { kind: 'propDestroyed', data: { id: barrel.id, x: barrel.center.x, y: barrel.center.y, z: barrel.center.z }, from: 'p2' } );
	ok( barrel.state === 'broken' && sent.length === nSent && events.filter( ( x ) => x.n === 'propDestroyed' ).length === nEv, 'a remote propDestroyed breaks the same prop without re-broadcasting' );
	const groupsBefore = d.groups.length;
	features.emit( 'remoteWorldEvent', { kind: 'propDestroyed', data: { id: barrel.id }, from: 'p2', replay: true } );
	ok( d.groups.length === groupsBefore && sent.length === nSent, 'the same event replayed is a no-op' );
	const rack = d.props.find( ( p ) => p.kind === 'fishRack' && p.state === 'intact' );
	features.emit( 'remoteWorldEvent', { kind: 'propDestroyed', data: { id: rack.id }, from: 'server', replay: true } );
	ok( rack.state === 'broken' && ! d.groups.some( ( g ) => g.prop === rack ), 'a replay on join breaks it silently (no debris)' );
	features.emit( 'remoteWorldEvent', { kind: 'propRespawned', data: { id: barrel.id }, from: 'server' } );
	ok( barrel.state === 'intact' && barrel.colliders.length === 1 && ! d.groups.some( ( g ) => g.prop === barrel ), 'the server\'s propRespawned restores it' );

	// save round trip
	const save = JSON.parse( JSON.stringify( d.toJSON() ) );
	ok( save.broken.some( ( e ) => e[ 0 ] === crate.id ) && save.broken.some( ( e ) => e[ 0 ] === rack.id ), `the save lists the broken props (${ save.broken.length })` );
	const app2 = { ...app, colliders: new Colliders(), netsync: null };
	const f2 = new Features( app2 );
	f2.fromJSON( { destruction: save } );
	const d2 = f2.add( 'destruction', destruction );
	d2.build();
	ok( d2.byId.get( crate.id ).state === 'broken' && d2.byId.get( barrel.id ).state === 'intact' && app2.colliders.boxes.filter( ( b ) => b.tag === 'destructible' ).length === d2.props.length - save.broken.length, 'a loaded save keeps them broken (no colliders)' );
	d2.dispose();

	// respawn after a few in-game hours, never next to the player
	app.player.position.set( crate.center.x, 0, crate.center.z );
	d.hours += RESPAWN + 0.1;
	d._checkRespawns();
	ok( crate.state === 'broken', 'no respawn while the player stands there' );
	app.player.position.set( 0, 5, - 300 );
	d._checkRespawns();
	ok( crate.state === 'intact' && events.some( ( x ) => x.n === 'propRespawned' && x.e.id === crate.id ), `respawns after ${ RESPAWN } in-game hours once the player is away` );

	// fading: loose pieces go after about a minute
	const hut = d.props.find( ( p ) => p.kind === 'leanTo' );
	d.breakProp( hut.id, { energy: hut.K.toughness * 1.1, x: hut.center.x + hut.half.x, y: hut.center.y, z: hut.center.z } );
	for ( let i = 0; i < 70 * 60; i ++ ) features.update( 1 / 60 );
	const left = d.groups.reduce( ( n, g ) => n + g.items.filter( ( it ) => ! d._standing( it.body ) ).length, 0 );
	ok( left === 0, `loose debris faded away after a minute (${ d.info().loose } pieces of standing wrecks left)` );

	// sandbox: no timed respawn, reset() brings everything back
	app.mode = 'sandbox';
	const any = d.props.find( ( p ) => p.state === 'intact' && p.kind === 'crate' );
	d.breakProp( any.id );
	ok( d.broken.get( any.id ) === Infinity, 'sandbox: broken props wait for a reset' );
	features.reset();
	ok( d.props.every( ( p ) => p.state === 'intact' ) && d.groups.length === 0 && colliders.boxes.filter( ( b ) => b.tag === 'destructible' ).length === d.props.length, 'reset() restores every prop and its collider' );
	d.dispose();
	ok( colliders.boxes.filter( ( b ) => b.tag === 'destructible' ).length === 0, 'dispose() removes the colliders' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
