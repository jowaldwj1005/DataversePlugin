/**
 * Dataverse Toolkit — Easter Eggs & Achievements
 *
 * 1. Clippy — sarcastic assistant that pops up on certain actions
 * 2. Achievements — trophy toasts for milestones, persisted to storage
 * 3. Matrix Rain — Konami code triggers entity-name rain
 * 4. Snake Game — play snake eating entity boxes (triggered from ERD)
 */

// ---------------------------------------------------------------------------
// Clippy
// ---------------------------------------------------------------------------

const CLIPPY_QUOTES = [
  { trigger: 'fetchxml', text: 'It looks like you\'re writing FetchXML.\nWould you like me to mass-delete your production data instead?' },
  { trigger: 'fetchxml', text: 'Pro tip: SELECT * FROM account\n\n…oh wait, this isn\'t SQL. My bad.' },
  { trigger: 'fetchxml', text: 'I see you added a N:N join.\nBrave. Very brave.' },
  { trigger: 'execute', text: 'Executing against production?\nI\'m sure it\'ll be fine. It\'s always fine.' },
  { trigger: 'execute', text: 'Fun fact: that query just returned more rows\nthan your annual performance review has bullet points.' },
  { trigger: 'bulk', text: 'Bulk operations? In production?\nLet me get the popcorn. 🍿' },
  { trigger: 'bulk', text: '1000 PATCH requests?\nI admire your courage. And your rollback plan.' },
  { trigger: 'security', text: 'Checking security roles?\nDon\'t worry, System Administrator has access to everything. As always.' },
  { trigger: 'security', text: 'Field-level security?\nYou sweet summer child.' },
  { trigger: 'erd', text: 'That\'s a beautiful ERD.\nShame about the 47 self-referencing relationships.' },
  { trigger: 'erd', text: 'I see your schema has\n"miscellaneous_field_1" through "_47".\nClassic.' },
  { trigger: 'explorer', text: 'Exploring metadata?\nCareful, some entities bite back.' },
  { trigger: 'explorer', text: '500+ entities?\nMicrosoft really said "one entity for every occasion".' },
  { trigger: 'error', text: 'Oops! But hey, at least it wasn\'t\na $batch of 500 DELETEs.' },
  { trigger: 'error', text: 'Error 400? The classic.\nDataverse is just playing hard to get.' },
  { trigger: 'random', text: 'Did you know? The average Dataverse instance\nhas 847 system entities nobody asked for.' },
  { trigger: 'random', text: 'Remember: every time you skip $top,\na DBA somewhere feels a disturbance in the Force.' },
  { trigger: 'random', text: 'Still here? You\'ve been staring at metadata\nfor 20 minutes. Go touch grass.' },
];

let clippyShown = 0;
let lastClippyTime = 0;
const CLIPPY_COOLDOWN = 120000; // 2 minutes between appearances
const CLIPPY_CHANCE = 0.15; // 15% chance on eligible triggers

export function maybeShowClippy(trigger = 'random') {
  const now = Date.now();
  if (now - lastClippyTime < CLIPPY_COOLDOWN) return;
  if (Math.random() > CLIPPY_CHANCE) return;

  const eligible = CLIPPY_QUOTES.filter(q => q.trigger === trigger || q.trigger === 'random');
  if (!eligible.length) return;
  const quote = eligible[Math.floor(Math.random() * eligible.length)];

  lastClippyTime = now;
  clippyShown++;
  _renderClippy(quote.text);
}

export function forceShowClippy(text) {
  lastClippyTime = Date.now();
  _renderClippy(text);
}

