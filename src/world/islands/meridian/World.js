import { Vector3 } from '../../../engine/index.js';
import { MERIDIAN, cityPlan, LAYOUT, toWorld } from './CityPlan.js';

// Meridian in the shared world layout (wave 21A): registerMeridian( WORLD ) adds (idempotently)
//   WORLD.meridian   { center, radius, dock (the stone pier in the harbour basin, WORLD.ports' dock shape), bay (the roads
//                    outside the harbour mouth: a seaplane lands there), airstrip (the runway on the reclaimed land, the shape
//                    of WORLD.tidemark.airstrip: x, z, y, heading, length, width, pad, hangar), town, market, lighthouse }
//   WORLD.islands    { id: 'meridian', name, center, radius, tile: true, city: true }
//   WORLD.ports      { id: 'meridian', name, dock, stand, market, center, radius, size: 2, roads, approach, lagoon }
// WorldLayout.js calls it at its end (root patch); Meridian.js calls it too, so the order of imports does not matter.

const r1 = ( v ) => Math.round( v * 10 ) / 10;
const V = ( p, y = 0 ) => new Vector3( r1( p.x ), y, r1( p.z ) );

export function meridianWorld() {

	const plan = cityPlan();
	const pier = plan.docks.find( ( d ) => d.kind === 'pier' );
	const heading = Math.round( Math.atan2( pier.b.x - pier.a.x, pier.b.z - pier.a.z ) * 1e4 ) / 1e4;
	const center = new Vector3( MERIDIAN.center.x, 0, MERIDIAN.center.z );
	const roads = toWorld( 900, - 8 );
	const A = plan.airstrip;
	return {
		center, radius: MERIDIAN.radius,
		dock: { position: V( pier.berth ), heading, start: V( pier.a ), end: V( pier.b ), deckHeight: pier.deck, width: pier.width },
		bay: { x: r1( roads.x ), z: r1( roads.z ), radius: 140 },
		airstrip: { x: A.x, z: A.z, y: A.y, heading: A.heading, length: A.length, width: A.width, pad: { x: A.pad.x, z: A.pad.z }, hangar: { ...A.hangar } },
		town: V( toWorld( ( LAYOUT.TWINS.x0 + LAYOUT.TWINS.x1 ) / 2, ( LAYOUT.TWINS.z0 + LAYOUT.TWINS.z1 ) / 2 ) ),
		market: V( plan.port.market ),
		lighthouse: V( plan.lighthouse ),
		stand: { ...plan.port.stand },
	};

}

export function registerMeridian( WORLD ) {

	if ( ! WORLD || WORLD.meridian ) return WORLD && WORLD.meridian;
	const M = meridianWorld();
	WORLD.meridian = M;
	if ( Array.isArray( WORLD.islands ) && ! WORLD.islands.some( ( i ) => i.id === 'meridian' ) ) WORLD.islands.push( { id: 'meridian', name: MERIDIAN.name, center: M.center, radius: M.radius, tile: true, city: true } );
	if ( Array.isArray( WORLD.ports ) && ! WORLD.ports.some( ( p ) => p.id === 'meridian' ) ) {

		const roads = [ M.bay.x, M.bay.z ];
		WORLD.ports.push( {
			id: 'meridian', name: MERIDIAN.name,
			dock: { ...M.dock },
			stand: { x: r1( M.stand.x ), z: r1( M.stand.z ), yaw: M.stand.yaw },
			market: { x: M.market.x, z: M.market.z },
			center: M.center, radius: M.radius, size: 2,
			// west from the harbour anchorage, south of Gull Rock and between West Haven and the Inverted Isles, to the roads
			roads, approach: [ [ 30, 200 ], [ - 110, 330 ], [ - 300, 360 ], [ - 560, 420 ], [ - 820, 380 ], [ - 1050, 200 ], [ - 1400, 20 ], [ - 1700, - 200 ], roads ],
			lagoon: { ...M.bay },
		} );

	}

	return M;

}
