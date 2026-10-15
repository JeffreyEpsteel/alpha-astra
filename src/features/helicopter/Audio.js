// Positional turbine and four-blade rotor pulse through the game's existing SFX bus.
// The shared audio lifecycle supplies mute/volume, spatialization and impact sounds.
import { PlaneAudio } from '../seaplane/PlaneAudio.js';

export class RotorAudio extends PlaneAudio {
	_build( ctx ) {
		super._build( ctx );
		const n = this.nodes, pulse = ctx.createOscillator(), depth = ctx.createGain();
		pulse.type = 'sine'; depth.gain.value = 0.24;
		pulse.connect( depth ); depth.connect( n.eng.gain ); pulse.start();
		n.rotorPulse = pulse; n.sources.push( pulse ); n.fire.type = 'triangle'; n.sub.type = 'sine';
	}
	update( dt, state ) {
		super.update( dt, state );
		const n = this.nodes, ctx = this.ctx;
		if ( ! n || ! ctx ) return;
		const rpm = Math.max( 0, Math.min( 1, state.rpm || 0 ) ), t = ctx.currentTime;
		n.rotorPulse.frequency.setTargetAtTime( Math.max( 1, rpm * 22 ), t, 0.1 );
		n.fire.frequency.setTargetAtTime( 110 + rpm * 240, t, 0.08 );
		n.sub.frequency.setTargetAtTime( 22 + rpm * 16, t, 0.08 );
		n.high.frequency.setTargetAtTime( 700 + rpm * 1600, t, 0.08 );
		n.lp.frequency.setTargetAtTime( 500 + rpm * 900, t, 0.08 );
	}
}
