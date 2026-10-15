# Credits

Hyptile Island is the project owner's game, converted from the owner's Unreal project **Upside-Down Fishing** and its
naval fork, with a lot of AI help and the open-source projects listed here. It started from **Tidewater**
(github.com/dgreenheck/tidewater, MIT, Copyright (c) 2026 DRG Software Solutions LLC), whose engine still draws the
game; most of what runs on top of it is new. The code is released under the MIT license in `LICENSE`. The
third-party software and assets below keep their own licences; licence texts that must travel with the game are at
the end of this file. Every entry was checked against the files in this repository (`package.json`,
`node_modules/*/LICENSE`, the per-folder credit files). Where an author is not known it says "unknown - to confirm".

## Made with

| Tool | Used for |
|---|---|
| Claude Code (Anthropic: Fable, Opus and Sonnet agents) | root integration and most of the browser code, the briefs in `docs/briefs/` |
| OpenAI Codex / ChatGPT (GPT-6.1 workers), OpenCode (free catalog models MiMo and Space Bunny) | the Unreal game and naval-fork phases, bounded worker tasks |
| JEV game-dev assistance (OpenRouter) | routing and triage during the Unreal work |
| Unreal Engine 5.8 | the original game *Upside-Down Fishing* and its naval fork |
| Blender 5.2 | models, rigs, retargeting (`tools/roster`, `tools/roid`, `tools/modules`, `tools/seaplane`) |
| ComfyUI (TRELLIS.2, Pixal3D) | the character, prop and key-art generations |
| ElevenLabs text-to-sound | sound effects and Captain Roid's clicks |

## Hyptile Island

