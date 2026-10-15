import { strongholdLayout } from './Layout.js';

// The stronghold's breakable kinds for the destruction feature (src/features/destruction/Kinds.js piece format: boxes and
// barrels in the prop's own frame, x right, y up, z forward, the ground at y = 0) and the plan that stands them on Blackwater.
//
//   STRONGHOLD_KINDS[ kind ] = { def: { toughness (J), jointForce (N), mat, shatterAt, label, explosive? }, build( rng, opts ) -> pieces }
//     palisade     a run of sharpened stakes on two rails (opts.length), each stake held to the ground
//     gunPlatform  a timber gun deck on four posts behind a log parapet: when it breaks the battery on it is silenced
//     powder       the battery's powder kegs under a plank lean-to: it explodes when it breaks (def.explosive)
//   strongholdPlan( terrain ) -> [ { id, kind, site: 'blackwater', port: null, x, y, z, yaw, r, opts } ]   (planProps' shape)
//
// Destruction picks these up through two small root patches (KINDS / BUILD registration, the plan appended in build());
// src/features/pirates/Stronghold.js keeps its own damage model for the same ids while they are not registered.

const ID = { x: 0, y: 0, z: 0, w: 1 };
const LOG = [ [ 0.26, 0.19, 0.12 ], [ 0.32, 0.23, 0.14 ], [ 0.22, 0.16, 0.1 ] ];
const PLANK = [ 0.38, 0.27, 0.16 ];
const KEG = [ 0.17, 0.12, 0.08 ];
const tint = ( c, rng, a = 0.1 ) => { const k = 1 + ( rng() - 0.5 ) * 2 * a; return [ c[ 0 ] * k, c[ 1 ] * k, c[ 2 ] * k ]; };
const box = ( sx, sy, sz, x, y, z, color, o = {} ) => ( {
	type: 'box', size: [ sx, sy, sz ], pos: { x, y, z }, quat: o.quat || ID, color, density: o.density ?? 560,
	jf: o.jf ?? 0, anchor: o.anchor ?? 0, float: o.float ?? 1,
} );
const keg = ( r, h, x, y, z, color ) => ( { type: 'barrel', size: [ 2 * r, h, 2 * r ], pos: { x, y, z }, quat: ID, color, density: 900, jf: 0, anchor: 0, float: 0.8 } );

export const STRONGHOLD_KINDS = {

	palisade: {
		def: { toughness: 2600, jointForce: 2400, mat: 'wood', shatterAt: 4, label: 'palisade' },
		build( rng, o = {} ) {

			const L = o.length ?? 5.8, w = 0.38, n = Math.max( 3, Math.round( L / w ) );
			const P = [];
			for ( let i = 0; i < n; i ++ ) {

				const h = 2.9 + rng() * 0.5;
				P.push( box( w - 0.02, h, 0.3, - L / 2 + ( i + 0.5 ) * L / n, h / 2, 0, tint( LOG[ i % 3 ], rng ), { anchor: 7000, density: 620 } ) );

			}

			// the rails behind, touching every stake
			for ( const y of [ 0.9, 2.2 ] ) P.push( box( L, 0.14, 0.1, 0, y, - 0.2, tint( LOG[ 1 ], rng, 0.05 ), { density: 600 } ) );
			return P;

		},
	},

	gunPlatform: {
		def: { toughness: 6000, jointForce: 4200, mat: 'wood', shatterAt: 4, label: 'gun platform' },
		build( rng ) {

			const P = [];
			for ( const x of [ - 3.2, 3.2 ] ) for ( const z of [ - 2.2, 2.2 ] ) P.push( box( 0.32, 1.0, 0.32, x, 0.5, z, tint( LOG[ 0 ], rng ), { anchor: 9000, density: 650 } ) );
			for ( const z of [ - 2.2, 0, 2.2 ] ) P.push( box( 7.2, 0.26, 0.32, 0, 1.13, z, tint( LOG[ 1 ], rng ), { density: 640 } ) );
			for ( let k = 0; k < 6; k ++ ) P.push( box( 7.0, 0.12, 0.99, 0, 1.32, - 2.5 + k, tint( PLANK, rng, 0.08 ), { density: 560 } ) );
			// the parapet: three logs stacked along the front, resting on the deck
			for ( let k = 0; k < 3; k ++ ) P.push( box( 7.0, 0.34, 0.36, 0, 1.55 + k * 0.34, 3.0 - k * 0.02, tint( LOG[ k % 3 ], rng ), { density: 640 } ) );
			// chocks and a shot rack at the back corners
			P.push( box( 0.5, 0.3, 0.5, - 2.8, 1.53, - 2.3, tint( PLANK, rng ) ) );
			P.push( box( 0.5, 0.3, 0.5, 2.8, 1.53, - 2.3, tint( PLANK, rng ) ) );
			return P;

		},
	},

	powder: {
		def: { toughness: 450, jointForce: 600, mat: 'wood', shatterAt: 2, label: 'powder store', explosive: { radius: 9, energy: 220000 } },
		build( rng ) {

			const P = [];
			// six kegs in two rows and one on top
			for ( let r = 0; r < 2; r ++ ) for ( let k = 0; k < 3; k ++ ) P.push( keg( 0.3, 0.8, - 0.66 + k * 0.66, 0.4, - 0.35 + r * 0.66, tint( KEG, rng, 0.15 ) ) );
			P.push( keg( 0.3, 0.8, 0, 1.2, 0, tint( KEG, rng, 0.15 ) ) );
			// the lean-to: two posts, a ridge and a plank roof over the kegs
			for ( const x of [ - 1.3, 1.3 ] ) P.push( box( 0.16, 2.0, 0.16, x, 1.0, - 0.9, tint( LOG[ 2 ], rng ), { anchor: 1500 } ) );
			P.push( box( 2.8, 0.14, 0.14, 0, 2.07, - 0.9, tint( LOG[ 1 ], rng ) ) );
			P.push( box( 2.9, 0.06, 1.7, 0, 1.75, - 0.1, tint( PLANK, rng ), { quat: { x: Math.sin( 0.18 ), y: 0, z: 0, w: Math.cos( 0.18 ) } } ) );
			return P;

		},
	},

};

// the props on Blackwater; y from the terrain (the pads level the fort and the gun platforms)
export function strongholdPlan( terrain ) {

	const L = strongholdLayout(), out = [];
	const y = ( p ) => ( terrain && terrain.heightAt ? terrain.heightAt( p.x, p.z ) : 0 ) - 0.02;
	for ( const s of L.palisade ) out.push( { id: s.id, kind: 'palisade', site: 'blackwater', port: null, x: s.x, y: y( s ), z: s.z, yaw: s.yaw, r: s.length / 2, opts: { length: s.length } } );
	for ( const b of L.batteries ) out.push( { id: b.platform, kind: 'gunPlatform', site: 'blackwater', port: null, x: b.x, y: y( b ), z: b.z, yaw: b.yaw, r: 4.3, opts: {}, battery: b.id } );
	for ( const p of L.powder ) out.push( { id: p.id, kind: 'powder', site: 'blackwater', port: null, x: p.x, y: y( p ), z: p.z, yaw: p.yaw, r: 1.6, opts: {}, battery: p.battery } );
	return out;

}
