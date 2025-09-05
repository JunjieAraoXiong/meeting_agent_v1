# 🎯 E-Meet: Feishu Meeting Agent Collection

A comprehensive meeting transcription and analysis tool with multiple implementations.

## 📁 Project Structure

```
e-meet/
├── 🏠 Main Application (React + Vite)
│   ├── index.html              # Main entry point
│   ├── src/
│   │   ├── App.tsx             # React app
│   │   ├── main.tsx            # Entry point
│   │   └── components/
│   │       └── MeetingAgent.tsx # Core meeting agent component
│   └── package.json            # Dependencies
│
├── 📂 demos/                   # Standalone demos and prototypes
│   ├── chinese-agent.html      # 🔥 READY-TO-USE Feishu agent
│   ├── enhanced-file-manager.html # 🔥 AUTO-LOADS transcriptions/ files
│   ├── meeting-agent.html      # React-based standalone demo
│   ├── post-meeting-agent.html # Post-meeting analysis
│   ├── simple-agent.html       # Simplified version
│   ├── working-agent.html      # Working prototype
│   └── prototypes/
│       └── performance-test.html # Performance monitoring
│
└── 📁 transcriptions/          # Your meeting data
    ├── 20250630.txt            # Meeting transcription 1
    └── 20250703.txt            # Meeting transcription 2
```

## 🚀 Quick Start Options

### Option 1: 🔥 **Enhanced File Manager** (Auto-loads transcriptions)

**Best for comprehensive file management and analysis:**

```bash
# Automatically includes all files from transcriptions/ folder:
open demos/enhanced-file-manager.html
```
- ✅ **Auto-loads `20250630.txt` and `20250703.txt`**
- ✅ **Editable file names, sizes, dates**
- ✅ **Real-time performance metrics**
- ✅ **File tabs for easy switching**

### Option 2: 🔥 **Simple Testing** (No Setup Required)

**Best for immediate testing with manual file upload:**

```bash
# Simply open in browser:
open demos/chinese-agent.html
```

✅ **Features:**
- ✨ Works immediately with your .txt files
- 🎯 Feishu format parsing (汤欣钰 00:00)
- 🔍 Term extraction and highlighting
- ⏯️ Timeline playback simulation
- 💬 Basic chat functionality
- 🗂️ File selector for transcriptions/

### Option 2: 🏗️ **Full Development Setup**

**For advanced features and development:**

1. **Install Node.js** (required for npm):
   ```bash
   # Install Node.js from https://nodejs.org/
   # Or via Homebrew:
   brew install node
   ```

2. **Run the React app:**
   ```bash
   npm install
   npm run dev
   ```

✅ **Advanced Features:**
- 🏆 Full feature set with History page
- 💾 LocalStorage persistence
- 🧪 Built-in test suite (15 tests)
- 🎨 Modern React UI with Tailwind
- 📊 Performance monitoring

## 🔍 Understanding the Versions

