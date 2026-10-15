// The tavern dice round of the Unreal game (BoatServiceComponent::ServerTavernDice): the player and the
// resident each roll one six-sided die; the higher roll wins, equal is a draw. No wager, no reward, no
// progression: it is a voluntary pastime. A new round needs 2 s after the last one (DiceServerCooldown).
//
//   const dice = new Dice( { rng } );
//   dice.roll( now, residentName ) -> { ok: true, player, resident, outcome: 'win' | 'lose' | 'draw', text }
//                                   | { ok: false, reason: 'cooldown', wait }
//   dice.tally -> { rounds, wins, losses, draws }      dice.toJSON() / fromJSON( d )

export const COOLDOWN_S = 2;
export const OUTCOME_TEXT = { win: 'You win.', lose: 'The resident wins.', draw: 'A draw.' };

const num = ( v ) => ( Number.isFinite( v ) ? Math.max( 0, Math.min( 1e6, Math.floor( v ) ) ) : 0 );

export function rollDie( rng = Math.random ) {

	return 1 + Math.min( 5, Math.floor( rng() * 6 ) );

}

export function outcomeOf( player, resident ) {

	return player > resident ? 'win' : player < resident ? 'lose' : 'draw';

}

export class Dice {

	constructor( { rng = Math.random } = {} ) {

		this.rng = rng;
		this.last = - Infinity; // time of the last round (s, the caller's clock)
		this.tally = { rounds: 0, wins: 0, losses: 0, draws: 0 };
		this.lastRound = null;

	}

	ready( now ) {

		return now - this.last >= COOLDOWN_S;

	}

	roll( now, residentName = 'The resident' ) {

		if ( ! this.ready( now ) ) return { ok: false, reason: 'cooldown', wait: Math.max( 0, COOLDOWN_S - ( now - this.last ) ) };
		this.last = now;
		const player = rollDie( this.rng ), resident = rollDie( this.rng );
		const outcome = outcomeOf( player, resident );
		this.tally.rounds ++;
		if ( outcome === 'win' ) this.tally.wins ++;
		else if ( outcome === 'lose' ) this.tally.losses ++;
		else this.tally.draws ++;
		const verdict = outcome === 'lose' ? `${ residentName } wins.` : OUTCOME_TEXT[ outcome ];
		const text = `You rolled ${ player }; ${ residentName } rolled ${ resident }. ${ verdict } No wager or reward.`;
		this.lastRound = { player, resident, outcome, text, who: residentName };
		return { ok: true, player, resident, outcome, text };

	}

	toJSON() {

		return { ...this.tally };

	}

	fromJSON( d ) {

		const t = d && typeof d === 'object' ? d : {};
		this.tally = { rounds: num( t.rounds ), wins: num( t.wins ), losses: num( t.losses ), draws: num( t.draws ) };

	}

	reset() {

		this.tally = { rounds: 0, wins: 0, losses: 0, draws: 0 };
		this.last = - Infinity;
		this.lastRound = null;

	}

}
