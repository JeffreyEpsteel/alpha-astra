// Hostile boarding (parity V12, naval fork WORLD_TRADE_PIRATES_BRIEF D5): pirates board the player's boat. Repel them or pay.
// Owned by the Boarding instance (boarding.hostile) and driven from its update(); headless like the rest of boarding.
//
//   1. A pirate in 'chase' / 'broadside' within CHOOSE_RANGE rolls once per engagement whether to board instead of trading shot
//      (more likely for the 'boarder' trait the pirates feature puts on its named captains, an unarmed or shot-up boat, high
//      notoriety; a retaliation raid with mustBoard always does). She enters 'close' (V7 close-to-board: an external state the
//      naval brains leave alone) and steers for your boat.
//   2. Alongside (hull gap under GRAPPLE_GAP) while your boat is slower than GRAPPLE_SPEED: 'grapple' for GRAPPLE_TIME s. Open the
//      throttle past BREAK_SPEED and the lines part (she falls back to 'chase' and may try again after RETRY s).
//   3. Boarded: a panel - 1 Repel boarders / 2 Pay the ransom (keys 1 / 2 or click). No choice in CHOOSE_TIME s means repel.
//   4. Repel: a short melee exchange resolved in ticks: your side (gun level, crew, melee health, rally) against her boarders.
//      Press 1 to rally (stamina). Win: the boarders go over the side, she loses hull and runs to regroup. Lose: they strip a share
//      of your coins and cargo, knock the boat about, and leave to regroup.
//   5. Ransom: pay and they leave (regroup).
//   Wave 4: the exchanges keep the melee's guard timing. Each exchange is a blow on a beat (the HUD's beat bar fills toward
//   its gold end): raise the guard (RMB / LT) in the parry window just before it lands and that boarder goes over the side
//   outright; a late raise (the last 0.06 s) still tilts the odds your way. And never in the peaceful home waters: no
//   pirate rolls to board, and anyone closing gives up, until the boat is beyond the reef (melee/Peace.js).
//
//   h.phase 'idle' | 'grapple' | 'boarded' | 'fight'   h.ship   h.view()   h.choose( 0 | 1 )   h.rally()   h.update( dt )   h.reset()
// Events: hostileBoarding { id, ship, captain, boarders }, boardersRepelled { id, ship, captain, boarders }, boardersWon { id, ship,
//   captain, coins, goods }, ransomPaid { id, ship, captain, amount }, and grappleBroken { id, ship }.

import { mulberry32 } from '../../util/Noise.js';
import { hullGap, clamp } from './BoardingData.js';
import { inPeace } from '../melee/Peace.js';
import { PLAYER } from '../melee/MeleeData.js';

export const HOSTILE = {
	chooseRange: 180, // m: a pirate this close considers boarding
	base: 0.16, boarder: 0.45, weakHull: 0.25, unarmed: 0.3, perLevel: 0.04,
	giveUp: 0.35, // hull fraction: below it a closing pirate gives up the idea
	closeTimeout: 75, loseRange: 420,
	grappleGap: 9, grappleSpeed: 5, breakSpeed: 6.2, grappleTime: 2.5,
	retry: 45,
	chooseTime: 9,
	tick: 0.85, playerHits: 3, // s per exchange (a readable beat for the parry), exchanges lost before the boat is overrun
	lateBonus: 0.2, // a late guard adds this to your odds for that exchange
	rally: 0.35, rallyCost: 0.08, rallyDecay: 0.5,
	repelHull: 0.12, // of her max hull lost with the boarders
	overrunShare: 0.22, overrunMax: [ 0, 160, 260, 380, 520, 700 ], // coins by tier
	overrunHull: 0.15,
	ransom: [ 80, 55, 0.08 ], // base + per boarder + share of the purse
};

const BOARD_STATES = new Set( [ 'close', 'grapple', 'boarding' ] );

export class Hostile {

	constructor( boarding, { hud = null, seed = 0x51ab } = {} ) {

		this.b = boarding;
		this.hud = hud;
		this.rng = mulberry32( seed );
		if ( this.hud ) this.hud.onChoose = ( i ) => this.choose( i );
		this.stats = { attempts: 0, grapples: 0, broken: 0, repelled: 0, overrun: 0, ransoms: 0, parries: 0 };
		this.reset();

	}

