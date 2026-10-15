import { Group, Mesh, Vector3, Color, CylinderGeometry, BufferGeometry, Float32BufferAttribute } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { LAYERS } from '../../engine/render/SceneRenderer.js';
import { G } from '../../engine/render/Frame.js';
import { prepare, mergePrepared, box, cylinder, sphere, torus, mat4 } from '../boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { Gulls } from '../Gulls.js';
import { WORLD } from '../WorldLayout.js';
import { ISLETS_BY_ID, isletWorld } from '../terrain/IslandShape.js';
import { buildJetty } from './Jetty.js';

// Gull Rock, the rocky islet west-south-west of the harbour (terrain/IslandShape.js ISLETS 'gull'):
// a tiny timber jetty on its one pocket beach, a footpath up the rock and a red-and-white
// lighthouse on the summit pad, with a bird colony on the ledges (perched gulls and nests) and a few gulls circling the tower.
//
//   const rock = new GullRock( { scene, terrain, colliders } );
//   rock.group, rock.lights (add to localLights), rock.update( dt )
//   rock.lighthouse: { x, z, y, height, lampY }   rock.birds: number of perched gulls
//
// The lantern glow follows the night (G.night), a pair of slow beams sweep round at night, and the
// lamp light pulses gently. Engine geometry only (GeoKit), one merged prop mesh plus the lamp glass.

const I = ISLETS_BY_ID.gull;
const D = WORLD.gull.dock;
const STONE = ( c, o = {} ) => ( { color: c, rough: 0.95, ...o } );
const WOOD = ( c, o = {} ) => ( { color: c, rough: 0.9, pattern: PAT.wood, ...o } );
const PAINT = ( c, o = {} ) => ( { color: c, rough: 0.55, ...o } );

const TOWER_H = 11.5; // m, plinth to gallery
const R_BOT = 2.55, R_TOP = 1.8;
const LAMP_H = 1.9;

export class GullRock {

	constructor( { scene, terrain, colliders = null, material = null, birds = true } ) {

		this.terrain = terrain;
		this.material = material || createPropMaterial( 'gullRock' );
		this.group = new Group();
		this.group.name = 'GullRock';
		scene.add( this.group );
		this.lights = [];
		this._t = 0;

		const P = [];
		const add = ( g, o ) => P.push( prepare( g, o ) );
		const jetty = buildJetty( { D, terrain, add, colliders, tag: 'gull', seed: 33 } );
		this.jetty = jetty;
		this.lights.push( ...jetty.lights );
		this._lighthouse( add, colliders );
		this.birds = birds ? this._colony( add ) : 0;
		const mesh = new Mesh( mergePrepared( P ), this.material );
		mesh.name = 'GullRockProps';
		mesh.castShadow = true;
		this.group.add( mesh );

		this._lamp();
		this._beams( scene );
		// a few gulls riding the thermals round the tower (high enough to clear it)
		this.flock = null;
		if ( birds ) {

			const L = this.lighthouse;
			this.flock = new Gulls( { scene, count: 11, center: new Vector3( L.x, 0, L.z ), spread: 50, seed: 41 } );
			const a = this.flock.mesh.geometry.getAttribute( 'gA' );
			for ( let i = 0; i < a.count; i ++ ) {

				a.array[ i * 4 + 2 ] = 26 + ( i % 4 ) * 6; // orbit radius
				a.array[ i * 4 + 3 ] = L.y + 14 + ( i % 5 ) * 5; // height above the sea
				a.array[ i * 4 ] = L.x + ( ( i * 37 ) % 21 - 10 );
				a.array[ i * 4 + 1 ] = L.z + ( ( i * 53 ) % 21 - 10 );

			}

			a.needsUpdate = true;
			this.flock.mesh.name = 'GullRockFlock';

		}

	}

