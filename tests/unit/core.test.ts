import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENTS,
  normalizeAttachmentName,
} from "@/lib/attachments/limits";
import { hasDuplicateAttachmentNames } from "@/lib/attachments/validation";
import { parseChatBody } from "@/lib/chatRequest";
import {
  encodeActivityMarker,
  encodeFreeMarker,
  encodeKeepMarker,
  encodeLimitMarker,
  encodeModelMarker,
  encodeQuestionClearMarker,
  encodeQuestionMarker,
  encodeTryingMarker,
  ModelMarkerParser,
} from "@/lib/markers";
import {
  getChatChain,
  isDeepSeekPeak,
  resolveAgentModel,
} from "@/lib/models";
import {
  parseQuestionEvent,
  sanitizeQuestionPayload,
  validateQuestionAnswers,
  QuestionValidationError,
} from "@/lib/question";
import { formatElapsed, parseLimitPayload, stripDoneLines } from "@/lib/format";
import {
  agentTurnCancelled,
  claimAgentTurn,
  cancelAgentTurn,
  holdAgentTurn,
  inflightSessionFor,
  noteInflightSession,
  ownerTurnBusy,
  releaseAgentTurn,
  seedFromHistory,
  AgentBusyError,
} from "@/lib/agentBind";
import {
  chooseWhisperLanguage,
  isEnglishOnlyWhisperModel,
  isNoSpeechTranscript,
} from "@/lib/whisper";

describe("attachment validation", () => {
  it("normalizes names and detects duplicates across images and documents", () => {
    expect(normalizeAttachmentName("  Report.PDF ")).toBe("report.pdf");
    expect(
      hasDuplicateAttachmentNames([{ name: "Photo.PNG" }], [{ name: " photo.png " }])
    ).toBe(true);
    expect(hasDuplicateAttachmentNames([{ name: "" }], [{ name: "" }])).toBe(false);
    expect(MAX_ATTACHMENTS).toBe(3);
  });

  it("validates chat messages, documents, limits, and model restrictions", () => {
    const document = {
      id: "doc-1",
      name: "notes.txt",
      mimeType: "text/plain",
      size: 10,
      text: "hello",
      sources: [{ locator: "L1-L1", label: "Lines 1-1", text: "hello" }],
    };
    const parsed = parseChatBody({
      messages: [{ role: "user", text: "hi", documents: [document] }],
      language: "en",
      mode: "plan",
    });
    expect(parsed.reasoning).toBe("max");
    expect(parsed.messages[0].documents?.[0].name).toBe("notes.txt");

    expect(() =>
      parseChatBody({
        messages: [
          {
            role: "user",
            text: "",
            images: [
              { name: "a.png", mimeType: "image/png", data: "a" },
              { name: "b.png", mimeType: "image/png", data: "b" },
            ],
            documents: [document, { ...document, id: "doc-2", name: "b.txt" }],
          },
        ],
      })
    ).toThrow("at most 3 attachments");

    expect(() =>
      parseChatBody({
        messages: [
          {
            role: "user",
            text: "",
            documents: [document, { ...document, id: "doc-2", name: " NOTES.txt " }],
          },
        ],
      })
    ).toThrow("duplicate attachment names");

    expect(() =>
      parseChatBody({
        messages: [
          {
            role: "user",
            text: "",
            images: [{ mimeType: "image/png", data: "a" }],
          },
        ],
        model: "deepseek-v4-flash",
      })
    ).toThrow("cannot read images");
  });
});

describe("stream markers", () => {
  it("parses markers split across arbitrary chunks without leaking them", () => {
    const parser = new ModelMarkerParser();
    const activity = {
      id: "a1",
      kind: "tool" as const,
      tool: "read",
      status: "completed" as const,
      path: "README.md",
    };
    const question = {
      requestId: "q1",
      opencodeSessionId: "session-1",
      questions: [
        {
          header: "Style",
          question: "Tone?",
          options: [{ label: "Direct" }],
        },
      ],
    };
    const chunks = [
      "before",
      encodeTryingMarker("deepseek-v4-flash").slice(0, 8),
      encodeTryingMarker("deepseek-v4-flash").slice(8),
      encodeModelMarker("qwen3.8-flash"),
      encodeActivityMarker(activity),
      encodeQuestionMarker(question),
      encodeQuestionClearMarker("q1"),
      encodeLimitMarker("2026-01-01T00:00:00Z"),
      encodeFreeMarker(),
      encodeKeepMarker(),
      "after",
    ];
    const parsed = chunks.map((chunk) => parser.push(chunk));
    const combined = parsed.map((item) => item.text).join("");
    const last = parsed.at(-1)!;
    expect(combined).toBe("beforeafter");
    expect(last.model).toBeUndefined();
    expect(parsed.some((item) => item.trying === "deepseek-v4-flash")).toBe(true);
    expect(parsed.some((item) => item.model === "qwen3.8-flash")).toBe(true);
    expect(parsed.some((item) => item.activities?.[0]?.path === "README.md")).toBe(true);
    expect(parsed.some((item) => item.questions?.requestId === "q1")).toBe(true);
    expect(parsed.some((item) => item.questionClear === "q1")).toBe(true);
    expect(parsed.some((item) => item.limit)).toBe(true);
    expect(parsed.some((item) => item.free === true)).toBe(true);
  });
});

