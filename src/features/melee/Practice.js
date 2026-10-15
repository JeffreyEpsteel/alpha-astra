import { Group, Mesh, BoxGeometry, CylinderGeometry } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { PLAYER, PRACTICE, TRAINING_POST, yawToward } from './MeleeData.js';
import { Raider } from './Raider.js';

// The practice fight at the training post (wave 12E): E at the weapon rack beside the post starts it. Two tier 1 practice
// raiders (wooden swords: r.practiceFight) walk in on the beach and fight for real inside the peaceful home waters, but
// nobody dies: they yield at 1 health (Raider), the player at 10 % (PlayerCombat: "You're down - try again"). Nothing is
// looted, nothing is lost, no enemyDefeated goes out; the player's health is whole again when it ends.
//
//   const pf = new Practice( melee, { scene, terrain } )
//   pf.start() / pf.stop( why )     pf.active     pf.update( dt )     pf.onYield( r )     pf.lost( r )     pf.dispose()
//   pf.rack: { x, y, z }            the rack's spot (the "Practice fight" interactable)

export class Practice {

	constructor( melee, { scene = null, terrain = null, mesh = true } = {} ) {

		this.melee = melee;
		this.terrain = terrain;
		this.raiders = []; // cached: the GLBs load once
		this.active = false;
		this.result = null; // 'won' | 'lost' | 'left' | null
		this.leaveT = 0;
		this.fights = 0;
		this.wins = 0;
		const x = TRAINING_POST.x + PRACTICE.rackDx, z = TRAINING_POST.z + PRACTICE.rackDz;
		this.rack = { x, y: terrain && terrain.heightAt ? Math.max( 0, terrain.heightAt( x, z ) ) : 0, z };
		this.scene = scene;
		this.group = null;
		if ( mesh && scene ) {

			try { this._build(); } catch ( e ) { this.group = null; }

		}

	}

	get partners() {

		return this.raiders.filter( ( r ) => r.active );

	}

	// a spot on dry sand `d` m from the player, round the circle from angle a0
	_spot( p, d, a0 ) {

		const t = this.terrain;
		for ( let i = 0; i < 16; i ++ ) {

			const a = a0 + i * 0.7;
			const x = p.x + Math.sin( a ) * d, z = p.z + Math.cos( a ) * d;
			if ( ! t || t.heightAt( x, z ) > 0.3 ) return { x, z };

		}

		return { x: p.x + d, z: p.z };

	}

	start( opts = {} ) {

		const m = this.melee, p = m.player && m.player.position;
		if ( ! p || this.active ) return false;
		this.active = true;
		this.result = null;
		this.leaveT = 0;
		this.fights ++;
		m.rodAway( false );
		if ( m.dummy && m.dummy.sparring ) m.dummy.spar( false );
		const toPost = Math.atan2( TRAINING_POST.x - p.x, TRAINING_POST.z - p.z );
		for ( let i = 0; i < PRACTICE.count; i ++ ) {

			let r = this.raiders[ i ];
			const spot = this._spot( p, PRACTICE.spawn, toPost + ( i ? 1.3 : - 1.3 ) );
			const slot = { id: `practice-${ i + 1 }`, x: spot.x, z: spot.z, when: 'practice', characters: PRACTICE.characters, tier: PRACTICE.tier, practiceFight: true };
			if ( ! r ) {

				const mine = m.app.avatar && m.app.avatar.character;
				const chars = PRACTICE.characters.filter( ( c ) => c !== mine );
				const avatar = m.avatarFactory( { scene: m.app.scene, character: chars[ i % chars.length ], lite: true } );
				r = new Raider( m, slot, avatar );
				r.practiceFight = true;
				this.raiders[ i ] = r;
				m.list.push( r );

			}

			r.homeX = spot.x;
			r.homeZ = spot.z;
			r.homeYaw = yawToward( spot.x, spot.z, p.x, p.z );
			r.spawn( { name: PRACTICE.names[ i % PRACTICE.names.length ], tier: PRACTICE.tier } );
			r.practiceFight = true;
			r.yaw = r.homeYaw;
			// straight in: no camp to notice it from
			r.aggro = true;
			r._enter( 'notice' );

		}

		m.combat.hp = m.combat.maxHp;
		if ( opts.toast !== false ) m.toast( 'Practice fight · wooden swords · guard the gold ring, punish the opening', 3200 );
		m.emit( 'practiceStarted', { count: PRACTICE.count } );
		return true;

	}

