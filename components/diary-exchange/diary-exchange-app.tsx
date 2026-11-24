"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Lock, Unlock, Send, Sparkles, Trash2 } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import {
    type DiaryExchangeEntry,
    loadDiaryExchangeEntries, findDiaryExchangeEntry, saveDiaryExchangeEntry, deleteDiaryExchangeEntry, newDiaryExchangeId,
} from "@/lib/diary-exchange-module";
import { streamChat } from "@/lib/interactive-llm";

const STYLE = `
.dx { display:flex; flex-direction:column; gap:12px; padding:14px 14px 48px; }
.dx-hero { border-radius:20px; padding:18px 16px; color:#fff;
  background:linear-gradient(135deg,#7ccf9b 0%,#5bbf8a 100%); box-shadow:0 8px 24px rgba(91,191,138,.25); }
.dx-hero h2 { margin:0 0 4px; font-size:20px; }
.dx-hero p { margin:0; opacity:.92; font-size:12px; }
.dx-card { border-radius:16px; padding:12px 14px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08)); background:var(--c-panel,#fff); }
.dx-label { font-size:11px; letter-spacing:1px; color:var(--c-secondary,#999); text-transform:uppercase; margin:2px 0 6px; }
.dx-input { width:100%; border-radius:14px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08));
  padding:10px 12px; font-size:13px; background:var(--c-panel,#fff); color:var(--c-primary,#222); }
.dx-textarea { width:100%; border-radius:14px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08));
  padding:10px 12px; font-size:13px; background:var(--c-panel,#fff); color:var(--c-primary,#222); resize:vertical; }
.dx-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:11px 14px; border-radius:14px;
  font-size:13px; font-weight:600; cursor:pointer; border:none; color:#fff; background:linear-gradient(135deg,#7ccf9b,#5bbf8a); }
.dx-btn:disabled { opacity:.5; cursor:not-allowed; }
.dx-ghost { display:inline-flex; align-items:center; gap:4px; padding:6px 10px; font-size:12px; border-radius:999px;
  border:1px solid var(--c-panel-border,rgba(0,0,0,.08)); color:var(--c-secondary,#888); background:transparent; cursor:pointer; }
.dx-page { border-radius:14px; padding:12px 14px; font-size:14px; line-height:1.7; white-space:pre-wrap; }
.dx-mine { background:linear-gradient(180deg,rgba(124,207,155,.12),rgba(91,191,138,.06)); }
.dx-theirs { background:linear-gradient(180deg,rgba(255,183,197,.12),rgba(255,143,177,.06)); }
.dx-lock { display:flex; align-items:center; gap:8px; color:var(--c-secondary,#999); font-size:13px; padding:16px; justify-content:center; }
.dx-cursor { display:inline-block; width:7px; height:15px; background:#5bbf8a; vertical-align:text-bottom; animation:dxblink 1s steps(2,start) infinite; }
@keyframes dxblink { to { visibility:hidden; } }
`;

const PAGE_SIZE = 10;

function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
}

