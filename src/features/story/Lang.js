import { getLang, tx } from '../../i18n/index.js';
import { RO } from './W20Text.js';

// The story's text in the player's language. English is written in the data (StoryData, StoryW20); the wave 20 lines carry their
// Romanian in W20Text.js (RO: English -> Romanian, whole strings), and anything else goes through i18n's tx (a whole English string
// that is a table value), which hands unknown text back unchanged. Templates keep their {who} / {n} for the caller to fill.
//
//   L( text ) -> text in the current language (getLang(): 'en' | 'ro')

export function L( text ) {

	if ( typeof text !== 'string' || ! text ) return text;
	let lang = 'en';
	try { lang = getLang(); } catch ( e ) { lang = 'en'; }
	if ( lang === 'ro' && Object.prototype.hasOwnProperty.call( RO, text ) ) return RO[ text ];
	try { return tx( text ); } catch ( e ) { return text; }

}

export { RO };
