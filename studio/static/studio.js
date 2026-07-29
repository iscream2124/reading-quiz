let quiz = null;
let currentQuestionIndex = 0;
let batchItems = [];
let batchInputRows = [];
let batchGeneratedItems = [];
let currentBatchIndex = -1;
let assetFiles = new Map();
let assetObjectUrls = [];
let currentStoryPackage = null;
let pendingResourceReplaceKind = '';
let pendingResourceReplaceKey = '';

const SG_LABELS = {
  setting: 'Setting',
  initiating_event: 'Initiating Event',
  attempt: 'Attempt',
  reaction: 'Reaction',
  internal_response: 'Internal Response',
  consequence: 'Consequence'
};

const SG_KO = {
  setting: '\uBC30\uACBD \uC774\uD574',
  initiating_event: '\uC0AC\uAC74 \uC2DC\uC791',
  attempt: '\uD574\uACB0 \uD589\uB3D9',
  reaction: '\uAC10\uC815 \uBC18\uC751',
  internal_response: '\uB0B4\uBA74 \uCD94\uB860',
  consequence: '\uACB0\uACFC \uC774\uD574'
};

const SG_KEY_ALIASES = {
  setting: 'setting',
  'setting & sequence': 'setting',
  '\uBC30\uACBD': 'setting',
  '\uBC30\uACBD \uC774\uD574': 'setting',
  initiating_event: 'initiating_event',
  'initiating event': 'initiating_event',
  '\uC0AC\uAC74 \uC2DC\uC791': 'initiating_event',
  attempt: 'attempt',
  '\uC2DC\uB3C4': 'attempt',
  '\uD574\uACB0 \uD589\uB3D9': 'attempt',
  reaction: 'reaction',
  '\uBC18\uC751': 'reaction',
  '\uAC10\uC815 \uBC18\uC751': 'reaction',
  internal_response: 'internal_response',
  'internal response': 'internal_response',
  '\uB0B4\uBA74 \uCD94\uB860': 'internal_response',
  consequence: 'consequence',
  '\uACB0\uACFC': 'consequence',
  '\uACB0\uACFC \uC774\uD574': 'consequence'
};

const $ = (id) => document.getElementById(id);
const OPENAI_MODEL = 'gpt-4.1-mini';
const GEMINI_MODEL = 'gemini-2.5-flash';
const OPTION_LABELS = ['\u24D0', '\u24D1', '\u24D2', '\u24D3', '\u24D4', '\u24D5'];

const QUESTION_BLUEPRINT = [
  { number: 1, storyGrammar: 'consequence', type: 'story_sequence_drag', instruction: 'Put the story scenes in order.', promptMode: 'drag_sequence' },
  { number: 2, storyGrammar: 'setting', type: 'setting_slot_drag', instruction: 'Look at the picture. Fill in the boxes.', promptMode: 'slot_drag' },
  { number: 3, storyGrammar: 'initiating_event', type: 'listen_scene_mcq', instruction: 'Listen. Which scene starts the problem?', promptMode: 'image_mcq' },
  { number: 4, storyGrammar: 'attempt', type: 'scene_word_unscramble', instruction: 'Put the story words in order.', promptMode: 'word_unscramble' },
  { number: 5, storyGrammar: 'reaction', type: 'emotion_mcq', instruction: 'How does the character feel here?', promptMode: 'text_mcq' },
  { number: 6, storyGrammar: 'internal_response', type: 'internal_response_mcq', instruction: 'What is the character thinking?', promptMode: 'text_mcq' }
];

const BATCH_COLUMNS = [
  'story_id',
  'title',
  'level',
  'story_text',
  'notes'
];

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeJsonParse(value, label) {
  try {
    return JSON.parse(value || 'null');
  } catch (error) {
    throw new Error(`${label} JSON format needs review.`);
  }
}

function isLocalOrigin() {
  return ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
}

