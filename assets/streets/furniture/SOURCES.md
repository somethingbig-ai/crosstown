# streets / furniture: asset sources

All scanned props are from Poly Haven (https://polyhaven.com), licence CC0 1.0 (public domain, no attribution required).
Taken from `assets-scout/polyhaven/props/*.glb` (the scout's 1k packs) and cut down again here with
`npx @gltf-transform/cli@4 optimize --simplify true --simplify-ratio R --simplify-error E --texture-compress webp --texture-size S`
(no Draco, no meshopt; the game's stock GLTFLoader reads them).

| file | Poly Haven asset | URL | ratio / error / texture | used as |
|---|---|---|---|---|
| fire_hydrant.glb | Fire Hydrant | https://polyhaven.com/a/fire_hydrant | 0.4 / 0.004 / 512 | hydrants (aged variant, recoloured black and silver in the shader, widened) |
| metal_trash_can.glb | Metal Trash Can | https://polyhaven.com/a/metal_trash_can | 0.4 / 0.004 / 512 | kerbside cans (plain and rusted) |
| trashbag.glb | Trashbag | https://polyhaven.com/a/trashbag | 0.3 / 0.01 / 512 | bag piles at the kerb |
| cardboard_box_01.glb | Cardboard Box 01 | https://polyhaven.com/a/cardboard_box_01 | 0.25 / 0.01 / 512 | boxes by bag piles and vendor carts |
| concrete_road_barrier.glb | Concrete Road Barrier | https://polyhaven.com/a/concrete_road_barrier | 0.3 / 0.006 / 512 | jersey barriers at work sites |
| plastic_crate_02.glb | Plastic Crate 02 | https://polyhaven.com/a/plastic_crate_02 | 0.5 / 0.004 / 256 | crates |
| standing_chalkboard_01.glb | Standing Chalkboard 01 | https://polyhaven.com/a/standing_chalkboard_01 | 0.6 / 0.004 / 512 | sidewalk A-boards |
| outdoor_table_chair_set_01.glb | Outdoor Table Chair Set 01 | https://polyhaven.com/a/outdoor_table_chair_set_01 | 0.35 / 0.004 / 512 | kerbside cafe sets |
| utility_box_01.glb | Utility Box 01 | https://polyhaven.com/a/utility_box_01 | 0.4 / 0.004 / 512 | ground cabinets at signal corners |
| modular_street_seating.glb | Modular Street Seating | https://polyhaven.com/a/modular_street_seating | 0.3 / 0.004 / 256 | park benches (near band) |

Everything else in this part (signal poles and heads, street lights, signs, baskets, bikes, plaza furniture, fences, scaffolding,
carts, kiosks, shelters) is modelled in code in `game/src/streets/furniture.js`; all lettering, posters, stickers and sign faces are
drawn on a canvas there with invented generic wording (no real brands or logos).

## tex/ (photo-derived wear for the signal poles and heads, item 12)
- `tex/wear.jpg` (512 px; R = paint mask, G = roughness, B = tone variation) derived from ambientCG **PaintedMetal006** (colour and roughness maps), https://ambientcg.com/view?id=PaintedMetal006, CC0 1.0.
- `tex/rust.jpg` (256 px) from ambientCG **Rust007** colour map, https://ambientcg.com/view?id=Rust007, CC0 1.0.
- `tex/paint.jpg` (512 px colour, normalised so intact paint is 0.82) and `tex/painth.jpg` (512 px; R = height, G = roughness) from ambientCG **PaintedMetal012** (colour, displacement and roughness maps), https://ambientcg.com/view?id=PaintedMetal012, CC0 1.0. The painted steel of signal poles, mast arms, lamp posts and brackets (r16).

## hhead/ (the hero crossing's signal head, pedestrian head and pole shaft; item 12, r42 on)
- `hhead/hhead.bin`, `hhang.bin`, `hped.bin` (positions, normals, uv, indices): modelled in Blender 4.5 by script (`lanes/streets/items/signals/tools/bl/head.py`, `ped.py`, `lib.py`); no outside model.
- `hhead/hhead_*.webp`, `hped_*.webp`: baked in Blender Cycles from that model (occlusion, the fixed sun's light per world yaw, position / normal / part ids) and composed by `tools/bl/compose.py` (paint, dirt, wash streaks, dust, chips, gloss, relief): all computed; no photograph's pixels.
- `hhead/hpole_*.webp`: the pole shaft's paint, grime, tape and sticker remains, drawn by `tools/bl/compose_pole.py`; invented generic stickers, no real names or marks; no photograph's pixels.
- Looked at while modelling (no pixels, measurements or layouts taken; credits in `lanes/streets/items/signals/refs/build/SOURCES.md`): "Go (193314129).jpeg" by Gordon Zheng, CC BY 3.0; "Walk (3618379765).jpg" by Rob Young, CC BY 2.0; "Midtown East (38713869241).jpg" by Billie Grace Ward, CC BY 2.0; "Flatiron District td 43.jpg" by Tdorante10, CC BY-SA 4.0.
- Cast lettering on the back of the hero signal head (relief and a slight tone in `hhead/hhead_n.webp`, `hhead_c.webp`): the invented words "QUELLMARK" and "SIGNAL  12 IN" (no real maker's name is intended; not checked against a trade-mark register), rasterised by `tools/bl/compose.py` with **Liberation Sans Bold** (Liberation Fonts 2.x, copyright Red Hat and others, SIL Open Font License 1.1, https://github.com/liberationfonts/liberation-fonts). Only the rendered letter shapes are in the texture; the font file is not shipped with the game. Copy used: `lanes/streets/items/signals/tools/bl/fonts/LiberationSans-Bold.ttf` with its copyright file beside it.
- FROM ROUND 53 ON, PHOTOGRAPHS' PIXELS ARE IN THE HERO PIECES (this replaces "no photograph's pixels" above for the files named here). All are building references of the signals item (`lanes/streets/items/signals/refs/build/`, each CC0 or CC BY; none is a judging photo, none is in gauntlet/ref/index.json); cut by `lanes/streets/items/signals/tools/photo_src.py`, `ped_src.py`, `sign_src.py`:
  - `hhead/hhead_c.webp`, `hhead_n.webp`, `hped_c.webp`, `hped_n.webp` (the surface of thick brushed enamel: lumps, pits, sags, specks, laid on by position as a tone and a relief): two patches of the visors in **"Go (15596192519).jpg"** by Phil Dolby, CC BY 2.0, https://commons.wikimedia.org/wiki/File:Go_(15596192519).jpg
  - `hhead/led_r.webp`, `led_y.webp`, `led_g.webp` (a lit LED lens; amber and green are the red photograph recoloured): the red lens in **"Stop Light (2244738023).jpg"** by Ted Kerwin, CC BY 2.0, https://commons.wikimedia.org/wiki/File:Stop_Light_(2244738023).jpg
  - `hhead/pedlit_hand.webp`, `pedlit_walk.webp` (the lit hand and walking figure) and the unlit lens panel inside `hhead/hped_c.webp`: **"NYC Pedestrian crossing Stop.JPG"** and **"NYC Pedestrian crossing Go.JPG"** by Benoît Prieur, CC0 1.0, https://commons.wikimedia.org/wiki/File:NYC_Pedestrian_crossing_Stop.JPG , https://commons.wikimedia.org/wiki/File:NYC_Pedestrian_crossing_Go.JPG
  - `hhead/oneway_l.webp`, `oneway_r.webp` (a ONE WAY sign face, squared up, toned neutral; the right-pointing one is the same photograph turned over with its lettering put back): **"New York, United States (Unsplash pKeF6Tt3c08).jpg"** by Brendan Church, CC0 1.0, https://commons.wikimedia.org/wiki/File:New_York,_United_States_(Unsplash_pKeF6Tt3c08).jpg . The face carries the city transport department's small imprint as photographed (a public agency's name, not a trade mark).
  - `hhead/hpole_c.webp`, `hpole_n.webp`, `hpole_orm.webp` (the surface of a galvanised signal pole, laid on as tone, relief and gloss): **"Pedestrian walk signal device NY.jpg"** by SteveStrummer, CC0 1.0, https://commons.wikimedia.org/wiki/File:Pedestrian_walk_signal_device_NY.jpg
- From round 53 the cast lettering on the back of the hero head is a plain invented part number ("12S-4471"); the invented maker's name "QUELLMARK" is gone from every file.
