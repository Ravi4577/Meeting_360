/* ==========================================================================
   NEXUS CRM — application logic (vanilla JavaScript, no dependencies)

   Architecture
   ------------
   DB              single source of truth for every screen (persisted)
   MODULES         registry describing each CRM record type (fields, labels…)
   VIEWS           pure functions returning the HTML for one route
   Router          hash based, SPA — no page reloads
   updateUI()      re-renders navbar, notifications and the active view
   saveData()/loadData()   localStorage persistence
   openModal()/closeModal()/showToast()   shared UI services

   Every value shown in the UI is read from DB — nothing is hardcoded twice.
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     01. UTILITIES
     ====================================================================== */
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /** Escape untrusted values before injecting them into an HTML string. */
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const icon = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

  const todayISO = () => new Date().toISOString().slice(0, 10);

  const daysFromNow = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

  /** '2026-08-12' -> '12 Aug 2026' */
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? String(iso) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  /** '2020-07-16' -> '16-07-20' (compact CRM format used on the stat cards) */
  const fmtShort = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = String(iso).split('-');
    return `${d}-${m}-${String(y).slice(2)}`;
  };

  /** Epoch ms -> 'Just now' / '12 min ago' / '3 hr ago' / '12 Aug 2026' */
  const relTime = (ts) => {
    const diff = Date.now() - Number(ts || 0);
    const min = Math.floor(diff / 6e4);
    if (min < 1) return 'Just now';
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const day = Math.floor(hr / 24);
    if (day === 1) return 'Yesterday';
    if (day < 7) return `${day} days ago`;
    return fmtDate(new Date(Number(ts)).toISOString().slice(0, 10));
  };

  const initialsOf = (first, last) =>
    ((first || '').trim().charAt(0) + (last || '').trim().charAt(0)).toUpperCase() || '?';

  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const RE_PHONE = /^[+()\d\s.\-]{7,24}$/;
  const isEmail = (v) => RE_EMAIL.test(String(v).trim());
  const isPhone = (v) => RE_PHONE.test(String(v).trim()) && (String(v).match(/\d/g) || []).length >= 7;

  const telHref = (v) => 'tel:' + String(v || '').replace(/[^\d+]/g, '');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const sum = (arr, pick) => arr.reduce((t, x) => t + Number(pick(x) || 0), 0);
  const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));

  /** Highlight the matched substring inside a search result label. */
  const mark = (text, q) => {
    const safe = esc(text);
    if (!q) return safe;
    const i = safe.toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? safe : safe.slice(0, i) + '<mark>' + safe.slice(i, i + q.length) + '</mark>' + safe.slice(i + q.length);
  };

  /** Case-insensitive "does any of these values contain the query" test. */
  const matches = (q, ...vals) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return vals.some((v) => String(v ?? '').toLowerCase().includes(needle));
  };

  const avatarClass = (id) => 'av-' + ((String(id).split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) % 6) + 1);

  /* ======================================================================
     02. SEED DATA
     The shape below is the contract every view renders against.
     ====================================================================== */
  const STAGES = ['Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];

  const STAGE_ACCENT = {
    'Qualification': '#6366f1', 'Proposal': '#06b6d4', 'Negotiation': '#f59e0b',
    'Closed Won': '#10b981', 'Closed Lost': '#f43f5e'
  };

  function seedData() {
    return {
      version: 3,
      admin: {
        name: 'Adrian Cole',
        email: 'adrian.cole@nexuscrm.io',
        role: 'Administrator',
        initials: 'AC',
        avatar: 1
      },
      settings: { density: 'comfortable', animations: true, landing: 'contact' },
      activeContactId: 'c-1',

      contacts: [
        {
          id: 'c-1', firstName: 'Lilian', lastName: 'Marron', jobTitle: 'Senior Product Manager',
          department: '', accountName: 'MTM Investment Bank FSB',
          email: 'info.section.im@example.de', secondaryEmail: 'l.marron@mtm-bank.example',
          mobile: '(048) 284-6148', officePhone: '(144) 755-1854', fax: '',
          street: '9 IBM Path', city: 'St. Petersburg', state: 'CA', zip: '79297', country: 'USA',
          otherStreet: '', otherCity: '', otherState: '', otherZip: '', otherCountry: '',
          description: 'Champion for the analytics rollout across three regional teams.',
          favourite: true, owner: 'Adrian Cole', reportsTo: 'Denise Whitaker (VP Product)',
          leadSource: 'Webinar — Q2 Product Clinic', industry: 'Financial Services',
          employees: '2,400', annualRevenue: '$1.2B', timezone: '(GMT-05:00) Eastern Time',
          language: 'English (US)', linkedin: 'linkedin.com/in/lilian-marron',
          lifecycle: 'Customer — Expansion', nps: 9, engagement: 78,
          doNotCall: false, emailOptOut: false,
          tags: ['VIP', 'Renewal Q3', 'Enterprise'],
          createdAt: '2019-02-12', updatedAt: '2026-08-20'
        },
        {
          id: 'c-2', firstName: 'Marcus', lastName: 'Feld', jobTitle: 'Director of Operations',
          department: 'Operations', accountName: 'Halden Logistics Group',
          email: 'm.feld@halden.example', secondaryEmail: '',
          mobile: '(021) 774-3390', officePhone: '(021) 774-3300', fax: '',
          street: '18 Harbour Row', city: 'Rotterdam', state: 'ZH', zip: '3011', country: 'Netherlands',
          otherStreet: '', otherCity: '', otherState: '', otherZip: '', otherCountry: '',
          description: 'Evaluating the platform for a 40-site logistics rollout.',
          favourite: false, owner: 'Adrian Cole', reportsTo: 'Board of Directors',
          leadSource: 'Inbound — Pricing page', industry: 'Transport & Logistics',
          employees: '860', annualRevenue: '$310M', timezone: '(GMT+01:00) Amsterdam',
          language: 'English (UK)', linkedin: 'linkedin.com/in/marcus-feld',
          lifecycle: 'Prospect — Evaluation', nps: 7, engagement: 54,
          doNotCall: false, emailOptOut: false,
          tags: ['Prospect', 'Logistics'],
          createdAt: '2026-05-04', updatedAt: '2026-08-14'
        },
        {
          id: 'c-3', firstName: 'Priya', lastName: 'Raman', jobTitle: 'Head of Data',
          department: 'Data & Insights', accountName: 'Corvus Analytics',
          email: 'priya.raman@corvus.example', secondaryEmail: '',
          mobile: '(033) 512-8842', officePhone: '', fax: '',
          street: '221 Kingsway', city: 'Bengaluru', state: 'KA', zip: '560001', country: 'India',
          otherStreet: '', otherCity: '', otherState: '', otherZip: '', otherCountry: '',
          description: 'Technical champion. Runs the data model review board.',
          favourite: true, owner: 'Adrian Cole', reportsTo: 'CTO',
          leadSource: 'Partner referral', industry: 'Software & Analytics',
          employees: '1,150', annualRevenue: '$95M', timezone: '(GMT+05:30) India',
          language: 'English (IN)', linkedin: 'linkedin.com/in/priya-raman',
          lifecycle: 'Customer — Onboarding', nps: 10, engagement: 66,
          doNotCall: false, emailOptOut: false,
          tags: ['Champion', 'Expansion'],
          createdAt: '2025-11-02', updatedAt: '2026-08-18'
        }
      ],

      records: {
        calls: [
          { id: 'cl-1', contactId: 'c-1', subject: 'Renewal pricing walkthrough', date: '2026-08-12', duration: 24, owner: 'Adrian Cole', status: 'Completed', notes: 'Positive — asked for a written summary.' },
          { id: 'cl-2', contactId: 'c-1', subject: 'Follow-up on API rate limits', date: '2026-08-26', duration: 15, owner: 'Adrian Cole', status: 'Scheduled', notes: '' },
          { id: 'cl-3', contactId: 'c-2', subject: 'Discovery call', date: '2026-08-06', duration: 32, owner: 'Maya Iqbal', status: 'Completed', notes: 'Needs multi-site reporting.' },
          { id: 'cl-4', contactId: 'c-3', subject: 'Onboarding check-in', date: '2026-08-18', duration: 0, owner: 'Adrian Cole', status: 'Voicemail', notes: '' }
        ],
        meetings: [
          { id: 'mt-1', contactId: 'c-1', subject: 'Quarterly business review', date: '2026-08-02', time: '10:00', duration: 60, location: 'On-site', status: 'Completed', agenda: 'Adoption, roadmap, renewal.' },
          { id: 'mt-2', contactId: 'c-1', subject: 'Analytics module demo', date: '2026-08-09', time: '15:30', duration: 45, location: 'Video call', status: 'Completed', agenda: 'Live demo of the forecasting add-on.' },
          { id: 'mt-3', contactId: 'c-1', subject: 'Executive alignment', date: '2026-08-26', time: '09:30', duration: 30, location: 'Video call', status: 'Upcoming', agenda: 'Confirm renewal scope with the exec sponsor.' },
          { id: 'mt-4', contactId: 'c-2', subject: 'Solution design workshop', date: '2026-08-24', time: '13:00', duration: 90, location: 'Video call', status: 'Upcoming', agenda: 'Site rollout sequencing.' }
        ],
        tasks: [
          { id: 'tk-1', contactId: 'c-1', title: 'Share security questionnaire', due: '2026-08-08', priority: 'Medium', owner: 'Adrian Cole', status: 'Completed' },
          { id: 'tk-2', contactId: 'c-1', title: 'Send updated quote', due: '2026-08-11', priority: 'High', owner: 'Adrian Cole', status: 'Completed' },
          { id: 'tk-3', contactId: 'c-1', title: 'Confirm procurement contact', due: '2026-08-14', priority: 'Low', owner: 'Maya Iqbal', status: 'Completed' },
          { id: 'tk-4', contactId: 'c-1', title: 'Prepare renewal deck', due: '2026-08-24', priority: 'High', owner: 'Adrian Cole', status: 'In progress' },
          { id: 'tk-5', contactId: 'c-2', title: 'Send logistics case study', due: '2026-08-22', priority: 'Medium', owner: 'Adrian Cole', status: 'Open' },
          { id: 'tk-6', contactId: 'c-2', title: 'Schedule procurement intro', due: '2026-08-28', priority: 'Low', owner: 'Maya Iqbal', status: 'Open' },
          { id: 'tk-7', contactId: 'c-3', title: 'Review data model draft', due: '2026-08-21', priority: 'High', owner: 'Priya Raman', status: 'Open' }
        ],
        cases: [
          { id: 'cs-1', contactId: 'c-1', subject: 'SSO session drops after 20 minutes', priority: 'High', status: 'In progress', channel: 'Email', date: '2026-08-01', description: 'Users are logged out mid-session on the corporate IdP.' },
          { id: 'cs-2', contactId: 'c-1', subject: 'Report export times out', priority: 'Medium', status: 'Open', channel: 'Portal', date: '2026-08-04', description: 'Exports above 50k rows fail.' },
          { id: 'cs-3', contactId: 'c-1', subject: 'Billing address mismatch', priority: 'Low', status: 'Open', channel: 'Email', date: '2026-08-06', description: 'Invoice address differs from the account address.' },
          { id: 'cs-4', contactId: 'c-1', subject: 'Webhook retries are duplicated', priority: 'Medium', status: 'Open', channel: 'Portal', date: '2026-08-10', description: 'Duplicate deliveries on 5xx retries.' },
          { id: 'cs-5', contactId: 'c-1', subject: 'Seat provisioning delay', priority: 'High', status: 'Open', channel: 'Phone', date: '2026-08-15', description: 'New seats take 24h to appear.' },
          { id: 'cs-6', contactId: 'c-2', subject: 'Sandbox access request', priority: 'Low', status: 'Resolved', channel: 'Email', date: '2026-08-09', description: 'Requested a sandbox tenant for testing.' },
          { id: 'cs-7', contactId: 'c-3', subject: 'API key rotation guidance', priority: 'Medium', status: 'In progress', channel: 'Chat', date: '2026-08-17', description: 'Needs a zero-downtime rotation runbook.' }
        ],
        quotes: [
          { id: 'qt-1', contactId: 'c-1', title: 'QT-3391 · Analytics Suite renewal', amount: 225, status: 'Accepted', date: '2026-08-05', validUntil: '2026-09-05' },
          { id: 'qt-2', contactId: 'c-2', title: 'QT-3402 · Multi-site pilot', amount: 26500, status: 'Sent', date: '2026-08-13', validUntil: '2026-09-13' }
        ],
        invoices: [
          { id: 'in-1', contactId: 'c-1', number: 'INV-2081', product: 'Analytics Suite — Annual', units: 2, amount: 225, status: 'Paid', date: '2020-07-16' },
          { id: 'in-2', contactId: 'c-1', number: 'INV-2140', product: 'Priority Support Add-on', units: 2, amount: 190, status: 'Paid', date: '2020-07-16' },
          { id: 'in-3', contactId: 'c-3', number: 'INV-2210', product: 'Data Platform — Annual', units: 1, amount: 320, status: 'Paid', date: '2025-12-01' }
        ],
        emails: [
          { id: 'em-1', contactId: 'c-1', subject: 'Renewal summary and next steps', to: 'info.section.im@example.de', status: 'Sent', date: '2026-08-12', body: 'Thanks for the call — the renewal summary is attached.' },
          { id: 'em-2', contactId: 'c-1', subject: 'Security questionnaire response', to: 'info.section.im@example.de', status: 'Sent', date: '2026-08-08', body: 'Completed questionnaire attached for your review.' },
          { id: 'em-3', contactId: 'c-2', subject: 'Logistics case study', to: 'm.feld@halden.example', status: 'Draft', date: '2026-08-19', body: '' }
        ],
        notes: [
          { id: 'nt-1', contactId: 'c-1', body: 'Prefers a written summary after every call — forwards it to procurement.', author: 'Adrian Cole', date: '2026-08-12' },
          { id: 'nt-2', contactId: 'c-1', body: 'Budget approval closes end of September. Paperwork must land before 20 Sep.', author: 'Adrian Cole', date: '2026-08-09' },
          { id: 'nt-3', contactId: 'c-1', body: 'Interested in the forecasting add-on once SSO stability is confirmed.', author: 'Maya Iqbal', date: '2026-08-04' },
          { id: 'nt-4', contactId: 'c-1', body: 'Champion for the analytics rollout across three regional teams.', author: 'Adrian Cole', date: '2026-07-28' },
          { id: 'nt-5', contactId: 'c-1', body: 'Do not schedule calls on Fridays — internal planning day.', author: 'Maya Iqbal', date: '2026-07-19' },
          { id: 'nt-6', contactId: 'c-2', body: 'Decision committee meets fortnightly on Tuesdays.', author: 'Adrian Cole', date: '2026-08-13' }
        ],
        documents: [
          { id: 'dc-1', contactId: 'c-1', name: 'MSA_2026_Signed.pdf', size: '1.4 MB', type: 'Contract', date: '2026-08-03' },
          { id: 'dc-2', contactId: 'c-1', name: 'Security_Review.xlsx', size: '820 KB', type: 'Spreadsheet', date: '2026-08-07' },
          { id: 'dc-3', contactId: 'c-1', name: 'Renewal_Deck_v3.pptx', size: '6.1 MB', type: 'Presentation', date: '2026-08-14' },
          { id: 'dc-4', contactId: 'c-3', name: 'Data_Model_Draft.pdf', size: '2.2 MB', type: 'Report', date: '2026-08-16' }
        ],
        opportunities: [
          { id: 'op-1', contactId: 'c-1', name: 'Platform expansion — 40 seats', stage: 'Negotiation', amount: 48000, close: '2026-09-30', probability: 70, owner: 'Adrian Cole' },
          { id: 'op-2', contactId: 'c-2', name: 'Multi-site rollout pilot', stage: 'Proposal', amount: 26500, close: '2026-10-15', probability: 45, owner: 'Adrian Cole' },
          { id: 'op-3', contactId: 'c-3', name: 'Data platform add-on', stage: 'Qualification', amount: 12000, close: '2026-11-06', probability: 25, owner: 'Maya Iqbal' },
          { id: 'op-4', contactId: 'c-3', name: 'Annual platform renewal', stage: 'Closed Won', amount: 31000, close: '2026-07-01', probability: 100, owner: 'Adrian Cole' }
        ],
        campaigns: [
          { id: 'cp-1', name: 'Q3 Renewal Nurture', channel: 'Email', status: 'Active', budget: 4200, sent: 1820, opened: 964, clicked: 287, date: '2026-07-14', contactIds: ['c-2', 'c-3'] },
          { id: 'cp-2', name: 'Product Clinic Webinar', channel: 'Webinar', status: 'Completed', budget: 6800, sent: 2400, opened: 1310, clicked: 402, date: '2026-05-21', contactIds: ['c-1', 'c-3'] },
          { id: 'cp-3', name: 'Logistics Vertical Launch', channel: 'Paid Social', status: 'Planned', budget: 9500, sent: 0, opened: 0, clicked: 0, date: '2026-09-08', contactIds: [] },
          { id: 'cp-4', name: 'Customer Advisory Dinner', channel: 'Events', status: 'Active', budget: 12000, sent: 140, opened: 96, clicked: 41, date: '2026-08-11', contactIds: ['c-3'] }
        ],
        leads: [
          { id: 'ld-1', contactId: 'c-1', name: 'Lead #1180 · Webinar sign-up', source: 'Webinar', email: 'info.section.im@example.de', status: 'Converted', date: '2020-07-16' },
          { id: 'ld-2', contactId: 'c-2', name: 'Lead #2044 · Pricing enquiry', source: 'Website', email: 'm.feld@halden.example', status: 'Working', date: '2026-05-04' }
        ]
      },

      team: [
        { id: 'u-1', name: 'Adrian Cole', role: 'Account Executive', status: 'Online' },
        { id: 'u-2', name: 'Maya Iqbal', role: 'Customer Success', status: 'Online' },
        { id: 'u-3', name: 'Tomas Vega', role: 'Solutions Engineer', status: 'In a meeting' },
        { id: 'u-4', name: 'Sara Lindqvist', role: 'Support Lead', status: 'Away' },
        { id: 'u-5', name: 'Daniel Okafor', role: 'Revenue Operations', status: 'Offline' }
      ],

      feed: [
        { id: 'f-1', author: 'Maya Iqbal', body: 'Lilian confirmed the renewal scope — I have attached the updated deck to her record.', ts: Date.now() - 36e5 * 3 },
        { id: 'f-2', author: 'Tomas Vega', body: 'SSO drop-off looks like an IdP session-timeout mismatch. Runbook is in progress.', ts: Date.now() - 36e5 * 9 },
        { id: 'f-3', author: 'Sara Lindqvist', body: 'Two tickets escalated to Tier 2 this week — both on the Halden account.', ts: Date.now() - 36e5 * 26 }
      ],

      notifications: [
        { id: 'n-1', title: 'New task assigned', text: '“Prepare renewal deck” is due 24 Aug.', icon: 'task', ts: Date.now() - 12 * 6e4, unread: true, route: 'contact', param: 'c-1', module: 'tasks' },
        { id: 'n-2', title: 'Meeting reminder', text: 'Executive alignment · 26 Aug, 09:30.', icon: 'video', ts: Date.now() - 55 * 6e4, unread: true, route: 'contact', param: 'c-1', module: 'meetings' },
        { id: 'n-3', title: 'New email received', text: 'Marcus Feld replied about the multi-site pilot.', icon: 'mail', ts: Date.now() - 36e5 * 5, unread: true, route: 'contact', param: 'c-2', module: 'emails' },
        { id: 'n-4', title: 'Contact updated', text: 'Priya Raman moved to lifecycle “Onboarding”.', icon: 'user', ts: Date.now() - 36e5 * 30, unread: false, route: 'contact', param: 'c-3' }
      ]
    };
  }

  /* ======================================================================
     03. STORE — loadData() / saveData() / resetData()
     ====================================================================== */
  const STORAGE_KEY = 'nexusCrmData';
  const CONTACT_KEY = 'contactData';   // convenience mirror of the active contact

  let DB = seedData();

  /** UI-only state (never persisted apart from the parts stored in DB). */
  const state = {
    route: 'contact', param: null, tab: 'overview',
    filters: {}, loadTimer: null, modalRefresh: null, lastDeleted: null
  };

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.contacts) || !saved.contacts.length) return false;

      const base = seedData();
      DB = Object.assign(base, saved);
      DB.admin = Object.assign(base.admin, saved.admin || {});
      DB.settings = Object.assign(base.settings, saved.settings || {});
      DB.records = Object.assign(base.records, saved.records || {});
      return true;
    } catch (err) {
      console.error('[Nexus CRM] Failed to read saved data, falling back to defaults.', err);
      return false;
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
      localStorage.setItem(CONTACT_KEY, JSON.stringify(activeContact() || {}));
      return true;
    } catch (err) {
      console.warn('[Nexus CRM] Storage unavailable — changes stay in memory for this session.', err);
      return false;
    }
  }

  function resetData() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CONTACT_KEY);
    } catch (err) { /* storage may be blocked — resetting memory is enough */ }
    DB = seedData();
    saveData();
  }

  /* ---- Data accessors ---- */
  const contactById = (id) => DB.contacts.find((c) => c.id === id) || null;
  const activeContact = () => contactById(DB.activeContactId) || DB.contacts[0] || null;
  const fullName = (c) => c ? `${c.firstName} ${c.lastName}`.trim() : '—';
  const contactAddress = (c, joiner = ', ') =>
    [c.street, [c.city, c.state, c.zip].filter(Boolean).join(' '), c.country].filter(Boolean).join(joiner);
  const otherAddress = (c, joiner = ', ') =>
    [c.otherStreet, [c.otherCity, c.otherState, c.otherZip].filter(Boolean).join(' '), c.otherCountry].filter(Boolean).join(joiner);

  const allRecords = (key) => DB.records[key] || [];
  const recordsFor = (key, contactId) => {
    const mod = MODULES[key];
    const list = allRecords(key);
    return mod && mod.scope ? list.filter((r) => mod.scope(r, contactId)) : list.filter((r) => r.contactId === contactId);
  };
  const findRecord = (key, id) => allRecords(key).find((r) => r.id === id) || null;

  /* ======================================================================
     04. MODULE REGISTRY
     One entry per CRM record type: how to label, list, count and edit it.
     ====================================================================== */
  const TONES = {
    Completed: 'ok', Paid: 'ok', Accepted: 'ok', Converted: 'ok', 'Closed Won': 'ok',
    Resolved: 'ok', Closed: 'mute', Signed: 'ok', Active: 'ok', Qualified: 'ok',
    Sent: 'info', Scheduled: 'info', Upcoming: 'info', Open: 'info', New: 'info',
    Qualification: 'info', Proposal: 'info',
    Draft: 'mute', Planned: 'mute',
    'In progress': 'warn', Working: 'warn', Pending: 'warn', Voicemail: 'warn', Negotiation: 'warn',
    Overdue: 'danger', 'Closed Lost': 'danger', Lost: 'danger', Cancelled: 'danger'
  };
  const toneFor = (status) => TONES[status] || 'info';

  const MODULES = {
    calls: {
      label: 'Calls', singular: 'Call', icon: 'phone', accent: '#6366f1',
      hint: 'total / completed', doneLabel: 'Completed',
      doneWhen: (r) => r.status === 'Completed',
      title: (r) => r.subject,
      meta: (r) => `${fmtDate(r.date)} · ${r.duration || 0} min · ${r.owner || 'Unassigned'}`,
      status: (r) => r.status,
      make: () => ({ subject: '', date: todayISO(), duration: 15, owner: DB.admin.name, status: 'Completed', notes: '' }),
      toggle: (r) => { r.status = r.status === 'Completed' ? 'Scheduled' : 'Completed'; },
      fields: [
        { name: 'subject', label: 'Subject', required: true, full: true },
        { name: 'date', label: 'Date', type: 'date' },
        { name: 'duration', label: 'Duration (minutes)', type: 'number', min: 0, max: 600 },
        { name: 'owner', label: 'Logged by' },
        { name: 'status', label: 'Outcome', type: 'select', options: ['Completed', 'Scheduled', 'Voicemail'] },
        { name: 'notes', label: 'Call notes', type: 'textarea', full: true }
      ]
    },

    meetings: {
      label: 'Meetings', singular: 'Meeting', icon: 'users', accent: '#8b5cf6',
      hint: 'total / completed', doneLabel: 'Completed',
      doneWhen: (r) => r.status === 'Completed',
      title: (r) => r.subject,
      meta: (r) => `${fmtDate(r.date)}${r.time ? ' · ' + r.time : ''} · ${r.duration || 0} min · ${r.location || 'Video call'}`,
      status: (r) => r.status,
      make: () => ({ subject: '', date: daysFromNow(2), time: '10:00', duration: 30, location: 'Video call', status: 'Upcoming', agenda: '' }),
      toggle: (r) => { r.status = r.status === 'Completed' ? 'Upcoming' : 'Completed'; },
      fields: [
        { name: 'subject', label: 'Meeting title', required: true, full: true },
        { name: 'date', label: 'Date', type: 'date' },
        { name: 'time', label: 'Start time', type: 'time' },
        { name: 'duration', label: 'Duration (minutes)', type: 'number', min: 5, max: 600 },
        { name: 'location', label: 'Location', type: 'select', options: ['Video call', 'On-site', 'Phone'] },
        { name: 'status', label: 'Status', type: 'select', options: ['Upcoming', 'Completed', 'Cancelled'] },
        { name: 'agenda', label: 'Agenda', type: 'textarea', full: true }
      ]
    },

    tasks: {
      label: 'Tasks', singular: 'Task', icon: 'task', accent: '#0ea5e9',
      hint: 'total / completed', doneLabel: 'Completed',
      doneWhen: (r) => r.status === 'Completed',
      title: (r) => r.title,
      meta: (r) => `Due ${fmtDate(r.due)} · ${r.priority} priority · ${r.owner || 'Unassigned'}`,
      status: (r) => r.status,
      date: (r) => r.due,
      make: () => ({ title: '', due: daysFromNow(3), priority: 'Medium', owner: DB.admin.name, status: 'Open' }),
      toggle: (r) => { r.status = r.status === 'Completed' ? 'Open' : 'Completed'; },
      fields: [
        { name: 'title', label: 'Task title', required: true, full: true },
        { name: 'due', label: 'Due date', type: 'date' },
        { name: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High'] },
        { name: 'owner', label: 'Assigned to' },
        { name: 'status', label: 'Status', type: 'select', options: ['Open', 'In progress', 'Completed'] }
      ]
    },

    cases: {
      label: 'Cases', singular: 'Ticket', icon: 'case', accent: '#f43f5e',
      hint: 'total / resolved', doneLabel: 'Resolved',
      doneWhen: (r) => r.status === 'Resolved' || r.status === 'Closed',
      title: (r) => r.subject,
      meta: (r) => `Opened ${fmtDate(r.date)} · ${r.priority} priority · ${r.channel}`,
      status: (r) => r.status,
      make: () => ({ subject: '', priority: 'Medium', status: 'Open', channel: 'Email', date: todayISO(), description: '' }),
      toggle: (r) => { r.status = r.status === 'Resolved' ? 'Open' : 'Resolved'; },
      fields: [
        { name: 'subject', label: 'Subject', required: true, full: true },
        { name: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High'] },
        { name: 'status', label: 'Status', type: 'select', options: ['Open', 'In progress', 'Resolved', 'Closed'] },
        { name: 'channel', label: 'Channel', type: 'select', options: ['Email', 'Phone', 'Portal', 'Chat'] },
        { name: 'date', label: 'Opened on', type: 'date' },
        { name: 'description', label: 'Description', type: 'textarea', full: true }
      ]
    },

    quotes: {
      label: 'Quotes', singular: 'Quote', icon: 'quote', accent: '#f59e0b',
      hint: 'total / accepted', doneLabel: 'Accepted',
      doneWhen: (r) => r.status === 'Accepted',
      title: (r) => r.title,
      meta: (r) => `Issued ${fmtDate(r.date)} · ${money(r.amount)} · valid to ${fmtDate(r.validUntil)}`,
      status: (r) => r.status,
      make: () => ({ title: '', amount: 0, status: 'Draft', date: todayISO(), validUntil: daysFromNow(30) }),
      fields: [
        { name: 'title', label: 'Quote title', required: true, full: true },
        { name: 'amount', label: 'Amount ($)', type: 'number', required: true, min: 0 },
        { name: 'status', label: 'Status', type: 'select', options: ['Draft', 'Sent', 'Accepted', 'Declined'] },
        { name: 'date', label: 'Issued on', type: 'date' },
        { name: 'validUntil', label: 'Valid until', type: 'date' }
      ]
    },

    invoices: {
      label: 'Invoices', singular: 'Invoice', icon: 'invoice', accent: '#10b981',
      hint: 'total / paid', doneLabel: 'Paid',
      doneWhen: (r) => r.status === 'Paid',
      title: (r) => `${r.number} · ${r.product}`,
      meta: (r) => `${fmtDate(r.date)} · ${r.units} unit${Number(r.units) === 1 ? '' : 's'} · ${money(r.amount)}`,
      status: (r) => r.status,
      make: () => ({ number: 'INV-' + Math.floor(2200 + Math.random() * 700), product: '', units: 1, amount: 0, status: 'Paid', date: todayISO() }),
      fields: [
        { name: 'number', label: 'Invoice number', required: true },
        { name: 'product', label: 'Product', required: true },
        { name: 'units', label: 'Units', type: 'number', min: 1, max: 9999 },
        { name: 'amount', label: 'Amount ($)', type: 'number', required: true, min: 0 },
        { name: 'status', label: 'Status', type: 'select', options: ['Paid', 'Pending', 'Overdue'] },
        { name: 'date', label: 'Invoice date', type: 'date' }
      ]
    },

    emails: {
      label: 'Emails', singular: 'Email', icon: 'mail', accent: '#06b6d4',
      hint: 'messages logged', doneLabel: 'Sent',
      doneWhen: null,
      title: (r) => r.subject,
      meta: (r) => `To ${r.to} · ${fmtDate(r.date)}`,
      status: (r) => r.status,
      make: () => {
        const c = activeContact();
        return { subject: '', to: c ? c.email : '', status: 'Sent', date: todayISO(), body: '' };
      },
      fields: [
        { name: 'subject', label: 'Subject', required: true, full: true },
        { name: 'to', label: 'To', type: 'email', required: true },
        { name: 'status', label: 'Status', type: 'select', options: ['Sent', 'Draft', 'Scheduled'] },
        { name: 'date', label: 'Date', type: 'date' },
        { name: 'body', label: 'Message', type: 'textarea', full: true }
      ]
    },

    notes: {
      label: 'Notes', singular: 'Note', icon: 'note', accent: '#a855f7',
      hint: 'notes recorded', doneWhen: null,
      title: (r) => r.body,
      meta: (r) => `${r.author || 'Unknown'} · ${fmtDate(r.date)}`,
      status: () => 'Note',
      make: () => ({ body: '', author: DB.admin.name, date: todayISO() }),
      fields: [
        { name: 'body', label: 'Note', type: 'textarea', required: true, full: true },
        { name: 'author', label: 'Author' },
        { name: 'date', label: 'Date', type: 'date' }
      ]
    },

    documents: {
      label: 'Documents', singular: 'Document', icon: 'doc', accent: '#64748b',
      hint: 'files attached', doneWhen: null,
      title: (r) => r.name,
      meta: (r) => `${r.size || '—'} · ${r.type} · ${fmtDate(r.date)}`,
      status: (r) => r.type,
      make: () => ({ name: '', size: '', type: 'Contract', date: todayISO() }),
      fields: [
        { name: 'file', label: 'Choose a file', type: 'file', full: true },
        { name: 'name', label: 'Document name', required: true, full: true },
        { name: 'size', label: 'Size' },
        { name: 'type', label: 'Type', type: 'select', options: ['Contract', 'Report', 'Presentation', 'Spreadsheet', 'Other'] },
        { name: 'date', label: 'Uploaded on', type: 'date' }
      ]
    },

    opportunities: {
      label: 'Opportunity', singular: 'Deal', icon: 'bulb', accent: '#f97316',
      hint: 'open pipeline', doneWhen: null,
      title: (r) => r.name,
      meta: (r) => `${r.stage} · closes ${fmtDate(r.close)} · ${r.probability}% · ${money(r.amount)}`,
      status: (r) => r.stage,
      date: (r) => r.close,
      make: () => ({ name: '', stage: 'Qualification', amount: 0, close: daysFromNow(45), probability: 25, owner: DB.admin.name }),
      fields: [
        { name: 'name', label: 'Deal name', required: true, full: true },
        { name: 'stage', label: 'Stage', type: 'select', options: STAGES },
        { name: 'amount', label: 'Amount ($)', type: 'number', required: true, min: 0 },
        { name: 'close', label: 'Expected close', type: 'date' },
        { name: 'probability', label: 'Probability (%)', type: 'number', min: 0, max: 100 },
        { name: 'owner', label: 'Deal owner' }
      ]
    },

    campaigns: {
      label: 'Campaigns', singular: 'Campaign', icon: 'megaphone', accent: '#ec4899',
      hint: 'campaigns joined', doneWhen: null,
      scope: (r, contactId) => (r.contactIds || []).includes(contactId),
      title: (r) => r.name,
      meta: (r) => `${r.channel} · started ${fmtDate(r.date)} · ${Number(r.sent || 0).toLocaleString('en-US')} sent`,
      status: (r) => r.status,
      make: () => ({ name: '', channel: 'Email', status: 'Planned', budget: 0, sent: 0, opened: 0, clicked: 0, date: todayISO(), contactIds: [] }),
      fields: [
        { name: 'name', label: 'Campaign name', required: true, full: true },
        { name: 'channel', label: 'Channel', type: 'select', options: ['Email', 'Webinar', 'Events', 'Paid Social'] },
        { name: 'status', label: 'Status', type: 'select', options: ['Planned', 'Active', 'Completed'] },
        { name: 'budget', label: 'Budget ($)', type: 'number', min: 0 },
        { name: 'date', label: 'Start date', type: 'date' },
        { name: 'sent', label: 'Sent', type: 'number', min: 0 },
        { name: 'opened', label: 'Opened', type: 'number', min: 0 },
        { name: 'clicked', label: 'Clicked', type: 'number', min: 0 }
      ]
    },

    leads: {
      label: 'Leads', singular: 'Lead', icon: 'lead', accent: '#14b8a6',
      hint: 'linked leads', doneWhen: null,
      title: (r) => r.name,
      meta: (r) => `${r.source || 'Unknown source'} · ${fmtDate(r.date)}`,
      status: (r) => r.status,
      make: () => ({ name: '', source: 'Website', email: '', status: 'New', date: todayISO() }),
      fields: [
        { name: 'name', label: 'Lead name', required: true, full: true },
        { name: 'source', label: 'Source' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'status', label: 'Status', type: 'select', options: ['New', 'Working', 'Qualified', 'Converted', 'Lost'] },
        { name: 'date', label: 'Created on', type: 'date' }
      ]
    }
  };

  /** Order of the twelve activity cards on the contact profile. */
  const MODULE_ORDER = ['calls', 'meetings', 'tasks', 'cases', 'quotes', 'invoices',
    'emails', 'notes', 'documents', 'opportunities', 'campaigns', 'leads'];

  /** The date a record should be sorted/filtered by. */
  const recordDate = (key, r) => (MODULES[key].date ? MODULES[key].date(r) : r.date) || '';

  /* ======================================================================
     05. TOASTS — showToast(title, text, type, options)
     ====================================================================== */
  const TOAST_ICONS = { info: 'info', success: 'check', warning: 'alert', danger: 'alert' };

  function showToast(title, text = '', type = 'info', options = {}) {
    const root = $('#toasts');
    if (!root) return;

    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.innerHTML = `
      <span class="toast__icon">${icon(TOAST_ICONS[type] || 'info', 'ico--sm')}</span>
      <div class="toast__body">
        <p class="toast__title">${esc(title)}</p>
        ${text ? `<p class="toast__text">${esc(text)}</p>` : ''}
        ${options.actionLabel ? `<button class="toast__action" type="button">${esc(options.actionLabel)}</button>` : ''}
      </div>
      <button class="toast__close" type="button" aria-label="Dismiss">${icon('close', 'ico--xs')}</button>`;

    const dismiss = () => {
      if (!el.isConnected) return;
      el.classList.add('is-leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    };

    $('.toast__close', el).addEventListener('click', dismiss);
    const action = $('.toast__action', el);
    if (action) {
      action.addEventListener('click', () => {
        dismiss();
        if (typeof options.onAction === 'function') options.onAction();
      });
    }

    root.appendChild(el);
    setTimeout(dismiss, options.timeout || (options.actionLabel ? 7000 : 3800));
  }

  /* ======================================================================
     06. MODAL — openModal(config) / closeModal()
     ====================================================================== */
  const modalEl = () => $('#modal');

  let lastFocused = null;

  function openModal(cfg = {}) {
    const el = modalEl();
    if (!el.hidden) {
      // Re-using the open dialog (e.g. drilling from a list into a form).
      el.querySelector('.modal__dialog').style.animation = 'none';
      requestAnimationFrame(() => { el.querySelector('.modal__dialog').style.animation = ''; });
    } else {
      lastFocused = document.activeElement;
    }

    el.classList.toggle('modal--wide', !!cfg.wide);
    $('#modalTitle').textContent = cfg.title || '';
    $('#modalSub').textContent = cfg.sub || '';

    const iconBox = $('#modalIcon');
    iconBox.className = 'modal__icon' + (cfg.tone === 'danger' ? ' modal__icon--danger' : '');
    iconBox.innerHTML = icon(cfg.icon || 'info');

    $('#modalBody').innerHTML = cfg.body || '';
    $('#modalFoot').innerHTML = cfg.footer || '';
    el.hidden = false;
    document.body.style.overflow = 'hidden';

    state.modalRefresh = typeof cfg.refresh === 'function' ? cfg.refresh : null;
    if (typeof cfg.onMount === 'function') cfg.onMount($('.modal__dialog', el));

    const focusTarget = el.querySelector('[data-autofocus]') || focusablesIn()[0];
    if (focusTarget) setTimeout(() => focusTarget.focus(), 40);
  }

  function closeModal() {
    const el = modalEl();
    if (el.hidden) return;
    el.hidden = true;
    $('#modalBody').innerHTML = '';
    $('#modalFoot').innerHTML = '';
    document.body.style.overflow = '';
    state.modalRefresh = null;
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
  }

  /** Re-render the currently open modal (used after a record changes). */
  function refreshModal() {
    if (typeof state.modalRefresh === 'function') state.modalRefresh();
  }

  function focusablesIn() {
    const dialog = $('.modal__dialog');
    if (!dialog) return [];
    return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', dialog)
      .filter((el) => el.offsetParent !== null);
  }

  function trapFocus(e) {
    const items = focusablesIn();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /** Generic confirmation dialog. */
  function confirmModal({ title, sub, message, confirmLabel = 'Confirm', tone = 'danger', iconName = 'alert', onConfirm, returnTo }) {
    openModal({
      title, sub, icon: iconName, tone,
      body: `<div class="${tone === 'danger' ? 'danger-note' : 'fieldset-note'}">
               ${icon(tone === 'danger' ? 'alert' : 'info', 'ico--sm')}<span>${message}</span>
             </div>`,
      footer: `
        <button class="btn btn--quiet" type="button" data-modal-dismiss>Cancel</button>
        <button class="btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}" type="button" data-confirm data-autofocus>${esc(confirmLabel)}</button>`,
      onMount: (dialog) => {
        $('[data-confirm]', dialog).addEventListener('click', () => {
          onConfirm();
          if (returnTo) returnTo(); else closeModal();
        });
        $('[data-modal-dismiss]', dialog).addEventListener('click', () => {
          if (returnTo) returnTo(); else closeModal();
        });
      }
    });
  }

  /* ======================================================================
     07. FORM BUILDER — one implementation for every form in the app
     ====================================================================== */
  function buildFields(fields, values = {}) {
    return fields.map((f) => {
      const id = `f-${f.name}`;
      const val = values[f.name] ?? '';
      const label = `<label class="form__label" for="${id}">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>`;
      let control;

      switch (f.type) {
        case 'textarea':
          control = `<textarea class="textarea" id="${id}" name="${f.name}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
          break;
        case 'select':
          control = `<select class="select" id="${id}" name="${f.name}">
            ${f.options.map((o) => `<option value="${esc(o)}" ${String(val) === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}
          </select>`;
          break;
        case 'file':
          return `<div class="form__group form__group--full">
            <label class="filedrop" for="${id}">
              <span class="filedrop__icon">${icon('upload', 'ico--sm')}</span>
              <span>
                <span class="filedrop__title" data-file-name>Choose a file to attach</span>
                <span class="filedrop__note">The file name, size and type are captured — nothing is uploaded to a server.</span>
              </span>
              <input type="file" id="${id}" data-file-input />
            </label>
          </div>`;
        default:
          control = `<input class="input" id="${id}" name="${f.name}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'}"
            value="${esc(val)}" placeholder="${esc(f.placeholder || '')}"
            ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}
            ${f.autofocus ? 'data-autofocus' : ''} />`;
      }

      return `<div class="form__group ${f.full ? 'form__group--full' : ''}">
        ${label}${control}
        <p class="form__error" data-error-for="${f.name}"></p>
      </div>`;
    }).join('');
  }

  /** Validate a single field value against its schema. */
  function validateField(f, raw) {
    const v = String(raw ?? '').trim();
    if (f.required && !v) return `${f.label} is required.`;
    if (!v) return '';
    if (f.type === 'email' && !isEmail(v)) return 'Enter a valid email address (name@company.com).';
    if (f.type === 'tel' && !isPhone(v)) return 'Enter a valid phone number — at least 7 digits.';
    if (f.type === 'number') {
      const n = Number(v);
      if (Number.isNaN(n)) return 'Enter a number.';
      if (f.min != null && n < f.min) return `Must be ${f.min} or more.`;
      if (f.max != null && n > f.max) return `Must be ${f.max} or less.`;
    }
    return '';
  }

  /**
   * Read + validate a form. Paints inline errors and returns the values,
   * or null when the form is invalid.
   */
  function readForm(formEl, fields) {
    const values = {};
    const errors = {};

    fields.filter((f) => f.type !== 'file').forEach((f) => {
      const input = formEl.elements[f.name];
      if (!input) return;
      const raw = input.value;
      const msg = validateField(f, raw);
      if (msg) errors[f.name] = msg;
      values[f.name] = f.type === 'number' ? (raw === '' ? 0 : Number(raw)) : String(raw).trim();
    });

    $$('.input, .textarea, .select', formEl).forEach((el) => el.classList.remove('has-error'));
    $$('[data-error-for]', formEl).forEach((el) => { el.textContent = ''; });

    const keys = Object.keys(errors);
    if (keys.length) {
      keys.forEach((k) => {
        const input = formEl.elements[k];
        const slot = $(`[data-error-for="${k}"]`, formEl);
        if (input) input.classList.add('has-error');
        if (slot) slot.textContent = errors[k];
      });
      const first = formEl.elements[keys[0]];
      if (first) first.focus();
      showToast('Check the highlighted fields', 'Some information is missing or invalid.', 'warning');
      return null;
    }
    return values;
  }

  /** Wire the "upload" field: reads name/size/type from the chosen file. */
  function bindFileField(dialog) {
    const input = $('[data-file-input]', dialog);
    if (!input) return;
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const kb = file.size / 1024;
      const size = kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(kb)) + ' KB';
      const nameField = dialog.querySelector('[name="name"]');
      const sizeField = dialog.querySelector('[name="size"]');
      const typeField = dialog.querySelector('[name="type"]');
      if (nameField) nameField.value = file.name;
      if (sizeField) sizeField.value = size;
      if (typeField) {
        const ext = file.name.split('.').pop().toLowerCase();
        const map = { pdf: 'Contract', doc: 'Report', docx: 'Report', xls: 'Spreadsheet', xlsx: 'Spreadsheet', csv: 'Spreadsheet', ppt: 'Presentation', pptx: 'Presentation' };
        typeField.value = map[ext] || 'Other';
      }
      $('[data-file-name]', dialog).textContent = `${file.name} · ${size}`;
    });
  }

  /* ======================================================================
     08. ROUTER — hash based, no page reloads
     ====================================================================== */
  const NAV_ITEMS = [
    { id: 'home', label: 'Home', icon: 'home', iconOnly: true },
    { id: 'contacts', label: 'Contacts' },
    { id: 'sales', label: 'Sales' },
    { id: 'marketing', label: 'Marketing' },
    { id: 'support', label: 'Support' },
    { id: 'activities', label: 'Activities' },
    { id: 'collaboration', label: 'Collaboration' },
    { id: 'all', label: 'All' }
  ];

  /** Which nav item lights up for a given route. */
  const NAV_FOR_ROUTE = { contact: 'contacts' };

  function go(route, param) {
    const next = '#/' + route + (param ? '/' + param : '');
    if (location.hash === next) { renderView({ skeleton: true }); return; }
    location.hash = next;
  }

  function readHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [route, param] = raw.split('/');
    return { route: route || '', param: param || null };
  }

  function handleRoute() {
    const { route, param } = readHash();
    const known = VIEWS[route] ? route : null;

    if (!known) {
      const landing = DB.settings.landing === 'contact' ? `contact/${DB.activeContactId}` : DB.settings.landing || 'home';
      location.replace('#/' + landing);
      return;
    }

    if (route === 'contact') {
      const target = contactById(param) || activeContact();
      if (!target) { location.replace('#/contacts'); return; }
      DB.activeContactId = target.id;
      state.param = target.id;
      saveData();
    } else {
      state.param = param;
    }

    state.route = route;
    state.filters = {};
    renderNav();
    renderView({ skeleton: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderNav() {
    const activeNav = NAV_FOR_ROUTE[state.route] || state.route;
    $('#navList').innerHTML = NAV_ITEMS.map((item) => `
      <li>
        <a class="mainnav__link ${item.iconOnly ? 'mainnav__link--icon' : ''} ${activeNav === item.id ? 'is-active' : ''}"
           href="#/${item.id}" ${activeNav === item.id ? 'aria-current="page"' : ''}
           ${item.iconOnly ? `aria-label="${esc(item.label)}"` : ''}>
          ${item.icon ? icon(item.icon) : ''}
          <span class="${item.iconOnly ? 'mainnav__label--mobile' : ''}">${esc(item.label)}</span>
        </a>
      </li>`).join('');
  }

  /* ======================================================================
     09. SHARED RENDER HELPERS
     ====================================================================== */
  const pageHead = ({ crumbs = [], title, sub, actions = '' }) => `
    <div class="page__head">
      <div class="page__head-text">
        ${crumbs.length ? `<nav class="crumbs" aria-label="Breadcrumb"><ol>
          ${crumbs.map((c, i) => i === crumbs.length - 1
            ? `<li aria-current="page">${esc(c.label)}</li>`
            : `<li><a href="#/${c.route}">${esc(c.label)}</a></li>`).join('')}
        </ol></nav>` : ''}
        <h1 class="page__title">${esc(title)}</h1>
        ${sub ? `<p class="page__sub">${esc(sub)}</p>` : ''}
      </div>
      ${actions ? `<div class="page__cta">${actions}</div>` : ''}
    </div>`;

  const emptyState = ({ iconName = 'search', title, text, cta = '' }) => `
    <div class="empty">
      <span class="empty__icon">${icon(iconName)}</span>
      <p class="empty__title">${esc(title)}</p>
      <p class="empty__text">${esc(text)}</p>
      ${cta ? `<div class="empty__cta">${cta}</div>` : ''}
    </div>`;

  const kpiCard = ({ label, value, note, iconName, tone = '' }) => `
    <div class="kpi">
      <div class="kpi__head">
        <p class="kpi__label">${esc(label)}</p>
        <span class="kpi__icon">${icon(iconName, 'ico--sm')}</span>
      </div>
      <p class="kpi__value ${tone}">${esc(value)}</p>
      <p class="kpi__note">${esc(note || '')}</p>
    </div>`;

  const searchToolbar = ({ key, placeholder, count, total, extra = '', actions = '' }) => `
    <div class="toolbar">
      <label class="toolbar__search">
        ${icon('search', 'ico--sm')}
        <input type="search" data-filter="${esc(key)}" value="${esc(state.filters[key] || '')}"
               placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" />
      </label>
      ${extra}
      ${actions}
      <span class="toolbar__count">${count} of ${total}</span>
    </div>`;

  const chipRow = (key, options, current) => `
    <div class="chips">
      ${options.map((o) => `
        <button class="chip ${String(current) === String(o.value) ? 'is-active' : ''}" type="button"
                data-act="chip" data-key="${esc(key)}" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
    </div>`;

  /** A single record row with quick actions — used by every module list. */
  function recordRow(key, r, opts = {}) {
    const mod = MODULES[key];
    const status = mod.status(r);
    const done = mod.doneWhen ? mod.doneWhen(r) : false;
    return `
      <article class="rowcard ${done ? 'rowcard--done' : ''}">
        <span class="rowcard__icon" style="color:${mod.accent}">${icon(mod.icon, 'ico--sm')}</span>
        <div class="rowcard__body">
          <p class="rowcard__title">${esc(mod.title(r))}</p>
          <p class="rowcard__meta">${esc(mod.meta(r))}${opts.showContact ? ' · ' + esc(fullName(contactById(r.contactId))) : ''}</p>
        </div>
        <div class="rowcard__side">
          <span class="pill pill--${toneFor(status)}">${esc(status)}</span>
          <div class="rowcard__actions">
            ${mod.toggle ? `<button class="icon-btn icon-btn--sm icon-btn--light" type="button" title="${done ? 'Reopen' : 'Mark as ' + (mod.doneLabel || 'done')}"
                 data-act="toggle-record" data-key="${key}" data-id="${r.id}">${icon('check', 'ico--xs')}</button>` : ''}
            <button class="icon-btn icon-btn--sm icon-btn--light" type="button" title="Edit"
                    data-act="edit-record" data-key="${key}" data-id="${r.id}">${icon('edit', 'ico--xs')}</button>
            <button class="icon-btn icon-btn--sm icon-btn--light is-danger" type="button" title="Delete"
                    data-act="del-record" data-key="${key}" data-id="${r.id}">${icon('trash', 'ico--xs')}</button>
          </div>
        </div>
      </article>`;
  }

  /* Skeleton placeholders shown while a view loads. */
  const SKELETONS = {
    default: `<div class="skeleton"><div class="skel skel--title"></div>
      <div class="skel-grid">${'<div class="skel skel--card"></div>'.repeat(8)}</div></div>`,
    contact: `<div class="skeleton"><div class="skel skel--title"></div>
      <div class="skel-row"><div class="skel skel--card" style="height:420px"></div>
      <div class="skel-grid">${'<div class="skel skel--card"></div>'.repeat(9)}</div></div></div>`
  };

  function renderView(opts = {}) {
    const host = $('#view');
    if (!host) return;
    const draw = () => {
      try {
        host.innerHTML = (VIEWS[state.route] || VIEWS.home)();
      } catch (err) {
        console.error('[Nexus CRM] View failed to render.', err);
        host.innerHTML = emptyState({
          iconName: 'alert', title: 'Something went wrong',
          text: 'This screen could not be rendered. Reloading usually clears it.',
          cta: '<button class="btn btn--primary" type="button" data-act="reload">Reload workspace</button>'
        });
      }
    };

    clearTimeout(state.loadTimer);
    if (opts.skeleton && DB.settings.animations !== false) {
      host.innerHTML = SKELETONS[state.route] || SKELETONS.default;
      state.loadTimer = setTimeout(draw, 240);
    } else {
      draw();
    }
  }

  /** Master refresh: navbar identity, notifications and the active view. */
  function updateUI() {
    renderAdmin();
    renderNotifications();
    renderNav();
    renderView();
  }

  /* ======================================================================
     10. DERIVED DATA (analytics, timelines, roll-ups)
     ====================================================================== */
  function analyticsFor(contact) {
    const invoices = recordsFor('invoices', contact.id).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const total = sum(invoices, (i) => i.amount);
    const units = sum(invoices, (i) => i.units);
    return {
      invoices, total, units,
      first: invoices[0] || null,
      last: invoices[invoices.length - 1] || null,
      average: units ? Math.round(total / units) : 0
    };
  }

  /** Build a chronological timeline for a contact out of every record type. */
  function timelineFor(contact, limit = 8) {
    const items = [];
    MODULE_ORDER.forEach((key) => {
      const mod = MODULES[key];
      recordsFor(key, contact.id).forEach((r) => {
        items.push({
          date: recordDate(key, r),
          title: `${mod.singular || mod.label}: ${mod.title(r)}`.slice(0, 90),
          text: mod.meta(r), icon: mod.icon, accent: mod.accent, key, id: r.id
        });
      });
    });
    return items.sort(byDateDesc).slice(0, limit);
  }

  const openDeals = () => allRecords('opportunities').filter((o) => !o.stage.startsWith('Closed'));
  const openTickets = () => allRecords('cases').filter((c) => c.status !== 'Resolved' && c.status !== 'Closed');
  const openTasks = () => allRecords('tasks').filter((t) => t.status !== 'Completed');
  const paidRevenue = () => sum(allRecords('invoices').filter((i) => i.status === 'Paid'), (i) => i.amount);

  /* ======================================================================
     11. VIEWS
     ====================================================================== */
  const VIEWS = {};

  /* ---------------------------- HOME ---------------------------------- */
  VIEWS.home = function () {
    const admin = DB.admin;
    const deals = openDeals();
    const weighted = Math.round(sum(deals, (d) => d.amount * (Number(d.probability) || 0) / 100));
    const upcoming = allRecords('meetings')
      .filter((m) => m.status === 'Upcoming')
      .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 4);
    const tasks = openTasks().sort((a, b) => String(a.due).localeCompare(String(b.due))).slice(0, 5);

    const recent = MODULE_ORDER.flatMap((key) =>
      allRecords(key).map((r) => ({ key, r, date: recordDate(key, r) }))
    ).sort(byDateDesc).slice(0, 6);

    return `
      ${pageHead({
        title: `Good to see you, ${admin.name.split(' ')[0]}`,
        sub: `Here is what is happening across your workspace on ${fmtDate(todayISO())}.`,
        actions: `
          <button class="btn btn--ghost" type="button" data-act="new-record" data-key="tasks">${icon('task')}<span class="btn__label">New task</span></button>
          <button class="btn btn--primary" type="button" data-act="new-contact">${icon('plus')}<span class="btn__label">New contact</span></button>`
      })}

      <div class="kpis">
        ${kpiCard({ label: 'Open pipeline', value: money(sum(deals, (d) => d.amount)), note: `${deals.length} active deal${deals.length === 1 ? '' : 's'}`, iconName: 'trend' })}
        ${kpiCard({ label: 'Weighted forecast', value: money(weighted), note: 'Probability adjusted', iconName: 'target' })}
        ${kpiCard({ label: 'Revenue collected', value: money(paidRevenue()), note: 'Paid invoices', iconName: 'dollar' })}
        ${kpiCard({ label: 'Open tickets', value: String(openTickets().length), note: `${allRecords('cases').filter((c) => c.priority === 'High' && c.status !== 'Resolved').length} high priority`, iconName: 'support' })}
        ${kpiCard({ label: 'Tasks outstanding', value: String(openTasks().length), note: 'Across all contacts', iconName: 'task' })}
        ${kpiCard({ label: 'Contacts', value: String(DB.contacts.length), note: `${DB.contacts.filter((c) => c.favourite).length} starred`, iconName: 'users' })}
      </div>

      <section class="section">
        <div class="layout">
          <div class="card" style="padding:20px">
            <p class="subhead">Upcoming meetings</p>
            <div class="stack">
              ${upcoming.length ? upcoming.map((m) => `
                <article class="rowcard">
                  <span class="rowcard__icon" style="color:${MODULES.meetings.accent}">${icon('video', 'ico--sm')}</span>
                  <div class="rowcard__body">
                    <p class="rowcard__title">${esc(m.subject)}</p>
                    <p class="rowcard__meta">${esc(fmtDate(m.date))} · ${esc(m.time || '')} · ${esc(fullName(contactById(m.contactId)))}</p>
                  </div>
                  <div class="rowcard__side">
                    <button class="btn btn--sm btn--soft" type="button" data-act="open-contact" data-id="${esc(m.contactId)}">Open</button>
                  </div>
                </article>`).join('')
                : '<p class="empty-note">No meetings scheduled.</p>'}
            </div>

            <p class="subhead">Tasks due next</p>
            <div class="stack">
              ${tasks.length ? tasks.map((t) => recordRow('tasks', t, { showContact: true })).join('')
                : '<p class="empty-note">Nothing outstanding — the queue is clear.</p>'}
            </div>
          </div>

          <div class="layout__main">
            <div class="card" style="padding:20px">
              <p class="subhead">Recent activity</p>
              <div class="feed">
                ${recent.map(({ key, r, date }) => {
                  const mod = MODULES[key];
                  return `
                  <button class="feed__item" type="button" data-act="module" data-key="${key}" data-contact="${esc(r.contactId || '')}" style="text-align:left;width:100%">
                    <span class="feed__icon" style="--acc:${mod.accent};--acc-soft:${mod.accent}1f">${icon(mod.icon, 'ico--sm')}</span>
                    <span class="feed__body">
                      <span class="feed__title">${esc(mod.title(r))}</span>
                      <span class="feed__meta">${esc(mod.label)} · ${esc(fmtDate(date))}${r.contactId ? ' · ' + esc(fullName(contactById(r.contactId))) : ''}</span>
                    </span>
                    <span class="pill pill--${toneFor(mod.status(r))}">${esc(mod.status(r))}</span>
                  </button>`;
                }).join('')}
              </div>
            </div>

            <div class="section-head" style="margin-top:24px"><h2 class="section-title">Jump back in</h2></div>
            <div class="grid-cards">
              ${DB.contacts.slice(0, 3).map((c) => contactCard(c)).join('')}
            </div>
          </div>
        </div>
      </section>`;
  };

  /* -------------------------- CONTACTS LIST ---------------------------- */
  function contactCard(c) {
    const modsWithData = MODULE_ORDER.filter((k) => recordsFor(k, c.id).length).length;
    return `
      <article class="ccard">
        <button class="ccard__star" type="button" aria-pressed="${!!c.favourite}"
                aria-label="${c.favourite ? 'Remove from favourites' : 'Add to favourites'}"
                data-act="toggle-fav" data-id="${esc(c.id)}">${icon('star', 'ico--sm')}</button>
        <div class="ccard__top">
          <span class="avatar avatar--md ${avatarClass(c.id)}">${esc(initialsOf(c.firstName, c.lastName))}</span>
          <div>
            <p class="ccard__name">${esc(fullName(c))}</p>
            <p class="ccard__role">${esc(c.jobTitle || 'No job title')}</p>
          </div>
        </div>
        <ul class="ccard__meta">
          <li>${icon('building', 'ico--sm')}<span>${esc(c.accountName || '—')}</span></li>
          <li>${icon('mail', 'ico--sm')}<span>${esc(c.email)}</span></li>
          <li>${icon('phone', 'ico--sm')}<span>${esc(c.mobile || c.officePhone || '—')}</span></li>
        </ul>
        <div class="profile__tags" style="justify-content:flex-start;margin-top:12px">
          ${(c.tags || []).slice(0, 3).map((t) => `<span class="pill pill--info">${esc(t)}</span>`).join('')}
          <span class="pill pill--mute">${modsWithData} module${modsWithData === 1 ? '' : 's'}</span>
        </div>
        <div class="ccard__foot">
          <button class="btn btn--sm btn--primary" type="button" data-act="open-contact" data-id="${esc(c.id)}">${icon('eye', 'ico--xs')} View</button>
          <button class="btn btn--sm btn--ghost" type="button" data-act="edit-contact" data-id="${esc(c.id)}">${icon('edit', 'ico--xs')} Edit</button>
          <button class="icon-btn icon-btn--sm icon-btn--light is-danger" type="button" title="Delete contact"
                  data-act="delete-contact" data-id="${esc(c.id)}">${icon('trash', 'ico--xs')}</button>
        </div>
      </article>`;
  }

  VIEWS.contacts = function () {
    const q = state.filters.contacts || '';
    const favOnly = state.filters.contactsFav === 'true';
    let list = DB.contacts.filter((c) => matches(q, fullName(c), c.email, c.accountName, c.jobTitle, (c.tags || []).join(' ')));
    if (favOnly) list = list.filter((c) => c.favourite);

    return `
      ${pageHead({
        crumbs: [{ label: 'Home', route: 'home' }, { label: 'Contacts' }],
        title: 'Contacts',
        sub: 'Every person in your workspace, with their live activity roll-up.',
        actions: `<button class="btn btn--primary" type="button" data-act="new-contact">${icon('plus')}<span class="btn__label">New contact</span></button>`
      })}

      ${searchToolbar({
        key: 'contacts', placeholder: 'Search by name, email, company or tag…',
        count: list.length, total: DB.contacts.length,
        extra: chipRow('contactsFav', [{ label: 'All contacts', value: 'false' }, { label: 'Favourites', value: 'true' }], String(favOnly))
      })}

      ${list.length
        ? `<div class="grid-cards">${list.map(contactCard).join('')}</div>`
        : emptyState({
            title: 'No results found',
            text: q ? `Nothing matches “${q}”. Try a different name, company or tag.` : 'There are no contacts in this workspace yet.',
            cta: `<button class="btn btn--primary" type="button" data-act="new-contact">${icon('plus', 'ico--sm')} Create a contact</button>`
          })}`;
  };

  /* ------------------------- CONTACT PROFILE --------------------------- */
  VIEWS.contact = function () {
    const c = activeContact();
    if (!c) {
      return emptyState({
        iconName: 'user', title: 'No contact selected',
        text: 'This workspace has no contacts yet. Create one to get started.',
        cta: `<button class="btn btn--primary" type="button" data-act="new-contact">${icon('plus', 'ico--sm')} Create a contact</button>`
      });
    }

    const a = analyticsFor(c);
    const statCards = [
      { label: 'First Purchase Date', icon: 'calendar', value: a.first ? fmtShort(a.first.date) : '—', note: a.first ? `${money(a.first.amount)} · ${a.first.product}` : 'No purchases yet', delta: a.first ? money(a.first.amount) : '—', grad: 'var(--grad-1)', glow: 'rgba(99,102,241,.35)' },
      { label: 'Last Purchase Date', icon: 'clock', value: a.last ? fmtShort(a.last.date) : '—', note: a.last ? `${money(a.last.amount)} · ${a.last.product}` : 'No purchases yet', delta: a.last ? money(a.last.amount) : '—', grad: 'var(--grad-2)', glow: 'rgba(59,130,246,.35)' },
      { label: 'Total Revenue', icon: 'dollar', value: money(a.total), note: `Across ${a.invoices.length} invoice${a.invoices.length === 1 ? '' : 's'}`, delta: 'Lifetime', grad: 'var(--grad-3)', glow: 'rgba(16,185,129,.32)' },
      { label: 'Purchased Products', icon: 'package', value: String(a.units), note: 'Licences and add-ons owned', delta: 'Active', grad: 'var(--grad-4)', glow: 'rgba(249,115,22,.32)' },
      { label: 'Average Revenue', icon: 'trend', value: money(a.average), note: 'Per purchased product', delta: a.units ? `${a.units} items` : '—', grad: 'var(--grad-5)', glow: 'rgba(236,72,153,.32)' }
    ];

    return `
      ${pageHead({
        crumbs: [{ label: 'Home', route: 'home' }, { label: 'Contacts', route: 'contacts' }, { label: fullName(c) }],
        title: 'Contact Profile',
        sub: 'A 360° view of every interaction, deal and document tied to this contact.',
        actions: `
          <button class="btn btn--ghost" type="button" data-act="new-record" data-key="emails">${icon('mail')}<span class="btn__label">Email</span></button>
          <button class="btn btn--ghost" type="button" data-act="new-record" data-key="calls">${icon('phone')}<span class="btn__label">Call</span></button>
          <button class="btn btn--primary" type="button" data-act="edit-contact" data-id="${esc(c.id)}">${icon('edit')}<span class="btn__label">Edit Contact</span></button>`
      })}

      <section class="layout" aria-label="Contact summary and activity modules">
        <aside class="card profile">
          <div class="profile__banner" aria-hidden="true"></div>
          <button class="star" type="button" aria-pressed="${!!c.favourite}"
                  aria-label="${c.favourite ? 'Remove from favourites' : 'Mark as favourite'}"
                  data-act="toggle-fav" data-id="${esc(c.id)}">${icon('star')}</button>

          <div class="profile__avatar-wrap">
            <span class="avatar avatar--xl ${avatarClass(c.id)}">${esc(initialsOf(c.firstName, c.lastName))}</span>
            <span class="profile__presence" title="Active"></span>
          </div>

          <h2 class="profile__name">${esc(fullName(c))}</h2>
          <p class="profile__role">${esc(c.jobTitle || 'No job title')}</p>
          <p class="profile__account">${icon('building', 'ico--sm')}<span>${esc(c.accountName || 'No account linked')}</span></p>

          <ul class="profile__meta">
            <li><span class="profile__ico">${icon('phone', 'ico--sm')}</span>
              ${c.mobile || c.officePhone
                ? `<a href="${esc(telHref(c.mobile || c.officePhone))}">${esc(c.mobile || c.officePhone)}</a>`
                : '<span>No phone number</span>'}</li>
            <li><span class="profile__ico">${icon('mail', 'ico--sm')}</span>
              <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>
            <li><span class="profile__ico">${icon('pin', 'ico--sm')}</span>
              <span>${esc(contactAddress(c) || 'No address on file')}</span></li>
          </ul>

          <div class="profile__tags">
            ${(c.tags || []).map((t) => `<span class="pill pill--info">${esc(t)}</span>`).join('') || '<span class="pill pill--mute">No tags</span>'}
          </div>

          <div class="profile__score">
            <div class="profile__score-head"><span>Engagement score</span><strong>${Number(c.engagement) || 0}%</strong></div>
            <div class="meter"><span class="meter__fill" style="width:${Number(c.engagement) || 0}%"></span></div>
            <p class="profile__score-note">${esc(c.lifecycle || 'Lifecycle not set')}</p>
          </div>

          <div class="profile__cta">
            <button class="btn btn--primary btn--block" type="button" data-act="edit-contact" data-id="${esc(c.id)}">${icon('edit')} Edit details</button>
            <button class="btn btn--soft" type="button" data-act="new-record" data-key="notes">${icon('note')} Note</button>
            <button class="btn btn--soft" type="button" data-act="new-record" data-key="tasks">${icon('task')} Task</button>
          </div>
        </aside>

        <div class="layout__main">
          <div class="section-head">
            <div>
              <h2 class="section-title">Activity modules</h2>
              <p class="section-note">Open any card to create, edit or delete its records.</p>
            </div>
            <span class="pill pill--live"><span class="pill__dot"></span>Live data</span>
          </div>

          <div class="acards">
            ${MODULE_ORDER.map((key, i) => {
              const mod = MODULES[key];
              const list = recordsFor(key, c.id);
              const done = mod.doneWhen ? list.filter(mod.doneWhen).length : null;
              const figures = done === null
                ? `<span class="acard__num">${list.length}</span>`
                : `<span class="acard__num">${list.length}</span><span class="acard__sep">/</span><span class="acard__num acard__num--muted">${done}</span>`;
              return `
                <button class="acard" type="button" data-act="module" data-key="${key}"
                        style="--acc:${mod.accent};--acc-soft:${mod.accent}1f;animation-delay:${i * 30}ms"
                        aria-label="${esc(mod.label)} — open records">
                  <span class="acard__chevron">${icon('chevron-right', 'ico--sm')}</span>
                  <span class="acard__icon">${icon(mod.icon)}</span>
                  <span class="acard__label">${esc(mod.label)}</span>
                  <span class="acard__figures">${figures}</span>
                  <span class="acard__hint">${esc(mod.hint)}</span>
                </button>`;
            }).join('')}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <div>
            <h2 class="section-title">Customer analytics</h2>
            <p class="section-note">Calculated from this contact's invoices — add one and every card updates.</p>
          </div>
          <button class="btn btn--sm btn--ghost" type="button" data-act="new-record" data-key="invoices">${icon('plus', 'ico--xs')} Add invoice</button>
        </div>
        <div class="stats">
          ${statCards.map((s, i) => `
            <article class="stat" style="--grad:${s.grad};--glow:${s.glow};animation-delay:${i * 50}ms">
              <div class="stat__head">
                <p class="stat__label">${esc(s.label)}</p>
                <span class="stat__icon">${icon(s.icon)}</span>
              </div>
              <div>
                <p class="stat__value">${esc(s.value)}</p>
                <div class="stat__foot">
                  <span class="stat__note">${esc(s.note)}</span>
                  <span class="stat__delta">${esc(s.delta)}</span>
                </div>
              </div>
            </article>`).join('')}
        </div>
      </section>

      <section class="section">
        <div class="card panel">
          <div class="tabbar">
            <div class="tabs" role="tablist" aria-label="Contact information tabs">
              ${[['overview', 'Overview'], ['other', 'Other Details'], ['journey', 'Journey Details'], ['more', 'More Information']]
                .map(([id, label]) => `
                  <button class="tab ${state.tab === id ? 'is-active' : ''}" role="tab" type="button"
                          aria-selected="${state.tab === id}" tabindex="${state.tab === id ? 0 : -1}"
                          data-act="tab" data-id="${id}">${label}</button>`).join('')}
            </div>

            <div class="dropdown" data-dropdown>
              <button class="btn btn--accent" type="button" data-dropdown-toggle aria-expanded="false" aria-haspopup="true">
                <span class="btn__label">Actions</span>${icon('chevron', 'ico--xs dropdown__caret')}
              </button>
              <div class="dropdown__menu dropdown__menu--right" role="menu" data-dropdown-menu hidden>
                <button class="dropdown__item" role="menuitem" type="button" data-act="edit-contact" data-id="${esc(c.id)}">${icon('edit')} Edit Contact</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="new-record" data-key="tasks">${icon('task')} Create Task</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="new-record" data-key="notes">${icon('note')} Add Note</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="new-record" data-key="emails">${icon('mail')} Send Email</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="new-record" data-key="meetings">${icon('video')} Create Meeting</button>
                <div class="dropdown__sep" role="separator"></div>
                <button class="dropdown__item dropdown__item--danger" role="menuitem" type="button" data-act="delete-contact" data-id="${esc(c.id)}">${icon('trash')} Delete Contact</button>
              </div>
            </div>
          </div>

          <div class="panel__body">
            <div class="tabpanel" role="tabpanel">${TABS[state.tab] ? TABS[state.tab](c) : TABS.overview(c)}</div>
          </div>
        </div>
      </section>`;
  };

  /* ------------------------- CONTACT TABS ------------------------------ */
  const field = (label, value, opts = {}) => {
    const empty = value === undefined || value === null || String(value).trim() === '';
    return `
      <div class="field ${opts.full ? 'field--full' : ''}">
        <span class="field__label">${esc(label)}</span>
        <span class="field__value ${empty ? 'field__value--empty' : ''}">${empty ? '—' : (opts.raw ? value : esc(value))}</span>
      </div>`;
  };

  const TABS = {
    overview: (c) => `
      <p class="subhead">Contact information</p>
      <div class="fields">
        ${field('First Name', c.firstName)}
        ${field('Last Name', c.lastName)}
        ${field('Office Phone', c.officePhone ? `<a href="${esc(telHref(c.officePhone))}">${esc(c.officePhone)}</a>` : '', { raw: !!c.officePhone })}
        ${field('Mobile', c.mobile ? `<a href="${esc(telHref(c.mobile))}">${esc(c.mobile)}</a>` : '', { raw: !!c.mobile })}
        ${field('Job Title', c.jobTitle)}
        ${field('Department', c.department)}
        ${field('Account Name', c.accountName)}
        ${field('Fax', c.fax)}
        ${field('Email Address', `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a> <small>Primary</small>`, { raw: true, full: true })}
      </div>

      <p class="subhead">Address information</p>
      <div class="fields">
        ${field('Primary Address', contactAddress(c, '<br>'), { raw: !!contactAddress(c) })}
        ${field('Other Address', otherAddress(c, '<br>'), { raw: !!otherAddress(c) })}
        ${field('Description', c.description, { full: true })}
      </div>`,

    other: (c) => `
      <p class="subhead">Ownership &amp; source</p>
      <div class="fields">
        ${field('Contact Owner', c.owner)}
        ${field('Lead Source', c.leadSource)}
        ${field('Reports To', c.reportsTo)}
        ${field('Industry', c.industry)}
        ${field('Employees', c.employees)}
        ${field('Annual Revenue', c.annualRevenue)}
        ${field('Secondary Email', c.secondaryEmail ? `<a href="mailto:${esc(c.secondaryEmail)}">${esc(c.secondaryEmail)}</a>` : '', { raw: !!c.secondaryEmail })}
        ${field('LinkedIn', c.linkedin ? `<a href="https://${esc(c.linkedin)}" target="_blank" rel="noopener noreferrer">${esc(c.linkedin)}</a>` : '', { raw: !!c.linkedin })}
        ${field('Time Zone', c.timezone)}
        ${field('Preferred Language', c.language)}
        ${field('Created On', fmtDate(c.createdAt))}
        ${field('Last Modified', fmtDate(c.updatedAt))}
      </div>

      <p class="subhead">Communication preferences</p>
      <div class="stack">
        <div class="switch-row">
          <div>
            <p class="switch-row__text">Do not call</p>
            <p class="switch-row__note">Suppress this contact from every outbound dialler list.</p>
          </div>
          <button class="switch" type="button" role="switch" aria-checked="${!!c.doNotCall}" aria-label="Do not call"
                  data-act="switch" data-key="doNotCall" data-label="Do not call"></button>
        </div>
        <div class="switch-row">
          <div>
            <p class="switch-row__text">Email opt-out</p>
            <p class="switch-row__note">Exclude this contact from marketing campaigns and newsletters.</p>
          </div>
          <button class="switch" type="button" role="switch" aria-checked="${!!c.emailOptOut}" aria-label="Email opt-out"
                  data-act="switch" data-key="emailOptOut" data-label="Email opt-out"></button>
        </div>
      </div>

      <p class="subhead">Tags</p>
      <div class="profile__tags" style="justify-content:flex-start">
        ${(c.tags || []).map((t) => `<span class="pill pill--info">${esc(t)}</span>`).join('') || '<span class="pill pill--mute">No tags — add them from Edit Contact</span>'}
      </div>`,

    journey: (c) => {
      const a = analyticsFor(c);
      const tl = timelineFor(c, 8);
      const deals = recordsFor('opportunities', c.id);
      const lastTouch = timelineFor(c, 1)[0];

      return `
        <p class="subhead">Journey snapshot</p>
        <div class="kpis">
          ${kpiCard({ label: 'Lifecycle stage', value: c.lifecycle || '—', note: `Owner ${c.owner}`, iconName: 'flag' })}
          ${kpiCard({ label: 'Customer since', value: a.first ? fmtDate(a.first.date) : 'Not yet', note: `${a.invoices.length} purchase${a.invoices.length === 1 ? '' : 's'}`, iconName: 'calendar' })}
          ${kpiCard({ label: 'Last touchpoint', value: lastTouch ? fmtDate(lastTouch.date) : '—', note: lastTouch ? lastTouch.title.slice(0, 42) : 'No activity yet', iconName: 'pulse' })}
          ${kpiCard({ label: 'NPS response', value: `${c.nps} / 10`, note: Number(c.nps) >= 9 ? 'Promoter' : Number(c.nps) >= 7 ? 'Passive' : 'Detractor', iconName: 'target' })}
        </div>

        <p class="subhead">Open deals</p>
        <div class="stack">
          ${deals.length ? deals.map((d) => recordRow('opportunities', d)).join('')
            : `<p class="empty-note">No deals linked to this contact yet.</p>`}
        </div>

        <p class="subhead">Engagement timeline</p>
        ${tl.length ? `<div class="timeline">
          ${tl.map((t) => `
            <article class="tl-item">
              <p class="tl-item__time">${esc(fmtDate(t.date))}</p>
              <p class="tl-item__title">${esc(t.title)}</p>
              <p class="tl-item__text">${esc(t.text)}</p>
            </article>`).join('')}
        </div>` : '<p class="empty-note">Nothing has been logged against this contact yet.</p>'}

        <p class="subhead">Purchase history</p>
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th>Invoice</th><th>Date</th><th>Product</th>
              <th class="num">Units</th><th class="num">Amount</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${a.invoices.length ? a.invoices.map((o) => `
                <tr>
                  <td data-label="Invoice"><strong>${esc(o.number)}</strong></td>
                  <td data-label="Date">${esc(fmtDate(o.date))}</td>
                  <td data-label="Product">${esc(o.product)}</td>
                  <td data-label="Units" class="num">${esc(o.units)}</td>
                  <td data-label="Amount" class="num"><strong>${money(o.amount)}</strong></td>
                  <td data-label="Status"><span class="pill pill--${toneFor(o.status)}">${esc(o.status)}</span></td>
                  <td data-label="Actions"><span class="acts">
                    <button class="icon-btn icon-btn--sm icon-btn--light" type="button" title="Edit"
                            data-act="edit-record" data-key="invoices" data-id="${esc(o.id)}">${icon('edit', 'ico--xs')}</button>
                    <button class="icon-btn icon-btn--sm icon-btn--light is-danger" type="button" title="Delete"
                            data-act="del-record" data-key="invoices" data-id="${esc(o.id)}">${icon('trash', 'ico--xs')}</button>
                  </span></td>
                </tr>`).join('')
                : '<tr><td colspan="7" style="text-align:center;color:var(--text-mute)">No invoices recorded yet.</td></tr>'}
            </tbody>
          </table>
        </div>`;
    },

    more: (c) => {
      const notes = recordsFor('notes', c.id).slice().sort(byDateDesc);
      const docs = recordsFor('documents', c.id).slice().sort(byDateDesc);
      const camps = recordsFor('campaigns', c.id);

      return `
        <p class="subhead">Description</p>
        <div class="rowcard" style="display:block">
          ${c.description ? esc(c.description)
            : '<span style="color:var(--text-mute)">No description yet — add one from <strong>Edit Contact</strong>.</span>'}
        </div>

        <p class="subhead">Notes (${notes.length})
          <button class="btn btn--sm btn--soft" type="button" data-act="new-record" data-key="notes">${icon('plus', 'ico--xs')} Add</button>
        </p>
        <div class="stack">
          ${notes.length ? notes.map((n) => recordRow('notes', n)).join('')
            : '<p class="empty-note">No notes yet — add the first one.</p>'}
        </div>

        <p class="subhead">Documents (${docs.length})
          <button class="btn btn--sm btn--soft" type="button" data-act="new-record" data-key="documents">${icon('upload', 'ico--xs')} Upload</button>
        </p>
        <div class="stack">
          ${docs.length ? docs.map((d) => recordRow('documents', d)).join('')
            : '<p class="empty-note">No documents attached to this contact.</p>'}
        </div>

        <p class="subhead">Campaign membership</p>
        <div class="stack">
          ${camps.length ? camps.map((m) => `
            <article class="rowcard">
              <span class="rowcard__icon" style="color:${MODULES.campaigns.accent}">${icon('megaphone', 'ico--sm')}</span>
              <div class="rowcard__body">
                <p class="rowcard__title">${esc(m.name)}</p>
                <p class="rowcard__meta">${esc(MODULES.campaigns.meta(m))}</p>
              </div>
              <div class="rowcard__side"><span class="pill pill--${toneFor(m.status)}">${esc(m.status)}</span></div>
            </article>`).join('')
            : '<p class="empty-note">This contact is not part of any campaign.</p>'}
        </div>

        <p class="subhead">System information</p>
        <div class="fields">
          ${field('Record ID', c.id.toUpperCase())}
          ${field('Contact Owner', c.owner)}
          ${field('Created On', fmtDate(c.createdAt))}
          ${field('Last Modified', fmtDate(c.updatedAt))}
        </div>`;
    }
  };

  /* ----------------------------- SALES -------------------------------- */
  VIEWS.sales = function () {
    const q = state.filters.sales || '';
    const deals = allRecords('opportunities')
      .filter((d) => matches(q, d.name, d.owner, d.stage, fullName(contactById(d.contactId))));

    const open = deals.filter((d) => !d.stage.startsWith('Closed'));
    const won = deals.filter((d) => d.stage === 'Closed Won');
    const lost = deals.filter((d) => d.stage === 'Closed Lost');
    const winRate = (won.length + lost.length) ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;

    return `
      ${pageHead({
        crumbs: [{ label: 'Home', route: 'home' }, { label: 'Sales' }],
        title: 'Sales pipeline',
        sub: 'Every open opportunity across the workspace, grouped by stage.',
        actions: `<button class="btn btn--primary" type="button" data-act="new-record" data-key="opportunities">${icon('plus')}<span class="btn__label">New deal</span></button>`
      })}

      <div class="kpis">
        ${kpiCard({ label: 'Open pipeline', value: money(sum(open, (d) => d.amount)), note: `${open.length} deal${open.length === 1 ? '' : 's'} in play`, iconName: 'trend' })}
        ${kpiCard({ label: 'Weighted forecast', value: money(Math.round(sum(open, (d) => d.amount * (Number(d.probability) || 0) / 100))), note: 'Probability adjusted', iconName: 'target' })}
        ${kpiCard({ label: 'Closed won', value: money(sum(won, (d) => d.amount)), note: `${won.length} deal${won.length === 1 ? '' : 's'} won`, iconName: 'check' })}
        ${kpiCard({ label: 'Win rate', value: winRate + '%', note: `${won.length} won · ${lost.length} lost`, iconName: 'pulse' })}
      </div>

      <div class="section">
        ${searchToolbar({ key: 'sales', placeholder: 'Search deals by name, stage, owner or contact…', count: deals.length, total: allRecords('opportunities').length })}

        ${deals.length ? `
          <div class="board">
            ${STAGES.map((stage) => {
              const col = deals.filter((d) => d.stage === stage);
              return `
                <section class="board__col" style="--acc:${STAGE_ACCENT[stage]}">
                  <div class="board__head">
                    <p class="board__title"><span class="board__dot"></span>${esc(stage)}</p>
                    <span class="board__sum">${col.length} · ${money(sum(col, (d) => d.amount))}</span>
                  </div>
                  <div class="board__list">
                    ${col.length ? col.map((d) => `
                      <button class="dealcard" type="button" data-act="edit-record" data-key="opportunities" data-id="${esc(d.id)}">
                        <p class="dealcard__name">${esc(d.name)}</p>
                        <p class="dealcard__meta">${esc(fullName(contactById(d.contactId)))} · closes ${esc(fmtDate(d.close))}</p>
                        <div class="meter" style="margin-top:10px"><span class="meter__fill" style="width:${Number(d.probability) || 0}%"></span></div>
                        <div class="dealcard__foot">
                          <span class="dealcard__amount">${money(d.amount)}</span>
                          <span class="pill pill--${toneFor(d.stage)}">${d.probability}%</span>
                        </div>
                      </button>`).join('')
                      : '<p class="empty-note" style="padding:16px">Nothing here yet.</p>'}
                  </div>
                </section>`;
            }).join('')}
          </div>`
        : emptyState({
            iconName: 'trend', title: 'No results found',
            text: q ? `No deals match “${q}”.` : 'The pipeline is empty — create your first deal.',
            cta: `<button class="btn btn--primary" type="button" data-act="new-record" data-key="opportunities">${icon('plus', 'ico--xs')} New deal</button>`
          })}
      </div>`;
  };

  /* --------------------------- MARKETING ------------------------------ */
  VIEWS.marketing = function () {
    const q = state.filters.marketing || '';
    const all = allRecords('campaigns');
    const list = all.filter((c) => matches(q, c.name, c.channel, c.status));

    const sent = sum(all, (c) => c.sent);
    const opened = sum(all, (c) => c.opened);
    const clicked = sum(all, (c) => c.clicked);
    const rate = (n, d) => d ? Math.round((n / d) * 100) + '%' : '0%';

    return `
      ${pageHead({
        crumbs: [{ label: 'Home', route: 'home' }, { label: 'Marketing' }],
        title: 'Campaigns',
        sub: 'Performance for every campaign, and who is enrolled in them.',
        actions: `<button class="btn btn--primary" type="button" data-act="new-record" data-key="campaigns">${icon('plus')}<span class="btn__label">New campaign</span></button>`
      })}

      <div class="kpis">
        ${kpiCard({ label: 'Active campaigns', value: String(all.filter((c) => c.status === 'Active').length), note: `${all.length} total`, iconName: 'megaphone' })}
        ${kpiCard({ label: 'Messages sent', value: sent.toLocaleString('en-US'), note: 'Across all channels', iconName: 'send' })}
        ${kpiCard({ label: 'Open rate', value: rate(opened, sent), note: `${opened.toLocaleString('en-US')} opens`, iconName: 'eye' })}
        ${kpiCard({ label: 'Click rate', value: rate(clicked, sent), note: `${clicked.toLocaleString('en-US')} clicks`, iconName: 'target' })}
        ${kpiCard({ label: 'Budget committed', value: money(sum(all, (c) => c.budget)), note: 'Planned + active', iconName: 'dollar' })}
      </div>

      <div class="section">
        ${searchToolbar({ key: 'marketing', placeholder: 'Search campaigns by name, channel or status…', count: list.length, total: all.length })}

        ${list.length ? `
          <div class="grid-cards">
            ${list.map((c) => {
              const openRate = c.sent ? Math.round((c.opened / c.sent) * 100) : 0;
              return `
                <article class="campcard">
                  <div class="campcard__head">
                    <div>
                      <p class="campcard__name">${esc(c.name)}</p>
                      <p class="campcard__meta">${esc(c.channel)} · started ${esc(fmtDate(c.date))}</p>
                    </div>
                    <span class="pill pill--${toneFor(c.status)}">${esc(c.status)}</span>
                  </div>

                  <div class="campcard__stats">
                    <div class="campcard__stat"><b>${Number(c.sent).toLocaleString('en-US')}</b><span>Sent</span></div>
                    <div class="campcard__stat"><b>${Number(c.opened).toLocaleString('en-US')}</b><span>Opened</span></div>
                    <div class="campcard__stat"><b>${Number(c.clicked).toLocaleString('en-US')}</b><span>Clicked</span></div>
                  </div>

                  <div class="progress-block__head"><span>Open rate</span><strong>${openRate}%</strong></div>
                  <div class="meter"><span class="meter__fill" style="width:${openRate}%"></span></div>

                  <p class="campcard__meta" style="margin-top:12px">
                    Budget ${money(c.budget)} · ${(c.contactIds || []).length} contact${(c.contactIds || []).length === 1 ? '' : 's'} enrolled
                  </p>

                  <div class="campcard__foot">
                    <button class="btn btn--sm btn--soft" type="button" data-act="campaign-advance" data-id="${esc(c.id)}">
                      ${icon('refresh', 'ico--xs')} ${c.status === 'Completed' ? 'Reactivate' : c.status === 'Active' ? 'Mark complete' : 'Launch'}
                    </button>
                    <button class="btn btn--sm btn--ghost" type="button" data-act="edit-record" data-key="campaigns" data-id="${esc(c.id)}">${icon('edit', 'ico--xs')} Edit</button>
                    <button class="icon-btn icon-btn--sm icon-btn--light is-danger" type="button" title="Delete campaign"
                            data-act="del-record" data-key="campaigns" data-id="${esc(c.id)}">${icon('trash', 'ico--xs')}</button>
                  </div>
                </article>`;
            }).join('')}
          </div>`
        : emptyState({
            iconName: 'megaphone', title: 'No results found',
            text: q ? `No campaigns match “${q}”.` : 'No campaigns have been created yet.',
            cta: `<button class="btn btn--primary" type="button" data-act="new-record" data-key="campaigns">${icon('plus', 'ico--xs')} New campaign</button>`
          })}
      </div>`;
  };

  /* ---------------------------- SUPPORT ------------------------------- */
  VIEWS.support = function () {
    const q = state.filters.support || '';
    const status = state.filters.supportStatus || 'all';
    const all = allRecords('cases');
    let list = all.filter((t) => matches(q, t.subject, t.channel, t.priority, fullName(contactById(t.contactId))));
    if (status !== 'all') list = list.filter((t) => t.status === status);
    list = list.slice().sort(byDateDesc);

    return `
      ${pageHead({
        crumbs: [{ label: 'Home', route: 'home' }, { label: 'Support' }],
        title: 'Support tickets',
        sub: 'Cases raised by your contacts — the same records shown on each profile.',
        actions: `<button class="btn btn--primary" type="button" data-act="new-record" data-key="cases">${icon('plus')}<span class="btn__label">New ticket</span></button>`
      })}

      <div class="kpis">
        ${kpiCard({ label: 'Open', value: String(all.filter((t) => t.status === 'Open').length), note: 'Awaiting first action', iconName: 'support' })}
        ${kpiCard({ label: 'In progress', value: String(all.filter((t) => t.status === 'In progress').length), note: 'Being worked on', iconName: 'clock' })}
        ${kpiCard({ label: 'Resolved', value: String(all.filter((t) => t.status === 'Resolved' || t.status === 'Closed').length), note: 'Closed out', iconName: 'check' })}
        ${kpiCard({ label: 'High priority', value: String(all.filter((t) => t.priority === 'High' && t.status !== 'Resolved').length), note: 'Needs attention', iconName: 'alert' })}
      </div>

      <div class="section">
        ${searchToolbar({
          key: 'support', placeholder: 'Search tickets by subject, contact or channel…',
          count: list.length, total: all.length,
          extra: chipRow('supportStatus', [
            { label: 'All', value: 'all' }, { label: 'Open', value: 'Open' },
            { label: 'In progress', value: 'In progress' }, { label: 'Resolved', value: 'Resolved' }
          ], status)
        })}

        ${list.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead><tr>
                <th>Ticket</th><th>Contact</th><th>Priority</th><th>Channel</th><th>Opened</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                ${list.map((t) => `
                  <tr>
                    <td data-label="Ticket"><strong>${esc(t.subject)}</strong></td>
                    <td data-label="Contact">
                      <button class="link-btn" type="button" data-act="open-contact" data-id="${esc(t.contactId)}">${esc(fullName(contactById(t.contactId)))}</button>
                    </td>
                    <td data-label="Priority"><span class="pill pill--${t.priority === 'High' ? 'danger' : t.priority === 'Medium' ? 'warn' : 'mute'}">${esc(t.priority)}</span></td>
                    <td data-label="Channel">${esc(t.channel)}</td>
                    <td data-label="Opened">${esc(fmtDate(t.date))}</td>
                    <td data-label="Status"><span class="pill pill--${toneFor(t.status)}">${esc(t.status)}</span></td>
                    <td data-label="Actions"><span class="acts">
                      <button class="icon-btn icon-btn--sm icon-btn--light" type="button" title="${t.status === 'Resolved' ? 'Reopen' : 'Resolve'}"
                              data-act="toggle-record" data-key="cases" data-id="${esc(t.id)}">${icon('check', 'ico--xs')}</button>
                      <button class="icon-btn icon-btn--sm icon-btn--light" type="button" title="Edit"
                              data-act="edit-record" data-key="cases" data-id="${esc(t.id)}">${icon('edit', 'ico--xs')}</button>
                      <button class="icon-btn icon-btn--sm icon-btn--light is-danger" type="button" title="Delete"
                              data-act="del-record" data-key="cases" data-id="${esc(t.id)}">${icon('trash', 'ico--xs')}</button>
                    </span></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`
        : emptyState({
            iconName: 'support', title: 'No results found',
            text: q || status !== 'all' ? 'No tickets match the current filters.' : 'No support tickets have been raised.',
            cta: `<button class="btn btn--primary" type="button" data-act="new-record" data-key="cases">${icon('plus', 'ico--xs')} New ticket</button>`
          })}
      </div>`;
  };

  /* --------------------------- ACTIVITIES ----------------------------- */
  VIEWS.activities = function () {
    const q = state.filters.activities || '';
    const type = state.filters.activityType || 'all';

    let items = MODULE_ORDER.flatMap((key) =>
      allRecords(key).map((r) => ({ key, r, date: recordDate(key, r) }))
    );
    if (type !== 'all') items = items.filter((i) => i.key === type);
    items = items.filter(({ key, r }) => matches(q, MODULES[key].title(r), MODULES[key].meta(r), fullName(contactById(r.contactId))));
    const total = MODULE_ORDER.reduce((n, k) => n + allRecords(k).length, 0);
    items.sort(byDateDesc);

    const chips = [{ label: 'All activity', value: 'all' }]
      .concat(MODULE_ORDER.map((k) => ({ label: MODULES[k].label, value: k })));

    return `
      ${pageHead({
        crumbs: [{ label: 'Home', route: 'home' }, { label: 'Activities' }],
        title: 'Activity stream',
        sub: 'Every record logged across the workspace, newest first.',
        actions: `<button class="btn btn--primary" type="button" data-act="new-record" data-key="tasks">${icon('plus')}<span class="btn__label">Log activity</span></button>`
      })}

      ${searchToolbar({ key: 'activities', placeholder: 'Search all activity…', count: items.length, total })}
      <div style="margin:-6px 0 18px">${chipRow('activityType', chips, type)}</div>

      ${items.length ? `
        <div class="feed">
          ${items.slice(0, 60).map(({ key, r, date }) => {
            const mod = MODULES[key];
            return `
              <div class="feed__item">
                <span class="feed__icon" style="--acc:${mod.accent};--acc-soft:${mod.accent}1f">${icon(mod.icon, 'ico--sm')}</span>
                <div class="feed__body">
                  <p class="feed__title">${esc(mod.title(r))}</p>
                  <p class="feed__meta">${esc(mod.label)} · ${esc(fmtDate(date))}${r.contactId ? ' · ' + esc(fullName(contactById(r.contactId))) : ''}</p>
                </div>
                <div class="rowcard__side">
                  <span class="pill pill--${toneFor(mod.status(r))}">${esc(mod.status(r))}</span>
                  <div class="rowcard__actions">
                    <button class="icon-btn icon-btn--sm icon-btn--light" type="button" title="Edit"
                            data-act="edit-record" data-key="${key}" data-id="${esc(r.id)}">${icon('edit', 'ico--xs')}</button>
                    <button class="icon-btn icon-btn--sm icon-btn--light is-danger" type="button" title="Delete"
                            data-act="del-record" data-key="${key}" data-id="${esc(r.id)}">${icon('trash', 'ico--xs')}</button>
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
        ${items.length > 60 ? `<p class="section-note" style="margin-top:12px">Showing the 60 most recent of ${items.length} records.</p>` : ''}`
      : emptyState({
          iconName: 'pulse', title: 'No results found',
          text: 'Nothing matches the current filters. Clear the search or pick another type.'
        })}`;
  };

  /* ------------------------- COLLABORATION ---------------------------- */
  VIEWS.collaboration = function () {
    const q = state.filters.collaboration || '';
    const posts = DB.feed.filter((p) => matches(q, p.body, p.author)).slice().sort((a, b) => b.ts - a.ts);

    return `
      ${pageHead({
        crumbs: [{ label: 'Home', route: 'home' }, { label: 'Collaboration' }],
        title: 'Team collaboration',
        sub: 'Share account context with the people working these records.',
      })}

      <div class="layout">
        <div class="card" style="padding:20px">
          <p class="subhead">Team</p>
          <div class="stack">
            ${DB.team.map((m) => `
              <div class="member">
                <span class="avatar avatar--sm ${avatarClass(m.id)}">${esc(initialsOf(...m.name.split(' ')))}</span>
                <div>
                  <p class="member__name">${esc(m.name)}</p>
                  <p class="member__role">${esc(m.role)}</p>
                </div>
                <span class="member__status pill pill--${m.status === 'Online' ? 'ok' : m.status === 'Offline' ? 'mute' : 'warn'}">${esc(m.status)}</span>
              </div>`).join('')}
          </div>

          <p class="subhead">Workspace at a glance</p>
          <div class="stack">
            <div class="switch-row"><div><p class="switch-row__text">Open deals</p><p class="switch-row__note">${money(sum(openDeals(), (d) => d.amount))} in pipeline</p></div><strong>${openDeals().length}</strong></div>
            <div class="switch-row"><div><p class="switch-row__text">Open tickets</p><p class="switch-row__note">Support queue</p></div><strong>${openTickets().length}</strong></div>
            <div class="switch-row"><div><p class="switch-row__text">Tasks outstanding</p><p class="switch-row__note">Across the team</p></div><strong>${openTasks().length}</strong></div>
          </div>
        </div>

        <div class="layout__main">
          <form class="composer" id="composer">
            <div class="composer__row">
              <span style="display:flex;align-items:center;gap:10px">
                <span class="avatar avatar--sm av-${DB.admin.avatar || 1}">${esc(DB.admin.initials)}</span>
                <strong style="font-size:13px">${esc(DB.admin.name)}</strong>
              </span>
              <span class="pill pill--mute">Visible to the team</span>
            </div>
            <textarea class="textarea" name="body" placeholder="Share an update with the team…" style="min-height:88px"></textarea>
            <div class="composer__row">
              <p class="form__hint">Posts are stored with your workspace data.</p>
              <button class="btn btn--primary btn--sm" type="submit">${icon('send', 'ico--xs')} Post update</button>
            </div>
          </form>

          ${searchToolbar({ key: 'collaboration', placeholder: 'Search team updates…', count: posts.length, total: DB.feed.length })}

          ${posts.length ? `<div class="feed">
            ${posts.map((p) => `
              <div class="feed__item">
                <span class="avatar avatar--sm ${avatarClass(p.id)}">${esc(initialsOf(...p.author.split(' ')))}</span>
                <div class="feed__body">
                  <p class="feed__title">${esc(p.author)}</p>
                  <p class="feed__meta">${esc(relTime(p.ts))}</p>
                  <p class="rowcard__text">${esc(p.body)}</p>
                </div>
                <button class="icon-btn icon-btn--sm icon-btn--light is-danger" type="button" title="Delete post"
                        data-act="del-post" data-id="${esc(p.id)}">${icon('trash', 'ico--xs')}</button>
              </div>`).join('')}
          </div>`
          : emptyState({ iconName: 'chat', title: 'No updates found', text: q ? `Nothing matches “${q}”.` : 'Be the first to post an update for the team.' })}
        </div>
      </div>`;
  };

  /* ------------------------------- ALL -------------------------------- */
  VIEWS.all = function () {
    const c = activeContact();
    return `
      ${pageHead({
        crumbs: [{ label: 'Home', route: 'home' }, { label: 'All' }],
        title: 'All modules',
        sub: 'Every record type in the workspace with its current volume.',
      })}

      <div class="section-head"><h2 class="section-title">Workspace modules</h2></div>
      <div class="grid-cards">
        ${[
          { label: 'Contacts', icon: 'users', accent: '#6366f1', count: DB.contacts.length, note: 'People and accounts', route: 'contacts' },
          { label: 'Sales pipeline', icon: 'trend', accent: '#0ea5e9', count: allRecords('opportunities').length, note: 'Deals by stage', route: 'sales' },
          { label: 'Marketing', icon: 'megaphone', accent: '#ec4899', count: allRecords('campaigns').length, note: 'Campaigns and performance', route: 'marketing' },
          { label: 'Support', icon: 'support', accent: '#f43f5e', count: allRecords('cases').length, note: 'Tickets and cases', route: 'support' },
          { label: 'Activities', icon: 'pulse', accent: '#10b981', count: MODULE_ORDER.reduce((n, k) => n + allRecords(k).length, 0), note: 'Everything logged', route: 'activities' },
          { label: 'Collaboration', icon: 'chat', accent: '#8b5cf6', count: DB.feed.length, note: 'Team updates', route: 'collaboration' }
        ].map((m) => `
          <button class="modcard" type="button" data-act="go" data-route="${m.route}" style="--acc:${m.accent};--acc-soft:${m.accent}1f">
            <span class="modcard__icon">${icon(m.icon)}</span>
            <span>
              <span class="modcard__title">${esc(m.label)}</span>
              <span class="modcard__note">${esc(m.note)}</span>
            </span>
            <span class="modcard__count">${m.count}</span>
          </button>`).join('')}
      </div>

      <div class="section-head" style="margin-top:28px">
        <div>
          <h2 class="section-title">Record types</h2>
          <p class="section-note">Counts are for ${esc(fullName(c))} — open one to manage its records.</p>
        </div>
      </div>
      <div class="grid-cards">
        ${MODULE_ORDER.map((key) => {
          const mod = MODULES[key];
          const mine = c ? recordsFor(key, c.id).length : 0;
          return `
            <button class="modcard" type="button" data-act="module" data-key="${key}" style="--acc:${mod.accent};--acc-soft:${mod.accent}1f">
              <span class="modcard__icon">${icon(mod.icon)}</span>
              <span>
                <span class="modcard__title">${esc(mod.label)}</span>
                <span class="modcard__note">${allRecords(key).length} in workspace</span>
              </span>
              <span class="modcard__count">${mine}</span>
            </button>`;
        }).join('')}
      </div>`;
  };

  /* ======================================================================
     12. MODULE MODAL + RECORD CRUD
     ====================================================================== */
  function openModuleModal(key, contactId) {
    const mod = MODULES[key];
    const c = contactById(contactId) || activeContact();
    if (!mod || !c) return;

    const list = recordsFor(key, c.id).slice().sort((a, b) => String(recordDate(key, b)).localeCompare(String(recordDate(key, a))));
    const done = mod.doneWhen ? list.filter(mod.doneWhen).length : null;
    const pct = done === null || !list.length ? null : Math.round((done / list.length) * 100);

    const stats = done === null
      ? `<div class="mstat"><p class="mstat__label">Total ${esc(mod.label)}</p><p class="mstat__value">${list.length}</p></div>
         <div class="mstat"><p class="mstat__label">Linked to</p><p class="mstat__value" style="font-size:15px">${esc(fullName(c))}</p></div>`
      : `<div class="mstat"><p class="mstat__label">Total ${esc(mod.label)}</p><p class="mstat__value">${list.length}</p></div>
         <div class="mstat"><p class="mstat__label">${esc(mod.doneLabel)}</p><p class="mstat__value">${done}</p></div>
         <div class="mstat"><p class="mstat__label">Pending</p><p class="mstat__value">${Math.max(list.length - done, 0)}</p></div>`;

    openModal({
      title: mod.label,
      sub: `${list.length} record${list.length === 1 ? '' : 's'} linked to ${fullName(c)}`,
      icon: mod.icon,
      refresh: () => openModuleModal(key, c.id),
      body: `
        <div class="mstats">${stats}</div>
        ${pct === null ? '' : `
          <div class="progress-block">
            <div class="progress-block__head"><span>${esc(mod.doneLabel)} rate</span><strong>${pct}%</strong></div>
            <div class="meter"><span class="meter__fill" style="width:${pct}%;background:linear-gradient(90deg, ${mod.accent}, ${mod.accent}aa)"></span></div>
          </div>`}
        <p class="subhead">${esc(mod.label)} records</p>
        ${list.length
          ? `<div class="stack">${list.map((r) => recordRow(key, r)).join('')}</div>`
          : emptyState({
              iconName: mod.icon, title: `No ${mod.label.toLowerCase()} yet`,
              text: `Nothing has been logged for ${fullName(c)} in this module.`,
              cta: `<button class="btn btn--primary btn--sm" type="button" data-act="new-record" data-key="${key}">${icon('plus', 'ico--xs')} Add ${esc(mod.singular || mod.label)}</button>`
            })}`,
      footer: `
        <button class="btn btn--quiet" type="button" data-modal-close>Close</button>
        <button class="btn btn--primary" type="button" data-act="new-record" data-key="${key}">
          ${icon('plus', 'ico--sm')} New ${esc(mod.singular || mod.label)}</button>`
    });
  }

  /** Create/edit form for any record type. */
  function openRecordForm(key, id, returnTo) {
    const mod = MODULES[key];
    const c = activeContact();
    const existing = id ? findRecord(key, id) : null;
    const values = existing ? clone(existing) : mod.make();
    const contactForRecord = existing ? (contactById(existing.contactId) || c) : c;

    openModal({
      title: existing ? `Edit ${mod.singular || mod.label}` : `New ${mod.singular || mod.label}`,
      sub: contactForRecord && key !== 'campaigns'
        ? `Linked to ${fullName(contactForRecord)}`
        : 'Workspace record',
      icon: mod.icon,
      body: `<form class="form" id="recordForm" novalidate>
               <div class="form__grid">${buildFields(mod.fields.map((f, i) => i === 0 ? Object.assign({}, f, { autofocus: true }) : f), values)}</div>
             </form>`,
      footer: `
        <button class="btn btn--quiet" type="button" data-modal-dismiss>Cancel</button>
        <button class="btn btn--primary" type="submit" form="recordForm">${icon('check', 'ico--sm')} ${existing ? 'Save changes' : 'Create'}</button>`,
      onMount: (dialog) => {
        bindFileField(dialog);
        $('[data-modal-dismiss]', dialog).addEventListener('click', () => { returnTo ? returnTo() : closeModal(); });

        $('#recordForm', dialog).addEventListener('submit', (e) => {
          e.preventDefault();
          const values2 = readForm(e.currentTarget, mod.fields);
          if (!values2) return;

          if (existing) {
            Object.assign(existing, values2);
            pushNotification({
              title: `${mod.singular || mod.label} updated`, text: mod.title(existing),
              icon: mod.icon, route: 'contact', param: existing.contactId || (c && c.id)
            });
            showToast(`${mod.singular || mod.label} updated`, mod.title(existing), 'success');
          } else {
            const record = Object.assign({ id: uid(key.slice(0, 2)) }, mod.make(), values2);
            if (key === 'campaigns') record.contactIds = c ? [c.id] : [];
            else record.contactId = contactForRecord ? contactForRecord.id : null;
            DB.records[key].unshift(record);
            pushNotification({
              title: `${mod.singular || mod.label} created`, text: mod.title(record),
              icon: mod.icon, route: 'contact', param: record.contactId || (c && c.id)
            });
            showToast(`${mod.singular || mod.label} created`, mod.title(record), 'success');
          }

          touchContact(contactForRecord);
          saveData();
          updateUI();
          if (returnTo) returnTo(); else closeModal();
          bumpCard(key);
        });
      }
    });
  }

  function deleteRecord(key, id, returnTo) {
    const mod = MODULES[key];
    const record = findRecord(key, id);
    if (!record) return;

    confirmModal({
      title: `Delete this ${(mod.singular || mod.label).toLowerCase()}?`,
      sub: mod.title(record).slice(0, 60),
      message: `<strong>${esc(mod.title(record))}</strong> will be removed from the workspace. You can undo this straight after.`,
      confirmLabel: 'Delete',
      iconName: 'trash',
      returnTo,
      onConfirm: () => {
        const list = DB.records[key];
        const index = list.findIndex((r) => r.id === id);
        const [removed] = list.splice(index, 1);
        saveData();
        updateUI();
        showToast(`${mod.singular || mod.label} deleted`, mod.title(removed), 'danger', {
          actionLabel: 'Undo',
          onAction: () => {
            DB.records[key].splice(index, 0, removed);
            saveData();
            updateUI();
            refreshModal();
            showToast('Restored', mod.title(removed), 'success');
          }
        });
      }
    });
  }

  function toggleRecord(key, id) {
    const mod = MODULES[key];
    const record = findRecord(key, id);
    if (!record || !mod.toggle) return;
    mod.toggle(record);
    touchContact(contactById(record.contactId));
    saveData();
    updateUI();
    refreshModal();
    showToast(`${mod.singular || mod.label} updated`, `${mod.title(record)} — ${mod.status(record)}`, 'success');
  }

  /** Stamp "last modified" on a contact whenever its data changes. */
  function touchContact(c) {
    if (c) c.updatedAt = todayISO();
  }

  /** Small attention animation on an activity card after its count changes. */
  function bumpCard(key) {
    requestAnimationFrame(() => {
      const card = $(`.acard[data-key="${key}"]`);
      if (!card) return;
      card.classList.add('is-bumped');
      card.addEventListener('animationend', () => card.classList.remove('is-bumped'), { once: true });
    });
  }

  /* ======================================================================
     13. CONTACT CRUD
     ====================================================================== */
  const CONTACT_FIELDS = [
    { name: 'firstName', label: 'First Name', required: true },
    { name: 'lastName', label: 'Last Name', required: true },
    { name: 'jobTitle', label: 'Job Title' },
    { name: 'department', label: 'Department', placeholder: 'e.g. Product & Growth' },
    { name: 'accountName', label: 'Account Name' },
    { name: 'email', label: 'Email Address', type: 'email', required: true },
    { name: 'mobile', label: 'Mobile', type: 'tel' },
    { name: 'officePhone', label: 'Office Phone', type: 'tel' },
    { name: 'fax', label: 'Fax', type: 'tel' },
    { name: 'street', label: 'Street', full: true },
    { name: 'city', label: 'City' },
    { name: 'state', label: 'State / Region' },
    { name: 'zip', label: 'Postal Code' },
    { name: 'country', label: 'Country' },
    { name: 'tagsText', label: 'Tags (comma separated)', full: true, placeholder: 'VIP, Renewal Q3' },
    { name: 'description', label: 'Description', type: 'textarea', full: true }
  ];

  function openContactForm(id) {
    const existing = id ? contactById(id) : null;
    const values = existing
      ? Object.assign(clone(existing), { tagsText: (existing.tags || []).join(', ') })
      : { firstName: '', lastName: '', email: '', country: '', tagsText: '' };

    openModal({
      title: existing ? 'Edit Contact' : 'New Contact',
      sub: existing ? 'Changes update every screen immediately.' : 'Create a new person in your workspace.',
      icon: existing ? 'edit' : 'user',
      body: `
        <form class="form" id="contactForm" novalidate>
          <div class="fieldset-note">${icon('info', 'ico--sm')}
            <span>Fields marked <strong>*</strong> are required. Email and phone numbers are validated before saving.</span>
          </div>
          <div class="form__grid">${buildFields(CONTACT_FIELDS.map((f, i) => i === 0 ? Object.assign({}, f, { autofocus: true }) : f), values)}</div>
        </form>`,
      footer: `
        <button class="btn btn--quiet" type="button" data-modal-close>Cancel</button>
        <button class="btn btn--primary" type="submit" form="contactForm">${icon('check', 'ico--sm')} ${existing ? 'Save changes' : 'Create contact'}</button>`,
      onMount: (dialog) => {
        $('#contactForm', dialog).addEventListener('submit', (e) => {
          e.preventDefault();
          const values2 = readForm(e.currentTarget, CONTACT_FIELDS);
          if (!values2) return;

          values2.tags = String(values2.tagsText || '').split(',').map((t) => t.trim()).filter(Boolean);
          delete values2.tagsText;

          if (existing) {
            Object.assign(existing, values2, { updatedAt: todayISO() });
            pushNotification({ title: 'Contact updated', text: `${fullName(existing)} was edited.`, icon: 'user', route: 'contact', param: existing.id });
            showToast('Contact updated', `${fullName(existing)} saved successfully.`, 'success');
          } else {
            const contact = Object.assign({
              id: uid('c'), favourite: false, owner: DB.admin.name, reportsTo: '', leadSource: 'Manual entry',
              industry: '', employees: '', annualRevenue: '', timezone: '', language: '', linkedin: '',
              lifecycle: 'Prospect — New', nps: 0, engagement: 10, doNotCall: false, emailOptOut: false,
              secondaryEmail: '', otherStreet: '', otherCity: '', otherState: '', otherZip: '', otherCountry: '',
              createdAt: todayISO(), updatedAt: todayISO(), tags: []
            }, values2);
            DB.contacts.unshift(contact);
            DB.activeContactId = contact.id;
            pushNotification({ title: 'Contact created', text: `${fullName(contact)} was added.`, icon: 'user', route: 'contact', param: contact.id });
            showToast('Contact created', `${fullName(contact)} is now in your workspace.`, 'success');
            saveData();
            closeModal();
            go('contact', contact.id);
            return;
          }

          saveData();
          updateUI();
          closeModal();
        });
      }
    });
  }

  function deleteContact(id) {
    const c = contactById(id);
    if (!c) return;

    confirmModal({
      title: 'Delete contact?',
      sub: fullName(c),
      message: `<strong>${esc(fullName(c))}</strong> and every linked record will be removed from this workspace. You can undo this immediately afterwards.`,
      confirmLabel: 'Delete contact',
      iconName: 'trash',
      onConfirm: () => {
        const index = DB.contacts.findIndex((x) => x.id === id);
        const [removed] = DB.contacts.splice(index, 1);

        // Detach the records so an undo can put everything back.
        const removedRecords = {};
        MODULE_ORDER.forEach((key) => {
          removedRecords[key] = DB.records[key].filter((r) => r.contactId === id);
          DB.records[key] = DB.records[key].filter((r) => r.contactId !== id);
          if (key === 'campaigns') {
            DB.records.campaigns.forEach((cp) => { cp.contactIds = (cp.contactIds || []).filter((x) => x !== id); });
          }
        });

        if (DB.activeContactId === id) DB.activeContactId = DB.contacts[0] ? DB.contacts[0].id : null;
        saveData();
        closeModal();
        go('contacts');

        showToast('Contact deleted', `${fullName(removed)} was removed.`, 'danger', {
          actionLabel: 'Undo',
          onAction: () => {
            DB.contacts.splice(index, 0, removed);
            MODULE_ORDER.forEach((key) => { DB.records[key] = removedRecords[key].concat(DB.records[key]); });
            DB.activeContactId = removed.id;
            saveData();
            go('contact', removed.id);
            showToast('Contact restored', `${fullName(removed)} is back.`, 'success');
          }
        });
      }
    });
  }

  function toggleFavourite(id) {
    const c = contactById(id);
    if (!c) return;
    c.favourite = !c.favourite;
    touchContact(c);
    saveData();
    updateUI();
    const star = $(`.star[data-id="${id}"]`);
    if (star) {
      star.classList.add('is-bouncing');
      star.addEventListener('animationend', () => star.classList.remove('is-bouncing'), { once: true });
    }
    showToast(c.favourite ? 'Added to favourites' : 'Removed from favourites', fullName(c), c.favourite ? 'success' : 'info');
  }

  /* ======================================================================
     14. ADMIN PROFILE & SETTINGS
     ====================================================================== */
  function renderAdmin() {
    const a = DB.admin;
    const av = 'avatar avatar--sm av-' + (a.avatar || 1);
    $('#adminAvatar').className = av;
    $('#adminAvatar').textContent = a.initials;
    $('#adminAvatarMenu').className = av;
    $('#adminAvatarMenu').textContent = a.initials;
    $('#adminName').textContent = a.name;
    $('#adminNameMenu').textContent = a.name;
    $('#adminRole').textContent = a.role;
    $('#adminMailMenu').textContent = a.email;
  }

  function openAdminProfile() {
    const a = DB.admin;
    const myTasks = allRecords('tasks').filter((t) => t.owner === a.name);
    const myDeals = allRecords('opportunities').filter((d) => d.owner === a.name);

    openModal({
      title: a.name, sub: a.role, icon: 'user',
      body: `
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px">
          <span class="avatar avatar--xl av-${a.avatar || 1}" style="width:76px;height:76px;font-size:24px">${esc(a.initials)}</span>
          <div>
            <p style="font-size:17px;font-weight:600">${esc(a.name)}</p>
            <p style="font-size:12.5px;color:var(--text-mute)">${esc(a.email)}</p>
            <span class="pill pill--info" style="margin-top:8px">${esc(a.role)}</span>
          </div>
        </div>
        <div class="mstats">
          <div class="mstat"><p class="mstat__label">Open tasks</p><p class="mstat__value">${myTasks.filter((t) => t.status !== 'Completed').length}</p></div>
          <div class="mstat"><p class="mstat__label">My deals</p><p class="mstat__value">${myDeals.length}</p></div>
          <div class="mstat"><p class="mstat__label">Pipeline</p><p class="mstat__value" style="font-size:17px">${money(sum(myDeals.filter((d) => !d.stage.startsWith('Closed')), (d) => d.amount))}</p></div>
        </div>
        <p class="subhead">Assigned tasks</p>
        <div class="stack">
          ${myTasks.length ? myTasks.slice(0, 5).map((t) => recordRow('tasks', t, { showContact: true })).join('')
            : '<p class="empty-note">Nothing is assigned to you right now.</p>'}
        </div>`,
      footer: `
        <button class="btn btn--quiet" type="button" data-modal-close>Close</button>
        <button class="btn btn--primary" type="button" data-act="admin-edit">${icon('edit', 'ico--sm')} Edit profile</button>`
    });
  }

  function openAdminForm() {
    const a = DB.admin;
    const fields = [
      { name: 'name', label: 'Full name', required: true, full: true },
      { name: 'email', label: 'Email address', type: 'email', required: true, full: true },
      { name: 'role', label: 'Role', type: 'select', options: ['Administrator', 'Sales Manager', 'Account Executive', 'Customer Success', 'Support Lead'] },
      { name: 'initials', label: 'Avatar initials', required: true, max: 3 }
    ];

    openModal({
      title: 'Edit Profile', sub: 'Updates the navbar immediately.', icon: 'edit',
      body: `
        <form class="form" id="adminForm" novalidate>
          <div class="form__grid">${buildFields(fields.map((f, i) => i === 0 ? Object.assign({}, f, { autofocus: true }) : f), a)}</div>
          <div class="form__group">
            <span class="form__label">Avatar colour</span>
            <div class="swatches">
              ${[1, 2, 3, 4, 5, 6].map((n) => `
                <button class="swatch av-${n}" type="button" data-avatar="${n}"
                        aria-pressed="${Number(a.avatar || 1) === n}" aria-label="Avatar colour ${n}"></button>`).join('')}
            </div>
          </div>
        </form>`,
      footer: `
        <button class="btn btn--quiet" type="button" data-modal-close>Cancel</button>
        <button class="btn btn--primary" type="submit" form="adminForm">${icon('check', 'ico--sm')} Save profile</button>`,
      onMount: (dialog) => {
        let avatar = Number(a.avatar || 1);
        $$('[data-avatar]', dialog).forEach((btn) => {
          btn.addEventListener('click', () => {
            avatar = Number(btn.dataset.avatar);
            $$('[data-avatar]', dialog).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.avatar) === avatar)));
          });
        });

        $('#adminForm', dialog).addEventListener('submit', (e) => {
          e.preventDefault();
          const values = readForm(e.currentTarget, fields);
          if (!values) return;
          Object.assign(DB.admin, values, {
            initials: String(values.initials).slice(0, 3).toUpperCase(),
            avatar
          });
          saveData();
          updateUI();
          closeModal();
          showToast('Profile updated', `${DB.admin.name} · ${DB.admin.role}`, 'success');
        });
      }
    });
  }

  function openSettings() {
    const s = DB.settings;
    openModal({
      title: 'Settings', sub: 'Workspace preferences, saved to this device.', icon: 'settings',
      body: `
        <p class="subhead">Display</p>
        <div class="stack">
          <div class="switch-row">
            <div>
              <p class="switch-row__text">Compact density</p>
              <p class="switch-row__note">Tighter spacing — fits more records on screen.</p>
            </div>
            <button class="switch" type="button" role="switch" aria-checked="${s.density === 'compact'}"
                    data-setting="density" aria-label="Compact density"></button>
          </div>
          <div class="switch-row">
            <div>
              <p class="switch-row__text">Interface animations</p>
              <p class="switch-row__note">Transitions, loading shimmer and card motion.</p>
            </div>
            <button class="switch" type="button" role="switch" aria-checked="${s.animations !== false}"
                    data-setting="animations" aria-label="Interface animations"></button>
          </div>
        </div>

        <p class="subhead">Start-up</p>
        <div class="form__group">
          <label class="form__label" for="landingSel">Landing screen</label>
          <select class="select" id="landingSel">
            ${[['contact', 'Contact profile'], ['home', 'Home dashboard'], ['contacts', 'Contacts list'], ['sales', 'Sales pipeline'], ['support', 'Support tickets']]
              .map(([v, l]) => `<option value="${v}" ${s.landing === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <p class="form__hint">Opened when you load the app without a specific link.</p>
        </div>

        <p class="subhead">Data</p>
        <div class="switch-row">
          <div>
            <p class="switch-row__text">Workspace storage</p>
            <p class="switch-row__note">${DB.contacts.length} contacts · ${MODULE_ORDER.reduce((n, k) => n + allRecords(k).length, 0)} records saved locally.</p>
          </div>
          <button class="btn btn--sm btn--ghost" type="button" data-act="reset-data">${icon('refresh', 'ico--xs')} Reset workspace</button>
        </div>`,
      footer: `<button class="btn btn--primary" type="button" data-modal-close data-autofocus>Done</button>`,
      onMount: (dialog) => {
        $$('[data-setting]', dialog).forEach((btn) => {
          btn.addEventListener('click', () => {
            const key = btn.dataset.setting;
            const next = btn.getAttribute('aria-checked') !== 'true';
            btn.setAttribute('aria-checked', String(next));
            DB.settings[key] = key === 'density' ? (next ? 'compact' : 'comfortable') : next;
            applySettings();
            saveData();
            showToast('Setting saved', `${key === 'density' ? 'Density' : 'Animations'} updated.`, 'success');
          });
        });

        $('#landingSel', dialog).addEventListener('change', (e) => {
          DB.settings.landing = e.target.value;
          saveData();
          showToast('Landing screen saved', 'Applied the next time you open the app.', 'success');
        });
      }
    });
  }

  function applySettings() {
    document.body.classList.toggle('is-compact', DB.settings.density === 'compact');
    document.body.classList.toggle('no-anim', DB.settings.animations === false);
  }

  function logout() {
    confirmModal({
      title: 'Sign out?', sub: DB.admin.name,
      message: 'Your workspace data stays saved on this device and will be here when you sign back in.',
      confirmLabel: 'Sign out', iconName: 'logout',
      onConfirm: () => {
        closeModal();
        $('#lockScreen').hidden = false;
        document.body.style.overflow = 'hidden';
      }
    });
  }

  /* ======================================================================
     15. NOTIFICATIONS
     ====================================================================== */
  function pushNotification({ title, text, icon: iconName, route, param, module }) {
    DB.notifications.unshift({
      id: uid('n'), title, text, icon: iconName || 'info', ts: Date.now(),
      unread: true, route: route || null, param: param || null, module: module || null
    });
    DB.notifications = DB.notifications.slice(0, 20);
  }

  function renderNotifications() {
    const list = $('#notifList');
    const items = DB.notifications;

    list.innerHTML = items.length
      ? items.map((n) => `
        <li>
          <button class="notif ${n.unread ? 'is-unread' : ''}" type="button" data-notif="${esc(n.id)}">
            <span class="notif__icon">${icon(n.icon, 'ico--sm')}</span>
            <span style="flex:1;min-width:0">
              <span class="notif__title">${esc(n.title)}</span>
              <span class="notif__text">${esc(n.text)}</span>
              <span class="notif__time">${esc(relTime(n.ts))}</span>
            </span>
          </button>
        </li>`).join('')
      : '<li class="notif-empty">You are all caught up 🎉</li>';

    const unread = items.filter((n) => n.unread).length;
    const badge = $('#notifBadge');
    badge.textContent = String(unread);
    badge.hidden = unread === 0;
  }

  function openNotification(id) {
    const n = DB.notifications.find((x) => x.id === id);
    if (!n) return;
    n.unread = false;
    saveData();
    renderNotifications();
    closeDropdowns();

    if (n.route === 'contact' && n.param && contactById(n.param)) {
      go('contact', n.param);
      if (n.module) setTimeout(() => openModuleModal(n.module, n.param), 320);
    } else if (n.route && VIEWS[n.route]) {
      go(n.route, n.param);
    }
  }

  /* ======================================================================
     16. GLOBAL SEARCH
     ====================================================================== */
  const Search = {
    results: [], activeIndex: -1,

    init() {
      this.panel = $('#searchPanel');
      this.input = $('#searchInput');
      this.list = $('#searchResults');
      this.toggle = $('#searchToggle');

      this.toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.panel.hidden ? this.open() : this.close();
      });
      $('#searchClose').addEventListener('click', () => this.close());
      $('#searchForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const hit = $('.sresult.is-active', this.list) || $('.sresult', this.list);
        if (hit) hit.click();
      });
      this.input.addEventListener('input', () => this.render(this.input.value.trim()));
      this.input.addEventListener('keydown', (e) => this.onKeydown(e));

      this.panel.addEventListener('click', (e) => {
        e.stopPropagation();
        const hit = e.target.closest('.sresult');
        if (!hit) return;
        const entry = this.results[Number(hit.dataset.idx)];
        if (entry) { this.close(); entry.run(); }
      });

      document.addEventListener('click', (e) => {
        if (!this.panel.hidden && !e.target.closest('#search')) this.close();
      });
    },

    open() {
      closeDropdowns();
      this.panel.hidden = false;
      this.toggle.setAttribute('aria-expanded', 'true');
      this.input.setAttribute('aria-expanded', 'true');
      this.render(this.input.value.trim());
      setTimeout(() => this.input.focus(), 30);
    },

    close() {
      this.panel.hidden = true;
      this.toggle.setAttribute('aria-expanded', 'false');
      this.input.setAttribute('aria-expanded', 'false');
      this.list.hidden = true;
      this.activeIndex = -1;
    },

    /** Build the result set for a query across contacts, records and views. */
    collect(q) {
      const out = [];

      DB.contacts.forEach((c) => {
        if (matches(q, fullName(c), c.email, c.accountName, c.jobTitle, c.mobile, (c.tags || []).join(' '))) {
          out.push({
            group: 'Contacts', label: fullName(c), meta: `${c.jobTitle || '—'} · ${c.accountName || '—'}`,
            kind: 'Contact', icon: 'user', run: () => go('contact', c.id)
          });
        }
      });

      MODULE_ORDER.forEach((key) => {
        const mod = MODULES[key];
        allRecords(key).forEach((r) => {
          if (!matches(q, mod.title(r), mod.meta(r))) return;
          out.push({
            group: 'Records', label: String(mod.title(r)).slice(0, 64), meta: `${mod.label} · ${mod.meta(r)}`.slice(0, 80),
            kind: mod.label, icon: mod.icon,
            run: () => {
              if (r.contactId) { go('contact', r.contactId); setTimeout(() => openModuleModal(key, r.contactId), 320); }
              else openRecordForm(key, r.id);
            }
          });
        });
      });

      NAV_ITEMS.forEach((item) => {
        if (matches(q, item.label)) {
          out.push({ group: 'Navigate', label: item.label, meta: 'Workspace view', kind: 'View', icon: item.icon || 'grid', run: () => go(item.id) });
        }
      });

      return out;
    },

    render(q) {
      this.results = this.collect(q).slice(0, 24);
      this.activeIndex = -1;
      this.list.hidden = false;

      if (!this.results.length) {
        this.list.innerHTML = `<li class="search__empty"><div class="empty" style="border:0;background:transparent;padding:24px">
          <span class="empty__icon">${icon('search')}</span>
          <p class="empty__title">No results found</p>
          <p class="empty__text">Nothing matches “${esc(q)}”. Try a name, company, subject or module.</p>
        </div></li>`;
        return;
      }

      let group = '';
      this.list.innerHTML = this.results.map((entry, idx) => {
        const header = entry.group !== group ? `<li class="search__group">${esc(entry.group)}</li>` : '';
        group = entry.group;
        return `${header}
          <li role="option" aria-selected="false">
            <button class="sresult" type="button" data-idx="${idx}">
              <span class="sresult__icon">${icon(entry.icon, 'ico--sm')}</span>
              <span style="flex:1;min-width:0">
                <span class="sresult__label">${mark(entry.label, q)}</span>
                <span class="sresult__meta">${esc(entry.meta)}</span>
              </span>
              <span class="sresult__kind">${esc(entry.kind)}</span>
            </button>
          </li>`;
      }).join('');
    },

    onKeydown(e) {
      const items = $$('.sresult', this.list);
      if (!items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.activeIndex = e.key === 'ArrowDown'
          ? (this.activeIndex + 1) % items.length
          : (this.activeIndex - 1 + items.length) % items.length;
        items.forEach((el, i) => el.classList.toggle('is-active', i === this.activeIndex));
        items[this.activeIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  };

  /* ======================================================================
     17. DROPDOWNS, ACTION ROUTER & EVENT WIRING
     ====================================================================== */
  function closeDropdowns() {
    $$('[data-dropdown-menu]').forEach((menu) => {
      if (menu.hidden) return;
      menu.hidden = true;
      const wrap = menu.closest('[data-dropdown]');
      const toggle = wrap && $('[data-dropdown-toggle]', wrap);
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
  }

  /** Map of every data-act / data-action handler in the application. */
  const ACTIONS = {
    'go': (el) => go(el.dataset.route, el.dataset.param),
    'reload': () => location.reload(),

    'open-contact': (el) => go('contact', el.dataset.id),
    'new-contact': () => openContactForm(null),
    'edit-contact': (el) => openContactForm(el.dataset.id || DB.activeContactId),
    'delete-contact': (el) => deleteContact(el.dataset.id || DB.activeContactId),
    'toggle-fav': (el) => toggleFavourite(el.dataset.id),

    'module': (el) => openModuleModal(el.dataset.key, el.dataset.contact || DB.activeContactId),
    'new-record': (el) => {
      const key = el.dataset.key;
      const inModule = !modalEl().hidden && state.modalRefresh;
      openRecordForm(key, null, inModule ? state.modalRefresh : null);
    },
    'edit-record': (el) => openRecordForm(el.dataset.key, el.dataset.id, state.modalRefresh),
    'del-record': (el) => deleteRecord(el.dataset.key, el.dataset.id, state.modalRefresh),
    'toggle-record': (el) => toggleRecord(el.dataset.key, el.dataset.id),

    'tab': (el) => {
      state.tab = el.dataset.id;
      renderView();
    },
    'chip': (el) => {
      state.filters[el.dataset.key] = el.dataset.value;
      renderView();
    },

    'switch': (el) => {
      const c = activeContact();
      const key = el.dataset.key;
      c[key] = !c[key];
      touchContact(c);
      saveData();
      el.setAttribute('aria-checked', String(c[key]));
      showToast(el.dataset.label, c[key] ? 'Preference enabled.' : 'Preference disabled.', c[key] ? 'warning' : 'info');
    },

    'campaign-advance': (el) => {
      const cp = findRecord('campaigns', el.dataset.id);
      if (!cp) return;
      const next = { Planned: 'Active', Active: 'Completed', Completed: 'Active' };
      cp.status = next[cp.status] || 'Active';
      saveData();
      updateUI();
      showToast('Campaign updated', `${cp.name} is now ${cp.status}.`, 'success');
    },

    'del-post': (el) => {
      const index = DB.feed.findIndex((p) => p.id === el.dataset.id);
      if (index < 0) return;
      const [removed] = DB.feed.splice(index, 1);
      saveData();
      updateUI();
      showToast('Update deleted', '', 'danger', {
        actionLabel: 'Undo',
        onAction: () => { DB.feed.splice(index, 0, removed); saveData(); updateUI(); }
      });
    },

    'admin-view': () => openAdminProfile(),
    'admin-edit': () => openAdminForm(),
    'admin-settings': () => openSettings(),
    'admin-logout': () => logout(),
    'reset-data': () => confirmModal({
      title: 'Reset workspace?', sub: 'This cannot be undone',
      message: 'Every contact, record, note and setting you created will be replaced with the original sample workspace.',
      confirmLabel: 'Reset everything', iconName: 'refresh',
      onConfirm: () => {
        resetData();
        applySettings();
        closeModal();
        go('contact', DB.activeContactId);
        updateUI();
        showToast('Workspace reset', 'The original sample data has been restored.', 'success');
      }
    })
  };

  /** data-action="new:tasks" style shortcuts from the Create menu. */
  function runAction(name, el) {
    if (name.startsWith('new:')) { openRecordForm(name.slice(4), null, null); return; }
    const fn = ACTIONS[name];
    if (fn) fn(el);
  }

  function bindEvents() {
    /* --- clicks: dropdowns, actions, modal close, notifications --- */
    document.addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-dropdown-toggle]');
      if (toggle) {
        e.stopPropagation();
        const menu = $('[data-dropdown-menu]', toggle.closest('[data-dropdown]'));
        const isOpen = !menu.hidden;
        closeDropdowns();
        if (!isOpen) { menu.hidden = false; toggle.setAttribute('aria-expanded', 'true'); }
        return;
      }

      if (e.target.closest('[data-modal-close]')) { closeModal(); return; }

      const notif = e.target.closest('[data-notif]');
      if (notif) { openNotification(notif.dataset.notif); return; }

      const actEl = e.target.closest('[data-act], [data-action]');
      if (actEl) {
        const name = actEl.dataset.act || actEl.dataset.action;
        if (ACTIONS[name] || name.startsWith('new:')) {
          e.preventDefault();
          if (actEl.closest('[data-dropdown-menu]')) closeDropdowns();
          runAction(name, actEl);
          return;
        }
      }

      if (!e.target.closest('[data-dropdown]')) closeDropdowns();
    });

    /* --- filter inputs inside views (search / filter displayed data) --- */
    let filterTimer = null;
    $('#view').addEventListener('input', (e) => {
      const input = e.target.closest('[data-filter]');
      if (!input) return;
      const key = input.dataset.filter;
      state.filters[key] = input.value;
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        renderView();
        const next = $(`[data-filter="${key}"]`);
        if (next) {
          next.focus();
          const v = next.value;
          next.value = '';
          next.value = v;   // keep the caret at the end
        }
      }, 180);
    });

    /* --- collaboration composer --- */
    document.addEventListener('submit', (e) => {
      if (e.target.id !== 'composer') return;
      e.preventDefault();
      const field = e.target.elements.body;
      const body = field.value.trim();
      if (!body) {
        field.classList.add('has-error');
        showToast('Nothing to post', 'Write an update before posting.', 'warning');
        return;
      }
      DB.feed.unshift({ id: uid('f'), author: DB.admin.name, body, ts: Date.now() });
      saveData();
      updateUI();
      showToast('Update posted', 'Your team can see it now.', 'success');
    });

    /* --- keyboard: ESC closes, TAB traps inside modals, "/" focuses search --- */
    document.addEventListener('keydown', (e) => {
      const modalOpen = !modalEl().hidden;

      if (e.key === 'Escape') {
        if (modalOpen) { e.preventDefault(); closeModal(); return; }
        if (!Search.panel.hidden) { Search.close(); return; }
        closeDropdowns();
        return;
      }
      if (e.key === 'Tab' && modalOpen) { trapFocus(e); return; }
      if (e.key === '/' && !modalOpen && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        Search.open();
      }
    });

    /* --- mobile navigation --- */
    const burger = $('#burgerBtn');
    const nav = $('#primaryNav');
    const scrim = $('#navScrim');
    const setNav = (open) => {
      nav.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
      burger.innerHTML = icon(open ? 'close' : 'menu');
      scrim.hidden = !open;
    };
    burger.addEventListener('click', (e) => { e.stopPropagation(); setNav(!nav.classList.contains('is-open')); });
    scrim.addEventListener('click', () => setNav(false));
    nav.addEventListener('click', (e) => { if (e.target.closest('.mainnav__link')) setNav(false); });
    window.addEventListener('resize', () => { if (window.innerWidth > 1040) setNav(false); });

    /* --- notifications header actions --- */
    $('#markAllRead').addEventListener('click', (e) => {
      e.stopPropagation();
      DB.notifications.forEach((n) => { n.unread = false; });
      saveData();
      renderNotifications();
      showToast('Notifications read', 'All notifications marked as read.', 'success');
    });
    $('#clearNotifs').addEventListener('click', (e) => {
      e.stopPropagation();
      DB.notifications = [];
      saveData();
      renderNotifications();
      showToast('Notifications cleared', '', 'info');
    });

    /* --- sign back in --- */
    $('#signBackIn').addEventListener('click', () => {
      $('#lockScreen').hidden = true;
      document.body.style.overflow = '';
      showToast(`Welcome back, ${DB.admin.name.split(' ')[0]}`, 'Your workspace is exactly as you left it.', 'success');
    });

    window.addEventListener('hashchange', handleRoute);
  }

  /* ======================================================================
     18. BOOTSTRAP
     ====================================================================== */
  function init() {
    loadData();
    applySettings();
    renderAdmin();
    renderNotifications();
    Search.init();
    bindEvents();
    handleRoute();
    saveData();

    setTimeout(() => {
      showToast(`Welcome back, ${DB.admin.name.split(' ')[0]}`,
        'Every card, tab and menu here is live — your changes are saved to this device.', 'info', { timeout: 5200 });
    }, 800);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
