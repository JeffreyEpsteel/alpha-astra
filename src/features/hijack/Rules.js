// Numbers and pure helpers of the hijack feature (src/features/hijack): which player hull a taken AI ship becomes, the night
// watch's roll, the wanted state's price tags, where the mail plane calls and where the residents keep their skiffs. No engine,
// no DOM, no game state.

import { BOATS } from '../../game/Boats.js';
import { FENCE, fencePrice } from './Fence.js';
export { fencePrice };
import { SHIP_CLASSES } from '../naval/ShipClasses.js';
import { WORLD } from '../../world/WorldLayout.js';

export const HIJACK = {
	minHull: 0.4, // a taken hull keeps her damage, patched to at least this fraction (above the flooding line)
	// the watch on a moored ship: the chance the crew wake when you cast off (night / day), + per notoriety level, + at Blackwater
	watch: { night: 0.2, day: 0.75, perLevel: 0.08, blackwater: 0.15, min: 0.05, max: 0.95 },
	helmReach: 4, // m: E at the helm casts off
	leaveReach: 40, // m: wandering this far from her ends the sneak
	// what taking a vessel costs: notoriety heat / corsair standing (pirates), merchant standing (trade credit), the bounty ($)
	cost: {
		merchant: { heat: 14, standing: 6, merchant: - 8, bounty: 400 },
		navy: { heat: 22, standing: 9, merchant: - 12, bounty: 900 },
		pirate: { heat: 6, standing: - 8, merchant: 2, bounty: 0 },
		resident: { heat: 0, standing: 0, merchant: - 3, bounty: 60 },
		mail: { heat: 4, standing: 0, merchant: - 6, bounty: 500 },
	},
	alarm: { merchant: - 6, bounty: 250 }, // the watch woke: more standing lost, a bigger bounty
	guards: { merchant: - 5, bounty: 150 }, // the town's guards at her home port know her
	hunt: { every: 300, chance: 0.5 }, // s at sea between the faction's hunters while she is wanted
	repaint: { share: 0.12, min: 300, hours: 24 }, // the yard's fee (x her price) and the day the paint takes to launder her
	fence: FENCE, // Blackwater's fence pays this share of her price for a stolen hull
	skiff: { restock: 24, kinds: [ 'skiff', 'canoe' ], reach: 3.5, view: 260 },
	moored: { range: 700, drop: 1100, restock: 24 }, // the merchant moored in Tidemark's bay: put there within range of the player
	// the mail plane: a Petrel with a pilot who walks to the tavern while she lies moored (in-game hours)
	mail: { af: 'petrel', liv: 2, ashore: 0.25, reach: 3.5, restock: 48, stops: [ { port: 'tidemark', from: 8, to: 12 }, { port: 'home', from: 15, to: 18.5 } ],
		// wave 16A: "MAIL" on her fuselage; a toast when she comes in (within notice m, the first `fresh` h of a stop); her pilot, a
		// resident (world/Residents.js) who comes ashore at the dock and walks to the port's tavern while she lies there
		lettering: 'MAIL', notice: 1500, fresh: 0.5,
		pilot: { id: 'mail-pilot', name: 'Ines Marlow', character: 'bravile', lines: [
			'Mail for Tidemark, mail for the harbour. Same hops every day.',
			'She flies herself, mostly. I just keep the sacks dry.',
			'Lock? On a floatplane? Who would steal a mail plane.',
		] } },
};

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

// the player hull a ship class becomes: the BOATS entry built on that class (Boats.js shipClass), else the nearest by length
// (a ship class longer than 8 m only among the ships, so a 12 m navy cutter is not a 4.5 m sail cutter)
export function hullFor( kind ) {

	for ( const [ id, b ] of Object.entries( BOATS ) ) if ( b.shipClass === kind ) return id;
	const cls = SHIP_CLASSES[ kind ];
	if ( ! cls ) return BOATS[ kind ] ? kind : null;
	if ( cls.hull && BOATS[ cls.hull ] ) return cls.hull; // (wave 16A: the harbour launch sails as the cabin launch)
	let best = null, bd = Infinity;
	for ( const [ id, b ] of Object.entries( BOATS ) ) {

		if ( cls.length > 8 && b.kind !== 'ship' ) continue;
		const d = Math.abs( b.length - cls.length );
		if ( d < bd ) { bd = d; best = id; }

	}

	return best;

}