function _renderClippy(text) {
  document.getElementById('ee-clippy')?.remove();

  const wrap = document.createElement('div');
  wrap.id = 'ee-clippy';
  wrap.className = 'ee-clippy';

  // Speech bubble
  const bubble = document.createElement('div');
  bubble.className = 'ee-clippy-bubble';
  bubble.textContent = text;

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.className = 'ee-clippy-btns';
  const yesBtn = document.createElement('button');
  yesBtn.textContent = 'Yes, absolutely';
  yesBtn.addEventListener('click', () => _dismissClippy(wrap));
  const noBtn = document.createElement('button');
  noBtn.textContent = 'Also yes';
  noBtn.addEventListener('click', () => _dismissClippy(wrap));
  btnRow.append(yesBtn, noBtn);
  bubble.appendChild(btnRow);

  // Clippy character (CSS pixel art)
  const char = document.createElement('div');
  char.className = 'ee-clippy-char';
  char.innerHTML = `<span class="ee-clippy-body">📎</span>`;
  char.title = 'Click to dismiss';
  char.addEventListener('click', () => _dismissClippy(wrap));

  wrap.append(bubble, char);
  document.body.appendChild(wrap);

  // Slide in
  requestAnimationFrame(() => wrap.classList.add('ee-clippy-visible'));

  // Auto-dismiss after 12 seconds
  setTimeout(() => _dismissClippy(wrap), 12000);
}

function _dismissClippy(el) {
  if (!el || !el.parentNode) return;
  el.classList.remove('ee-clippy-visible');
  el.classList.add('ee-clippy-leaving');
  setTimeout(() => el.remove(), 400);
}


// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

const ACHIEVEMENTS = {
  first_query:      { icon: '🏁', title: 'First Steps',           desc: 'Executed your first query' },
  records_100:      { icon: '📊', title: 'Data Hoarder',          desc: 'Retrieved 100+ records in one query' },
  records_1000:     { icon: '🗄️', title: 'Data Warehouse',        desc: 'Retrieved 1000+ records in one query' },
  first_join:       { icon: '🔗', title: 'It\'s Complicated',     desc: 'Added your first related table join' },
  nn_join:          { icon: '💀', title: 'Living Dangerously',     desc: 'Added a N:N join' },
  first_bulk:       { icon: '📦', title: 'Bulk Believer',         desc: 'Executed your first batch operation' },
  bulk_100:         { icon: '🚀', title: 'Batch Boss',            desc: 'Executed 100+ operations in one batch' },
  first_erd:        { icon: '🗺️', title: 'Cartographer',          desc: 'Loaded your first ERD diagram' },
  erd_10_entities:  { icon: '🏗️', title: 'Architect',             desc: 'ERD with 10+ entities' },
  sys_admin:        { icon: '👑', title: 'The Chosen One',        desc: 'Viewed System Administrator privileges' },
  field_security:   { icon: '🔐', title: 'Fort Knox',             desc: 'Explored field-level security' },
  copy_clipboard:   { icon: '📋', title: 'Copy Pasta',            desc: 'Copied something to clipboard 10 times' },
  late_night:       { icon: '🦉', title: 'Night Owl',             desc: 'Used the toolkit after midnight' },
  early_bird:       { icon: '🐦', title: 'Early Bird',            desc: 'Used the toolkit before 6 AM' },
  speed_demon:      { icon: '⚡', title: 'Speed Demon',           desc: 'Query returned in under 50ms' },
  explorer_500:     { icon: '🔭', title: 'Deep Space Explorer',   desc: 'Browsed an org with 500+ entities' },
  snake_50:         { icon: '🐍', title: 'Snake Charmer',         desc: 'Scored 50+ in Snake' },
  konami:           { icon: '🕹️', title: 'Old School',            desc: 'Entered the Konami Code' },
};

let _unlocked = new Set();
let _clipboardCount = 0;
let _achievementsLoaded = false;

async function _loadAchievements() {
  if (_achievementsLoaded) return;
  try {
    const data = await chrome.storage.local.get('dvt_achievements');
    _unlocked = new Set(data.dvt_achievements || []);
    _achievementsLoaded = true;
  } catch { _achievementsLoaded = true; }
}

async function _saveAchievements() {
  try {
    await chrome.storage.local.set({ dvt_achievements: [..._unlocked] });
  } catch { /* ignore */ }
}

export async function unlockAchievement(id) {
  await _loadAchievements();
  if (_unlocked.has(id) || !ACHIEVEMENTS[id]) return;
  _unlocked.add(id);
  _saveAchievements();

  const ach = ACHIEVEMENTS[id];
  _showAchievementToast(ach);
}