async function loadGenerationPrompt() {
  const res = await fetch('prompts/story_grammar_v3.md', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Prompt file not found: HTTP ${res.status}`);
  return res.text();
}

function extractJsonFromText(text) {
  let raw = String(text || '').trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  return JSON.parse(raw);
}

function aiInputFromRow(row, index = 0) {
  const storyId = row.story_id || row.storyId || `STORY_${String(index + 1).padStart(3, '0')}`;
  return {
    storyId,
    title: row.title || row.Title || storyId,
    level: row.level || row.Level || 'Draft Level',
    storyText: row.story_text || row.storyText || row['Story Text'] || '',
    assetNaming: {
      image: '{storyId}_SC##_I.webp or {storyId}_SC##_I_1920x1080.webp',
      audio: '{storyId}_SC##_ST##_N_A.mp3',
      cover: '{storyId}_Cover_L_I.webp or {storyId}_Cover_L_I_1920x1080.webp',
      background: '{storyId}_Talking_BG_I.webp'
    },
    questionBlueprint: QUESTION_BLUEPRINT
  };
}

function applyDefaultAssetsToQuiz(sourceQuiz, row = {}) {
  const qz = sourceQuiz.quiz || sourceQuiz;
  const input = aiInputFromRow(row);
  qz.schemaVersion = qz.schemaVersion || 'quiz-v3.0';
  qz.story = qz.story || {};
  qz.story.storyId = qz.story.storyId || input.storyId;
  qz.story.title = qz.story.title || input.title;
  qz.story.level = qz.story.level || input.level;
  qz.story.text = qz.story.text || input.storyText;
  qz.assets = qz.assets || {};
  qz.assets.imageBasePath = row.image_base_path || qz.assets.imageBasePath || `../v3/${qz.story.storyId}/Image/`;
  qz.assets.audioBasePath = row.audio_base_path || qz.assets.audioBasePath || `../v3/${qz.story.storyId}/Audio/`;
  qz.assets.coverBasePath = row.cover_base_path || qz.assets.coverBasePath || `../v3/${qz.story.storyId}/Cover/`;
  qz.assets.backgroundImage = row.background_image || qz.assets.backgroundImage || `../v3/${qz.story.storyId}/Image/${qz.story.storyId}_Talking_BG_I.webp`;
  qz.assets.coverImage = row.cover_image || qz.assets.coverImage || `../v3/${qz.story.storyId}/Cover/${qz.story.storyId}_Cover_L_I.webp`;
  qz.assets.hintCharacter = row.hint_character || qz.assets.hintCharacter || `../v3/${qz.story.storyId}/Assets/BKTK_Characters_Bookey.png`;
  return qz;
}

function hasMeaningfulInteraction(q) {
  const i = q?.interaction || {};
  if (Array.isArray(i.options) && i.options.length >= 2) return true;
  if (Array.isArray(i.items) && i.items.length >= 2) return true;
  if (Array.isArray(i.slots) && i.slots.length >= 1) return true;
  if (Array.isArray(i.correct) && i.correct.length >= 1) return true;
  if (i.correct && typeof i.correct === 'object' && Object.keys(i.correct).length) return true;
  return false;
}

function hasMeaningfulScoring(q) {
  return !!(q?.scoring?.formula && Array.isArray(q.scoring.components) && q.scoring.components.length);
}

function hasImageResources(q) {
  return Array.isArray(q?.resources?.images) && q.resources.images.length > 0;
}

function hasMcqOptions(q) {
  return Array.isArray(q?.interaction?.options) && q.interaction.options.length >= 2;
}

function isTemplateCompatible(baseQ, aiQ) {
  if (!aiQ) return false;
  const promptMode = aiQ.interaction?.promptMode || '';
  if (baseQ.type === 'story_sequence_drag') {
    return Array.isArray(aiQ.interaction?.correct)
      && aiQ.interaction.correct.length >= 4
      && aiQ.interaction.correct.every(value => /^SC\d{2}$/i.test(String(value)))
      && hasImageResources(aiQ);
  }
  if (baseQ.type === 'setting_slot_drag') {
    return Array.isArray(aiQ.interaction?.slots)
      && aiQ.interaction.slots.length >= 3
      && (
        (Array.isArray(aiQ.interaction?.items) && aiQ.interaction.items.length >= 3)
        || (Array.isArray(aiQ.interaction?.options) && aiQ.interaction.options.length >= 3)
      );
  }
  if (baseQ.type === 'listen_scene_mcq') {
    return hasMcqOptions(aiQ) && hasImageResources(aiQ);
  }
  if (baseQ.type === 'scene_word_unscramble') {
    return Array.isArray(aiQ.interaction?.correct)
      && aiQ.interaction.correct.length >= 3
      && hasImageResources(aiQ);
  }
  if (baseQ.type === 'emotion_mcq' || baseQ.type === 'internal_response_mcq') {
    return hasMcqOptions(aiQ);
  }
  return promptMode === baseQ.interaction?.promptMode;
}

function isInstructionCompatible(baseQ, instruction) {
  const value = String(instruction || '').trim();
  if (!value) return false;
  if (baseQ.type === 'emotion_mcq') return /^How does .+ feel here\?$/i.test(value);
  if (baseQ.type === 'internal_response_mcq') return /^What is .+ thinking\?$/i.test(value);
  return value === baseQ.instruction;
}

function matchingQuestionScore(baseQ, aiQ) {
  if (!aiQ) return 0;
  let score = 0;
  if (Number(aiQ.number) === Number(baseQ.number)) score += 40;
  if (normalizeStoryGrammarKey(aiQ.storyGrammar) === normalizeStoryGrammarKey(baseQ.storyGrammar)) score += 35;
  if (aiQ.type === baseQ.type) score += 20;
  if ((aiQ.interaction?.promptMode || '') === (baseQ.interaction?.promptMode || '')) score += 10;
  if (isTemplateCompatible(baseQ, aiQ)) score += 40;
  return score;
}

function bestAiQuestionForTemplate(baseQ, incomingQuestions) {
  return [...(incomingQuestions || [])]
    .map(q => ({ q, score: matchingQuestionScore(baseQ, q) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.q || null;
}

function templateScoringForQuestion(q) {
  if (q.type === 'story_sequence_drag') {
    const sequence = Array.isArray(q.interaction?.correct) && q.interaction.correct.length
      ? q.interaction.correct
      : (q.interaction?.items || []);
    return weightedPosition(sequence);
  }
  if (q.type === 'setting_slot_drag') return settingScoring(q.interaction?.correct, q.interaction?.slots);
  if (q.type === 'scene_word_unscramble') {
    const words = Array.isArray(q.interaction?.correct) ? q.interaction.correct : [];
    return wordScoring(words);
  }
  if (hasMcqOptions(q)) {
    return {
      type: 'fixed_option_score',
      maxScore: 100,
      formula: 'score = selected_option.score',
      components: q.interaction.options.map(opt => ({
        key: opt.key,
        weight: Number(opt.score) || 0,
        rule: 'option_score',
        correctValue: !!opt.isCorrect,
        rationale: opt.diagnostic || (opt.isCorrect ? 'Correct option.' : 'Distractor option.')
      }))
    };
  }
  return q.scoring || fixedScoring();
}

function mergeQuestionDraft(baseQ, aiQ) {
  if (!aiQ) return baseQ;
  const merged = deepClone(baseQ);
  const compatible = isTemplateCompatible(baseQ, aiQ);
  merged.qId = baseQ.qId;
  merged.number = baseQ.number;
  merged.storyGrammar = normalizeStoryGrammarKey(baseQ.storyGrammar);
  merged.type = baseQ.type;
  merged.instruction = isInstructionCompatible(baseQ, aiQ.instruction) ? aiQ.instruction : baseQ.instruction;
  if (aiQ.hint) merged.hint = aiQ.hint;
  if (compatible && aiQ.resources && (aiQ.resources.images || aiQ.resources.audio || aiQ.resources.scene)) merged.resources = aiQ.resources;
  if (compatible && hasMeaningfulInteraction(aiQ)) merged.interaction = aiQ.interaction;
  if (Array.isArray(aiQ.diagnostics) && aiQ.diagnostics.length) merged.diagnostics = aiQ.diagnostics;
  merged.scoring = templateScoringForQuestion(merged);
  merged.lrs = baseQ.lrs;
  return merged;
}

function slugKey(value, fallback) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
}

function normalizeStoryGrammarKey(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase().replace(/[-\s]+/g, '_');
  return SG_KEY_ALIASES[raw] || SG_KEY_ALIASES[raw.toLowerCase()] || SG_KEY_ALIASES[lower] || lower;
}

function storyGrammarLabel(value) {
  const key = normalizeStoryGrammarKey(value);
  return SG_LABELS[key] || String(value || '');
}

function normalizeSlotKey(value) {
  const lower = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (['who', 'character', 'main_character'].includes(lower)) return 'who';
  if (['where', 'place', 'setting', 'main_place', 'story_place'].includes(lower)) return 'where';
  if (['at_first', 'first', 'opening', 'opening_state', 'first_action', 'later_problem'].includes(lower)) return 'at_first';
  return lower;
}

function humanizeKey(value) {
  const text = String(value || '')
    .replace(/^card[_-]/i, '')
    .replace(/^setting[_-]/i, '')
    .replace(/^main[_-]/i, '')
    .replace(/^other[_-]/i, 'other ')
    .replace(/^later[_-]/i, 'later ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.replace(/\b([a-z])/g, ch => ch.toUpperCase()).replace(/\bThe\b/g, 'the');
}

function normalizeSettingItem(item, index) {
  if (typeof item === 'string') {
    return { key: slugKey(item, `item_${index + 1}`), text: item, slot: '' };
  }
  const rawText = item?.text || item?.label || item?.value || '';
  const text = placeholderText(rawText) ? (humanizeKey(item?.key) || rawText || `item ${index + 1}`) : rawText;
  return {
    ...item,
    key: item?.key || slugKey(text, `item_${index + 1}`),
    text,
    slot: normalizeSlotKey(item?.slot || item?.category || '')
  };
}

function normalizeSettingInteraction(interaction = {}) {
  const aiSlots = Array.isArray(interaction.slots) ? interaction.slots : [];
  const fixedSlots = [
    { key: 'who', label: 'Who?', weight: 3 },
    { key: 'where', label: 'Where?', weight: 3 },
    { key: 'at_first', label: 'At first...', weight: 4 }
  ];
  const sourceItems = Array.isArray(interaction.items) && interaction.items.length
    ? interaction.items
    : (Array.isArray(interaction.options) ? interaction.options : []);
  const items = sourceItems.map(normalizeSettingItem);
  const itemByKey = new Map(items.map(item => [String(item.key), item]));
  const correct = {};
  const slots = fixedSlots.map(slot => {
    const aiSlot = aiSlots.find(s => normalizeSlotKey(s.key || s.label) === slot.key) || {};
    let correctValue = interaction.correct?.[slot.key] || aiSlot.correct || slot.correct;
    if (correctValue && !itemByKey.has(String(correctValue))) {
      const matchedItem = items.find(item => String(item.text || '').toLowerCase() === String(correctValue).toLowerCase());
      if (matchedItem) {
        correctValue = matchedItem.key;
      }
    }
    if (correctValue && !itemByKey.has(String(correctValue))) {
      const text = String(correctValue);
      const key = `${slot.key}_${slugKey(text, 'correct')}`;
      const newItem = { key, text, slot: slot.key, diagnostic: aiSlot.diagnostic || '' };
      items.push(newItem);
      itemByKey.set(key, newItem);
      correctValue = key;
    }
    correct[slot.key] = correctValue || slot.correct || `${slot.key}_correct`;
    return { ...aiSlot, key: slot.key, label: slot.label, correct: correct[slot.key], weight: slot.weight, partialCredit: .35 };
  });
  return {
    ...interaction,
    promptMode: 'slot_drag',
    slots,
    items,
    correct
  };
}

function storySentenceTextById(storyText, sentenceId) {
  if (!sentenceId) return '';
  for (const scene of parseStory(storyText || '')) {
    const found = (scene.sentences || []).find(sentence => sentence.sentenceId === sentenceId);
    if (found) return found.text;
  }
  return '';
}

function storySentenceById(storyText, sentenceId) {
  if (!sentenceId) return null;
  for (const scene of parseStory(storyText || '')) {
    const found = (scene.sentences || []).find(sentence => sentence.sentenceId === sentenceId);
    if (found) return { ...found, sceneId: scene.sceneId };
  }
  return null;
}

function sceneTextById(storyText, sceneId) {
  const scene = parseStory(storyText || '').find(item => item.sceneId === sceneId);
  return (scene?.sentences || []).map(sentence => sentence.text).join(' ');
}

function imageResourceForScene(storyId, sceneId) {
  return { id: sceneId, path: `${storyId}_${sceneId}_I.webp`, kind: 'image', sceneId };
}

function audioResourceForSentence(storyId, sentence) {
  if (!sentence?.sentenceId) return null;
  const audioId = `${sentence.sentenceId}_A`;
  return {
    id: audioId,
    path: `${storyId}_${audioId}.mp3`,
    kind: 'audio',
    sceneId: sentence.sceneId,
    sentenceId: sentence.sentenceId
  };
}

function storySentenceWords(text = '') {
  return (String(text).match(/[A-Za-z']+/g) || []).length;
}

function weakInitiatingSentence(text = '') {
  const cleaned = String(text || '').trim();
  if (storySentenceWords(cleaned) < 5) return true;
  if (/^(look there|look|listen|wow|oh no|oh|hey|got it|help|hello)[!\.]*$/i.test(cleaned)) return true;
  if (/^["']?(look|wow|oh|hey)\b/i.test(cleaned) && storySentenceWords(cleaned) <= 4) return true;
  return false;
}

function storySceneIds(storyText = '') {
  return parseStory(storyText || '').map(scene => scene.sceneId);
}

function storySceneIndex(storyText = '', sceneId = '') {
  return storySceneIds(storyText).indexOf(String(sceneId || '').toUpperCase());
}

function sceneAtRatio(sceneIds = [], ratio = 0) {
  if (!sceneIds.length) return '';
  const idx = Math.max(0, Math.min(sceneIds.length - 1, Math.round((sceneIds.length - 1) * ratio)));
  return sceneIds[idx];
}

function problemSignalScore(text = '') {
  const lower = String(text || '').toLowerCase();
  const strong = [
    'lost', 'loses', 'missing', 'problem', 'trouble', 'only', 'cannot', "can't", 'could not', "couldn't",
    'danger', 'stuck', 'trapped', 'caught', 'heavy', 'dark', 'fell', 'broke', 'vanished', 'disappeared',
    'worried', 'afraid', 'terrible', 'wrong', 'mistake', 'dim', 'stopped', 'dull', 'lifeless',
    'plastic', 'trash', 'bag', 'net', 'capture', 'captured', 'grabbed', 'must have', 'will capture',
    'own', 'keep', 'ignored', 'warning', 'warned'
  ];
  const weak = ['beautiful', 'amazing', 'pretty', 'wonderful', 'watched', 'watching', 'smiled', 'happy'];
  let score = strong.reduce((sum, keyword) => sum + (lower.includes(keyword) ? 5 : 0), 0);
  score -= weak.reduce((sum, keyword) => sum + (lower.includes(keyword) ? 2 : 0), 0);
  if (/\bbut\b|\bsuddenly\b/.test(lower)) score += 2;
  if (/\b(want|wanted|must|try|tried|need|needed)\b/.test(lower)) score += 2;
  return score;
}

function chooseInitiatingSentence(storyText = '') {
  const scenes = parseStory(storyText || '');
  let best = null;
  scenes.forEach((scene, sceneIdx) => {
    (scene.sentences || []).forEach(sentence => {
      const text = sentence.text || '';
      if (weakInitiatingSentence(text)) return;
      let score = problemSignalScore(text) * 2;
      score += sceneIdx === 0 ? -4 : Math.max(0, 8 - sceneIdx);
      score += Math.min(4, storySentenceWords(text) / 2);
      if (problemSignalScore(text) <= 0) score -= 6;
      if (!best || score > best.score) best = { ...sentence, sceneId: scene.sceneId, score };
    });
  });
  if (best) return best;
  const fallbackScene = scenes[1] || scenes[0];
  const fallbackSentence = fallbackScene?.sentences?.find(sentence => !weakInitiatingSentence(sentence.text)) || fallbackScene?.sentences?.[0];
  return fallbackSentence ? { ...fallbackSentence, sceneId: fallbackScene.sceneId } : null;
}

function chooseAttemptSentence(storyText = '') {
  const scenes = parseStory(storyText || '');
  const initiating = chooseInitiatingSentence(storyText);
  const eventIdx = Math.max(0, scenes.findIndex(scene => scene.sceneId === initiating?.sceneId));
  const solveActions = [
    'helped', 'help', 'rescued', 'rescue', 'saved', 'save', 'opened', 'open',
    'released', 'release', 'freed', 'free', 'returned', 'return', 'ran back',
    'went back', 'searched', 'looked for', 'picked up', 'carried', 'hid',
    'used', 'made', 'asked'
  ];
  const goalActions = [
    'tried', 'went', 'walked', 'ran', 'looked', 'followed', 'grabbed',
    'caught', 'capture', 'captured', 'took', 'put'
  ];
  const weakOutcome = [
    'smiled', 'watched', 'whispered', 'agreed', 'realized', 'understood',
    'felt', 'was happy', 'was sad', 'became', 'looked like', 'beautiful'
  ];
  let best = null;
  scenes.forEach((scene, sceneIdx) => {
    (scene.sentences || []).forEach(sentence => {
      const text = sentence.text || '';
      const words = storySentenceWords(text);
      if (words < 4 || words > 12) return;
      const lower = text.toLowerCase();
      let score = 0;
      score += solveActions.reduce((sum, word) => sum + (lower.includes(word) ? 6 : 0), 0);
      score += goalActions.reduce((sum, word) => sum + (lower.includes(word) ? 3 : 0), 0);
      score += sceneIdx > eventIdx ? 6 : -6;
      score += Math.max(0, 8 - Math.abs(words - 7));
      score -= weakOutcome.reduce((sum, word) => sum + (lower.includes(word) ? 5 : 0), 0);
      if (/^["']?i will help you/i.test(text)) score -= 4;
      if (score <= 0) return;
      if (!best || score > best.score) best = { ...sentence, sceneId: scene.sceneId, score };
    });
  });
  return best;
}

function weakAttemptSentence(storyText = '', sentence = null) {
  if (!sentence?.text) return true;
  const scenes = parseStory(storyText || '');
  const sceneIdx = scenes.findIndex(scene => scene.sceneId === sentence.sceneId);
  const eventIdx = Math.max(0, scenes.findIndex(scene => scene.sceneId === chooseInitiatingSentence(storyText)?.sceneId));
  const lower = String(sentence.text || '').toLowerCase();
  const words = storySentenceWords(sentence.text);
  if (words < 4 || words > 12) return true;
  if (sceneIdx >= 0 && sceneIdx <= eventIdx) return true;
  if (/^(look there|wow|oh no|got it|hello)[!\.]*$/i.test(sentence.text.trim())) return true;
  if (/(watched|watching|beautiful|smiled|whispered|agreed|realized|understood)\b/.test(lower)) return true;
  return !/(help|rescue|save|open|release|free|return|ran back|went back|search|looked for|pick|carry|hid|used|made|ask|follow|grab|catch|caught|capture|took|walk|went|ran)/.test(lower);
}

function storyArcScenes(storyText = '', seedScenes = []) {
  const scenes = parseStory(storyText || '');
  const sceneIds = scenes.map(scene => scene.sceneId);
  const usable = sceneIds.length ? sceneIds : ['SC01', 'SC02', 'SC03', 'SC04', 'SC05'];
  const validSeed = (seedScenes || []).map(sceneIdFromValue).filter(scene => usable.includes(scene));
  const uniqueSeed = [...new Set(validSeed)];
  if (uniqueSeed.length === 5) return uniqueSeed.sort((a, b) => usable.indexOf(a) - usable.indexOf(b));
  const eventScene = chooseInitiatingSentence(storyText)?.sceneId || sceneAtRatio(usable, .18) || usable[0];
  const attemptScene = chooseAttemptSentence(storyText)?.sceneId || sceneAtRatio(usable, .45) || eventScene;
  const reactionScene = scenes
    .map((scene, idx) => {
      const text = (scene.sentences || []).map(sentence => sentence.text).join(' ').toLowerCase();
      const score = ['sad', 'happy', 'afraid', 'worried', 'angry', 'surprised', 'terrible', 'smile', 'cried', 'groaned', 'realized']
        .reduce((sum, word) => sum + (text.includes(word) ? 3 : 0), 0)
        + (idx > Math.max(0, usable.indexOf(eventScene)) ? 2 : 0);
      return { sceneId: scene.sceneId, score };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.sceneId || sceneAtRatio(usable, .7) || usable[usable.length - 1];
  const preferred = [
    usable[0],
    eventScene,
    attemptScene,
    reactionScene,
    usable[usable.length - 1],
    ...validSeed,
    sceneAtRatio(usable, .25),
    sceneAtRatio(usable, .5),
    sceneAtRatio(usable, .75)
  ];
  const out = [];
  const add = scene => {
    const normalized = sceneIdFromValue(scene);
    if (normalized && usable.includes(normalized) && !out.includes(normalized)) out.push(normalized);
  };
  preferred.forEach(add);
  usable.forEach(add);
  const sorted = out.sort((a, b) => usable.indexOf(a) - usable.indexOf(b)).slice(0, Math.min(5, usable.length));
  while (sorted.length < 5) sorted.push(sorted[sorted.length - 1] || usable[0]);
  return sorted;
}

function sceneOptionsAround(storyText = '', correctScene = '', count = 4) {
  const scenes = parseStory(storyText || '').map(scene => scene.sceneId);
  const correctIndex = Math.max(0, scenes.indexOf(correctScene));
  const ordered = [correctScene];
  for (let dist = 1; ordered.length < count && dist <= scenes.length; dist += 1) {
    [correctIndex - dist, correctIndex + dist].forEach(idx => {
      if (idx >= 0 && idx < scenes.length && !ordered.includes(scenes[idx]) && ordered.length < count) ordered.push(scenes[idx]);
    });
  }
  scenes.forEach(scene => {
    if (ordered.length < count && !ordered.includes(scene)) ordered.push(scene);
  });
  return ordered.filter(Boolean).slice(0, count).sort((a, b) => scenes.indexOf(a) - scenes.indexOf(b));
}

function settingInteractionLooksWeak(interaction = {}) {
  const items = interaction.items || [];
  if (items.length !== 6) return true;
  const texts = items.map(item => String(item.text || item.key || '').trim().toLowerCase());
  if (texts.some(placeholderText)) return true;
  if (new Set(texts).size < 6) return true;
  const correct = interaction.correct || {};
  return !correct.who || !correct.where || !correct.at_first;
}

function characterFromInstruction(instruction = '') {
  const match = String(instruction || '').match(/^How does\s+(.+?)\s+feel here\?$/i)
    || String(instruction || '').match(/^What is\s+(.+?)\s+thinking\?$/i);
  return match ? match[1].trim() : '';
}

function fixCharacterInstructionForScene(q, storyText = '') {
  const scene = q.resources?.scene || sceneIdFromPath(q.resources?.images?.[0]?.path);
  const sceneText = sceneTextById(storyText, scene);
  if (!sceneText) return;
  const currentName = characterFromInstruction(q.instruction);
  if (currentName && !/^the character$/i.test(currentName) && !sceneText.toLowerCase().includes(currentName.toLowerCase())) {
    const inferred = storyNamesFromText(sceneText).split(' and ')[0];
    if (inferred && inferred !== 'the character') {
      q.instruction = q.type === 'emotion_mcq' ? `How does ${inferred} feel here?` : `What is ${inferred} thinking?`;
    } else {
      q.instruction = q.type === 'emotion_mcq' ? 'How does the character feel here?' : 'What is the character thinking?';
    }
  }
}

function ensurePartialOptionScores(q) {
  if (!Array.isArray(q?.interaction?.options)) return;
  const needsPartial = q.type === 'emotion_mcq' || q.type === 'internal_response_mcq';
  q.interaction.options.forEach(opt => {
    opt.score = Math.max(0, Math.min(100, Number(opt.score) || 0));
    opt.isCorrect = opt.isCorrect || opt.score === 100 || opt.key === q.interaction.correct;
  });
  const correct = q.interaction.options.find(opt => opt.isCorrect) || q.interaction.options.find(opt => opt.score === 100);
  if (correct) {
    correct.score = 100;
    correct.isCorrect = true;
    q.interaction.correct = correct.key;
  }
  if (!needsPartial) return;
  const wrong = q.interaction.options.filter(opt => !opt.isCorrect);
  if (wrong.length && wrong.every(opt => Number(opt.score) === 0)) {
    wrong.forEach((opt, idx) => {
      opt.score = idx === 0 ? 40 : idx === 1 ? 20 : 0;
      opt.diagnostic = opt.diagnostic || (idx === 0
        ? 'Near-miss distractor: the scene clue is close, but the feeling or thought needs more precise checking.'
        : 'Distractor: the learner may be reading a surface clue without connecting it to the story grammar target.');
    });
  }
}

function ensureImageResourcesForQuiz(qz) {
  const storyId = qz?.story?.storyId || 'OG0000';
  const storyText = qz?.story?.text || '';
  const parsedScenes = parseStory(storyText || '').map(scene => scene.sceneId);
  (qz?.questions || []).forEach(q => {
    q.resources = q.resources || {};
    if (q.type === 'story_sequence_drag') {
      const seed = [
        ...(Array.isArray(q.interaction?.correct) ? q.interaction.correct : []),
        ...(Array.isArray(q.interaction?.items) ? q.interaction.items : []),
        ...(Array.isArray(q.resources?.images) ? q.resources.images.map(img => img.sceneId || img.id || img.path) : [])
      ];
      const sequence = storyArcScenes(storyText, seed);
      q.interaction = { ...(q.interaction || {}), promptMode: 'drag_sequence', items: sequence, correct: sequence };
      q.resources.images = sequence.map(scene => imageResourceForScene(storyId, scene));
      return;
    }
    const existing = Array.isArray(q.resources.images) ? q.resources.images : [];
    q.resources.images = existing
      .map(img => {
        const scene = sceneIdFromValue(img.sceneId) || sceneIdFromValue(img.id) || sceneIdFromPath(img.path);
        return scene ? { ...img, id: img.id || scene, sceneId: scene, path: img.path || `${storyId}_${scene}_I.webp` } : img;
      })
      .filter(img => img?.path || img?.sceneId || img?.id);
    if (q.resources.images.length) return;
    let scenes = [];
    if (q.type === 'story_sequence_drag') {
      scenes = (q.interaction?.correct || q.interaction?.items || []).map(sceneIdFromValue).filter(Boolean);
    } else if (q.type === 'setting_slot_drag') {
      const scene = sceneIdFromValue(q.resources?.scene) || parsedScenes[0];
      if (scene) scenes = [scene];
    } else if (q.type === 'listen_scene_mcq') {
      scenes = (q.interaction?.options || []).map(sceneIdFromOption).filter(Boolean);
      const audioScene = sceneIdFromValue(q.resources?.audio?.sceneId) || sceneIdFromPath(q.resources?.audio?.path);
      if (!scenes.length && audioScene) scenes = sceneOptionsAround(storyText, audioScene, 4);
    } else if (q.type === 'scene_word_unscramble') {
      const sentenceScene = sceneIdFromValue(q.resources?.scene) || sceneIdFromValue(q.resources?.sentenceId);
      const attemptScene = chooseAttemptSentence(storyText)?.sceneId;
      const scene = sentenceScene || attemptScene;
      if (scene) scenes = [scene];
    } else {
      const scene = sceneIdFromValue(q.resources?.scene) || sceneIdFromPath(q.resources?.images?.[0]?.path);
      if (scene) scenes = [scene];
    }
    if (scenes.length) q.resources.images = scenes.map(scene => imageResourceForScene(storyId, scene));
  });
  return qz;
}

function normalizeQuestionForTemplate(q, storyText = '') {
  const normalized = deepClone(q);
  normalized.storyGrammar = normalizeStoryGrammarKey(normalized.storyGrammar);
  if (normalized.type === 'story_sequence_drag') {
    const storyId = quiz?.story?.storyId || normalized.qId?.split('_V3_')?.[0] || 'OG0000';
    const seed = [
      ...(Array.isArray(normalized.interaction?.correct) ? normalized.interaction.correct : []),
      ...(Array.isArray(normalized.interaction?.items) ? normalized.interaction.items : []),
      ...(Array.isArray(normalized.resources?.images) ? normalized.resources.images.map(img => img.sceneId || img.id || img.path) : [])
    ];
    const sequence = storyArcScenes(storyText, seed);
    normalized.interaction = { ...(normalized.interaction || {}), promptMode: 'drag_sequence', correct: sequence, items: sequence };
    normalized.resources = { ...(normalized.resources || {}), images: sequence.map(scene => imageResourceForScene(storyId, scene)) };
    normalized.scoring = weightedPosition(sequence);
  }
  if (normalized.type === 'setting_slot_drag') {
    normalized.interaction = normalizeSettingInteraction(normalized.interaction || {});
    normalized.scoring = settingScoring(normalized.interaction.correct, normalized.interaction.slots);
  }
  if (normalized.type === 'listen_scene_mcq') {
    const storyId = quiz?.story?.storyId || normalized.qId?.split('_V3_')?.[0] || 'OG0000';
    const audioSentence = storySentenceById(storyText, normalized.resources?.audio?.sentenceId);
    if (!audioSentence || weakInitiatingSentence(audioSentence.text) || problemSignalScore(audioSentence.text) <= 0) {
      const better = chooseInitiatingSentence(storyText);
      if (better) {
        normalized.resources = normalized.resources || {};
        normalized.resources.audio = audioResourceForSentence(storyId, better);
        normalized.resources.images = sceneOptionsAround(storyText, better.sceneId, 4).map(scene => imageResourceForScene(storyId, scene));
        normalized.interaction = imageOptions((normalized.resources.images || []).map(img => img.sceneId), better.sceneId);
        normalized.hint = fallbackHint(normalized, storyText);
      }
    }
  }
  if (normalized.type === 'scene_word_unscramble') {
    let sentenceObj = storySentenceById(storyText, normalized.resources?.sentenceId);
    let sentence = sentenceObj?.text || '';
    if (!sentence || weakAttemptSentence(storyText, sentenceObj)) {
      const better = chooseAttemptSentence(storyText);
      if (better) {
        const storyId = quiz?.story?.storyId || normalized.qId?.split('_V3_')?.[0] || 'OG0000';
        normalized.resources = {
          ...(normalized.resources || {}),
          scene: better.sceneId,
          sentenceId: better.sentenceId,
          images: [imageResourceForScene(storyId, better.sceneId)]
        };
        sentence = better.text;
        sentenceObj = better;
      }
    }
    const source = sentence || (Array.isArray(normalized.interaction?.correct) ? normalized.interaction.correct.join(' ') : '');
    const tokens = storyWordTokens(source);
    if (tokens.length >= 3) {
      normalized.interaction = {
        ...(normalized.interaction || {}),
        promptMode: 'word_unscramble',
        correct: tokens,
        items: [...tokens].reverse()
      };
      normalized.scoring = wordScoring(tokens);
      if (genericHint(normalized, normalized.hint)) normalized.hint = fallbackHint(normalized, storyText);
    }
  }
  if (Array.isArray(normalized.interaction?.options)) {
    ensurePartialOptionScores(normalized);
    normalized.scoring = templateScoringForQuestion(normalized);
  }
  return normalized;
}

function placeholderText(value) {
  const text = String(value || '').trim().toLowerCase();
  return !text
    || ['main_character', 'main character', 'character', 'the character', 'the characgter', 'characgter', 'main_place', 'main place', 'story place', 'the story place', 'place', 'other character', 'first action', 'later problem', 'other place', 'opening_state', 'opening state', 'main action', 'later action'].includes(text)
    || /\bcharacgter\b/.test(text)
    || /\bas\s+\w+\s+as\b/.test(text)
    || /^card[_-]/.test(text)
    || /^item \d+$/.test(text);
}

function contaminatedHint(value, storyText = '') {
  const text = String(value || '').trim();
  const lower = text.toLowerCase();
  if (!text) return true;
  if (text.length > 120) return true;
  if (/(wait|example|specific for this story|let's make|do not|a1-level|prompt|template|instruction)/i.test(text)) return true;
  if (/[^\x00-\x7F]/.test(text)) return true;
  if (/milo/i.test(text) && !/milo/i.test(storyText || '')) return true;
  if (/podo|didi/i.test(text) && !/podo|didi/i.test(storyText || '')) return true;
  return false;
}

function genericHint(q = {}, value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  if (q.type === 'listen_scene_mcq' && /listen for the first (clear )?problem\.?$/.test(text)) return true;
  if (q.type === 'scene_word_unscramble' && /(start with who|find who|then find the action)/.test(text)) return true;
  if (q.type === 'emotion_mcq' && /(face|expression|what .* says|look at the face|smiling because|because the problem is solved|feels? happy because|answer is)/.test(text)) return true;
  if (q.type === 'internal_response_mcq' && /^think about what the character learns\.?$/.test(text)) return true;
  return false;
}

function contaminatedVisibleText(value, storyText = '') {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text.length > 140) return true;
  if (/(wait|example|specific for this story|let's make|do not|a1-level|prompt|template|json|schema|instruction)/i.test(text)) return true;
  if (/milo/i.test(text) && !/milo/i.test(storyText || '')) return true;
  return false;
}

function firstSceneText(storyText = '') {
  const scenes = parseStory(storyText || '');
  return (scenes[0]?.sentences || []).map(sentence => sentence.text).join(' ');
}

function storyNamesFromText(text = '') {
  const cleaned = String(text || '').replace(/["']/g, ' ');
  const namedMatch = cleaned.match(/\bnamed\s+([A-Z][a-z]+)(?:\s+and\s+([A-Z][a-z]+))?/);
  if (namedMatch) return [namedMatch[1], namedMatch[2]].filter(Boolean).join(' and ');
  const objectName = cleaned.match(/\b(the\s+[A-Z][a-z]+(?:\s+[a-z]+)?)/i);
  if (objectName) return objectName[1].replace(/\s+/g, ' ').replace(/^The\b/, 'the');
  const names = [...cleaned.matchAll(/\b[A-Z][a-z]{2,}\b/g)]
    .map(match => match[0])
    .filter(word => !['The','A','An','On','In','At','One','Once','Long','Deep','Suddenly','But'].includes(word));
  return [...new Set(names)].slice(0, 2).join(' and ') || 'the character';
}

function storyPlaceFromText(text = '') {
  const source = String(text || '');
  if (/Tiny Rock/i.test(source)) return 'on Tiny Rock';
  if (/dark canyon/i.test(source)) return 'in the dark canyon';
  if (/forest/i.test(source)) return 'in the forest';
  if (/\bocean\b/i.test(source)) return 'in the ocean';
  if (/\bsea\b/i.test(source)) return 'in the sea';
  if (/\bmill\b/i.test(source)) return 'at the mill';
  if (/\bhome\b|\bhouse\b/i.test(source)) return 'at home';
  const match = source.match(/\b(in|at|on|near|inside|into|under|over)\s+(the\s+|a\s+|an\s+)?([A-Za-z]+(?:\s+[A-Za-z]+){0,3})/);
  if (!match) return '';
  const phrase = `${match[1].toLowerCase()} ${match[2] || ''}${match[3]}`.replace(/\s+/g, ' ').replace(/\s+of$/i, '').trim();
  return placeholderText(phrase) ? '' : phrase;
}

function openingStateFromText(text = '') {
  const sentence = String(text || '').split(/[.!?]/)[0] || '';
  const namedSubject = storyNamesFromText(sentence);
  if (namedSubject && namedSubject !== 'the character') {
    const escaped = namedSubject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const subjectMatch = sentence.match(new RegExp(`^\\s*${escaped}\\s+(.+)$`, 'i'));
    if (subjectMatch?.[1]) {
      const phrase = subjectMatch[1]
        .replace(/\b(in|at|on|near|inside|into)\s+(the\s+|a\s+|an\s+)?[A-Za-z]+(?:\s+[A-Za-z]+){0,3}$/i, '')
        .trim();
      return phrase.replace(/^[A-Z]/, ch => ch.toLowerCase());
    }
  }
  const afterComma = sentence.includes(',') ? sentence.split(',').slice(1).join(',').trim() : sentence.trim();
  const directSubject = afterComma.match(/^The\s+[A-Z][a-z]+(?:\s+(?:submarine|cat|fish|boy|girl|son|man|woman|friend|cloud|box|ship|robot|dog))?\s+(.+)$/)
    || afterComma.match(/^[A-Z][a-z]+(?:\s+and\s+[A-Z][a-z]+)?\s+(.+)$/);
  if (directSubject?.[1]) {
    const phrase = directSubject[1]
      .replace(/\b(in|at|on|near|inside|into)\s+(the\s+|a\s+|an\s+)?[A-Za-z]+(?:\s+[A-Za-z]+){0,3}$/i, '')
      .trim();
    if (phrase && storySentenceWords(phrase) <= 6) return phrase.replace(/^[A-Z]/, ch => ch.toLowerCase());
  }
  const words = afterComma.split(/\s+/).filter(Boolean);
  if (words.length <= 4) return afterComma.toLowerCase() || 'starts the story';
  return words.slice(Math.max(0, words.length - 4)).join(' ').replace(/^[A-Z]/, ch => ch.toLowerCase());
}

function storyPlacesFromText(text = '') {
  const places = [...String(text || '').matchAll(/\b(in|at|on|near|inside|into|under|over)\s+(the\s+|a\s+|an\s+)?([a-z]+(?:\s+[a-z]+){0,3})/gi)]
    .map(match => `${match[1].toLowerCase()} ${match[2] || ''}${match[3]}`.replace(/\s+/g, ' ').trim())
    .filter(place => storySentenceWords(place) <= 5 && !/\bof$|\bas black\b|\bas white\b/i.test(place) && !placeholderText(place));
  return [...new Set(places)];
}

function storyActionPhrases(storyText = '') {
  const phrases = [];
  parseStory(storyText || '').forEach(scene => {
    (scene.sentences || []).forEach(sentence => {
      const phrase = openingStateFromText(sentence.text);
      if (phrase && !placeholderText(phrase) && phrase.length <= 45) phrases.push(phrase);
    });
  });
  return [...new Set(phrases)];
}

function firstSafe(values = [], fallback = '') {
  return values.find(value => value && !placeholderText(value) && !contaminatedVisibleText(value, '')) || fallback;
}

function openingCharacterFromText(storyText = '') {
  const opening = firstSceneText(storyText);
  const who = storyNamesFromText(opening);
  const nonCharacter = /\b(planet|place|forest|ocean|sea|canyon|sky|light|cloud|room|house|home|mill|rock|gold)\b/i;
  if (who && !placeholderText(who) && !nonCharacter.test(who)) return who;
  const whole = storyNamesFromText(storyText);
  if (whole && !placeholderText(whole) && !nonCharacter.test(whole)) return whole;
  const titleLike = String(storyText || '').match(/\b(?:named\s+)?([A-Z][a-z]+)(?:\s+and\s+([A-Z][a-z]+))?\b/);
  return [titleLike?.[1], titleLike?.[2]].filter(Boolean).join(' and ') || 'someone';
}

function storyCharacterCandidates(storyText = '') {
  const source = String(storyText || '');
  const nonCharacter = /\b(planet|place|forest|ocean|sea|canyon|sky|light|cloud|room|house|home|mill|rock|gold|box|net|bag)\b/i;
  const candidates = [];
  const named = source.match(/\bnamed\s+([A-Z][a-z]+)(?:\s+and\s+([A-Z][a-z]+))?/);
  if (named) candidates.push(...[named[1], named[2]].filter(Boolean));
  [...source.matchAll(/\b[A-Z][a-z]{2,}\b/g)]
    .map(match => match[0])
    .filter(word => !['The','A','An','On','In','At','One','Once','Long','Deep','Suddenly','But','With','It','He','She','They','This','Indeed'].includes(word))
    .filter(word => !nonCharacter.test(word))
    .forEach(word => candidates.push(word));
  [...source.matchAll(/\b(?:a|an|the)\s+(boy|girl|cat|dog|fish|son|man|woman|friend|butterfly|bird|king|queen|child|father|mother)\b/gi)]
    .map(match => match[0].toLowerCase())
    .forEach(value => candidates.push(value));
  return [...new Set(candidates)].filter(value => value && !placeholderText(value));
}

function settingFallbackPlaces(storyText = '') {
  const text = String(storyText || '');
  const candidates = [
    storyPlaceFromText(firstSceneText(storyText)),
    ...storyPlacesFromText(text),
    /Tiny Rock/i.test(text) ? 'on Tiny Rock' : '',
    /forest/i.test(text) ? 'in the forest' : '',
    /dark canyon/i.test(text) ? 'in the dark canyon' : '',
    /ocean/i.test(text) ? 'in the ocean' : '',
    /sea/i.test(text) ? 'in the sea' : '',
    /mill/i.test(text) ? 'at the mill' : '',
    /home|house/i.test(text) ? 'at home' : ''
  ].filter(value => value && !placeholderText(value));
  return [...new Set(candidates.map(value => String(value).trim()))];
}

function settingFallbackActions(storyText = '') {
  const opening = openingStateFromText(firstSceneText(storyText));
  const actions = [
    opening,
    ...storyActionPhrases(storyText)
  ]
    .map(value => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(value => value && !placeholderText(value) && storySentenceWords(value) <= 6 && /\b(love|watch|spend|go|walk|move|follow|look|search|play|live|sit|stand|swim|start|begin|ride|carry|hold|work|help|want|need|have|make|try|run|fly|vanish|disappear|lose|lost|fall|fell|break|broke|stop)\w*\b/i.test(value));
  return [...new Set(actions)];
}

function fallbackSettingInteraction(storyText = '') {
  const opening = firstSceneText(storyText);
  const who = openingCharacterFromText(storyText);
  const places = settingFallbackPlaces(storyText);
  const where = firstSafe(places, 'in the story');
  const actions = settingFallbackActions(storyText);
  const atFirst = firstSafe(actions, 'starts the story');
  const allNames = storyCharacterCandidates(storyText);
  const otherName = allNames.find(name => !who.toLowerCase().includes(name.toLowerCase())) || (/friend/i.test(storyText) ? 'a friend' : 'someone else');
  const otherPlace = places.find(place => place.toLowerCase() !== where.toLowerCase()) || (/home|house/i.test(storyText) && where !== 'at home' ? 'at home' : 'outside');
  const otherAction = actions.find(action => action.toLowerCase() !== atFirst.toLowerCase()) || 'has a problem';
  const distractors = [
    { key: 'other_character', text: otherName, slot: 'who' },
    { key: 'other_place', text: otherPlace, slot: 'where' },
    { key: 'later_event', text: otherAction, slot: 'at_first' }
  ];
  return normalizeSettingInteraction({
    promptMode: 'slot_drag',
    slots: [
      { key: 'who', label: 'Who?', correct: 'setting_who' },
      { key: 'where', label: 'Where?', correct: 'setting_where' },
      { key: 'at_first', label: 'At first...', correct: 'setting_first' }
    ],
    items: [
      { key: 'setting_who', text: who, slot: 'who' },
      { key: 'setting_where', text: where, slot: 'where' },
      { key: 'setting_first', text: atFirst, slot: 'at_first' },
      ...distractors
    ],
    correct: { who: 'setting_who', where: 'setting_where', at_first: 'setting_first' }
  });
}

function possessiveName(name = 'the character') {
  const cleaned = String(name || 'the character').trim() || 'the character';
  if (/^the character$/i.test(cleaned)) return 'the character\'s';
  return cleaned.endsWith('s') ? `${cleaned}'` : `${cleaned}'s`;
}

function initiatingHint(storyText = '', sentence = null) {
  const text = String(sentence?.text || '').toLowerCase();
  if (/lost|missing|vanished|disappeared/.test(text)) return 'Listen for what is lost.';
  if (/\bonly\b.*\bcat\b|\bcat\b.*\bonly\b/.test(text)) return 'Listen for the youngest man\'s problem.';
  if (/plastic|trash|bag|danger/.test(text)) return 'Listen for the danger in the sea.';
  if (/dark|canyon|lost light/.test(text)) return 'Listen for the problem in the dark place.';
  if (/heavy|gold/.test(text)) return 'Listen for the problem with the heavy gold.';
  if (/capture|captured|caught|trapped|grabbed|keep|own|must have|will capture/.test(text)) return 'Listen for the problem about keeping it.';
  return 'Listen for the story problem.';
}

function attemptHint(q = {}, storyText = '') {
  const sentence = storySentenceById(storyText, q.resources?.sentenceId);
  const text = String(sentence?.text || storySentenceTextById(storyText, q.resources?.sentenceId) || '').toLowerCase();
  const sceneText = sceneTextById(storyText, q.resources?.scene || sentence?.sceneId || '');
  const name = storyNamesFromText(sentence?.text || sceneText || firstSceneText(storyText)).split(' and ')[0] || 'the character';
  if (/hid/.test(text)) return 'Build the sentence about hiding.';
  if (/help|rescue|save/.test(text)) return 'Build the sentence about helping.';
  if (/walk|went|go|ran|rush/.test(text)) return `Build the sentence about where ${name} goes.`;
  if (/follow/.test(text)) return 'Build the sentence about following.';
  if (/open/.test(text)) return 'Build the sentence about opening it.';
  if (/catch|caught|capture|grab/.test(text)) return 'Build the sentence about catching it.';
  return `Put ${possessiveName(name)} action in order.`;
}

function emotionHint(q = {}, storyText = '') {
  const scene = q.resources?.scene || sceneIdFromPath(q.resources?.images?.[0]?.path);
  const text = sceneTextById(storyText, scene).toLowerCase();
  const name = characterFromInstruction(q.instruction) || storyNamesFromText(text || firstSceneText(storyText)).split(' and ')[0] || 'the character';
  const subject = /^the character$/i.test(name) ? 'the character' : name;
  if (/danger|plastic|trash|bag|stuck|trapped/.test(text)) return `${subject} is near danger. How does ${/^the character$/i.test(subject) ? 'the character' : subject} feel?`;
  if (/terrible|dark|dull|dim|lost|sad|cry|cried|wrong/.test(text)) return 'Something goes wrong. How does the character feel?';
  if (/happy|smile|smiled|free|safe|saved/.test(text)) return 'Look at what happens now. How does the character feel?';
  return 'Look at the scene. How does the character feel?';
}

function internalHint(q = {}, storyText = '') {
  const scene = q.resources?.scene || sceneIdFromPath(q.resources?.images?.[0]?.path);
  const text = sceneTextById(storyText, scene);
  const name = storyNamesFromText(text || firstSceneText(storyText)).split(' and ')[0] || 'the character';
  if (/realized|understood|learned|mistake|belongs|freely|free/i.test(text)) return `Think about what ${name} learns.`;
  return `Think about what ${name} understands.`;
}

function fallbackHint(q, storyText = '') {
  const opening = firstSceneText(storyText);
  const who = storyNamesFromText(opening);
  if (q.type === 'story_sequence_drag') {
    const name = who && who !== 'the character' ? who : 'the character';
    const plural = /\sand\s/.test(name);
    return `${name} ${plural ? 'have' : 'has'} a problem and ${plural ? 'try' : 'tries'} to fix it.`;
  }
  if (q.type === 'setting_slot_drag') {
    const plural = /\sand\s/.test(who);
    return plural ? 'Who is there? Where are they?' : 'Who is there? Where does the story start?';
  }
  if (q.type === 'listen_scene_mcq') return initiatingHint(storyText, storySentenceById(storyText, q.resources?.audio?.sentenceId) || chooseInitiatingSentence(storyText));
  if (q.type === 'scene_word_unscramble') return attemptHint(q, storyText);
  if (q.type === 'emotion_mcq') return emotionHint(q, storyText);
  if (q.type === 'internal_response_mcq') return internalHint(q, storyText);
  return 'Look at the story clues.';
}

function reconcileQuizResourcesWithPackage(qz) {
  if (!qz || !currentStoryPackage) return qz;
  qz.assets = qz.assets || {};
  if (currentStoryPackage.backgroundFile) qz.assets.backgroundImage = currentStoryPackage.backgroundFile.name;
  if (currentStoryPackage.coverFiles?.[0]) qz.assets.coverImage = currentStoryPackage.coverFiles[0].name;
  (qz.questions || []).forEach(q => {
    q.resources = q.resources || {};
    if (Array.isArray(q.resources.images)) {
      q.resources.images.forEach(img => {
        const scene = (img.sceneId || img.id || sceneIdFromPath(img.path) || '').toUpperCase();
        const file = packageImageFileForScene(scene);
        if (file) {
          img.path = file.name;
          img.sceneId = scene;
          img.id = img.id || scene;
        }
      });
    }
    const scene = q.resources.scene || sceneIdFromPath(q.resources?.images?.[0]?.path);
    if ((!q.resources.images || !q.resources.images.length) && scene) {
      const file = packageImageFileForScene(scene);
      if (file) q.resources.images = [{ id: scene, path: file.name, kind: 'image', sceneId: scene }];
    }
    const audio = q.resources.audio;
    if (audio) {
      const audioId = (audio.id || sentenceAudioIdFromPath(audio.path) || `${audio.sceneId || ''}_${audio.sentenceId || ''}_A`).toUpperCase();
      const file = packageAudioFileForId(audioId);
      if (file) audio.path = file.name;
    }
  });
  return qz;
}

function sanitizeGeneratedQuiz(qz) {
  if (!qz) return qz;
  const storyText = qz.story?.text || '';
  (qz.questions || []).forEach(q => {
    q.storyGrammar = normalizeStoryGrammarKey(q.storyGrammar);
    if (contaminatedHint(q.hint, storyText) || genericHint(q, q.hint)) q.hint = fallbackHint(q, storyText);
    if (q.type === 'story_sequence_drag') {
      const storyId = qz.story?.storyId || 'OG0000';
      const seed = [
        ...(Array.isArray(q.interaction?.correct) ? q.interaction.correct : []),
        ...(Array.isArray(q.interaction?.items) ? q.interaction.items : []),
        ...(Array.isArray(q.resources?.images) ? q.resources.images.map(img => img.sceneId || img.id || img.path) : [])
      ];
      const sequence = storyArcScenes(storyText, seed);
      q.interaction = { ...(q.interaction || {}), promptMode: 'drag_sequence', correct: sequence, items: sequence };
      q.resources = { ...(q.resources || {}), images: sequence.map(scene => imageResourceForScene(storyId, scene)) };
      q.scoring = weightedPosition(sequence);
    }
    if (q.type === 'setting_slot_drag') {
      const items = q.interaction?.items || [];
      const placeholderCount = items.filter(item => placeholderText(item.text || item.key)).length;
      const dirtyItem = items.some(item => contaminatedVisibleText(item.text || item.key, storyText));
      if (settingInteractionLooksWeak(q.interaction || {}) || placeholderCount >= Math.ceil(items.length / 2) || dirtyItem) {
        q.interaction = fallbackSettingInteraction(storyText);
      }
      q.interaction = normalizeSettingInteraction(q.interaction || {});
      q.scoring = settingScoring(q.interaction.correct, q.interaction.slots);
    }
    if (q.type === 'listen_scene_mcq') {
      const sentence = storySentenceById(storyText, q.resources?.audio?.sentenceId);
      if (!sentence || weakInitiatingSentence(sentence.text) || problemSignalScore(sentence.text) <= 0) {
        const storyId = qz.story?.storyId || 'OG0000';
        const better = chooseInitiatingSentence(storyText);
        if (better) {
          q.resources = q.resources || {};
          q.resources.audio = audioResourceForSentence(storyId, better);
          q.resources.images = sceneOptionsAround(storyText, better.sceneId, 4).map(scene => imageResourceForScene(storyId, scene));
          q.interaction = imageOptions((q.resources.images || []).map(img => img.sceneId), better.sceneId);
          q.scoring = templateScoringForQuestion(q);
          q.hint = fallbackHint(q, storyText);
        }
      }
    }
    if (q.type === 'scene_word_unscramble') {
      const sentence = storySentenceById(storyText, q.resources?.sentenceId);
      if (!sentence || weakAttemptSentence(storyText, sentence)) {
        const storyId = qz.story?.storyId || 'OG0000';
        const better = chooseAttemptSentence(storyText);
        if (better) {
          const tokens = storyWordTokens(better.text);
          q.resources = { ...(q.resources || {}), scene: better.sceneId, sentenceId: better.sentenceId, images: [imageResourceForScene(storyId, better.sceneId)] };
          q.interaction = { promptMode: 'word_unscramble', correct: tokens, items: [...tokens].reverse() };
          q.scoring = wordScoring(tokens);
          q.hint = fallbackHint(q, storyText);
        }
      }
      if (Array.isArray(q.interaction?.correct) && q.interaction.correct.length) q.scoring = wordScoring(q.interaction.correct);
      if (genericHint(q, q.hint)) q.hint = fallbackHint(q, storyText);
    }
    if ((q.type === 'emotion_mcq' || q.type === 'internal_response_mcq') && Array.isArray(q.interaction?.options)) {
      const dirtyOption = q.interaction.options.some(opt => contaminatedVisibleText(opt.text || opt.key, storyText));
      if (dirtyOption) {
        q.interaction = q.type === 'emotion_mcq' ? emotionOptions() : internalOptions();
        q.scoring = templateScoringForQuestion(q);
      }
      ensurePartialOptionScores(q);
      q.scoring = templateScoringForQuestion(q);
      fixCharacterInstructionForScene(q, storyText);
      if (genericHint(q, q.hint)) q.hint = fallbackHint(q, storyText);
    }
    normalizeDiagnosticsForQuestion(q);
  });
  return reconcileQuizResourcesWithPackage(ensureImageResourcesForQuiz(qz));
}

function completeGeneratedQuiz(generatedQuiz, row = {}) {
  const base = quizFromBatchRow(normalizeBatchRow(row, 0));
  const incoming = applyDefaultAssetsToQuiz(generatedQuiz, row);
  const incomingQuestions = incoming.questions || [];
  const completed = deepClone(base);
  completed.schemaVersion = incoming.schemaVersion || base.schemaVersion;
  completed.story = { ...base.story, ...(incoming.story || {}) };
  completed.assets = { ...base.assets, ...(incoming.assets || {}) };
  completed.storyGrammarAxes = Object.keys(SG_LABELS).map(key => ({ key, labelEn: SG_LABELS[key], labelKo: SG_KO[key], descriptionKo: '' }));
  completed.questions = base.questions.map(baseQ => {
    const aiQ = bestAiQuestionForTemplate(baseQ, incomingQuestions);
    return mergeQuestionDraft(baseQ, aiQ);
  }).map(q => normalizeQuestionForTemplate(q, completed.story?.text || row.story_text || ''));
  completed.reporting = incoming.reporting || base.reporting;
  completed.generation = incoming.generation || base.generation;
  return sanitizeGeneratedQuiz(applyDefaultAssetsToQuiz(completed, row));
}

async function callOpenAiInBrowser(prompt, userPayload, apiKey) {
  if (!apiKey) throw new Error('Enter an OpenAI API key.');
  const body = {
    model: OPENAI_MODEL,
    input: [
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify(userPayload) }
    ],
    text: { format: { type: 'json_object' } }
  };
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `OpenAI HTTP ${res.status}`);
  let text = data.output_text || '';
  if (!text && Array.isArray(data.output)) {
    text = data.output.flatMap(item => item.content || [])
      .filter(content => content.type === 'output_text' || content.type === 'text')
      .map(content => content.text || '')
      .join('');
  }
  return extractJsonFromText(text);
}

async function callGeminiInBrowser(prompt, userPayload, apiKey) {
  if (!apiKey) throw new Error('Enter a Gemini API key.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{
      role: 'user',
      parts: [{ text: `${prompt}\n\nINPUT:\n${JSON.stringify(userPayload)}` }]
    }],
    generationConfig: { responseMimeType: 'application/json' }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Gemini HTTP ${res.status}`);
  const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
  return extractJsonFromText(text);
}

