// Wave 18F: the soft shadow level and the golden hour rim ride in the SunShadow uniform block. The block layout stays
// 16-byte aligned (a WGSL struct that is not fails at pipeline creation), the filter level follows the quality tier's
// refit periods until setSoft() pins it, phones never get the soft level on their own.
//   node test/visuals-shadows.mjs
import { GPU } from './sky-harness.mjs';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { ShadowUniforms } from '../src/engine/render/wgsl/lighting.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

await GPU.init( { headless: true } );
const f = ShadowUniforms.fields;
ok( f.soft && f.rim && f.pad0 && f.pad1 && f.pad2, 'the block has soft, rim and the three pads' );
ok( ShadowUniforms.byteLength % 16 === 0, 'block size is a multiple of 16 bytes (' + ShadowUniforms.byteLength + ')' );
ok( ShadowUniforms.layout.blend.offset % 16 === 0, 'the vec4 array after the pads starts on a 16 byte boundary' );

delete globalThis.__phoneBudget;
const s = new SunShadows( { size: 256 } );
ok( s.soft === 1, 'default periods [1,2,4] (Medium and up): soft level on' );
s.periods = [ 1, 4, 8 ];
ok( s.soft === 0, 'Low periods [1,4,8]: the old filters' );
s.periods = [ 1, 2, 4 ];
ok( s.soft === 1, 'back to Medium: soft again' );
s.setSoft( 0 );
s.periods = [ 1, 2, 4 ];
ok( s.soft === 0, 'setSoft(0) pins the level against a refit' );
s.setSoft( null );
ok( s.soft === 1, 'setSoft(null) follows the tier again' );
globalThis.__phoneBudget = { textureMax: 1024 };
s.periods = [ 1, 2, 4 ];
ok( s.soft === 0, 'phones never follow into soft' );
delete globalThis.__phoneBudget;
s.rim = 0.3;
ok( Math.abs( s.rim - 0.3 ) < 1e-6, 'rim strength is writable' );

console.log( fails ? fails + ' FAILED' : 'all passed' );
process.exit( fails ? 1 : 0 );
