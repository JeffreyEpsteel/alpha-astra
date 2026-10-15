// Plain-node test of Meridian (wave 21A): the shared city plan (meridian/CityPlan.js: deterministic, roads connected, no
// building on a road, the Twins landmark / destructible), the terrain tile (MeridianTerrain: heights, shore, roads on
// the ground, the hill road's grade), the world entries (WORLD.meridian / ports / islands), the builder's handles (setStage,
// onStage, the Twins' rule, colliders), the signals, the port's vendors' premium, the townlife plan and the budgets.
//   node test/feature-meridian.mjs
import { WORLD } from '../src/world/WorldLayout.js';
import * as CP from '../src/world/islands/meridian/CityPlan.js';
import { MeridianTerrain, ensureMeridian } from '../src/world/islands/MeridianTerrain.js';
import { registerMeridian } from '../src/world/islands/meridian/World.js';
import { Meridian } from '../src/world/islands/meridian/Meridian.js';
import { meridianTownPlan } from '../src/world/islands/meridian/TownLife.js';
import { Colliders } from '../src/world/Colliders.js';
import { terrainTiles, heightAtlasLayout, buildHeightStrip, stripHeightAt, tileBeaches, mapExtent } from '../src/world/terrain/TerrainTiles.js';
import { ISLETS } from '../src/world/terrain/IslandShape.js';

