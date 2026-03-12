'use strict';
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/migrate');

function getAllCampaigns(includeInactive=false) {
  const db=getDb();
  const where = includeInactive ? '' : 'WHERE c.active=1';
  const rows=db.prepare(`
    SELECT c.*,
      COALESCE(v.required_watch_pct, 0.8) AS video_required_pct,
      COALESCE(v.duration_seconds,   120)  AS video_duration,
      v.filename                           AS video_filename,
      v.title                              AS video_original,
      COALESCE(sc.total,   0)              AS total_sessions,
      COALESCE(sc.granted, 0)              AS granted_sessions
    FROM campaigns c
    LEFT JOIN (
      SELECT campaign_id, filename, title, required_watch_pct, duration_seconds
      FROM campaign_videos WHERE active=1
      GROUP BY campaign_id
    ) v ON v.campaign_id = c.id
    LEFT JOIN (
      SELECT campaign_id,
        COUNT(*) AS total,
        SUM(CASE WHEN access_granted=1 THEN 1 ELSE 0 END) AS granted
      FROM sessions GROUP BY campaign_id
    ) sc ON sc.campaign_id = c.id
    ${where}
    ORDER BY c.created_at DESC
  `).all();
  db.close(); return rows;
}
function getCampaignBySlug(slug) { const db=getDb(); const r=db.prepare('SELECT * FROM campaigns WHERE slug=?').get(slug); db.close(); return r||null; }
function getCampaignById(id)     { const db=getDb(); const r=db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);   db.close(); return r||null; }

function getCampaignConfig(slug) {
  const db=getDb();
  const c=db.prepare('SELECT * FROM campaigns WHERE slug=? AND active=1').get(slug);
  if (!c) { db.close(); return null; }
  const v=db.prepare('SELECT * FROM campaign_videos WHERE campaign_id=? AND active=1 ORDER BY sort_order ASC LIMIT 1').get(c.id);
  const s=db.prepare('SELECT * FROM campaign_surveys WHERE campaign_id=? AND active=1 LIMIT 1').get(c.id);
  const qs=s?db.prepare('SELECT * FROM survey_questions WHERE survey_id=? ORDER BY sort_order ASC').all(s.id).map(q=>({...q,options:JSON.parse(q.options)})):[];
  db.close();
  return { campaign:c, video:v||null, survey:s?{...s,questions:qs}:null };
}

function createCampaign(d) {
  const db=getDb(); const id=uuidv4();
  db.prepare('INSERT INTO campaigns(id,slug,name,description,sponsor,logo_url,primary_color,accent_color,bg_color,session_hours,start_date,end_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,d.slug,d.name,d.description||null,d.sponsor||null,d.logo_url||null,d.primary_color||'#0050ff',d.accent_color||'#00c896',d.bg_color||'#050c1a',d.session_hours||8,d.start_date||null,d.end_date||null);
  const r=db.prepare('SELECT * FROM campaigns WHERE id=?').get(id); db.close(); return r;
}

function updateCampaign(id, d) {
  const db=getDb();
  const allowed=['name','description','sponsor','logo_url','primary_color','accent_color','bg_color','session_hours','active','start_date','end_date'];
  const fields=[],vals=[];
  for (const k of allowed) if (d[k]!==undefined) { fields.push(`${k}=?`); vals.push(d[k]); }
  if (fields.length) { fields.push(`updated_at=datetime('now')`); vals.push(id); db.prepare(`UPDATE campaigns SET ${fields.join(',')} WHERE id=?`).run(...vals); }
  const r=db.prepare('SELECT * FROM campaigns WHERE id=?').get(id); db.close(); return r;
}

function getVideosForCampaign(cid) { const db=getDb(); const r=db.prepare('SELECT * FROM campaign_videos WHERE campaign_id=? ORDER BY sort_order ASC').all(cid); db.close(); return r; }

function createVideo(cid, d) {
  const db=getDb(); const id=uuidv4();
  db.prepare('INSERT INTO campaign_videos(id,campaign_id,title,description,filename,thumbnail_filename,duration_seconds,required_watch_pct,sort_order) VALUES(?,?,?,?,?,?,?,?,?)').run(id,cid,d.title,d.description||null,d.filename,d.thumbnail_filename||null,d.duration_seconds||120,d.required_watch_pct||0.8,d.sort_order||0);
  const r=db.prepare('SELECT * FROM campaign_videos WHERE id=?').get(id); db.close(); return r;
}

function updateVideo(id, d) {
  const db=getDb();
  const allowed=['title','description','filename','thumbnail_filename','duration_seconds','required_watch_pct','sort_order','active'];
  const fields=[],vals=[];
  for (const k of allowed) if (d[k]!==undefined) { fields.push(`${k}=?`); vals.push(d[k]); }
  if (fields.length) { vals.push(id); db.prepare(`UPDATE campaign_videos SET ${fields.join(',')} WHERE id=?`).run(...vals); }
  const r=db.prepare('SELECT * FROM campaign_videos WHERE id=?').get(id); db.close(); return r;
}

function deleteVideo(id) { const db=getDb(); db.prepare('DELETE FROM campaign_videos WHERE id=?').run(id); db.close(); }

function getSurveyForCampaign(cid) {
  const db=getDb();
  const s=db.prepare('SELECT * FROM campaign_surveys WHERE campaign_id=? AND active=1').get(cid);
  if (!s) { db.close(); return null; }
  const qs=db.prepare('SELECT * FROM survey_questions WHERE survey_id=? ORDER BY sort_order ASC').all(s.id).map(q=>({...q,options:JSON.parse(q.options)}));
  db.close(); return {...s,questions:qs};
}

function upsertSurvey(cid, d) {
  const db=getDb();
  db.transaction(()=>{
    let s=db.prepare('SELECT * FROM campaign_surveys WHERE campaign_id=?').get(cid);
    if (!s) { const sid=uuidv4(); db.prepare('INSERT INTO campaign_surveys(id,campaign_id,title) VALUES(?,?,?)').run(sid,cid,d.title||'Survey'); s=db.prepare('SELECT * FROM campaign_surveys WHERE id=?').get(sid); }
    else db.prepare('UPDATE campaign_surveys SET title=? WHERE id=?').run(d.title||s.title,s.id);
    db.prepare('DELETE FROM survey_questions WHERE survey_id=?').run(s.id);
    const ins=db.prepare('INSERT INTO survey_questions(id,survey_id,question,options,sort_order) VALUES(?,?,?,?,?)');
    (d.questions||[]).forEach((q,i)=>ins.run(uuidv4(),s.id,q.question,JSON.stringify(q.options),i));
  })();
  db.close(); return getSurveyForCampaign(cid);
}

module.exports = { getAllCampaigns, getCampaignBySlug, getCampaignById, getCampaignConfig, createCampaign, updateCampaign, getVideosForCampaign, createVideo, updateVideo, deleteVideo, getSurveyForCampaign, upsertSurvey };