async function callAiInBrowser(provider, prompt, userPayload, apiKey) {
  return provider === 'gemini'
    ? callGeminiInBrowser(prompt, userPayload, apiKey)
    : callOpenAiInBrowser(prompt, userPayload, apiKey);
}

async function requestAiQuizOnce(payload, apiKey) {
  if (isLocalOrigin()) {
    const res = await fetch('/api/generate-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'AI generation failed.');
    return data.quiz;
  }
  const prompt = await loadGenerationPrompt();
  return callAiInBrowser(payload.provider, prompt, payload.input, apiKey);
}

function generationQualityIssues(qz) {
  const issues = [];
  const storyText = qz?.story?.text || '';
  const q1 = qz?.questions?.find(q => Number(q.number) === 1);
  const q2 = qz?.questions?.find(q => Number(q.number) === 2);
  const q3 = qz?.questions?.find(q => Number(q.number) === 3);
  const q4 = qz?.questions?.find(q => Number(q.number) === 4);
  const q5 = qz?.questions?.find(q => Number(q.number) === 5);
  const q6 = qz?.questions?.find(q => Number(q.number) === 6);
  if (q1 && (contaminatedHint(q1.hint, storyText) || genericHint(q1, q1.hint))) issues.push('Q1 hint contains prompt/example text or is missing.');
  if (q1 && (q1.interaction?.correct || []).length !== 5) issues.push('Q1 must use exactly five story-arc scenes.');
  if (q2 && settingInteractionLooksWeak(q2.interaction || {})) issues.push('Q2 setting cards must contain six real story-specific cards.');
  if (q3) {
    const sentence = storySentenceById(storyText, q3.resources?.audio?.sentenceId);
    if (!sentence || weakInitiatingSentence(sentence.text) || problemSignalScore(sentence.text) <= 0) issues.push('Q3 audio sentence must identify the central problem, not just an early scene.');
    if (genericHint(q3, q3.hint)) issues.push('Q3 hint is too generic for the selected problem.');
  }
  if (q4) {
    const sentence = storySentenceById(storyText, q4.resources?.sentenceId);
    if (!sentence || weakAttemptSentence(storyText, sentence)) issues.push('Q4 sentence must show a character action used to handle or solve the problem.');
    const correct = q4.interaction?.correct || [];
    if (sentence && /[.!?]$/.test(sentence.text.trim()) && !/[.!?]$/.test(String(correct[correct.length - 1] || ''))) {
      issues.push('Q4 final punctuation is missing from the last word card.');
    }
    if (genericHint(q4, q4.hint)) issues.push('Q4 hint is too generic for the selected action sentence.');
  }
  if (q5) {
    const name = characterFromInstruction(q5.instruction);
    const scene = q5.resources?.scene || sceneIdFromPath(q5.resources?.images?.[0]?.path);
    if (name && !/^the character$/i.test(name) && scene && !sceneTextById(storyText, scene).toLowerCase().includes(name.toLowerCase())) {
      issues.push('Q5 named character does not match the selected scene.');
    }
    if ((q5.interaction?.options || []).filter(opt => !opt.isCorrect).every(opt => Number(opt.score) === 0)) {
      issues.push('Q5 needs at least one partial-score distractor.');
    }
    if (genericHint(q5, q5.hint)) issues.push('Q5 hint must use scene context, not invisible face/speech cues.');
  }
  if (q6) {
    if ((q6.interaction?.options || []).filter(opt => !opt.isCorrect).every(opt => Number(opt.score) === 0)) {
      issues.push('Q6 needs at least one partial-score distractor.');
    }
    if (genericHint(q6, q6.hint)) issues.push('Q6 hint is too generic for the selected internal response.');
  }
  return issues;
}

async function loadSample() {
  try {
    const res = await fetch('samples/OG0021_v3.quiz.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    quiz = await res.json();
  } catch (error) {
    toast('Sample file could not be loaded.');
    console.error(error);
    return;
  }
  currentStoryPackage = null;
  renderResourceSummary(null);
  if ($('package-status')) $('package-status').textContent = 'Sample loaded. Upload a story folder to replace it.';
  currentBatchIndex = -1;
  syncStoryInputs();
  currentQuestionIndex = 0;
  renderAll();
  toast('OG0021 sample loaded.');
}

function syncStoryInputs() {
  if (!quiz) return;
  $('story-id').value = quiz.story.storyId || '';
  $('story-title').value = quiz.story.title || '';
  $('story-level').value = quiz.story.level || '';
  $('story-text').value = quiz.story.text || '';
}

function renderAll() {
  if (!quiz) return;
  $('schema-pill').textContent = quiz.schemaVersion || 'quiz-v3.0';
  renderQuestionNav();
  renderQuestionSelect();
  renderPreview();
  renderEditor();
  renderBatchList();
  renderReviewPanel();
}

function showLeftSection(mode = 'generate') {
  const isGenerate = mode === 'generate';
  $('left-tab-generate')?.classList.toggle('active', isGenerate);
  $('left-tab-open')?.classList.toggle('active', !isGenerate);
  $('left-section-generate')?.classList.toggle('active', isGenerate);
  $('left-section-open')?.classList.toggle('active', !isGenerate);
}

function renderQuestionNav() {
  const nav = $('preview-nav');
  nav.innerHTML = '';
  quiz.questions.forEach((q, idx) => {
    const btn = document.createElement('button');
    btn.className = `q-dot${idx === currentQuestionIndex ? ' active' : ''}`;
    btn.textContent = q.number || idx + 1;
    btn.onclick = () => {
      currentQuestionIndex = idx;
      renderAll();
    };
    nav.appendChild(btn);
  });
}

function renderQuestionSelect() {
  const select = $('question-select');
  const previous = select.value;
  select.innerHTML = '';
  quiz.questions.forEach((q, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = `Q${q.number || idx + 1}`;
    select.appendChild(opt);
  });
  select.value = quiz.questions[Number(previous)] ? previous : String(currentQuestionIndex);
}

function assetUrl(path, kind = 'image') {
  if (!quiz || !path) return '';
  const localAsset = findLocalAssetUrl(path);
  if (localAsset) return localAsset;
  if (/^(https?:|data:|blob:|\/)/.test(path)) return path;
  if (String(path).includes('/')) return path;
  const base = kind === 'audio' ? quiz.assets.audioBasePath : quiz.assets.imageBasePath;
  const joined = `${base || ''}${path}`;
  return findLocalAssetUrl(joined) || joined;
}

function fileName(pathValue) {
  return String(pathValue || '').split(/[\\/]/).pop();
}

function basename(pathValue) {
  return fileName(pathValue).toLowerCase();
}

function assetStem(pathValue) {
  return basename(pathValue)
    .replace(/\.(png|jpe?g|webp|gif|mp3|wav|m4a|ogg)$/i, '')
    .replace(/_(?:\d{3,4}x\d{3,4}|[0-9]+p)$/i, '');
}

function assetCount() {
  return new Set([...assetFiles.values()].map(value => value.file)).size;
}

function findLocalAsset(pathValue) {
  if (!pathValue || !assetFiles.size) return '';
  const normalized = String(pathValue).replace(/\\/g, '/').toLowerCase();
  const name = basename(normalized);
  const stem = assetStem(normalized);
  if (assetFiles.has(normalized)) return assetFiles.get(normalized);
  if (assetFiles.has(name)) return assetFiles.get(name);
  if (stem && assetFiles.has(`stem:${stem}`)) return assetFiles.get(`stem:${stem}`);
  for (const [key, value] of assetFiles.entries()) {
    if (key.startsWith('stem:')) continue;
    if (key.endsWith('/' + name) || normalized.endsWith('/' + key)) return value;
    if (stem && assetStem(key) === stem) return value;
  }
  return null;
}

function findLocalAssetUrl(pathValue) {
  return findLocalAsset(pathValue)?.url || '';
}

function findLocalAssetFile(pathValue) {
  return findLocalAsset(pathValue)?.file || null;
}

function resolvedAssetFileName(pathValue) {
  return findLocalAssetFile(pathValue)?.name || fileName(pathValue);
}

function sceneIdFromPath(pathValue) {
  const match = String(pathValue || '').match(/(SC\d{2})/i);
  return match ? match[1].toUpperCase() : '';
}

function sceneIdFromValue(value) {
  const text = String(value || '').trim();
  if (/^SC\d{2}$/i.test(text)) return text.toUpperCase();
  return sceneIdFromPath(text);
}

function sceneIdFromOption(opt = {}) {
  return sceneIdFromValue(opt.sceneId)
    || sceneIdFromValue(opt.id)
    || sceneIdFromValue(opt.value)
    || sceneIdFromValue(opt.path)
    || sceneIdFromValue(opt.text);
}

function sentenceAudioIdFromPath(pathValue) {
  const match = String(pathValue || '').match(/(SC\d{2}_ST\d{2}_N_A)/i);
  return match ? match[1].toUpperCase() : '';
}

function packageImageFileForScene(sceneId) {
  if (!sceneId || !currentStoryPackage?.sceneImages) return null;
  return currentStoryPackage.sceneImages.get(String(sceneId).toUpperCase()) || null;
}

function packageAudioFileForId(audioId) {
  if (!audioId || !currentStoryPackage?.audioFiles) return null;
  return currentStoryPackage.audioFiles.get(String(audioId).toUpperCase()) || null;
}

function imagesForQuestion(q) {
  const storyId = quiz?.story?.storyId || 'OG0000';
  const imageFor = scene => imageResourceForScene(storyId, scene);
  if (q?.type === 'story_sequence_drag') {
    const sequence = storyArcScenes(quiz?.story?.text || '', [
      ...(Array.isArray(q.interaction?.correct) ? q.interaction.correct : []),
      ...(Array.isArray(q.interaction?.items) ? q.interaction.items : []),
      ...(Array.isArray(q.resources?.images) ? q.resources.images.map(img => img.sceneId || img.id || img.path) : [])
    ]);
    return sequence.map(imageFor);
  }
  const normalizedImages = (Array.isArray(q?.resources?.images) ? q.resources.images : [])
    .map(img => {
      const scene = sceneIdFromValue(img?.sceneId) || sceneIdFromValue(img?.id) || sceneIdFromValue(img?.path);
      return scene ? { ...img, id: img.id || scene, sceneId: scene, path: img.path || `${storyId}_${scene}_I.webp` } : img;
    })
    .filter(img => img?.path || img?.sceneId || img?.id);
  if (normalizedImages.length) return normalizedImages;
  if (q?.type === 'story_sequence_drag') {
    const scenes = (q.interaction?.correct || q.interaction?.items || []).map(sceneIdFromValue).filter(Boolean);
    if (scenes.length) return scenes.map(imageFor);
  }
  if (q?.type === 'listen_scene_mcq') {
    const optionScenes = (q.interaction?.options || []).map(sceneIdFromOption).filter(Boolean);
    if (optionScenes.length) return optionScenes.map(imageFor);
    const audioScene = sceneIdFromValue(q.resources?.audio?.sceneId) || sceneIdFromPath(q.resources?.audio?.path);
    if (audioScene) return sceneOptionsAround(quiz?.story?.text || '', audioScene, 4).map(imageFor);
  }
  const scene = sceneIdFromValue(q?.resources?.scene) || sceneIdFromPath(q?.resources?.images?.[0]?.path);
  if (scene) return [imageFor(scene)];
  return [];
}

function imageHtml(resource, className = '') {
  const scene = sceneIdFromValue(resource?.sceneId) || sceneIdFromValue(resource?.id) || sceneIdFromPath(resource?.path) || 'Scene';
  const packageFile = packageImageFileForScene(scene);
  const fallbackPath = scene !== 'Scene' ? `${quiz?.story?.storyId || 'OG0000'}_${scene}_I.webp` : resource?.path;
  const url = (packageFile ? findLocalAssetUrl(packageFile.name) : '')
    || assetUrl(resource?.path || fallbackPath, 'image')
    || assetUrl(fallbackPath, 'image')
    || fallbackPath
    || '';
  return `<div class="scene-card ${className}">
    <img src="${escapeAttr(url)}" alt="${escapeAttr(scene)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
    <div class="scene-fallback" style="display:none">${escapeHtml(scene)}</div>
  </div>`;
}

function playPreviewAudio(pathValue) {
  const audioId = sentenceAudioIdFromPath(pathValue);
  const packageFile = packageAudioFileForId(audioId);
  const url = packageFile ? findLocalAssetUrl(packageFile.name) : assetUrl(pathValue, 'audio');
  if (!url) {
    toast('Audio file is missing.');
    return;
  }
  const audio = new Audio(url);
  audio.play().catch(error => {
    console.error(error);
    toast('Audio could not play. Check the audio file.');
  });
}

function renderPreview() {
  const stage = $('preview-stage');
  const bg = quiz.assets?.backgroundImage;
  const bgUrl = findLocalAssetUrl(bg) || bg;
  stage.style.setProperty('--preview-bg', bgUrl ? `url("${bgUrl}")` : 'linear-gradient(140deg,#F7F4FF,#EBF7FF)');
  const q = quiz.questions[currentQuestionIndex];
  const images = imagesForQuestion(q);
  const hintAvatarPath = quiz.assets?.hintCharacter || `../v3/${quiz.story?.storyId || 'OG0021'}/Assets/BKTK_Characters_Bookey.png`;
  const hintAvatar = findLocalAssetUrl(hintAvatarPath) || hintAvatarPath;
  const parts = [];
  parts.push(`<article class="quiz-card q-type-${escapeAttr(q.type || 'unknown')}">`);
  parts.push(`<div class="quiz-meta"><span class="q-badge">Q${q.number || currentQuestionIndex + 1}</span><span class="sg-tag">${escapeHtml(storyGrammarLabel(q.storyGrammar))}</span></div>`);
  parts.push(`<div class="instruction">${escapeHtml(q.instruction || '')}</div>`);
  const hintHtml = `<div class="hint-row"><img class="hint-avatar" src="${escapeAttr(hintAvatar)}" alt="Bookey"><span>${escapeHtml(q.hint || '')}</span></div>`;

  if (q.type === 'story_sequence_drag') {
    parts.push(`<div class="scene-grid">${images.map(img => imageHtml(img)).join('')}</div>`);
    parts.push(`<div class="sequence-slots">${(q.interaction?.correct || []).map((_, i) => `<div class="slot">Scene ${i + 1}</div>`).join('')}</div>`);
  } else if (q.type === 'setting_slot_drag') {
    parts.push(`<div class="scene-grid single">${images.slice(0, 1).map(img => imageHtml(img)).join('')}</div>`);
    parts.push(`<div class="setting-slots">${(q.interaction?.slots || []).map(slot => `<div class="setting-row"><div class="setting-label">${escapeHtml(slot.label)}</div><div class="slot">Drop here</div></div>`).join('')}</div>`);
    parts.push(`<div class="word-row">${(q.interaction?.items || []).map(item => `<div class="word-chip">${escapeHtml(item.text || item.key)}</div>`).join('')}</div>`);
  } else if (q.type === 'listen_scene_mcq') {
    const audio = q.resources?.audio;
    parts.push(`<button type="button" class="audio-chip" onclick="playPreviewAudio('${escapeAttr(audio?.path || '')}')">Listen</button>`);
    parts.push(`<div class="scene-grid">${images.map(img => imageHtml(img)).join('')}</div>`);
  } else if (q.type === 'scene_word_unscramble') {
    parts.push(`<div class="scene-grid single">${images.slice(0, 1).map(img => imageHtml(img)).join('')}</div>`);
    parts.push(`<div class="word-row">${(q.interaction?.items || []).map(word => `<div class="word-chip">${escapeHtml(word)}</div>`).join('')}</div>`);
  } else {
    parts.push(`<div class="scene-grid single">${images.slice(0, 1).map(img => imageHtml(img)).join('')}</div>`);
    parts.push(`<div class="option-grid">${(q.interaction?.options || []).map((opt, idx) => `<div class="option-chip"><span class="option-letter">${OPTION_LABELS[idx] || escapeHtml(opt.key || String(idx + 1))}</span><span class="option-text">${escapeHtml(opt.text || opt.key)}</span></div>`).join('')}</div>`);
  }

  parts.push(hintHtml);
  parts.push(`</article>`);
  stage.innerHTML = parts.join('');
}

function renderEditor() {
  const q = quiz.questions[currentQuestionIndex];
  $('question-select').value = String(currentQuestionIndex);
  $('sg-select').value = normalizeStoryGrammarKey(q.storyGrammar);
  $('type-select').value = q.type;
  $('review-status-select').value = q.reviewStatus || 'draft';
  $('cmci-design-intent-select').value = q.cmciDesignIntent || '';
  $('instruction-input').value = q.instruction || '';
  $('hint-input').value = q.hint || '';
  renderChoiceEditor(q);
  $('resources-json').value = JSON.stringify(q.resources || {}, null, 2);
  $('interaction-json').value = JSON.stringify(q.interaction || {}, null, 2);
  $('scoring-json').value = JSON.stringify(q.scoring || {}, null, 2);
  $('diagnostics-json').value = JSON.stringify(q.diagnostics || [], null, 2);
}

function renderChoiceEditor(q) {
  const box = $('choice-editor');
  if (!box) return;
  if (!q) {
    box.innerHTML = '<div class="choice-note">No question selected.</div>';
    updateWeightSummary(null);
    return;
  }
  if (Array.isArray(q.interaction?.options) && q.interaction.options.length) {
    box.innerHTML = `<div class="choice-table">${q.interaction.options.map((opt, idx) => `
      <div class="choice-row">
        <div class="choice-key">${OPTION_LABELS[idx] || escapeHtml(opt.key || String(idx + 1))}</div>
        <input value="${escapeAttr(opt.text || '')}" oninput="updateOptionText(${idx}, this.value)" aria-label="Option ${escapeAttr(opt.key || idx + 1)} text">
        <input type="number" min="0" max="100" step="1" value="${Number(opt.score) || 0}" oninput="updateOptionScore(${idx}, this.value)" aria-label="Option ${escapeAttr(opt.key || idx + 1)} score">
      </div>
    `).join('')}</div>`;
    updateWeightSummary(q);
    return;
  }
  if (q.type === 'setting_slot_drag' && Array.isArray(q.interaction?.items)) {
    const slotRows = (q.interaction?.slots || []).map(slot => `
      <div class="choice-row slot-weight-row">
        <div class="choice-key">${escapeHtml(slot.label || slot.key)}</div>
        <input value="${escapeAttr(q.interaction?.correct?.[slot.key] || slot.correct || '')}" readonly aria-label="${escapeAttr(slot.key)} correct item">
        <input type="number" min="0" max="5" step=".1" value="${Number(slot.weight) || 0}" oninput="updateSettingSlotWeight('${escapeAttr(slot.key)}', this.value)" aria-label="${escapeAttr(slot.key)} weight">
      </div>
    `).join('');
    box.innerHTML = `<div class="choice-table"><div class="choice-section">${q.interaction.items.map((item, idx) => `
      <div class="choice-row setting-row">
        <div class="choice-key">${idx + 1}</div>
        <input value="${escapeAttr(item.text || '')}" oninput="updateSettingItem(${idx}, 'text', this.value)" aria-label="Setting card ${idx + 1} text">
        <select onchange="updateSettingItem(${idx}, 'slot', this.value)" aria-label="Setting card ${idx + 1} slot">
          <option value="who"${item.slot === 'who' ? ' selected' : ''}>Who</option>
          <option value="where"${item.slot === 'where' ? ' selected' : ''}>Where</option>
          <option value="at_first"${item.slot === 'at_first' ? ' selected' : ''}>At first</option>
        </select>
        <input type="number" value="${slotWeightForSetting(q, item.slot)}" readonly aria-label="Linked slot weight">
      </div>
    `).join('')}</div><div class="choice-subhead">Slot weights</div><div class="choice-section">${slotRows}</div></div>`;
    updateWeightSummary(q);
    return;
  }
  if (q.type === 'scene_word_unscramble' && Array.isArray(q.interaction?.correct)) {
    const weightByKey = new Map((q.scoring?.components || []).map(c => [String(c.key), Number(c.weight) || 0]));
    box.innerHTML = `<div class="choice-table">${q.interaction.correct.map((word, idx) => `
      <div class="choice-row">
        <div class="choice-key">${idx + 1}</div>
        <input value="${escapeAttr(word)}" oninput="updateWordToken(${idx}, this.value)" aria-label="Word ${idx + 1}">
        <input type="number" min="0" max="5" step=".1" value="${weightByKey.get(String(word)) || 1}" oninput="updateWordWeight(${idx}, this.value)" aria-label="Word ${idx + 1} weight">
      </div>
    `).join('')}</div>`;
    updateWeightSummary(q);
    return;
  }
  if (q.type === 'story_sequence_drag') {
    const sequence = Array.isArray(q.interaction?.correct) ? q.interaction.correct : [];
    const weightByKey = new Map((q.scoring?.components || []).map(c => [String(c.key), Number(c.weight) || 0]));
    box.innerHTML = `<div class="choice-table">${sequence.map((scene, idx) => `
      <div class="choice-row sequence-row">
        <div class="choice-key">${escapeHtml(scene)}</div>
        <input value="${escapeAttr(scene)}" oninput="updateSequenceScene(${idx}, this.value)" aria-label="Scene ${idx + 1}">
        <input type="number" min="0" max="5" step=".1" value="${weightByKey.get(String(scene)) || 1}" oninput="updateSequenceWeight(${idx}, this.value)" aria-label="Scene ${idx + 1} weight">
      </div>
    `).join('')}</div>`;
    updateWeightSummary(q);
    return;
  }
  box.innerHTML = '<div class="choice-note">This question has no editable choices.</div>';
  updateWeightSummary(q);
}

function slotWeightForSetting(q, slotKey) {
  return Number((q?.interaction?.slots || []).find(slot => slot.key === slotKey)?.weight)
    || Number((q?.scoring?.components || []).find(c => c.key === slotKey)?.weight)
    || 0;
}

function weightMetricsForQuestion(q) {
  if (!q) return { text: '', warn: false };
  if (Array.isArray(q.interaction?.options) && q.interaction.options.length) {
    const scores = q.interaction.options.map(opt => Number(opt.score) || 0);
    const highest = Math.max(...scores);
    const wrongScores = q.interaction.options.filter(opt => !opt.isCorrect && Number(opt.score) < 100).map(opt => Number(opt.score) || 0);
    const hasPartial = wrongScores.some(score => score > 0);
    const needsPartial = q.type === 'emotion_mcq' || q.type === 'internal_response_mcq';
    return {
      text: `Selectable max: ${highest} / 100${needsPartial ? (hasPartial ? ' - partial distractor OK' : ' - add partial distractor') : ''}`,
      warn: highest !== 100 || scores.some(score => score > 100 || score < 0) || (needsPartial && !hasPartial)
    };
  }
  const components = Array.isArray(q.scoring?.components) ? q.scoring.components : [];
  const total = components.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);
  return {
    text: `Weight total: ${Number(total.toFixed(1))} / 10`,
    warn: total <= 0 || Math.abs(total - 10) > 0.01
  };
}

function updateWeightSummary(q = quiz?.questions?.[currentQuestionIndex]) {
  const box = $('weight-summary');
  if (!box) return;
  const metrics = weightMetricsForQuestion(q);
  box.textContent = metrics.text || '';
  box.classList.toggle('warn', !!metrics.warn);
}

function refreshQuestionAfterLightEdit() {
  const q = quiz.questions[currentQuestionIndex];
  q.scoring = templateScoringForQuestion(q);
  syncCurrentBatchItem();
  renderPreview();
  renderQuestionNav();
  renderReviewPanel();
  updateWeightSummary(q);
  $('interaction-json').value = JSON.stringify(q.interaction || {}, null, 2);
  $('scoring-json').value = JSON.stringify(q.scoring || {}, null, 2);
}

function updateOptionText(index, value) {
  const opts = quiz?.questions?.[currentQuestionIndex]?.interaction?.options || [];
  if (!opts[index]) return;
  opts[index].text = value;
  refreshQuestionAfterLightEdit();
}

function updateOptionScore(index, value) {
  const opts = quiz?.questions?.[currentQuestionIndex]?.interaction?.options || [];
  if (!opts[index]) return;
  opts[index].score = Math.max(0, Math.min(100, Number(value) || 0));
  opts[index].isCorrect = opts[index].score === 100;
  quiz.questions[currentQuestionIndex].interaction.correct = opts.find(opt => opt.isCorrect)?.key || quiz.questions[currentQuestionIndex].interaction.correct;
  refreshQuestionAfterLightEdit();
}

function updateSettingItem(index, field, value) {
  const q = quiz?.questions?.[currentQuestionIndex];
  const item = q?.interaction?.items?.[index];
  if (!item) return;
  item[field] = value;
  q.interaction = normalizeSettingInteraction(q.interaction);
  refreshQuestionAfterLightEdit();
}

function updateSettingSlotWeight(slotKey, value) {
  const q = quiz?.questions?.[currentQuestionIndex];
  const slot = (q?.interaction?.slots || []).find(item => item.key === slotKey);
  if (!slot) return;
  slot.weight = Math.max(0, Number(value) || 0);
  q.scoring = settingScoring(q.interaction.correct, q.interaction.slots);
  syncCurrentBatchItem();
  updateWeightSummary(q);
  $('interaction-json').value = JSON.stringify(q.interaction || {}, null, 2);
  $('scoring-json').value = JSON.stringify(q.scoring || {}, null, 2);
}

function updateWordToken(index, value) {
  const q = quiz?.questions?.[currentQuestionIndex];
  if (!Array.isArray(q?.interaction?.correct)) return;
  q.interaction.correct[index] = value;
  q.interaction.items = [...q.interaction.correct].reverse();
  refreshQuestionAfterLightEdit();
}

function updateWordWeight(index, value) {
  const q = quiz?.questions?.[currentQuestionIndex];
  const word = q?.interaction?.correct?.[index];
  const component = (q?.scoring?.components || []).find(c => String(c.key) === String(word));
  if (component) component.weight = Math.max(0, Number(value) || 0);
  syncCurrentBatchItem();
  updateWeightSummary(q);
  $('scoring-json').value = JSON.stringify(q.scoring || {}, null, 2);
}

function updateSequenceScene(index, value) {
  const q = quiz?.questions?.[currentQuestionIndex];
  if (!Array.isArray(q?.interaction?.correct)) return;
  q.interaction.correct[index] = value.trim().toUpperCase();
  q.interaction.items = [...q.interaction.correct];
  q.resources.images = q.interaction.correct.map(scene => imageResourceForScene(quiz.story?.storyId || 'OG0000', scene));
  refreshQuestionAfterLightEdit();
}

function updateSequenceWeight(index, value) {
  const q = quiz?.questions?.[currentQuestionIndex];
  const scene = q?.interaction?.correct?.[index];
  const component = (q?.scoring?.components || []).find(c => String(c.key) === String(scene));
  if (component) component.weight = Math.max(0, Number(value) || 0);
  syncCurrentBatchItem();
  updateWeightSummary(q);
  $('scoring-json').value = JSON.stringify(q.scoring || {}, null, 2);
}

function applyEditorChanges() {
  if (!quiz) return;
  const q = quiz.questions[currentQuestionIndex];
  try {
    q.storyGrammar = normalizeStoryGrammarKey($('sg-select').value);
    q.type = $('type-select').value;
    q.reviewStatus = $('review-status-select').value || 'draft';
    q.cmciDesignIntent = $('cmci-design-intent-select').value || null;
    q.instruction = $('instruction-input').value.trim();
    q.hint = $('hint-input').value.trim();
    q.resources = safeJsonParse($('resources-json').value, 'Resources') || {};
    q.interaction = safeJsonParse($('interaction-json').value, 'Interaction') || {};
    q.scoring = safeJsonParse($('scoring-json').value, 'Scoring') || {};
    q.diagnostics = safeJsonParse($('diagnostics-json').value, 'Diagnostics') || [];
    syncCurrentBatchItem();
    renderAll();
    toast('蹂寃쎌쓣 諛섏쁺?덉뒿?덈떎.');
  } catch (error) {
    toast(error.message);
  }
}

function updateStoryFromInputs() {
  const storyText = $('story-text').value;
  const storyId = $('story-id').value.trim() || 'OG0000';
  const title = $('story-title').value.trim() || 'Untitled Story';
  const level = $('story-level').value.trim() || 'Draft Level';
  if (!quiz) quiz = blankQuiz(storyId, title, level, storyText);
  quiz.story.storyId = storyId;
  quiz.story.title = title;
  quiz.story.level = level;
  quiz.story.text = storyText;
  if (currentBatchIndex >= 0 && batchItems[currentBatchIndex]) {
    const item = batchItems[currentBatchIndex];
    item.row.story_id = storyId;
    item.row.title = title;
    item.row.level = level;
    item.row.story_text = storyText;
    item.quiz = deepClone(quiz);
  }
}

function currentStoryRow() {
  const row = {
    story_id: $('story-id')?.value.trim() || currentStoryPackage?.storyId || 'OG0000',
    title: $('story-title')?.value.trim() || currentStoryPackage?.title || 'Untitled Story',
    level: $('story-level')?.value.trim() || 'Draft Level',
    story_text: $('story-text')?.value || currentStoryPackage?.storyText || '',
    notes: ''
  };
  if (currentStoryPackage?.backgroundFile) row.background_image = currentStoryPackage.backgroundFile.name;
  if (currentStoryPackage?.coverFiles?.[0]) row.cover_image = currentStoryPackage.coverFiles[0].name;
  return row;
}

async function generateRuleDraft() {
  syncCurrentBatchItem();
  updateStoryFromInputs();
  const payload = {
    storyId: $('story-id').value.trim(),
    title: $('story-title').value.trim(),
    level: $('story-level').value.trim(),
    storyText: $('story-text').value
  };
  try {
    const res = await fetch('/api/generate-rule-based', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('local api unavailable');
    const data = await res.json();
    quiz = sanitizeGeneratedQuiz(data.quiz);
  } catch {
    quiz = buildRuleDraft(payload);
  }
  currentBatchIndex = -1;
  currentQuestionIndex = 0;
  renderAll();
  toast('Rule draft generated. Review the quiz on the right.');
}

async function generateAiDraft() {
  syncCurrentBatchItem();
  updateStoryFromInputs();
  const apiKey = $('api-key').value.trim();
  const row = currentStoryRow();
  if (!row.story_text.trim()) {
    toast('Upload a story TXT file or paste story text first.');
    return;
  }
  const payload = {
    provider: $('ai-provider').value,
    input: {
      storyId: row.story_id,
      title: row.title,
      level: row.level,
      storyText: row.story_text,
      assetNaming: {
        image: '{storyId}_SC##_I.webp or {storyId}_SC##_I_1920x1080.webp',
        audio: '{storyId}_SC##_ST##_N_A.mp3',
        cover: '{storyId}_Cover_L_I.webp or {storyId}_Cover_L_I_1920x1080.webp',
        background: '{storyId}_Talking_BG_I.webp'
      },
      questionBlueprint: QUESTION_BLUEPRINT
    }
  };
  if (apiKey) payload.apiKey = apiKey;
  const btn = $('generate-ai-btn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generating...';
  try {
    let bestQuiz = null;
    let issues = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const attemptPayload = deepClone(payload);
      if (attempt > 0 && issues.length) {
        attemptPayload.input.revisionNotes = [
          'Regenerate inside the fixed Q1-Q6 template.',
          'Fix these quality issues before returning JSON:',
          ...issues
        ].join('\n- ');
      }
      const generated = await requestAiQuizOnce(attemptPayload, apiKey);
      bestQuiz = completeGeneratedQuiz(generated, row);
      issues = generationQualityIssues(bestQuiz);
      if (!issues.length) break;
    }
    quiz = bestQuiz;
    const hintCount = (quiz.questions || []).filter(q => String(q.hint || '').trim()).length;
    currentBatchIndex = -1;
    currentQuestionIndex = 0;
    renderAll();
    toast(`Quiz generated with ${payload.provider}. ${hintCount}/6 hints ready.${issues.length ? ' Please review flagged items.' : ''}`);
  } catch (error) {
    toast(`AI generation failed: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function parseStory(storyText) {
  const scenes = new Map();
  storyText.split(/\r?\n/).forEach(line => {
    const match = line.trim().match(/^(SC\d{2})_(ST\d{2})_N\s*=\s*(.+)$/);
    if (!match) return;
    const [, sceneId, st, text] = match;
    if (!scenes.has(sceneId)) scenes.set(sceneId, []);
    scenes.get(sceneId).push({ sentenceId: `${sceneId}_${st}_N`, text: text.replace(/^["']+|["']+$/g, '').trim() });
  });
  return [...scenes.entries()].map(([sceneId, sentences]) => ({ sceneId, sentences }));
}

function storyWordTokens(sentence) {
  const raw = String(sentence || '').match(/[A-Za-z']+[,\.!?]?/g) || [];
  const compoundPairs = new Set([
    'plastic bag',
    'rainbow cloud',
    'crystal box',
    'dark canyon',
    'ocean floor',
    'lost light',
    'strange light',
    'aurora submarine',
    'tiny rock',
    'youngest son',
    'youngest man'
  ]);
  const modifierWords = new Set([
    'plastic', 'rainbow', 'crystal', 'dark', 'deep', 'little', 'big', 'quiet',
    'lost', 'strange', 'aurora', 'youngest', 'oldest', 'middle', 'bright', 'gray', 'grey', 'clear'
  ]);
  const clean = token => String(token || '').replace(/[,\.\!?]+$/g, '').toLowerCase();
  const isCompoundPair = (a, b) => compoundPairs.has(`${clean(a)} ${clean(b)}`);
  const shouldGroupThree = (article, first, second) => {
    if (!/^(a|an|the)$/i.test(article) || !first || !second) return false;
    return isCompoundPair(first, second) || modifierWords.has(clean(first));
  };
  const grouped = [];
  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    if (shouldGroupThree(token, raw[i + 1], raw[i + 2])) {
      grouped.push(`${token} ${raw[i + 1]} ${raw[i + 2]}`);
      i += 2;
    } else if (/^(a|an|the)$/i.test(token) && raw[i + 1]) {
      grouped.push(`${token} ${raw[i + 1]}`);
      i += 1;
    } else if (raw[i + 1] && isCompoundPair(token, raw[i + 1])) {
      grouped.push(`${token} ${raw[i + 1]}`);
      i += 1;
    } else {
      grouped.push(token);
    }
  }
  return grouped;
}

function buildRuleDraft(payload) {
  const storyId = payload.storyId || 'OG0000';
  const title = payload.title || 'Untitled Story';
  const level = payload.level || 'Draft Level';
  const storyText = payload.storyText || '';
  const scenes = parseStory(storyText);
  const ids = scenes.map(s => s.sceneId);
  const usable = ids.length ? ids : ['SC01','SC02','SC03','SC04','SC05'];
  const sceneAt = (ratio) => usable[Math.max(0, Math.min(usable.length - 1, Math.round((usable.length - 1) * ratio)))];
  const first = usable[0];
  const event = usable[1] || first;
  const attempt = sceneAt(.35);
  const reaction = sceneAt(.62);
  const sequence = storyArcScenes(storyText, [first, event, attempt, reaction, usable[usable.length - 1]]);
  const image = scene => ({ id: scene, path: `${storyId}_${scene}_I.webp`, kind: 'image', sceneId: scene });
  const findSentence = scene => (scenes.find(s => s.sceneId === scene)?.sentences?.[0]) || { sentenceId: `${scene}_ST01_N`, text: 'Put the words in order.' };
  const eventSentence = chooseInitiatingSentence(storyText) || { ...findSentence(event), sceneId: event };
  const eventScene = eventSentence.sceneId || event;
  const attemptSentence = chooseAttemptSentence(storyText) || { ...findSentence(attempt), sceneId: attempt };
  const attemptScene = attemptSentence.sceneId || attempt;
  const words = storyWordTokens(attemptSentence.text).length ? storyWordTokens(attemptSentence.text) : ['Put','the words','in','order.'];
  const settingDraft = fallbackSettingInteraction(storyText);
  const mkQ = (number, type, axis, instruction, hint, resources, interaction, scoring, diagnostics) => ({
    qId: `${storyId}_V3_Q${String(number).padStart(2, '0')}`,
    number, type, storyGrammar: axis, instruction, hint, resources, interaction, scoring,
    reviewStatus: 'draft',
    cmciDesignIntent: null,
    diagnostics: diagnostics || [{ code: axis + '_gap', threshold: 70, messageKo: SG_KO[axis] + ' \uD56D\uBAA9\uC744 \uB2E4\uC2DC \uD655\uC778\uD560 \uD544\uC694\uAC00 \uC788\uC2B5\uB2C8\uB2E4.' }],
    lrs: { verb: 'answered', objectId: `quiz_${storyId}_v3_Q${String(number).padStart(2, '0')}_${axis}`, resultFields: ['score_raw', 'is_correct', 'hint_used', 'response_time_sec', 'selected_key'] }
  });
  return {
    schemaVersion: 'quiz-v3.0',
    story: { storyId, title, level, text: storyText, scenes },
    assets: {
      imageBasePath: `../v3/${storyId}/Image/`,
      audioBasePath: `../v3/${storyId}/Audio/`,
      coverBasePath: `../v3/${storyId}/Cover/`,
      backgroundImage: `../v3/${storyId}/Image/${storyId}_Talking_BG_I.webp`,
      coverImage: `../v3/${storyId}/Cover/${storyId}_Cover_L_I.webp`,
      hintCharacter: `../v3/${storyId}/Assets/BKTK_Characters_Bookey.png`
    },
    storyGrammarAxes: Object.keys(SG_LABELS).map(key => ({ key, labelEn: SG_LABELS[key], labelKo: SG_KO[key], descriptionKo: '' })),
    questions: [
      mkQ(1, 'story_sequence_drag', 'consequence', 'Put the story scenes in order.', fallbackHint({ type: 'story_sequence_drag' }, storyText), { images: sequence.map(image) }, { promptMode: 'drag_sequence', items: sequence, correct: sequence }, weightedPosition(sequence)),
      mkQ(2, 'setting_slot_drag', 'setting', 'Look at the picture. Fill in the boxes.', fallbackHint({ type: 'setting_slot_drag' }, storyText), { images: [image(first)], scene: first }, settingDraft, settingScoring(settingDraft.correct, settingDraft.slots)),
      mkQ(3, 'listen_scene_mcq', 'initiating_event', 'Listen. Which scene starts the problem?', fallbackHint({ type: 'listen_scene_mcq' }, storyText), { images: sceneOptionsAround(storyText, eventScene, 4).map(image), audio: { id: `${eventSentence.sentenceId}_A`, path: `${storyId}_${eventSentence.sentenceId}_A.mp3`, kind: 'audio', sceneId: eventScene, sentenceId: eventSentence.sentenceId } }, imageOptions(sceneOptionsAround(storyText, eventScene, 4), eventScene), fixedScoring()),
      mkQ(4, 'scene_word_unscramble', 'attempt', 'Put the story words in order.', fallbackHint({ type: 'scene_word_unscramble' }, storyText), { images: [image(attemptScene)], scene: attemptScene, sentenceId: attemptSentence.sentenceId }, { promptMode: 'word_unscramble', items: [...words].reverse(), correct: words }, wordScoring(words)),
      mkQ(5, 'emotion_mcq', 'reaction', 'How does the character feel here?', fallbackHint({ type: 'emotion_mcq' }, storyText), { images: [image(reaction)], scene: reaction }, emotionOptions(), fixedScoring()),
      mkQ(6, 'internal_response_mcq', 'internal_response', 'What is the character thinking?', 'Think about the character\'s heart.', { images: [image(reaction)], scene: reaction }, internalOptions(), fixedScoring())
    ],
    reporting: defaultReporting(),
    generation: { provider: 'rule_based', model: 'browser-heuristic', promptVersion: 'story_grammar_v3', createdAt: new Date().toISOString().slice(0, 10), notes: 'Draft generated locally. Human review required.' }
  };
}

function weightedPosition(sequence) {
  const weights = normalizedWeights(sequence.length, (idx, count) => (idx === 0 || idx === count - 1 ? 2.5 : 1.5));
  return {
    type: 'weighted_position',
    maxScore: 100,
    formula: 'score = round(sum(weight_i * max(0, 1 - abs(placed_pos_i - correct_pos_i) * 0.5)) / sum(weights) * 100)',
    components: sequence.map((sc, idx) => ({ key: sc, weight: weights[idx], rule: 'position_distance', correctValue: idx + 1, rationale: 'Story sequence diagnostic point.' }))
  };
}

function normalizedWeights(count, rawWeightFn) {
  const raw = Array.from({ length: count }, (_, idx) => Number(rawWeightFn(idx, count)) || 1);
  const total = raw.reduce((sum, weight) => sum + weight, 0) || 1;
  const weights = raw.map(weight => Number((weight * 10 / total).toFixed(1)));
  const diff = Number((10 - weights.reduce((sum, weight) => sum + weight, 0)).toFixed(1));
  if (weights.length) weights[weights.length - 1] = Number((weights[weights.length - 1] + diff).toFixed(1));
  return weights;
}

function settingInteraction() {
  return {
    promptMode: 'slot_drag',
    slots: [
      { key: 'who', label: 'Who?', correct: 'main_character', weight: 3 },
      { key: 'where', label: 'Where?', correct: 'main_place', weight: 3 },
      { key: 'at_first', label: 'At first...', correct: 'opening_state', weight: 4 }
    ],
    items: [
      { key: 'main_place', text: 'story place', slot: 'where' },
      { key: 'other_character', text: 'other character', slot: 'who', diagnostic: '주요 인물과 다른 인물을 혼동합니다.' },
      { key: 'opening_state', text: 'first action', slot: 'at_first' },
      { key: 'main_character', text: 'main character', slot: 'who' },
      { key: 'other_place', text: 'other place', slot: 'where', diagnostic: '이야기가 시작된 장소와 다른 장소를 혼동합니다.' },
      { key: 'later_problem', text: 'later problem', slot: 'at_first', diagnostic: '처음 상황과 뒤에 생긴 문제를 혼동합니다.' }
    ],
    correct: { who: 'main_character', where: 'main_place', at_first: 'opening_state' }
  };
}

function settingScoring(correct = {}, slots = []) {
  const slotWeight = (key, fallback) => Number((slots || []).find(slot => slot.key === key)?.weight) || fallback;
  return {
    type: 'weighted_slot_match',
    maxScore: 100,
    formula: 'full slot weight if exact target; 35% slot credit if same category but wrong card; 0 for wrong category',
    components: [
      { key: 'who', weight: slotWeight('who', 3), rule: 'slot_match', correctValue: correct.who || 'main_character', partialCredit: .35, rationale: 'Identifies the main character. Same-category wrong character earns 35% of this slot.' },
      { key: 'where', weight: slotWeight('where', 3), rule: 'slot_match', correctValue: correct.where || 'main_place', partialCredit: .35, rationale: 'Identifies the story place. Same-category wrong place earns 35% of this slot.' },
      { key: 'at_first', weight: slotWeight('at_first', 4), rule: 'slot_match', correctValue: correct.at_first || 'opening_state', partialCredit: .35, rationale: 'Identifies the opening state. Same-category wrong opening action earns 35% of this slot.' }
    ]
  };
}

function imageOptions(scenes, correctScene) {
  return {
    promptMode: 'image_mcq',
    options: scenes.map((sc, idx) => ({
      key: String.fromCharCode(65 + idx),
      text: sc,
      score: sc === correctScene ? 100 : Math.max(0, 30 - idx * 5),
      isCorrect: sc === correctScene,
      diagnostic: 'Distractor: the learner confuses the problem-start scene with another story scene.'
    })),
    correct: String.fromCharCode(65 + Math.max(0, scenes.indexOf(correctScene)))
  };
}

function wordScoring(words) {
  const weights = normalizedWeights(words.length, (idx, count) => (idx <= 1 || idx === count - 1 ? 2.5 : 1));
  return {
    type: 'weighted_word_position',
    maxScore: 100,
    formula: 'score = round(sum(weight[word] if submitted_pos == correct_pos) / sum(weights) * 100)',
    components: words.map((word, idx) => ({ key: word, weight: weights[idx], rule: 'exact_position', correctValue: idx + 1, rationale: 'Sentence structure diagnostic point.' }))
  };
}

function fixedScoring() {
  return { type: 'fixed_option_score', maxScore: 100, formula: 'score = selected_option.score', components: [{ key: 'correct', weight: 100, rule: 'option_score', correctValue: true, rationale: 'Correct option receives 100.' }] };
}

function normalizeDiagnosticText(message = '') {
  let text = String(message || '').trim();
  if (!text) return '';
  text = text
    .replace(/혼동함\.?$/u, '혼동합니다.')
    .replace(/부족함\.?$/u, '부족합니다.')
    .replace(/필요함\.?$/u, '필요합니다.');
  if (/[가-힣]/u.test(text) && !/[.!?]$/.test(text)) text += '.';
  return text;
}

function fallbackOptionDiagnostic(q = {}, opt = {}) {
  if (opt.isCorrect || Number(opt.score) >= 100) return '정답 선택지입니다.';
  const axis = normalizeStoryGrammarKey(q.storyGrammar);
  const score = Number(opt.score) || 0;
  if (axis === 'initiating_event') {
    return score >= 25
      ? '문제가 시작되는 장면과 가까운 장면을 혼동합니다.'
      : '문제가 실제로 시작되는 핵심 장면을 다시 확인할 필요가 있습니다.';
  }
  if (axis === 'reaction') {
    return score >= 35
      ? '감정의 큰 방향은 파악했지만 비슷한 감정을 더 섬세하게 구분할 필요가 있습니다.'
      : '장면 상황을 근거로 인물의 감정을 파악하는 연습이 필요합니다.';
  }
  if (axis === 'internal_response') {
    return score >= 35
      ? '장면 정보는 일부 파악했지만 인물의 생각이나 깨달음으로 연결하는 추론이 더 필요합니다.'
      : '겉으로 보이는 행동과 인물의 내적 생각을 구분하는 연습이 필요합니다.';
  }
  return score > 0
    ? '정답과 가까운 단서는 찾았지만 핵심 의미를 더 정확히 확인할 필요가 있습니다.'
    : '해당 Story Grammar 항목의 핵심 단서를 다시 확인할 필요가 있습니다.';
}

function normalizeDiagnosticsForQuestion(q = {}) {
  (q.diagnostics || []).forEach(d => {
    d.messageKo = normalizeDiagnosticText(d.messageKo || d.message || '');
  });
  (q.interaction?.options || []).forEach(opt => {
    opt.diagnostic = normalizeDiagnosticText(opt.diagnostic || fallbackOptionDiagnostic(q, opt));
  });
  (q.interaction?.items || []).forEach(item => {
    if (item.diagnostic) item.diagnostic = normalizeDiagnosticText(item.diagnostic);
  });
}

function emotionOptions() {
  return { promptMode: 'text_mcq', options: [
    { key: 'A', text: 'happy', score: 20, isCorrect: false, diagnostic: 'Distractor: positive feeling is confused with a difficult scene.' },
    { key: 'B', text: 'sad', score: 100, isCorrect: true },
    { key: 'C', text: 'angry', score: 40, isCorrect: false, diagnostic: 'Near-miss: the learner identifies a negative feeling but confuses sadness and anger.' },
    { key: 'D', text: 'surprised', score: 20, isCorrect: false, diagnostic: 'Distractor: surprise is confused with the character?s sustained feeling.' }
  ], correct: 'B' };
}

function internalOptions() {
  return { promptMode: 'text_mcq', options: [
    { key: 'A', text: 'I understand something now.', score: 100, isCorrect: true },
    { key: 'B', text: 'I want a new toy.', score: 0, isCorrect: false, diagnostic: 'Distractor: this thought is not connected to the story.' },
    { key: 'C', text: 'The place is pretty.', score: 40, isCorrect: false, diagnostic: 'Near-miss: the learner notices scene information but does not infer the character?s thought.' },
    { key: 'D', text: 'I want to go away.', score: 20, isCorrect: false, diagnostic: 'Distractor: action and inner reason are confused.' }
  ], correct: 'A' };
}

function defaultReporting() {
  const feedback = {
    setting: {
      stable: 'Setting is understood steadily.',
      developing: 'The learner mostly understands who, where, and the opening state, but should check some clues again.',
      shaky: 'The learner needs practice identifying who is in the first scene and where the story starts.',
      focus: 'Practice matching short opening sentences with character and place cards.'
    },
    initiating_event: {
      stable: 'The problem-start scene is identified steadily.',
      developing: 'The learner mostly finds the problem, but should separate it from nearby scenes.',
      shaky: 'The learner needs practice hearing the sentence that changes the story into a problem.',
      focus: 'Practice matching the problem sentence with its scene.'
    },
    attempt: {
      stable: 'The character action used to solve the problem is understood well.',
      developing: 'The learner finds the action scene but should check word-order clues more carefully.',
      shaky: 'The learner needs practice identifying who does what in the action sentence.',
      focus: 'Practice subject and action chunks with short word cards.'
    },
    reaction: {
      stable: 'The character reaction and feeling are understood steadily.',
      developing: 'The learner understands the broad feeling but should distinguish similar emotions.',
      shaky: 'The learner needs practice choosing a feeling from scene evidence.',
      focus: 'Practice connecting feeling words with story situations.'
    },
    internal_response: {
      stable: 'The character thought or realization is inferred well.',
      developing: 'The learner mostly understands the thought but should check the evidence scene again.',
      shaky: 'The learner needs practice separating visible action from inner thought.',
      focus: 'Practice saying why the character thinks that way.'
    },
    consequence: {
      stable: 'The story flow and outcome are understood steadily.',
      developing: 'The learner understands the overall story but should check the middle order again.',
      shaky: 'The learner needs practice connecting beginning, problem, action, and outcome.',
      focus: 'Practice retelling the whole story with five key scenes.'
    }
  };
  return {
    overallFormula: 'overall = average(setting, initiating_event, attempt, reaction, internal_response, consequence)',
    masteryBands: [
      { key: 'stable', min: 85, max: 100, labelKo: 'Stable' },
      { key: 'developing', min: 70, max: 84, labelKo: 'Developing' },
      { key: 'shaky', min: 50, max: 69, labelKo: 'Shaky' },
      { key: 'focus', min: 0, max: 49, labelKo: 'Focus' }
    ],
    parentFeedback: feedback
  };
}

function blankQuiz(storyId, title, level, storyText) {
  return buildRuleDraft({ storyId, title, level, storyText });
}

function downloadBlob(filename, mime, content) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (['approved', 'approve'].includes(value)) return 'Approved';
  if (['needs review', 'needs_review', 'review'].includes(value)) return 'Needs Review';
  if (['generated'].includes(value)) return 'Generated';
  return 'Input';
}

function statusClass(status) {
  return `status-${normalizeStatus(status).toLowerCase().replace(/\s+/g, '-')}`;
}

function normalizeBatchRow(raw, index) {
  const read = (...keys) => {
    for (const key of keys) {
      if (raw[key] !== undefined && raw[key] !== null && String(raw[key]).trim() !== '') return String(raw[key]).trim();
    }
    return '';
  };
  const storyId = read('story_id', 'storyId', 'Story ID', 'StoryID') || 'STORY_' + String(index + 1).padStart(3, '0');
  return {
    story_id: storyId,
    title: read('title', 'Title', 'story_title', 'Story Title') || storyId,
    level: read('level', 'Level') || 'Draft Level',
    story_text: read('story_text', 'storyText', 'Story Text', 'text', 'Text'),
    image_base_path: read('image_base_path', 'imageBasePath', 'Image Base Path', 'image_folder', 'Image Folder'),
    audio_base_path: read('audio_base_path', 'audioBasePath', 'Audio Base Path', 'audio_folder', 'Audio Folder'),
    cover_base_path: read('cover_base_path', 'coverBasePath', 'Cover Base Path', 'cover_folder', 'Cover Folder'),
    background_image: read('background_image', 'backgroundImage', 'Background Image'),
    hint_character: read('hint_character', 'hintCharacter', 'Hint Character'),
    status: normalizeStatus(read('status', 'Status')),
    notes: read('notes', 'Notes')
  };
}

function createBatchItem(row, index) {
  return {
    id: row.story_id || `STORY_${String(index + 1).padStart(3, '0')}`,
    row,
    status: normalizeStatus(row.status),
    issues: [],
    quiz: null
  };
}

function updateBatchInputStatus() {
  const status = $('batch-input-status');
  if (!status) return;
  if (!batchInputRows.length) {
    status.textContent = 'No batch format uploaded.';
    return;
  }
  status.textContent = `${batchInputRows.length} stories loaded. Ready for AI Batch Generate.`;
}

function showBatchOutputs(show = true) {
  const box = $('batch-output-box');
  if (box) box.hidden = !show;
}

function quizFromBatchRow(row) {
  const draft = buildRuleDraft({
    storyId: row.story_id,
    title: row.title,
    level: row.level,
    storyText: row.story_text
  });
  draft.assets.imageBasePath = row.image_base_path || draft.assets.imageBasePath;
  draft.assets.audioBasePath = row.audio_base_path || draft.assets.audioBasePath;
  draft.assets.coverBasePath = row.cover_base_path || draft.assets.coverBasePath;
  draft.assets.backgroundImage = row.background_image || draft.assets.backgroundImage;
  draft.assets.coverImage = row.cover_image || draft.assets.coverImage;
  draft.assets.hintCharacter = row.hint_character || draft.assets.hintCharacter;
  draft.generation.notes = row.notes || draft.generation.notes;
  return draft;
}

function validateQuizDraft(sourceQuiz, row = {}) {
  const issues = [];
  const scenes = sourceQuiz.story?.scenes || [];
  if (!row.story_text && !sourceQuiz.story?.text) issues.push('Story text is missing.');
  if (scenes.length < 5) issues.push('At least five scenes are recommended for this quiz template.');
  if ((sourceQuiz.questions || []).length !== 6) issues.push('The quiz must contain exactly six questions.');
  const expectedAxes = Object.keys(SG_LABELS);
  const foundAxes = new Set((sourceQuiz.questions || []).map(q => normalizeStoryGrammarKey(q.storyGrammar)));
  expectedAxes.forEach(axis => {
    if (!foundAxes.has(axis)) issues.push(`${SG_LABELS[axis]} axis is missing.`);
  });
  (sourceQuiz.questions || []).forEach(q => {
    if (!q.instruction) issues.push(`${q.qId}: instruction is missing.`);
    if (!q.hint) issues.push(`${q.qId}: hint is missing.`);
    if (!q.resources || (!q.resources.images && !q.resources.audio && !q.resources.scene)) issues.push(`${q.qId}: resource data is missing.`);
    if (!hasMeaningfulInteraction(q)) issues.push(`${q.qId}: interaction data is missing or too thin.`);
    if (!q.scoring?.formula) issues.push(`${q.qId}: scoring formula is missing.`);
    if (!Array.isArray(q.scoring?.components) || !q.scoring.components.length) issues.push(`${q.qId}: scoring components are missing.`);
    if ((q.type || '').includes('mcq') && (!Array.isArray(q.interaction?.options) || q.interaction.options.length < 2)) {
      issues.push(`${q.qId}: options are missing or insufficient.`);
    }
    if (q.type === 'scene_word_unscramble') {
      const sentenceId = q.resources?.sentenceId;
      const sentenceFound = scenes.some(scene => (scene.sentences || []).some(s => s.sentenceId === sentenceId));
      if (sentenceId && !sentenceFound) issues.push(`${q.qId}: sentenceId was not found in the story text.`);
    }
  });
  return issues;
}
function generateBatchDrafts() {
  if (!batchItems.length) {
    toast('癒쇱? Batch XLSX/JSON??遺덈윭? 二쇱꽭??');
    return;
  }
  syncCurrentBatchItem();
  batchItems = batchItems.map((item, index) => {
    const draft = quizFromBatchRow(item.row);
    const issues = validateQuizDraft(draft, item.row);
    return {
      ...item,
      id: item.row.story_id || item.id || `STORY_${String(index + 1).padStart(3, '0')}`,
      quiz: draft,
      issues,
      status: issues.length ? 'Needs Review' : 'Generated'
    };
  });
  selectBatchItem(0, false);
  toast(`${batchItems.length}媛??ㅽ넗由?珥덉븞???앹꽦?덉뒿?덈떎.`);
}

function loadAssetFolder(files) {
  assetObjectUrls.forEach(url => URL.revokeObjectURL(url));
  assetObjectUrls = [];
  assetFiles = new Map();
  Array.from(files || []).forEach(file => registerAssetFile(file, file.webkitRelativePath || file.name));
  const status = $('asset-status');
  const count = assetCount();
  if (status) status.textContent = count ? `${count} asset files loaded for preview/export.` : 'No asset folder loaded.';
  renderPreview();
  toast(`${count}媛??먯뀑 ?뚯씪???곌껐?덉뒿?덈떎.`);
}

function registerAssetFile(file, relativePath = '') {
  const url = URL.createObjectURL(file);
  assetObjectUrls.push(url);
  const relative = String(relativePath || file.name).replace(/\\/g, '/').toLowerCase();
  const name = file.name.toLowerCase();
  const stem = assetStem(name);
  const relativeStem = assetStem(relative);
  assetFiles.set(relative, { file, url });
  assetFiles.set(name, { file, url });
  if (stem) assetFiles.set(`stem:${stem}`, { file, url });
  if (relativeStem) assetFiles.set(`stem:${relativeStem}`, { file, url });
}

function storyCodeFromPath(pathValue) {
  const match = String(pathValue || '').match(/(?:^|[\\/])?((?:OG|CS)\d{4})(?=[_\\/.-]|$)/i);
  return match ? match[1].toUpperCase() : '';
}

function storyTextIdFromFileName(fileNameValue) {
  const name = fileName(fileNameValue);
  if (!/\.txt$/i.test(name)) return '';
  if (/(^|[_-])processing[_-]?log|_log[_-]?\d|\blog\b/i.test(name)) return '';
  const match = name.match(/^((?:OG|CS)\d{4})_.+\.txt$/i);
  return match ? match[1].toUpperCase() : '';
}

function isStoryTextFile(file, expectedStoryId = '') {
  const storyId = storyTextIdFromFileName(file?.name || '');
  if (!storyId) return false;
  return !expectedStoryId || storyId === String(expectedStoryId).toUpperCase();
}

function titleFromStoryFile(fileNameValue, storyId) {
  const stem = fileName(fileNameValue).replace(/\.[^.]+$/, '');
  const cleaned = stem
    .replace(new RegExp(`^${storyId}[_\\s-]*`, 'i'), '')
    .replace(/[_-]+/g, ' ')
    .replace(/\bstorytitle\b/i, '')
    .trim();
  return cleaned || storyId || 'Untitled Story';
}

function classifyStoryFiles(files) {
  const fileList = Array.from(files || []);
  const pkg = {
    storyId: '',
    title: '',
    storyFile: null,
    storyText: '',
    coverFiles: [],
    backgroundFile: null,
    sceneImages: new Map(),
    audioFiles: new Map(),
    otherFiles: []
  };

  fileList.forEach(file => {
    const rel = file.webkitRelativePath || file.name;
    const storyTextId = storyTextIdFromFileName(file.name);
    const storyId = storyTextId || storyCodeFromPath(rel) || storyCodeFromPath(file.name);
    if (!pkg.storyId && storyId) pkg.storyId = storyId;
  });

  fileList.forEach(file => {
    const rel = file.webkitRelativePath || file.name;
    const name = file.name;
    const storyId = storyCodeFromPath(rel) || storyCodeFromPath(name);

    if (/\.txt$/i.test(name)) {
      if (isStoryTextFile(file, pkg.storyId)) pkg.storyFile = file;
      else pkg.otherFiles.push(file);
      return;
    }

    if (/\.(webp|png|jpe?g|gif)$/i.test(name) && /_cover_[lp]_i(?:_\d{3,4}x\d{3,4})?/i.test(name)) {
      pkg.coverFiles.push(file);
      return;
    }

    if (/\.(webp|png|jpe?g|gif)$/i.test(name) && /_talking_bg_i(?:_\d{3,4}x\d{3,4})?/i.test(name)) {
      pkg.backgroundFile = file;
      return;
    }

    const sceneMatch = name.match(/_(SC\d{2})_I(?:_\d{3,4}x\d{3,4})?\.(webp|png|jpe?g|gif)$/i);
    if (sceneMatch) {
      pkg.sceneImages.set(sceneMatch[1].toUpperCase(), file);
      return;
    }

    const audioMatch = name.match(/_(SC\d{2}_ST\d{2}_N_A)\.(mp3|wav|m4a|ogg)$/i);
    if (audioMatch) {
      pkg.audioFiles.set(audioMatch[1].toUpperCase(), file);
      return;
    }

    pkg.otherFiles.push(file);
  });
  pkg.title = titleFromStoryFile(pkg.storyFile?.name || pkg.storyId, pkg.storyId);
  return pkg;
}

function renderResourceSummary(pkg) {
  const box = $('resource-summary');
  if (!box) return;
  if (!pkg) {
    box.innerHTML = '<div class="resource-empty">Upload one OG/CS story folder to classify its files.</div>';
    return;
  }
  const sceneList = [...pkg.sceneImages.keys()].sort();
  const audioList = [...pkg.audioFiles.keys()].sort();
  const row = (label, value, ok = true, kind = '', key = '') => {
    const title = kind === 'story_id' ? 'Edit' : 'Replace';
    const icon = kind === 'story_id' ? '\u270E' : '\u21E7';
    return `
    <button type="button" class="resource-row ${ok ? 'ok' : 'warn'}" onclick="startResourceReplace('${escapeAttr(kind)}','${escapeAttr(key)}')">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <em title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}">${icon}</em>
    </button>`;
  };
  box.innerHTML = [
    row('Story ID', pkg.storyId || 'Not detected', !!pkg.storyId, 'story_id'),
    row('Story TXT', pkg.storyFile?.name || 'Missing', !!pkg.storyFile, 'story'),
    row('Cover', pkg.coverFiles[0]?.name || 'Missing', !!pkg.coverFiles.length, 'cover'),
    row('Background', pkg.backgroundFile?.name || 'Missing', !!pkg.backgroundFile, 'background'),
    row('Scenes', `${sceneList.length} files`, sceneList.length > 0, 'scene_any'),
    row('Audio', `${audioList.length} files`, true, 'audio_any')
  ].join('');
}

function replaceInputAccept(kind) {
  if (kind === 'story') return '.txt,text/plain';
  if (kind === 'audio' || kind === 'audio_any') return '.mp3,.wav,.m4a,.ogg,audio/*';
  return '.webp,.png,.jpg,.jpeg,.gif,image/*';
}

function startResourceReplace(kind, key = '') {
  if (kind === 'story_id') {
    const current = $('story-id')?.value.trim() || currentStoryPackage?.storyId || '';
    const next = prompt('Story ID', current);
    if (next === null) return;
    const cleaned = next.trim().toUpperCase();
    if (!/^(OG|CS)\d{4}$/.test(cleaned)) {
      toast('Use a Story ID such as OG0021 or CS0003.');
      return;
    }
    if (!currentStoryPackage) currentStoryPackage = classifyStoryFiles([]);
    currentStoryPackage.storyId = cleaned;
    $('story-id').value = cleaned;
    updateStoryFromInputs();
    renderResourceSummary(currentStoryPackage);
    renderAll();
    toast(`Story ID updated to ${cleaned}.`);
    return;
  }
  pendingResourceReplaceKind = kind;
  pendingResourceReplaceKey = key;
  const input = $('resource-replace-file');
  if (!input) return;
  input.accept = replaceInputAccept(kind);
  input.multiple = kind === 'scene_any' || kind === 'audio_any';
  input.value = '';
  input.click();
}

async function handleResourceReplaceFiles(files) {
  const kind = pendingResourceReplaceKind;
  if (kind === 'scene_any' || kind === 'audio_any') {
    await replaceStoryPackageFiles(files);
    pendingResourceReplaceKind = '';
    pendingResourceReplaceKey = '';
    return;
  }
  await replaceSpecificResourceFile(Array.from(files || [])[0]);
}

async function replaceSpecificResourceFile(file) {
  if (!file || !pendingResourceReplaceKind) return;
  if (!currentStoryPackage) currentStoryPackage = classifyStoryFiles([]);
  const kind = pendingResourceReplaceKind;
  const key = pendingResourceReplaceKey;
  registerAssetFile(file, file.webkitRelativePath || file.name);

  if (kind === 'story') {
    if (!isStoryTextFile(file, currentStoryPackage.storyId || storyTextIdFromFileName(file.name))) {
      toast('Choose a story TXT named like OG0021_Title.txt.');
      return;
    }
    currentStoryPackage.storyFile = file;
    currentStoryPackage.storyId = storyTextIdFromFileName(file.name) || currentStoryPackage.storyId;
    currentStoryPackage.title = titleFromStoryFile(file.name, currentStoryPackage.storyId);
    currentStoryPackage.storyText = await readFileAsText(file);
    $('story-id').value = currentStoryPackage.storyId || $('story-id').value;
    $('story-title').value = currentStoryPackage.title || $('story-title').value;
    $('story-text').value = currentStoryPackage.storyText;
  } else if (kind === 'cover') {
    currentStoryPackage.coverFiles = [file];
    if (quiz) quiz.assets = { ...(quiz.assets || {}), coverImage: file.name };
  } else if (kind === 'background') {
    currentStoryPackage.backgroundFile = file;
    if (quiz) quiz.assets = { ...(quiz.assets || {}), backgroundImage: file.name };
  } else if (kind === 'scene' || kind === 'scene_any') {
    const sceneMatch = file.name.match(/_(SC\d{2})_I(?:_\d{3,4}x\d{3,4})?\.(webp|png|jpe?g|gif)$/i);
    const sceneId = (kind === 'scene' ? key : sceneMatch?.[1] || '').toUpperCase();
    if (!sceneId) {
      toast('Choose an image named like OG0021_SC01_I.webp.');
      return;
    }
    currentStoryPackage.sceneImages.set(sceneId, file);
    if (quiz) {
      (quiz.questions || []).forEach(q => (q.resources?.images || []).forEach(img => {
        if ((img.sceneId || img.id || '').toUpperCase() === sceneId) img.path = file.name;
      }));
    }
  } else if (kind === 'audio' || kind === 'audio_any') {
    const audioMatch = file.name.match(/_(SC\d{2}_ST\d{2}_N_A)\.(mp3|wav|m4a|ogg)$/i);
    const audioId = (kind === 'audio' ? key : audioMatch?.[1] || '').toUpperCase();
    if (!audioId) {
      toast('Choose audio named like OG0021_SC02_ST01_N_A.mp3.');
      return;
    }
    currentStoryPackage.audioFiles.set(audioId, file);
    if (quiz) {
      (quiz.questions || []).forEach(q => {
        const audio = q.resources?.audio;
        if (audio && ((audio.id || '').toUpperCase() === audioId || `${audio.sceneId}_${audio.sentenceId}_A`.toUpperCase().includes(audioId))) {
          audio.path = file.name;
        }
      });
    }
  }

  pendingResourceReplaceKind = '';
  pendingResourceReplaceKey = '';
  updateStoryFromInputs();
  renderResourceSummary(currentStoryPackage);
  renderAll();
  toast(`${file.name} updated.`);
}

async function loadStoryPackage(files) {
  const fileList = Array.from(files || []);
  if (!fileList.length) return;
  showLeftSection('generate');
  assetObjectUrls.forEach(url => URL.revokeObjectURL(url));
  assetObjectUrls = [];
  assetFiles = new Map();
  fileList.forEach(file => registerAssetFile(file, file.webkitRelativePath || file.name));

  const pkg = classifyStoryFiles(fileList);
  if (pkg.storyFile) {
    pkg.storyText = await readFileAsText(pkg.storyFile);
  }
  currentStoryPackage = pkg;

  $('story-id').value = pkg.storyId || $('story-id').value || 'OG0000';
  $('story-title').value = pkg.title || $('story-title').value || pkg.storyId || '';
  if (!$('story-level').value.trim()) $('story-level').value = 'Level 1';
  $('story-text').value = pkg.storyText || $('story-text').value;

  renderResourceSummary(pkg);
  const status = $('package-status');
  if (status) {
    status.textContent = `${assetCount()} files loaded. ${pkg.sceneImages.size} scene images, ${pkg.audioFiles.size} audio files.`;
  }

  const row = currentStoryRow();
  quiz = sanitizeGeneratedQuiz(quizFromBatchRow(row));
  currentQuestionIndex = 0;
  currentBatchIndex = -1;
  renderAll();
  toast(`${row.story_id} resource folder loaded.`);
}

async function replaceStoryPackageFiles(files) {
  const fileList = Array.from(files || []);
  if (!fileList.length) return;
  if (!currentStoryPackage) {
    await loadStoryPackage(fileList);
    return;
  }
  fileList.forEach(file => registerAssetFile(file, file.webkitRelativePath || file.name));
  const incoming = classifyStoryFiles(fileList);
  if (!currentStoryPackage.storyId && incoming.storyId) currentStoryPackage.storyId = incoming.storyId;
  if (incoming.storyFile) {
    currentStoryPackage.storyFile = incoming.storyFile;
    currentStoryPackage.storyText = await readFileAsText(incoming.storyFile);
    $('story-text').value = currentStoryPackage.storyText;
  }
  if (incoming.coverFiles.length) currentStoryPackage.coverFiles = incoming.coverFiles;
  if (incoming.backgroundFile) currentStoryPackage.backgroundFile = incoming.backgroundFile;
  incoming.sceneImages.forEach((file, sceneId) => currentStoryPackage.sceneImages.set(sceneId, file));
  incoming.audioFiles.forEach((file, audioId) => currentStoryPackage.audioFiles.set(audioId, file));
  currentStoryPackage.otherFiles.push(...incoming.otherFiles);

  if (!$('story-id').value.trim() && currentStoryPackage.storyId) $('story-id').value = currentStoryPackage.storyId;
  if (!$('story-title').value.trim()) $('story-title').value = currentStoryPackage.title || currentStoryPackage.storyId || '';
  renderResourceSummary(currentStoryPackage);
  if ($('package-status')) {
    $('package-status').textContent = `${assetCount()} files loaded. ${currentStoryPackage.sceneImages.size} scene images, ${currentStoryPackage.audioFiles.size} audio files.`;
  }
  if (quiz) {
    const row = currentStoryRow();
    quiz.assets = {
      ...(quiz.assets || {}),
      backgroundImage: row.background_image || quiz.assets?.backgroundImage,
      coverImage: row.cover_image || quiz.assets?.coverImage
    };
    renderAll();
  }
  toast(`${fileList.length} resource file(s) updated.`);
}

async function generateBatchAiDrafts() {
  const sourceRows = batchInputRows.length ? batchInputRows : [];
  if (!sourceRows.length) {
    toast('癒쇱? Story Batch?먯꽌 Format XLSX瑜??낅줈?쒗빐 二쇱꽭??');
    return;
  }
  const apiKey = $('api-key').value.trim();
  const provider = $('ai-provider').value;
  syncCurrentBatchItem();
  const btn = $('batch-ai-generate-btn');
  const originalText = btn.textContent;
  btn.disabled = true;
  try {
    if (isLocalOrigin()) {
      btn.textContent = 'Generating...';
      const res = await fetch('/api/generate-batch-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          apiKey,
          stories: sourceRows
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'AI batch generation failed.');
      batchGeneratedItems = (data.items || []).map((entry, index) => {
        const row = normalizeBatchRow(entry.row || sourceRows[index] || {}, index);
        const qz = completeGeneratedQuiz(entry.quiz || {}, row);
        const issues = [...(entry.issues || []), ...validateQuizDraft(qz, row)];
        return { row, status: issues.length ? 'Needs Review' : normalizeStatus(entry.status || 'Generated'), issues, quiz: qz };
      });
    } else {
      if (!apiKey) throw new Error('?뱀뿉?쒕뒗 API Key瑜??낅젰??二쇱꽭??');
      const prompt = await loadGenerationPrompt();
      const generatedItems = [];
      for (let index = 0; index < sourceRows.length; index += 1) {
        const row = sourceRows[index];
        btn.textContent = `Generating ${index + 1}/${sourceRows.length}`;
        try {
          const input = aiInputFromRow(row, index);
          const generated = await callAiInBrowser(provider, prompt, input, apiKey);
          const qz = completeGeneratedQuiz(generated, row);
          const issues = validateQuizDraft(qz, row);
          generatedItems.push({
            row,
            status: issues.length ? 'Needs Review' : 'Generated',
            issues,
            quiz: qz
          });
        } catch (storyError) {
          const fallback = quizFromBatchRow(row);
          generatedItems.push({
            row,
            status: 'Needs Review',
            issues: [`AI generation failed: ${storyError.message}`],
            quiz: fallback
          });
        }
      }
      batchGeneratedItems = generatedItems;
    }
    showBatchOutputs(true);
    toast(`${provider}濡?${batchGeneratedItems.length}媛?珥덉븞???앹꽦?덉뒿?덈떎. ?꾨옒?먯꽌 ?곗텧臾쇱쓣 ?ㅼ슫濡쒕뱶?????덉뒿?덈떎.`);
  } catch (error) {
    toast(`AI Batch ?ㅽ뙣: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function renderBatchList() {
  const list = $('batch-list');
  const count = $('batch-count');
  if (!list || !count) return;
  count.textContent = `${batchItems.length} stories`;
  if (!batchItems.length) {
    list.innerHTML = '<div class="batch-empty">Story Batch?먯꽌 Batch XLSX瑜?遺덈윭?ㅺ굅?? ?ш린?먯꽌 Quiz/Batch JSON??遺덈윭?ㅻ㈃ ?ㅽ넗由щ? ?좏깮?????덉뒿?덈떎.</div>';
    return;
  }
  list.innerHTML = batchItems.map((item, index) => {
    const row = item.row || {};
    const status = normalizeStatus(item.status);
    return `<button class="batch-item${index === currentBatchIndex ? ' active' : ''}" onclick="selectBatchItem(${index})">
      <div class="batch-title-row">
        <span class="batch-story-id">${escapeHtml(row.story_id || item.id)}</span>
        <span class="status-badge ${statusClass(status)}">${escapeHtml(status)}</span>
      </div>
      <div class="batch-title">${escapeHtml(row.title || 'Untitled Story')}</div>
    </button>`;
  }).join('');
}

function renderReviewPanel() {
  const issueList = $('issue-list');
  if (!issueList) return;
  if (!quiz) {
    issueList.textContent = 'Generate or upload a quiz to see validation notes.';
    return;
  }
  const issues = validateQuizDraft(quiz, currentStoryRow());
  if (!issues.length) {
    issueList.innerHTML = '<strong>Validation passed</strong><br>Review the quiz content and export when ready.';
    return;
  }
  issueList.innerHTML = `<strong>Needs review</strong><ul>${issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>`;
}

function selectBatchItem(index, saveCurrent = true) {
  if (!batchItems[index]) return;
  if (saveCurrent) syncCurrentBatchItem();
  currentBatchIndex = index;
  const item = batchItems[index];
  if (!item.quiz) {
    item.quiz = quizFromBatchRow(item.row);
    item.issues = validateQuizDraft(item.quiz, item.row);
    item.status = item.issues.length ? 'Needs Review' : 'Generated';
  }
  quiz = deepClone(item.quiz);
  currentQuestionIndex = 0;
  syncStoryInputs();
  renderAll();
}

function syncCurrentBatchItem() {
  if (currentBatchIndex < 0 || !batchItems[currentBatchIndex] || !quiz) return;
  const item = batchItems[currentBatchIndex];
  item.quiz = deepClone(quiz);
  item.row.story_id = quiz.story?.storyId || item.row.story_id;
  item.row.title = quiz.story?.title || item.row.title;
  item.row.level = quiz.story?.level || item.row.level;
  item.row.story_text = quiz.story?.text || item.row.story_text;
  item.issues = validateQuizDraft(item.quiz, item.row);
  if (item.status !== 'Approved') item.status = item.issues.length ? 'Needs Review' : 'Generated';
}

function setCurrentBatchStatus(status) {
  syncCurrentBatchItem();
  if (currentBatchIndex < 0 || !batchItems[currentBatchIndex]) {
    toast('癒쇱? Batch ??ぉ???좏깮??二쇱꽭??');
    return;
  }
  batchItems[currentBatchIndex].status = normalizeStatus(status);
  renderAll();
  toast(`${batchItems[currentBatchIndex].row.story_id} ?곹깭瑜?${normalizeStatus(status)}濡?諛붽엥?듬땲??`);
}

function loadBatchBundle(parsed) {
  const sourceItems = Array.isArray(parsed) ? parsed : (parsed.items || parsed.quizzes || parsed.stories || []);
  batchItems = sourceItems.map((entry, index) => {
    const qz = entry.quiz || (entry.schemaVersion === 'quiz-v3.0' ? entry : null);
    const row = normalizeBatchRow(entry.row || entry.story || entry, index);
    const item = createBatchItem(row, index);
    if (qz) {
      item.quiz = qz;
      item.status = normalizeStatus(entry.status || row.status || 'Generated');
      item.issues = [...(entry.issues || []), ...validateQuizDraft(qz, row)];
    }
    return item;
  });
  currentBatchIndex = -1;
  if (batchItems.length) selectBatchItem(0, false);
  else renderBatchList();
}

function loadBatchFile(file) {
  if (!file) return;
  if (!window.XLSX) {
    toast('XLSX ?쇱씠釉뚮윭由щ? 遺덈윭?ㅼ? 紐삵뻽?듬땲??');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const wb = XLSX.read(reader.result, { type: 'array' });
      const sheetName = wb.SheetNames.includes('INPUT') ? 'INPUT' : wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
      batchInputRows = rows.map((row, index) => normalizeBatchRow(row, index));
      batchGeneratedItems = [];
      showBatchOutputs(false);
      updateBatchInputStatus();
      toast(`${batchInputRows.length}媛?Story Batch ?낅젰??遺덈윭?붿뒿?덈떎.`);
    } catch (error) {
      console.error(error);
      toast('Batch ?뚯씪 ?뺤떇???뺤씤??二쇱꽭??');
    }
  };
  reader.readAsArrayBuffer(file);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'utf-8');
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function rowsFromSheet(wb, sheetName) {
  return wb.Sheets[sheetName] ? XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' }) : [];
}

function rowValue(rows, label) {
  const row = rows.find(r => String(r[0] || '').trim().toLowerCase() === label.toLowerCase());
  return row ? row[1] : '';
}

function rowsAfterHeader(rows, headerLabel) {
  const start = rows.findIndex(r => String(r[0] || '').trim() === headerLabel);
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row.some(cell => String(cell || '').trim())) break;
    out.push(row);
  }
  return out;
}

function quizFromReadingWorkbook(wb, fallbackName = 'Uploaded Quiz') {
  const quizRows = rowsFromSheet(wb, 'QUIZ_LIST');
  const storyId = rowValue(quizRows, 'Story ID') || fallbackName.replace(/\.[^.]+$/, '') || 'UPLOADED';
  const title = rowValue(quizRows, 'Title') || storyId;
  const level = rowValue(quizRows, 'Level') || 'Uploaded Level';
  const metaRows = rowsAfterHeader(quizRows, 'Q_ID');
  const metaByQid = new Map(metaRows.map(r => [r[0], {
    qId: r[0],
    number: Number(r[1]) || metaRows.indexOf(r) + 1,
    storyGrammar: r[2],
    type: r[3],
    instruction: r[4],
    hint: r[5],
    formula: r[6]
  }]));
  const questionSheets = wb.SheetNames.filter(name => /^Q\d{2}_/i.test(name));
  const questions = questionSheets.map((sheetName, idx) => {
    const rows = rowsFromSheet(wb, sheetName);
    const qId = rowValue(rows, 'Q_ID') || `${storyId}_V3_Q${String(idx + 1).padStart(2, '0')}`;
    const meta = metaByQid.get(qId) || {};
    const resources = { images: [] };
    rowsAfterHeader(rows, 'Kind').forEach(r => {
      const kind = r[0];
      if (kind === 'image') resources.images.push({ id: r[1], path: r[2], kind: 'image', sceneId: r[3], sentenceId: r[4] });
      if (kind === 'audio') resources.audio = { id: r[1], path: r[2], kind: 'audio', sceneId: r[3], sentenceId: r[4] };
      if (kind === 'scene') resources.scene = r[3] || r[1];
    });
    const interactionText = rowValue(rows, 'JSON');
    let interaction = {};
    try { interaction = interactionText ? JSON.parse(interactionText) : {}; } catch { interaction = {}; }
    const components = rowsAfterHeader(rows, 'Key').map(r => ({
      key: r[0],
      weight: r[1],
      rule: r[2],
      correctValue: r[3],
      partialCredit: r[4],
      rationale: r[5]
    }));
    const diagnostics = rowsAfterHeader(rows, 'Code').map(r => ({ code: r[0], threshold: r[1], messageKo: r[2] }));
    return {
      qId,
      number: meta.number || idx + 1,
      type: rowValue(rows, 'Type') || meta.type || 'text_mcq',
      storyGrammar: meta.storyGrammar || sheetName.replace(/^Q\d{2}_/i, '').toLowerCase(),
      instruction: rowValue(rows, 'Instruction') || meta.instruction || '',
      hint: rowValue(rows, 'Hint') || meta.hint || '',
      resources,
      interaction,
      scoring: {
        type: components[0]?.rule || 'imported',
        maxScore: 100,
        formula: meta.formula || '',
        components
      },
      diagnostics,
      lrs: { verb: 'answered', objectId: `quiz_${storyId}_v3_Q${String(idx + 1).padStart(2, '0')}`, resultFields: ['score_raw'] }
    };
  });
  return applyDefaultAssetsToQuiz({
    schemaVersion: 'quiz-v3.0',
    story: { storyId, title, level, text: '', scenes: [] },
    assets: {},
    storyGrammarAxes: Object.keys(SG_LABELS).map(key => ({ key, labelEn: SG_LABELS[key], labelKo: SG_KO[key], descriptionKo: '' })),
    questions,
    reporting: defaultReporting(),
    generation: { provider: 'imported_xlsx', model: 'xlsx-parser', promptVersion: 'story_grammar_v3', createdAt: new Date().toISOString().slice(0, 10), notes: 'Imported from Reading Quiz XLSX.' }
  }, { story_id: storyId, title, level, story_text: '' });
}

function quizFromDevWorkbook(wb, fallbackName = 'Uploaded Quiz') {
  if (!wb.Sheets.QUESTIONS) return null;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.QUESTIONS, { defval: '' });
  if (!rows.length) return null;
  const storyId = rows[0].story_id || fallbackName.replace(/\.[^.]+$/, '') || 'UPLOADED';
  const storyLevel = rows[0].story_level || rows[0].level || rows[0].Level || 'Uploaded Level';
  const resources = XLSX.utils.sheet_to_json(wb.Sheets.RESOURCES || {}, { defval: '' });
  const options = XLSX.utils.sheet_to_json(wb.Sheets.OPTIONS || {}, { defval: '' });
  const rules = XLSX.utils.sheet_to_json(wb.Sheets.SCORING_RULES || {}, { defval: '' });
  const questions = rows.map((r, idx) => {
    const qResources = resources.filter(x => x.q_id === r.q_id);
    const qOptions = options.filter(x => x.q_id === r.q_id);
    return {
      qId: r.q_id,
      number: Number(r.number) || idx + 1,
      storyGrammar: r.story_grammar,
      type: r.question_type,
      instruction: r.instruction,
      hint: r.hint,
      resources: {
        images: qResources.filter(x => x.resource_kind === 'image').map(x => ({ id: x.resource_id, path: x.path, kind: 'image', sceneId: x.scene_id, sentenceId: x.sentence_id })),
        audio: (() => {
          const a = qResources.find(x => x.resource_kind === 'audio');
          return a ? { id: a.resource_id, path: a.path, kind: 'audio', sceneId: a.scene_id, sentenceId: a.sentence_id } : undefined;
        })()
      },
      interaction: qOptions.length ? { promptMode: 'text_mcq', options: qOptions.map(o => ({ key: o.option_key, text: o.option_text, score: o.score, isCorrect: !!o.is_correct, diagnostic: o.diagnostic })), correct: qOptions.find(o => o.is_correct)?.option_key || '' } : {},
      scoring: { type: 'imported', maxScore: r.max_score || 100, formula: r.formula, components: rules.filter(x => x.q_id === r.q_id).map(x => ({ key: x.component_key, weight: x.weight, rule: x.rule, correctValue: x.correct_value, partialCredit: x.partial_credit, rationale: x.rationale })) },
      diagnostics: [],
      lrs: { verb: 'answered', objectId: `quiz_${storyId}_v3_Q${String(idx + 1).padStart(2, '0')}`, resultFields: ['score_raw'] }
    };
  });
  return applyDefaultAssetsToQuiz({
    schemaVersion: 'quiz-v3.0',
    story: { storyId, title: storyId, level: storyLevel, text: '', scenes: [] },
    assets: {},
    storyGrammarAxes: Object.keys(SG_LABELS).map(key => ({ key, labelEn: SG_LABELS[key], labelKo: SG_KO[key], descriptionKo: '' })),
    questions,
    reporting: defaultReporting(),
    generation: { provider: 'imported_devspec', model: 'xlsx-parser', promptVersion: 'story_grammar_v3', createdAt: new Date().toISOString().slice(0, 10), notes: 'Imported from Dev Spec XLSX.' }
  }, { story_id: storyId, title: storyId, level: storyLevel, story_text: '' });
}

