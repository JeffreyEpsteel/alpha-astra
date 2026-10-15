// A stand-in for wave 21A's Meridian while its builder is not there (tests, the captures): a small plan in the shape of
// w21-common.md's cityPlan() (an avenue and two cross streets, a row of touching low buildings, shops, midrises, two
// highrises and the twin towers on their plaza) and the runtime handle with building handles (setStage, stage,
// fireAnchors, colliders, group, bounds, landmark, collapsible). With a scene, each building is a plain box mesh that
// setStage( 3 ) hides (21A's real builder draws its own and calls meridian.onStage the same way).
//
//   const plan = stubPlan( { x, z } )                     the plan (deterministic)
//   const city = stubCity( { plan, scene?, ground?, material? } )   -> { plan, building( id ), roadHeight( x, z ), onStage, group }

export function stubPlan( { x = 0, z = 0 } = {} ) {

	const B = [];
	const add = ( id, kind, bx, bz, w, d, h, extra = {} ) => B.push( {
		id, kind, x: x + bx, z: z + bz, w, d, h, yaw: 0, floors: Math.max( 1, Math.round( h / 3.4 ) ), style: kind,
		landmark: kind === 'tower', collapsible: kind !== 'highrise', block: extra.block || 'b0', ...extra,
	} );
	// the north side of the avenue (z < 0): a row of touching low buildings, two shops, a midrise
	add( 'stub.low.0', 'lowrise', - 52, - 16, 12, 12, 10, { block: 'n1' } );
	add( 'stub.low.1', 'lowrise', - 39, - 16, 12, 12, 9, { block: 'n1' } );
	add( 'stub.low.2', 'lowrise', - 26, - 16, 12, 12, 11, { block: 'n1' } );
	add( 'stub.shop.0', 'shop', - 13.5, - 15, 11, 10, 6, { block: 'n1', interior: 'meridian.stubshop' } );
	add( 'stub.low.3', 'lowrise', - 1, - 16, 12, 12, 10, { block: 'n1' } );
	add( 'stub.mid.0', 'midrise', 30, - 20, 18, 18, 24, { block: 'n2' } );
	add( 'stub.shop.1', 'shop', 52, - 15, 12, 10, 6, { block: 'n2' } );
	// the south side (z > 0): a warehouse, a midrise, a highrise
	add( 'stub.ware.0', 'warehouse', - 40, 20, 26, 18, 9, { block: 's1' } );
	add( 'stub.mid.1', 'midrise', - 6, 20, 18, 16, 21, { block: 's1' } );
	add( 'stub.high.0', 'highrise', 38, 26, 22, 22, 78, { block: 's2' } );
	// the twins on their plaza, beyond the east cross street
	add( 'stub.tower.0', 'tower', 112, - 30, 30, 30, 300, { block: 'plaza' } );
	add( 'stub.tower.1', 'tower', 112, 30, 30, 30, 300, { block: 'plaza' } );
	add( 'stub.high.1', 'highrise', 160, 0, 20, 20, 92, { block: 'e1' } );
	const nodes = [
		{ id: 'n0', x: x - 80, z, signal: false }, { id: 'n1', x: x + 14, z, signal: true }, { id: 'n2', x: x + 76, z, signal: true }, { id: 'n3', x: x + 190, z, signal: false },
		{ id: 'n4', x: x + 14, z: z - 60, signal: false }, { id: 'n5', x: x + 14, z: z + 60, signal: false },
		{ id: 'n6', x: x + 76, z: z - 70, signal: false }, { id: 'n7', x: x + 76, z: z + 70, signal: false },
	];
	const edges = [
		{ id: 'e0', a: 'n0', b: 'n1', lanes: 2, width: 9, speed: 13, oneWay: false },
		{ id: 'e1', a: 'n1', b: 'n2', lanes: 2, width: 9, speed: 13, oneWay: false },
		{ id: 'e2', a: 'n2', b: 'n3', lanes: 2, width: 9, speed: 13, oneWay: false },
		{ id: 'e3', a: 'n1', b: 'n4', lanes: 1, width: 7, speed: 9, oneWay: false },
		{ id: 'e4', a: 'n1', b: 'n5', lanes: 1, width: 7, speed: 9, oneWay: false },
		{ id: 'e5', a: 'n2', b: 'n6', lanes: 1, width: 7, speed: 9, oneWay: false },
		{ id: 'e6', a: 'n2', b: 'n7', lanes: 1, width: 7, speed: 9, oneWay: false },
	];
	return { buildings: B, roads: { nodes, edges }, parking: [], sidewalks: [], plazas: [ { x: x + 112, z, w: 60, d: 110 } ], docks: [] };

}

