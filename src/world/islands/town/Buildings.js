import { Mesh, Vector3, Color, BufferGeometry, Float32BufferAttribute } from '../../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, mat4 } from '../../boat/GeoKit.js';
import { PAT } from '../../../game/GameMaterials.js';
import { mulberry32 } from '../../../util/Noise.js';
import { Builder, Batch, gridPart } from '../../village/GeoBuilder.js';
import { buildHouse } from '../../village/Buildings.js';
import { TownKit, createGlowMaterial, lodSwitch } from '../../village/TownKit.js';
import { InstancedProps, Rand, lin, laundryLine } from '../../Props.js';
import { WOOD, WOODX, STONE, PAINT, frameAt, cottage } from '../IslandKit.js';
import { tidemarkWorld } from '../../terrain/IslandShape.js';
import { BUILDINGS, EXTRA, FACE, at } from './Layout.js';
import { STREET } from './Waterfront.js';
import { DOOR } from '../../interiors/Rooms.js';

// Tidemark's building shells: the fishermen's houses, the chandlery, the tavern and the harbourmaster's hut are the home
// village's own houses (village/Buildings.js buildHouse, its baked PBR materials) when the Village is passed in, plain
// GeoKit cottages otherwise; the warehouse (the fish hall), the chapel with its belfry, the boatyard shed, the airstrip's
// hangar and the hilltop lookout are GeoKit (merged prop meshes). Shells take damage decals at most (Damage.js), never
// collapse.
//
// Wave 18C (the town looks like a place): fifteen more houses fill the rows (FILLERS: the front row's gaps, the back row,
// a third row up the slope); the quay, the square, the back lane and the market street are cobbled (the village stone
// material, metre uvs) with kerbs; the town kit (village/TownKit.js, public/models/town/kit.glb from tools/town/kit.py)
// hangs the name boards (the Tide & Tankard, Marlow's chandlery, the fish hall, the harbourmaster), projecting signs,
// window boxes, an awning, and stands the street lamps, benches, planters, the fountain and the net racks
// (Waterfront.js STREET); the fish hall's and the chapel's windows light up at night (the kit's glow mesh, a per-window
// mask). Two blocks (south / north of the market street) each draw near meshes within LOD.desktop m of their centre (60 m
// on phones) and one merged far mesh beyond.
//
//   const shells = buildShells( { terrain, colliders, village, propMaterial } )
//   shells.meshes (add to a group: the paving (the kit's anchor), the blocks' near and far meshes, the hangar),
//   shells.far (the lookout: a landmark), shells.list [ { id, kind, name, x, z, yaw, w, d, floorY, top, block } ],
//   shells.lamp (the lookout's lamp position), shells.kit (TownKit: kit.ready resolves once the GLB is merged in),
//   shells.blocks [ { id, x, z, ids } ], shells.stats { near, far, paving, kitPlacements }
//   (wave 19E) the tavern, the chandlery and the harbourmaster's hut open (INTERIOR_OF: their list entries' `interior`): the
//   village house cuts the doorway and registers its shell for src/world/interiors

const PASTEL = [ lin( 0x7fc8c0 ), lin( 0xf0a890 ), lin( 0xf2e2b8 ), lin( 0x9cc8e4 ), lin( 0xf4d27a ), lin( 0xb8e0c4 ), lin( 0xe8c0d4 ) ];
const TRIM = { white: lin( 0xf2efe6 ), cream: lin( 0xe8dcc0 ), navy: lin( 0x2e4f73 ), teal: lin( 0x2d7f7a ), red: lin( 0xa8463a ), green: lin( 0x4c7d4c ) };
const ROOF = { red: lin( 0xa64a35 ), green: lin( 0x5f8a6a ), blue: lin( 0x4f7898 ), teal: lin( 0x3f8a86 ), rust: lin( 0x8a5a40 ), grey: lin( 0x8c9296 ) };
const THATCH = lin( 0xa08a5a );

// near / far switch distance from a block's centre (m): phones go to the far meshes past 60 m (the brief's budget)
export const LOD = { desktop: 320, phone: 60 };
const KIT_CULL = { desktop: 520, phone: 110 }; // the kit's dressing (plus the town's radius, below)
const TOWN_R = 130;

// the infill houses (wave 18C): the same village houses, in the rows' gaps and a third row at the foot of the slope behind the back
// row's gardens; kept off the streets, the square, the paths, the breakable props and the street palms (test/feature-citylooks.mjs)
const FB = ( id, name, u, v, w, d, stories ) => ( { id, kind: 'house', name, u, v, w, d, stories, filler: true, ...at( u, v ), yaw: FACE } );
export const FILLERS = [
	FB( 'row1', 'Sailmaker\'s house', - 120, - 30.5, 5, 6, 2 ),
	FB( 'row2', 'Baker\'s house', - 121, 48.5, 5, 6, 2 ),
	FB( 'row3', 'Ropewalk cottage', - 121, - 77, 5, 5.5, 1 ),
	FB( 'row4', 'Lamplighter\'s cottage', - 121, 66, 5, 5, 1 ),
	FB( 'row5', 'Clerk\'s house', - 94, - 50, 5, 5, 2 ),
	FB( 'row6', 'Cooper\'s yard cottage', - 94, - 30, 5, 5, 1 ),
	FB( 'row7', 'Schoolhouse', - 94, - 8, 6, 5, 1 ),
	FB( 'row8', 'Weaver\'s house', - 94, 20, 5, 5, 2 ),
	FB( 'row9', 'Mender\'s cottage', - 94, 43.5, 5, 5, 1 ),
	FB( 'row10', 'Smokehouse cottage', - 79.5, - 62, 6, 4.5, 1 ),
	FB( 'row11', 'Shipwright\'s house', - 79.5, - 44, 5, 4.5, 2 ),
	FB( 'row12', 'Carter\'s cottage', - 79.5, - 26, 5, 4.5, 1 ),
	FB( 'row13', 'Midwife\'s house', - 79.5, 18, 6, 4.5, 1 ),
	FB( 'row14', 'Chandler\'s clerk\'s house', - 79.5, 52, 5, 4.5, 2 ),
	FB( 'row15', 'Hilltop cottage', - 79.5, 66, 5, 4.5, 1 ),
];