function quizCompletenessScore(qz) {
  if (!qz?.questions?.length) return 0;
  return qz.questions.reduce((total, q) => {
    const hasImages = (q.resources?.images || []).length > 0 ? 1 : 0;
    const hasAudio = q.resources?.audio ? 1 : 0;
    return total
      + (hasMeaningfulInteraction(q) ? 4 : 0)
      + (hasMeaningfulScoring(q) ? 3 : 0)
      + hasImages
      + hasAudio;
  }, qz.questions.length);
}

function dedupeLoadedQuizItems(items) {
  const byStory = new Map();
  items.forEach((item, idx) => {
    const storyId = item.quiz?.story?.storyId || item.row?.story_id || `uploaded_${idx}`;
    const candidateScore = quizCompletenessScore(item.quiz);
    const current = byStory.get(storyId);
    if (!current || candidateScore > current.score) {
      byStory.set(storyId, { item, score: candidateScore });
    }
  });
  return [...byStory.values()].map(entry => entry.item);
}

async function loadQuizUploadFiles(files) {
  const fileList = Array.from(files || []);
  if (!fileList.length) return;
  showLeftSection('open');
  const loadedItems = [];
  try {
    for (const file of fileList) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.zip')) {
        if (!window.JSZip) throw new Error('ZIP ?쇱씠釉뚮윭由щ? 遺덈윭?ㅼ? 紐삵뻽?듬땲??');
        const zip = await JSZip.loadAsync(await readFileAsArrayBuffer(file));
        const zipEntries = Object.values(zip.files).filter(entry => !entry.dir);
        const jsonEntries = zipEntries.filter(entry => entry.name.toLowerCase().endsWith('.json'));
        const assetEntries = zipEntries.filter(entry => /\.(png|jpe?g|webp|gif|mp3|wav|m4a|ogg)$/i.test(entry.name));
        for (const entry of assetEntries) {
          const blob = await entry.async('blob');
          const assetFile = new File([blob], fileName(entry.name), { type: blob.type || 'application/octet-stream' });
          registerAssetFile(assetFile, entry.name);
        }
        for (const entry of jsonEntries) {
          const parsed = JSON.parse(await entry.async('string'));
          if (parsed.schemaVersion === 'quiz-batch-v1.0' || Array.isArray(parsed.items)) {
            (parsed.items || []).forEach((item, idx) => loadedItems.push({ ...item, row: normalizeBatchRow(item.row || item.quiz?.story || {}, idx) }));
          } else {
            loadedItems.push({ row: normalizeBatchRow(parsed.story || {}, loadedItems.length), status: 'Generated', issues: [], quiz: parsed });
          }
        }
      } else if (lower.endsWith('.json')) {
        const parsed = JSON.parse(await readFileAsText(file));
        if (parsed.schemaVersion === 'quiz-batch-v1.0' || Array.isArray(parsed.items)) {
          (parsed.items || []).forEach((item, idx) => loadedItems.push({ ...item, row: normalizeBatchRow(item.row || item.quiz?.story || {}, idx) }));
        } else {
          loadedItems.push({ row: normalizeBatchRow(parsed.story || {}, loadedItems.length), status: 'Generated', issues: [], quiz: parsed });
        }
      } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const wb = XLSX.read(await readFileAsArrayBuffer(file), { type: 'array' });
        const qz = wb.SheetNames.includes('QUIZ_LIST')
          ? quizFromReadingWorkbook(wb, file.name)
          : quizFromDevWorkbook(wb, file.name);
        if (qz) loadedItems.push({ row: normalizeBatchRow(qz.story || {}, loadedItems.length), status: 'Generated', issues: validateQuizDraft(qz, qz.story || {}), quiz: qz });
      }
    }
    if (!loadedItems.length) {
      toast('遺덈윭?????덈뒗 ?댁쫰 ?뚯씪???놁뒿?덈떎.');
      return;
    }
    const uniqueItems = dedupeLoadedQuizItems(loadedItems);
    currentStoryPackage = null;
    renderResourceSummary(null);
    if ($('package-status')) $('package-status').textContent = 'Existing quiz loaded. Upload a story folder to create a new quiz.';
    loadBatchBundle({ schemaVersion: 'quiz-batch-v1.0', items: uniqueItems });
    const status = $('asset-status');
    if (status && assetFiles.size) status.textContent = `${assetCount()} asset files loaded for preview/export.`;
    toast(`${uniqueItems.length}媛?Quiz ??ぉ??遺덈윭?붿뒿?덈떎.`);
  } catch (error) {
    console.error(error);
    toast(`Quiz Upload ?ㅽ뙣: ${error.message}`);
  }
}

