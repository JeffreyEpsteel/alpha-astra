// Combat feedback: muzzle flash and smoke, water plumes, wood splinters, drifting smoke from a shot-up hull.
//
//   const fx = new Effects( { scene, spray } );     // both optional: no scene = nothing drawn (node tests), no spray = rings
//   fx.splash( x, y, z, size )      a cannonball (or a sinking hull) into the sea: GPU spray plume, else an expanding ring
//   fx.hit( x, y, z )               a ball into timber: splinters and a dust puff
//   fx.muzzle( x, y, z, dx, dy, dz, big )   flash + a cloud of smoke along the barrel direction
//   fx.smoke( x, y, z, scale )      one puff of dark smoke that drifts up and fades
//   fx.update( dt ); fx.dispose();  fx.counts   how many of each were requested (tests)
//
// Pools are fixed (no allocation per effect); transparent meshes sit on LAYERS.TRANSPARENT so they draw over the
// water. The spray particle kinds are Spray.js SPRAY.* (DROPLET 0, MIST 1, LIGAMENT 2, SPRAY 3).

import { BoxGeometry, Mesh, SphereGeometry, TorusGeometry } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { LAYERS } from '../../core/SceneRenderer.js';
import { GRAVITY } from './Ballistics.js';

const K_DROPLET = 0, K_SPRAY = 3;
const NPUFF = 28, NRING = 10, NSPLINTER = 40, NFLASH = 4;

export class Effects {

	constructor( { scene = null, spray = null } = {} ) {

		this.scene = scene;
		this.spray = spray;
		this.counts = { splash: 0, hit: 0, muzzle: 0, smoke: 0 };
		this.puffs = [];
		this.rings = [];
		this.splinters = [];
		this.flashes = [];
		this._v = { x: 0, y: 0, z: 0 };
		this._p = { x: 0, y: 0, z: 0 };
		this._geo = [];
		this._mat = [];
		if ( scene ) this._build();

	}

	_mesh( geo, mat, transparent ) {

		const m = new Mesh( geo, mat );
		m.visible = false;
		m.castShadow = false;
		m.receiveShadow = false;
		m.frustumCulled = false;
		if ( transparent ) m.layers.set( LAYERS.TRANSPARENT );
		this.scene.add( m );
		return m;

	}

	_build() {

		const sphere = new SphereGeometry( 0.5, 8, 6 );
		const ring = new TorusGeometry( 1, 0.045, 5, 28 );
		const splinter = new BoxGeometry( 0.07, 0.05, 0.34 );
		this._geo.push( sphere, ring, splinter );
		const puffMat = ( name ) => {

			const m = new Material( { name, color: 0x4b4741, roughness: 1, transparent: true, opacity: 0.5, depthWrite: false, side: 'double', underwaterLighting: 'lite' } );
			this._mat.push( m );
			return m;

		};

		for ( let i = 0; i < NPUFF; i ++ ) this.puffs.push( { mesh: this._mesh( sphere, puffMat( 'nv-puff' ), true ), t: 0, life: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 2, a: 0.5, on: false } );
		for ( let i = 0; i < NRING; i ++ ) {

			const m = new Material( { name: 'nv-ring', color: 0xe9f2f4, roughness: 0.6, transparent: true, opacity: 0.6, depthWrite: false, side: 'double', underwaterLighting: 'lite' } );
			this._mat.push( m );
			const mesh = this._mesh( ring, m, true );
			mesh.rotation.x = Math.PI / 2;
			this.rings.push( { mesh, t: 0, life: 1.4, s1: 3, on: false } );

		}

		const wood = new Material( { name: 'nv-splinter', color: 0x7a5530, roughness: 0.9, underwaterLighting: 'lite' } );
		this._mat.push( wood );
		for ( let i = 0; i < NSPLINTER; i ++ ) this.splinters.push( { mesh: this._mesh( splinter, wood, false ), t: 0, life: 0, vx: 0, vy: 0, vz: 0, on: false } );
		for ( let i = 0; i < NFLASH; i ++ ) {

			const m = new Material( { name: 'nv-flash', color: 0xffd27a, emissive: [ 6, 3.6, 1.2 ], roughness: 1, lit: false, transparent: true, opacity: 0.9, depthWrite: false, underwaterLighting: 'none' } );
			this._mat.push( m );
			this.flashes.push( { mesh: this._mesh( sphere, m, true ), t: 0, life: 0.1, s: 1, on: false } );

		}

	}

