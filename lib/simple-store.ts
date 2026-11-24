// lib/simple-store.ts
// 互动应用共用的极简 IndexedDB 存储封装（忏悔室/问答箱/交换日记/惩罚券）。
// 一个 DB 可包含多个 store，open() 在 onUpgrade 里一次性创建全部 store。

import { openIndexedDbAtLeast } from "./idb-open";

function hasBrowserApi(): boolean {
    return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

export type SimpleStore = {
    put: (storeName: string, value: Record<string, unknown> & { id: string }) => Promise<void>;
    getAll: <T>(storeName: string) => Promise<T[]>;
    del: (storeName: string, id: string) => Promise<void>;
};

export function createSimpleStore(dbName: string, stores: string[]): SimpleStore {
    async function open(): Promise<IDBDatabase | null> {
        if (!hasBrowserApi()) return null;
        return openIndexedDbAtLeast(dbName, 1, (db) => {
            for (const store of stores) {
                if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
            }
        }).catch(() => null);
    }

    function runRequest<T>(req: IDBRequest<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function runWrite(storeName: string, fn: (store: IDBObjectStore) => void): Promise<void> {
        const db = await open();
        if (!db) return;
        try {
            const tx = db.transaction(storeName, "readwrite");
            fn(tx.objectStore(storeName));
            await new Promise<void>((res, rej) => {
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
                tx.onabort = () => rej(tx.error);
            });
        } finally {
            db.close();
        }
    }

    return {
        async put(storeName, value) {
            await runWrite(storeName, (store) => store.put(value));
        },
        async getAll<T>(storeName: string) {
            const db = await open();
            if (!db) return [];
            try {
                const tx = db.transaction(storeName, "readonly");
                return await runRequest(tx.objectStore(storeName).getAll() as IDBRequest<T[]>);
            } finally {
                db.close();
            }
        },
        async del(storeName, id) {
            await runWrite(storeName, (store) => store.delete(id));
        },
    };
}

export function makeId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
