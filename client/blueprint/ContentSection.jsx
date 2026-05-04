export function ContentSection({ formState, updateForm }) {
  const bothSet = formState.samplePosts > 0 && formState.wxrPath.trim().length > 0;

  return (
    <section className="blueprint-form-section">
      <details className="bfs-collapsible">
        <summary className="bfs-summary" id="section-content">Content</summary>
        <div className="bf-fields">

        <div className="bf-field">
          <label className="bf-label" htmlFor="bf-sample-posts">Sample Posts</label>
          <input
            id="bf-sample-posts"
            type="number"
            className="bf-input bf-input-number"
            min="0"
            value={formState.samplePosts === 0 ? '' : formState.samplePosts}
            placeholder="0"
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              updateForm({ samplePosts: isNaN(val) || val < 0 ? 0 : val });
            }}
            aria-label="Number of sample posts to generate"
          />
          <span className="bf-help">Generates posts via WP-CLI on startup</span>
        </div>

        <div className="bf-field">
          <label className="bf-label" htmlFor="bf-wxr-path">WXR Import (URL or path)</label>
          <input
            id="bf-wxr-path"
            type="text"
            className="bf-input"
            value={formState.wxrPath}
            placeholder="https://example.com/export.xml"
            onChange={(e) => updateForm({ wxrPath: e.target.value })}
            aria-label="WXR file URL or path to import"
          />
          <span className="bf-help">Imports a WordPress export file on startup</span>
        </div>

        {bothSet && (
          <div className="blueprint-notice" role="status">
            Both content options are set. Sample posts will be generated first, then the WXR file will be imported.
          </div>
        )}

        </div>
      </details>
    </section>
  );
}
