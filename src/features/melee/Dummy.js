import { Group, Mesh, CylinderGeometry, BoxGeometry, SphereGeometry } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { RAIDER, TRAINING_POST, yawToward, wrapAngle } from './MeleeData.js';

// The training post on the harbour beach (MeleeData TRAINING_POST): the melee tutorial in the peaceful home waters. Hit it
// any time; E there ("Spar") and while you keep at it the post swings its arm back at you on a slow, fully telegraphed
// beat (ring, amber cue, whoosh), so the guard, the parry window and the dodge can be practised. Its blows are practice
// (r.practice): the outcomes and numbers show, nothing is lost. It never dies (its "health" just refills).
//
// It quacks like a Raider for the combat code: id, kind 'dummy', name, x / y / z, yaw, cfg { windup, hitRange, cone, damage },
// state / t / alert (the telegraph), targetable, takeHit( dmg ), parried(), headPosition( out ), parryCue.
//
//   const d = new Dummy( owner, { scene, terrain } )   owner: Melee (raiderStrike, onWindup, target())
//   d.spar( on )   d.update( dt )   d.dispose()

export const DUMMY = {
	windup: 0.9, // the post's wind-up: slower than any raider
	every: 2.4, // s between its swings while sparring
	spar: 14, // s sparring lasts after the last E / hit
	range: 4, // m: it only swings at a player this close
	hp: 300,
};

export class Dummy {

	constructor( owner, { scene = null, terrain = null, x = TRAINING_POST.x, z = TRAINING_POST.z, mesh = true } = {} ) {

		this.owner = owner;
		this.id = 'training-post';
		this.spawnId = this.id;
		this.kind = 'dummy';
		this.name = 'Training post';
		this.practice = true;
		this.tier = 1;
		this.cfg = { ...RAIDER, windup: DUMMY.windup, hitRange: TRAINING_POST.reach, cone: 0.2, damage: 12, recover: 1.0, stagger: 0.4, parryStagger: 1.2, hp: DUMMY.hp };
		this.x = x;
		this.z = z;
		this.y = terrain && terrain.heightAt ? Math.max( 0, terrain.heightAt( x, z ) ) : 0;
		this.yaw = TRAINING_POST.yaw;
		this.hp = this.maxHp = DUMMY.hp;
		this.active = true;
		this.visible = true;
		this.state = 'idle';
		this.t = 0;
		this.alert = false;
		this.punish = false;
		this.parriedT = 0;
		this.sparT = 0;
		this.nextT = 1.2;
		this.strikeCount = 0;
		this.outcome = null;
		this.spin = 0; // visual: the post rocks when hit
		this.spinV = 0;
		this.hits = 0;
		this.group = null;
		this.scene = scene;
		if ( mesh && scene ) {

			try { this._build(); } catch ( e ) { this.group = null; }

		}

	}

	get targetable() {

		return this.active;

	}

	get sparring() {

		return this.sparT > 0;

	}

	get inCombat() {

		return false; // the post never counts as a fight (no health bar, no rod-away)

	}

	get parryCue() {

		if ( this.state !== 'windup' ) return 0;
		const left = this.cfg.windup - this.t;
		return left <= 0.26 ? 1 - left / 0.26 : 0;

	}

	spar( on = true ) {

		this.sparT = on ? DUMMY.spar : 0;
		if ( on ) this.nextT = Math.min( this.nextT, 1.2 );
		else if ( this.state === 'windup' ) this._enter( 'idle' );
		return this.sparring;

	}

	_enter( s ) {

		this.state = s;
		this.t = 0;
		this.alert = s === 'windup';
		this.punish = s === 'recover' || ( s === 'stagger' && this.parriedT > 0 );
		if ( s === 'windup' && this.owner.onWindup ) this.owner.onWindup( this );

	}

	takeHit( damage ) {

		const punish = this.state === 'recover' || this.parriedT > 0;
		const dealt = Math.round( damage * ( punish ? 1.5 : 1 ) );
		this.hp -= dealt;
		if ( this.hp <= 0 ) this.hp = this.maxHp; // it never falls
		this.hits ++;
		this.spinV += ( punish ? 7 : 4 ) * ( this.hits % 2 ? 1 : - 1 );
		if ( this.sparT > 0 ) this.sparT = DUMMY.spar;
		if ( this.state === 'windup' ) this._enter( 'idle' ); // interrupted: it starts its beat again
		return { dealt, killed: false, punish, staggered: false };

	}

	parried() {

		this.parriedT = this.cfg.parryStagger;
		this._enter( 'stagger' );
		this.spinV += 5;
		return true;

	}

	headPosition( out ) {

		return out.set( this.x, this.y + 1.75, this.z );

	}