// the cobbled ground (island rects u0, u1, v0, v1; they do not overlap): the quay promenade, the square with the back
// lane's middle, the back lane north and south, the market street up to the road
export const PAVING = [
	[ - 157.6, - 125, - 80, 69 ],
	[ - 125, - 101.5, - 9, 25 ],
	[ - 108.5, - 101.5, - 72, - 9 ],
	[ - 108.5, - 101.5, 25, 64 ],
	[ - 101.5, - 84, 5.5, 10.5 ],
];

// the two blocks south and north of the market street (v = 8); the hangar and the lookout stand apart
const blockOf = ( b ) => ( b.v < 8 ? 'south' : 'north' );

// the village house spec of a town building (village/Buildings.js buildHouse fields)
function houseSpec( b, rand ) {

	const base = { name: b.id, x: b.x, z: b.z, yaw: b.yaw, w: b.w, d: b.d, curtain: rand.pick( [ lin( 0xe8d6b0 ), lin( 0xd98c7a ), lin( 0x9cc0d8 ) ] ), foundation: 'stone', stoneStyle: 1 };
	switch ( b.id ) {

		case 'tavern': return { ...base, stories: 2, roof: 'gable', roofMat: 'metal', roofColor: ROOF.red, wall: lin( 0xd9b38c ), trim: TRIM.cream, accent: TRIM.green, siding: 2, porch: { depth: 2.4, rail: 'balusters' }, paint: 0.6, chimney: 1, doorGlass: true, antenna: false };
		case 'chandler': return { ...base, stories: 2, roof: 'gableFront', roofMat: 'metal', galv: true, rust: 0.4, wall: lin( 0x9fc1c9 ), trim: TRIM.white, accent: TRIM.navy, siding: 1, porch: { depth: 2.0, rail: 'x' }, paint: 0.7, doorGlass: true };
		case 'office': return { ...base, roof: 'hip', roofMat: 'metal', roofColor: ROOF.blue, wall: TRIM.white, trim: TRIM.navy, accent: TRIM.navy, siding: 1, paint: 0.75, fewWindows: true };
		default: {

			const k = b.id.charCodeAt( b.id.length - 1 ) % PASTEL.length;
			return { ...base, stories: b.stories, roof: rand.pick( [ 'gable', 'hip', 'gableFront' ] ), roofMat: rand.chance( 0.35 ) ? 'thatch' : 'metal', thatchAge: 0.4, roofColor: rand.pick( Object.values( ROOF ) ),
				wall: PASTEL[ k ], trim: TRIM.white, accent: rand.pick( [ TRIM.navy, TRIM.teal, TRIM.red, TRIM.green ] ), siding: 1 + ( k % 2 ), paint: 0.55 + rand.next() * 0.2,
				porch: rand.chance( 0.5 ) ? { depth: 1.8, rail: rand.pick( [ 'x', 'balusters' ] ) } : null, shutters: rand.pick( [ 'board', 'bahama', 'louver' ] ), buoys: rand.chance( 0.4 ) ? 1 : 0 };

		}

	}

}

// the infill houses' specs (their own random stream: the original twelve keep their looks); no porches (they stand in
// narrow gaps), metal or thatch roofs, the town's pastels
function fillerSpec( b, rand ) {

	const k = ( b.id.length * 7 + b.id.charCodeAt( b.id.length - 1 ) ) % PASTEL.length;
	const thatch = b.u > - 80 && rand.chance( 0.5 ); // the third row up the slope: older, thatched
	return { name: b.id, x: b.x, z: b.z, yaw: b.yaw, w: b.w, d: b.d, stories: b.stories, foundation: 'stone', stoneStyle: rand.chance( 0.5 ) ? 1 : 0,
		curtain: rand.pick( [ lin( 0xe8d6b0 ), lin( 0xd98c7a ), lin( 0x9cc0d8 ), lin( 0xf0e8d8 ) ] ),
		roof: rand.pick( [ 'gable', 'gable', 'hip', 'gableFront' ] ), roofMat: thatch ? 'thatch' : 'metal', thatchAge: 0.5, roofColor: rand.pick( Object.values( ROOF ) ),
		wall: PASTEL[ k ], trim: TRIM.white, accent: rand.pick( [ TRIM.navy, TRIM.teal, TRIM.red, TRIM.green ] ), siding: 1 + ( k % 2 ), paint: 0.5 + rand.next() * 0.25,
		porch: null, shutters: rand.pick( [ 'board', 'louver', 'louver' ] ), chimney: rand.chance( 0.5 ) ? 1 : 0, litChance: 0.65 };

}

const HOUSE_KINDS = new Set( [ 'house', 'tavern', 'chandler' ] );

// wave 19E: the shells whose door opens into an interior (src/world/interiors/Rooms.js INTERIORS; the village houses only:
// the GeoKit stand-in cottages stay shut)
export const INTERIOR_OF = { tavern: 'tidemark.tavern', chandler: 'tidemark.chandler', office: 'tidemark.office' };

// the name boards and projecting signs on the village houses: piece, the height over the floor (in storeys + m), scale
const SIGNS = {
	tavern: [ { piece: 'sign_tavern', y: [ 1, 0.42 ], x: 0, scale: 0.82 }, { piece: 'hang_tavern', y: [ 1, 1.15 ], x: 'corner' } ],
	chandler: [ { piece: 'sign_chandler', y: [ 1, 0.42 ], x: 0, scale: 0.8 }, { piece: 'hang_chandler', y: [ 1, 1.15 ], x: 'corner' } ],
	office: [ { piece: 'sign_harbour', y: [ 1, - 0.3 ], x: 0, scale: 0.95 } ],
};

