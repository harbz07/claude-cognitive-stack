export function getMultiAgentDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Soul Tavern Multi-Agent Playground</title>
  <meta name="description" content="SillyTavern-inspired multi-agent playground for soul-os.cc with shared and scoped memory." />
  <link rel="stylesheet" href="/static/multi-agent-canvas.css" />
</head>
<body>
  <a class="skip-link" href="#chat-composer">Skip to chat composer</a>
  <div id="soul-tavern-root" class="boot-shell" aria-live="polite">
    <div class="boot-card">
      <h1>Soul Tavern</h1>
      <p>Booting multi-agent chat canvas...</p>
      <p class="boot-hint">No curl scripts needed. Add API key, toggle agents, and start chaos.</p>
    </div>
  </div>
  <noscript>
    <section class="no-script">
      <h1>JavaScript Required</h1>
      <p>This experience requires JavaScript to run the React multi-agent canvas.</p>
    </section>
  </noscript>
  <script defer crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script defer crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script defer src="https://unpkg.com/htm@3.1.1/dist/htm.umd.js"></script>
  <script defer src="/static/multi-agent-canvas.js"></script>
</body>
</html>`
}
