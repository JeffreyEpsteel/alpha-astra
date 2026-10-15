// Living sea: kelp on the shallow seabed, baitfish schools over it, dolphin pods that come to the player's boat.
// Models are the naval fork's MarineLife pack ( public/models/marine/*.glb, built by tools/dressing/build.ps1 ):
// +Z is the nose, +Y up, metres ( dolphin 2.6 m, kelp cluster 1.7 m, fish 0.66 m ).
//
//   const kelp = new Kelp( { scene, assets, sites } );        kelp.update( cameraPosition )
//   const fish = new FishSchools( { scene, assets, schools } ); fish.update( dt, t, cameraPosition )
//   const pods = new DolphinPods( { scene, assets, terrain, spray, query } ); pods.update( dt, anchor, cameraPosition )
//
// Everything is instanced: kelp 2 LODs x 1 mesh, fish 2 LODs x 3 meshes, dolphins 2 LODs x 2 meshes ( 8 draws at most ).
// Movement is in the vertex shaders ( kelp sway by height, fish and dolphin tail beat ), so the matrices only carry
// position and heading. Materials are 'lite' underwater lighting, lit, double sided where the fronds are thin.

import { InstancedMesh, Matrix4, Quaternion, Vector3, Euler, Group } from '../../engine/index.js';
import { mulberry32 } from '../../util/Noise.js';

const K_DROPLET = 0, K_SPRAY = 3; // fx/Spray.js SPRAY.*

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _e = new Euler();

// a few slow sines: the swell where no WaterQuery slot covers the point
export function swell( x, z, t ) {

	return 0.14 * Math.sin( 0.21 * x + 0.9 * t ) + 0.1 * Math.sin( 0.17 * z + 1.3 * t + 1.7 ) + 0.05 * Math.sin( 0.35 * ( x + z ) + 1.9 * t );

}

function instanced( geometry, material, capacity, name ) {

	const m = new InstancedMesh( geometry, material, capacity );
	m.name = name;
	m.count = 0;
	m.frustumCulled = false; // instances are placed around the camera; the set is small
	m.staticVelocity = true;
	m.castShadow = false;
	m.receiveShadow = true;
	return m;

}

// ---------------------------------------------------------------------------------------------- kelp

const KELP_VERTEX = /* wgsl */`
	// sway grows with height above the root ( the fronds are 1.7 m ); phase from the cluster's place, so a bed ripples
	let kh = clamp( v.position.y / 1.7, 0.0, 1.0 );
	let kk = kh * kh;
	let kp = frame.time * 1.25 + v.model[ 3 ].x * 0.41 + v.model[ 3 ].z * 0.33;
	v.position.x += ( sin( kp + v.position.y * 1.9 ) * 0.17 + sin( kp * 2.3 + v.position.y * 3.1 ) * 0.04 ) * kk;
	v.position.z += sin( kp * 0.83 + 1.7 + v.position.y * 1.4 ) * 0.13 * kk;
`;

export class Kelp {

	// sites: Sites.kelpSites(); near / far: LOD distances in metres ( beyond far nothing is drawn )
	constructor( { scene, assets, sites, near = 42, far = 120 } ) {

		this.scene = scene;
		this.sites = sites;
		this.near = near;
		this.far = far;
		this.group = new Group();
		this.group.name = 'dress-kelp';
		this.meshes = [];
		this.mats = new Map();
		this.counts = { near: 0, far: 0 };
		this.ready = this._build( assets );
		this._last = new Vector3( 1e9, 0, 0 );
		// one matrix per site
		this.mat = new Float32Array( sites.length * 16 );
		this.pos = new Float32Array( sites.length * 2 );
		sites.forEach( ( s, i ) => {

			_e.set( 0, s.yaw, 0 );
			_q.setFromEuler( _e );
			_m.compose( _p.set( s.x, s.y, s.z ), _q, _s.setScalar( s.s ) ).toArray( this.mat, i * 16 );
			this.pos[ i * 2 ] = s.x; this.pos[ i * 2 + 1 ] = s.z;

		} );

	}

