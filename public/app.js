'use strict';

// ============================================================
// State
// ============================================================
const state = {
  category: 'charts',
  sub: null,
  page: 1,
  limit: 99999,
  total: 0,
  totalPages: 1,
  selectedId: null,
  selectedDetail: null,
  settings: { game_data_path: '', language: 'zh-CN', app_version: '0.0.2.alpha.2', game_version: '' },
  sources: [],
  options: { genres: [], releaseTags: [] },
  sortBy: 'id',
};

// ============================================================
// i18n
// ============================================================
const I18N = {
  'zh-CN': {
    charts: '谱面', characters: '角色', avatars: '虚拟形象',
    face: '面孔', head: '头饰', body: '服饰', item: '道具',
    back: '背部饰物', front: '前面饰物',
    collectibles: '收藏品', trophy: '称号', nameplate: '名牌版',
    mapicon: '地图头像', systemvoice: '系统语音',
    others: '其他', map: '地图', course: '段位', quest: '任务', ticket: '功能票',
    loading: '加载中...', noData: '暂无数据',
    refresh: '刷新', refreshOk: '数据已刷新', saveOk: '设置已保存', save: '保存',
    delete: '删除', deleteConfirm: '确定要删除吗？此操作不可恢复。', importChart: '导入谱面',
    setPath: '请先在设置中配置游戏数据路径',
    browse: '浏览',
    comingSoon: '该功能正在开发中，敬请期待',
    hint: '选择一个分类以查看数据',
    empty: '从左侧选择一个项目以查看详情',
    copyExport: '编辑与导出',
    copyExportHint: '请选择 A001 以外的目录来编辑',
    basic: 'Basic', advanced: 'Advanced', expert: 'Expert', master: 'Master', ultima: 'Ultima', worldsEnd: "World's End",
    enableDiff: '启用此难度',
    name: '名称', sortName: '排序名', artist: '作者', genre: '流派', worksName: '作品',
    illustratorName: '画师', releaseTagName: '版本',
    versionCat: '版本分类', releaseTag: '发行版本', version: '版本',
    releaseDate: '发布日期', cueFile: '音频文件', stageName: '舞台',
    jacketFile: '封面文件', enableUltima: '启用Ultima', firstLock: '初始锁定',
    isGiftMusic: '赠曲', disableFlag: '禁用', exType: '特殊类型', starDif: '星级类型',
    priority: '优先级', worldsEndTag: "WE标签", dataName: '数据名',
    author: '谱师', displayLevel: '显示等级', levelConst: '定数', chartFile: '谱面文件',
    longMusic: '长乐曲',
    rarity: '稀有度', type: '类型',
    category: '分类',
    sortById: 'ID', sortByName: '名称', sortByDate: '更新时间',
  },
};

function t(key) {
  return (I18N['zh-CN'] && I18N['zh-CN'][key]) || key;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  updateSortLabel();
}

