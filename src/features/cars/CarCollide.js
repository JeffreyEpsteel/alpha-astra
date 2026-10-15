// The cars' view of the solid world (pure: no engine): a uniform grid over app.colliders (src/world/Colliders.js: yawed
// boxes, cylinders), rebuilt when the colliders change, so a car asks only the few boxes round it - a city has thousands.
//
//   const cw = new CarWorld( colliders, { terrain, roadHeight, destruction } );
//   cw.ground( x, z, yRef )        the highest of the terrain, the road surface and a walkable box top under yRef
//   cw.collide( body, h )          pushes a CarBody out of solid boxes / cylinders (circles along the car); returns impacts
//                                  [ { speed, x, z, nx, nz, what: 'wall' | 'prop', id } ]; a breakable prop (tag
//                                  'destructible') hit hard enough breaks (destruction.damage) and lets the car through
//   cw.circles( spec ) -> [ [ z, r ] ]   the car's footprint as circles along its length
// Things lower than a kerb step over the car's floor are driven over; things above its roof are passed under.

const CELL = 16;
const STEP = 0.45; // m: lower boxes are driven over (the walkable ones are ground)
const E = 0.18; // restitution against walls

export function carCircles( spec ) {

	const r = spec.wid / 2;
	const n = Math.max( 2, Math.round( spec.len / spec.wid ) );
	const out = [];
	for ( let i = 0; i < n; i ++ ) out.push( [ - spec.len / 2 + r + ( spec.len - 2 * r ) * ( n === 1 ? 0.5 : i / ( n - 1 ) ), r ] );
	return out;

}

export class CarWorld {

	constructor( colliders = null, { terrain = null, roadHeight = null, destruction = null, sea = 0 } = {} ) {

		this.colliders = colliders;
		this.terrain = terrain;
		this.roadHeight = roadHeight; // ( x, z ) -> y | null
		this.destruction = destruction; // () -> the destruction feature (lazy)
		this.sea = sea;
		this.grid = new Map();
		this._sig = '';
		this._propOf = new WeakMap();
		this._seen = new Set();
		this.rebuilds = 0;

	}

	_signature() {

		const C = this.colliders;
		if ( ! C ) return '';
		const b = C.boxes, c = C.cylinders || [];
		return `${ b.length }|${ c.length }|${ b.length ? b[ b.length - 1 ].center.x : 0 }|${ b.length ? b[ 0 ].center.z : 0 }`;

	}

	refresh() {

		const sig = this._signature();
		if ( sig === this._sig ) return;
		this._sig = sig;
		this.rebuilds ++;
		const g = this.grid;
		g.clear();
		const C = this.colliders;
		if ( ! C ) return;
		const put = ( item, x, z, r ) => {

			const i0 = Math.floor( ( x - r ) / CELL ), i1 = Math.floor( ( x + r ) / CELL );
			const j0 = Math.floor( ( z - r ) / CELL ), j1 = Math.floor( ( z + r ) / CELL );
			if ( ( i1 - i0 + 1 ) * ( j1 - j0 + 1 ) > 400 ) return; // (a huge box: kept out of the grid, see this.big)
			for ( let i = i0; i <= i1; i ++ ) for ( let j = j0; j <= j1; j ++ ) {

				const k = i * 73856093 ^ j * 19349663;
				let a = g.get( k );
				if ( ! a ) g.set( k, a = [] );
				a.push( item );

			}

		};
		this.big = [];
		for ( const b of C.boxes ) {

			if ( ( Math.floor( ( b.center.x + b.radius ) / CELL ) - Math.floor( ( b.center.x - b.radius ) / CELL ) + 1 ) * ( Math.floor( ( b.center.z + b.radius ) / CELL ) - Math.floor( ( b.center.z - b.radius ) / CELL ) + 1 ) > 400 ) this.big.push( b );
			else put( b, b.center.x, b.center.z, b.radius );

		}

		for ( const c of C.cylinders || [] ) put( c, c.x, c.z, c.radius );

	}

	// every collider whose cell box overlaps the square ( x +- r, z +- r ), once each
	near( x, z, r, out = [] ) {

		this.refresh();
		out.length = 0;
		const seen = this._seen;
		seen.clear();
		const i0 = Math.floor( ( x - r ) / CELL ), i1 = Math.floor( ( x + r ) / CELL );
		const j0 = Math.floor( ( z - r ) / CELL ), j1 = Math.floor( ( z + r ) / CELL );
		for ( let i = i0; i <= i1; i ++ ) for ( let j = j0; j <= j1; j ++ ) {

			const a = this.grid.get( i * 73856093 ^ j * 19349663 );
			if ( a ) for ( const it of a ) if ( ! seen.has( it ) ) { seen.add( it ); out.push( it ); }

		}

		if ( this.big ) for ( const b of this.big ) out.push( b );
		return out;

	}

