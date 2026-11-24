"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Heart, Send, Trash2, Sparkles } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import {
    CONFESSION_KINDS, type ConfessionKind, type ConfessionRecord,
    loadConfessionRecords, saveConfessionRecord, deleteConfessionRecord, newConfessionId,
} from "@/lib/confession-module";
import { streamChat } from "@/lib/interactive-llm";

const STYLE = `
.cf { display:flex; flex-direction:column; gap:12px; padding:14px 14px 48px; }
.cf-hero { border-radius:20px; padding:18px 16px; color:#fff;
  background:linear-gradient(135deg,#b98cff 0%,#7c6cf6 100%); box-shadow:0 8px 24px rgba(124,108,246,.25); }
.cf-hero h2 { margin:0 0 4px; font-size:20px; }
.cf-hero p { margin:0; opacity:.92; font-size:12px; }
.cf-card { border-radius:16px; padding:12px 14px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08)); background:var(--c-panel,#fff); }
.cf-label { font-size:11px; letter-spacing:1px; color:var(--c-secondary,#999); text-transform:uppercase; margin:2px 0 6px; }
.cf-chip { display:inline-flex; align-items:center; gap:4px; padding:6px 10px; font-size:12px; border-radius:999px;
  border:1px solid var(--c-panel-border,rgba(0,0,0,.08)); color:var(--c-secondary,#888); background:transparent; cursor:pointer; }
.cf-chip[data-on="true"] { color:#fff; border-color:transparent; background:linear-gradient(135deg,#b98cff,#7c6cf6); }
.cf-textarea { width:100%; border-radius:14px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08));
  padding:10px 12px; font-size:13px; background:var(--c-panel,#fff); color:var(--c-primary,#222); resize:vertical; }
.cf-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:11px 14px; border-radius:14px;
  font-size:13px; font-weight:600; cursor:pointer; border:none; color:#fff; background:linear-gradient(135deg,#b98cff,#7c6cf6); }
.cf-btn:disabled { opacity:.5; cursor:not-allowed; }
.cf-answer { border-radius:14px; padding:12px 14px; background:linear-gradient(180deg,rgba(185,140,255,.12),rgba(124,108,246,.08)); font-size:14px; line-height:1.7; white-space:pre-wrap; }
.cf-emotion { display:inline-flex; border-radius:999px; padding:3px 10px; font-size:11px; background:rgba(124,108,246,.16); color:#6d5ce0; }
.cf-record { border-radius:14px; padding:11px 13px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08)); background:var(--c-panel,#fff); }
.cf-record-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.cf-date { font-size:11px; color:var(--c-secondary,#999); }
.cf-content { margin:6px 0 0; font-size:13px; line-height:1.6; white-space:pre-wrap; }
.cf-cursor { display:inline-block; width:7px; height:15px; background:#7c6cf6; vertical-align:text-bottom; animation:cfblink 1s steps(2,start) infinite; }
@keyframes cfblink { to { visibility:hidden; } }
`;

const PAGE_SIZE = 10;

export function ConfessionApp({ onNotice }: { onNotice?: (msg: string) => void }) {
    const [kind, setKind] = useState<ConfessionKind>("confession");
    const [content, setContent] = useState("");
    const [response, setResponse] = useState("");
    const [emotion, setEmotion] = useState("");
    const [generating, setGenerating] = useState(false);
    const [records, setRecords] = useState<ConfessionRecord[]>([]);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [charId, setCharId] = useState("");

    const chars = useMemo(() => loadCharacters(), []);
    const activeCharId = charId || chars[0]?.id || "";

    const reload = useCallback(async () => {
        setRecords(await loadConfessionRecords(activeCharId));
        setVisibleCount(PAGE_SIZE);
    }, [activeCharId]);

    useEffect(() => { setCharId(chars[0]?.id ?? ""); }, [chars]);
    useEffect(() => { reload(); }, [reload]);

    const submit = async () => {
        const text = content.trim();
        if (!text || generating) return;
        setGenerating(true);
        setResponse("");
        setEmotion("");
        const kindLabel = CONFESSION_KINDS.find((k) => k.id === kind)?.label ?? kind;
        try {
            const system = "你是恋人的知己。对方正在向你倾诉" + kindLabel + "。请结合你的人设，给出带有真实情绪、有温度、有互动的回应：先点出你感受到的情绪，再给出回应。用中文，简短真诚。";
            let emotionGuess = "";
            const full = await streamChat(activeCharId, system, text, {
                appId: "confession",
                onDelta: (t) => setResponse((prev) => prev + t),
            });
            // 从回应里简单抽取情绪（首段括号内或直接给出）
            const m = full.match(/【(.{1,8})】|\[(.{1,8})\]/);
            emotionGuess = m ? (m[1] ?? m[2] ?? "") : "";
            setEmotion(emotionGuess);
            setResponse(full);
            const now = new Date().toISOString();
            await saveConfessionRecord({
                id: newConfessionId(),
                characterId: activeCharId,
                kind,
                content: text,
                response: full,
                emotion: emotionGuess,
                createdAt: now,
            });
            setContent("");
            await reload();
        } catch (e) {
            onNotice?.(e instanceof Error ? e.message : "提交失败");
        } finally {
            setGenerating(false);
        }
    };

    return (
        <>
            <style>{STYLE}</style>
            <div className="cf">
                <div className="cf-hero">
                    <h2>忏悔室</h2>
                    <p>把心事悄悄说出来，TA 会用真实的情绪回应你。</p>
                </div>

                <div>
                    <div className="cf-label">选择类型</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {CONFESSION_KINDS.map((k) => (
                            <button key={k.id} className="cf-chip" data-on={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>
                        ))}
                    </div>
                </div>

                <div>
                    <div className="cf-label">写下你的心事</div>
                    <textarea className="cf-textarea" rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="说点什么吧…" />
                    <button className="cf-btn" style={{ marginTop: 10 }} onClick={submit} disabled={generating || !content.trim()}><Send size={14} /> 提交</button>
                </div>

                {generating && <div className="cf-answer"><Sparkles size={12} /> 正在回应…</div>}
                {response && (
                    <div className="cf-answer">
                        {emotion && <span className="cf-emotion">{emotion}</span>}
                        <div style={{ marginTop: emotion ? 8 : 0 }}>{response}{generating && <span className="cf-cursor" />}</div>
                    </div>
                )}

                {records.length > 0 && (
                    <div>
                        <div className="cf-label">历史记录</div>
                        {records.slice(0, visibleCount).map((r) => (
                            <div key={r.id} className="cf-record" style={{ marginBottom: 8 }}>
                                <div className="cf-record-head">
                                    <span className="cf-emotion">{CONFESSION_KINDS.find((k) => k.id === r.kind)?.label}</span>
                                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                        <span className="cf-date">{r.createdAt.slice(0, 16).replace("T", " ")}</span>
                                        <button className="cf-chip" onClick={() => { void deleteConfessionRecord(r.id); void reload(); }}><Trash2 size={12} /></button>
                                    </span>
                                </div>
                                <div className="cf-content">{r.content}</div>
                                {r.response && <div className="cf-answer" style={{ marginTop: 8 }}>{r.response}</div>}
                            </div>
                        ))}
                        {records.length > visibleCount && (
                            <button className="cf-chip" style={{ marginTop: 8 }} onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>加载更多（{records.length - visibleCount}）</button>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
