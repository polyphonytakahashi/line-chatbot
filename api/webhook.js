// api/webhook.js
import { Client } from "@line/bot-sdk";
import OpenAI from "openai";

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** ===== 店舗定義 / 画像URL / 位置情報 ===== */
const STORE_NAME = "南堀江の隠れ家カフェ＆バル　カフェポリフォニー";

const IMG = {
  // ←あなたの本番ドメインに差し替え
  menu: "https://line-chatbot-tau.vercel.app/menu.png",
};

const PLACE = {
  title: "カフェポリフォニー",
  address: "大阪市西区南堀江3-15-7 堀江ヴィラ 1F",
  // ←実値に修正してください（環境変数でも上書き可）
  lat: Number(process.env.PLACE_LAT) || 34.6711232,
  lng: Number(process.env.PLACE_LNG) || 135.4877019,
};

const BUILD = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local";

/** ===== 手動対応モード（ハンドオフ）設定 =====
 * - 簡易メモリ（リスタートで消える可能性あり）
 * - TTL 既定 90 分（環境変数 HANDOFF_TTL_MIN で上書き）
 */
const HANDOFF_TTL_MIN = Number(process.env.HANDOFF_TTL_MIN) || 90;
const handoffMem = new Map(); // key=userId, val={until:number}

function handoffGet(userId) {
  const v = handoffMem.get(userId);
  if (!v) return null;
  if (Date.now() > v.until) {
    handoffMem.delete(userId);
    return null;
  }
  return v;
}
function handoffSet(userId, minutes = HANDOFF_TTL_MIN) {
  handoffMem.set(userId, { until: Date.now() + minutes * 60 * 1000 });
}
function handoffClear(userId) {
  handoffMem.delete(userId);
}