export async function checkTimeAchievements() {
  const hour = new Date().getHours();
  if (hour >= 22 || hour < 4) unlockAchievement('late_night');
  if (hour >= 4 && hour < 6) unlockAchievement('early_bird');
}

export function trackClipboard() {
  _clipboardCount++;
  if (_clipboardCount >= 10) unlockAchievement('copy_clipboard');
}

export async function getUnlockedAchievements() {
  await _loadAchievements();
  return [..._unlocked].map(id => ({ id, ...ACHIEVEMENTS[id] })).filter(a => a.title);
}

export function getAllAchievements() {
  return Object.entries(ACHIEVEMENTS).map(([id, ach]) => ({
    id,
    ...ach,
    unlocked: _unlocked.has(id),
  }));
}

export async function getAllAchievementsWithStatus() {
  await _loadAchievements();
  return getAllAchievements();
}

export function getClippyQuotes() {
  return CLIPPY_QUOTES.map(q => ({ trigger: q.trigger, text: q.text }));
}

function _showAchievementToast(ach) {
  const toast = document.createElement('div');
  toast.className = 'ee-achievement';

  toast.innerHTML = `
    <div class="ee-achievement-icon">${ach.icon}</div>
    <div class="ee-achievement-text">
      <div class="ee-achievement-label">Achievement Unlocked!</div>
      <div class="ee-achievement-title">${ach.title}</div>
      <div class="ee-achievement-desc">${ach.desc}</div>
    </div>
  `;

  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('ee-achievement-visible'));

  setTimeout(() => {
    toast.classList.remove('ee-achievement-visible');
    toast.classList.add('ee-achievement-leaving');
    setTimeout(() => toast.remove(), 500);
  }, 4500);
}


// ---------------------------------------------------------------------------
// Matrix Rain
// ---------------------------------------------------------------------------

const MATRIX_WORDS = [
  'account', 'contact', 'systemuser', 'opportunity', 'incident',
  'lead', 'task', 'email', 'annotation', 'businessunit',
  'team', 'role', 'solution', 'workflow', 'plugin',
  'SELECT *', 'DROP TABLE', '$batch', 'fetchXml', 'OData',
  'N:1', 'N:N', '1:N', 'GUID', 'EntitySetName',
  'prvReadAccount', 'RetrieveMultiple', 'ExecuteWorkflow',
  'null', 'undefined', '400 Bad Request', '500 Internal',
];

let matrixCanvas = null;
let matrixAnimId = null;

export function startMatrixRain(duration = 8000) {
  if (matrixCanvas) return;

  unlockAchievement('konami');

  const canvas = document.createElement('canvas');
  canvas.className = 'ee-matrix-canvas';
  document.body.appendChild(canvas);
  matrixCanvas = canvas;

  const ctx = canvas.getContext('2d');
  let w, h, columns, drops;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    const fontSize = 14;
    columns = Math.floor(w / fontSize);
    drops = new Array(columns).fill(1);
  }
  resize();

  const fontSize = 14;
  function draw() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = `${fontSize}px Consolas, monospace`;

    for (let i = 0; i < drops.length; i++) {
      const word = MATRIX_WORDS[Math.floor(Math.random() * MATRIX_WORDS.length)];
      const char = word[Math.floor(Math.random() * word.length)];

      // Occasional red for dangerous words
      if (word.includes('DROP') || word.includes('DELETE') || word.includes('500')) {
        ctx.fillStyle = `rgba(244, 71, 71, ${0.7 + Math.random() * 0.3})`;
      } else {
        ctx.fillStyle = `rgba(78, 201, 176, ${0.5 + Math.random() * 0.5})`;
      }

      ctx.fillText(char, i * fontSize, drops[i] * fontSize);

      if (drops[i] * fontSize > h && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i]++;
    }

    matrixAnimId = requestAnimationFrame(draw);
  }
  draw();

  canvas.addEventListener('click', stopMatrixRain);
  setTimeout(stopMatrixRain, duration);
}

