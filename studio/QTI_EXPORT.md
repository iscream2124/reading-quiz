# Quiz Studio QTI 2.1 Export

Quiz Studio exports the open quiz as an IMS QTI 2.1 content package ZIP for LMS import.

## Package contents

- `imsmanifest.xml`: IMS Content Packaging manifest
- `assessmentTest.xml`: one QTI assessment test referencing all questions
- `items/*.xml`: one QTI assessment item per Studio question
- `assets/*`: referenced scene images and audio that could be loaded at export time
- `bookeytalkey-metadata.json`: the complete Studio quiz plus evidence, comprehension depth, diagnostics, and original scoring rules

## Interaction mapping

| Studio question type | QTI 2.1 interaction |
| --- | --- |
| `listen_scene_mcq` | `choiceInteraction` |
| `emotion_mcq` | `choiceInteraction` |
| `internal_response_mcq` | `choiceInteraction` |
| `story_sequence_drag` | `orderInteraction` |
| `scene_word_unscramble` | `orderInteraction` |
| `setting_slot_drag` | `matchInteraction` |

## Scoring contract

The portable QTI items use the standard `match_correct` response-processing template. This gives broad LMS compatibility and exact-match item scoring.

Studio's richer weighted, position-distance, distractor, and partial-credit rules are preserved without loss in `bookeytalkey-metadata.json`. An LMS must explicitly implement those BookeyTalkey rules to reproduce Studio scoring exactly; otherwise the imported QTI package uses standard correct/incorrect scoring.

## Asset behavior

The exporter first checks browser-loaded local resources and then tries to fetch the resolved Studio asset URL. Successfully loaded files are embedded in the ZIP and declared in the manifest. Missing assets do not block item export; they are omitted from item markup and listed in `bookeytalkey-metadata.json` under `assetWarnings`.
