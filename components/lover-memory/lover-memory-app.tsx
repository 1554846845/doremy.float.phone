"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Archive, Download, Heart, Plus, Search, Settings2, Sparkles,
    Star, Trash2, Upload, Merge, FileText, RefreshCw, Pin, ShieldCheck,
} from "lucide-react";
import { Toggle } from "@/components/ui/form";
import { ConfirmDialog, ContentDialog } from "@/components/ui/modal";
import { loadCharacters } from "@/lib/character-storage";
import type { LoverMemoryArchive, LoverMemoryConfig, LoverMemoryEntry, LoverProfile } from "@/lib/lover-memory-types";
import { DEFAULT_LOVER_PROFILE } from "@/lib/lover-memory-types";
import {
    loadLoverMemoryConfig, saveLoverMemoryConfig,
    loadLoverMemoryEntries, loadLoverMemoryArchives,
    saveLoverMemoryEntry, saveLoverMemoryEntries, saveLoverMemoryArchive,
    deleteLoverMemoryEntry, deleteLoverMemoryArchives, clearLoverMemory,
    parseTextImport, parseTableImport, recordsToEntries,
    buildLoverMemoryExportJson, buildLoverMemoryExportCsv, sliceEntriesByDay, extractKeyEvents,
} from "@/lib/lover-memory-storage";
import { loadLoverProfile, saveLoverProfile, hasLoverProfileContent } from "@/lib/lover-memory-profile";
import { parseXlsxImport, parseLegacyExport, importedRecordsToEntries } from "@/lib/lover-memory-xlsx";
import { maybeRunLoverMemoryAutoBackup } from "@/lib/lover-memory-ingest";
import { recallLoverMemories } from "@/lib/lover-memory-recall";
import { listSiliconFlowModels, testSiliconFlowConnection, generateLoverSummary, generateLoverEmbedding } from "@/lib/lover-memory-api";
import { downloadFile } from "@/lib/download-utils";
import { MoveInImport } from "@/components/settings/move-in";

type Tab = "profile" | "all" | "pinned" | "archive" | "settings";

const STYLE = `
.lm-app { display:flex; flex-direction:column; gap:12px; padding:14px 14px 40px; }
.lm-hero { border-radius:20px; padding:18px 16px; color:#fff;
  background:linear-gradient(135deg,#ff8fb1 0%,#c084fc 55%,#8b7cf6 100%);
  box-shadow:0 8px 24px rgba(192,132,252,.28); }
.lm-hero h2 { margin:0 0 4px; font-size:20px; letter-spacing:.5px; }
.lm-hero p { margin:0; opacity:.92; font-size:12px; }
.lm-chip { display:inline-flex; align-items:center; gap:4px; border-radius:999px;
  background:rgba(255,255,255,.22); padding:4px 10px; font-size:11px; margin-top:10px; }
.lm-tabs { display:flex; gap:8px; }
.lm-tab { flex:1; display:flex; align-items:center; justify-content:center; gap:6px;
  border:1px solid var(--c-panel-border, rgba(0,0,0,.08)); border-radius:14px;
  padding:10px 6px; font-size:12px; color:var(--c-secondary,#888); background:transparent; cursor:pointer; }
.lm-tab[data-active="true"] { color:#fff; border-color:transparent;
  background:linear-gradient(135deg,#ff8fb1,#c084fc); }
.lm-search { display:flex; gap:8px; }
.lm-search input { flex:1; border-radius:14px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08));
  padding:10px 12px; font-size:13px; background:var(--c-panel,#fff); color:var(--c-primary,#222); }
.lm-btn { display:inline-flex; align-items:center; gap:6px; border-radius:14px; padding:10px 12px;
  font-size:12px; font-weight:600; cursor:pointer; border:1px solid transparent; }
.lm-btn-primary { color:#fff; background:linear-gradient(135deg,#ff8fb1,#c084fc); }
.lm-btn-ghost { color:var(--c-secondary,#888); border-color:var(--c-panel-border,rgba(0,0,0,.08)); background:transparent; }
.lm-card { border-radius:16px; padding:12px 14px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08));
  background:var(--c-panel,#fff); }
.lm-card[data-pinned="true"] { border-color:#c084fc; background:linear-gradient(180deg,rgba(192,132,252,.08),rgba(255,143,177,.05)); }
.lm-card-head { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.lm-date { font-size:11px; color:var(--c-secondary,#999); }
.lm-tag { border-radius:8px; padding:2px 8px; font-size:10px; background:rgba(192,132,252,.14); color:#a855f7; }
.lm-tag-pin { background:rgba(255,143,177,.18); color:#ec4899; }
.lm-content { margin:8px 0 0; font-size:13px; line-height:1.6; white-space:pre-wrap; word-break:break-word; }
.lm-summary { margin:8px 0 0; font-size:12px; color:#7c5cbf; background:rgba(192,132,252,.10);
  border-radius:10px; padding:8px 10px; }
.lm-actions { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
.lm-mini { display:inline-flex; align-items:center; gap:3px; border-radius:9px; padding:5px 8px;
  font-size:11px; cursor:pointer; border:1px solid var(--c-panel-border,rgba(0,0,0,.08)); background:transparent; color:var(--c-secondary,#888); }
.lm-mini[data-on="true"] { color:#ec4899; border-color:#f9a8d4; }
.lm-section-title { font-size:11px; letter-spacing:1px; color:var(--c-secondary,#999); text-transform:uppercase; margin:6px 0 8px; }
.lm-field { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }
.lm-field label { font-size:11px; color:var(--c-secondary,#888); }
.lm-field input, .lm-field textarea { border-radius:12px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08));
  padding:9px 11px; font-size:13px; background:var(--c-panel,#fff); color:var(--c-primary,#222); }
.lm-row { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 0;
  border-bottom:1px solid var(--c-panel-border,rgba(0,0,0,.06)); }
.lm-row:last-child { border-bottom:none; }
.lm-row-label { font-size:13px; }
.lm-row-desc { font-size:11px; color:var(--c-secondary,#999); }
.lm-range { width:100%; accent-color:#c084fc; }
`;