	async _build( assets ) {

		const opts = { materials: () => ( { vertex: KELP_VERTEX, side: 'double', roughness: 0.75, localLightsCheap: true, color: 0x78a23a } ) };
		const [ g0, g1 ] = await Promise.all( [ assets.load( 'marine/KelpCluster_LOD0.glb', opts ), assets.load( 'marine/KelpCluster_LOD1.glb', opts ) ] );
		if ( ! g0 || ! g1 || ! this.sites.length ) return false;
		this.lod = [ g0, g1 ].map( ( g, k ) => g.meshes.map( ( src ) => {

			// both LODs draw with the LOD0 material of the same name, so the shader compiles once
			const mat = k === 0 ? src.material : g0.meshes.find( ( m ) => m.material.name === src.material.name )?.material || src.material;
			const im = instanced( src.geometry, mat, this.sites.length, 'kelp-lod' + k );
			this.group.add( im );
			this.meshes.push( im );
			return im;

		} ) );
		this.scene.add( this.group );
		this._last.set( 1e9, 0, 0 );
		return true;

	}

	// re-bucket the sites into LOD0 / LOD1 when the camera has moved a few metres
	update( cam ) {

		if ( ! this.lod ) return;
		if ( Math.hypot( cam.x - this._last.x, cam.z - this._last.z ) < 4 ) return;
		this._last.set( cam.x, 0, cam.z );
		const n0 = this.near * this.near, n1 = this.far * this.far;
		const a = this.lod[ 0 ], b = this.lod[ 1 ];
		let c0 = 0, c1 = 0;
		for ( let i = 0; i < this.sites.length; i ++ ) {

			const dx = this.pos[ i * 2 ] - cam.x, dz = this.pos[ i * 2 + 1 ] - cam.z;
			const d2 = dx * dx + dz * dz;
			if ( d2 > n1 ) continue;
			const set = d2 < n0 ? a : b;
			const c = d2 < n0 ? c0 ++ : c1 ++;
			for ( const m of set ) m.instanceMatrix.array.set( this.mat.subarray( i * 16, i * 16 + 16 ), c * 16 );

		}

		for ( const [ set, c ] of [ [ a, c0 ], [ b, c1 ] ] ) for ( const m of set ) {

			m.count = c;
			m.instanceMatrix.needsUpdate = true;
			m.visible = c > 0;

		}

		this.counts.near = c0;
		this.counts.far = c1;

	}

	dispose() {

		this.scene.remove( this.group );

	}

}

// ---------------------------------------------------------------------------------------------- baitfish

const FISH_VERTEX = /* wgsl */`
	// tail beat: the rear third swings sideways, faster for smaller phase offsets per fish
	let fp = frame.time * 13.0 + f32( v.instance ) * 1.7;
	let tail = clamp( - v.position.z / 0.4, 0.0, 1.0 );
	v.position.x += sin( fp - v.position.z * 9.0 ) * 0.045 * tail * tail;
`;

export class FishSchools {

	// schools: [ { x, z, y, radius, count } ] centres ( y below the sea ), fish circle round them
	constructor( { scene, assets, schools, seed = 77, range = 130, nearRange = 38 } ) {

		this.scene = scene;
		this.range = range;
		this.nearRange = nearRange;
		const rand = mulberry32( seed );
		this.schools = schools.map( ( s ) => ( {
			...s,
			omega: ( 0.35 + rand() * 0.2 ) * ( rand() < 0.5 ? - 1 : 1 ),
			fish: Array.from( { length: s.count }, () => ( { th: rand() * 6.283, r: s.radius * ( 0.35 + 0.65 * Math.sqrt( rand() ) ), dy: ( rand() - 0.5 ) * s.radius * 0.6, wob: rand() * 6.283, sp: 0.85 + rand() * 0.3, sc: 0.75 + rand() * 0.5 } ) ),
		} ) );
		this.capacity = this.schools.reduce( ( a, s ) => a + s.count, 0 );
		this.group = new Group();
		this.group.name = 'dress-fish';
		this.counts = { near: 0, far: 0 };
		this.ready = this._build( assets );

	}

	async _build( assets ) {

		const opts = { materials: () => ( { vertex: FISH_VERTEX, side: 'double', roughness: 0.4, localLightsCheap: true } ) };
		const [ g0, g1 ] = await Promise.all( [ assets.load( 'marine/Fish_LOD0.glb', opts ), assets.load( 'marine/Fish_LOD1.glb', opts ) ] );
		if ( ! g0 || ! g1 || ! this.capacity ) return false;
		this.lod = [ g0, g1 ].map( ( g, k ) => g.meshes.map( ( src ) => {

			const mat = k === 0 ? src.material : g0.meshes.find( ( m ) => m.material.name === src.material.name )?.material || src.material;
			const im = instanced( src.geometry, mat, this.capacity, 'fish-lod' + k );
			this.group.add( im );
			return im;

		} ) );
		this.scene.add( this.group );
		return true;

	}