// the chance the watch wakes when you cast off a moored ship
export function watchChance( { night = false, level = 0, blackwater = false } = {}, W = HIJACK.watch ) {

	return clamp( ( night ? W.night : W.day ) + W.perLevel * ( level || 0 ) + ( blackwater ? W.blackwater : 0 ), W.min, W.max );

}

// the yard's fee to repaint a hull
export function repaintFee( hull, R = HIJACK.repaint ) {

	const b = BOATS[ hull ];
	return Math.max( R.min, Math.round( ( b ? b.price : 0 ) * R.share / 10 ) * 10 );

}

// what the fence pays for a stolen hull
// the port nearest a point (WORLD.ports, read live): the home port of a vessel taken there
export function nearestPort( x, z ) {

	let best = null, bd = Infinity;
	for ( const p of WORLD.ports || [] ) {

		if ( ! p || ! p.dock || ! p.dock.position ) continue;
		const d = Math.hypot( p.dock.position.x - x, p.dock.position.z - z );
		if ( d < bd ) { bd = d; best = p; }

	}

	return best ? { id: best.id, name: best.name, d: bd } : null;

}

// a water spot off a point: the first of the offsets (rotated by `heading`) with `depth` metres of water, else the first one
export function waterSpot( x, z, heading, offsets, terrain = null, depth = 0.6 ) {

	const c = Math.cos( heading ), s = Math.sin( heading );
	let first = null;
	for ( const [ lx, lz ] of offsets ) {

		const p = { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
		if ( ! first ) first = p;
		if ( ! terrain || ! terrain.heightAt || terrain.heightAt( p.x, p.z ) < - depth ) return p;

	}

	return first;

}

// a resident's boat beside every port's jetty: on the water a few metres along the jetty from the berth, the other side of it
export function skiffSites( terrain = null ) {

	const out = [];
	for ( const p of WORLD.ports || [] ) {

		const d = p && p.dock;
		if ( ! d || ! d.position ) continue;
		const h = Number.isFinite( d.heading ) ? d.heading : 0;
		const at = waterSpot( d.position.x, d.position.z, h, [ [ - 5, - 9 ], [ 5, - 9 ], [ - 6, - 4 ], [ 6, - 4 ], [ - 7, 6 ], [ 7, 6 ] ], terrain, 0.4 );
		let hsh = 0;
		for ( let i = 0; i < p.id.length; i ++ ) hsh = ( hsh * 31 + p.id.charCodeAt( i ) ) >>> 0;
		out.push( { id: 'skiff:' + p.id, port: p.id, kind: HIJACK.skiff.kinds[ hsh % HIJACK.skiff.kinds.length ], x: at.x, z: at.z, heading: h } );

	}

	return out;

}

// where the mail plane lies at a port: Tidemark's bay, or off the home pier head, in water deep enough for her floats
export function mailSpot( port, terrain = null ) {

	if ( port === 'tidemark' && WORLD.tidemark && WORLD.tidemark.bay ) {

		const b = WORLD.tidemark.bay;
		return { ...waterSpot( b.x, b.z, 0, [ [ 30, 0 ], [ - 30, 0 ], [ 0, 30 ], [ 0, - 30 ] ], terrain, 1.5 ), heading: 0 };

	}

	const P = ( WORLD.ports || [] ).find( ( q ) => q.id === port );
	const d = P && P.dock;
	if ( ! d ) return null;
	const h = d.heading || 0;
	return { ...waterSpot( d.position.x, d.position.z, h, [ [ - 30, 45 ], [ 30, 45 ], [ - 40, 25 ], [ 40, 25 ], [ 0, 60 ] ], terrain, 1.5 ), heading: h };

}

// the mail plane's call now: { port, from, to } of the stop whose hours hold `hour` (0..24), or null
export function mailStop( hour, stops = HIJACK.mail.stops ) {

	for ( const s of stops ) if ( hour >= s.from && hour < s.to ) return s;
	return null;

}
