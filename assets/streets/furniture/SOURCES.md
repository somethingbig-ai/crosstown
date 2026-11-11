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
