// The ships' GLB frame and hull centring, shared by the AI ships (features/naval/Models.js) and the player's ship
// (world/boat/ShipBoatModel.js).
//
// GLB frame: +X forward (bow), +Y up, origin at the waterline centre of the hull; the model is turned by MODEL_YAW
// (-PI/2 about Y) to meet the game's boat frame (+Z forward, +X port).

export const MODEL_YAW = - Math.PI / 2;

// The fork's export left the ships where the Blender scene laid them out side by side: the root node of
// brigantine_v2.glb is translated +24.53 m and trawler_v2.glb +54.67 m along the ship's own length axis (the
// manifest's source_layout_x_m), and StaticGLB bakes node transforms into the vertices. The hull is meant to be
// centred on the origin (manifest: "origin: waterline centre, hull centred on X"), so shift the meshes back by the
// middle of their X extent. Returns the shift applied (0 for an already centred hull like the sloop).
export function centreOnHull( glb ) {

	let lo = Infinity, hi = - Infinity;
	for ( const m of glb.meshes ) {

		const g = m.geometry;
		if ( ! g.boundingBox ) g.computeBoundingBox();
		lo = Math.min( lo, g.boundingBox.min.x );
		hi = Math.max( hi, g.boundingBox.max.x );

	}

	const mid = ( lo + hi ) / 2;
	glb.shiftX = 0;
	if ( ! Number.isFinite( mid ) || Math.abs( mid ) < 0.25 ) return 0;
	for ( const m of glb.meshes ) {

		m.geometry.translate( - mid, 0, 0 );
		m.geometry.computeBoundingBox();
		m.geometry.computeBoundingSphere();

	}

	glb.shiftX = - mid;
	return glb.shiftX;

}

// Mirror the hull across its centre plane (glTF z -> -z): positions, normals and the triangle winding, in place. The
// brigantine's ship's boat on skids stands in the boarding opening of the fork's -Y side, which in the game is the pier side
// of the berth (+X is port, the pier is to starboard of the moored ship); mirrored, the tender is on the open-sea side.
export function mirrorHull( glb ) {

	for ( const m of glb.meshes ) {

		const g = m.geometry;
		g.scale( 1, 1, - 1 );
		const idx = g.index.array;
		for ( let i = 0; i < idx.length; i += 3 ) {

			const t = idx[ i + 1 ];
			idx[ i + 1 ] = idx[ i + 2 ];
			idx[ i + 2 ] = t;

		}

		g.index.needsUpdate = true;
		g.computeBoundingBox();
		g.computeBoundingSphere();

	}

	glb.mirrored = true;

}
