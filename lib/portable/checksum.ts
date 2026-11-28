// lib/portable/checksum.ts
// 备份文件的完整性校验。
//
// 大文件（几十万条聊天记录、几百 MB 的图片 dataURL）不能为了算 sha256 再复制
// 一份 Uint8Array —— 手机上那一下就可能 OOM。所以：
//   - 数据量小（默认 ≤ 32MB）用 WebCrypto 的 sha256，最可信；
//   - 数据量大退化到 FNV-1a 64bit 分块累加，只做「有没有被截断/改坏」的完整性
//     校验，不承担密码学强度。
// 校验值自带算法前缀，导入端按前缀用同一算法重算，不会出现算法不一致误报。

const SHA256_MAX_BYTES = 32 * 1024 * 1024;

function fnv1a64(text: string): string {
    // 64 位 FNV-1a，用 BigInt 保证不溢出；分块处理避免长字符串反复切片。
    const prime = 1099511628211n;
    const mask = (1n << 64n) - 1n;
    let hash = 14695981039346656037n;
    const chunk = 4096;
    for (let start = 0; start < text.length; start += chunk) {
        const part = text.slice(start, start + chunk);
        for (let i = 0; i < part.length; i++) {
            hash ^= BigInt(part.charCodeAt(i));
            hash = (hash * prime) & mask;
        }
    }
    return hash.toString(16).padStart(16, "0");
}

async function sha256Hex(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

/** 计算校验串，返回值形如 `sha256:ab12…` 或 `fnv1a64:ab12…`。 */
export async function computeChecksum(text: string): Promise<string> {
    try {
        if (typeof crypto !== "undefined" && crypto.subtle && text.length * 2 <= SHA256_MAX_BYTES * 2) {
            return `sha256:${await sha256Hex(text)}`;
        }
    } catch {
        // 非安全上下文（http / 老 WebView）没有 crypto.subtle，退化即可。
    }
    return `fnv1a64:${fnv1a64(text)}`;
}

/** 重新计算并比对；算法不认识时返回 null（调用方按「无法校验」处理，不阻断导入）。 */
export async function verifyChecksum(text: string, expected: string): Promise<boolean | null> {
    if (typeof expected !== "string" || !expected.includes(":")) return null;
    const [algorithm] = expected.split(":", 1);
    if (algorithm !== "sha256" && algorithm !== "fnv1a64") return null;
    const actual = await computeChecksum(text);
    return actual === expected;
}

/** 生成 `ai_phone_backup_YYYYMMDD_HHmmss.json` 这样的文件名（本地时区）。 */
export function buildBackupFilename(prefix = "ai_phone_backup", date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${prefix}_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`;
}
