# streets/sidewalks: texture sources

All CC0 1.0. Poly Haven (https://polyhaven.com/license), fetched at 1k from `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/<slug>/<slug>_<map>_1k.jpg`
(asset pages `https://polyhaven.com/a/<slug>`); ambientCG (https://ambientcg.com, https://docs.ambientcg.com/license/) from the copies in `assets-scout/`.
Built by `prep_assets.py <dir with the Poly Haven JPGs> <assets-scout dir>` (PIL + numpy; light, bigbox is fine).

| file | size | what | from |
|---|---|---|---|
| `conc_d.jpg` | 0.96 MB | three real concretes as luminance ratios to their mean (0.5 = mean): R mottled trowelled slab, G float-finished slab with trowel arcs, B fine sandy concrete | Poly Haven `brushed_concrete_2`, `brushed_concrete`, `rough_concrete` (diff) |
| `conc_n1.jpg` | 0.34 MB | normal map of the mottled slab | Poly Haven `brushed_concrete_2` (nor_gl) |
| `conc_n2.jpg` | 0.53 MB | normal map of a broom finish | Poly Haven `brushed_concrete_03` (nor_gl) |
| `masks.jpg` | 1.3 MB | R chewing-gum scan (alpha), G cracks of a shattered slab (dark lines of the scan), B granite speckle (luminance ratio) | ambientCG `ChewingGum002`; Poly Haven `cracked_concrete` (diff); ambientCG `Granite005A` |
| `metal_d.jpg` | 0.45 MB | R rust, G smooth concrete, B diamond plate (luminance ratios) | ambientCG `Rust007`, `Concrete034`, `DiamondPlate008A` |
| `tactile_c.jpg`, `tactile_n.jpg` | 0.23 + 0.15 MB | scanned tactile warning paving: colour and normal map (copied as they are) | ambientCG `TactilePaving001` |
| `noise.png` | 0.74 MB | tileable noise made by the script (no source) | - |

Nothing else is loaded: the layout (frames, frontages, flags, joints), the kerb stones and the gutter strip are made at load time from city.json.
| `conc2a.jpg` | 2.7 MB | (round 23) three more real concretes, 2048 px, one whole scan per pour: R scuffed cement, G blotchy floated slab, B plain worn floor (luminance ratios, 0.5 = mean) | Poly Haven `scuffed_cement`, `garage_floor`, `concrete_floor_worn_001` (diff, 2k), CC0 |
| `conc2b.jpg` | 4.4 MB | (round 23) R concrete with its stone showing, G fine-stone concrete, B stained and streaked slab | Poly Haven `concrete_floor_01`, `gravel_concrete_04`, `dirty_concrete` (diff, 2k), CC0 |

`conc2a.jpg` / `conc2b.jpg` are built by `prep_assets2.py <dir with <slug>_diff.jpg at 2k>` (fetched from `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/<slug>/<slug>_diff_2k.jpg`).
| `gum.png` | 0.14 MB | (round 37) 64 single chewing-gum spots cut from the two scanned gum decals, 64 px each: R (= B) distance field of each spot's own outline, G the scan's folds and tread print inside it. Built by `prep_assets3.py <assets-scout dir> gum.png` | ambientCG `ChewingGum001`, `ChewingGum002` (https://ambientcg.com/view?id=ChewingGum001, ...002), CC0 |
| `leaves.webp` | see `ls` | (round 38) 16 single scanned leaves, 128 px each, RGBA: eight maple leaves, five narrow leaves, three toothed leaves; browned and curled in the shader as fallen leaves on the walk and in the gutter. Built by `prep_assets4.py <dir of the unpacked sets> leaves.png`, then saved as webp | ambientCG `LeafSet021`, `LeafSet013`, `LeafSet020` (https://ambientcg.com/view?id=LeafSet021, ...013, ...020; 1K-JPG), CC0 |
