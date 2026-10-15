// The gun's HUD (wave 12E; class prefix gh-), laid over the game's HUD element like the melee HUD:
//   - a crosshair whenever a firearm is drawn: four thin ticks whose gap is the shot's cone right now (it grows on the move
//     and after a shot, tightens while aiming), and a centre dot
//   - a hit marker on a hit (white), a different one on a head shot (gold, larger), a kill confirmation (red, "DOWN")
//   - a reload ring round the crosshair filling while reloading, and "R to reload" under it while the gun is empty
// No document or no HUD element: every call is a no-op (the headless tests pass a fake `doc`).
//
//   const hud = new GunHud( { hud: hudElement, doc } );
//   hud.update( dt, { drawn, gap (px), aiming, scope (the long rifle's sight ring), reload (0..1 or -1), empty, noShots } )
//   hud.mark( 'hit' | 'head' | 'kill' )      hud.dispose()

const MARK_LIFE = { hit: 0.22, head: 0.32, kill: 0.6 };

const CSS = /* css */`
.gh-root { position: absolute; left: 0; top: 0; right: 0; bottom: 0; pointer-events: none; overflow: hidden; display: none; }
.gh-root.is-on { display: block; }
.gh-cross { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.gh-cross i { position: absolute; background: rgba(255, 255, 255, 0.9); box-shadow: 0 0 2px rgba(0, 0, 0, 0.85); transition: transform 60ms linear; }
.gh-cross i.h { width: calc(9 * var(--tw-u, 1px)); height: 1.5px; top: -0.75px; }
.gh-cross i.v { height: calc(9 * var(--tw-u, 1px)); width: 1.5px; left: -0.75px; }
.gh-cross i.l { right: 0; } .gh-cross i.r { left: 0; } .gh-cross i.t { bottom: 0; } .gh-cross i.b { top: 0; }
.gh-cross b { position: absolute; left: -1.5px; top: -1.5px; width: 3px; height: 3px; border-radius: 50%; background: #fff; box-shadow: 0 0 2px #000; }
.gh-root.is-aim .gh-cross i { background: #fff; }
.gh-mark { position: absolute; left: 50%; top: 50%; width: calc(22 * var(--tw-u, 1px)); height: calc(22 * var(--tw-u, 1px)); transform: translate(-50%, -50%); opacity: 0; }
.gh-mark i { position: absolute; left: 50%; top: 50%; width: 42%; height: 2px; background: #fff; box-shadow: 0 0 3px rgba(0, 0, 0, 0.9); transform-origin: 0 50%; }
.gh-mark i:nth-child(1) { transform: rotate(45deg) translateX(30%); } .gh-mark i:nth-child(2) { transform: rotate(135deg) translateX(30%); }
.gh-mark i:nth-child(3) { transform: rotate(225deg) translateX(30%); } .gh-mark i:nth-child(4) { transform: rotate(315deg) translateX(30%); }
.gh-mark.is-head i { background: #ffd23a; height: 2.5px; } .gh-mark.is-head { width: calc(30 * var(--tw-u, 1px)); height: calc(30 * var(--tw-u, 1px)); }
.gh-mark.is-kill i { background: #ff3b2f; height: 3px; } .gh-mark.is-kill { width: calc(36 * var(--tw-u, 1px)); height: calc(36 * var(--tw-u, 1px)); }
.gh-kill { position: absolute; left: 50%; top: calc(50% + 30 * var(--tw-u, 1px)); transform: translateX(-50%); opacity: 0;
	font: 800 var(--tw-fs-md, 12.5px) var(--tw-font, system-ui, sans-serif); letter-spacing: 0.2em; color: #ff5a4a; text-shadow: 0 1px 3px #000; }
.gh-ring { position: absolute; left: 50%; top: 50%; width: calc(44 * var(--tw-u, 1px)); height: calc(44 * var(--tw-u, 1px)); transform: translate(-50%, -50%); opacity: 0; }
.gh-ring.is-on { opacity: 1; }
.gh-ring circle { fill: none; stroke-width: 3; }
.gh-ring .bg { stroke: rgba(255, 255, 255, 0.18); }
.gh-ring .fg { stroke: var(--tw-aqua, #5fe3d4); stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; }
.gh-cue { position: absolute; left: 50%; top: calc(50% + 34 * var(--tw-u, 1px)); transform: translateX(-50%); opacity: 0; transition: opacity 160ms;
	font: 600 var(--tw-fs-sm, 11.5px) var(--tw-font, system-ui, sans-serif); color: var(--tw-ink, #eef6f8); text-shadow: 0 1px 3px #000; white-space: nowrap; }
.gh-cue.is-on { opacity: 0.95; }
.gh-scope { position: absolute; left: 0; top: 0; right: 0; bottom: 0; opacity: 0; transition: opacity 120ms;
	background: radial-gradient(circle at 50% 50%, transparent 0, transparent 30vmin, rgba(0, 0, 0, 0.55) 31vmin, rgba(0, 0, 0, 0.92) 46vmin); }
.gh-root.is-scope .gh-scope { opacity: 1; }
.gh-cue kbd { font: 700 var(--tw-fs-sm, 11.5px) var(--tw-mono, monospace); padding: 0 calc(5 * var(--tw-u, 1px)); border-radius: 4px; background: rgba(255, 255, 255, 0.16); }
`;

