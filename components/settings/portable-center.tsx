"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AlertTriangle,
    ArchiveRestore,
    Brain,
    Check,
    ChevronDown,
    Database,
    Download,
    Loader2,
    Pin,
    Plus,
    RefreshCw,
    Search,
    Sparkles,
    Trash2,
    Upload,
} from "lucide-react";
import styles from "./portable-center.module.css";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { buildPortableBackup, exportPortableBackup, type ExportProgress } from "@/lib/portable/export";
import { parsePortableBackup, readFileText, restorePortableBackup } from "@/lib/portable/import";
import { detectLegacyBackup, importLegacyBackup, type LegacyImportProgress } from "@/lib/portable/legacy";
import type {
    LegacyBackupPreview,
    LegacyImportResult,
    PortableBackup,
    PortableImportProgress,
    PortableImportResult,
} from "@/lib/portable/types";
import {
    MEMORY_VAULT_CATEGORIES,
    MEMORY_VAULT_MAX_CONTENT,
    memoryVaultCategoryLabel,
    type MemoryVaultCategory,
    type MemoryVaultEntry,
} from "@/lib/memory-vault/types";
import { deleteVaultEntry, listVaultEntries, saveVaultEntry } from "@/lib/memory-vault/storage";
import { invalidateMemoryVaultCache } from "@/lib/memory-vault/injector";

type Tab = "transfer" | "vault";

type Notice = { kind: "ok" | "warn" | "error"; text: string } | null;

type PendingRestore = {
    backup: PortableBackup;
    warnings: string[];
    bytes: number;
};

