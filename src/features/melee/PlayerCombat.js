import { Vector3 } from '../../engine/index.js';
import { PLAYER, FEEL, THROW, facingDot, forwardX, forwardZ } from './MeleeData.js';
import { magnetTurn } from './LockOn.js';

// The player's side of the fight: health, the swing, the guard, the evade, being hit and the knockdown.
// Pure logic over a `host` (Melee in index.js, or a stub in the tests) that supplies the player, the raiders
// and the effects:
//   host.player (position, yaw, stamina 0..1), host.raiders, host.rand()
//   host.sfx( bank, { at, rate, gain } ), host.pop( text, at, kind ), host.kick( type ), host.lineOfSight( ... )
//   host.movePlayer( dx, dz ), host.respawnPlayer(), host.loseCash() -> number, host.emit( name, payload )
//   host.toast( text ), host.rodAway(), host.tauntNearby(), host.lockPlayer(), host.engaged() -> bool
//   host.rodStowed(), host.canSwing()
//   optional (wave 5): host.stopMontage( slot, blendOut ) when host.montage gave no handle to stop
//   optional (wave 4): host.targets() (raiders + the training post), host.lock (the soft lock-on target), host.montage( name,
//   opts ) (Avatar.playMontage), host.hasDeath() (the death feature respawns the player: no pier wake-up, no cash taken here)
//   optional (wave 12E, the feel): host.hitstop( s ) (both fighters freeze), host.slowmo( s, k ) (the parry), host.flash( kind )
//   (the HUD's shield / parry / hurt flash), host.puff( kind, { x, y, z } ) (dust / sparks at the contact), host.practiceLost()
//   optional (wave 18D, the arsenal): host.weaponStats() -> the weapon in hand (weapons/WeaponsData MELEE row: damage, range,
//   cone, contact, total, whiff, stamina, energy, parry, chip, guardBreak, combo, stun, montage, rate) or null (the paddle:
//   PLAYER's numbers). The swing reads it when it starts: the contact / recovery times, the reach and cone, the stamina, the
//   blow; a cutlass widens the parry window and cheapens a block, its third blow of a chain bites x1.5; an axe goes through a
//   cutlass guard and an armoured wind-up (Raider.takeHit opts.guardBreak). A blow a raider's cutlass turns aside: 'BLOCKED'.
//
// States: free | swing | evade | hurt | down.  Stamina belongs to Player.js: this only checks and spends it.
//   swing   LMB: 0.3 s to the contact (Melee_Paddle), the hit test runs then, ready again at 0.62 s (a whiff: 0.78 s); a
//           press in the last 0.3 s queues the next swing. Costs 0.08 stamina. A hit freezes both fighters (hitstop), kicks
//           the camera, pops the number and puffs dust at the contact; a whiff swishes. Q after the contact cancels the
//           recovery into the dodge (before the contact it is queued for the contact).
//   guard   RMB held in `free` with the rod stowed (Melee decides when the button counts: an enemy in reach, hold or
//           toggle, the forced drops): frontal hits are blocked (each chips 0.15 stamina; with less than
//           that the guard breaks and the hit lands at half damage); holding it costs 0.1 stamina / s.
//           Timing (wave 4): raised 0.06 - 0.26 s before the blow lands it PARRIES (no damage or stamina, the raider is
//           staggered and open); raised in the last 0.06 s it is a late block that lets 30 % through (chip).
//           The guard pose is a LOOPING upper-body montage ('block'): it is stopped the moment `guarding` drops (wave 5:
//           it used to stay up forever, "locked into the block animation"), and raised again after a parry's one-shot.
//   evade   Q: a 2 m dash in 0.2 s, i-frames 0.3 s from the start, 0.45 s cooldown, 0.18 stamina.
//   rocks   (wave 12E) a thrown rock arrives as a strike from a `ranged` source: the guard blocks it whatever the timing
//           (THROW.chip stamina; nobody near to stagger), a dodge's i-frames let it pass.
//   practice (r.practiceFight, the practice fight at the training post): blows land, but the player yields at 10 % instead
//           of going down (host.practiceLost()).
//   hurt    0.6 s after a hit (Hit_Reaction), 0.5 s of i-frames, cancels a swing in progress.
//   down    hp 0: Knockdown (1.2 s), cut to black, the player wakes at the nearest pier and gets up (GetUp_Front)
//           until 3 s; 10 % of the cash carried is lost at the moment of the blow. With the death feature installed
//           (host.hasDeath()) playerDied { cause: 'melee', x, y, z, by } goes out instead and the death feature does
//           the cut, the respawn and the purse; this only plays the fall and restores the health.

