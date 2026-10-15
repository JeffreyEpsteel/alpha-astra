// World map logic without the DOM: the world's bounds, the explored-area fog grid, the map view (pan / zoom
// projection, clamped) and small helpers (edge chevrons, the scale bar, compass words, waypoint clicks).
// src/ui/WorldMap.js draws with it; test/feature-worldmap.mjs runs it in plain node.
//
//   worldBounds( WORLD, terrain? )        { x0, z0, x1, z1 }: the heightmap plus every island and port, with a margin
//   const fog = new FogGrid( bounds, cell )
//     fog.reveal( x, z, r ) -> cells newly revealed      fog.revealedAt( x, z )      fog.revealAll() / clear()
//     fog.circleMask( circles ) -> Uint8Array            cells inside any { x, z, r } (charted islands)
//     fog.softAt( mask, x, z ) -> 0..1                   bilinear "revealed" over the cell centres
//     fog.count, fog.version (bumps on every change), fog.toJSON() / fromJSON( d ) (an older grid is remapped)
//   const v = new MapView( bounds )
//     v.setSize( w, h ); v.toScreen( x, z, out ); v.toWorld( sx, sy, out ); v.zoomAt( f, sx, sy ); v.panBy( dx, dy )
//     v.centerOn( x, z ); v.k (css px per metre, kMin .. kMax; kMin shows the whole world)
//     v.setInsets( { top, right, bottom, left } ) px kept clear (title bar, status line): the world fits and pans
//     inside the free area, so an island at the world's edge never has to sit under them; v.fit() shows it all
//   edgeClamp( sx, sy, w, h, inset )      a point kept inside the view: { x, y, edge, angle } (angle: clockwise from up)
//   niceScale( k, px )                    the scale bar: { metres, px, label }
//   pickWaypoint( current, x, z, k, hitPx ) the waypoint after a click: null when the click hits the current one
//   revealRadius( mode, height )          metres revealed around the player: on foot, at sea, more from up high
//   compass( dx, dz )                     'N' | 'NE' | ... for a world direction (north is -z)
//   viewAngle( fx, fz ) / yawAngle( yaw ) screen rotation (clockwise from up) of a direction / a boat-convention yaw

export const FOG_CELL = 64; // m
export const SEA_MODES = [ 'boat', 'deck', 'swim', 'seat', 'ride' ];

const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) );

export function worldBounds( world, terrain = null, margin = 120 ) {

	let x0 = Infinity, z0 = Infinity, x1 = - Infinity, z1 = - Infinity;
	const add = ( x, z, r = 0 ) => {

		if ( ! Number.isFinite( x ) || ! Number.isFinite( z ) ) return;
		x0 = Math.min( x0, x - r ); x1 = Math.max( x1, x + r );
		z0 = Math.min( z0, z - r ); z1 = Math.max( z1, z + r );

	};

	const size = terrain && Number.isFinite( terrain.size ) ? terrain.size : world && world.terrainSize;
	const org = terrain && Number.isFinite( terrain.origin ) ? terrain.origin : - ( size || 0 ) / 2;
	if ( size ) {

		add( org, org );
		add( org + size, org + size );

	}

	// islands and ports may lie beyond the heightmap (another worker adds islands): the map reaches them too
	for ( const i of ( world && world.islands ) || [] ) if ( i && i.center ) add( i.center.x, i.center.z, ( i.radius || 0 ) + margin );
	for ( const p of ( world && world.ports ) || [] ) if ( p && p.stand ) add( p.stand.x, p.stand.z, margin );
	if ( ! Number.isFinite( x0 ) ) return { x0: - 1024, z0: - 1024, x1: 1024, z1: 1024 };
	return { x0, z0, x1, z1 };

}

// ---- fog of the unexplored sea: coarse cells, revealed around the player and kept in the save
export class FogGrid {