// ============================================================
// API
// ============================================================
async function api(path, options) {
  try {
    const res = await fetch(path, options);
    if (!res.ok) return { error: 'HTTP ' + res.status };
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================================
// Navigation config
// ============================================================
const NAV_CONFIG = {
  charts:       { label: 'charts', layout: 'list', sourceSelect: true },
  characters:   { label: 'characters', layout: 'grid' },
  avatars:      { label: 'avatars', subs: ['face','head','body','item','back','front'], showAll: true, layout: 'grid' },
  collectibles: { label: 'collectibles', subs: ['trophy','nameplate','mapicon','systemvoice'], layout: 'grid' },
  others:       { label: 'others', subs: ['map','course','quest','ticket'], layout: 'grid' },
};

// Detail renderer dispatch — maps category to render function
const DETAIL_RENDERERS = {
  charts:       (item) => renderChartDetail(item),
  characters:   (item) => renderCharacterDetail(item),
  avatars:      (item) => renderAvatarDetail(item),
  collectibles: (item) => renderCollectibleDetail(item),
  others:       (item) => renderOtherDetail(item),
};

// ============================================================
// Thumb color generator
// ============================================================
const THUMB_PALETTE = [
  '#FF6B6B','#FF9F43','#FECA57','#10AC84','#1DD1A1','#54A0FF',
  '#5F27CD','#EE5A6F','#48DBFB','#A29BFE','#FD79A8','#FDCB6E',
  '#6C5CE7','#00D2D3','#FF7675','#FAB1A0','#81ECEC','#55EFC4',
  '#26de81','#2bcbba','#2d98da','#778ca3','#e056fd','#686de0',
];

function colorFromId(id) {
  let h = 0;
  const s = String(id || 'x');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return THUMB_PALETTE[Math.abs(h) % THUMB_PALETTE.length];
}

function thumbInitials(item) {
  const id = String(item.id || '');
  return id.length >= 4 ? id.slice(-4) : id || '?';
}

// Build cover image URL for chart items. Returns empty string if not applicable.
function coverUrl(item) {
  if (state.category !== 'charts') return '';
  if (!item || !item.id || !item.source) return '';
  return '/api/cover/' + encodeURIComponent(item.source) + '/' + encodeURIComponent(item.id);
}

// ============================================================
// Sidebar / Nav
// ============================================================
function updateNav() {
  document.querySelectorAll('#nav-icons .sb-icon[data-cat]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.cat === state.category);
  });
}

function updateSubNav() {
  const subNav = document.getElementById('sub-nav');
  const inner = document.getElementById('sub-nav-inner');
  inner.innerHTML = '';
  const cfg = NAV_CONFIG[state.category];
  if (!cfg) { subNav.classList.add('hidden'); return; }

  // Charts: source selection handled by top version card, not sub-nav
  if (cfg.sourceSelect) {
    subNav.classList.add('hidden');
    return;
  }

  // Static sub-navigation (avatars, collectibles, others)
  if (cfg.subs) {
    subNav.classList.remove('hidden');
    if (cfg.showAll) {
      const btnAll = document.createElement('button');
      btnAll.className = 'sub-tab' + (!state.sub ? ' active' : '');
      btnAll.textContent = '全部';
      btnAll.addEventListener('click', () => selectCategory(state.category, null));
      inner.appendChild(btnAll);
    }
    for (const sub of cfg.subs) {
      const btn = document.createElement('button');
      btn.className = 'sub-tab' + (state.sub === sub ? ' active' : '');
      btn.textContent = t(sub);
      btn.addEventListener('click', () => selectCategory(state.category, sub));
      inner.appendChild(btn);
    }
  } else {
    subNav.classList.add('hidden');
  }
}

function updateSourceSelect() {
  const inner = document.getElementById('source-dropdown-inner');
  const label = document.getElementById('source-card-label');
  const card = document.getElementById('source-card');
  if (!inner || !label || !card) return;

  const cfg = NAV_CONFIG[state.category];
  if (cfg && cfg.sourceSelect) {
    card.style.display = '';
    inner.innerHTML = '';
    if (!state.sources || state.sources.length === 0) {
      const item = document.createElement('button');
      item.className = 'hdr-dropdown-item';
      item.textContent = 'No data';
      item.disabled = true;
      inner.appendChild(item);
      label.textContent = '–';
      return;
    }
    // Find current source label
    const cur = state.sources.find((s) => s.id === state.sub);
    label.textContent = cur ? (cur.version ? cur.id + ' (' + cur.version + ')' : cur.id) : (state.sources[0].version ? state.sources[0].id + ' (' + state.sources[0].version + ')' : state.sources[0].id);

    for (const src of state.sources) {
      const item = document.createElement('button');
      item.className = 'hdr-dropdown-item';
      item.textContent = src.version ? src.id + ' (' + src.version + ')' : src.id;
      item.dataset.source = src.id;
      if (state.sub === src.id) item.classList.add('active');
      inner.appendChild(item);
    }
  } else {
    card.style.display = 'none';
  }
}

function updateSortLabel() {
  const sortLabel = document.getElementById('sort-card-label');
  const labelMap = { id: t('sortById'), name: t('sortByName'), date: t('sortByDate') };
  sortLabel.textContent = labelMap[state.sortBy] || t('sortById');
}

function closeAllDropdowns() {
  document.querySelectorAll('.hdr-card.open').forEach((el) => el.classList.remove('open'));
  document.querySelectorAll('.hdr-card-dropdown').forEach((el) => el.classList.add('hidden'));
}

function toggleDropdown(cardId, dropdownId) {
  const card = document.getElementById(cardId);
  const dropdown = document.getElementById(dropdownId);
  const isOpen = card.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) {
    card.classList.add('open');
    dropdown.classList.remove('hidden');
  }
}

function selectCategory(category, sub) {
  state.category = category;
  state.sub = sub;
  state.page = 1;
  state.selectedId = null;
  state.selectedDetail = null;
  updateNav();
  updateSubNav();
  updateSourceSelect();
  updateActionBar();
  renderDetail(null);

  // Check backend support via NAV_CONFIG (all categories are supported)
  const cfg = NAV_CONFIG[category];
  if (!cfg) {
    const body = document.getElementById('list-body');
    body.innerHTML = '<div class="coming-soon">' + t('comingSoon') + '</div>';
    return;
  }

  loadData();
}

// ============================================================
// Data Loading
// ============================================================
async function loadData() {
  const body = document.getElementById('list-body');
  body.innerHTML = '<div class="loading">' + t('loading') + '</div>';

  if (!state.settings.game_data_path || state.sources.length === 0) {
    body.innerHTML = '<div class="loading">' + t('setPath') + '</div>';
    return;
  }

  let url = '/api/data/' + state.category + '?page=' + state.page + '&limit=' + state.limit;
  if (state.sub) url += '&sub=' + encodeURIComponent(state.sub);

  const data = await api(url);
  if (data.error) {
    body.innerHTML = '<div class="loading">' + data.error + '</div>';
    return;
  }

  state.total = data.count;
  state.totalPages = data.total_pages || 1;
  let items = data.items || [];

  // Client-side sort based on state.sortBy
  items = sortItems(items, state.sortBy);

  renderItems(items);

  // Auto-select first item if nothing selected
  if (!state.selectedId && items && items.length > 0) {
    selectItem(items[0]);
  }
}

