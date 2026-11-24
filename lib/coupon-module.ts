// lib/coupon-module.ts
// 惩罚券：自定义惩罚内容与次数，使用后触发角色按当下状态执行的即时反馈，并记录结果。

import { createSimpleStore, makeId } from "./simple-store";

export type Coupon = {
    id: string;
    characterId: string;
    name: string;
    description: string;
    total: number;
    used: number;
    createdAt: string;
};

export type CouponUseRecord = {
    id: string;
    couponId: string;
    characterId: string;
    /** 角色的即时反馈互动结果。 */
    feedback: string;
    createdAt: string;
};

const store = createSimpleStore("ai_phone_coupon_db_v1", ["coupons", "records"]);
const COUPON_STORE = "coupons";
const RECORD_STORE = "records";

export async function saveCoupon(coupon: Coupon): Promise<void> {
    await store.put(COUPON_STORE, coupon as unknown as Record<string, unknown> & { id: string });
}

export async function loadCoupons(characterId = ""): Promise<Coupon[]> {
    const all = await store.getAll<Coupon>(COUPON_STORE);
    const list = all.filter((c) => c.characterId === characterId);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list;
}

export async function deleteCoupon(id: string): Promise<void> {
    await store.del(COUPON_STORE, id);
}

export async function saveCouponUseRecord(record: CouponUseRecord): Promise<void> {
    await store.put(RECORD_STORE, record as unknown as Record<string, unknown> & { id: string });
}

export async function loadCouponUseRecords(characterId = ""): Promise<CouponUseRecord[]> {
    const all = await store.getAll<CouponUseRecord>(RECORD_STORE);
    const list = all.filter((r) => r.characterId === characterId);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list;
}

export function newCouponId(): string {
    return makeId("cp");
}