| What | Author | Licence / terms |
|---|---|---|
| Hyptile Island art: the eight playable characters (JadeFisher v03 rig), their portraits, the main-menu key art (`public/ui/menu`, from the Unreal game's `T_HyptileMenu`) and the loader key art (`public/ui/keyart`) | Hyptile Island art: **[owner name - to fill in]** (made in the owner's local ComfyUI: TRELLIS.2 generations, rigged and posed in Blender) | the owner's own work |
| Design source: the Unreal game **Upside-Down Fishing** (UE 5.8) and its naval fork `Fishing_Naval_20261007` | the project owner | the owner's own project |
| Captain Roid: model (ComfyUI TRELLIS.2 / Pixal3D branches on the JadeFisher rig, `public/models/npc/captain-roid.glb`) and his clicking voice (`public/audio/captain_roid_clicks.ogg`, an ElevenLabs text-to-sound v2 generation; receipt `Assets/CaptainRoid/audio/provider.json` in the naval fork) | the project owner | the owner's own work, generated under the owner's ElevenLabs account |
| Fleet hulls (`public/models/fleet`), ship classes (`public/models/ships`), ship modules (`public/models/modules`), marine life (`public/models/marine`), harbour props (`public/models/harbour`) | the project owner (naval fork `Assets/*`, converted by `tools/roster`, `tools/modules`, `tools/dressing`) | the owner's own work |
| Seaplane (`public/models/seaplane`) | procedural, `tools/seaplane/build_seaplane.py` | this repository's MIT license |
| Animation: the authored clips (fishing, swims, helm, rowing, seated, fall, prank, jump) | the project owner (`JadeFisher_Comfy/animations`, `Assets/Hyptile*`, `Assets/FishingFleet`) | the owner's own work |
| Melee, cannon, impact and dynamic sounds (`public/audio/combat`, `public/audio/naval`, `public/audio/sfx`) | the project owner (ElevenLabs text-to-sound generations in the naval fork, receipts there; details in each folder's `CREDITS.txt`) | the owner's own work; `thwack`, `thud`, `splinter`, `sail_luff` are synthesised and need no credit |
| Action sounds of wave 20 (weapons, navy, storms, interiors, crew, towns; `src/features/sfx/Voices.js`) | synthesised at runtime with Web Audio, no recordings | this repository's MIT license |
| Navy frigate and revenue cutter (`public/models/navy`) | procedural, `tools/navy/build_navy_ships.py` (reusing the brigantine's textures) | this repository's MIT license |
| Meridian: the city kit, the twin towers and the facades (`public/models/meridian`) | procedural, `tools/meridian` | this repository's MIT license |
| Combat motions in the roster GLBs (sword slashes and thrust, axe chop, club swing, harpoon throw, bomb throw, dodge roll, taunt) | generated with NVIDIA Kimodo (Kimodo-SOMA-RP) through the local ComfyUI pipeline, `tools/roster/kimodo-combat` | the project's own generations |
| Cars (`public/models/cars`) | procedural, `tools/cars/build_cars.py` | this repository's MIT license |
| Interiors kit (`public/models/interiors`) | procedural, `tools/interiors/kit.py` (Poly Haven CC0 plank scans already credited below) | this repository's MIT license |
| Character names Ethena Prosper (chandlery) and PoorGoat (fish stand) | the project owner | - |

### Microsoft Rocketbox motion capture

Thirty-three clips on every playable character are retargeted from the
[Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox)
(`Assets/Animations/all_animations_max_motextr_<set>`; list in `tools/roster/rocketbox/clips.json`):
Idle_Breathe (m_idle_breathe_01), Walk_InPlace (m_walk_neutral_01), Run_InPlace (m_run_neutral_01), Wave (m_wave_01),
Friendly_Wave (m_wave_02), Talk (m_gestic_talk_neutral_01), Chat_Gesture (m_gestic_talk_relaxed_01), Look_Around
(m_idle_look_around_01), Cheer_Clap (m_cheer_01), Dance (m_dancing_silly), Laugh (m_gestic_laugh_loud), Shrug
(m_gestic_shrug_01), Point (m_gestic_presentation_right_01), Beckon (m_invite_sit), Swagger_Idle (m_idle_neutral_03).
Wave 18 added the way-of-life set: Sit_Chair (m_sit_down_chair_01), Sit_Chair_Idle (m_sit_chair_idle_neutral_01), Stand_From_Chair (m_sit_stand_up_chair_01), Sit_Down (m_sit_down_chair_01), Stand_Up (m_sit_stand_up_chair_01), Drink (m_drink_drinking), Eat (m_idle_touch_face_01), Crouch (m_crouch_idle), Kneel_Work (m_crouch_gestic), Talk_Group (m_gestic_talk_excited_01), Clap (m_claphands_01), Point_Out (m_gestic_presentation_left_01), Fish_Net (m_work_mid), Drunk_Walk (m_walk_drunk), Walk_Tired (m_walk_bruised), Turn_Left (m_turn_left_90), Turn_Right (m_turn_right_90), Dance_2 (m_dancing_cool).
The vendors' avatars (`public/models/characters`) are Rocketbox too (see the Tidewater section). Licence: **MIT License,
Copyright (c) 2020 Microsoft** (the full text ships as `tools/roster/rocketbox/LICENSE.md` and
`public/models/characters/LICENSE-Rocketbox.md`, and is reproduced below).

## Third-party software

| Package | Version | Copyright | Licence | In the game? |
|---|---|---|---|---|
| [@dimforge/rapier3d-compat](https://github.com/dimforge/rapier) | 0.21.0 | Copyright 2020 Dimforge EURL | Apache-2.0 (no NOTICE file in the package) | yes: destruction physics (`src/physics/rapier`) |
| [@colyseus/sdk](https://github.com/colyseus/colyseus.js) | 0.18.5 | Copyright (c) 2015-2026 Endel Dreyer | MIT | yes: multiplayer client |
| [@colyseus/schema](https://github.com/colyseus/schema) | 5.0.39 | Copyright (c) 2018 Endel Dreyer | MIT | yes: client and server state |
| [colyseus](https://github.com/colyseus/colyseus) | 0.18.9 | Copyright (c) 2015-2026 Endel Dreyer | MIT | the multiplayer server (`server/`) |
| [ws](https://github.com/websockets/ws) | 8.22.0 | Copyright (c) 2011 Einar Otto Stangvik; (c) 2013 Arnout Kazemier and contributors; (c) 2016 Luigi Pinca and contributors | MIT | the relay server |
| [three.js](https://github.com/mrdoob/three.js) | 0.186.1 | Copyright (c) 2010-2026 three.js authors | MIT | installed but not imported by the game (it runs on its own engine); the SMAA lookup textures and the SMAA / FXAA ports come from three.js (Tidewater section) |
| [three-avbd](https://github.com/sbobyn/three-avbd) | 0.3.0 | Copyright (c) 2026 Steven Bobyn (its notices credit Chris Giles' avbd-demo2d / avbd-demo3d, MIT) | MIT | **evaluated, not shipped**: read and rejected in favour of Rapier (`src/physics/README.md`) |
| [Vite](https://github.com/vitejs/vite) | 8.3.0 | Copyright (c) 2019-present, VoidZero Inc. and Vite contributors | MIT | build tool (its small runtime helpers end up in the bundle) |
| [webgpu](https://github.com/dawn-gpu/node-webgpu) (Dawn for Node) | 0.6.1 | Copyright 2017-2025 The Dawn & Tint Authors | package MIT; Dawn BSD-3-Clause | headless tests only, not shipped |
| [Colyseus agent skill](https://github.com/colyseus/skill) (`.claude/skills/colyseus`) | - | Copyright (c) 2026 Endel Dreyer | MIT | development tooling only |

## Fonts

Loaded from Google Fonts at runtime (not in this repository), all SIL Open Font License 1.1:
[Inter](https://rsms.me/inter/) (Rasmus Andersson), [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (JetBrains),
[Caveat Brush](https://fonts.google.com/specimen/Caveat+Brush) (Impallari Type) and
[Kalam](https://fonts.google.com/specimen/Kalam) (Indian Type Foundry).

The stall signs (`public/models/props/signs.png`) are lettered with Permanent Marker (Font Diner, Apache-2.0),
Cabin Sketch (Copyright 2011 The Cabin Project Authors, OFL 1.1) and Oswald (Copyright 2016 The Oswald Project
Authors, OFL 1.1); the font files and their licences are in `tools/props/fonts/` and only the rendered image ships.

---

# Tidewater

Everything in this section is carried over from Tidewater's `CREDITS.md` (with the stall keepers' new names).

The code in this repository is released under the MIT license (see `LICENSE`). The third-party
assets below keep their own licences.

## Audio: `public/audio/`

42 field recordings from [Freesound](https://freesound.org), all released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). No attribution is required, but every file is
credited with its author and source link in [`public/audio/CREDITS.md`](public/audio/CREDITS.md).

Recordists: YevgVerh, straget, Alex_hears_things, chris_dagorne, bruno.auzet, felix.blume, hdfreema,
richardemoore, KaleidacousticsAudio, AugustSandberg, kyles, Pfannkuchn, 200221-WeanBekker, florianreichelt,
Nox_Sound, ryansitz, SilentStrikeZ, SecureSubset, tbsounddesigns, qubodup, blaukreuz, wormer2, roboroo,
squashy555, Soojay, coalcon, dubminister, nathankwright, SorenF109, LaScienceMusicale, KEVOY, mikewest,
tosha73, paulprit, Mrthenoronha, mwchristian95, MrFossy, BranndyBottle, JoelMcDaniel, khenshom, ramattahatta,
RatBird and Anthousai.

## Scanned beach debris: `public/models/debris/`

Photogrammetry models from [Poly Haven](https://polyhaven.com), under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/):

- Dead Quiver Trunk
- Dead Quiver Branch 01
- Dead Quiver Branch 02
- Lambis Shell

The meshes were decimated into levels of detail, and the textures are unchanged. Details are in
[`public/models/debris/CREDITS.md`](public/models/debris/CREDITS.md).

## Vendor stalls: `public/models/props/`

PoorGoat's fish stand and Ethena Prosper's chandlery are built from [Poly Haven](https://polyhaven.com) textures and
models under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/):

- Textures: Weathered Brown Planks, Weathered Planks, Worn Corrugated Iron, Weathered Peeling Timber
- Models: Wooden Crate 01 and 02, Wooden Bucket 01, Fish Knife, Wooden Cutting Board, Lifebuoy, Wooden
  Lantern 01, Fisherman's Hat, Wooden Table 03, Metal Jerrycan (green), Plastic Jerrycan, Life Jacket, Metal
  Toolbox, Wooden Display Shelves 01

The models were decimated and the textures downsized by `tools/props/`. The signs, the chalkboard and the
scale dial were lettered with [Permanent Marker](https://fonts.google.com/specimen/Permanent+Marker) (Apache
2.0), [Cabin Sketch](https://fonts.google.com/specimen/Cabin+Sketch) (SIL OFL 1.1) and
[Oswald](https://fonts.google.com/specimen/Oswald) (SIL OFL 1.1); the font files and their licences are in
`tools/props/fonts/`. Details are in [`public/models/props/CREDITS.md`](public/models/props/CREDITS.md).

## Humpback whale: `public/models/whale/`

This is an original procedural model, generated by our own scripts. Its proportions follow
published humpback anatomy, and its side profile was traced from a NOAA Fisheries illustration, a
US government work in the public domain. The reference photographs used while modelling are not included.

## Characters: `public/models/characters/`

The vendors PoorGoat and Ethena Prosper (`joe.glb`, `marta.glb`) are avatars `Wood_Male_01` and `Female_Adult_04` and their
idle, talk, wave and shrug animations from the [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox)
(© Microsoft Corporation, MIT license, included as `LICENSE-Rocketbox.md`), converted with
`tools/characters/` (textures resized, animations retargeted and baked). Paper: M. Gonzalez-Franco
et al., "The Rocketbox Library and the Utility of Freely Available Rigged Avatars", Frontiers in
Virtual Reality, 2020.

## Fonts

[Inter](https://rsms.me/inter/) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/) are both under the
SIL Open Font License 1.1. They are loaded from Google Fonts at runtime and are not part of this repository.

## Libraries

The SMAA area and search lookup textures (`public/textures/smaa/`) are from three.js (MIT), which ships
them from J. Jimenez et al.'s SMAA reference implementation (MIT).

[Vite](https://vite.dev) (MIT) is an npm dependency and is not vendored here.

## Techniques and references

These are published techniques. No code from the papers is included.

| Technique | Source |
|---|---|
| FFT ocean spectra | J. Tessendorf, *Simulating Ocean Water* |
| Atmosphere | S. Hillaire, *A Scalable and Production Ready Sky and Atmosphere Rendering Technique* (2020) |
| Volumetric cloud modelling | A. Schneider (Guerrilla Games), the *Nubis* talks |
| Motion blur | M. McGuire et al., *A Reconstruction Filter for Plausible Motion Blur* (2012); J. Jimenez, *Next Generation Post Processing in Call of Duty: Advanced Warfare* (2014) |
| Bloom | J. Jimenez (2014) |
| Sharpening (RCAS) | AMD FidelityFX Super Resolution 1 |
| SMAA / FXAA | J. Jimenez et al., *SMAA: Enhanced Subpixel Morphological Antialiasing* (2012); T. Lottes, *FXAA* (2009); ported from three.js' SMAANode / FXAANode (MIT) |
| Rasterized caustics | Evan Wallace's *WebGL Water* approach |
| Breaking waves | Guerrilla Games, *Horizon Forbidden West* water (SIGGRAPH 2022) |

The cloud noise, lighting and sampling scheme (`src/sky/Clouds.js`) is adapted from DRG Software Solutions'
own *Sky Pro WebGPU*. It is published here under this repository's MIT license by its copyright holder.

`public/clouds/LICENSING.md` comes with Tidewater's cloud code (from *Sky Pro WebGPU*). Of the textures it lists
(ambientCG and Poly Haven terrain, CC0; the NASA/Goddard SVS Tycho star map, public domain; an AI-generated cirrus
texture), none ships in this build: `public/clouds` holds only the two noise tables `baseShape64.bin` and
`blueNoise.bin`, and `public/textures` only the SMAA lookups.

---

# Licence texts

## MIT License

Applies, each with its own copyright line, to: Tidewater (Copyright (c) 2026 DRG Software Solutions LLC), Microsoft
Rocketbox (Copyright (c) 2020 Microsoft), three.js (Copyright (c) 2010-2026 three.js authors), @colyseus/sdk and
colyseus (Copyright (c) 2015-2026 Endel Dreyer), @colyseus/schema (Copyright (c) 2018 Endel Dreyer), the Colyseus
agent skill (Copyright (c) 2026 Endel Dreyer), ws (Copyright (c) 2011 Einar Otto Stangvik, Copyright (c) 2013 Arnout
Kazemier and contributors, Copyright (c) 2016 Luigi Pinca and contributors), Vite (Copyright (c) 2019-present,
VoidZero Inc. and Vite contributors) and three-avbd (Copyright (c) 2026 Steven Bobyn).

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Apache License 2.0: Rapier (`@dimforge/rapier3d-compat`)

Copyright 2020 Dimforge EURL. Licensed under the Apache License, Version 2.0; the package carries no NOTICE file.
The full licence text as shipped in `node_modules/@dimforge/rapier3d-compat/LICENSE`:

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright 2020 Dimforge EURL

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```
