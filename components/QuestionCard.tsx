"use client";

import { useState } from "react";
import type { PendingQuestion } from "@/lib/types";
import { STR, useUiLang } from "@/lib/i18n";

interface QuestionCardProps {
  pending: PendingQuestion;
  busy?: boolean;
  error?: string | null;
  onReply: (answers: string[][]) => void;
  onReject: () => void;
}

export default function QuestionCard({
  pending,
  busy = false,
  error,
  onReply,
  onReject,
}: QuestionCardProps) {
  const lang = useUiLang();
  const t = STR[lang];
  const [picked, setPicked] = useState<string[][]>(() =>
    pending.questions.map(() => [])
  );
  const [customOpen, setCustomOpen] = useState<boolean[]>(() =>
    pending.questions.map(() => false)
  );
  const [customText, setCustomText] = useState<string[]>(() =>
    pending.questions.map(() => "")
  );

  const allowCustom = (index: number) => pending.questions[index]?.custom !== false;

  const resolve = (nextPicked: string[][], nextCustom: boolean[]) =>
    pending.questions.map((_, i) =>
      nextCustom[i]
        ? [(customText[i] ?? "").trim()].filter((text) => Boolean(text))
        : nextPicked[i] ?? []
    );

  const sendIfComplete = (answers: string[][]) => {
    if (answers.every((item) => item.length > 0)) onReply(answers);
  };

  const choose = (index: number, label: string) => {
    if (busy) return;
    const nextPicked = pending.questions.map((_, i) =>
      i === index ? [label] : picked[i] ?? []
    );
    const nextCustom = customOpen.map((open, i) => (i === index ? false : open));
    setPicked(nextPicked);
    setCustomOpen(nextCustom);
    sendIfComplete(resolve(nextPicked, nextCustom));
  };

  const openCustom = (index: number) => {
    if (busy || !allowCustom(index)) return;
    setCustomOpen((prev) => prev.map((open, i) => (i === index ? true : open)));
    setPicked((prev) => prev.map((current, i) => (i === index ? [] : current)));
  };

  return (
    <section className="question-card" aria-live="polite">
      <button
        type="button"
        className="question-reject"
        disabled={busy}
        onClick={onReject}
      >
        {t["question.reject"]}
      </button>
      {pending.questions.map((item, index) => (
        <div className="question-item" key={`${item.header}:${index}`}>
          <p className="question-item-header">{item.question}</p>
          <div className="question-options" role="radiogroup">
            {item.options.map((option) => {
              const selected =
                !customOpen[index] && (picked[index] ?? []).includes(option.label);
              return (
                <button
                  type="button"
                  key={option.label}
                  className={`question-option${selected ? " selected" : ""}`}
                  disabled={busy}
                  aria-pressed={selected}
                  onClick={() => choose(index, option.label)}
                >
                  <span className="question-option-label">{option.label}</span>
                  {option.description ? (
                    <span className="question-option-desc">{option.description}</span>
                  ) : null}
                </button>
              );
            })}
            {allowCustom(index) ? (
              <button
                type="button"
                className={`question-option${customOpen[index] ? " selected" : ""}`}
                disabled={busy}
                aria-pressed={customOpen[index]}
                onClick={() => openCustom(index)}
              >
                <span className="question-option-label">{t["question.other"]}</span>
              </button>
            ) : null}
          </div>
          {customOpen[index] ? (
            <input
              className="question-custom"
              value={customText[index] ?? ""}
              disabled={busy}
              maxLength={500}
              autoFocus
              onChange={(event) => {
                const value = event.target.value;
                setCustomText((prev) =>
                  prev.map((text, i) => (i === index ? value : text))
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  sendIfComplete(resolve(picked, customOpen));
                }
              }}
            />
          ) : null}
        </div>
      ))}
      {error ? <p className="question-error">{error}</p> : null}
    </section>
  );
}