const _v = new Vector3();
// the paddle's swing as a weapon row (PLAYER's numbers: what the combat harness was tuned on)
export const SWING = {
	id: 'paddle', damage: PLAYER.attackDamage, range: PLAYER.attackRange, cone: PLAYER.attackCone, contact: PLAYER.attackContact,
	total: PLAYER.attackTotal, whiff: PLAYER.whiffTotal, stamina: PLAYER.attackStamina, energy: PLAYER.attackDamage * 40,
	parry: 0, chip: 1, guardBreak: false, combo: null, stun: 0, montage: 'swing', slot: 'full', rate: 1,
};
const COMBO_GAP = 0.45; // s after a swing within which the next one carries the chain on

export class PlayerCombat {

	constructor( host ) {

		this.host = host;
		this.maxHp = PLAYER.maxHp;
		this.reset();

	}

	reset() {

		this.hp = this.maxHp;
		this.state = 'free';
		this.t = 0;
		this.swingSfx = false;
		this.swingContact = false;
		this.buffer = 0;
		this.evadeInv = 0;
		this.evadeCd = 0;
		this.hurtInv = 0;
		this.evadeDir = { x: 0, z: 1 };
		this.dodgeQueued = null; // { x, z, yaw }: Q pressed before the swing's contact
		this.guardHeld = false;
		this.guarding = false;
		if ( this._guardMt ) this._stopGuardPose();
		this._guardMt = null; // the looping 'block' montage's handle while the guard is up
		this._upperBusy = 0; // clock until which another upper-body one-shot (the parry) owns the overlay
		this.sinceHurt = 99;
		this.hurtFlash = 0;
		this.fade = 0;
		this.respawned = false;
		this.downBy = null;
		this.lostCash = 0;
		this.tiredT = 0;
		this.lastSwing = null; // result of the last contact: { target, dealt, killed, punish } | null (whiff)
		this.clock = 0;
		this.guardStart = - 99; // clock when the guard last came up
		this.sinceCombat = 99; // s since a blow was traded (the health bar shows inside PLAYER.combatLinger)
		this.deathMode = false;
		this.stats = { swings: 0, hits: 0, whiffs: 0, blocks: 0, dodges: 0, hurt: 0, knockdowns: 0, parries: 0, chips: 0, cancels: 0, yields: 0 };
		this.guardFlash = 0; // 1 -> 0: the shield flash of a blocked blow (HUD)
		this.guardFlashKind = null;
		this.W = SWING; // the weapon of the swing in progress (weaponStats() at its start)
		this.combo = 0; // blows of the chain so far (a cutlass)
		this.comboT = 99; // s since the last swing ended

	}

	// the weapon in hand now: the host's row over PLAYER's paddle numbers
	weapon() {

		let w = null;
		try { w = this.host.weaponStats ? this.host.weaponStats() : null; } catch ( e ) { w = null; }
		return w ? { ...SWING, ...w } : SWING;

	}

	get alive() {

		return this.state !== 'down';

	}

	// the avatar action to show this frame (Avatar.js one-shots: swing / hit / knockdown / getUp) or null
	get action() {

		switch ( this.state ) {

			case 'swing': return 'swing';
			case 'hurt': return 'hit';
			case 'down': return this.t < PLAYER.fallTime ? 'knockdown' : 'getUp';
			default: return null;

		}

	}