function downloadBatchTemplate() {
  if (!window.XLSX) {
    toast('XLSX ?쇱씠釉뚮윭由щ? 遺덈윭?ㅼ? 紐삵뻽?듬땲??');
    return;
  }
  const wb = XLSX.utils.book_new();
  aoaSheet(wb, 'INPUT', [
    BATCH_COLUMNS,
    [
      'OG0001',
      'Sample Story',
      'Level 1',
      'SC01_ST01_N = The story starts here.\nSC02_ST01_N = A problem begins.\nSC03_ST01_N = The character tries something.\nSC04_ST01_N = The character feels sad.\nSC05_ST01_N = The story ends.',
      'Optional memo'
    ]
  ]);
  aoaSheet(wb, 'README', [
    ['Column', 'Required', 'Description'],
    ['story_id', 'Y', 'Story code such as OG0021'],
    ['title', 'Y', 'Story title'],
    ['level', 'Y', 'Level label'],
    ['story_text', 'Y', 'Use SC##_ST##_N = sentence lines.'],
    ['notes', 'N', 'Internal memo'],
    [],
    ['Asset Rule', 'Description', 'Example'],
    ['Images', 'Do not enter local file paths in this sheet. Studio matches images by filename after you load an Assets folder.', 'OG0021_SC01_I.webp or OG0021_SC01_I_1920x1080.webp'],
    ['Audio', 'Do not enter local file paths in this sheet. Studio matches audio by filename after you load an Assets folder.', 'OG0021_SC02_ST01_N_A.mp3'],
    ['Cover', 'Cover images are matched by filename when included in the selected Assets folder or exported package.', 'OG0021_Cover_L_I.webp or OG0021_Cover_L_I_1920x1080.webp'],
    ['Reopen', 'Use QuizBatch.json or an individual *.quiz.json as the editable source. XLSX files are export deliverables.', 'QuizBatch.json']
  ]);
  XLSX.writeFile(wb, 'StoryBatch_Input_Template.xlsx');
}