function sortItems(items, sortBy) {
  const arr = items.slice();
  if (sortBy === 'name') {
    arr.sort((a, b) => {
      const an = (a.sortName || a.name || '').toString();
      const bn = (b.sortName || b.name || '').toString();
      return an.localeCompare(bn, 'zh-CN');
    });
  } else if (sortBy === 'date') {
    arr.sort((a, b) => {
      const ad = parseInt(String(a.releaseDate || '0').replace(/\D/g, ''), 10) || 0;
      const bd = parseInt(String(b.releaseDate || '0').replace(/\D/g, ''), 10) || 0;
      return ad - bd;
    });
  } else {
    // 'id' - numeric ascending
    arr.sort((a, b) => {
      const an = parseInt(String(a.id || '0').replace(/\D/g, ''), 10) || 0;
      const bn = parseInt(String(b.id || '0').replace(/\D/g, ''), 10) || 0;
      return an - bn;
    });
  }
  return arr;
}

// ============================================================
// Item Rendering
// ============================================================
function renderItems(items) {
  const body = document.getElementById('list-body');
  if (!items.length) {
    body.innerHTML = '<div class="loading">' + t('noData') + '</div>';
    return;
  }

  const cfg = NAV_CONFIG[state.category];
  const layout = cfg.layout || 'list';

  if (layout === 'grid') {
    const grid = document.createElement('div');
    grid.className = 'list-grid';
    for (const item of items) {
      const cell = document.createElement('div');
      cell.className = 'grid-item' + (state.selectedId === item.id ? ' selected' : '');
      cell.dataset.id = item.id;

      const cover = document.createElement('div');
      cover.className = 'gi-cover';
      if (item.defaultImages && item.source) {
        const img = document.createElement('img');
        img.src = '/api/chara_img/' + item.source + '/' + item.defaultImages + '/02';
        img.alt = '';
        img.loading = 'lazy';
        img.className = 'gi-img';
        img.onerror = function() { this.style.display = 'none'; };
        cover.appendChild(img);
      } else {
        cover.textContent = thumbInitials(item);
      }
      cell.appendChild(cover);

      const info = document.createElement('div');
      info.className = 'gi-info';

      const nm = document.createElement('div');
      nm.className = 'gi-name';
      nm.textContent = item.name || '(unnamed)';
      nm.title = item.name || '';
      info.appendChild(nm);

      const id = document.createElement('div');
      id.className = 'gi-id';
      id.textContent = item.id + (item.rareType && item.rareType !== '0' ? ' · R' + item.rareType : '');
      info.appendChild(id);

      cell.appendChild(info);

      cell.addEventListener('click', () => selectItem(item));
      grid.appendChild(cell);
    }
    body.innerHTML = '';
    body.appendChild(grid);
  } else {
    const list = document.createElement('div');
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'list-item' + (state.selectedId === item.id ? ' selected' : '');
      row.dataset.id = item.id;

      const cover = document.createElement('div');
      cover.className = 'li-cover';
      const coverBg = colorFromId(item.id);
      const url = coverUrl(item);
      if (url) {
        cover.style.background = coverBg;
        const img = document.createElement('img');
        img.className = 'cover-img-el';
        img.alt = item.name || '';
        img.loading = 'lazy';
        img.src = url;
        img.onerror = () => { img.remove(); cover.classList.add('cover-fallback'); };
        cover.appendChild(img);
        const txt = document.createElement('span');
        txt.className = 'cover-fallback-text';
        txt.textContent = thumbInitials(item);
        cover.appendChild(txt);
      } else {
        cover.style.background = coverBg;
        cover.textContent = thumbInitials(item);
      }
      row.appendChild(cover);

      const info = document.createElement('div');
      info.className = 'li-info';

      const idEl = document.createElement('div');
      idEl.className = 'li-id';
      idEl.textContent = String(item.id || '').replace(/\D/g, '') || item.id;
      info.appendChild(idEl);

      const nm = document.createElement('div');
      nm.className = 'li-name';
      nm.textContent = item.name || '(unnamed)';
      nm.title = item.name || '';
      info.appendChild(nm);

      if (state.category === 'charts') {
        const meta = document.createElement('div');
        meta.className = 'li-meta';
        const parts = [];
        if (item.artist) parts.push(item.artist);
        if (item.genre) parts.push(item.genre);
        meta.textContent = parts.join(' · ');
        info.appendChild(meta);
      }

      if (state.category === 'charts' && item.notes && item.notes.length) {
        const badges = document.createElement('div');
        badges.className = 'li-badges';
        // Determine which slots have a chart enabled
        const diffNames = ['BAS','ADV','EXP','MAS','ULT','WE'];
        const diffClasses = ['bas','adv','exp','mas','ult','we'];
        const hasAnyStandard = [0,1,2,3].some(i => item.notes[i] && item.notes[i].enable);
        const hasWe = item.notes[5] && item.notes[5].enable;

        // WDE-only songs: show only the "World's End" pill (no level number)
        if (!hasAnyStandard && hasWe) {
          const badge = document.createElement('div');
          badge.className = 'diff-badge we we-text';
          badge.textContent = "World's End";
          badge.title = "World's End";
          badges.appendChild(badge);
        } else {
          // Standard songs: show up to 6 slots (or 5 if no ULT, 4 if no ULT/WE)
          let maxSlot = 4;
          if (item.notes[4] && item.notes[4].enable) maxSlot = 5;
          if (item.notes[5] && item.notes[5].enable) maxSlot = 6;
          for (let i = 0; i < maxSlot; i++) {
            const note = item.notes[i];
            const badge = document.createElement('div');
            if (note && note.enable) {
              const lvl = note.level + (note.levelDecimal > 0 ? '+' : '');
              badge.className = 'diff-badge ' + diffClasses[i];
              badge.textContent = lvl;
              badge.title = diffNames[i] + ' ' + lvl;
            } else {
              badge.className = 'diff-badge lv';
              badge.textContent = '–';
            }
            badges.appendChild(badge);
          }
        }
        info.appendChild(badges);
      }

      if (item.longMusic) {
        const longTag = document.createElement('span');
        longTag.className = 'long-tag';
        longTag.textContent = t('longMusic');
        info.appendChild(longTag);
      }

      row.appendChild(info);
      row.addEventListener('click', () => selectItem(item));
      list.appendChild(row);
    }
    body.innerHTML = '';
    body.appendChild(list);
  }
}

