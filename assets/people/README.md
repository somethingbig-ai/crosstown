# people/export: the game's people (player + four pedestrians, real mocap)

`people.glb` is a drop-in for the people part of `game/assets/models.glb`: same conventions, so `models.js` needs only the loader change below.

## What is in the file
- glTF 2.0 binary, Y up, metres. Each character faces +X, origin at the feet.
- Five top-level armature nodes: `player`, `ped_a`, `ped_b`, `ped_c`, `ped_d`, each with one skinned mesh `<name>_mesh` (about 19k triangles, 52 bones named `<name>_<bone>`: hips, spine, chest, chest2, neck, head, clavicle/upper_arm/forearm/hand, thigh/shin/foot/toe `_L`/`_R`, fingers).
- Materials per character: `skin_`, `eyes_`, `hair_`, `brows_`, `lashes_`, `top_`, `pants_`, `shoes_<name>` (hair, brows and lashes are alpha-tested cards: set `alphaTest` about 0.35 and `DoubleSide`, as you do for leaves).
- Bodies are MakeHuman (MPFB2, CC0 assets); nobody is modelled on a real person or on any game's character.

## Animations (every one is real motion capture, CMU Graphics Lab database)
Each clip holds every character's tracks, named `<name>_<bone>`, exactly like the old Idle/Walk/Run/Drive.

| Clip | Length | Use | Natural speed |
|---|---|---|---|
| Idle | 6.7 s loop | standing quietly, looking left and right (default) | 0 |
| IdleShift | 6.8 s loop | wider stance, shifting weight leg to leg | 0 |
| Walk, Walk2, Walk3, Walk4 | 1.0-1.1 s loops | four different people's street walks: pick one per pedestrian | 1.36, 1.59, 1.28, 1.42 m/s |
| WalkSlow | 1.27 s loop | stroll | 0.92 m/s |
| WalkBrisk | 0.87 s loop | hurrying | 1.91 m/s |
| Jog | 0.77 s loop | flee / light run | 2.62 m/s |
| Run | 0.70 s loop | sprint | 4.02 m/s |
| TurnL, TurnR | 1.8 s, 2.4 s | turn in place: rotate the node by +84 deg / -90 deg linearly over the clip | 0 |
| GetIn | 2.0 s, once | sit down into the seat; ends in Drive's first pose | 0 |
| Drive | 2.5 s loop | seated, hands on the wheel | 0 |
| GetOut | 1.7 s, once | stand up from the seat | 0 |

Speeds are for a 1.78 m person; scale by the character's height / 1.78. Set `mixer.timeScale = groundSpeed / naturalSpeed` so feet do not slide (your code already does this with 1.4 and 5.0: use the table's numbers instead). The player's 5.4 m/s sprint needs Run at about 1.35x.

### Added Nov 9, 21:45 (same file, more clips; all loops unless noted)
| Clip | Length | Use | Natural speed |
|---|---|---|---|
| TalkA, TalkB | 9.1 s | two people in conversation, captured together: put B about 1.1 m in front of A facing back and start both at the same clip time | 0 |
| Wait | 8.0 s | waiting, hands on hips, a step | 0 |
| PhoneStand / PhoneWalk | 3.0 s / 3.4 s | left hand at the ear | 0 / 1.28 m/s |
| CoffeeStand / CoffeeWalk | 3.1 s / 5.1 s | right forearm held forward with a cup | 0 / 0.92 m/s |
| CarryBag, CarryBox | 1.4 s, 1.2 s | carrying a case in one hand; carrying a box | 0.85, 0.91 m/s |
| Walk5..Walk9 | 1.0-1.3 s | five more people's walks | 0.90, 1.31, 1.22, 1.47, 0.91 m/s |

Standing clips (Idle, IdleShift, Talk, Wait, Phone, Coffee) are stood upright at retarget (the captures lean 4-9 degrees from the ankles).
The street crowd is a separate layer with its own low-poly cast: `people/crowd/` (HANDOFF.md there when it is ready).

## Loader change in `game/src/models.js`
The current regex `^(Idle|Walk|Run|Drive)` would let `Walk4` overwrite `Walk`. Key clips by their full name instead:

```js
for (const a of this.animations) {
  const tracks = a.tracks.filter((t) => t.name.startsWith(name + '_'));
  if (tracks.length) acts[a.name.toLowerCase()] = mixer.clipAction(new THREE.AnimationClip(a.name + '_' + name, a.duration, tracks));
}
```

Then `acts.walk`, `acts.walk2`, `acts.idleshift`, `acts.getin` and so on exist; give each pedestrian a fixed walk (`['walk','walk2','walk3','walk4'][i % 4]`) for crowd variety. Load `people.glb` beside `models.glb` (or merge them): `Kit.people[name] = gltf.scene.getObjectByName(name)`.

## Rebuild
From `people/`: `bin/prun hero.py` (hero characters, Blender + MPFB on laptop 3), then `bin/gexport` (game bake, mocap retarget, GLB). Sources: `src/`; look rules in `src/looks.py`, hair in `src/hair.py`, cast in `src/chars.py` + `src/wardrobe.py`, mocap clips in `src/mocap_prep.py` (see `mocap/MOCAP.md` for takes and licence).

## State of this export (Nov 9, 21:16)
- Built from the round-9 characters: relaxed eyelids, fitted clothes with trousers tucked under tops, seams and folds baked into the normal maps, hidden skin pulled in under garments.
- Checked by eye in Blender preview frames only (`people/render/game_*.jpg`: idle, walks, run, turns, drive, get in/out, all five characters). Not yet loaded in the game: the loader change above is untested in three.js.
- Hair, brows and lashes in the game file are still MakeHuman's alpha-card shells. The strand hair of the hero renders has no game version yet (the card generator was tried and rejected; a baked hair shell is the next step).
- Faint horizontal ridges can show on wool and knit where the baked fold normals meet the decimated mesh.
- Drive is a composite of two CMU takes, and GetIn/GetOut are a low-stool sit and stand (CMU has no car entry): expect to hide the transition behind the car door.
- Licences: bodies, clothes, hair and skins are MakeHuman CC0; fabric scans are Poly Haven CC0; motion is the CMU Graphics Lab Motion Capture Database (free to use; see `people/mocap/MOCAP.md`). No MetaHuman or Epic asset is in the file.
