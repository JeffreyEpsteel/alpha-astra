// Courtesy aircraft use personal fleet records, like the existing hangar planes.
// These stands are on Meridian's reclaimed north apron, clear of the hangar.
import { Group, Mesh } from '../../engine/index.js';
import { box, prepare, mergePrepared, mat4 } from '../../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { AIRFRAMES, spec } from './Airframes.js';

export const AIRPORT_FLEET = [ 'swift', 'courier' ];

export function findAirport( world ) {
	const s = world?.meridian?.airstrip;
	return s && [ s.x, s.z, s.y, s.pad?.x, s.pad?.z ].every( Number.isFinite ) ? { ...s, island: 'meridian' } : null;
}

const sessions = new WeakMap();
const geometry = new Map();
const geomFor = af => { if ( ! geometry.has( af ) ) geometry.set( af, spec( af ).geom ); return geometry.get( af ); };

// Session-local reservations stay put across joins/drops. A newcomer first uses
// observed aircraft positions to preserve occupied stands, then fills free pairs.
// This is collision avoidance, not an atomic server reservation protocol: two
// simultaneous clients without each other's first state can still race.
export function airportRank( app, airport = null, refresh = false ) {
	const id = app?.net?.id;
	if ( ! id ) return 0;
	const peers = app?.remotePlayers?.peers;
	const ids = [ ...new Set( [ id, ...( peers?.keys ? peers.keys() : [] ) ] ) ].map( String ).sort();
	let state = sessions.get( app );
	if ( ! state || state.net !== app.net || state.id !== id ) {
		state = { net: app.net, id, slots: new Map(), locked: false };
		sessions.set( app, state );
	}
	if ( state.locked && state.slots.has( id ) ) return state.slots.get( id );
	const membership = ids.join( '\0' ), now = Date.now();
	if ( ! refresh && state.membership === membership && state.until > now && state.slots.has( id ) ) return state.slots.get( id );
	state.membership = membership; state.until = now + 250;
	for ( const owner of state.slots.keys() ) if ( ! ids.includes( owner ) ) state.slots.delete( owner );
	const occupied = [];
	const add = ( owner, af, p, q ) => {
		// Generic peer extras are untrusted decoded JSON, unlike typed room fields.
		// Indexed checks reject sparse arrays too; malformed entries must not poison
		// every stand query or introduce NaN footprint dimensions.
		if ( ! airport || owner === id || ! Object.hasOwn( AIRFRAMES, af ) || ! Array.isArray( p ) || p.length !== 3 || ! [ 0, 1, 2 ].every( i => Number.isFinite( p[ i ] ) ) || Math.abs( p[ 1 ] - airport.y ) > 8 ) return;
		if ( ! Array.isArray( q ) || q.length !== 4 || ! [ 0, 1, 2, 3 ].every( i => Number.isFinite( q[ i ] ) ) ) return;
		const norm = Math.hypot( ...q );
		if ( ! Number.isFinite( norm ) || norm < 1e-6 ) return;
		const [ qx, qy, qz, qw ] = q.map( n => n / norm );
		const g = geomFor( af ), h = Math.atan2( 2 * ( qw * qy + qx * qz ), 1 - 2 * ( qy ** 2 + qz ** 2 ) );
		const c = Math.abs( Math.cos( h ) ), s = Math.abs( Math.sin( h ) );
		occupied.push( { owner, x: p[ 0 ], z: p[ 2 ], hx: c * g.span / 2 + s * ( g.length || 12 ) / 2, hz: s * g.span / 2 + c * ( g.length || 12 ) / 2 } );
	};
	for ( const [ owner, peer ] of peers || [] ) { const p = peer?.extra?.plane; if ( p ) add( owner, p.af, p.p, p.q ); }
	// Unpiloted aircraft are in the room's owner-prefixed PlaneLink entries.
	app.net?.link?.room?.state?.planes?.forEach?.( p => { if ( p ) add( p.owner, p.af, [ p.x, p.y, p.z ], [ p.qx, p.qy, p.qz, p.qw ] ); } );
	const blocked = new Set();
	for ( const p of occupied ) {
		let closest = null;
		for ( let rank = 0; rank < 16; rank ++ ) for ( const af of AIRPORT_FLEET ) {
			const b = airportStand( airport, af, rank ), d = Math.hypot( p.x - b.x, p.z - b.z );
			if ( ! closest || d < closest.d ) closest = { rank, d };
			if ( Math.abs( p.x - b.x ) < p.hx + geomFor( af ).span / 2 + 1 && Math.abs( p.z - b.z ) < p.hz + 7 ) blocked.add( rank );
		}
		if ( closest?.d < 18 && ids.includes( p.owner ) ) {
			for ( const [ owner, rank ] of state.slots ) if ( owner !== p.owner && rank === closest.rank ) state.slots.delete( owner );
			state.slots.set( p.owner, closest.rank );
		}
	}
	// An unissued display may yield to a newly observed occupied footprint. Once
	// issued, its stand/service pin and the physical aircraft are never reassigned.
	if ( ! state.locked && blocked.has( state.slots.get( id ) ) ) state.slots.delete( id );
	for ( const owner of ids ) {
		if ( state.slots.has( owner ) ) continue;
		const used = new Set( state.slots.values() );
		const rank = Array.from( { length: 16 }, ( _, n ) => n ).find( n => ! used.has( n ) && ! blocked.has( n ) );
		if ( rank !== undefined ) state.slots.set( owner, rank );
	}
	return state.slots.get( id ) ?? - 1;
}

