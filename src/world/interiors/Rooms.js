// The interiors (wave 19E): which shells open, and what stands inside each (plain data, no engine).
//
// A room is laid out in its building's frame: origin at the centre of the ground floor, x across, z toward the front
// (the door), y up from the floor; the inner wall faces at x = +-X, z = +-Z, the ceiling at h. The shells come from the
// towns as they build (Registry.js registerShell: Tidemark's tavern / chandlery / harbourmaster's office and the home
// village's Upturned Keel and Ethena's stilt hut through village/Buildings.js buildHouse, Blackwater's Rum Hole through
// Shells.js openCottage); the layouts are sized from them so a room always fits its shell.
//
//   INTERIORS            [ { id, port, name, style, service?, shop? } ]
//   OPEN_DOORS           village houses whose door opens (buildHouse looks them up by name and place)
//   layoutRoom( def, shell ) -> { X, Z, h, doorX, doorW, doorH, pieces, solids, seats, staff, lights, lining, well, spawn, views }
//     pieces   [ { piece, x, y, z, ry, s?, sx?, sy?, sz? } ]    kit pieces (public/models/interiors/kit.glb)
//     props    [ { prop, x, y, z, ry, s } ]                       StallKit's Poly Haven scans (crates, lifebuoy, shelves)
//     coils    [ { x, y, z, r } ]                                 rope coils on the floor (StallKit rope)
//     solids   [ { x, z, hx, hz, h } ]                            colliders, axis-aligned in the room, from the floor
//     seats    [ { n, x, y, z, yaw } ]                            y the seat height; yaw the way the sitter faces (frame rotation.y)
//     staff    { x, z, yaw, at: { x, z }, r } | null              behind the bar / counter (yaw: the figure's rotation.y), at: where E works
//     lights   [ { x, y, z, intensity, range, flicker, color } ]
//     spawn    { x, z, yaw }   (Player.yaw in the frame: 0 looks toward -z)

export const INTERIORS = [
	{ id: 'tidemark.tavern', port: 'tidemark', name: 'The Tide & Tankard', style: 'tavern', service: 'tavern' },
	{ id: 'tidemark.chandler', port: 'tidemark', name: 'Marlow\'s chandlery', style: 'chandlery', shop: { name: 'Tobias · Marlow\'s chandlery', character: 'bonk', greeting: 'Marlow\'s out on the quay. I keep the shop: rope, reels, powder and shot.', idle: 'Mind the rifles, they\'re loaded with dust.' } },
	{ id: 'tidemark.office', port: 'tidemark', name: 'Harbourmaster\'s office', style: 'office' },
	{ id: 'blackwater.rumhole', port: 'blackwater', name: 'The Rum Hole', style: 'rumhole', service: 'tavern' },
	{ id: 'home.keel', port: 'home', name: 'The Upturned Keel', style: 'keel', service: 'tavern' },
	{ id: 'home.ethena', port: 'home', name: 'Ethena\'s store', style: 'store', shop: { name: 'Pip · Ethena\'s store', character: 'pepe', greeting: 'Ethena\'s at the stall. In here it\'s the heavy gear.', idle: 'Shut the door, the wind takes the tickets.' } },
];

export const INTERIOR_BY_ID = Object.fromEntries( INTERIORS.map( ( d ) => [ d.id, d ] ) );

// the home village's houses that open (Village.js specs: house C is the Upturned Keel, the stilt hut S2 Ethena's store)
export const OPEN_DOORS = [
	{ id: 'home.keel', name: 'C', x: 62.5, z: - 106.0 },
	{ id: 'home.ethena', name: 'S2', x: 79.8, z: - 70.4 },
];
export const DOOR = { w: 1.0, h: 2.1 }; // an open doorway (a capsule of 0.3 m passes with 0.2 m to spare)

export function openDoorFor( s ) {

	if ( ! s ) return null;
	const o = OPEN_DOORS.find( ( d ) => d.name === s.name && Math.abs( d.x - s.x ) < 0.5 && Math.abs( d.z - s.z ) < 0.5 );
	return o ? { id: o.id, w: DOOR.w, h: DOOR.h } : null;

}

