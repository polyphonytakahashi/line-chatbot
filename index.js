// package.json に "type": "module" を推奨
import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import OpenAI from "openai";

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(lineConfig);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** ── ① ポリフォニー用の関連ワード辞書（必要に応じて追加/編集してください） ── */
const POLYPHONY_RELATED_TERMS = [
  // 事業・制度
  "就労継続支援A型", "就労継続支援B型", "施設外就労", "施設外支援", "一般就労", "通過施設",
  // 業務領域
  "Web制作", "デザイン", "ECサイト制作", "データ入力", "清掃", "飲食店業務", "ミシン軽作業",
  // 支援の考え方
  "ソーシャルワーク", "相談支援", "計画相談", "多様性", "生き方", "ソーシャルキャピタル（社会関係資本）",
  // 組織・地域
  "大阪市", "大阪市西区南堀江", "一般社団法人ダイアロゴス",
  // 連携・周辺語
  "障害福祉サービス", "生活困窮", "アディクション", "刑余者支援", "発達障害支援", "職業センター"
];

/** ユーザー入力が「関連ワード」モードかどうか判定 */
function isRelatedQuery(text) {
  const t = text.trim();
  return /関連ワード|キーワード|ハッシュタグ|ポリフォニー|就労支援/i.test(t);
}

/** 関連ワードの整形（見やすい箇条書き） */
function formatRelatedTerms(terms) {
  const bullets = terms.map(t => `・${t}`).join("\n");
  return [
    "【ポリフォニー関連ワード】",
    bullets,
    "",
    "（例）知りたい分野を送ってください：",
    "「A型の仕事内容」「B型の訓練」「施設外就労とは？」"
  ].join("\n");
}

// 追加: ざっくりログ
const log = (...a) => console.log("[webhook]", ...a);

async function handleEvent(event) {
  // テキスト以外は無視
  if (event.type !== "message" || event.message.type !== "text") return;

  const userText = event.message.text;
  log("recv:", userText);

  // 1) 関連ワードモード（OpenAIなし）
  if (isRelatedQuery(userText)) {
    const text = formatRelatedTerms(POLYPHONY_RELATED_TERMS);
    return client.replyMessage(event.replyToken, { type: "text", text });
  }

  // 2) 通常はOpenAIへ。ただし失敗しても必ず返信する
  try {
    const resp = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: "LINE向け日本語アシスタント。簡潔に丁寧に。" },
        { role: "user", content: userText }
      ],
    });

    const aiText =
      resp.output_text?.trim() ||
      (resp.output?.[0]?.content?.[0]?.text?.value ??
        "すみません、うまく答えられませんでした。");
    return client.replyMessage(event.replyToken, { type: "text", text: aiText });
  } catch (err) {
    console.error("OpenAI error:", err);
    // フォールバック（確実に1本返す）
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "（ただいまAI応答でエラーが出ました）\n「関連ワード」と送るとポリフォニーの用語リストを表示できます。",
    });
  }
}





/** ── ② Express/Webhook ── */
const app = express();
app.get("/", (_, res) => res.send("ok"));

app.post("/webhook", middleware(lineConfig), async (req, res) => {
  // 2秒ルール対策：処理は並行で進め、先に200を返す
  Promise.all(req.body.events.map(handleEvent)).catch(console.error);
  res.sendStatus(200);
});

/** ── ③ イベント処理：関連ワード or ChatGPT応答 ── */
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const userText = event.message.text;

  // 3-1) 関連ワードモード
  if (isRelatedQuery(userText)) {
    const text = formatRelatedTerms(POLYPHONY_RELATED_TERMS);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text,
      quickReply: {
        items: [
          { type: "action", action: { type: "message", label: "A型について", text: "A型の仕事内容を教えて" } },
          { type: "action", action: { type: "message", label: "B型について", text: "B型の訓練内容を教えて" } },
          { type: "action", action: { type: "message", label: "施設外就労", text: "施設外就労とは？" } }
        ]
      }
    });
  }

  // 3-2) それ以外はChatGPTで回答（トーンは日本語で簡潔）
  const resp = await openai.responses.create({
    model: "gpt-4o-mini",
    input: [
      {
        role: "system",
        content:
          "あなたはLINE用の日本語アシスタント。簡潔でやさしい言葉で、就労支援ポリフォニー（大阪市）に関する質問にも親切に回答します。"
      },
      {
        role: "user",
        content: userText
      }
    ]
  });

  const aiText =
    resp.output_text?.trim() ||
    (resp.output?.[0]?.content?.[0]?.text?.value ?? "すみません、うまく答えられませんでした。");

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: aiText
  });
}

const port = process.env.PORT || 3000;
export default app;
