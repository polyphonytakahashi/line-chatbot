import { Client } from "@line/bot-sdk";
import OpenAI from "openai";

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TERMS = [
  "就労継続支援A型","就労継続支援B型","施設外就労","施設外支援","一般就労","通過施設",
  "Web制作","デザイン","ECサイト制作","データ入力","清掃","飲食店業務","ミシン軽作業",
  "ソーシャルワーク","相談支援","計画相談","多様性","生き方","ソーシャルキャピタル（社会関係資本）",
  "大阪市","大阪市西区南堀江","一般社団法人ダイアロゴス",
  "障害福祉サービス","生活困窮","アディクション","刑余者支援","発達障害支援","職業センター"
];
const isRelated = (t)=>/関連ワード|キーワード|ハッシュタグ|ポリフォニー|就労支援/i.test((t||"").trim());
const fmt = (arr)=>`【ポリフォニー関連ワード】
${arr.map(t=>`・${t}`).join("\n")}

（例）知りたい分野を送ってください：
「A型の仕事内容」「B型の訓練」「施設外就労とは？」`;

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
  const text = event.message.text;

  if (isRelated(text)) {
    return client.replyMessage(event.replyToken, { type: "text", text: fmt(TERMS) });
  }

  try {
    const resp = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: "あなたはLINE向け日本語アシスタント。簡潔で丁寧に答えてください。" },
        { role: "user", content: text }
      ]
    });
    const aiText =
      resp.output_text?.trim() ||
      (resp.output?.[0]?.content?.[0]?.text?.value ?? "すみません、うまく答えられませんでした。");
    return client.replyMessage(event.replyToken, { type: "text", text: aiText });
  } catch (err) {
    console.error("[api/webhook] OpenAI error:", err);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "（AI応答でエラーが発生しました）\n「関連ワード」と送るとポリフォニーの用語リストを表示できます。"
    });
  }
}