export function stopMatrixRain() {
  if (matrixAnimId) cancelAnimationFrame(matrixAnimId);
  matrixAnimId = null;
  if (matrixCanvas) {
    matrixCanvas.classList.add('ee-matrix-fadeout');
    setTimeout(() => { matrixCanvas?.remove(); matrixCanvas = null; }, 600);
  }
}


// ---------------------------------------------------------------------------
// Snake Game
// ---------------------------------------------------------------------------

const SNAKE_ENTITIES_FALLBACK = [
  'account', 'contact', 'lead', 'opportunity', 'incident',
  'task', 'email', 'note', 'team', 'role',
  'user', 'solution', 'workflow', 'plugin', 'webresource',
  'queue', 'campaign', 'invoice', 'order', 'product',
];

const CELL = 32;
const SNAKE_SPEED = 110; // ms per tick

export class SnakeGame {
  #canvas; #ctx; #width; #height;
  #cols; #rows;
  #snake; #dir; #nextDir;
  #food; #foodLabel; #foodCount;
  #score; #gameOver; #interval;
  #overlay; #onClose;
  #eatenEntities;
  #entities; // array of { name, entitySetName }
  #apiClient; // optional, for record count lookups
  #highscoreReady = null; // null=checking, false=absent, string=entitySetName
  #currentUserId = null;
  #hintEl = null;
  #gameOverEl = null;