export function lockAirportRank( app ) { const state = sessions.get( app ); if ( state ) state.locked = true; }

export function airportStand( airport, af, rank = 0 ) {
	if ( ! airport || ! AIRPORT_FLEET.includes( af ) || rank < 0 ) return null;
	const n = Math.max( 0, Math.min( 15, rank | 0 ) );
	return { kind: 'strip', x: airport.x - 250 + n * 32 + ( af === 'courier' ? 16 : 0 ),
		y: airport.y, z: airport.z - ( af === 'swift' ? 50 : 28 ), heading: 0 };
}

export function buildAirportStandGeometry( airport ) {
	if ( ! airport ) return null;
	const p = [];
	const add = ( w, d, x, z, color ) => p.push( prepare( box( w, 0.025, d ), { color, rough: 0.85, pattern: PAT.plain, matrix: mat4( x, airport.y + 0.055, z ) } ) );
	for ( const af of AIRPORT_FLEET ) {
		const s = airportStand( airport, af ), color = af === 'swift' ? 0xffd552 : 0xa7cef1;
		// Wing-clear stand outline, taxi centre line, and I / II identification bars.
		const half = af === 'swift' ? 7 : 9;
		for ( const dx of [ - half, half ] ) add( 0.22, 14, s.x + dx, s.z, color );
		for ( const dz of [ - 7, 7 ] ) add( half * 2, 0.22, s.x, s.z + dz, color );
		const hold = airport.z - 20, start = s.z + 7;
		add( 0.16, hold - start, s.x, ( hold + start ) / 2, 0xffd552 );
		add( 7, 0.25, s.x, hold, 0xffd552 );
		// Taxi marks lead toward the holding line, clear of buildings and peers.
		add( 1.2, 0.2, s.x - 0.5, hold - 1.4, 0xffd552 );
		add( 1.2, 0.2, s.x + 0.5, hold - 1.4, 0xffd552 );
		for ( let i = 0; i < ( af === 'swift' ? 1 : 2 ); i ++ ) add( 0.24, 1.8, s.x + ( i - ( af === 'swift' ? 0 : 0.5 ) ) * 0.75, s.z - 4.5, color );
	}
	return mergePrepared( p );
}

export class AirportSite {
	constructor( airport, scene ) {
		this.scene = scene;
		this.group = new Group();
		this.group.name = 'AirportCourtesyStands';
		this.geometry = buildAirportStandGeometry( airport );
		if ( this.geometry && scene ) {
			this.material = createPropMaterial( 'airportCourtesyStands' );
			const mesh = new Mesh( this.geometry, this.material );
			mesh.receiveShadow = true;
			this.group.add( mesh );
			scene.add( this.group );
		}
	}
	setRank( rank ) { this.group.visible = rank >= 0; if ( rank >= 0 ) this.group.position.set( rank * 32, 0, 0 ); }
	dispose() { this.scene?.remove?.( this.group ); this.geometry?.dispose?.(); this.material?.dispose?.(); }
}
