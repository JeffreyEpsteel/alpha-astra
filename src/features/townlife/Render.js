import { InstancedMesh, Matrix4, Quaternion, Vector3, Color } from '../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, torus, mat4 } from '../../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { G } from '../../core/Globals.js';

// townlife's instanced draws: the far crowd (a cheap figure per citizen beyond the avatars' reach: one draw for a whole
// town), what the near ones carry (a crate, a wheelbarrow, the watch's lantern: its glass glows at night) and the local
// skiffs with their rower. Every list is refilled each frame from plain records:
//   const R = new TownMeshes( scene, { crowd: 80, props: 16, skiffs: 6 } );
//   R.begin(); R.peg( x, y, z, yaw, scale, tint, phase ); R.crate( ... ); R.barrow( ... ); R.lantern( ... ); R.skiff( ... ); R.end();

const _m = new Matrix4(), _q = new Quaternion(), _q2 = new Quaternion(), _ax = new Vector3(), _p = new Vector3(), _s = new Vector3(), _c = new Color(), _y = new Vector3( 0, 1, 0 );

// a person in a few boxes (1.65 m, facing +z; the rig convention of the avatars is turned by yaw + PI like theirs)
function pegGeometry() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, { rough: 0.9, ...o } ) );
	for ( const s of [ - 1, 1 ] ) {

		add( box( 0.13, 0.78, 0.15 ), { color: 0x4a4a52, pattern: PAT.cloth, matrix: mat4( s * 0.09, 0.39, 0 ) } );
		add( box( 0.09, 0.62, 0.1 ), { color: 0xe8e4dc, pattern: PAT.cloth, matrix: mat4( s * 0.25, 1.12, 0, 0, 0, s * 0.08 ) } );

	}

	add( box( 0.38, 0.62, 0.22 ), { color: 0xf2efe8, pattern: PAT.cloth, matrix: mat4( 0, 1.1, 0 ) } );
	add( sphere( 0.12, 8, 6 ), { color: 0xc8a07a, pattern: PAT.skin, matrix: mat4( 0, 1.53, 0.01 ) } );
	return mergePrepared( P );

}

function crateGeometry() {

	return mergePrepared( [
		prepare( box( 0.42, 0.32, 0.34 ), { color: 0x8a6a46, rough: 0.9, pattern: PAT.woodX } ),
		prepare( box( 0.44, 0.04, 0.36 ), { color: 0x5a4632, rough: 0.9, matrix: mat4( 0, 0.15, 0 ) } ),
	] );

}

// a wheelbarrow, its wheel ahead at +z, handles back at -z (the pusher stands behind them)
function barrowGeometry() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, { rough: 0.85, ...o } ) );
	add( box( 0.55, 0.28, 0.7 ), { color: 0x7a6248, pattern: PAT.woodX, matrix: mat4( 0, 0.5, 0.15, 0.08, 0, 0 ) } );
	for ( const s of [ - 1, 1 ] ) {

		add( box( 0.05, 0.05, 1.3 ), { color: 0x5a4632, pattern: PAT.wood, matrix: mat4( s * 0.25, 0.45, - 0.1, 0.12, 0, 0 ) } );
		add( box( 0.04, 0.32, 0.04 ), { color: 0x4a3a2a, matrix: mat4( s * 0.22, 0.2, - 0.25 ) } );

	}

	add( torus( 0.17, 0.035, 6, 14 ), { color: 0x3a3430, metal: 0.5, matrix: mat4( 0, 0.19, 0.62, 0, Math.PI / 2, 0 ) } );
	for ( let i = 0; i < 3; i ++ ) add( sphere( 0.12, 7, 5 ), { color: [ 0x9a7a3a, 0x6a8a3a, 0xa86a3a ][ i ], matrix: mat4( - 0.12 + i * 0.12, 0.68, 0.1 + ( i % 2 ) * 0.12 ) } );
	return mergePrepared( P );

}

function lanternFrameGeometry() {

	return mergePrepared( [
		prepare( cylinder( 0.035, 0.09, 0.05, 8 ), { color: 0x2a2a2a, rough: 0.5, metal: 0.6, matrix: mat4( 0, 0.15, 0 ) } ),
		prepare( cylinder( 0.09, 0.07, 0.03, 8 ), { color: 0x2a2a2a, rough: 0.5, metal: 0.6, matrix: mat4( 0, - 0.13, 0 ) } ),
		prepare( torus( 0.06, 0.008, 4, 10 ), { color: 0x2a2a2a, metal: 0.6, matrix: mat4( 0, 0.22, 0, 0, Math.PI / 2, 0 ) } ),
	] );

}