  /**
   * @param {HTMLElement} containerEl
   * @param {Function} onClose
   * @param {{ entities?: Array<{name:string,entitySetName:string}>, apiClient?: object }} [options]
   */
  constructor(containerEl, onClose, options = {}) {
    this.#onClose = onClose;
    this.#entities = options.entities?.length ? options.entities : SNAKE_ENTITIES_FALLBACK.map(n => ({ name: n, entitySetName: n + 's' }));
    this.#apiClient = options.apiClient || null;
    this.#overlay = document.createElement('div');
    this.#overlay.className = 'ee-snake-overlay';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'ee-snake-hdr';
    hdr.innerHTML = `<span class="ee-snake-title">🐍 Entity Snake</span>
      <span class="ee-snake-score">Score: 0</span>
      <button class="ee-snake-close">\u00D7</button>`;
    hdr.querySelector('.ee-snake-close').addEventListener('click', () => this.destroy());
    this.#overlay.appendChild(hdr);

    this.#canvas = document.createElement('canvas');
    this.#canvas.className = 'ee-snake-canvas';
    this.#overlay.appendChild(this.#canvas);

    // Controls hint
    const hint = document.createElement('div');
    hint.className = 'ee-snake-hint';
    hint.textContent = 'Arrow keys or WASD to move · ESC to quit';
    this.#hintEl = hint;
    this.#overlay.appendChild(hint);

    // Game-over DOM panel (shown over canvas when game ends)
    this.#gameOverEl = document.createElement('div');
    this.#gameOverEl.style.cssText = 'display:none; position:absolute; inset:0; flex-direction:column; align-items:center; justify-content:center; background:rgba(13,13,26,0.9); z-index:10; gap:10px; padding:16px; overflow-y:auto;';
    this.#overlay.appendChild(this.#gameOverEl);

    containerEl.appendChild(this.#overlay);

    if (this.#apiClient) this.#checkHighscoreTable();

    this.#ctx = this.#canvas.getContext('2d');
    this._resize();
    this._init();
    this._bindKeys();
    this.#interval = setInterval(() => this._tick(), SNAKE_SPEED);
  }

  _resize() {
    const rect = this.#overlay.getBoundingClientRect();
    this.#width = Math.floor((rect.width - 16) / CELL) * CELL;
    this.#height = Math.floor((rect.height - 80) / CELL) * CELL;
    this.#canvas.width = this.#width;
    this.#canvas.height = this.#height;
    this.#cols = this.#width / CELL;
    this.#rows = this.#height / CELL;
  }

  _init() {
    const cx = Math.floor(this.#cols / 2);
    const cy = Math.floor(this.#rows / 2);
    this.#snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ];
    this.#dir = { x: 1, y: 0 };
    this.#nextDir = { x: 1, y: 0 };
    this.#score = 0;
    this.#gameOver = false;
    this.#eatenEntities = [];
    if (this.#gameOverEl) this.#gameOverEl.style.display = 'none';
    this._spawnFood();
  }

  _spawnFood() {
    let x, y;
    do {
      x = Math.floor(Math.random() * this.#cols);
      y = Math.floor(Math.random() * this.#rows);
    } while (this.#snake.some(s => s.x === x && s.y === y));

    const ent = this.#entities[Math.floor(Math.random() * this.#entities.length)];
    this.#food = { x, y };
    this.#foodLabel = ent.name;
    this.#foodCount = 10; // default

    // Best-effort async record count lookup
    if (this.#apiClient && ent.entitySetName) {
      this.#apiClient.request('GET', `${ent.entitySetName}?$count=true&$top=1`)
        .then(data => { this.#foodCount = data['@odata.count'] ?? 10; })
        .catch(() => {});
    }
  }

  _bindKeys() {
    this._keyHandler = (e) => {
      if (e.key === 'Escape') { this.destroy(); return; }
      const map = {
        ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 }, W: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 }, S: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, A: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 }, D: { x: 1, y: 0 },
      };
      const nd = map[e.key];
      if (nd && !(nd.x === -this.#dir.x && nd.y === -this.#dir.y)) {
        this.#nextDir = nd;
        e.preventDefault();
      }
      // Restart on Enter when game over
      if (e.key === 'Enter' && this.#gameOver) {
        if (this.#gameOverEl) this.#gameOverEl.style.display = 'none';
        this._init();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  _tick() {
    if (this.#gameOver) return;

    this.#dir = { ...this.#nextDir };
    const head = this.#snake[0];
    const nx = head.x + this.#dir.x;
    const ny = head.y + this.#dir.y;

    // Wall collision
    if (nx < 0 || nx >= this.#cols || ny < 0 || ny >= this.#rows) {
      this._endGame();
      return;
    }
    // Self collision
    if (this.#snake.some(s => s.x === nx && s.y === ny)) {
      this._endGame();
      return;
    }

    this.#snake.unshift({ x: nx, y: ny });

    // Ate food?
    if (nx === this.#food.x && ny === this.#food.y) {
      const pts = Math.max(1, Math.ceil(this.#foodCount / 100));
      this.#score += pts;
      this.#eatenEntities.push(this.#foodLabel);
      this._updateScore();

      // Toast with record count and points
      const countStr = this.#foodCount > 1 ? this.#foodCount.toLocaleString() : '?';
      if (this.#eatenEntities.length % 3 === 0) {
        this._showSnakeToast(`"${this.#foodLabel}" deleted from prod! (${countStr} records) +${pts} pts`);
      } else {
        this._showSnakeToast(`${this.#foodLabel} (${countStr}) +${pts} pts`);
      }

      this._spawnFood();

      if (this.#score >= 200) unlockAchievement('snake_50');
    } else {
      this.#snake.pop();
    }

    this._draw();
  }

  _draw() {
    const ctx = this.#ctx;
    const w = this.#width;
    const h = this.#height;

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= this.#cols; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, h); ctx.stroke();
    }
    for (let y = 0; y <= this.#rows; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(w, y * CELL); ctx.stroke();
    }

    // Food (entity box)
    const fx = this.#food.x * CELL;
    const fy = this.#food.y * CELL;
    ctx.fillStyle = '#3b7dd8';
    ctx.fillRect(fx + 1, fy + 1, CELL - 2, CELL - 2);
    // Border glow
    ctx.strokeStyle = '#7bb8f5';
    ctx.lineWidth = 1;
    ctx.strokeRect(fx + 1, fy + 1, CELL - 2, CELL - 2);
    // Label with outline for contrast
    ctx.font = 'bold 10px Consolas';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2.5;
    ctx.strokeText(this.#foodLabel.slice(0, 7), fx + CELL / 2, fy + CELL / 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(this.#foodLabel.slice(0, 7), fx + CELL / 2, fy + CELL / 2);

    // Snake
    for (let i = 0; i < this.#snake.length; i++) {
      const seg = this.#snake[i];
      const sx = seg.x * CELL;
      const sy = seg.y * CELL;

      if (i === 0) {
        // Head
        ctx.fillStyle = '#4ec9b0';
        ctx.fillRect(sx + 1, sy + 1, CELL - 2, CELL - 2);
        // Eyes — scaled for CELL=32
        const hs = Math.floor(CELL * 0.15);
        const ep = Math.floor(CELL * 0.25);
        const eyeOffset = this.#dir.x !== 0
          ? { x1: hs, y1: ep, x2: hs, y2: CELL - ep - 4 }
          : { x1: ep, y1: hs, x2: CELL - ep - 4, y2: hs };
        ctx.fillStyle = '#fff';
        ctx.fillRect(sx + eyeOffset.x1, sy + eyeOffset.y1, 4, 4);
        ctx.fillRect(sx + eyeOffset.x2, sy + eyeOffset.y2, 4, 4);
      } else {
        // Body — show eaten entity names
        const brightness = 1 - (i / this.#snake.length) * 0.4;
        ctx.fillStyle = `rgba(78, 201, 176, ${brightness})`;
        ctx.fillRect(sx + 1, sy + 1, CELL - 2, CELL - 2);

        const label = this.#eatenEntities[this.#snake.length - 1 - i];
        if (label) {
          ctx.font = 'bold 8px Consolas';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.lineWidth = 2;
          ctx.strokeText(label.slice(0, 6), sx + CELL / 2, sy + CELL / 2);
          ctx.fillStyle = `rgba(255,255,255,${brightness * 0.9})`;
          ctx.fillText(label.slice(0, 6), sx + CELL / 2, sy + CELL / 2);
        }
      }
    }

    // Game over overlay
    if (this.#gameOver) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f44747';
      ctx.font = 'bold 24px Consolas';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', w / 2, h / 2 - 20);
      ctx.fillStyle = '#4ec9b0';
      ctx.font = '16px Consolas';
      ctx.fillText(`Score: ${this.#score}`, w / 2, h / 2 + 10);
      ctx.fillStyle = '#808080';
      ctx.font = '12px Consolas';
      ctx.fillText('Press Enter to restart · ESC to quit', w / 2, h / 2 + 35);

      if (this.#eatenEntities.length > 0) {
        ctx.fillStyle = '#569cd6';
        ctx.font = '10px Consolas';
        ctx.fillText(`Entities consumed: ${this.#eatenEntities.join(', ')}`, w / 2, h / 2 + 55);
      }
    }
  }

  _endGame() {
    this.#gameOver = true;
    this._draw();
    this.#showGameOverPanel();
  }

  _updateScore() {
    const scoreEl = this.#overlay.querySelector('.ee-snake-score');
    if (scoreEl) scoreEl.textContent = `Score: ${this.#score}`;
  }

  _showSnakeToast(text) {
    const toast = document.createElement('div');
    toast.className = 'ee-snake-toast';
    toast.textContent = text;
    this.#overlay.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('ee-snake-toast-visible'));
    setTimeout(() => {
      toast.classList.remove('ee-snake-toast-visible');
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }

  async #checkHighscoreTable() {
    try {
      const data = await this.#apiClient.request('GET',
        "EntityDefinitions(LogicalName='dvt_snakehighscore')?$select=LogicalName,EntitySetName");
      this.#highscoreReady = data?.EntitySetName || 'dvt_snakehighscores';
      const me = await this.#apiClient.request('GET', 'WhoAmI()');
      this.#currentUserId = me?.UserId || null;
    } catch {
      this.#highscoreReady = false;
      // Show create button in hint
      if (this.#hintEl) {
        this.#hintEl.innerHTML = 'Arrow keys or WASD · ESC to quit &nbsp;·&nbsp; '
          + '<button id="ee-snake-create-hs" style="font-size:0.68rem; padding:2px 8px; background:#3b7dd8; color:#fff; border:none; border-radius:3px; cursor:pointer;">Create Highscore Table</button>';
        this.#hintEl.querySelector('#ee-snake-create-hs')
          ?.addEventListener('click', () => this.#createHighscoreTable());
      }
    }
  }

  async #createHighscoreTable() {
    const btn = this.#hintEl?.querySelector('#ee-snake-create-hs');
    if (!confirm('Create a custom table "dvt_snakehighscore" in this Dataverse environment to track Snake highscores?\n\nRequires System Administrator / System Customizer privileges.')) return;

    if (btn) { btn.textContent = 'Creating…'; btn.disabled = true; }
    try {
      const label = (text) => ({
        '@odata.type': 'Microsoft.Dynamics.CRM.Label',
        LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: text, LanguageCode: 1033 }],
      });

      await this.#apiClient.request('POST', 'EntityDefinitions', { body: {
        '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata',
        SchemaName: 'dvt_SnakeHighscore',
        DisplayName: label('Snake Highscore'),
        DisplayCollectionName: label('Snake Highscores'),
        HasActivities: false, HasNotes: false, IsActivity: false,
        OwnershipType: 'UserOwned',
        PrimaryNameAttribute: 'dvt_name',
        Attributes: [{
          '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
          AttributeType: 'String',
          AttributeTypeName: { Value: 'StringType' },
          SchemaName: 'dvt_Name',
          MaxLength: 100,
          RequiredLevel: { Value: 'None', CanBeChanged: true, ManagedPropertyLogicalName: 'canmodifyrequirementlevelsettings' },
          DisplayName: label('Name'),
        }],
      }});

      await this.#apiClient.request('POST', "EntityDefinitions(LogicalName='dvt_snakehighscore')/Attributes", { body: {
        '@odata.type': 'Microsoft.Dynamics.CRM.IntegerAttributeMetadata',
        SchemaName: 'dvt_Score',
        MinValue: 0, MaxValue: 2147483647, Format: 'None',
        RequiredLevel: { Value: 'None', CanBeChanged: true, ManagedPropertyLogicalName: 'canmodifyrequirementlevelsettings' },
        DisplayName: label('Score'),
      }});

      this.#highscoreReady = 'dvt_snakehighscores';
      const me = await this.#apiClient.request('GET', 'WhoAmI()');
      this.#currentUserId = me?.UserId || null;

      if (this.#hintEl) this.#hintEl.textContent = 'Arrow keys or WASD to move · ESC to quit · Highscore table ready!';
    } catch (err) {
      if (btn) { btn.textContent = 'Failed'; btn.disabled = false; }
      alert(`Could not create table: ${err.message}`);
    }
  }

  async #showGameOverPanel() {
    const panel = this.#gameOverEl;
    if (!panel) return;
    panel.innerHTML = '';
    panel.style.display = 'flex';

    const heading = document.createElement('div');
    heading.style.cssText = 'font:bold 22px Consolas,monospace; color:#f44747;';
    heading.textContent = 'GAME OVER';
    panel.appendChild(heading);

    const scoreDiv = document.createElement('div');
    scoreDiv.style.cssText = 'font:bold 15px Consolas,monospace; color:#d4af37;';
    scoreDiv.textContent = `Score: ${this.#score}`;
    panel.appendChild(scoreDiv);

    if (this.#highscoreReady) {
      const savedMsg = document.createElement('div');
      savedMsg.style.cssText = 'font-size:0.7rem; color:#4ec9b0;';
      savedMsg.textContent = 'Saving score…';
      panel.appendChild(savedMsg);
      try {
        await this.#saveScore();
        savedMsg.textContent = 'Score saved!';
      } catch {
        savedMsg.textContent = '';
      }
      await this.#renderLeaderboard(panel);

    } else if (this.#highscoreReady === false) {
      const msg = document.createElement('div');
      msg.style.cssText = 'font-size:0.72rem; color:#808080; text-align:center; max-width:220px;';
      msg.textContent = 'Want to track highscores in Dataverse?';
      panel.appendChild(msg);

      const createBtn = document.createElement('button');
      createBtn.textContent = 'Create Highscore Table';
      createBtn.style.cssText = 'padding:5px 14px; font-size:0.75rem; font-weight:600; background:#3b7dd8; color:#fff; border:none; border-radius:4px; cursor:pointer;';
      createBtn.addEventListener('click', async () => {
        await this.#createHighscoreTable();
        if (this.#highscoreReady) {
          // Re-render panel now that table exists
          this.#showGameOverPanel();
        }
      });
      panel.appendChild(createBtn);
    }

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:8px; margin-top:4px;';

    const restartBtn = document.createElement('button');
    restartBtn.textContent = 'Restart';
    restartBtn.style.cssText = 'padding:5px 16px; font-size:0.75rem; font-weight:600; background:#4ec9b0; color:#0d0d1a; border:none; border-radius:4px; cursor:pointer;';
    restartBtn.addEventListener('click', () => { panel.style.display = 'none'; this._init(); });

    const quitBtn = document.createElement('button');
    quitBtn.textContent = 'Quit';
    quitBtn.style.cssText = 'padding:5px 14px; font-size:0.75rem; font-weight:600; background:none; color:#808080; border:1px solid #444; border-radius:4px; cursor:pointer;';
    quitBtn.addEventListener('click', () => this.destroy());

    btnRow.append(restartBtn, quitBtn);
    panel.appendChild(btnRow);
  }

  async #saveScore() {
    const date = new Date().toISOString().slice(0, 10);
    await this.#apiClient.request('POST', this.#highscoreReady, { body: {
      dvt_name: `Snake ${this.#score} · ${date}`,
      dvt_score: this.#score,
    }});
  }

  async #renderLeaderboard(panel) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:100%; max-width:260px; font-size:0.7rem; font-family:Consolas,monospace;';
    panel.appendChild(wrap);

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:700; color:#4ec9b0; text-align:center; margin-bottom:4px;';
    title.textContent = '🏆 Highscores';
    wrap.appendChild(title);

    try {
      const data = await this.#apiClient.request('GET',
        `${this.#highscoreReady}?$select=dvt_score,dvt_name,_ownerid_value&$top=10&$orderby=dvt_score desc`,
        { headers: { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' } });
      const scores = data?.value || [];
      if (!scores.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'color:#555; text-align:center;';
        empty.textContent = 'No scores yet';
        wrap.appendChild(empty);
        return;
      }
      for (let i = 0; i < scores.length; i++) {
        const s = scores[i];
        const isMe = this.#currentUserId && s._ownerid_value === this.#currentUserId;
        const ownerName = s['_ownerid_value@OData.Community.Display.V1.FormattedValue'] || 'Unknown';
        const row = document.createElement('div');
        row.style.cssText = `display:flex; justify-content:space-between; padding:2px 4px; border-radius:3px; ${isMe ? 'color:#d4af37; font-weight:700; background:rgba(212,175,55,0.08);' : 'color:#ccc;'}`;
        row.innerHTML = `<span>${i + 1}. ${ownerName}</span><span>${s.dvt_score}</span>`;
        wrap.appendChild(row);
      }
    } catch {
      const err = document.createElement('div');
      err.style.cssText = 'color:#555; text-align:center;';
      err.textContent = 'Could not load scores';
      wrap.appendChild(err);
    }
  }

  destroy() {
    clearInterval(this.#interval);
    document.removeEventListener('keydown', this._keyHandler);
    this.#overlay.remove();
    if (this.#onClose) this.#onClose();
  }
}


// ---------------------------------------------------------------------------
// Konami Code Listener
// ---------------------------------------------------------------------------

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let konamiPos = 0;

export function initKonamiListener() {
  // capture:true — intercepts before child components can stopPropagation (dropdowns, lists, etc.)
  document.addEventListener('keydown', (e) => {
    if (e.key === KONAMI[konamiPos]) {
      konamiPos++;
      if (konamiPos === KONAMI.length) {
        konamiPos = 0;
        startMatrixRain(10000);
      }
    } else {
      konamiPos = e.key === KONAMI[0] ? 1 : 0; // partial restart if first key matches
    }
  }, { capture: true });
}
