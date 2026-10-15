// The sea chest's mesh: a banded timber chest with a small glowing lantern-gem above it, so it reads from a distance
// on the beach and in the murk of the sea floor. Built only with a scene (nothing in node).
//
//   const mesh = makeChestMesh( scene );  mesh.place( x, y, z, yaw );  mesh.update( dt );  mesh.dispose()

import { BoxGeometry, Group, IcosahedronGeometry, Mesh } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';

export function makeChestMesh( scene ) {

	if ( ! scene ) return null;
	const body = new BoxGeometry( 0.9, 0.5, 0.58 );
	const lid = new BoxGeometry( 0.94, 0.16, 0.62 );
	const band = new BoxGeometry( 0.08, 0.68, 0.64 );
	const gem = new IcosahedronGeometry( 0.16, 0 );
	const wood = new Material( { name: 'dt-chest', color: 0x6b4423, roughness: 0.82, underwaterLighting: 'lite' } );
	const iron = new Material( { name: 'dt-chest-iron', color: 0x2a2a2e, roughness: 0.5, metalness: 0.7, underwaterLighting: 'lite' } );
	const glow = new Material( { name: 'dt-chest-glow', color: 0xf0c060, emissive: [ 2.2, 1.5, 0.45 ], roughness: 0.3, metalness: 0.6, underwaterLighting: 'lite' } );
	const g = new Group();
	g.name = 'sea-chest';
	const b = new Mesh( body, wood );
	b.position.y = 0.25;
	b.castShadow = true;
	const l = new Mesh( lid, wood );
	l.position.y = 0.58;
	l.castShadow = true;
	g.add( b, l );
	for ( const x of [ - 0.3, 0.3 ] ) {

		const s = new Mesh( band, iron );
		s.position.set( x, 0.34, 0 );
		g.add( s );

	}

	const f = new Mesh( gem, glow );
	f.position.y = 1.35;
	g.add( f );
	scene.add( g );
	let t = 0;
	return {
		group: g,
		place( x, y, z, yaw = 0 ) {

			g.position.set( x, y, z );
			g.rotation.y = yaw;

		},
		update( dt ) {

			t += dt;
			f.position.y = 1.35 + Math.sin( t * 1.6 ) * 0.08;
			f.rotation.y = t * 0.9;

		},
		dispose() {

			scene.remove( g );
			for ( const geo of [ body, lid, band, gem ] ) if ( geo.dispose ) geo.dispose();
			for ( const m of [ wood, iron, glow ] ) if ( m.dispose ) m.dispose();

		},
	};

}