	reset() {

		if ( this.ship && this.ship.alive && BOARD_STATES.has( this.ship.state ) ) this.ship.state = 'chase';
		this.phase = 'idle';
		this.ship = null;
		this.t = 0;
		this.boarders = 0;
		this.hits = 0;
		this.rallyLevel = 0;
		this.outcome = null;
		this._scanT = 0;
		this._rmb = false;
		this.guardAt = - 99; // fight clock when the guard last came up
		this.lastExchange = null; // 'parried' | 'won' | 'lost'

	}

	get app() {

		return this.b.app;

	}

	get busy() {

		return this.phase !== 'idle';

	}

	_pirates() {

		return this.b.features && this.b.features.get ? this.b.features.get( 'pirates' ) : null;

	}

	_captainName( s ) {

		return s.captain || s.name;

	}

	_tier( s ) {

		const p = this._pirates(), c = p && p.roster ? p.roster.captainOfShip( s ) : null;
		return c ? c.tier : s.kind === 'brigantine' ? 2 : 1;

	}

	_boarders( s ) {

		return clamp( Math.round( s.crewSize ? s.crewSize * 0.6 : s.kind === 'brigantine' ? 3 : 2 ), 1, 5 );

	}

	_boat() {

		const a = this.app, p = a.player, b = a.boatCtl;
		if ( ! p || ! b || ! b.position ) return null;
		if ( p.mode !== 'boat' && p.mode !== 'deck' && p.mode !== 'seat' ) return null;
		if ( b.moored ) return null;
		const nv = this.b.naval;
		if ( nv && nv.playerHull && nv.playerHull.sunk ) return null;
		const speed = Number.isFinite( b.speed ) ? Math.abs( b.speed ) : ( b.velocity ? Math.hypot( b.velocity.x, b.velocity.z ) : 0 );
		return { x: b.position.x, z: b.position.z, vx: b.velocity ? b.velocity.x : 0, vz: b.velocity ? b.velocity.z : 0, speed };

	}

	// ---- choosing a ship

	_odds( s ) {

		const nv = this.b.naval, h = HOSTILE;
		if ( s.mustBoard ) return 1;
		let o = h.base;
		if ( s.traits && s.traits.includes( 'boarder' ) ) o += h.boarder;
		const hull = nv && nv.playerHull;
		if ( hull && hull.max > 0 && hull.hp / hull.max < 0.5 ) o += h.weakHull;
		if ( nv && nv.playerGun && ! nv.playerGun.owned ) o += h.unarmed;
		const p = this._pirates();
		if ( p && p.wanted ) o += h.perLevel * p.wanted.level;
		return Math.min( 0.95, o );

	}

	_scan( nv, boat ) {

		for ( const s of nv.ships ) {

			if ( s.faction !== 'pirate' || ! s.alive || s.ghost ) continue;
			if ( s._boardCool > 0 ) { s._boardCool -= 1; continue; }
			if ( s.state !== 'chase' && s.state !== 'broadside' ) continue;
			if ( s.hpFraction < HOSTILE.giveUp || s._boardRolled ) continue;
			if ( Math.hypot( s.x - boat.x, s.z - boat.z ) > HOSTILE.chooseRange ) continue;
			s._boardRolled = true;
			if ( this.rng() >= this._odds( s ) ) continue;
			s.state = 'close';
			s.stateTime = 0;
			this.stats.attempts ++;

		}

	}

	// ---- the closing ships (several may be closing; one boards at a time)

	_steer( nv, boat, dt ) {

		for ( const s of nv.ships ) {

			if ( ! s.alive || s.state !== 'close' ) continue;
			const d = Math.hypot( boat.x - s.x, boat.z - s.z );
			if ( s.hpFraction < HOSTILE.giveUp ) { s.state = 'flee'; continue; }
			if ( d > HOSTILE.loseRange || s.stateTime > HOSTILE.closeTimeout ) { this._fallBack( s ); continue; }
			const lead = clamp( d / 7, 0, 4 );
			s.want = Math.atan2( boat.x + boat.vx * lead - s.x, boat.z + boat.vz * lead - s.z );
			s.wantSpeed = d > 45 ? 1 : 0.55;
			if ( this.phase === 'idle' && boat.speed < HOSTILE.grappleSpeed && hullGap( s.cls, { x: s.x, z: s.z, yaw: s.yaw }, boat.x, boat.z ) < HOSTILE.grappleGap ) this._grapple( s );

		}

	}