	_take( list ) {

		for ( const e of list ) if ( ! e.on ) return e;
		// all busy: recycle the oldest
		let o = list[ 0 ];
		for ( const e of list ) if ( e.t > o.t ) o = e;
		return o;

	}

	_puff( x, y, z, vx, vy, vz, s0, s1, life, a, color = 0x4b4741 ) {

		if ( ! this.scene ) return;
		const p = this._take( this.puffs );
		p.on = true;
		p.t = 0;
		p.life = life;
		p.vx = vx; p.vy = vy; p.vz = vz;
		p.s0 = s0; p.s1 = s1; p.a = a;
		p.mesh.visible = true;
		p.mesh.position.set( x, y, z );
		p.mesh.scale.setScalar( s0 );
		p.mesh.material.color = color;
		p.mesh.material.opacity = a;

	}

	// a ball (or a sinking hull) into the water; size ~1 for a 2 kg ball, 3+ for a hull
	splash( x, y, z, size = 1 ) {

		this.counts.splash ++;
		const sp = this.spray;
		if ( sp && sp.emit ) {

			const p = this._p, v = this._v;
			p.x = x; p.y = y; p.z = z;
			v.x = 0; v.y = 4 + 3 * size; v.z = 0;
			sp.emit( p, v, Math.round( 14 + 14 * size ), 0.22 * size, K_SPRAY, { spread: 1.6 + size, jitter: 0.3 * size, life: 2.2, sizeJitter: 0.7 } );
			v.y = 6 + 3 * size;
			sp.emit( p, v, Math.round( 26 * size ), 0.028, K_DROPLET, { spread: 3.2 + size, jitter: 0.4 * size, life: 1.8 } );
			return;

		}

		if ( ! this.scene ) return;
		const r = this._take( this.rings );
		r.on = true;
		r.t = 0;
		r.life = 1.2 + 0.3 * size;
		r.s1 = 2.5 + 2.5 * size;
		r.mesh.visible = true;
		r.mesh.position.set( x, y + 0.05, z );
		r.mesh.scale.set( 0.3, 0.3, 1 );
		r.mesh.material.opacity = 0.6;
		this._puff( x, y + 0.4, z, 0, 2.2 * size, 0, 0.5 * size, 1.8 * size, 0.9, 0.5, 0xeef3f4 );

	}

	// a ball into timber
	hit( x, y, z ) {

		this.counts.hit ++;
		if ( ! this.scene ) return;
		for ( let i = 0; i < 9; i ++ ) {

			const s = this._take( this.splinters );
			s.on = true;
			s.t = 0;
			s.life = 0.9 + Math.random() * 0.7;
			const a = Math.random() * Math.PI * 2, h = 2 + Math.random() * 4;
			s.vx = Math.cos( a ) * h;
			s.vz = Math.sin( a ) * h;
			s.vy = 2 + Math.random() * 5;
			s.mesh.visible = true;
			s.mesh.position.set( x, y, z );
			s.mesh.scale.setScalar( 1 );
			s.mesh.rotation.set( Math.random() * 6, Math.random() * 6, Math.random() * 6 );

		}

		this._puff( x, y, z, 0, 0.8, 0, 0.5, 2.4, 1.2, 0.45, 0x8f7a5a );

	}

