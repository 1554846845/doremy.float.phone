// lib/diary-exchange-module.ts
// 交换日记：双方各自写下当天日记，写完解锁对方那一页，按日期归档。

import { createSimpleStore, makeId } from "./simple-store";

export type DiaryExchangeEntry = {
    id: string;
    characterId: string;
    /** 归档日期 YYYY-MM-DD。 */
    date: string;
    /** 用户写的一页。 */
    myEntry: string;
    /** 角色写的一页（写完我的即可解锁）。 */
    theirEntry: string;
    /** 解锁时间。 */
    unlockedAt?: string;
    createdAt: string;
};

const store = createSimpleStore("ai_phone_diary_exchange_db_v1", ["entries"]);
const STORE = "entries";

export async function saveDiaryExchangeEntry(entry: DiaryExchangeEntry): Promise<void> {
    await store.put(STORE, entry as unknown as Record<string, unknown> & { id: string });
}

export async function loadDiaryExchangeEntries(characterId = ""): Promise<DiaryExchangeEntry[]> {
    const all = await store.getAll<DiaryExchangeEntry>(STORE);
    const list = all.filter((e) => e.characterId === characterId);
    list.sort((a, b) => b.date.localeCompare(a.date));
    return list;
}

export async function findDiaryExchangeEntry(characterId: string, date: string): Promise<DiaryExchangeEntry | null> {
    const all = await store.getAll<DiaryExchangeEntry>(STORE);
    return all.find((e) => e.characterId === characterId && e.date === date) ?? null;
}

export async function deleteDiaryExchangeEntry(id: string): Promise<void> {
    await store.del(STORE, id);
}

export function newDiaryExchangeId(): string {
    return makeId("dx");
}
