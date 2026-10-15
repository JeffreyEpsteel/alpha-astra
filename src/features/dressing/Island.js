// Pons Cove's land cover: coconut palms ( the same instanced geometry, wind material and distance LOD as the main island's
// Vegetation.js, built here as one extra VegType ) and a scatter of rocks ( the terrain's own RockGeometry in four shapes,
// four instanced draws ).
//
//   const isle = new PonsIsland( { scene, terrain, colliders, palms: Sites.palmSites(...), rocks: Sites.rockSites(...) } );
//   isle.update( cameraPosition )       // palms re-bucket near / far when the camera has moved a few metres
//   isle.stats()  isle.dispose()
//
// Draw calls: palm near + palm far + 4 rock shapes = 6. The palms cast shadows only close up ( near level ); rocks cast
// shadows. Underwater lighting: palms 'none' ( they never reach the water ), rocks 'lite' ( the ones at the waterline are
// half in the sea ).

import { Group, InstancedMesh, Matrix4, Quaternion, Vector3, Euler } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { VegType } from '../../world/vegetation/InstanceLOD.js';
import { buildPalmNear, buildPalmFar } from '../../world/vegetation/PlantGeometry.js';
import { createPlantLeafMaterial } from '../../world/vegetation/VegMaterials.js';
import { uCamPos } from '../../world/vegetation/VegNodes.js';
import { buildRockGeometry, ROCK_STYLES } from '../../world/terrain/RockGeometry.js';
import { getDetailTexture } from '../../world/terrain/DetailTextures.js';

const PALM_NEAR = 120; // m, full detail ( Vegetation.js )
const CANOPY_FAR = [ 2600, 2800 ];
const ROCK_NEAR_SUBDIV = 3;

const ROCK_SURFACE = /* wgsl */`
	let p = in.P;
	let h1 = fract( sin( dot( floor( p.xz * 2.4 ), vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
	let h2 = fract( sin( dot( floor( p.xy * 3.7 + p.zy * 1.9 ), vec2f( 39.3468, 11.135 ) ) ) * 24634.6345 );
	var c = mix( vec3f( 0.30, 0.28, 0.25 ), vec3f( 0.55, 0.52, 0.46 ), h1 * 0.55 + h2 * 0.45 );
	// salt-stained and darker near the water, a little sun-bleached on top
	let wet = 1.0 - smoothstep( 0.0, 1.1, p.y );
	c = mix( c, c * vec3f( 0.6, 0.66, 0.58 ), wet * 0.7 );
	c = mix( c, c * 1.15, smoothstep( 0.6, 1.0, in.N.y ) * 0.4 );
	s.albedo = pow( c, vec3f( 2.2 ) );
	s.roughness = mix( 0.88, 0.5, wet );
	s.ao = clamp( in.vs.vAo, 0.0, 1.0 );
`;

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _e = new Euler();

export class PonsIsland {

	constructor( { scene, terrain, colliders = null, palms = [], rocks = [] } ) {

		this.scene = scene;
		this.group = new Group();
		this.group.name = 'dress-pons-island';
		this.palmRecords = palms;
		this.rockSites = rocks;
		this.camPos = new Vector3();

		// ---- palms
		this.palms = null;
		if ( palms.length ) {

			// the palm material samples the terrain detail texture; make sure it exists now ( outside a render pass ), not on first draw
			getDetailTexture();
			this.leafMat = createPlantLeafMaterial();
			this.leafMat.underwaterLighting = 'none';
			this.leafMat.localLightsCheap = true;
			const near = buildPalmNear(), far = buildPalmFar();
			this.palmTris = { near: near.triangles, far: far.triangles };
			this.palms = new VegType( 'ponsPalms', palms, {
				nearRange: PALM_NEAR, margin: 10, refreshDistance: 6, farExcludeNear: true, sortNear: true,
				near: [ { geometry: near.geometry, material: this.leafMat, castShadow: true, name: 'pons-palm' } ],
				far: { parts: [ { geometry: far.geometry, material: this.leafMat, name: 'pons-palm-far' } ], fade: CANOPY_FAR },
			} );
			for ( const m of this.palms.meshes ) {

				m.renderOrder = 1;
				m.staticVelocity = true;
				this.group.add( m );

			}

		}

		// ---- rocks: one instanced mesh per shape
		this.rockMeshes = [];
		this.rockMat = new Material( {
			name: 'pons-rock', roughness: 0.88, underwaterLighting: 'lite',
			attributes: { ao: 'f32' }, varyings: { vAo: 'f32' }, vertex: 'o.vAo = v.ao;', surface: ROCK_SURFACE,
		} );
		for ( let st = 0; st < ROCK_STYLES.length; st ++ ) {

			const members = rocks.filter( ( r ) => r.style === st );
			if ( ! members.length ) continue;
			const geo = buildRockGeometry( st, 17 + st * 101, ROCK_NEAR_SUBDIV );
			const im = new InstancedMesh( geo, this.rockMat, members.length );
			im.name = 'pons-rocks-' + ROCK_STYLES[ st ].name;
			im.frustumCulled = false;
			im.staticVelocity = true;
			im.castShadow = true;
			im.receiveShadow = true;
			const sc = ROCK_STYLES[ st ].scale;
			members.forEach( ( r, i ) => {

				_e.set( r.tiltX, r.yaw, r.tiltZ, 'YXZ' );
				_q.setFromEuler( _e );
				// sit on the lowest ground under it, sunk by a fraction of its height ( Rocks.js )
				_m.compose( _p.set( r.x, r.y - r.size * r.sy * sc[ 1 ] * r.sink, r.z ), _q, _s.set( r.size, r.size * r.sy, r.size ) );
				im.setMatrixAt( i, _m );
				if ( colliders && r.size >= 0.9 && r.y + r.size * r.sy * 0.8 > - 0.3 ) colliders.addCylinder( r.x, r.z, r.size * 0.75, r.y - r.size * 0.5, r.y + r.size * r.sy * 0.8, { tag: 'ponsRock' } );

			} );
			im.count = members.length;
			this.group.add( im );
			this.rockMeshes.push( im );

		}

		scene.add( this.group );

	}

	update( cam ) {

		if ( ! this.palms ) return;
		// the wind material reads the camera position from the vegetation uniform block ( Vegetation.update sets the same value )
		uCamPos.value.set( cam.x, cam.y, cam.z );
		this.camPos.set( cam.x, cam.y, cam.z );
		if ( this.palms.overdue( this.camPos ) > 0 ) this.palms.update( this.camPos, true );

	}

	stats() {

		const near = this.palms && this.palms.near ? this.palms.near.count : 0, far = this.palms && this.palms.far ? this.palms.far.count : 0;
		return {
			palms: this.palmRecords.length, palmsNear: near, palmsFar: far, rocks: this.rockSites.length,
			draws: ( near ? 1 : 0 ) + ( far ? 1 : 0 ) + this.rockMeshes.length,
		};

	}

	dispose() {

		this.scene.remove( this.group );
		if ( this.palms ) for ( const m of this.palms.meshes ) m.geometry.dispose();
		for ( const m of this.rockMeshes ) m.geometry.dispose();
		if ( this.leafMat ) this.leafMat.dispose();
		this.rockMat.dispose();

	}

}