	constructor( bounds, cell = FOG_CELL ) {

		this.cell = cell;
		this.x0 = Math.floor( bounds.x0 / cell ) * cell;
		this.z0 = Math.floor( bounds.z0 / cell ) * cell;
		this.nx = Math.max( 1, Math.ceil( ( bounds.x1 - this.x0 ) / cell ) );
		this.nz = Math.max( 1, Math.ceil( ( bounds.z1 - this.z0 ) / cell ) );
		this.cells = new Uint8Array( this.nx * this.nz );
		this.count = 0;
		this.version = 0;

	}

	get x1() {

		return this.x0 + this.nx * this.cell;

	}

	get z1() {

		return this.z0 + this.nz * this.cell;

	}

	index( x, z ) {

		const i = Math.floor( ( x - this.x0 ) / this.cell ), j = Math.floor( ( z - this.z0 ) / this.cell );
		return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? - 1 : j * this.nx + i;

	}

	revealedAt( x, z ) {

		const k = this.index( x, z );
		return k >= 0 && this.cells[ k ] === 1;

	}

	// cells whose centre lies within r of (x, z), and always the cell under it
	reveal( x, z, r ) {

		if ( ! Number.isFinite( x ) || ! Number.isFinite( z ) ) return 0;
		r = Math.max( 0, r || 0 );
		const c = this.cell, n0 = this.count;
		const i0 = Math.max( 0, Math.floor( ( x - r - this.x0 ) / c ) ), i1 = Math.min( this.nx - 1, Math.floor( ( x + r - this.x0 ) / c ) );
		const j0 = Math.max( 0, Math.floor( ( z - r - this.z0 ) / c ) ), j1 = Math.min( this.nz - 1, Math.floor( ( z + r - this.z0 ) / c ) );
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

			const dx = this.x0 + ( i + 0.5 ) * c - x, dz = this.z0 + ( j + 0.5 ) * c - z;
			const k = j * this.nx + i;
			if ( this.cells[ k ] || dx * dx + dz * dz > r * r ) continue;
			this.cells[ k ] = 1;
			this.count ++;

		}

		const k = this.index( x, z );
		if ( k >= 0 && ! this.cells[ k ] ) {

			this.cells[ k ] = 1;
			this.count ++;

		}