function selectItem(item) {
  state.selectedId = item.id;
  state.selectedDetail = item;
  document.querySelectorAll('.list-item, .grid-item').forEach((el) => {
    el.classList.toggle('selected', el.dataset.id === item.id);
  });
  updateActionBar();
  renderDetail(item);
}

function updateActionBar() {
  const bar = document.getElementById('chart-action-bar');
  if (!bar) return;
  const show = state.category === 'charts' && !!state.selectedDetail;
  bar.classList.toggle('hidden', !show);
}

// ============================================================
// Detail Panel Rendering
// ============================================================
function renderDetail(item) {
  const pane = document.getElementById('detail-content');
  if (!item) {
    pane.className = 'detail-empty';
    pane.innerHTML = '<div class="empty-hint">' + t('empty') + '</div>';
    return;
  }
  pane.className = 'detail-body';

  // Dispatch through DETAIL_RENDERERS lookup table
  const renderer = DETAIL_RENDERERS[state.category];
  pane.innerHTML = renderer ? renderer(item) : '';
}

function renderChartDetail(item) {
  const notes = item.notes || [];
  const hasUlt = notes[4] && notes[4].enable;
  const hasWe = notes[5] && notes[5].enable;
  const hasAnyStandard = [0, 1, 2, 3].some(i => notes[i] && notes[i].enable);

  // If the song has NO standard difficulties (BAS/ADV/EXP/MAS) but HAS a WE chart,
  // render only the World's End tab.
  let diffTabs, diffLabels, defaultActive;
  if (!hasAnyStandard && hasWe) {
    diffTabs = ['we'];
    diffLabels = [t('worldsEnd') || "World's End"];
    defaultActive = 0;
  } else {
    diffTabs = ['bas','adv','exp','mas','ult','we'];
    diffLabels = [t('basic'), t('advanced'), t('expert'), t('master'), t('ultima'), t('worldsEnd') || "World's End"];
    defaultActive = -1;
    for (let i = 0; i < 4; i++) {
      if (notes[i] && notes[i].enable) { defaultActive = i; break; }
    }
    if (defaultActive === -1) defaultActive = 0;
    // Skip ULT/WE in tabs if not enabled
    if (!hasUlt && !hasWe) diffTabs = diffTabs.slice(0, 4);
    else if (!hasUlt && hasWe) diffTabs = diffTabs.slice(0, 5);
    else if (hasUlt && !hasWe) diffTabs = diffTabs.slice(0, 5);
  }

  let tabsHtml = '';
  let panelsHtml = '';
  for (let i = 0; i < diffTabs.length; i++) {
    const key = diffTabs[i];
    const labelIdx = ['bas','adv','exp','mas','ult','we'].indexOf(key);
    const n = notes[labelIdx];
    const active = i === defaultActive;
    const hasChart = n && n.enable;
    tabsHtml += `<button class="diff-tab ${key}${active ? ' active' : ''}" data-diff="${key}">${diffLabels[labelIdx]}</button>`;

    // WE-only songs: no enable checkbox / no level / no levelDecimal fields, no text
    const isWeOnly = (key === 'we' && !hasAnyStandard);
    if (isWeOnly) {
      panelsHtml += `<div class="diff-panel diff-panel-${key}${active ? '' : ' hidden'}" data-diff-panel="${key}">
        <div class="diff-left diff-left-empty"></div>
      </div>`;
    } else {
      panelsHtml += `<div class="diff-panel diff-panel-${key}${active ? '' : ' hidden'}" data-diff-panel="${key}">
        <div class="diff-left">
          <div class="enable-row">
            <label class="enable-cb-label">
              <input type="checkbox" class="diff-enable-cb" data-note-idx="${labelIdx}" ${hasChart ? 'checked' : ''}>
              <span>${t('enableDiff')}</span>
            </label>
          </div>
          <div class="meta-row"><div class="meta-label">${t('displayLevel')}</div><input type="number" class="meta-input" data-note-idx="${labelIdx}" data-note-field="level" value="${n ? n.level : 0}" min="0" max="20"></div>
          <div class="meta-row"><div class="meta-label">${t('levelConst')}</div><input type="number" class="meta-input" data-note-idx="${labelIdx}" data-note-field="levelDecimal" value="${n ? n.levelDecimal : 0}" min="0" max="99"></div>
        </div>
      </div>`;
    }
  }

  // Cover image element (real DDS->PNG from cover API)
  const coverSrc = coverUrl(item);
  const coverFallback = colorFromId(item.id);
  const coverHtml = coverSrc
    ? `<div class="cover-img" style="background:${coverFallback}"><img class="cover-img-el cover-img-lg" src="${coverSrc}" alt="${esc(item.name || '')}" onerror="this.remove()"><span class="cover-fallback-text">${thumbInitials(item)}</span></div>`
    : `<div class="cover-img" style="background:${coverFallback};color:rgba(255,255,255,0.85)">${thumbInitials(item)}</div>`;

  return `
    <div class="detail-top">
      <div class="meta-form">
        <div class="meta-row">
          <div class="meta-label">${t('name')}</div>
          <input type="text" class="meta-input" data-field="name" value="${esc(item.name || '')}">
        </div>
        <div class="meta-row">
          <div class="meta-label">${t('sortName')}</div>
          <input type="text" class="meta-input" data-field="sortName" value="${esc(item.sortName || '')}">
        </div>
        <div class="meta-row">
          <div class="meta-label">${t('artist')}</div>
          <input type="text" class="meta-input" data-field="artist" value="${esc(item.artist || '')}">
        </div>
        <div class="meta-row">
          <div class="meta-label">${t('genre')}</div>
          <select class="meta-input" data-field="genre">
            ${state.options.genres.map(g => `<option value="${esc(g)}" ${g === item.genre ? 'selected' : ''}>${esc(g)}</option>`).join('')}
          </select>
        </div>
        <div class="meta-row">
          <div class="meta-label">${t('version')}</div>
          <select class="meta-input" data-field="releaseTagName">
            ${state.options.releaseTags.map(rt => `<option value="${esc(rt.str)}" ${rt.str === item.releaseTagName ? 'selected' : ''}>${esc(rt.versionName)} (${esc(rt.str)})</option>`).join('')}
          </select>
        </div>
        <div class="meta-row">
          <div class="meta-label">${t('releaseDate')}</div>
          <input type="text" class="meta-input" data-field="releaseDate" value="${esc(item.releaseDate || '')}">
        </div>
        <div class="meta-row">
          <div class="meta-label">ID</div>
          <div class="meta-value meta-value-readonly">${esc(String(item.id || '').replace(/\D/g, '') || '–')}</div>
        </div>
      </div>
      ${coverHtml}
    </div>
    <div class="diff-tabs">${tabsHtml}</div>
    ${panelsHtml}
  `;
}

