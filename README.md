# 出店収支ノート（coffee-ledger）

岩間・小林・谷の3人で、コーヒーフェス出店の売上・経費・精算を記録するアプリです。
スマホのブラウザで開き、ホーム画面に追加すればアプリのように使えます。

## しくみ

| 役割 | 使っているもの |
| --- | --- |
| 画面（アプリ本体） | HTML / CSS / JavaScript（このフォルダ） |
| 公開 | GitHub Pages |
| データの保存 | Firebase Firestore（東京リージョン） |
| ログイン | Firebase Authentication（Googleログイン） |

## フォルダの中身

```
coffee-ledger/
├── index.html            画面の骨組み
├── css/style.css         見た目
├── js/app.js             動き（記録・集計・精算・ログイン）
├── js/firebase-config.js Firebaseの接続先
├── firestore.rules       だれが読み書きできるか（Firebaseに貼る用の控え）
├── manifest.webmanifest  ホーム画面に追加したときのアプリ名やアイコン
├── sw.js                 オフラインでも画面を開けるようにする仕組み
└── icons/                アプリのアイコン
```

## 公開のしかた（GitHub Pages）

1. このフォルダの中身をすべて、GitHubのリポジトリ `coffee-ledger` に置く
2. リポジトリの Settings → Pages で、Branch を `main` / `/ (root)` にして Save
3. 表示されたアドレス（`https://ユーザー名.github.io/coffee-ledger/`）を開く

初回だけ、Firebaseの Authentication → 設定 → 承認済みドメイン に
`ユーザー名.github.io` を追加しておく（しないとGoogleログインが失敗する）。

## メンバーを増やす・変える

- **ログインできる人**：Firebaseの Firestore → ルール で、メールアドレスの一覧に追加して「公開」。
  `firestore.rules` にも同じ内容を書いておくと控えになる。
- **画面に出る名前（岩間・小林・谷）**：`js/app.js` の `const PEOPLE=[...]` を書き換える。

## 画面を更新したとき

`sw.js` の `VERSION`（例：`'v1'` → `'v2'`）を1つ上げてからアップロードする。
上げないと、スマホに古い画面が残ることがある。

## 記録データのバックアップ

アプリの「記録」タブ →「CSVをコピー」で、表計算ソフトに貼り付けられる形でコピーできる。
