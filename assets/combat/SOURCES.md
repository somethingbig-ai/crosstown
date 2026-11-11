
## Weapons (src/combat/models.js)
All four guns (pistol, SMG, shotgun, rifle), their casings and all their textures are generated in code at load: no model or texture files,
nothing downloaded, no third-party art. Generic firearm types only; no maker marks.
Judging-only reference photos (not shipped, not in the game) are listed in lanes/gameplay/weapons-state/ref/README.md.

## Gun audio (src/combat/audio.js, assets/combat/audio/guns.opus + guns.json)
One sprite file, 750 kB (Ogg Opus, stereo, 48 kHz, 36 s), cut and levelled by lanes/gameplay/tools/audiosprite.py. Everything in it is CC0
(public domain dedication; no credit required, given here anyway). Licence and author read from each page on Nov 10 2026; nothing from any game.
Everything else the module plays (thump/body layers, street tail, casings, impacts, whiz, explosion, alarm, dry-fire, draw/holster) is synthesized in code.

| What is in the sprite | Source | Author | Licence | Page | File |
|---|---|---|---|---|---|
| Gunshots, close and mid-distance microphones: Walther PPQ 9 mm (pistol), Carl Gustav M45 9 mm (SMG), AK-47 7.62x39 (rifle), Benelli Nova and Charles Daly 12-gauge pump (shotgun). Files X_39P, X_31P, G_31P, G_33P, G_20P, C_28P, C_29P, C_31P, O_21P, O_17P, H_21P, H_16P | The Free Firearm Sound Library, "Prepared SFX Library" | the Free Firearm Sound Library team (freefirearmsfx.com; posted on OpenGameArt by bart) | CC0: "Our team holds CC0 NO RIGHTS RESERVED for this library. It may be used without royalty or credit ... for any application, personal or professional." | https://opengameart.org/content/the-free-firearm-sound-library | https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z |
| Pistol magazine out, magazine in, slide rack (three cuts of reload.wav) | Handgun Reload Sound Effect | zer0_sol | CC0 | https://opengameart.org/content/handgun-reload-sound-effect | https://opengameart.org/sites/default/files/reload.wav |
| Shotgun pump (Rack.mp3) and shell loading (First Shell.mp3, Subsequent Shells.mp3, Shell in Chamber.mp3) | Shotgun Reload Sound effects | zer0_sol | CC0 | https://opengameart.org/content/shotgun-reload-sound-effects | shotgunsounds.zip on that page |
| Rifle magazine out / in / bolt (assaultriflereload1_0.wav), SMG magazine out / in (gunreload1.wav), second shotgun pump (shotguncock_0.wav) | Gun reload sounds | SpringySpringo | CC0 | https://opengameart.org/content/gun-reload-sounds | the three .wav files on that page |
| Second magazine-in take (clipload1.wav) | Gun Reload Sound Effects | BMacZero (Brian MacIntosh) | CC0 | https://opengameart.org/content/gun-reload-sound-effects | https://opengameart.org/sites/default/files/clipload1.wav |
| Car window breaking (glass_breaking.wav), with synthesized shards over it | Glass Break | TinyWorlds | CC0 | https://opengameart.org/content/glass-break | https://opengameart.org/sites/default/files/glass_breaking.wav |

Not shipped: the reference gameplay audio used for measuring (lanes/gameplay/audio-state/ref-audio) and the rest of the downloaded packs (lanes/gameplay/audio-state/samples-raw).

## Heat (police, health, death): src/combat/heat.js, heatscripts.js
No outside assets. The patrol car light bar, door panels and "CITY PATROL" markings, the navy uniform, the vest and the hurt sound are made in code (our own made-up city police: no real department name, badge or livery). Officers are the kit people; their cap is the guns helper's Cap (dress.js); weapons, effects and gun audio are the lane's own.
