# The Unreal game's fish in Hyptile Island

Source: `D:\fishing game\UpsideDownFishing\Data\Fish.csv` (also the naval fork's
`browser/src/data/economy-seed-v1.json`) and `Source/UpsideDownFishing/Fishing/FishingComponent.*`
(the marker-timing minigame). The Unreal fish are described in one line each and have no anatomy.
The models here are invented to match those lines.

| id (FishTable / FishSpecies) | Unreal StableId | Size cm | Unreal time | Hyptile `time` | Difficulty | Unreal rarity, weight | `rarity` | Habitat here | Look (FishSpecies / FishMaterial / Fish.js) |
|---|---|---|---|---|---|---|---|---|---|
| `silverminnow` | Fish.SilverMinnow | 8-18 | Dawn, Day, Dusk | `day` | 1 | Common, 50 | 0.35 | shallows, pier, bay | small slim schooling bait, big eyes, coin-flash mirror scales; schools in the bay shallows |
| `rootfin` | Fish.Rootfin | 15-28 | Dawn, Day, Dusk | `day` | 2 | Common, 34 | 0.24 | pier piles, shallows, reef | blunt bark-brown fish, ragged root-like fins (`pectoral.shape 'root'`, notch / ragged rays); hangs by the pier piles and coral heads |
| `lanterncarp` | Fish.LanternCarp | 22-42 | Dusk, Night | `nightOnly` | 3 | Uncommon, 18 | 0.13 | pier, shallows, bay | deep golden carp, big scales, barbels; warm emissive photophores, faint by day, bright at night |
| `upsidedowneel` | Fish.UpsideDownEel | 45-90 | Dusk, Night | `night` | 4 | Uncommon, 14 | 0.10 | pier, reef, bay | eel, no pelvic fins, inverted counter-shading; swims belly-up (`invert` in Fish.js BEHAVIOUR) |
| `glassperch` | Fish.GlassPerch | 18-32 | Dawn, Dusk | `dawnDusk` | 4 | Rare, 8 | 0.08 | shallows, bay | see-through perch: stochastic transparency (GLASS_MASK); rim, head, backbone, gut sac and eyes stay visible |
| `crookedcod` | Fish.CrookedCod | 38-70 | Day, Night | `any` | 5 | Rare, 6 | 0.06 | reef, pier | freckled cod with three dorsal fins and a chin barbel, body bent into a sideways S, jaw skewed, tail drooping (`crook`) |

## Balance

- Weights come from the size range through the length-weight relation `lw`, so `fishLengthCm` returns the
  Unreal sizes.
- `rarity` is SelectionWeight * 0.007, with a minimum of 0.06. The set takes about 25 % of bites in the shallows,
  13 % by the pier and under 7 % on the reef. It does not bite in deep water. `test/feature-fish-unreal.mjs` checks this.
- Prices put the typical value in the BaseValue order (12 / 18 / 36 / 42 / 48 / 65 in Unreal, roughly
  $1 / $6 / $14 / $16 / $17 / $30 here). The economy stays below the Tidewater offshore fish.

## Minigame

`minigame: 'marker'` selects `MarkerMinigame` (CatchMinigame.js), a port of `UFishingComponent`:

- The marker sweeps the bar at `0.9 + 0.15 d`.
- The target zone is `max(0.05, 0.22 - 0.02 d)` wide.
- Three good strikes land the fish (four at difficulty 5). Each hit relieves 0.12 strain and moves the zone to 0.68 / 0.32.
- A miss adds about 0.3 strain. There is a 0.45 s cooldown between strikes.
- Passive strain is 0.014/s and rises with the fish's pull against the line.
- The attempt lasts 25 s.

Hyptile additions:

- Three misses lose the fish, so the fight stays losable.
- Reel, line and rod soften the speed, the zone width and the strain.
- Difficulty 4+ fish shift the zone.
- The game's minutes per attempt and the cargo grid are left to the existing systems.
