// Performance scenarios (P1 / P2 of docs/UNREAL_PARITY.md): plain data and pure helpers, shared by the browser runner
// (tools/perf/runner.js, ?bench&perf=...) and the node test (test/perf-scenarios.mjs). No DOM, no engine.
//
//   SCENARIOS[ id ]        { id, name, about, time, weather, intensity, place, ships, fire, peers, warm, frames, dt }
//     place                { kind: 'helm' | 'deck' | 'walk' | 'fly', port?: id (its stand) | x, z, heading, boat?: BOATS id, pose?: { x, y, z, yaw, pitch },
//                            interior?: id (wave 20A: inside that room, interiors.enter( id ); x, z the fallback without the feature) }
//     ships                [ { kind: 'trawler' | 'sloop' | 'brigantine', dx, dz, state? } ]  placed around the player
//     fire                 { every: s }  the player's guns, port and starboard in turn
//     peers                number of stand-in remote players walking around the player (the crowd)
//     weapon               a melee weapon id drawn for the run (weapons feature: owned, slot 1)
//   SCOPES                 [ [ label, app path, method ] ]  the per-system CPU scopes (feature updates get 'feature:<name>')
//   parsePerfQuery( 'all' | 'navalFight,storm' | '1' ) -> [ id ]
//   validateScenario( s, { boats, ports, shipKinds } ) -> [ problem ]
//   summarize( numbers ) -> { n, mean, p50, p95, p99, min, max }      budget( frames, ms = 16.7 ) -> { over, share }
//   rankScopes( perFrame ) -> [ { name, mean, p95, max, share } ]   (perFrame: [ { scope: ms } ])
//   cullingCandidates( report, opts ) -> { candidates: [ ... ], unverified: [ ... ] }   P2: what to cull, from numbers
//
// The numbers only exist after a run in a real browser (the runner posts perf-<tag>.json to tools/perf/collect.mjs);
// candidates without numbers are listed as unverified.

export const BUDGET_MS = 1000 / 60;
export const DEFAULT_WARM = 90;
export const DEFAULT_FRAMES = 240;

