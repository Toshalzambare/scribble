/**
 * Topic Engine — OSINT-style dynamic topic research
 * Fetches words, facts, entities, and achievements from Wikipedia/Wikidata
 * for ANY topic. Caches results per room session.
 */

const cache = new Map();

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

/**
 * Fetch all topic data (words, facts, entities) for a given topic.
 * Returns cached data if available.
 */
export async function fetchTopicData(topic) {
  const key = topic.toLowerCase().trim();
  if (cache.has(key)) return cache.get(key);

  console.log(`[TopicEngine] Fetching data for: "${topic}"`);

  const [summary, relatedPages, searchResults] = await Promise.all([
    fetchWikiSummary(topic),
    fetchRelatedPages(topic),
    fetchWikiSearch(topic),
  ]);

  const entities = extractEntities(summary, relatedPages, searchResults);
  const facts = extractFacts(summary, relatedPages);
  const words = extractWords(summary, relatedPages, searchResults, topic);

  // Fetch achievements for top entities
  const entityProfiles = await fetchEntityProfiles(entities.slice(0, 15));

  const data = {
    topic: key,
    words,
    facts,
    entities: entityProfiles,
    fetchedAt: Date.now(),
  };

  cache.set(key, data);
  console.log(`[TopicEngine] Cached: ${words.length} words, ${facts.length} facts, ${entityProfiles.length} entities`);
  return data;
}

/**
 * Get word list for drawing mode, augmented with dynamic data
 */
export function getTopicWords(topicData, count = 3) {
  const words = [...topicData.words];
  shuffle(words);
  return words.slice(0, Math.min(count, words.length));
}

/**
 * Get next fact that hasn't been shown in this session
 */
export function getNextFact(topicData, shownFactHashes) {
  for (const fact of topicData.facts) {
    const hash = simpleHash(fact.text);
    if (!shownFactHashes.has(hash)) {
      shownFactHashes.add(hash);
      return fact;
    }
  }
  return null; // All facts shown
}

/**
 * Get an entity with clues for Guess by Achievement mode
 */
export function getEntityForGuessing(topicData, usedEntityIds) {
  for (const entity of topicData.entities) {
    if (!usedEntityIds.has(entity.id) && entity.clues.length >= 2) {
      usedEntityIds.add(entity.id);
      return entity;
    }
  }
  return null;
}

// ===== Wikipedia API Functions =====

async function fetchWikiSummary(topic) {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn(`[TopicEngine] Summary fetch failed for "${topic}":`, e.message);
    return null;
  }
}

async function fetchRelatedPages(topic) {
  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      list: 'search',
      srsearch: topic,
      srlimit: '20',
      srprop: 'snippet|titlesnippet',
      origin: '*',
    });
    const res = await fetch(`${WIKI_API}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.query?.search || [];
  } catch (e) {
    console.warn(`[TopicEngine] Related pages fetch failed:`, e.message);
    return [];
  }
}

async function fetchWikiSearch(topic) {
  try {
    const params = new URLSearchParams({
      action: 'opensearch',
      search: topic,
      limit: '30',
      format: 'json',
      origin: '*',
    });
    const res = await fetch(`${WIKI_API}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data[1] || []; // Array of titles
  } catch (e) {
    console.warn(`[TopicEngine] Search failed:`, e.message);
    return [];
  }
}

async function fetchEntityProfiles(entityNames) {
  const profiles = [];

  for (const name of entityNames) {
    try {
      // Fetch summary for clue generation
      const summary = await fetchWikiSummary(name);
      if (!summary || !summary.extract) continue;

      const clues = generateCluesFromSummary(name, summary);
      if (clues.length < 2) continue;

      profiles.push({
        id: name.toLowerCase().replace(/\s+/g, '_'),
        name,
        description: summary.description || '',
        clues,
        thumbnail: summary.thumbnail?.source || null,
      });
    } catch (e) {
      continue;
    }
  }

  return profiles;
}

