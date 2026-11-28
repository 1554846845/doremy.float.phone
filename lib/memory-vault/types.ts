// lib/memory-vault/types.ts
// 增强记忆库（Memory Vault）：用户可以手动维护、始终置顶注入的长期事实。
//
// 与 lib/memory-storage 的自动记忆的区别：
//   - 自动记忆由摘要模型批量沉淀，条数多、会滚动、会被 token 预算裁掉；
//   - 记忆库条目是「用户亲自确认过的事实」，带分类与权重，注入时永远排在
//     最前面且不参与滑窗裁剪，用来钉住姓名、称呼、偏好、约定、关系里程碑。

export type MemoryVaultCategory =
    | "identity"      // 身份与称呼：真名、昵称、年龄、职业
    | "preference"    // 偏好与禁忌：喜欢/讨厌、口味、作息
    | "relationship"  // 关系与身份：恋人、家人、主仆、称呼
    | "milestone"     // 关系里程碑：在一起、纪念日、同居
    | "promise"       // 约定与承诺：说好的事、禁忌话题
    | "other";        // 其他长期事实

export type MemoryVaultEntry = {
    id: string;
    /** 归属角色；空字符串表示「所有角色通用」的全局记忆。 */
    characterId: string;
    category: MemoryVaultCategory;
    content: string;
    /** 重要程度 0-100；数值越大越先注入。 */
    weight: number;
    /** 置顶条目永远排在最前，且不受条数上限影响（仍受字符预算保护）。 */
    pinned: boolean;
    createdAt: string;
    updatedAt: string;
    source?: "manual" | "auto" | "import";
    metadata?: Record<string, unknown>;
};

export type MemoryVaultDraft = {
    id?: string;
    characterId: string;
    category: MemoryVaultCategory;
    content: string;
    weight: number;
    pinned: boolean;
};

export const MEMORY_VAULT_CATEGORIES: Array<{
    id: MemoryVaultCategory;
    label: string;
    hint: string;
    color: string;
}> = [
    { id: "identity", label: "身份", hint: "真名、昵称、年龄、职业", color: "#6d8cff" },
    { id: "preference", label: "偏好", hint: "喜欢/讨厌、口味、作息", color: "#39b98b" },
    { id: "relationship", label: "关系", hint: "恋人、家人、称呼、边界", color: "#e0679c" },
    { id: "milestone", label: "里程碑", hint: "在一起、纪念日、同居", color: "#f0a03c" },
    { id: "promise", label: "约定", hint: "说好的事、禁忌话题", color: "#8b6cf0" },
    { id: "other", label: "其他", hint: "其他需要长期记住的事实", color: "#7b8794" },
];

export function memoryVaultCategoryLabel(category: MemoryVaultCategory): string {
    return MEMORY_VAULT_CATEGORIES.find((item) => item.id === category)?.label ?? "其他";
}

export function isMemoryVaultCategory(value: unknown): value is MemoryVaultCategory {
    return typeof value === "string" && MEMORY_VAULT_CATEGORIES.some((item) => item.id === value);
}

export const MEMORY_VAULT_MAX_CONTENT = 600;
export const MEMORY_VAULT_MAX_ENTRIES_PER_CHARACTER = 400;
/** 单次注入的字符预算：再重要也不能把 System Prompt 撑爆。 */
export const MEMORY_VAULT_PROMPT_BUDGET = 1800;