export const SCENARIOS = {
	navalFight: {
		id: 'navalFight', name: 'Naval fight', about: 'at the helm of the brigantine, two sloops and a brigantine closing, a trawler passing, guns firing',
		time: 15.5, weather: 'clear', intensity: 0,
		place: { kind: 'helm', boat: 'brigantine', x: 260, z: 320, heading: 0.8 },
		ships: [ { kind: 'sloop', dx: 140, dz: 70, state: 'chase' }, { kind: 'sloop', dx: - 110, dz: 150, state: 'chase' }, { kind: 'brigantine', dx: 70, dz: - 170, state: 'chase' }, { kind: 'trawler', dx: - 220, dz: - 60 } ],
		fire: { every: 1.6 }, peers: 0,
	},
	storm: {
		id: 'storm', name: 'Storm', about: 'on deck in open water, full storm (rain, wind, sea state, lightning)',
		time: 14, weather: 'storm', intensity: 1,
		place: { kind: 'deck', boat: 'launch', x: 200, z: 260, heading: 2.4 },
		ships: [], fire: null, peers: 0,
	},
	night: {
		id: 'night', name: 'Night', about: 'on foot at the home harbour at 23:00: lamps, lanterns, night glow, bioluminescence',
		time: 23, weather: 'clear', intensity: 0,
		place: { kind: 'walk', port: 'home' },
		ships: [], fire: null, peers: 0,
	},
	crowd: {
		id: 'crowd', name: 'Crowd', about: 'the home harbour at dusk with the residents and 16 stand-in players walking about',
		time: 18.5, weather: 'clear', intensity: 0,
		place: { kind: 'walk', port: 'home' },
		ships: [], fire: null, peers: 16,
	},
	all: {
		id: 'all', name: 'Everything', about: 'a night storm fight at the helm with a crowd of players around: every system at once',
		time: 22.5, weather: 'storm', intensity: 0.8,
		place: { kind: 'helm', boat: 'brigantine', x: 260, z: 320, heading: 0.8 },
		ships: [ { kind: 'sloop', dx: 140, dz: 70, state: 'chase' }, { kind: 'brigantine', dx: 70, dz: - 170, state: 'chase' }, { kind: 'trawler', dx: - 220, dz: - 60 } ],
		fire: { every: 2 }, peers: 12,
	},
	// wave 16C: the three places of the two-tile world on foot at noon (GPU memory and frame time per profile)
	homeBay: {
		id: 'homeBay', name: 'Home bay', about: 'on foot at the home harbour stand at noon: the village, the bay, the home island plants',
		time: 12, weather: 'clear', intensity: 0,
		place: { kind: 'walk', port: 'home' },
		ships: [], fire: null, peers: 0, frames: 180,
	},
	tidemarkQuay: {
		id: 'tidemarkQuay', name: 'Tidemark quay', about: 'on foot on the Tidemark quay at noon: the town, its tile, ~7,500 plants',
		time: 12, weather: 'clear', intensity: 0,
		place: { kind: 'walk', port: 'tidemark' },
		ships: [], fire: null, peers: 0, frames: 180,
	},
	blackwaterCove: {
		id: 'blackwaterCove', name: 'Blackwater cove', about: 'on foot on the Blackwater dock at noon, looking over the cove: the fort, the tile, the scrub',
		time: 12, weather: 'clear', intensity: 0,
		// (x, z: the dock as WorldLayout places it; `at` re-reads WORLD.blackwater.dock in the runner)
		place: { kind: 'walk', at: 'blackwater', x: - 197.8, z: 1505.6, heading: 1.75 },
		ships: [], fire: null, peers: 0, frames: 180,
	},
	// wave 19A: Tidemark's market square at noon with wave 18's townsfolk (townlife), the dressing kit (TownKit) and a
	// cutlass drawn (weapons); x, z: Layout.js at( -106, 8 ), the inland edge of the square, facing the bay over it
	tidemarkSquare: {
		id: 'tidemarkSquare', name: 'Tidemark square', about: 'on foot in the Tidemark market square at noon, cutlass drawn: the townsfolk, the kit, the stalls',
		time: 12, weather: 'clear', intensity: 0,
		place: { kind: 'walk', x: 1819.4, z: - 22.4, heading: 1.134 },
		ships: [], fire: null, peers: 0, frames: 180, warm: 240, weapon: 'cutlass',
	},
	// wave 20A: inside the Tide & Tankard at 19:00 (an interior loaded: its kit, lining and lights; the town around it)
	tidemarkTavern: {
		id: 'tidemarkTavern', name: 'Tidemark tavern', about: 'inside the Tide & Tankard at dusk: the interior loaded, the barkeep, the town outside',
		time: 19, weather: 'clear', intensity: 0,
		place: { kind: 'walk', interior: 'tidemark.tavern', x: 1844.8, z: - 43.7, heading: 1.134 },
		ships: [], fire: null, peers: 0, frames: 180, warm: 240,
	},
	// wave 22A: Meridian on phones: downtown at the Twins Plaza (the towers, the blocks, the traffic), the harbour (the port
	// stand on the quay), the skyline seen from home (the far impostor), and a car on the avenue (car: driven for the run)
	meridianDowntown: {
		id: 'meridianDowntown', name: 'Meridian downtown', about: 'on foot at the west edge of the Twins Plaza at noon, facing the towers: the blocks, the streets, the traffic',
		time: 12, weather: 'clear', intensity: 0,
		place: { kind: 'walk', x: - 2662, z: - 296, heading: - 1.45 },
		ships: [], fire: null, peers: 0, frames: 180, warm: 240,
	},
	meridianHarbour: {
		id: 'meridianHarbour', name: 'Meridian harbour', about: 'on foot at the Meridian port stand on the quay at noon: the harbour, the waterfront blocks, the skyline behind',
		time: 12, weather: 'clear', intensity: 0,
		place: { kind: 'walk', port: 'meridian' },
		ships: [], fire: null, peers: 0, frames: 180, warm: 240,
	},
	homeSkyline: {
		id: 'homeSkyline', name: 'Skyline from home', about: 'on foot at the home harbour stand at noon looking west: Meridian on the horizon (its far impostor)',
		time: 12, weather: 'clear', intensity: 0,
		place: { kind: 'walk', port: 'home', heading: 1.57 }, // (heading: facing west, over the stand's own)
		ships: [], fire: null, peers: 0, frames: 180,
	},
	meridianDrive: {
		id: 'meridianDrive', name: 'Meridian drive', about: 'driving a sedan along the avenue south of the Twins Plaza at 17:30: the traffic, the parked cars, the city',
		time: 17.5, weather: 'clear', intensity: 0,
		place: { kind: 'walk', x: - 2700, z: - 181.5, heading: - 1.5708 }, car: 'sedan', // (a westbound lane: RoadGraph.at)
		ships: [], fire: null, peers: 0, frames: 180, warm: 240,
	},
};