	// the tower on the summit pad, door toward the jetty
	_lighthouse( add, colliders ) {

		const [ x, z ] = isletWorld( I, 0, 0 );
		const y0 = this.terrain.heightAt( x, z );
		const fx = Math.sin( D.heading ), fz = Math.cos( D.heading ); // from the rock toward the jetty
		this.lighthouse = { x, z, y: y0, height: TOWER_H, lampY: y0 + TOWER_H + 0.35 + LAMP_H / 2, door: { x: x + fx * R_BOT, z: z + fz * R_BOT } };

		// stone plinth and a stepped footing
		add( cylinder( 3.2, 3.6, 1.1, 20 ), { ...STONE( 0x6d675e ), matrix: mat4( x, y0 + 0.45, z ) } );
		add( cylinder( 2.85, 3.05, 0.35, 20 ), { ...STONE( 0x7b756b ), matrix: mat4( x, y0 + 1.15, z ) } );

		// the tower: five tapered bands, white with two red stripes
		const bands = [ [ 0.0, 3.2, 0xe9e6dd ], [ 3.2, 5.0, 0xb23a2e ], [ 5.0, 7.6, 0xe9e6dd ], [ 7.6, 9.4, 0xb23a2e ], [ 9.4, TOWER_H, 0xe9e6dd ] ];
		const rAt = ( h ) => R_BOT + ( R_TOP - R_BOT ) * ( h / TOWER_H );
		const base = y0 + 1.3;
		for ( const [ h0, h1, c ] of bands ) {

			add( cylinder( rAt( h1 ), rAt( h0 ), h1 - h0 + 0.02, 24 ), { ...PAINT( c ), matrix: mat4( x, base + ( h0 + h1 ) / 2, z ) } );

		}

		const top = base + TOWER_H;
		// gallery: floor, corbel ring, railing
		add( cylinder( 2.75, 2.75, 0.22, 24 ), { ...STONE( 0x57534c ), matrix: mat4( x, top + 0.1, z ) } );
		add( cylinder( 2.1, 1.8, 0.4, 24 ), { ...STONE( 0x57534c ), matrix: mat4( x, top - 0.2, z ) } );
		add( torus( 2.62, 0.035, 5, 32 ), { ...PAINT( 0x2b2e31, { metal: 0.5 } ), matrix: mat4( x, top + 1.2, z, Math.PI / 2 ) } );
		add( torus( 2.62, 0.03, 5, 32 ), { ...PAINT( 0x2b2e31, { metal: 0.5 } ), matrix: mat4( x, top + 0.75, z, Math.PI / 2 ) } );
		for ( let i = 0; i < 16; i ++ ) {

			const a = i / 16 * Math.PI * 2;
			add( cylinder( 0.03, 0.03, 1.1, 5 ), { ...PAINT( 0x2b2e31, { metal: 0.5 } ), matrix: mat4( x + Math.cos( a ) * 2.62, top + 0.66, z + Math.sin( a ) * 2.62 ) } );

		}

		// lantern room frame: base ring, eight mullions, top ring (the glass is the emissive mesh), roof
		const lampBase = top + 0.21;
		add( cylinder( 1.42, 1.42, 0.2, 16 ), { ...PAINT( 0x2b2e31, { metal: 0.4 } ), matrix: mat4( x, lampBase + 0.1, z ) } );
		for ( let i = 0; i < 8; i ++ ) {

			const a = i / 8 * Math.PI * 2 + Math.PI / 8;
			add( box( 0.09, LAMP_H, 0.09 ), { ...PAINT( 0x2b2e31, { metal: 0.4 } ), matrix: mat4( x + Math.cos( a ) * 1.28, lampBase + 0.2 + LAMP_H / 2, z + Math.sin( a ) * 1.28, 0, - a, 0 ) } );

		}

		const lampTop = lampBase + 0.2 + LAMP_H;
		add( cylinder( 1.38, 1.38, 0.16, 16 ), { ...PAINT( 0x2b2e31, { metal: 0.4 } ), matrix: mat4( x, lampTop + 0.08, z ) } );
		add( cylinder( 0.1, 1.55, 1.1, 16 ), { ...PAINT( 0xb23a2e ), matrix: mat4( x, lampTop + 0.16 + 0.55, z ) } );
		add( sphere( 0.16, 8, 6 ), { ...PAINT( 0x2b2e31, { metal: 0.5 } ), matrix: mat4( x, lampTop + 1.36, z ) } );
		add( cylinder( 0.02, 0.02, 1.4, 5 ), { ...PAINT( 0x2b2e31, { metal: 0.6 } ), matrix: mat4( x, lampTop + 2.0, z ) } );

		// the door (blue, with a stone lintel and two steps), toward the jetty, and slit windows up the stair
		const door = ( lx, ly, lz, ry ) => mat4( x + lx, ly, z + lz, 0, ry, 0 );
		const yawToJetty = Math.atan2( fx, fz );
		const dxr = fx * ( R_BOT + 0.05 ), dzr = fz * ( R_BOT + 0.05 );
		add( box( 1.0, 1.95, 0.22 ), { ...WOOD( 0x2f4a63 ), matrix: door( dxr, base + 0.975, dzr, yawToJetty ) } );
		add( box( 1.35, 0.22, 0.4 ), { ...STONE( 0x6d675e ), matrix: door( fx * ( R_BOT + 0.02 ), base + 2.1, fz * ( R_BOT + 0.02 ), yawToJetty ) } );
		for ( let k = 0; k < 2; k ++ ) add( box( 1.6 - k * 0.2, 0.17, 0.6 ), { ...STONE( 0x7b756b ), matrix: door( fx * ( R_BOT + 0.5 + k * 0.4 ), y0 + 1.3 - 0.1 - k * 0.0, fz * ( R_BOT + 0.5 + k * 0.4 ), yawToJetty ) } );
		for ( let k = 0; k < 4; k ++ ) {

			const a = yawToJetty + 0.9 + k * 1.5;
			const hh = 2.6 + k * 2.3, r = rAt( hh );
			add( box( 0.22, 0.7, 0.2 ), { color: 0x14181b, rough: 0.2, matrix: mat4( x + Math.sin( a ) * r, base + hh, z + Math.cos( a ) * r, 0, a, 0 ) } );

		}

		// the keeper's things at the foot: a coil of rope, two barrels, a crate stack, an upturned dinghy
		const side = [ fz, - fx ];
		const put = ( f, s, fn ) => fn( x + fx * f + side[ 0 ] * s, z + fz * f + side[ 1 ] * s );
		put( 4.4, 2.1, ( px, pz ) => {

			add( cylinder( 0.3, 0.3, 0.8, 12 ), { ...WOOD( 0x5b4a39 ), matrix: mat4( px, y0 + 0.4, pz ) } );
			add( cylinder( 0.3, 0.3, 0.8, 12 ), { ...WOOD( 0x6a5842 ), matrix: mat4( px + 0.62, y0 + 0.4, pz - 0.25 ) } );

		} );
		put( 4.6, - 2.0, ( px, pz ) => {

			add( box( 0.7, 0.5, 0.55 ), { ...WOOD( 0x7b6a52 ), matrix: mat4( px, y0 + 0.25, pz, 0, 0.3, 0 ) } );
			add( box( 0.55, 0.4, 0.45 ), { ...WOOD( 0x6e5e47 ), matrix: mat4( px + 0.1, y0 + 0.7, pz, 0, - 0.2, 0 ) } );

		} );
		put( 1.5, 4.3, ( px, pz ) => {

			// the dinghy: a squashed half-sphere hull, keel up
			add( sphere( 1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2 ), { color: 0x2b5a7a, rough: 0.5, matrix: mat4( px, y0 + 0.02, pz, 0, yawToJetty + 0.5, 0, 1.25, 0.4, 0.55 ) } );
			add( box( 2.0, 0.05, 0.07 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( px, y0 + 0.41, pz, 0, yawToJetty + 0.5, 0 ) } );

		} );

		if ( colliders ) {

			colliders.addCylinder( x, z, 3.3, y0 - 1.5, y0 + TOWER_H + 4, { tag: 'gullLighthouse' } );
			put( 4.4, 2.1, ( px, pz ) => colliders.addCylinder( px + 0.3, pz - 0.1, 0.8, y0 - 0.2, y0 + 0.9, { tag: 'gullBarrels' } ) );

		}

	}

