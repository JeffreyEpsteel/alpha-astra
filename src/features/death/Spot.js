// A claimable spot (the sea chest, a wreck's cargo): E on foot / on deck through the registry's interactables (Game shows
// the prompt), and E while swimming or diving here, since Game only offers feature prompts on foot and on deck. The
// prompt set in a feature's update is still drawn this frame (AppUI reads player.prompt after features.update).
//
//   const spot = new ClaimSpot( app, features, { id, position: () => ( { x, y, z } ) | null, prompt: () => text | null,
//                                                onClaim: () => void, radius = 2.6, reach = 3.2 } );
//   spot.update()     per frame (the swim / dive half)      spot.dispose()

export class ClaimSpot {

	constructor( app, features, o ) {

		this.app = app || {};
		this.o = { radius: 2.6, reach: 3.2, ...o };
		const swimming = () => !! ( this.app.player && this.app.player.mode === 'swim' );
		this._off = features && features.interactable ? features.interactable( {
			id: o.id, radius: this.o.radius,
			position: () => this.o.position(),
			prompt: () => this.o.prompt(),
			onInteract: () => this.o.onClaim(),
			when: () => ! swimming() && !! this.o.position(),
		} ) : null;

	}

	// the player is close enough (horizontally within radius, vertically within reach)
	near() {

		const p = this.app.player, q = this.o.position();
		if ( ! p || ! p.position || ! q ) return false;
		return Math.hypot( q.x - p.position.x, q.z - p.position.z ) <= this.o.radius && Math.abs( ( q.y ?? p.position.y ) - p.position.y ) <= this.o.reach;

	}

	update() {

		const p = this.app.player, inp = this.app.input;
		if ( ! p || p.mode !== 'swim' || ! this.near() ) return false;
		let text = null;
		try { text = this.o.prompt(); } catch ( e ) { text = null; }
		if ( ! text ) return false;
		if ( ! p.prompt ) p.prompt = { key: 'E', text };
		if ( inp && inp.hit && inp.hit( 'KeyE' ) ) {

			this.o.onClaim();
			return true;

		}

		return false;

	}

	dispose() {

		if ( this._off ) this._off();
		this._off = null;

	}

}
