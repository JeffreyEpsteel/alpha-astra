// Breath and drowning (wave 22B), pure logic: the air you hold while your head is under water. The death feature runs it
// every frame (index.js: breathContext reads the player) and ends the run with cause 'drowned' when it says so.
//
//   const b = new Breath();   b.bonus = 1 (a future upgrade: more air)
//   b.update( dt, { under, sprint } ) -> null | 'warn' (WARN s of air left, once per dive) | 'empty' (out of air: the damage
//                               starts) | 'drowned' (DAMAGE s after that)
//   b.air 0..1 of the lungs     b.left  s of air at the current drain     b.drowning  s since the air ran out (0 surfaced)
//   b.hurt 0..1                 how far the drowning damage has gone (the death feature takes it off the hit points)
//   b.ring() -> { show, frac, tone: 'ok' | 'warn' | 'out', vignette 0..1, pulse 0..1 }   what the ring near the centre draws
//   b.reset()                   full lungs (a respawn)
// Surfacing refills from empty in REFILL s; sprint-swimming under water burns the air SPRINT times as fast.

export const BREATH = { air: 30, sprint: 1.6, refill: 4, warn: 8, damage: 6, linger: 0.8 };

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

export class Breath {

	constructor() {

		this.bonus = 1;
		this.reset();

	}

	reset() {

		this.air = 1;
		this.under = false;
		this.sprint = false;
		this.drowning = 0;
		this.warned = false;
		this.shown = 0; // s the ring has left to linger after the lungs are full again
		this.underFor = 0; // s of this dive (a passing wave over the face does not bring the ring up)
		this.dove = false; // a real dive (past 0.4 s under): the ring stays up until the lungs are full again

	}

	get capacity() {

		return BREATH.air * Math.max( 0.1, Number.isFinite( this.bonus ) ? this.bonus : 1 );

	}

	// seconds of air left at the drain of the moment
	get left() {

		return this.air * this.capacity / ( this.sprint ? BREATH.sprint : 1 );

	}

	get hurt() {

		return clamp( this.drowning / BREATH.damage, 0, 1 );

	}

	update( dt, { under = false, sprint = false } = {} ) {

		if ( ! ( dt > 0 ) ) return null;
		dt = Math.min( dt, 0.25 );
		this.under = !! under;
		this.sprint = !! sprint && this.under;
		let ev = null;
		if ( this.under ) {

			this.underFor += dt;
			if ( this.underFor > 0.4 ) this.dove = true;
			this.shown = BREATH.linger;
			if ( this.air > 0 ) {

				this.air = Math.max( 0, this.air - dt * ( this.sprint ? BREATH.sprint : 1 ) / this.capacity );
				if ( ! this.warned && this.left <= BREATH.warn ) {

					this.warned = true;
					ev = 'warn';

				}

				if ( this.air <= 0 ) ev = 'empty';

			} else {

				this.drowning += dt;
				if ( this.drowning >= BREATH.damage ) ev = 'drowned';

			}

		} else {

			this.underFor = 0;
			this.drowning = 0;
			this.air = Math.min( 1, this.air + dt / BREATH.refill );
			if ( this.left > BREATH.warn + 1 ) this.warned = false;
			if ( this.air >= 1 ) this.shown = Math.max( 0, this.shown - dt );
			if ( this.air >= 1 && this.shown <= 0 ) this.dove = false;

		}

		return ev;

	}

	// the ring: shown while under (after a moment) or while the lungs fill again; amber and pulsing in the last WARN s, red
	// with the damage; the vignette closes in over the last WARN s and the drowning
	ring() {

		const show = this.dove || this.air <= 0;
		const left = this.left;
		const tone = this.drowning > 0 || this.air <= 0 ? 'out' : this.under && left <= BREATH.warn ? 'warn' : 'ok';
		const v = this.under ? clamp( 1 - left / BREATH.warn, 0, 1 ) * 0.75 + this.hurt * 0.25 : 0;
		return { show: !! show, frac: this.air, tone, vignette: clamp( v, 0, 1 ), pulse: tone === 'ok' ? 0 : tone === 'warn' ? 0.5 : 1, left };

	}

}