	// the lamp glass: its own mesh and material so the glow can follow the night
	_lamp() {

		const L = this.lighthouse;
		const P = [];
		const y = L.y + 1.3 + TOWER_H + 0.21 + 0.2 + LAMP_H / 2;
		P.push( prepare( cylinder( 1.2, 1.2, LAMP_H, 24, 1, true ), { color: 0xfff1cf, rough: 0.15, matrix: mat4( L.x, y, L.z ) } ) );
		// the lens: a hot core
		P.push( prepare( sphere( 0.42, 12, 8 ), { color: 0xfff6dd, rough: 0.3, matrix: mat4( L.x, y, L.z ) } ) );
		this.lampMaterial = createPropMaterial( 'gullLamp' );
		this.lampMaterial.side = 'double';
		const mesh = new Mesh( mergePrepared( P ), this.lampMaterial );
		mesh.name = 'GullRockLamp';
		mesh.castShadow = false;
		this.group.add( mesh );
		this.lampMesh = mesh;
		this._y = y;

		// the lantern light: a wide warm glow that breathes, plus a cool-white fill low on the gallery
		const lamp = { position: new Vector3( L.x, y, L.z ), color: new Color( 1.0, 0.86, 0.58 ), intensity: 36, range: 80, kind: 'lantern', scale: 1 };
		const self = this;
		lamp.update = function () {

			this.scale = 0.88 + 0.12 * Math.sin( self._t * 1.9 );

		};

		this.lampLight = lamp;
		this.lights.push( lamp );
		this.lights.push( { position: new Vector3( L.door.x, L.y + 2.6, L.door.z ), color: new Color( 1.0, 0.72, 0.42 ), intensity: 5 * 1.5, range: 11, kind: 'lantern', flicker: 0.08 } );

	}

