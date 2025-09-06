import { Client } from "@line/bot-sdk";
import OpenAI from "openai";

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** ── カフェポリフォニー関連ワード ── */
const TERMS = [
  "南堀江の隠れ家カフェ＆バル カフェポリフォニー",
  "ランチメニュー", "追加オプション", "営業時間", "定休日",
  "アクセス", "電話", "予約", "おすすめスイーツ", "ドリンクメニュー"
];

const isRelated = (t) =>
  /関連ワード|キーワード|メニュー|営業時間|アクセス|予約|ランチ|電話/i.test((t || "").trim());

const fmt = (arr) =>
  `【カフェポリフォニー関連ワード】
${arr.map((t) => `・${t}`).join("\n")}

（例）「ランチメニュー」「営業時間」「アクセス」「電話」などを送ってください。`;

/** ── 固定返答（よく聞かれる情報）── */
const FIXED = {
  "店舗名": "南堀江の隠れ家カフェ＆バル　カフェポリフォニー",
  "営業時間": "ランチ 11:30 - 13:30 (L.O. 13:00)\n※ランチは無くなり次第終了となります。",
  "アクセス": "〒550-0015 大阪市西区南堀江3-15-7 堀江ヴィラ 1F\n最寄駅：四ツ橋駅から徒歩5分。",
  "電話": "TEL: 06-6606-9561",
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
  "予約": "ご予約はお電話（06-6606-9561）またはLINEから承ります。",
  "定休日": "毎週火曜日が定休日です。",
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("ok");

  try {
    const events = req.body?.events || [];
    for (const ev of events) await handleEvent(ev);
  } catch (e) {
    console.error("[api/webhook] error:", e);
  }
  res.status(200).send("ok");
}

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;
  const text = event.message.text.trim();
  console.log("[webhook] recv:", text);

  // 固定返答
  if (FIXED[text]) {
    return client.replyMessage(event.replyToken, { type: "text", text: FIXED[text] });
  }

  // 関連ワードモード
  if (isRelated(text)) {
    return client.replyMessage(event.replyToken, { type: "text", text: fmt(TERMS) });
  }

  // ChatGPT応答
  try {
    const resp = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "あなたは『南堀江の隠れ家カフェ＆バル カフェポリフォニー』の案内アシスタントです。"+
            "メニュー、営業時間、アクセス、予約、電話番号などを丁寧に案内してください。"
        },
        { role: "user", content: text },
      ],
    });
    const aiText =
      resp.output_text?.trim() ||
      (resp.output?.[0]?.content?.[0]?.text?.value ?? "すみません、うまく答えられませんでした。");

    return client.replyMessage(event.replyToken, { type: "text", text: aiText });
  } catch (err) {
    console.error("[webhook] OpenAI error:", err);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "（AI応答でエラーが出ました）\n「ランチメニュー」「営業時間」「アクセス」「電話」などを送ってみてください。",
    });
  }
}
