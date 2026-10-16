# prompt-band
用量資訊列

輸入框上方的一列資訊：左邊是用量（Context、5 小時、每週），右邊是主對話 1 小時快取的倒數。

## 安裝（本機）

```
/plugin marketplace add crytropy/prompt-band
/plugin install prompt-band@prompt-band
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
   CLAUDE_CODE_PLUGIN_DIRS=/opt/prompt-band
   ```

設定好後開一個新的雲端 session，看輸入框上方有沒有出現資訊列。
