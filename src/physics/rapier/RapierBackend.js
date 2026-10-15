// Rapier backend of the physics facade (src/physics/World.js). The facade owns bodies, joints, loads, buoyancy and terrain
// tiles; this file is the only one that talks to @dimforge/rapier3d-compat (WASM inlined as base64, `await RAPIER.init()`).
//
//   await loadRapier();
//   const be = new RapierBackend( { gravity: - 9.81, dt: 1 / 60, iterations: 4 } );
//   const n = be.createBody( { type: 'dynamic', shape: 'box', hx, hy, hz, position, quaternion, density, ... } );
//   be.createJoint( nA, nB, anchorA, frameA, anchorB, frameB );  be.step();  be.readPose( n, pos, quat, vel, ang );
//
// Natives are plain objects { rb, col } (the rigid body and its single collider). Collider handles are numbers.

import RAPIER from '@dimforge/rapier3d-compat';

let _ready = null;

export function loadRapier() {

	if ( ! _ready ) _ready = RAPIER.init().then( () => RAPIER );
	return _ready;

}

const ID_Q = { x: 0, y: 0, z: 0, w: 1 };

export class RapierBackend {

	constructor( { gravity = - 9.81, dt = 1 / 60, iterations = 4 } = {} ) {

		this.R = RAPIER;
		this.world = new RAPIER.World( { x: 0, y: gravity, z: 0 } );
		this.world.timestep = dt;
		try { this.world.integrationParameters.numSolverIterations = iterations; } catch ( e ) { /* older builds */ }
		// one fixed body at the origin: joints "to the world" hang on it
		this.ground = this.world.createRigidBody( RAPIER.RigidBodyDesc.fixed() );
		this._ray = new RAPIER.Ray( { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 } );

	}

	// d: { type: 'dynamic' | 'fixed' | 'kinematic', shape: 'box' | 'sphere' | 'cylinder' | 'convex' | 'capsule', hx, hy, hz, radius,
	//      halfHeight, points (Float32Array, convex), position, quaternion, velocity, angularVelocity, density, friction,
	//      restitution, linearDamping, angularDamping, ccd, canSleep }
	createBody( d ) {

		const R = this.R;
		let bd = d.type === 'fixed' ? R.RigidBodyDesc.fixed() : d.type === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic();
		const p = d.position || { x: 0, y: 0, z: 0 }, q = d.quaternion || ID_Q;
		bd = bd.setTranslation( p.x, p.y, p.z ).setRotation( q );
		if ( d.type === 'dynamic' ) {

			if ( d.velocity ) bd = bd.setLinvel( d.velocity.x, d.velocity.y, d.velocity.z );
			if ( d.angularVelocity ) bd = bd.setAngvel( d.angularVelocity );
			bd = bd.setLinearDamping( d.linearDamping ?? 0.02 ).setAngularDamping( d.angularDamping ?? 0.05 ).setCanSleep( d.canSleep !== false );
			if ( d.ccd ) bd = bd.setCcdEnabled( true );

		}

		const rb = this.world.createRigidBody( bd );
		let cd = this._shape( d );
		if ( ! cd ) cd = R.ColliderDesc.cuboid( d.hx || 0.25, d.hy || 0.25, d.hz || 0.25 );
		cd = cd.setFriction( d.friction ?? 0.6 ).setRestitution( d.restitution ?? 0.1 );
		if ( d.type === 'dynamic' ) cd = cd.setDensity( d.density ?? 600 );
		const col = this.world.createCollider( cd, rb );
		return { rb, col, handle: col.handle };

	}

	_shape( d ) {

		const R = this.R;
		switch ( d.shape ) {

			case 'sphere': return R.ColliderDesc.ball( d.radius || 0.25 );
			case 'cylinder': return R.ColliderDesc.cylinder( d.halfHeight || 0.25, d.radius || 0.25 );
			case 'capsule': return R.ColliderDesc.capsule( d.halfHeight || 0.5, d.radius || 0.3 );
			case 'convex': return d.points ? R.ColliderDesc.convexHull( d.points ) : null;
			default: return R.ColliderDesc.cuboid( d.hx || 0.25, d.hy || 0.25, d.hz || 0.25 );

		}

	}

	removeBody( n ) {

		if ( ! n || n.removed ) return;
		n.removed = true;
		this.world.removeRigidBody( n.rb );

	}

	// a fixed joint holding the two frames together (nA null: the world). Anchors and frames are in each body's local space.
	createJoint( nA, nB, anchorA, frameA, anchorB, frameB ) {

		const data = this.R.JointData.fixed( anchorA, frameA, anchorB, frameB );
		const j = this.world.createImpulseJoint( data, nA ? nA.rb : this.ground, nB.rb, true );
		try { j.setContactsEnabled( false ); } catch ( e ) { /* older builds */ }
		return { j };

	}

