// lib/qabox-module.ts
// 双向匿名问答箱：用户匿名问角色，角色也能匿名投递问题；双方都能作答和猜身份。

import { createSimpleStore, makeId } from "./simple-store";

export type QaBoxDirection = "user_to_char" | "char_to_user";

export type QaBoxItem = {
    id: string;
    characterId: string;
    direction: QaBoxDirection;
    question: string;
    answer?: string;
    /** 猜身份结论。 */
    guess?: string;
    answeredAt?: string;
    createdAt: string;
};

const store = createSimpleStore("ai_phone_qabox_db_v1", ["items"]);
const STORE = "items";

export async function saveQaBoxItem(item: QaBoxItem): Promise<void> {
    await store.put(STORE, item as unknown as Record<string, unknown> & { id: string });
}

export async function loadQaBoxItems(characterId = ""): Promise<QaBoxItem[]> {
    const all = await store.getAll<QaBoxItem>(STORE);
    const list = all.filter((i) => i.characterId === characterId);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list;
}

export async function deleteQaBoxItem(id: string): Promise<void> {
    await store.del(STORE, id);
}

export function newQaBoxId(): string {
    return makeId("qb");
}
