/**
 * Word bank for draw-and-guess mode.
 * In Phase 2 these get replaced/augmented by the Topic Engine.
 * For now, provides default word lists by category.
 */

const wordBank = {
  general: [
    'apple', 'bicycle', 'castle', 'dragon', 'elephant', 'fire',
    'guitar', 'helicopter', 'island', 'jellyfish', 'kangaroo', 'lighthouse',
    'mountain', 'ninja', 'octopus', 'piano', 'queen', 'robot',
    'submarine', 'tornado', 'umbrella', 'volcano', 'waterfall', 'xylophone',
    'yacht', 'zombie', 'airplane', 'bridge', 'camera', 'diamond',
    'eagle', 'fountain', 'globe', 'hammer', 'iceberg', 'jungle',
    'knight', 'lemon', 'mirror', 'notebook', 'owl', 'pyramid',
    'rainbow', 'satellite', 'telescope', 'unicorn', 'violin', 'windmill',
  ],

  cricket: [
    'bat', 'ball', 'wicket', 'stumps', 'helmet', 'gloves',
    'boundary', 'six', 'catch', 'bowler', 'batsman', 'umpire',
    'pitch', 'crease', 'yorker', 'googly', 'spin', 'swing',
    'fielder', 'stadium', 'trophy', 'duck', 'century', 'over',
  ],

  anime: [
    'naruto', 'pikachu', 'dragon ball', 'sword', 'ninja headband', 'ramen',
    'katana', 'sharingan', 'pokeball', 'sailor moon', 'titan', 'death note',
    'spirit', 'demon', 'saiyan', 'kunai', 'sensei', 'chakra',
    'manga', 'cosplay', 'bento', 'shuriken', 'scroll', 'dojo',
  ],

  football: [
    'goal', 'penalty', 'referee', 'corner kick', 'offside', 'trophy',
    'stadium', 'jersey', 'boots', 'header', 'dribble', 'tackle',
    'goalkeeper', 'free kick', 'red card', 'yellow card', 'whistle', 'net',
    'football', 'coach', 'substitute', 'formation', 'half time', 'celebration',
  ],

  tech: [
    'laptop', 'robot', 'satellite', 'rocket', 'drone', 'virtual reality',
    'artificial intelligence', 'blockchain', 'cloud', 'server', 'database', 'code',
    'keyboard', 'mouse', 'monitor', 'wifi', 'bluetooth', 'circuit',
    'chip', 'antenna', 'hologram', 'algorithm', 'pixel', 'binary',
  ],

  cartoon: [
    'spongebob', 'tom and jerry', 'mickey mouse', 'bugs bunny', 'scooby doo',
    'batman', 'superman', 'spider web', 'cape', 'mask',
    'pineapple house', 'treehouse', 'spaceship', 'magic wand', 'treasure map',
    'villain', 'sidekick', 'potion', 'crystal', 'portal',
    'dinosaur', 'time machine', 'invisibility', 'lightning bolt',
  ],

  countries: [
    'eiffel tower', 'great wall', 'taj mahal', 'statue of liberty', 'pyramids',
    'colosseum', 'big ben', 'opera house', 'mount fuji', 'christ the redeemer',
    'flag', 'passport', 'globe', 'map', 'compass',
    'kangaroo', 'panda', 'eagle', 'elephant', 'polar bear',
    'sushi', 'pizza', 'taco', 'croissant', 'curry',
  ],

  fruits: [
    'apple', 'banana', 'cherry', 'dragonfruit', 'elderberry',
    'fig', 'grape', 'honeydew', 'kiwi', 'lemon',
    'mango', 'nectarine', 'orange', 'papaya', 'quince',
    'raspberry', 'strawberry', 'tangerine', 'watermelon', 'blueberry',
    'pineapple', 'coconut', 'pomegranate', 'avocado',
  ],

  engineering: [
    'bridge', 'gear', 'circuit', 'blueprint', 'crane',
    'dam', 'engine', 'factory', 'generator', 'hydraulic',
    'piston', 'turbine', 'welding', 'bolt', 'wrench',
    'conveyor belt', 'solar panel', 'wind turbine', 'robot arm', 'laser',
    'lever', 'pulley', 'screw', 'spring',
  ],
};

/**
 * Get words for a given topic.
 * Falls back to general if topic not found.
 * @param {string} topic
 * @param {number} count - number of words to return
 * @returns {string[]}
 */
export function getWordsForTopic(topic, count = 10) {
  const normalizedTopic = topic.toLowerCase().trim();
  let words = wordBank[normalizedTopic] || wordBank.general;

  // Shuffle using Fisher-Yates
  const shuffled = [...words];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Get word choices for the drawer to pick from
 * @param {string} topic
 * @returns {string[]} 3 word options
 */
export function getWordChoices(topic) {
  return getWordsForTopic(topic, 3);
}

/**
 * Get all available default topics
 * @returns {string[]}
 */
export function getAvailableTopics() {
  return Object.keys(wordBank);
}

export default wordBank;
