# aimo — AI Usage Monitor

A unified viewer for your **ZAI / Claude / Codex / Ollama Cloud** usage limits.
Bundles a Chromium extension and a local dashboard server.
**Zero-config for most providers** — reuses the browser session you're already logged into.

<p align="center">
  <img src="docs/aimo_top.png" alt="aimo — AI Usage Monitor: unified usage limits for Claude, Codex, ZAI, and Ollama Cloud">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/no%20polling-manual%20refresh%20only-22d3ee?style=flat-square" alt="No polling">
  <img src="https://img.shields.io/badge/no%20telemetry-local%20only-22d3ee?style=flat-square" alt="No telemetry">
  <img src="https://img.shields.io/badge/agent%20API-localhost%3A3030-22d3ee?style=flat-square" alt="Agent API">
  <img src="https://img.shields.io/badge/license-MIT-22d3ee?style=flat-square" alt="MIT license">
</p>

[🇺🇸 English](#english) · [🇯🇵 日本語](#日本語)

---

## English

### Why aimo?

AI tools are powerful, but their usage limits are fragmented.

Claude, Codex, ZAI, and Ollama Cloud each expose their limits in different places, with different reset windows, quota names, and usage formats. When you use multiple providers for coding, research, agents, or automation, checking "which model can I safely use now?" becomes a manual routine.

aimo solves that small but painful operational problem.

It gives you one local view of your current AI usage windows — no background polling, no cloud sync, no telemetry. Open the popup, refresh the dashboard, or let your local agent check the JSON API before dispatching a heavy refactor to the provider with the most headroom.

aimo is not a benchmark tool, a proxy, or an automation bot.

It is a fuel gauge for people who actively operate multiple AI systems.

### What it does

One extension popup + one local dashboard shows the current usage window for all four services:

| Provider | Windows shown | How it fetches |
|---|---|---|
| Claude | 5h / 7d all / 7d Sonnet / 7d Opus / extra credits | `claude.ai/api/organizations/{uuid}/usage` via your claude.ai session cookie |
| Codex | 5h / 7d + Spark limits | `chatgpt.com/backend-api/wham/usage` — session → `/api/auth/session` → Bearer |
| ZAI | whatever time / token windows the plan exposes (labels inferred from reset time) | `api.z.ai/api/monitor/usage/quota/limit` — JWT auto-captured from z.ai localStorage (API key fallback) |
| Ollama | session / weekly | `ollama.com/settings` HTML parse via session cookie |

### Update policy (TOS-safe)

**aimo does not poll.** Requests fire only when:

- you open the extension popup,
- you click the manual **Refresh** button on the dashboard or popup,
- you open the dashboard page (one fetch per open),
- an agent hits `GET /api/usage` or `POST /api/refresh`.

Each request retrieves exactly the same data the provider's own usage page would show you. aimo is unaffiliated with Anthropic, OpenAI, Z.ai, or Ollama; verify each provider's terms of service before using it on shared or commercial accounts.

Plan differences are handled gracefully: if a provider's response doesn't include a particular window (e.g. no Opus quota on Claude Max, no Spark on Codex Plus, no weekly on legacy ZAI plans), it's simply omitted from the output.

### Features

- **Zero API keys** for Claude / Codex / Ollama — browser cookies are enough
- **Optional API key** for ZAI (needed only if the z.ai JWT capture fails)
- Per-provider **enable/disable toggles** in Options
- Local **dashboard** at `http://localhost:3030` with auto-refresh on open
- **JSON API** for agents: `GET /api/usage` and `POST /api/refresh`
- **Bitwarden integration** for the ZAI API key (`bw get password zai-api-key`)
- Works on **Chrome**, **Brave**, and any Chromium-based browser

### Requirements

- Node.js 20+
- A Chromium-based browser logged into each provider you want to track
- (Optional) Bitwarden CLI unlocked for server-side ZAI fallback

### Install

```bash
git clone <this-repo> aimo
cd aimo
npm install            # only dependency is dotenv
```

**Load the extension**:

1. Open `chrome://extensions` (or `brave://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` folder

**Log into the providers you want to monitor** — nothing else to configure for Claude / Codex / Ollama. For ZAI, open `https://z.ai/` once while logged in (the extension captures the JWT from localStorage automatically).

### Run

**Dashboard server** (optional — extension works standalone):

```bash
node server.mjs
# → listening on http://localhost:3030
```

**CLI** (quick terminal view, no browser needed):

```bash
node cli.mjs              # pretty table
node cli.mjs --json       # machine-readable
```

### Agent / script API

```bash
curl -s http://localhost:3030/api/usage               # merged view, JSON
curl -sX POST http://localhost:3030/api/refresh       # set the pending flag, return current merged data
curl -sX POST http://localhost:3030/api/refresh?wait=10  # long-poll: wait up to 10s for the extension to push fresh data
curl -s http://localhost:3030/api/ping                # liveness probe
```

Server-side collectors (ZAI via Bitwarden / Codex via `~/.codex/auth.json`) run on every call.

`POST /api/refresh` also pokes the extension: it sets a pending flag that the extension's background alarm picks up on its next tick (≤ 1 minute), then runs a full fetch and pushes Ollama/Claude data back. Pass `?wait=N` (seconds, max 15) to long-poll until the push lands — the agent gets fresh data in a single round trip.

| condition | Claude / Ollama freshness |
| --- | --- |
| browser closed / extension disabled | stale (last push) |
| browser open, `POST /api/refresh`, **no** `wait` | fresh within ~1 minute (extension alarm picks up flag) |
| browser open, `POST /api/refresh?wait=15` | fresh in the same response if push arrives within the window |
| any user interaction (popup open, dashboard open, Refresh button) | fresh immediately |

<details>
<summary><b>Example response</b> (trimmed)</summary>

```json
[
  {
    "provider": "zai",
    "ok": true,
    "plan": "pro",
    "auth_source": "jwt",
    "windows": [
      { "label": "5h",                   "used_pct": 2, "resets_at": "2026-04-25T02:00:00Z" },
      { "label": "tool usage (monthly)", "used_pct": 4, "usage": 47, "remaining": 953, "resets_at": "2026-05-20T13:59:46Z" }
    ],
    "_source": "server"
  },
  {
    "provider": "claude",
    "ok": true,
    "plan": "default_claude_max_20x",
    "windows": [
      { "label": "session (5h)",  "used_pct": 15, "resets_at": "2026-04-25T13:20:00Z" },
      { "label": "weekly (all)",  "used_pct": 7,  "resets_at": "2026-04-26T18:00:01Z" },
      { "label": "weekly Sonnet", "used_pct": 4,  "resets_at": "2026-04-26T18:00:00Z" }
    ],
    "_source": "push",
    "_received_at": "2026-04-25T00:01:23Z"
  },
  {
    "provider": "codex",
    "ok": true,
    "plan": "prolite",
    "windows": [
      { "label": "session (5h)", "used_pct": 1,  "resets_at": "2026-04-25T02:00:00Z" },
      { "label": "weekly (7d)",  "used_pct": 16, "resets_at": "2026-04-29T00:00:00Z" }
    ],
    "_source": "server"
  },
  {
    "provider": "ollama",
    "ok": true,
    "plan": "pro",
    "windows": [
      { "label": "session", "used_pct": 0.2, "resets_in": "2 hours" },
      { "label": "weekly",  "used_pct": 1.5, "resets_in": "2 days" }
    ],
    "_source": "push",
    "_received_at": "2026-04-25T00:01:23Z"
  }
]
```

Each entry has `provider`, `ok`, `plan`, a `windows` array with `used_pct` and reset info, and a `_source` field (`server` = freshly fetched, `push` = cached from the extension).

</details>

### Route work to the provider with the most headroom

A common use case for the JSON API: before dispatching an expensive prompt, pick whichever provider is furthest from hitting its tightest limit.

```js
// pick-provider.mjs
const results = await fetch('http://localhost:3030/api/usage').then(r => r.json());

const headroom = (p) => {
  if (!p.ok || !p.windows?.length) return -1;
  const peak = Math.max(...p.windows.map((w) => w.used_pct ?? 0));
  return 100 - peak;
};

const ranked = results.filter((p) => p.ok).sort((a, b) => headroom(b) - headroom(a));
const pick = ranked[0];

console.log(`Dispatch to ${pick.provider} — ${headroom(pick).toFixed(1)}% headroom on its tightest window`);
```

This picks the provider whose most-used window still has the most room. Swap in your own logic — e.g. weight by model capability, treat `used_pct > 90` as a hard no, or combine with cost.

### Options page

- **Providers** — check/uncheck to hide unused providers (stops fetching too)
- **Server** — status dot, "Recheck", copy the start command
- **For agents / scripts** — copy-paste curl snippets
- **Auto-auth status** — ZAI JWT capture indicator + "Open z.ai" button
- **Quick links** — direct links to each provider's usage page

### Privacy

- Auth tokens live in `chrome.storage.local` (per-browser, not synced)
- `.env` is git-ignored; the ZAI API key (if stored there) never leaves your machine
- The only outbound requests are to the provider APIs you're already using

### Architecture

```
aimo/
├── server.mjs              HTTP server (dashboard + /api/usage + /ingest)
├── cli.mjs                 terminal viewer
├── lib/env-resolver.mjs    Bitwarden CLI fallback
├── collectors/             server-side collectors (zai, codex, claude stub, ollama)
└── extension/              Manifest V3 extension
    ├── manifest.json
    ├── background.js       service worker — fetch + /ingest push
    ├── fetchers.js         per-provider fetch + parse
    ├── popup.html / .js    the extension popup UI
    ├── options.html / .js  setup page
    ├── content-bridge.js   injected on localhost:3030 (relays refresh)
    └── content-zai.js      injected on z.ai (captures JWT)
```

### License

MIT.

---

## 日本語

### なぜ aimo？

AI ツールは強力だが、使用制限は分断されている。

Claude / Codex / ZAI / Ollama Cloud はそれぞれ別の場所で、別のリセット窓、別のクォータ名、別のフォーマットで制限を表示する。コーディング・リサーチ・エージェント・自動化で複数プロバイダを使っていると、「今どのモデルなら安全に使えるか？」の確認が手動のルーチン作業になる。

aimo はこの小さいが地味に痛い運用上の問題を解く。

ローカルに 1 つのビューで現在の AI 使用量ウィンドウを表示する — バックグラウンド poll なし、クラウド同期なし、テレメトリなし。ポップアップを開く、ダッシュボードを Refresh する、あるいはローカルのエージェントが JSON API を叩いて「一番余裕のあるプロバイダ」にヘビーなリファクタを投げる前のチェックに使える。

aimo はベンチマークツールでも、プロキシでも、自動化 bot でもない。

複数 AI システムを能動的に運用する人のための **燃料計（fuel gauge）** だ。

### 何をするツールか

1つの拡張ポップアップ + 1つのローカルダッシュボードで、4 サービスの現在の使用量ウィンドウをまとめて表示する。

| プロバイダ | 表示する項目 | 取得経路 |
|---|---|---|
| Claude | 5時間 / 週間 all / 週間 Sonnet / 週間 Opus / 追加クレジット | `claude.ai/api/organizations/{uuid}/usage`（claude.ai セッション Cookie）|
| Codex | 5時間 / 週間 + Spark 制限 | `chatgpt.com/backend-api/wham/usage` — セッション → `/api/auth/session` → Bearer |
| ZAI | プランが返す時間・トークン系ウィンドウ（ラベルは reset 時刻から自動推定）| `api.z.ai/api/monitor/usage/quota/limit` — z.ai localStorage から JWT 自動捕獲（API key フォールバックあり）|
| Ollama | セッション / 週間 | `ollama.com/settings` の HTML パース（セッション Cookie）|

### 更新ポリシー（TOS 配慮）

**aimo はバックグラウンド poll しない。** リクエストが飛ぶのは次のタイミングのみ：

- 拡張ポップアップを開いた時
- ダッシュボード/ポップアップの **Refresh** ボタンを押した時
- ダッシュボードページを開いた時（1 回 fetch）
- エージェントが `GET /api/usage` / `POST /api/refresh` を叩いた時

各リクエストで取得するのは、各プロバイダの自分の使用量ページに表示されるのと同じデータ。aimo は Anthropic / OpenAI / Z.ai / Ollama とは無関係。共有アカウントや商用アカウントで使う場合は各社の TOS を確認してください。

プラン差分はデータ駆動で処理される：レスポンスに含まれないウィンドウ（Claude Max で Opus 枠がない、Codex Plus で Spark がない、レガシー ZAI プランで週制限がない等）は単純に表示から省かれる。

### 特徴

- **API キー不要**で Claude / Codex / Ollama が動く — ブラウザの Cookie だけで OK
- **ZAI のみ**任意で API key（z.ai の JWT 捕獲に失敗した場合のフォールバック）
- Options ページで**プロバイダごとの有効/無効切替**
- ローカル **ダッシュボード** `http://localhost:3030`（開いた時に自動 refresh）
- エージェント向け **JSON API**：`GET /api/usage` と `POST /api/refresh`
- **Bitwarden 連携**で ZAI API key を自動解決（`bw get password zai-api-key`）
- **Chrome** / **Brave** など Chromium 系ブラウザで動作

### 必要なもの

- Node.js 20 以上
- 監視したい各プロバイダにログイン済みの Chromium 系ブラウザ
- （任意）Bitwarden CLI（サーバー側 ZAI フォールバック用）

### インストール

```bash
git clone <このリポジトリ> aimo
cd aimo
npm install            # 依存は dotenv だけ
```

**拡張の読み込み**：

1. `chrome://extensions`（または `brave://extensions`）を開く
2. **デベロッパーモード** を ON
3. **パッケージ化されていない拡張機能を読み込む** → `extension/` フォルダを選択

**監視したいプロバイダにログイン**するだけで Claude / Codex / Ollama は動く。ZAI は `https://z.ai/` を一度開けば（ログイン済み状態で）拡張が localStorage から JWT を自動キャプチャする。

### 起動

**ダッシュボードサーバー**（任意、拡張だけでも動く）：

```bash
node server.mjs
# → http://localhost:3030 で待機
```

**CLI**（ブラウザ不要でサクッとターミナルで見る）：

```bash
node cli.mjs              # 整形表示
node cli.mjs --json       # JSON 出力
```

### エージェント/スクリプト向け API

```bash
curl -s http://localhost:3030/api/usage                  # マージ済みビュー、JSON
curl -sX POST http://localhost:3030/api/refresh          # pending フラグを立てて、現在のマージ済みデータを返す
curl -sX POST http://localhost:3030/api/refresh?wait=10  # 長ポーリング: 拡張からの push を最大10秒待ってから返す
curl -s http://localhost:3030/api/ping                   # 生存確認
```

サーバー側の収集（ZAI は Bitwarden / Codex は `~/.codex/auth.json`）は毎コール走る。

`POST /api/refresh` は拡張への **「refresh 要求」フラグ** も立てる。ブラウザが起動していれば、拡張の background alarm が最大 1 分以内にこのフラグを拾って、Claude/Ollama を fetch してサーバーに push し戻す。`?wait=N`（秒、最大 15）を付けると push 到着まで長ポーリングするので、エージェントが 1 回の呼び出しで fresh データを取れる。

| 条件 | Claude / Ollama の鮮度 |
| --- | --- |
| ブラウザ閉じてる / 拡張無効 | 古いまま（直近 push）|
| ブラウザ開いてる、`POST /api/refresh`（`wait` なし）| 約 1 分以内に fresh（拡張 alarm がフラグを拾う）|
| ブラウザ開いてる、`POST /api/refresh?wait=15` | push が間に合えば同じレスポンスで fresh |
| ユーザー操作（ポップアップ開、ダッシュボード開、Refresh ボタン）| 即 fresh |

<details>
<summary><b>レスポンス例</b>（抜粋）</summary>

```json
[
  {
    "provider": "zai",
    "ok": true,
    "plan": "pro",
    "auth_source": "jwt",
    "windows": [
      { "label": "5h",                   "used_pct": 2, "resets_at": "2026-04-25T02:00:00Z" },
      { "label": "tool usage (monthly)", "used_pct": 4, "usage": 47, "remaining": 953, "resets_at": "2026-05-20T13:59:46Z" }
    ],
    "_source": "server"
  },
  {
    "provider": "claude",
    "ok": true,
    "plan": "default_claude_max_20x",
    "windows": [
      { "label": "session (5h)",  "used_pct": 15, "resets_at": "2026-04-25T13:20:00Z" },
      { "label": "weekly (all)",  "used_pct": 7,  "resets_at": "2026-04-26T18:00:01Z" },
      { "label": "weekly Sonnet", "used_pct": 4,  "resets_at": "2026-04-26T18:00:00Z" }
    ],
    "_source": "push",
    "_received_at": "2026-04-25T00:01:23Z"
  },
  {
    "provider": "codex",
    "ok": true,
    "plan": "prolite",
    "windows": [
      { "label": "session (5h)", "used_pct": 1,  "resets_at": "2026-04-25T02:00:00Z" },
      { "label": "weekly (7d)",  "used_pct": 16, "resets_at": "2026-04-29T00:00:00Z" }
    ],
    "_source": "server"
  },
  {
    "provider": "ollama",
    "ok": true,
    "plan": "pro",
    "windows": [
      { "label": "session", "used_pct": 0.2, "resets_in": "2 hours" },
      { "label": "weekly",  "used_pct": 1.5, "resets_in": "2 days" }
    ],
    "_source": "push",
    "_received_at": "2026-04-25T00:01:23Z"
  }
]
```

各エントリは `provider` / `ok` / `plan` / `windows`（`used_pct` とリセット情報）/ `_source` を持つ。`_source: "server"` はサーバー側で都度取得、`"push"` は拡張から送られたキャッシュ。

</details>

### エージェント連携例：余裕のあるプロバイダに仕事を振る

JSON API の典型的な使い所：重めのプロンプトを投げる前に、一番タイトな制限からまだ離れてるプロバイダを選ぶ。

```js
// pick-provider.mjs
const results = await fetch('http://localhost:3030/api/usage').then(r => r.json());

const headroom = (p) => {
  if (!p.ok || !p.windows?.length) return -1;
  const peak = Math.max(...p.windows.map((w) => w.used_pct ?? 0));
  return 100 - peak;
};

const ranked = results.filter((p) => p.ok).sort((a, b) => headroom(b) - headroom(a));
const pick = ranked[0];

console.log(`${pick.provider} に振る — 最もタイトな窓でも ${headroom(pick).toFixed(1)}% 余裕あり`);
```

各プロバイダで「最も使用率の高い窓」の残量を見て、その残量が最大のプロバイダを選ぶ。独自のロジックに差し替え可能 — モデル性能で重み付け、`used_pct > 90` を hard-no にする、コストと組み合わせる、など。

### Options ページ

- **Providers** — 使わないプロバイダをチェック外しで非表示（fetch も止まる）
- **Server** — 生存インジケータ、Recheck、起動コマンドをコピー
- **For agents / scripts** — curl コマンドをコピペ用に表示
- **Auto-auth status** — ZAI JWT キャプチャ状態 + 「Open z.ai」ボタン
- **Quick links** — 各プロバイダの usage ページへ直接遷移

### プライバシー

- 認証トークンは `chrome.storage.local` に保存（ブラウザローカル、同期なし）
- `.env` は git-ignore 済み。ZAI API key をそこに置いてもマシン外に出ない
- 外向き通信は既にあなたが使っているプロバイダの API のみ

### 構成

```
aimo/
├── server.mjs              HTTP サーバー（ダッシュボード + /api/usage + /ingest）
├── cli.mjs                 ターミナルビューア
├── lib/env-resolver.mjs    Bitwarden CLI フォールバック
├── collectors/             サーバー側 collectors（zai, codex, claude スタブ, ollama）
└── extension/              Manifest V3 拡張
    ├── manifest.json
    ├── background.js       service worker — fetch + /ingest push
    ├── fetchers.js         各プロバイダの fetch + パース
    ├── popup.html / .js    拡張ポップアップ UI
    ├── options.html / .js  設定ページ
    ├── content-bridge.js   localhost:3030 に注入（refresh リレー）
    └── content-zai.js      z.ai に注入（JWT キャプチャ）
```

### ライセンス

MIT