describe("question validation", () => {
  const pending = sanitizeQuestionPayload(
    {
      requestId: "q1",
      questions: [
        {
          question: "Choose",
          options: [{ label: "A" }, { label: "B" }],
          custom: false,
        },
      ],
    },
    "session-1"
  )!;

  it("sanitizes question events and validates known answers", () => {
    expect(
      parseQuestionEvent(
        "question.v2.asked",
        pending as unknown as Record<string, unknown>,
        "session-1"
      )?.requestId
    ).toBe("q1");
    expect(validateQuestionAnswers(pending, [["A"]])).toEqual([["A"]]);
    expect(() => validateQuestionAnswers(pending, [["other"]])).toThrow(QuestionValidationError);
  });

  it("supports custom multi-answer questions and rejects malformed payloads", () => {
    const multi = sanitizeQuestionPayload(
      {
        id: "q2",
        questions: [
          {
            text: "Pick",
            options: [{ label: "A" }, { label: "B" }],
            multiple: true,
          },
        ],
      },
      "session-2"
    )!;
    expect(validateQuestionAnswers(multi, [["A", "B", "A"]])).toEqual([["A", "B"]]);
    expect(sanitizeQuestionPayload({ id: "x/y", questions: pending.questions }, "s")).toBeNull();
    expect(
      parseQuestionEvent(
        "session.idle",
        pending as unknown as Record<string, unknown>,
        "session-1"
      )
    ).toBeNull();
  });
});

describe("model routing and formatting", () => {
  it("routes images to vision and excludes retired models", () => {
    expect(getChatChain(true)).toEqual(["glm-5.3-flash"]);
    expect(getChatChain(false)).not.toContain("deepseek-v4-pro");
    expect(resolveAgentModel("qwen3.8-flash")).toBe("qwen3.8-flash");
    expect(isDeepSeekPeak(new Date("2026-09-21T02:00:00Z"))).toBe(true);
    expect(isDeepSeekPeak(new Date("2026-09-20T02:00:00Z"))).toBe(false);
  });

  it("formats elapsed time, limit markers, and done lines", () => {
    expect(formatElapsed(82, "en")).toBe("1m 22s");
    expect(formatElapsed(82, "zh")).toBe("1分22秒");
    expect(parseLimitPayload("weekly|2026-01-01T00:00:00Z")?.window).toBe("weekly");
    expect(parseLimitPayload("bad|not-a-date")).toBeNull();
    expect(stripDoneLines("hello\nDONE\nworld")).toBe("hello\nworld");
    expect(stripDoneLines("```\nDONE\n```")).toBe("```\nDONE\n```");
  });
});

describe("agent ownership and history recovery", () => {
  it("prevents duplicate turns and tracks cancellation/session ownership", () => {
    const owner = `test-owner-${Date.now()}`;
    claimAgentTurn(owner, 10_000);
    expect(ownerTurnBusy(owner)).toBe(true);
    expect(() => claimAgentTurn(owner, 10_000)).toThrow(AgentBusyError);
    noteInflightSession(owner, "session-1");
    expect(inflightSessionFor(owner)).toBe("session-1");
    expect(cancelAgentTurn(owner)).toBe("session-1");
    expect(agentTurnCancelled(owner)).toBe(true);
    holdAgentTurn(owner, true);
    releaseAgentTurn(owner);
    expect(ownerTurnBusy(owner)).toBe(false);
  });

  it("creates a recovery recap with documents and trims old turns", () => {
    const recap = seedFromHistory(
      [
        { role: "user", text: "first" },
        { role: "model", text: "answer" },
        {
          role: "user",
          text: "",
          documents: [
            {
              id: "d1",
              name: "notes.txt",
              mimeType: "text/plain",
              size: 4,
              text: "doc text",
              sources: [],
            },
          ],
        },
      ],
      "rebuild"
    );
    expect(recap).toContain("[Context restored]");
    expect(recap).toContain("notes.txt");
    expect(seedFromHistory([], "compact")).toBeNull();
  });
});

describe("Whisper helpers", () => {
  it("detects silence and selects a compatible language", () => {
    expect(isNoSpeechTranscript("[BLANK_AUDIO]")).toBe(true);
    expect(isNoSpeechTranscript("hello world")).toBe(false);
    expect(isEnglishOnlyWhisperModel("/models/ggml-base.en-q5_1.bin")).toBe(true);
    expect(chooseWhisperLanguage("zh", "/models/ggml-base.en.bin")).toBe("en");
    expect(chooseWhisperLanguage("zh", "/models/ggml-base-q5_1.bin")).toBe("zh");
    expect(chooseWhisperLanguage("auto", "/models/ggml-base-q5_1.bin")).toBe("auto");
  });
});