export function buildShells( { terrain, colliders, village = null, propMaterial } ) {

	const phone = !! globalThis.__phoneBudget;
	const list = [];
	const meshes = [];
	const useVillage = !! ( village && village.materials && village.textures );
	const rand = new Rand( mulberry32( 4242 ) );
	const rand2 = new Rand( mulberry32( 1818 ) );
	const kit = new TownKit( { name: 'tidemark', material: propMaterial, glowMaterial: createGlowMaterial( 'tidemarkGlow' ) } );
	const frame = ( b, y = null ) => frameAt( b.x, y ?? terrain.heightAt( b.x, b.z ), b.z, b.yaw );

	// per block: a village builder, the GeoKit near list, the far list
	const blocks = {};
	const blockFor = ( id ) => {

		if ( blocks[ id ] ) return blocks[ id ];
		const B = useVillage ? new Builder() : null;
		const k = blocks[ id ] = { id, B, P: [], F: [], ids: [], sx: 0, sz: 0, n: 0 };
		k.ctx = useVillage ? { B, terrain, colliders, rand, lights: [], inst: new InstancedProps( B ), checks: [] } : null;
		k.add = ( g, o ) => k.P.push( prepare( g, o ) );
		k.addFar = ( g, o ) => k.F.push( prepare( g, o ) );
		return k;

	};

	const all = [ ...BUILDINGS.map( ( b ) => ( { ...b } ) ), ...FILLERS ];
	for ( const b of all ) {

		const k = blockFor( blockOf( b ) );
		const g = terrain.heightAt( b.x, b.z );
		const F = frame( b );
		let top = g + b.stories * 2.8 + 2;
		let farSpec = null;
		if ( HOUSE_KINDS.has( b.kind ) ) {

			const sp = b.filler ? fillerSpec( b, rand2 ) : houseSpec( b, rand );
			if ( useVillage && INTERIOR_OF[ b.id ] ) sp.openDoor = { id: INTERIOR_OF[ b.id ], w: DOOR.w, h: DOOR.h };
			if ( useVillage ) {

				const r = rand2.next();
				const boxes = b.filler ? r < 0.55 : r < 0.35; // window boxes on about half the infill fronts
				if ( boxes ) sp.onOpening = ( o ) => {

					if ( o.kind !== 'window' || ! o.front || o.closed || o.shutters === 'bahama' ) return;
					if ( o.story === 0 && sp.porch ) return;
					kit.place( ( b.id.length + o.x * 3 ) % 2 < 1 ? 'flowerbox_a' : 'flowerbox_b', o.frame.clone().multiply( mat4( o.x, o.sillY - 0.24, 0.01 ) ) );

				};
				const res = buildHouse( k.ctx, sp );
				top = res.roofTop ?? top;
				for ( const s of SIGNS[ b.id ] || [] ) {

					const y = res.floorY + res.storyH * s.y[ 0 ] + s.y[ 1 ];
					const x = s.x === 'corner' ? b.w / 2 - 0.45 : s.x;
					kit.place( s.piece, F.m( x, y - F.y, b.d / 2 + 0.06, 0, 0, 0, s.scale || 1 ) );

				}

				farSpec = { H: res.eaveY - g, floor: res.floorY - g, rise: Math.max( 0.8, top - res.eaveY ) };

			} else {

				const hex = ( c ) => new Color( c[ 0 ], c[ 1 ], c[ 2 ] ).getHex();
				const r = cottage( k.add, F, { w: b.w, d: b.d, storeys: b.stories, wall: hex( sp.wall ), roof: hex( sp.roofColor || ROOF.red ), trim: hex( sp.accent ), plank: sp.siding === 2, tin: sp.roofMat === 'metal' } );
				top = g + r.top;
				if ( colliders ) colliders.addBox( new Vector3( b.x, g + b.stories * 1.4, b.z ), new Vector3( b.w / 2 + 0.15, b.stories * 1.4, b.d / 2 + 0.15 ), b.yaw, { tag: 'tidemarkHouse' } );
				farSpec = { H: 0.3 + b.stories * 2.6, floor: 0.3, rise: r.top - 0.3 - b.stories * 2.6 };

			}

			farHouse( k.addFar, F, b.w, b.d, farSpec, sp.wall, sp.roofMat === 'thatch' ? THATCH : ( sp.roofColor || ROOF.red ) );

		} else if ( b.kind === 'warehouse' ) {

			top = warehouse( k.add, F, b, colliders, kit );
			farBox( k.addFar, F, b.w, b.d, 5.4, 2.6, lin( 0x8c6d4f ), lin( 0x5a5f63 ) );

		} else if ( b.kind === 'chapel' ) {

			top = chapel( k.add, F, b, colliders, kit );
			farBox( k.addFar, F, b.w, b.d, 4.6, 3.0, lin( 0xf0ece0 ), lin( 0x7d2f25 ) );
			k.addFar( box( 2.6, 9.5, 2.6 ), { ...PAINT( 0xf0ece0 ), matrix: F.m( 0, 4.75, b.d / 2 - 1.3 ) } );
			k.addFar( cylinder( 0.05, 2.1, 2.6, 4 ), { color: 0x7d2f25, rough: 0.8, matrix: F.m( 0, 11.8 + 1.3, b.d / 2 - 1.3, 0, Math.PI / 4, 0 ) } );

		} else if ( b.kind === 'boatyard' ) {

			top = boatyard( k.add, F, b, colliders );
			farBox( k.addFar, F, b.w, b.d, 4.8, 2.4, lin( 0x6e6455 ), lin( 0x6b6f72 ) );

		}

		k.ids.push( b.id );
		k.sx += b.x; k.sz += b.z; k.n ++;
		list.push( { id: b.id, kind: b.kind, name: b.name, x: b.x, z: b.z, yaw: b.yaw, w: b.w, d: b.d, floorY: g, top, block: k.id, filler: !! b.filler, interior: useVillage ? INTERIOR_OF[ b.id ] || null : null } );

	}

	// the hangar (apart, on the apron) and the lookout (the landmark)
	const H = [], Lk = [];
	const addH = ( g, o ) => H.push( prepare( g, o ) );
	const hangarB = EXTRA.find( ( e ) => e.id === 'hangar' ), lookB = EXTRA.find( ( e ) => e.id === 'lookout' );
	const hTop = hangar( addH, frame( hangarB ), hangarB, colliders );
	list.push( { id: 'hangar', kind: 'hangar', name: hangarB.name, x: hangarB.x, z: hangarB.z, yaw: hangarB.yaw, w: hangarB.w, d: hangarB.d, floorY: terrain.heightAt( hangarB.x, hangarB.z ), top: hTop } );
	const look = lookout( ( g, o ) => Lk.push( prepare( g, o ) ), frame( lookB ), colliders );
	list.push( { id: 'lookout', kind: 'lookout', name: lookB.name, x: lookB.x, z: lookB.z, yaw: lookB.yaw, w: 5, d: 5, floorY: look.y, top: look.top } );

	// the streets: cobbles (the paving mesh is the first: the kit's meshes hang under it), kerbs, the street furniture
	const paving = pave( terrain, useVillage ? village : null, propMaterial );
	meshes.push( paving.mesh );
	street( terrain, kit, useVillage ? blocks : null, rand2 );

	// the blocks: near (village batches + GeoKit) within LOD of the block's centre, far beyond
	const dist = phone ? LOD.phone : LOD.desktop;
	const tris = ( m ) => ( m && m.geometry.index ? m.geometry.index.count / 3 : 0 );
	const stats = { near: 0, far: 0, paving: tris( paving.mesh ), kitPlacements: 0 };
	const blockList = [];
	for ( const id of Object.keys( blocks ) ) {

		const k = blocks[ id ];
		const cx = k.sx / k.n, cz = k.sz / k.n;
		blockList.push( { id, x: cx, z: cz, ids: k.ids } );
		const near = useVillage ? assemble( k.B, village, id ) : [];
		if ( k.P.length ) {

			const m = new Mesh( mergePrepared( k.P ), propMaterial );
			m.name = 'TidemarkShells_' + id;
			m.castShadow = true;
			m.receiveShadow = true;
			near.push( m );

		}

		for ( const m of near ) {

			lodSwitch( m, { x: cx, z: cz, dist, near: true } );
			stats.near += tris( m );
			meshes.push( m );

		}

		if ( k.F.length ) {

			const far = new Mesh( mergePrepared( k.F ), propMaterial );
			far.name = 'TidemarkFar_' + id;
			far.castShadow = true;
			far.receiveShadow = true;
			lodSwitch( far, { x: cx, z: cz, dist, near: false } );
			stats.far += tris( far );
			meshes.push( far );

		}

	}

	const hm = new Mesh( mergePrepared( H ), propMaterial );
	hm.name = 'TidemarkShells';
	hm.castShadow = true;
	hm.receiveShadow = true;
	meshes.push( hm );
	stats.near += tris( hm );
	const far = new Mesh( mergePrepared( Lk ), propMaterial );
	far.name = 'TidemarkLookout';
	far.castShadow = true;

	// the kit merges in once its GLB is loaded (async: the town draws without it until then)
	stats.kitPlacements = kit.placements.length;
	const cull = phone ? KIT_CULL.phone : KIT_CULL.desktop;
	kit.ready = kit.attach( paving.mesh, { cullDistance: cull, cullRadius: TOWN_R } ).then( ( r ) => {

		if ( r ) stats.kit = r.triangles;
		return r;

	} );
	return { meshes, far, list, lamp: look.lamp, village: useVillage, kit, blocks: blockList, stats };

}