	removeJoint( nj ) {

		if ( ! nj || nj.removed ) return;
		nj.removed = true;
		try { this.world.removeImpulseJoint( nj.j, true ); } catch ( e ) { /* its body went first */ }

	}

	// a heightfield patch: n x n cells over size x size metres centred on ( cx, cz ). heights: (n+1)^2, index iz + ix * (n+1)
	createHeightfield( n, heights, size, cx, cz ) {

		const R = this.R;
		const cd = R.ColliderDesc.heightfield( n, n, heights, { x: size, y: 1, z: size } ).setTranslation( cx, 0, cz ).setFriction( 0.8 ).setRestitution( 0.05 );
		const col = this.world.createCollider( cd );
		return { col, handle: col.handle };

	}

	// a fixed collider without a body of its own (static world mirror: decks, walls, piles)
	createStatic( d ) {

		const R = this.R;
		let cd = this._shape( d );
		if ( ! cd ) return null;
		const p = d.position || { x: 0, y: 0, z: 0 };
		cd = cd.setTranslation( p.x, p.y, p.z ).setRotation( d.quaternion || ID_Q ).setFriction( d.friction ?? 0.7 ).setRestitution( 0.05 );
		const col = this.world.createCollider( cd );
		return { col, handle: col.handle };

	}

	removeCollider( n ) {

		if ( ! n || n.removed ) return;
		n.removed = true;
		this.world.removeCollider( n.col, false );

	}

	mass( n ) {

		return n.rb.mass();

	}

	readPose( n, pos, quat, vel, ang ) {

		const rb = n.rb;
		const t = rb.translation(), r = rb.rotation();
		pos.x = t.x; pos.y = t.y; pos.z = t.z;
		quat.x = r.x; quat.y = r.y; quat.z = r.z; quat.w = r.w;
		if ( vel ) { const v = rb.linvel(); vel.x = v.x; vel.y = v.y; vel.z = v.z; }
		if ( ang ) { const w = rb.angvel(); ang.x = w.x; ang.y = w.y; ang.z = w.z; }

	}

	readVelocity( n, vel ) {

		const v = n.rb.linvel();
		vel.x = v.x; vel.y = v.y; vel.z = v.z;

	}

	isSleeping( n ) {

		return n.rb.isSleeping();

	}

	wake( n ) {

		n.rb.wakeUp();

	}

	setForce( n, fx, fy, fz ) {

		n.rb.resetForces( false );
		if ( fx || fy || fz ) n.rb.addForce( { x: fx, y: fy, z: fz }, true );

	}

	applyImpulse( n, ix, iy, iz, px, py, pz ) {

		if ( px === undefined ) n.rb.applyImpulse( { x: ix, y: iy, z: iz }, true );
		else n.rb.applyImpulseAtPoint( { x: ix, y: iy, z: iz }, { x: px, y: py, z: pz }, true );

	}

	setVelocity( n, v, w ) {

		if ( v ) n.rb.setLinvel( v, true );
		if ( w ) n.rb.setAngvel( w, true );

	}

	setDamping( n, lin, ang ) {

		n.rb.setLinearDamping( lin );
		n.rb.setAngularDamping( ang );

	}

	setKinematicPose( n, p, q ) {

		n.rb.setNextKinematicTranslation( p );
		if ( q ) n.rb.setNextKinematicRotation( q );

	}

	setPose( n, p, q ) {

		n.rb.setTranslation( p, true );
		if ( q ) n.rb.setRotation( q, true );

	}

	step() {

		this.world.step();

	}

	// nearest hit along the segment origin + dir * t, t in [0, maxT]; filter( handle ) -> bool keeps a collider
	castRay( ox, oy, oz, dx, dy, dz, maxT, filter ) {

		const ray = this._ray;
		ray.origin.x = ox; ray.origin.y = oy; ray.origin.z = oz;
		ray.dir.x = dx; ray.dir.y = dy; ray.dir.z = dz;
		const pred = filter ? ( c ) => filter( c.handle ) : undefined;
		const hit = this.world.castRayAndGetNormal( ray, maxT, true, undefined, undefined, undefined, undefined, pred );
		if ( ! hit ) return null;
		return { t: hit.timeOfImpact, handle: hit.collider.handle, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z };

	}

	// does the body touch anything for which internal( handle ) is false (the ground, another prop, a static)?
	touching( n, internal ) {

		const w = this.world, c = n.col;
		let hit = false;
		w.contactPairsWith( c, ( other ) => {

			if ( hit || internal( other.handle ) ) return;
			w.contactPair( c, other, ( m ) => { if ( m.numContacts() > 0 ) hit = true; } );

		} );
		return hit;

	}

	dispose() {

		try { this.world.free(); } catch ( e ) { /* already gone */ }

	}

}