	// ---- stamina (0..1, Player.js owns it)

	get stamina() {

		const p = this.host.player;
		return p && typeof p.stamina === 'number' ? p.stamina : 1;

	}

	_spend( amount ) {

		const p = this.host.player;
		if ( p && typeof p.stamina === 'number' ) p.stamina = Math.max( 0, p.stamina - amount );

	}

	_tired() {

		if ( this.tiredT <= 0 ) {

			this.tiredT = 1.5;
			this.host.toast( 'Too tired', 900 );

		}

	}

	// ---- presses (edges, from Melee.update)

	// LMB. Returns 'swing' | 'queued' | 'tired' | 'no'
	attackPress() {

		if ( this.state === 'down' ) return 'no';
		if ( this.state === 'free' ) return this._startSwing();
		this.buffer = PLAYER.attackBuffer;
		return 'queued';

	}

	_startSwing() {

		const W = this.weapon();
		if ( this.stamina < W.stamina - 1e-6 ) {

			this._tired();
			return 'tired';

		}

		this._spend( W.stamina );
		this.W = W;
		// a chain: the next swing soon after the last carries it on (the cutlass's third cut bites deeper)
		this.combo = W.combo && this.comboT <= COMBO_GAP ? ( this.combo % W.combo.length ) + 1 : 1;
		this.state = 'swing';
		this.t = 0;
		this.swingSfx = false;
		this.swingContact = false;
		this.buffer = 0;
		this.guarding = false;
		this.stats.swings ++;
		// the soft lock turns the swing onto its target (a little: the player still aims)
		const h = this.host, lk = h.lock, p = h.player;
		if ( lk && lk.targetable && p ) p.yaw += magnetTurn( p.yaw, p.position, lk );
		if ( h.montage ) h.montage( ( W.chain ? W.chain[ ( this.combo - 1 ) % W.chain.length ] : W.montage ) || 'swing', { slot: W.montage && W.montage !== 'swing' ? W.slot || 'upper' : 'upper', blendIn: 0.06, blendOut: 0.18, rate: W.rate || 1 } );
		return 'swing';

	}

	// Q. ( wishX, wishZ ): the direction the player is steering (world, any length); none: a step back.
	// Returns 'evade' | 'busy' | 'cooldown' | 'tired' | 'no'
	evadePress( wishX = 0, wishZ = 0, yaw = 0 ) {

		if ( this.state === 'down' ) return 'no';
		if ( this.state === 'evade' ) return 'busy';
		if ( this.evadeCd > 0 ) return 'cooldown';
		// mid-swing: before the contact the dodge waits for it (the blow still lands), after it the recovery is cancelled
		if ( this.state === 'swing' && ! this.swingContact ) {

			this.dodgeQueued = { x: wishX, z: wishZ, yaw };
			return 'queued';

		}
		if ( this.stamina < PLAYER.evadeStamina - 1e-6 ) {

			this._tired();
			return 'tired';

		}

		let dx = wishX, dz = wishZ;
		const len = Math.hypot( dx, dz );
		if ( len > 0.1 ) { dx /= len; dz /= len; } else { dx = Math.sin( yaw ); dz = Math.cos( yaw ); } // behind: opposite of ( -sin, -cos )
		this._spend( PLAYER.evadeStamina );
		if ( this.state === 'swing' ) this.stats.cancels ++;
		this.dodgeQueued = null;
		this.evadeDir.x = dx;
		this.evadeDir.z = dz;
		this.state = 'evade';
		this.t = 0;
		this.evadeInv = PLAYER.evadeInvuln;
		this.evadeCd = PLAYER.evadeCooldown;
		this.guarding = false;
		this.buffer = 0;
		this.host.sfx( 'hookSwing', { rate: 1.35, gain: 0.3 } );
		this.host.kick( 'dodge' );
		if ( this.host.montage ) this.host.montage( 'dodge', { slot: 'full', blendIn: 0.04, blendOut: 0.12, rate: 1 } );
		return 'evade';

	}