// the village builder's batches as meshes with the village's materials (the folds of Village._assemble: glass into wood,
// rope into hard, cloth / flags into fabric); the texture bake is shared with the village (a no-op once baked)
function assemble( B, village, suffix = '' ) {

	const mats = village.materials, out = [];
	const take = ( key ) => {

		const b = B.batches[ key ];
		delete B.batches[ key ];
		return b;

	};
	const wood = B.batch( 'wood' ), hard = B.batch( 'hard' ), fabric = B.batch( 'fabric' );
	const glass = take( 'glass' ), rope = take( 'rope' ), cloth = take( 'cloth' ), net = take( 'net' ), flag = take( 'flag' );
	if ( glass ) wood.append( glass, ( d ) => [ d[ 0 ], d[ 1 ], 9, d[ 2 ] ] );
	if ( rope ) hard.append( rope, ( d ) => [ d[ 0 ], 0, 0, 2 + d[ 1 ] ] );
	if ( cloth ) fabric.append( cloth, ( d ) => [ d[ 0 ], d[ 1 ], 0, 0 ] );
	if ( flag ) fabric.append( flag, ( d ) => [ d[ 0 ], d[ 1 ], d[ 2 ] + 10000, d[ 3 ] ] );
	const nets = new Batch();
	if ( net ) nets.append( net, ( d ) => [ d[ 0 ], d[ 1 ], Math.max( 0.02, d[ 2 ] ), 0 ] );
	const bake = () => village.textures.bake();
	for ( const key of [ 'wood', 'hard', 'roofMetal', 'thatch', 'stone', 'fabric' ] ) {

		const b = B.batches[ key ];
		if ( ! b || b.vcount === 0 || ! mats[ key ] ) continue;
		const mesh = new Mesh( b.build(), mats[ key ] );
		mesh.name = 'tidemark_' + key + ( suffix && key !== 'wood' ? '_' + suffix : '' );
		mesh.receiveShadow = true;
		mesh.castShadow = key !== 'fabric';
		mesh.onBeforeRender = bake;
		out.push( mesh );

	}

	if ( nets.vcount > 0 && mats.net ) {

		const mesh = new Mesh( nets.build(), mats.net );
		mesh.name = 'tidemark_nets_' + suffix;
		mesh.onBeforeRender = bake;
		out.push( mesh );

	}

	return out;

}

// ---- the far LOD: a house as its walls, a dark door and windows on the front, a pitched roof (~40 triangles)

function farHouse( add, F, w, d, { H, floor = 0.4, rise = 1.6 }, wall, roof ) {

	farBox( add, F, w, d, H, rise, wall, roof, floor );

}

function farBox( add, F, w, d, H, rise, wall, roof, floor = 0.2 ) {

	const wc = new Color( wall[ 0 ], wall[ 1 ], wall[ 2 ] ), rc = new Color( roof[ 0 ], roof[ 1 ], roof[ 2 ] );
	add( box( w, H, d ), { color: wc, rough: 0.85, matrix: F.m( 0, H / 2, 0 ) } );
	const half = d / 2 + 0.3, slope = Math.atan2( rise, half ), rl = Math.hypot( half, rise );
	for ( const s of [ - 1, 1 ] ) add( box( w + 0.4, 0.12, rl ), { color: rc, rough: 0.75, matrix: F.m( 0, H + rise / 2, s * half / 2, s * slope, 0, 0 ) } );
	// the gable ends: a wedge from three stacked boards (reads at distance)
	for ( let k = 0; k < 3; k ++ ) add( box( w - 0.02, rise / 3, d * ( 1 - ( k + 0.5 ) / 3 ) ), { color: wc, rough: 0.85, matrix: F.m( 0, H + rise * ( k + 0.5 ) / 3, 0 ) } );
	const dark = { color: 0x1d2328, rough: 0.3 };
	add( box( 0.9, Math.min( 2.0, H - floor - 0.3 ), 0.04 ), { ...dark, matrix: F.m( 0, floor + 1.0, d / 2 + 0.02 ) } );
	const rows = Math.max( 1, Math.round( H / 2.8 ) );
	for ( let r = 0; r < rows; r ++ ) for ( const s of [ - 1, 1 ] ) add( box( 0.8, 1.0, 0.04 ), { ...dark, matrix: F.m( s * w * 0.3, floor + 1.4 + r * 2.75, d / 2 + 0.02 ) } );

}

