// lib/memory-vault/auto-extract.ts
// 记忆沉淀的「预留接口」：先用轻量规则从一轮对话里挑出候选事实，
// 后续接入摘要模型时，只要把 extractVaultCandidates 换成模型调用即可，
// 落库与去重逻辑不用改。

import { listVaultEntries, saveVaultEntry } from "./storage";
import type { MemoryVaultCategory } from "./types";

export type VaultCandidate = {
    category: MemoryVaultCategory;
    content: string;
    weight: number;
};

type Rule = {
    category: MemoryVaultCategory;
    weight: number;
    pattern: RegExp;
    /** 只保留整句，避免把半句话塞进记忆库。 */
    sentence: boolean;
};

const RULES: Rule[] = [
    { category: "identity", weight: 92, pattern: /(?:我叫|我的名字(?:叫|是)|叫我)([^，。！？\n]{1,20})/, sentence: true },
    { category: "identity", weight: 88, pattern: /(?:我的生日|生日是|我出生于)([^，。！？\n]{1,24})/, sentence: true },
    { category: "relationship", weight: 90, pattern: /(?:我们(?:是|已经)|你(?:是|是我的))(恋人|情侣|男女朋友|夫妻|家人|主仆|主人|宠物|搭档)[^，。！？\n]{0,24}/, sentence: true },
    { category: "preference", weight: 70, pattern: /我(?:很|最|特别|超)?(?:喜欢|爱|讨厌|不喜欢|受不了)([^，。！？\n]{1,30})/, sentence: true },
    { category: "promise", weight: 85, pattern: /(?:说好了|答应我|约定|约好)([^，。！？\n]{1,40})/, sentence: true },
    { category: "milestone", weight: 88, pattern: /(?:纪念日|在一起第?\s*\d+|同居|见家长|订婚|结婚)([^，。！？\n]{0,30})/, sentence: true },
];

function splitSentences(text: string): string[] {
    return text
        .split(/(?<=[。！？!?\n])/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 4 && item.length <= 200);
}

/** 从一段文本里提取候选记忆（纯规则，不联网、不调用模型）。 */
export function extractVaultCandidates(text: string): VaultCandidate[] {
    if (!text.trim()) return [];
    const sentences = splitSentences(text);
    const found: VaultCandidate[] = [];
    const seen = new Set<string>();
    for (const rule of RULES) {
        for (const sentence of sentences) {
            if (!rule.pattern.test(sentence)) continue;
            const content = sentence.replace(/\s+/g, " ").trim();
            if (!content || seen.has(content)) continue;
            // 过滤掉 AI 自称的记忆和过短片段。
            if (/^(?:我)?(?:是|叫)(?:一个)?(?:AI|人工智能|助手)/.test(content)) continue;
            seen.add(content);
            found.push({ category: rule.category, content: content.slice(0, 160), weight: rule.weight });
            if (found.length >= 8) return found;
        }
    }
    return found;
}

/**
 * 把候选写入记忆库：相同内容（按角色 + 去掉标点后比较）直接跳过。
 * 返回真正新增的条数，方便 UI 反馈。
 */
export async function ingestVaultCandidates(
    characterId: string,
    candidates: VaultCandidate[],
): Promise<number> {
    if (!candidates.length) return 0;
    const existing = await listVaultEntries(characterId);
    const normalize = (value: string) => value.replace(/[\s，。！？、,.!?~～]/g, "");
    const seen = new Set(existing.map((entry) => normalize(entry.content)));
    let added = 0;
    for (const candidate of candidates) {
        const key = normalize(candidate.content);
        if (!key || seen.has(key)) continue;
        try {
            await saveVaultEntry({
                characterId,
                category: candidate.category,
                content: candidate.content,
                weight: candidate.weight,
                pinned: false,
            });
            seen.add(key);
            added++;
        } catch (error) {
            console.warn("[memory-vault] 自动记忆写入失败", error);
        }
    }
    return added;
}

/**
 * 预留：一轮对话结束后调用。
 * 现在是规则提取；接入摘要模型时把内部换成模型返回的 JSON 数组即可。
 * 建议保持「只新增、不删除、不覆盖用户手写条目」的原则。
 */
export async function autoIngestTurn(characterId: string, transcript: string): Promise<number> {
    try {
        return await ingestVaultCandidates(characterId, extractVaultCandidates(transcript));
    } catch (error) {
        console.warn("[memory-vault] autoIngestTurn 失败", error);
        return 0;
    }
}
