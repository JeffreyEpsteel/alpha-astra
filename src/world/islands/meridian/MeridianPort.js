import { Group, Mesh, Vector3, Color } from '../../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, mat4 } from '../../boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../../game/GameMaterials.js';
import { Vendor } from '../../../game/Vendor.js';
import { characterUrl } from '../../../game/Characters.js';
import { cityPlan } from './CityPlan.js';
import { cameraPosition } from '../IslandKit.js';

// The port entry of Meridian (wave 21A) on the harbour quay (meridian/CityPlan.js plan.port): the fish market's stall
// (kind 'buyer': the Sell / Quests panel) paying a premium for the big game fish the city's restaurants want, and the
// chandlery's counter (kind 'shop': gear and fuel) in front of the chandlery. Roid & Co.'s agent comes with the WORLD.ports
// entry (the agents feature), the notice board is the kit's (Meridian.js: plan.port.notice).
//
//   const port = new MeridianPort( { scene, terrain, colliders } )   port.vendors, port.lights, port.update( dt, distance )
//   MERIDIAN_STAND, MERIDIAN_PREMIUM, MERIDIAN_BOARD

const P = cityPlan().port;
export const MERIDIAN_STAND = { ...P.stand };
export const MERIDIAN_BOARD = { ...P.notice };
export const MERIDIAN_PREMIUM = {
	label: 'Big game fish',
	ids: [ 'tuna', 'mahi', 'barracuda', 'tarpon', 'redSnapper' ],
	mult: 1.25,
	note: 'The Meridian fish market pays 25% extra for big game fish: tuna, mahi-mahi, barracuda, tarpon and red snapper. The city\'s restaurants want them.',
};
const LOAD_DIST = 260;

export class MeridianPort {

	constructor( { scene, terrain, colliders = null } ) {

		this.material = createPropMaterial( 'meridianPort' );
		this.group = new Group();
		this.group.name = 'MeridianPort';
		if ( scene ) scene.add( this.group );
		this.terrain = terrain;
		this.lights = [];
		this.market = this._stall( MERIDIAN_STAND, stallGeometry( 0x1f5f8a, true ), colliders, 'meridianFishMarket', {
			name: 'Ines · Meridian fish market',
			kind: 'buyer',
			greeting: 'Tuna, mahi, barracuda, tarpon, red snapper: the restaurants uptown pay for those, and so do I.',
			idle: 'The ferry\'s late again.',
			character: { url: characterUrl( 'heptyle' ), idle: 'Idle_Breathe', talk: 'Talk', greet: 'Wave' },
			look: { shirt: 0x1f5f8a, trousers: 0x2f2f33, apron: 0xe8e2d0, hat: 0x20384a, hair: 0x2a1e16, skin: 0x9a7452 },
		} );
		const ch = cityPlan().buildings.find( ( b ) => b.id === 'chandlery' );
		const cs = { x: ch.x + Math.sin( ch.yaw ) * ( ch.d / 2 + 2.6 ), z: ch.z + Math.cos( ch.yaw ) * ( ch.d / 2 + 2.6 ), yaw: ch.yaw };
		this.chandler = this._stall( cs, stallGeometry( 0x7a2f26, false ), colliders, 'meridianChandler', {
			name: 'Dorsey · Chandlery',
			kind: 'shop',
			greeting: 'Line, reels, a bigger hold, fuel for the run home. Everything a captain needs, city prices.',
			idle: 'Busy port today.',
			character: { url: characterUrl( 'doge' ), idle: 'Idle_Breathe', talk: 'Talk', greet: 'Wave' },
			look: { shirt: 0x7a2f26, trousers: 0x33302c, apron: 0x5a4632, hat: 0x2b3a44, hair: 0x9a7a4a, skin: 0x8a6a4a },
		} );
		const ids = new Set( MERIDIAN_PREMIUM.ids );
		const v = this.market;
		v.premium = MERIDIAN_PREMIUM;
		v.priceFor = ( f ) => ids.has( f.species ) ? Math.round( f.value * MERIDIAN_PREMIUM.mult ) : f.value;
		v.premiumBonus = ( list ) => {

			let extra = 0;
			for ( const f of list || [] ) if ( ids.has( f.species ) ) extra += Math.round( f.value * MERIDIAN_PREMIUM.mult ) - f.value;
			return extra;

		};

		this.vendors = [ this.market, this.chandler ];

	}