	update( dt, t, cam ) {

		if ( ! this.lod ) return;
		let c0 = 0, c1 = 0;
		for ( const s of this.schools ) {

			const d = Math.hypot( s.x - cam.x, s.z - cam.z );
			if ( d > this.range ) continue;
			const near = d < this.nearRange;
			const set = near ? this.lod[ 0 ] : this.lod[ 1 ];
			for ( const f of s.fish ) {

				const th = f.th + t * s.omega * f.sp;
				const x = s.x + Math.cos( th ) * f.r, z = s.z + Math.sin( th ) * f.r;
				const y = s.y + f.dy + Math.sin( t * 0.9 + f.wob ) * 0.18;
				// heading: the tangent of the circle ( counter-clockwise for omega > 0 ), nose along +Z of the model
				const tx = - Math.sin( th ) * Math.sign( s.omega ), tz = Math.cos( th ) * Math.sign( s.omega );
				_e.set( 0, Math.atan2( tx, tz ), Math.sin( t * 1.3 + f.wob ) * 0.08 );
				_q.setFromEuler( _e );
				_m.compose( _p.set( x, y, z ), _q, _s.setScalar( f.sc ) );
				const c = near ? c0 ++ : c1 ++;
				for ( const m of set ) _m.toArray( m.instanceMatrix.array, c * 16 );

			}

		}

		for ( const [ set, c ] of [ [ this.lod[ 0 ], c0 ], [ this.lod[ 1 ], c1 ] ] ) for ( const m of set ) {

			m.count = c;
			m.instanceMatrix.needsUpdate = true;
			m.visible = c > 0;

		}

		this.counts.near = c0;
		this.counts.far = c1;

	}

	dispose() {

		this.scene.remove( this.group );

	}

}

// ---------------------------------------------------------------------------------------------- dolphins

const DOLPHIN_VERTEX = /* wgsl */`
	// the whole rear half flexes up and down ( a dolphin beats its flukes vertically ), the body a little sideways
	let dp = frame.time * 6.2 + v.model[ 3 ].x * 0.7 + v.model[ 3 ].z * 0.5 - v.position.z * 2.1;
	let dt = clamp( - v.position.z / 1.2, 0.0, 1.0 );
	v.position.y += sin( dp ) * 0.14 * dt * dt;
	v.position.x += sin( dp * 0.5 ) * 0.025 * dt;
`;

// formation: [ side, back ] metres from the pod's lead ( + side = starboard ), porpoise phase offsets
const FORMATION = [ [ 0, 0, 0 ], [ - 3.4, 1.8, 0.32 ], [ 3.6, 1.4, 0.64 ], [ - 6.4, 4.2, 0.16 ], [ 6.8, 3.8, 0.48 ] ];
const AIR = 0.36; // share of the porpoise cycle spent in the air
const MAX_DOLPHINS = 10;

export class DolphinPods {

	// terrain: TerrainData ( open-water test ); spray: app.spray; query: app.query ( WaterQuery ), both optional
	constructor( { scene, assets, terrain, spray = null, query = null, seed = 2027, maxPods = 2 } ) {

		this.scene = scene;
		this.terrain = terrain;
		this.spray = spray;
		this.query = query;
		this.rand = mulberry32( seed );
		this.maxPods = maxPods;
		this.pods = [];
		this.clock = 0;
		this.timer = 8; // s to the next pod
		this.group = new Group();
		this.group.name = 'dress-dolphins';
		this.counts = { near: 0, far: 0, splashes: 0 };
		this.slot0 = - 1;
		if ( query && query.allocate ) {

			try {

				this.slot0 = query.allocate( 'dressing', maxPods );

			} catch ( e ) {

				this.slot0 = - 1; // no free slot: the procedural swell

			}

		}

		this.ready = this._build( assets );

	}