	muzzle( x, y, z, dx, dy, dz, big = false ) {

		this.counts.muzzle ++;
		if ( ! this.scene ) return;
		const f = this._take( this.flashes );
		f.on = true;
		f.t = 0;
		f.life = 0.09;
		f.s = big ? 1.5 : 1;
		f.mesh.visible = true;
		f.mesh.position.set( x + dx * 0.8, y + dy * 0.8, z + dz * 0.8 );
		f.mesh.scale.setScalar( 0.5 * f.s );
		f.mesh.material.opacity = 0.9;
		const n = big ? 6 : 4;
		for ( let i = 0; i < n; i ++ ) {

			const k = 1 + i * 0.9, j = ( Math.random() - 0.5 ) * 1.2;
			this._puff( x + dx * k, y + dy * k + 0.1, z + dz * k, dx * 3 + j, 0.7 + Math.random() * 0.8, dz * 3 + j, 0.5 + 0.2 * i, 2.4 + 0.5 * i, 2.2 + Math.random(), 0.55 );

		}

	}

	smoke( x, y, z, scale = 1 ) {

		this.counts.smoke ++;
		this._puff( x, y, z, ( Math.random() - 0.5 ) * 0.8 + 0.6, 1.8, ( Math.random() - 0.5 ) * 0.8, 0.8 * scale, 4.2 * scale, 4.5, 0.42 );

	}

	update( dt ) {

		if ( ! this.scene ) return;
		for ( const p of this.puffs ) {

			if ( ! p.on ) continue;
			p.t += dt;
			const u = p.t / p.life;
			if ( u >= 1 ) {

				p.on = false;
				p.mesh.visible = false;
				continue;

			}

			const m = p.mesh;
			m.position.x += p.vx * dt;
			m.position.y += p.vy * dt;
			m.position.z += p.vz * dt;
			p.vx *= Math.exp( - dt * 0.8 );
			p.vz *= Math.exp( - dt * 0.8 );
			p.vy *= Math.exp( - dt * 0.7 );
			m.scale.setScalar( p.s0 + ( p.s1 - p.s0 ) * Math.sqrt( u ) );
			m.material.opacity = p.a * ( 1 - u ) * ( 1 - u );

		}

		for ( const r of this.rings ) {

			if ( ! r.on ) continue;
			r.t += dt;
			const u = r.t / r.life;
			if ( u >= 1 ) {

				r.on = false;
				r.mesh.visible = false;
				continue;

			}

			const s = 0.3 + ( r.s1 - 0.3 ) * Math.sqrt( u );
			r.mesh.scale.set( s, s, 1 );
			r.mesh.material.opacity = 0.6 * ( 1 - u );

		}

		for ( const s of this.splinters ) {

			if ( ! s.on ) continue;
			s.t += dt;
			if ( s.t >= s.life ) {

				s.on = false;
				s.mesh.visible = false;
				continue;

			}

			s.vy -= GRAVITY * dt;
			const m = s.mesh;
			m.position.x += s.vx * dt;
			m.position.y += s.vy * dt;
			m.position.z += s.vz * dt;
			m.rotation.x += dt * 9;
			m.rotation.z += dt * 6;
			if ( m.position.y < 0 ) {

				s.on = false;
				m.visible = false;

			}

		}

		for ( const f of this.flashes ) {

			if ( ! f.on ) continue;
			f.t += dt;
			if ( f.t >= f.life ) {

				f.on = false;
				f.mesh.visible = false;
				continue;

			}

			const u = f.t / f.life;
			f.mesh.scale.setScalar( ( 0.5 + 1.1 * u ) * f.s );
			f.mesh.material.opacity = 0.9 * ( 1 - u );

		}

	}

	dispose() {

		if ( this.scene ) {

			for ( const l of [ this.puffs, this.rings, this.splinters, this.flashes ] ) for ( const e of l ) this.scene.remove( e.mesh );

		}

		for ( const g of this._geo ) g.dispose && g.dispose();
		for ( const m of this._mat ) m.dispose && m.dispose();
		this.puffs.length = this.rings.length = this.splinters.length = this.flashes.length = 0;

	}

}