		const added = this.count - n0;
		if ( added ) this.version ++;
		return added;

	}

	revealAll() {

		this.cells.fill( 1 );
		this.count = this.cells.length;
		this.version ++;

	}

	clear() {

		this.cells.fill( 0 );
		this.count = 0;
		this.version ++;

	}

	// cells within any circle { x, z, r } (an island once it is charted), as a mask the size of the grid
	circleMask( circles, out = null ) {

		const m = out && out.length === this.cells.length ? out : new Uint8Array( this.cells.length );
		m.fill( 0 );
		const c = this.cell;
		for ( const q of circles || [] ) {

			if ( ! q || ! Number.isFinite( q.x ) || ! Number.isFinite( q.z ) ) continue;
			const r = Math.max( 0, q.r || 0 ) + c * 0.5;
			for ( let j = 0; j < this.nz; j ++ ) for ( let i = 0; i < this.nx; i ++ ) {

				const dx = this.x0 + ( i + 0.5 ) * c - q.x, dz = this.z0 + ( j + 0.5 ) * c - q.z;
				if ( dx * dx + dz * dz <= r * r ) m[ j * this.nx + i ] = 1;

			}

		}

		return m;

	}

	// 0 (fogged) .. 1 (revealed): the explored cells plus `extra` (a circleMask), bilinear over the cell centres
	softAt( extra, x, z ) {

		const c = this.cell, fx = ( x - this.x0 ) / c - 0.5, fz = ( z - this.z0 ) / c - 0.5;
		const i = Math.floor( fx ), j = Math.floor( fz ), tx = fx - i, tz = fz - j;
		const v = ( a, b ) => {

			if ( a < 0 || b < 0 || a >= this.nx || b >= this.nz ) return 0;
			const k = b * this.nx + a;
			return this.cells[ k ] || ( extra && extra[ k ] ) ? 1 : 0;

		};

		return ( v( i, j ) * ( 1 - tx ) + v( i + 1, j ) * tx ) * ( 1 - tz ) + ( v( i, j + 1 ) * ( 1 - tx ) + v( i + 1, j + 1 ) * tx ) * tz;

	}

	// the save: the grid's geometry and its cells as hex (4 cells a digit)
	toJSON() {

		let bits = '';
		for ( let k = 0; k < this.cells.length; k += 4 ) {

			const v = this.cells[ k ] | ( this.cells[ k + 1 ] << 1 ) | ( this.cells[ k + 2 ] << 2 ) | ( this.cells[ k + 3 ] << 3 );
			bits += v.toString( 16 );

		}

		return { cell: this.cell, x0: this.x0, z0: this.z0, nx: this.nx, nz: this.nz, bits };

	}

	// a grid saved with other bounds (the world grew) is remapped cell by cell through the centres
	fromJSON( d ) {

		this.cells.fill( 0 );
		this.count = 0;
		this.version ++;
		if ( ! d || typeof d !== 'object' || typeof d.bits !== 'string' || ! /^[0-9a-f]*$/.test( d.bits ) ) return false;
		const cell = Number( d.cell ), x0 = Number( d.x0 ), z0 = Number( d.z0 ), nx = Math.floor( Number( d.nx ) ), nz = Math.floor( Number( d.nz ) );
		if ( ! ( cell > 0 ) || ! Number.isFinite( x0 ) || ! Number.isFinite( z0 ) || ! ( nx > 0 ) || ! ( nz > 0 ) || nx * nz > 1 << 20 ) return false;
		const same = cell === this.cell && x0 === this.x0 && z0 === this.z0 && nx === this.nx && nz === this.nz;
		const n = Math.min( nx * nz, d.bits.length * 4 );
		for ( let k = 0; k < n; k ++ ) {

			if ( ! ( ( parseInt( d.bits[ k >> 2 ], 16 ) >> ( k & 3 ) ) & 1 ) ) continue;
			const t = same ? k : this.index( x0 + ( ( k % nx ) + 0.5 ) * cell, z0 + ( Math.floor( k / nx ) + 0.5 ) * cell );
			if ( t >= 0 && ! this.cells[ t ] ) {

				this.cells[ t ] = 1;
				this.count ++;

			}

		}

		return true;

	}

}

// ---- the view: north up, world x to the right and z down, k css px per metre
export class MapView {

	constructor( bounds, { kMax = 2.5 } = {} ) {

		this.bounds = bounds;
		this.w = 1;
		this.h = 1;
		this.kMax = kMax;
		this.kMin = 0.05;
		this.k = 0.5;
		this.cx = ( bounds.x0 + bounds.x1 ) / 2;
		this.cz = ( bounds.z0 + bounds.z1 ) / 2;
		this.inset = { top: 0, right: 0, bottom: 0, left: 0 };

	}

	// the free area's size (px), never below a quarter of the view
	get freeW() {

		return Math.max( this.w * 0.25, this.w - this.inset.left - this.inset.right );

	}

	get freeH() {

		return Math.max( this.h * 0.25, this.h - this.inset.top - this.inset.bottom );

	}

	// the zoom that shows the whole world (inside the free area)
	get fitK() {

		const B = this.bounds;
		return Math.min( this.freeW / Math.max( 1, B.x1 - B.x0 ), this.freeH / Math.max( 1, B.z1 - B.z0 ) );

	}

	setSize( w, h ) {

		this.w = Math.max( 1, w );
		this.h = Math.max( 1, h );
		this.kMin = Math.min( this.kMax, this.fitK );
		this.clamp();

	}

