"use client";

import { STR, useUiLang } from "@/lib/i18n";

const SHORT_NAMES: Record<string, string> = {
  "qwen3.8-flash": "Qwen3.8 Flash",
  "deepseek-v4-flash": "DS V4 Flash",
  "deepseek-v4-flash-free": "DS Flash (Free)",
  "mimo-v2.5-free": "MiMo-V2.5",
  "nemotron-3-ultra-free": "Nemotron 3",
  "nemotron-3.5-lightning-free": "Nemotron 3.5",
  "ling-3.0-flash-fin-free": "Ling 3.0",
  "laguna-s-2.1-free": "Laguna S 2.1",
  "big-pickle": "Big Pickle",
  "deepseek-v4-flash-vision-exp": "Vision Exp",
  "qwen3.5-plus": "Qwen3.5 Plus",
};

const FREE_MODELS = [
  "deepseek-v4-flash-free",
  "mimo-v2.5-free",
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "ling-3.0-flash-fin-free",
  "laguna-s-2.1-free",
  "big-pickle",
];

export default function ModelRoutingTree() {
  const lang = useUiLang();
  const t = STR[lang];
  const arrow = lang === "zh" ? "→" : "→";

  const Chain = ({ models }: { models: string[] }) => (
    <span className="routing-chain">
      {models.map((model, index) => (
        <span key={model} className="routing-model">
          {index > 0 && <span className="routing-arrow">{arrow}</span>}
          <code>{SHORT_NAMES[model] ?? model}</code>
        </span>
      ))}
    </span>
  );

  return (
    <section className="usage-card routing-card">
      <span className="usage-title">{t["routing.title"]}</span>

      <ul className="routing-tree">
        <li>
          <span className="routing-node">{t["routing.textChat"]}</span>
          <ul>
            <li>
            <span className="routing-when">{t["routing.peak"]}</span>
            <Chain models={["qwen3.8-flash"]} />
          </li>
            <li>
              <span className="routing-when">{t["routing.offpeak"]}</span>
              <Chain models={["qwen3.8-flash", "deepseek-v4-flash"]} />
            </li>
          </ul>
        </li>

        <li>
          <span className="routing-node">{t["routing.images"]}</span>
          <Chain models={["deepseek-v4-flash-vision-exp", "qwen3.5-plus"]} />
          <span className="routing-tag">{t["routing.imagesTag"]}</span>
        </li>

        <li>
          <span className="routing-node">{t["routing.pinned"]}</span>
        </li>

        <li>
          <span className="routing-node">{t["routing.freeFallback"]}</span>
          <Chain models={FREE_MODELS} />
        </li>
      </ul>
    </section>
  );
}