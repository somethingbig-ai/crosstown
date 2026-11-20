export function releaseFeedbackKeys(game, recorded) {
  if (game.P?.get('feedbackkeys') === '0') return;
  game.keys?.clear();
  game.look?.keys.clear();
  recorded.clear();
}
