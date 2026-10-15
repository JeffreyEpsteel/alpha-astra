import { Group, Mesh, Vector3 } from '../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, mat4 } from '../../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from '../GameMaterials.js';
import { Vendor } from '../Vendor.js';
import { characterUrl } from '../Characters.js';
import { WORLD } from '../../world/WorldLayout.js';

// The hermit fisher of The Shrine (world/islands/TheShrine.js builds the rock, the hut and the shrine): Heptyle,
// who has fished the stacks alone for years, sits on a driftwood bench by a split-log table outside his hut with
// a basket and a smoking rack. A vendor of kind 'buyer' (the Sell / Quests panel) who pays a premium for the
// strange fish of the inverted sea (SHRINE_PREMIUM: the Unreal game's rootfin, lantern carp, upside-down eel,
// glass perch and crooked cod).
//
//   const port = new ShrinePort( { scene, terrain, colliders } );
//   port.vendor (push into Game.vendors), port.update( dt, camera distance ), port.lights ([]: the hut has the lamp)
//   SHRINE_STAND (WORLD.ports 'shrine' stand), SHRINE_PREMIUM

const PORT = WORLD.ports.find( ( p ) => p.id === 'shrine' );
export const SHRINE_STAND = { ...PORT.stand };
export const SHRINE_PREMIUM = {
	label: 'Strange fish',
	ids: [ 'rootfin', 'lanterncarp', 'upsidedowneel', 'glassperch', 'crookedcod' ],
	mult: 1.5,
	note: 'The hermit pays 50% extra for the strange fish: rootfin, lantern carp, upside-down eel, glass perch and crooked cod.',
};
const LOAD_DIST = 220;

export class ShrinePort {

	constructor( { scene, terrain, colliders = null } ) {

		const { x, z, yaw } = SHRINE_STAND;
		const y = terrain.heightAt( x, z );
		this.material = createPropMaterial( 'shrinePort' );
		this.group = new Group();
		this.group.name = 'ShrinePort';
		this.group.position.set( x, y, z );
		this.group.rotation.y = yaw;
		const mesh = new Mesh( buildTable(), this.material );
		mesh.name = 'ShrineTable';
		mesh.castShadow = true;
		this.group.add( mesh );
		scene.add( this.group );
		this.lights = [];

		const c = Math.cos( yaw ), s = Math.sin( yaw );
		const lx = 0, lz = - 0.75;
		this.vendor = new Vendor( {
			name: 'Heptyle · The hermit',
			kind: 'buyer',
			position: new Vector3( x + lx * c + lz * s, y + 0.02, z - lx * s + lz * c ),
			yaw,
			radius: 3.0,
			greeting: 'Few boats come out to the stacks. The strange ones bite near the roots and the deep rock: rootfin, lantern carp, the upside-down eel, glass perch, crooked cod. I pay half again for those.',
			idle: 'The shrine lamp has burned since before the isles turned over.',
			material: this.material,
			look: { shirt: 0x5d6b55, trousers: 0x3a3a3a, apron: 0x5a4632, hat: 0x3b2f24, hair: 0x9a9387, skin: 0x8a6a4a },
		} );
		this.vendor._lazyCharacter = { url: characterUrl( 'heptyle' ), idle: 'Idle_Breathe', talk: 'Talk', greet: 'Wave' };
		const ids = new Set( SHRINE_PREMIUM.ids );
		this.vendor.premium = SHRINE_PREMIUM;
		this.vendor.priceFor = ( f ) => ids.has( f.species ) ? Math.round( f.value * SHRINE_PREMIUM.mult ) : f.value;
		this.vendor.premiumBonus = ( list ) => {

			let extra = 0;
			for ( const f of list || [] ) if ( ids.has( f.species ) ) extra += Math.round( f.value * SHRINE_PREMIUM.mult ) - f.value;
			return extra;

		};

		scene.add( this.vendor.group );
		if ( colliders ) colliders.addBox( new Vector3( x, y + 0.4, z ), new Vector3( 0.9, 0.4, 0.4 ), yaw, { tag: 'shrineTable' } );

	}