// ---- the cobbles: a terrain-following grid per rect (3 m cells, 4 cm over the ground), the village stone (small
// rubble: cobbles, metre uvs; v offset so the stone's ground dust stays off) with the game's materials, flagstones in
// the prop material otherwise; kerbs along the back lane and the market street

function pave( terrain, village, propMaterial ) {

	const cell = 3;
	if ( village ) {

		const B = new Builder();
		for ( const [ u0, u1, v0, v1 ] of PAVING ) {

			const cols = Math.max( 1, Math.ceil( ( u1 - u0 ) / cell ) ), rows = Math.max( 1, Math.ceil( ( v1 - v0 ) / cell ) );
			const part = gridPart( cols, rows, ( i, j ) => {

				const [ x, z ] = tidemarkWorld( u0 + ( u1 - u0 ) * i / cols, v0 + ( v1 - v0 ) * j / rows );
				return { p: [ x, terrain.heightAt( x, z ) + 0.04, z ], n: [ 0, 1, 0 ], uv: [ x - 1700, z + 300 ] };

			} );
			B.part( 'stone', part, 0, 0, 0, { tint: lin( 0xcfc4ae ), data: [ 0.37, 2, 0, 0 ] } );

		}

		for ( const [ ua, va, ub, vb ] of KERBS ) kerb( B, terrain, ua, va, ub, vb );
		const b = B.batches.stone;
		const mesh = new Mesh( b.build(), village.materials.stone );
		mesh.name = 'tidemark_paving';
		mesh.receiveShadow = true;
		mesh.castShadow = false;
		mesh.onBeforeRender = () => village.textures.bake();
		return { mesh };

	}

	// stand-in: flagstones of three tones
	const P = [];
	const tones = [ 0xa49b8b, 0x988f80, 0xaea595 ];
	let n = 0;
	for ( const [ u0, u1, v0, v1 ] of PAVING ) {

		const cols = Math.max( 1, Math.ceil( ( u1 - u0 ) / cell ) ), rows = Math.max( 1, Math.ceil( ( v1 - v0 ) / cell ) );
		for ( let i = 0; i < cols; i ++ ) for ( let j = 0; j < rows; j ++ ) {

			const c = [ [ i, j ], [ i + 1, j ], [ i + 1, j + 1 ], [ i, j + 1 ] ].map( ( [ a, b ] ) => {

				const [ x, z ] = tidemarkWorld( u0 + ( u1 - u0 ) * a / cols, v0 + ( v1 - v0 ) * b / rows );
				return [ x, terrain.heightAt( x, z ) + 0.04, z ];

			} );
			const g = new BufferGeometry();
			g.setAttribute( 'position', new Float32BufferAttribute( c.flat(), 3 ) );
			g.setAttribute( 'normal', new Float32BufferAttribute( [ 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0 ], 3 ) );
			// (wound for an upward face whichever way the island frame turns)
			const ex = c[ 1 ][ 0 ] - c[ 0 ][ 0 ], ez = c[ 1 ][ 2 ] - c[ 0 ][ 2 ], fx = c[ 3 ][ 0 ] - c[ 0 ][ 0 ], fz = c[ 3 ][ 2 ] - c[ 0 ][ 2 ];
			g.setIndex( ez * fx - ex * fz > 0 ? [ 0, 1, 2, 0, 2, 3 ] : [ 0, 2, 1, 0, 3, 2 ] );
			P.push( prepare( g, { color: tones[ ( n ++ * 7 + i ) % 3 ], rough: 0.95 } ) );

		}

	}

	const mesh = new Mesh( mergePrepared( P ), propMaterial );
	mesh.name = 'TidemarkPaving';
	mesh.receiveShadow = true;
	mesh.castShadow = false;
	return { mesh };

}

// kerb runs (island coordinates, start / end): both sides of the market street east of the square, the back lane's edges
const KERBS = [
	[ - 101.5, 5.5, - 84, 5.5 ], [ - 101.5, 10.5, - 84, 10.5 ],
	[ - 108.5, - 72, - 108.5, - 9 ], [ - 101.5, - 72, - 101.5, - 9 ], [ - 108.5, 25, - 108.5, 64 ], [ - 101.5, 25, - 101.5, 64 ],
];

function kerb( B, terrain, ua, va, ub, vb ) {

	const len = Math.hypot( ub - ua, vb - va ), n = Math.max( 1, Math.round( len / 1.2 ) );
	for ( let k = 0; k < n; k ++ ) {

		const t = ( k + 0.5 ) / n;
		const [ x, z ] = tidemarkWorld( ua + ( ub - ua ) * t, va + ( vb - va ) * t );
		const [ x1, z1 ] = tidemarkWorld( ub, vb ), [ x0, z0 ] = tidemarkWorld( ua, va );
		const yaw = Math.atan2( x1 - x0, z1 - z0 );
		B.box( 'stone', x, terrain.heightAt( x, z ) + 0.05, z, 0.24, 0.16, len / n - 0.04, { ry: yaw, tint: lin( 0xb8b0a0 ), data: [ k * 0.13, 0, 0, 0 ] } );

	}

}

// ---- the street furniture (Waterfront.js STREET) through the kit, washing lines in the back gardens (village fabric)

function street( terrain, kit, blocks, rand ) {

	const place = ( piece, u, v, yawOff = 0, ly = 0, s = 1 ) => {

		const [ x, z ] = tidemarkWorld( u, v );
		const F = frameAt( x, terrain.heightAt( x, z ), z, FACE + yawOff );
		kit.place( piece, F.m( 0, ly, 0, 0, 0, 0, s ) );

	};
	for ( const L of STREET.lamps ) place( 'lamp_street', L.u, L.v );
	for ( const b of STREET.benches ) place( 'bench', b.u, b.v, b.yawOff );
	for ( const p of STREET.planters ) place( 'planter', p.u, p.v, p.u * 0.37 );
	for ( const n of STREET.netracks ) place( 'netrack', n.u, n.v, n.yawOff );
	place( 'fountain', STREET.fountain.u, STREET.fountain.v, Math.PI / 8 );
	// washing lines across the back gardens (between the back row and the third row)
	if ( blocks ) for ( const [ ua, va, ub, vb ] of [ [ - 87.6, - 53, - 87.6, - 47 ], [ - 87.6, - 34, - 87.6, - 28 ], [ - 87.6, 16, - 87.6, 22 ], [ - 87.6, 45, - 87.6, 51 ] ] ) {

		const B = ( blocks[ va < 8 ? 'south' : 'north' ] || {} ).B;
		if ( ! B ) continue;
		const [ xa, za ] = tidemarkWorld( ua, va ), [ xb, zb ] = tidemarkWorld( ub, vb );
		const ya = terrain.heightAt( xa, za ), yb = terrain.heightAt( xb, zb );
		for ( const [ x, y, z ] of [ [ xa, ya, za ], [ xb, yb, zb ] ] ) B.cyl( 'wood', x, y - 0.2, z, 0.05, 0.06, 2.3, { segs: 6, data: [ rand.next(), 0, 0, 0.8 ] } );
		laundryLine( B, [ xa, ya + 2.0, za ], [ xb, yb + 2.0, zb ], rand, [ lin( 0xf2efe6 ), lin( 0xd98c7a ), lin( 0x9cc0d8 ), lin( 0xf0cf7c ), lin( 0x5dbcb0 ) ] );

	}

}

