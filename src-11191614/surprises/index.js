// surprises/index.js: hidden New York moments a player stumbles into (surprises lane, Nov 15; Matt 15:12 "things people will very likely
// find, not expect, then be like, holy shit"). One line in game.js, after the subway line:
//     if (this.P.get('surprises') !== '0') try { await (await import('./surprises/index.js')).install(this); } catch (e) { console.log('[surprises] not loaded: ' + (e && (e.stack || e.message))); }
// Each surprise is one file in this folder with install(game, kit); a fault in one is logged and the others run.
//   ?surprises=0      none of this is fetched
//   ?<name>=0         that one off (the names are the LIST below)
//   ?surshow=<name>   stand the player where that surprise is and set it off (for a look; each file's show())
import { makeKit } from './kit.js';

export const LIST = ['pigeons', 'steam', 'hydrant', 'jingle', 'slice', 'pizzarat', 'shedrattle', 'bodegacat', 'showtime', 'busker'];      // what has shipped (surprises lane hand-overs 1 to 10); puddle splash was dropped (lanes/surprises/STATE.md)

export async function install(game) {
  if (game.surprises) return game.surprises;
  const P = game.P || new URLSearchParams(''), S = (game.surprises = { mods: {}, off: [], failed: [] });
  const kit = (S.kit = makeKit(game)), show = P.get('surshow');
  await Promise.all(LIST.map(async (name) => {
    if (P.get(name) === '0') { S.off.push(name); return; }
    try { const m = await import('./' + name + '.js'); S.mods[name] = (await m.install(game, kit)) || {}; S.mods[name].__show = m.show; }
    catch (e) { S.failed.push(name); console.log('[surprises] ' + name + ' not loaded: ' + ((e && (e.stack || e.message)) || e)); }
  }));
  S.show = (name) => { const m = S.mods[name]; if (!m || !m.__show) return false; try { m.__show(game, kit, m); return true; } catch (e) { kit.fail(name + '.show', e); return false; } };
  if (show) setTimeout(() => S.show(show), 0);
  S.info = () => ({ on: Object.keys(S.mods), off: S.off, failed: S.failed, fails: kit.fails });
  return S;
}