	// ---- per-step update

	update( dt ) {

		const h = this.host;
		this.clock += dt;
		this.sinceHurt += dt;
		this.sinceCombat += dt;
		if ( this.hurtInv > 0 ) this.hurtInv = Math.max( 0, this.hurtInv - dt );
		if ( this.evadeInv > 0 ) this.evadeInv = Math.max( 0, this.evadeInv - dt );
		if ( this.evadeCd > 0 ) this.evadeCd = Math.max( 0, this.evadeCd - dt );
		if ( this.buffer > 0 ) this.buffer = Math.max( 0, this.buffer - dt );
		if ( this.tiredT > 0 ) this.tiredT -= dt;
		if ( this.state !== 'swing' ) this.comboT += dt;
		if ( this.hurtFlash > 0 ) this.hurtFlash = Math.max( 0, this.hurtFlash - dt * 3.5 );
		if ( this.guardFlash > 0 ) this.guardFlash = Math.max( 0, this.guardFlash - dt * 4 );

		switch ( this.state ) {

			case 'free': {

				if ( this.buffer > 0 && h.canSwing() ) {

					this._startSwing();
					break;

				}

				const was = this.guarding;
				this.guarding = this.guardHeld && h.rodStowed() && this.stamina > PLAYER.guardMin;
				if ( this.guarding && ! was ) {

					// the parry timing counts from the step the press arrived in (wave 12E, the harness: stamping the step's end
					// made a raise one frame before the blow a 'late' block)
					this.guardStart = this.clock - dt;
					this._raiseGuardPose();

				}

				// (the stance is free outside a fight: wave 12E shows it whenever RMB is held with the rod away)
				if ( this.guarding && h.engaged() ) this._spend( PLAYER.guardDrain * dt );
				if ( this.hp < this.maxHp && this.sinceHurt > PLAYER.regenDelay && ! h.engaged() ) this.hp = Math.min( this.maxHp, this.hp + PLAYER.regen * dt );
				break;

			}

			case 'swing': {

				this.t += dt;
				const W = this.W || SWING;
				const lead = h.audio && h.audio.lead ? h.audio.lead( 'paddleSwing' ) : 0.12;
				if ( ! this.swingSfx && this.t >= W.contact - lead ) {

					this.swingSfx = true;
					h.sfx( 'paddleSwing', { rate: W.id === 'axe' ? 0.8 : W.id === 'cutlass' ? 1.3 : 1.05, gain: W.id === 'paddle' ? 0.6 : 0.3 } ); // (wave 20B: the blades' own voices sit on top)

				}

				if ( ! this.swingContact && this.t >= W.contact ) {

					this.swingContact = true;
					this.lastSwing = this._resolveSwing();
					// a Q pressed during the swing's wind-up: the dodge comes out the moment the blow is through
					const q = this.dodgeQueued;
					if ( q ) {

						this.dodgeQueued = null;
						if ( this.evadePress( q.x, q.z, q.yaw ) === 'evade' ) break;

					}

				}

				if ( this.t >= ( this.swingContact && ! this.lastSwing ? W.whiff : W.total ) ) {

					this.state = 'free';
					this.t = 0;
					this.comboT = 0;
					if ( this.buffer > 0 && h.canSwing() ) this._startSwing();

				}

				break;

			}

			case 'evade': {

				const step = Math.min( dt, PLAYER.evadeTime - this.t );
				if ( step > 0 ) {

					const sp = PLAYER.evadeDist / PLAYER.evadeTime * step;
					h.movePlayer( this.evadeDir.x * sp, this.evadeDir.z * sp );

				}

				this.t += dt;
				if ( this.t >= PLAYER.evadeTime ) {

					this.state = 'free';
					this.t = 0;

				}

				break;

			}

			case 'hurt':
				this.t += dt;
				if ( this.t >= PLAYER.hurtTime ) {

					this.state = 'free';
					this.t = 0;

				}

				break;

			case 'down': {

				this.t += dt;
				const t = this.t;
				// black while the player is carried off: in from 0.75 s, out from 1.5 s
				this.fade = t < 0.75 ? 0 : t < 1.2 ? ( t - 0.75 ) / 0.45 : t < 1.5 ? 1 : t < 2.2 ? 1 - ( t - 1.5 ) / 0.7 : 0;
				if ( this.deathMode ) this.fade = 0; // the death feature does its own cut
				h.lockPlayer();
				if ( ! this.respawned && t >= PLAYER.fallTime ) {

					this.respawned = true;
					this.hp = this.maxHp;
					if ( ! this.deathMode ) h.respawnPlayer();

				}

				if ( t >= PLAYER.downTime ) {

					this.state = 'free';
					this.t = 0;
					this.fade = 0;
					this.hurtInv = 1.5; // a moment to find your feet
					this.sinceHurt = 0;

				}

				break;

			}

			default:
				break;

		}

		if ( this.state !== 'free' ) this.guarding = false;
		if ( ! this.guarding ) {

			if ( this._guardMt ) this._stopGuardPose();

		} else if ( this._guardMt && this._guardMt.playing === false && this.clock >= this._upperBusy ) this._raiseGuardPose(); // after a parry

	}