	async _build( assets ) {

		// counter-shading: a darker back and a pale belly ( the model carries one grey for both ), from the world normal
		const opts = { materials: ( info ) => ( { vertex: DOLPHIN_VERTEX, roughness: 0.32, localLightsCheap: true, surface: info.name === 'Grey' ? 's.albedo = mix( s.albedo * 2.1, s.albedo * 0.8, smoothstep( - 0.4, 0.5, in.N.y ) );' : '' } ) };
		const [ g0, g1 ] = await Promise.all( [ assets.load( 'marine/Dolphin_LOD0.glb', opts ), assets.load( 'marine/Dolphin_LOD1.glb', opts ) ] );
		if ( ! g0 || ! g1 ) return false;
		this.lod = [ g0, g1 ].map( ( g, k ) => g.meshes.map( ( src ) => {

			const mat = k === 0 ? src.material : g0.meshes.find( ( m ) => m.material.name === src.material.name )?.material || src.material;
			const im = instanced( src.geometry, mat, MAX_DOLPHINS, 'dolphin-lod' + k );
			im.castShadow = k === 0;
			this.group.add( im );
			return im;

		} ) );
		this.scene.add( this.group );
		return true;

	}

	// ------------------------------------------------------------------ pods

	// open water: deep, far from any coast ( TerrainData.coastDistance: > 0 water )
	openWater( x, z ) {

		const T = this.terrain;
		return T.heightAt( x, z ) < - 7 && T.coastDistance( x, z ).d > 70;

	}

	spawn( anchor ) {

		const r = this.rand;
		const sp = Math.hypot( anchor.vx || 0, anchor.vz || 0 );
		for ( let tries = 0; tries < 40; tries ++ ) {

			// ahead of a moving boat ( +-70 degrees ), anywhere round a stationary one
			const base = sp > 1.5 ? Math.atan2( anchor.vx, anchor.vz ) : r() * 6.283;
			const ang = base + ( sp > 1.5 ? ( r() - 0.5 ) * 2.4 : 0 );
			const d = 110 + r() * 100;
			const x = anchor.x + Math.sin( ang ) * d, z = anchor.z + Math.cos( ang ) * d;
			if ( ! this.openWater( x, z ) ) continue;
			const n = 3 + Math.floor( r() * 3 ); // 3 - 5
			const pod = {
				x, z, heading: Math.atan2( anchor.x - x, anchor.z - z ) + ( r() - 0.5 ) * 0.5, speed: 6, state: 'approach', t: 0, life: 40 + r() * 30,
				orbit: r() * 6.283, orbitR: 19 + r() * 9, orbitDir: r() < 0.5 ? - 1 : 1, side: r() < 0.5 ? - 1 : 1, idle: 0, clock: r() * 10, sea: 0, turn: 0, slot: - 1,
				members: Array.from( { length: n }, ( _, i ) => ( { side: FORMATION[ i ][ 0 ], back: FORMATION[ i ][ 1 ], phase: FORMATION[ i ][ 2 ] + ( r() - 0.5 ) * 0.1, period: 3.1 + r() * 0.5, sc: 0.9 + r() * 0.22, air: false, y: - 0.2, pitch: 0, wx: x, wz: z } ) ),
			};
			if ( this.slot0 >= 0 ) {

				const used = new Set( this.pods.map( ( p ) => p.slot ) );
				for ( let k = 0; k < this.maxPods; k ++ ) if ( ! used.has( k ) ) { pod.slot = k; break; }

			}

			this.pods.push( pod );
			return pod;

		}

		return null;

	}

	_seaOf( pod, t ) {

		const q = this.query;
		if ( this.slot0 >= 0 && pod.slot >= 0 && q ) {

			const i = this.slot0 + pod.slot;
			// lead the point by the query latency; read the last result if it was computed near where this pod is
			q.setPoint( i, pod.x + Math.sin( pod.heading ) * pod.speed * ( q.latency || 0.05 ), pod.z + Math.cos( pod.heading ) * pod.speed * ( q.latency || 0.05 ) );
			const h = q.cpu && q.cpuValid ? q.cpu[ i * 4 ] : NaN;
			if ( Number.isFinite( h ) && Math.abs( q.resultInputs[ i * 4 ] - pod.x ) < 20 && Math.abs( q.resultInputs[ i * 4 + 1 ] - pod.z ) < 20 ) return h;

		}

		return swell( pod.x, pod.z, t );

	}

	_steer( pod, desired, rate, dt ) {

		let d = desired - pod.heading;
		d = Math.atan2( Math.sin( d ), Math.cos( d ) );
		const step = Math.max( - rate * dt, Math.min( rate * dt, d ) );
		pod.heading += step;
		pod.turn = step / Math.max( dt, 1e-4 );

	}