// wave 22A: Meridian's views (`--perf=meridian`; also in `views`)
export const MERIDIAN_SET = [ 'meridianDowntown', 'meridianHarbour', 'homeSkyline', 'meridianDrive' ];
// the views of the wave 16C pass (not in 'every' runs of the old guard: listed explicitly)
export const VIEW_SET = [ 'homeBay', 'tidemarkQuay', 'tidemarkSquare', 'blackwaterCove', 'tidemarkTavern', ...MERIDIAN_SET ];

export const SCENARIO_IDS = Object.keys( SCENARIOS );
export const DEFAULT_SET = [ 'navalFight', 'storm', 'night', 'crowd' ];

// [ label, path on the app, method ]: wrapped with a timer while a scenario is measured (only those that exist)
export const SCOPES = [
	[ 'game', 'game', 'update' ], [ 'features', 'features', 'update' ], [ 'player', 'player', 'update' ], [ 'boat physics', 'boatCtl', 'update' ],
	[ 'boat spray', 'boatSpray', 'update' ], [ 'wake', 'wake', 'update' ], [ 'avatar', 'avatar', 'update' ], [ 'remote players', 'remotePlayers', 'update' ],
	[ 'boat yard', 'boatYard', 'update' ], [ 'atmosphere', 'atmosphere', 'update' ], [ 'fft', 'fft', 'update' ], [ 'sea detail', 'seaDetail', 'update' ],
	[ 'water query', 'query', 'update' ], [ 'caustics', 'caustics', 'update' ], [ 'marine snow', 'marineSnow', 'update' ], [ 'air motes', 'airMotes', 'update' ],
	[ 'shore sim', 'shoreSim', 'update' ], [ 'breakers', 'breakers', 'update' ], [ 'spray', 'spray', 'update' ], [ 'clouds', 'clouds', 'update' ],
	[ 'environment', 'environment', 'update' ], [ 'ocean lod', 'oceanLOD', 'update' ], [ 'terrain', 'terrain', 'update' ], [ 'rocks', 'rocks', 'update' ],
	[ 'debris', 'debris', 'update' ], [ 'reef', 'reef', 'update' ], [ 'village', 'village', 'update' ], [ 'residents', 'residents', 'update' ],
	[ 'vegetation', 'vegetation', 'update' ], [ 'whale', 'whale', 'update' ], [ 'boat model', 'boat', 'update' ], [ 'wildlife', 'wildlife', 'update' ],
	[ 'local lights', 'localLights', 'update' ], [ 'shadows', 'shadows', 'render' ], [ 'scene render', 'sceneRenderer', 'render' ], [ 'post', 'post', 'render' ],
	[ 'audio', '', 'updateAudio' ], [ 'ui', 'ui', 'update' ], [ 'camera feel', 'cameraFeel', 'update' ],
];

// P2 (LOD and distance culling for vessels, projectiles, residents): which scopes speak for which kind of object
export const P2_KINDS = [
	{ kind: 'vessels', scopes: [ 'feature:naval', 'feature:boarding', 'feature:pirates', 'feature:shipdamage', 'remote players' ], fix: 'sleep / LOD far ships (naval/Models.js), skip far ship physics, cull ship lights and sails beyond view' },
	{ kind: 'projectiles', scopes: [ 'feature:naval', 'feature:vfx', 'feature:destruction' ], fix: 'cap live balls and particles, drop splash / smoke emitters beyond ~400 m, pool projectile meshes' },
	{ kind: 'residents', scopes: [ 'residents', 'remote players', 'feature:harbour', 'avatar' ], fix: 'lower the animate radius (Residents 60 m) or animate at half rate past 30 m, hide name tags past 60 m' },
	{ kind: 'wildlife and dressing', scopes: [ 'wildlife', 'feature:dressing', 'feature:life', 'vegetation', 'reef' ], fix: 'distance-cull schools and harbour props, update flocks every other frame' },
];

