"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HelpCircle, Send, Trash2, Sparkles, RefreshCw } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import {
    type QaBoxItem, type QaBoxDirection,
    loadQaBoxItems, saveQaBoxItem, deleteQaBoxItem, newQaBoxId,
} from "@/lib/qabox-module";
import { streamChat } from "@/lib/interactive-llm";

const STYLE = `
.qb { display:flex; flex-direction:column; gap:12px; padding:14px 14px 48px; }
.qb-hero { border-radius:20px; padding:18px 16px; color:#fff;
  background:linear-gradient(135deg,#6c9cff 0%,#7c6cf6 100%); box-shadow:0 8px 24px rgba(108,156,255,.25); }
.qb-hero h2 { margin:0 0 4px; font-size:20px; }
.qb-hero p { margin:0; opacity:.92; font-size:12px; }
.qb-tabs { display:flex; gap:8px; }
.qb-tab { flex:1; border:1px solid var(--c-panel-border,rgba(0,0,0,.08)); border-radius:14px; padding:10px 6px;
  font-size:12px; color:var(--c-secondary,#888); background:transparent; cursor:pointer; }
.qb-tab[data-active="true"] { color:#fff; border-color:transparent; background:linear-gradient(135deg,#6c9cff,#7c6cf6); }
.qb-card { border-radius:16px; padding:12px 14px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08)); background:var(--c-panel,#fff); }
.qb-label { font-size:11px; letter-spacing:1px; color:var(--c-secondary,#999); text-transform:uppercase; margin:2px 0 6px; }
.qb-textarea { width:100%; border-radius:14px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08));
  padding:10px 12px; font-size:13px; background:var(--c-panel,#fff); color:var(--c-primary,#222); resize:vertical; }
.qb-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:11px 14px; border-radius:14px;
  font-size:13px; font-weight:600; cursor:pointer; border:none; color:#fff; background:linear-gradient(135deg,#6c9cff,#7c6cf6); }
.qb-btn:disabled { opacity:.5; cursor:not-allowed; }
.qb-ghost { display:inline-flex; align-items:center; gap:4px; padding:6px 10px; font-size:12px; border-radius:999px;
  border:1px solid var(--c-panel-border,rgba(0,0,0,.08)); color:var(--c-secondary,#888); background:transparent; cursor:pointer; }
.qb-answer { border-radius:14px; padding:12px 14px; background:linear-gradient(180deg,rgba(108,156,255,.12),rgba(124,108,246,.08)); font-size:14px; line-height:1.7; white-space:pre-wrap; }
.qb-guess { display:inline-flex; border-radius:999px; padding:3px 10px; font-size:11px; background:rgba(124,108,246,.16); color:#6d5ce0; }
.qb-cursor { display:inline-block; width:7px; height:15px; background:#6c9cff; vertical-align:text-bottom; animation:qbblink 1s steps(2,start) infinite; }
@keyframes qbblink { to { visibility:hidden; } }
.qb-q { font-size:14px; font-weight:600; margin:0 0 6px; }
.qb-date { font-size:11px; color:var(--c-secondary,#999); }
`;

const PAGE_SIZE = 10;