async function saveChart() {
  const pane = document.getElementById('detail-content');
  const item = state.selectedDetail;
  if (!item) return;

  const fields = {};

  // Top-level fields (inputs and selects)
  pane.querySelectorAll('[data-field]').forEach((el) => {
    fields[el.dataset.field] = el.value;
  });

  // Notes fields
  const notesData = [];
  const notes = item.notes || [];
  for (let i = 0; i < notes.length; i++) {
    const enableCb = pane.querySelector('input.diff-enable-cb[data-note-idx="' + i + '"]');
    const levelInput = pane.querySelector('input.meta-input[data-note-idx="' + i + '"][data-note-field="level"]');
    const levelDecimalInput = pane.querySelector('input.meta-input[data-note-idx="' + i + '"][data-note-field="levelDecimal"]');

    notesData.push({
      type: notes[i].type,
      typeName: notes[i].typeName,
      level: levelInput ? parseInt(levelInput.value) || 0 : 0,
      levelDecimal: levelDecimalInput ? parseInt(levelDecimalInput.value) || 0 : 0,
      enable: enableCb ? enableCb.checked : false,
    });
  }
  fields.notes = notesData;

  const result = await api('/api/save/chart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: item.source,
      music_id: item.id,
      fields: fields,
    }),
  });

  if (result.error) {
    showToast(result.error);
  } else {
    showToast(t('saveOk'));
    await api('/api/refresh', { method: 'POST' });
    loadData();
  }
}