	_fallBack( s ) {

		if ( ! s.alive ) return;
		s.state = 'chase';
		s.stateTime = 0;
		s._boardCool = HOSTILE.retry;
		s._boardRolled = false;

	}

	_grapple( s ) {

		this.phase = 'grapple';
		this.ship = s;
		this.t = 0;
		s.state = 'grapple';
		this.stats.grapples ++;
		this.b._toast( `Grappling hooks from the ${ s.name }! Open the throttle to tear free`, 3000 );

	}

	// ---- per frame

	update( dt ) {

		const nv = this.b.naval;
		if ( ! nv || nv.active === false || ! Array.isArray( nv.ships ) ) { if ( this.phase !== 'idle' ) this._end( null ); this._hud( dt ); return; }
		const boat = this._boat();
		if ( this.phase === 'idle' ) {

			if ( boat && this.b.phase === 'idle' && inPeace( boat.x, boat.z ) ) {

				// the home waters: whoever was closing gives it up
				for ( const s of nv.ships ) if ( s.alive && s.state === 'close' ) this._fallBack( s );

			} else if ( boat && this.b.phase === 'idle' ) {

				this._scanT -= dt;
				if ( this._scanT <= 0 ) {

					this._scanT = 1;
					this._scan( nv, boat );

				}

				this._steer( nv, boat, dt );

			} else {

				// nothing to board: anyone closing goes back to the guns
				for ( const s of nv.ships ) if ( s.alive && s.state === 'close' ) this._fallBack( s );

			}

			this._hud( dt );
			return;

		}

		const s = this.ship;
		// her ship went, the boat went, or she struck her colours under your guns: it is over
		if ( ! s || ! s.alive || ! boat || s.state === 'adrift' ) { this._end( null ); this._hud( dt ); return; }
		this.t += dt;
		this._holdAlongside( s, boat );
		if ( boat ) this._steer( nv, boat, dt ); // the others keep closing
		switch ( this.phase ) {

			case 'grapple':
				if ( boat.speed > HOSTILE.breakSpeed ) {

					this.stats.broken ++;
					this.b._toast( 'You tore free of the hooks', 2200 );
					this.b._emit( 'grappleBroken', { id: s.id, ship: s.name } );
					this._fallBack( s );
					this.phase = 'idle';
					this.ship = null;

				} else if ( this.t >= HOSTILE.grappleTime ) this._boarded( s );
				break;
			case 'boarded':
				this._stall();
				if ( this.t >= HOSTILE.chooseTime ) this.choose( 0 );
				break;
			case 'fight': {

				this._stall();
				this.rallyLevel = Math.max( 0, this.rallyLevel - HOSTILE.rallyDecay * dt );
				// the guard's rising edge (RMB / LT): the parry timing of the next exchange counts from it
				const inp = this.app.input, rmb = !! ( inp && inp.rightDown );
				if ( rmb && ! this._rmb ) this.guardAt = this.t;
				this._rmb = rmb;
				this._tickT = ( this._tickT ?? HOSTILE.tick ) - dt;
				if ( this._tickT <= 0 ) {

					this._tickT = HOSTILE.tick;
					this._exchange( s );

				}

				break;

			}

			default:
				break;

		}

		this._hud( dt );

	}

	// she lies alongside, matching the boat
	_holdAlongside( s, boat ) {

		s.want = Math.atan2( boat.vx, boat.vz ) || s.yaw;
		s.wantSpeed = clamp( boat.speed / ( s.cls.speed || 6 ), 0, 1 );

	}

	// boarders on deck: the boat loses way
	_stall() {

		const b = this.app.boatCtl;
		if ( b && b.velocity && b.velocity.multiplyScalar ) b.velocity.multiplyScalar( 0.92 );

	}

	_boarded( s ) {

		this.phase = 'boarded';
		this.t = 0;
		s.state = 'boarding';
		this.boarders = this._boarders( s );
		this.hits = 0;
		this.rallyLevel = 0;
		this.b._toast( `${ this._captainName( s ) }'s crew swarm over your rail!`, 2600 );
		this.b._emit( 'hostileBoarding', { id: s.id, ship: s.name, captain: s.captain || null, boarders: this.boarders } );

	}

	ransomFor( s = this.ship ) {

		const st = this.b.state, [ base, per, share ] = HOSTILE.ransom;
		const purse = st && Number.isFinite( st.money ) ? st.money : 0;
		return Math.round( ( base + per * this._boarders( s ) * this._tier( s ) + purse * share ) / 5 ) * 5;

	}