export function DiaryExchangeApp({ onNotice }: { onNotice?: (msg: string) => void }) {
    const [date, setDate] = useState(todayStr());
    const [entry, setEntry] = useState<DiaryExchangeEntry | null>(null);
    const [myDraft, setMyDraft] = useState("");
    const [generating, setGenerating] = useState(false);
    const [archive, setArchive] = useState<DiaryExchangeEntry[]>([]);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [charId, setCharId] = useState("");

    const chars = useMemo(() => loadCharacters(), []);
    const activeCharId = charId || chars[0]?.id || "";

    const reload = useCallback(async () => {
        setArchive(await loadDiaryExchangeEntries(activeCharId));
        const e = await findDiaryExchangeEntry(activeCharId, date);
        setEntry(e ?? null);
        setMyDraft(e?.myEntry ?? "");
    }, [activeCharId, date]);

    useEffect(() => { setCharId(chars[0]?.id ?? ""); }, [chars]);
    useEffect(() => { reload(); }, [reload]);
    useEffect(() => { setVisibleCount(PAGE_SIZE); }, [activeCharId]);

    const writeMine = async () => {
        const text = myDraft.trim();
        if (!text || generating) return;
        setGenerating(true);
        const now = new Date().toISOString();
        const base: DiaryExchangeEntry = entry ?? {
            id: newDiaryExchangeId(), characterId: activeCharId, date, myEntry: "", theirEntry: "", createdAt: now,
        };
        const withMine: DiaryExchangeEntry = { ...base, myEntry: text };
        setEntry(withMine);
        try {
            const system = "你是恋人的交换日记伙伴。对方写下了今天的日记，请结合人设与近期相处，写一页你自己的今日日记，真诚、有细节、有情感。直接写正文，不要标题。";
            let their = "";
            const full = await streamChat(activeCharId, system, `对方今日日记：\n${text}`, {
                appId: "diary_exchange",
                onDelta: (t) => { their += t; setEntry((prev) => prev ? { ...prev, theirEntry: their, unlockedAt: now } : prev); },
            });
            const final: DiaryExchangeEntry = { ...withMine, theirEntry: full, unlockedAt: now };
            setEntry(final);
            await saveDiaryExchangeEntry(final);
            await reload();
        } catch (e) {
            onNotice?.(e instanceof Error ? e.message : "写入失败");
        } finally {
            setGenerating(false);
        }
    };

    return (
        <>
            <style>{STYLE}</style>
            <div className="dx">
                <div className="dx-hero">
                    <h2>交换日记</h2>
                    <p>写下今天的一页，才能解锁 TA 的那一页。</p>
                </div>

                <div>
                    <div className="dx-label">选择日期</div>
                    <input className="dx-input" type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
                </div>

                <div className="dx-card">
                    <div className="dx-label">我的一页</div>
                    <textarea className="dx-textarea" rows={4} value={myDraft} onChange={(e) => setMyDraft(e.target.value)} placeholder="写下今天的日记…" />
                    <button className="dx-btn" style={{ marginTop: 10 }} onClick={writeMine} disabled={generating || !myDraft.trim()}><Send size={14} /> 写完并解锁对方</button>
                </div>

                <div className="dx-card">
                    <div className="dx-label">TA 的一页</div>
                    {entry?.theirEntry ? (
                        <div className="dx-page dx-theirs">
                            <Unlock size={12} style={{ opacity: .6 }} /> {entry.theirEntry}{generating && <span className="dx-cursor" />}
                        </div>
                    ) : (
                        <div className="dx-lock"><Lock size={14} /> 写完你的日记后才能解锁 TA 的这一页</div>
                    )}
                </div>

                {entry?.myEntry && (
                    <div className="dx-card">
                        <div className="dx-label">我的一页（已保存）</div>
                        <div className="dx-page dx-mine">{entry.myEntry}</div>
                    </div>
                )}

                {archive.length > 0 && (
                    <div>
                        <div className="dx-label">按日期归档</div>
                        {archive.slice(0, visibleCount).map((e) => (
                            <div key={e.id} className="dx-card" style={{ marginBottom: 8 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontWeight: 700, fontSize: 14 }}><BookOpen size={13} style={{ verticalAlign: "-2px" }} /> {e.date}</span>
                                    <button className="dx-ghost" onClick={() => { void deleteDiaryExchangeEntry(e.id); void reload(); }}><Trash2 size={12} /></button>
                                </div>
                                <div className="dx-page dx-mine" style={{ marginTop: 8 }}>{e.myEntry.slice(0, 120)}{e.myEntry.length > 120 ? "…" : ""}</div>
                                {e.theirEntry && <div className="dx-page dx-theirs" style={{ marginTop: 6 }}>{e.theirEntry.slice(0, 120)}{e.theirEntry.length > 120 ? "…" : ""}</div>}
                            </div>
                        ))}
                        {archive.length > visibleCount && (
                            <button className="dx-ghost" style={{ marginTop: 8 }} onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>加载更多（{archive.length - visibleCount}）</button>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