async function saveCharacter() {
  const pane = document.getElementById('detail-content');
  const item = state.selectedDetail;
  if (!item) return;

  const fields = {};
  pane.querySelectorAll('[data-field]').forEach((el) => {
    fields[el.dataset.field] = el.value;
  });

  const result = await api('/api/save/character', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: item.source,
      chara_id: item.id,
      fields: fields,
    }),
  });

  if (result.error) {
    showToast(result.error);
  } else {
    showToast(t('saveOk'));
    await api('/api/refresh', { method: 'POST' });
    loadData();
  }
}

async function editMusicXml() {
  closeAllDropdowns();
  const item = state.selectedDetail;
  if (!item) return;
  console.log('[editMusicXml]', item.source, item.id);
  const result = await api(`/api/music/open-xml?source=${encodeURIComponent(item.source)}&music_id=${encodeURIComponent(item.id)}`);
  console.log('[editMusicXml] result', result);
  if (result.error) showToast(result.error);
  else if (result.path) showToast('已打开: ' + result.path);
}
window.editMusicXml = editMusicXml;

async function openMusicFolder() {
  closeAllDropdowns();
  const item = state.selectedDetail;
  if (!item) return;
  console.log('[openMusicFolder]', item.source, item.id);
  const result = await api(`/api/music/open-folder?source=${encodeURIComponent(item.source)}&music_id=${encodeURIComponent(item.id)}`);
  console.log('[openMusicFolder] result', result);
  if (result.error) showToast(result.error);
  else if (result.path) showToast('已打开: ' + result.path);
}
window.openMusicFolder = openMusicFolder;

async function exportMusicZip() {
  const item = state.selectedDetail;
  if (!item) return;
  console.log('[exportMusicZip]', item.source, item.id);
  showToast('正在打包...');
  const result = await api(`/api/music/export-zip?source=${encodeURIComponent(item.source)}&music_id=${encodeURIComponent(item.id)}`);
  console.log('[exportMusicZip] result', result);
  if (result.error) {
    showToast(result.error);
  } else {
    showToast('已导出: ' + (result.path || item.id + '.zip'));
  }
}
window.exportMusicZip = exportMusicZip;

function renderCharacterDetail(item) {
  return `
    <div class="detail-top">
      <div class="meta-form chara-edit-form">
        <div class="meta-row"><div class="meta-label">${t('name')}</div><div class="meta-value"><input class="chara-input" type="text" data-field="name" value="${escAttr(item.name || '')}" placeholder="–"></div></div>
        <div class="meta-row"><div class="meta-label">${t('sortName')}</div><div class="meta-value"><input class="chara-input" type="text" data-field="sortName" value="${escAttr(item.sortName || '')}" placeholder="–"></div></div>
        <div class="meta-row"><div class="meta-label">${t('illustratorName')}</div><div class="meta-value"><input class="chara-input" type="text" data-field="illustratorName" value="${escAttr(item.illustratorName || '')}" placeholder="–"></div></div>
        <div class="meta-row"><div class="meta-label">${t('worksName')}</div><div class="meta-value"><input class="chara-input" type="text" data-field="worksName" value="${escAttr(item.worksName || '')}" placeholder="–"></div></div>
        <div class="meta-row"><div class="meta-label">${t('releaseTagName')}</div><div class="meta-value"><input class="chara-input" type="text" data-field="releaseTagName" value="${escAttr(item.releaseTagName || '')}" placeholder="–"></div></div>
        <div class="meta-row"><div class="meta-label">ID</div><div class="meta-value"><input class="chara-input chara-input-id" type="text" value="${escAttr(item.id || '')}" readonly></div></div>
        <div class="meta-row chara-save-row">
          <div class="save-bar">
            <button class="btn-save" id="btn-save-chara">${t('save')}</button>
          </div>
        </div>
      </div>
      <div class="cover-img">
        ${item.defaultImages && item.source ? `<img class="cover-img-el" src="/api/chara_img/${item.source}/${item.defaultImages}/00" alt="" onerror="this.style.display='none'">` : ''}
      </div>
    </div>
  `;
}

function renderAvatarDetail(item) {
  return `
    <div class="detail-top">
      <div class="meta-form">
        <div class="meta-row"><div class="meta-label">${t('name')}</div><div class="meta-value">${esc(item.name || '–')}</div></div>
        <div class="meta-row"><div class="meta-label">${t('type')}</div><div class="meta-value">${esc(item.type || item.sub || '–')}</div></div>
        <div class="meta-row"><div class="meta-label">ID</div><div class="meta-value">${esc(item.id || '–')}</div></div>
      </div>
      <div class="cover-img" style="background:${colorFromId(item.id)};color:rgba(255,255,255,0.85)">
        ${thumbInitials(item)}
      </div>
    </div>
  `;
}