	canPay( s = this.ship ) {

		const st = this.b.state;
		if ( ! st ) return true;
		return !! st.free || ( Number.isFinite( st.money ) && st.money >= this.ransomFor( s ) );

	}

	// your side against hers: 0..1, the chance you win one exchange
	odds( s = this.ship ) {

		const nv = this.b.naval, st = this.b.state, m = this.b.melee;
		const gun = nv && nv.playerGun && nv.playerGun.owned ? nv.playerGun.level : 0;
		const crew = st && Array.isArray( st.unlocked ) ? Math.min( 4, st.unlocked.length - 1 ) : 0;
		const hp = m && Number.isFinite( m.playerHp ) ? clamp( m.playerHp / 100, 0, 1 ) : 1;
		const mine = 1 + 0.22 * gun + 0.18 * crew + 0.5 * hp + this.rallyLevel;
		const theirs = 0.45 * Math.max( 1, this.boarders ) + 0.12 * this._tier( s );
		return mine / ( mine + theirs );

	}

	choose( i ) {

		const s = this.ship;
		if ( this.phase !== 'boarded' || ! s ) return false;
		if ( i === 1 ) {

			const amount = this.ransomFor( s );
			if ( ! this.canPay( s ) ) { this.b._toast( 'You cannot pay what they ask', 2200 ); return false; }
			const st = this.b.state;
			if ( st && st.spend ) st.spend( amount );
			this.stats.ransoms ++;
			this.b._toast( `You paid ${ this._captainName( s ) } $${ amount } · they cast off`, 3400 );
			this.b._emit( 'ransomPaid', { id: s.id, ship: s.name, captain: s.captain || null, amount } );
			this._end( 'ransom' );
			return true;

		}

		this.phase = 'fight';
		this.t = 0;
		this._tickT = HOSTILE.tick;
		return true;

	}

	rally() {

		if ( this.phase !== 'fight' ) return false;
		const p = this.app.player;
		if ( p && Number.isFinite( p.stamina ) ) {

			if ( p.stamina < HOSTILE.rallyCost ) return false;
			p.stamina -= HOSTILE.rallyCost;

		}

		this.rallyLevel = Math.min( 1.2, this.rallyLevel + HOSTILE.rally );
		return true;

	}

	// where the guard's timing puts this exchange: 'parry' | 'late' | null (no guard raised for it)
	guardTiming() {

		const held = this.t - this.guardAt;
		if ( held < 0 || held > PLAYER.lateWindow + PLAYER.parryWindow ) return null;
		return held < PLAYER.lateWindow ? 'late' : 'parry';

	}

	_exchange( s ) {

		const timing = this.guardTiming();
		const cf = this.app.cameraFeel;
		if ( timing === 'parry' ) {

			// parried: the blow turned, the boarder goes over the side
			this.stats.parries = ( this.stats.parries || 0 ) + 1;
			this.lastExchange = 'parried';
			if ( cf && cf.kick && cf.kick( 'parry' ) === false ) cf.kick( 'catch' );
			this.boarders --;
			if ( this.boarders <= 0 ) this._repelled( s );
			return;

		}

		const odds = Math.min( 0.95, this.odds( s ) + ( timing === 'late' ? HOSTILE.lateBonus : 0 ) );
		if ( this.rng() < odds ) {

			this.lastExchange = 'won';
			this.boarders --;
			if ( this.boarders <= 0 ) this._repelled( s );

		} else {

			this.lastExchange = 'lost';
			this.hits ++;
			if ( cf && cf.kick ) cf.kick( 'snap' );
			if ( this.hits >= HOSTILE.playerHits ) this._overrun( s );

		}

	}

	_repelled( s ) {

		s.hp = Math.max( 1, s.hp - s.maxHp * HOSTILE.repelHull );
		s.hostileRepelled = true;
		this.stats.repelled ++;
		if ( this.b.stats ) this.b.stats.repelled = ( this.b.stats.repelled || 0 ) + 1;
		this.b._toast( `Boarders repelled! The ${ s.name } sheers off`, 3200 );
		this.b._emit( 'boardersRepelled', { id: s.id, ship: s.name, captain: s.captain || null, boarders: this._boarders( s ) } );
		this._end( 'repelled' );

	}

