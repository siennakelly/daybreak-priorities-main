// GET /api/jira-sync
// 1. Updates existing board initiatives from Jira (status -> phase, completion stamp, title).
// 2. Discovery: inserts any DAY epic not yet on the board into the Requested area (is_new = true),
//    all-time, with floor scores of 1 and a blank requestor to be filled before promotion.
// Add ?dryRun=1 to preview UPDATES without writing (discovery still previews without inserting).
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

  const jiraHeaders = { Authorization: `Basic ${AUTH}`, Accept: 'application/json' };
  const sbHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  try {
    // Pull board initiatives (title/notes needed for title sync + completion stamp check)
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/initiatives?select=key,phase,notes,title`, { headers: sbHeaders });
    if (!sRes.ok) throw new Error(`Supabase fetch failed: ${sRes.status}`);
    const initiatives = await sRes.json();

    const updates = [], skipped = [], errors = [];

    // ── 1. Update existing initiatives (per-key lookup, avoids search pagination gaps) ──
    for (const initiative of initiatives) {
      const key = initiative.key;
      if (!/^[A-Z]+-\d+$/.test(key)) continue;
      try {
        const r = await fetch(`${JIRA_BASE}/rest/api/3/issue/${key}?fields=status,resolutiondate,summary`, { headers: jiraHeaders });
        if (r.status === 404) { skipped.push({ key, reason: 'not found in Jira' }); continue; }
        if (!r.ok) { errors.push({ key, reason: `Jira error ${r.status}` }); continue; }
        const d = await r.json();
        const jiraStatus = d.fields.status.name;
        const mappedPhase = JIRA_TO_PHASE[jiraStatus];
        if (!mappedPhase) { skipped.push({ key, reason: `no mapping for "${jiraStatus}"` }); continue; }

        const jiraSummary = typeof d.fields.summary === 'string' ? d.fields.summary : null;
        const needsPhaseChange = initiative.phase !== mappedPhase;
        const needsStamp = mappedPhase === 'Completed' && !/\[completed:/.test(initiative.notes || '');
        const needsTitleChange = jiraSummary !== null && (initiative.title || '').trim() !== jiraSummary.trim();
        if (!needsPhaseChange && !needsStamp && !needsTitleChange) continue;

        const patch = { updated_at: new Date().toISOString() };
        if (needsPhaseChange) patch.phase = mappedPhase;
        if (needsTitleChange) patch.title = jiraSummary;
        if (needsStamp) {
          const rd = d.fields.resolutiondate;
          patch.notes = `[completed:${rd ? new Date(rd).toISOString() : new Date().toISOString()}] ` + (initiative.notes || '');
        }

        const change = { key };
        if (needsPhaseChange) { change.from = initiative.phase; change.to = mappedPhase; }
        if (needsStamp) change.stamped = true;
        if (needsTitleChange) { change.titleFrom = initiative.title; change.titleTo = jiraSummary; }

        if (dryRun) { updates.push(change); continue; }

        const uRes = await fetch(`${SUPABASE_URL}/rest/v1/initiatives?key=eq.${encodeURIComponent(key)}`, {
          method: 'PATCH',
          headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(patch),
        });
        if (!uRes.ok) { errors.push({ key, reason: `Supabase update failed: ${uRes.status}` }); continue; }
        updates.push(change);
      } catch (e) {
        errors.push({ key, reason: e.message });
      }
    }

    // ── 2. Discovery: find DAY epics not on the board, add to Requested (is_new = true) ──
    const existingKeys = new Set(initiatives.map(i => i.key));
    const discovered = [];
    let pageToken = null, guard = 0;
    do {
      const jql = encodeURIComponent('project = DAY AND issuetype = Epic AND statusCategory != Done AND status != "Descoped"');
      const url = `${JIRA_BASE}/rest/api/3/search/jql?jql=${jql}&fields=summary,status,resolutiondate,created&maxResults=100${pageToken ? `&nextPageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const r = await fetch(url, { headers: jiraHeaders });
      if (!r.ok) { errors.push({ discovery: `Jira epic list failed: ${r.status}` }); break; }
      const d = await r.json();
      for (const iss of (d.issues || [])) {
        if (existingKeys.has(iss.key)) continue;
        existingKeys.add(iss.key); // guard against dupes across pages
        const mappedPhase = JIRA_TO_PHASE[iss.fields.status.name] || 'Requirements Not Ready';
        const row = {
          key: iss.key,
          title: iss.fields.summary || iss.key,
          phase: mappedPhase,
          requestor: '',            // blank on purpose; required before promotion
          effort: 1, value: 1, importance: 1, urgency: 1,  // floor scores
          score: 20,                // all-1s under the standard weights; recomputed on edit
          revenue: 0,
          is_new: true,             // lands in the Requested area, off the main board
          created_at: iss.fields.created ? new Date(iss.fields.created).toISOString() : new Date().toISOString(),
          notes: mappedPhase === 'Completed'
            ? `[completed:${iss.fields.resolutiondate ? new Date(iss.fields.resolutiondate).toISOString() : new Date().toISOString()}] `
            : '',
          updated_at: new Date().toISOString(),
        };
        discovered.push(row);
      }
      pageToken = d.isLast ? null : d.nextPageToken;
      guard++;
    } while (pageToken && guard < 50);

    let discoveredCount = 0;
    if (discovered.length) {
      if (dryRun) {
        discoveredCount = discovered.length;
      } else {
        const insRes = await fetch(`${SUPABASE_URL}/rest/v1/initiatives`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(discovered),
        });
        if (!insRes.ok) { errors.push({ discovery: `Supabase insert failed: ${insRes.status} ${await insRes.text()}` }); }
        else { discoveredCount = discovered.length; }
      }
    }

    return res.status(200).json({
      success: true,
      dryRun: !!dryRun,
      updates,
      discovered: discoveredCount,
      discoveredKeys: discovered.map(d => d.key),
      skipped,
      errors,
      total: initiatives.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
