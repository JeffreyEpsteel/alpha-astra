// The seaplane's sound, synthesized (no samples): a radial engine drone (a sawtooth at the firing rate, a square
// sub-octave and a detuned upper partial through a low-pass that opens with the rpm) and the propeller wash / wind
// (looped white noise through a band-pass that rises with the airspeed). One HRTF-less panner at the cowling, into
// the game's SoundScape sfx bus (a.sfxAbove, else its master), so the sfx volume, the mute switch and the underwater
// muffle apply. Built on the first update with the engine running; a no-op without app.audio (node tests, ?noAudio).
//
//   const s = new PlaneAudio( app );
//   s.update( dt, { running, rpm, airspeed, x, y, z, inside, cranking, flaps, horn } );   s.click( kind );   s.dispose()
// Wave 8, the cockpit (straight into the bus, no panner: they are in the cabin with you): the starter's whine while it
// cranks, the flap motor's whir while the flaps travel, the stall horn (a warbling square) and a switch click.
// Wave 10, crashes: s.crunch( strength, x, y, z, water ) - the impact (a low thud, a tearing crunch of metal and wood, a
// splash hiss on the water), positioned; the engine dying is the caller's (a sputter of update()s with running dropping).

export class PlaneAudio {

	constructor( app ) {

		this.app = app;
		this.nodes = null;
		this.level = 0; // eased engine-running level
		this.state = { rpm: 0, airspeed: 0, gain: 0, horn: false, flaps: false, cranking: false, clicks: 0, crunches: 0 }; // last values (tests)

	}

	get ctx() {

		const a = this.app && this.app.audio;
		return a && a.ctx && ! a._failed ? a.ctx : null;

	}

	_build( ctx ) {

		const a = this.app.audio;
		const out = ctx.createGain();
		out.gain.value = 0;
		const pan = ctx.createPanner();
		pan.panningModel = 'equalpower';
		pan.distanceModel = 'inverse';
		pan.refDistance = 12;
		pan.rolloffFactor = 1.0;
		pan.maxDistance = 3000;
		out.connect( pan );
		pan.connect( a.sfxAbove || a.master || ctx.destination );

		const lp = ctx.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.value = 400;
		lp.Q.value = 0.9;
		const eng = ctx.createGain();
		eng.gain.value = 0.5;
		lp.connect( eng );
		eng.connect( out );
		const osc = ( type, gain ) => {

			const o = ctx.createOscillator();
			o.type = type;
			o.frequency.value = 30;
			const g = ctx.createGain();
			g.gain.value = gain;
			o.connect( g );
			g.connect( lp );
			o.start();
			o._g = g; // (the second engine ramps its own gain)
			return o;

		};

		const fire = osc( 'sawtooth', 0.5 ), sub = osc( 'square', 0.28 ), high = osc( 'sawtooth', 0.12 );
		// the Albatross's second engine: the same voice a hair sharp, so the pair beats like two radials do
		const fire2 = osc( 'sawtooth', 0 ), sub2 = osc( 'square', 0 );
		// a slow wobble on the firing rate: nine cylinders never quite agree
		const lfo = ctx.createOscillator();
		lfo.frequency.value = 3.1;
		const lfoG = ctx.createGain();
		lfoG.gain.value = 0.6;
		lfo.connect( lfoG );
		lfoG.connect( fire.frequency );
		lfo.start();

		const len = Math.floor( ctx.sampleRate * 2 );
		const buf = ctx.createBuffer( 1, len, ctx.sampleRate );
		const d = buf.getChannelData( 0 );
		for ( let i = 0; i < len; i ++ ) d[ i ] = Math.random() * 2 - 1;
		const noise = ctx.createBufferSource();
		noise.buffer = buf;
		noise.loop = true;
		const bp = ctx.createBiquadFilter();
		bp.type = 'bandpass';
		bp.frequency.value = 600;
		bp.Q.value = 0.6;
		const wash = ctx.createGain();
		wash.gain.value = 0;
		noise.connect( bp );
		bp.connect( wash );
		wash.connect( out );
		noise.start();
		this.nodes = { out, pan, lp, eng, fire, sub, high, fire2, sub2, lfo, noise, bp, wash, sources: [ fire, sub, high, fire2, sub2, lfo, noise ] };
		this._buildCabin( ctx, buf );

	}

