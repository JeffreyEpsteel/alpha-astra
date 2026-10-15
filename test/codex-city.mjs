// Regressions against the authored car assets and actual Meridian collision handles. No browser/GPU required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BufferGeometry, BufferAttribute, Matrix4, Quaternion, Vector3 } from '../src/engine/index.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { buildMeshShader } from '../src/engine/render/MeshShader.js';
import { KINDS } from '../src/features/cars/CarData.js';
import { splitCarTrimGeometry, openCarCabin, carCabinGeometry, carCabinBounds } from '../src/features/cars/CarRender.js';
import { createFacadeMaterial, Acc, buildingInto } from '../src/world/islands/meridian/Facades.js';
import { Meridian } from '../src/world/islands/meridian/Meridian.js';
import { Colliders } from '../src/world/Colliders.js';
import { Features } from '../src/features/Features.js';
import * as citywreck from '../src/features/citywreck/index.js';
import { Collapse, heap } from '../src/features/citywreck/Looks.js';

let checks = 0;
const check = ( result, name ) => { assert.ok( result, name ); checks ++; console.log( 'ok', name ); };

function authoredGeometry( gltf, materialName ) {

	let found;
	const visit = ( ni, parent ) => {

		const node = gltf.nodes[ ni ];
		const matrix = new Matrix4().multiplyMatrices( parent, new Matrix4().compose( new Vector3( ...node.t ), new Quaternion( ...node.r ), new Vector3( ...node.s ) ) );
		for ( const p of gltf.meshes[ node.mesh ] || [] ) if ( gltf.materials[ p.material ].name === materialName ) {

			const g = new BufferGeometry();
			for ( const [ k, name ] of [ [ 'POSITION', 'position' ], [ 'NORMAL', 'normal' ], [ 'TEXCOORD_0', 'uv' ] ] ) {

				const a = p.attributes[ k ];
				if ( a ) g.setAttribute( name, new BufferAttribute( new Float32Array( a.array ), a.itemSize ) );

			}
			g.setIndex( Array.from( p.indices ) ); g.applyMatrix4( matrix );
			found = g;

		}
		for ( const c of node.children ) visit( c, matrix );

	};
	for ( const r of gltf.roots ) visit( r, new Matrix4() );
	return found;

}

function surfaceArea( geometry ) {

	const p = geometry.attributes.position.array, ids = geometry.index?.array || Array.from( { length: p.length / 3 }, ( _, i ) => i );
	let area = 0;
	for ( let i = 0; i < ids.length; i += 3 ) {

		const [ a, b, c ] = [ ids[ i ], ids[ i + 1 ], ids[ i + 2 ] ].map( j => new Vector3( ...p.slice( j * 3, j * 3 + 3 ) ) );
		area += b.sub( a ).cross( c.sub( a ) ).length() / 2;

	}
	return area;

}

for ( const [ kind, spec ] of Object.entries( KINDS ) ) {

	const file = readFileSync( new URL( '../public/models/' + spec.glb, import.meta.url ) );
	const gltf = parseGLB( file.buffer.slice( file.byteOffset, file.byteOffset + file.byteLength ) );
	const trim = authoredGeometry( gltf, 'CarTrim' ), paint = authoredGeometry( gltf, 'CarPaint' );
	const split = splitCarTrimGeometry( trim );
	check( split.glass.attributes.position.count > 0 && split.trim.attributes.position.count > 0, kind + ': glass separated from opaque trim' );
	check( split.glass.attributes.position.count + split.trim.attributes.position.count === trim.index.count, kind + ': every original trim triangle retained exactly once' );
	const bounds = carCabinBounds( spec, split.glass );
	const open = openCarCabin( paint, bounds );
	check( surfaceArea( open ) < surfaceArea( paint ) - 0.1 && surfaceArea( open ) > surfaceArea( paint ) / 2, kind + ': cabin opened without deleting body' );
	const cabin = carCabinGeometry( spec, bounds );
	check( cabin.attributes.position.count > 100 && cabin.attributes.color.count === cabin.attributes.position.count, kind + ': furnished cabin with distinct colored surfaces' );
	check( Array.from( cabin.attributes.position.array ).every( Number.isFinite ), kind + ': finite cabin geometry' );
	const eye = new Vector3( ...spec.eye ), direction = new Vector3( 0, 0, 1 );
	// Raycast opaque shell at the actual driver's eye, to catch a misplaced roof/pillar blocking the windscreen.
	const positions = open.attributes.position.array;
	let blocksView = false;
	for ( let i = 0; i < positions.length; i += 9 ) {

		const a = new Vector3( ...positions.slice( i, i + 3 ) ), b = new Vector3( ...positions.slice( i + 3, i + 6 ) ), c = new Vector3( ...positions.slice( i + 6, i + 9 ) );
		const e1 = b.clone().sub( a ), e2 = c.clone().sub( a ), h = direction.clone().cross( e2 ), det = e1.dot( h );
		if ( Math.abs( det ) < 1e-8 ) continue;
		const s = eye.clone().sub( a ), u = s.dot( h ) / det, q = s.clone().cross( e1 ), v = direction.dot( q ) / det, t = e2.dot( q ) / det;
		if ( u >= 0 && v >= 0 && u + v <= 1 && t > 0 && t < spec.len ) blocksView = true;

	}
	check( ! blocksView, kind + ': driver has an unobstructed forward view through windshield' );
	for ( const g of [ trim, paint, split.trim, split.glass, open, cabin ] ) g.dispose();

}

