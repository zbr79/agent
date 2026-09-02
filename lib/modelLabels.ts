// Client-safe display names for model IDs (no node imports).

const LABELS: Record<string, string> = {
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-v4-flash-free": "DeepSeek V4 Flash (Free)",
  "mimo-v2.5-free": "MiMo-V2.5 (Free)",
  "big-pickle": "Big Pickle (Free)",
  "nemotron-3-ultra-free": "Nemotron 3 Ultra (Free)",
  "nemotron-3.5-lightning-free": "Nemotron 3.5 Lightning (Free)",
  "ling-3.0-flash-fin-free": "Ling 3.0 Flash (Free)",
  "laguna-s-2.1-free": "Laguna S 2.1 (Free)",
  "deepseek-v4-flash-vision-exp": "DeepSeek V4 Flash Vision Exp",
  "glm-5.3": "GLM-5.3",
  "glm-5.3-flash": "GLM-5.3 Flash",
  "glm-5.2": "GLM-5.2",
  "glm-5.1": "GLM-5.1",
  "glm-5": "GLM-5",
  "kimi-k3": "Kimi K3",
  "kimi-k2.7-code": "Kimi K2.7 Code",
  "kimi-k2.6": "Kimi K2.6",
  "kimi-k2.5": "Kimi K2.5",
  "longcat-2.0": "LongCat-2.0",
  "mimo-v2.5-pro": "MiMo-V2.5-Pro",
  "mimo-v2.5": "MiMo-V2.5",
  "mimo-v2-omni": "MiMo-V2-Omni",
  "mimo-v2-pro": "MiMo-V2-Pro",
  "qwen3.7-max": "Qwen3.7 Max",
  "qwen3.7-plus": "Qwen3.7 Plus",
  "qwen3.6-plus": "Qwen3.6 Plus",
  "qwen3.5-plus": "Qwen3.5 Plus",
  "hy4-preview": "Hy4 Preview",
  "hy3": "Hy3",
  "hy3-preview": "Hy3 Preview",
};

export function modelLabel(name: string): string {
  return LABELS[name] ?? name;
}
