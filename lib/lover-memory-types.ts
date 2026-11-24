// lib/lover-memory-types.ts
// 专属恋人的个人记忆库：类型与默认配置。
// 独立于现有的角色长期/核心记忆体系，使用自己的 IndexedDB 与硅基流动 API。

export type LoverMemoryEntry = {
    id: string;
    /** 归属角色；空字符串表示全局共享（默认）。 */
    characterId: string;
    /** 原文（保留对照用）。 */
    content: string;
    /** 精简摘要（可手动 / 由总结模型生成）。 */
    summary?: string;
    /** 事件发生时间（用于按日期时间线切片）。 */
    eventDate: string;
    createdAt: string;
    updatedAt: string;
    /** 手动标签。 */
    tags: string[];
    /** 核心记忆置顶。 */
    pinned: boolean;
    /** 来源：手动 / 导入 / 聊天自动。 */
    source: "manual" | "import" | "chat_auto";
    /** 0-1 重要度。 */
    importance: number;
    /** 向量（由硅基流动向量模型生成）。 */
    embedding?: number[];
    /** 被合并到的目标条目 id（合并后本条不再独立展示）。 */
    mergedInto?: string;
};

export type LoverMemoryArchive = {
    id: string;
    characterId: string;
    /** 时间片起止。 */
    startTime: string;
    endTime: string;
    /** 精简标题。 */
    title: string;
    /** 提炼摘要（保留原文在 entryIds 里对照）。 */
    summary: string;
    entryIds: string[];
    /** 关键事件关键词。 */
    keyEvents: string[];
    createdAt: string;
    updatedAt: string;
};

export type LoverMemoryConfig = {
    /** 独立硅基流动设置（不混用主聊天接口）。 */
    siliconFlowBaseUrl: string;
    siliconFlowApiKey: string;
    siliconFlowEmbeddingModel: string;
    siliconFlowSummaryModel: string;
    /** 双路召回。 */
    recallTopK: number;          // 召回数量
    keywordWeight: number;       // 精确关键词权重 0-1
    vectorWeight: number;        // 向量语义权重 0-1
    vectorRecallEnabled: boolean;
    /** 注入上下文（聊天时自动带上）。 */
    autoInjectEnabled: boolean;
    injectTokenBudget: number;   // 注入字数上限
    pinnedBoost: number;         // 置顶条目额外加成
    /** 聊天实时自动沉淀归档。 */
    autoArchiveEnabled: boolean;      // 是否把聊天内容自动写入记忆库
    autoArchiveMinImportance: number; // 自动沉淀的最低重要度（低于不记）
    autoArchiveMaxPerTurn: number;    // 每轮最多自动沉淀多少条
    /** 定时自动备份（本地快照）。 */
    autoBackupEnabled: boolean;
    backupIntervalHours: number;      // 自动备份间隔（小时）
};

/**
 * 恋人「喜好与雷区」档案——永久置顶、以最高优先级注入上下文，
 * 切换任何模型/接口都不会丢失（独立持久化，与聊天/记忆分离）。
 */
export type LoverProfile = {
    /** 归属角色；空字符串表示全局恋人档案。 */
    characterId: string;
    /** 喜好（喜欢的东西、习惯、纪念日等）。 */
    likes: string[];
    /** 雷区（忌讳、边界、绝不能踩的线）。 */
    mines: string[];
    /** 称呼与偏好（怎么称呼 TA / TA 怎么称呼你）。 */
    nicknames: string[];
    /** 其他重要约定与备注。 */
    notes: string[];
    /** 自由格式补充（原文保留）。 */
    raw: string;
    updatedAt: string;
};

export const DEFAULT_SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";
export const DEFAULT_EMBEDDING_MODEL = "BAAI/bge-large-zh-v1.5";
export const DEFAULT_SUMMARY_MODEL = "Qwen/Qwen2.5-7B-Instruct";

export const DEFAULT_LOVER_MEMORY_CONFIG: LoverMemoryConfig = {
    siliconFlowBaseUrl: DEFAULT_SILICONFLOW_BASE_URL,
    siliconFlowApiKey: "",
    siliconFlowEmbeddingModel: DEFAULT_EMBEDDING_MODEL,
    siliconFlowSummaryModel: DEFAULT_SUMMARY_MODEL,
    recallTopK: 6,
    keywordWeight: 0.5,
    vectorWeight: 0.5,
    vectorRecallEnabled: true,
    autoInjectEnabled: true,
    injectTokenBudget: 2000,
    pinnedBoost: 0.15,
    autoArchiveEnabled: true,
    autoArchiveMinImportance: 0.55,
    autoArchiveMaxPerTurn: 3,
    autoBackupEnabled: false,
    backupIntervalHours: 24,
};

export const DEFAULT_LOVER_PROFILE: LoverProfile = {
    characterId: "",
    likes: [],
    mines: [],
    nicknames: [],
    notes: [],
    raw: "",
    updatedAt: "",
};

/** 判断 id 是否像向量模型（用于模型列表归类）。 */
export function isLikelyEmbeddingModel(id: string): boolean {
    return /embed|bge-|m3e|text2vec|\be5\b|\bgte\b/i.test(id);
}