	// a stall (front: local +z, toward the water), the vendor behind the counter
	_stall( S, geometry, colliders, tag, opts ) {

		const { x, z, yaw } = S;
		const y = this.terrain && this.terrain.heightAt ? this.terrain.heightAt( x, z ) : 0;
		const g = new Group();
		g.position.set( x, y, z );
		g.rotation.y = yaw;
		const mesh = new Mesh( geometry, this.material );
		mesh.name = tag;
		mesh.castShadow = true;
		g.add( mesh );
		this.group.add( g );
		const c = Math.cos( yaw ), s = Math.sin( yaw );
		const lz = - 0.85;
		const { character, ...rest } = opts;
		const vendor = new Vendor( { ...rest, position: new Vector3( x + lz * s, y + 0.04, z + lz * c ), yaw, radius: 3.2, material: this.material } );
		vendor._lazyCharacter = character;
		this.group.add( vendor.group );
		this.lights.push( { position: new Vector3( x + 1.25 * c + 0.75 * s, y + 2.2, z - 1.25 * s + 0.75 * c ), color: new Color( 1.0, 0.8, 0.55 ), intensity: 7.5, range: 11, kind: 'lantern' } );
		if ( colliders ) colliders.addBox( new Vector3( x, y + 0.5, z ), new Vector3( 1.3, 0.5, 0.45 ), yaw, { tag } );
		return vendor;

	}

	// cameraDistance: from the port's stand (measured here when not given: the island's own distance is to the city's centre)
	update( dt, cameraDistance = null ) {

		if ( ! Number.isFinite( cameraDistance ) ) {

			const cam = cameraPosition();
			cameraDistance = cam ? Math.hypot( cam.x - MERIDIAN_STAND.x, cam.z - MERIDIAN_STAND.z ) : Infinity;

		}

		if ( cameraDistance > LOAD_DIST ) return;
		for ( const v of this.vendors ) {

			if ( ! v._lazyCharacter ) continue;
			const ch = v._lazyCharacter;
			v._lazyCharacter = null;
			v.loadCharacter( ch.url, ch ).catch( ( e ) => console.warn( 'MeridianPort: character failed to load', e ) );

		}

	}

}

// a steel market counter under a blue (or red) awning: ice and fish on the fish market's, rope and tins on the chandler's
function stallGeometry( awning, fish ) {

	const L = [];
	const add = ( g, o ) => L.push( prepare( g, o ) );
	add( box( 2.4, 0.9, 0.7 ), { color: 0x9aa0a3, rough: 0.35, metal: 0.8, matrix: mat4( 0, 0.45, 0 ) } );
	for ( const x of [ - 1.2, 1.2 ] ) for ( const z of [ 0.4, - 1.5 ] ) add( cylinder( 0.04, 0.04, 2.6, 6 ), { color: 0x3a3f44, rough: 0.5, metal: 0.7, matrix: mat4( x, 1.3, z ) } );
	for ( let i = 0; i < 6; i ++ ) add( box( 2.6 / 6, 0.04, 2.3 ), { color: i % 2 ? 0xeeeae0 : awning, rough: 0.9, pattern: PAT.cloth, matrix: mat4( - 1.3 + ( i + 0.5 ) * 2.6 / 6, 2.62, - 0.55, 0.1, 0, 0 ) } );
	if ( fish ) {

		add( box( 2.2, 0.06, 0.6 ), { color: 0xdfe8ea, rough: 0.2, matrix: mat4( 0, 0.94, 0 ) } );
		for ( let i = 0; i < 8; i ++ ) add( sphere( 1, 8, 5 ), { color: [ 0x4a6f9a, 0xd8b04a, 0x8fa6b2, 0xc96a4a ][ i % 4 ], rough: 0.3, metal: 0.4, matrix: mat4( - 0.85 + i * 0.24, 1.02, 0, 0, 0.3 * ( i % 3 - 1 ), 0, 0.11, 0.07, 0.32 ) } );

	} else {

		for ( let i = 0; i < 4; i ++ ) add( cylinder( 0.18, 0.18, 0.12, 12 ), { color: 0xc9b48a, rough: 0.9, pattern: PAT.cloth, matrix: mat4( - 0.8 + i * 0.5, 0.96, 0 ) } );
		for ( let i = 0; i < 3; i ++ ) add( cylinder( 0.08, 0.08, 0.16, 10 ), { color: [ 0xb23a2e, 0x2f5f8a, 0xe9e6dd ][ i ], rough: 0.5, metal: 0.3, matrix: mat4( 0.2 + i * 0.2, 1.0, 0.2 ) } );

	}

	return mergePrepared( L );

}
