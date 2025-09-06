import { Client } from "@line/bot-sdk";
import OpenAI from "openai";

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** ── 店舗定義 ── */
const STORE_NAME = "南堀江の隠れ家カフェ＆バル　カフェポリフォニー";

/** ── 固定返答（ここだけ直せば全体が最新化されます） ── */
const FIXED = {
  "店舗名": STORE_NAME,
  "営業時間":
    "ランチ 11:30 - 13:30 (L.O. 13:00)\n※ランチメニューは無くなり次第終了となります。\n※価格はすべて税込み。",
  "定休日": "不定期となります。",
  "アクセス":
    "〒550-0015 大阪市西区南堀江3-15-7 堀江ヴィラ 1F\n最寄駅：地下鉄千日前線 桜川駅より徒歩6分。",
  "電話": "TEL: 06-6606-9561",
  "予約": "ご予約はお電話（06-6606-9561）またはLINEから承ります。",
  "ランチメニュー": `【ランチメニュー】（税込）
1. 定番ランチセット（ご飯・味噌汁付）
 ・低温調理トンテキ定食 ¥1,000（ダブル ¥1,500）
 ・特製からあげ定食 ¥1,000
2. ヘルシーランチ（ご飯・味噌汁付）
 ・低温調理のバンバンジー定食 ¥1,000
 ・低温調理のよだれ鶏定食 ¥1,000
3. 本日の日替わりランチ
 ・日替わりランチ ¥1,000
※ランチは無くなり次第終了`,
  "追加オプション": `【追加オプション】
・ランチドリンク ¥200（コーヒー、紅茶、オレンジジュース など）
・本日のデザート ¥200（例：自家製イチゴジャムのヨーグルト）`,
};

/** ── “関連ワード”の表示 ── */
const TERMS = [
  STORE_NAME,
  "ランチメニュー", "追加オプション",
  "営業時間", "定休日",
  "アクセス", "電話", "予約",
  "おすすめスイーツ", "ドリンクメニュー",
];
const relatedList = () =>
  `【${STORE_NAME} 関連ワード】\n` +
  TERMS.map(t => `・${t}`).join("\n") +
  `\n\n（例）「ランチ」「メニュー」「営業時間」「アクセス」「電話」などを送ってください。`;

/** 前処理＆マッチ系 */
const norm = (s="") => s.toLowerCase().replace(/\s+/g,"").replace(/[！!？?。、・,.]/g,"");
const anyMatch = (text, patterns) => patterns.some(p => p.test(norm(text||"")));

/** あいさつ検出（AIを通さない） */
const isGreeting = (t="") =>
  anyMatch(t, [/こんにちは|こんちは|こんにちわ/, /はじめまして|初めまして/, /おはよう/, /こんばんは/, /hi|hello|hey/]);

/** 意図マップ（部分一致OK） */
const INTENTS = [
  { key: "ランチメニュー", patterns: [/ランチ/, /(ﾒﾆｭｰ|メニュー|めにゅー)/, /(ごはん|フード|食事|昼|昼飯)/, /(日替|今日).*(おすすめ|本日)/, /(おすすめ).*(メニュー|ﾒﾆｭｰ|ランチ)/, /(見せて|教えて|おしえて).*(メニュー|ﾒﾆｭｰ|ランチ)/], replyKey: "ランチメニュー" },
  { key: "追加オプション", patterns: [/(追加|オプション|セット)/, /(ﾄﾞﾘﾝｸ|ドリンク|飲み物).*(ｾｯﾄ|セット|追加)/, /(ﾃﾞｻﾞｰﾄ|デザート|スイーツ)/], replyKey: "追加オプション" },
  { key: "営業時間", patterns: [/(営業時間|オープン|open|何時|いつまで|ラスト|lo|l\.o)/], replyKey: "営業時間" },
  { key: "定休日", patterns: [/(定休日|休み|休業|クローズ|close)/], replyKey: "定休日" },
  { key: "アクセス", patterns: [/(場所|どこ|住所|行き方|道順|アクセス|地図|最寄|駅|南堀江|桜川)/], replyKey: "アクセス" },
  { key: "電話", patterns: [/(電話|tel|でんわ|連絡|問い合わせ|call|コール)/], replyKey: "電話" },
  { key: "予約", patterns: [/(予約|リザーブ|book|席|貸切|コース|取りたい|取れ)/], replyKey: "予約" },
  { key: "関連ワード", patterns: [/(関連|ﾜｰﾄﾞ|キーワード|keyword|ﾍﾙﾌﾟ|help|一覧)/], reply: () => relatedList() },
];