	// ---- the guard pose (a looping upper-body montage: it must be stopped by hand)

	_raiseGuardPose() {

		const h = this.host;
		if ( this._guardMt ) this._stopGuardPose();
		this._guardMt = h.montage ? h.montage( 'block', { slot: 'upper', blendIn: 0.05, blendOut: 0.15 } ) || null : null;

	}

	_stopGuardPose() {

		const h = this.host, mt = this._guardMt;
		this._guardMt = null;
		if ( mt && typeof mt.stop === 'function' ) mt.stop( 0.15 );
		else if ( mt && h.stopMontage ) h.stopMontage( 'upper', 0.15 ); // a host that gave no handle (montage() -> true)

	}

	// ---- the swing's contact

	_resolveSwing() {

		const h = this.host, p = h.player.position, yaw = h.player.yaw, W = this.W || SWING;
		let best = null, bs = Infinity;
		const lk = h.lock;
		for ( const r of ( h.targets ? h.targets() : h.raiders ) ) {

			if ( ! r.targetable ) continue;
			const d = Math.hypot( r.x - p.x, r.z - p.z );
			const locked = r === lk;
			// the locked target is hit a little further off the view and the reach (the lock already put him in front)
			if ( d > W.range + ( locked ? 0.4 : 0 ) ) continue;
			const dot = d < 0.5 ? 1 : facingDot( yaw, p.x, p.z, r.x, r.z );
			if ( dot < ( locked ? Math.min( 0.1, W.cone ) : W.cone ) ) continue;
			if ( ! h.lineOfSight( p.x, p.y + 1.1, p.z, r.x, r.y + 1.1, r.z ) ) continue;
			const score = d - dot - ( locked ? 1.5 : 0 );
			if ( score < bs ) { bs = score; best = r; }

		}

		// the swing's contact point for the destructible props (a raider in reach takes the hit as well)
		const reachK = Math.min( 1.6, W.range * 0.46 ); // the contact point: 1.2 m for the paddle, further for the harpoon
		if ( h.emit ) h.emit( 'meleeHit', { x: p.x + forwardX( yaw ) * reachK, y: p.y + 1.0, z: p.z + forwardZ( yaw ) * reachK, range: W.range, energy: W.energy, by: 'player', weapon: W.id } );
		if ( ! best ) {

			// a whiff: a thin swish through the air and the longer recovery (whiffTotal)
			this.stats.whiffs ++;
			h.sfx( 'hookSwing', { rate: 1.45, gain: 0.32 } );
			return null;

		}

		const k = W.combo ? W.combo[ Math.max( 0, Math.min( W.combo.length, this.combo ) - 1 ) ] || 1 : 1;
		const res = best.takeHit( Math.round( W.damage * k ), { from: { x: p.x, z: p.z }, guardBreak: !! W.guardBreak, stun: W.stun || 0, weapon: W.id } );
		this.sinceCombat = 0;
		best.headPosition( _v );
		if ( res && res.blocked ) {

			// his cutlass turned the blow aside: steel on steel, nothing lands
			this.stats.blocked = ( this.stats.blocked || 0 ) + 1;
			h.sfx( 'hookHit', { at: { x: best.x, y: best.y + 1.2, z: best.z }, gain: 0.8, rate: 1.5 } );
			h.pop( 'BLOCKED', _v, 'block' );
			h.kick( 'snap' );
			if ( h.puff ) h.puff( 'block', { x: ( p.x + best.x ) / 2, y: best.y + 1.2, z: ( p.z + best.z ) / 2 } );
			return { target: best, dealt: 0, killed: false, punish: false, blocked: true };

		}

		this.stats.hits ++;
		h.sfx( 'paddleHit', { at: { x: best.x, y: best.y + 1.1, z: best.z }, gain: W.id === 'paddle' ? 0.95 : 0.5, rate: res.punish ? 0.9 : W.id === 'axe' ? 0.75 : 1 } );
		const label = res.guardBroken ? `BREAK ${ res.dealt }` : res.punish ? `PUNISH ${ res.dealt }` : k > 1 ? `CHAIN ${ res.dealt }` : String( res.dealt );
		h.pop( label, _v, res.punish || res.guardBroken || k > 1 ? 'punish' : 'dmg' );
		const heavy = res.punish || res.killed || W.id === 'axe';
		h.kick( heavy ? 'meleeHeavy' : 'meleeHit', 'catch' ); // the camera's hold and a small FOV pull
		// both fighters freeze for a beat (the sim's hitstop); dust off the contact, nearer him than the player
		if ( h.hitstop ) h.hitstop( res.killed ? FEEL.killStop : heavy ? FEEL.heavyStop : FEEL.hitstop );
		if ( h.puff ) h.puff( 'hit', { x: ( p.x + best.x * 2 ) / 3, y: best.y + 1.15, z: ( p.z + best.z * 2 ) / 3 } );
		return { target: best, dealt: res.dealt, killed: res.killed, punish: res.punish };

	}