	// the cabin's own sounds: starter whine, flap motor, stall horn, and the bus the clicks play into
	_buildCabin( ctx, noiseBuf ) {

		const a = this.app.audio, n = this.nodes;
		const cab = ctx.createGain();
		cab.gain.value = 1;
		cab.connect( a.sfxAbove || a.master || ctx.destination );
		const tone = ( type, freq, gain ) => {

			const o = ctx.createOscillator();
			o.type = type;
			o.frequency.value = freq;
			const g = ctx.createGain();
			g.gain.value = 0;
			o.connect( g );
			o.start();
			n.sources.push( o );
			return { o, g, peak: gain };

		};

		// starter: a geared whine
		const st = tone( 'sawtooth', 160, 0.07 );
		const stLp = ctx.createBiquadFilter();
		stLp.type = 'lowpass';
		stLp.frequency.value = 900;
		st.g.connect( stLp );
		stLp.connect( cab );
		// flap motor: a buzzing whir with a little flutter
		const fm = tone( 'triangle', 310, 0.05 );
		const fmV = ctx.createOscillator();
		fmV.frequency.value = 23;
		const fmVG = ctx.createGain();
		fmVG.gain.value = 9;
		fmV.connect( fmVG );
		fmVG.connect( fm.o.frequency );
		fmV.start();
		n.sources.push( fmV );
		fm.g.connect( cab );
		// stall horn: a square at 420 Hz, warbled 7 times a second
		const hn = tone( 'square', 420, 0.06 );
		const hnLp = ctx.createBiquadFilter();
		hnLp.type = 'lowpass';
		hnLp.frequency.value = 1600;
		const hnAm = ctx.createGain();
		hnAm.gain.value = 0.6;
		const hnL = ctx.createOscillator();
		hnL.frequency.value = 7;
		const hnLG = ctx.createGain();
		hnLG.gain.value = 0.4;
		hnL.connect( hnLG );
		hnLG.connect( hnAm.gain );
		hnL.start();
		n.sources.push( hnL );
		hn.g.connect( hnAm );
		hnAm.connect( hnLp );
		hnLp.connect( cab );
		Object.assign( n, { cab, starter: st, flapMotor: fm, horn: hn, noiseBuf } );

	}

	// a switch click (or a heavier 'clunk' for the flap lever / the starter button)
	click( kind = 'switch' ) {

		this.state.clicks ++;
		const ctx = this.ctx, n = this.nodes;
		if ( ! ctx || ! n || ! n.cab || ( this.app.audio && this.app.audio._muted ) ) return;
		try {

			const t = ctx.currentTime;
			const src = ctx.createBufferSource();
			src.buffer = n.noiseBuf;
			const f = ctx.createBiquadFilter();
			f.type = 'bandpass';
			f.frequency.value = kind === 'clunk' ? 900 : 3200;
			f.Q.value = 1.2;
			const g = ctx.createGain();
			g.gain.setValueAtTime( kind === 'clunk' ? 0.5 : 0.35, t );
			g.gain.exponentialRampToValueAtTime( 0.001, t + ( kind === 'clunk' ? 0.09 : 0.035 ) );
			src.connect( f );
			f.connect( g );
			g.connect( n.cab );
			src.start( t, Math.random() );
			src.stop( t + 0.12 );

		} catch ( e ) { /* a missed click is fine */ }

	}

	// the impact: strength 0.3 (a rough landing's bang) .. 2 (a wreck)
	crunch( strength = 1, x = 0, y = 0, z = 0, water = true ) {

		this.state.crunches ++;
		const ctx = this.ctx, a = this.app && this.app.audio;
		if ( ! ctx || ( a && a._muted ) ) return;
		try {

			const t = ctx.currentTime, k = Math.max( 0.2, Math.min( 2, strength ) );
			const out = ctx.createGain();
			out.gain.value = Math.min( 1, 0.45 * k );
			const pan = ctx.createPanner();
			pan.panningModel = 'equalpower';
			pan.distanceModel = 'inverse';
			pan.refDistance = 14;
			pan.maxDistance = 3000;
			if ( pan.positionX ) { pan.positionX.value = x; pan.positionY.value = y; pan.positionZ.value = z; } else pan.setPosition( x, y, z );
			out.connect( pan );
			pan.connect( a.sfxAbove || a.master || ctx.destination );
			const len = Math.floor( ctx.sampleRate * 1.6 );
			const buf = ctx.createBuffer( 1, len, ctx.sampleRate );
			const d = buf.getChannelData( 0 );
			// crackle: noise with random hard spikes (rivets and spars letting go), decaying
			for ( let i = 0; i < len; i ++ ) {

				const e = Math.exp( - i / ( ctx.sampleRate * 0.35 ) );
				d[ i ] = ( Math.random() * 2 - 1 ) * e * ( Math.random() < 0.02 ? 3 : 1 );

			}

			const noise = ( type, f, q, g0, dur ) => {

				const src = ctx.createBufferSource();
				src.buffer = buf;
				const fl = ctx.createBiquadFilter();
				fl.type = type;
				fl.frequency.value = f;
				fl.Q.value = q;
				const g = ctx.createGain();
				g.gain.setValueAtTime( g0, t );
				g.gain.exponentialRampToValueAtTime( 0.001, t + dur );
				src.connect( fl );
				fl.connect( g );
				g.connect( out );
				src.start( t );
				src.stop( t + dur + 0.05 );

			};

			noise( 'lowpass', 700, 0.8, 1.0, 0.9 ); // the crunch
			noise( 'bandpass', 2200, 2.5, 0.35, 0.5 ); // metal tearing
			if ( water ) noise( 'highpass', 1800, 0.5, 0.4, 1.4 ); // the splash hiss
			// the thud: a falling sine
			const o = ctx.createOscillator();
			o.type = 'sine';
			o.frequency.setValueAtTime( 90, t );
			o.frequency.exponentialRampToValueAtTime( 32, t + 0.5 );
			const og = ctx.createGain();
			og.gain.setValueAtTime( 1.1, t );
			og.gain.exponentialRampToValueAtTime( 0.001, t + 0.6 );
			o.connect( og );
			og.connect( out );
			o.start( t );
			o.stop( t + 0.65 );

		} catch ( e ) { /* a missed crunch is fine */ }

	}

