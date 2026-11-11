# streets/ground: texture sources

All from ambientCG (https://ambientcg.com, CC0 1.0, https://docs.ambientcg.com/license/) and Poly Haven (https://polyhaven.com, CC0 1.0,
https://polyhaven.com/license), taken from the copies in `assets-scout/` (1k), cut down by `prep_assets.py` (run with the repo's
`.venv/bin/python prep_assets.py <preview.jpg>`; light, bigbox is fine). Asset pages: `https://ambientcg.com/a/<id>`, `https://polyhaven.com/a/<slug>`.

| file | size | what | from |
|---|---|---|---|
| `pack1.jpg` | 0.7 MB | three grey detail maps, mean 0.5: R asphalt aggregate, G smooth concrete, B granite speckle | ambientCG Asphalt031, Concrete034, Granite002A |
| `pack2.jpg` | 0.4 MB | R block-crack mask, G chewing-gum mask, B coarse worn-asphalt detail | ambientCG Asphalt012 (alpha), ChewingGum002 (alpha); Poly Haven worn_asphalt |
| `decals.webp` | 0.3 MB | 4x4 atlas, RGBA: four manhole covers, a double utility cover, a kerb drain inlet, a small area drain, tactile paving, diamond plate, leaves, cardboard, a dirt clump; the vault grating and the ragged patch cell are drawn by the script | ambientCG ManholeCover001/003/005/006/007, Grate001, Grate002, TactilePaving002, DiamondPlate008A, ScatteredLeaves004, CardboardSet001, AsphaltDamageSet002 |

Made at load time, no file: the field textures (distance to kerb / wall / junction, rendered from city.json) and the markings atlas (arrows, ONLY, BUS; canvas).
| `asph_col.jpg` | 1.8 MB | road item: photo asphalt albedo (coarse exposed aggregate), 2048 px laid at 2.2 m, low frequencies flattened (`prep_asph.py`) | ambientCG Asphalt032 (photogrammetry), https://ambientcg.com/a/Asphalt032, CC0 1.0 (r2-r6 used Asphalt023L, https://ambientcg.com/a/Asphalt023L, CC0) |
| `asph_nrm.jpg` | 0.8 MB | road item: the same scan's OpenGL normal (R,G) and roughness (B), 1024 px | ambientCG Asphalt032, CC0 1.0 |
| `paint.webp` | 0.2 MB | road item: a real painted line with its ragged edges, cracks and grime, cut to 256 x 2048 RGBA (`prep_paint.py`); laid along every white bar | ambientCG RoadLines003, https://ambientcg.com/a/RoadLines003, CC0 1.0 |
| (removed Nov 10 13:xx) `hero_w23.webp` | - | r15-r17 only: the w23rd judging photo's own road projected onto the road. Ruled out by the lead (judging photos are never sources); file and scripts kept only under items/road/dropped/, not in the game | - |
| `decals.webp` cells 0 and 1 of row 0 | - | road item, r18: two real New York covers photographed from straight above (`prep_covers.py`), replacing two scanned European ones; the utility's name in the middle of the first is smoothed away (no real company names) | "Con Edison manhole cover.jpg" and "DPW Manhattan manhole cover.jpg" by Paul Lowry, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0), https://commons.wikimedia.org/wiki/File:Con_Edison_manhole_cover.jpg , https://commons.wikimedia.org/wiki/File:DPW_Manhattan_manhole_cover.jpg ; cropped, levelled, masked. Neither is in gauntlet/ref/index.json. CREDIT NEEDED in the game's credits. |
| (NOT in the game: tried in r18, read worse, strip kept in items/road/dropped/paint.stuyvesant.webp) `paint.webp` from a photo | 0.2 MB | road item: one worn, cracked and chipped crosswalk bar from a street photograph, rectified, shadows taken out, laid there and back as a 256 x 2048 RGBA strip (`prep_paint2.py`); laid along every white bar and line | "Stuyvesant Street 20230412 174845.jpg" by CaptJayRuffins, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0), https://commons.wikimedia.org/wiki/File:Stuyvesant_Street_20230412_174845.jpg ; cropped, rectified, de-lit. Not in gauntlet/ref/index.json. CREDIT NEEDED in the game's credits. |
| `asph_macro4k.jpg` | 4.6 MB | road item, r23: a 15 m x 15 m aerial scan of worn asphalt (its own cracks, stains, tyre arcs, a paving joint) at 3.7 mm a pixel, grey, 4096 px (`prep_macro.py`); loaded as a one-channel texture and laid at 15 m, two places blended by a slow noise, as the road's centimetre-to-metre layer under the lane-scale rules and over the close scan's stone. (r18 used a 1024 px softened copy at 30 m, `asph_macro.jpg`: removed) | Poly Haven aerial_asphalt_01 (Rob Tuytel), https://polyhaven.com/a/aerial_asphalt_01, CC0 1.0 |