function exportBatchJson() {
  syncCurrentBatchItem();
  const items = batchGeneratedItems.length ? batchGeneratedItems : batchItems;
  if (!items.length) {
    toast('?ㅼ슫濡쒕뱶???앹꽦 寃곌낵媛 ?놁뒿?덈떎.');
    return;
  }
  const payload = {
    schemaVersion: 'quiz-batch-v1.0',
    exportedAt: new Date().toISOString(),
    items: items.map(item => ({
      row: item.row,
      status: item.status,
      issues: item.issues || [],
      quiz: item.quiz
    }))
  };
  downloadBlob('QuizBatch.json', 'application/json;charset=utf-8', JSON.stringify(payload, null, 2));
}

function workbookForQuiz(sourceQuiz, kind) {
  const previousQuiz = quiz;
  quiz = sourceQuiz;
  const wb = XLSX.utils.book_new();
  if (kind === 'dev') buildDevWorkbook(wb);
  else buildReadingWorkbook(wb);
  quiz = previousQuiz;
  return wb;
}

function packageQuizForExport(sourceQuiz) {
  const packaged = sanitizeGeneratedQuiz(ensureImageResourcesForQuiz(deepClone(sourceQuiz)));
  packaged.assets = packaged.assets || {};
  packaged.assets.imageBasePath = 'Image/';
  packaged.assets.audioBasePath = 'Audio/';
  packaged.assets.coverBasePath = 'Cover/';
  if (packaged.assets.backgroundImage) packaged.assets.backgroundImage = `Image/${resolvedAssetFileName(packaged.assets.backgroundImage)}`;
  if (packaged.assets.coverImage) packaged.assets.coverImage = `Cover/${resolvedAssetFileName(packaged.assets.coverImage)}`;
  if (packaged.assets.hintCharacter) packaged.assets.hintCharacter = `Assets/${resolvedAssetFileName(packaged.assets.hintCharacter)}`;
  (packaged.questions || []).forEach(q => {
    (q.resources?.images || []).forEach(img => {
      if (img.path) img.path = resolvedAssetFileName(img.path);
    });
    if (q.resources?.audio?.path) q.resources.audio.path = resolvedAssetFileName(q.resources.audio.path);
  });
  return packaged;
}