const material = createFacadeMaterial();
const shader = buildMeshShader( material, [ { name: 'position', wgsl: 'vec3f', location: 0 }, { name: 'normal', wgsl: 'vec3f', location: 1 }, { name: 'uv', wgsl: 'vec2f', location: 2 }, { name: 'color', wgsl: 'vec4f', location: 3 }, { name: 'aux', wgsl: 'vec4f', location: 4 } ], { kind: 'main' } );
const code = typeof shader === 'string' ? shader : shader.code;
check( code.includes( '@interpolate( flat ) vFacadeAux: vec4u' ), 'facade identity is flat across each triangle, eliminating unstable seed interpolation' );
const facadeHelpers = material.modules.map( m => m.code ).join( '\n' );
check( ! facadeHelpers.includes( 'fract( sin( dot( p' ) && facadeHelpers.includes( '1597334677u' ), 'facade window hash uses deterministic integer arithmetic' );

const colliders = new Colliders();
const city = new Meridian( { scene: null, colliders, kit: false } );
const app = { settings: { timeOfDay: 9 }, meridian: city };
const features = new Features( app );
const wreck = features.add( 'citywreck', { install: ( a, f ) => citywreck.install( a, f, { city, render: false } ) } );
for ( const id of [ 'twin-north', 'twin-south' ] ) {

	const h = city.building( id ), b = h.plan, top = b.y + b.h, x = b.x + 18, z = b.z;
	check( city.landingSurfaceAt( x, z, top + 1 )?.y === top, id + ': perimeter roof is landable' );
	check( colliders.groundHeightAt( x, z, top + 0.3 ) === top, id + ': player can walk on roof' );
	check( city.landingSurfaceAt( x, z, top - 0.1 ) === null, id + ': surface cannot be selected from below' );
	check( city.landingSurfaceAt( b.x + b.w / 2 + 0.1, z ) === null && city.landingSurfaceAt( b.x + b.w / 2 - 0.1, b.z + b.d / 2 - 0.1 ) === null, id + ': outside footprint and clipped roof corners do not support landing' );
	check( city.landingSurfaceAt( x, z, top + 1, 6 ) === null, id + ': landing footprint must fit inside the roof' );
	check( city.landingSurfaceAt( b.x + ( id === 'twin-north' ? 8 : 0 ), b.z )?.y === top + ( id === 'twin-south' ? 10 : 6 ), id + ': plant/pavilion roof heights match rendered geometry' );
	if ( id === 'twin-north' ) check( city.landingSurfaceAt( b.x, b.z ) === null, 'north antenna is an obstacle, not a landing pad' );
	check( colliders.raycast( new Vector3( b.x + 50, top - 10, b.z ), new Vector3( - 1, 0, 0 ), 100 ) < 50, id + ': solid facade still blocks side approaches' );
	const acc = new Acc(); buildingInto( acc, b, { stage: 3 } );
	const geometry = acc.geometry(); geometry.computeBoundingBox();
	check( geometry.boundingBox.max.y <= b.y + 4.001, id + ': collapsed facade contains no hidden full-height tower or mast' );
	geometry.dispose();
	// A visual collapse awaiting the renderer must already remove the roof from physics.
	wreck.render = { draw() {}, dispose() {} };
	const model = wreck.model.byId.get( id );
	wreck.model.hit( id, model.hp * 2, { cause: 'blast', by: 'player' } );
	check( model.stage === 3 && wreck.queue.includes( model ) && h.stage < 3 && city.landingSurfaceAt( x, z ) === null, id + ': authoritative collapse removes roof while animation is queued' );
	check( colliders.groundHeightAt( x, z, top + 1 ) < top && h.colliders[ 0 ].top <= b.y + 4, id + ': no ghost player ground or facade remains high in the air' );
	const collapse = new Collapse( model, 56 );
	const settled = collapse.at( collapse.duration );
	const target = heap( model, 110 ).filter( p => p.big );
	check( settled.every( p => target.some( t => Math.hypot( p.p[ 0 ] - t.p[ 0 ], p.p[ 1 ] - t.p[ 1 ], p.p[ 2 ] - t.p[ 2 ] ) < 1e-5 ) ), id + ': all falling tower chunks reach rubble before animation ends' );
	wreck.model.reset();
	check( city.landingSurfaceAt( x, z, top + 1 )?.y === top && colliders.groundHeightAt( x, z, top + 1 ) === top, id + ': rebuilding/reset restores roof support' );

}
wreck.dispose(); city.dispose(); material.dispose();
console.log( `${ checks } city/car regression checks passed` );
