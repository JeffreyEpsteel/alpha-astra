import { STAND } from '../../game/FishStand.js';
import { PONS_STAND } from '../../game/PonsPort.js';
import { TIDEMARK_BOARD } from '../../game/ports/TidemarkPort.js';

// Where the two notice boards stand, relative to the fish buyers' stalls so they follow them if the stalls move.
//   Hyptile: on the sand beside PoorGoat's stand towards the pier foot, facing the boardwalk like the stall (stall frame:
//            local +z is the front, local +x runs along the counter)
//   Pons:    between the stall and the dock foot, on the footpath side, facing the dock
// The offsets keep a metre or more from the stalls' crates and colliders and clear of the boardwalk, the dock
// and the footpath (test/feature-notices.mjs checks the clearances against the terrain and the stall boxes).
const OFFSET = {
	home: { lx: - 4.1, lz: 1.9 },
	pons: { lx: 3.4, lz: 3.0 },
};

function site( stand, o ) {

	const c = Math.cos( stand.yaw ), s = Math.sin( stand.yaw );
	return { x: Math.round( ( stand.x + o.lx * c + o.lz * s ) * 100 ) / 100, z: Math.round( ( stand.z - o.lx * s + o.lz * c ) * 100 ) / 100, yaw: stand.yaw };

}

export const BOARD_SITES = {
	home: site( STAND, OFFSET.home ),
	pons: site( PONS_STAND, OFFSET.pons ),
	tidemark: TIDEMARK_BOARD, // on Tidemark's market square (the town's layout places it: test/feature-town.mjs checks it)
};

// the stalls the boards stand beside (the test checks the clearance)
export const STALLS = { home: STAND, pons: PONS_STAND };
