// Per-section ship damage (wave 11A, Unreal parity V4), pure logic: every hull - the AI ships (Ship.sections) and the
// player's boat (naval.sections) - has sections with their own points besides the hull: rudder, sails (the rigging; motor
// boats an engine instead), mast, and the guns of each side.
//
//   const sec = new Sections( { hullMax, propulsion: 'sails' | 'engine' | null, mast: bool, guns: bool } )
//   sec.parts { id: { hp, max } }      only the sections this hull has (a skiff: none; a trawler: rudder, engine, mast)
//   sec.hit( id, amount ) -> { id, before, after, broke, mastFell } | null   mastFell: once, the hit that brought the mast
//                                       down (the sails go to 0 with it)
//   sec.frac( id ) 0..1 (1 for a section she has not got)      sec.has( id )      sec.mastDown
//   sec.turnMul      rudder < 40 % -> 0.5 of the turn rate, 0 -> 0 (no steering: she drifts straight)
//   sec.speedMul     sails / engine < 50 % -> 0.5 of the top speed, 0 -> 0 (adrift); a mast down takes the sails with it
//   sec.gunsOk( side )   false when that side's gun section is at 0 (the broadside is silenced)
//   sec.missing() points to repair; sec.repair(); sec.damaged; sec.pips() -> [ { id, label, frac } ] (the HUD)
//   sec.rescale( hullMax ) (plating changed the hull), toJSON() / fromJSON( d )
//
//   pickSection( local { x, y, z }, geo, rng ) -> section id    where a ball struck, in the boat frame (+X port, +Y up from
//       the waterline, +Z forward); geo { length, beam, sheer, guns, mast, masts: [ z / length ], propulsion }: above the
//       sheer the guns of that side (the first SECTION_RULES.gunBand m), then the mast (the spar itself: near the centre
//       line, within SECTION_RULES.mastSpan of a mast station fore and aft) or the sails; below it the hull, and astern
//       (the aft SECTION_RULES.stern of her length) the rudder SECTION_RULES.rudderChance of the time
//   MAST_STATIONS[ id ]   where the masts stand, as a fraction of the length forward of amidships
//   sectionsFor( boatId ) / shipSections( cls )  the layout of a player hull / an AI class
//   AIM_PARTS [ 'hull', 'sails', 'rudder' ]   aimPoint( ship, part, out ) where to lay the guns on an AI ship for a part
//   aimHeight( part, geo ) the height above the water to lay a hand-aimed shot for a part (hull: the waterline, as before)

import { BOATS } from '../../game/Boats.js';

export const SECTION_IDS = [ 'rudder', 'sails', 'engine', 'mast', 'gunsPort', 'gunsStarboard' ];
// section points as a share of the hull's
export const SECTION_SHARE = { rudder: 0.3, sails: 0.5, engine: 0.4, mast: 0.45, gunsPort: 0.3, gunsStarboard: 0.3 };
// the share of a section hit the hull feels as well
export const HULL_SHARE = { hull: 1, rudder: 0.5, sails: 0.3, engine: 0.5, mast: 0.3, gunsPort: 0.4, gunsStarboard: 0.4 };
export const SECTION_RULES = { rudderSlow: 0.4, sailSlow: 0.5, gunBand: 1.2, mastBand: 0.15, mastSpan: 0.08, stern: 0.2, rudderChance: 0.3 };
export const MAST_STATIONS = { cutter: [ 0.1 ], trawler: [ 0.18 ], sloop: [ 0.1 ], brigantine: [ 0.22, - 0.12 ] };
export const SECTION_LABELS = { hull: 'Hull', rudder: 'Rudder', sails: 'Sails', engine: 'Engine', mast: 'Mast', gunsPort: 'Port guns', gunsStarboard: 'Starboard guns' };
// what drives each player hull: the canvas, an engine, or arms (oars and paddles are not shot away)
export const PROPULSION = { skiff: null, canoe: null, cutter: 'sails', launch: 'engine', lobster: 'engine', trawler: 'engine', sloop: 'sails', brigantine: 'sails' };
const MASTED = new Set( [ 'cutter', 'trawler', 'sloop', 'brigantine' ] );
export const AIM_PARTS = [ 'hull', 'sails', 'rudder' ];
export const AIM_LABELS = { hull: 'HULL', sails: 'SAILS', rudder: 'RUDDER' };

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

export class Sections {

	constructor( { hullMax = 100, propulsion = 'sails', mast = true, guns = true } = {} ) {

		this.layout = { propulsion, mast: !! mast, guns: !! guns };
		this.parts = {};
		this.mastDown = false;
		this.rescale( hullMax, true );

	}

	rescale( hullMax, fresh = false ) {

		const L = this.layout, ids = [ 'rudder' ];
		if ( L.propulsion ) ids.push( L.propulsion );
		if ( L.mast ) ids.push( 'mast' );
		if ( L.guns ) ids.push( 'gunsPort', 'gunsStarboard' );
		const old = this.parts;
		this.parts = {};
		for ( const id of ids ) {

			const max = Math.max( 1, Math.round( hullMax * SECTION_SHARE[ id ] ) );
			const o = old[ id ];
			this.parts[ id ] = { hp: fresh || ! o ? max : clamp( o.hp * max / o.max, 0, max ), max };

		}

		if ( this.mastDown ) this._fell();

	}

	has( id ) {

		return !! this.parts[ id ];

	}