function generateCluesFromSummary(name, summary) {
  const clues = [];
  const extract = summary.extract || '';
  const desc = summary.description || '';

  // Split extract into sentences
  const sentences = extract
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15 && s.length < 200);

  // Filter out sentences that contain the entity name (too easy)
  const nameParts = name.toLowerCase().split(/\s+/);

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    const containsName = nameParts.some((part) => part.length > 2 && lower.includes(part));

    if (!containsName && sentence.length > 20) {
      clues.push({ text: sentence + '.', difficulty: 'hard' });
    } else if (containsName) {
      // Redact the name from the sentence for a medium clue
      let redacted = sentence;
      for (const part of nameParts) {
        if (part.length > 2) {
          redacted = redacted.replace(new RegExp(part, 'gi'), '____');
        }
      }
      if (redacted !== sentence) {
        clues.push({ text: redacted + '.', difficulty: 'medium' });
      }
    }
  }

  // Add description as easiest clue
  if (desc && desc.length > 5) {
    // Redact name from description
    let redactedDesc = desc;
    for (const part of nameParts) {
      if (part.length > 2) {
        redactedDesc = redactedDesc.replace(new RegExp(part, 'gi'), '____');
      }
    }
    clues.push({ text: redactedDesc, difficulty: 'easy' });
  }

  // Sort: hard first, easy last
  const order = { hard: 0, medium: 1, easy: 2 };
  clues.sort((a, b) => order[a.difficulty] - order[b.difficulty]);

  return clues.slice(0, 5); // Max 5 clues
}

// ===== Data Extraction =====

function extractEntities(summary, relatedPages, searchResults) {
  const entities = new Set();

  // From search results
  for (const title of searchResults) {
    if (title.length > 2 && title.length < 60) {
      entities.add(title);
    }
  }

  // From related pages
  for (const page of relatedPages) {
    if (page.title.length > 2 && page.title.length < 60) {
      entities.add(page.title);
    }
  }

  return Array.from(entities);
}

function extractFacts(summary, relatedPages) {
  const facts = [];

  // From summary
  if (summary?.extract) {
    const sentences = summary.extract
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 30 && s.length < 250);

    for (const s of sentences) {
      facts.push({ text: s + '.', source: 'wikipedia' });
    }
  }

  // From related page snippets
  for (const page of relatedPages) {
    if (page.snippet) {
      const clean = page.snippet.replace(/<[^>]*>/g, '').trim();
      if (clean.length > 30 && clean.length < 250) {
        facts.push({ text: clean, source: 'wikipedia', title: page.title });
      }
    }
  }

  shuffle(facts);
  return facts;
}

function extractWords(summary, relatedPages, searchResults, topic) {
  const words = new Set();

  // Add the topic itself
  words.add(topic.toLowerCase());

  // From search results
  for (const title of searchResults) {
    const clean = title.toLowerCase().trim();
    if (clean.length >= 3 && clean.length <= 30) {
      words.add(clean);
    }
  }

  // From related pages
  for (const page of relatedPages) {
    const clean = page.title.toLowerCase().trim();
    if (clean.length >= 3 && clean.length <= 30) {
      words.add(clean);
    }
  }

  // Extract key terms from summary
  if (summary?.extract) {
    const text = summary.extract.toLowerCase();
    // Find capitalized/proper nouns (basic NLP)
    const properNouns = summary.extract.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g) || [];
    for (const noun of properNouns) {
      if (noun.length >= 3 && noun.length <= 25) {
        words.add(noun.toLowerCase());
      }
    }
  }

  return Array.from(words);
}

// ===== Utilities =====

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

/**
 * Clear cache for a specific topic or all
 */
export function clearCache(topic) {
  if (topic) cache.delete(topic.toLowerCase().trim());
  else cache.clear();
}

export default { fetchTopicData, getTopicWords, getNextFact, getEntityForGuessing, clearCache };
