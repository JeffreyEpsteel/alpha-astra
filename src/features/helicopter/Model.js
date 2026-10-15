// Authored light utility helicopter: bubble cockpit, panel, cabin, tail boom,
// four main blades, tail rotor, skid gear and rescue paint. Uses native engine materials.
import { Group, Mesh, Vector3 } from '../../engine/index.js';
import { standard } from '../../materials/Materials.js';
import { prepare, mergePrepared, box, roundedBox, cylinder, sphere, rod, torus, mat4 } from '../../world/boat/GeoKit.js';
import { createPropMaterial } from '../../game/GameMaterials.js';

const V = ( x, y, z ) => new Vector3( x, y, z );
export class HelicopterVisual {

	constructor( scene ) {
		this.scene = scene; this.root = new Group(); this.root.name = 'coastal-rescue-helicopter';
		this.geometries = []; this.materials = []; this.meshes = [];
		const solid = createPropMaterial( 'helicopter-rescue-paint' ); this.materials.push( solid );
		const parts = [];
		const add = ( g, color, matrix = null, metal = 0, rough = 0.45 ) => parts.push( prepare( g, { color, matrix, metal, rough } ) );
		const jade = 0x157d79, cream = 0xf6e8bd, black = 0x18272c, metal = 0x667980, rescue = 0xe67232;
		add( sphere( 1, 24, 14 ), jade, mat4( 0, 0.95, 0.2, 0, 0, 0, 1.15, 0.62, 2.1 ) );
		add( sphere( 1, 20, 12 ), jade, mat4( 0, 1.73, - 0.9, 0, 0, 0, 1.1, 0.83, 1.3 ) );
		add( roundedBox( 1.2, 0.5, 1.7, 0.2 ), cream, mat4( 0, 2.4, - 0.9 ) );
		for ( const s of [ - 1, 1 ] ) {
			add( cylinder( 0.19, 0.23, 0.75, 12 ), black, mat4( s * 0.46, 2.35, - 1.82, Math.PI / 2 ) );
			// Skids curve up at their forward ends; two cross-struts tie the cabin to them.
			add( rod( V( s * 1.3, 0.09, - 1.75 ), V( s * 1.3, 0.09, 1.8 ), 0.085 ), metal, null, 0.8 );
			add( rod( V( s * 1.3, 0.09, 1.8 ), V( s * 1.3, 0.35, 2.15 ), 0.085 ), metal, null, 0.8 );
			for ( const z of [ - 1, 1 ] ) add( rod( V( s * 1.3, 0.17, z ), V( s * 0.65, 0.85, z ), 0.07 ), metal, null, 0.8 );
			// Door frames and handles, cream rescue stripes, red/green navigation lamps.
			add( rod( V( s * 1.05, 1.1, 0.6 ), V( s * 0.84, 2.23, 0.6 ), 0.035 ), cream );
			add( box( 0.06, 0.16, 2.3 ), cream, mat4( s * 1.08, 1.09, - 0.2 ) );
			add( box( 0.06, 0.08, 0.35 ), black, mat4( s * 1.13, 1.4, 0.15 ) );
			add( sphere( 0.08, 8, 6 ), s > 0 ? 0xe93333 : 0x37e67d, mat4( s * 1.14, 1.24, - 0.8 ) );
			add( roundedBox( 0.58, 0.16, 0.64, 0.06 ), black, mat4( s * 0.5, 0.96, 0.45 ) );
			add( roundedBox( 0.58, 0.8, 0.15, 0.05 ), black, mat4( s * 0.5, 1.34, 0.1, - 0.08 ) );
			add( rod( V( s * 0.5, 1, 1.25 ), V( s * 0.5, 1.44, 1.2 ), 0.025 ), black );
		}
		add( rod( V( 0, 1.63, - 1.45 ), V( 0, 2.08, - 7.05 ), 0.38, 16, 0.11 ), jade );
		add( box( 2.5, 0.09, 0.7 ), cream, mat4( 0, 1.94, - 5.6, 0.04 ) );
		add( box( 0.1, 1.7, 0.72 ), rescue, mat4( 0, 2.42, - 6.87, - 0.22 ) );
		add( rod( V( 0, 2.5, - 0.4 ), V( 0, 3.12, - 0.4 ), 0.08 ), metal, null, 0.9 );
		add( cylinder( 0.26, 0.26, 0.15, 12 ), black, mat4( 0, 3.1, - 0.4 ) );
		// Central windshield bar, panel, instrument rings, overhead beacon and nose searchlight.
		add( rod( V( 0, 1.15, 2.15 ), V( 0, 2.2, 1.65 ), 0.035 ), cream );
		add( roundedBox( 1.6, 0.45, 0.32, 0.06 ), black, mat4( 0, 1.35, 1.76, - 0.18 ) );
		this.gauges = [];
		for ( const x of [ - 0.55, - 0.18, 0.18, 0.55 ] ) {
			add( cylinder( 0.135, 0.135, 0.025, 20 ), cream, mat4( x, 1.42, 1.57, Math.PI / 2 ), 0.3 );
			add( cylinder( 0.115, 0.115, 0.03, 20 ), black, mat4( x, 1.42, 1.55, Math.PI / 2 ) );
		}
		add( sphere( 0.105, 10, 8 ), rescue, mat4( 0, 2.77, - 1.1 ) );
		add( sphere( 0.15, 10, 8 ), cream, mat4( 0, 0.89, 2.06 ) );
		this._mesh( mergePrepared( parts ), solid, this.root, 'airframe' );
		// Transparent bubble leaves a real cockpit view through the native forward renderer.
		const glass = standard( { color: 0x9dd5dd, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.19, depthWrite: false, side: 2 } );
		this.materials.push( glass );
		this._mesh( sphere( 1, 28, 18 ), glass, this.root, 'bubble-canopy' ).scale.set( 1.13, 0.9, 1.62 );
		this.meshes[ this.meshes.length - 1 ].position.set( 0, 1.65, 0.72 );
		this.mainRotor = new Group(); this.mainRotor.position.set( 0, 3.19, - 0.4 ); this.root.add( this.mainRotor );
		const blades = [];
		for ( let n = 0; n < 4; n ++ ) {
			const a = n * Math.PI / 2;
			blades.push( prepare( box( 0.24, 0.045, 4.7 ), { color: black, rough: 0.35, metal: 0.4, matrix: mat4( Math.sin( a ) * 2.7, 0, Math.cos( a ) * 2.7, 0, a ) } ) );
			blades.push( prepare( box( 0.25, 0.048, 0.35 ), { color: cream, matrix: mat4( Math.sin( a ) * 4.88, 0, Math.cos( a ) * 4.88, 0, a ) } ) );
		}
		this._mesh( mergePrepared( blades ), solid, this.mainRotor, 'main-rotor-four-blades' );
		this.tailRotor = new Group(); this.tailRotor.position.set( 0.24, 2.25, - 6.95 ); this.root.add( this.tailRotor );
		const tail = [];
		for ( let n = 0; n < 2; n ++ ) tail.push( prepare( box( 0.05, 1.5, 0.12 ), { color: n ? cream : black, matrix: mat4( 0, 0, 0, n * Math.PI / 2 ) } ) );
		this._mesh( mergePrepared( tail ), solid, this.tailRotor, 'tail-rotor' );
		for ( const x of [ - 0.55, - 0.18, 0.18, 0.55 ] ) {
			const pivot = new Group(); pivot.position.set( x, 1.42, 1.524 ); this.root.add( pivot );
			this._mesh( prepare( box( 0.012, 0.085, 0.012 ), { color: rescue, matrix: mat4( 0, 0.025, 0 ) } ), solid, pivot, 'instrument-needle' );
			this.gauges.push( pivot );
		}
		scene?.add?.( this.root );
	}

