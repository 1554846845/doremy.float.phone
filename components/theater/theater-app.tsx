"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Clapperboard, Smartphone, Sparkles, Play, Send,
    Plus, X, Settings2, Moon, Sun, Link2, PenLine, Gift,
} from "lucide-react";
import { Toggle } from "@/components/ui/form";
import { loadCharacters } from "@/lib/character-storage";
import type { TheaterConfig, TheaterStory, TheaterStoryKind } from "@/lib/theater-types";
import { DEFAULT_THEATER_CONFIG } from "@/lib/theater-types";
import {
    loadTheaterConfig, saveTheaterConfig, loadTheaterStories, saveTheaterStory, deleteTheaterStory,
    loadTheaterNotes, saveTheaterNote, loadTheaterDailyQuestionByDate, saveTheaterDailyQuestion, makeId,
} from "@/lib/theater-storage";
import { generateTheaterStoryStream, generateTheaterInspiration, continueTheaterStory, generateDailyQuestion, applyForbiddenWords } from "@/lib/theater-engine";
import { sendBrowserNotification } from "@/lib/browser-notification";
import { TheaterReader } from "@/components/theater/theater-reader";

type Tab = "theater" | "pickup";

// 一键转入主聊天：写草稿 + 切到聊天，由 chat-room 监听事件回填输入框。
export function transferToChat(text: string): void {
    if (typeof window === "undefined") return;
    const clean = text.trim();
    if (!clean) return;
    window.dispatchEvent(new CustomEvent("theater-transfer-to-chat", { detail: { text: clean } }));
    window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "chat" } }));
}

const STYLE = `
.tt { display:flex; flex-direction:column; gap:14px; padding:14px 14px 56px; min-height:100%;
  --tt-ink: #111; --tt-paper: #fff; --tt-muted: #888; --tt-line: #e6e6e6; --tt-accent: #111;
  background:var(--tt-paper); color:var(--tt-ink); font-family:Georgia,"Songti SC","Noto Serif SC",serif; }
.tt[data-dark="true"] { --tt-ink:#f2f2f2; --tt-paper:#0e0e0e; --tt-muted:#8a8a8a; --tt-line:#262626; --tt-accent:#f2f2f2; }
.tt-masthead { display:flex; align-items:flex-end; justify-content:space-between; border-bottom:2px solid var(--tt-ink); padding-bottom:10px; }
.tt-masthead h1 { font-size:30px; letter-spacing:2px; margin:0; font-weight:900; }
.tt-masthead small { font-size:11px; letter-spacing:3px; color:var(--tt-muted); text-transform:uppercase; }
.tt-issue { font-size:10px; letter-spacing:2px; color:var(--tt-muted); border:1px solid var(--tt-line); padding:2px 8px; }
.tt-tabs { display:flex; border-bottom:1px solid var(--tt-line); }
.tt-tab { flex:1; display:flex; align-items:center; justify-content:center; gap:6px; padding:12px 4px;
  background:transparent; border:none; cursor:pointer; color:var(--tt-muted); font-size:14px; letter-spacing:2px;
  border-bottom:2px solid transparent; font-family:inherit; }
.tt-tab[data-active="true"] { color:var(--tt-ink); border-bottom-color:var(--tt-ink); font-weight:700; }
.tt-label { font-size:10px; letter-spacing:2px; text-transform:uppercase; color:var(--tt-muted); margin:2px 0 6px; }
.tt-input, .tt-textarea { width:100%; background:transparent; border:1px solid var(--tt-line); color:var(--tt-ink);
  padding:10px 12px; font-size:14px; border-radius:0; font-family:inherit; resize:vertical; }
.tt-input:focus, .tt-textarea:focus { outline:none; border-color:var(--tt-ink); }
.tt-chips { display:flex; flex-wrap:wrap; gap:6px; }
.tt-chip { display:inline-flex; align-items:center; gap:4px; padding:6px 10px; font-size:12px;
  border:1px solid var(--tt-line); color:var(--tt-muted); background:transparent; cursor:pointer; font-family:inherit; }
.tt-chip[data-on="true"] { background:var(--tt-ink); color:var(--tt-paper); border-color:var(--tt-ink); }
.tt-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:11px 14px;
  font-size:13px; cursor:pointer; border:1px solid var(--tt-ink); background:var(--tt-ink); color:var(--tt-paper);
  font-family:inherit; letter-spacing:1px; }
.tt-btn[data-ghost="true"] { background:transparent; color:var(--tt-ink); }
.tt-btn:disabled { opacity:.4; cursor:not-allowed; }
.tt-toolbar { display:flex; flex-wrap:wrap; gap:8px; }
.tt-footer { border-top:2px solid var(--tt-ink); margin-top:6px; padding-top:12px; display:flex; flex-direction:column; gap:10px; }
.tt-row { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.tt-row-label { font-size:13px; }
.tt-row-desc { font-size:11px; color:var(--tt-muted); }
.tt-note-card { border:1px solid var(--tt-line); padding:12px 14px; font-size:13px; }
.tt-note-date { font-size:10px; letter-spacing:1px; color:var(--tt-muted); margin-top:6px; }
.tt-dialog-back { position:fixed; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; z-index:200; }
.tt-dialog { background:var(--tt-paper); color:var(--tt-ink); border:1px solid var(--tt-line); width:min(92vw,460px); padding:18px; display:flex; flex-direction:column; gap:12px; }
.tt-error { display:flex; align-items:flex-start; gap:8px; padding:10px 12px; border:1px solid #c2410c;
  background:#fff1f2; color:#c2410c; font-size:12.5px; line-height:1.6; word-break:break-word; }
.tt[data-dark="true"] .tt-error { border-color:#fca5a5; background:#2a1214; color:#fca5a5; }
.tt-error span { flex:1; min-width:0; }
.tt-error button { flex:0 0 auto; border:none; background:transparent; color:inherit; cursor:pointer; font-size:15px; padding:0 2px; }
`;