/** AIに渡す “確定情報” を文字列化（逸脱防止用コンテキスト） */
const FACTS = `
【店舗名】${FIXED["店舗名"]}
【住所】${FIXED["アクセス"]}
【電話】${FIXED["電話"]}
【営業時間】${FIXED["営業時間"]}
【定休日】${FIXED["定休日"]}
${FIXED["ランチメニュー"]}

【ルール】
- 回答は上記の事実のみから作成してください。推測・創作は禁止。
- 事実にない項目を聞かれたら「公式情報をご確認ください」と案内してください。
- 価格は税込み。ランチは無くなり次第終了。
`;

/** Webhook */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("ok");
  try {
    const events = req.body?.events || [];
    for (const ev of events) await handleEvent(ev);
  } catch (e) {
    console.error("[api/webhook] error:", e);
  }
  return res.status(200).send("ok");
}

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;
  const text = (event.message.text || "").trim();
  console.log("[recv]", text);

  /** 0) 挨拶はAIを通さず“安全なウェルカム”で返す */
  if (isGreeting(text)) {
    const welcome =
      `こんにちは！『${STORE_NAME}』のご案内です。\n` +
      `・ランチ →「ランチ」\n・追加オプション →「追加オプション」\n・営業時間/定休日 →「営業時間」「定休日」\n・アクセス/電話/予約 →「アクセス」「電話」「予約」\n` +
      `ご希望の項目をメッセージでお送りください。`;
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: welcome,
      quickReply: {
        items: [
          { type: "action", action: { type: "message", label: "ランチ", text: "ランチ" } },
          { type: "action", action: { type: "message", label: "追加オプション", text: "追加オプション" } },
          { type: "action", action: { type: "message", label: "営業時間", text: "営業時間" } },
          { type: "action", action: { type: "message", label: "アクセス", text: "アクセス" } },
          { type: "action", action: { type: "message", label: "電話", text: "電話" } },
        ],
      },
    });
  }

  /** 1) 部分一致の意図判定（固定返答 or 関連ワード） */
  for (const intent of INTENTS) {
    if (anyMatch(text, intent.patterns)) {
      if (intent.replyKey && FIXED[intent.replyKey]) {
        return client.replyMessage(event.replyToken, { type: "text", text: FIXED[intent.replyKey] });
      }
      if (intent.reply) {
        return client.replyMessage(event.replyToken, { type: "text", text: intent.reply() });
      }
    }
  }

  /** 2) 完全一致の固定返答（保険） */
  if (FIXED[text]) {
    return client.replyMessage(event.replyToken, { type: "text", text: FIXED[text] });
  }

  /** 3) どうしてもAIが必要な質問だけ、事実コンテキスト付きで回答 */
  try {
    const resp = await openai.responses.create({
      model: "gpt-4o-mini",
      // ぶれ防止のため出力安定寄り
      temperature: 0.1,
      input: [
        {
          role: "system",
          content:
            "あなたはカフェの案内アシスタントです。ユーザーに誤情報を出さないことが最優先。"
        },
        {
          role: "user",
          content:
            `以下の「確定情報」の範囲だけで、質問に答えてください。` +
            `不明な点は「公式情報をご確認ください」と案内してください。\n\n` +
            FACTS +
            `\n\n【ユーザーの質問】\n${text}`
        },
      ],
    });

    const aiText =
      resp.output_text?.trim() ||
      (resp.output?.[0]?.content?.[0]?.text?.value ?? "すみません、うまく答えられませんでした。");
    return client.replyMessage(event.replyToken, { type: "text", text: aiText });
  } catch (err) {
    console.error("[openai]", err?.name, err?.message);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "（AI応答でエラーが出ました）\n「ランチ」「営業時間」「アクセス」「電話」「予約」などキーワードでお試しください。",
    });
  }
}