	update( dt ) {

		this.t += dt;
		if ( this.parriedT > 0 ) this.parriedT = Math.max( 0, this.parriedT - dt );
		const tg = this.owner.target ? this.owner.target() : null;
		const d = tg ? Math.hypot( tg.x - this.x, tg.z - this.z ) : Infinity;
		if ( this.sparT > 0 ) {

			this.sparT -= dt;
			if ( d > DUMMY.range * 3 ) this.sparT = 0; // walked off
			// it turns to face its sparring partner
			if ( tg && d > 0.3 ) this.yaw += wrapAngle( yawToward( this.x, this.z, tg.x, tg.z ) - this.yaw ) * ( 1 - Math.exp( - dt * 6 ) );

		}

		switch ( this.state ) {

			case 'idle':
				this.nextT -= dt;
				if ( this.sparT > 0 && this.nextT <= 0 && tg && tg.valid && d <= DUMMY.range ) this._enter( 'windup' );
				break;
			case 'windup':
				if ( this.sparT <= 0 ) { this._enter( 'idle' ); break; }
				if ( this.t >= this.cfg.windup ) {

					this.strikeCount ++;
					this.outcome = this.owner.raiderStrike ? this.owner.raiderStrike( this ) : 'missed';
					if ( this.state === 'windup' ) this._enter( 'recover' );

				}

				break;
			case 'recover':
				if ( this.t >= this.cfg.recover ) { this._enter( 'idle' ); this.nextT = DUMMY.every - this.cfg.recover; }
				break;
			case 'stagger':
				if ( this.t >= this.cfg.parryStagger ) { this._enter( 'idle' ); this.nextT = DUMMY.every; }
				break;
			default:
				break;

		}

		this._pose( dt );

	}

	// ---- the mesh: a post, a padded body, a head and a swinging arm (the arm winds back, then sweeps through)

	_build() {

		const wood = new Material( { name: 'training-post-wood', color: [ 0.42, 0.3, 0.19 ], roughness: 0.85 } );
		const pad = new Material( { name: 'training-post-pad', color: [ 0.72, 0.62, 0.42 ], roughness: 0.95 } );
		const g = new Group();
		g.name = 'TrainingPost';
		const add = ( geo, mat, x, y, z, parent = g ) => {

			const m = new Mesh( geo, mat );
			m.position.set( x, y, z );
			m.castShadow = true;
			m.receiveShadow = true;
			parent.add( m );
			return m;

		};

		add( new CylinderGeometry( 0.09, 0.11, 2.0, 10 ), wood, 0, 1.0, 0 );
		add( new CylinderGeometry( 0.26, 0.24, 0.8, 12 ), pad, 0, 1.15, 0 );
		add( new SphereGeometry( 0.17, 12, 8 ), pad, 0, 1.78, 0 );
		add( new BoxGeometry( 0.7, 0.08, 0.7 ), wood, 0, 0.04, 0 );
		const arm = new Group();
		arm.position.set( 0, 1.42, 0 );
		add( new BoxGeometry( 1.1, 0.07, 0.07 ), wood, 0.55, 0, 0, arm );
		add( new CylinderGeometry( 0.07, 0.07, 0.3, 8 ), pad, 1.08, 0, 0, arm );
		g.add( arm );
		this.arm = arm;
		this.group = g;
		this.mats = [ wood, pad ];
		this.scene.add( g );
		this._pose( 0 );

	}

	_pose( dt ) {

		// the rocking after a hit: a damped spring
		this.spinV += - this.spin * 40 * dt - this.spinV * 6 * dt;
		this.spin += this.spinV * dt;
		const g = this.group;
		if ( ! g ) return;
		g.position.set( this.x, this.y, this.z );
		g.rotation.set( 0, this.yaw + Math.PI + this.spin * 0.12, this.spin * 0.05 );
		let a = 0.9; // the arm rests across the front
		if ( this.state === 'windup' ) a = 0.9 + 1.6 * Math.min( 1, this.t / this.cfg.windup ); // wound back
		else if ( this.state === 'recover' ) a = this.t < 0.12 ? 2.5 - 3.6 * ( this.t / 0.12 ) : - 1.1 + 2 * Math.min( 1, ( this.t - 0.12 ) / 0.6 ); // the sweep, then back
		if ( this.arm ) this.arm.rotation.set( 0, a, 0 );
		if ( typeof g.updateMatrixWorld === 'function' ) g.updateMatrixWorld( true );

	}

	dispose() {

		if ( this.group && this.scene ) this.scene.remove( this.group );
		if ( this.mats ) for ( const m of this.mats ) if ( m.dispose ) m.dispose();
		this.group = null;

	}

}