	_splash( x, z, y, vx, vz, big ) {

		this.counts.splashes ++;
		const sp = this.spray;
		if ( ! sp || ! sp.emit ) return;
		const p = { x, y, z }, v = { x: vx * 0.4, y: big ? 4.2 : 2.6, z: vz * 0.4 };
		sp.emit( p, v, big ? 22 : 9, big ? 0.24 : 0.16, K_SPRAY, { spread: big ? 2.2 : 1.4, jitter: 0.5, life: 2.0, sizeJitter: 0.8 } );
		sp.emit( p, { x: v.x, y: v.y + 1.5, z: v.z }, big ? 34 : 12, 0.022, K_DROPLET, { spread: big ? 3 : 2, jitter: 0.4, life: 1.8 } );

	}

	// anchor: { x, z, vx, vz } the boat ( or the camera ); cam: camera position for LOD
	update( dt, anchor, cam ) {

		if ( ! this.lod ) return;
		this.clock += dt;
		const T = this.terrain;
		// spawn / retire
		this.timer -= dt;
		if ( this.timer <= 0 && this.pods.length < this.maxPods ) {

			const pod = anchor ? this.spawn( anchor ) : null;
			this.timer = pod ? ( this.pods.length > 1 ? 40 : 12 ) + this.rand() * 25 : 5;

		}

		for ( let i = this.pods.length - 1; i >= 0; i -- ) {

			const pod = this.pods[ i ];
			pod.t += dt;
			pod.clock += dt;
			let tx, tz, want;
			let repel = false;
			if ( anchor ) {

				pod.idle = 0;
				const away = Math.hypot( pod.x - anchor.x, pod.z - anchor.z );
				if ( away > 460 || ( pod.state === 'leave' && away > 240 ) ) {

					this.pods.splice( i, 1 );
					this.timer = Math.min( this.timer, 14 ) + this.rand() * 20;
					continue;

				}

				if ( pod.state === 'approach' && away < 48 ) pod.state = 'escort';
				if ( pod.state === 'escort' && pod.t > pod.life ) pod.state = 'leave';
				const sp = Math.hypot( anchor.vx || 0, anchor.vz || 0 );
				if ( pod.state === 'leave' ) {

					tx = pod.x + ( pod.x - anchor.x ) * 5; tz = pod.z + ( pod.z - anchor.z ) * 5; want = 8;

				} else if ( sp > 2 ) {

					// the boat is under way: keep to one flank ( + side = port, the model's +X ), a little ahead of the bow wave
					const bx = anchor.vx / sp, bz = anchor.vz / sp, px = bz, pz = - bx;
					const lat = ( pod.x - anchor.x ) * px + ( pod.z - anchor.z ) * pz;
					if ( Math.abs( lat ) > 7 ) pod.side = Math.sign( lat ); // never swap flanks across the bow
					const ahead = Math.min( 5, sp * 0.9 );
					tx = anchor.x + bx * ahead + px * pod.side * pod.orbitR;
					tz = anchor.z + bz * ahead + pz * pod.side * pod.orbitR;
					const dist = Math.hypot( tx - pod.x, tz - pod.z );
					want = Math.max( 3.4, Math.min( 9.5, sp * 1.12 + dist * 0.22 ) );

				} else {

					// the boat is slow: swim slow circles round it
					pod.orbit += pod.orbitDir * dt * 0.2;
					tx = anchor.x + Math.sin( pod.orbit ) * pod.orbitR; tz = anchor.z + Math.cos( pod.orbit ) * pod.orbitR;
					const dist = Math.hypot( tx - pod.x, tz - pod.z );
					want = Math.max( 3.4, Math.min( 8, dist * 0.3 + 3.4 ) );

				}

				// never through the hull: inside 21 m the pod turns away from it
				if ( away < 21 && pod.state !== 'leave' ) {

					repel = true;
					tx = pod.x + ( pod.x - anchor.x ); tz = pod.z + ( pod.z - anchor.z );

				}

			} else {

				// nobody afloat: the pod swims on, and goes after half a minute
				pod.idle += dt;
				pod.state = 'leave';
				if ( pod.idle > 30 ) {

					this.pods.splice( i, 1 );
					continue;

				}

				tx = pod.x + Math.sin( pod.heading ) * 50; tz = pod.z + Math.cos( pod.heading ) * 50; want = 5;

			}

			// water ahead must stay deep: turn away from shallows and land
			const look = 26;
			const ax = pod.x + Math.sin( pod.heading ) * look, az = pod.z + Math.cos( pod.heading ) * look;
			let rate = repel ? 1.6 : 0.9;
			let desired = Math.atan2( tx - pod.x, tz - pod.z );
			if ( T.heightAt( ax, az ) > - 5 ) {

				const l = T.heightAt( pod.x + Math.sin( pod.heading - 0.7 ) * look, pod.z + Math.cos( pod.heading - 0.7 ) * look );
				const r = T.heightAt( pod.x + Math.sin( pod.heading + 0.7 ) * look, pod.z + Math.cos( pod.heading + 0.7 ) * look );
				desired = pod.heading + ( l < r ? - 0.9 : 0.9 );
				rate = 1.8;
				want = Math.min( want, 4 );

			}

			this._steer( pod, desired, rate, dt );
			pod.speed += ( want - pod.speed ) * Math.min( 1, dt * 0.8 );
			pod.x += Math.sin( pod.heading ) * pod.speed * dt;
			pod.z += Math.cos( pod.heading ) * pod.speed * dt;
			pod.sea += ( this._seaOf( pod, this.clock ) - pod.sea ) * Math.min( 1, dt * 6 );

		}

		// the instances
		const a = this.lod[ 0 ], b = this.lod[ 1 ];
		let c0 = 0, c1 = 0;
		for ( const pod of this.pods ) {

			const sh = Math.sin( pod.heading ), ch = Math.cos( pod.heading );
			for ( const m of pod.members ) {

				// position in the formation ( + side = starboard = ( cos h, -sin h ) )
				const wx = pod.x + ch * m.side - sh * m.back, wz = pod.z - sh * m.side - ch * m.back;
				const ph = ( ( pod.clock / m.period + m.phase ) % 1 + 1 ) % 1;
				let y, dydt;
				const H = 1.15 + 0.35 * Math.sin( m.phase * 40 ), Dp = 1.1;
				if ( ph < AIR ) {

					const u = ph / AIR;
					y = - 0.12 + H * 4 * u * ( 1 - u );
					dydt = H * 4 * ( 1 - 2 * u ) / ( AIR * m.period );

				} else {

					const w = ( ph - AIR ) / ( 1 - AIR );
					y = - 0.12 - Dp * Math.sin( Math.PI * w );
					dydt = - Dp * Math.PI * Math.cos( Math.PI * w ) / ( ( 1 - AIR ) * m.period );

				}

				const air = y > 0.35;
				if ( air !== m.air ) {

					// breaking the surface: a small splash going up, a bigger one coming down
					this._splash( wx, wz, pod.sea, sh * pod.speed, ch * pod.speed, ! air );
					m.air = air;

				}

				m.y = pod.sea + y;
				const pitch = Math.atan2( dydt, Math.max( pod.speed, 1 ) );
				const roll = Math.max( - 0.35, Math.min( 0.35, - pod.turn * 0.3 ) ) + ( air ? Math.sin( m.phase * 30 ) * 0.12 : 0 );
				_e.set( - pitch, pod.heading, roll, 'YXZ' );
				_q.setFromEuler( _e );
				_m.compose( _p.set( wx, m.y, wz ), _q, _s.setScalar( m.sc ) );
				m.wx = wx; m.wz = wz;
				const near = ! cam || Math.hypot( wx - cam.x, wz - cam.z ) < 100;
				const set = near ? a : b;
				const c = near ? c0 ++ : c1 ++;
				if ( c0 > MAX_DOLPHINS || c1 > MAX_DOLPHINS ) continue;
				for ( const im of set ) _m.toArray( im.instanceMatrix.array, c * 16 );

			}

		}

		c0 = Math.min( c0, MAX_DOLPHINS ); c1 = Math.min( c1, MAX_DOLPHINS );
		for ( const [ set, c ] of [ [ a, c0 ], [ b, c1 ] ] ) for ( const im of set ) {

			im.count = c;
			im.instanceMatrix.needsUpdate = true;
			im.visible = c > 0;

		}

		this.counts.near = c0;
		this.counts.far = c1;

	}

	dispose() {

		this.scene.remove( this.group );

	}

}