function renderCollectibleDetail(item) {
  return `
    <div class="detail-top">
      <div class="meta-form">
        <div class="meta-row"><div class="meta-label">${t('name')}</div><div class="meta-value">${esc(item.name || '–')}</div></div>
        <div class="meta-row"><div class="meta-label">${t('category')}</div><div class="meta-value">${esc(item.sub || state.sub || '–')}</div></div>
        <div class="meta-row"><div class="meta-label">${t('rarity')}</div><div class="meta-value">${item.rareType && item.rareType !== '0' ? `<span class="detail-rarity rarity-${item.rareType}">★${item.rareType}</span>` : '–'}</div></div>
        <div class="meta-row"><div class="meta-label">ID</div><div class="meta-value">${esc(item.id || '–')}</div></div>
      </div>
      <div class="cover-img" style="background:${colorFromId(item.id)};color:rgba(255,255,255,0.85)">
        ${thumbInitials(item)}
      </div>
    </div>
  `;
}

function renderOtherDetail(item) {
  return `
    <div class="detail-top">
      <div class="meta-form">
        <div class="meta-row"><div class="meta-label">${t('name')}</div><div class="meta-value">${esc(item.name || '–')}</div></div>
        <div class="meta-row"><div class="meta-label">${t('category')}</div><div class="meta-value">${esc(item.sub || state.sub || '–')}</div></div>
        <div class="meta-row"><div class="meta-label">ID</div><div class="meta-value">${esc(item.id || '–')}</div></div>
        <div class="meta-row"><div class="meta-label">${t('rarity')}</div><div class="meta-value">${item.rareType && item.rareType !== '0' ? `<span class="detail-rarity rarity-${item.rareType}">★${item.rareType}</span>` : '–'}</div></div>
      </div>
      <div class="cover-img" style="background:${colorFromId(item.id)};color:rgba(255,255,255,0.85)">
        ${thumbInitials(item)}
      </div>
    </div>
  `;
}

// Difficulty tab switching & save button
document.addEventListener('click', (e) => {
  // Save button
  if (e.target.id === 'btn-save-chart') {
    saveChart();
    return;
  }
  if (e.target.id === 'btn-delete-chart') {
    if (confirm(t('deleteConfirm'))) {
      showToast(t('delete') + ' — TODO');
    }
    return;
  }
  if (e.target.id === 'btn-import-chart') {
    showToast(t('importChart') + ' — TODO');
    return;
  }
  if (e.target.id === 'btn-import-chart-caret') {
    showToast(t('importChart') + ' — TODO');
    return;
  }
  if (e.target.id === 'btn-save-chara') {
    saveCharacter();
    return;
  }

  const tab = e.target.closest('.diff-tab');
  if (tab) {
    const diff = tab.dataset.diff;
    const tabsRoot = tab.parentElement;
    const panelRoot = tabsRoot.nextElementSibling.parentElement;
    tabsRoot.querySelectorAll('.diff-tab').forEach((b) => b.classList.remove('active'));
    tab.classList.add('active');
    panelRoot.querySelectorAll('[data-diff-panel]').forEach((p) => {
      p.classList.toggle('hidden', p.dataset.diffPanel !== diff);
    });
  }
});

