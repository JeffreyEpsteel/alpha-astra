// Progressive flooding (wave 11A, Unreal parity V5), pure logic: below FLOOD.line of her hull points water comes in.
// The player's boat: naval.floodState (naval.flood is its level); an AI ship: ship.flood.
//
//   floodRate( hpFrac ) -> per s: FLOOD.rate for every 10 % of hull under the line (0.01 / s at 25 %, 0.03 / s at 5 %)
//   const f = new Flood()
//   f.update( dt, { hpFrac, pump (drain per s: the "Man the pump" channel 0.04, posted crew FLOOD.crewPump each) } )
//       -> { level, sunk }   sunk: true once, when she filled (she goes down through the sinking flow even with hull left)
//   f.level 0..1    f.speedMul (1 - 0.5 level: her top speed)    f.settle( depth ) metres lower in the water
//   f.drain()       the yard pumps her dry with the repairs

export const FLOOD = {
	line: 0.35,
	rate: 0.01, // per s for every 10 % under the line
	pump: 0.04, // per s while the player mans the pump
	crewPump: 0.012, // per s for each posted crew member (no enemy in range) / each hand of an AI crew
	slow: 0.5, // top speed x ( 1 - slow * level )
	settle: 0.5, // of her draft lower in the water when full
};

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

export function floodRate( hpFrac ) {

	return hpFrac < FLOOD.line ? FLOOD.rate * ( FLOOD.line - Math.max( 0, hpFrac ) ) / 0.1 : 0;

}

export class Flood {

	constructor() {

		this.level = 0;
		this.sunk = false;

	}

	get speedMul() {

		return 1 - FLOOD.slow * this.level;

	}

	settle( depth = 1 ) {

		return this.level * FLOOD.settle * depth;

	}

	update( dt, { hpFrac = 1, pump = 0 } = {} ) {

		if ( ! ( dt > 0 ) || this.sunk ) return { level: this.level, sunk: false };
		this.level = clamp( this.level + ( floodRate( hpFrac ) - Math.max( 0, pump ) ) * dt, 0, 1 );
		if ( this.level >= 1 ) {

			this.sunk = true;
			return { level: 1, sunk: true };

		}

		return { level: this.level, sunk: false };

	}

	drain() {

		this.level = 0;
		this.sunk = false;

	}

	toJSON() {

		return Math.round( this.level * 1000 ) / 1000;

	}

	fromJSON( v ) {

		this.level = Number.isFinite( v ) ? clamp( v, 0, 0.999 ) : 0;
		this.sunk = false;

	}

}