	frac( id ) {

		const p = this.parts[ id ];
		return p ? p.hp / p.max : 1;

	}

	// the mast came down: it and the canvas it carried are gone
	_fell() {

		this.mastDown = true;
		if ( this.parts.mast ) this.parts.mast.hp = 0;
		if ( this.parts.sails ) this.parts.sails.hp = 0;

	}

	hit( id, amount ) {

		const p = this.parts[ id ];
		if ( ! p || ! ( amount > 0 ) ) return null;
		const before = p.hp;
		p.hp = Math.max( 0, p.hp - amount );
		let mastFell = false;
		if ( id === 'mast' && p.hp <= 0 && ! this.mastDown ) {

			this._fell();
			mastFell = true;

		}

		return { id, before, after: p.hp, broke: before > 0 && p.hp <= 0, mastFell };

	}

	get turnMul() {

		const f = this.frac( 'rudder' );
		return f <= 0 ? 0 : f < SECTION_RULES.rudderSlow ? 0.5 : 1;

	}

	get speedMul() {

		const id = this.layout.propulsion;
		if ( ! id ) return 1;
		const f = this.frac( id );
		return f <= 0 ? 0 : f < SECTION_RULES.sailSlow ? 0.5 : 1;

	}

	gunsOk( side ) {

		return this.frac( side === 'starboard' ? 'gunsStarboard' : 'gunsPort' ) > 0;

	}

	missing() {

		let n = 0;
		for ( const p of Object.values( this.parts ) ) n += p.max - p.hp;
		return n;

	}

	get damaged() {

		return this.mastDown || this.missing() > 0.5;

	}

	repair() {

		for ( const p of Object.values( this.parts ) ) p.hp = p.max;
		this.mastDown = false;

	}

	pips() {

		return Object.keys( this.parts ).map( ( id ) => ( { id, label: SECTION_LABELS[ id ], frac: Math.round( this.frac( id ) * 100 ) / 100 } ) );

	}

	toJSON() {

		const out = { mastDown: this.mastDown };
		for ( const [ id, p ] of Object.entries( this.parts ) ) out[ id ] = Math.round( p.hp * 10 ) / 10;
		return out;

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		for ( const [ id, p ] of Object.entries( this.parts ) ) if ( Number.isFinite( d[ id ] ) ) p.hp = clamp( d[ id ], 0, p.max );
		if ( d.mastDown && this.layout.mast ) this._fell();

	}

}

// the layout of a player hull (Boats.js): a ship carries a battery on each side, the small boats a swivel gun (one gun
// section a side all the same: the gun shifts to the side it fires from)
export function sectionsFor( boatId, hullMax ) {

	const b = BOATS[ boatId ];
	const propulsion = Object.prototype.hasOwnProperty.call( PROPULSION, boatId ) ? PROPULSION[ boatId ] : ( b && b.drive === 'wheel' ? 'engine' : null );
	return new Sections( { hullMax, propulsion, mast: MASTED.has( boatId ) || !! ( b && b.mast ), guns: true } );

}

// an AI class (ShipClasses.js): every class is masted; a merchant trawler runs on her engine and has no guns
export function shipSections( cls ) {

	return new Sections( { hullMax: cls.hp, propulsion: cls.id === 'trawler' ? 'engine' : 'sails', mast: true, guns: ( cls.guns || 0 ) > 0 } );

}

export function pickSection( local, geo, rng = Math.random ) {

	const R = SECTION_RULES;
	const sheer = geo.sheer ?? 1;
	if ( local.y > sheer ) {

		const band = local.y - sheer;
		if ( geo.guns && band <= R.gunBand ) return local.x >= 0 ? 'gunsPort' : 'gunsStarboard';
		if ( geo.mast && Math.abs( local.x ) <= Math.max( 0.5, ( geo.beam || 3 ) * R.mastBand ) ) {

			const L = geo.length || 10, span = Math.max( 1.2, L * R.mastSpan );
			if ( ( geo.masts || [ 0.1 ] ).some( ( f ) => Math.abs( local.z - f * L ) <= span ) ) return 'mast';

		}

		if ( geo.propulsion ) return geo.propulsion;
		return geo.mast ? 'mast' : 'hull';

	}

	const L = geo.length || 10;
	if ( local.z < - L / 2 + L * R.stern && rng() < R.rudderChance ) return 'rudder';
	return 'hull';

}

// where to lay the guns on ship `s` (Ship.js) for an aimed part: the hull a little above the water, the sails half way up
// the mast, the rudder at the stern post
export function aimPoint( s, part, out = {} ) {

	const c = s.cls;
	if ( part === 'sails' ) return s.toWorld( 0, c.sheer + ( c.mast - c.sheer ) * 0.45, 0, out );
	if ( part === 'rudder' ) return s.toWorld( 0, Math.min( 1, c.sheer * 0.3 ), - c.length * 0.46, out );
	return s.toWorld( 0, c.sheer * 0.4, 0, out );

}

// the height above the water to lay a hand-aimed shot for a part (the look picks the range; this the elevation)
export function aimHeight( part, geo = {} ) {

	if ( part === 'sails' ) return ( geo.sheer ?? 3 ) + ( ( geo.top ?? 10 ) - ( geo.sheer ?? 3 ) ) * 0.45;
	if ( part === 'rudder' ) return 0.5;
	return 0;

}