// ============================================================
// Utils
// ============================================================
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2200);
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ============================================================
// Event Handlers
// ============================================================
function setupEvents() {
  // Sidebar category buttons
  document.querySelectorAll('#nav-icons .sb-icon[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const cfg = NAV_CONFIG[cat];
      if (!cfg) return;

      // Determine default sub for this category
      let sub = null;
      if (cfg.sourceSelect && state.sources.length > 0) {
        sub = (state.sub && state.sources.find(s => s.id === state.sub)) ? state.sub : state.sources[0].id;
      } else if (cfg.subs) {
        sub = (state.sub && cfg.subs.includes(state.sub)) ? state.sub : (cfg.showAll ? null : cfg.subs[0]);
      }

      selectCategory(cat, sub);
    });
  });

  // Source card dropdown (custom, matches sort card style)
  document.getElementById('source-card-main').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown('source-card', 'source-dropdown');
    // Highlight active source option
    document.querySelectorAll('#source-dropdown .hdr-dropdown-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.source === state.sub);
    });
  });

  // Source option click (event delegation, since options are dynamic)
  document.getElementById('source-dropdown-inner').addEventListener('click', (e) => {
    const btn = e.target.closest('.hdr-dropdown-item');
    if (!btn || !btn.dataset.source) return;
    e.stopPropagation();
    const newSource = btn.dataset.source;
    if (state.sub !== newSource) {
      selectCategory(state.category, newSource);
    }
    closeAllDropdowns();
  });

  // Sort card dropdown
  document.getElementById('sort-card-main').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown('sort-card', 'sort-dropdown');
    // Highlight active sort option
    document.querySelectorAll('#sort-dropdown .hdr-dropdown-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.sort === state.sortBy);
    });
  });

  // Sort option click
  document.querySelectorAll('#sort-dropdown .hdr-dropdown-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newSort = btn.dataset.sort;
      if (state.sortBy !== newSort) {
        state.sortBy = newSort;
        updateSortLabel();
        closeAllDropdowns();
        loadData();
      } else {
        closeAllDropdowns();
      }
    });
  });

  // Copy/Export dropdown
  document.getElementById('copy-export-main').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown('copy-export-card', 'copy-export-dropdown');
  });

  // Copy/Export action buttons (direct listener, no delegation)
  const btnEditXml = document.getElementById('btn-edit-xml');
  const btnOpenFolder = document.getElementById('btn-open-folder');
  const btnExportZip = document.getElementById('btn-export-zip');
  if (btnEditXml) btnEditXml.addEventListener('click', (e) => { e.stopPropagation(); editMusicXml(); });
  if (btnOpenFolder) btnOpenFolder.addEventListener('click', (e) => { e.stopPropagation(); openMusicFolder(); });
  if (btnExportZip) btnExportZip.addEventListener('click', (e) => { e.stopPropagation(); exportMusicZip(); });

  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
    closeAllDropdowns();
  });

  // Refresh
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    await api('/api/refresh', { method: 'POST' });
    showToast(t('refreshOk'));
    if (state.category) loadData();
  });

  // Settings
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('setting-language').value = state.settings.language || 'zh-CN';
    document.getElementById('setting-path').value = state.settings.game_data_path || '';
    openModal('settings-modal');
  });

  document.getElementById('settings-save').addEventListener('click', async () => {
    // Language is locked to zh-CN
    const lang = 'zh-CN';
    const gamePath = document.getElementById('setting-path').value.trim();
    const result = await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang, game_data_path: gamePath }),
    });
    if (result.error) { showToast(result.error); return; }
    state.settings = result;
    // Reload sources from new path
    const sources = await api('/api/sources');
    if (!sources.error) state.sources = sources;
    // Reload options (genres / release tags) from new path
    const options = await api('/api/options');
    if (!options.error) state.options = options;
    // Reset navigation state for fresh data
    state.sub = (state.sources.length > 0) ? state.sources[0].id : '';
    state.page = 1;
    state.selectedId = null;
    state.selectedDetail = null;
    state.total = 0;
    state.totalPages = 1;
    applyI18n();
    updateNav();
    updateSubNav();
    updateSourceSelect();
    updateSortLabel();
    renderDetail(null);
    closeModal('settings-modal');
    showToast(t('saveOk'));
    loadData();
  });

  // Browse button: open native folder picker via pywebview JS API
  document.getElementById('path-browse').addEventListener('click', async () => {
    const browseBtn = document.getElementById('path-browse');
    browseBtn.disabled = true;
    browseBtn.textContent = '...';
    try {
      let picked = '';
      let errMsg = '';
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.select_directory === 'function') {
        const resp = await window.pywebview.api.select_directory();
        // pywebview returns Python dict as JS object (or JSON string in some versions)
        let obj = resp;
        if (typeof resp === 'string') {
          try { obj = JSON.parse(resp); } catch (_) { obj = { path: resp, error: '' }; }
        }
        picked = obj.path || '';
        errMsg = obj.error || '';
      } else {
        // Fallback: prompt user to paste path manually (browser/dev mode)
        picked = window.prompt('请输入游戏数据目录路径（例 D:\\\\SDHD_2.50）:', document.getElementById('setting-path').value || '');
        picked = picked ? picked.trim() : '';
      }
      if (errMsg) {
        showToast(errMsg);
      }
      if (picked) {
        document.getElementById('setting-path').value = picked;
      }
    } catch (e) {
      showToast('无法打开目录选择器：' + e);
    } finally {
      browseBtn.disabled = false;
      browseBtn.textContent = t('browse') || '浏览';
    }
  });

  // About
  const sbVer = document.getElementById('sb-version');
  if (sbVer) sbVer.addEventListener('click', () => {
    document.getElementById('about-game-version').textContent = state.settings.game_version || '-';
    openModal('about-modal');
  });

  // Modal close
  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });
  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden'));
    }
  });
}

// ============================================================
// Init
// ============================================================
async function init() {
  const settings = await api('/api/settings');
  if (!settings.error) state.settings = settings;

  const sources = await api('/api/sources');
  if (!sources.error) state.sources = sources;

  const options = await api('/api/options');
  if (!options.error) state.options = options;

  document.getElementById('sb-version').textContent = 'v' + (state.settings.app_version || '0.0.2.alpha.2');

  setupEvents();
  applyI18n();
  updateNav();
  updateSubNav();
  updateSourceSelect();
  updateSortLabel();

  if (state.sources.length > 0) {
    selectCategory('charts', state.sources[0].id);
  } else {
    document.getElementById('list-body').innerHTML = '<div class="loading">' + t('setPath') + '</div>';
    renderDetail(null);
  }
}

init();