	// where the guard's timing puts a blow arriving now: 'parry' | 'late' | 'block' (pure: the tests read it)
	guardTiming( now = this.clock ) {

		const held = now - this.guardStart;
		if ( held < PLAYER.lateWindow ) return 'late';
		if ( held <= PLAYER.lateWindow + PLAYER.parryWindow + this.weapon().parry ) return 'parry'; // a cutlass parries wider
		return 'block';

	}

	// ---- being struck. `r` has landed a blow that reached the player; returns the outcome:
	// 'dodged' | 'parried' | 'blocked' | 'chipped' | 'hit' | 'guardBroken' | 'knockedDown' | 'ignored' | 'missed'
	// r.practice (the training post): the same outcomes, but nothing is lost

	takeStrike( r ) {

		const h = this.host, p = h.player.position;
		if ( this.state === 'down' ) return 'missed';
		this.sinceCombat = 0;
		if ( this.evadeInv > 0 ) {

			this.stats.dodges ++;
			h.pop( 'DODGE', { x: p.x, y: p.y + 1.9, z: p.z }, 'dodge' );
			return 'dodged';

		}

		if ( this.hurtInv > 0 ) return 'ignored';
		const dmg = r.cfg.damage;
		if ( this.guarding && facingDot( h.player.yaw, p.x, p.z, r.x, r.z ) >= PLAYER.blockCone ) {

			const timing = this.guardTiming();
			if ( r.ranged ) {

				// a gunman's blast (wave 18D): the guard takes the worst of it, 40 % still gets through
				if ( r.shot ) {

					this._spend( THROW.chip );
					this.stats.chips ++;
					this._blockFx( r, 'block' );
					return this._damage( r, Math.ceil( dmg * 0.4 ), 'chipped' );

				}

				// a rock on the guard: it holds whatever the timing; a guard with no wind left breaks
				if ( this.stamina >= THROW.chip - 1e-6 ) {

					this._spend( THROW.chip );
					this.stats.blocks ++;
					h.sfx( 'hookHit', { at: { x: p.x, y: p.y + 1.2, z: p.z }, gain: 0.5, rate: 1.6 } );
					h.pop( 'BLOCK', { x: p.x, y: p.y + 1.9, z: p.z }, 'block' );
					h.kick( 'snap', null );
					this._blockFx( r, 'block' );
					return 'blocked';

				}

				this.guarding = false;
				return this._damage( r, Math.ceil( dmg * 0.5 ), 'guardBroken' );

			}

			if ( timing === 'parry' ) {

				// a clean parry: nothing lost, a little wind back, the raider reels open
				this.stats.parries ++;
				const p0 = h.player;
				if ( typeof p0.stamina === 'number' ) p0.stamina = Math.min( 1, p0.stamina + PLAYER.parryRefund );
				if ( r.parried ) r.parried();
				if ( ! h.sfx( 'parry', { at: { x: p.x, y: p.y + 1.3, z: p.z }, gain: 0.9 } ) ) h.sfx( 'hookHit', { at: { x: p.x, y: p.y + 1.2, z: p.z }, gain: 0.8, rate: 1.7 } );
				h.pop( 'PARRY', { x: p.x, y: p.y + 1.9, z: p.z }, 'parry' );
				h.kick( 'parry', 'catch' );
				this._blockFx( r, 'parry' );
				if ( h.slowmo ) h.slowmo( FEEL.slowT, FEEL.slowK ); // the moment: 0.3 s at 0.4 speed
				if ( h.montage ) h.montage( 'parry', { slot: 'upper', blendIn: 0.03, blendOut: 0.2 } );
				this._upperBusy = this.clock + 0.45; // the parry's one-shot plays out before the guard pose comes back
				return 'parried';

			}

			if ( timing === 'late' && this.stamina >= PLAYER.blockChip - 1e-6 ) {

				// the guard came up as the blow landed: it holds, but some of it gets through
				this._spend( PLAYER.blockChip );
				this.stats.chips ++;
				const chip = r.practice ? 0 : Math.ceil( dmg * PLAYER.chip );
				h.sfx( 'hookHit', { at: { x: p.x, y: p.y + 1.2, z: p.z }, gain: 0.7, rate: 1.2 } );
				h.pop( chip ? `LATE ${ chip }` : 'LATE', { x: p.x, y: p.y + 1.9, z: p.z }, 'chip' );
				h.kick( 'snap' );
				this._blockFx( r, 'block' );
				if ( chip > 0 ) {

					this.hp = Math.max( 0, this.hp - chip );
					this.sinceHurt = 0;
					this.hurtFlash = 0.5;
					if ( this.hp <= 0 ) { this._knockDown( r ); return 'knockedDown'; }

				}

				return 'chipped';

			}

			const chipCost = PLAYER.blockChip * this.weapon().chip; // a cutlass turns a blow cheaper, an axe dearer
			if ( this.stamina >= chipCost - 1e-6 ) {

				this._spend( chipCost );
				this.stats.blocks ++;
				h.sfx( 'hookHit', { at: { x: p.x, y: p.y + 1.2, z: p.z }, gain: 0.55, rate: 1.4 } );
				h.pop( 'BLOCK', { x: p.x, y: p.y + 1.9, z: p.z }, 'block' );
				h.kick( 'snap' );
				this._blockFx( r, 'block' );
				return 'blocked';

			}

			// no stamina left to hold the blow: the guard breaks and half of it lands
			const p0 = h.player;
			if ( typeof p0.stamina === 'number' ) p0.stamina = 0;
			this.guarding = false;
			return this._damage( r, Math.ceil( dmg * 0.5 ), 'guardBroken' );

		}

		return this._damage( r, dmg, 'hit' );

	}

