'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/captive.db');

function getDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function migrate() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id             TEXT PRIMARY KEY,
      slug           TEXT NOT NULL UNIQUE,
      name           TEXT NOT NULL,
      description    TEXT,
      sponsor        TEXT,
      logo_url       TEXT,
      primary_color  TEXT NOT NULL DEFAULT '#0050ff',
      accent_color   TEXT NOT NULL DEFAULT '#00c896',
      bg_color       TEXT NOT NULL DEFAULT '#050c1a',
      session_hours  INTEGER NOT NULL DEFAULT 8,
      active         INTEGER NOT NULL DEFAULT 1,
      start_date     TEXT,
      end_date       TEXT,
      watch_frequency TEXT NOT NULL DEFAULT 'once_per_day',
      require_survey  INTEGER NOT NULL DEFAULT 1,
      require_video   INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS campaign_videos (
      id                  TEXT PRIMARY KEY,
      campaign_id         TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      title               TEXT NOT NULL,
      description         TEXT,
      filename            TEXT NOT NULL,
      thumbnail_filename  TEXT,
      duration_seconds    INTEGER NOT NULL DEFAULT 120,
      required_watch_pct  REAL NOT NULL DEFAULT 0.8,
      sort_order          INTEGER NOT NULL DEFAULT 0,
      active              INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vid_campaign ON campaign_videos(campaign_id);
    CREATE TABLE IF NOT EXISTS campaign_surveys (
      id          TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      title       TEXT NOT NULL DEFAULT 'Quick Survey',
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS survey_questions (
      id         TEXT PRIMARY KEY,
      survey_id  TEXT NOT NULL REFERENCES campaign_surveys(id) ON DELETE CASCADE,
      question   TEXT NOT NULL,
      options    TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id             TEXT PRIMARY KEY,
      campaign_id    TEXT NOT NULL REFERENCES campaigns(id),
      mac_address    TEXT,
      ip_address     TEXT NOT NULL,
      dst_url        TEXT,
      challenge      TEXT,
      video_watched  INTEGER NOT NULL DEFAULT 0,
      survey_done    INTEGER NOT NULL DEFAULT 0,
      access_granted INTEGER NOT NULL DEFAULT 0,
      granted_at     TEXT,
      expires_at     TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sess_ip       ON sessions(ip_address);
    CREATE INDEX IF NOT EXISTS idx_sess_mac      ON sessions(mac_address);
    CREATE INDEX IF NOT EXISTS idx_sess_campaign ON sessions(campaign_id);
    CREATE TABLE IF NOT EXISTS survey_responses (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id),
      question_id TEXT NOT NULL,
      question    TEXT NOT NULL,
      answer      TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sr_session ON survey_responses(session_id);
  `);

  const { n } = db.prepare('SELECT COUNT(*) as n FROM campaigns').get();
  if (n === 0) seedCampaigns(db);

  // ── Column migrations — safe to run on existing DBs ──────────────────
  const cols = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);
  if (!cols.includes('dst_url')) {
    db.exec('ALTER TABLE sessions ADD COLUMN dst_url TEXT');
    console.log('  ↳ added dst_url column to sessions');
  }
  if (!cols.includes('challenge')) {
    db.exec('ALTER TABLE sessions ADD COLUMN challenge TEXT');
    console.log('  ↳ added challenge column to sessions');
  }

  const campCols = db.prepare('PRAGMA table_info(campaigns)').all().map(c => c.name);
  if (!campCols.includes('watch_frequency')) {
    db.exec(`ALTER TABLE campaigns ADD COLUMN watch_frequency TEXT NOT NULL DEFAULT 'once_per_day'`);
    console.log('  ↳ added watch_frequency column to campaigns');
  }
  if (!campCols.includes('require_survey')) {
    db.exec(`ALTER TABLE campaigns ADD COLUMN require_survey INTEGER NOT NULL DEFAULT 1`);
    console.log('  ↳ added require_survey column to campaigns');
  }
  if (!campCols.includes('require_video')) {
    db.exec(`ALTER TABLE campaigns ADD COLUMN require_video INTEGER NOT NULL DEFAULT 1`);
    console.log('  ↳ added require_video column to campaigns');
  }

  // video_progress: create with started column, or add it if missing
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_progress (
      id           TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      campaign_id  TEXT NOT NULL,
      watched_pct  REAL NOT NULL DEFAULT 0,
      last_pct     REAL NOT NULL DEFAULT 0,
      started      INTEGER NOT NULL DEFAULT 0,
      completed    INTEGER NOT NULL DEFAULT 0,
      dropped_off  INTEGER NOT NULL DEFAULT 0,
      drop_pct     REAL,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vp_session ON video_progress(session_id);
    CREATE INDEX IF NOT EXISTS idx_vp_campaign ON video_progress(campaign_id);
  `);
  // Add started column to existing video_progress tables that predate this migration
  try {
    const vpCols = db.prepare('PRAGMA table_info(video_progress)').all().map(r => r.name);
    if (!vpCols.includes('started')) {
      db.exec('ALTER TABLE video_progress ADD COLUMN started INTEGER NOT NULL DEFAULT 0');
      console.log('  ↳ added started column to video_progress');
    }
  } catch {}

  console.log('✅ DB migrated');
  db.close();
}

function seedCampaigns(db) {
  const ic = db.prepare(`INSERT INTO campaigns (id,slug,name,description,sponsor,primary_color,accent_color,bg_color,session_hours,watch_frequency) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const iv = db.prepare(`INSERT INTO campaign_videos (id,campaign_id,title,description,filename,duration_seconds,required_watch_pct) VALUES (?,?,?,?,?,?,?)`);
  const is = db.prepare(`INSERT INTO campaign_surveys (id,campaign_id,title) VALUES (?,?,?)`);
  const iq = db.prepare(`INSERT INTO survey_questions (id,survey_id,question,options,sort_order) VALUES (?,?,?,?,?)`);

  function addCampaign(slug,name,desc,sponsor,pc,ac,bg,hours,freq,videoFile,videoDur,vidPct,survTitle,questions) {
    const sid = uuidv4();
    ic.run(uuidv4(),slug,name,desc,sponsor,pc,ac,bg,hours,freq);
    const row = db.prepare('SELECT id FROM campaigns WHERE slug=?').get(slug);
    iv.run(uuidv4(),row.id,`Welcome: ${name}`,desc,videoFile,videoDur,vidPct);
    is.run(sid,row.id,survTitle);
    questions.forEach(([q,opts],i) => iq.run(uuidv4(),sid,q,JSON.stringify(opts),i));
  }

  addCampaign('default','Community Wi-Fi','Free community internet access.','CityNet','#0050ff','#00c896','#050c1a',8,'once_per_day','intro.mp4',120,0.8,'Help Us Improve',[
    ['How did you hear about this Wi-Fi?',['Word of mouth','Community board','Social media','Just found it']],
    ['How often do you need internet here?',['Daily','A few times a week','Occasionally','First time']],
    ['What will you use the internet for today?',['Work / Education','Social media','News & info','Entertainment']],
  ]);

  addCampaign('redcross','Red Cross Relief Zone','Emergency relief connectivity.','Red Cross','#cc0000','#ff6b6b','#1a0000',4,'always','redcross-intro.mp4',90,0.75,'Relief Services Survey',[
    ['What is your current shelter situation?',['Emergency shelter','Staying with family','Own home (damaged)','Other']],
    ['What services do you need most?',['Medical','Food & water','Communication','Evacuation help']],
    ['How many people are in your group?',['1','2–4','5–10','More than 10']],
  ]);

  addCampaign('covid-health','Health Connect','COVID-19 health info & connectivity.','Ministry of Health','#0077b6','#48cae4','#03045e',6,'once_per_day','covid-info.mp4',150,0.85,'Health Check Survey',[
    ['Have you been vaccinated against COVID-19?',['Yes, fully','Yes, partially','No','Prefer not to say']],
    ['How are you feeling today?',['Well','Mild symptoms','Unwell','Need medical attention']],
    ['Do you need help accessing health services?',['No, I am fine','Need information','Need appointment','Need transport']],
  ]);

  console.log('🌱 Seeded 3 campaigns: default, redcross, covid-health');
}

module.exports = { getDb, migrate };
if (require.main === module) migrate();