	// two long soft beams sweeping round at night (additive, no depth write)
	_beams( scene ) {

		const L = this.lighthouse;
		const len = 170;
		const geo = new CylinderGeometry( 11, 0.5, len, 14, 1, true );
		geo.translate( 0, len / 2, 0 );
		geo.rotateZ( - Math.PI / 2 ); // +Y -> +X, uv.y 0 at the lamp .. 1 at the far end
		this.beamMaterial = new Material( {
			name: 'gullBeam', lit: false, transparent: true, blending: 'additive', depthWrite: false, side: 'double', velocityWeight: 0,
			underwaterLighting: 'none', color: [ 0, 0, 0 ], emissive: [ 1.6, 1.3, 0.8 ], opacity: 0,
			surface: /* wgsl */`
	let fade = 1.0 - in.uv.y;
	let ndv = abs( dot( normalize( in.N ), normalize( in.V ) ) );
	s.alpha = s.alpha * fade * fade * ndv * ndv;
	s.albedo = vec3f( 0.0 );
`,
		} );
		this.beams = new Group();
		this.beams.name = 'GullRockBeams';
		this.beams.position.set( L.x, this._y, L.z );
		for ( const a of [ 0, Math.PI ] ) {

			const m = new Mesh( geo, this.beamMaterial );
			m.rotation.y = a;
			m.frustumCulled = false;
			m.castShadow = false;
			m.receiveShadow = false;
			m.layers.set( LAYERS.TRANSPARENT );
			this.beams.add( m );

		}

		this.beams.visible = false;
		this.group.add( this.beams );

	}