function previewHtmlForQuiz(sourceQuiz, simulate) {
  const data = JSON.stringify(sourceQuiz).replace(/</g, '\\u003c');
  const title = escapeHtml(sourceQuiz.story?.title || sourceQuiz.story?.storyId || 'Reading Quiz');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} Reading Quiz</title><style>
body{font-family:Arial,sans-serif;margin:0;color:#263148;background:#f7f4ff}
.page{min-height:100vh;padding:28px;background:linear-gradient(rgba(255,255,255,.76),rgba(255,255,255,.76)),var(--bg);background-size:cover;background-position:center;background-attachment:fixed}
.wrap{max-width:980px;margin:auto}.head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:18px}
h1{margin:0;font-size:30px}.meta{color:#6b7280;font-weight:700}.nav{display:flex;gap:8px;flex-wrap:wrap}.nav button{width:40px;height:40px;border:0;border-radius:50%;background:#ede9fe;color:#6d28d9;font-weight:900}.nav button.active{background:#111827;color:white}
.card{background:#fff;border-radius:22px;padding:22px;box-shadow:0 12px 30px rgba(0,0,0,.08)}
.pill{display:inline-flex;background:#ede9fe;color:#6d28d9;border-radius:99px;padding:5px 10px;font-weight:bold;margin-bottom:8px}.instruction{font-size:21px;font-weight:800;margin:8px 0 16px}
.scene-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.sequence-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
.scene{border:2px solid #ede9fe;border-radius:14px;overflow:hidden;background:#faf7ff;aspect-ratio:16/9;position:relative}.scene.draggable{cursor:grab}.scene.selected{border-color:#7c3aed;box-shadow:0 0 0 3px #ede9fe}
.scene img{width:100%;height:100%;object-fit:cover;display:block}.scene span{display:none;position:absolute;inset:0;align-items:center;justify-content:center;color:#8b5cf6;font-weight:900;background:#f5f3ff}.scene.missing span{display:flex}
.slots{display:grid;gap:10px;margin:16px 0}.seq-slots{grid-template-columns:repeat(5,1fr)}.setting-slots{grid-template-columns:repeat(3,1fr)}
.slot{min-height:78px;border:2px dashed #c4b5fd;border-radius:12px;background:#faf7ff;color:#6d28d9;font-weight:900;text-align:center;padding:10px;display:flex;align-items:center;justify-content:center}
.slot.filled{background:white;border-style:solid}.slot .scene{width:100%}.slot-label{font-weight:900;color:#4c1d95;text-align:center;margin-bottom:6px}
.chips,.options{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px}.chip,.option{border:2px solid #d8b4fe;background:#fff;color:#4c1d95;border-radius:12px;padding:10px 14px;font-weight:800}.chip{cursor:grab}
.answer{min-height:72px;border:2px dashed #c4b5fd;border-radius:12px;background:#faf7ff;padding:10px;display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;color:#6d28d9;font-weight:900}
.option{color:#374151;min-width:190px;cursor:pointer}.option.selected{border-color:#7c3aed;background:#f5f3ff}.audio{display:inline-flex;background:#7c3aed;color:white;border:0;border-radius:99px;padding:10px 16px;font-weight:bold;margin-bottom:12px}
.hint{display:flex;align-items:center;gap:10px;margin-top:16px;padding:10px 12px;border-radius:16px;background:#fff8dd;color:#7c5b00}.hint img{width:42px;height:42px;border-radius:50%;object-fit:contain;background:white}
.actions{display:flex;gap:10px;margin-top:18px}.actions button{border:0;border-radius:999px;padding:10px 18px;font-weight:900}.check{background:#7c3aed;color:white}.next{background:#ede9fe;color:#6d28d9}.score{margin-top:12px;font-weight:900;color:#111827}
pre{white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:10px;color:#4b5563;font-size:12px}
@media(max-width:760px){.scene-grid,.sequence-grid,.setting-slots{grid-template-columns:1fr}.seq-slots{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main class="page"><div class="wrap"><div class="head"><div><h1 id="title"></h1><div class="meta" id="meta"></div></div><div class="nav" id="nav"></div></div><div id="app"></div></div></main><script>
const quiz=${data};
var current=0;var answers={};var checked={};var rtStart={};var rtData={};var skData={};var icData={};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function asset(p,kind){if(!p)return'';if(/^(https?:|data:|blob:|\\/)/.test(p))return p;if(String(p).indexOf('/')>=0)return p;var base=kind==='audio'?(quiz.assets.audioBasePath||'Audio/'):(quiz.assets.imageBasePath||'Image/');return base+p;}
function sceneFrom(v){var m=String(v||'').match(/(SC\\d{2})/i);return m?m[1].toUpperCase():'';}
function imgForScene(q,scene){var imgs=(q.resources&&q.resources.images)||[];for(var i=0;i<imgs.length;i++){var id=(imgs[i].sceneId||imgs[i].id||sceneFrom(imgs[i].path)||'').toUpperCase();if(id===scene)return imgs[i];}return {id:scene,sceneId:scene,path:(quiz.story.storyId||'STORY')+'_'+scene+'_I.webp'};}
function imageCard(img,cls,attrs){var scene=(img.sceneId||img.id||sceneFrom(img.path)||'Scene');return '<div class="scene '+(cls||'')+'" '+(attrs||'')+'><img src="'+esc(asset(img.path,'image'))+'" alt="'+esc(scene)+'" onerror="this.parentNode.classList.add(\\'missing\\')"><span>'+esc(scene)+'</span></div>';}
function state(q,init){var id=q.qId||('q'+q.number);if(!answers[id])answers[id]=init();return answers[id];}
function drag(ev,type,key){ev.dataTransfer.setData('text/plain',JSON.stringify({type:type,key:key}));}
function allow(ev){ev.preventDefault();}
function readDrag(ev,type){try{var d=JSON.parse(ev.dataTransfer.getData('text/plain')||'{}');return d.type===type?d.key:'';}catch(e){return'';}}
function scoreSeq(q){var s=state(q,function(){return {slots:Array((q.interaction.correct||[]).length).fill('')}}).slots;var comps=q.scoring.components||[];var total=comps.reduce(function(a,c){return a+Number(c.weight||0)},0)||1;var earned=0;comps.forEach(function(c,idx){var pos=s.indexOf(c.key);if(pos>=0)earned+=Number(c.weight||0)*Math.max(0,1-Math.abs(pos-idx)*.5);});return Math.round(earned/total*100);}
function scoreSetting(q){var s=state(q,function(){return {slots:{}}}).slots;var comps=q.scoring.components||[];var items={};(q.interaction.items||[]).forEach(function(i){items[i.key]=i});var total=comps.reduce(function(a,c){return a+Number(c.weight||0)},0)||1;var earned=0;comps.forEach(function(c){var key=s[c.key];var item=items[key]||{};if(key===c.correctValue)earned+=Number(c.weight||0);else if(item.slot===c.key)earned+=Number(c.weight||0)*Number(c.partialCredit||.35);});return Math.round(earned/total*100);}
function scoreWords(q){var s=state(q,function(){return {words:[]}}).words.map(function(x){return String(x).replace(/^\\d+:/,'')});var comps=q.scoring.components||[];var total=comps.reduce(function(a,c){return a+Number(c.weight||0)},0)||1;var earned=0;comps.forEach(function(c,idx){if(s[idx]===c.key)earned+=Number(c.weight||0);});return Math.round(earned/total*100);}
function scoreOption(q){var sel=state(q,function(){return {selected:''}}).selected;var opt=(q.interaction.options||[]).find(function(o){return o.key===sel});return Number(opt&&opt.score||0);}
function scoreCurrent(){var q=quiz.questions[current];if(q.type==='story_sequence_drag')return scoreSeq(q);if(q.type==='setting_slot_drag')return scoreSetting(q);if(q.type==='scene_word_unscramble')return scoreWords(q);return scoreOption(q);}
function check(){var q=quiz.questions[current];var id=q.qId||q.number;checked[id]=scoreCurrent();rtData[id]=Math.round((Date.now()-(rtStart[id]||Date.now()))/100)/10;skData[id]=(answers[id]&&answers[id].selected)||null;icData[id]=checked[id]>=100;render();}
function play(path){var url=asset(path,'audio');if(!url)return;new Audio(url).play();}
function renderNav(){var nav=document.getElementById('nav');nav.innerHTML=quiz.questions.map(function(q,i){return '<button class="'+(i===current?'active':'')+'" onclick="current='+i+';render()">'+(q.number||i+1)+'</button>';}).join('');}
function renderQ1(q){var s=state(q,function(){return {slots:Array((q.interaction.correct||[]).length).fill('')}}).slots;var all=(q.interaction.correct||[]).slice(0,5);var used=new Set(s.filter(Boolean));var slots='<div class="slots seq-slots">'+all.map(function(scene,i){return '<div class="slot '+(s[i]?'filled':'')+'" ondragover="allow(event)" ondrop="var k=readDrag(event,\\'scene\\');if(k){answers[\\''+(q.qId||q.number)+'\\'].slots['+i+']=k;render()}">'+(s[i]?imageCard(imgForScene(q,s[i]),'', 'onclick="answers[\\''+(q.qId||q.number)+'\\'].slots['+i+']=\\'\\';render()"'):'Scene '+(i+1))+'</div>';}).join('')+'</div>';var bank='<div class="scene-grid sequence-grid">'+all.filter(function(scene){return !used.has(scene)}).map(function(scene){return imageCard(imgForScene(q,scene),'draggable','draggable="true" ondragstart="drag(event,\\'scene\\',\\''+scene+'\\')"');}).join('')+'</div>';return bank+slots;}
function renderQ2(q){var s=state(q,function(){return {slots:{}}}).slots;var used=new Set(Object.values(s));var imgs=(q.resources&&q.resources.images)||[];var slots='<div class="slots setting-slots">'+(q.interaction.slots||[]).map(function(slot){var item=(q.interaction.items||[]).find(function(i){return i.key===s[slot.key]});return '<div><div class="slot-label">'+esc(slot.label)+'</div><div class="slot '+(item?'filled':'')+'" ondragover="allow(event)" ondrop="var k=readDrag(event,\\'card\\');if(k){answers[\\''+(q.qId||q.number)+'\\'].slots[\\''+slot.key+'\\']=k;render()}">'+(item?'<span class="chip" onclick="delete answers[\\''+(q.qId||q.number)+'\\'].slots[\\''+slot.key+'\\'];render()">'+esc(item.text||item.key)+'</span>':'Drop here')+'</div></div>';}).join('')+'</div>';var cards='<div class="chips">'+(q.interaction.items||[]).filter(function(item){return !used.has(item.key)}).map(function(item){return '<span class="chip" draggable="true" ondragstart="drag(event,\\'card\\',\\''+esc(item.key)+'\\')">'+esc(item.text||item.key)+'</span>';}).join('')+'</div>';return '<div class="scene-grid">'+imageCard(imgs[0]||{},'','')+'</div>'+slots+cards;}
function renderQ3(q){var s=state(q,function(){return {selected:''}});var opts=q.interaction.options||[];var audio=q.resources&&q.resources.audio;var imgs=(q.resources&&q.resources.images)||[];return (audio?'<button class="audio" onclick="play(\\''+esc(audio.path||'')+'\\')">Listen</button>':'')+'<div class="scene-grid">'+opts.map(function(o,i){var scene=sceneFrom(o.sceneId||o.id||o.text||o.path);var img=scene?imgForScene(q,scene):(imgs[i]||{});return imageCard(img,s.selected===o.key?'selected':'','onclick="answers[\\''+(q.qId||q.number)+'\\'].selected=\\''+o.key+'\\';render()"');}).join('')+'</div>';}
function renderQ4(q){var s=state(q,function(){return {words:[]}}).words;var correct=q.interaction.correct||[];var imgs=(q.resources&&q.resources.images)||[];var all=correct.map(function(w,i){return i+':'+w});var used=new Set(s);var answer='<div class="answer" ondragover="allow(event)" ondrop="var k=readDrag(event,\\'word\\');if(k&&!answers[\\''+(q.qId||q.number)+'\\'].words.includes(k)){answers[\\''+(q.qId||q.number)+'\\'].words.push(k);render()}">'+(s.length?s.map(function(k,idx){return '<span class="chip" onclick="answers[\\''+(q.qId||q.number)+'\\'].words.splice('+idx+',1);render()">'+esc(k.replace(/^\\d+:/,''))+'</span>';}).join(''):'Drop words here.')+'</div>';var bank='<div class="chips">'+all.filter(function(k){return !used.has(k)}).reverse().map(function(k){return '<span class="chip" draggable="true" ondragstart="drag(event,\\'word\\',\\''+esc(k)+'\\')">'+esc(k.replace(/^\\d+:/,''))+'</span>';}).join('')+'</div>';return '<div class="scene-grid">'+imageCard(imgs[0]||{},'','')+'</div>'+answer+bank;}
function renderOptions(q){var s=state(q,function(){return {selected:''}});var imgs=(q.resources&&q.resources.images)||[];return '<div class="scene-grid">'+(imgs[0]?imageCard(imgs[0],'',''):'')+'</div><div class="options">'+(q.interaction.options||[]).map(function(o,i){return '<div class="option '+(s.selected===o.key?'selected':'')+'" onclick="answers[\\''+(q.qId||q.number)+'\\'].selected=\\''+o.key+'\\';render()">'+['A','B','C','D'][i]+'. '+esc(o.text||o.key)+'</div>';}).join('')+'</div>';}
function body(q){if(q.type==='story_sequence_drag')return renderQ1(q);if(q.type==='setting_slot_drag')return renderQ2(q);if(q.type==='listen_scene_mcq')return renderQ3(q);if(q.type==='scene_word_unscramble')return renderQ4(q);return renderOptions(q);}
function render(){document.querySelector('.page').style.setProperty('--bg','url("'+asset(quiz.assets.backgroundImage,'image')+'")');document.getElementById('title').textContent=quiz.story.title||quiz.story.storyId;document.getElementById('meta').textContent=(quiz.story.storyId||'')+' - '+(quiz.story.level||'');renderNav();var q=quiz.questions[current];var id=q.qId||q.number;if(!rtStart[id])rtStart[id]=Date.now();document.getElementById('app').innerHTML='<section class="card"><span class="pill">Q'+(q.number||current+1)+' - '+esc(q.storyGrammar||'')+'</span><div class="instruction">'+esc(q.instruction||'')+'</div>'+body(q)+'<div class="hint"><img src="'+esc(asset(quiz.assets.hintCharacter,'image'))+'" alt="Bookey"><span>'+esc(q.hint||'')+'</span></div><div class="actions"><button class="check" onclick="check()">Check</button><button class="next" onclick="current=Math.min(quiz.questions.length-1,current+1);render()">Next</button></div>'+(checked[id]!=null?'<div class="score">Score: '+checked[id]+' / 100 · '+(icData[id]?'✓ Correct':'✗ Incorrect')+' · RT: '+(rtData[id]||'?')+'s'+(skData[id]?' · Selected: '+esc(skData[id]):'')+'</div>':'')+'</section>';}
render();
${simulate ? `(function(){
var cur=document.createElement('div');
cur.style.cssText='position:fixed;width:22px;height:22px;border-radius:50%;background:rgba(124,58,237,0.85);border:2.5px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.4);pointer-events:none;z-index:9999;transition:left .5s ease,top .5s ease;transform:translate(-50%,-50%)';
document.body.appendChild(cur);
cur.style.left=(window.innerWidth/2)+'px';cur.style.top=(window.innerHeight/2)+'px';
function mv(el,cb){var r=el.getBoundingClientRect();cur.style.left=(r.left+r.width/2)+'px';cur.style.top=(r.top+r.height/2)+'px';setTimeout(cb,600);}
function cl(el,cb){mv(el,function(){cur.style.transform='translate(-50%,-50%) scale(.65)';setTimeout(function(){el.click();cur.style.transform='translate(-50%,-50%) scale(1)';setTimeout(cb,350);},220);});}
function step(){setTimeout(function(){
var q=quiz.questions[current];var id=q.qId||q.number;
if(checked[id]!=null){var nb=document.querySelector('.next');if(nb&&current<quiz.questions.length-1)cl(nb,step);return;}
var opts=(q.interaction&&q.interaction.options)||[];
var ci=opts.findIndex(function(o){return o.score>=100||o.isCorrect;});if(ci<0)ci=0;
if(q.type==='emotion_mcq'||q.type==='internal_response_mcq'){
  var els=document.querySelectorAll('.option');if(!els[ci])return;
  cl(els[ci],function(){setTimeout(function(){var cb=document.querySelector('.check');if(cb)cl(cb,function(){setTimeout(step,1400);});},300);});
}else if(q.type==='listen_scene_mcq'){
  var els=document.querySelectorAll('.scene-grid .img-card');var t=els[ci]||els[0];if(!t)return;
  cl(t,function(){setTimeout(function(){var cb=document.querySelector('.check');if(cb)cl(cb,function(){setTimeout(step,1400);});},300);});
}else{
  if(q.type==='story_sequence_drag'){answers[id]={slots:(q.interaction.correct||[]).slice()};}
  else if(q.type==='scene_word_unscramble'){answers[id]={words:(q.interaction.correct||[]).map(function(w,i){return i+':'+w;})};}
  else if(q.type==='setting_slot_drag'){var sl={};(q.interaction.slots||[]).forEach(function(s){var sc=q.scoring&&q.scoring.partial;if(sc&&sc[s.key])sl[s.key]=sc[s.key];});answers[id]={slots:sl};}
  render();setTimeout(function(){var cb=document.querySelector('.check');if(cb)cl(cb,function(){setTimeout(step,1400);});},900);
}
},1200);}
setTimeout(step,1800);
})();` : ''}
</script></body></html>`;
}

function collectQuizAssetEntries(sourceQuiz) {
  const entries = [];
  if (sourceQuiz.assets?.backgroundImage) entries.push({ path: sourceQuiz.assets.backgroundImage, folder: 'Image' });
  if (sourceQuiz.assets?.coverImage) entries.push({ path: sourceQuiz.assets.coverImage, folder: 'Cover', optional: true });
  if (sourceQuiz.assets?.hintCharacter) entries.push({ path: sourceQuiz.assets.hintCharacter, folder: 'Assets' });
  (sourceQuiz.questions || []).forEach(q => {
    (q.resources?.images || []).forEach(img => img.path && entries.push({ path: img.path, folder: 'Image' }));
    if (q.resources?.audio?.path) entries.push({ path: q.resources.audio.path, folder: 'Audio' });
  });
  const storyId = sourceQuiz.story?.storyId || '';
  if (storyId) {
    entries.push({ path: `${storyId}_Cover_L_I.webp`, folder: 'Cover', optional: true });
    entries.push({ path: `${storyId}_Cover_L_I_1920x1080.webp`, folder: 'Cover', optional: true });
    entries.push({ path: `${storyId}_Cover_P_I.webp`, folder: 'Cover', optional: true });
    entries.push({ path: `${storyId}_Cover_L_I.png`, folder: 'Cover', optional: true });
    entries.push({ path: `${storyId}_Cover_P_I.png`, folder: 'Cover', optional: true });
  }
  const seen = new Set();
  return entries.filter(entry => {
    const key = `${entry.folder}/${resolvedAssetFileName(entry.path).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function exportApprovedZip() {
  syncCurrentBatchItem();
  if (!window.XLSX) {
    toast('XLSX ?쇱씠釉뚮윭由щ? 遺덈윭?ㅼ? 紐삵뻽?듬땲??');
    return;
  }
  const exportItems = batchGeneratedItems.length
    ? batchGeneratedItems.filter(item => item.quiz)
    : batchItems.filter(item => normalizeStatus(item.status) === 'Approved' && item.quiz);
  if (!exportItems.length) {
    toast(batchGeneratedItems.length ? '?ㅼ슫濡쒕뱶???앹꽦 寃곌낵媛 ?놁뒿?덈떎.' : 'Approved ?곹깭??Batch ??ぉ???놁뒿?덈떎.');
    return;
  }
  if (!window.JSZip) {
    toast('ZIP ?쇱씠釉뚮윭由щ? 遺덈윭?ㅼ? 紐삵뻽?듬땲?? Batch JSON留??대낫?낅땲??');
    exportBatchJson();
    return;
  }
  const zip = new JSZip();
  exportItems.forEach(item => {
    const packagedQuiz = packageQuizForExport(item.quiz);
    const storyId = packagedQuiz.story.storyId;
    const folder = zip.folder(storyId);
    folder.file(`${storyId}.quiz.json`, JSON.stringify(packagedQuiz, null, 2));
    folder.file(`${storyId}_ReadingQuiz.html`, previewHtmlForQuiz(packagedQuiz));
    folder.file(`${storyId}_ReadingQuiz.xlsx`, XLSX.write(workbookForQuiz(packagedQuiz, 'reading'), { bookType: 'xlsx', type: 'array' }));
    folder.file(`${storyId}_DevSpec.xlsx`, XLSX.write(workbookForQuiz(packagedQuiz, 'dev'), { bookType: 'xlsx', type: 'array' }));
    collectQuizAssetEntries(item.quiz).forEach(entry => {
      const file = findLocalAssetFile(entry.path);
      if (file) folder.folder(entry.folder).file(file.name, file);
    });
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(batchGeneratedItems.length ? 'Generated_Quiz_Outputs.zip' : 'Approved_Quiz_Exports.zip', 'application/zip', blob);
  toast(`${exportItems.length}媛???ぉ??ZIP?쇰줈 ?대낫?덉뒿?덈떎.`);
}

function exportJson() {
  updateStoryFromInputs();
  downloadBlob(`${quiz.story.storyId}.quiz.json`, 'application/json;charset=utf-8', JSON.stringify(packageQuizForExport(quiz), null, 2));
}

function exportWorkbook(kind) {
  if (!window.XLSX) {
    toast('XLSX ?쇱씠釉뚮윭由щ? 遺덈윭?ㅼ? 紐삵뻽?듬땲??');
    return;
  }
  updateStoryFromInputs();
  const previousQuiz = quiz;
  quiz = packageQuizForExport(quiz);
  try {
    const wb = XLSX.utils.book_new();
    if (kind === 'dev') buildDevWorkbook(wb);
    else buildReadingWorkbook(wb);
    const filename = kind === 'dev' ? `${quiz.story.storyId}_DevSpec.xlsx` : `${quiz.story.storyId}_ReadingQuiz.xlsx`;
    XLSX.writeFile(wb, filename);
  } finally {
    quiz = previousQuiz;
  }
}

function aoaSheet(wb, name, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  return ws;
}

function buildReadingWorkbook(wb) {
  aoaSheet(wb, 'QUIZ_LIST', [
    ['Story ID', quiz.story.storyId],
    ['Title', quiz.story.title],
    ['Level', quiz.story.level],
    [],
    ['Q_ID','No','Story Grammar','Story Grammar Label','Question Type','Instruction','Hint','Scoring Formula'],
    ...quiz.questions.map(q => [q.qId, q.number, normalizeStoryGrammarKey(q.storyGrammar), storyGrammarLabel(q.storyGrammar), q.type, q.instruction, q.hint, q.scoring?.formula || ''])
  ]);
  quiz.questions.forEach(q => {
    const rows = [
      [`Q${String(q.number).padStart(2, '0')} - ${storyGrammarLabel(q.storyGrammar)}`],
      ['Q_ID', q.qId],
      ['Type', q.type],
      ['Story Grammar', normalizeStoryGrammarKey(q.storyGrammar)],
      ['Instruction', q.instruction],
      ['Hint', q.hint],
      [],
      ['SECTION A - Resources'],
      ['Kind','ID','Path','Scene ID','Sentence ID'],
      ...resourceRows(q),
      [],
      ['SECTION B - Interaction Details'],
      ...readingInteractionRows(q),
      [],
      ['SECTION C - Scoring Components'],
      ['Key','Weight','Rule','Correct Value','Partial Credit','Rationale'],
      ...(q.scoring?.components || []).map(c => [c.key, c.weight, c.rule, c.correctValue, c.partialCredit ?? '', c.rationale || '']),
      [],
      ['SECTION D - Diagnostics'],
      ['Code','Threshold','Message'],
      ...(q.diagnostics || []).map(d => [d.code, d.threshold, d.messageKo]),
      [],
      ['SECTION E - Report Comments'],
      ['Condition','Score / Weight','Report Comment','Source'],
      ...reportCommentRows(q),
      [],
      ['SECTION F - Raw JSON'],
      ['Interaction JSON', JSON.stringify(q.interaction || {}, null, 2)],
      ['Scoring JSON', JSON.stringify(q.scoring || {}, null, 2)]
    ];
    aoaSheet(wb, `Q${String(q.number).padStart(2, '0')}_${normalizeStoryGrammarKey(q.storyGrammar)}`.toUpperCase(), rows);
  });
  aoaSheet(wb, 'SG_SCORING', [
    ['Axis','Label','Question','Score Source','Formula'],
    ...quiz.questions.map(q => [normalizeStoryGrammarKey(q.storyGrammar), storyGrammarLabel(q.storyGrammar), q.qId, 'question_score', q.scoring?.formula || '']),
    [],
    ['Overall', '', '', quiz.reporting?.overallFormula || '']
  ]);
  aoaSheet(wb, 'LRS_MAPPING', [
    ['Q_ID','Verb','Object ID','Result Fields'],
    ...quiz.questions.map(q => [q.qId, q.lrs?.verb || 'answered', q.lrs?.objectId || '', (q.lrs?.resultFields || []).join(', ')])
  ]);
}

function readingInteractionRows(q) {
  if (q.type === 'story_sequence_drag') {
    const sequence = q.interaction?.correct || [];
    const weights = new Map((q.scoring?.components || []).map(c => [String(c.key), Number(c.weight) || 0]));
    const rows = [
      ['Scene ID','Correct Position','Weight','Image Path','Rubric'],
      ...sequence.map((scene, idx) => [scene, idx + 1, weights.get(String(scene)) || '', imagePathForSceneInQuestion(q, scene), idx === 0 || idx === sequence.length - 1 ? 'Anchor scene. High diagnostic weight.' : 'Middle story event. Partial position credit applies.']),
      [],
      ['Score Matrix - points by submitted position'],
      ['Scene \\ Position', ...sequence.map((_, idx) => `Pos ${idx + 1}`)]
    ];
    sequence.forEach((scene, correctIdx) => {
      const weight = weights.get(String(scene)) || 0;
      const maxPoints = weight * 10;
      rows.push([scene, ...sequence.map((_, submittedIdx) => Number((maxPoints * Math.max(0, 1 - Math.abs(submittedIdx - correctIdx) * 0.5)).toFixed(1)))]);
    });
    return rows;
  }
  if (q.type === 'setting_slot_drag') {
    const slots = q.interaction?.slots || [];
    const items = q.interaction?.items || [];
    const correct = q.interaction?.correct || {};
    const rows = [
      ['Slot Key','Label','Correct Item Key','Slot Weight','Same-Slot Partial Credit','Rule'],
      ...slots.map(slot => [slot.key, slot.label, correct[slot.key] || slot.correct || '', Number(slot.weight) || '', slot.partialCredit ?? .35, 'Exact correct card = full slot weight; wrong card from same slot category = 35%; wrong category = 0']),
      [],
      ['Item Key','Visible Text','Category Slot','Correct For Slot','Exact Credit','Same-Slot Partial Credit','Diagnostic'],
      ...items.map(item => {
        const slot = slots.find(s => s.key === item.slot) || {};
        const isCorrectSlot = Object.entries(correct).find(([, value]) => String(value) === String(item.key))?.[0] || '';
        const slotWeight = Number(slot.weight) || 0;
        return [item.key, item.text || item.key, item.slot || '', isCorrectSlot, isCorrectSlot ? slotWeight : 0, isCorrectSlot ? '' : Number((slotWeight * (slot.partialCredit ?? .35)).toFixed(2)), item.diagnostic || 'Same-category distractor if placed in its own slot; otherwise 0.'];
      })
    ];
    return rows;
  }
  if (q.type === 'scene_word_unscramble') {
    const components = q.scoring?.components || [];
    return [
      ['Token','Correct Position','Weight','Rule','Rationale'],
      ...components.map(c => [c.key, c.correctValue, c.weight, c.rule, c.rationale || 'Exact-position credit only.'])
    ];
  }
  if (Array.isArray(q.interaction?.options)) {
    return [
      ['Option Key','Visible Text','Score','Correct?','Scene ID','Image Path','Diagnostic'],
      ...q.interaction.options.map(opt => {
        const scene = sceneIdFromOption(opt);
        return [opt.key, opt.text || opt.key, Number(opt.score) || 0, !!opt.isCorrect, scene, imagePathForSceneInQuestion(q, scene), opt.diagnostic || ''];
      })
    ];
  }
  return [['JSON', JSON.stringify(q.interaction || {}, null, 2)]];
}

function buildDevWorkbook(wb) {
  aoaSheet(wb, 'QUESTIONS', [
    ['q_id','story_id','story_level','number','story_grammar','story_grammar_label','question_type','instruction','hint','max_score','formula'],
    ...quiz.questions.map(q => [q.qId, quiz.story.storyId, quiz.story.level || '', q.number, normalizeStoryGrammarKey(q.storyGrammar), storyGrammarLabel(q.storyGrammar), q.type, q.instruction, q.hint, q.scoring?.maxScore || 100, q.scoring?.formula || ''])
  ]);
  aoaSheet(wb, 'RESOURCES', [
    ['q_id','resource_kind','resource_id','path','scene_id','sentence_id'],
    ...quiz.questions.flatMap(q => resourceRows(q).map(r => [q.qId, ...r]))
  ]);
  aoaSheet(wb, 'OPTIONS', [
    ['q_id','option_key','option_text','score','is_correct','scene_id','diagnostic'],
    ...quiz.questions.flatMap(q => (q.interaction?.options || []).map(o => [q.qId, o.key, o.text, o.score, !!o.isCorrect, sceneIdFromOption(o), o.diagnostic || '']))
  ]);
  aoaSheet(wb, 'INTERACTION_ITEMS', [
    ['q_id','item_kind','item_key','visible_text','slot_or_position','scene_id','is_correct','score_or_weight','diagnostic'],
    ...quiz.questions.flatMap(q => devInteractionItemRows(q))
  ]);
  aoaSheet(wb, 'SLOT_RULES', [
    ['q_id','slot_key','slot_label','correct_item_key','slot_weight','partial_credit','partial_rule'],
    ...quiz.questions.flatMap(q => q.type === 'setting_slot_drag'
      ? (q.interaction?.slots || []).map(slot => [q.qId, slot.key, slot.label, q.interaction?.correct?.[slot.key] || slot.correct || '', slot.weight, slot.partialCredit ?? .35, 'same slot/category only'])
      : [])
  ]);
  aoaSheet(wb, 'SCORING_RULES', [
    ['q_id','component_key','weight','rule','correct_value','partial_credit','rationale'],
    ...quiz.questions.flatMap(q => (q.scoring?.components || []).map(c => [q.qId, c.key, c.weight, c.rule, c.correctValue, c.partialCredit ?? '', c.rationale || '']))
  ]);
  aoaSheet(wb, 'LRS_MAPPING', [
    ['q_id','verb','object_id','result_fields'],
    ...quiz.questions.map(q => [q.qId, q.lrs?.verb || 'answered', q.lrs?.objectId || '', (q.lrs?.resultFields || []).join('|')])
  ]);
  aoaSheet(wb, 'REPORT_COMMENTS', [
    ['q_id','story_grammar','condition','score_or_weight','report_comment','source'],
    ...quiz.questions.flatMap(q => reportCommentRows(q).map(row => [q.qId, normalizeStoryGrammarKey(q.storyGrammar), ...row]))
  ]);
}

function imagePathForSceneInQuestion(q, scene) {
  if (!scene) return '';
  return (q.resources?.images || []).find(img => String(img.sceneId || img.id || '').toUpperCase() === String(scene).toUpperCase())?.path || '';
}

function devInteractionItemRows(q) {
  if (q.type === 'story_sequence_drag') {
    const weights = new Map((q.scoring?.components || []).map(c => [String(c.key), Number(c.weight) || 0]));
    return (q.interaction?.correct || []).map((scene, idx) => [q.qId, 'sequence_scene', scene, scene, idx + 1, scene, true, weights.get(String(scene)) || '', 'position-distance weighted scene']);
  }
  if (q.type === 'setting_slot_drag') {
    const correctValues = new Set(Object.values(q.interaction?.correct || {}).map(String));
    return (q.interaction?.items || []).map(item => [q.qId, 'setting_card', item.key, item.text || item.key, item.slot || '', '', correctValues.has(String(item.key)), slotWeightForSetting(q, item.slot), item.diagnostic || '']);
  }
  if (q.type === 'scene_word_unscramble') {
    const weights = new Map((q.scoring?.components || []).map(c => [String(c.key), Number(c.weight) || 0]));
    return (q.interaction?.correct || []).map((word, idx) => [q.qId, 'word_token', word, word, idx + 1, q.resources?.scene || '', true, weights.get(String(word)) || '', 'exact-position token']);
  }
  return (q.interaction?.options || []).map(opt => [q.qId, 'option', opt.key, opt.text || opt.key, '', sceneIdFromOption(opt), !!opt.isCorrect, Number(opt.score) || 0, opt.diagnostic || '']);
}

function resourceRows(q) {
  const rows = [];
  (q.resources?.images || []).forEach(img => rows.push(['image', img.id || '', img.path || '', img.sceneId || '', img.sentenceId || '']));
  if (q.resources?.audio) {
    const a = q.resources.audio;
    rows.push(['audio', a.id || '', a.path || '', a.sceneId || '', a.sentenceId || '']);
  }
  if (q.resources?.scene) rows.push(['scene', q.resources.scene, '', q.resources.scene, q.resources.sentenceId || '']);
  return rows;
}

function reportCommentRows(q) {
  const rows = [];
  const axis = normalizeStoryGrammarKey(q.storyGrammar);
  if (q.type === 'story_sequence_drag') {
    (q.scoring?.components || []).forEach(c => {
      rows.push([
        `${c.key} placed away from position ${c.correctValue}`,
        c.weight,
        c.correctValue === 1 || c.correctValue === (q.scoring?.components || []).length
          ? '이야기의 시작 또는 결말 장면을 기준점으로 잡는 연습이 필요합니다.'
          : '중간 사건의 전후 관계를 다시 확인할 필요가 있습니다.',
        'sequence_weight'
      ]);
    });
    return rows;
  }
  if (q.type === 'setting_slot_drag') {
    (q.interaction?.items || []).forEach(item => {
      const isCorrect = Object.values(q.interaction?.correct || {}).map(String).includes(String(item.key));
      rows.push([
        `${item.key} in ${item.slot || 'wrong'} slot`,
        isCorrect ? slotWeightForSetting(q, item.slot) : Number((slotWeightForSetting(q, item.slot) * .35).toFixed(1)),
        isCorrect
          ? '배경 단서를 정확히 파악합니다.'
          : normalizeDiagnosticText(item.diagnostic || '같은 범주의 오답을 선택하여 배경 단서를 더 정확히 구분할 필요가 있습니다.'),
        'setting_card'
      ]);
    });
    return rows;
  }
  if (q.type === 'scene_word_unscramble') {
    (q.scoring?.components || []).forEach(c => {
      rows.push([
        `${c.key} not in position ${c.correctValue}`,
        c.weight,
        c.correctValue <= 2
          ? '문장의 주어와 핵심 행동을 먼저 찾는 연습이 필요합니다.'
          : '문장 안에서 행동의 세부 단서와 어순을 확인할 필요가 있습니다.',
        'word_position'
      ]);
    });
    return rows;
  }
  (q.interaction?.options || []).forEach(opt => {
    rows.push([
      `select ${opt.key}`,
      Number(opt.score) || 0,
      normalizeDiagnosticText(opt.diagnostic || fallbackOptionDiagnostic(q, opt)),
      `${axis}_option`
    ]);
  });
  return rows;
}

function exportPreviewHtml() {
  updateStoryFromInputs();
  const packagedQuiz = packageQuizForExport(quiz);
  downloadBlob(`${packagedQuiz.story.storyId}_ReadingQuiz.html`, 'text/html;charset=utf-8', previewHtmlForQuiz(packagedQuiz));
}

async function simulateQuiz() {
  await loadSample();

  // Reset to Q1
  currentQuestionIndex = 0;
  renderAll();

  // Remove old cursor
  const old = document.getElementById('sim-cursor');
  if (old) old.remove();

  const cur = document.createElement('div');
  cur.id = 'sim-cursor';
  cur.style.cssText = 'position:fixed;width:22px;height:22px;border-radius:50%;background:rgba(124,58,237,0.85);border:2.5px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.4);pointer-events:none;z-index:9999;transition:left .45s ease,top .45s ease;transform:translate(-50%,-50%)';
  document.body.appendChild(cur);

  // Start cursor at Simulate button
  const sb = $('simulate-btn').getBoundingClientRect();
  cur.style.left = (sb.left + sb.width / 2) + 'px';
  cur.style.top  = (sb.top  + sb.height / 2) + 'px';

  function mv(el, cb) {
    const r = el.getBoundingClientRect();
    cur.style.left = (r.left + r.width / 2) + 'px';
    cur.style.top  = (r.top  + r.height / 2) + 'px';
    setTimeout(cb, 520);
  }

  function cl(el, cb) {
    mv(el, () => {
      cur.style.transform = 'translate(-50%,-50%) scale(.6)';
      setTimeout(() => {
        cur.style.transform = 'translate(-50%,-50%) scale(1)';
        setTimeout(cb, 300);
      }, 200);
    });
  }

  function stepQ() {
    setTimeout(() => {
      const stage = $('preview-stage');
      const q = quiz.questions[currentQuestionIndex];

      // Pick targets based on question type
      let targets = [];
      if (q.type === 'emotion_mcq' || q.type === 'internal_response_mcq') {
        targets = Array.from(stage.querySelectorAll('.option-chip'));
      } else if (q.type === 'listen_scene_mcq') {
        targets = Array.from(stage.querySelectorAll('.scene-grid img, .img-card'));
      } else if (q.type === 'scene_word_unscramble') {
        targets = Array.from(stage.querySelectorAll('.word-chip'));
      } else {
        targets = Array.from(stage.querySelectorAll('.scene-grid img, .img-card, .word-chip, .option-chip'));
      }

      // Find correct option index
      const opts = q.interaction?.options || [];
      let ci = opts.findIndex(o => o.score >= 100 || o.isCorrect);
      if (ci < 0) ci = 0;

      const doClick = () => {
        const target = targets[Math.min(ci, targets.length - 1)];
        if (target) {
          cl(target, goNext);
        } else {
          goNext();
        }
      };

      // Hover a decoy first if there are multiple targets
      if (targets.length > 1) {
        const decoy = targets[ci === 0 ? 1 : 0];
        mv(decoy, doClick);
      } else {
        doClick();
      }
    }, 900);
  }

  function goNext() {
    setTimeout(() => {
      const nextIdx = currentQuestionIndex + 1;
      if (nextIdx >= quiz.questions.length) {
        setTimeout(() => cur.remove(), 800);
        return;
      }
      const dots = $('preview-nav').querySelectorAll('.q-dot');
      const dot = dots[nextIdx];
      if (dot) {
        cl(dot, stepQ);
      } else {
        currentQuestionIndex = nextIdx;
        renderAll();
        stepQ();
      }
    }, 600);
  }

  setTimeout(stepQ, 700);
}

function loadJsonFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (parsed.schemaVersion === 'quiz-batch-v1.0' || Array.isArray(parsed.quizzes) || Array.isArray(parsed.items)) {
        loadBatchBundle(parsed);
        toast('Batch JSON??遺덈윭?붿뒿?덈떎.');
      } else {
        syncCurrentBatchItem();
        quiz = parsed;
        currentBatchIndex = -1;
        currentQuestionIndex = 0;
        syncStoryInputs();
        renderAll();
        toast('JSON??遺덈윭?붿뒿?덈떎.');
      }
    } catch {
      toast('JSON ?뚯씪 ?뺤떇???뺤씤??二쇱꽭??');
    }
  };
  reader.readAsText(file, 'utf-8');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function bindEvents() {
  if ($('left-tab-generate')) $('left-tab-generate').onclick = () => showLeftSection('generate');
  if ($('left-tab-open')) $('left-tab-open').onclick = () => showLeftSection('open');
  if ($('story-package')) $('story-package').onchange = e => loadStoryPackage(e.target.files);
  if ($('story-file-replace')) $('story-file-replace').onchange = e => replaceStoryPackageFiles(e.target.files);
  if ($('resource-replace-file')) $('resource-replace-file').onchange = e => handleResourceReplaceFiles(e.target.files);
  if ($('load-sample-btn')) $('load-sample-btn').onclick = loadSample;
  if ($('quiz-file')) $('quiz-file').onchange = e => loadQuizUploadFiles(e.target.files);
  if ($('batch-file')) $('batch-file').onchange = e => loadBatchFile(e.target.files[0]);
  if ($('asset-folder')) $('asset-folder').onchange = e => loadAssetFolder(e.target.files);
  if ($('batch-template-btn')) $('batch-template-btn').onclick = downloadBatchTemplate;
  if ($('batch-ai-generate-btn')) $('batch-ai-generate-btn').onclick = generateBatchAiDrafts;
  if ($('batch-download-json-btn')) $('batch-download-json-btn').onclick = exportBatchJson;
  if ($('batch-download-zip-btn')) $('batch-download-zip-btn').onclick = exportApprovedZip;
  if ($('generate-ai-btn')) $('generate-ai-btn').onclick = generateAiDraft;
  if ($('apply-btn')) $('apply-btn').onclick = applyEditorChanges;
  if ($('mark-review-btn')) $('mark-review-btn').onclick = () => setCurrentBatchStatus('Needs Review');
  if ($('approve-btn')) $('approve-btn').onclick = () => setCurrentBatchStatus('Approved');
  $('question-select').onchange = e => {
    currentQuestionIndex = Number(e.target.value);
    renderAll();
  };
  $('export-json-btn').onclick = exportJson;
  $('export-reading-btn').onclick = () => exportWorkbook('reading');
  $('export-dev-btn').onclick = () => exportWorkbook('dev');
  $('export-html-btn').onclick = exportPreviewHtml;
  $('simulate-btn').onclick = simulateQuiz;
}

bindEvents();
loadSample();
