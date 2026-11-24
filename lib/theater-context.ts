// lib/theater-context.ts
// 「连着主线」：开启后，聊天主线可读取小剧场剧情。
// 只追加文本，绝不触碰人设；异常吞掉返回 ""。

import { loadTheaterConfig, loadTheaterStories } from "./theater-storage";
import { estimateTokens } from "./token-counter";

const BUDGET_TOKENS = 800;

/**
 * 构建注入到聊天上下文的小剧场剧情块（异步，读取 IndexedDB）。
 * 优先注入「收藏」的剧情，其次最新的几篇，按更新时间倒序。
 */
export async function buildTheaterContext(characterId: string): Promise<string> {
    try {
        const config = loadTheaterConfig();
        if (!config.linkToMain) return "";
        const stories = await loadTheaterStories(characterId);
        if (stories.length === 0) return "";
        const chosen = stories.filter((s) => s.favorite).concat(stories.filter((s) => !s.favorite)).slice(0, 4);
        const lines: string[] = [];
        let used = 0;
        for (const s of chosen) {
            const text = (s.content || "").trim().replace(/\s+/g, " ").slice(0, 260);
            if (!text) continue;
            const line = `- [${s.kind === "pickup" ? "捡手机" : "小剧场"}${s.title ? "《" + s.title + "》" : ""}] ${text}`;
            const cost = estimateTokens(line) + 4;
            if (used + cost > BUDGET_TOKENS) break;
            lines.push(line);
            used += cost;
        }
        if (lines.length === 0) return "";
        return `### 小剧场剧情主线（连着主线已开启）\n${lines.join("\n")}`;
    } catch {
        return "";
    }
}
