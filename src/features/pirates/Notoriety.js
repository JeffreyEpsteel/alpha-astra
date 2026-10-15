// Notoriety (parity V18: the wanted pressure) and the corsair standing axis (E11): two numbers the pirate feature keeps.
//
//   heat 0..100 -> level 0..5 (LEVELS): how hard the brotherhood and the navy are after you. Sinking, capturing, raiding and
//                  sinking merchants raise it; it cools by COOL per in-game hour. Level 3 makes the hunters shoot, level 4 turns
//                  the navy patrols on you, every level raises retaliation and hostile-boarding odds.
//   standing -100..100: what the corsairs think of you. Hunting pirates lowers it; sinking merchants / navy and paying ransoms
//                  raise it. A corsair whose disposition + standing > 20 lets you pass (Roster.factionFor).
//
//   const n = new Notoriety( { hudElement, doc } );   n.add( heat, standing ) -> level changed?   n.cool( hours )
//   n.level  n.heat  n.standing  n.view()  n.updateHud( dt )  n.toJSON() / fromJSON( d ) / reset() / dispose()
//
// The HUD element is a small chip (skull + five pips) under the top-right corner, shown only while the level is above zero and
// pulsing briefly when it changes: an indicator, never a standing prompt. No document (node tests): a no-op.

export const LEVELS = [ 0, 8, 22, 40, 62, 85 ]; // heat at which each level starts
export const COOL = 1.6; // heat per in-game hour
export const HEAT = {
	sunk: 9, captured: 11, named: 8, raid: 16, merchant: 14, navy: 22, repelled: 4, crew: 1.5, bounty: 6,
};
export const STANDING = {
	sunk: - 4, captured: - 6, raid: - 9, merchant: 6, navy: 9, ransom: 3, repelled: - 2, crew: - 0.5, overrun: 1,
};
const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

export function levelOf( heat ) {

	let l = 0;
	for ( let i = 1; i < LEVELS.length; i ++ ) if ( heat >= LEVELS[ i ] ) l = i;
	return l;

}

const CSS = /* css */`
.pn-chip { position: absolute; right: var(--tw-edge, 16px); top: calc(var(--tw-edge, 16px) + 172 * var(--tw-u, 1px)); display: flex; align-items: center; gap: calc(4 * var(--tw-u, 1px));
	padding: calc(4 * var(--tw-u, 1px)) calc(9 * var(--tw-u, 1px)); border-radius: 999px; background: var(--tw-glass, rgba(12, 18, 26, 0.62)); color: var(--tw-ink, #eef6f8);
	font: 600 var(--tw-fs-sm, 11.5px) var(--tw-font, system-ui, sans-serif); pointer-events: none; opacity: 0; transition: opacity 300ms ease, transform 300ms ease; }
.pn-chip.is-on { opacity: 0.92; }
.pn-chip.is-pulse { transform: scale(1.12); }
.pn-chip .pn-skull { font-size: calc(13 * var(--tw-u, 1px)); line-height: 1; margin-right: calc(2 * var(--tw-u, 1px)); }
.pn-chip i { width: calc(7 * var(--tw-u, 1px)); height: calc(7 * var(--tw-u, 1px)); border-radius: 50%; background: rgba(255, 255, 255, 0.18); display: block; }
.pn-chip i.on { background: var(--tw-danger, #ff6b5e); box-shadow: 0 0 6px rgba(255, 107, 94, 0.6); }
`;

let cssInjected = false;

export class Notoriety {

	constructor( { hudElement = null, doc = null } = {} ) {

		this.doc = doc || ( typeof document !== 'undefined' ? document : null );
		this.hudElement = hudElement;
		this.el = null;
		this.pips = [];
		this._shown = - 1;
		this._pulse = 0;
		this.reset();
		this._build();

	}

	reset() {

		this.heat = 0;
		this.standing = 0;

	}

	get level() {

		return levelOf( this.heat );

	}

	// returns { changed, level, previous }
	add( heat = 0, standing = 0 ) {

		const previous = this.level;
		this.heat = clamp( this.heat + heat, 0, 100 );
		this.standing = clamp( this.standing + standing, - 100, 100 );
		const level = this.level;
		if ( level !== previous ) this._pulse = 1.2;
		return { changed: level !== previous, level, previous };

	}

	cool( hours ) {

		if ( ! ( hours > 0 ) ) return { changed: false, level: this.level, previous: this.level };
		const previous = this.level;
		this.heat = Math.max( 0, this.heat - COOL * hours );
		// the corsairs forget slowly too (toward neutral)
		this.standing -= Math.sign( this.standing ) * Math.min( Math.abs( this.standing ), 0.25 * hours );
		const level = this.level;
		return { changed: level !== previous, level, previous };

	}

	view() {

		return { level: this.level, heat: Math.round( this.heat * 10 ) / 10, standing: Math.round( this.standing * 10 ) / 10 };

	}

	_build() {

		const doc = this.doc, host = this.hudElement || ( doc && doc.body );
		if ( ! doc || ! host || ! doc.createElement ) return;
		try {

			if ( ! cssInjected && doc.head ) {

				const st = doc.createElement( 'style' );
				st.textContent = CSS;
				doc.head.appendChild( st );
				cssInjected = true;

			}

			const el = doc.createElement( 'div' );
			el.className = 'pn-chip';
			el.title = 'Notoriety';
			const sk = doc.createElement( 'span' );
			sk.className = 'pn-skull';
			sk.textContent = '☠';
			el.appendChild( sk );
			for ( let i = 0; i < 5; i ++ ) {

				const p = doc.createElement( 'i' );
				el.appendChild( p );
				this.pips.push( p );

			}

			host.appendChild( el );
			this.el = el;

		} catch ( e ) {

			this.el = null;

		}

	}

	updateHud( dt ) {

		if ( ! this.el ) return;
		const l = this.level;
		if ( l !== this._shown ) {

			this._shown = l;
			this.pips.forEach( ( p, i ) => { p.className = i < l ? 'on' : ''; } );
			this.el.classList.toggle( 'is-on', l > 0 );

		}

		if ( this._pulse > 0 ) {

			this._pulse -= dt;
			this.el.classList.toggle( 'is-pulse', this._pulse > 0.6 );
			if ( this._pulse <= 0 ) this.el.classList.remove( 'is-pulse' );

		}

	}

	toJSON() {

		return { heat: Math.round( this.heat * 100 ) / 100, standing: Math.round( this.standing * 100 ) / 100 };

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		if ( Number.isFinite( d.heat ) ) this.heat = clamp( d.heat, 0, 100 );
		if ( Number.isFinite( d.standing ) ) this.standing = clamp( d.standing, - 100, 100 );

	}

	dispose() {

		if ( this.el && this.el.parentNode ) this.el.parentNode.removeChild( this.el );
		this.el = null;

	}

}
