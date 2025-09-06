// api/webhook.js
export default async function handler(req, res) {
  // 動作しているか確認用：GET/POSTどちらでも "ok" を返す
  res.status(200).send("ok");
}