	setInsets( { top = 0, right = 0, bottom = 0, left = 0 } = {} ) {

		const f = ( v ) => Math.max( 0, Number.isFinite( v ) ? v : 0 );
		this.inset = { top: f( top ), right: f( right ), bottom: f( bottom ), left: f( left ) };
		this.setSize( this.w, this.h );

	}

	// the whole world, centred in the free area
	fit() {

		this.k = this.kMin;
		this.clamp();

	}

	// zoom within its range; the world stays in frame: centred in the free area when it fits, else its edges may
	// come no further in than the free area's edges
	clamp() {

		this.k = clamp( Number.isFinite( this.k ) ? this.k : this.kMin, this.kMin, this.kMax );
		const B = this.bounds, k = this.k, I = this.inset;
		const l = ( this.w - this.freeW ) * ( I.left / Math.max( 1e-9, I.left + I.right ) || 0 ), r = this.w - this.freeW - l;
		const t = ( this.h - this.freeH ) * ( I.top / Math.max( 1e-9, I.top + I.bottom ) || 0 ), b = this.h - this.freeH - t;
		const axis = ( c, a0, a1, size, lo, hi, free ) => ( a1 - a0 ) * k <= free + 1e-6
			? ( a0 + a1 ) / 2 - ( lo - hi ) / 2 / k
			: clamp( c, a0 + ( size / 2 - lo ) / k, a1 - ( size / 2 - hi ) / k );
		this.cx = axis( this.cx, B.x0, B.x1, this.w, l, r, this.freeW );
		this.cz = axis( this.cz, B.z0, B.z1, this.h, t, b, this.freeH );

	}

	toScreen( x, z, out = {} ) {

		out.x = ( x - this.cx ) * this.k + this.w / 2;
		out.y = ( z - this.cz ) * this.k + this.h / 2;
		return out;

	}

	toWorld( sx, sy, out = {} ) {

		out.x = ( sx - this.w / 2 ) / this.k + this.cx;
		out.z = ( sy - this.h / 2 ) / this.k + this.cz;
		return out;

	}

	// zoom by f keeping the world point under (sx, sy) in place (as far as the clamps allow)
	zoomAt( f, sx = this.w / 2, sy = this.h / 2 ) {

		const p = this.toWorld( sx, sy );
		this.k = clamp( this.k * f, this.kMin, this.kMax );
		this.cx = p.x - ( sx - this.w / 2 ) / this.k;
		this.cz = p.z - ( sy - this.h / 2 ) / this.k;
		this.clamp();

	}

	panBy( dx, dy ) {

		this.cx -= dx / this.k;
		this.cz -= dy / this.k;
		this.clamp();

	}

	centerOn( x, z ) {

		if ( Number.isFinite( x ) ) this.cx = x;
		if ( Number.isFinite( z ) ) this.cz = z;
		this.clamp();

	}

}

export function edgeClamp( sx, sy, w, h, inset = 20 ) {

	const cx = w / 2, cy = h / 2, dx = sx - cx, dy = sy - cy;
	const t = Math.max( Math.abs( dx ) / Math.max( 1, cx - inset ), Math.abs( dy ) / Math.max( 1, cy - inset ) );
	if ( t <= 1 ) return { x: sx, y: sy, edge: false, angle: 0 };
	return { x: cx + dx / t, y: cy + dy / t, edge: true, angle: Math.atan2( dx, - dy ) };

}

const STEPS = [ 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000 ];

export function niceScale( k, target = 110 ) {

	let m = STEPS[ 0 ];
	for ( const s of STEPS ) if ( s * k <= target ) m = s;
	return { metres: m, px: m * k, label: m >= 1000 ? `${ m / 1000 } km` : `${ m } m` };

}

export function pickWaypoint( current, x, z, k, hitPx = 16 ) {

	if ( ! Number.isFinite( x ) || ! Number.isFinite( z ) ) return current || null;
	if ( current && Math.hypot( current.x - x, current.z - z ) * k <= hitPx ) return null;
	return { x: Math.round( x * 10 ) / 10, z: Math.round( z * 10 ) / 10 };

}

