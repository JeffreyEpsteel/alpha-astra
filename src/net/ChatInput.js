// A one-line chat entry at the bottom of the HUD (multiplayer): Enter opens it, Enter sends,
// Escape cancels. While it is open the game's keys are ignored (input.enabled = false).
//   const chat = new ChatInput( { hud, input } ); chat.open( ( text ) => net.chat( text ) ); chat.isOpen
const CSS = /* css */`
.net-entry { position: absolute; left: 50%; bottom: calc(var(--tw-edge) + 150 * var(--tw-u)); transform: translateX(-50%); width: min(560px, 80vw);
	display: none; align-items: center; gap: var(--tw-2); padding: var(--tw-2) var(--tw-3); border-radius: 999px; font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); }
.net-entry.is-on { display: flex; }
.net-entry span { color: var(--tw-ink-3); font-size: var(--tw-fs-sm); white-space: nowrap; }
.net-entry input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: var(--tw-ink); font: inherit; }
`;

export class ChatInput {

	constructor( { hud, input } ) {

		this.input = input;
		const style = document.createElement( 'style' );
		style.textContent = CSS;
		document.head.append( style );
		this.el = document.createElement( 'div' );
		this.el.className = 'net-entry tw-glass tw-interactive';
		this.el.innerHTML = '<span>Say</span><input type="text" maxlength="200" placeholder="…and Enter to send, Esc to cancel" /><span>Enter</span>';
		this.field = this.el.querySelector( 'input' );
		hud.append( this.el );
		this.isOpen = false;
		this._send = null;
		this.field.addEventListener( 'keydown', ( e ) => {

			e.stopPropagation();
			if ( e.key === 'Enter' ) {

				const text = this.field.value.trim();
				if ( text && this._send ) this._send( text );
				this.close();

			} else if ( e.key === 'Escape' ) this.close();

		} );
		this.field.addEventListener( 'blur', () => this.close() );

	}

	open( send ) {

		if ( this.isOpen ) return;
		this._send = send;
		this.isOpen = true;
		this.el.classList.add( 'is-on' );
		this.field.value = '';
		if ( this.input ) this.input.enabled = false;
		try {

			if ( document.pointerLockElement ) document.exitPointerLock();

		} catch ( e ) { /* ignore */ }

		setTimeout( () => this.field.focus(), 0 );

	}

	close() {

		if ( ! this.isOpen ) return;
		this.isOpen = false;
		this.el.classList.remove( 'is-on' );
		if ( this.input ) this.input.enabled = true;
		this.field.blur();

	}

}
