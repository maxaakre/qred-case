/**
 * Styling for /docs, scoped to Swagger UI's own classes. The written guide in the
 * contract is long, so it gets a readable line length, room between sections and
 * quieter inline code. Presentation only: the contract itself is untouched.
 */
export const docsTheme = `
.swagger-ui .wrapper { max-width: 1080px; padding: 0 32px; }
.swagger-ui .info { margin: 56px 0 40px; }
.swagger-ui .info .title { margin-bottom: 8px; }

.swagger-ui .info .markdown,
.swagger-ui .renderedMarkdown {
  max-width: 780px;
  font-size: 15px;
  line-height: 1.7;
  color: #1f2933;
}
.swagger-ui .info .markdown h2 {
  margin: 48px 0 16px;
  padding-top: 32px;
  border-top: 1px solid #e5e7eb;
  font-size: 22px;
}
.swagger-ui .info .markdown h3 { margin: 28px 0 8px; font-size: 17px; }
.swagger-ui .markdown p,
.swagger-ui .renderedMarkdown p { margin: 0 0 16px; }
.swagger-ui .markdown ul,
.swagger-ui .markdown ol,
.swagger-ui .renderedMarkdown ul,
.swagger-ui .renderedMarkdown ol { margin: 0 0 20px; padding-left: 24px; }
.swagger-ui .markdown li,
.swagger-ui .renderedMarkdown li { margin-bottom: 12px; }

.swagger-ui .markdown code,
.swagger-ui .renderedMarkdown code {
  padding: 2px 6px;
  border-radius: 4px;
  background: #f1f5f9;
  color: #1e3a5f;
  font-size: 0.88em;
  font-weight: 500;
}
.swagger-ui .markdown pre,
.swagger-ui .renderedMarkdown pre {
  margin: 0 0 20px;
  padding: 14px 18px;
  border-radius: 8px;
  background: #0f172a;
}
.swagger-ui .markdown pre code,
.swagger-ui .renderedMarkdown pre code { padding: 0; background: none; color: #e2e8f0; }

.swagger-ui .info .markdown table { margin: 8px 0 24px; border-collapse: collapse; }
.swagger-ui .info .markdown th,
.swagger-ui .info .markdown td {
  padding: 12px 16px 12px 0;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  vertical-align: top;
}
.swagger-ui .info .markdown td:first-child { font-weight: 600; white-space: nowrap; }

.swagger-ui .opblock-tag { margin-top: 32px; }
.swagger-ui .opblock { margin-bottom: 16px; }
.swagger-ui .opblock .opblock-section-header { padding: 12px 20px; }
`;
