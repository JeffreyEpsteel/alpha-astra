// The islanders' sounds.
//
//   clown prank    app.player.launched rising from 0 to above 0 (the shove: Player.launch sets 0.9 s; the clown is the
//                  only caller) plays the voice line ClownPullMyFinger_V4 at the nearest prank resident (within 20 m),
//                  else in the head. The interact() result of the Residents is not an event, so this polls.
//   workshop       now and then a working resident within hearing range (3 - 28 m of the listener) speaks one of the
//                  workshop lines (Bran_Workshop_V01 / Iona_Workshop_V01, alternating), positional at the resident,
//                  one at a time, every 40 - 100 s. Working: a resident whose gesture or base clip is a task (sweeping,
//                  fishing, mending, inspecting a catch...) and who is not talking or walking.
// Residents: app.residents.list of { x, y, z, state, gesture, base, prank, data }.

import { num } from './util.js';

const WORK = /sweep|hammer|saw|mend|repair|net|inspect|fishing|work|haul|paint|carry/i;
const LINES = [ 'bran_workshop', 'iona_workshop' ];
export const WORKSHOP_RANGE = [ 3, 28 ]; // m from the listener
const GAP = [ 40, 100 ]; // s between two workshop lines

export function isWorking( r ) {

	if ( ! r || r.state === 'talk' || r.state === 'walk' ) return false;
	if ( r.data && r.data.work === true ) return true;
	return WORK.test( String( r.gesture || '' ) ) || ( ! r.gesture && WORK.test( String( r.base || '' ) ) );

}

export class FolkSfx {

	constructor( sfx ) {

		this.sfx = sfx;
		this.launched = 0;
		this.nextT = 20 + Math.random() * 20;
		this.line = Math.floor( Math.random() * LINES.length );
		this.scanT = 0;
		this.pranks = 0;
		this.workshop = 0;
		this.speaker = null; // id of the resident of the last workshop line

	}

	clown() {

		const R = this.sfx.app.residents, p = this.sfx.app.player && this.sfx.app.player.position;
		if ( ! R || ! R.list || ! p ) return null;
		let best = null, bd = 20 * 20;
		for ( const r of R.list ) {

			if ( ! ( r.prank || ( r.data && r.data.prank ) ) ) continue;
			const d2 = ( r.x - p.x ) ** 2 + ( r.z - p.z ) ** 2;
			if ( d2 < bd ) { bd = d2; best = r; }

		}

		return best;

	}

	update( dt ) {

		const s = this.sfx, app = s.app, p = app.player;
		if ( ! s.player.ctx ) return;

		// the prank: a shove has started
		const l = p ? num( p.launched, 0 ) : 0;
		if ( l > 0 && this.launched <= 0 ) {

			const c = this.clown();
			this.pranks ++;
			s.play( 'clown_prank', { at: c ? { x: c.x, y: num( c.y, 0 ) + 1.6, z: c.z } : null, jitter: 0.02 } );

		}

		this.launched = l;

		// load the voice lines before they are needed
		this.scanT -= dt;
		const R = app.residents;
		if ( this.scanT <= 0 && R && R.list && p ) {

			this.scanT = 1;
			if ( this.clown() ) s.player.preload( 'clown_prank' );

		}

		this.nextT -= dt;
		if ( this.nextT > 0 || ! R || ! R.list ) return;
		if ( s.player.busy( 'bran_workshop' ) > 0 || s.player.busy( 'iona_workshop' ) > 0 ) { this.nextT = 5; return; }
		const L = s.player.listener(), cands = [];
		for ( const r of R.list ) {

			if ( ! isWorking( r ) ) continue;
			const d = Math.hypot( r.x - L.x, r.z - L.z );
			if ( d >= WORKSHOP_RANGE[ 0 ] && d <= WORKSHOP_RANGE[ 1 ] ) cands.push( r );

		}

		if ( ! cands.length ) { this.nextT = 6; return; }
		const r = cands[ Math.floor( Math.random() * cands.length ) ];
		const name = LINES[ this.line % LINES.length ];
		if ( ! s.player.has( name ) ) {

			s.player.preload( name ); // the first line waits for its file
			this.nextT = 2;
			return;

		}

		const v = s.play( name, { at: { x: r.x, y: num( r.y, 0 ) + 1.6, z: r.z }, jitter: 0 } );
		if ( v ) {

			this.workshop ++;
			this.speaker = r.id || null;
			this.line ++;
			this.nextT = GAP[ 0 ] + Math.random() * ( GAP[ 1 ] - GAP[ 0 ] );

		} else this.nextT = 15; // muted or out of range of the mix: try later

	}

	dispose() {}

}
