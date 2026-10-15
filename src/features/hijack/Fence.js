// What Blackwater's fence pays for a stolen hull: a leaf module (only Boats.js behind it) so the universe server can price a
// fence sale without pulling the hijack rules, the ship classes and the engine into its image (test/deploy-config.mjs).
import { BOATS } from '../../game/Boats.js';

export const FENCE = 0.08; // the fraction of the yard price the fence pays

export function fencePrice( hull ) {

	const b = BOATS[ hull ];
	return b ? Math.round( b.price * FENCE / 10 ) * 10 : 0;

}
