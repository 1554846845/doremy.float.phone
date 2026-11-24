"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Ticket, Plus, Trash2, Zap, Sparkles } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import {
    type Coupon, type CouponUseRecord,
    loadCoupons, saveCoupon, deleteCoupon, loadCouponUseRecords, saveCouponUseRecord, newCouponId,
} from "@/lib/coupon-module";
import { streamChat } from "@/lib/interactive-llm";

const STYLE = `
.cp { display:flex; flex-direction:column; gap:12px; padding:14px 14px 48px; }
.cp-hero { border-radius:20px; padding:18px 16px; color:#fff;
  background:linear-gradient(135deg,#ff9d6c 0%,#ff6a88 100%); box-shadow:0 8px 24px rgba(255,106,136,.25); }
.cp-hero h2 { margin:0 0 4px; font-size:20px; }
.cp-hero p { margin:0; opacity:.92; font-size:12px; }
.cp-card { border-radius:16px; padding:12px 14px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08)); background:var(--c-panel,#fff); }
.cp-label { font-size:11px; letter-spacing:1px; color:var(--c-secondary,#999); text-transform:uppercase; margin:2px 0 6px; }
.cp-input { width:100%; border-radius:14px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08));
  padding:10px 12px; font-size:13px; background:var(--c-panel,#fff); color:var(--c-primary,#222); }
.cp-textarea { width:100%; border-radius:14px; border:1px solid var(--c-panel-border,rgba(0,0,0,.08));
  padding:10px 12px; font-size:13px; background:var(--c-panel,#fff); color:var(--c-primary,#222); resize:vertical; }
.cp-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:11px 14px; border-radius:14px;
  font-size:13px; font-weight:600; cursor:pointer; border:none; color:#fff; background:linear-gradient(135deg,#ff9d6c,#ff6a88); }
.cp-btn:disabled { opacity:.5; cursor:not-allowed; }
.cp-ghost { display:inline-flex; align-items:center; gap:4px; padding:6px 10px; font-size:12px; border-radius:999px;
  border:1px solid var(--c-panel-border,rgba(0,0,0,.08)); color:var(--c-secondary,#888); background:transparent; cursor:pointer; }
.cp-feedback { border-radius:14px; padding:12px 14px; background:linear-gradient(180deg,rgba(255,157,108,.12),rgba(255,106,136,.08)); font-size:14px; line-height:1.7; white-space:pre-wrap; }
.cp-remaining { display:inline-flex; border-radius:999px; padding:3px 10px; font-size:11px; background:rgba(255,106,136,.16); color:#e0446a; }
.cp-cursor { display:inline-block; width:7px; height:15px; background:#ff6a88; vertical-align:text-bottom; animation:cpblink 1s steps(2,start) infinite; }
@keyframes cpblink { to { visibility:hidden; } }
`;

const PAGE_SIZE = 10;