## Credit lines the game's credits must carry (CC BY: attribution is a licence condition)
Checked against Commons on Nov 10 (author and licence as its file pages give them; originals on Flickr, user paul_lowry):
- Manhole cover textures (`decals.webp`, cells 0 and 1): "Con Edison manhole cover" and "DPW Manhattan manhole cover" by Paul Lowry, CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0), via Wikimedia Commons
  (https://commons.wikimedia.org/wiki/File:Con_Edison_manhole_cover.jpg , https://commons.wikimedia.org/wiki/File:DPW_Manhattan_manhole_cover.jpg ;
  source https://www.flickr.com/photos/paul_lowry/55275930970/ , https://www.flickr.com/photos/paul_lowry/55275763944/ ).
  Changes made: cropped to the cover, levelled, masked to a circle, the utility's name in the centre of the first smoothed out, packed into an atlas.
Everything else in this folder is CC0 (ambientCG, Poly Haven): no credit required, listed above.
| `street76.webp` | 0.6 MB | road item, r27-r28 (used only behind `?gnext=1` so far): a real New York side street as road texture: the lower part of a street photograph in its own pixel grid, masked to the road it shows (`prep_street76.py`, which also records how the camera was read off the picture); ground_next.js maps W 22nd St at 5th Ave through that camera | "76th w Street (Manhattan) May 2023.jpg", Wikimedia Commons, CC0 1.0, https://commons.wikimedia.org/wiki/File:76th_w_Street_(Manhattan)_May_2023.jpg ; not in gauntlet/ref/index.json; never used as a judging photo. No credit required. |

## Photographed road (road item, r29 on): `photo/`
Made by `items/road/photolay.py` from a spec in `items/road/photos/<name>.json` (camera read off the picture, outline, what is painted out); `photo/photos.json` is the
list the module reads. None of these photographs is a judging photo (`gauntlet/ref/index.json`; the tool refuses one that is), and a view is never judged against its own source.
| file | size | what | from |
|---|---|---|---|
| `photo/street76.webp` | 0.8 MB | W 22nd St at 5th Ave: asphalt, crosswalk bars, cover and patches of a real side street (replaces `street76.webp`, which only the dropped r28 module read) | "76th w Street (Manhattan) May 2023.jpg", Wikimedia Commons, CC0 1.0, https://commons.wikimedia.org/wiki/File:76th_w_Street_(Manhattan)_May_2023.jpg (kept in `items/road/src/`). Changes: cropped to the road, slow light gradient levelled, the cover's rim dulled, sharpened a little, masked with a soft edge |
| `photo/soho.webp` | 0.3 MB | Broadway's crosswalk on the north side of 23rd St: bars, asphalt, a cover and two lane lines of a real sunlit crossing | **"Soho Crosswalk (23652301818).jpg" by Billie Grace Ward, CC BY 2.0** (https://creativecommons.org/licenses/by/2.0), https://commons.wikimedia.org/wiki/File:Soho_Crosswalk_(23652301818).jpg , source https://www.flickr.com/photos/wwward0/23652301818/ (the 3840 px rendition, kept in `items/road/src/`). Changes: cropped to the road, a lamp-post shadow painted out from the road beside it, slow light gradient levelled, masked with a soft edge. CREDIT REQUIRED in the game's credits: "Soho Crosswalk" by Billie Grace Ward (CC BY 2.0), modified |
