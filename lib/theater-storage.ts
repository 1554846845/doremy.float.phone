// lib/theater-storage.ts
// 小剧场持久化：独立 IndexedDB（故事/小纸条/每日一问）+ kv 配置。

import type {
    TheaterConfig, TheaterStory, TheaterNote, TheaterDailyQuestion,
} from "./theater-types";
import { DEFAULT_THEATER_CONFIG } from "./theater-types";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { openIndexedDbAtLeast } from "./idb-open";

const DB_NAME = "ai_phone_theater_db_v1";
const DB_VERSION = 1;
const STORY_STORE = "stories";
const NOTE_STORE = "notes";
const QUESTION_STORE = "questions";
const CONFIG_KEY = "ai_phone_theater_config_v1";
registerKvMigration(CONFIG_KEY);

function hasBrowserApi(): boolean {
    return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

async function openDb(): Promise<IDBDatabase | null> {
    if (!hasBrowserApi()) return null;
    return openIndexedDbAtLeast(DB_NAME, DB_VERSION, (db) => {
        if (!db.objectStoreNames.contains(STORY_STORE)) {
            const store = db.createObjectStore(STORY_STORE, { keyPath: "id" });
            store.createIndex("by_character", "characterId", { unique: false });
        }
        if (!db.objectStoreNames.contains(NOTE_STORE)) {
            db.createObjectStore(NOTE_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(QUESTION_STORE)) {
            db.createObjectStore(QUESTION_STORE, { keyPath: "id" });
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
    const db = await openDb();
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

async function readAll<T>(storeName: string): Promise<T[]> {
    const db = await openDb();
    if (!db) return [];
    try {
        const tx = db.transaction(storeName, "readonly");
        return await runRequest(tx.objectStore(storeName).getAll());
    } finally {
        db.close();
    }
}

export function makeId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── 配置 ──

export function loadTheaterConfig(): TheaterConfig {
    if (typeof window === "undefined") return JSON.parse(JSON.stringify(DEFAULT_THEATER_CONFIG));
    try {
        const raw = kvGet(CONFIG_KEY);
        if (!raw) return JSON.parse(JSON.stringify(DEFAULT_THEATER_CONFIG));
        const parsed = JSON.parse(raw) as Partial<TheaterConfig>;
        return {
            ...DEFAULT_THEATER_CONFIG,
            ...parsed,
            theaterSpec: { ...DEFAULT_THEATER_CONFIG.theaterSpec, ...(parsed.theaterSpec ?? {}) },
            pickupSpec: { ...DEFAULT_THEATER_CONFIG.pickupSpec, ...(parsed.pickupSpec ?? {}) },
        };
    } catch {
        return JSON.parse(JSON.stringify(DEFAULT_THEATER_CONFIG));
    }
}

export function saveTheaterConfig(config: TheaterConfig): void {
    if (typeof window === "undefined") return;
    kvSet(CONFIG_KEY, JSON.stringify(config));
}

// ── 故事 ──

export async function saveTheaterStory(story: TheaterStory): Promise<void> {
    await runWrite(STORY_STORE, (store) => store.put(story));
}

export async function loadTheaterStories(characterId = ""): Promise<TheaterStory[]> {
    const all = await readAll<TheaterStory>(STORY_STORE);
    const list = all.filter((s) => s.characterId === characterId);
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return list;
}

export async function deleteTheaterStory(id: string): Promise<void> {
    await runWrite(STORY_STORE, (store) => store.delete(id));
}

// ── 小纸条 ──

export async function saveTheaterNote(note: TheaterNote): Promise<void> {
    await runWrite(NOTE_STORE, (store) => store.put(note));
}

export async function loadTheaterNotes(): Promise<TheaterNote[]> {
    const all = await readAll<TheaterNote>(NOTE_STORE);
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return all;
}

export async function loadLatestTheaterNote(): Promise<TheaterNote | null> {
    const notes = await loadTheaterNotes();
    return notes[0] ?? null;
}

export async function deleteTheaterNote(id: string): Promise<void> {
    await runWrite(NOTE_STORE, (store) => store.delete(id));
}

// ── 每日一问 ──

export async function saveTheaterDailyQuestion(q: TheaterDailyQuestion): Promise<void> {
    await runWrite(QUESTION_STORE, (store) => store.put(q));
}

export async function loadTheaterDailyQuestions(): Promise<TheaterDailyQuestion[]> {
    const all = await readAll<TheaterDailyQuestion>(QUESTION_STORE);
    all.sort((a, b) => b.date.localeCompare(a.date));
    return all;
}

export async function loadTheaterDailyQuestionByDate(date: string): Promise<TheaterDailyQuestion | null> {
    const all = await readAll<TheaterDailyQuestion>(QUESTION_STORE);
    return all.find((q) => q.date === date) ?? null;
}
