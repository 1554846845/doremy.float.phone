// lib/lover-memory-recall.ts
// 双路智能召回：精确关键词 + 向量语义，加权融合排序。
// 权重、召回数量、置顶加成均可由配置调节。

import type { LoverMemoryConfig, LoverMemoryEntry } from "./lover-memory-types";
import { cosineSimilarity, keywordOverlapRatio } from "./memory-embedding";
import { generateLoverEmbedding } from "./lover-memory-api";

export type LoverMemoryRecallResult = {
    entry: LoverMemoryEntry;
    keywordScore: number;
    vectorScore: number;
    score: number;
};

/** 关键词路径得分：命中越多的条目得分越高（精确匹配优先）。 */
export function scoreByKeyword(query: string, entry: LoverMemoryEntry): number {
    // 汇总原文 + 摘要 + 标签，兼顾精确关键词。
    const haystack = [entry.content, entry.summary ?? "", entry.tags.join(" ")].join("\n");
    return keywordOverlapRatio(query, haystack);
}

/** 向量路径得分：查询向量与条目向量的余弦相似度。 */
export function scoreByVector(queryEmbedding: number[], entry: LoverMemoryEntry): number {
    if (!entry.embedding || entry.embedding.length === 0) return 0;
    return cosineSimilarity(queryEmbedding, entry.embedding);
}

/**
 * 双路召回主入口。
 * - keywordScore / vectorScore 归一化到 0-1 后按配置权重融合；
 * - 置顶条目额外加 pinnedBoost；
 * - 返回按总分降序、截断到 recallTopK 的结果。
 */
export async function recallLoverMemories(
    characterId: string,
    query: string,
    entries: LoverMemoryEntry[],
    config: LoverMemoryConfig,
): Promise<LoverMemoryRecallResult[]> {
    const pool = entries.filter((e) => e.characterId === characterId && !e.mergedInto);
    if (pool.length === 0) return [];

    const q = query.trim();
    // 向量召回：仅当开启且配置了密钥时尝试。
    let queryEmbedding: number[] | null = null;
    if (config.vectorRecallEnabled && config.siliconFlowApiKey.trim() && config.siliconFlowEmbeddingModel.trim()) {
        queryEmbedding = await generateLoverEmbedding(q, config).catch(() => null);
    }

    const kwW = config.keywordWeight;
    const vW = config.vectorWeight;
    const sum = kwW + vW;
    const kwN = sum > 0 ? kwW / sum : 0.5;
    const vN = sum > 0 ? vW / sum : 0.5;

    const results: LoverMemoryRecallResult[] = pool.map((entry) => {
        const keywordScore = q ? scoreByKeyword(q, entry) : 0;
        const vectorScore = queryEmbedding ? scoreByVector(queryEmbedding, entry) : 0;
        let score = keywordScore * kwN + vectorScore * vN;
        if (entry.pinned) score += config.pinnedBoost;
        return { entry, keywordScore, vectorScore, score };
    });

    // 无查询时按最近时间 + 置顶优先。
    if (!q) {
        results.sort((a, b) => {
            if (a.entry.pinned !== b.entry.pinned) return a.entry.pinned ? -1 : 1;
            return b.entry.eventDate.localeCompare(a.entry.eventDate);
        });
        return results.slice(0, Math.max(1, config.recallTopK));
    }

    results.sort((a, b) => b.score - a.score || b.entry.eventDate.localeCompare(a.entry.eventDate));
    return results.slice(0, Math.max(1, config.recallTopK)).filter((r) => r.score > 0);
}