export function QaBoxApp({ onNotice }: { onNotice?: (msg: string) => void }) {
    const [tab, setTab] = useState<QaBoxDirection>("user_to_char");
    const [question, setQuestion] = useState("");
    const [items, setItems] = useState<QaBoxItem[]>([]);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [active, setActive] = useState<QaBoxItem | null>(null);
    const [generating, setGenerating] = useState(false);
    const [answerDraft, setAnswerDraft] = useState("");
    const [charId, setCharId] = useState("");

    const chars = useMemo(() => loadCharacters(), []);
    const activeCharId = charId || chars[0]?.id || "";

    const reload = useCallback(async () => {
        setItems(await loadQaBoxItems(activeCharId));
    }, [activeCharId]);

    useEffect(() => { setCharId(chars[0]?.id ?? ""); }, [chars]);
    useEffect(() => { reload(); }, [reload]);
    useEffect(() => { setVisibleCount(PAGE_SIZE); }, [tab, activeCharId]);

    const askChar = async () => {
        const q = question.trim();
        if (!q || generating) return;
        setGenerating(true);
        setActive(null);
        const item: QaBoxItem = { id: newQaBoxId(), characterId: activeCharId, direction: "user_to_char", question: q, createdAt: new Date().toISOString() };
        try {
            const system = "你是被匿名提问的恋人。请结合人设，真诚地回答这个匿名问题，并在结尾用一行「我猜：…」猜猜是谁问的。";
            const full = await streamChat(activeCharId, system, q, {
                appId: "qabox",
                onDelta: (t) => setActive((prev) => prev ? { ...prev, answer: (prev.answer ?? "") + t } : { ...item, answer: t }),
            });
            const guessMatch = full.match(/我猜[:：]\s*(.{1,40})/);
            const final: QaBoxItem = { ...item, answer: full.replace(/我猜[:：].*/s, "").trim(), guess: guessMatch ? guessMatch[1].trim() : "", answeredAt: new Date().toISOString() };
            await saveQaBoxItem(final);
            setActive(final);
            setQuestion("");
            await reload();
        } catch (e) {
            onNotice?.(e instanceof Error ? e.message : "提问失败");
        } finally {
            setGenerating(false);
        }
    };

    const charAsk = async () => {
        if (generating) return;
        setGenerating(true);
        const item: QaBoxItem = { id: newQaBoxId(), characterId: activeCharId, direction: "char_to_user", question: "", createdAt: new Date().toISOString() };
        setActive(item);
        try {
            const system = "你正在匿名给恋人投递一个问题。请出一个有温度、能让人想回答的问题。直接给问题，不要解释。";
            const q = await streamChat(activeCharId, system, "给我一个你想问对方的问题。", {
                appId: "qabox",
                onDelta: (t) => setActive((prev) => prev ? { ...prev, question: (prev.question ?? "") + t } : { ...item, question: t }),
            });
            const final: QaBoxItem = { ...item, question: q };
            await saveQaBoxItem(final);
            setActive(final);
            await reload();
        } catch (e) {
            onNotice?.(e instanceof Error ? e.message : "投递失败");
        } finally {
            setGenerating(false);
        }
    };

    const answerCharQuestion = async () => {
        const target = active;
        if (!target || generating) return;
        const a = answerDraft.trim();
        if (!a) { onNotice?.("先写下你的回答"); return; }
        setGenerating(true);
        try {
            const system = "恋人回答了你之前匿名投递的问题。请结合人设给出回应，并在结尾用一行「我猜：…」猜猜对方当时的身份/心情。";
            const full = await streamChat(activeCharId, system, `我匿名问：「${target.question}」\nTA 的回答：「${a}」`, {
                appId: "qabox",
                onDelta: (t) => setActive((prev) => prev ? { ...prev, answer: (prev.answer ?? "") + t } : prev),
            });
            const guessMatch = full.match(/我猜[:：]\s*(.{1,40})/);
            const final: QaBoxItem = { ...target, answer: `${a}\n\n——\n${full.replace(/我猜[:：].*/s, "").trim()}`, guess: guessMatch ? guessMatch[1].trim() : "", answeredAt: new Date().toISOString() };
            await saveQaBoxItem(final);
            setActive(final);
            setAnswerDraft("");
            await reload();
        } catch (e) {
            onNotice?.(e instanceof Error ? e.message : "回答失败");
        } finally {
            setGenerating(false);
        }
    };

    const list = items.filter((i) => i.direction === tab);

    return (
        <>
            <style>{STYLE}</style>
            <div className="qb">
                <div className="qb-hero">
                    <h2>双向匿名问答箱</h2>
                    <p>互相匿名提问、作答、猜身份，坦诚又好玩。</p>
                </div>

                <div className="qb-tabs">
                    <button className="qb-tab" data-active={tab === "user_to_char"} onClick={() => setTab("user_to_char")}>我问 TA</button>
                    <button className="qb-tab" data-active={tab === "char_to_user"} onClick={() => setTab("char_to_user")}>TA 问我</button>
                </div>

                {tab === "user_to_char" ? (
                    <div className="qb-card">
                        <div className="qb-label">匿名提问</div>
                        <textarea className="qb-textarea" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="匿名问 TA 一个问题…" />
                        <button className="qb-btn" style={{ marginTop: 10 }} onClick={askChar} disabled={generating || !question.trim()}><Send size={14} /> 匿名投递</button>
                    </div>
                ) : (
                    <div className="qb-card">
                        <div className="qb-label">TA 匿名投递</div>
                        <button className="qb-btn" onClick={charAsk} disabled={generating}><RefreshCw size={14} /> 让 TA 投一个问题给我</button>
                        {active && active.direction === "char_to_user" && (
                            <div style={{ marginTop: 12 }}>
                                <div className="qb-q">{active.question || <span className="qb-cursor" />}</div>
                                {active.question && !active.answer && (
                                    <>
                                        <textarea className="qb-textarea" rows={3} value={answerDraft} onChange={(e) => setAnswerDraft(e.target.value)} placeholder="写下你的回答…" />
                                        <button className="qb-btn" style={{ marginTop: 8 }} onClick={answerCharQuestion} disabled={generating}><Send size={14} /> 作答</button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {active && active.answer && (
                    <div className="qb-answer">
                        {active.guess && <span className="qb-guess">猜身份：{active.guess}</span>}
                        <div style={{ marginTop: active.guess ? 8 : 0 }}>{active.answer}{generating && <span className="qb-cursor" />}</div>
                    </div>
                )}

                {list.length > 0 && (
                    <div>
                        <div className="qb-label">历史</div>
                        {list.slice(0, visibleCount).map((i) => (
                            <div key={i.id} className="qb-card" style={{ marginBottom: 8 }}>
                                <div className="qb-q">{i.question}</div>
                                {i.answer && <div className="qb-answer" style={{ marginTop: 6 }}>{i.answer}</div>}
                                {i.guess && <div className="qb-guess" style={{ marginTop: 6 }}>猜身份：{i.guess}</div>}
                                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                                    <button className="qb-ghost" onClick={() => { void deleteQaBoxItem(i.id); void reload(); }}><Trash2 size={12} /></button>
                                </div>
                            </div>
                        ))}
                        {list.length > visibleCount && (
                            <button className="qb-ghost" style={{ marginTop: 8 }} onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>加载更多（{list.length - visibleCount}）</button>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