const STUB_COLORS = { lowrise: 0x8a5a44, shop: 0xa0704f, midrise: 0xb0a690, warehouse: 0x7c5b48, highrise: 0x9aa3ab, tower: 0xb9c0c6, station: 0xa79f8c, landmark: 0xb3a88e };

export function stubCity( { plan = stubPlan(), scene = null, ground = null, Mesh = null, BoxGeometry = null, Material = null, Group = null } = {} ) {

	const g = ground || ( () => 0 );
	const handles = new Map();
	const city = {
		id: 'meridian', stub: true, plan,
		group: null,
		onStage: null,
		roadHeight: ( x, z ) => g( x, z ),
		building: ( id ) => handles.get( id ) || null,
		buildings: () => [ ...handles.values() ],
	};
	if ( scene && Mesh && BoxGeometry && Group ) {

		city.group = new Group();
		city.group.name = 'stub-city';
		scene.add( city.group );

	}

	const mats = new Map();
	for ( const p of plan.buildings ) {

		const y0 = g( p.x, p.z );
		let mesh = null;
		if ( city.group ) {

			const col = STUB_COLORS[ p.kind ] || 0x999999;
			if ( ! mats.has( col ) ) {

				const r = ( col >> 16 & 255 ) / 255, gg = ( col >> 8 & 255 ) / 255, b = ( col & 255 ) / 255;
				mats.set( col, new Material( { name: 'stub-' + p.kind, roughness: 0.85, surface: `
					let wy = fract( in.P.y / 3.4 );
					let wx = fract( ( in.P.x + in.P.z ) / 2.6 );
					let win = step( 0.35, wy ) * step( wy, 0.8 ) * step( 0.25, wx ) * step( wx, 0.75 ) * step( 0.2, abs( in.N.x ) + abs( in.N.z ) );
					s.albedo = mix( vec3f( ${ ( r * r ).toFixed( 3 ) }, ${ ( gg * gg ).toFixed( 3 ) }, ${ ( b * b ).toFixed( 3 ) } ), vec3f( 0.05, 0.07, 0.09 ), win * 0.85 );
					s.roughness = mix( 0.85, 0.2, win );
				` } ) );

			}

			mesh = new Mesh( new BoxGeometry( p.w, p.h, p.d ), mats.get( col ) );
			mesh.position.set( p.x, y0 + p.h / 2, p.z );
			mesh.rotation.y = p.yaw || 0;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			mesh.name = 'stub-' + p.id;
			city.group.add( mesh );

		}

		const h = {
			id: p.id, group: mesh, stage: 0, landmark: !! p.landmark, collapsible: !! p.collapsible, interior: p.interior || null,
			bounds: { min: { x: p.x - p.w / 2, y: y0, z: p.z - p.d / 2 }, max: { x: p.x + p.w / 2, y: y0 + p.h, z: p.z + p.d / 2 } },
			colliders: [],
			fireAnchors: [ { x: p.x, y: y0 + p.h + 0.5, z: p.z }, { x: p.x + p.w * 0.25, y: y0 + Math.min( p.h * 0.5, 10 ), z: p.z + p.d / 2 + 0.3 }, { x: p.x - p.w * 0.25, y: y0 + Math.min( p.h * 0.4, 8 ), z: p.z - p.d / 2 - 0.3 } ],
			stages: [],
			setStage( s ) {

				if ( s === h.stage ) return h.stage;
				h.stage = s;
				h.stages.push( s );
				if ( mesh ) mesh.visible = s < 3;
				if ( typeof city.onStage === 'function' ) city.onStage( p.id, s );
				return s;

			},
		};
		handles.set( p.id, h );

	}

	return city;

}
