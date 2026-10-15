// Cannonballs: ballistic (gravity only, exact steps), swept against the ships' hull / rigging boxes, the
// player's boat, the sea and the land. A fixed pool; the mesh pool is only built when a scene is given.
//
//   const balls = new Projectiles( { scene, max: 64 } );
//   balls.spawn( { x, y, z, vx, vy, vz, damage, owner: 'player' | shipId, faction: 'player' | 'pirate' | 'merchant', big } )  (big: a brigantine's gun)
//   balls.update( dt, ctx )  with ctx = {
//       ships,                         Ship[] (alive ones are hit; a ball never hits its own ship or its own faction)
//       playerBox() -> box | null,     the player's boat as an oriented box ( Ballistics.quatBox ), hit by balls not owned by 'player'
//       waterHeight( x, z ) -> y,      sea level at a point (default 0)
//       terrain,                       { heightAt( x, z ) } (land stops a ball)
//       onShipHit( ball, ship, part, point ), onPlayerHit( ball, point ), onWater( ball, point ), onLand( ball, point ),
//       raycastProps( p0, p1 ) -> { t, id, x, y, z } | null,   optional: destructible props along the step (destruction feature)
//       onProp( ball, point, hit )
//   }
// Each callback ends the ball. `ball.travelled` is the path length so far (damage falls off with it).
// wind: { x, z } acceleration in m/s^2 (a gentle drift; 0 by default).

import { Mesh, SphereGeometry } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { stepBall, segmentVsObb, segmentNearPoint } from './Ballistics.js';

export const BALL_RADIUS = 0.14;
const MAX_LIFE = 14;

export class Projectiles {

	constructor( { scene = null, max = 64 } = {} ) {

		this.scene = scene;
		this.max = max;
		this.active = [];
		this.wind = { x: 0, z: 0 };
		this._p0 = { x: 0, y: 0, z: 0 };
		this._p1 = { x: 0, y: 0, z: 0 };
		this._c = { x: 0, y: 0, z: 0 };
		this._geo = null;
		this._mat = null;
		this._free = [];
		if ( scene ) {

			this._geo = new SphereGeometry( BALL_RADIUS * 1.15, 8, 6 );
			this._mat = new Material( { name: 'nv-ball', color: 0x1c1c1f, roughness: 0.45, metalness: 0.6, underwaterLighting: 'lite' } );

		}

	}

	spawn( b ) {

		if ( this.active.length >= this.max ) this._release( this.active.shift() );
		const ball = {
			x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz,
			damage: b.damage ?? 20, owner: b.owner ?? 'player', faction: b.faction ?? 'player', level: b.level ?? 1, big: !! b.big,
			travelled: 0, age: 0, mesh: null, x0: b.x, z0: b.z,
		};
		if ( this.scene ) {

			const m = this._free.pop() || ( () => {

				const mesh = new Mesh( this._geo, this._mat );
				mesh.castShadow = false;
				mesh.frustumCulled = false;
				this.scene.add( mesh );
				return mesh;

			} )();
			m.visible = true;
			m.position.set( ball.x, ball.y, ball.z );
			ball.mesh = m;

		}

		this.active.push( ball );
		return ball;

	}

	_release( ball ) {

		if ( ! ball ) return;
		if ( ball.mesh ) {

			ball.mesh.visible = false;
			this._free.push( ball.mesh );
			ball.mesh = null;

		}

	}

	clear() {

		for ( const b of this.active ) this._release( b );
		this.active.length = 0;

	}

	get count() {

		return this.active.length;

	}

	update( dt, ctx ) {

		const sub = Math.max( 1, Math.ceil( dt / 0.04 ) ), h = dt / sub;
		for ( let s = 0; s < sub; s ++ ) {

			for ( let i = this.active.length - 1; i >= 0; i -- ) {

				if ( this._step( this.active[ i ], h, ctx ) ) {

					this._release( this.active[ i ] );
					this.active.splice( i, 1 );

				}

			}

		}

		for ( const b of this.active ) if ( b.mesh ) b.mesh.position.set( b.x, b.y, b.z );

	}