// a small open boat (bow +z) with a rower facing aft, oars out
function skiffGeometry() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, { rough: 0.85, ...o } ) );
	add( box( 1.2, 0.42, 3.4 ), { color: 0x2f6f7a, pattern: PAT.woodX, matrix: mat4( 0, 0.12, 0 ) } );
	add( box( 0.8, 0.32, 0.9 ), { color: 0x2f6f7a, pattern: PAT.woodX, matrix: mat4( 0, 0.17, 1.9, 0, Math.PI / 4, 0, 1, 1, 1 ) } );
	add( box( 1.06, 0.06, 3.2 ), { color: 0x8a7a62, pattern: PAT.wood, matrix: mat4( 0, 0.3, 0 ) } );
	add( box( 1.25, 0.06, 3.45 ), { color: 0xe8e2d0, matrix: mat4( 0, 0.36, 0 ) } );
	add( box( 1.1, 0.05, 0.25 ), { color: 0x6a5a46, matrix: mat4( 0, 0.42, - 0.2 ) } );
	// the rower (a figure seated on the thwart, facing aft)
	add( box( 0.36, 0.52, 0.22 ), { color: 0xd8c8a0, pattern: PAT.cloth, matrix: mat4( 0, 0.8, - 0.2, 0.2, 0, 0 ) } );
	add( sphere( 0.12, 8, 6 ), { color: 0xb88a62, pattern: PAT.skin, matrix: mat4( 0, 1.16, - 0.28 ) } );
	add( cylinder( 0.15, 0.17, 0.06, 10 ), { color: 0xb8a070, matrix: mat4( 0, 1.27, - 0.28 ) } );
	for ( const s of [ - 1, 1 ] ) add( cylinder( 0.025, 0.025, 2.6, 5 ), { color: 0xc8b088, pattern: PAT.wood, matrix: mat4( s * 0.95, 0.55, - 0.25, 0, 0, s * 1.2 ) } );
	// a basket of fish aft
	add( cylinder( 0.22, 0.18, 0.25, 10 ), { color: 0x9a7a4a, pattern: PAT.cloth, matrix: mat4( 0, 0.45, - 1.2 ) } );
	return mergePrepared( P );

}

class List {

	constructor( scene, geometry, material, cap, name, { shadow = true } = {} ) {

		this.mesh = new InstancedMesh( geometry, material, cap );
		this.mesh.name = name;
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = shadow;
		this.mesh.count = 0;
		this.mesh.setColorAt( 0, _c.setRGB( 1, 1, 1 ) );
		this.cap = cap;
		this.n = 0;
		scene.add( this.mesh );

	}

	push( x, y, z, yaw, scale = 1, tint = null, pitch = 0, roll = 0 ) {

		if ( this.n >= this.cap ) return;
		_q.setFromAxisAngle( _y, yaw );
		if ( pitch || roll ) {

			_q.multiply( _q2.setFromAxisAngle( _ax.set( 1, 0, 0 ), pitch ) );
			if ( roll ) _q.multiply( _q2.setFromAxisAngle( _ax.set( 0, 0, 1 ), roll ) );

		}

		_m.compose( _p.set( x, y, z ), _q, _s.set( scale, scale, scale ) );
		this.mesh.setMatrixAt( this.n, _m );
		if ( tint ) this.mesh.setColorAt( this.n, _c.setRGB( tint[ 0 ], tint[ 1 ], tint[ 2 ] ) );
		else this.mesh.setColorAt( this.n, _c.setRGB( 1, 1, 1 ) );
		this.n ++;

	}

	end() {

		const m = this.mesh;
		m.count = this.n;
		m.visible = this.n > 0;
		m.instanceMatrix.needsUpdate = true;
		if ( m.instanceColor ) m.instanceColor.needsUpdate = true;

	}

	dispose( scene ) {

		scene.remove( this.mesh );
		this.mesh.dispose();

	}

}

export class TownMeshes {

	constructor( scene, { crowd = 80, props = 16, skiffs = 6 } = {} ) {

		this.scene = scene;
		this.material = createPropMaterial( 'townlife' );
		this.glass = createPropMaterial( 'townlifeLanterns' );
		this.pegs = new List( scene, pegGeometry(), this.material, crowd, 'townlife-crowd' );
		this.crates = new List( scene, crateGeometry(), this.material, props, 'townlife-crates' );
		this.barrows = new List( scene, barrowGeometry(), this.material, props, 'townlife-barrows' );
		this.lanterns = new List( scene, lanternFrameGeometry(), this.material, props, 'townlife-lanterns', { shadow: false } );
		this.glow = new List( scene, mergePrepared( [ prepare( cylinder( 0.07, 0.07, 0.24, 8 ), { color: 0xffd9a0, rough: 0.2 } ) ] ), this.glass, props, 'townlife-lanternGlass', { shadow: false } );
		this.skiffs = new List( scene, skiffGeometry(), this.material, skiffs, 'townlife-skiffs' );
		this.lists = [ this.pegs, this.crates, this.barrows, this.lanterns, this.glow, this.skiffs ];

	}

	begin() {

		for ( const l of this.lists ) l.n = 0;

	}

	end() {

		for ( const l of this.lists ) l.end();
		// the lanterns' glass glows from dusk
		const night = Math.max( 0, Math.min( 1, ( ( G.night ? G.night.value : 0 ) - 0.05 ) / 0.5 ) );
		const e = 0.1 + 3.4 * night;
		this.glass.emissive = [ e, e * 0.8, e * 0.5 ];

	}

	dispose() {

		for ( const l of this.lists ) l.dispose( this.scene );

	}

}