	// the shield flash (HUD) and sparks where the blow met the guard
	_blockFx( r, kind ) {

		const h = this.host, p = h.player.position;
		this.guardFlash = 1;
		this.guardFlashKind = kind;
		if ( h.flash ) h.flash( kind );
		if ( h.puff ) {

			const dx = r.x - p.x, dz = r.z - p.z, d = Math.hypot( dx, dz ) || 1;
			h.puff( kind, { x: p.x + dx / d * 0.55, y: p.y + 1.25, z: p.z + dz / d * 0.55 } );

		}

	}

	_damage( r, dmg, outcome ) {

		const h = this.host, p = h.player.position;
		if ( r.practiceFight && this.hp - dmg <= this.maxHp * PLAYER.practiceYield + 1e-6 ) {

			// the practice fight: the player yields at 10 % instead of going down; nothing is lost
			this.hp = Math.max( 1, Math.round( this.maxHp * PLAYER.practiceYield ) );
			this.hurtInv = 1.2;
			this.sinceHurt = 0;
			this.hurtFlash = 1;
			this.buffer = 0;
			this.dodgeQueued = null;
			this.state = 'hurt';
			this.t = 0;
			this.guarding = false;
			this.stats.yields ++;
			this.sinceCombat = 0;
			h.kick( 'meleeHurt', 'strike' );
			if ( h.practiceLost ) h.practiceLost( r );
			return 'yielded';

		}

		if ( r.practice ) {

			// the training post's swing: shown, never felt
			this.hurtInv = PLAYER.hurtInvuln;
			h.pop( 'HIT', { x: p.x, y: p.y + 1.9, z: p.z }, 'hurt' );
			h.kick( 'snap' );
			return outcome;

		}

		this.hp = Math.max( 0, this.hp - dmg );
		this.hurtInv = PLAYER.hurtInvuln;
		this.sinceHurt = 0;
		this.hurtFlash = 1;
		this.buffer = 0;
		this.stats.hurt ++;
		h.sfx( r.kind === 'captain' ? 'hookHit' : 'paddleHit', { at: { x: p.x, y: p.y + 1.2, z: p.z }, gain: 1, rate: 0.85 } );
		h.pop( String( dmg ), { x: p.x, y: p.y + 1.9, z: p.z }, 'hurt' );
		h.kick( 'meleeHurt', 'strike' );
		if ( h.flash ) h.flash( 'hurt' );
		this.dodgeQueued = null;
		if ( h.montage && this.hp > 0 ) h.montage( 'hit', { slot: 'full', blendIn: 0.04, blendOut: 0.2 } );
		if ( this.hp <= 0 ) {

			this._knockDown( r );
			return 'knockedDown';

		}

		this.state = 'hurt';
		this.t = 0;
		this.guarding = false;
		return outcome;

	}

	_knockDown( r ) {

		const h = this.host;
		this.state = 'down';
		this.t = 0;
		this.fade = 0;
		this.respawned = false;
		this.guarding = false;
		this.buffer = 0;
		this.downBy = r;
		this.stats.knockdowns ++;
		this.deathMode = !! ( h.hasDeath && h.hasDeath() );
		this.lostCash = this.deathMode ? 0 : h.loseCash();
		h.emit( 'playerKnockedDown', { by: r.name, byId: r.spawnId, kind: r.kind, cashLost: this.lostCash } );
		if ( this.deathMode ) {

			const p = h.player.position;
			h.emit( 'playerDied', { cause: 'melee', x: p.x, y: p.y, z: p.z, by: r.name } );

		}
		h.rodAway( true );
		h.tauntNearby( r );
		h.sfx( 'paddleHit', { gain: 1, rate: 0.7 } );

	}

}