const PI = Math.PI;
// how far a wall-hung piece's origin sits off the wall's face (the kit's pieces have their backs at the origin, or centred)
const WALL_OFF = { firearms_rack: 0.08, notice_board: 0.045, chart_frame: 0.04, wheel_wall: 0.03, fish_mount: 0.04, net_wall: 0.035, rum_shelf: 0.17, plate_shelf: 0.13, door_closed: 0.045 };
const P = ( piece, x, y, z, ry = 0, o = {} ) => ( { piece, x, y, z, ry, ...o } );
const S = ( x, z, hx, hz, h ) => ( { x, z, hx, hz, h } );
const L = ( x, y, z, intensity, range, flicker = 0.05, color = [ 1.0, 0.7, 0.42 ] ) => ( { x, y, z, intensity, range, flicker, color } );
const seat = ( list, x, z, h, yaw ) => list.push( { n: list.length, x, y: h, z, yaw } );
// round a table: n stools at radius r, at the angles given (0: +x), each facing the centre
function ring( out, seats, cx, cz, angles, r = 0.74, piece = 'stool', h = 0.64 ) {

	for ( const a of angles ) {

		const x = cx + Math.cos( a ) * r, z = cz + Math.sin( a ) * r;
		const yaw = Math.atan2( cx - x, cz - z ); // facing the table
		out.push( P( piece, x, 0, z, yaw ) );
		seat( seats, x, z, h, yaw );

	}

}

const LINING = {
	tavern: { floor: '0x4e3826', wainscot: '0x3f5a48', wall: '0xb89c78', ceiling: '0x5e4632', layers: { floor: 1, wainscot: 3, wall: 0, ceiling: 1 }, tint: { floor: [ 0.85, 0.72, 0.6 ], wainscot: [ 0.42, 0.62, 0.5 ], wall: [ 1.0, 0.9, 0.76 ], ceiling: [ 0.7, 0.6, 0.5 ] } },
	keel: { floor: '0x4e3826', wainscot: '0x7a3428', wall: '0xc2a882', ceiling: '0x5e4632', layers: { floor: 1, wainscot: 3, wall: 0, ceiling: 1 }, tint: { floor: [ 0.85, 0.72, 0.6 ], wainscot: [ 0.8, 0.42, 0.36 ], wall: [ 1.0, 0.92, 0.8 ], ceiling: [ 0.7, 0.6, 0.5 ] } },
	rumhole: { floor: '0x3a2c22', wainscot: null, wall: '0x6e5a46', ceiling: '0x3a2c22', layers: { floor: 1, wainscot: 0, wall: 0, ceiling: 1 }, tint: { floor: [ 0.55, 0.48, 0.42 ], wall: [ 0.72, 0.62, 0.52 ], ceiling: [ 0.45, 0.4, 0.36 ] } },
	chandlery: { floor: '0x5a4430', wainscot: '0x2e4560', wall: '0xc8b898', ceiling: '0x6a5440', layers: { floor: 1, wainscot: 3, wall: 0, ceiling: 1 }, tint: { floor: [ 0.9, 0.8, 0.68 ], wainscot: [ 0.4, 0.52, 0.72 ], wall: [ 1.0, 0.96, 0.86 ], ceiling: [ 0.75, 0.66, 0.56 ] } },
	store: { floor: '0x5a4430', wainscot: '0x2d6f6a', wall: '0xc8b898', ceiling: '0x6a5440', layers: { floor: 1, wainscot: 3, wall: 0, ceiling: 1 }, tint: { floor: [ 0.9, 0.8, 0.68 ], wainscot: [ 0.4, 0.75, 0.7 ], wall: [ 1.0, 0.96, 0.86 ], ceiling: [ 0.75, 0.66, 0.56 ] } },
	office: { floor: '0x5a4430', wainscot: '0x2e4560', wall: '0xe6dcc6', ceiling: '0x8a7660', layers: { floor: 1, wainscot: 3, wall: 0, ceiling: 1 }, tint: { floor: [ 0.9, 0.8, 0.68 ], wainscot: [ 0.38, 0.5, 0.7 ], wall: [ 1.0, 0.98, 0.9 ], ceiling: [ 0.85, 0.78, 0.66 ] } },
};

