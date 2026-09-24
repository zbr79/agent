"use client";

import { STR, useUiLang } from "@/lib/i18n";

const SHORT_NAMES: Record<string, string> = {
  "gpt-6-luna": "GPT-6 Luna",
  "qwen3.8-flash": "Qwen3.8 Flash",
  "deepseek-v4-flash": "DS V4 Flash",
  "deepseek-v4-flash-free": "DS Flash (Free)",
  "mimo-v2.5-free": "MiMo-V2.5",
  "nemotron-3-ultra-free": "Nemotron 3",
  "nemotron-3.5-lightning-free": "Nemotron 3.5",
  "ling-3.0-flash-fin-free": "Ling 3.0",
  "laguna-s-2.1-free": "Laguna S 2.1",
  "big-pickle": "Big Pickle",
  "glm-5.3-flash": "GLM-5.3 Flash",
};

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
              <span className="routing-when">{t["routing.autoLabel"]}</span>
              <Chain models={["gpt-6-luna", "glm-5.3-flash"]} />
            </li>
          </ul>
        </li>

        <li>
          <span className="routing-node">{t["routing.images"]}</span>
          <Chain models={["gpt-6-luna", "glm-5.3-flash"]} />
        </li>

        <li>
          <span className="routing-node">{t["routing.pinned"]}</span>
        </li>

      </ul>
    </section>
  );
}