// ---- GeoKit shells (frame: local +z is the front, toward the bay; F.m( lx, ly, lz, ... ) a matrix in it)

function walls( add, F, w, d, h, mat, { front = true, door = null } = {} ) {

	const t = 0.18;
	add( box( w, h, t ), { ...mat, matrix: F.m( 0, h / 2, - d / 2 ) } );
	for ( const s of [ - 1, 1 ] ) add( box( t, h, d ), { ...mat, matrix: F.m( s * w / 2, h / 2, 0 ) } );
	if ( ! front ) return;
	if ( ! door ) {

		add( box( w, h, t ), { ...mat, matrix: F.m( 0, h / 2, d / 2 ) } );
		return;

	}

	// a front wall round a doorway door = [ width, height ]
	const [ dw, dh ] = door, side = ( w - dw ) / 2;
	for ( const s of [ - 1, 1 ] ) add( box( side, h, t ), { ...mat, matrix: F.m( s * ( dw / 2 + side / 2 ), h / 2, d / 2 ) } );
	add( box( dw, h - dh, t ), { ...mat, matrix: F.m( 0, dh + ( h - dh ) / 2, d / 2 ) } );

}

function gableRoof( add, F, w, d, y, rise, opts ) {

	const half = d / 2 + 0.4, slope = Math.atan2( rise, half ), rl = Math.hypot( half, rise );
	for ( const s of [ - 1, 1 ] ) add( box( w + 0.5, 0.12, rl ), { ...opts, matrix: F.m( 0, y + rise / 2, s * half / 2, s * slope, 0, 0 ) } );
	add( box( w + 0.52, 0.14, 0.16 ), { ...opts, matrix: F.m( 0, y + rise + 0.05, 0 ) } );
	// stepped gable infill
	for ( const s of [ - 1, 1 ] ) for ( let k = 0; k < 3; k ++ ) {

		const f = 1 - ( k + 0.5 ) / 3;
		add( box( 0.1, rise / 3, d * f ), { ...WOODX( 0x7a6e5a ), matrix: F.m( s * w / 2, y + rise * ( k + 0.5 ) / 3, 0 ) } );

	}

}

function warehouse( add, F, b, colliders, kit = null ) {

	const { w, d } = b, h = 5.4;
	add( box( w + 0.4, 0.5, d + 0.4 ), { ...STONE( 0x6f6a61 ), matrix: F.m( 0, 0.05, 0 ) } );
	walls( add, F, w, d, h, WOODX( 0x8c6d4f ), { door: [ 4.2, 3.8 ] } );
	add( box( 4.0, 3.6, 0.08 ), { ...WOOD( 0x4a5a50 ), matrix: F.m( 0, 1.8, d / 2 - 0.2 ) } );
	gableRoof( add, F, w, d, h, 2.6, { color: 0x5a5f63, rough: 0.6, metal: 0.5, pattern: PAT.rusty } );
	// the hoist beam over the loft door and its block
	add( box( 1.1, 1.3, 0.1 ), { ...WOOD( 0x3d4b55 ), matrix: F.m( 0, 4.6, d / 2 + 0.05 ) } );
	add( box( 0.2, 0.2, 1.8 ), { ...WOOD( 0x4a3c30 ), matrix: F.m( 0, 5.9, d / 2 + 0.8 ) } );
	add( cylinder( 0.012, 0.012, 2.4, 4 ), { color: 0xc9b48a, rough: 0.9, matrix: F.m( 0, 4.7, d / 2 + 1.5 ) } );
	// the fish hall's name board and a striped awning over its doors (the kit), else the old painted board
	if ( kit ) {

		kit.place( 'sign_fishhall', F.m( - 3.4, 4.45, d / 2 + 0.09, 0, 0, 0, 0.62 ) );
		kit.place( 'awning_red', F.m( 0, 4.05, d / 2 + 0.09, 0, 0, 0, 1.55, 1, 1 ) );

	} else {

		add( box( 5.2, 0.6, 0.05 ), { ...PAINT( 0xe9e6dd ), matrix: F.m( 0, 4.15 + 0.05, d / 2 + 0.1 ) } );
		add( box( 4.6, 0.18, 0.02 ), { ...PAINT( 0x2b3a44 ), matrix: F.m( 0, 4.2, d / 2 + 0.13 ) } );

	}

	// windows down the sides (frames here, the panes in the kit's glow mesh: lit at night, some stay dark)
	for ( const sx of [ - 1, 1 ] ) for ( let k = 0; k < 3; k ++ ) {

		const z = - d / 2 + 2 + k * ( d - 4 ) / 2;
		add( box( 0.1, 1.2, 1.1 ), { ...WOOD( 0x3d4b55 ), matrix: F.m( sx * ( w / 2 + 0.05 ), 2.2, z ) } );
		if ( kit ) kit.glow( box( 0.04, 1.0, 0.9 ), { color: 0x23292e, lit: ( k + ( sx > 0 ? 1 : 0 ) ) % 3 ? 0.55 : 0, matrix: F.m( sx * ( w / 2 + 0.11 ), 2.2, z ) } );

	}

	if ( colliders ) colliders.addBox( new Vector3( F.x, F.y + h / 2, F.z ), new Vector3( w / 2 + 0.1, h / 2, d / 2 + 0.1 ), F.yaw, { tag: 'tidemarkWarehouse' } );
	return F.y + h + 2.6;

}