export function CouponApp({ onNotice }: { onNotice?: (msg: string) => void }) {
    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [records, setRecords] = useState<CouponUseRecord[]>([]);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [total, setTotal] = useState(1);
    const [feedback, setFeedback] = useState("");
    const [generating, setGenerating] = useState(false);
    const [charId, setCharId] = useState("");

    const chars = useMemo(() => loadCharacters(), []);
    const activeCharId = charId || chars[0]?.id || "";

    const reload = useCallback(async () => {
        setCoupons(await loadCoupons(activeCharId));
        setRecords(await loadCouponUseRecords(activeCharId));
    }, [activeCharId]);

    useEffect(() => { setCharId(chars[0]?.id ?? ""); }, [chars]);
    useEffect(() => { reload(); }, [reload]);
    useEffect(() => { setVisibleCount(PAGE_SIZE); }, [activeCharId]);

    const createCoupon = async () => {
        const n = name.trim();
        if (!n) { onNotice?.("请填写惩罚名称"); return; }
        await saveCoupon({
            id: newCouponId(),
            characterId: activeCharId,
            name: n,
            description: description.trim(),
            total: Math.max(1, total),
            used: 0,
            createdAt: new Date().toISOString(),
        });
        setName(""); setDescription(""); setTotal(1);
        await reload();
    };

    const useCoupon = async (coupon: Coupon) => {
        if (generating) return;
        if (coupon.used >= coupon.total) { onNotice?.("次数已用完"); return; }
        setGenerating(true);
        setFeedback("");
        try {
            const system = "你收到一张「惩罚券」，上面写着恋人要对你做的事。请结合人设与当下状态，立刻、真实地执行这个惩罚并给出即时互动反馈（语气、动作、反应都演出来）。用中文，有画面感。";
            const user = `惩罚券：${coupon.name}${coupon.description ? "（" + coupon.description + "）" : ""}`;
            const full = await streamChat(activeCharId, system, user, {
                appId: "coupon",
                onDelta: (t) => setFeedback((prev) => prev + t),
            });
            setFeedback(full);
            const updated: Coupon = { ...coupon, used: coupon.used + 1 };
            await saveCoupon(updated);
            await saveCouponUseRecord({ id: `${coupon.id}_${Date.now()}`, couponId: coupon.id, characterId: activeCharId, feedback: full, createdAt: new Date().toISOString() });
            await reload();
        } catch (e) {
            onNotice?.(e instanceof Error ? e.message : "使用失败");
        } finally {
            setGenerating(false);
        }
    };

    return (
        <>
            <style>{STYLE}</style>
            <div className="cp">
                <div className="cp-hero">
                    <h2>惩罚券</h2>
                    <p>自定义惩罚内容与次数，使用后 TA 会按当下状态真实执行。</p>
                </div>

                <div className="cp-card">
                    <div className="cp-label">新建惩罚券</div>
                    <input className="cp-input" placeholder="惩罚名称，如：捏脸 10 下" value={name} onChange={(e) => setName(e.target.value)} />
                    <textarea className="cp-textarea" style={{ marginTop: 8 }} rows={2} placeholder="补充说明（可选）" value={description} onChange={(e) => setDescription(e.target.value)} />
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                        <span className="cp-label" style={{ margin: 0 }}>次数</span>
                        <input className="cp-input" style={{ width: 70 }} type="number" min={1} max={99} value={total} onChange={(e) => setTotal(Number(e.target.value) || 1)} />
                        <button className="cp-btn" onClick={createCoupon}><Plus size={14} /> 创建</button>
                    </div>
                </div>

                {feedback && (
                    <div className="cp-feedback">
                        <Sparkles size={12} /> 即时反馈：
                        <div style={{ marginTop: 6 }}>{feedback}{generating && <span className="cp-cursor" />}</div>
                    </div>
                )}

                {coupons.length > 0 && (
                    <div>
                        <div className="cp-label">我的惩罚券</div>
                        {coupons.slice(0, visibleCount).map((c) => {
                            const remaining = c.total - c.used;
                            return (
                                <div key={c.id} className="cp-card" style={{ marginBottom: 8 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                        <span style={{ fontWeight: 700, fontSize: 14 }}><Ticket size={13} style={{ verticalAlign: "-2px" }} /> {c.name}</span>
                                        <span className="cp-remaining">剩 {remaining}/{c.total}</span>
                                    </div>
                                    {c.description && <div style={{ fontSize: 12, color: "var(--c-secondary,#888)", marginTop: 4 }}>{c.description}</div>}
                                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                                        <button className="cp-btn" onClick={() => useCoupon(c)} disabled={generating || remaining <= 0}><Zap size={14} /> 使用</button>
                                        <button className="cp-ghost" onClick={() => { void deleteCoupon(c.id); void reload(); }}><Trash2 size={13} /></button>
                                    </div>
                                </div>
                            );
                        })}
                        {coupons.length > visibleCount && (
                            <button className="cp-ghost" style={{ marginTop: 8 }} onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>加载更多（{coupons.length - visibleCount}）</button>
                        )}
                    </div>
                )}

                {records.length > 0 && (
                    <div>
                        <div className="cp-label">反馈记录</div>
                        {records.slice(0, 10).map((r) => {
                            const c = coupons.find((x) => x.id === r.couponId);
                            return (
                                <div key={r.id} className="cp-card" style={{ marginBottom: 8 }}>
                                    <div style={{ fontSize: 12, color: "var(--c-secondary,#888)" }}>{c?.name ?? "惩罚券"} · {r.createdAt.slice(0, 16).replace("T", " ")}</div>
                                    <div className="cp-feedback" style={{ marginTop: 6 }}>{r.feedback}</div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </>
    );
}