	_overrun( s ) {

		const st = this.b.state, f = this.b.features, tier = this._tier( s );
		let coins = 0;
		if ( st && ! ( f && f.sandbox ) && ! st.free && Number.isFinite( st.money ) && st.money > 0 ) {

			coins = Math.min( HOSTILE.overrunMax[ clamp( tier, 1, 5 ) ], Math.round( st.money * HOSTILE.overrunShare ) );
			if ( coins > 0 && st.spend ) st.spend( coins );

		}

		const goods = [], tr = this.b.trade;
		if ( tr && tr.cargo && tr.takeCargo ) {

			const have = Object.keys( tr.cargo ).filter( ( g ) => tr.cargo[ g ] && tr.cargo[ g ].qty > 0 );
			for ( let i = 0; i < Math.min( 2, have.length ); i ++ ) {

				const g = have[ Math.floor( this.rng() * have.length ) % have.length ];
				const want = Math.max( 1, Math.ceil( tr.cargo[ g ] ? tr.cargo[ g ].qty / 2 : 1 ) );
				const r = tr.takeCargo( g, want );
				if ( r && r.qty ) goods.push( { good: g, qty: r.qty } );

			}

		}

		const nv = this.b.naval, h = nv && nv.playerHull;
		if ( h && h.max > 0 && nv.damagePlayer ) nv.damagePlayer( Math.min( h.max * HOSTILE.overrunHull, Math.max( 0, h.hp - 1 ) ), `boarders:${ s.name }` );
		this.stats.overrun ++;
		this.b._toast( `${ this._captainName( s ) }'s crew took the deck${ coins ? ` · $${ coins }` : '' }${ goods.length ? ` and ${ goods.map( ( g ) => g.good ).join( ', ' ) }` : '' } gone`, 4200 );
		this.b._emit( 'boardersWon', { id: s.id, ship: s.name, captain: s.captain || null, coins, goods } );
		this._end( 'overrun' );

	}

	// she leaves: regroup (pirates feature steers 'regroup'; without it the brains' patrol)
	_end( outcome ) {

		const s = this.ship;
		this.outcome = outcome;
		if ( s && s.alive && BOARD_STATES.has( s.state ) ) {

			s.mustBoard = false;
			s._boardCool = HOSTILE.retry * 3;
			const p = this._pirates();
			s.state = outcome && p ? 'regroup' : 'chase';
			s.stateTime = 0;

		}

		this.phase = 'idle';
		this.ship = null;
		this.t = 0;

	}

	view() {

		const s = this.ship;
		let prompt = '', choice = null;
		if ( this.phase === 'grapple' && s ) prompt = `Grappled by the ${ s.name } · throttle away to tear free`;
		else if ( this.phase === 'fight' && s ) prompt = `Repelling boarders · <kbd>RMB</kbd>guard on the gold to parry · <kbd>1</kbd>rally · ${ this.boarders } left · ${ HOSTILE.playerHits - this.hits } before they take the deck`;
		else if ( this.phase === 'boarded' && s ) {

			const pay = this.ransomFor( s );
			choice = {
				title: `${ this._captainName( s ) } boards your boat`,
				lines: [ `${ this.boarders } boarder${ this.boarders > 1 ? 's' : '' } from the ${ s.name }. ${ Math.max( 0, Math.ceil( HOSTILE.chooseTime - this.t ) ) } s to decide.` ],
				options: [
					{ key: '1', label: 'Repel boarders', sub: `fight them off · about ${ Math.round( this.odds( s ) * 100 ) } % a blow` },
					{ key: '2', label: `Pay $${ pay }`, sub: 'they cast off and leave you be', disabled: ! this.canPay( s ) },
				],
			};

		}

		// the beat bar of the exchanges: fills toward the next blow, the gold end is the parry window
		const beat = this.phase === 'fight' ? { k: clamp( 1 - ( this._tickT ?? HOSTILE.tick ) / HOSTILE.tick, 0, 1 ), zone: ( PLAYER.parryWindow + PLAYER.lateWindow ) / HOSTILE.tick, last: this.lastExchange } : null;
		return { phase: this.phase, prompt, choice, fade: 0, prisoners: [], beat };

	}

	_hud( dt ) {

		if ( this.hud ) this.hud.update( dt, this.view() );

	}

	dispose() {

		this.reset();
		if ( this.hud && this.hud.dispose ) this.hud.dispose();
		this.hud = null;

	}

}
