import { Vector3, Color } from '../../../engine/index.js';
import { box, cylinder, sphere, mat4 } from '../../boat/GeoKit.js';
import { PAT } from '../../../game/GameMaterials.js';
import { TIDEMARK as I, tidemarkWorld } from '../../terrain/IslandShape.js';
import { buildJetty } from '../Jetty.js';
import { WOOD, WOODX, STONE, PAINT, frameAt } from '../IslandKit.js';
import { FACE, SPOTS } from './Layout.js';

// Tidemark's waterfront: the stone quay (a dressed-stone block along the town terrace, its top a walkable 2.45 m), the
// stone pier out into the bay (deck 2.6 m on stone piers, kerbs, bollards, a lantern at the head; the berth alongside its
// head is WORLD.tidemark.dock), the timber wharf in front of the quay's south end, the market booth of the trade cell and
// the well's stone base (its roof is a breakable prop). Static geometry into `add`; colliders; returns the lights.
//
//   const wf = buildWaterfront( { terrain, add, colliders } )   wf.lights   wf.pierTop   wf.quayTop   wf.seats
//   STREET (the street furniture the town kit draws), tidemarkSeats( terrain ) (the benches' places, for the residents)

export const QUAY_TOP = 2.45;
const QUAY = { u0: - 166, u1: - 158, v0: - 82, v1: 70 };

// The street furniture (wave 18C; island coordinates u, v; yawOff from FACE: 0 = the piece's front toward the bay). The
// town kit (village/TownKit.js) draws them, Buildings.js places them; the lamp lights and the seats are plain data here.
//   lamps     iron street lamps along the quay and the back lane (light: a LocalLights lantern at night)
//   benches   park benches round the square and along the quay (18B seats people on them: tidemarkSeats())
//   planters  half-barrel tubs with flowers; fountain: the square's fountain (a collider); netracks: nets drying
export const STREET = {
	lamps: [
		{ u: - 152, v: - 30, light: true }, { u: - 152, v: 30, light: true }, { u: - 154, v: 13.5, light: true },
		{ u: - 152, v: - 72, light: false }, { u: - 152, v: 58, light: false },
		{ u: - 105, v: - 45, light: true }, { u: - 105, v: 45, light: true }, { u: - 105, v: - 12, light: false },
	],
	benches: [
		{ u: - 118, v: - 8, yawOff: 0 }, { u: - 108, v: 12, yawOff: Math.PI / 2 }, { u: - 128, v: 24, yawOff: Math.PI },
		{ u: - 153, v: - 52, yawOff: 0 }, { u: - 153, v: - 12, yawOff: 0 }, { u: - 153, v: 24, yawOff: 0 }, { u: - 153, v: 45, yawOff: 0 },
	],
	planters: [ { u: - 152, v: - 40 }, { u: - 152, v: - 19 }, { u: - 152, v: 18 }, { u: - 130, v: - 9.5 }, { u: - 108.5, v: - 9 } ],
	fountain: { u: - 121, v: 0, r: 2.55 },
	netracks: [ { u: - 151, v: - 56, yawOff: 0 }, { u: - 146, v: - 86, yawOff: 0 } ],
};

// where people can sit: two places per bench, { id, x, y (the seat), z, yaw (the way a sitter faces) }
export function tidemarkSeats( terrain ) {

	const out = [];
	STREET.benches.forEach( ( b, i ) => {

		const Fb = F( terrain, b.u, b.v, b.yawOff );
		for ( const [ k, lx ] of [ [ 'a', - 0.45 ], [ 'b', 0.45 ] ] ) {

			const [ x, z ] = Fb.world( lx, 0.05 );
			out.push( { id: `tidemark.bench.${ i }.${ k }`, x, y: Fb.y + 0.46, z, yaw: Fb.yaw } );

		}

	} );
	return out;

}

const F = ( terrain, u, v, yawOff = 0, y = null ) => {

	const [ x, z ] = tidemarkWorld( u, v );
	return frameAt( x, y ?? terrain.heightAt( x, z ), z, FACE + yawOff );

};