	ground( x, z, yRef = Infinity ) {

		let h = this.terrain && this.terrain.heightAt ? this.terrain.heightAt( x, z ) : 0;
		if ( ! Number.isFinite( h ) ) h = 0;
		const r = this.roadHeight ? this.roadHeight( x, z ) : null;
		if ( Number.isFinite( r ) && r > h && r <= yRef + 0.6 ) h = r;
		if ( this.colliders ) {

			for ( const b of this.near( x, z, 0.5, _list ) ) {

				if ( ! b.walkable || b.top > yRef || b.top <= h ) continue;
				const dx = x - b.center.x, dz = z - b.center.z;
				const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
				if ( Math.abs( lx ) <= b.half.x && Math.abs( lz ) <= b.half.z ) h = b.top;

			}

		}

		return h;

	}

	collide( body, h ) {

		const S = body.spec, hits = [];
		if ( ! this.colliders ) return hits;
		const circ = body._circles || ( body._circles = carCircles( S ) );
		const fx = Math.sin( body.yaw ), fz = Math.cos( body.yaw );
		const y0 = body.y + STEP, y1 = body.y + S.hgt;
		const list = this.near( body.x, body.z, S.len / 2 + 1, _list2 );
		for ( const [ cz, r ] of circ ) {

			for ( const o of list ) {

				const px = body.x + fx * cz, pz = body.z + fz * cz;
				let nx, nz, pen;
				if ( o.center ) {

					// a box (yawed about y)
					if ( ! o.solid || o.top < y0 || o.bottom > y1 ) continue;
					if ( Math.abs( px - o.center.x ) > o.radius + r || Math.abs( pz - o.center.z ) > o.radius + r ) continue;
					const dx = px - o.center.x, dz = pz - o.center.z;
					const lx = dx * o.cos - dz * o.sin, lz = dx * o.sin + dz * o.cos;
					const qx = Math.max( - o.half.x, Math.min( o.half.x, lx ) ), qz = Math.max( - o.half.z, Math.min( o.half.z, lz ) );
					let ex = lx - qx, ez = lz - qz;
					const d2 = ex * ex + ez * ez;
					if ( d2 >= r * r ) continue;
					let lnx, lnz;
					if ( d2 > 1e-8 ) {

						const d = Math.sqrt( d2 );
						lnx = ex / d; lnz = ez / d; pen = r - d;

					} else {

						const ax = o.half.x - Math.abs( lx ), az = o.half.z - Math.abs( lz );
						if ( ax < az ) { lnx = Math.sign( lx ) || 1; lnz = 0; pen = ax + r; } else { lnx = 0; lnz = Math.sign( lz ) || 1; pen = az + r; }

					}

					nx = lnx * o.cos + lnz * o.sin;
					nz = - lnx * o.sin + lnz * o.cos;

				} else {

					// a cylinder
					if ( o.yMax < y0 || o.yMin > y1 ) continue;
					const dx = px - o.x, dz = pz - o.z, R = o.radius + r;
					const d2 = dx * dx + dz * dz;
					if ( d2 >= R * R ) continue;
					const d = Math.sqrt( d2 ) || 1e-4;
					nx = dx / d; nz = dz / d; pen = R - d;

				}

				const vn = body.vx * nx + body.vz * nz;
				// a breakable prop: hard enough and it goes, the car ploughs on
				if ( o.tag === 'destructible' && vn < - 2 ) {

					const broke = this._breakProp( o, body, - vn, px - nx * r, pz - nz * r );
					if ( broke ) {

						body.vx *= 0.82; body.vz *= 0.82;
						hits.push( { speed: - vn * 0.5, x: px - nx * r, z: pz - nz * r, nx, nz, what: 'prop', id: broke } );
						continue;

					}

				}

				body.x += nx * pen;
				body.z += nz * pen;
				if ( vn < 0 ) {

					// bounce off, scrub some of the slide along it, and turn about the hit point
					const j = - ( 1 + E ) * vn;
					body.vx += nx * j; body.vz += nz * j;
					const tx = - nz, tz = nx, vt = body.vx * tx + body.vz * tz;
					body.vx -= tx * vt * 0.12; body.vz -= tz * vt * 0.12;
					const rx = fx * cz, rz = fz * cz;
					const I = ( S.len * S.len + S.wid * S.wid ) / 12;
					body.yawRate += ( rz * nx * j - rx * nz * j ) / I * 0.6;
					if ( - vn > 1 ) hits.push( { speed: - vn, x: px - nx * r, z: pz - nz * r, nx, nz, what: o.tag === 'destructible' ? 'prop' : 'wall', id: o.tag || null } );

				}

			}

		}

		return hits;

	}

	_breakProp( box, body, speed, x, z ) {

		const d = typeof this.destruction === 'function' ? this.destruction() : this.destruction;
		if ( ! d || ! d.props || ! d.damage ) return null;
		let id = this._propOf.get( box );
		if ( id === undefined ) {

			id = null;
			for ( const p of d.props ) if ( p.colliders && p.colliders.includes( box ) ) { id = p.id; break; }
			this._propOf.set( box, id );

		}

		if ( ! id ) return null;
		const energy = 0.5 * body.spec.mass * speed * speed * 0.35;
		return d.damage( id, energy, { x, y: body.y + 0.6, z }, 'car' ) ? id : null;

	}

}

const _list = [], _list2 = [];