	// the bird colony: ledge-sitting gulls in clusters, with nests and white streaks on the rock
	_colony( add ) {

		const t = this.terrain, L = this.lighthouse;
		let s = 9187;
		const rnd = () => ( ( s = ( s * 16807 ) % 2147483647 ) / 2147483647 );
		const face = Math.atan2( WORLD.swellDir.x, WORLD.swellDir.y ) + Math.PI; // facing into the wind (from the south)
		const nrm = new Vector3();
		const clear = ( x, z ) => {

			if ( Math.hypot( x - L.x, z - L.z ) < 7.5 ) return false; // the tower and its pad
			// the footpath to the jetty and the dock
			const dx = x - D.start.x, dz = z - D.start.z;
			if ( Math.hypot( dx, dz ) < 9 ) return false;
			return true;

		};

		const centres = [];
		for ( let k = 0; k < 4000 && centres.length < 9; k ++ ) {

			const [ x, z ] = isletWorld( I, ( rnd() - 0.4 ) * 100, ( rnd() - 0.5 ) * 80 );
			const h = t.heightAt( x, z );
			if ( h < 2.5 || h > 22 || ! clear( x, z ) ) continue;
			if ( t.normalAt( x, z, nrm ).y < 0.8 ) continue;
			if ( centres.some( ( c ) => Math.hypot( c[ 0 ] - x, c[ 1 ] - z ) < 8 ) ) continue;
			centres.push( [ x, z ] );

		}

		this.colonies = centres;
		let count = 0;
		const WHITE = 0xf1efe9, GREY = 0x8d979f;
		for ( const [ cx, cz ] of centres ) {

			const n = 6 + Math.floor( rnd() * 5 );
			for ( let i = 0; i < n; i ++ ) {

				const bx = cx + ( rnd() - 0.5 ) * 6.5, bz = cz + ( rnd() - 0.5 ) * 6.5;
				if ( ! clear( bx, bz ) ) continue;
				const by = t.heightAt( bx, bz );
				if ( by < 1.5 ) continue;
				t.normalAt( bx, bz, nrm );
				if ( nrm.y < 0.7 ) continue;
				const yaw = face + ( rnd() - 0.5 ) * 1.2;
				const sc = 0.9 + rnd() * 0.3;
				const B = ( lx, ly, lz, rx = 0, sx = 1, sy = sx, sz = sx ) => mat4( bx, by, bz, 0, yaw, 0, sc ).multiply( mat4( lx, ly, lz, rx, 0, 0, sx, sy, sz ) );
				const brood = rnd() < 0.35; // sitting on a nest: lower, with the straw round it
				const dy = brood ? - 0.02 : 0.06;
				add( sphere( 1, 6, 4 ), { color: WHITE, rough: 0.8, matrix: B( 0, 0.12 + dy, 0, 0, 0.115, 0.1, 0.24 ) } );
				add( sphere( 1, 6, 4 ), { color: GREY, rough: 0.8, matrix: B( 0, 0.2 + dy, - 0.03, 0, 0.12, 0.05, 0.2 ) } );
				add( box( 0.1, 0.02, 0.1 ), { color: 0x1b1b1d, rough: 0.8, matrix: B( 0, 0.215 + dy, - 0.2 ) } );
				add( sphere( 0.065, 6, 5 ), { color: WHITE, rough: 0.8, matrix: B( 0, 0.27 + dy, 0.2 ) } );
				add( cylinder( 0.005, 0.02, 0.1, 5 ), { color: 0xe6b422, rough: 0.6, matrix: B( 0, 0.265 + dy, 0.29, Math.PI / 2 ) } );
				add( box( 0.07, 0.02, 0.12 ), { color: WHITE, rough: 0.8, matrix: B( 0, 0.14 + dy, - 0.27 ) } );
				if ( brood ) add( cylinder( 0.3, 0.26, 0.09, 9 ), { color: 0x8a7a4e, rough: 1, pattern: PAT.cloth, matrix: mat4( bx, by + 0.03, bz ) } );
				count ++;

			}

		}

		return count;

	}

	update( dt ) {

		this._t += dt;
		const night = Math.max( 0, Math.min( 1, ( G.night.value - 0.1 ) / 0.6 ) );
		const e = 0.5 + 3.4 * night;
		this.lampMaterial.emissive = [ e, e * 0.78, e * 0.42 ];
		if ( night > 0.02 ) {

			this.beams.visible = true;
			this.beams.rotation.y += dt * 0.42;
			this.beamMaterial.uniforms.opacity.value = 0.11 * night;

		} else if ( this.beams.visible ) this.beams.visible = false;

	}

}