function chapel( add, F, b, colliders, kit = null ) {

	const { w, d } = b, h = 4.6;
	add( box( w + 0.4, 0.5, d + 0.4 ), { ...STONE( 0x8a8378 ), matrix: F.m( 0, 0.05, 0 ) } );
	walls( add, F, w, d, h, PAINT( 0xf0ece0, { rough: 0.85 } ), { door: [ 1.6, 2.6 ] } );
	add( box( 1.5, 2.5, 0.08 ), { ...WOOD( 0x5a3a2a ), matrix: F.m( 0, 1.3, d / 2 + 0.02 ) } );
	// tall windows down the sides
	// (wave 18C: the panes are the kit's glow: candle-lit at night)
	for ( const s of [ - 1, 1 ] ) for ( let k = 0; k < 3; k ++ ) {

		const m = F.m( s * ( w / 2 + 0.06 ), 2.4, - d / 2 + 2.5 + k * 3.5 );
		if ( kit ) kit.glow( box( 0.06, 1.8, 0.7 ), { color: 0x24343a, lit: 0.45, matrix: m } );
		else add( box( 0.06, 1.8, 0.7 ), { color: 0x24343a, rough: 0.15, matrix: m } );
		add( box( 0.1, 0.1, 0.8 ), { ...STONE( 0xd8d2c4 ), matrix: F.m( s * ( w / 2 + 0.08 ), 1.47, - d / 2 + 2.5 + k * 3.5 ) } );

	}
	gableRoof( add, F, w, d, h, 3.0, { color: 0x7d2f25, rough: 0.8 } );
	// the belfry over the door: a square tower, open arches, a pyramid cap, the bell
	const tz = d / 2 - 1.3, th = 9.5;
	add( box( 2.6, th, 2.6 ), { ...PAINT( 0xf0ece0, { rough: 0.85 } ), matrix: F.m( 0, th / 2, tz ) } );
	for ( const [ sx, sz ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ - 1, 1 ], [ 1, 1 ] ] ) add( box( 0.45, 2.2, 0.45 ), { ...PAINT( 0xe6e1d4 ), matrix: F.m( sx * 1.1, th + 1.1, tz + sz * 1.1 ) } );
	add( box( 2.9, 0.25, 2.9 ), { ...STONE( 0x8a8378 ), matrix: F.m( 0, th + 2.3, tz ) } );
	add( cylinder( 0.05, 2.1, 2.6, 4 ), { color: 0x7d2f25, rough: 0.8, matrix: F.m( 0, th + 3.7, tz, 0, Math.PI / 4, 0 ) } );
	add( cylinder( 0.25, 0.45, 0.6, 12 ), { color: 0xb08a3a, rough: 0.35, metal: 1, matrix: F.m( 0, th + 1.2, tz ) } );
	add( box( 0.08, 1.0, 0.08 ), { color: 0x2b2e31, rough: 0.5, metal: 0.7, matrix: F.m( 0, th + 5.4, tz ) } );
	add( box( 0.6, 0.08, 0.08 ), { color: 0x2b2e31, rough: 0.5, metal: 0.7, matrix: F.m( 0, th + 5.6, tz ) } );
	if ( colliders ) {

		colliders.addBox( new Vector3( F.x, F.y + h / 2, F.z ), new Vector3( w / 2 + 0.1, h / 2, d / 2 + 0.1 ), F.yaw, { tag: 'tidemarkChapel' } );
		const [ bx, bz ] = F.world( 0, tz );
		colliders.addBox( new Vector3( bx, F.y + th / 2, bz ), new Vector3( 1.3, th / 2, 1.3 ), F.yaw, { tag: 'tidemarkBelfry' } );

	}

	return F.y + th + 5.9;

}

// the boatyard: an open-fronted shed (its doors are breakable props) over a cradle with a half-built hull, rails down the slip
function boatyard( add, F, b, colliders ) {

	const { w, d } = b, h = 4.8;
	walls( add, F, w, d, h, WOODX( 0x6e6455 ), { front: false } );
	add( box( w, 1.2, 0.18 ), { ...WOODX( 0x6e6455 ), matrix: F.m( 0, h - 0.6, d / 2 ) } ); // the lintel over the doorway
	gableRoof( add, F, w, d, h, 2.4, { color: 0x6b6f72, rough: 0.6, metal: 0.4, pattern: PAT.rusty } );
	// the cradle, the hull in frame (ribs over a keel), planks and sawhorses
	add( box( 0.3, 0.5, 9 ), { ...WOOD( 0x4a3c30 ), matrix: F.m( 0, 0.25, 0 ) } );
	add( box( 0.22, 0.3, 9.4 ), { ...WOOD( 0x6a523a ), matrix: F.m( 0, 0.7, 0 ) } );
	for ( let k = 0; k < 9; k ++ ) {

		const z = - 4 + k, r = 1.25 * Math.sin( Math.PI * ( k + 0.5 ) / 9 ) + 0.25;
		for ( const s of [ - 1, 1 ] ) add( box( 0.1, 1.5, 0.12 ), { ...WOOD( 0x7a5e40 ), matrix: F.m( s * r * 0.75, 1.45, z, 0, 0, s * 0.45 ) } );

	}

	for ( let k = 0; k < 3; k ++ ) add( box( 0.06, 0.25, 6 ), { ...WOOD( 0x8a6a46 ), matrix: F.m( - 1.05 + 0.02 * k, 1.0 + k * 0.26, 0.3, 0, 0, - 0.5 ) } );
	for ( const z of [ - 2.5, 2.5 ] ) add( box( 1.2, 0.08, 0.2 ), { ...WOOD( 0x7a6b58 ), matrix: F.m( 3.6, 0.8, z ) } );
	// the slipway rails from the doorway down into the bay
	for ( const s of [ - 1, 1 ] ) add( box( 0.2, 0.18, 16 ), { ...WOOD( 0x3f372e ), matrix: F.m( s * 1.1, - 0.55, d / 2 + 7.2, 0.085, 0, 0 ) } );
	if ( colliders ) {

		const t = 0.25;
		const back = F.world( 0, - d / 2 );
		colliders.addBox( new Vector3( back[ 0 ], F.y + h / 2, back[ 1 ] ), new Vector3( w / 2, h / 2, t ), F.yaw, { tag: 'tidemarkBoatyard' } );
		for ( const s of [ - 1, 1 ] ) {

			const p = F.world( s * w / 2, 0 );
			colliders.addBox( new Vector3( p[ 0 ], F.y + h / 2, p[ 1 ] ), new Vector3( t, h / 2, d / 2 ), F.yaw, { tag: 'tidemarkBoatyard' } );

		}

	}

	return F.y + h + 2.4;

}