let cssInjected = false;

export class GunHud {

	constructor( { hud = null, doc = ( typeof document !== 'undefined' ? document : null ) } = {} ) {

		this.doc = doc;
		this.root = null;
		this.markKind = null; // the marker showing now (tests)
		this.markAge = 0;
		this.gap = 0;
		this.shown = false;
		this.cue = false;
		this.ringK = - 1;
		if ( ! doc || ! hud ) return;
		if ( ! cssInjected && doc.head ) {

			const style = doc.createElement( 'style' );
			style.textContent = CSS;
			doc.head.append( style );
			cssInjected = true;

		}

		const mk = ( tag, cls, html = '' ) => {

			const e = doc.createElement( tag );
			e.className = cls;
			if ( html ) e.innerHTML = html;
			return e;

		};

		this.root = mk( 'div', 'gh-root' );
		this.cross = mk( 'div', 'gh-cross', '<i class="h l"></i><i class="h r"></i><i class="v t"></i><i class="v b"></i><b></b>' );
		this.ticks = this.cross.querySelectorAll ? Array.from( this.cross.querySelectorAll( 'i' ) ) : [];
		this.markEl = mk( 'div', 'gh-mark', '<i></i><i></i><i></i><i></i>' );
		this.killEl = mk( 'div', 'gh-kill', 'DOWN' );
		this.ringEl = mk( 'div', 'gh-ring', '<svg viewBox="0 0 44 44" width="100%" height="100%"><circle class="bg" cx="22" cy="22" r="19"/><circle class="fg" cx="22" cy="22" r="19" stroke-dasharray="119.4" stroke-dashoffset="119.4"/></svg>' );
		this.ringFg = this.ringEl.querySelector ? this.ringEl.querySelector( '.fg' ) : null;
		this.cueEl = mk( 'div', 'gh-cue', 'Empty · <kbd>R</kbd> to reload' );
		this.scopeEl = mk( 'div', 'gh-scope' ); // the long rifle's sight (wave 18D): the view narrows to a ring while aiming
		this.root.append( this.scopeEl, this.cross, this.ringEl, this.markEl, this.killEl, this.cueEl );
		hud.append( this.root );

	}

	get enabled() {

		return !! this.root;

	}

	mark( kind ) {

		this.markKind = kind;
		this.markAge = 0;
		if ( ! this.root ) return;
		this.markEl.className = 'gh-mark is-' + kind;

	}

	update( dt, v ) {

		const on = !! v.drawn;
		this.shown = on;
		this.gap = on ? Math.max( 0, v.gap || 0 ) : 0;
		this.cue = on && !! v.empty && ! ( v.reload >= 0 );
		this.scope = on && !! v.scope;
		this.ringK = on && v.reload >= 0 ? Math.min( 1, v.reload ) : - 1;
		if ( this.markKind ) {

			this.markAge += dt;
			if ( this.markAge >= ( MARK_LIFE[ this.markKind ] || 0.3 ) ) this.markKind = null;

		}

		if ( ! this.root ) return;
		this.root.classList.toggle( 'is-on', on );
		if ( ! on ) return;
		this.root.classList.toggle( 'is-aim', !! v.aiming );
		this.root.classList.toggle( 'is-scope', !! v.scope );
		const g = this.gap.toFixed( 1 );
		const [ l, r, t, b ] = this.ticks;
		if ( l ) l.style.transform = `translateX(-${ g }px)`;
		if ( r ) r.style.transform = `translateX(${ g }px)`;
		if ( t ) t.style.transform = `translateY(-${ g }px)`;
		if ( b ) b.style.transform = `translateY(${ g }px)`;
		const life = this.markKind ? ( MARK_LIFE[ this.markKind ] || 0.3 ) : 1;
		const mk = this.markKind ? 1 - this.markAge / life : 0;
		this.markEl.style.opacity = mk.toFixed( 2 );
		this.killEl.style.opacity = ( this.markKind === 'kill' ? Math.min( 1, mk * 1.6 ) : 0 ).toFixed( 2 );
		this.ringEl.classList.toggle( 'is-on', this.ringK >= 0 );
		if ( this.ringFg && this.ringK >= 0 ) this.ringFg.style.strokeDashoffset = ( 119.4 * ( 1 - this.ringK ) ).toFixed( 1 );
		this.cueEl.classList.toggle( 'is-on', this.cue );
		if ( this.cue && v.noShots ) this.cueEl.textContent = 'Empty · no cartridges';
		else if ( this.cue && this.cueEl.textContent !== 'Empty · R to reload' ) this.cueEl.innerHTML = 'Empty · <kbd>R</kbd> to reload';

	}

	dispose() {

		if ( this.root ) this.root.remove();
		this.root = null;

	}

}

// the crosshair gap in px for a cone of half-angle `half` (rad) on a camera of vertical fov `fovDeg` drawn `h` px tall
export function coneToPx( half, fovDeg, h ) {

	const f = Math.tan( ( fovDeg || 60 ) * Math.PI / 360 );
	return f > 0 ? Math.tan( half ) / f * h / 2 : 0;

}
