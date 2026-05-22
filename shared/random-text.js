// @ts-check

/**
 * Lorem-ipsum-style filler for "random text" demos.
 *
 * Three length buckets, rotating pool per bucket so consecutive demos of the
 * same length don't all look identical. The rotation is process-local — it
 * resets when the server restarts, which is fine; the goal is variety
 * within a single recording session, not deterministic test output.
 */

const POOLS = {
  short: [
    'The quick brown fox jumps over the lazy dog every single morning.',
    'A small idea can lead to a much bigger and more interesting result.',
    'Coffee in hand, the developer started writing the next great feature.',
  ],
  medium: [
    'Building software is a craft that rewards patience and curiosity. Every problem looks impossible until you break it down into pieces you can actually hold in your head. Then, suddenly, it just works.',
    'The block editor changed how people write for the web. Instead of one long blob of HTML, posts became compositions — a heading here, an image there, a quote in between. Writing turned into arranging.',
    'Good tools get out of your way. They suggest, they assist, they hint, but they never demand. The best ones feel like they understand what you meant, even when what you typed was a little bit wrong.',
  ],
  long: [
    'Building software is a craft that rewards patience and curiosity. Every problem looks impossible until you break it down into pieces you can actually hold in your head. The block editor changed how people write for the web — instead of one long blob of HTML, posts became compositions. A heading here, an image there, a quote in between. Writing turned into arranging, and arranging turned into thinking. Good tools get out of your way and suggest, assist, and hint without demanding. The best ones feel like they understand what you meant, even when what you typed was wrong.',
    'WordPress has always been about democratizing publishing, and the block editor is the latest chapter in that story. It takes the messy, fiddly work of building a webpage and turns it into something almost playful. Anyone can drag a heading into place, drop in an image, and adjust the spacing until the whole thing feels right. There is no template to fight, no theme to override, no shortcode to memorize — just blocks, snapping together like Lego, building up a post one decision at a time.',
    'A demo recording is a tiny act of storytelling. You have thirty seconds to show what a feature does, why it matters, and how it feels to use. Every click, every pause, every typed character carries weight. The best demos make hard things look effortless, and the worst ones make easy things look confusing. The difference is rarely the feature itself — it is the rhythm, the framing, and the willingness to cut everything that does not serve the story.',
  ],
};

/** @type {Record<keyof typeof POOLS, number>} */
const cursors = { short: 0, medium: 0, long: 0 };

/**
 * Return a random-text snippet at the requested length. Rotates through a
 * small pool so repeat calls within a session vary.
 *
 * @param {'short' | 'medium' | 'long'} length
 * @returns {string}
 */
function getRandomText(length) {
  const pool = POOLS[length];
  if (!pool) throw new Error(`getRandomText(): unknown length "${length}"`);
  const idx = cursors[length] % pool.length;
  cursors[length] = (cursors[length] + 1) % pool.length;
  return pool[idx];
}

module.exports = { getRandomText };
