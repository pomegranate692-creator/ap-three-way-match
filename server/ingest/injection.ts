import type { RiskFlag, TextLayer } from "../../shared/schemas.ts";
import { TINY_TEXT_PT } from "./layout.ts";

/**
 * Document text is UNTRUSTED DATA. This scanner does not "defend" the engine (the engine never reads free text);
 * it surfaces instruction-like content so a human sees it and the bundle is held. Heuristic by nature:
 * a novel phrasing may evade it — which is harmless to decisions, because nothing in a document can change them.
 */
const RULES: { code: RiskFlag["code"]; re: RegExp }[] = [
  { code: "INSTRUCTION_IN_DOCUMENT", re: /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/i },
  { code: "INSTRUCTION_IN_DOCUMENT", re: /\b(?:system|admin(?:istrator)?|developer)\s+(?:override|prompt|message|instruction)/i },
  { code: "INSTRUCTION_IN_DOCUMENT", re: /\bnote\s+to\s+(?:the\s+)?(?:automated|ai|llm|assistant|system|model|processing)/i },
  { code: "INSTRUCTION_IN_DOCUMENT", re: /\b(?:mark|classify|set|treat|label|flag)\s+(?:this|the|it)\s+(?:invoice|document|bundle)?[^.\n]{0,40}\b(?:approved|matched|ready[_ ]for[_ ]approval|paid|valid)\b/i },
  { code: "INSTRUCTION_IN_DOCUMENT", re: /\bpre-?approved\b/i },
  { code: "INSTRUCTION_IN_DOCUMENT", re: /\bskip\s+(?:the\s+)?(?:receiving|receipt|match(?:ing)?|check|verification|approval)/i },
  { code: "INSTRUCTION_IN_DOCUMENT", re: /\b(?:do\s+not|don'?t|never)\s+(?:create|raise|flag|report)\s+(?:any\s+)?exceptions?/i },
  { code: "INSTRUCTION_IN_DOCUMENT", re: /\b(?:you\s+are\s+now|act\s+as|disregard\s+(?:the\s+)?(?:above|policy|rules))\b/i },
  { code: "PAYMENT_REDIRECT", re: /\b(?:new|updated|changed|replacement)\b[^.\n]{0,30}\b(?:bank|iban|account|routing)/i },
  { code: "PAYMENT_REDIRECT", re: /\bremit\s+(?:payment\s+)?to\b[^.\n]{0,60}\biban\b/i },
];

const ZERO_WIDTH = /[​-‍⁠﻿]/g;

export function scanForRisk(layer: TextLayer): RiskFlag[] {
  const flags: RiskFlag[] = [];
  for (const pg of layer.pages) {
    // reading-order text with word offsets
    const ordered = [...pg.words].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
    const offsets: { start: number; end: number; id: string }[] = [];
    let text = "";
    for (const w of ordered) {
      const t = w.text.normalize("NFKC").replace(ZERO_WIDTH, "");
      offsets.push({ start: text.length, end: text.length + t.length, id: w.id });
      text += t + " ";
    }
    for (const rule of RULES) {
      const g = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g");
      let m: RegExpExecArray | null;
      while ((m = g.exec(text))) {
        const s = m.index;
        const e = m.index + m[0].length;
        const ids = offsets.filter((o) => o.start < e && o.end > s).map((o) => o.id);
        flags.push({ code: rule.code, excerpt: text.slice(Math.max(0, s - 10), Math.min(text.length, e + 60)).trim().slice(0, 300), page: pg.page, wordIds: ids });
        if (m[0].length === 0) g.lastIndex++;
      }
    }
    const tiny = pg.words.filter((w) => w.size < TINY_TEXT_PT);
    if (tiny.length >= 3) {
      flags.push({
        code: "HIDDEN_TEXT",
        excerpt: tiny.map((w) => w.text).join(" ").slice(0, 300),
        page: pg.page,
        wordIds: tiny.map((w) => w.id),
      });
    }
  }
  return dedupe(flags);
}

function dedupe(flags: RiskFlag[]): RiskFlag[] {
  const seen = new Set<string>();
  return flags.filter((f) => {
    const k = `${f.code}|${f.page}|${f.excerpt.slice(0, 40)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
