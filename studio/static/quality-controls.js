(() => {
  const DEPTHS = new Set(['literal', 'inferential', 'integrative']);
  const STOP_WORDS = new Set(['a', 'an', 'the', 'in', 'on', 'at', 'to', 'of', 'is', 'are', 'was', 'were', 'and', 'or', 'he', 'she', 'it', 'they']);
  let demoActive = false;

  const byId = id => document.getElementById(id);
  const splitIds = value => [...new Set(String(value || '')
    .split(/[\s,]+/)
    .map(item => item.trim().toUpperCase())
    .filter(Boolean))];

  function defaultDepth(q) {
    if (q?.type === 'internal_response_mcq' || q?.type === 'emotion_mcq') return 'inferential';
    if (q?.type === 'story_sequence_drag') return 'integrative';
    return 'literal';
  }

  function storySentenceIndex(sourceQuiz = quiz) {
    const out = new Map();
    (sourceQuiz?.story?.scenes || []).forEach(scene => {
      (scene.sentences || []).forEach(sentence => {
        out.set(String(sentence.sentenceId || '').toUpperCase(), {
          ...sentence,
          sceneId: String(scene.sceneId || '').toUpperCase()
        });
      });
    });
    return out;
  }

  function storySceneIndex(sourceQuiz = quiz) {
    const out = new Map();
    (sourceQuiz?.story?.scenes || []).forEach(scene => {
      out.set(String(scene.sceneId || '').toUpperCase(), (scene.sentences || []).map(sentence => sentence.text || '').join(' '));
    });
    return out;
  }

  function inferredEvidence(q, sourceQuiz = quiz) {
    const sceneIds = [];
    const sentenceIds = [];
    const addScene = value => {
      const match = String(value || '').toUpperCase().match(/SC\d{2}/);
      if (match) sceneIds.push(match[0]);
    };
    const addSentence = value => {
      const match = String(value || '').toUpperCase().match(/SC\d{2}_ST\d{2}_N/);
      if (match) {
        sentenceIds.push(match[0]);
        addScene(match[0]);
      }
    };

    addScene(q?.resources?.scene);
    (q?.resources?.images || []).forEach(image => addScene(image.sceneId || image.id || image.path));
    addScene(q?.resources?.audio?.sceneId || q?.resources?.audio?.path);
    addSentence(q?.resources?.sentenceId);
    addSentence(q?.resources?.audio?.sentenceId || q?.resources?.audio?.path);

    if (q?.type === 'scene_word_unscramble' && !sentenceIds.length) {
      const target = (q.interaction?.correct || []).join(' ').replace(/\s+([,.!?])/g, '$1').toLowerCase();
      for (const [sentenceId, sentence] of storySentenceIndex(sourceQuiz)) {
        if (target && String(sentence.text || '').toLowerCase() === target) {
          sentenceIds.push(sentenceId);
          addScene(sentence.sceneId);
          break;
        }
      }
    }

    return {
      sceneIds: [...new Set(sceneIds)],
      sentenceIds: [...new Set(sentenceIds)],
      note: ''
    };
  }

  function ensureQuestionMetadata(q, sourceQuiz = quiz) {
    if (!q) return;
    q.comprehensionDepth = DEPTHS.has(q.comprehensionDepth) ? q.comprehensionDepth : defaultDepth(q);
    const inferred = inferredEvidence(q, sourceQuiz);
    q.evidence = q.evidence && typeof q.evidence === 'object' ? q.evidence : {};
    q.evidence.sceneIds = splitIds(q.evidence.sceneIds?.length ? q.evidence.sceneIds.join(',') : inferred.sceneIds.join(','));
    q.evidence.sentenceIds = splitIds(q.evidence.sentenceIds?.length ? q.evidence.sentenceIds.join(',') : inferred.sentenceIds.join(','));
    q.evidence.note = String(q.evidence.note || '');
  }

  function ensureMeasurementPolicy(sourceQuiz = quiz) {
    if (!sourceQuiz) return;
    (sourceQuiz.questions || []).forEach(q => ensureQuestionMetadata(q, sourceQuiz));
    sourceQuiz.reporting = sourceQuiz.reporting || {};
    sourceQuiz.reporting.measurementPolicy = {
      mode: 'screening',
      singleQuizIsDiagnostic: false,
      minimumItemsPerAxisForTrend: 3,
      minimumBooksPerAxisForTrend: 3,
      measuredDomains: ['comprehension'],
      unmeasuredDomainsRequireExternalSessionData: ['reading_activity', 'pronunciation', 'vocabulary', 'expression', 'reading_risk', 'affect']
    };
  }

  function correctOption(q) {
    return (q?.interaction?.options || []).find(option => option.isCorrect || Number(option.score) === 100)
      || (q?.interaction?.options || []).find(option => String(option.key) === String(q?.interaction?.correct));
  }

  function contentWords(value) {
    return String(value || '').toLowerCase().match(/[a-z']+/g)?.filter(word => word.length >= 3 && !STOP_WORDS.has(word)) || [];
  }

  function settingEvidenceIssues(q, sourceQuiz) {
    if (q?.type !== 'setting_slot_drag') return [];
    const scenes = storySceneIndex(sourceQuiz);
    const evidenceText = (q.evidence?.sceneIds || []).map(id => scenes.get(id) || '').join(' ').toLowerCase();
    if (!evidenceText) return [];
    const correctKeys = new Set(Object.values(q.interaction?.correct || {}).map(String));
    return (q.interaction?.items || [])
      .filter(item => correctKeys.has(String(item.key)))
      .filter(item => {
        const words = contentWords(item.text || item.key);
        return words.length && !words.some(word => evidenceText.includes(word));
      })
      .map(item => `${q.qId}: correct setting card "${item.text || item.key}" is not supported by the selected evidence scene.`);
  }

  function qualityIssues(sourceQuiz) {
    const issues = [];
    const scenes = storySceneIndex(sourceQuiz);
    const sentences = storySentenceIndex(sourceQuiz);
    (sourceQuiz?.questions || []).forEach(q => {
      ensureQuestionMetadata(q, sourceQuiz);
      if (!DEPTHS.has(q.comprehensionDepth)) issues.push(`${q.qId}: comprehension depth is missing.`);
      if (!(q.evidence.sceneIds || []).length && !(q.evidence.sentenceIds || []).length) {
        issues.push(`${q.qId}: at least one evidence scene or sentence is required.`);
      }
      (q.evidence.sceneIds || []).forEach(id => {
        if (!scenes.has(id)) issues.push(`${q.qId}: evidence scene ${id} was not found in the story.`);
      });
      (q.evidence.sentenceIds || []).forEach(id => {
        if (!sentences.has(id)) issues.push(`${q.qId}: evidence sentence ${id} was not found in the story.`);
      });
      if (q.comprehensionDepth !== 'literal' && String(q.evidence.note || '').trim().length < 12) {
        issues.push(`${q.qId}: inferential/integrative questions require an author rationale.`);
      }
      if (q.type === 'internal_response_mcq' && q.comprehensionDepth === 'inferential') {
        const answer = String(correctOption(q)?.text || '').replace(/["'“”]/g, '').trim().toLowerCase();
        const story = String(sourceQuiz?.story?.text || '').replace(/["'“”]/g, '').toLowerCase();
        if (answer.length >= 8 && story.includes(answer)) {
          issues.push(`${q.qId}: the inferential answer is copied directly from the story; rewrite it so the learner must infer.`);
        }
      }
      issues.push(...settingEvidenceIssues(q, sourceQuiz));
    });
    return issues;
  }

  function syncQualityEditor() {
    const q = quiz?.questions?.[currentQuestionIndex];
    if (!q) return;
    ensureQuestionMetadata(q, quiz);
    if (byId('comprehension-depth-select')) byId('comprehension-depth-select').value = q.comprehensionDepth;
    if (byId('evidence-scenes-input')) byId('evidence-scenes-input').value = (q.evidence.sceneIds || []).join(', ');
    if (byId('evidence-sentences-input')) byId('evidence-sentences-input').value = (q.evidence.sentenceIds || []).join(', ');
    if (byId('evidence-note-input')) byId('evidence-note-input').value = q.evidence.note || '';
  }

  function saveQualityEditor() {
    const q = quiz?.questions?.[currentQuestionIndex];
    if (!q) return;
    q.comprehensionDepth = byId('comprehension-depth-select')?.value || defaultDepth(q);
    q.evidence = {
      sceneIds: splitIds(byId('evidence-scenes-input')?.value),
      sentenceIds: splitIds(byId('evidence-sentences-input')?.value),
      note: byId('evidence-note-input')?.value.trim() || ''
    };
    ensureMeasurementPolicy(quiz);
  }

  function renderMeasurementPolicy() {
    const el = byId('measurement-policy-note');
    if (!el || !quiz) return;
    const counts = new Map();
    (quiz.questions || []).forEach(q => {
      const key = normalizeStoryGrammarKey(q.storyGrammar);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const singleAxes = [...counts.entries()].filter(([, count]) => count < 3).map(([axis]) => storyGrammarLabel(axis));
    el.innerHTML = `<strong>Measurement policy</strong><br>This quiz is a screening result, not a final diagnosis. `
      + `A stable trend requires at least 3 items across 3 books per axis.`
      + (singleAxes.length ? `<br>Current single-item axes: ${singleAxes.map(escapeHtml).join(', ')}` : '');
  }

  function addDemoDisclosure() {
    const stage = byId('preview-stage');
    if (!demoActive || !stage || stage.querySelector('.demo-disclosure')) return;
    const note = document.createElement('div');
    note.className = 'demo-disclosure';
    note.innerHTML = '<strong>Automated review demo</strong>This uses the quiz currently open. It is not a learner attempt, and drag actions are visual checks rather than validated learner responses.';
    stage.prepend(note);
  }

  const baseRenderEditor = renderEditor;
  renderEditor = function patchedRenderEditor() {
    baseRenderEditor();
    syncQualityEditor();
  };

  const baseRenderPreview = renderPreview;
  renderPreview = function patchedRenderPreview() {
    baseRenderPreview();
    addDemoDisclosure();
  };

  const baseRenderAll = renderAll;
  renderAll = function patchedRenderAll() {
    ensureMeasurementPolicy(quiz);
    baseRenderAll();
    renderMeasurementPolicy();
  };

  const baseApplyEditorChanges = applyEditorChanges;
  applyEditorChanges = function patchedApplyEditorChanges() {
    saveQualityEditor();
    baseApplyEditorChanges();
  };
  if (byId('apply-btn')) byId('apply-btn').onclick = applyEditorChanges;

  const baseValidateQuizDraft = validateQuizDraft;
  validateQuizDraft = function patchedValidateQuizDraft(sourceQuiz, row = {}) {
    ensureMeasurementPolicy(sourceQuiz);
    return [...new Set([...baseValidateQuizDraft(sourceQuiz, row), ...qualityIssues(sourceQuiz)])];
  };

  const basePackageQuizForExport = packageQuizForExport;
  packageQuizForExport = function patchedPackageQuizForExport(sourceQuiz) {
    ensureMeasurementPolicy(sourceQuiz);
    const packaged = basePackageQuizForExport(sourceQuiz);
    ensureMeasurementPolicy(packaged);
    return packaged;
  };

  const baseShowLRSReport = showLRSReport;
  showLRSReport = function patchedShowLRSReport(log) {
    baseShowLRSReport(log);
    const report = byId('preview-stage')?.querySelector('.lrs-report');
    if (report) {
      const disclosure = document.createElement('div');
      disclosure.className = 'report-disclosure';
      disclosure.innerHTML = '<strong>Demo data, not a learner diagnosis</strong>Only the six quiz interactions below come from this automated run. Reading activity, pronunciation, vocabulary, expression, reading risk, and affect values are fixed examples.';
      report.prepend(disclosure);
      report.querySelectorAll('.lrs-kpi-l').forEach(label => {
        if (label.textContent.trim() === 'Comp Score') label.textContent = 'Demo Score';
      });
      report.querySelectorAll('.lrs-subhead').forEach(heading => {
        if (/Pronunciation|Vocabulary|Expression/.test(heading.textContent) && !heading.querySelector('.mock-data-badge')) {
          const badge = document.createElement('span');
          badge.className = 'mock-data-badge';
          badge.textContent = 'Sample data';
          heading.appendChild(badge);
        }
      });
      report.querySelectorAll('.lrs-section h4').forEach(heading => {
        if (/2\. 독서 활동|4\. 독서 위험 신호|5\. 감정 분포/.test(heading.textContent) && !heading.querySelector('.mock-data-badge')) {
          const badge = document.createElement('span');
          badge.className = 'mock-data-badge';
          badge.textContent = 'Sample data';
          heading.appendChild(badge);
        }
      });
    }
    demoActive = false;
  };

  const baseSimulateQuiz = simulateQuiz;
  simulateQuiz = async function patchedSimulateQuiz() {
    if (!quiz?.questions?.length) {
      toast('Generate or open a quiz first.');
      return;
    }
    demoActive = true;
    const originalLoadSample = loadSample;
    loadSample = async () => undefined;
    try {
      await baseSimulateQuiz();
    } finally {
      loadSample = originalLoadSample;
    }
  };
  if (byId('simulate-btn')) byId('simulate-btn').onclick = simulateQuiz;

  const baseToast = toast;
  toast = function patchedToast(message) {
    const text = String(message || '');
    const looksCorrupted = /[媛遺붽뒿덈삵]/.test(text) || (text.match(/\?/g) || []).length >= 3;
    baseToast(looksCorrupted ? '작업이 처리되었습니다. 화면의 상태를 확인해 주세요.' : text);
  };

  ensureMeasurementPolicy(quiz);
  renderAll();
})();