	_mesh( g, m, parent, name ) {
		this.geometries.push( g ); const mesh = new Mesh( g, m ); mesh.name = name;
		mesh.castShadow = name === 'airframe'; mesh.receiveShadow = true; parent.add( mesh ); this.meshes.push( mesh ); return mesh;
	}
	setPose( p, q ) { this.root.position.copy( p ); this.root.quaternion.copy( q ); }
	spin( dt, rpm = 0, flight = null ) {
		this.mainRotor.rotation.y = ( this.mainRotor.rotation.y + dt * rpm * 38 ) % ( Math.PI * 2 );
		this.tailRotor.rotation.x = ( this.tailRotor.rotation.x + dt * rpm * 64 ) % ( Math.PI * 2 );
		const values = [ rpm, flight ? Math.min( 1, flight.velocity.length() / 40 ) : 0, flight ? Math.min( 1, flight.position.y / 800 ) : 0, flight ? 0.5 + flight.velocity.y / 15 : 0.5 ];
		this.gauges.forEach( ( g, i ) => { g.rotation.z = 2.3 - values[ i ] * 4.6; } );
	}
	dispose() { this.scene?.remove?.( this.root ); this.geometries.forEach( g => g.dispose() ); this.materials.forEach( m => m.dispose() ); }
}

export function buildHelipad( scene, x, y, z ) {
	const parts = [];
	const add = ( g, color, matrix ) => parts.push( prepare( g, { color, matrix, rough: 0.85 } ) );
	add( cylinder( 6.7, 6.7, 0.4, 48 ), 0x3c4749, mat4( 0, - 0.2, 0 ) );
	add( torus( 5.4, 0.08, 4, 48 ), 0xf5dc98, mat4( 0, 0.02, 0, Math.PI / 2 ) );
	for ( const dx of [ - 1.15, 1.15 ] ) add( box( 0.32, 0.025, 3 ), 0xf5dc98, mat4( dx, 0.025, 0 ) );
	add( box( 2.3, 0.025, 0.32 ), 0xf5dc98, mat4( 0, 0.025, 0 ) );
	// Orange service bollard at the safe side of the rotor disk.
	add( box( 0.6, 1.1, 0.6 ), 0xe67232, mat4( 6.9, 0.55, 0 ) );
	const geo = mergePrepared( parts ), mat = createPropMaterial( 'coastal-helipad' ), mesh = new Mesh( geo, mat );
	mesh.name = 'coastal-rescue-helipad'; mesh.position.set( x, y, z ); mesh.receiveShadow = true; scene?.add?.( mesh );
	return { mesh, dispose() { scene?.remove?.( mesh ); geo.dispose(); mat.dispose(); } };
}
