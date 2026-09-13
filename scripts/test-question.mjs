#!/usr/bin/env node
/**
 * Sanitize / validate tests for paused OpenCode questions.
 * Run: node --experimental-strip-types --no-warnings scripts/test-question.mjs
 */
import {
  parseQuestionEvent,
  sanitizeQuestionPayload,
  validateQuestionAnswers,
  QuestionValidationError,
} from "../lib/question.ts";

let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log(`PASS  ${name}`);
    return;
  }
  failed += 1;
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

const raw = {
  id: "que_abc",
  questions: [
    {
      header: "Style",
      question: "Which tone should I use?",
      options: [{ label: "Casual" }, { label: "Formal", description: "Docs" }],
    },
  ],
};

const pending = sanitizeQuestionPayload(raw, "ses_123");
check(
  "sanitize keeps request id and session",
  pending?.requestId === "que_abc" && pending?.opencodeSessionId === "ses_123"
);
check("sanitize default custom is allowed (undefined)", pending?.questions[0].custom === undefined);
check(
  "sanitize rejects empty options",
  sanitizeQuestionPayload({ id: "x", questions: [{ question: "Hi", options: [] }] }, "ses") === null
);
check("sanitize rejects slash in request id", sanitizeQuestionPayload({ id: "a/b", questions: raw.questions }, "ses") === null);

const asked = parseQuestionEvent("question.v2.asked", raw, "ses_123");
check("parse question.v2.asked", asked?.requestId === "que_abc" && asked?.questions.length === 1);
check("parse question.asked", parseQuestionEvent("question.asked", raw, "ses_123")?.requestId === "que_abc");
check("ignore unrelated events", parseQuestionEvent("session.idle", raw, "ses_123") === null);

const answers = validateQuestionAnswers(pending, [["Casual"]]);
check("validate single select", answers[0][0] === "Casual");

try {
  validateQuestionAnswers(pending, [["Nope"]]);
  check("custom allowed by default", true);
} catch (error) {
  check("custom allowed by default", false, error.message);
}

const locked = sanitizeQuestionPayload(
  {
    requestId: "que_lock",
    questions: [
      {
        question: "Pick one",
        options: [{ label: "A" }, { label: "B" }],
        custom: false,
      },
    ],
  },
  "ses_123"
);
try {
  validateQuestionAnswers(locked, [["Nope"]]);
  check("custom:false rejects unknown", false);
} catch (error) {
  check("custom:false rejects unknown", error instanceof QuestionValidationError);
}

try {
  validateQuestionAnswers(pending, [["Casual", "Formal"]]);
  check("single-select rejects two answers", false);
} catch (error) {
  check(
    "single-select rejects two answers",
    error instanceof QuestionValidationError
  );
}

const multi = sanitizeQuestionPayload(
  {
    requestId: "que_multi",
    questions: [
      {
        question: "Pick any",
        options: [{ label: "A" }, { label: "B" }],
        multiple: true,
      },
    ],
  },
  "ses_123"
);
const multiAnswers = validateQuestionAnswers(multi, [["A", "B"]]);
check("multi allows several labels", multiAnswers[0].join(",") === "A,B");

const roundTrip = sanitizeQuestionPayload(JSON.parse(JSON.stringify(pending)), "");
check(
  "json round-trip keeps payload",
  roundTrip?.requestId === "que_abc" && roundTrip?.questions[0].options[1].description === "Docs"
);

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll question tests passed.");