// the room for one definition in one shell { w, d, t, h, doorX, doorW, doorH }
export function layoutRoom( def, shell ) {

	const X = shell.w / 2 - shell.t, Z = shell.d / 2 - shell.t, h = shell.h;
	const doorX = shell.doorX ?? 0, doorW = shell.doorW ?? DOOR.w, doorH = shell.doorH ?? DOOR.h;
	const R = { X, Z, h, doorX, doorW, doorH, pieces: [], props: [], coils: [], solids: [], seats: [], staff: null, lights: [], lining: LINING[ def.style ] || LINING.tavern, well: null, spawn: { x: doorX, z: Z - 1.1, yaw: 0 }, views: [] };
	// the open door leaf, hinged on the jamb's right side, swung into the room (along -z)
	const hinge = doorX + doorW / 2 + 0.03;
	R.pieces.push( P( 'door_leaf', hinge, 0, Z - 0.02, PI / 2 ) );
	R.solids.push( S( hinge, Z - 0.52, 0.05, 0.5, 2.1 ) );
	const build = STYLES[ def.style ] || STYLES.tavern;
	build( R, X, Z, h );
	// wall pieces stand off the lining by their own depth (placed at the wall line above; pushed along their facing)
	for ( const p of R.pieces ) {

		const off = WALL_OFF[ p.piece ];
		if ( off ) { p.x += Math.sin( p.ry ) * off; p.z += Math.cos( p.ry ) * off; }

	}

	return R;

}

