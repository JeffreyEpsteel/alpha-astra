// Wave 18A: the sky stays finite at every sun angle (-5 .. 90 deg): the atmosphere LUTs, its CPU readbacks (sun
// transmittance, sky irradiance, horizon colour) and the sky background as the main view draws it (HDR, half float),
// looking at the sun, the horizon under it, the zenith, the antisolar horizon and below the horizon.
//   node test/visuals-sky.mjs
import { GPU, G, E, setFrameCamera, readTexture, wait } from './sky-harness.mjs';
import { Atmosphere } from '../src/sky/Atmosphere.js';
import { Sky } from '../src/sky/Sky.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SceneRenderer } from '../src/engine/render/SceneRenderer.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// IEEE half -> float
const half = ( h ) => {

	const s = h & 0x8000 ? - 1 : 1, e = ( h >> 10 ) & 31, m = h & 1023;
	if ( e === 0 ) return s * m * 2 ** - 24;
	if ( e === 31 ) return m ? NaN : s * Infinity;
	return s * ( 1 + m / 1024 ) * 2 ** ( e - 15 );

};

await GPU.init( { headless: true } );
const W = 160, H = 90;
const atmosphere = new Atmosphere();
const sky = new Sky( atmosphere );
const scene = new E.Scene();
const camera = new E.PerspectiveCamera( 70, W / H, 0.1, 60000 );
const sr = new SceneRenderer( new MeshRenderer(), scene, camera );
sr.setSize( W, H );
sr.background = sky.background;

const looks = [ [ 'sun', 0, 0 ], [ 'horizon', 0, null ], [ 'zenith', 0, 1.5 ], [ 'antisolar', Math.PI, 0.05 ], [ 'below', 0.6, - 0.4 ] ];
for ( const deg of [ - 5, - 3, - 1, 0, 0.5, 2, 5, 10, 20, 35, 50, 70, 89.9 ] ) {

	const e = deg * Math.PI / 180;
	const dir = new E.Vector3( Math.cos( e ) * 0.8, Math.sin( e ), - Math.cos( e ) * 0.6 ).normalize();
	atmosphere.sunDir.value.copy( dir );
	const night = E.MathUtils.smoothstep( - dir.y, 0.02, 0.18 );
	G.night.value = night;
	sky.starIntensity.value = night;
	sky.moonDir.value.set( - dir.x, Math.abs( dir.y ) * 0.8 + 0.25, - dir.z ).normalize();
	G.sunDir.value.copy( dir.y > - 0.07 ? dir : sky.moonDir.value );
	atmosphere.invalidate();
	let bad = 0, worst = '', peak = 0;
	for ( const [ name, yaw, pitch ] of looks ) {

		const az = Math.atan2( dir.z, dir.x ) + yaw;
		const p = pitch === null ? 0 : pitch === 0 ? e : pitch;
		camera.position.set( 0, 2, 0 );
		camera.lookAt( Math.cos( az ) * Math.cos( p ), 2 + Math.sin( p ), Math.sin( az ) * Math.cos( p ) );
		camera.updateMatrixWorld();
		for ( let f = 0; f < 2; f ++ ) {

			GPU.beginFrame();
			atmosphere.update( 1 / 60, camera.position.y );
			setFrameCamera( camera, W, H );
			sr.render();
			GPU.submit();
			await wait( 10 );

		}

		const img = await readTexture( sr.sceneRT.texture );
		const u16 = new Uint16Array( img.data );
		let n = 0;
		for ( let i = 0; i < u16.length; i += 4 ) for ( let c = 0; c < 3; c ++ ) { const v = half( u16[ i + c ] ); if ( ! Number.isFinite( v ) ) n ++; else if ( v > peak ) peak = v; }
		if ( n ) { bad += n; worst = name; }

	}

	const rb = [ ...( atmosphere.sunTransmittance || [ 0 ] ), ...( atmosphere.skyIrradiance || [ 0 ] ), ...( atmosphere.horizon || [ 0 ] ) ];
	ok( bad === 0, `sun ${ deg } deg: sky background finite in ${ looks.length } views${ bad ? ` (${ bad } bad channels, ${ worst })` : '' }` );
	ok( rb.every( Number.isFinite ), `sun ${ deg } deg: atmosphere readbacks finite` );
	ok( peak > 0, `sun ${ deg } deg: the sky was drawn (peak ${ peak.toPrecision( 3 ) })` );

}

await wait( 100 );
console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