| Version | Use Case | Setup | Features |
|---------|----------|--------|----------|
| **chinese-agent.html** | 🎯 **Immediate testing** | None | Feishu parsing, file loading, basic UI |
| **React App (src/)** | 🏆 **Full experience** | Node.js + npm | Complete feature set, tests, history |
| **meeting-agent.html** | 🧪 **Prototype testing** | None | React in browser, advanced parsing |
| **Other demos/** | 📋 **Specific demos** | None | Various prototypes and experiments |

## 📊 Performance Testing

### Quick Test with Chinese Agent:
1. Open `demos/chinese-agent.html`
2. Click "📁 加载文件" 
3. Select one of your transcription files
4. Check parsing speed and accuracy

### Full Performance Suite:
1. Start React app: `npm run dev`
2. Open browser DevTools (F12)
3. Load transcription files
4. Run built-in tests (bottom right panel)

## 🇨🇳 Chinese Agent vs Feishu Meeting Agent

**They're the same concept, different implementations:**

- **Chinese Agent** = Standalone HTML version optimized for Chinese/Feishu format
- **Feishu Meeting Agent** = The React component in src/components/
- **Both** can process your transcription files with format:
  ```
  汤欣钰 00:00
  [meeting content]
  
  说话人 1 01:42
  [more content]
  ```

## 🛠️ Troubleshooting

### "npm: command not found"
```bash
# Install Node.js first:
brew install node
# Or download from: https://nodejs.org/
```

### Files won't load
- Use `chinese-agent.html` for immediate testing
- Check file paths in transcriptions/ folder
- Ensure files are in Feishu format

### Performance issues
- Open `demos/prototypes/performance-test.html`
- Monitor memory usage and timing
- Use browser DevTools Performance tab

## 🎯 Recommended Workflow

1. **Start with Chinese Agent** (`demos/chinese-agent.html`)
   - Test your transcription files immediately
   - Verify parsing accuracy
   - Check term extraction quality

2. **Move to React App** (if Node.js available)
   - Get full feature experience
   - Use history and persistence
   - Run comprehensive tests

3. **Performance Testing**
   - Monitor metrics during use
   - Verify benchmarks are met
   - Test with different file sizes

## 📈 Expected Performance

| Metric | Target | Your Files |
|--------|--------|------------|
| Parse Time | < 1s | ✅ (~45-55KB files) |
| Memory Usage | < 50MB | ✅ Should be fine |
| Timeline Render | < 500ms | ✅ Smooth |
| Search Response | < 300ms | ✅ Fast |

## 🔧 Next Steps

1. **Immediate:** Test `demos/chinese-agent.html` with your files
2. **Install Node.js** for full React experience  
3. **Organize workflow** based on your needs
4. **Performance test** with your specific use cases

### Chat Interface

- **Location**: `src/components/RAGChat.tsx` (integrated in `src/components/MeetingAgent.tsx` and the main app UI). A simple chat is also available in `demos/chinese-agent.html` and `demos/meeting-agent.html`.
- **What it does**: Conversational interface over the meeting knowledge base. It routes prompts through the local RAG pipeline (`src/services/RAGService.ts`, `src/services/VectorService.ts`) with the currently selected meeting context.
- **How to use**:
  - Run the React app: `npm install && npm run dev`, then open the app and use the chat panel on the right.
  - Or open a demo directly: `open demos/chinese-agent.html` for a zero-setup chat that you can test with files in `transcriptions/`.
- **Features**:
  - Context-aware responses grounded in selected transcription(s)
  - Term extraction, timeline references, and highlight support (where applicable)
  - Extensible prompt and tool hooks for future automations

### MCP for Feishu (Optional, Cross‑App Integration)

You can deploy an MCP (Model Context Protocol) server to make these meeting tools available across Feishu (Lark) chats and apps.

- **Why MCP**: Centralizes capabilities (RAG, parsing, summarization) behind a protocol so multiple Feishu entry points (DMs, group chats, apps) can share the same toolset.
- **High‑level architecture**:
  - Feishu Bot/App → Event Subscription (message events) → MCP Gateway/Server → Tools (RAG, vector search, summaries) → Feishu Reply
- **Setup outline**:
  1. Create a Feishu app/bot and enable event subscriptions (message receive). Note required permissions like `im:message`, `im:chat`, etc.
  2. Deploy an MCP server (container or serverless). Expose HTTPS endpoint for Feishu callbacks and your MCP RPC endpoint.
  3. Configure environment variables for deployment:
     - `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_ENCRYPT_KEY`, `FEISHU_VERIFICATION_TOKEN`
     - `MCP_ENDPOINT` (your MCP server URL)
     - Storage/embedding config as needed by your vector store
  4. On incoming Feishu messages, forward requests to MCP tools (RAG query, summary, action routing) and return responses to Feishu.
- **Security & compliance**:
  - Verify Feishu request signatures and tokens.
  - Limit tool scopes; redact PII when logging.
  - Use HTTPS and rotate secrets regularly.
- **Status**: This repo’s UI and services are MCP‑friendly by design. The MCP server implementation is deployment‑specific and can be added as a separate service/module.
