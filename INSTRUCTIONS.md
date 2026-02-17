# JSON Formatter Web App

Build a complete, production-ready JSON formatter/parser web application.

## Features

### Core
- Paste or upload JSON text
- Parse and validate JSON with clear error messages (line number, position)
- Beautify (pretty-print with configurable indent: 2/4 spaces, tabs)
- Minify JSON
- Copy formatted result to clipboard
- Dark/light theme toggle

### AI Fix (key feature)
- Button "Fix with AI" — sends broken JSON to backend
- Backend calls Anthropic Claude Haiku (claude-haiku-4-5-20251001) to fix syntax errors WITHOUT changing content/values
- Uses ANTHROPIC_API_KEY env var
- Prompt: "Fix the JSON syntax errors in this text. Do not change any values, keys, or structure. Only fix syntax (missing commas, brackets, quotes, etc). Return ONLY the fixed JSON, nothing else."
- Show diff of what AI changed (highlight changed lines)

### History (MongoDB)
- Save each parsed/formatted JSON to MongoDB with timestamp
- List recent 50 entries in sidebar
- Click to reload any saved entry
- MongoDB connection string from MONGODB_URI env var
- Database: json_formatter, Collection: history
- Fields: { content: string, formatted: string, timestamp: Date, label: string (first 50 chars) }

## Tech Stack
- **Backend**: Node.js + Express
- **Frontend**: Single HTML file with embedded CSS/JS (no build step, no React)
- **UI**: Clean, modern, responsive. Use CSS variables for theming.
- **DB**: MongoDB via mongodb driver (not mongoose)
- **Port**: from PORT env var, default 3000

## File Structure
```
/server.js          - Express server + API routes
/public/index.html  - Full frontend (HTML+CSS+JS in one file)
/package.json       - Dependencies
/.env.example       - Example env vars
```

## API Routes
- POST /api/format - { json: string, indent: number } → formatted JSON
- POST /api/fix - { json: string } → AI-fixed JSON + diff
- GET /api/history - list recent entries
- POST /api/history - save entry
- DELETE /api/history/:id - delete entry

## Design
- Split pane: input left, output right (collapsible on mobile → stacked)
- Toolbar top: Format, Minify, Fix with AI, Copy, Save buttons
- Sidebar right: history list (collapsible)
- Syntax highlighting for JSON (use simple regex-based coloring, no external lib)
- Error messages in red banner with line number
- Loading spinner on AI fix

## Important
- Production ready: error handling, input validation, size limits (max 1MB JSON)
- package.json with "start" script
- No TypeScript, no build step, keep it simple