export function buildWaterfront( { terrain, add, colliders = null } ) {

	const lights = [];
	const rnd = seeded( 7311 );

	// ---- the stone quay: dressed blocks in 8 m courses, coping stones on top, iron rings and fenders on the face
	const len = QUAY.v1 - QUAY.v0, uc = ( QUAY.u0 + QUAY.u1 ) / 2, depth = QUAY.u1 - QUAY.u0;
	for ( let v = QUAY.v0; v < QUAY.v1 - 0.1; v += 8 ) {

		const seg = Math.min( 8, QUAY.v1 - v ), Q = F( terrain, uc, v + seg / 2, 0, 0 );
		const tone = [ 0x8f877a, 0x9a9285, 0x857e72, 0x938b7e ][ Math.floor( rnd() * 4 ) ];
		add( box( seg - 0.04, QUAY_TOP + 2.2, depth ), { ...STONE( tone ), matrix: Q.m( 0, ( QUAY_TOP - 2.2 ) / 2, 0 ) } );
		add( box( seg - 0.02, 0.22, 1.0 ), { ...STONE( 0xb3aa98 ), matrix: Q.m( 0, QUAY_TOP + 0.02, depth / 2 - 0.5 ) } );
		// a fender pile and a mooring ring on the face
		add( box( 0.28, 2.6, 0.28 ), { ...WOOD( 0x4b4034 ), matrix: Q.m( 0, QUAY_TOP - 1.3, depth / 2 + 0.16 ) } );
		add( cylinder( 0.12, 0.12, 0.04, 10 ), { color: 0x2b2e31, rough: 0.5, metal: 0.8, matrix: Q.m( 1.6, QUAY_TOP - 0.5, depth / 2 + 0.03, Math.PI / 2, 0, 0 ) } );

	}

	if ( colliders ) {

		const Q = F( terrain, uc, ( QUAY.v0 + QUAY.v1 ) / 2, 0, 0 );
		colliders.addBox( new Vector3( Q.x, ( QUAY_TOP - 2.2 ) / 2, Q.z ), new Vector3( len / 2, ( QUAY_TOP + 2.2 ) / 2, depth / 2 ), FACE, { walkable: true, tag: 'tidemarkQuay' } );

	}

	// ---- the stone pier: deck slabs on stone piers every 8 m, kerbs, bollards, steps down to the water, the head lantern
	const P = I.pier, top = P.deck, hw = P.width / 2;
	const plen = P.u0 - P.u1;
	for ( let s = 0; s < plen; s += 4 ) {

		const D = F( terrain, P.u0 - s - 2, P.v, 0, 0 );
		add( box( P.width, 0.45, 4.0 - 0.03 ), { ...STONE( [ 0xa39b8c, 0x9a9283, 0xaaa293 ][ Math.floor( rnd() * 3 ) ] ), matrix: D.m( 0, top - 0.225, 0 ) } );
		for ( const sx of [ - 1, 1 ] ) add( box( 0.3, 0.2, 4.0 - 0.03 ), { ...STONE( 0x857e72 ), matrix: D.m( sx * ( hw - 0.15 ), top + 0.1, 0 ) } );

	}

	for ( let s = 8; s <= plen; s += 8 ) {

		const D = F( terrain, P.u0 - s, P.v, 0, 0 );
		const g = Math.min( terrain.heightAt( D.x, D.z ), top - 1 );
		const h = top - 0.45 - ( g - 0.6 );
		add( box( P.width - 0.4, h, 1.6 ), { ...STONE( 0x7b746a ), matrix: D.m( 0, g - 0.6 + h / 2, 0 ) } );
		if ( colliders ) colliders.addBox( new Vector3( D.x, g - 0.6 + h / 2, D.z ), new Vector3( hw - 0.2, h / 2, 0.8 ), D.yaw, { tag: 'tidemarkPierPier' } );

	}

	for ( let s = 6; s < plen; s += 10 ) for ( const sx of [ - 1, 1 ] ) {

		const D = F( terrain, P.u0 - s, P.v, 0, 0 );
		add( cylinder( 0.13, 0.16, 0.45, 10 ), { color: 0x2b2e31, rough: 0.5, metal: 0.7, matrix: D.m( sx * ( hw - 0.35 ), top + 0.42, 0 ) } );
		add( sphere( 0.15, 10, 6 ), { color: 0x2b2e31, rough: 0.5, metal: 0.7, matrix: D.m( sx * ( hw - 0.35 ), top + 0.66, 0 ) } );

	}

	// steps down the berth side near the head (to a boat alongside)
	for ( let k = 0; k < 4; k ++ ) {

		const D = F( terrain, P.u1 + 6 - k * 0.45, P.v + hw + 0.5, 0, 0 );
		add( box( 0.9, 0.2, 1.4 ), { ...STONE( 0x8f877a ), matrix: D.m( 0, top - 0.45 - k * 0.55, 0, 0, Math.PI / 2, 0 ) } );

	}

	{

		const L = F( terrain, P.u1 + 1.2, P.v - hw + 0.4, 0, 0 );
		add( box( 0.14, 3.2, 0.14 ), { ...PAINT( 0x2b2e31, { metal: 0.5 } ), matrix: L.m( 0, top + 1.6, 0 ) } );
		add( box( 0.06, 0.06, 0.6 ), { ...PAINT( 0x2b2e31, { metal: 0.5 } ), matrix: L.m( 0, top + 3.1, 0.25 ) } );
		const [ x, z ] = L.world( 0, 0.5 );
		add( cylinder( 0.1, 0.1, 0.32, 8 ), { color: 0xffd9a0, rough: 0.2, matrix: mat4( x, top + 2.85, z ) } );
		lights.push( { position: new Vector3( x, top + 2.85, z ), color: new Color( 1.0, 0.72, 0.42 ), intensity: 8, range: 13, kind: 'lantern', flicker: 0.08 } );

	}

	if ( colliders ) {

		const D = F( terrain, ( P.u0 + P.u1 ) / 2, P.v, 0, 0 );
		colliders.addBox( new Vector3( D.x, top - 0.225, D.z ), new Vector3( hw, 0.225, plen / 2 ), D.yaw, { walkable: true, tag: 'tidemarkPier' } );

	}

	// ---- the timber wharf in front of the quay's south end (boards across, piles at its edges)
	{

		const Q = I.quay, um = ( Q.u0 + Q.u1 ) / 2 - 8;
		const [ sx, sz ] = tidemarkWorld( um, Q.v0 ), [ ex, ez ] = tidemarkWorld( um, Q.v1 );
		const D = { start: new Vector3( sx, 0, sz ), end: new Vector3( ex, 0, ez ), heading: Math.atan2( ex - sx, ez - sz ), deckHeight: Q.deck, width: 8 };
		buildJetty( { D, terrain, add, colliders, tag: 'tidemarkWharf', crates: false, seed: 57, lanterns: 0 } );

	}

	// ---- the market booth (the trade cell's counter), the well's stone base, benches round the square
	{

		const M = F( terrain, - 124, 18 + 1.6 );
		add( box( 3.0, 0.95, 0.8 ), { ...WOODX( 0x8e7e68 ), matrix: M.m( 0, 0.48, 0 ) } );
		add( box( 3.2, 0.06, 1.0 ), { ...WOODX( 0x75664f ), matrix: M.m( 0, 0.98, 0 ) } );
		for ( const x of [ - 1.5, 1.5 ] ) for ( const z of [ - 0.9, 0.5 ] ) add( box( 0.1, 2.4, 0.1 ), { ...WOOD( 0x6e5f4c ), matrix: M.m( x, 1.2, z ) } );
		for ( let i = 0; i < 6; i ++ ) add( box( 3.4 / 6, 0.05, 2.0 ), { color: i % 2 ? 0xe9e6dd : 0x2f6a5a, rough: 0.95, pattern: PAT.cloth, matrix: M.m( - 1.7 + ( i + 0.5 ) * 3.4 / 6, 2.45, - 0.2, 0.1, 0, 0 ) } );
		add( box( 1.6, 0.4, 0.04 ), { ...PAINT( 0xe9e6dd ), matrix: M.m( 0, 2.1, 0.56 ) } );
		add( box( 1.3, 0.12, 0.02 ), { ...PAINT( 0x2b3a44 ), matrix: M.m( 0, 2.1, 0.585 ) } );
		for ( let i = 0; i < 4; i ++ ) add( box( 0.4, 0.3, 0.32 ), { color: [ 0xb5642f, 0xe9e4d4, 0xc9a86a, 0x8a6a43 ][ i ], rough: 0.8, pattern: PAT.cloth, matrix: M.m( - 1.1 + i * 0.72, 1.16, - 0.1 ) } );
		if ( colliders ) colliders.addBox( new Vector3( M.x, M.y + 0.5, M.z ), new Vector3( 1.6, 0.5, 0.5 ), M.yaw, { tag: 'tidemarkBooth' } );

	}

	{

		const W = SPOTS.well, y = terrain.heightAt( W.x, W.z );
		add( cylinder( 1.05, 1.15, 0.8, 16 ), { ...STONE( 0x8a8378 ), matrix: mat4( W.x, y + 0.4, W.z ) } );
		add( cylinder( 0.85, 0.85, 0.05, 16 ), { color: 0x24343a, rough: 0.1, matrix: mat4( W.x, y + 0.72, W.z ) } );
		if ( colliders ) colliders.addCylinder( W.x, W.z, 1.15, y - 0.3, y + 0.85, { tag: 'tidemarkWell' } );

	}

	// the fountain's basin (the kit draws it): a low collider
	{

		const [ x, z ] = tidemarkWorld( STREET.fountain.u, STREET.fountain.v ), y = terrain.heightAt( x, z );
		if ( colliders ) colliders.addCylinder( x, z, STREET.fountain.r, y - 0.3, y + 0.62, { tag: 'tidemarkFountain' } );

	}

	// (the benches round the square and along the quay are the town kit's: STREET.benches, placed by Buildings.js)

	// the street lamps' lights (their iron posts are the town kit's; a light only on the ones that matter at night)
	for ( const L of STREET.lamps ) {

		if ( ! L.light ) continue;
		const [ x, z ] = tidemarkWorld( L.u, L.v );
		const y = terrain.heightAt( x, z ) + 3.55;
		lights.push( { position: new Vector3( x, y, z ), color: new Color( 1.0, 0.74, 0.44 ), intensity: 9, range: 15, kind: 'lantern', flicker: 0.03 } );

	}

	// the tavern's lantern by its door (the town's one evening light that matters besides the pier head)
	{

		const T = SPOTS.tavernLamp, y = terrain.heightAt( T.x, T.z );
		add( box( 0.1, 2.6, 0.1 ), { ...WOOD( 0x4a3c30 ), matrix: mat4( T.x, y + 1.3, T.z ) } );
		add( cylinder( 0.09, 0.09, 0.28, 8 ), { color: 0xffd9a0, rough: 0.2, matrix: mat4( T.x, y + 2.45, T.z ) } );
		lights.push( { position: new Vector3( T.x, y + 2.45, T.z ), color: new Color( 1.0, 0.7, 0.4 ), intensity: 8.5, range: 14, kind: 'lantern', flicker: 0.1 } );

	}

	return { lights, pierTop: top, quayTop: QUAY_TOP, seats: tidemarkSeats( terrain ) };

}

function seeded( seed ) {

	let s = seed;
	return () => ( ( s = ( s * 16807 ) % 2147483647 ) / 2147483647 );

}