const STYLES = {

	// The Tide & Tankard: the bar along the back on the left, the bottle shelves and the casks behind it, the stairs up the
	// back on the right, the hearth on the right wall with a rug and a chair, two tables of stools and the dice table
	tavern( R, X, Z, h ) {

		const p = R.pieces, s = R.seats;
		const bz = - Z + 1.95; // the bar's line
		const bx0 = - X + 0.65, bx1 = bx0 + 4.8; // two 2.4 m counters
		p.push( P( 'bar_counter', bx0 + 1.2, 0, bz ), P( 'bar_counter', bx0 + 3.6, 0, bz ) );
		p.push( P( 'bar_back', bx0 + 1.25, 0, - Z + 0.2 ), P( 'keg_rack', bx0 + 3.55, 0, - Z + 0.33 ) );
		p.push( P( 'bottles', bx0 + 0.45, 1.08, bz - 0.05 ), P( 'mugs', bx0 + 4.2, 1.08, bz ) );
		R.solids.push( S( ( bx0 + bx1 ) / 2, bz, 2.42, 0.38, 1.1 ), S( bx0 + 1.25, - Z + 0.2, 1.12, 0.21, 2.3 ), S( bx0 + 3.55, - Z + 0.33, 0.82, 0.32, 1.4 ) );
		for ( let i = 0; i < 5; i ++ ) {

			const x = bx0 + 0.55 + i * 0.85;
			if ( x > bx1 - 0.3 || Math.abs( x - R.doorX ) < 0.8 ) continue;
			p.push( P( 'stool', x, 0, bz + 0.68 ) );
			seat( s, x, bz + 0.68, 0.64, PI );

		}

		R.staff = { x: bx0 + 2.4, z: - Z + 0.85, yaw: 0, at: { x: bx0 + 2.4, z: bz + 0.75 }, r: 1.9 };
		// the stairs: up the back wall toward the right corner, the stairwell over their top
		const sx = Math.max( bx1 + 0.9, X - 3.6 );
		p.push( P( 'stairs', sx, 0, - Z + 0.52, - PI / 2 ) );
		R.solids.push( S( sx + 1.65, - Z + 0.55, 1.68, 0.56, h ) );
		R.well = { x0: sx + 1.6, x1: Math.min( X, sx + 3.4 ), z0: - Z, z1: - Z + 1.1 };
		// the hearth on the right wall, a rug and a chair before it
		const hz = Math.min( 0.6, Z - 2.6 );
		p.push( P( 'hearth', X - 0.375, 0, hz, - PI / 2 ), P( 'rug', X - 2.05, 0, hz, PI / 2 ), P( 'chair', X - 1.9, 0, hz + 0.85, PI / 2 ) );
		seat( s, X - 1.9, hz + 0.85, 0.45, PI / 2 );
		R.solids.push( S( X - 0.38, hz, 0.4, 0.98, h ) );
		// two round tables in the front half (clear of the way in from the door), the dice table by the stairs
		const t1 = { x: - X + 2.05, z: Z - 2.25 }, t2 = { x: X - 3.15, z: Z - 1.1 };
		p.push( P( 'table_round', t1.x, 0, t1.z ), P( 'mugs', t1.x, 0.76, t1.z, 0.6 ), P( 'table_round', t2.x, 0, t2.z ), P( 'candle', t2.x + 0.1, 0.76, t2.z ) );
		ring( p, s, t1.x, t1.z, [ 0, PI / 2 + 0.4, PI + 0.3, - PI / 2 ] );
		ring( p, s, t2.x, t2.z, [ 0, PI, - PI / 2 ] );
		R.solids.push( S( t1.x, t1.z, 0.46, 0.46, 0.8 ), S( t2.x, t2.z, 0.46, 0.46, 0.8 ) );
		const dt = { x: X - 3.1, z: - Z + 2.9 };
		p.push( P( 'dice_table', dt.x, 0, dt.z ), P( 'chair', dt.x - 0.78, 0, dt.z, PI / 2 ), P( 'chair', dt.x + 0.78, 0, dt.z, - PI / 2 ) );
		seat( s, dt.x - 0.78, dt.z, 0.45, PI / 2 );
		seat( s, dt.x + 0.78, dt.z, 0.45, - PI / 2 );
		R.solids.push( S( dt.x, dt.z, 0.5, 0.5, 0.8 ) );
		R.dice = { x: dt.x, z: dt.z };
		// the walls: the marlin, plates, a chart, the kitchen door; the lamps
		p.push( P( 'fish_mount', - X, 0, Z - 1.6, PI / 2 ), P( 'door_closed', - X, 0, bz + 1.05, PI / 2 ), P( 'plate_shelf', - X + 1.6, 0, Z, PI ), P( 'chart_frame', X - 1.4, 0, Z, PI ) );
		p.push( P( 'lantern_hang', bx0 + 2.4, h, bz ), P( 'chandelier', 0.3, h, 0.6 ), P( 'lantern_hang', t2.x, h, t2.z ) );
		R.lights.push( L( X - 0.65, 0.55, hz, 6, 7, 0.16, [ 1.0, 0.55, 0.25 ] ), L( 0.3, h - 0.65, 0.6, 7, 9 ), L( bx0 + 2.4, h - 0.85, bz, 4, 6, 0.08 ) );
		R.views.push( { name: 'bar', from: [ R.doorX + 0.2, 1.65, Z - 0.35 ], to: [ bx0 + 1.6, 1.0, - Z + 0.5 ] }, { name: 'hearth', from: [ - X + 0.6, 1.8, Z - 0.5 ], to: [ X - 0.5, 0.8, - 0.8 ] } );

	},

	// the Upturned Keel (home, house C): a smaller tavern, the bar across the back, the hearth on the right, two tables
	keel( R, X, Z, h ) {

		const p = R.pieces, s = R.seats;
		const bz = - Z + 1.75, bx = - X + 1.6;
		p.push( P( 'bar_counter', bx, 0, bz ), P( 'bar_back', bx, 0, - Z + 0.2 ), P( 'bottles', bx - 0.8, 1.08, bz - 0.05 ) );
		R.solids.push( S( bx, bz, 1.22, 0.38, 1.1 ), S( bx, - Z + 0.2, 1.12, 0.21, 2.3 ) );
		for ( const dx of [ - 0.8, 0.0, 0.8 ] ) {

			p.push( P( 'stool', bx + dx, 0, bz + 0.68 ) );
			seat( s, bx + dx, bz + 0.68, 0.64, PI );

		}

		R.staff = { x: bx, z: - Z + 0.85, yaw: 0, at: { x: bx, z: bz + 0.75 }, r: 1.8 };
		const hz = Math.min( - 0.5, Z - 3.6 );
		p.push( P( 'hearth', X - 0.375, 0, hz, - PI / 2 ), P( 'chair', X - 1.15, 0, hz + 0.35, PI / 2 ) );
		seat( s, X - 1.15, hz + 0.35, 0.45, PI / 2 );
		R.solids.push( S( X - 0.38, hz, 0.4, 0.98, h ) );
		p.push( P( 'keg_rack', Math.min( X - 2.0, bx + 2.55 ), 0, - Z + 0.33 ) );
		R.solids.push( S( Math.min( X - 2.0, bx + 2.55 ), - Z + 0.33, 0.82, 0.32, 1.4 ) );
		const t1 = { x: - X + 1.2, z: Z - 1.15 }, t2 = { x: X - 1.3, z: Z - 1.15 };
		p.push( P( 'table_round', t1.x, 0, t1.z ), P( 'mugs', t1.x, 0.76, t1.z, 2.2 ), P( 'table_round', t2.x, 0, t2.z ), P( 'candle', t2.x, 0.76, t2.z ) );
		ring( p, s, t1.x, t1.z, [ 0, - PI / 2 ] );
		ring( p, s, t2.x, t2.z, [ PI, - PI / 2 ] );
		R.solids.push( S( t1.x, t1.z, 0.46, 0.46, 0.8 ), S( t2.x, t2.z, 0.46, 0.46, 0.8 ) );
		p.push( P( 'fish_mount', - X, 0, 0.1, PI / 2 ), P( 'plate_shelf', - X + 1.3, 0, Z, PI ) );
		p.push( P( 'lantern_hang', bx, h, bz ), P( 'chandelier', 0.5, h, 0.3 ) );
		R.lights.push( L( X - 0.65, 0.55, hz, 5, 6, 0.16, [ 1.0, 0.55, 0.25 ] ), L( 0.5, h - 0.65, 0.3, 6, 8 ), L( bx, h - 0.85, bz, 3.5, 5, 0.08 ) );
		R.views.push( { name: 'bar', from: [ R.doorX + 0.3, 1.65, Z - 0.3 ], to: [ bx, 1.0, - Z + 0.3 ] } );

	},

	// the Rum Hole: a plank bar on casks, rough shelves of bottles and a skull, casks in the corner, barrel tables and
	// crates to sit on, a net on the wall, a hammock slung up high; candles in bottles and one lantern
	rumhole( R, X, Z, h ) {

		const p = R.pieces, s = R.seats;
		const bz = - Z + 1.55, bx = - X + 2.1;
		p.push( P( 'plank_bar', bx, 0, bz ), P( 'rum_shelf', bx - 0.2, 0, - Z ), P( 'rum_casks', X - 0.95, 0, - Z + 0.6, - 0.3 ) );
		p.push( P( 'candle_bottle', bx - 0.9, 1.05, bz ), P( 'candle_bottle', bx + 1.0, 1.05, bz + 0.05 ), P( 'bottles', bx + 0.3, 1.05, bz - 0.1 ) );
		R.solids.push( S( bx, bz, 1.45, 0.38, 1.1 ), S( X - 0.95, - Z + 0.6, 0.75, 0.55, 1.4 ) );
		for ( const dx of [ - 0.85, 0.0, 0.85 ] ) {

			if ( Math.abs( bx + dx - R.doorX ) < 0.8 ) continue;
			p.push( P( 'stool', bx + dx, 0, bz + 0.62 ) );
			seat( s, bx + dx, bz + 0.62, 0.64, PI );

		}

		R.staff = { x: bx, z: - Z + 0.6, yaw: 0, at: { x: bx, z: bz + 0.7 }, r: 1.8 };
		const t1 = { x: - X + 1.5, z: Z - 1.35 }, t2 = { x: X - 1.6, z: Z - 1.75 };
		p.push( P( 'barrel_table', t1.x, 0, t1.z ), P( 'candle_bottle', t1.x + 0.1, 0.92, t1.z ), P( 'barrel_table', t2.x, 0, t2.z ), P( 'candle_bottle', t2.x - 0.1, 0.92, t2.z + 0.05 ), P( 'mugs', t2.x, 0.92, t2.z, 1.1 ) );
		ring( p, s, t1.x, t1.z, [ 0, - PI / 2 ], 0.7, 'crate_seat', 0.45 );
		ring( p, s, t2.x, t2.z, [ 0, PI, - PI / 2 ], 0.7, 'crate_seat', 0.45 );
		R.solids.push( S( t1.x, t1.z, 0.42, 0.42, 0.95 ), S( t2.x, t2.z, 0.42, 0.42, 0.95 ) );
		p.push( P( 'net_wall', - X, 0, 0.2, PI / 2 ), P( 'hammock', X - 0.45, 0, - 0.35, - PI / 2 ), P( 'lantern_hang', bx, h, bz ) );
		R.lights.push( L( bx, h - 0.85, bz, 3.2, 5.5, 0.1 ), L( t1.x + 0.1, 1.3, t1.z, 2.2, 4.5, 0.25, [ 1.0, 0.62, 0.3 ] ), L( t2.x - 0.1, 1.3, t2.z, 2.2, 4.5, 0.25, [ 1.0, 0.62, 0.3 ] ) );
		R.views.push( { name: 'bar', from: [ R.doorX + 0.4, 1.6, Z - 0.3 ], to: [ bx, 1.0, - Z + 0.3 ] } );

	},

	// Marlow's chandlery: the counter across the room, shelves of rope and lanterns behind, the firearms rack on the left
	// wall, a display of floats and the lifebuoy on the right, crates by the door, coils of rope on the floor
	chandlery( R, X, Z, h ) {

		const p = R.pieces;
		const cz = - Z + 2.45, cx = R.doorX - 0.3;
		p.push( P( 'shop_counter', cx, 0, cz ) );
		R.solids.push( S( cx, cz, 1.12, 0.37, 1.05 ) );
		R.staff = { x: cx, z: cz - 0.85, yaw: 0, at: { x: cx, z: cz + 0.75 }, r: 1.7 };
		p.push( P( 'shelf_rope', - X + 1.75, 0, - Z + 0.23 ), P( 'shelf_rope', - X + 3.65, 0, - Z + 0.23 ), P( 'shelf_lanterns', X - 1.3, 0, - Z + 0.21 ) );
		R.solids.push( S( - X + 2.7, - Z + 0.23, 1.85, 0.24, 2.1 ), S( X - 1.3, - Z + 0.21, 0.72, 0.22, 2.0 ) );
		p.push( P( 'firearms_rack', - X, 0, 0.5, PI / 2 ) );
		R.solids.push( S( - X + 0.12, 0.5, 0.12, 0.78, 2.0 ) );
		p.push( P( 'crates_stack', - X + 0.85, 0, Z - 0.65, 0.3 ), P( 'bench', X - 1.2, 0, Z - 0.24, PI ) );
		R.solids.push( S( - X + 0.85, Z - 0.65, 0.68, 0.48, 1.0 ) );
		R.seats.push( { n: 0, x: X - 1.55, y: 0.46, z: Z - 0.24, yaw: PI }, { n: 1, x: X - 0.85, y: 0.46, z: Z - 0.24, yaw: PI } );
		R.props.push( { prop: 'wooden_display_shelves_01', x: X - 0.21, y: 0, z: - 0.2, ry: 0, s: 1 }, { prop: 'lifebuoy', x: X - 0.1, y: 1.7, z: 1.5, ry: - PI / 2, s: 1 } );
		R.props.push( { prop: 'wooden_crate_01', x: X - 0.5, y: 0, z: 0.85, ry: PI / 2 + 0.15, s: 1 } );
		R.solids.push( S( X - 0.22, - 0.2, 0.24, 0.6, 1.6 ), S( X - 0.5, 0.85, 0.26, 0.45, 0.4 ) );
		R.coils.push( { x: - X + 0.6, y: 0, z: - 0.9, r: 0.24 }, { x: - X + 1.2, y: 0, z: - 1.2, r: 0.2 } );
		p.push( P( 'lantern_hang', cx, h, cz ), P( 'lantern_hang', X - 2.0, h, 1.2 ) );
		R.lights.push( L( cx, h - 0.85, cz, 4.5, 7, 0.06 ), L( X - 2.0, h - 0.85, 1.2, 4, 7, 0.06 ) );
		R.spawn = { x: R.doorX, z: Z - 1.0, yaw: 0 };
		R.views.push( { name: 'counter', from: [ R.doorX - 0.3, 1.65, Z - 0.6 ], to: [ cx + 0.4, 1.0, - Z + 0.4 ] }, { name: 'rack', from: [ X - 0.7, 1.7, Z - 0.6 ], to: [ - X, 1.2, - 0.2 ] } );

	},

	// Ethena's store (the home stilt hut): a short counter, rope shelves behind, the firearms rack, crates
	store( R, X, Z, h ) {

		const p = R.pieces;
		const cz = - Z + 1.3, cx = - X + 1.45;
		p.push( P( 'shop_counter', cx, 0, cz, 0, { sx: 0.9 } ) );
		R.solids.push( S( cx, cz, 1.02, 0.37, 1.05 ) );
		R.staff = { x: cx, z: cz - 0.68, yaw: 0, at: { x: cx, z: cz + 0.75 }, r: 1.6 };
		p.push( P( 'shelf_rope', cx, 0, - Z + 0.23, 0, { sx: 0.85 } ) );
		p.push( P( 'firearms_rack', X, 0, - 0.55, - PI / 2 ) );
		R.solids.push( S( X - 0.12, - 0.55, 0.12, 0.78, 2.0 ) );
		p.push( P( 'crates_stack', - X + 0.75, 0, Z - 0.5, 0.2, { s: 0.8 } ) );
		R.solids.push( S( - X + 0.75, Z - 0.5, 0.55, 0.4, 0.9 ) );
		p.push( P( 'lantern_hang', 0.2, h, - 0.1 ) );
		R.lights.push( L( 0.2, h - 0.85, - 0.1, 4, 6, 0.06 ) );
		R.spawn = { x: R.doorX, z: Z - 0.8, yaw: 0 };
		R.views.push( { name: 'counter', from: [ R.doorX + 0.4, 1.6, Z - 0.25 ], to: [ cx - 0.2, 1.0, - Z ] } );

	},

	// the harbourmaster's office: the chart table, the notice board, a framed chart, the desk and its chair, a wheel
	office( R, X, Z, h ) {

		const p = R.pieces;
		p.push( P( 'chart_table', - X + 1.3, 0, - Z + 0.7 ) );
		R.solids.push( S( - X + 1.3, - Z + 0.7, 0.82, 0.52, 1.0 ) );
		p.push( P( 'notice_board', - X, 0, 0.55, PI / 2 ), P( 'chart_frame', X - 0.95, 0, - Z ) );
		p.push( P( 'desk', X - 0.36, 0, 0.1, - PI / 2 ), P( 'chair', X - 1.05, 0, 0.1, PI / 2 ) );
		R.seats.push( { n: 0, x: X - 1.05, y: 0.45, z: 0.1, yaw: PI / 2 } );
		R.solids.push( S( X - 0.36, 0.1, 0.34, 0.66, 0.8 ) );
		p.push( P( 'wheel_wall', X, 0, - Z + 0.55, - PI / 2 ), P( 'lantern_hang', 0, h, - 0.2 ) );
		R.lights.push( L( 0, h - 0.85, - 0.2, 4, 6, 0.04 ) );
		R.board = { x: - X + 0.6, z: 0.55 };
		R.spawn = { x: R.doorX, z: Z - 0.8, yaw: 0 };
		R.views.push( { name: 'room', from: [ R.doorX + 0.2, 1.65, Z - 0.2 ], to: [ - 0.4, 0.9, - Z ] } );

	},

};

// the shells as the towns build them (tests and the Blender renders lay the rooms out without a world): w, d, the wall
// thickness, the ground floor's ceiling height, the doorway
export const SHELL_HINTS = {
	'tidemark.tavern': { w: 11, d: 8, t: 0.14, h: 2.75, doorX: 0, doorW: DOOR.w, doorH: DOOR.h },
	'tidemark.chandler': { w: 9, d: 7, t: 0.14, h: 2.75, doorX: 0, doorW: DOOR.w, doorH: DOOR.h },
	'tidemark.office': { w: 4.4, d: 4, t: 0.14, h: 2.95, doorX: 0, doorW: DOOR.w, doorH: DOOR.h },
	'blackwater.rumhole': { w: 8, d: 6, t: 0.15, h: 2.6, doorX: 0, doorW: DOOR.w, doorH: DOOR.h },
	'home.keel': { w: 7, d: 5.8, t: 0.14, h: 2.75, doorX: 0, doorW: DOOR.w, doorH: DOOR.h },
	'home.ethena': { w: 4.4, d: 4.0, t: 0.14, h: 2.95, doorX: 0, doorW: DOOR.w, doorH: DOOR.h },
};