type PendingLegacy = {
    payload: unknown;
    preview: LegacyBackupPreview;
    bytes: number;
};

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatTime(value?: string): string {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

export function PortableCenter({ onNotice }: { onNotice?: (message: string) => void }) {
    const [tab, setTab] = useState<Tab>("transfer");
    const [notice, setNotice] = useState<Notice>(null);

    // ── 导出 ────────────────────────────────────────────
    const [exporting, setExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
    const [lastExport, setLastExport] = useState<{ name: string; size: number } | null>(null);

    // ── 本机备份导入 ────────────────────────────────────
    const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
    const [importing, setImporting] = useState(false);
    const [importProgress, setImportProgress] = useState<PortableImportProgress | null>(null);
    const [importResult, setImportResult] = useState<PortableImportResult | null>(null);

    // ── 鲸鱼机迁移 ──────────────────────────────────────
    const [pendingLegacy, setPendingLegacy] = useState<PendingLegacy | null>(null);
    const [legacyRunning, setLegacyRunning] = useState(false);
    const [legacyProgress, setLegacyProgress] = useState<LegacyImportProgress | null>(null);
    const [legacyResult, setLegacyResult] = useState<LegacyImportResult | null>(null);

    // ── 记忆库 ──────────────────────────────────────────
    const [characters, setCharacters] = useState<Character[]>([]);
    const [activeCharacterId, setActiveCharacterId] = useState("");
    const [entries, setEntries] = useState<MemoryVaultEntry[]>([]);
    const [vaultLoading, setVaultLoading] = useState(false);
    const [query, setQuery] = useState("");
    const [draft, setDraft] = useState<{
        id?: string;
        category: MemoryVaultCategory;
        content: string;
        weight: number;
        pinned: boolean;
    } | null>(null);
    const [saving, setSaving] = useState(false);

    const importInputRef = useRef<HTMLInputElement | null>(null);
    const legacyInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        const list = loadCharacters();
        setCharacters(list);
        if (list.length > 0) setActiveCharacterId((current) => current || list[0].id);
    }, []);

    const showNotice = useCallback((next: Notice) => {
        setNotice(next);
        if (next?.text) onNotice?.(next.text);
    }, [onNotice]);

    // ── 记忆库加载 ──────────────────────────────────────
    const refreshVault = useCallback(async (characterId: string) => {
        if (!characterId) {
            setEntries([]);
            return;
        }
        setVaultLoading(true);
        try {
            setEntries(await listVaultEntries(characterId));
        } catch (error) {
            showNotice({ kind: "error", text: `读取记忆库失败：${error instanceof Error ? error.message : String(error)}` });
        } finally {
            setVaultLoading(false);
        }
    }, [showNotice]);

    useEffect(() => {
        void refreshVault(activeCharacterId);
    }, [activeCharacterId, refreshVault]);

    const filteredEntries = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        if (!keyword) return entries;
        return entries.filter((entry) =>
            entry.content.toLowerCase().includes(keyword)
            || memoryVaultCategoryLabel(entry.category).includes(keyword));
    }, [entries, query]);

    // ── 导出 ────────────────────────────────────────────
    const runExport = async () => {
        if (exporting) return;
        setExporting(true);
        setNotice(null);
        try {
            const result = await exportPortableBackup(setExportProgress);
            setLastExport({ name: result.filename, size: result.size });
            showNotice({
                kind: "ok",
                text: `已生成 ${result.filename}（${formatBytes(result.size)}），请到浏览器下载列表确认。`,
            });
        } catch (error) {
            showNotice({ kind: "error", text: `导出失败：${error instanceof Error ? error.message : String(error)}` });
        } finally {
            setExporting(false);
            setExportProgress(null);
        }
    };

    // ── 本机备份导入 ────────────────────────────────────
    const pickBackupFile = async (file: File | null | undefined) => {
        if (!file) return;
        setNotice(null);
        setImportResult(null);
        try {
            const text = await readFileText(file);
            const { backup, warnings } = await parsePortableBackup(text);
            setPendingRestore({ backup, warnings, bytes: file.size });
        } catch (error) {
            setPendingRestore(null);
            showNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
        }
    };

    const confirmRestore = async () => {
        if (!pendingRestore || importing) return;
        setImporting(true);
        setImportResult(null);
        try {
            const result = await restorePortableBackup(pendingRestore.backup, setImportProgress);
            setImportResult(result);
            setPendingRestore(null);
            showNotice({
                kind: result.errors.length > 0 ? "warn" : "ok",
                text: `导入完成：${result.records} 条记录、${result.kvKeys} 个键值、${result.localStorageKeys} 个本地存储项。`,
            });
            if (result.errors.length === 0) {
                // 全量替换后内存里的旧缓存必须丢弃，3 秒后自动平滑刷新。
                window.setTimeout(() => window.location.reload(), 3000);
            }
        } catch (error) {
            showNotice({ kind: "error", text: `导入失败：${error instanceof Error ? error.message : String(error)}` });
        } finally {
            setImporting(false);
            setImportProgress(null);
        }
    };

    // ── 鲸鱼机迁移 ──────────────────────────────────────
    const pickLegacyFile = async (file: File | null | undefined) => {
        if (!file) return;
        setNotice(null);
        setLegacyResult(null);
        try {
            const text = await readFileText(file);
            let payload: unknown;
            try {
                payload = JSON.parse(text);
            } catch {
                throw new Error("不是合法的 JSON 文件。");
            }
            const preview = detectLegacyBackup(payload);
            if (!preview) throw new Error("没有识别出鲸鱼机备份结构（缺少 friends / messages / littlephone_ 键）。");
            setPendingLegacy({ payload, preview, bytes: file.size });
            if (file.size > 80 * 1024 * 1024) {
                showNotice({
                    kind: "warn",
                    text: `文件较大（${formatBytes(file.size)}），建议在电脑 Chrome 里导入；手机 WebView 内存不足时可能解析失败。`,
                });
            }
        } catch (error) {
            setPendingLegacy(null);
            showNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
        }
    };

    const confirmLegacy = async () => {
        if (!pendingLegacy || legacyRunning) return;
        setLegacyRunning(true);
        setLegacyResult(null);
        try {
            const result = await importLegacyBackup(pendingLegacy.payload, setLegacyProgress);
            setLegacyResult(result);
            setPendingLegacy(null);
            invalidateMemoryVaultCache();
            showNotice({
                kind: result.errors.length > 0 ? "warn" : "ok",
                text: `迁移完成：角色 ${result.characters}、会话 ${result.sessions}、消息 ${result.messages}、记忆 ${result.memories}。`,
            });
        } catch (error) {
            showNotice({ kind: "error", text: `迁移失败：${error instanceof Error ? error.message : String(error)}` });
        } finally {
            setLegacyRunning(false);
            setLegacyProgress(null);
        }
    };

    // ── 记忆库编辑 ──────────────────────────────────────
    const openDraft = (entry?: MemoryVaultEntry) => {
        setDraft(entry
            ? {
                id: entry.id,
                category: entry.category,
                content: entry.content,
                weight: entry.weight,
                pinned: entry.pinned,
            }
            : {
                category: "identity",
                content: "",
                weight: 70,
                pinned: false,
            });
    };

    const saveDraft = async () => {
        if (!draft || !activeCharacterId) return;
        if (!draft.content.trim()) {
            showNotice({ kind: "warn", text: "记忆内容不能为空。" });
            return;
        }
        setSaving(true);
        try {
            await saveVaultEntry({
                id: draft.id,
                characterId: activeCharacterId,
                category: draft.category,
                content: draft.content.trim(),
                weight: draft.weight,
                pinned: draft.pinned,
            });
            invalidateMemoryVaultCache(activeCharacterId);
            setDraft(null);
            await refreshVault(activeCharacterId);
            showNotice({ kind: "ok", text: "记忆已保存。" });
        } catch (error) {
            showNotice({ kind: "error", text: `保存失败：${error instanceof Error ? error.message : String(error)}` });
        } finally {
            setSaving(false);
        }
    };

    const removeEntry = async (entry: MemoryVaultEntry) => {
        if (!window.confirm(`删除这条记忆？\n\n${entry.content}`)) return;
        try {
            await deleteVaultEntry(entry.id);
            invalidateMemoryVaultCache(activeCharacterId);
            await refreshVault(activeCharacterId);
        } catch (error) {
            showNotice({ kind: "error", text: `删除失败：${error instanceof Error ? error.message : String(error)}` });
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.hero}>
                <div className={styles.heroIcon}>
                    <ArchiveRestore size={22} />
                </div>
                <div>
                    <h1 className={styles.heroTitle}>搬家与记忆</h1>
                    <p className={styles.heroDesc}>整机数据搬运 + 钉进提示词的长期记忆库</p>
                </div>
            </div>

            <div className={styles.tabs}>
                <button
                    type="button"
                    className={`${styles.tab} ${tab === "transfer" ? styles.tabActive : ""}`}
                    onClick={() => setTab("transfer")}
                >
                    <Database size={15} /> 一键搬家
                </button>
                <button
                    type="button"
                    className={`${styles.tab} ${tab === "vault" ? styles.tabActive : ""}`}
                    onClick={() => setTab("vault")}
                >
                    <Brain size={15} /> 记忆库
                </button>
            </div>

            {notice ? (
                <div className={`${styles.notice} ${styles[`notice_${notice.kind}`]}`}>
                    {notice.kind === "ok" ? <Check size={15} /> : <AlertTriangle size={15} />}
                    <span>{notice.text}</span>
                    <button type="button" onClick={() => setNotice(null)} className={styles.noticeClose}>×</button>
                </div>
            ) : null}

            {tab === "transfer" ? (
                <div className={styles.stack}>
                    <section className={styles.card}>
                        <header className={styles.cardHead}>
                            <div>
                                <h2>全量导出</h2>
                                <p>把全部 IndexedDB 数据库、配置键值与 localStorage 打成一份 JSON。</p>
                            </div>
                            <span className={`${styles.badge} ${styles.badgeBlue}`}>备份</span>
                        </header>
                        <ul className={styles.bullets}>
                            <li>包含聊天记录、角色卡、世界书、API 设置、记忆、媒体缓存等全部本地数据。</li>
                            <li>文件名形如 <code>ai_phone_backup_20260101_120000.json</code>，自带校验值。</li>
                        </ul>
                        {exportProgress ? (
                            <div className={styles.progressWrap}>
                                <div className={styles.progressBar}>
                                    <div className={styles.progressFill} style={{ width: `${exportProgress.percent}%` }} />
                                </div>
                                <span>{exportProgress.detail}</span>
                            </div>
                        ) : null}
                        {lastExport ? (
                            <p className={styles.hint}>上次导出：{lastExport.name}（{formatBytes(lastExport.size)}）</p>
                        ) : null}
                        <div className={styles.actions}>
                            <button type="button" className={styles.primary} onClick={runExport} disabled={exporting}>
                                {exporting ? <Loader2 size={15} className={styles.spin} /> : <Download size={15} />}
                                {exporting ? "正在打包…" : "导出全部数据"}
                            </button>
                            <button
                                type="button"
                                className={styles.ghost}
                                onClick={async () => {
                                    try {
                                        const artifact = await buildPortableBackup();
                                        showNotice({
                                            kind: "ok",
                                            text: `预览：${artifact.backup.summary.records} 条记录 / ${artifact.backup.summary.stores} 个仓库 / ${formatBytes(artifact.size)}。`,
                                        });
                                    } catch (error) {
                                        showNotice({ kind: "error", text: `统计失败：${error instanceof Error ? error.message : String(error)}` });
                                    }
                                }}
                                disabled={exporting}
                            >
                                只统计不下载
                            </button>
                        </div>
                    </section>

                    <section className={styles.card}>
                        <header className={styles.cardHead}>
                            <div>
                                <h2>导入本机备份</h2>
                                <p>覆盖写入当前设备，导入完成后需要刷新一次页面。</p>
                            </div>
                            <span className={`${styles.badge} ${styles.badgeRose}`}>覆盖</span>
                        </header>
                        <input
                            ref={importInputRef}
                            type="file"
                            accept=".json,application/json"
                            hidden
                            onChange={(event) => {
                                void pickBackupFile(event.target.files?.[0]);
                                event.target.value = "";
                            }}
                        />
                        <div className={styles.actions}>
                            <button type="button" className={styles.primary} onClick={() => importInputRef.current?.click()} disabled={importing}>
                                <Upload size={15} /> 选择备份文件
                            </button>
                        </div>

                        {pendingRestore ? (
                            <div className={styles.preview}>
                                <div className={styles.previewGrid}>
                                    <div><b>{pendingRestore.backup.summary.records}</b><span>条记录</span></div>
                                    <div><b>{pendingRestore.backup.summary.stores}</b><span>个仓库</span></div>
                                    <div><b>{pendingRestore.backup.summary.kvKeys}</b><span>项配置</span></div>
                                    <div><b>{formatBytes(pendingRestore.bytes)}</b><span>文件大小</span></div>
                                </div>
                                <p className={styles.hint}>
                                    来源：{pendingRestore.backup.origin || "未知"} · 导出时间：{formatTime(pendingRestore.backup.createdAt)}
                                </p>
                                {pendingRestore.warnings.map((warning) => (
                                    <p key={warning} className={styles.warnText}>⚠️ {warning}</p>
                                ))}
                                <div className={styles.actions}>
                                    <button type="button" className={styles.danger} onClick={confirmRestore} disabled={importing}>
                                        {importing ? <Loader2 size={15} className={styles.spin} /> : <ArchiveRestore size={15} />}
                                        {importing ? "正在覆盖写入…" : "确认覆盖导入"}
                                    </button>
                                    <button type="button" className={styles.ghost} onClick={() => setPendingRestore(null)} disabled={importing}>
                                        取消
                                    </button>
                                </div>
                                {importProgress ? (
                                    <div className={styles.progressWrap}>
                                        <div className={styles.progressBar}>
                                            <div className={styles.progressFill} style={{ width: `${importProgress.percent}%` }} />
                                        </div>
                                        <span>{importProgress.detail}</span>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        {importResult ? (
                            <div className={styles.resultBox}>
                                <p className={styles.okText}>✅ 写入完成，请刷新页面让新数据生效。</p>
                                <div className={styles.previewGrid}>
                                    <div><b>{importResult.records}</b><span>条记录</span></div>
                                    <div><b>{importResult.kvKeys}</b><span>项配置</span></div>
                                    <div><b>{importResult.localStorageKeys}</b><span>本地存储</span></div>
                                    <div><b>{importResult.errors.length}</b><span>错误</span></div>
                                </div>
                                {importResult.errors.slice(0, 6).map((error) => (
                                    <p key={error} className={styles.warnText}>{error}</p>
                                ))}
                                <button type="button" className={styles.primary} onClick={() => window.location.reload()}>
                                    <RefreshCw size={15} /> 立即刷新页面
                                </button>
                            </div>
                        ) : null}
                    </section>

                    <section className={styles.card}>
                        <header className={styles.cardHead}>
                            <div>
                                <h2>从鲸鱼机迁移</h2>
                                <p>识别 littlephone / 鲸鱼机 的整份备份，转换角色、聊天记录与记忆。</p>
                            </div>
                            <span className={`${styles.badge} ${styles.badgeAmber}`}>兼容</span>
                        </header>
                        <input
                            ref={legacyInputRef}
                            type="file"
                            accept=".json,application/json"
                            hidden
                            onChange={(event) => {
                                void pickLegacyFile(event.target.files?.[0]);
                                event.target.value = "";
                            }}
                        />
                        <div className={styles.actions}>
                            <button type="button" className={styles.ghost} onClick={() => legacyInputRef.current?.click()} disabled={legacyRunning}>
                                <Upload size={15} /> 选择鲸鱼机备份
                            </button>
                        </div>

                        {pendingLegacy ? (
                            <div className={styles.preview}>
                                <div className={styles.previewGrid}>
                                    <div><b>{pendingLegacy.preview.characters}</b><span>角色</span></div>
                                    <div><b>{pendingLegacy.preview.sessions}</b><span>会话</span></div>
                                    <div><b>{pendingLegacy.preview.messages}</b><span>消息</span></div>
                                    <div><b>{pendingLegacy.preview.memories}</b><span>记忆</span></div>
                                </div>
                                <p className={styles.hint}>
                                    文件 {formatBytes(pendingLegacy.bytes)} · 导出时间 {formatTime(pendingLegacy.preview.exportedAt)}
                                </p>
                                <p className={styles.warnText}>
                                    会新增角色/会话/消息/记忆并绑定聊天 API；世界书、朋友圈、表情包、自定义工具暂不迁移（会列在结果里）。
                                </p>
                                <div className={styles.actions}>
                                    <button type="button" className={styles.primary} onClick={confirmLegacy} disabled={legacyRunning}>
                                        {legacyRunning ? <Loader2 size={15} className={styles.spin} /> : <Sparkles size={15} />}
                                        {legacyRunning ? "正在迁移…" : "开始迁移"}
                                    </button>
                                    <button type="button" className={styles.ghost} onClick={() => setPendingLegacy(null)} disabled={legacyRunning}>
                                        取消
                                    </button>
                                </div>
                                {legacyProgress ? (
                                    <div className={styles.progressWrap}>
                                        <div className={styles.progressBar}>
                                            <div className={styles.progressFill} style={{ width: `${legacyProgress.percent}%` }} />
                                        </div>
                                        <span>{legacyProgress.detail}</span>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        {legacyResult ? (
                            <div className={styles.resultBox}>
                                <p className={styles.okText}>✅ 迁移完成，请刷新页面后到聊天列表查看。</p>
                                <div className={styles.previewGrid}>
                                    <div><b>{legacyResult.characters}</b><span>角色</span></div>
                                    <div><b>{legacyResult.sessions}</b><span>会话</span></div>
                                    <div><b>{legacyResult.messages}</b><span>消息</span></div>
                                    <div><b>{legacyResult.memories}</b><span>记忆</span></div>
                                </div>
                                {legacyResult.skipped.map((item) => (
                                    <p key={item} className={styles.warnText}>· {item}</p>
                                ))}
                                {legacyResult.errors.map((error) => (
                                    <p key={error} className={styles.warnText}>❌ {error}</p>
                                ))}
                                <button type="button" className={styles.primary} onClick={() => window.location.reload()}>
                                    <RefreshCw size={15} /> 刷新页面
                                </button>
                            </div>
                        ) : null}
                    </section>
                </div>
            ) : (
                <div className={styles.stack}>
                    <section className={styles.card}>
                        <header className={styles.cardHead}>
                            <div>
                                <h2>记忆库</h2>
                                <p>置顶条目会永远排在 System Prompt 的最前面，不参与上下文滑窗。</p>
                            </div>
                            <span className={`${styles.badge} ${styles.badgeViolet}`}>{entries.length} 条</span>
                        </header>

                        <div className={styles.toolbar}>
                            <label className={styles.select}>
                                <select value={activeCharacterId} onChange={(event) => setActiveCharacterId(event.target.value)}>
                                    {characters.length === 0 ? <option value="">还没有角色</option> : null}
                                    {characters.map((character) => (
                                        <option key={character.id} value={character.id}>{character.name}</option>
                                    ))}
                                </select>
                                <ChevronDown size={14} />
                            </label>
                            <label className={styles.search}>
                                <Search size={14} />
                                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索记忆内容" />
                            </label>
                            <button type="button" className={styles.primary} onClick={() => openDraft()} disabled={!activeCharacterId}>
                                <Plus size={15} /> 新增
                            </button>
                        </div>

                        {draft ? (
                            <div className={styles.editor}>
                                <div className={styles.chips}>
                                    {MEMORY_VAULT_CATEGORIES.map((category) => (
                                        <button
                                            key={category.id}
                                            type="button"
                                            className={`${styles.chip} ${draft.category === category.id ? styles.chipActive : ""}`}
                                            style={draft.category === category.id ? { borderColor: category.color, color: category.color } : undefined}
                                            onClick={() => setDraft({ ...draft, category: category.id })}
                                        >
                                            {category.label}
                                        </button>
                                    ))}
                                </div>
                                <textarea
                                    className={styles.textarea}
                                    maxLength={MEMORY_VAULT_MAX_CONTENT}
                                    value={draft.content}
                                    placeholder="例如：用户真名是冬雨，喜欢被叫「冬酱」，讨厌被敷衍。"
                                    onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                                />
                                <div className={styles.editorRow}>
                                    <label className={styles.range}>
                                        权重 {draft.weight}
                                        <input
                                            type="range"
                                            min={0}
                                            max={100}
                                            value={draft.weight}
                                            onChange={(event) => setDraft({ ...draft, weight: Number(event.target.value) })}
                                        />
                                    </label>
                                    <label className={styles.checkbox}>
                                        <input
                                            type="checkbox"
                                            checked={draft.pinned}
                                            onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })}
                                        />
                                        置顶
                                    </label>
                                    <span className={styles.counter}>{draft.content.length}/{MEMORY_VAULT_MAX_CONTENT}</span>
                                </div>
                                <div className={styles.actions}>
                                    <button type="button" className={styles.primary} onClick={saveDraft} disabled={saving}>
                                        {saving ? <Loader2 size={15} className={styles.spin} /> : <Check size={15} />} 保存
                                    </button>
                                    <button type="button" className={styles.ghost} onClick={() => setDraft(null)} disabled={saving}>取消</button>
                                </div>
                            </div>
                        ) : null}

                        {vaultLoading ? (
                            <p className={styles.hint}><Loader2 size={14} className={styles.spin} /> 正在读取…</p>
                        ) : filteredEntries.length === 0 ? (
                            <div className={styles.empty}>
                                <Brain size={26} />
                                <p>还没有记忆。把姓名、称呼、约定、纪念日写进来，角色就不会忘。</p>
                            </div>
                        ) : (
                            <ul className={styles.list}>
                                {filteredEntries.map((entry) => (
                                    <li key={entry.id} className={styles.item}>
                                        <div className={styles.itemTop}>
                                            <span className={styles.catTag} style={{ color: categoryColor(entry.category) }}>
                                                {entry.pinned ? <Pin size={12} /> : null}
                                                {memoryVaultCategoryLabel(entry.category)}
                                            </span>
                                            <span className={styles.weight}>{entry.weight}</span>
                                        </div>
                                        <p className={styles.itemText}>{entry.content}</p>
                                        <div className={styles.itemFoot}>
                                            <span>{formatTime(entry.updatedAt)}</span>
                                            <div className={styles.itemActions}>
                                                <button type="button" onClick={() => openDraft(entry)}>编辑</button>
                                                <button type="button" onClick={() => void removeEntry(entry)} className={styles.delBtn}>
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}

function categoryColor(category: MemoryVaultCategory): string {
    return MEMORY_VAULT_CATEGORIES.find((item) => item.id === category)?.color ?? "#7b8794";
}
