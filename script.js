/* ==========================================================================
   MEETING 360 — meeting intelligence workspace (vanilla JavaScript)

   Architecture
   ------------
   DB              single source of truth for every screen (persisted)
   MODULES         registry describing each record type (fields, labels, CRUD)
   VIEWS           pure functions returning the HTML for one route
   Intel           local, rule-based meeting intelligence (summaries, actions,
                   sentiment roll-ups, follow-up suggestions) — no network calls
   Router          hash based, SPA — no page reloads
   updateUI()      re-renders navbar, notifications and the active view
   saveData()/loadData()                  localStorage persistence
   openModal()/closeModal()/showToast()   shared UI services
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     01. UTILITIES
     ====================================================================== */
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const icon = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  /**
   * Product branding — the single source of truth for the wordmark.
   * applyBrand() re-asserts it on every load so a cached copy of an older
   * index.html can never leave stale branding on screen.
   */
  const BRAND = { name: 'Meeting', suffix: '360', full: 'Meeting 360' };

  function applyBrand() {
    const mark = document.querySelector('.brand__text');
    if (mark) mark.innerHTML = `${BRAND.name}<span>${BRAND.suffix}</span>`;
    if (document.title !== BRAND.full) document.title = BRAND.full;
  }

  /** Workspace currency symbol — used by every amount rendered in the UI. */
  const CURRENCY = '₹';
  const money = (n) => CURRENCY + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const num = (n) => Number(n || 0).toLocaleString('en-US');

  /* ---- date helpers ---------------------------------------------------- */
  const iso = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };
  const todayISO = () => iso(new Date());
  const addDays = (isoStr, n) => { const d = new Date(isoStr + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  const daysFromNow = (n) => addDays(todayISO(), n);
  const dayDiff = (a, b) => Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 864e5);

  const fmtDate = (isoStr) => {
    if (!isoStr) return '—';
    const d = new Date(isoStr + 'T00:00:00');
    return isNaN(d) ? String(isoStr) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fmtDay = (isoStr) => {
    const d = new Date(isoStr + 'T00:00:00');
    return isNaN(d) ? String(isoStr) : d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  };
  const fmtShort = (isoStr) => {
    if (!isoStr) return '—';
    const [y, m, d] = String(isoStr).split('-');
    return `${d}-${m}-${String(y).slice(2)}`;
  };
  /** '14:30' -> '2:30 PM' */
  const fmtTime = (t) => {
    if (!t) return '';
    const [h, m] = String(t).split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 === 0 ? 12 : h % 12;
    return `${hr}:${String(m || 0).padStart(2, '0')} ${suffix}`;
  };
  const fmtDuration = (min) => {
    const m = Number(min) || 0;
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h}h ${rest}m` : `${h}h`;
  };
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
    return fmtDate(iso(new Date(Number(ts))));
  };
  /** Monday-based start of the week containing `isoStr`. */
  const weekStart = (isoStr) => {
    const d = new Date(isoStr + 'T00:00:00');
    const shift = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - shift);
    return iso(d);
  };
  const monthKey = (isoStr) => String(isoStr).slice(0, 7);
  const monthLabel = (key) => {
    const d = new Date(key + '-01T00:00:00');
    return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  };

  const initialsOf = (first, last) =>
    ((first || '').trim().charAt(0) + (last || '').trim().charAt(0)).toUpperCase() || '?';
  const initialsName = (name) => initialsOf(...String(name || '').split(' '));

  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const RE_PHONE = /^[+()\d\s.\-]{7,24}$/;
  const isEmail = (v) => RE_EMAIL.test(String(v).trim());
  const isPhone = (v) => RE_PHONE.test(String(v).trim()) && (String(v).match(/\d/g) || []).length >= 7;

  const telHref = (v) => 'tel:' + String(v || '').replace(/[^\d+]/g, '');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const sum = (arr, pick) => arr.reduce((t, x) => t + Number(pick(x) || 0), 0);
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));
  const byDateAsc = (a, b) => String(a.date || '').localeCompare(String(b.date || ''));

  const mark = (text, q) => {
    const safe = esc(text);
    if (!q) return safe;
    const i = safe.toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? safe : safe.slice(0, i) + '<mark>' + safe.slice(i, i + q.length) + '</mark>' + safe.slice(i + q.length);
  };

  const matches = (q, ...vals) => {
    if (!q) return true;
    const needle = String(q).toLowerCase();
    return vals.some((v) => String(v ?? '').toLowerCase().includes(needle));
  };

  const avatarClass = (id) => 'av-' + ((String(id).split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) % 6) + 1);

  /** Deterministic PRNG so the sample workspace is identical on every reset. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

  /* ======================================================================
     02. SEED DATA
     ====================================================================== */
  const MEETING_STATUSES = ['Scheduled', 'Confirmed', 'In Progress', 'Completed', 'Follow-up', 'Cancelled', 'Missed'];
  /** The five stages of the meeting pipeline shown on the dashboard. */
  const PIPELINE = ['Scheduled', 'Confirmed', 'In Progress', 'Completed', 'Follow-up'];
  const PIPELINE_ACCENT = {
    'Scheduled': '#6366f1', 'Confirmed': '#06b6d4', 'In Progress': '#f59e0b',
    'Completed': '#10b981', 'Follow-up': '#8b5cf6'
  };
  const MEETING_TYPES = ['Discovery', 'Product Demo', 'Quarterly Review', 'Support Review', 'Onboarding', 'Internal Sync', 'Follow-up Call'];
  const LOCATIONS = ['Video call', 'On-site', 'Phone'];

  /**
   * CURRENT_USER — the centralised profile for the signed-in administrator.
   * Every device loads this same object, so the navbar, greeting, profile menu,
   * record ownership and organizer roster all start from one definition.
   * (Without a backend this is the shared default; see LEGACY_ADMIN_NAME below
   * for how workspaces saved under the previous default are migrated.)
   */
  const CURRENT_USER = {
    teamId: 'u-1',
    name: 'Tanuj Sharma',
    role: 'Administrator',
    email: 'tanuj.sharma@meeting360.io',
    phone: '(020) 7946-0011',
    department: 'Revenue',
    initials: 'TS',
    avatar: 1
  };
  /** The retired default — saved workspaces still on this name are upgraded. */
  const LEGACY_ADMIN_NAME = 'Adrian Cole';

  /** The organizer roster — the single source of truth for who runs meetings. */
  const TEAM = [
    { id: CURRENT_USER.teamId, name: CURRENT_USER.name, role: CURRENT_USER.role, department: CURRENT_USER.department, email: CURRENT_USER.email, phone: CURRENT_USER.phone, permission: 'Admin', status: 'Online' },
    { id: 'u-2', name: 'Maya Iqbal', role: 'Project Manager', department: 'Customer Success', email: 'maya.iqbal@meeting360.io', phone: '(020) 7946-0022', permission: 'Manager', status: 'Online' },
    { id: 'u-3', name: 'Tomas Vega', role: 'Solutions Engineer', department: 'Solutions', email: 'tomas.vega@meeting360.io', phone: '(020) 7946-0033', permission: 'Member', status: 'In a meeting' },
    { id: 'u-4', name: 'Sara Lindqvist', role: 'Support Lead', department: 'Support', email: 'sara.lindqvist@meeting360.io', phone: '(020) 7946-0044', permission: 'Member', status: 'Away' },
    { id: 'u-5', name: 'Daniel Okafor', role: 'Revenue Operations', department: 'Operations', email: 'daniel.okafor@meeting360.io', phone: '(020) 7946-0055', permission: 'Viewer', status: 'Offline' },
    { id: 'u-6', name: 'Ravi Kumar Kushwaha', role: 'Implementation Consultant', department: 'Solutions', email: 'ravi.kushwaha@meeting360.io', phone: '(020) 7946-0066', permission: 'Member', status: 'Online' }
  ];

  const TITLE_BANK = {
    'Discovery': ['Discovery session', 'Requirements deep-dive', 'Initial needs assessment'],
    'Product Demo': ['Product demo', 'Analytics module walkthrough', 'Platform capability demo'],
    'Quarterly Review': ['Quarterly business review', 'Q3 performance review', 'Account health review'],
    'Support Review': ['Open ticket review', 'Escalation review', 'Service review call'],
    'Onboarding': ['Onboarding kickoff', 'Admin training session', 'Data migration workshop'],
    'Internal Sync': ['Account team sync', 'Deal strategy sync', 'Renewal planning sync'],
    'Follow-up Call': ['Follow-up call', 'Post-demo check-in', 'Proposal follow-up']
  };

  const AGENDA_BANK = [
    { topic: 'Adoption review', objective: 'Confirm active seats and usage trends' },
    { topic: 'Open issues', objective: 'Agree owners and timelines for blockers' },
    { topic: 'Roadmap preview', objective: 'Align on the next two quarters' },
    { topic: 'Commercials', objective: 'Walk through pricing and renewal terms' },
    { topic: 'Success metrics', objective: 'Define what good looks like by Q4' },
    { topic: 'Technical requirements', objective: 'Capture integration and security needs' },
    { topic: 'Next steps', objective: 'Confirm actions, owners and dates' }
  ];

  const SUMMARY_BANK = [
    'The team walked through current adoption and confirmed usage is trending up across all three regions. The customer will share updated seat forecasts, and we agreed to prepare a revised proposal before the end of the month.',
    'We reviewed the open escalations in detail. Engineering will publish a fix timeline, and support will send a written summary after each status change. The customer asked us to schedule a follow-up review next week.',
    'A full walkthrough of the analytics module was delivered. The customer highlighted reporting exports as the deciding factor and will confirm internal budget approval. We need to send the security questionnaire response.',
    'The session focused on onboarding sequencing across sites. We agreed on a phased rollout, and the customer will nominate a project lead. Our team will prepare the migration checklist and share it for review.',
    'Renewal scope was discussed and largely agreed. Procurement needs a formal quote before the cycle closes, and the sponsor asked for a summary of value delivered this year.'
  ];

  const DECISION_BANK = [
    'Proceed with the phased rollout starting with the two largest sites.',
    'Renewal paperwork to be issued before the end of the quarter.',
    'Support escalations move to a weekly written status update.',
    'Add the forecasting add-on to the next proposal for evaluation.',
    'Security review to be completed before contract signature.'
  ];

  const KEYPOINT_BANK = [
    'Budget approval closes at the end of September.',
    'Reporting exports are the primary decision driver.',
    'The customer prefers written summaries after every session.',
    'Two additional stakeholders will join the next review.',
    'Rollout must avoid the December change freeze.'
  ];

  const ACTION_BANK = [
    'Send the revised proposal', 'Share the security questionnaire response', 'Prepare the migration checklist',
    'Book the follow-up review', 'Circulate the meeting summary', 'Confirm procurement contact',
    'Publish the fix timeline', 'Draft the renewal quote'
  ];

  function seedContacts() {
    return [
      {
        id: 'c-5', firstName: 'Pranay', lastName: 'G', jobTitle: 'Director of Platform Engineering',
        department: 'Engineering', accountName: 'Nimbus Health Systems',
        email: 'pranay.g@nimbushealth.example', secondaryEmail: 'p.g@nimbus.example',
        mobile: '+91 90042 17835', officePhone: '+91 40 6688 2100', fax: '',
        street: '11th Floor, Amara Block, HITEC City', city: 'Hyderabad', state: 'TS', zip: '500081', country: 'India',
        otherStreet: 'Unit 6, Sunrise Business Park, Andheri East', otherCity: 'Mumbai',
        otherState: 'MH', otherZip: '400069', otherCountry: 'India',
        description: 'Runs the platform team piloting our API across two hospital networks. Security review is his gate before rollout.',
        favourite: true, owner: 'Tomas Vega', reportsTo: 'Ravi Menon (CTO)',
        leadSource: 'Conference — HealthTech Summit', industry: 'Healthcare Technology',
        employees: '5,200', annualRevenue: '₹1.05B', timezone: '(GMT+05:30) India',
        language: 'English (IN)', linkedin: 'linkedin.com/in/pranay-g',
        lifecycle: 'Prospect — Security review', engagement: 47,
        preferredSlot: 'Mon & Thu, 10:00–13:00 IST', doNotCall: false, emailOptOut: false,
        tags: ['Healthcare', 'Security Review', 'Pilot'],
        createdAt: '2026-08-21', updatedAt: todayISO()
      },
      {
        id: 'c-8', firstName: 'Virat', lastName: 'Kohli', jobTitle: 'Director of Brand Partnerships',
        department: 'Brand & Sponsorships', accountName: 'Southbank Sports Media',
        email: 'virat.kohli@southbanksports.example', secondaryEmail: '',
        mobile: '+91 99001 27418', officePhone: '+91 22 6789 4400', fax: '',
        street: 'Level 9, Trident Business Park, Lower Parel', city: 'Mumbai', state: 'MH', zip: '400013', country: 'India',
        otherStreet: 'Suite 210, Orion Arena, Sector 44', otherCity: 'Gurugram',
        otherState: 'HR', otherZip: '122003', otherCountry: 'India',
        description: 'Reviewing the platform for sponsor reporting across three leagues. Wants a media-rights dashboard in the pilot.',
        favourite: false, owner: 'Daniel Okafor', reportsTo: 'Neel Bhatia (Chief Revenue Officer)',
        leadSource: 'Event — Sponsorship summit', industry: 'Sports & Media',
        employees: '640', annualRevenue: '₹280M', timezone: '(GMT+05:30) India',
        language: 'English (IN)', linkedin: 'linkedin.com/in/vkohli-demo',
        lifecycle: 'Prospect — Discovery', engagement: 44,
        preferredSlot: 'Thu & Fri, 16:00–18:00 IST', doNotCall: false, emailOptOut: false,
        tags: ['Sports & Media', 'Sponsorship', 'Demo'],
        createdAt: '2026-08-21', updatedAt: todayISO()
      },
      {
        id: 'c-9', firstName: 'MS', lastName: 'Dhoni', jobTitle: 'Head of Regional Operations',
        department: 'Operations', accountName: 'Eastgate Cold Chain',
        email: 'ms.dhoni@eastgatecold.example', secondaryEmail: '',
        mobile: '+91 94318 60572', officePhone: '+91 651 224 7180', fax: '',
        street: 'Warehouse 3, Namkum Industrial Estate', city: 'Ranchi', state: 'JH', zip: '834010', country: 'India',
        otherStreet: 'Block C, Salt Lake Sector V', otherCity: 'Kolkata',
        otherState: 'WB', otherZip: '700091', otherCountry: 'India',
        description: 'Coordinates cold-chain logistics across the eastern depots. Wants offline-capable check-ins for field teams.',
        favourite: false, owner: CURRENT_USER.name, reportsTo: 'Ipsita Nandy (COO)',
        leadSource: 'Inbound — Logistics webinar', industry: 'Cold Chain & Logistics',
        employees: '1,250', annualRevenue: '₹365M', timezone: '(GMT+05:30) India',
        language: 'English (IN)', linkedin: 'linkedin.com/in/msdhoni-demo',
        lifecycle: 'Prospect — Evaluation', engagement: 52,
        preferredSlot: 'Tue–Thu, 09:30–12:00 IST', doNotCall: false, emailOptOut: false,
        tags: ['Logistics', 'Cold Chain', 'Demo'],
        createdAt: '2026-08-21', updatedAt: todayISO()
      },
      {
        id: 'c-10', firstName: 'Rohit', lastName: 'Sharma', jobTitle: 'General Manager — Retail Banking',
        department: 'Retail Banking', accountName: 'Westline Cooperative Bank',
        email: 'rohit.sharma@westlinebank.example', secondaryEmail: '',
        mobile: '+91 98204 51163', officePhone: '+91 22 3399 7040', fax: '',
        street: '12th Floor, Express Towers, Nariman Point', city: 'Mumbai', state: 'MH', zip: '400021', country: 'India',
        otherStreet: 'Plot 8, Sector 30A, Vashi', otherCity: 'Navi Mumbai',
        otherState: 'MH', otherZip: '400703', otherCountry: 'India',
        description: 'Piloting the platform for branch relationship managers. Needs an audit trail on every customer interaction.',
        favourite: true, owner: 'Maya Iqbal', reportsTo: 'Farida Contractor (Executive Director)',
        leadSource: 'Partner referral', industry: 'Banking & Financial Services',
        employees: '4,400', annualRevenue: '₹880M', timezone: '(GMT+05:30) India',
        language: 'English (IN)', linkedin: 'linkedin.com/in/rohitsharma-demo',
        lifecycle: 'Customer — Onboarding', engagement: 58,
        preferredSlot: 'Mon & Wed, 11:00–13:00 IST', doNotCall: false, emailOptOut: false,
        tags: ['Banking', 'Compliance', 'Demo'],
        createdAt: '2026-08-21', updatedAt: todayISO()
      },
      {
        id: 'c-11', firstName: 'Rahul', lastName: 'Parmar', jobTitle: 'Head of Quality Assurance',
        department: 'Quality Assurance', accountName: 'Aster Pharma Labs',
        email: 'rahul.parmar@asterpharma.example', secondaryEmail: '',
        mobile: '+91 99786 30244', officePhone: '+91 79 4890 5500', fax: '',
        street: 'Unit 12, Sanand GIDC Estate', city: 'Ahmedabad', state: 'GJ', zip: '382110', country: 'India',
        otherStreet: 'Block 4, Alembic Business Park, Gorwa', otherCity: 'Vadodara',
        otherState: 'GJ', otherZip: '390003', otherCountry: 'India',
        description: 'Needs validated audit records before the platform can touch batch documentation. Compliance sign-off gates the rollout.',
        favourite: false, owner: 'Sara Lindqvist', reportsTo: 'Dr. Meera Joshi (VP Quality)',
        leadSource: 'Trade show — PharmaTech India', industry: 'Pharmaceuticals',
        employees: '2,700', annualRevenue: '₹520M', timezone: '(GMT+05:30) India',
        language: 'English (IN)', linkedin: 'linkedin.com/in/rahul-parmar',
        lifecycle: 'Prospect — Validation review', engagement: 41,
        preferredSlot: 'Tue & Thu, 10:00–12:00 IST', doNotCall: false, emailOptOut: false,
        tags: ['Pharma', 'Compliance', 'Validation'],
        createdAt: '2026-08-21', updatedAt: todayISO()
      },
      {
        id: 'c-12', firstName: 'Narendra', lastName: 'Modi', jobTitle: 'Director of Public Sector Partnerships',
        department: 'Public Sector', accountName: 'Bharat Civic Infrastructure',
        email: 'narendra.modi@bharatcivic.example', secondaryEmail: '',
        mobile: '+91 98110 24680', officePhone: '+91 11 2301 4400', fax: '',
        street: '14 Rajpath Marg', city: 'New Delhi', state: 'DL', zip: '110001', country: 'India',
        otherStreet: '', otherCity: '', otherState: '', otherZip: '', otherCountry: '',
        description: 'Coordinates multi-state rollouts. Wants a single reporting view across regional programmes before committing.',
        favourite: false, owner: 'Maya Iqbal', reportsTo: 'Board of Directors',
        leadSource: 'Government tender portal', industry: 'Public Sector & Infrastructure',
        employees: '4,300', annualRevenue: '₹780M', timezone: '(GMT+05:30) India',
        language: 'English (IN)', linkedin: 'linkedin.com/in/narendra-modi',
        lifecycle: 'Prospect — Requirements gathering', engagement: 38,
        preferredSlot: 'Weekday afternoons IST', doNotCall: false, emailOptOut: false,
        tags: ['Public Sector', 'Multi-region'],
        createdAt: '2026-08-22', updatedAt: todayISO()
      }
    ];
  }

  /**
   * Builds a realistic meeting history (and the records that hang off it)
   * spanning the last 120 days and the next 30, seeded so it never changes.
   */
  function seedWorkspace() {
    const rnd = mulberry32(360360);
    const contacts = seedContacts();
    const records = {
      meetings: [], tasks: [], followups: [], notes: [],
      recordings: [], documents: [], calls: [], emails: []
    };

    const today = todayISO();
    let n = 0;

    for (let i = 0; i < 64; i++) {
      const offset = Math.floor(rnd() * 150) - 120;          // −120 … +29 days
      const date = addDays(today, offset);
      const contact = contacts[Math.floor(rnd() * contacts.length)];
      const type = pick(rnd, MEETING_TYPES);
      const title = pick(rnd, TITLE_BANK[type]);
      const duration = pick(rnd, [15, 30, 30, 45, 45, 60, 60, 90]);
      const hour = 9 + Math.floor(rnd() * 9);
      const time = `${String(hour).padStart(2, '0')}:${pick(rnd, ['00', '15', '30', '45'])}`;
      const organizer = pick(rnd, TEAM).name;

      let status;
      if (offset > 0) status = rnd() > 0.45 ? 'Confirmed' : 'Scheduled';
      else if (offset === 0) status = rnd() > 0.5 ? 'In Progress' : 'Confirmed';
      else {
        const r = rnd();
        status = r > 0.28 ? 'Completed' : r > 0.18 ? 'Follow-up' : r > 0.09 ? 'Cancelled' : 'Missed';
      }

      const done = status === 'Completed' || status === 'Follow-up';
      const sentiment = done ? (rnd() > 0.72 ? 'Neutral' : rnd() > 0.12 ? 'Positive' : 'Negative') : null;
      const satisfaction = done ? (sentiment === 'Positive' ? 88 + Math.floor(rnd() * 12)
        : sentiment === 'Neutral' ? 68 + Math.floor(rnd() * 15) : 40 + Math.floor(rnd() * 20)) : null;

      const internals = [pick(rnd, TEAM), pick(rnd, TEAM)]
        .filter((v, idx, arr) => arr.findIndex((x) => x.id === v.id) === idx)
        .map((u) => ({ name: u.name, role: 'Internal', email: u.name.toLowerCase().replace(/\s+/g, '.') + '@meeting360.io', attended: done ? rnd() > 0.12 : null }));

      const participants = internals.concat([{
        name: `${contact.firstName} ${contact.lastName}`, role: 'Customer',
        email: contact.email, attended: done ? rnd() > 0.14 : null
      }]);
      if (rnd() > 0.75) {
        participants.push({ name: pick(rnd, ['Denise Whitaker', 'Arjun Mehta', 'Clara Boone', 'Felix Ward']), role: 'External', email: 'guest@example.com', attended: done ? rnd() > 0.3 : null });
      }

      const agenda = [];
      const agendaCount = 2 + Math.floor(rnd() * 2);
      const pool = AGENDA_BANK.slice();
      for (let a = 0; a < agendaCount; a++) agenda.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);

      const meeting = {
        id: `mt-${String(++n).padStart(3, '0')}`,
        title, type, date, time, duration, status, organizer,
        organizerId: (TEAM.find((u) => u.name === organizer) || TEAM[0]).id,
        location: pick(rnd, LOCATIONS), contactId: contact.id,
        participants, agenda,
        summary: done ? pick(rnd, SUMMARY_BANK) : '',
        decisions: done && rnd() > 0.35 ? [pick(rnd, DECISION_BANK)] : [],
        keyPoints: done && rnd() > 0.4 ? [pick(rnd, KEYPOINT_BANK)] : [],
        sentiment, satisfaction,
        reminder: offset >= 0 ? 15 : null,
        createdTs: Date.now() - Math.max(1, (120 + offset)) * 864e5,
        timeline: [{ ts: Date.now() - Math.max(1, (125 + offset)) * 864e5, label: 'Meeting created' }]
      };
      if (offset >= 0) meeting.timeline.push({ ts: Date.now() - 2 * 864e5, label: 'Reminder scheduled' });
      if (done) meeting.timeline.push({ ts: new Date(date + 'T12:00:00').getTime(), label: 'Meeting completed' });
      records.meetings.push(meeting);

      /* --- records that hang off the meeting --- */
      if (done && rnd() > 0.42) {
        records.notes.push({
          id: uid('nt'), contactId: contact.id, meetingId: meeting.id,
          body: pick(rnd, KEYPOINT_BANK), author: organizer, date
        });
      }
      if (done && rnd() > 0.55) {
        records.recordings.push({
          id: uid('rc'), contactId: contact.id, meetingId: meeting.id,
          name: `${title.replace(/\s+/g, '_')}_${date}.mp4`,
          size: (30 + Math.floor(rnd() * 320)) + ' MB',
          length: duration, transcript: rnd() > 0.5 ? 'Available' : 'Processing', date
        });
      }
      if (done && rnd() > 0.5) {
        const count = 1 + Math.floor(rnd() * 2);
        for (let t = 0; t < count; t++) {
          records.tasks.push({
            id: uid('tk'), contactId: contact.id, meetingId: meeting.id,
            title: pick(rnd, ACTION_BANK), due: addDays(date, 3 + Math.floor(rnd() * 10)),
            priority: pick(rnd, ['Low', 'Medium', 'High']), owner: organizer,
            status: rnd() > 0.45 ? 'Completed' : rnd() > 0.5 ? 'In progress' : 'Open'
          });
        }
      }
      if (status === 'Follow-up' || (done && rnd() > 0.78)) {
        records.followups.push({
          id: uid('fu'), contactId: contact.id, meetingId: meeting.id,
          title: `Follow up on ${title.toLowerCase()}`,
          due: addDays(date, 5), owner: organizer, channel: pick(rnd, ['Email', 'Call', 'Meeting']),
          status: rnd() > 0.55 ? 'Pending' : 'Completed', date
        });
      }
      if (done && rnd() > 0.8) {
        records.documents.push({
          id: uid('dc'), contactId: contact.id, meetingId: meeting.id,
          name: pick(rnd, ['Proposal_v2.pdf', 'Security_Review.xlsx', 'Rollout_Plan.pptx', 'Meeting_Summary.pdf']),
          size: (200 + Math.floor(rnd() * 5000)) + ' KB',
          type: pick(rnd, ['Contract', 'Report', 'Presentation', 'Spreadsheet']), date
        });
      }
      if (done && rnd() > 0.82) {
        records.calls.push({
          id: uid('cl'), contactId: contact.id, meetingId: meeting.id,
          subject: `Pre-call for ${title.toLowerCase()}`, date: addDays(date, -1),
          duration: 10 + Math.floor(rnd() * 20), owner: organizer,
          status: pick(rnd, ['Completed', 'Voicemail']), notes: ''
        });
      }
      if (done && rnd() > 0.62) {
        records.emails.push({
          id: uid('em'), contactId: contact.id, meetingId: meeting.id,
          subject: `Summary — ${title}`, to: contact.email, status: 'Sent',
          date: addDays(date, 1), body: 'Thanks for your time — the summary and next steps are below.'
        });
      }
    }

    records.meetings.sort(byDateAsc);
    /* A fixed booking, kept out of the random history so it is always present:
       tomorrow 09:00-10:00, Tanuj Sharma with Pranay G. Ids prefixed fx-
       are merged into already-saved workspaces by migrateSeedData(). */
    const host = contacts.find((c) => c.id === 'c-5') || contacts[0];
    records.meetings.push({
      id: 'fx-learning-session',
      title: 'Learning session', type: 'Onboarding',
      date: daysFromNow(1), time: '09:00', duration: 60,
      status: 'Confirmed', organizer: CURRENT_USER.name, organizerId: CURRENT_USER.teamId,
      location: 'Video call', contactId: host.id,
      participants: [
        { name: CURRENT_USER.name, role: 'Internal', email: CURRENT_USER.email, attended: null },
        { name: `${host.firstName} ${host.lastName}`, role: 'Customer', email: host.email, attended: null }
      ],
      agenda: ['Learning session'],
      summary: '', decisions: [], keyPoints: [],
      sentiment: null, satisfaction: null, reminder: 15,
      createdTs: Date.now(),
      timeline: [{ ts: Date.now(), label: 'Meeting created' }]
    });

    /* re-sort: the fixture is appended after the generated history was ordered */
    records.meetings.sort(byDateAsc);

    return { contacts, records };
  }

  /** Bumped whenever seedContacts()/seedWorkspace() gain sample data a saved workspace should pick up. */
  const SEED_VERSION = 19;

  function seedData() {
    const ws = seedWorkspace();
    return {
      version: SEED_VERSION,
      admin: {
        teamId: CURRENT_USER.teamId, name: CURRENT_USER.name, email: CURRENT_USER.email,
        role: CURRENT_USER.role, initials: CURRENT_USER.initials, avatar: CURRENT_USER.avatar
      },
      settings: {
        density: 'comfortable', animations: true, landing: 'dashboard',
        defaultDuration: 30, defaultType: 'Discovery', defaultLocation: 'Video call',
        workStart: '09:00', workEnd: '18:00', reminderLead: 15, autoSummary: true,
        notify: { reminders: true, reschedules: true, actionItems: true, followUps: true, digest: false },
        integrations: { google: true, outlook: false, zoom: true, teams: false }
      },
      activeContactId: 'c-5',
      contacts: ws.contacts,
      records: ws.records,
      team: clone(TEAM),
      feed: [
        { id: 'f-1', author: 'Maya Iqbal', body: 'Renewal scope confirmed in the QBR — summary is attached to the meeting record.', ts: Date.now() - 36e5 * 3 },
        { id: 'f-2', author: 'Tomas Vega', body: 'Escalation review moved to weekly. I have added the action items to the meeting.', ts: Date.now() - 36e5 * 9 }
      ],
      notifications: []
    };
  }

  /* ======================================================================
     03. STORE — loadData() / saveData() / resetData()
     ====================================================================== */
  const STORAGE_KEY = 'meeting360Data';
  const CONTACT_KEY = 'contactData';   // convenience mirror of the active contact

  let DB = seedData();

  const state = {
    route: 'dashboard', param: null, tab: 'overview', mtab: 'overview',
    filters: {}, loadTimer: null, modalRefresh: null,
    calView: 'month', calCursor: todayISO()
  };

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.contacts) || !saved.contacts.length) return false;

      const base = seedData();
      const seedContactList = base.contacts;
      const seedRecords = Object.assign({}, base.records);
      DB = Object.assign(base, saved);
      DB.admin = Object.assign(base.admin, saved.admin || {});
      DB.settings = Object.assign(base.settings, saved.settings || {});
      DB.settings.notify = Object.assign(base.settings.notify, (saved.settings || {}).notify || {});
      DB.settings.integrations = Object.assign(base.settings.integrations, (saved.settings || {}).integrations || {});
      DB.records = Object.assign(base.records, saved.records || {});
      migrateSeedData(saved, seedContactList, seedRecords);
      /* prune first: a fixture still pointing at a retired contact is dropped
         here and re-added from the fresh seed in the same load. */
      const reconciled = pruneRetiredContacts() + pruneRetiredFixtures() + mergeFixtures(seedRecords);
      if (reconciled) saveData();
      return true;
    } catch (err) {
      console.error('[Meeting 360] Failed to read saved data, falling back to the sample workspace.', err);
      return false;
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
      localStorage.setItem(CONTACT_KEY, JSON.stringify(activeContact() || {}));
      return true;
    } catch (err) {
      console.warn('[Meeting 360] Storage unavailable — changes stay in memory for this session.', err);
      return false;
    }
  }

  function resetData() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CONTACT_KEY);
    } catch (err) { /* storage may be blocked; resetting memory is enough */ }
    DB = seedData();
    seedNotifications();
    saveData();
  }

  /**
   * Sample contacts dropped from seedContacts() after workspaces were already
   * saved. Listed explicitly so a contact the user created is never mistaken for
   * a retired one — those carry generated uid('c') ids and cannot collide.
   */
  const RETIRED_CONTACT_IDS = ['c-1', 'c-2', 'c-3', 'c-4', 'c-6', 'c-7'];

  /**
   * Removes retired sample contacts and every record hanging off them. Runs on
   * every load rather than behind SEED_VERSION, so a workspace already stamped
   * at the current version is still cleaned. Idempotent: removing what has
   * already gone is a no-op.
   */
  function pruneRetiredContacts() {
    const retired = new Set(RETIRED_CONTACT_IDS);
    let removed = 0;

    const kept = DB.contacts.filter((c) => !retired.has(c.id));
    removed += DB.contacts.length - kept.length;
    DB.contacts = kept;

    Object.keys(DB.records).forEach((key) => {
      const list = DB.records[key] || [];
      const keptRecords = list.filter((r) => !retired.has(r.contactId));
      removed += list.length - keptRecords.length;
      DB.records[key] = keptRecords;
    });

    if (retired.has(DB.activeContactId)) DB.activeContactId = (DB.contacts[0] || {}).id || null;
    return removed;
  }
  /**
   * Sample records dropped from seedWorkspace() after workspaces were already
   * saved. mergeFixtures() re-adds any fx- record it finds in the seed, so an
   * fx- fixture cannot be retired by deleting it from the seed alone: a
   * workspace that already merged it would keep it forever. Listing the id here
   * removes it instead, the fixture-level mirror of RETIRED_CONTACT_IDS.
   */
  const RETIRED_FIXTURE_IDS = ['fx-virat-kohli-discovery'];

  /**
   * Drops retired fx- fixtures from a saved workspace. Runs on every load rather
   * than behind SEED_VERSION, so a workspace already stamped at the current
   * version is still cleaned. Child records keyed by meetingId are left alone —
   * the same choice deleteRecord() makes for a meeting deleted in the UI.
   * Idempotent: removing what has already gone is a no-op.
   */
  function pruneRetiredFixtures() {
    const retired = new Set(RETIRED_FIXTURE_IDS);
    if (!retired.size) return 0;
    let removed = 0;

    Object.keys(DB.records).forEach((key) => {
      const list = DB.records[key] || [];
      const kept = list.filter((r) => !retired.has(r.id));
      removed += list.length - kept.length;
      DB.records[key] = kept;
    });
    return removed;
  }

  /**
   * Fixed sample records carry stable fx- ids, so they can be reconciled by id
   * on every load: missing ones are added, present ones left alone. Deliberately
   * not tied to SEED_VERSION — a workspace already stamped with the current
   * version would otherwise never receive them. Generated records keep their
   * regenerated ids and are never touched here.
   */
  function mergeFixtures(seedRecords) {
    let added = 0;
    Object.keys(seedRecords).forEach((key) => {
      const have = new Set((DB.records[key] || []).map((r) => r.id));
      const extra = (seedRecords[key] || [])
        .filter((r) => String(r.id).indexOf('fx-') === 0 && !have.has(r.id));
      if (extra.length) {
        DB.records[key] = (DB.records[key] || []).concat(extra.map(clone));
        added += extra.length;
      }
    });
    return added;
  }

  /**
   * Brings an older saved workspace up to SEED_VERSION. Any sample contact added
   * to seedContacts() since the save is merged in together with the sample records
   * that belong to it, so the new profile is populated instead of empty. Anything
   * the user created is left exactly as it was.
   */
  function migrateSeedData(saved, seedContactList, seedRecords) {
    if ((saved.version || 0) >= SEED_VERSION) return;

    const known = new Set(DB.contacts.map((c) => c.id));
    const added = seedContactList.filter((c) => !known.has(c.id));

    if (added.length) {
      DB.contacts = DB.contacts.concat(added.map(clone));
      const addedIds = new Set(added.map((c) => c.id));
      Object.keys(seedRecords).forEach((key) => {
        const extra = (seedRecords[key] || []).filter((r) => addedIds.has(r.contactId));
        if (extra.length) DB.records[key] = (DB.records[key] || []).concat(extra.map(clone));
      });
    }

    /* loadData() does `Object.assign(base, saved)`, so a saved team array
       replaces the seeded one wholesale — a member added to TEAM would never
       reach an existing workspace. Merge unseen ones by id, same as contacts. */
    const knownTeam = new Set((DB.team || []).map((u) => u.id));
    const newTeam = TEAM.filter((u) => !knownTeam.has(u.id));
    if (newTeam.length) DB.team = (DB.team || []).concat(newTeam.map(clone));

    DB.version = SEED_VERSION;
    saveData();
  }

  /* ---- accessors ---- */
  const contactById = (id) => DB.contacts.find((c) => c.id === id) || null;
  const activeContact = () => contactById(DB.activeContactId) || DB.contacts[0] || null;
  const fullName = (c) => c ? `${c.firstName} ${c.lastName}`.trim() : 'Unassigned';
  const contactAddress = (c, joiner = ', ') =>
    [c.street, [c.city, c.state, c.zip].filter(Boolean).join(' '), c.country].filter(Boolean).join(joiner);
  const otherAddress = (c, joiner = ', ') =>
    [c.otherStreet, [c.otherCity, c.otherState, c.otherZip].filter(Boolean).join(' '), c.otherCountry].filter(Boolean).join(joiner);

  /**
   * One-line identity of the running build: which seed version it carries, how
   * many sample contacts the code itself defines, and the host it was served
   * from. Makes a stale cache or the wrong hosting obvious at a glance.
   */
  const buildStamp = () => {
    const tag = document.querySelector('script[src*="script"]');
    const asset = tag ? tag.getAttribute('src') : 'script.js';
    return `Seed v${SEED_VERSION} · ${seedContacts().length} sample contacts in this build · ${asset} · served from ${location.host || 'file://'}`;
  };

  const allRecords = (key) => DB.records[key] || [];
  const recordsFor = (key, contactId) => allRecords(key).filter((r) => r.contactId === contactId);
  const findRecord = (key, id) => allRecords(key).find((r) => r.id === id) || null;
  const meetingById = (id) => findRecord('meetings', id);
  const recordsForMeeting = (key, meetingId) => allRecords(key).filter((r) => r.meetingId === meetingId);

  /* ---- Organizer roster (single source of truth, shared with the admin) ---- */
  const teamById = (id) => DB.team.find((u) => u.id === id) || null;
  const teamByName = (name) => DB.team.find((u) => u.name === name) || null;
  const organizerOf = (m) => teamById(m.organizerId) || teamByName(m.organizer) || null;
  const teamSelectOptions = () => DB.team.map((u) => ({ value: u.id, label: `${u.name} — ${u.role}` }));

  function organizerStats(id) {
    const mine = meetings().filter((m) => m.organizerId === id);
    const done = mine.filter(isDone);
    return {
      organised: mine.length,
      completed: done.length,
      upcoming: mine.filter((m) => isFuture(m) && m.status !== 'Cancelled').length,
      hours: Math.round(sum(done, (m) => m.duration) / 60),
      actionItems: allRecords('tasks').filter((t) => t.owner === (teamById(id) || {}).name && t.status !== 'Completed').length
    };
  }

  /** Keep the signed-in admin and their roster entry as one identity. */
  function syncAdminToTeam() {
    const u = teamById(DB.admin.teamId);
    if (!u) return;
    const oldName = u.name;
    u.name = DB.admin.name;
    u.role = DB.admin.role;
    u.email = DB.admin.email;
    if (oldName !== u.name) {
      // Re-point every denormalised name so nothing keeps the stale one.
      meetings().forEach((m) => { if (m.organizerId === u.id) m.organizer = u.name; });
      ['tasks', 'followups', 'calls'].forEach((key) => {
        allRecords(key).forEach((r) => { if (r.owner === oldName) r.owner = u.name; });
      });
      allRecords('notes').forEach((r) => { if (r.author === oldName) r.author = u.name; });
      DB.feed.forEach((p) => { if (p.author === oldName) p.author = u.name; });
    }
  }

  /**
   * Backfills the meeting → organizer relation for workspaces saved before
   * organizers became real records. Idempotent, so it can run on every load.
   */
  function migrateRelations() {
    const fallback = ['Revenue', 'Customer Success', 'Solutions', 'Support', 'Operations'];

    /* Workspaces saved under the retired default adopt the central profile.
       A profile the user renamed themselves is left untouched. */
    if (DB.admin.name === LEGACY_ADMIN_NAME) {
      Object.assign(DB.admin, {
        teamId: CURRENT_USER.teamId, name: CURRENT_USER.name, role: CURRENT_USER.role,
        email: CURRENT_USER.email, initials: CURRENT_USER.initials
      });
    }
    // Ownership strings written before the rename point at the current user.
    DB.contacts.forEach((c) => { if (c.owner === LEGACY_ADMIN_NAME) c.owner = DB.admin.name; });
    DB.team.forEach((u, i) => {
      // Refresh the roster profile fields from the canonical list; permission and
      // status stay as the workspace set them.
      const seed = TEAM.find((t) => t.id === u.id);
      if (seed) {
        u.role = seed.role;
        u.department = seed.department;
        u.email = seed.email;
        u.phone = seed.phone;
      }
      if (!u.email) u.email = u.name.toLowerCase().replace(/\s+/g, '.') + '@meeting360.io';
      if (!u.department) u.department = fallback[i % fallback.length];
    });
    if (!DB.admin.teamId) {
      const match = teamByName(DB.admin.name) || DB.team[0];
      DB.admin.teamId = match ? match.id : null;
    }
    meetings().forEach((m) => {
      if (!m.organizerId) {
        const u = teamByName(m.organizer) || DB.team[0];
        m.organizerId = u ? u.id : null;
      }
      const u = teamById(m.organizerId);
      if (u) m.organizer = u.name;
    });
  }

  /* ======================================================================
     04. MODULE REGISTRY
     ====================================================================== */
  const TONES = {
    Completed: 'ok', Confirmed: 'ok', Sent: 'ok', Positive: 'ok', Available: 'ok', Resolved: 'ok',
    Scheduled: 'info', Open: 'info', 'Follow-up': 'info', New: 'info', Neutral: 'info', Note: 'info',
    'In Progress': 'warn', 'In progress': 'warn', Pending: 'warn', Voicemail: 'warn', Processing: 'warn', Draft: 'mute',
    Cancelled: 'danger', Missed: 'danger', Negative: 'danger', Overdue: 'danger'
  };
  const toneFor = (status) => TONES[status] || 'info';

  const contactOptions = () => DB.contacts.map((c) => ({ value: c.id, label: fullName(c) }));
  const teamOptions = () => DB.team.map((u) => u.name);
  const meetingOptions = () => [{ value: '', label: '— Not linked to a meeting —' }].concat(
    allRecords('meetings').slice().sort(byDateDesc).slice(0, 40)
      .map((m) => ({ value: m.id, label: `${m.title} · ${fmtDate(m.date)}` }))
  );

  const MODULES = {
    meetings: {
      label: 'Meetings', singular: 'Meeting', icon: 'video', accent: '#6366f1',
      hint: 'total / completed', doneLabel: 'Completed',
      doneWhen: (r) => r.status === 'Completed' || r.status === 'Follow-up',
      title: (r) => r.title,
      meta: (r) => `${fmtDate(r.date)} · ${fmtTime(r.time)} · ${fmtDuration(r.duration)} · ${r.location}`,
      status: (r) => r.status,
      open: (r) => go('meeting', r.id),
      make: () => ({
        title: '', type: DB.settings.defaultType, date: daysFromNow(1), time: '10:00',
        duration: DB.settings.defaultDuration, location: DB.settings.defaultLocation,
        status: 'Scheduled', organizerId: DB.admin.teamId || (DB.team[0] || {}).id,
        organizer: DB.admin.name, contactId: DB.activeContactId,
        agendaText: '', summary: ''
      }),
      toggle: (r) => { r.status = r.status === 'Completed' ? 'Confirmed' : 'Completed'; },
      fields: () => [
        { name: 'title', label: 'Meeting title', required: true, full: true },
        { name: 'contactId', label: 'Customer', type: 'select', options: contactOptions() },
        { name: 'type', label: 'Meeting type', type: 'select', options: MEETING_TYPES },
        { name: 'date', label: 'Date', type: 'date' },
        { name: 'time', label: 'Start time', type: 'time' },
        { name: 'duration', label: 'Duration (minutes)', type: 'number', min: 5, max: 600 },
        { name: 'location', label: 'Location', type: 'select', options: LOCATIONS },
        { name: 'status', label: 'Status', type: 'select', options: MEETING_STATUSES },
        { name: 'organizerId', label: 'Organizer', type: 'select', options: teamSelectOptions() },
        { name: 'agendaText', label: 'Agenda — one topic per line', type: 'textarea', full: true,
          placeholder: 'Adoption review\nOpen issues\nNext steps' },
        { name: 'summary', label: 'Discussion summary', type: 'textarea', full: true }
      ],
      /** Agenda is edited as text but stored as structured topics. */
      beforeSave: (values, existing) => {
        const lines = String(values.agendaText || '').split('\n').map((l) => l.trim()).filter(Boolean);
        values.agenda = lines.length
          ? lines.map((l) => {
              const [topic, objective] = l.split('—').map((s) => s.trim());
              return { topic: topic || l, objective: objective || '' };
            })
          : (existing ? existing.agenda : []);
        delete values.agendaText;
        // Store the organizer relation, and mirror the name for display/grouping.
        const u = teamById(values.organizerId);
        if (u) values.organizer = u.name;
        return values;
      },
      toForm: (r) => Object.assign(clone(r), {
        agendaText: (r.agenda || []).map((a) => a.objective ? `${a.topic} — ${a.objective}` : a.topic).join('\n')
      })
    },

    tasks: {
      label: 'Action Items', singular: 'Action Item', icon: 'task', accent: '#0ea5e9',
      hint: 'total / completed', doneLabel: 'Completed',
      doneWhen: (r) => r.status === 'Completed',
      title: (r) => r.title,
      meta: (r) => `Due ${fmtDate(r.due)} · ${r.priority} priority · ${r.owner || 'Unassigned'}`,
      status: (r) => r.status,
      date: (r) => r.due,
      make: () => ({ title: '', due: daysFromNow(3), priority: 'Medium', owner: DB.admin.name, status: 'Open', contactId: DB.activeContactId, meetingId: '' }),
      toggle: (r) => { r.status = r.status === 'Completed' ? 'Open' : 'Completed'; },
      fields: () => [
        { name: 'title', label: 'Action item', required: true, full: true },
        { name: 'contactId', label: 'Customer', type: 'select', options: contactOptions() },
        { name: 'meetingId', label: 'From meeting', type: 'select', options: meetingOptions() },
        { name: 'due', label: 'Due date', type: 'date' },
        { name: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High'] },
        { name: 'owner', label: 'Owner', type: 'select', options: teamOptions() },
        { name: 'status', label: 'Status', type: 'select', options: ['Open', 'In progress', 'Completed'] }
      ]
    },

    followups: {
      label: 'Follow-ups', singular: 'Follow-up', icon: 'repeat', accent: '#8b5cf6',
      hint: 'total / closed', doneLabel: 'Completed',
      doneWhen: (r) => r.status === 'Completed',
      title: (r) => r.title,
      meta: (r) => `Due ${fmtDate(r.due)} · via ${r.channel} · ${r.owner || 'Unassigned'}`,
      status: (r) => r.status,
      date: (r) => r.due,
      make: () => ({ title: '', due: daysFromNow(5), channel: 'Email', owner: DB.admin.name, status: 'Pending', contactId: DB.activeContactId, meetingId: '', date: todayISO() }),
      toggle: (r) => { r.status = r.status === 'Completed' ? 'Pending' : 'Completed'; },
      fields: () => [
        { name: 'title', label: 'Follow-up', required: true, full: true },
        { name: 'contactId', label: 'Customer', type: 'select', options: contactOptions() },
        { name: 'meetingId', label: 'From meeting', type: 'select', options: meetingOptions() },
        { name: 'due', label: 'Due date', type: 'date' },
        { name: 'channel', label: 'Channel', type: 'select', options: ['Email', 'Call', 'Meeting'] },
        { name: 'owner', label: 'Owner', type: 'select', options: teamOptions() },
        { name: 'status', label: 'Status', type: 'select', options: ['Pending', 'Completed'] }
      ]
    },

    notes: {
      label: 'Meeting Notes', singular: 'Note', icon: 'note', accent: '#a855f7',
      hint: 'notes recorded', doneWhen: null,
      title: (r) => r.body,
      meta: (r) => `${r.author || 'Unknown'} · ${fmtDate(r.date)}${r.meetingId ? ' · ' + (meetingById(r.meetingId) ? meetingById(r.meetingId).title : 'meeting') : ''}`,
      status: () => 'Note',
      make: () => ({ body: '', author: DB.admin.name, date: todayISO(), contactId: DB.activeContactId, meetingId: '' }),
      fields: () => [
        { name: 'body', label: 'Note', type: 'textarea', required: true, full: true },
        { name: 'contactId', label: 'Customer', type: 'select', options: contactOptions() },
        { name: 'meetingId', label: 'From meeting', type: 'select', options: meetingOptions() },
        { name: 'author', label: 'Author', type: 'select', options: teamOptions() },
        { name: 'date', label: 'Date', type: 'date' }
      ]
    },

    recordings: {
      label: 'Recordings', singular: 'Recording', icon: 'mic', accent: '#f43f5e',
      hint: 'recordings stored', doneWhen: null,
      title: (r) => r.name,
      meta: (r) => `${r.size || '—'} · ${fmtDuration(r.length)} · ${fmtDate(r.date)}`,
      status: (r) => r.transcript,
      make: () => ({ name: '', size: '', length: 30, transcript: 'Processing', date: todayISO(), contactId: DB.activeContactId, meetingId: '' }),
      fields: () => [
        { name: 'file', label: 'Choose a recording', type: 'file', full: true },
        { name: 'name', label: 'Recording name', required: true, full: true },
        { name: 'contactId', label: 'Customer', type: 'select', options: contactOptions() },
        { name: 'meetingId', label: 'From meeting', type: 'select', options: meetingOptions() },
        { name: 'size', label: 'File size' },
        { name: 'length', label: 'Length (minutes)', type: 'number', min: 0 },
        { name: 'transcript', label: 'Transcript', type: 'select', options: ['Processing', 'Available'] },
        { name: 'date', label: 'Recorded on', type: 'date' }
      ]
    },

    documents: {
      label: 'Attachments', singular: 'Attachment', icon: 'doc', accent: '#64748b',
      hint: 'files attached', doneWhen: null,
      title: (r) => r.name,
      meta: (r) => `${r.size || '—'} · ${r.type} · ${fmtDate(r.date)}`,
      status: (r) => r.type,
      make: () => ({ name: '', size: '', type: 'Report', date: todayISO(), contactId: DB.activeContactId, meetingId: '' }),
      fields: () => [
        { name: 'file', label: 'Choose a file', type: 'file', full: true },
        { name: 'name', label: 'File name', required: true, full: true },
        { name: 'contactId', label: 'Customer', type: 'select', options: contactOptions() },
        { name: 'meetingId', label: 'From meeting', type: 'select', options: meetingOptions() },
        { name: 'size', label: 'Size' },
        { name: 'type', label: 'Type', type: 'select', options: ['Contract', 'Report', 'Presentation', 'Spreadsheet', 'Other'] },
        { name: 'date', label: 'Uploaded on', type: 'date' }
      ]
    },

    calls: {
      label: 'Calls', singular: 'Call', icon: 'phone', accent: '#14b8a6',
      hint: 'total / completed', doneLabel: 'Completed',
      doneWhen: (r) => r.status === 'Completed',
      title: (r) => r.subject,
      meta: (r) => `${fmtDate(r.date)} · ${fmtDuration(r.duration)} · ${r.owner || 'Unassigned'}`,
      status: (r) => r.status,
      make: () => ({ subject: '', date: todayISO(), duration: 15, owner: DB.admin.name, status: 'Completed', notes: '', contactId: DB.activeContactId, meetingId: '' }),
      toggle: (r) => { r.status = r.status === 'Completed' ? 'Scheduled' : 'Completed'; },
      fields: () => [
        { name: 'subject', label: 'Subject', required: true, full: true },
        { name: 'contactId', label: 'Customer', type: 'select', options: contactOptions() },
        { name: 'meetingId', label: 'Related meeting', type: 'select', options: meetingOptions() },
        { name: 'date', label: 'Date', type: 'date' },
        { name: 'duration', label: 'Duration (minutes)', type: 'number', min: 0, max: 600 },
        { name: 'owner', label: 'Logged by', type: 'select', options: teamOptions() },
        { name: 'status', label: 'Outcome', type: 'select', options: ['Completed', 'Scheduled', 'Voicemail'] },
        { name: 'notes', label: 'Call notes', type: 'textarea', full: true }
      ]
    },

    emails: {
      label: 'Emails', singular: 'Email', icon: 'mail', accent: '#06b6d4',
      hint: 'messages logged', doneWhen: null,
      title: (r) => r.subject,
      meta: (r) => `To ${r.to} · ${fmtDate(r.date)}`,
      status: (r) => r.status,
      make: () => {
        const c = activeContact();
        return { subject: '', to: c ? c.email : '', status: 'Sent', date: todayISO(), body: '', contactId: DB.activeContactId, meetingId: '' };
      },
      fields: () => [
        { name: 'subject', label: 'Subject', required: true, full: true },
        { name: 'to', label: 'To', type: 'email', required: true },
        { name: 'contactId', label: 'Customer', type: 'select', options: contactOptions() },
        { name: 'meetingId', label: 'Related meeting', type: 'select', options: meetingOptions() },
        { name: 'status', label: 'Status', type: 'select', options: ['Sent', 'Draft', 'Scheduled'] },
        { name: 'date', label: 'Date', type: 'date' },
        { name: 'body', label: 'Message', type: 'textarea', full: true }
      ]
    }
  };

  /** The eight module cards shown on a contact profile. */
  const MODULE_ORDER = ['meetings', 'tasks', 'followups', 'notes', 'recordings', 'documents', 'calls', 'emails'];

  const recordDate = (key, r) => (MODULES[key].date ? MODULES[key].date(r) : r.date) || '';
  const fieldsOf = (mod) => (typeof mod.fields === 'function' ? mod.fields() : mod.fields);

  /* ======================================================================
     05. TOASTS
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
    if (action) action.addEventListener('click', () => { dismiss(); if (options.onAction) options.onAction(); });

    root.appendChild(el);
    setTimeout(dismiss, options.timeout || (options.actionLabel ? 7000 : 3800));
  }

  /* ======================================================================
     06. MODAL
     ====================================================================== */
  const modalEl = () => $('#modal');
  let lastFocused = null;

  function openModal(cfg = {}) {
    const el = modalEl();
    if (el.hidden) lastFocused = document.activeElement;

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
    $('#modalBody').scrollTop = 0;

    state.modalRefresh = typeof cfg.refresh === 'function' ? cfg.refresh : null;
    if (typeof cfg.onMount === 'function') cfg.onMount($('.modal__dialog', el));

    const target = el.querySelector('[data-autofocus]') || focusablesIn()[0];
    if (target) setTimeout(() => target.focus(), 40);
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

  function refreshModal() { if (typeof state.modalRefresh === 'function') state.modalRefresh(); }

  function focusablesIn() {
    const dialog = $('.modal__dialog');
    if (!dialog) return [];
    return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', dialog)
      .filter((el) => el.offsetParent !== null);
  }

  function trapFocus(e) {
    const items = focusablesIn();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function confirmModal({ title, sub, message, confirmLabel = 'Confirm', tone = 'danger', iconName = 'alert', onConfirm, returnTo }) {
    openModal({
      title, sub, icon: iconName, tone,
      body: `<div class="${tone === 'danger' ? 'danger-note' : 'fieldset-note'}">
               ${icon(tone === 'danger' ? 'alert' : 'info', 'ico--sm')}<span>${message}</span></div>`,
      footer: `
        <button class="btn btn--quiet" type="button" data-modal-dismiss>Cancel</button>
        <button class="btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}" type="button" data-confirm data-autofocus>${esc(confirmLabel)}</button>`,
      onMount: (dialog) => {
        $('[data-confirm]', dialog).addEventListener('click', () => { onConfirm(); returnTo ? returnTo() : closeModal(); });
        $('[data-modal-dismiss]', dialog).addEventListener('click', () => { returnTo ? returnTo() : closeModal(); });
      }
    });
  }

  /* ======================================================================
     07. FORM BUILDER
     ====================================================================== */
  const optionValue = (o) => (o && typeof o === 'object') ? o.value : o;
  const optionLabel = (o) => (o && typeof o === 'object') ? o.label : o;

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
            ${f.options.map((o) => `<option value="${esc(optionValue(o))}" ${String(val) === String(optionValue(o)) ? 'selected' : ''}>${esc(optionLabel(o))}</option>`).join('')}
          </select>`;
          break;
        case 'file':
          return `<div class="form__group form__group--full">
            <label class="filedrop" for="${id}">
              <span class="filedrop__icon">${icon('upload', 'ico--sm')}</span>
              <span>
                <span class="filedrop__title" data-file-name>${esc(f.label)}</span>
                <span class="filedrop__note">The name, size and type are captured — the file itself stays on your device.</span>
              </span>
              <input type="file" id="${id}" data-file-input />
            </label>
          </div>`;
        default:
          control = `<input class="input" id="${id}" name="${f.name}"
            type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'}"
            value="${esc(val)}" placeholder="${esc(f.placeholder || '')}"
            ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}
            ${f.autofocus ? 'data-autofocus' : ''} />`;
      }

      return `<div class="form__group ${f.full ? 'form__group--full' : ''}">
        ${label}${control}<p class="form__error" data-error-for="${f.name}"></p>
      </div>`;
    }).join('');
  }

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

  function readForm(formEl, fields) {
    const values = {}, errors = {};

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
      if (formEl.elements[keys[0]]) formEl.elements[keys[0]].focus();
      showToast('Check the highlighted fields', 'Some information is missing or invalid.', 'warning');
      return null;
    }
    return values;
  }

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
     08. ROUTER
     ====================================================================== */
  const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'meetings', label: 'Meetings' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'tasks', label: 'Action Items' },
    { id: 'notes', label: 'Notes' },
    { id: 'reports', label: 'Reports' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'settings', label: 'Settings' }
  ];
  const NAV_FOR_ROUTE = { contact: 'contacts', meeting: 'meetings' };

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

  /**
   * Step back through the browser's own history so the previous screen is
   * restored exactly as it was — no reload, no re-entry through the router.
   */
  function goBack() {
    closeModal();
    if (state.routeCount > 1 && history.length > 1) history.back();
    else go(DB.settings.landing || 'dashboard');
  }

  function handleRoute() {
    const { route, param } = readHash();
    if (!VIEWS[route]) { location.replace('#/' + (DB.settings.landing || 'dashboard')); return; }
    state.routeCount = (state.routeCount || 0) + 1;

    if (route === 'contact') {
      const target = contactById(param) || activeContact();
      if (!target) { location.replace('#/contacts'); return; }
      DB.activeContactId = target.id;
      state.param = target.id;
      state.tab = 'overview';
      saveData();
    } else if (route === 'meeting') {
      if (!meetingById(param)) { location.replace('#/meetings'); return; }
      state.param = param;
      state.mtab = 'overview';
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
    const active = NAV_FOR_ROUTE[state.route] || state.route;
    $('#navList').innerHTML = NAV_ITEMS.map((item) => `
      <li>
        <a class="mainnav__link ${active === item.id ? 'is-active' : ''}" href="#/${item.id}"
           ${active === item.id ? 'aria-current="page"' : ''}>${esc(item.label)}</a>
      </li>`).join('');
  }

  /* ======================================================================
     09. SHARED RENDER HELPERS
     ====================================================================== */
  const pageHead = ({ crumbs = [], title, sub, actions = '' }) => `
    <div class="page__head">
      <div class="page__head-text">
        ${state.routeCount > 1 && state.route !== 'dashboard'
          ? `<button class="btn btn--ghost btn--sm page__back" type="button" data-act="back">${icon('arrow-left', 'ico--xs')} Back</button>`
          : ''}
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

  /**
   * Summary tile.
   *  act    -> renders a button that opens the matching detail modal
   *  acc    -> accent colour for the icon chip
   *  trend  -> { label, dir: 'up' | 'down' | 'warn' | 'flat' } small indicator
   */
  const kpiCard = ({ label, value, note, iconName, act, acc, trend }) => {
    const tag = act ? 'button' : 'div';
    const attrs = act ? ` type="button" data-act="kpi" data-id="${esc(act)}" aria-label="${esc(label)} — open details"` : '';
    const style = acc ? ` style="--acc:${acc};--acc-soft:${acc}1f"` : '';
    const arrow = trend && trend.dir === 'up' ? '▲' : trend && trend.dir === 'down' ? '▼' : '';
    return `
    <${tag} class="kpi"${attrs}${style}>
      <div class="kpi__head">
        <p class="kpi__label">${esc(label)}</p>
        <span class="kpi__icon">${icon(iconName, 'ico--sm')}</span>
      </div>
      <p class="kpi__value">${esc(value)}</p>
      ${trend || act
        ? `<div class="kpi__foot">
             ${trend ? `<span class="kpi__trend kpi__trend--${esc(trend.dir || 'flat')}">${arrow} ${esc(trend.label)}</span>` : '<span></span>'}
             ${act ? `<span class="kpi__more">Details ${icon('chevron-right', 'ico--xs')}</span>` : ''}
           </div>`
        : ''}
      <p class="kpi__note">${esc(note || '')}</p>
    </${tag}>`;
  };

  /** Vertical bar chart used by the dashboard and analytics trend blocks. */
  const barChart = (series) => {
    const max = Math.max(1, ...series.map((p) => p.value));
    return `<div class="bars">
      ${series.map((p) => `
        <div class="bar ${p.value === max && max > 0 ? 'bar--peak' : ''}" title="${esc(p.label)}: ${p.value} meetings">
          <span class="bar__value">${p.value}</span>
          <span class="bar__track"><span class="bar__fill" style="height:${Math.round((p.value / max) * 100)}%"></span></span>
          <span class="bar__label">${esc(p.label)}</span>
        </div>`).join('')}
    </div>`;
  };

  const searchToolbar = ({ key, placeholder, count, total, extra = '', actions = '' }) => `
    <div class="toolbar">
      <label class="toolbar__search">
        ${icon('search', 'ico--sm')}
        <input type="search" data-filter="${esc(key)}" value="${esc(state.filters[key] || '')}"
               placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" />
      </label>
      ${extra}${actions}
      <span class="toolbar__count">${count} of ${total}</span>
    </div>`;

  const chipRow = (key, options, current) => `
    <div class="chips">
      ${options.map((o) => `
        <button class="chip ${String(current) === String(o.value) ? 'is-active' : ''}" type="button"
                data-act="chip" data-key="${esc(key)}" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
    </div>`;

  const selectFilter = (key, label, options, current) => `
    <label class="form__group" style="gap:4px;min-width:150px">
      <span class="form__label" style="font-size:11px">${esc(label)}</span>
      <select class="select" data-filter-select="${esc(key)}">
        ${options.map((o) => `<option value="${esc(optionValue(o))}" ${String(current) === String(optionValue(o)) ? 'selected' : ''}>${esc(optionLabel(o))}</option>`).join('')}
      </select>
    </label>`;

  function recordRow(key, r, opts = {}) {
    const mod = MODULES[key];
    const status = mod.status(r);
    const done = mod.doneWhen ? mod.doneWhen(r) : false;
    const linked = r.meetingId ? meetingById(r.meetingId) : null;
    return `
      <article class="rowcard ${done ? 'rowcard--done' : ''}">
        <span class="rowcard__icon" style="color:${mod.accent}">${icon(mod.icon, 'ico--sm')}</span>
        <div class="rowcard__body">
          <p class="rowcard__title">${esc(mod.title(r))}</p>
          <p class="rowcard__meta">${esc(mod.meta(r))}${opts.showContact && r.contactId ? ' · ' + esc(fullName(contactById(r.contactId))) : ''}</p>
          ${opts.showMeeting && linked
            ? `<p class="rowcard__meta"><button class="link-btn" type="button" data-act="open-meeting" data-id="${esc(linked.id)}">${icon('video', 'ico--xs')} ${esc(linked.title)}</button></p>` : ''}
        </div>
        <div class="rowcard__side">
          <span class="pill pill--${toneFor(status)}">${esc(status)}</span>
          <div class="rowcard__actions">
            ${mod.open ? `<button class="icon-btn icon-btn--sm icon-btn--light" type="button" title="Open"
                 data-act="open-record" data-key="${key}" data-id="${r.id}">${icon('eye', 'ico--xs')}</button>` : ''}
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

  /** Compact meeting row used across dashboard, calendar and lists. */
  function meetingRow(m, opts = {}) {
    const c = contactById(m.contactId);
    return `
      <article class="rowcard">
        <span class="rowcard__icon" style="color:${PIPELINE_ACCENT[m.status] || MODULES.meetings.accent}">${icon(m.location === 'Phone' ? 'phone' : 'video', 'ico--sm')}</span>
        <div class="rowcard__body">
          <p class="rowcard__title">${esc(m.title)}</p>
          <p class="rowcard__meta">${esc(fmtDate(m.date))} · ${esc(fmtTime(m.time))} · ${esc(fmtDuration(m.duration))}${c ? ' · ' + esc(fullName(c)) : ''}</p>
          ${opts.showType ? `<p class="rowcard__meta">${esc(m.type)} · ${esc(m.location)} · ${esc(m.organizer)}</p>` : ''}
        </div>
        <div class="rowcard__side">
          <span class="pill pill--${toneFor(m.status)}">${esc(m.status)}</span>
          <div class="rowcard__actions">
            <button class="btn btn--sm btn--soft" type="button" data-act="open-meeting" data-id="${esc(m.id)}">Open</button>
          </div>
        </div>
      </article>`;
  }

  const SKELETONS = {
    default: `<div class="skeleton"><div class="skel skel--title"></div>
      <div class="skel-grid">${'<div class="skel skel--card"></div>'.repeat(8)}</div></div>`,
    contact: `<div class="skeleton"><div class="skel skel--title"></div>
      <div class="skel-row"><div class="skel skel--card" style="height:420px"></div>
      <div class="skel-grid">${'<div class="skel skel--card"></div>'.repeat(8)}</div></div></div>`
  };

  function renderView(opts = {}) {
    const host = $('#view');
    if (!host) return;
    const draw = () => {
      try {
        host.innerHTML = (VIEWS[state.route] || VIEWS.dashboard)();
      } catch (err) {
        console.error('[Meeting 360] View failed to render.', err);
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

  function updateUI() {
    renderAdmin();
    renderNotifications();
    renderNav();
    renderView();
  }

  /* ======================================================================
     10. DERIVED MEETING DATA
     ====================================================================== */
  const meetings = () => allRecords('meetings');
  const meetingsBy = (fn) => meetings().filter(fn);
  const isPast = (m) => m.date < todayISO();
  const isFuture = (m) => m.date >= todayISO();
  const isDone = (m) => m.status === 'Completed' || m.status === 'Follow-up';

  const upcomingMeetings = () => meetingsBy((m) => isFuture(m) && (m.status === 'Scheduled' || m.status === 'Confirmed' || m.status === 'In Progress')).sort(byDateAsc);
  const todaysMeetings = () => meetingsBy((m) => m.date === todayISO()).sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const meetingsOn = (isoStr) => meetingsBy((m) => m.date === isoStr).sort((a, b) => String(a.time).localeCompare(String(b.time)));

  function meetingStats(list) {
    const all = list || meetings();
    const done = all.filter(isDone);
    const cancelled = all.filter((m) => m.status === 'Cancelled');
    const missed = all.filter((m) => m.status === 'Missed');
    const upcoming = all.filter((m) => isFuture(m) && (m.status === 'Scheduled' || m.status === 'Confirmed'));
    const held = done.length + missed.length;

    let invited = 0, attended = 0;
    done.forEach((m) => (m.participants || []).forEach((p) => { invited++; if (p.attended) attended++; }));

    const rated = done.filter((m) => m.satisfaction != null);
    return {
      total: all.length,
      upcoming: upcoming.length,
      completed: done.length,
      cancelled: cancelled.length,
      missed: missed.length,
      avgDuration: done.length ? Math.round(sum(done, (m) => m.duration) / done.length) : 0,
      totalHours: Math.round(sum(done, (m) => m.duration) / 60),
      completionRate: pct(done.length, held || all.length),
      attendanceRate: pct(attended, invited),
      satisfaction: rated.length ? Math.round(sum(rated, (m) => m.satisfaction) / rated.length) : 0
    };
  }

  /** Count meetings per bucket for the trend chart. */
  function trendSeries(mode) {
    const out = [];
    const today = todayISO();
    if (mode === 'daily') {
      for (let i = 13; i >= 0; i--) {
        const d = addDays(today, -i);
        out.push({ key: d, label: new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit' }), value: meetingsOn(d).length });
      }
    } else if (mode === 'weekly') {
      for (let i = 7; i >= 0; i--) {
        const start = weekStart(addDays(today, -i * 7));
        const end = addDays(start, 6);
        out.push({
          key: start, label: 'W' + new Date(start + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).replace(' ', ''),
          value: meetingsBy((m) => m.date >= start && m.date <= end).length
        });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setDate(1); d.setMonth(d.getMonth() - i);
        const key = iso(d).slice(0, 7);
        out.push({ key, label: monthLabel(key), value: meetingsBy((m) => monthKey(m.date) === key).length });
      }
    }
    return out;
  }

  /** Meeting volume growth: last 30 days vs the 30 before that. */
  function growth() {
    const today = todayISO();
    const cur = meetingsBy((m) => m.date > addDays(today, -30) && m.date <= today).length;
    const prev = meetingsBy((m) => m.date > addDays(today, -60) && m.date <= addDays(today, -30)).length;
    return { cur, prev, change: prev ? Math.round(((cur - prev) / prev) * 100) : (cur ? 100 : 0) };
  }

  /** Change in average meeting length: last 30 days vs the 30 before. */
  function durationTrend() {
    const today = todayISO();
    const avg = (list) => (list.length ? Math.round(sum(list, (m) => m.duration) / list.length) : 0);
    const cur = avg(meetingsBy((m) => isDone(m) && m.date > addDays(today, -30) && m.date <= today));
    const prev = avg(meetingsBy((m) => isDone(m) && m.date > addDays(today, -60) && m.date <= addDays(today, -30)));
    return { cur, prev, change: cur - prev };
  }

  function contactMeetingProfile(c) {
    const list = recordsFor('meetings', c.id).slice().sort(byDateAsc);
    const past = list.filter(isPast);
    const done = list.filter(isDone);
    const next = list.find((m) => isFuture(m) && m.status !== 'Cancelled');
    const last = past.filter(isDone).slice(-1)[0] || past.slice(-1)[0] || null;

    // Average gap between held meetings, in days.
    let frequency = 0;
    if (done.length > 1) {
      const first = done[0].date, lastDate = done[done.length - 1].date;
      frequency = Math.max(1, Math.round(Math.abs(dayDiff(lastDate, first)) / (done.length - 1)));
    }
    const openFollow = recordsFor('followups', c.id).filter((f) => f.status !== 'Completed');
    const rated = done.filter((m) => m.satisfaction != null);

    return {
      list, total: list.length, completed: done.length, next, last, frequency,
      openFollowUps: openFollow.length,
      hours: Math.round(sum(done, (m) => m.duration) / 60),
      avgDuration: done.length ? Math.round(sum(done, (m) => m.duration) / done.length) : 0,
      satisfaction: rated.length ? Math.round(sum(rated, (m) => m.satisfaction) / rated.length) : 0,
      notes: recordsFor('notes', c.id).length
    };
  }

  /* ======================================================================
     10b. MEETING INTELLIGENCE (local, rule-based — no network calls)
     ====================================================================== */
  const ACTION_CUES = /\b(will|need to|needs to|should|must|send|share|prepare|schedule|book|confirm|publish|draft|circulate|review|follow up|follow-up)\b/i;

  const Intel = {
    /** Sentence-level extraction of candidate action items from free text. */
    extractActions(text) {
      return String(text || '')
        .split(/(?<=[.!?])\s+|\n+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 18 && ACTION_CUES.test(s))
        .slice(0, 6)
        .map((s) => s.replace(/^(and|then|also)\s+/i, '').replace(/\.$/, ''));
    },

    /** Readable recap built from the meeting's own structured fields. */
    summarise(m) {
      const c = contactById(m.contactId);
      const parts = [];
      parts.push(`${m.type} with ${c ? fullName(c) : 'the customer'} on ${fmtDate(m.date)}, ${fmtDuration(m.duration)} via ${m.location.toLowerCase()}.`);
      if ((m.agenda || []).length) parts.push(`Agenda covered ${m.agenda.map((a) => a.topic.toLowerCase()).join(', ')}.`);
      if (m.summary) parts.push(m.summary);
      if ((m.decisions || []).length) parts.push(`Decisions: ${m.decisions.join(' ')}`);
      const attended = (m.participants || []).filter((p) => p.attended).length;
      if (isDone(m)) parts.push(`${attended} of ${(m.participants || []).length} invitees attended${m.satisfaction != null ? `, satisfaction ${m.satisfaction}%` : ''}.`);
      return parts.join(' ');
    },

    /** Next-best-action recommendation for a single meeting. */
    suggestion(m) {
      const actions = recordsForMeeting('tasks', m.id);
      const follow = recordsForMeeting('followups', m.id);
      if (m.status === 'Missed') return { text: 'This meeting was missed — reschedule it while the context is fresh.', act: 'reschedule' };
      if (m.status === 'Cancelled') return { text: 'Cancelled. Offer two alternative slots to keep momentum.', act: 'reschedule' };
      if (m.sentiment === 'Negative') return { text: 'Sentiment was negative — a follow-up call is recommended within 48 hours.', act: 'followup' };
      if (isDone(m) && !follow.length) return { text: 'No follow-up is logged for this meeting yet.', act: 'followup' };
      if (isDone(m) && !actions.length) return { text: 'No action items were captured — extract them from the summary.', act: 'extract' };
      if (isFuture(m) && !(m.agenda || []).length) return { text: 'No agenda yet. Adding topics improves attendance and outcomes.', act: 'agenda' };
      if (isFuture(m)) return { text: 'Send a reminder with the agenda 24 hours before the meeting.', act: 'reminder' };
      return { text: 'Everything is captured for this meeting — no action needed.', act: null };
    },

    /** Workspace-level insights shown on the dashboard. */
    insights() {
      const today = todayISO();
      const out = [];
      const g = growth();

      out.push({
        icon: 'trend', accent: g.change >= 0 ? '#10b981' : '#f43f5e',
        text: `Customer engagement ${g.change >= 0 ? 'increased' : 'decreased'} by ${Math.abs(g.change)}%`,
        meta: `${g.cur} meetings in the last 30 days vs ${g.prev} in the previous 30`,
        route: 'analytics'
      });

      const needFollow = meetingsBy((m) => isDone(m) && !recordsForMeeting('followups', m.id).length);
      if (needFollow.length) {
        out.push({
          icon: 'repeat', accent: '#8b5cf6', text: `${needFollow.length} meetings require follow-up`,
          meta: 'Completed sessions with no follow-up logged', filter: 'needs-followup'
        });
      }

      const intent = DB.contacts.filter((c) => {
        const recent = recordsFor('meetings', c.id).filter((m) => isDone(m) && m.sentiment === 'Positive' && m.date > addDays(today, -60));
        const ahead = recordsFor('meetings', c.id).some((m) => isFuture(m) && m.status !== 'Cancelled');
        return recent.length >= 2 && ahead;
      });
      if (intent.length) {
        out.push({
          icon: 'target', accent: '#0ea5e9', text: `${intent.length} customer${intent.length === 1 ? '' : 's'} show buying intent`,
          meta: intent.map((c) => fullName(c)).join(', ') + ' — positive sentiment with a meeting booked', route: 'contacts'
        });
      }

      const stats = meetingStats();
      out.push({
        icon: 'sparkle', accent: '#4f46e5', text: `Average meeting satisfaction: ${stats.satisfaction}%`,
        meta: `Attendance ${stats.attendanceRate}% · completion ${stats.completionRate}%`, route: 'reports'
      });

      const overdue = allRecords('tasks').filter((t) => t.status !== 'Completed' && t.due < today);
      if (overdue.length) {
        out.push({
          icon: 'alert', accent: '#f59e0b', text: `${overdue.length} action item${overdue.length === 1 ? '' : 's'} are overdue`,
          meta: 'Oldest: ' + fmtDate(overdue.sort((a, b) => String(a.due).localeCompare(String(b.due)))[0].due), route: 'tasks'
        });
      }

      const risky = meetingsBy((m) => m.sentiment === 'Negative' && m.date > addDays(today, -45));
      if (risky.length) {
        out.push({
          icon: 'flag', accent: '#f43f5e', text: `${risky.length} recent meeting${risky.length === 1 ? '' : 's'} had negative sentiment`,
          meta: 'Review these accounts for churn risk', filter: 'negative'
        });
      }
      return out;
    }
  };

  /* ======================================================================
     11. VIEWS
     ====================================================================== */
  const VIEWS = {};

  /* --------------------------- A. DASHBOARD ---------------------------- */
  const QUICK_ACTIONS = [
    { id: 'schedule-meeting', label: 'Schedule Meeting', note: 'Book a new session', icon: 'video', accent: '#6366f1' },
    { id: 'new-contact', label: 'Create Contact', note: 'Add a customer', icon: 'user', accent: '#06b6d4' },
    { id: 'new:notes', label: 'Add Meeting Notes', note: 'Capture discussion', icon: 'note', accent: '#a855f7' },
    { id: 'new:tasks', label: 'Create Task', note: 'Assign an action item', icon: 'task', accent: '#0ea5e9' },
    { id: 'new:recordings', label: 'Upload Recording', note: 'Attach a session file', icon: 'mic', accent: '#f43f5e' },
    { id: 'reports', label: 'Generate Report', note: 'Build a meeting report', icon: 'bars', accent: '#10b981' }
  ];

  const REPORT_TYPES = [
    { id: 'productivity', label: 'Meeting productivity', note: 'Volume, hours and completion', icon: 'bars' },
    { id: 'employee', label: 'Employee meeting performance', note: 'Per organizer breakdown', icon: 'users' },
    { id: 'engagement', label: 'Customer engagement report', note: 'Per customer activity', icon: 'pulse' },
    { id: 'attendance', label: 'Attendance report', note: 'Invited vs attended', icon: 'check' },
    { id: 'duration', label: 'Meeting duration report', note: 'Time spent by type', icon: 'clock' },
    { id: 'followup', label: 'Follow-up completion report', note: 'Closure of commitments', icon: 'repeat' }
  ];

  VIEWS.dashboard = function () {
    const s = meetingStats();
    const g = growth();
    const mode = state.filters.trend || 'daily';
    const series = trendSeries(mode);
    const today = todayISO();
    const todays = todaysMeetings();
    const next = upcomingMeetings().slice(0, 4);
    const insights = Intel.insights();
    const dur = durationTrend();

    /* Recent activity, grouped by day */
    const activity = [];
    MODULE_ORDER.forEach((key) => {
      allRecords(key).forEach((r) => activity.push({ key, r, date: recordDate(key, r) }));
    });
    const recent = activity.filter((a) => a.date <= today).sort(byDateDesc).slice(0, 8);
    const groups = [
      { label: 'Today', items: recent.filter((a) => a.date === today) },
      { label: 'Yesterday', items: recent.filter((a) => a.date === addDays(today, -1)) },
      { label: 'Earlier', items: recent.filter((a) => a.date < addDays(today, -1)) }
    ].filter((grp) => grp.items.length);

    return `
      <div class="dash">
      ${pageHead({
        title: `Good to see you, ${DB.admin.name.split(' ')[0]}`,
        sub: `Meeting intelligence across your workspace for ${fmtDate(today)}.`,
        actions: `
          <button class="btn btn--ghost" type="button" data-act="go" data-route="analytics">${icon('pulse')}<span class="btn__label">Analytics</span></button>
          <button class="btn btn--ghost" type="button" data-act="go" data-route="reports">${icon('bars')}<span class="btn__label">Reports</span></button>
          <button class="btn btn--primary" type="button" data-act="schedule-meeting">${icon('plus')}<span class="btn__label">Schedule Meeting</span></button>`
      })}

      <!-- A. Meeting overview KPIs -->
      <div class="kpis">
        ${kpiCard({
          act: 'total', label: 'Total Meetings', value: num(s.total), iconName: 'video', acc: '#6366f1',
          trend: { label: `${Math.abs(g.change)}% vs last month`, dir: g.change > 0 ? 'up' : g.change < 0 ? 'down' : 'flat' },
          note: `${g.cur} in the last 30 days`
        })}
        ${kpiCard({
          act: 'upcoming', label: 'Upcoming', value: num(s.upcoming), iconName: 'calendar', acc: '#06b6d4',
          trend: { label: `${todays.length} today`, dir: todays.length ? 'up' : 'flat' },
          note: `Next: ${next[0] ? fmtDay(next[0].date) : 'nothing booked'}`
        })}
        ${kpiCard({
          act: 'completed', label: 'Completed', value: num(s.completed), iconName: 'check', acc: '#10b981',
          trend: { label: `${s.completionRate}% completion`, dir: s.completionRate >= 80 ? 'up' : 'warn' },
          note: `${num(s.totalHours)} hours held`
        })}
        ${kpiCard({
          act: 'cancelled', label: 'Cancelled', value: num(s.cancelled), iconName: 'close', acc: '#f43f5e',
          trend: { label: `${pct(s.cancelled, s.total)}% of all`, dir: s.cancelled ? 'down' : 'flat' },
          note: 'Called off before start'
        })}
        ${kpiCard({
          act: 'missed', label: 'Missed', value: num(s.missed), iconName: 'alert', acc: '#f59e0b',
          trend: { label: `${pct(s.missed, s.total)}% no-show`, dir: s.missed ? 'warn' : 'flat' },
          note: 'Recoverable with a reschedule'
        })}
        ${kpiCard({
          act: 'duration', label: 'Avg Duration', value: fmtDuration(s.avgDuration), iconName: 'clock', acc: '#8b5cf6',
          trend: { label: `${dur.change >= 0 ? '+' : ''}${dur.change} min`, dir: dur.change > 0 ? 'up' : dur.change < 0 ? 'down' : 'flat' },
          note: `${num(s.totalHours)} hours in total`
        })}
      </div>

      <!-- F. Meeting intelligence -->
      <section class="section">
        <div class="ai">
          <div class="ai__head">
            <p class="ai__title">${icon('sparkle')} Meeting Intelligence</p>
            <span class="ai__badge">${icon('pulse', 'ico--xs')} Computed from ${num(s.total)} meetings</span>
          </div>
          <div class="ai__list">
            ${insights.map((i) => `
              <button class="ai__item" type="button" data-act="insight"
                      data-route="${esc(i.route || '')}" data-filter="${esc(i.filter || '')}"
                      style="--acc:${i.accent || '#4f46e5'};--acc-soft:${i.accent || '#4f46e5'}1f">
                <span class="ai__chip">${icon(i.icon, 'ico--sm')}</span>
                <span class="ai__text">${esc(i.text)}<span class="ai__meta">${esc(i.meta)}</span></span>
              </button>`).join('')}
          </div>
          <div class="ai__foot">
            <button class="btn btn--soft btn--sm" type="button" data-act="intel-digest">${icon('sparkle', 'ico--xs')} Generate workspace digest</button>
            <button class="btn btn--ghost btn--sm" type="button" data-act="go" data-route="analytics">${icon('bars', 'ico--xs')} Intelligence analytics</button>
            <span class="ai__note">Derived locally from your meeting records</span>
          </div>
        </div>
      </section>

      <!-- B. Performance analytics (left) + C. Calendar overview (right) -->
      <section class="section">
        <div class="split">
          <div class="card pad">
            <div class="section-head">
              <div>
                <h2 class="section-title">Meeting performance</h2>
                <p class="section-note">Volume trend and quality rates</p>
              </div>
              ${chipRow('trend', [
                { label: 'Daily', value: 'daily' }, { label: 'Weekly', value: 'weekly' }, { label: 'Monthly', value: 'monthly' }
              ], mode)}
            </div>

            ${barChart(series)}

            <div class="mini-kpis" style="margin-top:16px">
              <div class="mini" style="--acc:#6366f1">
                <p class="mini__label">${icon('trend', 'ico--xs')} Meeting growth</p>
                <p class="mini__value">${g.change >= 0 ? '+' : ''}${g.change}%</p>
                <p class="mini__note">${g.cur} vs ${g.prev} meetings</p>
              </div>
              <div class="mini" style="--acc:#10b981">
                <p class="mini__label">${icon('check', 'ico--xs')} Completion rate</p>
                <p class="mini__value">${s.completionRate}%</p>
                <p class="mini__note">${s.completed} of ${s.completed + s.missed} held</p>
              </div>
              <div class="mini" style="--acc:#06b6d4">
                <p class="mini__label">${icon('users', 'ico--xs')} Attendance rate</p>
                <p class="mini__value">${s.attendanceRate}%</p>
                <p class="mini__note">Invitees who joined</p>
              </div>
              <div class="mini" style="--acc:#8b5cf6">
                <p class="mini__label">${icon('sparkle', 'ico--xs')} Satisfaction</p>
                <p class="mini__value">${s.satisfaction}%</p>
                <p class="mini__note">Post-meeting average</p>
              </div>
            </div>

            <p class="subhead">Top meeting types</p>
            <div class="stack">
              ${(() => {
                const byType = {};
                meetings().forEach((m) => { byType[m.type] = (byType[m.type] || 0) + 1; });
                const top = Object.keys(byType).sort((a, b) => byType[b] - byType[a]).slice(0, 3);
                const max = Math.max(1, ...top.map((t) => byType[t]));
                return top.map((t) => `
                  <div class="switch-row">
                    <div style="flex:1;min-width:0">
                      <p class="switch-row__text">${esc(t)}</p>
                      <div class="meter" style="margin-top:8px"><span class="meter__fill" style="width:${pct(byType[t], max)}%"></span></div>
                    </div>
                    <strong>${byType[t]}</strong>
                  </div>`).join('');
              })()}
            </div>
          </div>

          <div class="card pad">
            <div class="section-head">
              <div>
                <h2 class="section-title">Calendar overview</h2>
                <p class="section-note">${esc(fmtDay(today))}</p>
              </div>
              <button class="btn btn--sm btn--soft" type="button" data-act="go" data-route="calendar">${icon('calendar', 'ico--xs')} Open</button>
            </div>

            <p class="subhead">Today · ${todays.length}</p>
            <div class="stack">
              ${todays.length ? todays.slice(0, 2).map((m) => meetingRow(m)).join('')
                : `<p class="empty-note">No meetings today — <button class="link-btn" type="button" data-act="schedule-meeting">book one</button>.</p>`}
            </div>

            <p class="subhead">Next up</p>
            <div class="stack">
              ${next.length ? next.slice(0, 2).map((m) => meetingRow(m)).join('')
                : '<p class="empty-note">Nothing scheduled ahead.</p>'}
            </div>

            <p class="subhead">Reminders</p>
            <div class="stack">
              ${upcomingMeetings().slice(0, 1).map((m) => `
                <div class="switch-row">
                  <div>
                    <p class="switch-row__text">${esc(m.title)}</p>
                    <p class="switch-row__note">${esc(fmtDay(m.date))} · ${esc(fmtTime(m.time))} · ${m.reminder || DB.settings.reminderLead} min before</p>
                  </div>
                  <button class="btn btn--sm btn--ghost" type="button" data-act="send-reminder" data-id="${esc(m.id)}">${icon('bell', 'ico--xs')} Send</button>
                </div>`).join('') || '<p class="empty-note">No reminders pending.</p>'}
            </div>

            <button class="btn btn--primary btn--block" type="button" data-act="schedule-meeting" style="margin-top:14px">
              ${icon('plus', 'ico--sm')} Schedule meeting</button>
          </div>
        </div>
      </section>

      <!-- D. Meeting pipeline -->
      <section class="section">
        <div class="section-head">
          <div>
            <h2 class="section-title">Meeting pipeline</h2>
            <p class="section-note">Scheduled → Confirmed → In Progress → Completed → Follow-up</p>
          </div>
          <button class="btn btn--sm btn--ghost" type="button" data-act="go" data-route="meetings">Open meetings</button>
        </div>
        <div class="flow">
          ${PIPELINE.map((stage) => {
            const list = meetingsBy((m) => m.status === stage);
            const share = pct(list.length, s.total);
            return `
              <button class="flow__step" type="button" data-act="stage" data-value="${esc(stage)}" style="--acc:${PIPELINE_ACCENT[stage]}">
                <span class="flow__label">${esc(stage)}</span>
                <span class="flow__count">${list.length}</span>
                <span class="flow__pct">${share}% of all meetings</span>
                <span class="flow__bar"><span style="width:${share}%"></span></span>
              </button>`;
          }).join('')}
        </div>
      </section>

      <!-- E. Interaction history + G. Action center -->
      <section class="section">
        <div class="split">
          <div class="card pad">
            <div class="section-head">
              <div>
                <h2 class="section-title">Meeting interaction history</h2>
                <p class="section-note">Everything logged across the workspace</p>
              </div>
              <button class="btn btn--sm btn--ghost" type="button" data-act="go" data-route="meetings">View all</button>
            </div>
            ${groups.length ? groups.map((grp) => `
              <p class="subhead">${esc(grp.label)}</p>
              <div class="timeline">
                ${grp.items.map(({ key, r, date }) => {
                  const mod = MODULES[key];
                  return `
                    <article class="tl-item">
                      <p class="tl-item__time">${esc(fmtDate(date))} · ${esc(mod.label)}</p>
                      <p class="tl-item__title">${esc(String(mod.title(r)).slice(0, 78))}</p>
                      <p class="tl-item__text">${esc(mod.meta(r))}${r.contactId ? ' · ' + esc(fullName(contactById(r.contactId))) : ''}</p>
                    </article>`;
                }).join('')}
              </div>`).join('')
              : '<p class="empty-note">No activity recorded yet.</p>'}
          </div>

          <div class="card pad">
            <div class="section-head">
              <div>
                <h2 class="section-title">Action center</h2>
                <p class="section-note">One click to the things you do most</p>
              </div>
            </div>
            <div class="grid-cards" style="grid-template-columns:1fr;gap:10px">
              ${QUICK_ACTIONS.map((a) => `
                <button class="modcard" type="button"
                        data-act="${a.id === 'reports' ? 'go' : a.id}" ${a.id === 'reports' ? 'data-route="reports"' : ''}
                        style="--acc:${a.accent};--acc-soft:${a.accent}1f;padding:14px">
                  <span class="modcard__icon">${icon(a.icon)}</span>
                  <span>
                    <span class="modcard__title">${esc(a.label)}</span>
                    <span class="modcard__note">${esc(a.note)}</span>
                  </span>
                  <span class="modcard__count">${icon('chevron-right', 'ico--sm')}</span>
                </button>`).join('')}
            </div>

            <p class="subhead">Shortcuts</p>
            <div class="stack">
              <div class="switch-row">
                <div>
                  <p class="switch-row__text">Open action items</p>
                  <p class="switch-row__note">${allRecords('tasks').filter((t) => t.status !== 'Completed').length} still outstanding</p>
                </div>
                <button class="btn btn--sm btn--ghost" type="button" data-act="go" data-route="tasks">Open</button>
              </div>
              <div class="switch-row">
                <div>
                  <p class="switch-row__text">Follow-ups awaiting closure</p>
                  <p class="switch-row__note">${allRecords('followups').filter((f) => f.status !== 'Completed').length} pending commitments</p>
                </div>
                <button class="btn btn--sm btn--ghost" type="button" data-act="new-record" data-key="followups">Add</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- H. Meeting analytics reports -->
      <section class="section">
        <div class="section-head">
          <div>
            <h2 class="section-title">Meeting intelligence reports</h2>
            <p class="section-note">Open a report to filter it by date range, user, customer or type</p>
          </div>
          <button class="btn btn--sm btn--ghost" type="button" data-act="go" data-route="reports">All reports</button>
        </div>
        <div class="grid-cards">
          ${REPORT_TYPES.map((r) => `
            <button class="modcard" type="button" data-act="report" data-id="${r.id}" style="--acc:#4f46e5;--acc-soft:#4f46e51f">
              <span class="modcard__icon">${icon(r.icon)}</span>
              <span>
                <span class="modcard__title">${esc(r.label)}</span>
                <span class="modcard__note">${esc(r.note)}</span>
              </span>
              <span class="modcard__count">${icon('chevron-right', 'ico--sm')}</span>
            </button>`).join('')}
        </div>
      </section>
      </div>`;
  };

  /* --------------------------- MEETINGS LIST --------------------------- */
  VIEWS.meetings = function () {
    const q = state.filters.meetings || '';
    const status = state.filters.mStatus || 'all';
    const type = state.filters.mType || 'all';
    const range = state.filters.mRange || 'all';
    const today = todayISO();

    let list = meetings().slice();
    if (status !== 'all') list = list.filter((m) => m.status === status);
    if (type !== 'all') list = list.filter((m) => m.type === type);
    if (range === 'upcoming') list = list.filter((m) => m.date >= today);
    if (range === 'past') list = list.filter((m) => m.date < today);
    if (range === 'week') { const w = weekStart(today); list = list.filter((m) => m.date >= w && m.date <= addDays(w, 6)); }
    list = list.filter((m) => matches(q, m.title, m.type, m.organizer, m.location, fullName(contactById(m.contactId))));

    const sort = state.filters.mSort || 'date-desc';
    list.sort(sort === 'date-asc' ? byDateAsc : sort === 'title' ? (a, b) => a.title.localeCompare(b.title) : byDateDesc);

    return `
      ${pageHead({
        crumbs: [{ label: 'Dashboard', route: 'dashboard' }, { label: 'Meetings' }],
        title: 'Meetings',
        sub: 'Every session with its agenda, participants, notes, actions and intelligence.',
        actions: `<button class="btn btn--primary" type="button" data-act="schedule-meeting">${icon('plus')}<span class="btn__label">Schedule Meeting</span></button>`
      })}

      ${searchToolbar({
        key: 'meetings', placeholder: 'Search by title, customer, organizer or type…',
        count: list.length, total: meetings().length,
        extra: `
          ${selectFilter('mType', 'Type', [{ value: 'all', label: 'All types' }].concat(MEETING_TYPES), type)}
          ${selectFilter('mSort', 'Sort', [
            { value: 'date-desc', label: 'Newest first' }, { value: 'date-asc', label: 'Oldest first' }, { value: 'title', label: 'Title A–Z' }
          ], sort)}`
      })}

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:-6px 0 18px">
        ${chipRow('mStatus', [{ label: 'All statuses', value: 'all' }].concat(MEETING_STATUSES.map((s) => ({ label: s, value: s }))), status)}
        ${chipRow('mRange', [
          { label: 'Any date', value: 'all' }, { label: 'This week', value: 'week' },
          { label: 'Upcoming', value: 'upcoming' }, { label: 'Past', value: 'past' }
        ], range)}
      </div>

      ${list.length
        ? `<div class="stack">${list.map((m) => meetingRow(m, { showType: true })).join('')}</div>`
        : emptyState({
            iconName: 'video', title: 'No meetings found',
            text: q || status !== 'all' || type !== 'all' || range !== 'all'
              ? 'No meetings match the current filters. Clear them or widen the range.'
              : 'Nothing has been scheduled yet.',
            cta: `<button class="btn btn--primary" type="button" data-act="schedule-meeting">${icon('plus', 'ico--xs')} Schedule a meeting</button>`
          })}`;
  };

  /* ------------------------ MEETING 360 DETAIL ------------------------- */
  VIEWS.meeting = function () {
    const m = meetingById(state.param);
    if (!m) return emptyState({ iconName: 'video', title: 'Meeting not found', text: 'This meeting may have been deleted.', cta: `<button class="btn btn--primary" type="button" data-act="go" data-route="meetings">Back to meetings</button>` });

    const c = contactById(m.contactId);
    const actions = recordsForMeeting('tasks', m.id);
    const follow = recordsForMeeting('followups', m.id);
    const notes = recordsForMeeting('notes', m.id);
    const files = recordsForMeeting('documents', m.id);
    const recs = recordsForMeeting('recordings', m.id);
    const attended = (m.participants || []).filter((p) => p.attended).length;

    const TABS_M = [
      ['overview', 'Overview'], ['people', 'Participants'], ['notes', 'Notes & Actions'],
      ['files', 'Attachments'], ['intel', 'Intelligence'], ['timeline', 'Timeline']
    ];

    return `
      ${pageHead({
        crumbs: [{ label: 'Dashboard', route: 'dashboard' }, { label: 'Meetings', route: 'meetings' }, { label: m.title }],
        title: m.title,
        sub: `${m.type} · ${fmtDay(m.date)} · ${fmtTime(m.time)} · ${fmtDuration(m.duration)} · ${m.location}`,
        actions: `
          ${m.status !== 'Completed' && m.status !== 'Cancelled'
            ? `<button class="btn btn--ghost" type="button" data-act="complete-meeting" data-id="${esc(m.id)}">${icon('check')}<span class="btn__label">Complete</span></button>` : ''}
          <button class="btn btn--ghost" type="button" data-act="reschedule" data-id="${esc(m.id)}">${icon('calendar')}<span class="btn__label">Reschedule</span></button>
          <button class="btn btn--primary" type="button" data-act="edit-record" data-key="meetings" data-id="${esc(m.id)}">${icon('edit')}<span class="btn__label">Edit</span></button>`
      })}

      <div class="kpis">
        ${kpiCard({ label: 'Status', value: m.status, note: `Organizer ${m.organizer}`, iconName: 'flag' })}
        ${kpiCard({ label: 'Customer', value: c ? fullName(c) : 'Internal', note: c ? c.accountName : 'No customer linked', iconName: 'user' })}
        ${kpiCard({ label: 'Participants', value: String((m.participants || []).length), note: isDone(m) ? `${attended} attended` : 'Awaiting the session', iconName: 'users' })}
        ${kpiCard({ label: 'Action items', value: String(actions.length), note: `${actions.filter((a) => a.status === 'Completed').length} completed`, iconName: 'task' })}
        ${kpiCard({ label: 'Sentiment', value: m.sentiment || 'Not rated', note: m.satisfaction != null ? `Satisfaction ${m.satisfaction}%` : 'Available after the meeting', iconName: 'sparkle' })}
      </div>

      <section class="section">
        <div class="card panel">
          <div class="tabbar">
            <div class="tabs" role="tablist" aria-label="Meeting sections">
              ${TABS_M.map(([id, label]) => `
                <button class="tab ${state.mtab === id ? 'is-active' : ''}" role="tab" type="button"
                        aria-selected="${state.mtab === id}" tabindex="${state.mtab === id ? 0 : -1}"
                        data-act="mtab" data-id="${id}">${label}</button>`).join('')}
            </div>
            <div class="dropdown" data-dropdown>
              <button class="btn btn--accent" type="button" data-dropdown-toggle aria-expanded="false" aria-haspopup="true">
                <span class="btn__label">Actions</span>${icon('chevron', 'ico--xs dropdown__caret')}
              </button>
              <div class="dropdown__menu dropdown__menu--right" role="menu" data-dropdown-menu hidden>
                <button class="dropdown__item" role="menuitem" type="button" data-act="new-linked" data-key="tasks" data-id="${esc(m.id)}">${icon('task')} Add action item</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="new-linked" data-key="notes" data-id="${esc(m.id)}">${icon('note')} Add note</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="new-linked" data-key="followups" data-id="${esc(m.id)}">${icon('repeat')} Add follow-up</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="new-linked" data-key="recordings" data-id="${esc(m.id)}">${icon('mic')} Upload recording</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="new-linked" data-key="documents" data-id="${esc(m.id)}">${icon('doc')} Attach file</button>
                <div class="dropdown__sep" role="separator"></div>
                <button class="dropdown__item" role="menuitem" type="button" data-act="add-participant" data-id="${esc(m.id)}">${icon('lead')} Add participant</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="send-reminder" data-id="${esc(m.id)}">${icon('bell')} Send reminder</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="cancel-meeting" data-id="${esc(m.id)}">${icon('close')} Cancel meeting</button>
                <div class="dropdown__sep" role="separator"></div>
                <button class="dropdown__item dropdown__item--danger" role="menuitem" type="button" data-act="del-record" data-key="meetings" data-id="${esc(m.id)}">${icon('trash')} Delete meeting</button>
              </div>
            </div>
          </div>
          <div class="panel__body">
            <div class="tabpanel" role="tabpanel">${MTABS[state.mtab] ? MTABS[state.mtab](m) : MTABS.overview(m)}</div>
          </div>
        </div>
      </section>`;
  };

  const MTABS = {
    overview: (m) => {
      const c = contactById(m.contactId);
      const u = organizerOf(m);
      const stats = u ? organizerStats(u.id) : null;
      return `
        <p class="subhead">Meeting overview</p>
        <div class="fields">
          ${field('Title', m.title)}
          ${field('Type', m.type)}
          ${field('Date', fmtDay(m.date))}
          ${field('Time', `${fmtTime(m.time)} · ${fmtDuration(m.duration)}`)}
          ${field('Location', m.location)}
          ${field('Status', m.status)}
        </div>

        <p class="subhead">Customer</p>
        ${c ? `
          <article class="rowcard">
            <span class="avatar avatar--md ${avatarClass(c.id)}">${esc(initialsOf(c.firstName, c.lastName))}</span>
            <div class="rowcard__body">
              <p class="rowcard__title">${esc(fullName(c))}</p>
              <p class="rowcard__meta">${esc(c.jobTitle || '—')} · ${esc(c.accountName || 'No company')}</p>
              <p class="rowcard__meta">${icon('mail', 'ico--xs')} <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>
                ${c.mobile || c.officePhone ? ` · ${icon('phone', 'ico--xs')} <a href="${esc(telHref(c.mobile || c.officePhone))}">${esc(c.mobile || c.officePhone)}</a>` : ''}</p>
            </div>
            <div class="rowcard__side">
              <button class="btn btn--sm btn--soft" type="button" data-act="open-contact" data-id="${esc(c.id)}">Open Contact 360</button>
            </div>
          </article>`
          : '<p class="empty-note">No customer is linked to this meeting — use Edit to attach one.</p>'}

        <p class="subhead">Organizer</p>
        ${u ? `
          <article class="rowcard">
            <span class="avatar avatar--md ${avatarClass(u.id)}">${esc(initialsName(u.name))}</span>
            <div class="rowcard__body">
              <p class="rowcard__title">${esc(u.name)}</p>
              <p class="rowcard__meta">${esc(u.role)} · ${esc(u.department)}</p>
              <p class="rowcard__meta">${icon('mail', 'ico--xs')} <a href="mailto:${esc(u.email)}">${esc(u.email)}</a>
                ${u.phone ? ` · ${icon('phone', 'ico--xs')} <a href="${esc(telHref(u.phone))}">${esc(u.phone)}</a>` : ''}</p>
            </div>
            <div class="rowcard__side">
              <span class="pill pill--info">${stats.organised} meetings organised</span>
              <button class="btn btn--sm btn--soft" type="button" data-act="organizer" data-id="${esc(u.id)}">View profile</button>
            </div>
          </article>`
          : '<p class="empty-note">No organizer assigned — use Edit to set one.</p>'}

        <p class="subhead">Agenda
          <button class="btn btn--sm btn--soft" type="button" data-act="edit-agenda" data-id="${esc(m.id)}">${icon('edit', 'ico--xs')} Edit</button>
        </p>
        ${(m.agenda || []).length ? `<div class="olist">
          ${m.agenda.map((a) => `<div class="olist__item"><div><strong>${esc(a.topic)}</strong>${a.objective ? `<span>${esc(a.objective)}</span>` : ''}</div></div>`).join('')}
        </div>` : `<p class="empty-note">No agenda topics yet — add them so attendees know the objectives.</p>`}

        <p class="subhead">Discussion summary</p>
        <div class="rowcard" style="display:block">
          ${m.summary ? esc(m.summary)
            : '<span style="color:var(--text-mute)">No summary captured yet. Use <strong>Intelligence → Generate summary</strong> or edit the meeting.</span>'}
        </div>

        <p class="subhead">Key decisions
          <button class="btn btn--sm btn--soft" type="button" data-act="add-decision" data-id="${esc(m.id)}">${icon('plus', 'ico--xs')} Add</button>
        </p>
        ${(m.decisions || []).length ? `<div class="stack">
          ${m.decisions.map((d, i) => `
            <article class="rowcard">
              <span class="rowcard__icon">${icon('check', 'ico--sm')}</span>
              <div class="rowcard__body"><p class="rowcard__text" style="margin-top:0">${esc(d)}</p></div>
              <button class="icon-btn icon-btn--sm icon-btn--light is-danger" type="button" title="Remove"
                      data-act="del-decision" data-id="${esc(m.id)}" data-index="${i}">${icon('trash', 'ico--xs')}</button>
            </article>`).join('')}
        </div>` : '<p class="empty-note">No decisions recorded.</p>'}

        ${(m.keyPoints || []).length ? `<p class="subhead">Important points</p>
          <div class="stack">${m.keyPoints.map((k) => `
            <article class="rowcard"><span class="rowcard__icon">${icon('flag', 'ico--sm')}</span>
              <div class="rowcard__body"><p class="rowcard__text" style="margin-top:0">${esc(k)}</p></div></article>`).join('')}</div>` : ''}`;
    },

    people: (m) => {
      const groups = ['Internal', 'Customer', 'External'];
      return `
        <p class="subhead">Participants (${(m.participants || []).length})
          <button class="btn btn--sm btn--soft" type="button" data-act="add-participant" data-id="${esc(m.id)}">${icon('plus', 'ico--xs')} Add</button>
        </p>
        ${groups.map((grp) => {
          const list = (m.participants || []).filter((p) => p.role === grp);
          if (!list.length) return '';
          return `
            <p class="subhead" style="margin-top:18px">${esc(grp)} attendees · ${list.length}</p>
            <div class="stack">
              ${list.map((p, i) => `
                <article class="rowcard">
                  <span class="avatar avatar--sm ${avatarClass(p.name)}">${esc(initialsName(p.name))}</span>
                  <div class="rowcard__body">
                    <p class="rowcard__title">${esc(p.name)}</p>
                    <p class="rowcard__meta">${esc(p.email || '—')} · ${esc(p.role)}</p>
                  </div>
                  <div class="rowcard__side">
                    <span class="pill pill--${p.attended === true ? 'ok' : p.attended === false ? 'danger' : 'mute'}">
                      ${p.attended === true ? 'Attended' : p.attended === false ? 'No-show' : 'Invited'}</span>
                    <div class="rowcard__actions">
                      <button class="icon-btn icon-btn--sm icon-btn--light" type="button" title="Toggle attendance"
                              data-act="toggle-attendance" data-id="${esc(m.id)}" data-name="${esc(p.name)}">${icon('check', 'ico--xs')}</button>
                      <button class="icon-btn icon-btn--sm icon-btn--light is-danger" type="button" title="Remove"
                              data-act="del-participant" data-id="${esc(m.id)}" data-name="${esc(p.name)}">${icon('trash', 'ico--xs')}</button>
                    </div>
                  </div>
                </article>`).join('')}
            </div>`;
        }).join('') || '<p class="empty-note">Nobody has been invited yet.</p>'}`;
    },

    notes: (m) => {
      const actions = recordsForMeeting('tasks', m.id);
      const notes = recordsForMeeting('notes', m.id);
      const follow = recordsForMeeting('followups', m.id);
      return `
        <p class="subhead">Action items (${actions.length})
          <button class="btn btn--sm btn--soft" type="button" data-act="new-linked" data-key="tasks" data-id="${esc(m.id)}">${icon('plus', 'ico--xs')} Add</button>
        </p>
        <div class="stack">
          ${actions.length ? actions.map((t) => recordRow('tasks', t)).join('')
            : '<p class="empty-note">No action items. Use Intelligence → Extract action items to generate them from the summary.</p>'}
        </div>

        <p class="subhead">Meeting notes (${notes.length})
          <button class="btn btn--sm btn--soft" type="button" data-act="new-linked" data-key="notes" data-id="${esc(m.id)}">${icon('plus', 'ico--xs')} Add</button>
        </p>
        <div class="stack">
          ${notes.length ? notes.map((n) => recordRow('notes', n)).join('') : '<p class="empty-note">No notes captured for this meeting.</p>'}
        </div>

        <p class="subhead">Follow-ups (${follow.length})
          <button class="btn btn--sm btn--soft" type="button" data-act="new-linked" data-key="followups" data-id="${esc(m.id)}">${icon('plus', 'ico--xs')} Add</button>
        </p>
        <div class="stack">
          ${follow.length ? follow.map((f) => recordRow('followups', f)).join('') : '<p class="empty-note">No follow-up scheduled.</p>'}
        </div>`;
    },

    files: (m) => {
      const files = recordsForMeeting('documents', m.id);
      const recs = recordsForMeeting('recordings', m.id);
      return `
        <p class="subhead">Recordings (${recs.length})
          <button class="btn btn--sm btn--soft" type="button" data-act="new-linked" data-key="recordings" data-id="${esc(m.id)}">${icon('upload', 'ico--xs')} Upload</button>
        </p>
        <div class="stack">
          ${recs.length ? recs.map((r) => recordRow('recordings', r)).join('') : '<p class="empty-note">No recording attached to this meeting.</p>'}
        </div>

        <p class="subhead">Documents &amp; presentations (${files.length})
          <button class="btn btn--sm btn--soft" type="button" data-act="new-linked" data-key="documents" data-id="${esc(m.id)}">${icon('upload', 'ico--xs')} Attach</button>
        </p>
        <div class="stack">
          ${files.length ? files.map((f) => recordRow('documents', f)).join('') : '<p class="empty-note">No files attached.</p>'}
        </div>`;
    },

    intel: (m) => {
      const suggestion = Intel.suggestion(m);
      const candidates = Intel.extractActions([m.summary, ...recordsForMeeting('notes', m.id).map((n) => n.body)].join(' '));
      return `
        <div class="ai">
          <div class="ai__head">
            <p class="ai__title">${icon('sparkle')} Meeting intelligence</p>
            <span class="ai__badge">${esc(m.sentiment || 'Not rated')}${m.satisfaction != null ? ` · ${m.satisfaction}%` : ''}</span>
          </div>
          <div class="ai__list">
            <div class="ai__item" style="cursor:default">
              ${icon('note', 'ico--sm')}
              <span class="ai__text">${esc(Intel.summarise(m))}<span class="ai__meta">Generated from the agenda, summary, decisions and attendance on this record</span></span>
            </div>
            <div class="ai__item" style="cursor:default">
              ${icon('target', 'ico--sm')}
              <span class="ai__text">${esc(suggestion.text)}<span class="ai__meta">Recommended next action</span></span>
            </div>
          </div>
          <div class="ai__foot">
            <button class="btn btn--ghost btn--sm" type="button" data-act="apply-summary" data-id="${esc(m.id)}">${icon('sparkle', 'ico--xs')} Save summary to meeting</button>
            <button class="btn btn--ghost btn--sm" type="button" data-act="extract-actions" data-id="${esc(m.id)}">${icon('task', 'ico--xs')} Extract action items</button>
            <button class="btn btn--ghost btn--sm" type="button" data-act="set-sentiment" data-id="${esc(m.id)}">${icon('pulse', 'ico--xs')} Rate sentiment</button>
            ${suggestion.act === 'followup' ? `<button class="btn btn--ghost btn--sm" type="button" data-act="new-linked" data-key="followups" data-id="${esc(m.id)}">${icon('repeat', 'ico--xs')} Create follow-up</button>` : ''}
          </div>
        </div>

        <p class="subhead">Key decisions extracted</p>
        <div class="stack">
          ${(m.decisions || []).length ? m.decisions.map((d) => `
            <article class="rowcard"><span class="rowcard__icon">${icon('check', 'ico--sm')}</span>
              <div class="rowcard__body"><p class="rowcard__text" style="margin-top:0">${esc(d)}</p></div></article>`).join('')
            : '<p class="empty-note">No decisions recorded on this meeting yet.</p>'}
        </div>

        <p class="subhead">Suggested action items (${candidates.length})</p>
        <div class="stack">
          ${candidates.length ? candidates.map((t) => `
            <article class="rowcard">
              <span class="rowcard__icon">${icon('sparkle', 'ico--sm')}</span>
              <div class="rowcard__body"><p class="rowcard__text" style="margin-top:0">${esc(t)}</p></div>
              <div class="rowcard__side">
                <button class="btn btn--sm btn--soft" type="button" data-act="accept-action" data-id="${esc(m.id)}" data-text="${esc(t)}">Create task</button>
              </div>
            </article>`).join('')
            : '<p class="empty-note">No action-shaped sentences found in the summary or notes.</p>'}
        </div>

        <p class="subhead">Sentiment analysis</p>
        <div class="kpis">
          ${kpiCard({ label: 'Customer mood', value: m.sentiment || 'Not rated', note: 'Recorded after the session', iconName: 'pulse' })}
          ${kpiCard({ label: 'Satisfaction', value: m.satisfaction != null ? m.satisfaction + '%' : '—', note: 'Post-meeting score', iconName: 'sparkle' })}
          ${kpiCard({ label: 'Attendance', value: `${(m.participants || []).filter((p) => p.attended).length}/${(m.participants || []).length}`, note: 'Joined vs invited', iconName: 'users' })}
        </div>`;
    },

    timeline: (m) => `
      <p class="subhead">Meeting history</p>
      <div class="timeline">
        ${(m.timeline || []).slice().sort((a, b) => a.ts - b.ts).map((t) => `
          <article class="tl-item">
            <p class="tl-item__time">${esc(relTime(t.ts))}</p>
            <p class="tl-item__title">${esc(t.label)}</p>
          </article>`).join('') || '<p class="empty-note">No history recorded.</p>'}
      </div>
      <p class="subhead">Linked records</p>
      <div class="kpis">
        ${kpiCard({ label: 'Action items', value: String(recordsForMeeting('tasks', m.id).length), note: 'Tasks from this meeting', iconName: 'task' })}
        ${kpiCard({ label: 'Notes', value: String(recordsForMeeting('notes', m.id).length), note: 'Captured discussion', iconName: 'note' })}
        ${kpiCard({ label: 'Follow-ups', value: String(recordsForMeeting('followups', m.id).length), note: 'Commitments made', iconName: 'repeat' })}
        ${kpiCard({ label: 'Files', value: String(recordsForMeeting('documents', m.id).length + recordsForMeeting('recordings', m.id).length), note: 'Attachments & recordings', iconName: 'doc' })}
      </div>`
  };

  const field = (label, value, opts = {}) => {
    const empty = value === undefined || value === null || String(value).trim() === '';
    return `
      <div class="field ${opts.full ? 'field--full' : ''}">
        <span class="field__label">${esc(label)}</span>
        <span class="field__value ${empty ? 'field__value--empty' : ''}">${empty ? '—' : (opts.raw ? value : esc(value))}</span>
      </div>`;
  };

  /* -------------------------- CONTACTS LIST ---------------------------- */
  function contactCard(c) {
    const p = contactMeetingProfile(c);
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
          <li>${icon('video', 'ico--sm')}<span>${p.total} meetings · last ${p.last ? esc(fmtDate(p.last.date)) : '—'}</span></li>
          <li>${icon('calendar', 'ico--sm')}<span>Next: ${p.next ? esc(fmtDate(p.next.date)) + ' · ' + esc(fmtTime(p.next.time)) : 'not scheduled'}</span></li>
        </ul>
        <div class="profile__tags" style="justify-content:flex-start;margin-top:12px">
          ${(c.tags || []).slice(0, 2).map((t) => `<span class="pill pill--info">${esc(t)}</span>`).join('')}
          ${p.openFollowUps ? `<span class="pill pill--warn">${p.openFollowUps} follow-up${p.openFollowUps === 1 ? '' : 's'}</span>` : '<span class="pill pill--ok">No open follow-ups</span>'}
        </div>
        <div class="ccard__foot">
          <button class="btn btn--sm btn--primary" type="button" data-act="open-contact" data-id="${esc(c.id)}">${icon('eye', 'ico--xs')} View</button>
          <button class="btn btn--sm btn--ghost" type="button" data-act="schedule-for" data-id="${esc(c.id)}">${icon('video', 'ico--xs')} Meet</button>
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
        crumbs: [{ label: 'Dashboard', route: 'dashboard' }, { label: 'Contacts' }],
        title: 'Contacts',
        sub: 'Everyone you meet with, and their complete meeting history.',
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

  /* ------------------------- CONTACT 360 ------------------------------- */
  VIEWS.contact = function () {
    const c = activeContact();
    if (!c) {
      return emptyState({
        iconName: 'user', title: 'No contact selected',
        text: 'This workspace has no contacts yet. Create one to get started.',
        cta: `<button class="btn btn--primary" type="button" data-act="new-contact">${icon('plus', 'ico--sm')} Create a contact</button>`
      });
    }

    const p = contactMeetingProfile(c);
    const statCards = [
      { label: 'Total Meetings', icon: 'video', value: String(p.total), note: `${p.completed} completed · ${num(p.hours)} hours`, delta: 'Lifetime', grad: 'var(--grad-1)', glow: 'rgba(99,102,241,.35)' },
      { label: 'Last Meeting', icon: 'clock', value: p.last ? fmtShort(p.last.date) : '—', note: p.last ? p.last.title : 'No meetings held yet', delta: p.last ? p.last.status : '—', grad: 'var(--grad-2)', glow: 'rgba(59,130,246,.35)' },
      { label: 'Next Meeting', icon: 'calendar', value: p.next ? fmtShort(p.next.date) : '—', note: p.next ? `${p.next.title} · ${fmtTime(p.next.time)}` : 'Nothing scheduled', delta: p.next ? p.next.status : 'None', grad: 'var(--grad-3)', glow: 'rgba(16,185,129,.32)' },
      { label: 'Meeting Frequency', icon: 'repeat', value: p.frequency ? `${p.frequency}d` : '—', note: p.frequency ? `A meeting roughly every ${p.frequency} days` : 'Not enough history', delta: `${p.avgDuration} min avg`, grad: 'var(--grad-4)', glow: 'rgba(249,115,22,.32)' },
      { label: 'Follow-up Status', icon: 'flag', value: p.openFollowUps ? `${p.openFollowUps} open` : 'Clear', note: p.openFollowUps ? 'Commitments awaiting closure' : 'Every commitment closed', delta: `${p.notes} notes`, grad: 'var(--grad-5)', glow: 'rgba(236,72,153,.32)' }
    ];

    return `
      ${pageHead({
        crumbs: [{ label: 'Dashboard', route: 'dashboard' }, { label: 'Contacts', route: 'contacts' }, { label: fullName(c) }],
        title: 'Contact 360',
        sub: 'Meeting history, interactions and commitments for this customer.',
        actions: `
          <button class="btn btn--ghost" type="button" data-act="new-record" data-key="emails">${icon('mail')}<span class="btn__label">Email</span></button>
          <button class="btn btn--ghost" type="button" data-act="new-record" data-key="calls">${icon('phone')}<span class="btn__label">Call</span></button>
          <button class="btn btn--primary" type="button" data-act="schedule-for" data-id="${esc(c.id)}">${icon('video')}<span class="btn__label">Schedule Meeting</span></button>`
      })}

      <section class="layout" aria-label="Contact summary and modules">
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
              ${c.mobile || c.officePhone ? `<a href="${esc(telHref(c.mobile || c.officePhone))}">${esc(c.mobile || c.officePhone)}</a>` : '<span>No phone number</span>'}</li>
            <li><span class="profile__ico">${icon('mail', 'ico--sm')}</span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>
            <li><span class="profile__ico">${icon('pin', 'ico--sm')}</span><span>${esc(contactAddress(c) || 'No address on file')}</span></li>
            <li><span class="profile__ico">${icon('clock', 'ico--sm')}</span><span>Prefers ${esc(c.preferredSlot || 'no stated slot')}</span></li>
          </ul>

          <div class="profile__tags">
            ${(c.tags || []).map((t) => `<span class="pill pill--info">${esc(t)}</span>`).join('') || '<span class="pill pill--mute">No tags</span>'}
          </div>

          <div class="profile__score">
            <div class="profile__score-head"><span>Engagement score</span><strong>${Number(c.engagement) || 0}%</strong></div>
            <div class="meter"><span class="meter__fill" style="width:${Number(c.engagement) || 0}%"></span></div>
            <p class="profile__score-note">${esc(c.lifecycle || 'Lifecycle not set')} · satisfaction ${p.satisfaction || '—'}%</p>
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
              <h2 class="section-title">Interaction modules</h2>
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

          <div class="card pad" style="margin-top:var(--gap)">
            <div class="section-head">
              <div>
                <h2 class="section-title">Meeting summary</h2>
                <p class="section-note">Live roll-up for ${esc(fullName(c))}</p>
              </div>
              <button class="btn btn--sm btn--soft" type="button" data-act="schedule-for" data-id="${esc(c.id)}">${icon('plus', 'ico--xs')} Schedule</button>
            </div>
            <div class="mini-kpis">
              <div class="mini" style="--acc:#6366f1">
                <p class="mini__label">${icon('video', 'ico--xs')} Total meetings</p>
                <p class="mini__value">${p.total}</p>
                <p class="mini__note">${p.completed} completed · ${num(p.hours)}h</p>
              </div>
              <div class="mini" style="--acc:#06b6d4">
                <p class="mini__label">${icon('clock', 'ico--xs')} Last meeting</p>
                <p class="mini__value">${p.last ? esc(fmtDate(p.last.date)) : '—'}</p>
                <p class="mini__note">${p.last ? esc(String(p.last.title).slice(0, 32)) : 'None held yet'}</p>
              </div>
              <div class="mini" style="--acc:#10b981">
                <p class="mini__label">${icon('calendar', 'ico--xs')} Next meeting</p>
                <p class="mini__value">${p.next ? esc(fmtDate(p.next.date)) : '—'}</p>
                <p class="mini__note">${p.next ? esc(fmtTime(p.next.time)) + ' · ' + esc(p.next.type) : 'Not scheduled'}</p>
              </div>
              <div class="mini" style="--acc:#8b5cf6">
                <p class="mini__label">${icon('repeat', 'ico--xs')} Follow-ups</p>
                <p class="mini__value">${p.openFollowUps ? p.openFollowUps + ' open' : 'Clear'}</p>
                <p class="mini__note">${recordsFor('followups', c.id).length} in total</p>
              </div>
              <div class="mini" style="--acc:#a855f7">
                <p class="mini__label">${icon('note', 'ico--xs')} Notes</p>
                <p class="mini__value">${p.notes}</p>
                <p class="mini__note">Captured from meetings</p>
              </div>
              <div class="mini" style="--acc:#f43f5e">
                <p class="mini__label">${icon('mic', 'ico--xs')} Recordings</p>
                <p class="mini__value">${recordsFor('recordings', c.id).length}</p>
                <p class="mini__note">${recordsFor('documents', c.id).length} attachments</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <div>
            <h2 class="section-title">Contact meeting history</h2>
            <p class="section-note">Calculated live from this customer's meetings.</p>
          </div>
          <button class="btn btn--sm btn--ghost" type="button" data-act="schedule-for" data-id="${esc(c.id)}">${icon('plus', 'ico--xs')} Schedule meeting</button>
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
                  <span class="stat__note">${esc(String(s.note).slice(0, 46))}</span>
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
              ${[['overview', 'Overview'], ['history', 'Meeting History'], ['engagement', 'Engagement'], ['more', 'More Information']]
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
                <button class="dropdown__item" role="menuitem" type="button" data-act="schedule-for" data-id="${esc(c.id)}">${icon('video')} Schedule Meeting</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="edit-contact" data-id="${esc(c.id)}">${icon('edit')} Edit Contact</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="new-record" data-key="tasks">${icon('task')} Create Task</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="new-record" data-key="notes">${icon('note')} Add Note</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="new-record" data-key="followups">${icon('repeat')} Add Follow-up</button>
                <button class="dropdown__item" role="menuitem" type="button" data-act="new-record" data-key="emails">${icon('mail')} Send Email</button>
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
        ${field('Preferred meeting slot', c.preferredSlot)}
        ${field('Email Address', `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a> <small>Primary</small>`, { raw: true, full: true })}
      </div>
      <p class="subhead">Address information</p>
      <div class="fields">
        ${field('Primary Address', contactAddress(c, '<br>'), { raw: !!contactAddress(c) })}
        ${field('Other Address', otherAddress(c, '<br>'), { raw: !!otherAddress(c) })}
        ${field('Description', c.description, { full: true })}
      </div>`,

    history: (c) => {
      const p = contactMeetingProfile(c);
      const past = p.list.filter(isPast).slice().sort(byDateDesc);
      const ahead = p.list.filter(isFuture).slice().sort(byDateAsc);
      return `
        <p class="subhead">Meeting summary</p>
        <div class="kpis">
          ${kpiCard({ label: 'Total meetings', value: String(p.total), note: `${p.completed} completed`, iconName: 'video' })}
          ${kpiCard({ label: 'Last meeting', value: p.last ? fmtDate(p.last.date) : '—', note: p.last ? p.last.title : 'None yet', iconName: 'clock' })}
          ${kpiCard({ label: 'Next meeting', value: p.next ? fmtDate(p.next.date) : '—', note: p.next ? `${fmtTime(p.next.time)} · ${p.next.type}` : 'Not scheduled', iconName: 'calendar' })}
          ${kpiCard({ label: 'Frequency', value: p.frequency ? `Every ${p.frequency}d` : '—', note: `${p.avgDuration} min average`, iconName: 'repeat' })}
          ${kpiCard({ label: 'Follow-ups', value: p.openFollowUps ? `${p.openFollowUps} open` : 'Clear', note: 'Commitments outstanding', iconName: 'flag' })}
        </div>

        <p class="subhead">Upcoming (${ahead.length})</p>
        <div class="stack">
          ${ahead.length ? ahead.map((m) => meetingRow(m, { showType: true })).join('')
            : `<p class="empty-note">Nothing scheduled — <button class="link-btn" type="button" data-act="schedule-for" data-id="${esc(c.id)}">book a meeting</button>.</p>`}
        </div>

        <p class="subhead">Past meetings (${past.length})</p>
        <div class="stack">
          ${past.length ? past.slice(0, 12).map((m) => meetingRow(m, { showType: true })).join('')
            : '<p class="empty-note">No meetings held with this customer yet.</p>'}
        </div>
        ${past.length > 12 ? `<p class="section-note" style="margin-top:10px">Showing the 12 most recent of ${past.length} meetings.</p>` : ''}`;
    },

    engagement: (c) => {
      const p = contactMeetingProfile(c);
      const done = p.list.filter(isDone);
      const byType = {};
      done.forEach((m) => { byType[m.type] = (byType[m.type] || 0) + 1; });
      const sentiments = ['Positive', 'Neutral', 'Negative'].map((s) => ({ s, n: done.filter((m) => m.sentiment === s).length }));
      const notes = recordsFor('notes', c.id).slice().sort(byDateDesc);

      return `
        <p class="subhead">Engagement snapshot</p>
        <div class="kpis">
          ${kpiCard({ label: 'Meeting hours', value: String(p.hours), note: 'Time invested with this customer', iconName: 'clock' })}
          ${kpiCard({ label: 'Satisfaction', value: p.satisfaction ? p.satisfaction + '%' : '—', note: 'Average post-meeting score', iconName: 'sparkle' })}
          ${kpiCard({ label: 'Engagement score', value: (Number(c.engagement) || 0) + '%', note: c.lifecycle, iconName: 'pulse' })}
          ${kpiCard({ label: 'Action items', value: String(recordsFor('tasks', c.id).filter((t) => t.status !== 'Completed').length), note: 'Still open', iconName: 'task' })}
        </div>

        <p class="subhead">Meetings by type</p>
        <div class="stack">
          ${Object.keys(byType).length ? Object.keys(byType).sort((a, b) => byType[b] - byType[a]).map((t) => `
            <div class="switch-row">
              <div>
                <p class="switch-row__text">${esc(t)}</p>
                <div class="meter" style="margin-top:8px;width:min(320px,60vw)"><span class="meter__fill" style="width:${pct(byType[t], done.length)}%"></span></div>
              </div>
              <strong>${byType[t]}</strong>
            </div>`).join('') : '<p class="empty-note">No completed meetings to analyse.</p>'}
        </div>

        <p class="subhead">Sentiment mix</p>
        <div class="kpis">
          ${sentiments.map((x) => kpiCard({ label: x.s, value: String(x.n), note: `${pct(x.n, done.length)}% of held meetings`, iconName: x.s === 'Positive' ? 'check' : x.s === 'Negative' ? 'alert' : 'info' })).join('')}
        </div>

        <p class="subhead">Recent notes</p>
        <div class="stack">
          ${notes.length ? notes.slice(0, 5).map((n) => recordRow('notes', n, { showMeeting: true })).join('')
            : '<p class="empty-note">No notes captured for this customer.</p>'}
        </div>`;
    },

    more: (c) => `
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
          <div><p class="switch-row__text">Do not call</p><p class="switch-row__note">Suppress this contact from outbound dialling.</p></div>
          <button class="switch" type="button" role="switch" aria-checked="${!!c.doNotCall}" aria-label="Do not call"
                  data-act="switch" data-key="doNotCall" data-label="Do not call"></button>
        </div>
        <div class="switch-row">
          <div><p class="switch-row__text">Email opt-out</p><p class="switch-row__note">Exclude from meeting invitations sent in bulk.</p></div>
          <button class="switch" type="button" role="switch" aria-checked="${!!c.emailOptOut}" aria-label="Email opt-out"
                  data-act="switch" data-key="emailOptOut" data-label="Email opt-out"></button>
        </div>
      </div>

      <p class="subhead">Attachments &amp; recordings</p>
      <div class="stack">
        ${recordsFor('documents', c.id).concat(recordsFor('recordings', c.id)).length
          ? recordsFor('documents', c.id).map((d) => recordRow('documents', d, { showMeeting: true })).join('') +
            recordsFor('recordings', c.id).map((r) => recordRow('recordings', r, { showMeeting: true })).join('')
          : '<p class="empty-note">No files linked to this customer.</p>'}
      </div>

      <p class="subhead">System information</p>
      <div class="fields">
        ${field('Record ID', c.id.toUpperCase())}
        ${field('Contact Owner', c.owner)}
        ${field('Created On', fmtDate(c.createdAt))}
        ${field('Last Modified', fmtDate(c.updatedAt))}
      </div>`
  };

  /* ---------------------------- CALENDAR ------------------------------- */
  VIEWS.calendar = function () {
    const view = state.calView;
    const cursor = state.calCursor;
    const today = todayISO();

    const heading = view === 'month'
      ? new Date(cursor + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `Week of ${fmtDate(weekStart(cursor))}`
        : fmtDay(cursor);

    return `
      ${pageHead({
        crumbs: [{ label: 'Dashboard', route: 'dashboard' }, { label: 'Calendar' }],
        title: 'Meeting calendar',
        sub: 'Day, week and month views over every scheduled session.',
        actions: `<button class="btn btn--primary" type="button" data-act="schedule-meeting">${icon('plus')}<span class="btn__label">Schedule Meeting</span></button>`
      })}

      <div class="toolbar">
        <button class="icon-btn icon-btn--light" type="button" data-act="cal-move" data-value="-1" aria-label="Previous">${icon('arrow-left', 'ico--sm')}</button>
        <button class="btn btn--sm btn--ghost" type="button" data-act="cal-today">Today</button>
        <button class="icon-btn icon-btn--light" type="button" data-act="cal-move" data-value="1" aria-label="Next">${icon('chevron-right', 'ico--sm')}</button>
        <strong style="font-size:14px;margin-left:6px">${esc(heading)}</strong>
        <div style="margin-left:auto">
          ${chipRow('calView', [{ label: 'Day', value: 'day' }, { label: 'Week', value: 'week' }, { label: 'Month', value: 'month' }], view)}
        </div>
      </div>

      ${view === 'month' ? calendarMonth(cursor, today) : view === 'week' ? calendarWeek(cursor, today) : calendarDay(cursor)}

      <section class="section">
        <div class="section-head"><h2 class="section-title">Upcoming reminders</h2></div>
        <div class="stack">
          ${upcomingMeetings().slice(0, 5).map((m) => `
            <div class="switch-row">
              <div>
                <p class="switch-row__text">${esc(m.title)}</p>
                <p class="switch-row__note">${esc(fmtDay(m.date))} · ${esc(fmtTime(m.time))} · reminder ${m.reminder || DB.settings.reminderLead} min before</p>
              </div>
              <div style="display:flex;gap:6px">
                <button class="btn btn--sm btn--ghost" type="button" data-act="set-reminder" data-id="${esc(m.id)}">${icon('clock', 'ico--xs')} Reminder</button>
                <button class="btn btn--sm btn--soft" type="button" data-act="open-meeting" data-id="${esc(m.id)}">Open</button>
              </div>
            </div>`).join('') || '<p class="empty-note">No upcoming meetings to remind you about.</p>'}
        </div>
      </section>`;
  };

  function calendarMonth(cursor, today) {
    const first = cursor.slice(0, 8) + '01';
    const start = weekStart(first);
    const cells = [];
    for (let i = 0; i < 42; i++) cells.push(addDays(start, i));
    const month = cursor.slice(0, 7);

    return `
      <div class="cal">
        <div class="cal__grid">
          ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal__dow">${d}</div>`).join('')}
          ${cells.map((day) => {
            const list = meetingsOn(day);
            const out = monthKey(day) !== month;
            return `
              <button class="cal__cell ${out ? 'cal__cell--out' : ''} ${day === today ? 'cal__cell--today' : ''}"
                      type="button" data-act="cal-day" data-value="${day}" aria-label="${esc(fmtDate(day))} — ${list.length} meetings">
                <span class="cal__num">${Number(day.slice(-2))}</span>
                ${list.slice(0, 3).map((m) => `
                  <span class="cal__event" style="--acc:${PIPELINE_ACCENT[m.status] || '#6366f1'};--acc-soft:${(PIPELINE_ACCENT[m.status] || '#6366f1')}22">
                    ${esc(fmtTime(m.time))} ${esc(m.title)}</span>`).join('')}
                ${list.length > 3 ? `<span class="cal__more">+${list.length - 3} more</span>` : ''}
              </button>`;
          }).join('')}
        </div>
      </div>`;
  }

  function calendarWeek(cursor, today) {
    const start = weekStart(cursor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return `
      <div class="cal">
        <div class="cal__grid">
          ${days.map((d) => `<div class="cal__dow">${new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit' })}</div>`).join('')}
          ${days.map((day) => {
            const list = meetingsOn(day);
            return `
              <button class="cal__cell ${day === today ? 'cal__cell--today' : ''}" type="button" data-act="cal-day" data-value="${day}"
                      style="min-height:220px">
                <span class="cal__num">${list.length} meeting${list.length === 1 ? '' : 's'}</span>
                ${list.map((m) => `
                  <span class="cal__event" style="--acc:${PIPELINE_ACCENT[m.status] || '#6366f1'};--acc-soft:${(PIPELINE_ACCENT[m.status] || '#6366f1')}22">
                    ${esc(fmtTime(m.time))} ${esc(m.title)}</span>`).join('')}
              </button>`;
          }).join('')}
        </div>
      </div>`;
  }

  function calendarDay(cursor) {
    const list = meetingsOn(cursor);
    const startH = parseInt(DB.settings.workStart, 10) || 9;
    const endH = parseInt(DB.settings.workEnd, 10) || 18;
    const hours = [];
    for (let h = startH; h <= endH; h++) hours.push(h);

    return `
      <div class="card pad">
        <div class="section-head" style="margin-bottom:10px">
          <div>
            <h2 class="section-title">${esc(fmtDay(cursor))}</h2>
            <p class="section-note">${list.length} meeting${list.length === 1 ? '' : 's'} · working hours ${esc(DB.settings.workStart)}–${esc(DB.settings.workEnd)}</p>
          </div>
          <button class="btn btn--sm btn--primary" type="button" data-act="schedule-on" data-value="${esc(cursor)}">${icon('plus', 'ico--xs')} Add at this date</button>
        </div>
        <div class="cal__day">
          ${hours.map((h) => {
            const slot = list.filter((m) => parseInt(m.time, 10) === h);
            return `
              <div class="cal__slot">
                <span class="cal__time">${String(h).padStart(2, '0')}:00</span>
                <div class="cal__slot-body">
                  ${slot.length ? slot.map((m) => meetingRow(m, { showType: true })).join('')
                    : `<button class="link-btn" type="button" data-act="schedule-at" data-value="${esc(cursor)}" data-time="${String(h).padStart(2, '0')}:00" style="text-align:left">+ Schedule at ${String(h).padStart(2, '0')}:00</button>`}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  /* ------------------------- TASKS & NOTES ----------------------------- */
  VIEWS.tasks = function () {
    const q = state.filters.tasks || '';
    const status = state.filters.tStatus || 'open';
    const owner = state.filters.tOwner || 'all';
    const all = allRecords('tasks');
    let list = all.slice();
    if (status === 'open') list = list.filter((t) => t.status !== 'Completed');
    else if (status !== 'all') list = list.filter((t) => t.status === status);
    if (owner !== 'all') list = list.filter((t) => t.owner === owner);
    list = list.filter((t) => matches(q, t.title, t.owner, fullName(contactById(t.contactId))));
    list.sort((a, b) => String(a.due).localeCompare(String(b.due)));

    const overdue = all.filter((t) => t.status !== 'Completed' && t.due < todayISO());

    return `
      ${pageHead({
        crumbs: [{ label: 'Dashboard', route: 'dashboard' }, { label: 'Tasks' }],
        title: 'Action items',
        sub: 'Every commitment captured from a meeting, with its owner and due date.',
        actions: `<button class="btn btn--primary" type="button" data-act="new-record" data-key="tasks">${icon('plus')}<span class="btn__label">New action item</span></button>`
      })}

      <div class="kpis">
        ${kpiCard({ act: 'ai:open', label: 'Open', value: String(all.filter((t) => t.status !== 'Completed').length), note: 'Awaiting completion', iconName: 'task', acc: '#0ea5e9' })}
        ${kpiCard({ act: 'ai:overdue', label: 'Overdue', value: String(overdue.length), note: 'Past their due date', iconName: 'alert', acc: '#f59e0b' })}
        ${kpiCard({ act: 'ai:completed', label: 'Completed', value: String(all.filter((t) => t.status === 'Completed').length), note: 'Closed out', iconName: 'check', acc: '#10b981' })}
        ${kpiCard({ act: 'ai:rate', label: 'Completion rate', value: pct(all.filter((t) => t.status === 'Completed').length, all.length) + '%', note: `${all.length} in total`, iconName: 'pulse', acc: '#8b5cf6' })}
      </div>

      <div class="section">
        ${searchToolbar({
          key: 'tasks', placeholder: 'Search action items…', count: list.length, total: all.length,
          extra: selectFilter('tOwner', 'Owner', [{ value: 'all', label: 'Everyone' }].concat(teamOptions()), owner)
        })}
        <div style="margin:-6px 0 18px">
          ${chipRow('tStatus', [
            { label: 'Open', value: 'open' }, { label: 'All', value: 'all' },
            { label: 'In progress', value: 'In progress' }, { label: 'Completed', value: 'Completed' }
          ], status)}
        </div>
        ${list.length
          ? `<div class="stack">${list.map((t) => recordRow('tasks', t, { showContact: true, showMeeting: true })).join('')}</div>`
          : emptyState({ iconName: 'task', title: 'No action items found', text: 'Nothing matches the current filters.', cta: `<button class="btn btn--primary" type="button" data-act="new-record" data-key="tasks">${icon('plus', 'ico--xs')} New action item</button>` })}
      </div>`;
  };

  VIEWS.notes = function () {
    const q = state.filters.notes || '';
    const author = state.filters.nAuthor || 'all';
    const all = allRecords('notes');
    let list = all.slice();
    if (author !== 'all') list = list.filter((n) => n.author === author);
    list = list.filter((n) => matches(q, n.body, n.author, fullName(contactById(n.contactId))));
    list.sort(byDateDesc);

    return `
      ${pageHead({
        crumbs: [{ label: 'Dashboard', route: 'dashboard' }, { label: 'Notes' }],
        title: 'Meeting notes',
        sub: 'Discussion summaries and important points captured across every session.',
        actions: `<button class="btn btn--primary" type="button" data-act="new-record" data-key="notes">${icon('plus')}<span class="btn__label">New note</span></button>`
      })}

      ${searchToolbar({
        key: 'notes', placeholder: 'Search notes by text, author or customer…', count: list.length, total: all.length,
        extra: selectFilter('nAuthor', 'Author', [{ value: 'all', label: 'Everyone' }].concat(teamOptions()), author)
      })}

      ${list.length
        ? `<div class="stack">${list.map((n) => recordRow('notes', n, { showContact: true, showMeeting: true })).join('')}</div>`
        : emptyState({ iconName: 'note', title: 'No notes found', text: q ? `Nothing matches “${q}”.` : 'No notes have been captured yet.', cta: `<button class="btn btn--primary" type="button" data-act="new-record" data-key="notes">${icon('plus', 'ico--xs')} New note</button>` })}`;
  };

  /* ---------------------------- REPORTS -------------------------------- */
  function reportFilters() {
    return {
      from: state.filters.rFrom || addDays(todayISO(), -90),
      to: state.filters.rTo || addDays(todayISO(), 30),
      user: state.filters.rUser || 'all',
      customer: state.filters.rCustomer || 'all',
      type: state.filters.rType || 'all'
    };
  }

  function filteredMeetings(f) {
    return meetings().filter((m) =>
      m.date >= f.from && m.date <= f.to &&
      (f.user === 'all' || m.organizer === f.user) &&
      (f.customer === 'all' || m.contactId === f.customer) &&
      (f.type === 'all' || m.type === f.type));
  }

  /** Every report returns the same shape: columns, rows and summary tiles. */
  function buildReport(id, f) {
    const list = filteredMeetings(f);
    const done = list.filter(isDone);

    const attendanceOf = (m) => {
      const ps = m.participants || [];
      const att = ps.filter((p) => p.attended).length;
      return { invited: ps.length, attended: att, rate: pct(att, ps.length) };
    };

    switch (id) {
      case 'employee': {
        const owners = Array.from(new Set(list.map((m) => m.organizer)));
        return {
          title: 'Employee meeting performance',
          columns: ['Organizer', 'Meetings', 'Completed', 'Hours', 'Avg duration', 'Attendance'],
          rows: owners.map((o) => {
            const mine = list.filter((m) => m.organizer === o);
            const md = mine.filter(isDone);
            const att = md.reduce((acc, m) => { const a = attendanceOf(m); acc.i += a.invited; acc.a += a.attended; return acc; }, { i: 0, a: 0 });
            return [o, mine.length, md.length, Math.round(sum(md, (m) => m.duration) / 60) + 'h',
              (md.length ? Math.round(sum(md, (m) => m.duration) / md.length) : 0) + ' min', pct(att.a, att.i) + '%'];
          }).sort((a, b) => b[1] - a[1]),
          summary: [
            { label: 'Team members', value: String(owners.length) },
            { label: 'Meetings', value: String(list.length) },
            { label: 'Hours held', value: Math.round(sum(done, (m) => m.duration) / 60) + 'h' }
          ]
        };
      }
      case 'engagement': {
        return {
          title: 'Customer engagement report',
          columns: ['Customer', 'Meetings', 'Last meeting', 'Next meeting', 'Hours', 'Satisfaction', 'Open follow-ups'],
          rows: DB.contacts.map((c) => {
            const p = contactMeetingProfile(c);
            const mine = list.filter((m) => m.contactId === c.id);
            return [fullName(c), mine.length, p.last ? fmtDate(p.last.date) : '—', p.next ? fmtDate(p.next.date) : '—',
              p.hours + 'h', p.satisfaction ? p.satisfaction + '%' : '—', p.openFollowUps];
          }).sort((a, b) => b[1] - a[1]),
          summary: [
            { label: 'Customers', value: String(DB.contacts.length) },
            { label: 'Meetings in range', value: String(list.length) },
            { label: 'Avg satisfaction', value: (meetingStats(done).satisfaction || 0) + '%' }
          ]
        };
      }
      case 'attendance': {
        return {
          title: 'Attendance report',
          columns: ['Meeting', 'Date', 'Customer', 'Invited', 'Attended', 'Rate'],
          rows: done.slice().sort(byDateDesc).map((m) => {
            const a = attendanceOf(m);
            return [m.title, fmtDate(m.date), fullName(contactById(m.contactId)), a.invited, a.attended, a.rate + '%'];
          }),
          summary: [
            { label: 'Meetings held', value: String(done.length) },
            { label: 'Invitees', value: String(sum(done, (m) => (m.participants || []).length)) },
            { label: 'Attendance rate', value: meetingStats(list).attendanceRate + '%' }
          ]
        };
      }
      case 'duration': {
        const types = Array.from(new Set(list.map((m) => m.type)));
        return {
          title: 'Meeting duration report',
          columns: ['Meeting type', 'Meetings', 'Total hours', 'Average', 'Longest'],
          rows: types.map((t) => {
            const mine = list.filter((m) => m.type === t);
            const longest = mine.reduce((max, m) => Math.max(max, m.duration), 0);
            return [t, mine.length, Math.round(sum(mine, (m) => m.duration) / 60) + 'h',
              (mine.length ? Math.round(sum(mine, (m) => m.duration) / mine.length) : 0) + ' min', longest + ' min'];
          }).sort((a, b) => b[1] - a[1]),
          summary: [
            { label: 'Meeting types', value: String(types.length) },
            { label: 'Total hours', value: Math.round(sum(list, (m) => m.duration) / 60) + 'h' },
            { label: 'Average', value: (list.length ? Math.round(sum(list, (m) => m.duration) / list.length) : 0) + ' min' }
          ]
        };
      }
      case 'followup': {
        const ids = new Set(list.map((m) => m.id));
        const fu = allRecords('followups').filter((x) => !x.meetingId || ids.has(x.meetingId));
        const owners = Array.from(new Set(fu.map((x) => x.owner)));
        return {
          title: 'Follow-up completion report',
          columns: ['Owner', 'Follow-ups', 'Completed', 'Pending', 'Completion rate'],
          rows: owners.map((o) => {
            const mine = fu.filter((x) => x.owner === o);
            const c = mine.filter((x) => x.status === 'Completed').length;
            return [o, mine.length, c, mine.length - c, pct(c, mine.length) + '%'];
          }).sort((a, b) => b[1] - a[1]),
          summary: [
            { label: 'Follow-ups', value: String(fu.length) },
            { label: 'Completed', value: String(fu.filter((x) => x.status === 'Completed').length) },
            { label: 'Completion rate', value: pct(fu.filter((x) => x.status === 'Completed').length, fu.length) + '%' }
          ]
        };
      }
      default: {
        const buckets = Array.from(new Set(list.map((m) => monthKey(m.date)))).sort();
        return {
          title: 'Meeting productivity',
          columns: ['Month', 'Meetings', 'Completed', 'Cancelled', 'Missed', 'Hours', 'Completion'],
          rows: buckets.map((b) => {
            const mine = list.filter((m) => monthKey(m.date) === b);
            const md = mine.filter(isDone);
            const missed = mine.filter((m) => m.status === 'Missed').length;
            return [monthLabel(b), mine.length, md.length, mine.filter((m) => m.status === 'Cancelled').length,
              missed, Math.round(sum(md, (m) => m.duration) / 60) + 'h', pct(md.length, md.length + missed) + '%'];
          }),
          summary: [
            { label: 'Meetings', value: String(list.length) },
            { label: 'Completed', value: String(done.length) },
            { label: 'Hours held', value: Math.round(sum(done, (m) => m.duration) / 60) + 'h' }
          ]
        };
      }
    }
  }

  VIEWS.reports = function () {
    const id = state.filters.report || 'productivity';
    const f = reportFilters();
    const report = buildReport(id, f);

    return `
      ${pageHead({
        crumbs: [{ label: 'Dashboard', route: 'dashboard' }, { label: 'Reports' }],
        title: 'Meeting reports',
        sub: 'Filter by date range, user, customer or meeting type, then export.',
        actions: `<button class="btn btn--primary" type="button" data-act="export-report">${icon('download')}<span class="btn__label">Export CSV</span></button>`
      })}

      <div style="margin-bottom:18px">
        ${chipRow('report', REPORT_TYPES.map((r) => ({ label: r.label, value: r.id })), id)}
      </div>

      <div class="toolbar">
        ${selectFilter('rUser', 'User', [{ value: 'all', label: 'All users' }].concat(teamOptions()), f.user)}
        ${selectFilter('rCustomer', 'Customer', [{ value: 'all', label: 'All customers' }].concat(contactOptions()), f.customer)}
        ${selectFilter('rType', 'Meeting type', [{ value: 'all', label: 'All types' }].concat(MEETING_TYPES), f.type)}
        <label class="form__group" style="gap:4px;min-width:140px">
          <span class="form__label" style="font-size:11px">From</span>
          <input class="input" type="date" data-filter-select="rFrom" value="${esc(f.from)}" />
        </label>
        <label class="form__group" style="gap:4px;min-width:140px">
          <span class="form__label" style="font-size:11px">To</span>
          <input class="input" type="date" data-filter-select="rTo" value="${esc(f.to)}" />
        </label>
        <button class="btn btn--sm btn--ghost" type="button" data-act="reset-report">${icon('refresh', 'ico--xs')} Reset</button>
      </div>

      <div class="kpis">
        ${report.summary.map((s, i) => kpiCard({
          act: 'rp:' + ['meetings', 'completed', 'hours'][i] || 'rp:meetings',
          label: s.label, value: s.value, note: `${fmtDate(f.from)} → ${fmtDate(f.to)}`,
          iconName: 'bars', acc: ['#6366f1', '#10b981', '#8b5cf6'][i] || '#6366f1'
        })).join('')}
      </div>

      <section class="section">
        <div class="section-head">
          <div>
            <h2 class="section-title">${esc(report.title)}</h2>
            <p class="section-note">${report.rows.length} row${report.rows.length === 1 ? '' : 's'} in the selected range</p>
          </div>
        </div>
        ${report.rows.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead><tr>${report.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
              <tbody>
                ${report.rows.map((row) => `<tr>${row.map((cell, i) => `
                  <td data-label="${esc(report.columns[i])}">${i === 0 ? `<strong>${esc(cell)}</strong>` : esc(cell)}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </div>`
          : emptyState({ iconName: 'bars', title: 'No data in this range', text: 'Widen the date range or clear the filters to see results.' })}
      </section>`;
  };

  /* --------------------------- ANALYTICS ------------------------------- */
  VIEWS.analytics = function () {
    const mode = state.filters.trend || 'monthly';
    const series = trendSeries(mode);
    const s = meetingStats();
    const g = growth();
    const all = meetings();

    const byType = {};
    all.forEach((m) => { byType[m.type] = (byType[m.type] || 0) + 1; });
    const byStatus = {};
    all.forEach((m) => { byStatus[m.status] = (byStatus[m.status] || 0) + 1; });
    const byOwner = {};
    all.forEach((m) => { byOwner[m.organizer] = (byOwner[m.organizer] || 0) + 1; });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byDay = new Array(7).fill(0);
    all.forEach((m) => { byDay[new Date(m.date + 'T00:00:00').getDay()]++; });
    const busiestDay = dayNames[byDay.indexOf(Math.max(...byDay))];

    const bar = (label, value, max) => `
      <div class="switch-row">
        <div style="flex:1;min-width:0">
          <p class="switch-row__text">${esc(label)}</p>
          <div class="meter" style="margin-top:8px"><span class="meter__fill" style="width:${pct(value, max)}%"></span></div>
        </div>
        <strong>${value}</strong>
      </div>`;

    return `
      ${pageHead({
        crumbs: [{ label: 'Dashboard', route: 'dashboard' }, { label: 'Analytics' }],
        title: 'Meeting intelligence analytics',
        sub: 'Trends, distribution and quality metrics across the workspace.',
        actions: `<button class="btn btn--primary" type="button" data-act="go" data-route="reports">${icon('bars')}<span class="btn__label">Open reports</span></button>`
      })}

      <div class="kpis">
        ${kpiCard({ act: 'an:meetings', label: 'Meetings', value: num(s.total), note: `${g.change >= 0 ? '+' : ''}${g.change}% in 30 days`, iconName: 'video', acc: '#6366f1' })}
        ${kpiCard({ act: 'an:completion', label: 'Completion rate', value: s.completionRate + '%', note: `${s.completed} completed`, iconName: 'check', acc: '#10b981' })}
        ${kpiCard({ act: 'an:attendance', label: 'Attendance rate', value: s.attendanceRate + '%', note: 'Invitees who joined', iconName: 'users', acc: '#06b6d4' })}
        ${kpiCard({ act: 'an:duration', label: 'Avg duration', value: fmtDuration(s.avgDuration), note: `${num(s.totalHours)} hours total`, iconName: 'clock', acc: '#8b5cf6' })}
        ${kpiCard({ act: 'an:satisfaction', label: 'Satisfaction', value: s.satisfaction + '%', note: 'Post-meeting average', iconName: 'sparkle', acc: '#4f46e5' })}
        ${kpiCard({ act: 'an:busiest', label: 'Busiest day', value: busiestDay, note: `${Math.max(...byDay)} meetings booked`, iconName: 'calendar', acc: '#f59e0b' })}
      </div>

      <section class="section">
        <div class="card pad">
          <div class="section-head" style="margin-bottom:12px">
            <div>
              <h2 class="section-title">Meeting trend</h2>
              <p class="section-note">Daily, weekly and monthly volume</p>
            </div>
            ${chipRow('trend', [
              { label: 'Daily', value: 'daily' }, { label: 'Weekly', value: 'weekly' }, { label: 'Monthly', value: 'monthly' }
            ], mode)}
          </div>
          ${barChart(series)}
        </div>
      </section>

      <section class="section">
        <div class="split">
          <div class="card pad">
            <p class="subhead">Meetings by type</p>
            <div class="stack">
              ${Object.keys(byType).sort((a, b) => byType[b] - byType[a])
                .map((t) => bar(t, byType[t], Math.max(...Object.values(byType)))).join('')}
            </div>
            <p class="subhead">Meetings by status</p>
            <div class="stack">
              ${MEETING_STATUSES.filter((st) => byStatus[st]).map((st) => bar(st, byStatus[st], Math.max(...Object.values(byStatus)))).join('')}
            </div>
          </div>

          <div class="card pad">
            <p class="subhead">Organizer leaderboard</p>
            <div class="stack">
              ${Object.keys(byOwner).sort((a, b) => byOwner[b] - byOwner[a]).map((o, i) => {
                const u = teamByName(o);
                return `
                <article class="rowcard">
                  <span class="avatar avatar--sm ${avatarClass(u ? u.id : o)}">${esc(initialsName(o))}</span>
                  <div class="rowcard__body">
                    <p class="rowcard__title">${esc(o)}</p>
                    <p class="rowcard__meta">${u ? esc(u.role) + ' · ' : ''}${byOwner[o]} meetings organised</p>
                  </div>
                  <div class="rowcard__side">
                    <span class="pill pill--${i === 0 ? 'ok' : 'info'}">#${i + 1}</span>
                    ${u ? `<button class="btn btn--sm btn--soft" type="button" data-act="organizer" data-id="${esc(u.id)}">Profile</button>` : ''}
                  </div>
                </article>`;
              }).join('')}
            </div>
            <p class="subhead">Booking pattern</p>
            <div class="stack">
              ${dayNames.map((d, i) => bar(d, byDay[i], Math.max(...byDay))).join('')}
            </div>
          </div>
        </div>
      </section>`;
  };

  /* ---------------------------- SETTINGS ------------------------------- */
  VIEWS.settings = function () {
    const s = DB.settings;
    const toggle = (key, label, note, checked, scope) => `
      <div class="switch-row">
        <div>
          <p class="switch-row__text">${esc(label)}</p>
          <p class="switch-row__note">${esc(note)}</p>
        </div>
        <button class="switch" type="button" role="switch" aria-checked="${!!checked}" aria-label="${esc(label)}"
                data-act="setting-toggle" data-scope="${esc(scope || '')}" data-key="${esc(key)}" data-label="${esc(label)}"></button>
      </div>`;

    return `
      ${pageHead({
        crumbs: [{ label: 'Dashboard', route: 'dashboard' }, { label: 'Settings' }],
        title: 'Settings',
        sub: 'Meeting defaults, notifications, calendar integrations and permissions.'
      })}

      <div class="split">
        <div>
          <div class="card pad">
            <p class="subhead">Meeting preferences</p>
            <div class="form__grid">
              <div class="form__group">
                <label class="form__label" for="setDuration">Default duration (minutes)</label>
                <input class="input" id="setDuration" type="number" min="5" max="480" value="${esc(s.defaultDuration)}" data-setting-input="defaultDuration" />
              </div>
              <div class="form__group">
                <label class="form__label" for="setType">Default meeting type</label>
                <select class="select" id="setType" data-setting-input="defaultType">
                  ${MEETING_TYPES.map((t) => `<option ${s.defaultType === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
                </select>
              </div>
              <div class="form__group">
                <label class="form__label" for="setLocation">Default location</label>
                <select class="select" id="setLocation" data-setting-input="defaultLocation">
                  ${LOCATIONS.map((t) => `<option ${s.defaultLocation === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
                </select>
              </div>
              <div class="form__group">
                <label class="form__label" for="setLead">Reminder lead time (minutes)</label>
                <input class="input" id="setLead" type="number" min="0" max="1440" value="${esc(s.reminderLead)}" data-setting-input="reminderLead" />
              </div>
              <div class="form__group">
                <label class="form__label" for="setStart">Working hours start</label>
                <input class="input" id="setStart" type="time" value="${esc(s.workStart)}" data-setting-input="workStart" />
              </div>
              <div class="form__group">
                <label class="form__label" for="setEnd">Working hours end</label>
                <input class="input" id="setEnd" type="time" value="${esc(s.workEnd)}" data-setting-input="workEnd" />
              </div>
            </div>
            <div class="stack" style="margin-top:14px">
              ${toggle('autoSummary', 'Suggest summaries automatically', 'Offer a generated recap when a meeting is completed.', s.autoSummary)}
            </div>
          </div>

          <div class="card pad" style="margin-top:var(--gap)">
            <p class="subhead">Notification settings</p>
            <div class="stack">
              ${toggle('reminders', 'Meeting reminders', 'Notify me before a meeting starts.', s.notify.reminders, 'notify')}
              ${toggle('reschedules', 'Reschedules & cancellations', 'Tell me when a meeting moves.', s.notify.reschedules, 'notify')}
              ${toggle('actionItems', 'Action item updates', 'Alert me when items are assigned or overdue.', s.notify.actionItems, 'notify')}
              ${toggle('followUps', 'Follow-up required', 'Flag completed meetings with no follow-up.', s.notify.followUps, 'notify')}
              ${toggle('digest', 'Daily digest', 'A single summary of the day ahead.', s.notify.digest, 'notify')}
            </div>
          </div>

          <div class="card pad" style="margin-top:var(--gap)">
            <p class="subhead">Display</p>
            <div class="stack">
              ${toggle('density', 'Compact density', 'Tighter spacing — fits more on screen.', s.density === 'compact')}
              ${toggle('animations', 'Interface animations', 'Transitions, loading shimmer and card motion.', s.animations !== false)}
            </div>
            <div class="form__group" style="margin-top:14px">
              <label class="form__label" for="setLanding">Landing screen</label>
              <select class="select" id="setLanding" data-setting-input="landing">
                ${NAV_ITEMS.map((n) => `<option value="${n.id}" ${s.landing === n.id ? 'selected' : ''}>${esc(n.label)}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <div>
          <div class="card pad">
            <p class="subhead">Calendar integration</p>
            <div class="stack">
              ${[['google', 'Google Calendar', 'Two-way sync of meetings and reminders'],
                 ['outlook', 'Microsoft Outlook', 'Sync invitations and availability'],
                 ['zoom', 'Zoom', 'Attach join links and recordings automatically'],
                 ['teams', 'Microsoft Teams', 'Create Teams links for video meetings']]
                .map(([key, label, note]) => `
                  <div class="switch-row">
                    <div>
                      <p class="switch-row__text">${esc(label)}</p>
                      <p class="switch-row__note">${esc(note)}</p>
                    </div>
                    <button class="btn btn--sm ${s.integrations[key] ? 'btn--soft' : 'btn--ghost'}" type="button"
                            data-act="toggle-integration" data-key="${key}" data-label="${esc(label)}">
                      ${s.integrations[key] ? icon('check', 'ico--xs') + ' Connected' : 'Connect'}
                    </button>
                  </div>`).join('')}
            </div>
          </div>

          <div class="card pad" style="margin-top:var(--gap)">
            <p class="subhead">User roles &amp; permissions</p>
            <div class="stack">
              ${DB.team.map((u) => `
                <article class="rowcard">
                  <span class="avatar avatar--sm ${avatarClass(u.id)}">${esc(initialsName(u.name))}</span>
                  <div class="rowcard__body">
                    <p class="rowcard__title">${esc(u.name)}</p>
                    <p class="rowcard__meta">${esc(u.role)} · ${esc(u.department)} · ${esc(u.status)}</p>
                    <p class="rowcard__meta">${esc(u.email)} · ${organizerStats(u.id).organised} meetings organised</p>
                  </div>
                  <div class="rowcard__side">
                    <select class="select" style="padding:6px 28px 6px 10px;font-size:12px"
                            data-act-change="permission" data-id="${esc(u.id)}">
                      ${['Admin', 'Manager', 'Member', 'Viewer'].map((p) => `<option ${u.permission === p ? 'selected' : ''}>${p}</option>`).join('')}
                    </select>
                    <button class="btn btn--sm btn--soft" type="button" data-act="organizer" data-id="${esc(u.id)}">Profile</button>
                  </div>
                </article>`).join('')}
            </div>
            <p class="form__hint" style="margin-top:10px">Admins manage settings and permissions · Managers run reports · Members create and edit their own meetings · Viewers read only.</p>
          </div>

          <div class="card pad" style="margin-top:var(--gap)">
            <p class="subhead">Workspace data</p>
            <div class="switch-row">
              <div>
                <p class="switch-row__text">Local storage</p>
                <p class="switch-row__note">${DB.contacts.length} contacts · ${meetings().length} meetings · ${MODULE_ORDER.reduce((n, k) => n + allRecords(k).length, 0)} records saved on this device.</p>
                <p class="switch-row__note">${esc(buildStamp())}</p>
              </div>
              <button class="btn btn--sm btn--ghost" type="button" data-act="reset-data">${icon('refresh', 'ico--xs')} Reset workspace</button>
            </div>
          </div>
        </div>
      </div>`;
  };

  /* ======================================================================
     12. MODULE MODAL + RECORD CRUD
     ====================================================================== */
  function openModuleModal(key, contactId) {
    const mod = MODULES[key];
    const c = contactById(contactId) || activeContact();
    if (!mod || !c) return;

    const list = recordsFor(key, c.id).slice()
      .sort((a, b) => String(recordDate(key, b)).localeCompare(String(recordDate(key, a))));
    const done = mod.doneWhen ? list.filter(mod.doneWhen).length : null;
    const share = done === null || !list.length ? null : pct(done, list.length);

    const stats = done === null
      ? `<div class="mstat"><p class="mstat__label">Total ${esc(mod.label)}</p><p class="mstat__value">${list.length}</p></div>
         <div class="mstat"><p class="mstat__label">Linked to</p><p class="mstat__value" style="font-size:15px">${esc(fullName(c))}</p></div>`
      : `<div class="mstat"><p class="mstat__label">Total</p><p class="mstat__value">${list.length}</p></div>
         <div class="mstat"><p class="mstat__label">${esc(mod.doneLabel)}</p><p class="mstat__value">${done}</p></div>
         <div class="mstat"><p class="mstat__label">Pending</p><p class="mstat__value">${Math.max(list.length - done, 0)}</p></div>`;

    openModal({
      title: mod.label,
      sub: `${list.length} record${list.length === 1 ? '' : 's'} linked to ${fullName(c)}`,
      icon: mod.icon,
      refresh: () => openModuleModal(key, c.id),
      body: `
        <div class="mstats">${stats}</div>
        ${share === null ? '' : `
          <div class="progress-block">
            <div class="progress-block__head"><span>${esc(mod.doneLabel)} rate</span><strong>${share}%</strong></div>
            <div class="meter"><span class="meter__fill" style="width:${share}%;background:linear-gradient(90deg, ${mod.accent}, ${mod.accent}aa)"></span></div>
          </div>`}
        <p class="subhead">${esc(mod.label)}</p>
        ${list.length
          ? `<div class="stack">${list.map((r) => recordRow(key, r, { showMeeting: key !== 'meetings' })).join('')}</div>`
          : emptyState({
              iconName: mod.icon, title: `No ${mod.label.toLowerCase()} yet`,
              text: `Nothing has been logged for ${fullName(c)} in this module.`,
              cta: `<button class="btn btn--primary btn--sm" type="button" data-act="new-record" data-key="${key}">${icon('plus', 'ico--xs')} Add ${esc(mod.singular)}</button>`
            })}`,
      footer: `
        <button class="btn btn--quiet" type="button" data-modal-close>Close</button>
        <button class="btn btn--primary" type="button" data-act="new-record" data-key="${key}">
          ${icon('plus', 'ico--sm')} New ${esc(mod.singular)}</button>`
    });
  }

  function openRecordForm(key, id, returnTo, preset) {
    const mod = MODULES[key];
    const fields = fieldsOf(mod);
    const existing = id ? findRecord(key, id) : null;
    const values = Object.assign(
      existing ? (mod.toForm ? mod.toForm(existing) : clone(existing)) : mod.make(),
      preset || {}
    );

    openModal({
      title: existing ? `Edit ${mod.singular}` : `New ${mod.singular}`,
      sub: existing ? mod.title(existing).slice(0, 60) : 'Everything is saved to this workspace',
      icon: mod.icon,
      body: `<form class="form" id="recordForm" novalidate>
               <div class="form__grid">${buildFields(fields.map((f, i) => i === 0 ? Object.assign({}, f, { autofocus: true }) : f), values)}</div>
             </form>`,
      footer: `
        <button class="btn btn--quiet" type="button" data-modal-dismiss>Cancel</button>
        <button class="btn btn--primary" type="submit" form="recordForm">${icon('check', 'ico--sm')} ${existing ? 'Save changes' : 'Create'}</button>`,
      onMount: (dialog) => {
        bindFileField(dialog);
        $('[data-modal-dismiss]', dialog).addEventListener('click', () => { returnTo ? returnTo() : closeModal(); });

        $('#recordForm', dialog).addEventListener('submit', (e) => {
          e.preventDefault();
          let values2 = readForm(e.currentTarget, fields);
          if (!values2) return;
          if (mod.beforeSave) values2 = mod.beforeSave(values2, existing);

          if (existing) {
            Object.assign(existing, values2);
            if (key === 'meetings') logMeeting(existing, 'Meeting updated');
            showToast(`${mod.singular} updated`, String(mod.title(existing)).slice(0, 60), 'success');
            pushNotification({ title: `${mod.singular} updated`, text: String(mod.title(existing)).slice(0, 60), icon: mod.icon, route: key === 'meetings' ? 'meeting' : 'contact', param: key === 'meetings' ? existing.id : existing.contactId });
          } else {
            const record = Object.assign({ id: uid(key.slice(0, 2)) }, mod.make(), values2);
            if (key === 'meetings') {
              record.participants = record.participants || defaultParticipants(record);
              record.timeline = [{ ts: Date.now(), label: 'Meeting created' }];
              record.decisions = record.decisions || [];
              record.keyPoints = record.keyPoints || [];
              record.reminder = DB.settings.reminderLead;
            }
            DB.records[key].unshift(record);
            showToast(`${mod.singular} created`, String(mod.title(record)).slice(0, 60), 'success');
            pushNotification({ title: `${mod.singular} created`, text: String(mod.title(record)).slice(0, 60), icon: mod.icon, route: key === 'meetings' ? 'meeting' : 'contact', param: key === 'meetings' ? record.id : record.contactId });
            if (key === 'meetings' && !returnTo) { saveData(); closeModal(); go('meeting', record.id); return; }
          }

          touchContact(contactById(values2.contactId || (existing && existing.contactId)));
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
      title: `Delete this ${mod.singular.toLowerCase()}?`,
      sub: String(mod.title(record)).slice(0, 60),
      message: `<strong>${esc(String(mod.title(record)).slice(0, 80))}</strong> will be removed. You can undo this straight after.`,
      confirmLabel: 'Delete', iconName: 'trash', returnTo,
      onConfirm: () => {
        const list = DB.records[key];
        const index = list.findIndex((r) => r.id === id);
        const [removed] = list.splice(index, 1);
        saveData();
        if (key === 'meetings' && state.route === 'meeting' && state.param === id) { closeModal(); go('meetings'); }
        else updateUI();
        showToast(`${mod.singular} deleted`, String(mod.title(removed)).slice(0, 60), 'danger', {
          actionLabel: 'Undo',
          onAction: () => {
            DB.records[key].splice(index, 0, removed);
            saveData(); updateUI(); refreshModal();
            showToast('Restored', String(mod.title(removed)).slice(0, 60), 'success');
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
    if (key === 'meetings') logMeeting(record, `Status changed to ${record.status}`);
    touchContact(contactById(record.contactId));
    saveData();
    updateUI();
    refreshModal();
    showToast(`${mod.singular} updated`, `${String(mod.title(record)).slice(0, 50)} — ${mod.status(record)}`, 'success');
  }

  const touchContact = (c) => { if (c) c.updatedAt = todayISO(); };

  function bumpCard(key) {
    requestAnimationFrame(() => {
      const card = $(`.acard[data-key="${key}"]`);
      if (!card) return;
      card.classList.add('is-bumped');
      card.addEventListener('animationend', () => card.classList.remove('is-bumped'), { once: true });
    });
  }

  /* ======================================================================
     13. MEETING ACTIONS
     ====================================================================== */
  const logMeeting = (m, label) => {
    m.timeline = m.timeline || [];
    m.timeline.push({ ts: Date.now(), label });
  };

  function defaultParticipants(m) {
    const c = contactById(m.contactId);
    const list = [{ name: m.organizer, role: 'Internal', email: m.organizer.toLowerCase().replace(/\s+/g, '.') + '@meeting360.io', attended: null }];
    if (c) list.push({ name: fullName(c), role: 'Customer', email: c.email, attended: null });
    return list;
  }

  const scheduleMeeting = (preset) => openRecordForm('meetings', null, null, preset || {});

  function rescheduleMeeting(id) {
    const m = meetingById(id);
    if (!m) return;
    const fields = [
      { name: 'date', label: 'New date', type: 'date' },
      { name: 'time', label: 'New start time', type: 'time' },
      { name: 'duration', label: 'Duration (minutes)', type: 'number', min: 5, max: 600 },
      { name: 'reason', label: 'Reason (added to the timeline)', full: true }
    ];
    openModal({
      title: 'Reschedule meeting', sub: m.title, icon: 'calendar',
      body: `<form class="form" id="reForm" novalidate><div class="form__grid">
        ${buildFields(fields, { date: m.date, time: m.time, duration: m.duration, reason: '' })}
      </div></form>`,
      footer: `<button class="btn btn--quiet" type="button" data-modal-close>Cancel</button>
               <button class="btn btn--primary" type="submit" form="reForm">${icon('check', 'ico--sm')} Reschedule</button>`,
      onMount: (dialog) => {
        $('#reForm', dialog).addEventListener('submit', (e) => {
          e.preventDefault();
          const v = readForm(e.currentTarget, fields);
          if (!v) return;
          const from = `${fmtDate(m.date)} ${fmtTime(m.time)}`;
          Object.assign(m, { date: v.date, time: v.time, duration: v.duration, status: 'Scheduled' });
          logMeeting(m, `Rescheduled from ${from}${v.reason ? ' — ' + v.reason : ''}`);
          saveData(); updateUI(); closeModal();
          if (DB.settings.notify.reschedules) {
            pushNotification({ title: 'Meeting rescheduled', text: `${m.title} → ${fmtDate(m.date)} ${fmtTime(m.time)}`, icon: 'calendar', route: 'meeting', param: m.id });
          }
          showToast('Meeting rescheduled', `${m.title} moved to ${fmtDate(m.date)} at ${fmtTime(m.time)}.`, 'success');
        });
      }
    });
  }

  function cancelMeeting(id) {
    const m = meetingById(id);
    if (!m) return;
    const fields = [
      { name: 'cancelReason', label: 'Cancellation reason', type: 'select', full: true,
        options: ['Customer rescheduled', 'Internal conflict', 'No longer required', 'Key attendee unavailable', 'Technical issue', 'Other'] },
      { name: 'note', label: 'Additional detail (optional)', type: 'textarea', full: true }
    ];
    openModal({
      title: 'Cancel this meeting?', sub: m.title, icon: 'close', tone: 'danger',
      body: `
        <div class="danger-note">${icon('alert', 'ico--sm')}
          <span><strong>${esc(m.title)}</strong> on ${esc(fmtDate(m.date))} will be marked as cancelled. Participants stay on the record and the reason is stored for reporting.</span></div>
        <form class="form" id="cancelForm" novalidate style="margin-top:14px">
          <div class="form__grid">${buildFields(fields, { cancelReason: 'Customer rescheduled', note: '' })}</div>
        </form>`,
      footer: `<button class="btn btn--quiet" type="button" data-modal-close>Keep meeting</button>
               <button class="btn btn--danger" type="submit" form="cancelForm">${icon('close', 'ico--sm')} Cancel meeting</button>`,
      onMount: (dialog) => {
        $('#cancelForm', dialog).addEventListener('submit', (e) => {
          e.preventDefault();
          const v = readForm(e.currentTarget, fields);
          if (!v) return;
          m.status = 'Cancelled';
          m.cancelReason = v.note ? `${v.cancelReason} — ${v.note}` : v.cancelReason;
          logMeeting(m, `Meeting cancelled — ${m.cancelReason}`);
          saveData(); updateUI(); closeModal();
          if (DB.settings.notify.reschedules) pushNotification({ title: 'Meeting cancelled', text: `${m.title} — ${v.cancelReason}`, icon: 'close', route: 'meeting', param: m.id });
          showToast('Meeting cancelled', `${m.title} — ${v.cancelReason}`, 'danger');
        });
      }
    });
  }

  function completeMeeting(id) {
    const m = meetingById(id);
    if (!m) return;
    const fields = [
      { name: 'summary', label: 'Discussion summary', type: 'textarea', full: true },
      { name: 'sentiment', label: 'Customer sentiment', type: 'select', options: ['Positive', 'Neutral', 'Negative'] },
      { name: 'satisfaction', label: 'Satisfaction (%)', type: 'number', min: 0, max: 100 }
    ];
    openModal({
      title: 'Complete meeting', sub: m.title, icon: 'check',
      body: `
        <div class="fieldset-note">${icon('sparkle', 'ico--sm')}
          <span>A recap is suggested below from the agenda and decisions on this record — edit it before saving.</span></div>
        <form class="form" id="doneForm" novalidate><div class="form__grid">
          ${buildFields(fields, { summary: m.summary || (DB.settings.autoSummary ? Intel.summarise(m) : ''), sentiment: m.sentiment || 'Positive', satisfaction: m.satisfaction != null ? m.satisfaction : 85 })}
        </div></form>`,
      footer: `<button class="btn btn--quiet" type="button" data-modal-close>Cancel</button>
               <button class="btn btn--primary" type="submit" form="doneForm">${icon('check', 'ico--sm')} Mark completed</button>`,
      onMount: (dialog) => {
        $('#doneForm', dialog).addEventListener('submit', (e) => {
          e.preventDefault();
          const v = readForm(e.currentTarget, fields);
          if (!v) return;
          Object.assign(m, { status: 'Completed', summary: v.summary, sentiment: v.sentiment, satisfaction: v.satisfaction });
          (m.participants || []).forEach((p) => { if (p.attended === null || p.attended === undefined) p.attended = true; });
          logMeeting(m, 'Meeting completed');
          saveData(); updateUI(); closeModal();
          showToast('Meeting completed', `${m.title} — sentiment ${v.sentiment}.`, 'success');
          if (!recordsForMeeting('followups', m.id).length && DB.settings.notify.followUps) {
            pushNotification({ title: 'Follow-up required', text: `${m.title} has no follow-up yet.`, icon: 'repeat', route: 'meeting', param: m.id });
          }
        });
      }
    });
  }

  function sendReminder(id) {
    const m = meetingById(id);
    if (!m) return;
    logMeeting(m, `Reminder sent to ${(m.participants || []).length} participants`);
    saveData();
    pushNotification({ title: 'Reminder sent', text: `${m.title} · ${fmtDate(m.date)} ${fmtTime(m.time)}`, icon: 'bell', route: 'meeting', param: m.id });
    renderNotifications();
    showToast('Reminder sent', `${(m.participants || []).length} participants notified for ${m.title}.`, 'success');
  }

  function setReminder(id) {
    const m = meetingById(id);
    if (!m) return;
    const fields = [{ name: 'reminder', label: 'Remind me (minutes before)', type: 'number', min: 0, max: 1440 }];
    openModal({
      title: 'Meeting reminder', sub: m.title, icon: 'clock',
      body: `<form class="form" id="remForm" novalidate>${buildFields(fields, { reminder: m.reminder || DB.settings.reminderLead })}</form>`,
      footer: `<button class="btn btn--quiet" type="button" data-modal-close>Cancel</button>
               <button class="btn btn--primary" type="submit" form="remForm">${icon('check', 'ico--sm')} Save reminder</button>`,
      onMount: (dialog) => {
        $('#remForm', dialog).addEventListener('submit', (e) => {
          e.preventDefault();
          const v = readForm(e.currentTarget, fields);
          if (!v) return;
          m.reminder = v.reminder;
          logMeeting(m, `Reminder set to ${v.reminder} minutes before`);
          saveData(); updateUI(); closeModal();
          showToast('Reminder saved', `${v.reminder} minutes before ${m.title}.`, 'success');
        });
      }
    });
  }

  function addParticipant(id) {
    const m = meetingById(id);
    if (!m) return;
    const fields = [
      { name: 'name', label: 'Name', required: true, full: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'role', label: 'Attendee type', type: 'select', options: ['Internal', 'Customer', 'External'] }
    ];
    openModal({
      title: 'Add participant', sub: m.title, icon: 'lead',
      body: `<form class="form" id="pForm" novalidate><div class="form__grid">${buildFields(fields, { name: '', email: '', role: 'Internal' })}</div></form>`,
      footer: `<button class="btn btn--quiet" type="button" data-modal-close>Cancel</button>
               <button class="btn btn--primary" type="submit" form="pForm">${icon('check', 'ico--sm')} Add</button>`,
      onMount: (dialog) => {
        $('#pForm', dialog).addEventListener('submit', (e) => {
          e.preventDefault();
          const v = readForm(e.currentTarget, fields);
          if (!v) return;
          m.participants = m.participants || [];
          m.participants.push({ name: v.name, email: v.email, role: v.role, attended: isDone(m) ? false : null });
          logMeeting(m, `${v.name} added as ${v.role.toLowerCase()} participant`);
          saveData(); updateUI(); closeModal();
          showToast('Participant added', `${v.name} · ${v.role}`, 'success');
        });
      }
    });
  }

  function openTextModal({ title, sub, iconName, label, value, onSave, multiline = true }) {
    const fields = [{ name: 'text', label, type: multiline ? 'textarea' : 'text', required: true, full: true }];
    openModal({
      title, sub, icon: iconName || 'edit',
      body: `<form class="form" id="txtForm" novalidate>${buildFields(fields, { text: value || '' })}</form>`,
      footer: `<button class="btn btn--quiet" type="button" data-modal-close>Cancel</button>
               <button class="btn btn--primary" type="submit" form="txtForm">${icon('check', 'ico--sm')} Save</button>`,
      onMount: (dialog) => {
        $('#txtForm', dialog).addEventListener('submit', (e) => {
          e.preventDefault();
          const v = readForm(e.currentTarget, fields);
          if (!v) return;
          onSave(v.text);
          saveData(); updateUI(); closeModal();
        });
      }
    });
  }

  function extractActionsModal(id) {
    const m = meetingById(id);
    if (!m) return;
    const notes = recordsForMeeting('notes', m.id).map((n) => n.body).join(' ');
    const candidates = Intel.extractActions([m.summary, notes].join(' '));

    openModal({
      title: 'Extract action items', sub: m.title, icon: 'sparkle',
      refresh: () => extractActionsModal(id),
      body: candidates.length ? `
        <div class="fieldset-note">${icon('info', 'ico--sm')}
          <span>These sentences were detected in the summary and notes. Pick the ones to turn into action items.</span></div>
        <form id="exForm" class="stack" style="margin-top:14px">
          ${candidates.map((t, i) => `
            <label class="switch-row" style="cursor:pointer">
              <span class="switch-row__text" style="flex:1">${esc(t)}</span>
              <input type="checkbox" name="a${i}" value="${esc(t)}" checked style="width:18px;height:18px;accent-color:var(--brand-600)" />
            </label>`).join('')}
        </form>`
        : emptyState({ iconName: 'sparkle', title: 'Nothing to extract', text: 'No action-shaped sentences were found in the summary or notes for this meeting.' }),
      footer: candidates.length ? `
        <button class="btn btn--quiet" type="button" data-modal-close>Cancel</button>
        <button class="btn btn--primary" type="button" data-extract data-autofocus>${icon('task', 'ico--sm')} Create action items</button>`
        : `<button class="btn btn--primary" type="button" data-modal-close data-autofocus>Close</button>`,
      onMount: (dialog) => {
        const btn = $('[data-extract]', dialog);
        if (!btn) return;
        btn.addEventListener('click', () => {
          const chosen = $$('#exForm input:checked', dialog).map((el) => el.value);
          if (!chosen.length) { showToast('Nothing selected', 'Tick at least one item to create.', 'warning'); return; }
          chosen.forEach((text) => {
            DB.records.tasks.unshift({
              id: uid('tk'), contactId: m.contactId, meetingId: m.id,
              title: text.length > 90 ? text.slice(0, 90) + '…' : text,
              due: daysFromNow(5), priority: 'Medium', owner: m.organizer, status: 'Open'
            });
          });
          logMeeting(m, `${chosen.length} action item${chosen.length === 1 ? '' : 's'} extracted`);
          saveData(); updateUI(); closeModal();
          if (DB.settings.notify.actionItems) pushNotification({ title: 'Action items created', text: `${chosen.length} from ${m.title}`, icon: 'task', route: 'meeting', param: m.id });
          showToast('Action items created', `${chosen.length} task${chosen.length === 1 ? '' : 's'} added to ${m.title}.`, 'success');
        });
      }
    });
  }

  function setSentiment(id) {
    const m = meetingById(id);
    if (!m) return;
    const fields = [
      { name: 'sentiment', label: 'Customer sentiment', type: 'select', options: ['Positive', 'Neutral', 'Negative'] },
      { name: 'satisfaction', label: 'Satisfaction (%)', type: 'number', min: 0, max: 100 }
    ];
    openModal({
      title: 'Rate sentiment', sub: m.title, icon: 'pulse',
      body: `<form class="form" id="senForm" novalidate><div class="form__grid">
        ${buildFields(fields, { sentiment: m.sentiment || 'Positive', satisfaction: m.satisfaction != null ? m.satisfaction : 85 })}</div></form>`,
      footer: `<button class="btn btn--quiet" type="button" data-modal-close>Cancel</button>
               <button class="btn btn--primary" type="submit" form="senForm">${icon('check', 'ico--sm')} Save</button>`,
      onMount: (dialog) => {
        $('#senForm', dialog).addEventListener('submit', (e) => {
          e.preventDefault();
          const v = readForm(e.currentTarget, fields);
          if (!v) return;
          m.sentiment = v.sentiment; m.satisfaction = v.satisfaction;
          logMeeting(m, `Sentiment rated ${v.sentiment} (${v.satisfaction}%)`);
          saveData(); updateUI(); closeModal();
          showToast('Sentiment saved', `${m.title} — ${v.sentiment}`, 'success');
        });
      }
    });
  }

  function workspaceDigest() {
    const s = meetingStats();
    const g = growth();
    const today = todayISO();
    const lines = [
      `${todaysMeetings().length} meetings today and ${upcomingMeetings().length} upcoming.`,
      `${s.completed} of ${s.total} meetings completed (${s.completionRate}% completion, ${s.attendanceRate}% attendance).`,
      `Volume ${g.change >= 0 ? 'up' : 'down'} ${Math.abs(g.change)}% over the last 30 days.`,
      `${allRecords('tasks').filter((t) => t.status !== 'Completed').length} action items open, ${allRecords('tasks').filter((t) => t.status !== 'Completed' && t.due < today).length} overdue.`,
      `${allRecords('followups').filter((f) => f.status !== 'Completed').length} follow-ups awaiting closure.`,
      `Average satisfaction ${s.satisfaction}% across rated meetings.`
    ];
    openModal({
      title: 'Workspace digest', sub: fmtDate(today), icon: 'sparkle',
      body: `<div class="stack">${lines.map((l) => `
        <article class="rowcard"><span class="rowcard__icon">${icon('sparkle', 'ico--sm')}</span>
          <div class="rowcard__body"><p class="rowcard__text" style="margin-top:0">${esc(l)}</p></div></article>`).join('')}</div>`,
      footer: `<button class="btn btn--quiet" type="button" data-modal-close>Close</button>
               <button class="btn btn--primary" type="button" data-act="go" data-route="reports">${icon('bars', 'ico--sm')} Open reports</button>`
    });
  }

  /* ======================================================================
     14. CONTACT CRUD
     ====================================================================== */
  const CONTACT_FIELDS = [
    { name: 'firstName', label: 'First Name', required: true },
    { name: 'lastName', label: 'Last Name', required: true },
    { name: 'jobTitle', label: 'Job Title' },
    { name: 'department', label: 'Department' },
    { name: 'accountName', label: 'Account Name' },
    { name: 'email', label: 'Email Address', type: 'email', required: true },
    { name: 'mobile', label: 'Mobile', type: 'tel' },
    { name: 'officePhone', label: 'Office Phone', type: 'tel' },
    { name: 'preferredSlot', label: 'Preferred meeting slot' },
    { name: 'street', label: 'Street', full: true },
    { name: 'city', label: 'City' },
    { name: 'state', label: 'State / Region' },
    { name: 'zip', label: 'Postal Code' },
    { name: 'country', label: 'Country' },
    { name: 'tagsText', label: 'Tags (comma separated)', full: true },
    { name: 'description', label: 'Description', type: 'textarea', full: true }
  ];

  function openContactForm(id) {
    const existing = id ? contactById(id) : null;
    const values = existing
      ? Object.assign(clone(existing), { tagsText: (existing.tags || []).join(', ') })
      : { firstName: '', lastName: '', email: '', tagsText: '' };

    openModal({
      title: existing ? 'Edit Contact' : 'New Contact',
      sub: existing ? 'Changes update every screen immediately.' : 'Add a customer you meet with.',
      icon: existing ? 'edit' : 'user',
      body: `<form class="form" id="contactForm" novalidate>
          <div class="fieldset-note">${icon('info', 'ico--sm')}
            <span>Fields marked <strong>*</strong> are required. Email and phone numbers are validated before saving.</span></div>
          <div class="form__grid">${buildFields(CONTACT_FIELDS.map((f, i) => i === 0 ? Object.assign({}, f, { autofocus: true }) : f), values)}</div>
        </form>`,
      footer: `<button class="btn btn--quiet" type="button" data-modal-close>Cancel</button>
        <button class="btn btn--primary" type="submit" form="contactForm">${icon('check', 'ico--sm')} ${existing ? 'Save changes' : 'Create contact'}</button>`,
      onMount: (dialog) => {
        $('#contactForm', dialog).addEventListener('submit', (e) => {
          e.preventDefault();
          const v = readForm(e.currentTarget, CONTACT_FIELDS);
          if (!v) return;
          v.tags = String(v.tagsText || '').split(',').map((t) => t.trim()).filter(Boolean);
          delete v.tagsText;

          if (existing) {
            Object.assign(existing, v, { updatedAt: todayISO() });
            pushNotification({ title: 'Contact updated', text: `${fullName(existing)} was edited.`, icon: 'user', route: 'contact', param: existing.id });
            showToast('Contact updated', `${fullName(existing)} saved successfully.`, 'success');
            saveData(); updateUI(); closeModal();
          } else {
            const contact = Object.assign({
              id: uid('c'), favourite: false, owner: DB.admin.name, reportsTo: '', leadSource: 'Manual entry',
              industry: '', employees: '', annualRevenue: '', timezone: '', language: '', linkedin: '',
              lifecycle: 'Prospect — New', engagement: 10, doNotCall: false, emailOptOut: false,
              secondaryEmail: '', otherStreet: '', otherCity: '', otherState: '', otherZip: '', otherCountry: '',
              preferredSlot: '', createdAt: todayISO(), updatedAt: todayISO(), tags: []
            }, v);
            DB.contacts.unshift(contact);
            DB.activeContactId = contact.id;
            pushNotification({ title: 'Contact created', text: `${fullName(contact)} was added.`, icon: 'user', route: 'contact', param: contact.id });
            showToast('Contact created', `${fullName(contact)} is now in your workspace.`, 'success');
            saveData(); closeModal(); go('contact', contact.id);
          }
        });
      }
    });
  }

  function deleteContact(id) {
    const c = contactById(id);
    if (!c) return;
    confirmModal({
      title: 'Delete contact?', sub: fullName(c),
      message: `<strong>${esc(fullName(c))}</strong> and every linked meeting and record will be removed. You can undo this immediately afterwards.`,
      confirmLabel: 'Delete contact', iconName: 'trash',
      onConfirm: () => {
        const index = DB.contacts.findIndex((x) => x.id === id);
        const [removed] = DB.contacts.splice(index, 1);
        const removedRecords = {};
        MODULE_ORDER.forEach((key) => {
          removedRecords[key] = DB.records[key].filter((r) => r.contactId === id);
          DB.records[key] = DB.records[key].filter((r) => r.contactId !== id);
        });
        if (DB.activeContactId === id) DB.activeContactId = DB.contacts[0] ? DB.contacts[0].id : null;
        saveData(); closeModal(); go('contacts');
        showToast('Contact deleted', `${fullName(removed)} was removed.`, 'danger', {
          actionLabel: 'Undo',
          onAction: () => {
            DB.contacts.splice(index, 0, removed);
            MODULE_ORDER.forEach((key) => { DB.records[key] = removedRecords[key].concat(DB.records[key]); });
            DB.activeContactId = removed.id;
            saveData(); go('contact', removed.id);
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
    saveData(); updateUI();
    const star = $(`.star[data-id="${id}"]`);
    if (star) {
      star.classList.add('is-bouncing');
      star.addEventListener('animationend', () => star.classList.remove('is-bouncing'), { once: true });
    }
    showToast(c.favourite ? 'Added to favourites' : 'Removed from favourites', fullName(c), c.favourite ? 'success' : 'info');
  }

  /* ======================================================================
     15. ADMIN PROFILE
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
    const mine = meetings().filter((m) => m.organizer === a.name);
    const tasks = allRecords('tasks').filter((t) => t.owner === a.name && t.status !== 'Completed');
    openModal({
      title: a.name, sub: a.role, icon: 'user',
      body: `
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px">
          <span class="avatar av-${a.avatar || 1}" style="width:76px;height:76px;font-size:24px">${esc(a.initials)}</span>
          <div>
            <p style="font-size:17px;font-weight:600">${esc(a.name)}</p>
            <p style="font-size:12.5px;color:var(--text-mute)">${esc(a.email)}</p>
            <span class="pill pill--info" style="margin-top:8px">${esc(a.role)}</span>
          </div>
        </div>
        <div class="mstats">
          <div class="mstat"><p class="mstat__label">Meetings organised</p><p class="mstat__value">${mine.length}</p></div>
          <div class="mstat"><p class="mstat__label">Hours held</p><p class="mstat__value">${Math.round(sum(mine.filter(isDone), (m) => m.duration) / 60)}h</p></div>
          <div class="mstat"><p class="mstat__label">Open action items</p><p class="mstat__value">${tasks.length}</p></div>
        </div>
        <p class="subhead">Your next meetings</p>
        <div class="stack">
          ${mine.filter((m) => isFuture(m)).sort(byDateAsc).slice(0, 4).map((m) => meetingRow(m)).join('')
            || '<p class="empty-note">Nothing scheduled with you as organizer.</p>'}
        </div>`,
      footer: `<button class="btn btn--quiet" type="button" data-modal-close>Close</button>
               <button class="btn btn--primary" type="button" data-act="admin-edit">${icon('edit', 'ico--sm')} Edit profile</button>`
    });
  }

  function openAdminForm() {
    const a = DB.admin;
    const fields = [
      { name: 'name', label: 'Full name', required: true, full: true },
      { name: 'email', label: 'Email address', type: 'email', required: true, full: true },
      { name: 'role', label: 'Role', type: 'select', options: ['Administrator', 'Meeting Owner', 'Customer Success', 'Solutions Engineer', 'Support Lead'] },
      { name: 'initials', label: 'Avatar initials', required: true }
    ];
    openModal({
      title: 'Edit Profile', sub: 'Updates the navbar immediately.', icon: 'edit',
      body: `<form class="form" id="adminForm" novalidate>
          <div class="form__grid">${buildFields(fields.map((f, i) => i === 0 ? Object.assign({}, f, { autofocus: true }) : f), a)}</div>
          <div class="form__group">
            <span class="form__label">Avatar colour</span>
            <div class="swatches">
              ${[1, 2, 3, 4, 5, 6].map((n) => `<button class="swatch av-${n}" type="button" data-avatar="${n}"
                 aria-pressed="${Number(a.avatar || 1) === n}" aria-label="Avatar colour ${n}"></button>`).join('')}
            </div>
          </div>
        </form>`,
      footer: `<button class="btn btn--quiet" type="button" data-modal-close>Cancel</button>
               <button class="btn btn--primary" type="submit" form="adminForm">${icon('check', 'ico--sm')} Save profile</button>`,
      onMount: (dialog) => {
        let avatar = Number(a.avatar || 1);
        $$('[data-avatar]', dialog).forEach((btn) => btn.addEventListener('click', () => {
          avatar = Number(btn.dataset.avatar);
          $$('[data-avatar]', dialog).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.avatar) === avatar)));
        }));
        $('#adminForm', dialog).addEventListener('submit', (e) => {
          e.preventDefault();
          const v = readForm(e.currentTarget, fields);
          if (!v) return;
          Object.assign(DB.admin, v, { initials: String(v.initials).slice(0, 3).toUpperCase(), avatar });
          syncAdminToTeam();   // keep the roster entry and every record in step
          saveData(); updateUI(); closeModal();
          showToast('Profile updated', `${DB.admin.name} · ${DB.admin.role}`, 'success');
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
      onConfirm: () => { closeModal(); $('#lockScreen').hidden = false; document.body.style.overflow = 'hidden'; }
    });
  }

  /* ======================================================================
     16. NOTIFICATIONS
     ====================================================================== */
  function pushNotification({ title, text, icon: iconName, route, param }) {
    DB.notifications.unshift({
      id: uid('n'), title, text, icon: iconName || 'info', ts: Date.now(),
      unread: true, route: route || null, param: param || null
    });
    DB.notifications = DB.notifications.slice(0, 25);
  }

  /** Meeting-driven notifications generated from the current data. */
  function seedNotifications() {
    if (DB.notifications.length) return;
    const today = todayISO();
    upcomingMeetings().slice(0, 2).forEach((m) => {
      DB.notifications.push({
        id: uid('n'), title: 'Upcoming meeting reminder',
        text: `${m.title} · ${fmtDate(m.date)} at ${fmtTime(m.time)}`,
        icon: 'bell', ts: Date.now() - 12 * 6e4, unread: true, route: 'meeting', param: m.id
      });
    });
    const pending = allRecords('tasks').filter((t) => t.status !== 'Completed' && t.due < today)[0];
    if (pending) {
      DB.notifications.push({
        id: uid('n'), title: 'Action item pending', text: `${pending.title} was due ${fmtDate(pending.due)}`,
        icon: 'task', ts: Date.now() - 55 * 6e4, unread: true, route: 'tasks', param: null
      });
    }
    const needs = meetingsBy((m) => isDone(m) && !recordsForMeeting('followups', m.id).length)[0];
    if (needs) {
      DB.notifications.push({
        id: uid('n'), title: 'Follow-up required', text: `${needs.title} has no follow-up logged`,
        icon: 'repeat', ts: Date.now() - 36e5 * 3, unread: true, route: 'meeting', param: needs.id
      });
    }
    const moved = meetingsBy((m) => m.status === 'Cancelled')[0];
    if (moved) {
      DB.notifications.push({
        id: uid('n'), title: 'Meeting cancelled', text: `${moved.title} · ${fmtDate(moved.date)}`,
        icon: 'close', ts: Date.now() - 36e5 * 20, unread: false, route: 'meeting', param: moved.id
      });
    }
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
    saveData(); renderNotifications(); closeDropdowns();
    if (n.route === 'meeting' && meetingById(n.param)) go('meeting', n.param);
    else if (n.route === 'contact' && contactById(n.param)) go('contact', n.param);
    else if (n.route && VIEWS[n.route]) go(n.route);
  }

  /* ======================================================================
     17. SEARCH
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
        // Mirror the dropdown fix: trust aria-expanded, not the hidden property.
        this.toggle.getAttribute('aria-expanded') === 'true' ? this.close() : this.open();
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
      document.addEventListener('click', (e) => { if (!this.panel.hidden && !e.target.closest('#search')) this.close(); });
    },
    open() {
      closeDropdowns();
      this.panel.hidden = false;
      this.panel.removeAttribute('hidden');
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
    collect(q) {
      const out = [];
      meetings().slice().sort(byDateDesc).forEach((m) => {
        if (matches(q, m.title, m.type, m.organizer, fullName(contactById(m.contactId)))) {
          out.push({
            group: 'Meetings', label: m.title, meta: `${fmtDate(m.date)} · ${m.type} · ${fullName(contactById(m.contactId))}`,
            kind: m.status, icon: 'video', run: () => go('meeting', m.id)
          });
        }
      });
      DB.contacts.forEach((c) => {
        if (matches(q, fullName(c), c.email, c.accountName, c.jobTitle, (c.tags || []).join(' '))) {
          out.push({ group: 'Contacts', label: fullName(c), meta: `${c.jobTitle || '—'} · ${c.accountName || '—'}`, kind: 'Contact', icon: 'user', run: () => go('contact', c.id) });
        }
      });
      MODULE_ORDER.filter((k) => k !== 'meetings').forEach((key) => {
        const mod = MODULES[key];
        allRecords(key).forEach((r) => {
          if (!matches(q, mod.title(r), mod.meta(r))) return;
          out.push({
            group: 'Records', label: String(mod.title(r)).slice(0, 64), meta: `${mod.label} · ${mod.meta(r)}`.slice(0, 80),
            kind: mod.label, icon: mod.icon,
            run: () => { if (r.meetingId && meetingById(r.meetingId)) go('meeting', r.meetingId); else if (r.contactId) go('contact', r.contactId); }
          });
        });
      });
      NAV_ITEMS.forEach((item) => {
        if (matches(q, item.label)) out.push({ group: 'Navigate', label: item.label, meta: 'Workspace view', kind: 'View', icon: 'grid', run: () => go(item.id) });
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
          <p class="empty__text">Nothing matches “${esc(q)}”. Try a meeting title, customer, note or module.</p>
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
        this.activeIndex = e.key === 'ArrowDown' ? (this.activeIndex + 1) % items.length : (this.activeIndex - 1 + items.length) % items.length;
        items.forEach((el, i) => el.classList.toggle('is-active', i === this.activeIndex));
        items[this.activeIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  };

  /* ======================================================================
     18. DASHBOARD TILE MODALS
     ====================================================================== */
  const mstat = (label, value, small) =>
    `<div class="mstat"><p class="mstat__label">${esc(label)}</p>
     <p class="mstat__value"${small ? ' style="font-size:16px"' : ''}>${esc(value)}</p></div>`;

  /** A meeting row with recovery buttons — used by the Missed / Cancelled tiles. */
  const recoveryRow = (m, extra) => `
    <article class="rowcard">
      <span class="rowcard__icon" style="color:${PIPELINE_ACCENT[m.status] || '#f43f5e'}">${icon('video', 'ico--sm')}</span>
      <div class="rowcard__body">
        <p class="rowcard__title">${esc(m.title)}</p>
        <p class="rowcard__meta">${esc(fmtDate(m.date))} · ${esc(fmtTime(m.time))} · ${esc(fullName(contactById(m.contactId)))}</p>
        ${extra ? `<p class="rowcard__text">${extra}</p>` : ''}
      </div>
      <div class="rowcard__side">
        <span class="pill pill--${toneFor(m.status)}">${esc(m.status)}</span>
        <div class="rowcard__actions">
          <button class="btn btn--sm btn--soft" type="button" data-act="reschedule" data-id="${esc(m.id)}">${icon('calendar', 'ico--xs')} Reschedule</button>
          <button class="btn btn--sm btn--ghost" type="button" data-act="new-linked" data-key="followups" data-id="${esc(m.id)}">${icon('repeat', 'ico--xs')} Follow up</button>
        </div>
      </div>
    </article>`;

  /**
   * Shared renderer for every KPI drill-down. Same modal shell, same blocks —
   * stats row, optional note, then one or more titled record sections.
   */
  function detailModal(cfg) {
    openModal({
      title: cfg.title, sub: cfg.sub, icon: cfg.icon, wide: true,
      refresh: cfg.refresh,
      body: `
        <div class="mstats">${cfg.stats.map(([l, v]) => mstat(l, v)).join('')}</div>
        ${cfg.note ? `<div class="fieldset-note">${icon('info', 'ico--sm')}<span>${esc(cfg.note)}</span></div>` : ''}
        ${(cfg.sections || []).map((sec) => `
          <p class="subhead">${esc(sec.label)}</p>
          <div class="stack">${sec.rows.length ? sec.rows.join('') : `<p class="empty-note">${esc(sec.empty || 'Nothing to show.')}</p>`}</div>`).join('')}`,
      footer: `
        <button class="btn btn--quiet foot-left" type="button" data-modal-close>${icon('arrow-left', 'ico--sm')} Back</button>
        ${cfg.extraAction || ''}
        ${cfg.route ? `<button class="btn btn--primary" type="button" data-act="go" data-route="${esc(cfg.route)}">${esc(cfg.routeLabel || 'Open')}</button>` : ''}`
    });
  }

  /** A plain label/value row reused by the analytics drill-downs. */
  const statRow = (label, value, share) => `
    <div class="switch-row">
      <div style="flex:1;min-width:0">
        <p class="switch-row__text">${esc(label)}</p>
        ${share != null ? `<div class="meter" style="margin-top:8px"><span class="meter__fill" style="width:${share}%"></span></div>` : ''}
      </div>
      <strong>${esc(value)}</strong>
    </div>`;

  function openKpiModal(id) {
    const s = meetingStats();
    const all = meetings();
    const today = todayISO();
    const dur = durationTrend();

    const cfgs = {
      total: () => ({
        title: 'Meeting summary', sub: `${s.total} sessions in this workspace`, icon: 'video',
        stats: [['Total', String(s.total)], ['Completed', String(s.completed)], ['Upcoming', String(s.upcoming)],
          ['Cancelled', String(s.cancelled)], ['Missed', String(s.missed)]],
        sections: [{ label: 'Most recent meetings', rows: all.slice().sort(byDateDesc).slice(0, 8).map((m) => meetingRow(m, { showType: true })) }],
        route: 'meetings', routeLabel: 'Open meetings'
      }),
      upcoming: () => ({
        title: 'Upcoming schedule', sub: `${s.upcoming} meetings ahead`, icon: 'calendar',
        stats: [['Today', String(todaysMeetings().length)], ['This week', String(meetingsBy((m) => m.date >= today && m.date <= addDays(today, 7)).length)], ['Total upcoming', String(s.upcoming)]],
        sections: [
          { label: `Today · ${fmtDay(today)}`, rows: todaysMeetings().map((m) => meetingRow(m, { showType: true })), empty: 'No meetings today — a clear calendar.' },
          { label: 'Upcoming schedule', rows: upcomingMeetings().slice(0, 8).map((m) => meetingRow(m, { showType: true })), empty: 'Nothing booked ahead.' }
        ],
        route: 'calendar', routeLabel: 'Open calendar'
      }),
      completed: () => ({
        title: 'Completed meetings', sub: `${s.completionRate}% completion rate`, icon: 'check',
        stats: [['Completed', String(s.completed)], ['Completion rate', s.completionRate + '%'], ['Avg duration', fmtDuration(s.avgDuration)],
          ['Hours held', num(s.totalHours) + 'h'], ['Satisfaction', s.satisfaction + '%']],
        sections: [{ label: 'Recently completed', rows: all.filter(isDone).sort(byDateDesc).slice(0, 8).map((m) => meetingRow(m, { showType: true })), empty: 'No meetings completed yet.' }],
        route: 'reports', routeLabel: 'Open reports'
      }),
      cancelled: () => ({
        title: 'Cancelled meetings', sub: 'Sessions called off before they started', icon: 'close',
        stats: [['Cancelled', String(s.cancelled)], ['Share of all', pct(s.cancelled, s.total) + '%'], ['Hours freed', Math.round(sum(all.filter((m) => m.status === 'Cancelled'), (m) => m.duration) / 60) + 'h']],
        sections: [{
          label: 'Cancellations and reasons',
          rows: all.filter((m) => m.status === 'Cancelled').sort(byDateDesc).slice(0, 8)
            .map((m) => recoveryRow(m, `<strong>Reason:</strong> ${esc(m.cancelReason || 'No reason recorded')}`)),
          empty: 'Nothing has been cancelled.'
        }],
        route: 'meetings', routeLabel: 'Open meetings'
      }),
      missed: () => ({
        title: 'Missed meetings', sub: 'No-shows worth recovering', icon: 'alert',
        stats: [['Missed', String(s.missed)], ['No-show rate', pct(s.missed, s.total) + '%'], ['Recovered', String(meetingsBy((m) => m.status === 'Missed' && recordsForMeeting('followups', m.id).length).length)]],
        note: 'Recovery actions: reschedule the session or log a follow-up so the customer is not left waiting.',
        sections: [{
          label: 'No-shows and recovery actions',
          rows: all.filter((m) => m.status === 'Missed').sort(byDateDesc).slice(0, 8)
            .map((m) => recoveryRow(m, recordsForMeeting('followups', m.id).length ? '<strong>Recovery:</strong> follow-up already logged' : '<strong>Recovery:</strong> not started')),
          empty: 'No missed meetings — everyone showed up.'
        }],
        route: 'meetings', routeLabel: 'Open meetings'
      }),
      duration: () => ({
        title: 'Meeting duration', sub: 'Where your meeting time goes', icon: 'clock',
        stats: [['Average', fmtDuration(s.avgDuration)], ['Total hours', num(s.totalHours) + 'h'], ['Meetings held', String(s.completed)],
          ['30-day trend', `${dur.change >= 0 ? '+' : ''}${dur.change} min`]],
        note: `Average length is ${dur.cur} min over the last 30 days versus ${dur.prev} min in the previous 30.`,
        sections: [{ label: 'Longest sessions', rows: all.filter(isDone).sort((a, b) => b.duration - a.duration).slice(0, 8).map((m) => meetingRow(m, { showType: true })), empty: 'No meetings held yet.' }],
        route: 'analytics', routeLabel: 'Open analytics'
      })
    };
    const cfg = (cfgs[id] || cfgs.total)();
    detailModal(Object.assign({
      refresh: () => openKpiModal(id),
      extraAction: `<button class="btn btn--ghost" type="button" data-act="schedule-meeting">${icon('plus', 'ico--sm')} Schedule</button>`
    }, cfg));
  }

  /** Organizer profile — the detail page every organizer name links to. */
  function openOrganizerModal(id) {
    const u = teamById(id);
    if (!u) return;
    const s = organizerStats(id);
    const mine = meetings().filter((m) => m.organizerId === id);
    const upcoming = mine.filter((m) => isFuture(m) && m.status !== 'Cancelled').sort(byDateAsc).slice(0, 4);
    const recent = mine.filter(isDone).sort(byDateDesc).slice(0, 4);
    const isMe = DB.admin.teamId === id;

    detailModal({
      title: u.name, sub: `${u.role} · ${u.department}`, icon: 'user',
      refresh: () => openOrganizerModal(id),
      stats: [['Meetings organised', String(s.organised)], ['Completed', String(s.completed)],
        ['Upcoming', String(s.upcoming)], ['Hours held', s.hours + 'h'], ['Open action items', String(s.actionItems)]],
      note: `Contact: ${u.email}${u.phone ? ' · ' + u.phone : ''} · workspace permission: ${u.permission}.`,
      sections: [
        { label: 'Upcoming meetings', empty: 'Nothing scheduled with this organizer.',
          rows: upcoming.map((m) => meetingRow(m, { showType: true })) },
        { label: 'Recently held', empty: 'No completed meetings yet.',
          rows: recent.map((m) => meetingRow(m, { showType: true })) }
      ],
      extraAction: isMe ? `<button class="btn btn--ghost" type="button" data-act="admin-edit">${icon('edit', 'ico--sm')} Edit my profile</button>` : '',
      route: 'meetings', routeLabel: 'Open meetings'
    });
  }

  /* ---- Analytics page KPI drill-downs ---- */
  function openAnalyticsKpi(kind) {
    if (kind === 'meetings') return openKpiModal('total');
    if (kind === 'duration') return openKpiModal('duration');

    const s = meetingStats();
    const all = meetings();
    const done = all.filter(isDone);
    const refresh = () => openAnalyticsKpi(kind);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    if (kind === 'completion') {
      const months = Array.from(new Set(all.map((m) => monthKey(m.date)))).sort().slice(-6);
      return detailModal({
        title: 'Completion rate', sub: 'How reliably meetings actually happen', icon: 'check', refresh,
        stats: [['Completion rate', s.completionRate + '%'], ['Completed', String(s.completed)],
          ['Missed', String(s.missed)], ['Cancelled', String(s.cancelled)]],
        note: `${s.completed} of ${s.completed + s.missed} scheduled sessions were held. Cancellations are excluded from the rate.`,
        sections: [
          { label: 'Completion by month', rows: months.map((b) => {
              const mine = all.filter((m) => monthKey(m.date) === b);
              const held = mine.filter(isDone).length;
              const missed = mine.filter((m) => m.status === 'Missed').length;
              return statRow(monthLabel(b), `${held}/${held + missed} · ${pct(held, held + missed)}%`, pct(held, held + missed));
            }) },
          { label: 'Missed sessions to recover', empty: 'No missed meetings.',
            rows: all.filter((m) => m.status === 'Missed').sort(byDateDesc).slice(0, 5).map((m) => meetingRow(m, { showType: true })) }
        ],
        route: 'reports', routeLabel: 'Open reports'
      });
    }

    if (kind === 'attendance') {
      let invited = 0, attended = 0;
      done.forEach((m) => (m.participants || []).forEach((p) => { invited++; if (p.attended) attended++; }));
      const worst = done.slice().sort((a, b) => {
        const r = (x) => pct((x.participants || []).filter((p) => p.attended).length, (x.participants || []).length);
        return r(a) - r(b);
      }).slice(0, 5);
      return detailModal({
        title: 'Attendance rate', sub: 'Invitees who actually joined', icon: 'users', refresh,
        stats: [['Attendance rate', s.attendanceRate + '%'], ['Invited', String(invited)],
          ['Attended', String(attended)], ['No-shows', String(invited - attended)]],
        sections: [
          { label: 'Attendance by role', rows: ['Internal', 'Customer', 'External'].map((role) => {
              let i = 0, a = 0;
              done.forEach((m) => (m.participants || []).filter((p) => p.role === role).forEach((p) => { i++; if (p.attended) a++; }));
              return statRow(role, i ? `${a}/${i} · ${pct(a, i)}%` : 'none invited', pct(a, i));
            }) },
          { label: 'Lowest attendance meetings', empty: 'No meetings held yet.',
            rows: worst.map((m) => meetingRow(m, { showType: true })) }
        ],
        route: 'reports', routeLabel: 'Attendance report'
      });
    }

    if (kind === 'satisfaction') {
      const rated = done.filter((m) => m.satisfaction != null);
      const counts = ['Positive', 'Neutral', 'Negative'].map((x) => ({ x, n: done.filter((m) => m.sentiment === x).length }));
      return detailModal({
        title: 'Meeting satisfaction', sub: 'Sentiment and post-meeting scores', icon: 'sparkle', refresh,
        stats: [['Average', s.satisfaction + '%'], ['Rated meetings', String(rated.length)]]
          .concat(counts.map((c) => [c.x, String(c.n)])),
        sections: [
          { label: 'Sentiment mix', rows: counts.map((c) => statRow(c.x, `${c.n} · ${pct(c.n, done.length)}%`, pct(c.n, done.length))) },
          { label: 'Highest rated', empty: 'Nothing rated yet.',
            rows: rated.slice().sort((a, b) => b.satisfaction - a.satisfaction).slice(0, 4).map((m) => meetingRow(m, { showType: true })) },
          { label: 'Needs attention', empty: 'No low scores.',
            rows: rated.slice().sort((a, b) => a.satisfaction - b.satisfaction).slice(0, 4).map((m) => meetingRow(m, { showType: true })) }
        ],
        route: 'meetings', routeLabel: 'Open meetings'
      });
    }

    /* busiest day */
    const byDay = new Array(7).fill(0);
    all.forEach((m) => { byDay[new Date(m.date + 'T00:00:00').getDay()]++; });
    const peak = byDay.indexOf(Math.max(...byDay));
    const byHour = {};
    all.forEach((m) => { const h = parseInt(m.time, 10); byHour[h] = (byHour[h] || 0) + 1; });
    const peakHour = Object.keys(byHour).sort((a, b) => byHour[b] - byHour[a])[0];
    return detailModal({
      title: 'Booking pattern', sub: 'When meetings actually land', icon: 'calendar', refresh,
      stats: [['Busiest day', dayNames[peak]], ['Meetings that day', String(byDay[peak])],
        ['Busiest hour', peakHour != null ? `${String(peakHour).padStart(2, '0')}:00` : '—'],
        ['Quietest day', dayNames[byDay.indexOf(Math.min(...byDay))]]],
      sections: [
        { label: 'Meetings per weekday', rows: dayNames.map((d, i) => statRow(d, String(byDay[i]), pct(byDay[i], Math.max(...byDay)))) },
        { label: `Next meetings on ${dayNames[peak]}`, empty: 'Nothing booked on that day.',
          rows: upcomingMeetings().filter((m) => new Date(m.date + 'T00:00:00').getDay() === peak).slice(0, 5).map((m) => meetingRow(m, { showType: true })) }
      ],
      route: 'calendar', routeLabel: 'Open calendar'
    });
  }

  /* ---- Reports page KPI drill-downs ---- */
  function openReportKpi(kind) {
    const id = state.filters.report || 'productivity';
    const f = reportFilters();
    const report = buildReport(id, f);
    const list = filteredMeetings(f);
    const done = list.filter(isDone);
    const type = REPORT_TYPES.find((r) => r.id === id) || REPORT_TYPES[0];

    const focus = {
      meetings: ['Meetings in range', String(list.length)],
      completed: ['Completed', String(done.length)],
      hours: ['Hours held', Math.round(sum(done, (m) => m.duration) / 60) + 'h']
    }[kind] || ['Records', String(report.rows.length)];

    detailModal({
      title: 'Report summary', sub: type.label, icon: 'bars',
      refresh: () => openReportKpi(kind),
      stats: [focus, ['Total records', String(report.rows.length)], ['Completion', pct(done.length, done.length + list.filter((m) => m.status === 'Missed').length) + '%'],
        ['Avg duration', (done.length ? Math.round(sum(done, (m) => m.duration) / done.length) : 0) + ' min']],
      note: `Date range ${fmtDate(f.from)} → ${fmtDate(f.to)} · user: ${f.user === 'all' ? 'all users' : f.user} · customer: ${f.customer === 'all' ? 'all customers' : fullName(contactById(f.customer))} · type: ${f.type === 'all' ? 'all types' : f.type}.`,
      sections: [
        { label: 'Performance details', empty: 'No rows in this range.',
          rows: report.rows.slice(0, 8).map((row) => statRow(String(row[0]), row.slice(1).join(' · '))) },
        { label: 'Meetings in this range', empty: 'No meetings in this range.',
          rows: list.slice().sort(byDateDesc).slice(0, 5).map((m) => meetingRow(m, { showType: true })) }
      ],
      extraAction: `<button class="btn btn--ghost" type="button" data-act="export-report">${icon('download', 'ico--sm')} Export CSV</button>`,
      route: 'analytics', routeLabel: 'Open analytics'
    });
  }

  /* ---- Action Items page KPI drill-downs ---- */
  function openTaskKpi(kind) {
    const all = allRecords('tasks');
    const today = todayISO();
    const open = all.filter((t) => t.status !== 'Completed');
    const overdue = open.filter((t) => t.due < today);
    const completed = all.filter((t) => t.status === 'Completed');
    const rows = (list) => list.slice().sort((a, b) => String(a.due).localeCompare(String(b.due)))
      .slice(0, 8).map((t) => recordRow('tasks', t, { showContact: true, showMeeting: true }));

    const cfgs = {
      open: {
        title: 'Open action items', sub: 'Commitments still to close', icon: 'task',
        stats: [['Open', String(open.length)], ['Overdue', String(overdue.length)],
          ['Due this week', String(open.filter((t) => t.due >= today && t.due <= addDays(today, 7)).length)],
          ['Unassigned', String(open.filter((t) => !t.owner).length)]],
        sections: [{ label: 'Open items by due date', rows: rows(open), empty: 'Nothing outstanding.' }]
      },
      overdue: {
        title: 'Overdue action items', sub: 'Past their due date', icon: 'alert',
        stats: [['Overdue', String(overdue.length)], ['High priority', String(overdue.filter((t) => t.priority === 'High').length)],
          ['Oldest', overdue.length ? fmtDate(overdue.slice().sort((a, b) => String(a.due).localeCompare(String(b.due)))[0].due) : '—']],
        note: 'Reassign, reschedule or close these items — each one came out of a meeting commitment.',
        sections: [{ label: 'Overdue items', rows: rows(overdue), empty: 'Nothing is overdue.' }]
      },
      completed: {
        title: 'Completed action items', sub: 'Closed-out commitments', icon: 'check',
        stats: [['Completed', String(completed.length)], ['Completion rate', pct(completed.length, all.length) + '%'],
          ['From meetings', String(completed.filter((t) => t.meetingId).length)]],
        sections: [{ label: 'Recently completed', rows: completed.slice().sort((a, b) => String(b.due).localeCompare(String(a.due))).slice(0, 8).map((t) => recordRow('tasks', t, { showContact: true, showMeeting: true })), empty: 'Nothing completed yet.' }]
      },
      rate: {
        title: 'Action item completion', sub: 'Follow-through on meeting commitments', icon: 'pulse',
        stats: [['Completion rate', pct(completed.length, all.length) + '%'], ['Completed', String(completed.length)],
          ['Open', String(open.length)], ['Total', String(all.length)]],
        sections: [
          { label: 'By owner', rows: Array.from(new Set(all.map((t) => t.owner))).map((o) => {
              const mine = all.filter((t) => t.owner === o);
              const c = mine.filter((t) => t.status === 'Completed').length;
              return statRow(o || 'Unassigned', `${c}/${mine.length} · ${pct(c, mine.length)}%`, pct(c, mine.length));
            }) },
          { label: 'By priority', rows: ['High', 'Medium', 'Low'].map((p) => {
              const mine = all.filter((t) => t.priority === p);
              const c = mine.filter((t) => t.status === 'Completed').length;
              return statRow(p, `${c}/${mine.length} · ${pct(c, mine.length)}%`, pct(c, mine.length));
            }) }
        ]
      }
    };

    detailModal(Object.assign({
      refresh: () => openTaskKpi(kind),
      extraAction: `<button class="btn btn--ghost" type="button" data-act="new-record" data-key="tasks">${icon('plus', 'ico--sm')} New action item</button>`,
      route: 'tasks', routeLabel: 'Open action items'
    }, cfgs[kind] || cfgs.open));
  }

  function openStageModal(stage) {
    const list = meetingsBy((m) => m.status === stage).sort(byDateDesc);
    openModal({
      title: `${stage} meetings`, sub: `${list.length} in this stage`, icon: 'board',
      refresh: () => openStageModal(stage),
      body: `<div class="stack">${list.length ? list.map((m) => meetingRow(m, { showType: true })).join('')
        : '<p class="empty-note">No meetings are in this stage.</p>'}</div>`,
      footer: `<button class="btn btn--quiet" type="button" data-modal-close>Close</button>
               <button class="btn btn--primary" type="button" data-act="go" data-route="meetings">Open meetings</button>`
    });
  }

  /** CSV export of the currently selected report. */
  function exportReport() {
    const id = state.filters.report || 'productivity';
    const report = buildReport(id, reportFilters());
    const csv = [report.columns].concat(report.rows)
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meeting360-${id}-${todayISO()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Report exported', `${report.title} · ${report.rows.length} rows`, 'success');
    } catch (err) {
      showToast('Export blocked', 'Your browser blocked the download — the report is still on screen.', 'warning');
    }
  }

  /* ======================================================================
     19. DROPDOWNS, ACTION ROUTER & EVENTS
     ====================================================================== */
  function closeDropdowns() {
    $$('[data-dropdown-menu]').forEach((menu) => {
      menu.hidden = true;
      menu.setAttribute('hidden', '');
      const wrap = menu.closest('[data-dropdown]');
      const toggle = wrap && $('[data-dropdown-toggle]', wrap);
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
  }

  const ACTIONS = {
    'go': (el) => { closeModal(); go(el.dataset.route, el.dataset.param); },
    'reload': () => location.reload(),
    'kpi': (el) => {
      const id = el.dataset.id || '';
      if (id.startsWith('an:')) openAnalyticsKpi(id.slice(3));
      else if (id.startsWith('rp:')) openReportKpi(id.slice(3));
      else if (id.startsWith('ai:')) openTaskKpi(id.slice(3));
      else openKpiModal(id);
    },
    'back': () => goBack(),
    'stage': (el) => openStageModal(el.dataset.value),
    'insight': (el) => {
      closeModal();
      if (el.dataset.filter === 'needs-followup') { go('meetings'); setTimeout(() => { state.filters.mStatus = 'Completed'; renderView(); }, 400); }
      else if (el.dataset.filter === 'negative') { go('meetings'); }
      else if (el.dataset.route) go(el.dataset.route);
    },
    'intel-digest': () => workspaceDigest(),

    'open-contact': (el) => { closeModal(); go('contact', el.dataset.id); },
    'open-meeting': (el) => { closeModal(); go('meeting', el.dataset.id); },
    'open-record': (el) => { const mod = MODULES[el.dataset.key]; const r = findRecord(el.dataset.key, el.dataset.id); if (mod.open && r) { closeModal(); mod.open(r); } },

    'new-contact': () => openContactForm(null),
    'edit-contact': (el) => openContactForm(el.dataset.id || DB.activeContactId),
    'delete-contact': (el) => deleteContact(el.dataset.id || DB.activeContactId),
    'toggle-fav': (el) => toggleFavourite(el.dataset.id),

    'schedule-meeting': () => scheduleMeeting(),
    'schedule-for': (el) => { DB.activeContactId = el.dataset.id; scheduleMeeting({ contactId: el.dataset.id }); },
    'schedule-on': (el) => scheduleMeeting({ date: el.dataset.value }),
    'schedule-at': (el) => scheduleMeeting({ date: el.dataset.value, time: el.dataset.time }),
    'reschedule': (el) => rescheduleMeeting(el.dataset.id),
    'cancel-meeting': (el) => cancelMeeting(el.dataset.id),
    'complete-meeting': (el) => completeMeeting(el.dataset.id),
    'send-reminder': (el) => sendReminder(el.dataset.id),
    'set-reminder': (el) => setReminder(el.dataset.id),
    'add-participant': (el) => addParticipant(el.dataset.id),
    'toggle-attendance': (el) => {
      const m = meetingById(el.dataset.id);
      const p = m && (m.participants || []).find((x) => x.name === el.dataset.name);
      if (!p) return;
      p.attended = p.attended === true ? false : true;
      logMeeting(m, `${p.name} marked as ${p.attended ? 'attended' : 'no-show'}`);
      saveData(); updateUI();
      showToast('Attendance updated', `${p.name} — ${p.attended ? 'attended' : 'no-show'}`, 'success');
    },
    'del-participant': (el) => {
      const m = meetingById(el.dataset.id);
      if (!m) return;
      m.participants = (m.participants || []).filter((x) => x.name !== el.dataset.name);
      logMeeting(m, `${el.dataset.name} removed from participants`);
      saveData(); updateUI();
      showToast('Participant removed', el.dataset.name, 'info');
    },
    'add-decision': (el) => {
      const m = meetingById(el.dataset.id);
      openTextModal({
        title: 'Add decision', sub: m.title, iconName: 'check', label: 'Decision',
        onSave: (text) => { m.decisions = (m.decisions || []).concat(text); logMeeting(m, 'Decision recorded'); showToast('Decision added', text.slice(0, 50), 'success'); }
      });
    },
    'del-decision': (el) => {
      const m = meetingById(el.dataset.id);
      m.decisions.splice(Number(el.dataset.index), 1);
      saveData(); updateUI();
      showToast('Decision removed', '', 'info');
    },
    'edit-agenda': (el) => {
      const m = meetingById(el.dataset.id);
      openTextModal({
        title: 'Edit agenda', sub: m.title, iconName: 'note',
        label: 'One topic per line — use “Topic — objective” to add an objective',
        value: (m.agenda || []).map((a) => a.objective ? `${a.topic} — ${a.objective}` : a.topic).join('\n'),
        onSave: (text) => {
          m.agenda = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
            const [topic, objective] = l.split('—').map((s) => s.trim());
            return { topic: topic || l, objective: objective || '' };
          });
          logMeeting(m, 'Agenda updated');
          showToast('Agenda saved', `${m.agenda.length} topics`, 'success');
        }
      });
    },
    'apply-summary': (el) => {
      const m = meetingById(el.dataset.id);
      m.summary = Intel.summarise(m);
      logMeeting(m, 'Summary generated');
      saveData(); updateUI();
      showToast('Summary saved', 'The generated recap is now on the meeting record.', 'success');
    },
    'extract-actions': (el) => extractActionsModal(el.dataset.id),
    'accept-action': (el) => {
      const m = meetingById(el.dataset.id);
      DB.records.tasks.unshift({
        id: uid('tk'), contactId: m.contactId, meetingId: m.id,
        title: el.dataset.text.slice(0, 90), due: daysFromNow(5),
        priority: 'Medium', owner: m.organizer, status: 'Open'
      });
      logMeeting(m, 'Action item created from intelligence');
      saveData(); updateUI();
      showToast('Action item created', el.dataset.text.slice(0, 50), 'success');
    },
    'set-sentiment': (el) => setSentiment(el.dataset.id),

    'module': (el) => openModuleModal(el.dataset.key, el.dataset.contact || DB.activeContactId),
    'new-record': (el) => {
      const inModule = !modalEl().hidden && state.modalRefresh;
      openRecordForm(el.dataset.key, null, inModule ? state.modalRefresh : null);
    },
    'new-linked': (el) => {
      const m = meetingById(el.dataset.id);
      openRecordForm(el.dataset.key, null, null, { meetingId: m.id, contactId: m.contactId, date: m.date, due: daysFromNow(5) });
    },
    'edit-record': (el) => openRecordForm(el.dataset.key, el.dataset.id, state.modalRefresh),
    'del-record': (el) => deleteRecord(el.dataset.key, el.dataset.id, state.modalRefresh),
    'toggle-record': (el) => toggleRecord(el.dataset.key, el.dataset.id),

    'tab': (el) => { state.tab = el.dataset.id; renderView(); },
    'mtab': (el) => { state.mtab = el.dataset.id; renderView(); },
    'chip': (el) => {
      state.filters[el.dataset.key] = el.dataset.value;
      if (el.dataset.key === 'calView') state.calView = el.dataset.value;
      renderView();
    },
    'cal-move': (el) => {
      const dir = Number(el.dataset.value);
      if (state.calView === 'month') {
        const d = new Date(state.calCursor + 'T00:00:00');
        d.setDate(1); d.setMonth(d.getMonth() + dir);
        state.calCursor = iso(d);
      } else {
        state.calCursor = addDays(state.calCursor, dir * (state.calView === 'week' ? 7 : 1));
      }
      renderView();
    },
    'cal-today': () => { state.calCursor = todayISO(); renderView(); },
    'cal-day': (el) => { state.calCursor = el.dataset.value; state.calView = 'day'; state.filters.calView = 'day'; renderView(); },

    'switch': (el) => {
      const c = activeContact();
      const key = el.dataset.key;
      c[key] = !c[key];
      touchContact(c); saveData();
      el.setAttribute('aria-checked', String(c[key]));
      showToast(el.dataset.label, c[key] ? 'Preference enabled.' : 'Preference disabled.', c[key] ? 'warning' : 'info');
    },
    'setting-toggle': (el) => {
      const key = el.dataset.key, scope = el.dataset.scope;
      const next = el.getAttribute('aria-checked') !== 'true';
      if (scope === 'notify') DB.settings.notify[key] = next;
      else if (key === 'density') DB.settings.density = next ? 'compact' : 'comfortable';
      else DB.settings[key] = next;
      el.setAttribute('aria-checked', String(next));
      applySettings(); saveData();
      showToast(el.dataset.label, next ? 'Enabled.' : 'Disabled.', 'success');
    },
    'toggle-integration': (el) => {
      const key = el.dataset.key;
      DB.settings.integrations[key] = !DB.settings.integrations[key];
      saveData(); updateUI();
      showToast(el.dataset.label, DB.settings.integrations[key] ? 'Connected — meetings will sync.' : 'Disconnected.', DB.settings.integrations[key] ? 'success' : 'info');
    },
    'export-report': () => exportReport(),
    'reset-report': () => {
      ['rFrom', 'rTo', 'rUser', 'rCustomer', 'rType'].forEach((k) => delete state.filters[k]);
      renderView();
      showToast('Filters cleared', 'Showing the default range.', 'info');
    },
    'del-post': (el) => {
      const index = DB.feed.findIndex((p) => p.id === el.dataset.id);
      if (index < 0) return;
      const [removed] = DB.feed.splice(index, 1);
      saveData(); updateUI();
      showToast('Update deleted', '', 'danger', { actionLabel: 'Undo', onAction: () => { DB.feed.splice(index, 0, removed); saveData(); updateUI(); } });
    },

    'organizer': (el) => openOrganizerModal(el.dataset.id),
    'admin-view': () => openAdminProfile(),
    'admin-edit': () => openAdminForm(),
    'admin-settings': () => { closeModal(); go('settings'); },
    'admin-logout': () => logout(),
    'reset-data': () => confirmModal({
      title: 'Reset workspace?', sub: 'This cannot be undone',
      message: 'Every meeting, contact, note, action item and setting you created will be replaced with the original sample workspace.',
      confirmLabel: 'Reset everything', iconName: 'refresh',
      onConfirm: () => {
        resetData(); applySettings(); closeModal();
        go('dashboard'); updateUI();
        showToast('Workspace reset', 'The sample Meeting 360 workspace has been restored.', 'success');
      }
    })
  };

  function runAction(name, el) {
    if (name.startsWith('new:')) { openRecordForm(name.slice(4), null, null); return; }
    const fn = ACTIONS[name];
    if (fn) fn(el);
  }

  function bindEvents() {
    document.addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-dropdown-toggle]');
      if (toggle) {
        e.stopPropagation();
        const wrap = toggle.closest('[data-dropdown]');
        const menu = wrap && $('[data-dropdown-menu]', wrap);
        // aria-expanded is the single source of truth for open state — reading
        // back the `hidden` property proved unreliable and left menus stuck shut.
        const wasOpen = toggle.getAttribute('aria-expanded') === 'true';
        closeDropdowns();
        if (menu && !wasOpen) {
          menu.hidden = false;
          menu.removeAttribute('hidden');
          toggle.setAttribute('aria-expanded', 'true');
        }
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

    /* Filter inputs inside views */
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
        if (next) { next.focus(); const v = next.value; next.value = ''; next.value = v; }
      }, 200);
    });

    /* Select / date filters and settings inputs */
    $('#view').addEventListener('change', (e) => {
      const sel = e.target.closest('[data-filter-select]');
      if (sel) { state.filters[sel.dataset.filterSelect] = sel.value; renderView(); return; }

      const setting = e.target.closest('[data-setting-input]');
      if (setting) {
        const key = setting.dataset.settingInput;
        DB.settings[key] = setting.type === 'number' ? Number(setting.value) : setting.value;
        saveData();
        showToast('Setting saved', `${key.replace(/([A-Z])/g, ' $1').toLowerCase()} updated.`, 'success');
        return;
      }
      const perm = e.target.closest('[data-act-change="permission"]');
      if (perm) {
        const user = DB.team.find((u) => u.id === perm.dataset.id);
        if (user) { user.permission = perm.value; saveData(); showToast('Permission updated', `${user.name} is now ${perm.value}.`, 'success'); }
      }
    });

    /* Keyboard */
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
        e.preventDefault(); Search.open();
      }
    });

    /* Mobile navigation */
    const burger = $('#burgerBtn'), nav = $('#primaryNav'), scrim = $('#navScrim');
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

    /* Notification header actions */
    $('#markAllRead').addEventListener('click', (e) => {
      e.stopPropagation();
      DB.notifications.forEach((n) => { n.unread = false; });
      saveData(); renderNotifications();
      showToast('Notifications read', 'All notifications marked as read.', 'success');
    });
    $('#clearNotifs').addEventListener('click', (e) => {
      e.stopPropagation();
      DB.notifications = [];
      saveData(); renderNotifications();
      showToast('Notifications cleared', '', 'info');
    });

    $('#signBackIn').addEventListener('click', () => {
      $('#lockScreen').hidden = true;
      document.body.style.overflow = '';
      showToast(`Welcome back, ${DB.admin.name.split(' ')[0]}`, 'Your workspace is exactly as you left it.', 'success');
    });

    window.addEventListener('hashchange', handleRoute);
  }

  /* ======================================================================
     19b. CRM HOST — widget popup sizing
     ====================================================================== */
  /**
   * A custom-button widget opens in a small CRM popup and only the host can
   * resize it, through the embedded-app SDK. The SDK is fetched on demand and
   * every step is optional: outside CRM it never arrives, and the app renders
   * exactly as it does now.
   */
  const ZOHO_SDK_URL = 'https://live.zwidgets.com/js-sdk/1.1/ZohoEmbededAppSDK.min.js';
  const POPUP_SIZE = { width: '92%', height: '92%' };
  const POPUP_SIZE_PX = { width: '1440', height: '900' };   // hosts that reject percentages

  const isEmbedded = () => {
    try { return window.top !== window.self; } catch (err) { return true; }
  };

  function loadZohoSdk() {
    if (window.ZOHO && window.ZOHO.embeddedApp) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = ZOHO_SDK_URL;
      tag.async = true;
      tag.onload = () => (window.ZOHO && window.ZOHO.embeddedApp
        ? resolve() : reject(new Error('SDK loaded without the ZOHO global')));
      tag.onerror = () => reject(new Error('SDK could not be fetched'));
      document.head.appendChild(tag);
    });
  }

  function resizeCrmPopup(size) {
    const ui = window.ZOHO && window.ZOHO.CRM && window.ZOHO.CRM.UI;
    if (!ui || typeof ui.Resize !== 'function') return Promise.reject(new Error('CRM.UI.Resize missing'));
    return Promise.resolve(ui.Resize(size || POPUP_SIZE))
      .catch(() => ui.Resize(POPUP_SIZE_PX));
  }

  function fitInsideCrm() {
    if (!isEmbedded()) return Promise.resolve();
    return loadZohoSdk()
      .then(() => {
        const app = window.ZOHO.embeddedApp;
        /* register before init, or the first PageLoad is missed */
        if (typeof app.on === 'function') app.on('PageLoad', () => resizeCrmPopup());
        return Promise.resolve(typeof app.init === 'function' ? app.init() : null);
      })
      .then(() => resizeCrmPopup())
      .catch((err) => console.info('[Meeting 360] CRM popup resize unavailable —', err && err.message ? err.message : err));
  }

  /* ======================================================================
     20. BOOTSTRAP
     ====================================================================== */
  function init() {
    fitInsideCrm();
    applyBrand();
    loadData();
    console.info('[Meeting 360] ' + buildStamp());
    migrateRelations();
    syncAdminToTeam();
    seedNotifications();
    applySettings();
    renderAdmin();
    renderNotifications();
    Search.init();
    bindEvents();
    handleRoute();
    saveData();

    setTimeout(() => {
      const t = todaysMeetings().length;
      showToast(`Welcome back, ${DB.admin.name.split(' ')[0]}`,
        t ? `You have ${t} meeting${t === 1 ? '' : 's'} today — everything here is live and saved to this device.`
          : 'No meetings today. Everything here is live and saved to this device.', 'info', { timeout: 5200 });
      /* Which build is actually running, visible without opening Settings. */
      showToast('Build', buildStamp(), 'info', { timeout: 9000 });
    }, 800);
  }

  /* The loader in index.html injects this file once the DOM is already
     parsed, so waiting on DOMContentLoaded alone would never fire. Boot
     immediately when the document is ready, otherwise wait as before. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