/** ===== 固定返答 ===== */
const FIXED = {
  "店舗名": STORE_NAME,
  "営業時間":
    "ランチ 11:30 - 13:30 (L.O. 13:00)\n※ランチメニューは無くなり次第終了となります。\n※価格はすべて税込み。",
  "定休日": "不定期です。",
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

/** ===== 関連ワード表示 ===== */
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

/** ===== テキスト前処理＆マッチ ===== */
const norm = (s="") => s.toLowerCase().replace(/\s+/g,"").replace(/[！!？?。、・,.]/g,"");
const anyMatch = (text, patterns) => patterns.some(p => p.test(norm(text||"")));

/** あいさつ */
const isGreeting = (t="") =>
  anyMatch(t, [/こんにちは|こんちは|こんにちわ/, /はじめまして|初めまして/, /おはよう/, /こんばんは/, /hi|hello|hey/]);

/** メニュー画像 */
const wantsMenuImage = (t="") =>
  anyMatch(t, [
    /(ﾒﾆｭｰ|メニュー|menu)/,
    /(何がある|なにがある|何ある|なにある|ごはん|フード|食事)/,
    /(見せて|教えて|おしえて|ありますか|ある？)/,
  ]);

/** アクセス（地図） */
const wantsPlace = (t="") =>
  anyMatch(t, [/(アクセス|場所|どこ|地図|map|行き方|道順|住所|最寄|駅|南堀江|桜川)/]);

/** 予約 → ハンドオフ開始 / 終了合図 */
const wantsHandoffStart = (t="") =>
  anyMatch(t, [/(予約|リザーブ|book|席|席取|取りたい|取れ|コース|貸切|人数|日時|希望)/]);
const wantsHandoffEnd = (t="") =>
  anyMatch(t, [/(予約終了|対応終了|終了|おわり|終わり|cancel|キャンセル完了)/]);

/** 意図マップ（固定テキスト） */
const INTENTS = [
  { key: "ランチメニュー", patterns: [/ランチ/, /(ﾒﾆｭｰ|メニュー|めにゅー)/, /(ごはん|フード|食事|昼|昼飯)/, /(日替|今日).*(おすすめ|本日)/, /(おすすめ).*(メニュー|ﾒﾆｭｰ|ランチ)/, /(見せて|教えて|おしえて).*(メニュー|ﾒﾆｭｰ|ランチ)/], replyKey: "ランチメニュー" },
  { key: "追加オプション", patterns: [/(追加|オプション|セット)/, /(ﾄﾞﾘﾝｸ|ドリンク|飲み物).*(ｾｯﾄ|セット|追加)/, /(ﾃﾞｻﾞｰﾄ|デザート|スイーツ)/], replyKey: "追加オプション" },
  { key: "営業時間", patterns: [/(営業時間|オープン|open|何時|いつまで|ラスト|lo|l\.o)/], replyKey: "営業時間" },
  { key: "定休日", patterns: [/(定休日|休み|休業|クローズ|close)/], replyKey: "定休日" },
  { key: "アクセス", patterns: [/(場所|どこ|住所|行き方|道順|アクセス|地図|マップ|MAP|最寄|駅|南堀江|桜川)/], replyKey: "アクセス" },
  { key: "電話", patterns: [/(電話|tel|でんわ|連絡|問い合わせ|call|コール)/], replyKey: "電話" },
  // 予約は固定文を返さず、ハンドオフへ誘導するのでここには入れない
  { key: "関連ワード", patterns: [/(関連|ﾜｰﾄﾞ|キーワード|keyword|ﾍﾙﾌﾟ|help|一覧)/], reply: () => relatedList() },
];

/** AIに渡す事実 */
const FACTS = `
【店舗名】${FIXED["店舗名"]}
【住所】${FIXED["アクセス"]}
【電話】${FIXED["電話"]}
【営業時間】${FIXED["営業時間"]}
【定休日】${FIXED["定休日"]}
${FIXED["ランチメニュー"]}

【ルール】
- 回答は上記の事実のみ。推測・創作は禁止。
- 不明点は「公式情報をご確認ください」と案内。
- 価格は税込み。ランチは無くなり次第終了。
`;

/** ===== Webhook ===== */
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
  const userId = event.source?.userId || "unknown";
  console.log("[recv]", text, `user=${userId}`);

  /** 0) まず「ハンドオフ終了」の合図を先に見る */
  if (wantsHandoffEnd(text)) {
    if (handoffGet(userId)) {
      handoffClear(userId);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "ありがとうございました。自動応答を再開します。\nご不明点は「ランチ」「アクセス」などとお送りください。",
      });
    }
    // 既にハンドオフでなければ通常処理へ
  }

  /** 1) ハンドオフ中なら『完全に黙る』（返信しない） */
  const ho = handoffGet(userId);
  if (ho) {
    console.log(`[handoff] silent (until ${new Date(ho.until).toISOString()}) user=${userId}`);
    return; // 何も返さない
  }

  /** 2) あいさつ → ウェルカム */
  if (isGreeting(text)) {
    const welcome =
      `こんにちは！『${STORE_NAME}』のご案内です。\n` +
      `・ランチ →「ランチ」\n・追加オプション →「追加オプション」\n・営業時間/定休日 →「営業時間」「定休日」\n・アクセス/電話/予約 →「アクセス」「電話」「予約」\n` +
      `メニュー画像をご希望なら「メニュー見せて」とお送りください。`;
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: welcome,
      quickReply: {
        items: [
          { type: "action", action: { type: "message", label: "ランチ", text: "ランチ" } },
          { type: "action", action: { type: "message", label: "追加オプション", text: "追加オプション" } },
          { type: "action", action: { type: "message", label: "営業時間", text: "営業時間" } },
          { type: "action", action: { type: "message", label: "アクセス", text: "アクセス" } },
          { type: "action", action: { type: "message", label: "メニュー画像", text: "メニュー見せて" } },
        ],
      },
    });
  }

  /** 3) アクセス（地図）→ 位置情報 */
  if (wantsPlace(text)) {
    console.log(`[place] build=${BUILD} lat=${PLACE.lat} lng=${PLACE.lng}`);
    return client.replyMessage(event.replyToken, {
      type: "location",
      title: PLACE.title,
      address: PLACE.address,
      latitude: PLACE.lat,
      longitude: PLACE.lng,
    });
  }

  /** 4) メニュー画像 */
  if (wantsMenuImage(text)) {
    console.log("[menu image send]", IMG.menu);
    return client.replyMessage(event.replyToken, {
      type: "image",
      originalContentUrl: IMG.menu,
      previewImageUrl: IMG.menu,
    });
  }

  /** 5) 予約 → ハンドオフ開始（以降は黙る） */
  if (wantsHandoffStart(text)) {
    handoffSet(userId);
    console.log(`[handoff] start user=${userId} ttlMin=${HANDOFF_TTL_MIN}`);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        "スタッフにお繋ぎします。予約の希望日時・人数・お名前・電話番号などをメッセージでお送りください。\n" +
        "※この間は自動応答を停止します。対応が終わったら「予約終了」と送ってください。",
    });
  }

  /** 6) 固定返答（部分一致） */
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

  /** 7) 完全一致の固定返答（保険） */
  if (FIXED[text]) {
    return client.replyMessage(event.replyToken, { type: "text", text: FIXED[text] });
  }

  /** 8) それ以外は AI（事実同梱） */
  try {
    const resp = await openai.responses.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      input: [
        { role: "system", content: "あなたはカフェの案内アシスタント。誤情報の出力は禁止です。" },
        { role: "user", content: `以下の「確定情報」だけで回答してください。不明な点は「公式情報をご確認ください」と案内してください。\n\n${FACTS}\n\n【ユーザーの質問】\n${text}` },
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
      text: "（AI応答でエラーが出ました）\n「ランチ」「営業時間」「アクセス」「予約」「メニュー見せて」などでお試しください。",
    });
  }
}