export function parsePerfQuery( q ) {

	const s = typeof q === 'string' ? q.trim() : '';
	if ( ! s || s === '1' || s === 'true' || s === 'default' ) return DEFAULT_SET.slice();
	if ( s === 'every' ) return SCENARIO_IDS.filter( ( id ) => ! VIEW_SET.includes( id ) );
	if ( s === 'views' ) return VIEW_SET.slice();
	if ( s === 'meridian' ) return MERIDIAN_SET.slice();
	const ids = s.split( ',' ).map( ( x ) => x.trim() ).filter( ( x ) => SCENARIOS[ x ] );
	return ids.length ? [ ...new Set( ids ) ] : DEFAULT_SET.slice();

}

// problems with a scenario (empty: fine). boats / ports / shipKinds: the known ids (the test passes the game's own lists)
export function validateScenario( s, { boats = null, ports = null, shipKinds = null } = {} ) {

	const out = [];
	const has = ( list, id ) => ! list || ( list instanceof Set ? list.has( id ) : list.includes( id ) );
	if ( ! s || typeof s !== 'object' ) return [ 'not an object' ];
	if ( typeof s.id !== 'string' || ! s.id ) out.push( 'id missing' );
	if ( typeof s.name !== 'string' || ! s.name ) out.push( 'name missing' );
	if ( ! ( Number.isFinite( s.time ) && s.time >= 0 && s.time < 24 ) ) out.push( 'time must be 0..24 hours' );
	if ( s.weather !== null && s.weather !== undefined && typeof s.weather !== 'string' ) out.push( 'weather must be a kind or null' );
	if ( s.intensity !== undefined && ! ( Number.isFinite( s.intensity ) && s.intensity >= 0 && s.intensity <= 1 ) ) out.push( 'intensity must be 0..1' );
	const p = s.place;
	if ( ! p || ! [ 'helm', 'deck', 'walk', 'fly' ].includes( p.kind ) ) out.push( 'place.kind must be helm, deck, walk or fly' );
	else {

		if ( p.port !== undefined && ! has( ports, p.port ) ) out.push( `unknown port ${ p.port }` );
		if ( p.port === undefined && p.kind !== 'fly' && ! ( Number.isFinite( p.x ) && Number.isFinite( p.z ) ) ) out.push( 'place needs a port or x, z' );
		if ( ( p.kind === 'helm' || p.kind === 'deck' ) && p.boat !== undefined && ! has( boats, p.boat ) ) out.push( `unknown boat ${ p.boat }` );
		if ( p.kind === 'fly' && ! ( p.pose && Number.isFinite( p.pose.x ) && Number.isFinite( p.pose.z ) ) ) out.push( 'fly needs a pose' );

	}

	if ( ! Array.isArray( s.ships ) ) out.push( 'ships must be a list' );
	else s.ships.forEach( ( sh, i ) => {

		if ( ! sh || ! has( shipKinds, sh.kind ) ) out.push( `ships[${ i }]: unknown kind ${ sh && sh.kind }` );
		else if ( ! ( Number.isFinite( sh.dx ) && Number.isFinite( sh.dz ) ) ) out.push( `ships[${ i }]: dx, dz needed` );
		else if ( Math.hypot( sh.dx, sh.dz ) < 40 ) out.push( `ships[${ i }]: closer than 40 m (would ram the player)` );

	} );
	if ( s.fire && ! ( Number.isFinite( s.fire.every ) && s.fire.every > 0.2 ) ) out.push( 'fire.every must be > 0.2 s' );
	if ( s.fire && s.place && s.place.kind !== 'helm' ) out.push( 'fire needs the helm' );
	if ( s.peers !== undefined && ! ( Number.isInteger( s.peers ) && s.peers >= 0 && s.peers <= 64 ) ) out.push( 'peers must be 0..64' );
	if ( s.weapon !== undefined && typeof s.weapon !== 'string' ) out.push( 'weapon must be a weapon id' );
	if ( p && p.interior !== undefined && ( typeof p.interior !== 'string' || p.kind !== 'walk' ) ) out.push( 'place.interior must be a room id, on foot' );
	for ( const k of [ 'warm', 'frames' ] ) if ( s[ k ] !== undefined && ! ( Number.isInteger( s[ k ] ) && s[ k ] > 0 ) ) out.push( `${ k } must be a positive integer` );
	return out;

}

