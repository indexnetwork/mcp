const templateUri = "ui://widget/index-echo.html";
const title = "Index Echo";

export const indexEchoWidget = {
  id: "index-echo",
  title,
  templateUri,
  resourceName: "index-echo",
  invoking: "Rendering echo card",
  invoked: "Rendered echo card",
  mimeType: "text/html+skybridge",
  html: `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        padding: 16px;
        font-family: system-ui, sans-serif;
        background: transparent;
        color: inherit;
      }

      .card {
        border: 1px solid #0A0A0A;
        padding: 20px;
        display: flex;
        gap: 16px;
        align-items: flex-start;
        background: #ffffff;
        max-width: 400px;
      }

      .icon {
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        background: #3b82f6;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 18px;
        font-weight: bold;
      }

      .content {
        flex: 1;
      }

      .title {
        font-weight: 500;
        font-family: 'IBM Plex Mono', monospace;
        margin-bottom: 4px;
        color: #000000;
        font-size: 14px;
        line-height: 1.2;
      }

      .message {
        font-size: 14px;
        color: #475569;
        font-family: system-ui, sans-serif;
        line-height: 1.4;
        word-break: break-word;
      }

      .message:empty::after {
        content: 'Waiting for message...';
        color: #9ca3af;
        font-style: italic;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="icon">I</div>
      <div class="content">
        <div class="title">ECHO</div>
        <div id="message" class="message"></div>
      </div>
    </div>
    
    <script>
      function render() {
        const el = document.getElementById("message");
        if (el) el.textContent = window.openai?.toolOutput?.message || '';
      }
      render();
      window.addEventListener("openai:set_globals", render);
    </script>
  </body>
</html>
  `.trim()
} as const;

export const indexEchoEmbeddedResource = {
  type: "resource" as const,
  resource: {
    uri: templateUri,
    mimeType: "text/html+skybridge",
    text: indexEchoWidget.html,
    title
  }
};