export function TheaterApp({ onNotice }: { onNotice?: (msg: string) => void }) {
    const [tab, setTab] = useState<Tab>("theater");
    const [config, setConfig] = useState<TheaterConfig>(() => loadTheaterConfig());
    const [charId, setCharId] = useState("");
    const [stories, setStories] = useState<TheaterStory[]>([]);

    // 生成参数
    const [idea, setIdea] = useState("");
    const [tone, setTone] = useState("");
    const [person, setPerson] = useState("");
    const [styleId, setStyleId] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [newTag, setNewTag] = useState("");

    const [output, setOutput] = useState("");
    const [generating, setGenerating] = useState(false);
    const [currentStory, setCurrentStory] = useState<TheaterStory | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // 独立剧情阅读页：点「开始生成」后跳转过去流式渲染，不再挤在配置表单里。
    const [view, setView] = useState<"form" | "reader">("form");
    const [readerTitle, setReaderTitle] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [readerSaved, setReaderSaved] = useState(false);

    // 小纸条 / 每日一问
    const [noteOpen, setNoteOpen] = useState(false);
    const [noteText, setNoteText] = useState("");
    const [notes, setNotes] = useState<Awaited<ReturnType<typeof loadTheaterNotes>>>([]);
    const [todayQuestion, setTodayQuestion] = useState("");

    const chars = useMemo(() => loadCharacters(), []);
    const activeCharId = charId || chars[0]?.id || "";

    const notice = useCallback((m: string) => onNotice?.(m), [onNotice]);

    const reloadStories = useCallback(async () => {
        setStories(await loadTheaterStories(activeCharId));
        setNotes(await loadTheaterNotes());
    }, [activeCharId]);

    useEffect(() => { reloadStories(); }, [reloadStories]);
    useEffect(() => { setCharId(chars[0]?.id ?? ""); }, [chars]);
    useEffect(() => {
        const today = new Date().toISOString().slice(0, 10);
        void loadTheaterDailyQuestionByDate(today).then((q) => setTodayQuestion(q?.question ?? ""));
    }, []);

    const persistConfig = useCallback((next: TheaterConfig) => {
        setConfig(next);
        saveTheaterConfig(next);
    }, []);

    const spec = tab === "pickup" ? config.pickupSpec : config.theaterSpec;
    const setSpec = (partial: Partial<typeof spec>) => {
        const next: TheaterConfig = tab === "pickup"
            ? { ...config, pickupSpec: { ...config.pickupSpec, ...partial } }
            : { ...config, theaterSpec: { ...config.theaterSpec, ...partial } };
        persistConfig(next);
    };

    const forbidden = spec.forbiddenWords;

    const stop = () => abortRef.current?.abort();

    const runGenerate = async (withIdea?: string) => {
        if (generating) return;
        const kind: TheaterStoryKind = tab;
        const title = (withIdea ?? idea).trim().slice(0, 24) || "未命名";
        setGenerating(true);
        setError(null);
        setCurrentStory(null);
        setOutput("");
        setReaderSaved(false);
        setReaderTitle(title);
        setView("reader");
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const full = await generateTheaterStoryStream(config, {
                characterId: activeCharId,
                kind,
                idea: withIdea ?? idea,
                tone,
                person,
                styleId,
                tags: selectedTags,
                onDelta: (t) => setOutput((prev) => prev + t),
                signal: controller.signal,
            });
            setOutput(full);
            const now = new Date().toISOString();
            const story: TheaterStory = {
                id: makeId("tt"),
                characterId: activeCharId,
                kind,
                title,
                content: full,
                tone,
                person,
                styleId,
                tags: selectedTags,
                idea: (withIdea ?? idea).trim(),
                createdAt: now,
                updatedAt: now,
                favorite: false,
            };
            await saveTheaterStory(story);
            setCurrentStory(story);
            setReaderSaved(true);
            await reloadStories();
        } catch (e) {
            if (controller.signal.aborted) {
                // 用户主动停止：保留已流出的部分内容，不弹错误。
            } else {
                const msg = e instanceof Error ? e.message : String(e || "生成失败");
                setError(msg);
                notice(msg);
            }
        } finally {
            setGenerating(false);
            abortRef.current = null;
        }
    };

    const runInspiration = async () => {
        if (generating) return;
        setGenerating(true);
        setError(null);
        try {
            const ideaText = await generateTheaterInspiration(activeCharId, (t) => setIdea((prev) => prev + t));
            setIdea(ideaText);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "灵感生成失败";
            setError(msg);
            notice(msg);
        } finally {
            setGenerating(false);
        }
    };

    const runContinue = async () => {
        if (generating || !currentStory) return;
        setGenerating(true);
        setError(null);
        setReaderSaved(false);
        setReaderTitle(currentStory.title || "未命名");
        setView("reader");
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const more = await continueTheaterStory(currentStory, config, activeCharId, (t) => setOutput((prev) => prev + t), controller.signal);
            const full = (currentStory.content + "\n\n" + more).trim();
            setOutput(full);
            const updated: TheaterStory = { ...currentStory, content: full, updatedAt: new Date().toISOString() };
            await saveTheaterStory(updated);
            setCurrentStory(updated);
            setReaderSaved(true);
            await reloadStories();
        } catch (e) {
            if (controller.signal.aborted) {
                // 用户主动停止：保留已流出的部分内容，不弹错误。
            } else {
                const msg = e instanceof Error ? e.message : String(e || "续写失败");
                setError(msg);
                notice(msg);
            }
        } finally {
            setGenerating(false);
            abortRef.current = null;
        }
    };

    const toggleFavorite = async (story: TheaterStory) => {
        const updated = { ...story, favorite: !story.favorite, updatedAt: new Date().toISOString() };
        await saveTheaterStory(updated);
        if (currentStory?.id === story.id) setCurrentStory(updated);
        await reloadStories();
    };

    const toggleCurrentFavorite = async () => {
        if (!currentStory) return;
        await toggleFavorite(currentStory);
    };

    const transferCurrentToChat = () => {
        if (!currentStory) return;
        transferToChat(currentStory.content);
    };

    const backFromReader = () => {
        if (generating) abortRef.current?.abort();
        setView("form");
    };

    const openReader = (story: TheaterStory) => {
        setTab(story.kind);
        setOutput(story.content);
        setCurrentStory(story);
        setIdea(story.idea);
        setTone(story.tone ?? "");
        setPerson(story.person ?? "");
        setStyleId(story.styleId ?? "");
        setReaderTitle(story.title || "未命名");
        setReaderSaved(true);
        setError(null);
        setView("reader");
    };

    const saveCurrentStory = async () => {
        if (generating) return;
        if (!output.trim()) { notice("没有可保存的正文"); return; }
        const kind: TheaterStoryKind = currentStory?.kind ?? tab;
        const now = new Date().toISOString();
        const story: TheaterStory = currentStory
            ? { ...currentStory, content: output, updatedAt: now }
            : {
                id: makeId("tt"),
                characterId: activeCharId,
                kind,
                title: readerTitle || idea.trim().slice(0, 24) || "未命名",
                content: output,
                tone,
                person,
                styleId,
                tags: selectedTags,
                idea: idea.trim(),
                createdAt: now,
                updatedAt: now,
                favorite: false,
            };
        await saveTheaterStory(story);
        setCurrentStory(story);
        setReaderSaved(true);
        await reloadStories();
        notice("已保存记录");
    };

    const addTag = () => {
        const t = newTag.trim();
        if (!t) return;
        if (!config.tags.some((x) => x.label === t)) {
            const id = `tag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            persistConfig({ ...config, tags: [...config.tags, { id, label: t }] });
            setSelectedTags((prev) => [...prev, id]);
        }
        setNewTag("");
    };

    const toggleTag = (id: string) => {
        setSelectedTags((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
    };

    const sendNote = async () => {
        const text = noteText.trim();
        if (!text) { notice("小纸条内容不能为空"); return; }
        await saveTheaterNote({ id: makeId("tn"), content: text, createdAt: new Date().toISOString(), delivered: true });
        setNoteText("");
        setNoteOpen(false);
        await reloadStories();
        sendBrowserNotification("收到一张小纸条", { body: text });
        notice("小纸条已递出（离线推送/桌面组件可读）");
    };

    const sendDailyQuestion = async () => {
        setError(null);
        try {
            const q = await generateDailyQuestion(activeCharId);
            const date = new Date().toISOString().slice(0, 10);
            await saveTheaterDailyQuestion({ id: makeId("tq"), question: q, date, delivered: true });
            setTodayQuestion(q);
            sendBrowserNotification("每日一问", { body: q });
            notice("每日一问已递出");
        } catch (e) {
            const msg = e instanceof Error ? e.message : "每日一问生成失败";
            setError(msg);
            notice(msg);
        }
    };

    if (view === "reader") {
        return (
            <TheaterReader
                title={readerTitle || currentStory?.title || "未命名"}
                kind={currentStory?.kind ?? tab}
                content={output}
                generating={generating}
                saved={readerSaved}
                favorite={currentStory?.favorite ?? false}
                error={error}
                dark={config.darkMode}
                onBack={backFromReader}
                onSave={saveCurrentStory}
                onStop={stop}
                onContinue={runContinue}
                onToggleFavorite={toggleCurrentFavorite}
                onTransfer={transferCurrentToChat}
                onDismissError={() => setError(null)}
            />
        );
    }

    return (
        <>
            <style>{STYLE}</style>
            <div className="tt" data-dark={config.darkMode}>
                {/* 刊头 */}
                <div className="tt-masthead">
                    <div>
                        <h1>小剧场</h1>
                        <small>LOVER'S THEATER · 独立互动杂志</small>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span className="tt-issue">NO.{new Date().getFullYear()}</span>
                        <button className="tt-chip" onClick={() => persistConfig({ ...config, darkMode: !config.darkMode })} title="夜间模式">
                            {config.darkMode ? <Sun size={14} /> : <Moon size={14} />}
                        </button>
                    </div>
                </div>

                {/* 页签 */}
                <div className="tt-tabs">
                    <button className="tt-tab" data-active={tab === "theater"} onClick={() => setTab("theater")}><Clapperboard size={15} /> 小剧场</button>
                    <button className="tt-tab" data-active={tab === "pickup"} onClick={() => setTab("pickup")}><Smartphone size={15} /> 捡手机</button>
                </div>

                {/* 顶部标签（情侣问卷等，可自定义） */}
                <div>
                    <div className="tt-label">顶部标签 · 情侣问卷</div>
                    <div className="tt-chips">
                        {config.tags.map((t) => (
                            <button key={t.id} className="tt-chip" data-on={selectedTags.includes(t.id)} onClick={() => toggleTag(t.id)}>{t.label}</button>
                        ))}
                        <span className="tt-chips" style={{ gap: 4 }}>
                            <input className="tt-input" style={{ width: 90, padding: "6px 8px", fontSize: 12 }} placeholder="自定义标签" value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} />
                            <button className="tt-chip" onClick={addTag}><Plus size={13} /></button>
                        </span>
                    </div>
                </div>

                {/* 灵感梗 */}
                <div>
                    <div className="tt-label">灵感梗</div>
                    <textarea className="tt-textarea" rows={2} placeholder="手动输入一个梗，或一键结合近期聊天记录生成" value={idea} onChange={(e) => setIdea(e.target.value)} />
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <button className="tt-btn" data-ghost onClick={runInspiration} disabled={generating}><Sparkles size={14} /> 结合近期聊天生成灵感</button>
                    </div>
                </div>

                {/* 基调 / 人称 / 文风 */}
                <div className="tt-row" style={{ flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 120 }}>
                        <div className="tt-label">基调</div>
                        <div className="tt-chips">
                            {config.tones.map((t) => <button key={t.id} className="tt-chip" data-on={tone === t.id} onClick={() => setTone(t.id)}>{t.label}</button>)}
                        </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 120 }}>
                        <div className="tt-label">人称</div>
                        <div className="tt-chips">
                            {config.persons.map((p) => <button key={p.id} className="tt-chip" data-on={person === p.id} onClick={() => setPerson(p.id)}>{p.label}</button>)}
                        </div>
                    </div>
                </div>
                <div>
                    <div className="tt-label">文风模板</div>
                    <div className="tt-chips">
                        {config.styleTemplates.map((s) => <button key={s.id} className="tt-chip" data-on={styleId === s.id} onClick={() => setStyleId(s.id)}>{s.name}</button>)}
                    </div>
                </div>

                {/* 写作规范（独立） */}
                <div>
                    <div className="tt-row"><span className="tt-label" style={{ margin: 0 }}>{tab === "pickup" ? "捡手机写作规范（独立）" : "小剧场写作规范（独立）"}</span></div>
                    <textarea className="tt-textarea" rows={2} placeholder="自定义提示词（追加在系统提示词之后）" value={spec.customPrompt} onChange={(e) => setSpec({ customPrompt: e.target.value })} />
                    <input className="tt-input" style={{ marginTop: 8 }} placeholder="禁词规则（用逗号分隔，如：分手,渣男）" value={spec.forbiddenWords.join(",")} onChange={(e) => setSpec({ forbiddenWords: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })} />
                </div>

                {/* 错误提示 */}
                {error && (
                    <div className="tt-error" role="alert">
                        <span>{error}</span>
                        <button onClick={() => setError(null)} aria-label="关闭">×</button>
                    </div>
                )}

                {/* 生成按钮 */}
                <div className="tt-toolbar">
                    <button className="tt-btn" onClick={() => runGenerate()} disabled={generating}><Play size={15} /> 开始生成</button>
                </div>

                {/* 收藏列表 */}
                {stories.filter((s) => s.favorite).length > 0 && (
                    <div>
                        <div className="tt-label">我的收藏</div>
                        {stories.filter((s) => s.favorite).slice(0, 6).map((s) => (
                            <div key={s.id} className="tt-note-card" style={{ marginBottom: 8 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                    <b style={{ fontSize: 13 }}>{s.title}</b>
                                    <span style={{ display: "flex", gap: 6 }}>
                                        <button className="tt-chip" onClick={() => openReader(s)}>查看</button>
                                        <button className="tt-chip" onClick={() => toggleFavorite(s)}><X size={12} /></button>
                                    </span>
                                </div>
                                <div style={{ fontSize: 12, color: "var(--tt-muted)", marginTop: 6 }}>{s.content.slice(0, 80)}…</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* 底部：连着主线 + 写小纸条 + 每日一问 */}
                <div className="tt-footer">
                    <div className="tt-row">
                        <div>
                            <div className="tt-row-label"><Link2 size={13} style={{ verticalAlign: "-2px" }} /> 连着主线</div>
                            <div className="tt-row-desc">开启后，聊天主线可读取小剧场剧情</div>
                        </div>
                        <Toggle checked={config.linkToMain} onChange={(v) => persistConfig({ ...config, linkToMain: v })} />
                    </div>
                    <div className="tt-toolbar">
                        <button className="tt-btn" data-ghost onClick={() => setNoteOpen(true)}><PenLine size={14} /> 写小纸条</button>
                        <button className="tt-btn" data-ghost onClick={sendDailyQuestion}><Gift size={14} /> 每日一问</button>
                    </div>
                    {todayQuestion && <div className="tt-note-card">今日一问：{todayQuestion}</div>}
                    {notes.length > 0 && (
                        <div>
                            <div className="tt-label">最近小纸条</div>
                            {notes.slice(0, 3).map((n) => (
                                <div key={n.id} className="tt-note-card" style={{ marginBottom: 6 }}>
                                    {n.content}
                                    <div className="tt-note-date">{n.createdAt.slice(0, 16).replace("T", " ")}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 写小纸条弹窗 */}
                {noteOpen && (
                    <div className="tt-dialog-back" onClick={() => setNoteOpen(false)}>
                        <div className="tt-dialog" onClick={(e) => e.stopPropagation()}>
                            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>写小纸条</div>
                            <textarea className="tt-textarea" rows={4} placeholder="写一句想递给对方的话…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                            <div className="tt-toolbar" style={{ justifyContent: "flex-end" }}>
                                <button className="tt-btn" data-ghost onClick={() => setNoteOpen(false)}>取消</button>
                                <button className="tt-btn" onClick={sendNote}><Send size={14} /> 递出</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
