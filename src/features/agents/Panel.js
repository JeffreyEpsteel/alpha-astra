// The harbour agent's window: Captain Roid's yard window (GameHUD's stand, the gm-* classes of HudPanels.js) filled from
// agents.rows( port ). HudPanels.renderYard hands over here when hud.yardPort names a port with an agent; every button
// runs agents.act( key, port ) and re-renders through hud.renderYard (a purchase also re-renders through state.onChange).
//
//   renderAgentYard( hud, agents ) -> bool        false when the port has no agent (Roid's own window then)

const esc = ( v ) => String( v ).replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' ).replace( /"/g, '&quot;' );
const money = ( n ) => '$' + Math.round( n ).toLocaleString( 'en-US' );

export function rowHTML( r, free ) {

	let act;
	if ( r.have ) act = `<span class="gm-have">${ esc( r.have ) }</span>`;
	else {

		const price = free ? '<span class="gm-price">Free in sandbox</span>'
			: `<span class="gm-price">${ r.trade ? '<small>Trade in</small>' : '' }${ money( r.price ) }</span>`;
		act = `${ price }<button class="gm-btn" data-agent="${ esc( r.key ) }" ${ r.disabled ? 'disabled' : '' }>${ esc( r.action ) }</button>`;

	}

	return `<div class="gm-shop-row ${ r.owned ? 'is-owned' : '' }"><span>${ esc( r.label ) }<small>${ esc( r.note || '' ) }</small></span><span class="gm-shop-act">${ act }</span></div>`;

}

export function renderAgentYard( hud, ag ) {

	const port = hud.yardPort, A = ag.agentOf( port );
	if ( ! A || ! hud.stand ) return false;
	const s = hud.game.state, free = ag.free();
	const rows = ag.rows( port );
	const mod = ag.priceMod( port );
	const foot = free ? `Free in sandbox · delivered to ${ A.name }'s dock`
		: `Delivered to ${ A.name }'s dock · the yard's price${ Math.abs( mod - 1 ) > 1e-3 ? ' at this port' : '' } plus ${ Math.round( ag.fee * 100 ) } % for the agent`;
	hud.stand.innerHTML = `
			<h2>${ esc( ag.heading( port ) ) }</h2>
			<p class="gm-sub">${ esc( A.vendor ? A.vendor.greeting : '' ) } · ${ free ? 'Free in sandbox' : `You have ${ money( s.money ) }` }</p>
			<div class="gm-list">${ rows.map( ( r ) => rowHTML( r, free ) ).join( '' ) }</div>
			<div class="gm-foot"><span class="gm-sub">${ esc( foot ) }</span><button class="gm-btn is-ghost" data-close>Leave (E)</button></div>`;
	const close = hud.stand.querySelector( '[data-close]' );
	if ( close ) close.onclick = () => hud.closeStand();
	for ( const b of hud.stand.querySelectorAll( '[data-agent]' ) ) {

		b.onclick = () => {

			ag.act( b.dataset.agent, port );
			if ( hud.standOpen ) hud._keepScroll( () => hud.renderYard() );

		};

	}

	return true;

}
