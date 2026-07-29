(() => {
  "use strict";

  const QTI_NS = "http://www.imsglobal.org/xsd/imsqti_v2p1";
  const QTI_SCHEMA = `${QTI_NS} http://www.imsglobal.org/xsd/imsqti_v2p1.xsd`;
  const MATCH_CORRECT = `${QTI_NS}/rptemplates/match_correct`;

  function xml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function identifier(value, fallback = "ID") {
    let result = String(value || fallback)
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9_.-]+/g, "_")
      .replace(/^[^A-Za-z_]+/, "");
    if (!result) result = fallback;
    return result.slice(0, 96);
  }

  function fileName(value) {
    return String(value || "asset")
      .split(/[\\/]/)
      .pop()
      .replace(/[^A-Za-z0-9._-]+/g, "_") || "asset";
  }

  function shortHash(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).slice(0, 7);
  }

  function mimeType(path, supplied = "") {
    if (supplied) return supplied;
    const ext = String(path).split(".").pop().toLowerCase();
    return ({
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      webp: "image/webp",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
    })[ext] || "application/octet-stream";
  }

  function mappingType(question) {
    if (["listen_scene_mcq", "emotion_mcq", "internal_response_mcq"].includes(question.type)) {
      return "choiceInteraction";
    }
    if (["story_sequence_drag", "scene_word_unscramble"].includes(question.type)) {
      return "orderInteraction";
    }
    if (question.type === "setting_slot_drag") return "matchInteraction";
    throw new Error(`QTI export does not support question type: ${question.type}`);
  }

  function questionAssets(question) {
    const result = [];
    for (const image of question.resources?.images || []) {
      if (image?.path) result.push({ ...image, kind: "image", questionId: question.qId });
    }
    const audio = question.resources?.audio;
    if (audio?.path) result.push({ ...audio, kind: "audio", questionId: question.qId });
    return result;
  }

  function resolveAssetUrl(path, kind) {
    if (typeof assetUrl === "function") return assetUrl(path, kind);
    if (/^(blob:|data:|https?:)/i.test(path)) return path;
    const baseKey = kind === "audio" ? "audioBasePath" : "imageBasePath";
    const base = quiz?.assets?.[baseKey] || "";
    return new URL(`${base}${path}`, window.location.href).href;
  }

  async function assetBlob(path, kind) {
    if (typeof findLocalAssetFile === "function") {
      const local = findLocalAssetFile(path);
      if (local) return local;
    }
    const response = await fetch(resolveAssetUrl(path, kind));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
  }

  async function collectAssets(sourceQuiz) {
    const records = new Map();
    const warnings = [];
    for (const question of sourceQuiz.questions || []) {
      for (const asset of questionAssets(question)) {
        const key = `${asset.kind}:${asset.path}`;
        let record = records.get(key);
        if (!record) {
          const archivePath = `assets/${shortHash(key)}-${fileName(asset.path)}`;
          try {
            const blob = await assetBlob(asset.path, asset.kind);
            record = {
              key,
              sourcePath: asset.path,
              archivePath,
              itemPath: `../${archivePath}`,
              kind: asset.kind,
              type: mimeType(asset.path, blob.type),
              blob,
              questionIds: new Set(),
            };
            records.set(key, record);
          } catch (error) {
            warnings.push(`${asset.path}: ${error.message}`);
            continue;
          }
        }
        record.questionIds.add(question.qId);
      }
    }
    return { records, warnings };
  }

  function assetRecord(assets, kind, path) {
    return assets.records.get(`${kind}:${path}`);
  }

  function mediaMarkup(question, assets) {
    const parts = [];
    for (const image of question.resources?.images || []) {
      const record = assetRecord(assets, "image", image.path);
      if (!record) continue;
      const alt = image.caption || image.sceneId || image.id || "Story scene";
      parts.push(`    <div class="story-media"><img src="${xml(record.itemPath)}" alt="${xml(alt)}"/></div>`);
    }
    const audio = question.resources?.audio;
    const audioRecord = audio?.path ? assetRecord(assets, "audio", audio.path) : null;
    if (audioRecord) {
      parts.push(`    <div class="story-audio"><object data="${xml(audioRecord.itemPath)}" type="${xml(audioRecord.type)}">Audio prompt</object></div>`);
    }
    return parts.join("\n");
  }

  function responseAndOutcome(cardinality, baseType, values) {
    const valueXml = values.map((value) => `      <value>${xml(value)}</value>`).join("\n");
    return `  <responseDeclaration identifier="RESPONSE" cardinality="${cardinality}" baseType="${baseType}">\n    <correctResponse>\n${valueXml}\n    </correctResponse>\n  </responseDeclaration>\n  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float">\n    <defaultValue><value>0</value></defaultValue>\n  </outcomeDeclaration>`;
  }

  function itemShell(question, declaration, body) {
    const itemId = identifier(question.qId, `QUESTION_${question.number || 1}`);
    const title = `Q${question.number || ""} ${question.storyGrammar || question.type}`.trim();
    return `<?xml version="1.0" encoding="UTF-8"?>\n<assessmentItem xmlns="${QTI_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${QTI_SCHEMA}" identifier="${xml(itemId)}" title="${xml(title)}" adaptive="false" timeDependent="false" xml:lang="en">\n${declaration}\n  <itemBody>\n${body}\n  </itemBody>\n  <responseProcessing template="${MATCH_CORRECT}"/>\n</assessmentItem>\n`;
  }

  function choiceItem(question, assets) {
    const options = question.interaction?.options || [];
    if (options.length < 2) throw new Error(`${question.qId}: at least two options are required`);
    const correct = question.interaction?.correct ?? options.find((option) => option.isCorrect)?.key;
    if (correct == null) throw new Error(`${question.qId}: correct option is missing`);
    const choices = options.map((option, index) => {
      const id = identifier(option.key, `OPTION_${index + 1}`);
      return `      <simpleChoice identifier="${xml(id)}">${xml(option.text || option.key)}</simpleChoice>`;
    }).join("\n");
    const declaration = responseAndOutcome("single", "identifier", [identifier(correct)]);
    const media = mediaMarkup(question, assets);
    const body = `${media ? `${media}\n` : ""}    <choiceInteraction responseIdentifier="RESPONSE" shuffle="false" maxChoices="1">\n      <prompt>${xml(question.instruction || "Choose the best answer.")}</prompt>\n${choices}\n    </choiceInteraction>`;
    return itemShell(question, declaration, body);
  }

  function orderedRecords(question) {
    const sourceItems = question.interaction?.items || [];
    const correctItems = question.interaction?.correct || [];
    if (sourceItems.length < 2 || correctItems.length !== sourceItems.length) {
      throw new Error(`${question.qId}: ordered items and correct answer must have the same length`);
    }
    const records = sourceItems.map((value, index) => ({
      id: identifier(`ITEM_${index + 1}`),
      value: String(value),
      used: false,
    }));
    const correctIds = correctItems.map((value) => {
      const record = records.find((candidate) => !candidate.used && candidate.value === String(value));
      if (!record) throw new Error(`${question.qId}: correct order contains an unknown item`);
      record.used = true;
      return record.id;
    });
    records.forEach((record) => { record.used = false; });
    return { records, correctIds };
  }

  function orderLabel(question, value) {
    if (question.type !== "story_sequence_drag") return value;
    const image = (question.resources?.images || []).find((candidate) =>
      candidate.id === value || candidate.sceneId === value
    );
    return image?.caption ? `${value}: ${image.caption}` : value;
  }

  function orderItem(question, assets) {
    const { records, correctIds } = orderedRecords(question);
    const choices = records.map((record) =>
      `      <simpleChoice identifier="${xml(record.id)}">${xml(orderLabel(question, record.value))}</simpleChoice>`
    ).join("\n");
    const declaration = responseAndOutcome("ordered", "identifier", correctIds);
    const media = mediaMarkup(question, assets);
    const body = `${media ? `${media}\n` : ""}    <orderInteraction responseIdentifier="RESPONSE" shuffle="true" orientation="vertical">\n      <prompt>${xml(question.instruction || "Put the items in order.")}</prompt>\n${choices}\n    </orderInteraction>`;
    return itemShell(question, declaration, body);
  }

  function matchItem(question, assets) {
    const slots = question.interaction?.slots || [];
    const items = question.interaction?.items || [];
    const correct = question.interaction?.correct || {};
    if (!slots.length || !items.length) throw new Error(`${question.qId}: slots and items are required`);
    const slotIds = new Map(slots.map((slot, index) => [slot.key, identifier(`SLOT_${slot.key}`, `SLOT_${index + 1}`)]));
    const itemIds = new Map(items.map((item, index) => [item.key, identifier(`ITEM_${item.key}`, `ITEM_${index + 1}`)]));
    const correctPairs = slots.map((slot) => {
      const answer = correct[slot.key] ?? slot.correct;
      if (!itemIds.has(answer)) throw new Error(`${question.qId}: no matching card for ${slot.key}`);
      return `${slotIds.get(slot.key)} ${itemIds.get(answer)}`;
    });
    const slotChoices = slots.map((slot) =>
      `        <simpleAssociableChoice identifier="${xml(slotIds.get(slot.key))}" matchMax="1">${xml(slot.label || slot.key)}</simpleAssociableChoice>`
    ).join("\n");
    const itemChoices = items.map((item) =>
      `        <simpleAssociableChoice identifier="${xml(itemIds.get(item.key))}" matchMax="1">${xml(item.text || item.key)}</simpleAssociableChoice>`
    ).join("\n");
    const declaration = responseAndOutcome("multiple", "directedPair", correctPairs);
    const media = mediaMarkup(question, assets);
    const body = `${media ? `${media}\n` : ""}    <matchInteraction responseIdentifier="RESPONSE" shuffle="true" maxAssociations="${slots.length}">\n      <prompt>${xml(question.instruction || "Match each prompt to the correct answer.")}</prompt>\n      <simpleMatchSet>\n${slotChoices}\n      </simpleMatchSet>\n      <simpleMatchSet>\n${itemChoices}\n      </simpleMatchSet>\n    </matchInteraction>`;
    return itemShell(question, declaration, body);
  }

  function buildItem(question, assets) {
    const type = mappingType(question);
    if (type === "choiceInteraction") return choiceItem(question, assets);
    if (type === "orderInteraction") return orderItem(question, assets);
    return matchItem(question, assets);
  }

  function buildAssessmentTest(sourceQuiz, itemFiles) {
    const testId = identifier(`${sourceQuiz.story?.storyId || "STORY"}_TEST`);
    const title = sourceQuiz.story?.title || sourceQuiz.story?.storyId || "Reading Quiz";
    const refs = itemFiles.map((item) =>
      `      <assessmentItemRef identifier="REF_${xml(item.id)}" href="${xml(item.href)}"/>`
    ).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<assessmentTest xmlns="${QTI_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${QTI_SCHEMA}" identifier="${xml(testId)}" title="${xml(title)}" xml:lang="en">\n  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>\n  <testPart identifier="PART_1" navigationMode="linear" submissionMode="individual">\n    <assessmentSection identifier="SECTION_1" title="${xml(title)}" visible="true">\n${refs}\n    </assessmentSection>\n  </testPart>\n</assessmentTest>\n`;
  }

  function buildManifest(sourceQuiz, itemFiles, assets) {
    const packageId = identifier(`${sourceQuiz.story?.storyId || "STORY"}_QTI_2_1_PACKAGE`);
    const dependencies = itemFiles.map((item) =>
      `      <dependency identifierref="${xml(item.resourceId)}"/>`
    ).join("\n");
    const itemResources = itemFiles.map((item) => {
      const assetFiles = [...assets.records.values()]
        .filter((asset) => asset.questionIds.has(item.question.qId))
        .map((asset) => `      <file href="${xml(asset.archivePath)}"/>`)
        .join("\n");
      return `    <resource identifier="${xml(item.resourceId)}" type="imsqti_item_xmlv2p1" href="${xml(item.href)}">\n      <file href="${xml(item.href)}"/>${assetFiles ? `\n${assetFiles}` : ""}\n    </resource>`;
    }).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 http://www.imsglobal.org/xsd/imscp_v1p1.xsd" identifier="${xml(packageId)}">\n  <metadata>\n    <schema>IMS Content</schema>\n    <schemaversion>1.2.0</schemaversion>\n  </metadata>\n  <organizations/>\n  <resources>\n    <resource identifier="RES_TEST" type="imsqti_test_xmlv2p1" href="assessmentTest.xml">\n      <file href="assessmentTest.xml"/>\n      <file href="bookeytalkey-metadata.json"/>\n${dependencies}\n    </resource>\n${itemResources}\n  </resources>\n</manifest>\n`;
  }

  function metadataFor(sourceQuiz, itemFiles, warnings) {
    const cleanQuiz = typeof packageQuizForExport === "function"
      ? packageQuizForExport(sourceQuiz)
      : JSON.parse(JSON.stringify(sourceQuiz));
    return {
      format: "IMS QTI 2.1 Content Package",
      exportedAt: new Date().toISOString(),
      story: cleanQuiz.story,
      itemMappings: itemFiles.map((item) => ({
        qId: item.question.qId,
        sourceType: item.question.type,
        qtiInteraction: mappingType(item.question),
        storyGrammar: item.question.storyGrammar,
        comprehensionDepth: item.question.comprehensionDepth || "literal",
        evidence: item.question.evidence || null,
        sourceScoring: item.question.scoring || null,
      })),
      interoperability: {
        portableScoring: "QTI match_correct exact-match scoring",
        sourceScoringPreservedInMetadata: true,
        note: "BookeyTalkey weighted and partial-credit rules are preserved here because LMS support for custom QTI response processing varies.",
      },
      assetWarnings: warnings,
      sourceQuiz: cleanQuiz,
    };
  }

  async function exportQtiPackage() {
    if (!window.JSZip) throw new Error("JSZip is not available.");
    if (!quiz?.questions?.length) throw new Error("Generate or open a quiz before exporting QTI.");
    quiz.questions.forEach(mappingType);

    const assets = await collectAssets(quiz);
    const zip = new JSZip();
    const itemFiles = quiz.questions.map((question, index) => {
      const id = identifier(question.qId, `QUESTION_${index + 1}`);
      const href = `items/${String(index + 1).padStart(2, "0")}-${id}.xml`;
      return { id, href, resourceId: `RES_${id}`, question };
    });

    for (const item of itemFiles) zip.file(item.href, buildItem(item.question, assets));
    for (const asset of assets.records.values()) zip.file(asset.archivePath, asset.blob);
    zip.file("assessmentTest.xml", buildAssessmentTest(quiz, itemFiles));
    zip.file("imsmanifest.xml", buildManifest(quiz, itemFiles, assets));
    zip.file("bookeytalkey-metadata.json", JSON.stringify(metadataFor(quiz, itemFiles, assets.warnings), null, 2));

    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const storyId = identifier(quiz.story?.storyId || "reading-quiz");
    const outputName = `${storyId}_QTI_2_1.zip`;
    if (typeof downloadBlob === "function") {
      downloadBlob(blob, outputName);
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = outputName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return { outputName, warnings: assets.warnings };
  }

  const button = document.getElementById("export-qti-btn");
  if (!button) return;
  button.addEventListener("click", async () => {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Building QTI Package...";
    try {
      const result = await exportQtiPackage();
      const message = result.warnings.length
        ? `${result.outputName} exported with ${result.warnings.length} missing asset warning(s).`
        : `${result.outputName} exported.`;
      if (typeof showToast === "function") showToast(message);
    } catch (error) {
      console.error("QTI export failed", error);
      if (typeof showToast === "function") showToast(error.message || "QTI export failed.");
      else window.alert(error.message || "QTI export failed.");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });

  window.QuizStudioQti = { exportQtiPackage, mappingType };
})();
