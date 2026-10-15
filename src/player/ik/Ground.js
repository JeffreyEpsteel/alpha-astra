import { Quaternion, Vector3 } from '../../engine/index.js';

// Ground probes for the foot IK (src/player/ik/ContactIK.js): probe( p, mode, out ) looks for the walkable surface under
// the world point p = { x, y, z }, no higher than a step above it, and fills out = { x, y, z, nx, ny, nz } (world hit point
// and surface normal). Returns false where there is nothing to stand on (the IK then leaves that foot to the clip).
// The point comes as an object, not three numbers, so the per-frame call boxes nothing.
//
//   avatar.setGroundProbe( playerGroundProbe( app.player ) )                   // the local player: terrain, piers, decks
//   avatar.setGroundProbe( terrainGroundProbe( app.terrainData, app.colliders ) ) // remote players / residents: on foot only

const STEP = 0.45; // m above the foot point a surface may be and still count as ground (Player DECK_STEP 0.36, pier steps)

// terrain plus walkable colliders (pier planks, boardwalk); the terrain gives its normal, planks are flat
function landProbe( terrain, colliders, reef ) {

	const n = new Vector3();
	return ( x, y, z, out ) => {

		const t = terrain.heightAt( x, z );
		let g = t;
		if ( colliders ) {

			const c = colliders.groundHeightAt( x, z, y + STEP );
			if ( c > g ) g = c;

		}

		if ( reef && reef.floorHeightAt ) g = Math.max( g, reef.floorHeightAt( x, z ) );
		if ( ! Number.isFinite( g ) ) return false;
		out.x = x; out.y = g; out.z = z;
		if ( g > t + 0.02 ) { out.nx = 0; out.ny = 1; out.nz = 0; } else {

			terrain.normalAt( x, z, n );
			out.nx = n.x; out.ny = n.y; out.nz = n.z;

		}

		return true;

	};

}

export function terrainGroundProbe( terrain, colliders = null ) {

	const land = landProbe( terrain, colliders, null );
	return ( p, mode, out ) => mode === 'walk' ? land( p.x, p.y, p.z, out ) : false;

}

// The local player (src/player/Player.js): on foot the terrain / colliders / reef floor, aboard the deck walker's surfaces
// (Player.deckGroundAt, boat frame: the sole, hatches, the quarterdeck and its steps) under the boat's own up axis, so a
// rolling deck still plants both feet. Riding another player's boat has no deck data here: no probe.
export function playerGroundProbe( player ) {

	const land = landProbe( player.terrain, player.colliders, player.reef );
	const l = new Vector3(), w = new Vector3(), inv = new Quaternion();
	return ( p, mode, out ) => {

		const pm = player.mode, x = p.x, y = p.y, z = p.z;
		if ( pm === 'walk' ) return land( x, y, z, out );
		const b = player.boat;
		if ( ( pm !== 'deck' && pm !== 'seat' ) || ! b || ! player.deckGroundAt ) return false;
		inv.copy( b.quaternion ).invert();
		l.set( x - b.position.x, y - b.position.y, z - b.position.z ).applyQuaternion( inv );
		l.y = player.deckGroundAt( l.x, l.z, l.y + STEP );
		b.toWorld( l, w );
		out.x = w.x; out.y = w.y; out.z = w.z;
		w.set( 0, 1, 0 ).applyQuaternion( b.quaternion );
		out.nx = w.x; out.ny = w.y; out.nz = w.z;
		return true;

	};

}
