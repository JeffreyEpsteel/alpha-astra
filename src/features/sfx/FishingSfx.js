// Fishing sounds driven by the rod's state (NAVAL_BRIEF B2: "line tension creaking audibly as strain climbs;
// distinct thwack on clean strike vs dull thud on miss"). The reel ratchet, the drag and the snap are the
// SoundScape's (rodLoop / lineSnap); the strain bed it plays from tension 0.7 is kept. This adds
//   line creak   short creaks from tension 0.35: more often, louder and higher the nearer the line is to breaking
//   thwack       a fish was hooked: Game.fight went from null to a fight (a clean strike)
//   thud         a miss: a bite in the 'take' phase ran out (the fish took the bait and ran), or the fight ended
//                with the hook thrown (state 'escaped'); also on the feature event 'strikeMissed' (a strike with
//                nothing to strike, which Game.strike() does not signal by itself)
// Edges are read from app.game each frame; each plays once.

import { lerp, smooth } from './util.js';

const THUD_GAP = 0.35; // s: a miss and its follow-up (an escape right after) are one sound

export class FishingSfx {

	constructor( sfx ) {

		this.sfx = sfx;
		this.fight = null; // the CatchMinigame of the last frame
		this.phase = null; // the bite phase of the last frame
		this.creakT = 0.3;
		this.lastThud = - 99;
		this.thwacks = 0;
		this.thuds = 0;
		this.creaks = 0;

	}

	// the owner of the strike: the miss from outside (features.emit( 'strikeMissed' ))
	miss() {

		const s = this.sfx;
		if ( s.time - this.lastThud < THUD_GAP ) return false;
		this.lastThud = s.time;
		this.thuds ++;
		return !! s.play( 'thud', { rate: 0.95 } );

	}

	update( dt ) {

		const s = this.sfx, g = s.app.game;
		if ( ! g ) return;
		const fight = g.fight || null, bite = g.bite || null;
		const phase = bite ? bite.phase : null;

		if ( s.player.ctx && ( fight || phase || ( g.rod && g.rod.state && g.rod.state !== 'stowed' ) ) ) s.player.preload( [ 'thwack', 'thud', 'line_creak' ] );

		if ( fight && ! this.fight ) {

			this.thwacks ++;
			s.play( 'thwack', { rate: 0.97 + Math.random() * 0.1 } );
			this.creakT = 0.5;

		} else if ( ! fight && this.fight ) {

			if ( this.fight.state === 'escaped' ) this.miss();

		} else if ( ! fight && this.phase === 'take' && phase === 'wait' ) this.miss();

		if ( fight ) {

			const t = Number.isFinite( fight.tension ) ? fight.tension : 0;
			const k = smooth( 0.35, 1.1, t );
			this.creakT -= dt;
			if ( t < 0.3 ) this.creakT = Math.max( this.creakT, 0.3 );
			if ( t > 0.35 && this.creakT <= 0 ) {

				this.creaks ++;
				// near the breaking point the SoundScape's own strain bed carries the sound: ease the ticks back
				s.play( 'line_creak', { gain: ( 0.15 + 0.85 * k ) * ( 1 - 0.45 * smooth( 0.85, 1.05, t ) ), rate: 0.8 + 0.75 * k, jitter: 0.08 } );
				this.creakT = lerp( 1.1, 0.16, k ) * ( 0.8 + Math.random() * 0.4 );

			}

		}

		this.fight = fight;
		this.phase = phase;

	}

	dispose() {}

}