	// returns true when the ball is finished
	_step( b, h, ctx ) {

		const p0 = this._p0, p1 = this._p1;
		p0.x = b.x; p0.y = b.y; p0.z = b.z;
		stepBall( b, h, undefined, this.wind );
		p1.x = b.x; p1.y = b.y; p1.z = b.z;
		b.age += h;
		const seg = Math.hypot( p1.x - p0.x, p1.y - p0.y, p1.z - p0.z );
		b.travelled += seg;

		// nearest contact along the segment: a ship, the player, the sea
		let bestT = 2, bestShip = null, bestPart = null, player = false;
		const ships = ctx.ships || [];
		for ( const sh of ships ) {

			if ( ! sh.alive || sh.id === b.owner || sh.faction === b.faction ) continue;
			const c = this._c;
			c.x = sh.x; c.y = sh.pose.y + 4; c.z = sh.z;
			if ( ! segmentNearPoint( p0, p1, c, sh.cls.length * 0.5 + 8 ) ) continue;
			let t = segmentVsObb( p0, p1, sh.hullBox(), BALL_RADIUS );
			if ( t >= 0 && t < bestT ) { bestT = t; bestShip = sh; bestPart = 'hull'; player = false; }
			t = segmentVsObb( p0, p1, sh.riggingBox(), BALL_RADIUS );
			if ( t >= 0 && t < bestT ) { bestT = t; bestShip = sh; bestPart = 'rigging'; player = false; }

		}

		if ( b.owner !== 'player' && ctx.playerBox ) {

			const box = ctx.playerBox();
			if ( box ) {

				const t = segmentVsObb( p0, p1, box, BALL_RADIUS );
				if ( t >= 0 && t < bestT ) { bestT = t; bestShip = null; bestPart = 'player'; player = true; }

			}

		}

		// destructible props (the destruction feature's raycastSegment); t from its hit point, whatever its own t means
		let prop = null;
		if ( ctx.raycastProps && seg > 0 ) {

			const r = ctx.raycastProps( p0, p1 );
			if ( r ) {

				const t = Number.isFinite( r.x ) ? Math.hypot( r.x - p0.x, r.y - p0.y, r.z - p0.z ) / seg : r.t;
				if ( t >= 0 && t <= 1 && t < bestT ) { bestT = t; prop = r; bestShip = null; player = false; }

			}

		}

		// the sea
		const wh = ctx.waterHeight ? ctx.waterHeight( p1.x, p1.z ) : 0;
		let tw = 2;
		if ( p1.y <= wh && p0.y > wh - 0.001 ) tw = ( p0.y - wh ) / Math.max( p0.y - p1.y, 1e-6 );
		else if ( p1.y <= wh ) tw = 0;

		if ( bestT <= 1 && bestT <= tw ) {

			const pt = { x: p0.x + ( p1.x - p0.x ) * bestT, y: p0.y + ( p1.y - p0.y ) * bestT, z: p0.z + ( p1.z - p0.z ) * bestT };
			if ( prop ) ctx.onProp && ctx.onProp( b, pt, prop );
			else if ( player ) ctx.onPlayerHit && ctx.onPlayerHit( b, pt );
			else ctx.onShipHit && ctx.onShipHit( b, bestShip, bestPart, pt );
			return true;

		}

		if ( tw <= 1 ) {

			const pt = { x: p0.x + ( p1.x - p0.x ) * tw, y: wh, z: p0.z + ( p1.z - p0.z ) * tw };
			ctx.onWater && ctx.onWater( b, pt );
			return true;

		}

		if ( ctx.terrain && ctx.terrain.heightAt( p1.x, p1.z ) > p1.y ) {

			ctx.onLand && ctx.onLand( b, { x: p1.x, y: p1.y, z: p1.z } );
			return true;

		}

		return b.age > MAX_LIFE || p1.y < - 40;

	}

	dispose() {

		this.clear();
		for ( const m of this._free ) this.scene && this.scene.remove( m );
		this._free.length = 0;
		if ( this._geo ) this._geo.dispose();
		if ( this._mat ) this._mat.dispose();

	}

}
