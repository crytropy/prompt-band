# prompt-band
用量資訊列

輸入框上方的一列資訊：左邊是用量（Context、5 小時、每週），右邊是主對話 1 小時快取的倒數。

## 安裝

```
/plugin marketplace add crytropy/prompt-band
/plugin install prompt-band@prompt-band
```

要讓某個 repo 的 session（含雲端 session）自動載入，在那個 repo 的 `.claude/settings.json` 加上：

```json
{
  "extraKnownMarketplaces": {
    "prompt-band": { "source": { "source": "github", "repo": "crytropy/prompt-band" } }
  },
  "enabledPlugins": { "prompt-band@prompt-band": true }
}
```
