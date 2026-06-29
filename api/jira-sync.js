// GET /api/jira-sync
// Looks up each board initiative in Jira individually.
// Syncs: status -> phase, completion stamp (from resolutiondate), and title (from summary).
// Add ?dryRun=1 to preview every change WITHOUT writing anything to Supabase.
const JIRA_TO_PHASE = {
  'Ready for Release': 'Ready for Release',
  'QA': 'Testing',
  'In Progress': 'Development',
  'Calibration': 'Product Scoping',
  'Ready for Work': 'Requirements Ready, Not Started',
  'To Do': 'Requirements Not Ready',
  'Blocked': 'Blocked by Stakeholder',
  'Done': 'Completed',
};
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const dryRun = req.query && (req.query.dryRun === '1' || req.query.dryRun === 'true');
  const JIRA_BASE = process.env.JIRA_BASE_URL;
  const AUTH = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  try {
    // Fetch all board initiatives (title added for title sync, notes for the completed stamp)
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/initiatives?select=key,phase,notes,title`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!sRes.ok) throw new Error(`Supabase fetch failed: ${sRes.status}`);
    const initiatives = await sRes.json();
    const updates = [], skipped = [], errors = [];
    // Look up each initiative in Jira individually
    for (const initiative of initiatives) {
      const key = initiative.key;
      // Only process real Jira keys
      if (!/^[A-Z]+-\d+$/.test(key)) continue;
      try {
        // summary added for title sync, resolutiondate for the completion stamp
        const r = await fetch(`${JIRA_BASE}/rest/api/3/issue/${key}?fields=status,resolutiondate,summary`, {
          headers: { Authorization: `Basic ${AUTH}`, Accept: 'application/json' },
        });
        if (r.status === 404) { skipped.push({ key, reason: 'not found in Jira' }); continue; }
        if (!r.ok) { errors.push({ key, reason: `Jira error ${r.status}` }); continue; }
        const d = await r.json();
        const jiraStatus = d.fields.status.name;
        const mappedPhase = JIRA_TO_PHASE[jiraStatus];
        if (!mappedPhase) { skipped.push({ key, reason: `no mapping for "${jiraStatus}"` }); continue; }

        const jiraSummary = typeof d.fields.summary === 'string' ? d.fields.summary : null;
        const needsPhaseChange = initiative.phase !== mappedPhase;
        const needsStamp = mappedPhase === 'Completed' && !/\[completed:/.test(initiative.notes || '');
        const needsTitleChange = jiraSummary !== null
          && (initiative.title || '').trim() !== jiraSummary.trim();
        if (!needsPhaseChange && !needsStamp && !needsTitleChange) continue; // already in sync

        const patch = { updated_at: new Date().toISOString() };
        if (needsPhaseChange) patch.phase = mappedPhase;
        if (needsTitleChange) patch.title = jiraSummary;
        if (needsStamp) {
          // resolutiondate = when the epic resolved (moved to Done). UTC ISO to match
          // the manual completion path and the existing stamp format on the board.
          const rd = d.fields.resolutiondate;
          const stampDate = rd ? new Date(rd).toISOString() : new Date().toISOString();
          patch.notes = `[completed:${stampDate}] ` + (initiative.notes || '');
        }

        // Record what changed (used for both real runs and dry runs)
        const change = { key };
        if (needsPhaseChange) { change.from = initiative.phase; change.to = mappedPhase; }
        if (needsStamp) change.stamped = true;
        if (needsTitleChange) { change.titleFrom = initiative.title; change.titleTo = jiraSummary; }

        if (dryRun) { updates.push(change); continue; } // preview only, no write

        // Update Supabase
        const uRes = await fetch(`${SUPABASE_URL}/rest/v1/initiatives?key=eq.${encodeURIComponent(key)}`, {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(patch),
        });
        if (!uRes.ok) { errors.push({ key, reason: `Supabase update failed: ${uRes.status}` }); continue; }
        updates.push(change);
      } catch (e) {
        errors.push({ key, reason: e.message });
      }
    }
    return res.status(200).json({ success: true, dryRun: !!dryRun, updates, skipped, errors, total: initiatives.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