	update( dt, { running = false, rpm = 0, airspeed = 0, x = 0, y = 0, z = 0, inside = false, cranking = false, flaps = false, horn = false, engines = 1, failed = null } = {} ) {

		// the starter turns the engine over: a quieter, slower drone under the whine
		const on = running || cranking;
		this.level += ( ( running ? 1 : cranking ? 0.45 : 0 ) - this.level ) * ( 1 - Math.exp( - dt * ( on ? 2.5 : 1.2 ) ) );
		const a = this.app && this.app.audio;
		const muted = !! ( a && a._muted );
		const gain = muted ? 0 : this.level * ( inside ? 0.55 : 0.8 );
		this.state.rpm = rpm;
		this.state.airspeed = airspeed;
		this.state.gain = gain;
		this.state.horn = horn;
		this.state.flaps = flaps;
		this.state.cranking = cranking;
		const ctx = this.ctx;
		if ( ! ctx ) return;
		if ( ! this.nodes ) {

			if ( ! on && ! horn && ! flaps ) return;
			try { this._build( ctx ); } catch ( e ) { console.warn( 'seaplane: audio failed', e ); this.app = null; return; }

		}

		const n = this.nodes, t = ctx.currentTime, k = 0.08;
		// a nine-cylinder radial fires 4.5 times a revolution: idle ~600 rpm, full power ~2200
		// (on the starter: a slow chug of the cylinders coming round)
		const rev = running ? ( 600 + 1600 * rpm ) / 60 : Math.max( 1.5, rpm * 2200 * 2.5 / 60 );
		const f = rev * 4.5 / 2; // pitched down an octave: the drone sits better under the music
		n.fire.frequency.setTargetAtTime( f, t, k );
		n.sub.frequency.setTargetAtTime( f / 2, t, k );
		if ( n.fire2 ) {

			const two = engines > 1 && ! ( failed && failed[ 1 ] );
			n.fire2.frequency.setTargetAtTime( f * 1.013, t, k );
			n.sub2.frequency.setTargetAtTime( f / 2 * 1.013, t, k );
			n.fire2._g.gain.setTargetAtTime( two ? 0.5 : 0, t, 0.3 );
			n.sub2._g.gain.setTargetAtTime( two ? 0.28 : 0, t, 0.3 );
			n.fire._g.gain.setTargetAtTime( failed && failed[ 0 ] ? 0 : 0.5, t, 0.3 );

		}
		n.high.frequency.setTargetAtTime( f * 2.02, t, k );
		n.lp.frequency.setTargetAtTime( 260 + 2400 * Math.pow( rpm, 1.4 ) + ( inside ? 0 : 300 ), t, k );
		n.bp.frequency.setTargetAtTime( 380 + airspeed * 22 + rpm * 500, t, 0.2 );
		n.wash.gain.setTargetAtTime( Math.min( 0.9, rpm * 0.25 + airspeed / 55 * 0.5 ), t, 0.2 );
		n.out.gain.setTargetAtTime( gain, t, 0.1 );
		if ( n.cab ) {

			const cabin = muted ? 0 : inside ? 1 : 0.35;
			n.starter.g.gain.setTargetAtTime( cranking ? n.starter.peak * cabin : 0, t, 0.05 );
			n.starter.o.frequency.setTargetAtTime( cranking ? 150 + 110 * Math.min( 1, rpm / 0.06 ) : 120, t, 0.3 );
			n.flapMotor.g.gain.setTargetAtTime( flaps ? n.flapMotor.peak * cabin : 0, t, 0.04 );
			n.horn.g.gain.setTargetAtTime( horn ? n.horn.peak * cabin : 0, t, 0.03 );

		}

		const p = n.pan;
		if ( p.positionX ) {

			p.positionX.setTargetAtTime( x, t, 0.03 );
			p.positionY.setTargetAtTime( y, t, 0.03 );
			p.positionZ.setTargetAtTime( z, t, 0.03 );

		} else p.setPosition( x, y, z );

	}

	dispose() {

		const n = this.nodes;
		this.nodes = null;
		if ( ! n ) return;
		for ( const s of n.sources ) try { s.stop(); } catch ( e ) { /* already stopped */ }
		try { n.out.disconnect(); n.pan.disconnect(); } catch ( e ) { /* ignore */ }

	}

}
