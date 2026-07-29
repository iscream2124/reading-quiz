# Quiz Studio Quality Contract

Quiz Studio creates authoring drafts and screening data. It does not produce a final learner diagnosis from one six-question quiz.

## Required question metadata

Every question must include:

```json
{
  "comprehensionDepth": "literal | inferential | integrative",
  "evidence": {
    "sceneIds": ["SC02"],
    "sentenceIds": ["SC02_ST01_N"],
    "note": "Why this evidence supports the correct answer and Story Grammar axis."
  }
}
```

Literal questions may use a short rationale. Inferential and integrative questions require a human-authored rationale before approval.

## Evidence rules

- Evidence scene and sentence IDs must exist in the story text.
- A Setting answer must be supported by the selected opening evidence.
- An Internal Response item tagged as inferential must not copy the answer directly from the story.
- Sequence tasks are integrative story-arc screening. They are not, by themselves, a stable Consequence diagnosis.
- Generated questions remain drafts until a reviewer checks the evidence and rationale.

## Measurement policy

- One item on one Story Grammar axis is a screening result only.
- A trend requires at least three items across at least three books for the same axis.
- Quiz Studio directly measures only quiz comprehension interactions.
- Reading activity, pronunciation, vocabulary, expression, reading-risk, and affect fields require external session data.
- Demo values must be visibly labeled as sample data.

## Simulation policy

The `Review Demo` button runs the quiz currently open. It is an automated UI demonstration, not a learner session. Drag actions in the current demo are visual checks and must not be interpreted as validated learner scores.

## Production security

GitHub Pages may call an AI provider with a key entered in the browser. Shared production use must move provider credentials behind an authenticated server proxy. Never store provider keys in exported quizzes or browser storage.
