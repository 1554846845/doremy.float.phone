// lib/confession-module.ts
// 忏悔室：提交忏悔/心事，角色按人设给出带情绪互动与回应的反馈，并保留记录。

import { createSimpleStore, makeId } from "./simple-store";

export type ConfessionKind = "confession" | "secret" | "regret" | "heart";

export type ConfessionRecord = {
    id: string;
    characterId: string;
    kind: ConfessionKind;
    content: string;
    /** 角色的情绪反馈（带情绪的互动回应）。 */
    response: string;
    /** 角色给出的情绪标签。 */
    emotion: string;
    createdAt: string;
};

const store = createSimpleStore("ai_phone_confession_db_v1", ["records"]);
const STORE = "records";

export const CONFESSION_KINDS: Array<{ id: ConfessionKind; label: string }> = [
    { id: "confession", label: "忏悔" },
    { id: "secret", label: "心事" },
    { id: "regret", label: "后悔的事" },
    { id: "heart", label: "悄悄话" },
];

export async function saveConfessionRecord(record: ConfessionRecord): Promise<void> {
    await store.put(STORE, record as unknown as Record<string, unknown> & { id: string });
}

export async function loadConfessionRecords(characterId = ""): Promise<ConfessionRecord[]> {
    const all = await store.getAll<ConfessionRecord>(STORE);
    const list = all.filter((r) => r.characterId === characterId);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list;
}

export async function deleteConfessionRecord(id: string): Promise<void> {
    await store.del(STORE, id);
}

export function newConfessionId(): string {
    return makeId("cf");
}