	update( dt, cameraDistance = Infinity ) {

		const ch = this.vendor._lazyCharacter;
		if ( ch && cameraDistance < LOAD_DIST ) {

			this.vendor._lazyCharacter = null;
			this.vendor.loadCharacter( ch.url, ch ).catch( ( e ) => console.warn( 'ShrinePort: character failed to load', e ) );

		}

	}

}

// a split-log table (customer side +z), a driftwood bench behind it, a basket of fish and a smoking rack
function buildTable() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const WOOD = ( c ) => ( { color: c, rough: 0.95, pattern: PAT.wood } );
	for ( const x of [ - 0.7, 0.7 ] ) add( cylinder( 0.12, 0.14, 0.78, 8 ), { ...WOOD( 0x6e604d ), matrix: mat4( x, 0.39, 0 ) } );
	add( cylinder( 0.32, 0.32, 1.8, 10, 1, false, 0, Math.PI ), { ...WOOD( 0x8a7a64 ), matrix: mat4( 0, 0.8, 0, Math.PI / 2, 0, Math.PI / 2 ) } );
	add( box( 1.6, 0.08, 0.3 ), { ...WOOD( 0x9a8f80 ), matrix: mat4( 0, 0.42, - 1.05 ) } );
	for ( const x of [ - 0.6, 0.6 ] ) add( box( 0.12, 0.42, 0.26 ), { ...WOOD( 0x7d705f ), matrix: mat4( x, 0.21, - 1.05 ) } );
	// a basket of silver fish and a crooked cod on the table
	add( cylinder( 0.26, 0.2, 0.22, 12 ), { color: 0x9a7a4a, rough: 0.95, pattern: PAT.cloth, matrix: mat4( - 0.45, 0.93, 0 ) } );
	for ( let i = 0; i < 4; i ++ ) add( sphere( 1, 8, 5 ), { color: [ 0xb8c4cc, 0x8fa6b2, 0xc9d2d6 ][ i % 3 ], rough: 0.3, metal: 0.4, matrix: mat4( - 0.5 + i * 0.05, 1.05, - 0.05 + ( i % 2 ) * 0.1, 0, i * 0.7, 0.3, 0.06, 0.04, 0.17 ) } );
	add( sphere( 1, 8, 5 ), { color: 0x6b5a3a, rough: 0.5, metal: 0.2, matrix: mat4( 0.35, 0.9, 0.05, 0, 0.4, 0.25, 0.08, 0.06, 0.32 ) } );
	// the smoking rack: a tripod of poles over a little stone hearth, fish hung on a cross bar
	for ( let k = 0; k < 3; k ++ ) {

		const a = k / 3 * Math.PI * 2;
		add( cylinder( 0.03, 0.04, 1.9, 6 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( 1.6 + Math.cos( a ) * 0.35, 0.9, - 0.3 + Math.sin( a ) * 0.35, Math.sin( a ) * 0.18, 0, - Math.cos( a ) * 0.18 ) } );

	}

	for ( let k = 0; k < 6; k ++ ) {

		const a = k / 6 * Math.PI * 2;
		add( sphere( 0.12, 6, 4 ), { color: 0x55524e, rough: 0.95, matrix: mat4( 1.6 + Math.cos( a ) * 0.32, 0.06, - 0.3 + Math.sin( a ) * 0.32 ) } );

	}

	add( sphere( 0.15, 6, 4 ), { color: 0x2a2220, rough: 1, matrix: mat4( 1.6, 0.04, - 0.3, 0, 0, 0, 1.4, 0.3, 1.4 ) } );
	for ( let k = 0; k < 3; k ++ ) add( sphere( 1, 6, 4 ), { color: 0x8a6a3a, rough: 0.6, matrix: mat4( 1.5 + k * 0.1, 1.35, - 0.3, 0, 0, 0, 0.04, 0.18, 0.06 ) } );
	return mergePrepared( P );

}
