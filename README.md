# prompt-band
用量資訊列

輸入框上方的一列資訊：左邊是用量（Context、5 小時、Fable 每週、每週），右邊是主對話 1 小時快取的倒數。

```text
☂ Showers 67%  134.4k/200k  ▲ +98.3k   ·   5h 30% (resets in 2h10m)   ·   Fable 23%   ·   Week 12%     快取剩 52:13
```

Context 用天氣表示有多滿，後面是用掉的 token／整個視窗，和上一輪多用了多少（▲ 變多、▼ 變少）。終端機太窄時，▲ 那段會先藏起來。

`Fable` 是 Fable 這個模型自己的每週用量。session 的用量資料裡沒有這個數字，所以外掛會用目前登入的帳號去讀 `/api/oauth/usage`（和 `/usage` 看到的是同一份），最多每 5 分鐘讀一次。帳號沒有 Fable 的每週額度、用的是 API key 或第三方供應商，這一段就不顯示。

| 用量 | 天氣 |
|---|---|
| 未滿 25% | ☀ Clear |
| 25–49% | ☁ Cloudy |
| 50–74% | ☂ Showers |
| 75–89% | ☇ Storm |
| 90% 以上 | ↯ Compact soon |

Context 的天氣顯示參考 Anthropic 的 [Token Weather](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather)（Apache-2.0）。

## 兩個版本

| 版本 | 給誰用 | 左邊顯示 |
|---|---|---|
| `prompt-band` | Pro、Max | Context、5 小時、Fable 每週、每週 |
| `prompt-band-ultra` | Ultra（沒有 5 小時限制） | Context、Fable 每週、每週 |

```text
☂ Showers 67%  134.4k/200k  ▲ +98.3k   ·   Fable 23%   ·   Week 12%     快取剩 52:13
```

Ultra 帳號在驗證完成前，用量裡還是會有 5 小時的數字；`prompt-band-ultra` 一律不顯示。

兩個版本只能裝一個，同時啟用會畫出兩列。

## 安裝（本機）

先加 marketplace：

```
/plugin marketplace add crytropy/prompt-band
```

再開 `/plugin`，到 `prompt-band` marketplace 裡挑一個版本安裝。也可以直接下指令：

```
/plugin install prompt-band@prompt-band
/plugin install prompt-band-ultra@prompt-band
```

從一般版換成 Ultra 版：

```
/plugin uninstall prompt-band@prompt-band
/plugin install prompt-band-ultra@prompt-band
```

要讓某個 repo 在本機開的 session 自動載入，在那個 repo 的 `.claude/settings.json` 加上：

```json
{
  "extraKnownMarketplaces": {
    "prompt-band": { "source": { "source": "github", "repo": "crytropy/prompt-band" } }
  },
  "enabledPlugins": { "prompt-band@prompt-band": true }
}
```

這段設定只對本機 session 有效。雲端 session 不會安裝 repo 設定或使用者設定裡的外掛，見官方文件 [What carries over from your setup](https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup)。

## 雲端 session（未驗證）

> ⚠️ 這個做法還沒實際驗證過，雲端介面也不一定會畫出輸入框上方的資訊列。

雲端 session 跑在雲端環境（environment）裡，環境和 repo 是分開選的。設定一次環境，用這個環境開的雲端 session 都會套用，不管開在哪個 repo。在 claude.ai/code 的環境設定裡：

1. **Setup script** 加上：

   ```bash
   git clone --depth 1 https://github.com/crytropy/prompt-band /opt/prompt-band
   ```

2. **Environment variables** 加上：

   ```
   CLAUDE_CODE_PLUGIN_DIRS=/opt/prompt-band/prompt-band
   ```

   Ultra 版改成 `CLAUDE_CODE_PLUGIN_DIRS=/opt/prompt-band/prompt-band-ultra`。

設定好後開一個新的雲端 session，看輸入框上方有沒有出現資訊列。
