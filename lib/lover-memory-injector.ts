// lib/lover-memory-injector.ts
// 把恋人记忆召回结果格式化成可注入聊天的上下文块。
// 只追加文本，绝不触碰 / 覆盖人设（persona / 系统提示词）。

import type { LoverMemoryEntry } from "./lover-memory-types";
import { estimateTokens } from "./token-counter";
import { loadLoverMemoryEntries, loadLoverMemoryConfig } from "./lover-memory-storage";
import { recallLoverMemories } from "./lover-memory-recall";

function formatLine(entry: LoverMemoryEntry): string {
    const date = entry.eventDate.slice(0, 10) || "";
    const tags = entry.tags.length > 0 ? `｜标签：${entry.tags.join("、")}` : "";
    const pin = entry.pinned ? "｜★置顶" : "";
    const text = entry.summary?.trim() || entry.content;
    return `- [${date}${tags}${pin}] ${text}`;
}

/** 按字数上限截断并格式化。 */
export function formatLoverMemoriesForPrompt(entries: LoverMemoryEntry[], budgetTokens: number): string {
    const selected = entries.filter((e) => !e.mergedInto);
    if (selected.length === 0) return "";
    const lines: string[] = [];
    let used = 0;
    for (const entry of selected) {
        const line = formatLine(entry);
        const tokens = estimateTokens(line) + 4;
        if (used + tokens > budgetTokens) break;
        lines.push(line);
        used += tokens;
    }
    if (lines.length === 0) return "";
    return `### 恋人记忆\n${lines.join("\n")}`;
}

/**
 * 聊天时调用：召回与当前上下文相关的恋人记忆并格式化。
 * 任何异常都吞掉并返回 ""，绝不影响聊天主流程。
 */
export async function buildLoverMemoryContext(
    characterId: string,
    context: string,
): Promise<string> {
    try {
        const config = loadLoverMemoryConfig();
        if (!config.autoInjectEnabled) return "";
        const entries = await loadLoverMemoryEntries(characterId);
        if (entries.length === 0) return "";
        const results = await recallLoverMemories(characterId, context, entries, config);
        if (results.length === 0) return "";
        return formatLoverMemoriesForPrompt(results.map((r) => r.entry), config.injectTokenBudget);
    } catch {
        return "";
    }
}
