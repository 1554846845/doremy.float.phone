// lib/lover-memory-api.ts
// 独立的硅基流动（SiliconFlow）OpenAI 兼容客户端。
// 专用于「恋人记忆库」的语义检索（向量）与记忆总结，不混用主聊天接口。

import type { LoverMemoryConfig } from "./lover-memory-types";
import { DEFAULT_SILICONFLOW_BASE_URL, isLikelyEmbeddingModel } from "./lover-memory-types";

function normalizeBaseUrl(baseUrl: string): string {
    const url = (baseUrl || DEFAULT_SILICONFLOW_BASE_URL).trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(url)) return DEFAULT_SILICONFLOW_BASE_URL;
    return url;
}

function apiReady(config: LoverMemoryConfig): boolean {
    return Boolean(config.siliconFlowApiKey.trim());
}

async function postJson(url: string, apiKey: string, body: unknown): Promise<unknown> {
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`硅基流动接口 ${res.status}：${text.slice(0, 300)}`);
    }
    return res.json();
}

export type SiliconFlowModelInfo = {
    id: string;
    isEmbedding: boolean;
};

/** 拉取硅基流动模型列表；失败返回 []。 */
export async function listSiliconFlowModels(config: LoverMemoryConfig): Promise<SiliconFlowModelInfo[]> {
    if (!apiReady(config)) return [];
    const base = normalizeBaseUrl(config.siliconFlowBaseUrl);
    try {
        const res = await fetch(`${base}/models`, {
            headers: { "Authorization": `Bearer ${config.siliconFlowApiKey}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { data?: Array<{ id?: string; type?: string }> };
        const list = (data.data ?? [])
            .map((m) => m.id)
            .filter((id): id is string => typeof id === "string" && id.length > 0);
        return list.map((id) => ({ id, isEmbedding: isLikelyEmbeddingModel(id) }));
    } catch (err) {
        console.warn("[LoverMemory] 拉取模型列表失败：", err);
        return [];
    }
}

/** 生成向量；失败返回 null（调用方回退到关键词检索）。 */
export async function generateLoverEmbedding(text: string, config: LoverMemoryConfig): Promise<number[] | null> {
    if (!apiReady(config) || !config.siliconFlowEmbeddingModel.trim()) return null;
    const base = normalizeBaseUrl(config.siliconFlowBaseUrl);
    try {
        const data = (await postJson(`${base}/embeddings`, config.siliconFlowApiKey, {
            model: config.siliconFlowEmbeddingModel,
            input: text,
        })) as { data?: Array<{ embedding?: number[] }> };
        const embedding = data?.data?.[0]?.embedding;
        return Array.isArray(embedding) && embedding.length > 0 ? embedding : null;
    } catch (err) {
        console.warn("[LoverMemory] 生成向量失败：", err);
        return null;
    }
}

/** 用总结模型生成精简摘要；失败返回 null。 */
export async function generateLoverSummary(prompt: string, config: LoverMemoryConfig): Promise<string | null> {
    if (!apiReady(config) || !config.siliconFlowSummaryModel.trim()) return null;
    const base = normalizeBaseUrl(config.siliconFlowBaseUrl);
    try {
        const data = (await postJson(`${base}/chat/completions`, config.siliconFlowApiKey, {
            model: config.siliconFlowSummaryModel,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            stream: false,
        })) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data?.choices?.[0]?.message?.content;
        return content && content.trim() ? content.trim() : null;
    } catch (err) {
        console.warn("[LoverMemory] 生成摘要失败：", err);
        return null;
    }
}

/** 测试连接：尝试拉取一次模型列表。 */
export async function testSiliconFlowConnection(config: LoverMemoryConfig): Promise<{ ok: boolean; error?: string; count?: number }> {
    if (!apiReady(config)) return { ok: false, error: "请先填写 API Key" };
    const models = await listSiliconFlowModels(config);
    if (models.length > 0) return { ok: true, count: models.length };
    // 列表可能受限，退而校验 baseUrl + key 是否可连：尝试一次最小向量请求。
    const emb = await generateLoverEmbedding("测试", config);
    if (emb) return { ok: true, count: 0 };
    return { ok: false, error: "无法连接硅基流动，请检查接口地址、密钥与模型名" };
}