function makeId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function LoverMemoryApp({ onNotice }: { onNotice?: (msg: string) => void }) {
    const [tab, setTab] = useState<Tab>("profile");
    const [showMoveIn, setShowMoveIn] = useState(false);
    const [config, setConfig] = useState<LoverMemoryConfig>(loadLoverMemoryConfig);
    const [charId, setCharId] = useState("");
    // 恋人「喜好与雷区」档案（永久置顶）
    const [profile, setProfile] = useState<LoverProfile>(() => loadLoverProfile(""));
    const [profileLikes, setProfileLikes] = useState("");
    const [profileMines, setProfileMines] = useState("");
    const [profileNicknames, setProfileNicknames] = useState("");
    const [profileNotes, setProfileNotes] = useState("");
    const [profileRaw, setProfileRaw] = useState("");
    const [entries, setEntries] = useState<LoverMemoryEntry[]>([]);
    const [archives, setArchives] = useState<LoverMemoryArchive[]>([]);
    const [query, setQuery] = useState("");
    const [searchResults, setSearchResults] = useState<LoverMemoryEntry[] | null>(null);
    const [searching, setSearching] = useState(false);

    // 编辑/新增
    const [editing, setEditing] = useState<LoverMemoryEntry | null>(null);
    const [editorContent, setEditorContent] = useState("");
    const [editorSummary, setEditorSummary] = useState("");
    const [editorTags, setEditorTags] = useState("");
    const [editorDate, setEditorDate] = useState("");
    // 合并
    const [merging, setMerging] = useState<LoverMemoryEntry | null>(null);
    // 删除
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [confirmClear, setConfirmClear] = useState(false);
    // 导入
    const [importOpen, setImportOpen] = useState(false);
    const [importText, setImportText] = useState("");
    const [importPreview, setImportPreview] = useState<LoverMemoryEntry[]>([]);
    const fileRef = useRef<HTMLInputElement>(null);

    const chars = useMemo(() => loadCharacters(), []);

    const notice = useCallback((msg: string) => {
        onNotice?.(msg);
    }, [onNotice]);

    const reload = useCallback(async () => {
        const [es, as] = await Promise.all([loadLoverMemoryEntries(charId), loadLoverMemoryArchives(charId)]);
        setEntries(es);
        setArchives(as);
    }, [charId]);

    useEffect(() => { reload(); }, [reload]);
    useEffect(() => { setConfig(loadLoverMemoryConfig()); }, []);

    // 档案按归属角色加载；空 charId 用全局档案。
    useEffect(() => {
        const p = loadLoverProfile(charId);
        setProfile(p);
        setProfileLikes(p.likes.join("\n"));
        setProfileMines(p.mines.join("\n"));
        setProfileNicknames(p.nicknames.join("\n"));
        setProfileNotes(p.notes.join("\n"));
        setProfileRaw(p.raw);
    }, [charId]);

    // 定时自动备份：挂载后周期检查是否到期（间隔由配置决定）。
    useEffect(() => {
        const tick = () => { void maybeRunLoverMemoryAutoBackup(charId); };
        const timer = window.setInterval(tick, 10 * 60_000);
        const initial = window.setTimeout(tick, 20_000);
        return () => { window.clearInterval(timer); window.clearTimeout(initial); };
    }, [charId]);

    const persistProfile = useCallback((next: LoverProfile) => {
        setProfile(next);
        saveLoverProfile(next);
    }, []);

    const saveProfileNow = useCallback(() => {
        const split = (s: string) => s.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
        const next: LoverProfile = {
            characterId: charId,
            likes: split(profileLikes),
            mines: split(profileMines),
            nicknames: split(profileNicknames),
            notes: split(profileNotes),
            raw: profileRaw.trim(),
            updatedAt: new Date().toISOString(),
        };
        persistProfile(next);
        notice("恋人档案已保存，将以最高优先级注入上下文");
    }, [charId, profileLikes, profileMines, profileNicknames, profileNotes, profileRaw, persistProfile, notice]);

    const persistConfig = useCallback((next: LoverMemoryConfig) => {
        setConfig(next);
        saveLoverMemoryConfig(next);
    }, []);

    const runSearch = useCallback(async (q: string) => {
        if (!q.trim()) { setSearchResults(null); return; }
        setSearching(true);
        try {
            const results = await recallLoverMemories(charId, q, entries, config);
            setSearchResults(results.map((r) => r.entry));
        } catch {
            setSearchResults([]);
        } finally {
            setSearching(false);
        }
    }, [charId, entries, config]);

    useEffect(() => {
        if (!query.trim()) { setSearchResults(null); return; }
        const t = setTimeout(() => runSearch(query), 300);
        return () => clearTimeout(t);
    }, [query, runSearch]);

    const visible = useMemo(() => {
        const base = searchResults ?? entries;
        if (tab === "pinned") return base.filter((e) => e.pinned && !e.mergedInto);
        return base.filter((e) => !e.mergedInto);
    }, [searchResults, entries, tab]);

    // ── 写操作 ──
    const saveEntry = async (entry: LoverMemoryEntry) => {
        await saveLoverMemoryEntry(entry);
        await reload();
    };

    const togglePin = async (entry: LoverMemoryEntry) => {
        entry.pinned = !entry.pinned;
        entry.updatedAt = new Date().toISOString();
        await saveEntry(entry);
    };

    const openEdit = (entry: LoverMemoryEntry | null) => {
        setEditing(entry);
        setEditorContent(entry?.content ?? "");
        setEditorSummary(entry?.summary ?? "");
        setEditorTags(entry?.tags.join("、") ?? "");
        setEditorDate((entry?.eventDate ?? new Date().toISOString()).slice(0, 10));
    };

    const commitEdit = async () => {
        if (!editorContent.trim()) { notice("内容不能为空"); return; }
        const now = new Date().toISOString();
        const base: LoverMemoryEntry = editing ?? {
            id: makeId("lm"),
            characterId: charId,
            content: "",
            eventDate: now.slice(0, 10),
            createdAt: now,
            updatedAt: now,
            tags: [],
            pinned: false,
            source: "manual",
            importance: 0.7,
        };
        const next: LoverMemoryEntry = {
            ...base,
            content: editorContent.trim(),
            summary: editorSummary.trim() || undefined,
            tags: editorTags.split(/[,，;；、]/).map((t) => t.trim()).filter(Boolean),
            eventDate: editorDate || now.slice(0, 10),
            updatedAt: now,
        };
        // 内容变化后重新生成向量（异步，不阻塞保存）
        await saveLoverMemoryEntry(next);
        if (config.vectorRecallEnabled && config.siliconFlowApiKey.trim() && config.siliconFlowEmbeddingModel.trim()) {
            generateLoverEmbedding(next.content, config).then((emb) => {
                if (emb) { next.embedding = emb; saveLoverMemoryEntry(next).then(reload); }
            }).catch(() => {});
        }
        setEditing(null);
        await reload();
        notice(editing ? "已保存" : "已新增记忆");
    };

    const confirmMerge = async (target: LoverMemoryEntry) => {
        if (!merging || target.id === merging.id) { setMerging(null); return; }
        const source = merging;
        source.mergedInto = target.id;
        source.updatedAt = new Date().toISOString();
        target.content = `${target.content}\n${source.content}`;
        target.updatedAt = new Date().toISOString();
        await saveLoverMemoryEntries([source, target]);
        setMerging(null);
        await reload();
        notice("已合并记忆");
    };

    // ── 导入 ──
    const handleImportFile = async (file: File) => {
        const name = file.name.toLowerCase();
        if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
            const records = await parseXlsxImport(file);
            setImportText("（已从表格文件解析）");
            setImportPreview(importedRecordsToEntries(charId, records));
            setImportOpen(true);
            return;
        }
        const text = await file.text();
        setImportText(text);
        const records = name.endsWith(".csv") || name.endsWith(".tsv")
            ? parseTableImport(text)
            : name.endsWith(".json")
                ? parseLegacyExport(text)
                : parseLegacyExport(text).length > 0 ? parseLegacyExport(text) : parseTextImport(text);
        setImportPreview(recordsToEntries(charId, records));
        setImportOpen(true);
    };

    const handleImportPaste = () => {
        const legacy = parseLegacyExport(importText);
        const records = legacy.length > 0 && (importText.trim().startsWith("[") || importText.trim().startsWith("{") || /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?[ T]?\d{1,2}:\d{2}/.test(importText))
            ? legacy
            : importText.includes("\t") || (importText.includes(",") && /,.*,/.test(importText))
                ? parseTableImport(importText)
                : parseTextImport(importText);
        setImportPreview(recordsToEntries(charId, records));
    };

    const commitImport = async () => {
        if (importPreview.length === 0) { notice("没有可导入的记录"); return; }
        await saveLoverMemoryEntries(importPreview);
        setImportOpen(false);
        setImportText("");
        setImportPreview([]);
        await reload();
        notice(`已导入 ${importPreview.length} 条记忆`);
    };

    // ── 导出 ──
    const doExportJson = async () => {
        const blob = new Blob([buildLoverMemoryExportJson(entries, archives)], { type: "application/json" });
        await downloadFile(blob, `恋人记忆-${new Date().toISOString().slice(0, 10)}.json`);
    };
    const doExportCsv = async () => {
        const blob = new Blob(["\ufeff" + buildLoverMemoryExportCsv(entries)], { type: "text/csv;charset=utf-8" });
        await downloadFile(blob, `恋人记忆-${new Date().toISOString().slice(0, 10)}.csv`);
    };

    // ── 归档 ──
    const buildArchives = async () => {
        const slices = sliceEntriesByDay(entries);
        const now = new Date().toISOString();
        const built: LoverMemoryArchive[] = [];
        for (const s of slices) {
            const first = s.entries[0];
            const last = s.entries[s.entries.length - 1];
            let summary = s.entries.slice(0, 3).map((e) => e.summary || e.content.slice(0, 40)).join("；");
            if (config.siliconFlowApiKey.trim() && config.siliconFlowSummaryModel.trim()) {
                const prompt = `请用80字以内提炼下面这些恋人聊天/记忆的精华，保留关键事实与情感要点，不要格式标记：\n${s.entries.map((e) => e.content).join("\n")}`;
                const s2 = await generateLoverSummary(prompt, config).catch(() => null);
                if (s2) summary = s2;
            }
            built.push({
                id: `lma_${s.date}_${Math.random().toString(36).slice(2, 6)}`,
                characterId: charId,
                startTime: first.eventDate,
                endTime: last.eventDate,
                title: s.date,
                summary,
                entryIds: s.entries.map((e) => e.id),
                keyEvents: extractKeyEvents(s.entries),
                createdAt: now,
                updatedAt: now,
            });
        }
        if (built.length > 0) {
            for (const a of built) await saveLoverMemoryArchive(a);
        }
        await reload();
        notice(`已按日期切片归档 ${built.length} 段`);
    };

    // ── 设置：拉取模型 / 测试连接 ──
    const [models, setModels] = useState<{ id: string; isEmbedding: boolean }[]>([]);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [testing, setTesting] = useState(false);

    const fetchModels = async () => {
        setFetchingModels(true);
        try {
            const list = await listSiliconFlowModels(config);
            setModels(list);
            if (list.length === 0) notice("未拉到模型，请检查接口地址与密钥");
            else notice(`已拉取 ${list.length} 个模型`);
        } finally {
            setFetchingModels(false);
        }
    };

    const testConn = async () => {
        setTesting(true);
        try {
            const r = await testSiliconFlowConnection(config);
            notice(r.ok ? `连接成功${r.count ? `（${r.count} 个模型）` : ""}` : `连接失败：${r.error ?? "未知错误"}`);
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="lm-app">
            <style>{STYLE}</style>

            {/* 顶部渐变卡片 */}
            <div className="lm-hero">
                <h2><Heart size={18} style={{ verticalAlign: "-2px", marginRight: 6 }} />恋人记忆</h2>
                <p>专属于你们的个人记忆库 · 双路召回 · 自动注入上下文</p>
                <span className="lm-chip"><Star size={11} /> {entries.filter((e) => !e.mergedInto).length} 条记忆</span>
                <span className="lm-chip" style={{ marginLeft: 6 }}><Archive size={11} /> {archives.length} 段时间片</span>
            </div>

            {/* 标签页 */}
            <div className="lm-tabs">
                <button className="lm-tab" data-active={tab === "profile"} onClick={() => setTab("profile")}><ShieldCheck size={14} /> 档案</button>
                <button className="lm-tab" data-active={tab === "all"} onClick={() => setTab("all")}><Heart size={14} /> 记忆</button>
                <button className="lm-tab" data-active={tab === "pinned"} onClick={() => setTab("pinned")}><Pin size={14} /> 置顶</button>
                <button className="lm-tab" data-active={tab === "archive"} onClick={() => setTab("archive")}><Archive size={14} /> 归档</button>
                <button className="lm-tab" data-active={tab === "settings"} onClick={() => setTab("settings")}><Settings2 size={14} /> 设置</button>
            </div>

            {/* 恋人喜好与雷区档案（永久置顶） */}
            {tab === "profile" && (
                <>
                    <div className="lm-card" style={{ borderColor: "#c084fc", background: "linear-gradient(180deg,rgba(192,132,252,.10),rgba(255,143,177,.06))" }}>
                        <div className="lm-card-head"><ShieldCheck size={14} style={{ color: "#a855f7" }} /><span style={{ fontWeight: 700, fontSize: 14 }}>喜好与雷区档案</span></div>
                        <p style={{ fontSize: 12, color: "var(--c-secondary,#888)", margin: "6px 0 0" }}>
                            永久置顶、以最高优先级注入上下文——切换任何模型/接口都不会丢失。
                        </p>
                    </div>
                    <div className="lm-field">
                        <label>TA 喜欢 / 喜好（每行一条）</label>
                        <textarea rows={3} value={profileLikes} onChange={(e) => setProfileLikes(e.target.value)} placeholder="喜欢的东西、习惯、纪念日…" />
                    </div>
                    <div className="lm-field">
                        <label>雷区 / 绝不能踩（每行一条）</label>
                        <textarea rows={3} value={profileMines} onChange={(e) => setProfileMines(e.target.value)} placeholder="忌讳、边界、会生气的点…" />
                    </div>
                    <div className="lm-field">
                        <label>称呼偏好（每行一条）</label>
                        <textarea rows={2} value={profileNicknames} onChange={(e) => setProfileNicknames(e.target.value)} placeholder="怎么称呼 TA / TA 怎么称呼你" />
                    </div>
                    <div className="lm-field">
                        <label>重要约定 / 备注（每行一条）</label>
                        <textarea rows={2} value={profileNotes} onChange={(e) => setProfileNotes(e.target.value)} placeholder="其它需要永远记住的约定" />
                    </div>
                    <div className="lm-field">
                        <label>自由补充（原文保留）</label>
                        <textarea rows={3} value={profileRaw} onChange={(e) => setProfileRaw(e.target.value)} placeholder="任何其它想永久记住的话" />
                    </div>
                    <button className="lm-btn lm-btn-primary" onClick={saveProfileNow}><ShieldCheck size={14} /> 保存档案</button>
                    {hasLoverProfileContent(profile) && (
                        <p style={{ fontSize: 11, color: "#7c5cbf", margin: "6px 0 0" }}>
                            已保存档案 · 已注入 {profile.likes.length + profile.mines.length + profile.nicknames.length + profile.notes.length + (profile.raw.trim() ? 1 : 0)} 项
                        </p>
                    )}
                </>
            )}

            {tab !== "settings" && (
                <div className="lm-search">
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searching ? "召回中…" : "搜索记忆（关键词 + 语义）"} />
                    <button className="lm-btn lm-btn-ghost" onClick={() => openEdit(null)}><Plus size={15} /> 新增</button>
                </div>
            )}

            {/* 记忆 / 置顶 */}
            {(tab === "all" || tab === "pinned") && (
                <>
                    <div className="lm-section-title">{searchResults ? "召回结果" : tab === "pinned" ? "核心记忆（置顶）" : "全部记忆"}</div>
                    {visible.length === 0 ? (
                        <p style={{ color: "var(--c-secondary,#999)", fontSize: 13, textAlign: "center", marginTop: 20 }}>
                            暂无记忆，点「新增」或导入过往聊天记录。
                        </p>
                    ) : visible.map((e) => (
                        <div key={e.id} className="lm-card" data-pinned={e.pinned}>
                            <div className="lm-card-head">
                                <span className="lm-date">{e.eventDate.slice(0, 10)}</span>
                                {e.pinned && <span className="lm-tag lm-tag-pin">★置顶</span>}
                                {e.tags.map((t) => <span key={t} className="lm-tag">{t}</span>)}
                                <span className="lm-date" style={{ marginLeft: "auto" }}>{e.source === "import" ? "导入" : e.source === "chat_auto" ? "自动" : "手动"}</span>
                            </div>
                            {e.summary && <div className="lm-summary">摘要：{e.summary}</div>}
                            <div className="lm-content">{e.content}</div>
                            <div className="lm-actions">
                                <button className="lm-mini" data-on={e.pinned} onClick={() => togglePin(e)}><Pin size={12} /> {e.pinned ? "取消置顶" : "置顶"}</button>
                                <button className="lm-mini" onClick={() => openEdit(e)}><FileText size={12} /> 编辑</button>
                                <button className="lm-mini" onClick={() => setMerging(e)}><Merge size={12} /> 合并</button>
                                <button className="lm-mini" onClick={() => setConfirmDeleteId(e.id)}><Trash2 size={12} /> 删除</button>
                            </div>
                        </div>
                    ))}
                </>
            )}

            {/* 归档 */}
            {tab === "archive" && (
                <>
                    <div className="lm-actions">
                        <button className="lm-btn lm-btn-primary" onClick={buildArchives}><Sparkles size={14} /> 按日期自动切片归档</button>
                        <button className="lm-btn lm-btn-ghost" onClick={() => setConfirmClear(true)}><Trash2 size={14} /> 清空</button>
                    </div>
                    {archives.length === 0 ? (
                        <p style={{ color: "var(--c-secondary,#999)", fontSize: 13, textAlign: "center", marginTop: 20 }}>
                            尚无归档。点击上方按钮按日期时间线切片并提炼摘要。
                        </p>
                    ) : archives.map((a) => (
                        <div key={a.id} className="lm-card">
                            <div className="lm-card-head">
                                <span className="lm-date" style={{ fontWeight: 600 }}>{a.title}</span>
                                {a.keyEvents.map((k) => <span key={k} className="lm-tag">{k}</span>)}
                                <span className="lm-date" style={{ marginLeft: "auto" }}>{a.entryIds.length} 条</span>
                            </div>
                            <div className="lm-summary">{a.summary || "（无摘要）"}</div>
                            <div className="lm-actions">
                                <button className="lm-mini" onClick={async () => {
                                    const s = await generateLoverSummary(`提炼这段恋人记忆：\n${a.summary}`, config).catch(() => null);
                                    if (s) { a.summary = s; a.updatedAt = new Date().toISOString(); await saveLoverMemoryArchive(a); await reload(); notice("已更新摘要"); }
                                    else notice("生成摘要失败，请检查总结模型配置");
                                }}><RefreshCw size={12} /> AI 提炼摘要</button>
                            </div>
                        </div>
                    ))}
                </>
            )}

            {/* 设置 */}
            {tab === "settings" && (
                <>
                    <div className="lm-section-title">硅基流动 API（独立，不混用主聊天）</div>
                    <div className="lm-field">
                        <label>接口地址</label>
                        <input value={config.siliconFlowBaseUrl} onChange={(e) => persistConfig({ ...config, siliconFlowBaseUrl: e.target.value })} placeholder="https://api.siliconflow.cn/v1" />
                    </div>
                    <div className="lm-field">
                        <label>API Key</label>
                        <input type="password" value={config.siliconFlowApiKey} onChange={(e) => persistConfig({ ...config, siliconFlowApiKey: e.target.value })} placeholder="sk-..." />
                    </div>
                    <div className="lm-field">
                        <label>向量模型（语义检索）</label>
                        <input value={config.siliconFlowEmbeddingModel} onChange={(e) => persistConfig({ ...config, siliconFlowEmbeddingModel: e.target.value })} list="lm-emb-models" placeholder="BAAI/bge-large-zh-v1.5" />
                        <datalist id="lm-emb-models">{models.filter((m) => m.isEmbedding).map((m) => <option key={m.id} value={m.id} />)}</datalist>
                    </div>
                    <div className="lm-field">
                        <label>总结模型（提炼摘要）</label>
                        <input value={config.siliconFlowSummaryModel} onChange={(e) => persistConfig({ ...config, siliconFlowSummaryModel: e.target.value })} list="lm-sum-models" placeholder="Qwen/Qwen2.5-7B-Instruct" />
                        <datalist id="lm-sum-models">{models.filter((m) => !m.isEmbedding).map((m) => <option key={m.id} value={m.id} />)}</datalist>
                    </div>
                    <div className="lm-actions">
                        <button className="lm-btn lm-btn-primary" onClick={fetchModels} disabled={fetchingModels}><RefreshCw size={14} /> {fetchingModels ? "拉取中…" : "拉取模型列表"}</button>
                        <button className="lm-btn lm-btn-ghost" onClick={testConn} disabled={testing}><Search size={14} /> 测试连接</button>
                    </div>

                    <div className="lm-section-title" style={{ marginTop: 18 }}>双路召回</div>
                    <div className="lm-row">
                        <div><div className="lm-row-label">语义向量召回</div><div className="lm-row-desc">结合精确关键词与向量语义</div></div>
                        <Toggle checked={config.vectorRecallEnabled} onChange={(v) => persistConfig({ ...config, vectorRecallEnabled: v })} />
                    </div>
                    <div className="lm-row">
                        <div><div className="lm-row-label">聊天自动注入</div><div className="lm-row-desc">相关记忆自动进入上下文（不覆盖人设）</div></div>
                        <Toggle checked={config.autoInjectEnabled} onChange={(v) => persistConfig({ ...config, autoInjectEnabled: v })} />
                    </div>
                    <div className="lm-row">
                        <div><div className="lm-row-label">聊天自动沉淀归档</div><div className="lm-row-desc">聊天时把相关内容实时写入记忆库并按日期归档</div></div>
                        <Toggle checked={config.autoArchiveEnabled} onChange={(v) => persistConfig({ ...config, autoArchiveEnabled: v })} />
                    </div>
                    <div className="lm-row">
                        <div><div className="lm-row-label">定时自动备份</div><div className="lm-row-desc">按间隔生成本地快照（保留最近 10 份）</div></div>
                        <Toggle checked={config.autoBackupEnabled} onChange={(v) => persistConfig({ ...config, autoBackupEnabled: v })} />
                    </div>
                    {config.autoBackupEnabled && (
                        <div className="lm-field" style={{ marginTop: 8 }}>
                            <label>备份间隔：{config.backupIntervalHours} 小时</label>
                            <input className="lm-range" type="range" min={1} max={168} step={1} value={config.backupIntervalHours} onChange={(e) => persistConfig({ ...config, backupIntervalHours: Number(e.target.value) })} />
                        </div>
                    )}
                    <div className="lm-field" style={{ marginTop: 8 }}>
                        <label>召回数量：{config.recallTopK}</label>
                        <input className="lm-range" type="range" min={1} max={20} step={1} value={config.recallTopK} onChange={(e) => persistConfig({ ...config, recallTopK: Number(e.target.value) })} />
                    </div>
                    <div className="lm-field">
                        <label>关键词权重：{config.keywordWeight.toFixed(1)}</label>
                        <input className="lm-range" type="range" min={0} max={1} step={0.05} value={config.keywordWeight} onChange={(e) => persistConfig({ ...config, keywordWeight: Number(e.target.value) })} />
                    </div>
                    <div className="lm-field">
                        <label>向量权重：{config.vectorWeight.toFixed(1)}</label>
                        <input className="lm-range" type="range" min={0} max={1} step={0.05} value={config.vectorWeight} onChange={(e) => persistConfig({ ...config, vectorWeight: Number(e.target.value) })} />
                    </div>
                    <div className="lm-field">
                        <label>注入字数上限：{config.injectTokenBudget}</label>
                        <input className="lm-range" type="range" min={200} max={8000} step={200} value={config.injectTokenBudget} onChange={(e) => persistConfig({ ...config, injectTokenBudget: Number(e.target.value) })} />
                    </div>

                    <div className="lm-section-title" style={{ marginTop: 18 }}>数据</div>
                    <div className="lm-actions">
                        <button className="lm-btn lm-btn-primary" onClick={() => fileRef.current?.click()}><Upload size={14} /> 导入文本/表格</button>
                        <button className="lm-btn lm-btn-ghost" onClick={doExportJson}><Download size={14} /> 导出 JSON</button>
                        <button className="lm-btn lm-btn-ghost" onClick={doExportCsv}><Download size={14} /> 导出表格</button>
                        <input ref={fileRef} type="file" accept=".txt,.csv,.tsv,.json,.xlsx,.xlsm" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ""; }} />
                    </div>

                    <div className="lm-section-title" style={{ marginTop: 18 }}>一键搬家</div>
                    <button className="lm-btn lm-btn-ghost" onClick={() => setShowMoveIn((v) => !v)}>
                        <Sparkles size={14} /> {showMoveIn ? "收起搬家工具" : "从旧小手机导入备份（角色/世界书/聊天/记忆/设定）"}
                    </button>
                    {showMoveIn && <MoveInImport onNotice={onNotice} />}
                </>
            )}

            {/* 角色选择：全局 or 某角色 */}
            <div className="lm-field" style={{ marginTop: 4 }}>
                <label>归属</label>
                <select value={charId} onChange={(e) => { setCharId(e.target.value); setSearchResults(null); setQuery(""); }}
                    style={{ borderRadius: 12, border: "1px solid var(--c-panel-border,rgba(0,0,0,.08))", padding: "9px 11px", fontSize: 13, background: "var(--c-panel,#fff)", color: "var(--c-primary,#222)" }}>
                    <option value="">全部（共享）</option>
                    {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </div>

            {/* 新增/编辑弹窗 */}
            {editing !== null && (
                <ContentDialog
                    title={editing ? "编辑记忆" : "新增记忆"}
                    confirmLabel="保存"
                    onConfirm={commitEdit}
                    onCancel={() => setEditing(null)}
                >
                    <div className="lm-field"><label>日期</label><input type="date" value={editorDate} onChange={(e) => setEditorDate(e.target.value)} /></div>
                    <div className="lm-field"><label>原文</label><textarea rows={4} value={editorContent} onChange={(e) => setEditorContent(e.target.value)} /></div>
                    <div className="lm-field"><label>摘要（可留空，让总结模型生成）</label><textarea rows={2} value={editorSummary} onChange={(e) => setEditorSummary(e.target.value)} /></div>
                    <div className="lm-field"><label>标签（用逗号分隔）</label><input value={editorTags} onChange={(e) => setEditorTags(e.target.value)} /></div>
                </ContentDialog>
            )}

            {/* 合并弹窗 */}
            {merging !== null && (
                <ContentDialog title="合并到哪条记忆？" confirmLabel={undefined} onConfirm={() => setMerging(null)} onCancel={() => setMerging(null)}>
                    <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                        {entries.filter((e) => e.id !== merging.id && !e.mergedInto).map((e) => (
                            <button key={e.id} className="lm-card" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => confirmMerge(e)}>
                                <span className="lm-date">{e.eventDate.slice(0, 10)}</span>
                                <div style={{ fontSize: 12, marginTop: 4 }}>{e.content.slice(0, 60)}…</div>
                            </button>
                        ))}
                    </div>
                </ContentDialog>
            )}

            {/* 导入弹窗 */}
            {importOpen && (
                <ContentDialog title="导入过往记录" confirmLabel={`导入 ${importPreview.length} 条`} onConfirm={commitImport} onCancel={() => { setImportOpen(false); setImportPreview([]); }}>
                    <div className="lm-field">
                        <label>粘贴文本 / CSV / TSV</label>
                        <textarea rows={6} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="粘贴聊天记录，或粘贴 CSV 表格（表头：日期,标签,原文,摘要）" />
                    </div>
                    <button className="lm-btn lm-btn-primary" onClick={handleImportPaste}><Upload size={14} /> 解析预览</button>
                    {importPreview.length > 0 && (
                        <p style={{ fontSize: 12, marginTop: 10, color: "var(--c-secondary,#999)" }}>
                            识别到 {importPreview.length} 条记录，确认后导入。
                        </p>
                    )}
                </ContentDialog>
            )}

            {/* 删除确认 */}
            {confirmDeleteId && (
                <ConfirmDialog
                    title="删除这条记忆？"
                    message="删除后不可恢复。"
                    icon={Trash2}
                    confirmLabel="删除"
                    variant="danger"
                    onConfirm={async () => { await deleteLoverMemoryEntry(confirmDeleteId); setConfirmDeleteId(null); await reload(); notice("已删除"); }}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}

            {/* 清空确认 */}
            {confirmClear && (
                <ConfirmDialog
                    title="清空恋人记忆？"
                    message="将删除当前归属下的所有记忆与归档。"
                    icon={Trash2}
                    confirmLabel="清空"
                    variant="danger"
                    onConfirm={async () => { await clearLoverMemory(charId); setConfirmClear(false); await reload(); notice("已清空"); }}
                    onCancel={() => setConfirmClear(false)}
                />
            )}
        </div>
    );
}
