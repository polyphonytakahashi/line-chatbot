import { Client } from "@line/bot-sdk";
import OpenAI from "openai";

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** ── 店舗定義 ── */
const STORE_NAME = "南堀江の隠れ家カフェ＆バル　カフェポリフォニー";

/** ── 固定返答（更新しやすいように一箇所に集約） ── */
const FIXED = {
  "店舗名": STORE_NAME,
  "営業時間":
    "ランチ 11:30 - 13:30 (L.O. 13:00)\n※ランチメニューは無くなり次第終了となります。",
  "定休日": "毎週火曜日が定休日です。",
  "アクセス":
    "〒550-0015 大阪市西区南堀江3-15-7 堀江ヴィラ 1F\n最寄駅：四ツ橋駅から徒歩5分。",
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

/** ── “関連ワード”の表示（ヘルプ一覧） ── */
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

/** ── 文字前処理（大文字小文字・空白・記号をほどよく吸収） ── */
function norm(s = "") {
  return s
    .toLowerCase()
    .replace(/\s+/g, "")       // 全空白除去
    .replace(/[！!？?。、・,.]/g, ""); // よくある記号除去
}

/** ── 部分一致ヘルパー：どれか1つでも正規表現に当たればtrue ── */
function anyMatch(text, patterns) {
  const n = norm(text);
  return patterns.some(p => p.test(n));
}

/** ── 意図マップ：言い換え・部分表現に広く対応 ──
 *  左から順に評価（上にあるほど優先）。
 *  patterns は “norm後の文字列” に対して評価されます。
 */
const INTENTS = [
  {
    key: "ランチメニュー",
    patterns: [
      /ランチ/,                      // 例: ランチ, きょうのランチ
      /(ﾒﾆｭｰ|めにゅー|メニュー)/,   // メニュー
      /(ごはん|フード|食べ物|食事|昼ごはん|昼飯)/,
      /(本日|今日).*(おすすめ|日替|きょう)/,
      /(おすすめ).*(ﾒﾆｭｰ|メニュー|ランチ)/,
      /(何|なに).*(ある|あります|食べられる)/,
      /(見せて|教えて|おしえて).*(ﾒﾆｭｰ|メニュー|ランチ)/,
    ],
    replyKey: "ランチメニュー",
  },
  {
    key: "追加オプション",
    patterns: [
      /(追加|オプション|セット)/,
      /(ﾄﾞﾘﾝｸ|ドリンク|飲み物).*(ｾｯﾄ|セット|追加)/,
      /(ﾃﾞｻﾞｰﾄ|デザート|甘い|スイーツ)/,
    ],
    replyKey: "追加オプション",
  },
  {
    key: "営業時間",
    patterns: [/(営業時間|オープン|open|何時|いつまで|ラスト|lo|l\.o)/],
    replyKey: "営業時間",
  },
  {
    key: "定休日",
    patterns: [/(定休日|休み|休業|クローズ|close)/],
    replyKey: "定休日",
  },
  {
    key: "アクセス",
    patterns: [/(場所|どこ|住所|行き方|道順|アクセス|地図|最寄|駅|南堀江)/],
    replyKey: "アクセス",
  },
  {
    key: "電話",
    patterns: [/(電話|tel|でんわ|連絡|問い合わせ|call|コール)/],
    replyKey: "電話",
  },
  {
    key: "予約",
    patterns: [/(予約|リザーブ|book|取れ|取りたい|席|貸切|コース)/],
    replyKey: "予約",
  },
  {
    key: "関連ワード",
    patterns: [/(関連|ﾜｰﾄﾞ|キーワード|keyword|ﾍﾙﾌﾟ|help|一覧)/],
    reply: () => relatedList(),
  },
];

/** ── Webhook メイン ── */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("ok");

  // 署名検証を戻したい場合は validateSignature を利用（省略中）
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
  const text = (event.message.text || "").trim();
  console.log("[recv]", text);

  /** 1) 部分一致で意図判定（最優先） */
  for (const intent of INTENTS) {
    if (anyMatch(text, intent.patterns)) {
      // 固定返答キーがある場合
      if (intent.replyKey && FIXED[intent.replyKey]) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: FIXED[intent.replyKey],
        });
      }
      // カスタム返信関数がある場合
      if (intent.reply) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: intent.reply(),
        });
      }
    }
  }

  /** 2) 店名や単語の完全一致（万一の保険） */
  if (FIXED[text]) {
    return client.replyMessage(event.replyToken, { type: "text", text: FIXED[text] });
  }

  /** 3) それ以外はAI回答（店舗案内トーン） */
  try {
    const resp = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            `あなたは『${STORE_NAME}』の案内アシスタントです。` +
            "ランチメニュー・追加オプション・営業時間・定休日・アクセス・電話・予約について、" +
            "簡潔で丁寧に日本語で案内してください。"
        },
        { role: "user", content: text },
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
      text:
        "（AI応答でエラーが出ました）\n「ランチ」「メニュー」「営業時間」「アクセス」「電話」「予約」などと送ってみてください。",
    });
  }
}