let fails = 0, passes = 0;
const ok = ( c, msg, info = '' ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg, info ); } else { passes ++; console.log( 'ok  ', msg, info ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const { MERIDIAN, cityPlan, footprint } = CP;

// ---------------------------------------------------------------- the plan
section( 'the plan' );
const plan = cityPlan();
const again = JSON.stringify( CP.cityPlan( 2110 ) );
ok( again === JSON.stringify( plan ), 'cityPlan() is cached and the same per seed' );
// a fresh evaluation in a new module instance is identical (no state outside the seed)
const fresh = await import( '../src/world/islands/meridian/CityPlan.js?fresh=1' );
ok( JSON.stringify( fresh.cityPlan() ) === JSON.stringify( plan ), 'deterministic: a fresh module builds the same plan' );
ok( JSON.stringify( fresh.cityPlan( 7 ) ) !== JSON.stringify( plan ), 'another seed, another city' );
ok( MERIDIAN.id === 'meridian' && Math.hypot( MERIDIAN.center.x + 2700, MERIDIAN.center.z + 300 ) < 400, 'MERIDIAN centre near (-2700, -300)', JSON.stringify( MERIDIAN.center ) );
const kinds = new Set( [ 'tower', 'highrise', 'midrise', 'lowrise', 'shop', 'warehouse', 'station', 'landmark' ] );
ok( plan.buildings.length > 250, 'a city of buildings', plan.buildings.length );
ok( plan.buildings.every( ( b ) => kinds.has( b.kind ) && CP.STYLES.includes( b.style ) && b.w > 0 && b.d > 0 && b.h > 0 && b.floors >= 1 && Number.isFinite( b.y ) && b.block ), 'every building well formed (kind, style, size, floors, ground, block)' );
ok( new Set( plan.buildings.map( ( b ) => b.id ) ).size === plan.buildings.length, 'building ids unique' );
ok( plan.buildings.every( ( b ) => Math.abs( Math.round( b.yaw / ( Math.PI / 2 ) ) * ( Math.PI / 2 ) - b.yaw ) < 1e-9 ), 'yaws are quarter turns (axis-aligned footprints)' );
const towers = plan.buildings.filter( ( b ) => b.kind === 'tower' );
ok( towers.length === 2 && towers.every( ( t ) => t.landmark && t.collapsible && ! t.protected && t.h >= 280 && t.h <= 320 && t.w === t.d ), 'two square towers ~300 m: destructible landmarks' );
ok( towers[ 0 ].w === towers[ 1 ].w && towers[ 0 ].h === towers[ 1 ].h, 'the Twins are identical' );
const others = plan.buildings.filter( ( b ) => b.kind !== 'tower' );
ok( others.every( ( b ) => b.collapsible && ! b.protected ), 'every other building is destructible' );
ok( others.every( ( b ) => b.h < towers[ 0 ].h - 60 ), 'the Twins are the tallest by far', Math.max( ...others.map( ( b ) => b.h ) ) );
for ( const id of [ 'city-hall', 'station', 'lighthouse', 'fish-market', 'chandlery', 'roid-office', 'terminal', 'ferry-terminal', 'market-hall' ] ) ok( plan.buildings.some( ( b ) => b.id === id ), 'has ' + id );
// buildings do not overlap each other
let overlap = 0;
for ( let i = 0; i < plan.buildings.length; i ++ ) for ( let j = i + 1; j < plan.buildings.length; j ++ ) {

	const a = footprint( plan.buildings[ i ] ), b = footprint( plan.buildings[ j ] );
	if ( a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.z0 < b.z1 - 0.5 && b.z0 < a.z1 - 0.5 ) overlap ++;

}

ok( overlap === 0, 'no two buildings overlap', overlap );

section( 'roads' );
const { nodes, edges, byId } = plan.roads;
ok( nodes.length > 60 && edges.length > 100, 'a road graph', `${ nodes.length } nodes, ${ edges.length } edges` );
ok( edges.every( ( e ) => byId[ e.a ] && byId[ e.b ] && e.lanes >= 2 && e.width > 5 && e.speed > 5 && typeof e.oneWay === 'boolean' ), 'every edge joins two nodes, lanes / width / speed / oneWay' );
ok( new Set( edges.map( ( e ) => e.id ) ).size === edges.length && new Set( nodes.map( ( n ) => n.id ) ).size === nodes.length, 'ids unique' );
// connected: one component
const adj = new Map( nodes.map( ( n ) => [ n.id, [] ] ) );
for ( const e of edges ) { adj.get( e.a ).push( e.b ); adj.get( e.b ).push( e.a ); }
const seen = new Set( [ nodes[ 0 ].id ] ), stack = [ nodes[ 0 ].id ];
while ( stack.length ) for ( const n of adj.get( stack.pop() ) ) if ( ! seen.has( n ) ) { seen.add( n ); stack.push( n ); }
ok( seen.size === nodes.length, 'the road graph is connected', `${ seen.size } / ${ nodes.length }` );
ok( nodes.filter( ( n ) => n.signal ).length >= 8, 'traffic lights at the main junctions', nodes.filter( ( n ) => n.signal ).length );
// no building on a road (footprint vs the carriageway + sidewalk)
let onRoad = 0;
for ( const b of plan.buildings ) {

	const f = footprint( b );
	for ( const e of edges ) {

		const r = CP.edgeRect( plan, e, e.kind === 'hill' ? 0 : CP.SIDEWALK - 0.5 );
		// the closest point of the box to the segment
		const n = 12;
		for ( let k = 0; k <= n; k ++ ) {

			const x = r.ax + ( r.bx - r.ax ) * k / n, z = r.az + ( r.bz - r.az ) * k / n;
			const dx = Math.max( f.x0 - x, 0, x - f.x1 ), dz = Math.max( f.z0 - z, 0, z - f.z1 );
			if ( Math.hypot( dx, dz ) < r.half ) { onRoad ++; if ( onRoad < 4 ) console.log( '   on road', b.id, b.kind, e.id ); break; }

		}

	}

}

ok( onRoad === 0, 'no building stands on a road or its sidewalk', onRoad );
ok( plan.buildings.every( ( b ) => CP.coastDistance( b.x, b.z ) < 0 ), 'every building on land' );
ok( plan.parking.length > 200 && plan.parking.every( ( p ) => Number.isFinite( p.x ) && Number.isFinite( p.yaw ) && [ 'street', 'lot', 'garage' ].includes( p.kind ) ), 'parking (street bays, lots, garages)', plan.parking.length );
ok( plan.parking.some( ( p ) => p.kind === 'garage' ) && plan.parking.some( ( p ) => p.kind === 'lot' ), 'lots and garages for the cars' );
ok( plan.sidewalks.length > 100 && plan.plazas.some( ( p ) => p.id === 'twins' ) && plan.plazas.some( ( p ) => p.kind === 'park' ), 'sidewalks, the Twins plaza, the park' );
ok( plan.docks.some( ( d ) => d.kind === 'pier' && d.berth ) && plan.docks.some( ( d ) => d.kind === 'ferry' ), 'the pier (with its berth) and the ferry slip' );
ok( plan.airstrip && plan.airstrip.length >= 400, 'an airstrip on the reclaimed land', plan.airstrip.length );
// the signal cycle: never green both ways, both ways get green
let both = 0, gNS = 0, gEW = 0;
for ( let t = 0; t < 80; t += 0.25 ) {

	const a = CP.signalState( 'n3_2', 'ns', t ), b = CP.signalState( 'n3_2', 'ew', t );
	if ( a !== 'red' && b !== 'red' ) both ++;
	if ( a === 'green' ) gNS ++;
	if ( b === 'green' ) gEW ++;

}

ok( both === 0 && gNS > 0 && gEW > 0, 'signals: one axis at a time, each gets green' );

// ---------------------------------------------------------------- the terrain tile
section( 'the terrain tile' );
let t0 = Date.now();
const tile = new MeridianTerrain();
const tTile = Date.now() - t0;
ok( tTile < 4000, 'the tile builds quickly', tTile + ' ms' );
ok( tile.n === MERIDIAN.tile.n && tile.heights.length === tile.n * tile.n, 'the grid', tile.n );
ok( tile.x1 < - 1024 - 200, 'the tile lies beyond the heightmap (west of x -1024)', tile.x1 );
for ( const I of ISLETS ) {

	if ( ! Number.isFinite( I.x ) ) continue;
	ok( Math.hypot( I.x - MERIDIAN.center.x, I.z - MERIDIAN.center.z ) > 1000, 'clear of ' + I.id );

}

const C = MERIDIAN.center;
ok( tile.heightAt( C.x + 1000, C.z ) < - 40 && tile.heightAt( C.x, C.z - 900 ) < - 20, 'open sea round the island' );
ok( tile.heightAt( C.x, C.z ) > 2 && tile.heightAt( C.x, C.z ) < 12, 'the city plain above the sea', tile.heightAt( C.x, C.z ).toFixed( 2 ) );
// roads lie on the ground: every grid node's road height = the designed ground
let worst = 0;
for ( const n of nodes ) worst = Math.max( worst, Math.abs( tile.roadHeight( n.x, n.z ) - n.y ) );
ok( worst < 0.6, 'the road surface at every node matches the plan', worst.toFixed( 3 ) );
let grade = 0;
for ( const e of edges ) {

	const a = byId[ e.a ], b = byId[ e.b ], L = Math.hypot( b.x - a.x, b.z - a.z );
	for ( let s = 0; s + 4 <= L; s += 4 ) {

		const t1 = s / L, t2 = ( s + 4 ) / L;
		const h1 = tile.roadHeight( a.x + ( b.x - a.x ) * t1, a.z + ( b.z - a.z ) * t1 ), h2 = tile.roadHeight( a.x + ( b.x - a.x ) * t2, a.z + ( b.z - a.z ) * t2 );
		grade = Math.max( grade, Math.abs( h2 - h1 ) / 4 );

	}

}

ok( grade < 0.14, 'every road drivable (grade under 14 %)', ( grade * 100 ).toFixed( 1 ) + ' %' );
ok( plan.buildings.every( ( b ) => Math.abs( tile.heightAt( b.x, b.z ) - b.y ) < 1.5 ), 'every building stands on its ground' );
const pier = plan.docks.find( ( d ) => d.kind === 'pier' );
ok( tile.heightAt( pier.berth.x, pier.berth.z ) < - 5, 'deep water at the pier berth', tile.heightAt( pier.berth.x, pier.berth.z ).toFixed( 1 ) );
ok( tile.heightAt( plan.airstrip.x, plan.airstrip.z ) > 2 && Math.abs( tile.heightAt( plan.airstrip.x - 200, plan.airstrip.z ) - tile.heightAt( plan.airstrip.x + 200, plan.airstrip.z ) ) < 0.2, 'the runway level and dry' );
ok( tile.maskAt( C.x, C.z ).path > 0.9 && tile.pathDistance( C.x, C.z ) < 0, 'the city counts as path (no grass, no scattered trees)' );
const park = plan.plazas.find( ( p ) => p.id === 'park' );
ok( tile.maskAt( park.x + 20, park.z + 30 ).paved === 0, 'the park is grass' );

section( 'the tile in the world' );
const fakeTerrain = { size: 2048, res: 4, origin: - 1024, heightAt: () => - 90, coastDistance: () => ( { d: 1e4, beachZone: 0 } ), islandAt: () => 'main', pathDistance: () => 99 };
const att = ensureMeridian( fakeTerrain );
ok( att && fakeTerrain.heightAt( C.x, C.z ) > 2 && fakeTerrain.islandAt( C.x, C.z ) === 'meridian', 'attached: the terrain answers for Meridian' );
ok( ensureMeridian( fakeTerrain ) === att, 'ensureMeridian is idempotent' );
const layout = heightAtlasLayout( fakeTerrain ), strip = buildHeightStrip( layout );
ok( Math.abs( stripHeightAt( layout, strip, C.x + 13, C.z - 7 ) - att.heightAt( C.x + 13, C.z - 7 ) ) < 1e-3, 'the GPU height strip reads the tile' );
const beaches = tileBeaches( fakeTerrain );
ok( beaches.some( ( b ) => b.tile === 'meridian' && b.length > 200 ), 'beaches on the south shore (the surf)', beaches.map( ( b ) => Math.round( b.length ) ).join( ',' ) );
const ext = mapExtent( fakeTerrain );
ok( ext.x0 < MERIDIAN.tile.x0, 'the world map covers it' );
registerMeridian( WORLD );
registerMeridian( WORLD );
const port = WORLD.ports.filter( ( p ) => p.id === 'meridian' );
ok( port.length === 1 && WORLD.islands.filter( ( i ) => i.id === 'meridian' ).length === 1, 'one port and one island entry (registration idempotent)' );
const P0 = port[ 0 ];
ok( P0.dock && P0.dock.start && P0.dock.end && P0.dock.position && Number.isFinite( P0.dock.heading ) && P0.approach.length > 3, 'the port entry: dock, approach' );
ok( WORLD.meridian.airstrip && WORLD.meridian.airstrip.pad && Number.isFinite( WORLD.meridian.airstrip.heading ), 'WORLD.meridian.airstrip (the seaplane strips shape)' );
const home = WORLD.ports.find( ( p ) => p.id === 'home' );
const dHome = Math.hypot( P0.dock.position.x - home.dock.position.x, P0.dock.position.z - home.dock.position.z );
ok( dHome > 1800 && dHome < 3200, 'a real voyage from home', Math.round( dHome ) + ' m' );
for ( const [ x, z ] of P0.approach ) if ( Math.abs( x ) > 1100 ) ok( att.heightAt( x, z ) < - 3, `approach waypoint (${ x }, ${ z }) at sea` );

// ---------------------------------------------------------------- the builder
section( 'the builder' );
const colliders = new Colliders();
globalThis.__quietKit = true;
t0 = Date.now();
const city = new Meridian( { scene: null, terrain: fakeTerrain, colliders, kit: false } );
ok( Date.now() - t0 < 5000, 'builds', ( Date.now() - t0 ) + ' ms' );
ok( city.plan === plan && city.buildings().length === plan.buildings.length, 'a handle per building' );
const hT = city.building( 'twin-north' );
ok( hT.landmark && hT.collapsible && ! hT.protected && hT.fireAnchors.length > 0, 'the Twins: destructible landmarks with fire anchors' );
const calls = [];
city.onStage = ( id, s ) => calls.push( [ id, s ] );
ok( hT.setStage( 3 ) === 3 && hT.stage === 3, 'the Twins can collapse (stage 3)', hT.stage );
ok( hT.colliders.length && hT.colliders[ 0 ].top <= hT.plan.y + 4, 'the collapsed Twins lose their high collider' );
hT.setStage( 0 );
city.flush();
const lr = city.buildings().find( ( h ) => h.kind === 'lowrise' );
const top0 = lr.colliders[ 0 ].top;
ok( lr.setStage( 3 ) === 3 && calls.some( ( c ) => c[ 0 ] === lr.id && c[ 1 ] === 3 ), 'setStage calls meridian.onStage( id, stage )' );
ok( lr.colliders[ 0 ].top < top0 - 2, 'a collapsed building\'s collider drops to its stump' );
ok( city.flush() === 1, 'the stage change rebuilds one chunk' );
lr.setStage( 0 );
ok( lr.colliders[ 0 ].top === top0, 'restored' );
ok( lr.fireAnchors.length >= 3 && lr.bounds.max.y > lr.bounds.min.y, 'fire anchors and bounds' );
const g = lr.group;
ok( g && g.position.x === lr.plan.x && lr.group === g, 'the group is made on first use, at the building\'s foot' );
ok( Math.abs( city.roadHeight( byId.n3_3.x, byId.n3_3.z ) - byId.n3_3.y ) < 0.3, 'roadHeight' );
ok( [ 'green', 'yellow', 'red' ].includes( city.signalState( 'n3_2', 'ns' ) ), 'signalState' );
ok( city.seats.length > 20 && city.homes.length > 50, 'townlife seats and homes', `${ city.seats.length } seats, ${ city.homes.length } homes` );

section( 'budgets' );
const S = city.stats;
console.log( '   ', JSON.stringify( S ) );
ok( S.blocksFar < 8000 && S.chunks <= 20, 'the far skyline: tiers only, a draw per chunk', `${ S.blocksFar } triangles, ${ S.chunks } chunks` );
ok( S.blocksNear < 40000, 'the near blocks', S.blocksNear );
ok( S.streets < 60000, 'the streets', S.streets );
ok( S.landNear < 120000 && S.landFar < 20000, 'the land', `${ S.landNear } near, ${ S.landFar } far` );
ok( S.lights < 400, 'lights (LocalLights draws the nearest 16)', S.lights );
const bytes = tile.heights.byteLength;
ok( bytes < 1.2 * 1048576, 'the GPU height strip grows under 1.2 MB', ( bytes / 1048576 ).toFixed( 2 ) + ' MB' );
let geo = 0;
city.group.traverse( ( o ) => { if ( o.geometry ) for ( const k in o.geometry.attributes ) geo += o.geometry.attributes[ k ].array.byteLength; if ( o.geometry && o.geometry.index ) geo += o.geometry.index.array.byteLength; } );
ok( geo < 40 * 1048576, 'the city\'s vertex / index buffers (desktop, before phone cuts)', ( geo / 1048576 ).toFixed( 1 ) + ' MB' );
globalThis.__phoneBudget = { nearRelease: true };
const phoneCity = new Meridian( { scene: null, terrain: fakeTerrain, colliders: null, kit: false } );
let pgeo = 0;
phoneCity.group.traverse( ( o ) => { if ( o.geometry ) for ( const k in o.geometry.attributes ) pgeo += o.geometry.attributes[ k ].array.byteLength; if ( o.geometry && o.geometry.index ) pgeo += o.geometry.index.array.byteLength; } );
ok( pgeo < geo && pgeo < 15 * 1048576, 'phones: within the +15 MB a worker may add', ( pgeo / 1048576 ).toFixed( 1 ) + ' MB' );
ok( phoneCity.release.enabled, 'phones: the near meshes release their buffers when far' );
delete globalThis.__phoneBudget;

section( 'the port and townlife' );
const tl = meridianTownPlan();
ok( tl.id === 'meridian' && tl.port === 'meridian' && tl.grid.u1 - tl.grid.u0 < 400 && tl.grid.v1 - tl.grid.v0 < 450, 'the townlife quarter (a grid the size of Tidemark\'s)', `${ tl.grid.u1 - tl.grid.u0 } x ${ tl.grid.v1 - tl.grid.v0 }` );
ok( tl.homes.length > 5 && tl.stalls.length === 3 && tl.hall.queue.length === 5 && tl.tavern && tl.tavern.door, 'homes, stalls, the fish market queue, a bar' );
let MP = null;
try { MP = await import( '../src/world/islands/meridian/MeridianPort.js' ); } catch ( e ) { console.log( '   (MeridianPort needs the vendor\'s engine imports:', e.message, ')' ); }
if ( MP ) {

	const mp = new MP.MeridianPort( { scene: null, terrain: att, colliders: null } );
	const fish = [ { species: 'tuna', value: 100 }, { species: 'mullet', value: 40 } ];
	ok( mp.vendors.length === 2 && mp.market.priceFor( fish[ 0 ] ) === 125 && mp.market.priceFor( fish[ 1 ] ) === 40 && mp.market.premiumBonus( fish ) === 25, 'the fish market pays 25 % more for big game fish' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
