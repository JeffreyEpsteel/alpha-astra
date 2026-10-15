import { BOATS } from '../../game/Boats.js';
import { BoatModel } from '../BoatModel.js';
import { FleetBoatModel } from './FleetBoatModel.js';
import { ShipBoatModel } from './ShipBoatModel.js';

// Builds the boat model for a Boats.js catalog id: the procedural lobster boat (kind
// 'procedural'), a fleet hull (kind 'fleet') or one of the three ships (kind 'ship', ShipBoatModel);
// the GLBs load asynchronously. Every model exposes `ready` (a promise of the model) so callers
// can await the visual uniformly.
export function createBoatModel( id ) {

	const spec = BOATS[ id ];
	if ( ! spec ) throw new Error( 'createBoatModel: unknown boat ' + id );
	const model = spec.kind === 'procedural' ? new BoatModel() : spec.kind === 'ship' ? new ShipBoatModel( id ) : new FleetBoatModel( id );
	model.id = id;
	if ( ! model.ready ) model.ready = Promise.resolve( model );
	return model;

}

// Catalog entry with its id (null for an unknown id).
export function boatInfo( id ) {

	const spec = BOATS[ id ];
	return spec ? { id, ...spec } : null;

}