export function revealRadius( mode, height = 0 ) {

	const base = SEA_MODES.includes( mode ) ? 240 : 120; // what the minimap shows on foot / at sea
	return Math.min( 900, base + Math.max( 0, ( height || 0 ) - 14 ) * 2.5 ); // and more from a hill or the air

}

const WORDS = [ 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW' ];

export function compass( dx, dz ) {

	const a = Math.atan2( dx, - dz );
	return WORDS[ ( ( Math.round( a / ( Math.PI / 4 ) ) % 8 ) + 8 ) % 8 ];

}

export const viewAngle = ( fx, fz ) => Math.atan2( fx, - fz );
export const yawAngle = ( yaw ) => Math.atan2( Math.sin( yaw ), - Math.cos( yaw ) ); // forward ( sin yaw, cos yaw )

// ---- discovery, the legend and the pins (wave 13C), pure so the node test can run them
//
//   discoveryState( discovered, isl, sandbox )      'charted' (named, clear of the fog) | 'unknown' (a "?" and a faint silhouette);
//                                                   the home island is always charted, the sandbox charts everything. A pirate
//                                                   island turns charted when the stronghold sights it (state.discovered gets
//                                                   'blackwater'); its battery reach is drawn only from then on
//   legendRows( { discovered, sandbox, kinds, pirate } ) the legend's rows in order: { kind, icon (an ICON name or ''), key, text }.
//                                                   Some rows wait for what they explain: the airstrip for Tidemark, the pirate
//                                                   island and its battery reach for a charted pirate island, the others for a marker of
//                                                   that kind (kinds: a Set of the kinds on the map now)
//   questPinMarker( e ) -> marker | null            a story step naming a place: questPin { id, x, z, label } -> a 'quest' pin
//   questPinId( id )                                 the marker id of a quest's pin (questPinClear { id } removes it)
//   parkedAirframes( seaplane, discovered )          the owned airframes standing at their base (not the one out): [ { id, name, x, z, port } ]
//   portMarkerKind( marker )                         the badge kind of a port's sub-marker: the airstrip's plane is its own kind

export function discoveryState( discovered, isl, sandbox = false ) {

	if ( sandbox || ! isl || isl.id === 'home' ) return 'charted';
	return typeof discovered === 'function' && discovered( isl.id ) ? 'charted' : 'unknown';

}

// [ kind, icon, i18n key, text, when ]  when: undefined (always) | 'disc:<island>' | 'pirate' | 'kind:<marker kind>'
const LEGEND = [
	[ 'me', 'arrow', 'worldmap.you', 'You' ],
	[ 'boat', 'boat', 'worldmap.boat', 'Your boat and crew' ],
	[ 'plane', 'plane', 'worldmap.seaplane', 'Seaplane' ],
	[ 'parked', 'plane', 'worldmap.parked', 'Parked plane', 'kind:parked' ],
	[ 'peer', '', 'worldmap.players', 'Other players' ],
	[ 'joe', 'fish', 'worldmap.stall', 'Fish stall' ],
	[ 'trade', 'crate', 'worldmap.trade', 'Trade stall' ],
	[ 'marta', 'anchor', 'worldmap.chandlery', 'Chandlery' ],
	[ 'yard', 'helm', 'worldmap.yard', 'Captain Roid’s yard' ],
	[ 'pons', 'anchor', 'worldmap.port', 'Port' ],
	[ 'airstrip', 'plane', 'worldmap.airstrip', 'Airstrip', 'disc:tidemark' ],
	[ 'board', 'board', 'worldmap.board', 'Notice board' ],
	[ 'camp', 'swords', 'worldmap.camp', 'Raider camp' ],
	[ 'isle', 'skull', 'worldmap.pirateIsle', 'Pirate island', 'pirate' ],
	[ 'battery', '', 'worldmap.battery', 'Battery reach', 'pirate' ],
	[ 'pirate', 'skull', 'worldmap.pirate', 'Pirate ship' ],
	[ 'bounty', 'target', 'worldmap.bounty', 'Bounty target' ],
	[ 'zone', '', 'worldmap.searchZone', 'Search zone' ],
	[ 'wreck', 'wreck', 'worldmap.wreck', 'Wreck', 'kind:wreck' ],
	[ 'death', 'chest', 'worldmap.chest', 'Sea chest', 'kind:death' ],
	[ 'quest', 'quest', 'worldmap.quest', 'Quest', 'kind:quest' ],
	[ 'pin', 'flag', 'worldmap.pin', 'Marked place', 'kind:pin' ],
	[ 'wp', 'flag', 'worldmap.waypoint', 'Waypoint' ],
	[ 'unknown', '?', 'worldmap.unknown', 'Undiscovered' ],
	[ 'fog', '', 'worldmap.fog', 'Unexplored' ],
];

export const LEGEND_KINDS = LEGEND.map( ( r ) => r[ 0 ] );

export function legendRows( { discovered = null, sandbox = false, kinds = null, pirate = null } = {} ) {

	const known = ( id ) => sandbox || ( typeof discovered === 'function' && !! discovered( id ) );
	const hasPirate = pirate === null ? ( ( typeof discovered === 'function' && discovered( 'blackwater' ) ) || sandbox ) : !! pirate;
	const has = ( k ) => !! ( kinds && typeof kinds.has === 'function' && kinds.has( k ) );
	const out = [];
	for ( const [ kind, icon, key, text, when ] of LEGEND ) {

		if ( when ) {

			if ( when === 'pirate' ) { if ( ! hasPirate ) continue; } else if ( when.startsWith( 'disc:' ) ) { if ( ! known( when.slice( 5 ) ) ) continue; } else if ( when.startsWith( 'kind:' ) ) { if ( ! has( when.slice( 5 ) ) ) continue; }

		}

		out.push( { kind, icon, key, text } );

	}

	return out;

}

export const questPinId = ( id ) => 'quest:' + id;

export function questPinMarker( e ) {

	if ( ! e || e.id === undefined || e.id === null || e.id === '' || ! Number.isFinite( e.x ) || ! Number.isFinite( e.z ) ) return null;
	return { id: questPinId( e.id ), kind: 'quest', icon: 'quest', x: e.x, z: e.z, label: typeof e.label === 'string' ? e.label.slice( 0, 48 ) : '', mine: true };

}

const cap = ( s ) => ( typeof s === 'string' && s ? s[ 0 ].toUpperCase() + s.slice( 1 ) : '' );

// the airframes the seaplane feature keeps in its hangar records (sp.fleet) that are owned, not wrecked and not the one
// out (sp.af: it has the plane marker): each stands at its base (sp.base( id ): the ramp's berth, the airstrip's pad)
export function parkedAirframes( sp, discovered = null ) {

	if ( ! sp || ! sp.fleet || typeof sp.fleet !== 'object' ) return [];
	const out = [];
	for ( const id of Object.keys( sp.fleet ) ) {

		const r = sp.fleet[ id ];
		if ( ! r || r.owned !== true || r.lost === true || id === sp.af ) continue;
		let b = null;
		try { b = typeof sp.base === 'function' ? sp.base( id ) : null; } catch ( e ) { b = null; }
		if ( ! b || ! Number.isFinite( b.x ) || ! Number.isFinite( b.z ) ) continue;
		const port = b.kind === 'strip' ? 'tidemark' : 'home';
		if ( typeof discovered === 'function' && ! discovered( port ) ) continue;
		out.push( { id, name: cap( id ), x: b.x, z: b.z, port } );

	}

	return out;

}

export const portMarkerKind = ( m ) => ( m && m.icon === 'plane' ? 'airstrip' : 'pons' );