// the hangar on the airstrip's apron: corrugated walls on three sides, a vaulted roof, the doorway (15 x 5.5 m) facing the
// runway; colliders on its walls only (a plane rolls in through the front)
function hangar( add, F, b, colliders ) {

	const { w, d } = b, h = 6;
	const tin = { color: 0x8a9096, rough: 0.55, metal: 0.6, pattern: PAT.rusty };
	add( box( w, 0.12, d ), { ...STONE( 0x777168 ), matrix: F.m( 0, 0.03, 0 ) } );
	walls( add, F, w, d, h, tin, { door: [ 15, 5.5 ] } );
	// a vault of seven panels from wall to wall
	const n = 7;
	for ( let k = 0; k < n; k ++ ) {

		const a0 = Math.PI * k / n, a1 = Math.PI * ( k + 1 ) / n, am = ( a0 + a1 ) / 2;
		const R = w / 2, rise = 2.8;
		const x = - Math.cos( am ) * R, y = h + Math.sin( am ) * rise;
		const len = Math.hypot( R * ( Math.cos( a0 ) - Math.cos( a1 ) ), rise * ( Math.sin( a1 ) - Math.sin( a0 ) ) ) + 0.06;
		const tilt = Math.atan2( rise * ( Math.sin( a1 ) - Math.sin( a0 ) ), R * ( Math.cos( a0 ) - Math.cos( a1 ) ) );
		add( box( len, 0.1, d + 0.4 ), { ...tin, matrix: F.m( x, y, 0, 0, 0, tilt ) } );

	}

	for ( const s of [ - 1, 1 ] ) for ( let k = 0; k < 3; k ++ ) add( box( w * ( 0.75 - k * 0.25 ), 0.9, 0.12 ), { ...tin, matrix: F.m( 0, h + 0.45 + k * 0.9, s * d / 2 ) } );
	// the name board over the doors, a workbench and a fuel pump inside
	add( box( 7.5, 0.9, 0.06 ), { ...PAINT( 0xe9e6dd ), matrix: F.m( 0, 6.6, d / 2 + 0.12 ) } );
	add( box( 6.6, 0.34, 0.03 ), { ...PAINT( 0x2f5f8a ), matrix: F.m( 0, 6.6, d / 2 + 0.16 ) } );
	add( box( 3.2, 0.9, 0.8 ), { ...WOOD( 0x6e5e47 ), matrix: F.m( - w / 2 + 2.2, 0.45, - d / 2 + 0.7 ) } );
	add( box( 0.6, 1.5, 0.5 ), { ...PAINT( 0xb23a2e ), matrix: F.m( w / 2 - 1.2, 0.75, - d / 2 + 0.6 ) } );
	if ( colliders ) {

		const t = 0.2;
		const back = F.world( 0, - d / 2 );
		colliders.addBox( new Vector3( back[ 0 ], F.y + h / 2, back[ 1 ] ), new Vector3( w / 2, h / 2, t ), F.yaw, { tag: 'tidemarkHangar' } );
		for ( const s of [ - 1, 1 ] ) {

			const p = F.world( s * w / 2, 0 );
			colliders.addBox( new Vector3( p[ 0 ], F.y + h / 2, p[ 1 ] ), new Vector3( t, h / 2, d / 2 ), F.yaw, { tag: 'tidemarkHangar' } );
			const q = F.world( s * ( 7.5 + 0.75 ), d / 2 );
			colliders.addBox( new Vector3( q[ 0 ], F.y + h / 2, q[ 1 ] ), new Vector3( 0.75, h / 2, t ), F.yaw, { tag: 'tidemarkHangar' } );

		}

	}

	return F.y + h + 2.8;

}

// the lookout on the hilltop: a tapering stone tower, a lantern room on top (a landmark from the sea)
function lookout( add, F, colliders ) {

	const H = 12;
	add( box( 5.2, 1.0, 5.2 ), { ...STONE( 0x6f6a61 ), matrix: F.m( 0, 0.2, 0 ) } );
	for ( let k = 0; k < 4; k ++ ) {

		const w = 4.4 - k * 0.35, h = H / 4;
		add( box( w, h + 0.02, w ), { ...STONE( [ 0xb3aa98, 0xa69d8b, 0xb8af9c, 0xaaa190 ][ k ] ), matrix: F.m( 0, 0.7 + h * ( k + 0.5 ), 0 ) } );

	}

	const top = 0.7 + H;
	add( box( 4.2, 0.3, 4.2 ), { ...STONE( 0x7b746a ), matrix: F.m( 0, top + 0.15, 0 ) } );
	for ( const [ sx, sz ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ - 1, 1 ], [ 1, 1 ] ] ) add( box( 0.4, 1.8, 0.4 ), { ...STONE( 0x8a8378 ), matrix: F.m( sx * 1.7, top + 1.2, sz * 1.7 ) } );
	add( box( 3.8, 0.3, 3.8 ), { ...STONE( 0x7b746a ), matrix: F.m( 0, top + 2.25, 0 ) } );
	add( cylinder( 0.1, 2.6, 1.6, 4 ), { color: 0x2f5f8a, rough: 0.7, matrix: F.m( 0, top + 3.2, 0, 0, Math.PI / 4, 0 ) } );
	add( box( 1.0, 2.0, 0.1 ), { ...WOOD( 0x3d4b55 ), matrix: F.m( 0, 1.7, 2.25 ) } );
	if ( colliders ) colliders.addBox( new Vector3( F.x, F.y + top / 2, F.z ), new Vector3( 2.6, top / 2, 2.6 ), F.yaw, { tag: 'tidemarkLookout' } );
	return { y: F.y, top: F.y + top + 4, lamp: new Vector3( F.x, F.y + top + 1.2, F.z ) };

}

// the lookout's lantern glass (an emissive mesh of its own: its glow follows the night)
export function lookoutGlass( add, x, y, z ) {

	add( box( 2.2, 1.4, 2.2 ), { color: 0xffe6b0, rough: 0.3, matrix: mat4( x, y, z ) } );
	add( sphere( 0.5, 8, 6 ), { color: 0xfff2d0, rough: 0.2, matrix: mat4( x, y, z ) } );

}