// ---- numbers

export function summarize( values ) {

	const v = ( values || [] ).filter( ( x ) => Number.isFinite( x ) ).sort( ( a, b ) => a - b );
	const n = v.length;
	if ( ! n ) return { n: 0, mean: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
	const q = ( p ) => v[ Math.min( n - 1, Math.max( 0, Math.ceil( p * n ) - 1 ) ) ];
	const r = ( x ) => Math.round( x * 1000 ) / 1000;
	return { n, mean: r( v.reduce( ( a, b ) => a + b, 0 ) / n ), p50: r( q( 0.5 ) ), p95: r( q( 0.95 ) ), p99: r( q( 0.99 ) ), min: r( v[ 0 ] ), max: r( v[ n - 1 ] ) };

}

// frames over a budget (ms per frame)
export function budget( frames, ms = BUDGET_MS ) {

	const v = ( frames || [] ).filter( ( x ) => Number.isFinite( x ) );
	const over = v.filter( ( x ) => x > ms ).length;
	return { ms: Math.round( ms * 100 ) / 100, over, share: v.length ? Math.round( 1000 * over / v.length ) / 1000 : 0 };

}

// 'pass:<label>' (mesh pass CPU time, inside 'scene render' / 'shadows'), 'draws:<label>' and 'tris:<label>' (counts) are
// nested: listed, never added to the total or the shares
export const isNested = ( name ) => /^(pass|draws|tris):/.test( name );

// perFrame: [ { scopeName: ms } ] -> the scopes by mean cost; share = of the summed scope time (top-level scopes only)
export function rankScopes( perFrame ) {

	const series = new Map();
	for ( const f of perFrame || [] ) for ( const [ k, ms ] of Object.entries( f ) ) {

		if ( ! series.has( k ) ) series.set( k, [] );
		series.get( k ).push( ms );

	}

	const n = ( perFrame || [] ).length || 1;
	const rows = [];
	let total = 0;
	for ( const [ name, v ] of series ) {

		// a scope missing from a frame cost 0 there
		while ( v.length < n ) v.push( 0 );
		const s = summarize( v );
		const nested = isNested( name );
		rows.push( nested ? { name, mean: s.mean, p95: s.p95, max: s.max, nested: true } : { name, mean: s.mean, p95: s.p95, max: s.max } );
		if ( ! nested ) total += s.mean;

	}

	for ( const r of rows ) r.share = total > 0 ? Math.round( 1000 * r.mean / total ) / 1000 : 0;
	return rows.sort( ( a, b ) => b.mean - a.mean );

}

// P2 candidates from a runner report ({ scenarios: { id: { scopes: rankScopes(...) } } }): a P2 kind is a candidate when
// one of its scopes costs at least minMs on average or minShare of the CPU scope time in some scenario; P2 kinds whose
// scopes never appear (no numbers) are unverified.
export function cullingCandidates( report, { minMs = 0.5, minShare = 0.08 } = {} ) {

	const worst = new Map(); // scope -> { mean, share, p95, scenario }
	const scen = report && report.scenarios ? report.scenarios : {};
	for ( const [ id, r ] of Object.entries( scen ) ) for ( const row of ( r && r.scopes ) || [] ) {

		const w = worst.get( row.name );
		if ( ! w || row.mean > w.mean ) worst.set( row.name, { mean: row.mean, share: row.share, p95: row.p95, scenario: id } );

	}

	const candidates = [], unverified = [];
	for ( const k of P2_KINDS ) {

		const seen = k.scopes.filter( ( s ) => worst.has( s ) );
		if ( ! seen.length ) {

			unverified.push( { kind: k.kind, scopes: k.scopes, fix: k.fix, why: 'no measurement of these scopes yet' } );
			continue;

		}

		for ( const s of seen ) {

			const w = worst.get( s );
			if ( w.mean >= minMs || w.share >= minShare ) candidates.push( { kind: k.kind, scope: s, mean: w.mean, p95: w.p95, share: w.share, scenario: w.scenario, fix: k.fix } );

		}

	}

	candidates.sort( ( a, b ) => b.mean - a.mean );
	return { candidates, unverified };

}