	// a practice raider gave up (Raider.takeHit at 1 health)
	onYield( r ) {

		if ( ! this.active ) return;
		this.melee.sfx( 'hookHit', { at: { x: r.x, y: r.y + 1, z: r.z }, gain: 0.6, rate: 0.8 } );
		if ( this.partners.every( ( q ) => q.yielded ) ) this.stop( 'won' );
		else this.melee.toast( `${ r.name } yields`, 1600 );

	}

	// the player yielded (PlayerCombat at 10 %)
	lost() {

		if ( this.active ) this.stop( 'lost' );

	}

	stop( why = 'left' ) {

		if ( ! this.active ) return;
		const m = this.melee;
		this.active = false;
		this.result = why;
		this.leaveT = PRACTICE.leave;
		if ( why === 'won' ) this.wins ++;
		for ( const r of this.partners ) {

			// whoever is still up stops fighting and stands aside
			if ( ! r.yielded && r.state !== 'down' ) { r.yielded = true; r.alert = false; r._enter( 'taunt' ); }
			m.releaseToken( r );

		}

		if ( why === 'won' ) m.toast( 'Practice won · well fought', 2600 );
		else if ( why === 'lost' ) m.toast( 'You\'re down - try again', 2600 );
		m.emit( 'practiceEnded', { result: why } );

	}

	update( dt ) {

		const m = this.melee;
		if ( this.active ) {

			const p = m.player && m.player.position;
			// walked off, took the boat, or something else ended it
			const far = ! p || this.partners.every( ( r ) => Math.hypot( r.x - p.x, r.z - p.z ) > 30 );
			if ( far || ! m.player || m.player.mode !== 'walk' || ! m.enabled ) this.stop( 'left' );

		} else if ( this.leaveT > 0 ) {

			this.leaveT -= dt;
			if ( this.leaveT <= 0 ) {

				for ( const r of this.partners ) r.deactivate();
				// back on your feet, nothing lost
				if ( m.combat.state !== 'down' ) m.combat.hp = m.combat.maxHp;

			}

		}

		// a yielded practice raider must not come back into it (taunt -> return would heal and walk him home: fine, he
		// is put away when leaveT runs out); while the fight runs the player's health never drops under the yield line
		if ( this.active && m.combat.hp < m.combat.maxHp * PLAYER.practiceYield ) m.combat.hp = Math.ceil( m.combat.maxHp * PLAYER.practiceYield );

	}

	// the weapon rack: two posts, a bar, two wooden swords leaning on it
	_build() {

		const wood = new Material( { name: 'practice-rack-wood', color: [ 0.45, 0.32, 0.2 ], roughness: 0.85 } );
		const pale = new Material( { name: 'practice-sword', color: [ 0.7, 0.58, 0.4 ], roughness: 0.8 } );
		const g = new Group();
		g.name = 'PracticeRack';
		const add = ( geo, mat, x, y, z, rz = 0 ) => {

			const mm = new Mesh( geo, mat );
			mm.position.set( x, y, z );
			mm.rotation.set( 0, 0, rz );
			mm.castShadow = true;
			mm.receiveShadow = true;
			g.add( mm );
			return mm;

		};

		add( new CylinderGeometry( 0.05, 0.06, 1.0, 8 ), wood, - 0.45, 0.5, 0 );
		add( new CylinderGeometry( 0.05, 0.06, 1.0, 8 ), wood, 0.45, 0.5, 0 );
		add( new BoxGeometry( 1.05, 0.06, 0.06 ), wood, 0, 0.92, 0 );
		const blade = new BoxGeometry( 0.06, 0.95, 0.025 );
		add( blade, pale, - 0.18, 0.5, 0.06, 0.14 );
		add( blade, pale, 0.2, 0.5, 0.06, - 0.1 );
		g.position.set( this.rack.x, this.rack.y, this.rack.z );
		g.rotation.set( 0, yawToward( this.rack.x, this.rack.z, TRAINING_POST.x, TRAINING_POST.z ) + Math.PI / 2, 0 );
		if ( typeof g.updateMatrixWorld === 'function' ) g.updateMatrixWorld( true );
		this.group = g;
		this.mats = [ wood, pale ];
		this.scene.add( g );

	}

	dispose() {

		if ( this.group && this.scene ) this.scene.remove( this.group );
		if ( this.mats ) for ( const mt of this.mats ) if ( mt.dispose ) mt.dispose();
		this.group = null;

	}

}
