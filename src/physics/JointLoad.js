// Joint loads for break forces (backend independent).
//
// Rapier does not report the force an impulse joint carries, so the facade estimates it from Newton's second law. For every
// body with joints, the force its joints must have supplied over the last step is
//     R = m ( dv / dt - g ) - F_known - J / dt
// (F_known: buoyancy and forces the game applied; J: impulses the game applied). The joint forces f_j are the minimum-norm
// solution of "joints sum to R at every free body", with bodies that touch the outside world (the ground, a static, another
// prop) or are fixed acting as anchors that take any remainder. Written as f_j = phi_b - phi_a, that is a graph Laplacian
// L phi = R with phi = 0 at anchors, solved by a few warm-started Gauss-Seidel sweeps per step.
//
// What it captures: weight hanging off a joint, a piece dragged by an impulse on its neighbour, a falling assembly that
// stops at the ground (impact shock). What it ignores: torques (a cantilever's bending moment), friction at anchors.
// Contacts between pieces of the same assembly count as joint load (an overestimate; break forces sit far above weights).

const SWEEPS = 12;

// joints: [ { a: body | null, b: body, ... } ] with body.node = { phi: {x,y,z}, R: {x,y,z}, anchored, links: [] } (nodes: those)
// Fills joint.load (N). Nodes keep phi between steps (warm start).
export function solveJointLoads( nodes, joints, sweeps = SWEEPS ) {

	for ( const n of nodes ) n.links.length = 0;
	for ( const j of joints ) {

		const na = j.a ? j.a.node : null, nb = j.b.node;
		if ( na ) na.links.push( nb );
		nb.links.push( na ); // null: the world, an anchor with phi = 0

	}

	for ( const n of nodes ) if ( n.anchored ) { n.phi.x = 0; n.phi.y = 0; n.phi.z = 0; }
	for ( let s = 0; s < sweeps; s ++ ) {

		for ( const n of nodes ) {

			if ( n.anchored || ! n.links.length ) continue;
			let x = n.R.x, y = n.R.y, z = n.R.z;
			for ( const o of n.links ) if ( o ) { x += o.phi.x; y += o.phi.y; z += o.phi.z; }
			const k = 1 / n.links.length;
			n.phi.x = x * k; n.phi.y = y * k; n.phi.z = z * k;

		}

	}

	for ( const j of joints ) {

		const pb = j.b.node.phi, pa = j.a ? j.a.node.phi : null;
		const x = pb.x - ( pa ? pa.x : 0 ), y = pb.y - ( pa ? pa.y : 0 ), z = pb.z - ( pa ? pa.z : 0 );
		j.load = Math.sqrt( x * x + y * y + z * z );

	}

}
