// lib/theater-types.ts
// 小剧场独立互动应用：类型与默认配置。
// 小剧场与捡手机的写作规范相互独立；界面为极简黑白杂志排版 + 夜间深色模式。

export type TheaterStyleTemplate = {
    id: string;
    name: string;
    prompt: string;
};

export type TheaterTone = { id: string; label: string };
export type TheaterPerson = { id: string; label: string; prompt: string };
export type TheaterTag = { id: string; label: string };

/** 一套独立的写作规范：自定义提示词 + 禁词规则。 */
export type TheaterWritingSpec = {
    /** 自定义提示词（会追加在系统提示词之后）。 */
    customPrompt: string;
    /** 禁词规则：生成时禁止出现的词/短语。 */
    forbiddenWords: string[];
};

export type TheaterConfig = {
    /** 小剧场写作规范（与捡手机相互独立）。 */
    theaterSpec: TheaterWritingSpec;
    /** 捡手机写作规范。 */
    pickupSpec: TheaterWritingSpec;
    /** 文风模板。 */
    styleTemplates: TheaterStyleTemplate[];
    /** 基调。 */
    tones: TheaterTone[];
    /** 人称。 */
    persons: TheaterPerson[];
    /** 顶部可自定义标签（情侣问卷调查等）。 */
    tags: TheaterTag[];
    /** 连着主线：聊天主线可读取小剧场剧情。 */
    linkToMain: boolean;
    /** 夜间深色模式。 */
    darkMode: boolean;
};

export type TheaterStoryKind = "theater" | "pickup";

export type TheaterStory = {
    id: string;
    characterId: string;
    kind: TheaterStoryKind;
    title: string;
    /** 生成的正文（流式输出结果）。 */
    content: string;
    tone?: string;
    person?: string;
    styleId?: string;
    tags: string[];
    /** 灵感梗来源（用户手输或近期聊天）。 */
    idea: string;
    createdAt: string;
    updatedAt: string;
    favorite: boolean;
};

/** 小纸条（写给用户，通过桌面组件/离线推送递出）。 */
export type TheaterNote = {
    id: string;
    content: string;
    createdAt: string;
    delivered: boolean;
};

/** 每日一问。 */
export type TheaterDailyQuestion = {
    id: string;
    question: string;
    date: string;
    delivered: boolean;
};

export const DEFAULT_STYLE_TEMPLATES: TheaterStyleTemplate[] = [
    { id: "sweet", name: "甜宠", prompt: "甜宠治愈，语言细腻温柔，情绪饱满，结局偏暖。" },
    { id: "angst", name: "虐恋", prompt: "克制隐忍的虐恋，张力强，情感转折真实，不狗血。" },
    { id: "slice", name: "日常", prompt: "生活流日常，细节真实，平淡中见心动，对话自然。" },
    { id: "campus", name: "校园", prompt: "青春校园，青涩心动，画面感强，带少年感。" },
    { id: "comedy", name: "沙雕", prompt: "轻松搞笑沙雕，节奏快，梗密集，读来会心一笑。" },
    { id: "suspense", name: "悬疑", prompt: "悬疑氛围，伏笔回收干净，留白克制，节奏紧凑。" },
];

export const DEFAULT_TONES: TheaterTone[] = [
    { id: "sweet", label: "甜" },
    { id: "angst", label: "虐" },
    { id: "light", label: "轻松" },
    { id: "deep", label: "深情" },
    { id: "funny", label: "沙雕" },
];

export const DEFAULT_PERSONS: TheaterPerson[] = [
    { id: "first", label: "第一人称", prompt: "以「我」的第一人称视角叙事。" },
    { id: "second", label: "第二人称", prompt: "以「你」的第二人称视角叙事。" },
    { id: "third", label: "第三人称", prompt: "以第三人称全知视角叙事。" },
];

export const DEFAULT_TAGS: TheaterTag[] = [
    { id: "couple_quiz", label: "情侣问卷" },
    { id: "first_date", label: "初次约会" },
    { id: "anniversary", label: "纪念日" },
    { id: "pet_name", label: "昵称日常" },
];

export const DEFAULT_THEATER_CONFIG: TheaterConfig = {
    theaterSpec: {
        customPrompt: "",
        forbiddenWords: [],
    },
    pickupSpec: {
        customPrompt: "",
        forbiddenWords: [],
    },
    styleTemplates: DEFAULT_STYLE_TEMPLATES,
    tones: DEFAULT_TONES,
    persons: DEFAULT_PERSONS,
    tags: DEFAULT_TAGS,
    linkToMain: false,
    darkMode: false,
};
