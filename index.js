// package.json に "type": "module"
import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import OpenAI from "openai";

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(lineConfig);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const POLYPHONY_RELATED_TERMS = [
  "就労継続支援A型","就労継続支援B型","施設外就労","施設外支援","一般就労","通過施設",
  "Web制作","デザイン","ECサイト制作","データ入力","清掃","飲食店業務","ミシン軽作業",
  "ソーシャルワーク","相談支援","計画相談","多様性","生き方","ソーシャルキャピタル（社会関係資本）",
  "大阪市","大阪市西区南堀江","一般社団法人ダイアロゴス",
  "障害福祉サービス","生活困窮","アディクション","刑余者支援","発達障害支援","職業センター"
];

function isRelatedQuery(text){ return /関連ワード|キーワード|ハッシュタグ|ポリフォニー|就労支援/i.test(text.trim()); }
function formatRelatedTerms(terms){
  const bullets = terms.map(t=>`・${t}`).join("\n");
  return `【ポリフォニー関連ワード】\n${bullets}\n\n（例）知りたい分野を送ってください：\n「A型の仕事内容」「B型の訓練」「施設外就労とは？」`;
}

const app = express();
app.get("/", (_,res)=>res.send("ok"));

app.post("/webhook", middleware(lineConfig), async (req,res)=>{
  // 先に200（LINEの2秒制限対策）
  res.sendStatus(200);
  // 個々のイベント処理（失敗はログして無視）
  for (const ev of req.body.events){
    handleEvent(ev).catch(e=>console.error("[webhook] handleEvent error:", e));
  }
});

async function handleEvent(event){
  if (event.type !== "message" || event.message.type !== "text") return;
  const userText = event.message.text;
  console.log("[webhook] recv:", userText);

  // 1) 関連ワード（OpenAIなし）
  if (isRelatedQuery(userText)){
    const text = formatRelatedTerms(POLYPHONY_RELATED_TERMS);
    return client.replyMessage(event.replyToken, { type:"text", text });
  }

  // 2) ChatGPT（失敗時はフォールバック）
  try{
    const resp = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role:"system", content:"あなたはLINE向けの日本語アシスタント。簡潔で丁寧に答えてください。" },
        { role:"user", content: userText }
      ]
    });
    const aiText =
      resp.output_text?.trim() ||
      (resp.output?.[0]?.content?.[0]?.text?.value ?? "すみません、うまく答えられませんでした。");

    return client.replyMessage(event.replyToken, { type:"text", text: aiText });
  }catch(err){
    console.error("[webhook] OpenAI error:", err);
    return client.replyMessage(event.replyToken, {
      type:"text",
      text:"（AI応答でエラーが発生しました）\n「関連ワード」と送るとポリフォニーの用語リストを表示できます。"
    });
  }
}

export default app;
