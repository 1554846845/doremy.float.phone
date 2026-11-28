import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

export const runtime = "nodejs";
export const maxDuration = 30;

const DEFAULT_FISH_BASE_URL = "https://api.fish.audio";
const FISH_AUDIO_MODELS = new Set(["speech-1.5", "speech-1.6", "s1"]);

function normalizeBaseUrl(value: unknown): string {
    const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_FISH_BASE_URL;
    return raw.replace(/\/$/, "");
}

export async function POST(request: Request) {
    try {
        return await handleTts(request);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: "tts_failed", message: message.slice(0, 500) }, { status: 502 });
    }
}

async function handleTts(request: Request) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const text = typeof body.text === "string" ? body.text : "";
    const referenceId = typeof body.reference_id === "string" ? body.reference_id.trim() : "";
    const rawModel = typeof body.model === "string" ? body.model.trim() : "";
    const model = FISH_AUDIO_MODELS.has(rawModel) ? rawModel : "speech-1.5";
    const baseUrl = normalizeBaseUrl(body.baseUrl);

    if (!apiKey) return NextResponse.json({ error: "missing_api_key" }, { status: 400 });
    if (!text.trim()) return NextResponse.json({ error: "missing_text" }, { status: 400 });
    if (!referenceId) return NextResponse.json({ error: "missing_reference_id" }, { status: 400 });

    const upstream = await proxyFetch(`${baseUrl}/v1/tts`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            text,
            reference_id: referenceId,
            format: "mp3",
            model,
        }),
    });

    if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        let message = errText;
        try {
            const parsed = JSON.parse(errText) as Record<string, unknown>;
            message = String(parsed.message || parsed.error || errText);
        } catch { /* ignore */ }
        return NextResponse.json(
            { error: "upstream_failed", message: message.slice(0, 500) },
            { status: 502 },
        );
    }

    const audio = await upstream.arrayBuffer();
    const contentType = upstream.headers.get("Content-Type") || "audio/mpeg";
    return new Response(audio, {
        status: 200,
        headers: {
            "Content-Type": contentType,
            "Content-Length": String(audio.byteLength),
            "Cache-Control": "no-store",
        },
    });
}
