// ==================== FESTE CLOUD-CREDENTIALS ====================
const JSONBIN_API_KEY = "$2a$10$zDiH7eqWc3f4LD9yO9.3LuCKq2P69SW9cORTTkyvNGELtn6qR5Ad2";
const JSONBIN_BIN_ID = "6a26c7a8da38895dfe9a1f17";
// ================================================================

// --- STATE ---------------------------------------------------------
const STAGE_COLORS = ['#c8f050','#50e3c2','#f5a623','#ff6b9d','#a78bfa','#60a5fa','#fb923c','#34d399'];
let state = {
  stages: ['Hauptbühne', 'Floor B'],
  days: ['Tag 1', 'Tag 2'],
  activeStage: 0,
  acts: [],
  timeStart: '08:00',
  timeEnd: '03:00',
};
let editingActId = null;
let dayManagerOpen = false;

let syncTimeout = null;
let isSyncing = false;

// --- Hilfsfunktionen mit 30-Minuten-Rundung -------------------------
function timeToMinutes(t) { let [h,m]=t.split(':').map(Number); return h*60+m; }
function minutesToTime(mins) {
  let h = Math.floor(((mins%1440)+1440)%1440/60);
  let m = ((mins%1440)+1440)%1440%60;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}
function roundTo30Min(minutes) {
  return Math.round(minutes / 30) * 30;
}
function getTotalMinutes() {
  let s = timeToMinutes(state.timeStart);
  let e = timeToMinutes(state.timeEnd);
  if(e <= s) e += 1440;
  return e - s;
}

// --- Persistenz mit Cloud-Sync (automatisch, unsichtbar) -------------
function saveToLocal() {
  localStorage.setItem('ftimetable_cloud', JSON.stringify(state));
}

function loadFromLocal() {
  let d = localStorage.getItem('ftimetable_cloud');
  if(d) try { 
    let loaded = JSON.parse(d);
    state = {...state, ...loaded};
  } catch(e){}
}

// Automatisches Pushen in die Cloud (mit Debounce)
function pushToCloud() {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    await performCloudSync();
  }, 500);
}

async function performCloudSync() {
  if (isSyncing) return;
  isSyncing = true;
  try {
    const response = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY,
        'X-Bin-Versioning': 'false'
      },
      body: JSON.stringify(state)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log("Cloud sync erfolgreich");
  } catch (error) {
    console.error("Cloud Sync Fehler:", error);
    // Kein Benutzerhinweis – läuft im Hintergrund
  } finally {
    isSyncing = false;
  }
}

async function loadFromCloud() {
  try {
    const response = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const cloudState = data.record;
    if (cloudState && cloudState.stages && cloudState.days && cloudState.acts !== undefined) {
      state = {
        ...state,
        stages: cloudState.stages,
        days: cloudState.days,
        acts: cloudState.acts,
        timeStart: cloudState.timeStart || state.timeStart,
        timeEnd: cloudState.timeEnd || state.timeEnd
      };
      if (state.activeStage >= state.stages.length) state.activeStage = 0;
      saveToLocal();
      renderStageTabs();
      renderTimetable();
      console.log("Cloud geladen");
    }
  } catch (error) {
    console.error("Cloud Load Fehler:", error);
    // Fallback: lokale Daten bleiben
  }
}

// --- Alle State-Änderungen pushen Cloud ----------------------------
function syncAfterChange() {
  saveToLocal();
  pushToCloud();
}

// --- Bühnen (Tabs) mit Lösch-Button ---------------------------------
function renderStageTabs() {
  let container = document.getElementById('stageTabs');
  document.querySelectorAll('.tab:not(.tab-add):not(.tab-settings)').forEach(t => t.remove());
  state.stages.forEach((s, i) => {
    let btn = document.createElement('button');
    btn.className = 'tab' + (i === state.activeStage ? ' active' : '');
    btn.innerHTML = `${s} <span class="tab-close" title="Bühne löschen">✕</span>`;
    btn.onclick = (e) => {
      if(e.target.classList.contains('tab-close')) return;
      state.activeStage = i;
      renderStageTabs();
      renderTimetable();
    };
    let closeSpan = btn.querySelector('.tab-close');
    closeSpan.onclick = (e) => {
      e.stopPropagation();
      if(confirm(`Bühne "${s}" wirklich löschen? Alle Acts auf dieser Bühne werden gelöscht.`)) {
        removeStage(i);
      }
    };
    container.insertBefore(btn, container.querySelector('.tab-add'));
  });
}

function addStage() {
  state.stages.push('Bühne '+(state.stages.length+1));
  state.activeStage = state.stages.length-1;
  syncAfterChange();
  renderStageTabs();
  renderTimetable();
}

function removeStage(index) {
  let stageName = state.stages[index];
  state.acts = state.acts.filter(a => a.stage !== stageName);
  state.stages.splice(index, 1);
  if(state.stages.length === 0) {
    state.stages = ['Hauptbühne'];
    state.activeStage = 0;
  } else if(state.activeStage >= state.stages.length) {
    state.activeStage = state.stages.length - 1;
  } else if(state.activeStage === index && index < state.stages.length) {
    state.activeStage = Math.min(index, state.stages.length-1);
  }
  syncAfterChange();
  renderStageTabs();
  renderTimetable();
}

function renameStage(i) {
  let n = prompt('Bühne umbenennen:', state.stages[i]);
  if(n && n.trim()) { 
    state.stages[i] = n.trim(); 
    syncAfterChange();
    renderStageTabs(); 
    renderTimetable(); 
  }
}

document.addEventListener('contextmenu', e => {
  let tab = e.target.closest('.tab');
  if(tab && !tab.classList.contains('tab-add') && !tab.classList.contains('tab-settings')) {
    e.preventDefault();
    let idx = Array.from(document.querySelectorAll('.tab:not(.tab-add):not(.tab-settings)')).indexOf(tab);
    if(idx !== -1) renameStage(idx);
  }
});

// --- Tage Manager ------------------------------------
function renderDayManager() {
  let list = document.getElementById('dayList'); list.innerHTML = '';
  state.days.forEach((d, i) => {
    let row = document.createElement('div'); row.className = 'day-item';
    row.innerHTML = `<input type="text" value="${d}" onchange="renameDay(${i}, this.value)"><button class="btn btn-ghost btn-sm" onclick="removeDay(${i})">×</button>`;
    list.appendChild(row);
  });
}

function addDay() { 
  state.days.push('Tag '+(state.days.length+1)); 
  syncAfterChange();
  renderDayManager(); 
  renderTimetable(); 
}

function renameDay(i, val) { 
  if(val.trim()) state.days[i]=val.trim(); 
  syncAfterChange();
  renderDayManager(); 
  renderTimetable(); 
}

function removeDay(i) { 
  if(!confirm('Tag löschen?')) return; 
  state.acts = state.acts.filter(a => a.day !== i); 
  state.days.splice(i,1); 
  syncAfterChange();
  renderDayManager(); 
  renderTimetable(); 
}

function toggleDayManager() { 
  dayManagerOpen = !dayManagerOpen; 
  document.getElementById('dayManagerPanel').style.display = dayManagerOpen ? 'block' : 'none'; 
  if(dayManagerOpen) renderDayManager(); 
}

// --- Timetable Rendering -------------------------------------------
const LABEL_W = 110;
function renderTimetable() {
  state.timeStart = document.getElementById('timeStart').value;
  state.timeEnd = document.getElementById('timeEnd').value;
  let totalMins = getTotalMinutes();
  let h = Math.floor(totalMins/60), m = totalMins%60;
  document.getElementById('totalHoursLabel').textContent = `${h}h ${m>0?m+'min':''} Zeitstrahl`;
  let activeStageName = state.stages[state.activeStage];
  let container = document.getElementById('timetable');
  container.innerHTML = '';
  
  // Header
  let header = document.createElement('div'); header.className = 'timeline-header';
  let placeholder = document.createElement('div'); placeholder.className = 'day-label-placeholder'; placeholder.style.width = LABEL_W+'px';
  header.appendChild(placeholder);
  let ruler = document.createElement('div'); ruler.className = 'timeline-ruler';
  let startMins = timeToMinutes(state.timeStart);
  let total = getTotalMinutes();
  for(let t=0; t<=total; t+=30) {
    let pct = (t/total)*100;
    let tick = document.createElement('div'); tick.className = 'tick' + (t%60===0 ? ' major' : '');
    tick.style.left = pct+'%';
    let label = document.createElement('div'); label.className = 'tick-label'; label.textContent = minutesToTime(startMins+t);
    let line = document.createElement('div'); line.className = 'tick-line';
    tick.appendChild(label); tick.appendChild(line);
    ruler.appendChild(tick);
  }
  header.appendChild(ruler);
  container.appendChild(header);
  
  let rowsDiv = document.createElement('div'); rowsDiv.className = 'day-rows';
  let dayActs = state.acts.filter(a => a.stage === activeStageName);
  state.days.forEach((dayName, dayIdx) => {
    let row = document.createElement('div'); row.className = 'day-row';
    let label = document.createElement('div'); label.className = 'day-label'; label.style.width = LABEL_W+'px';
    label.innerHTML = `<span style="color:var(--accent);">${escapeHtml(dayName)}</span>`;
    row.appendChild(label);
    let track = document.createElement('div'); track.className = 'day-track';
    let inner = document.createElement('div'); inner.className = 'day-track-inner';
    let actsOnDay = dayActs.filter(a => a.day === dayIdx);
    if(actsOnDay.length === 0) {
      let empty = document.createElement('div'); empty.className = 'empty-track'; empty.textContent = 'Kein Act – klicke zum Hinzufügen';
      empty.style.cursor = 'pointer'; empty.onclick = () => openAddAct(dayIdx);
      inner.appendChild(empty);
    } else {
      actsOnDay.forEach(act => {
        let actColor = act.color || STAGE_COLORS[state.activeStage % STAGE_COLORS.length];
        let block = createActBlock(act, actColor, startMins, totalMins);
        inner.appendChild(block);
      });
    }
    track.appendChild(inner);
    track.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
    track.ondrop = e => {
      e.preventDefault();
      let id = e.dataTransfer.getData('actId');
      let act = state.acts.find(a => a.id == id);
      if(!act) return;
      let rect = track.getBoundingClientRect();
      let pct = (e.clientX - rect.left) / rect.width;
      let newStartMins = startMins + pct * total;
      newStartMins = roundTo30Min(newStartMins);
      act.start = minutesToTime(newStartMins);
      act.day = dayIdx;
      act.stage = activeStageName;
      act.duration = roundTo30Min(act.duration);
      if(act.duration < 30) act.duration = 30;
      syncAfterChange();
      renderTimetable();
    };
    row.appendChild(track);
    rowsDiv.appendChild(row);
  });
  container.appendChild(rowsDiv);
}

function createActBlock(act, color, startMins, totalMins) {
  let actStart = timeToMinutes(act.start);
  let relStart = actStart - startMins; if(relStart<0) relStart+=1440;
  let leftPct = (relStart/totalMins)*100;
  let widthPct = (act.duration/totalMins)*100;
  let block = document.createElement('div');
  block.className = 'act-block';
  block.style.left = leftPct+'%';
  block.style.width = Math.max(widthPct,1)+'%';
  block.style.background = color;
  block.draggable = true;
  block.innerHTML = `
    <div class="act-name">${escapeHtml(act.name)}</div>
    <div class="act-time">${act.start} · ${act.duration}min</div>
    ${act.genre ? `<div class="act-genre">${escapeHtml(act.genre)}</div>` : ''}
    <div class="act-actions"><button class="act-action-btn" onclick="editAct('${act.id}');event.stopPropagation();">✎</button></div>
  `;
  block.ondragstart = e => { e.dataTransfer.setData('actId', act.id); block.classList.add('dragging'); };
  block.ondragend = () => block.classList.remove('dragging');
  block.onmouseenter = e => showTooltip(e, act);
  block.onmousemove = e => moveTooltip(e);
  block.onmouseleave = hideTooltip;
  block.onclick = e => { if(!e.target.classList.contains('act-action-btn')) editAct(act.id); };
  
  let handle = document.createElement('div');
  handle.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:8px;cursor:ew-resize;z-index:5;';
  handle.onmousedown = e => { e.stopPropagation(); startResize(e, act); };
  block.appendChild(handle);
  return block;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// Resize mit 30-Minuten-Raster
let resizing = null;
function startResize(e, act) {
  e.preventDefault();
  let track = e.target.closest('.day-track');
  let rect = track.getBoundingClientRect();
  let totalMins = getTotalMinutes();
  resizing = { act, rect, totalMins, startMins: timeToMinutes(state.timeStart) };
  document.onmousemove = onResizeMove;
  document.onmouseup = stopResize;
}
function onResizeMove(e) {
  if(!resizing) return;
  let { act, rect, totalMins, startMins } = resizing;
  let actStartMins = timeToMinutes(act.start);
  let relStart = actStartMins - startMins; if(relStart<0) relStart+=1440;
  let pct = (e.clientX - rect.left) / rect.width;
  let endMinsRaw = startMins + pct * totalMins;
  let roundedEnd = roundTo30Min(endMinsRaw);
  let newDuration = roundedEnd - actStartMins;
  if(newDuration < 30) newDuration = 30;
  newDuration = roundTo30Min(newDuration);
  act.duration = Math.min(newDuration, 360);
  renderTimetable();
}
function stopResize() { 
  if (resizing) {
    syncAfterChange(); 
  }
  resizing = null; 
  document.onmousemove = null; 
  document.onmouseup = null; 
}

// --- Tooltip -------------------------------------------------------
function showTooltip(e, act) {
  let tt = document.getElementById('tooltip');
  let end = minutesToTime(timeToMinutes(act.start)+act.duration);
  tt.innerHTML = `<strong>${escapeHtml(act.name)}</strong><div>${act.start} – ${end} (${act.duration}min)</div>${act.genre?`<div>Genre: ${escapeHtml(act.genre)}</div>`:''}${act.notes?`<div>Notiz: ${escapeHtml(act.notes)}</div>`:''}`;
  tt.classList.add('visible'); moveTooltip(e);
}
function moveTooltip(e) { let tt=document.getElementById('tooltip'); tt.style.left=(e.clientX+14)+'px'; tt.style.top=(e.clientY-10)+'px'; }
function hideTooltip() { document.getElementById('tooltip').classList.remove('visible'); }

// --- Act Modal (mit Farbe) -----------------------------------------
function openAddAct(dayIdx) {
  editingActId = null;
  document.getElementById('modalTitle').textContent = 'Act hinzufügen';
  document.getElementById('deleteBtn').style.display = 'none';
  document.getElementById('actName').value = '';
  document.getElementById('actStart').value = '20:00';
  document.getElementById('actDuration').value = '60';
  document.getElementById('actGenre').value = '';
  document.getElementById('actNotes').value = '';
  document.getElementById('actColor').value = '#c8f050';
  document.getElementById('colorPreview').style.backgroundColor = '#c8f050';
  fillStageSelect(state.stages[state.activeStage]);
  fillDaySelect(dayIdx !== undefined ? dayIdx : 0);
  document.getElementById('actModal').classList.remove('hidden');
}

function editAct(id) {
  let act = state.acts.find(a=>a.id==id);
  if(!act) return;
  editingActId = id;
  document.getElementById('modalTitle').textContent = 'Act bearbeiten';
  document.getElementById('deleteBtn').style.display = 'inline-flex';
  document.getElementById('actName').value = act.name;
  document.getElementById('actStart').value = act.start;
  document.getElementById('actDuration').value = act.duration;
  document.getElementById('actGenre').value = act.genre||'';
  document.getElementById('actNotes').value = act.notes||'';
  let actColor = act.color || '#c8f050';
  document.getElementById('actColor').value = actColor;
  document.getElementById('colorPreview').style.backgroundColor = actColor;
  fillStageSelect(act.stage);
  fillDaySelect(act.day);
  document.getElementById('actModal').classList.remove('hidden');
}

function fillStageSelect(selected) {
  let sel = document.getElementById('actStage');
  sel.innerHTML = state.stages.map(s => `<option value="${s}" ${s===selected?'selected':''}>${s}</option>`).join('');
}

function fillDaySelect(selectedDayIdx) {
  let sel = document.getElementById('actDay');
  sel.innerHTML = state.days.map((d,i) => `<option value="${i}" ${i==selectedDayIdx?'selected':''}>${d}</option>`).join('');
}

function closeModal() { document.getElementById('actModal').classList.add('hidden'); }

function saveAct() {
  let name = document.getElementById('actName').value.trim();
  let start = document.getElementById('actStart').value;
  let duration = parseInt(document.getElementById('actDuration').value);
  let stage = document.getElementById('actStage').value;
  let day = parseInt(document.getElementById('actDay').value);
  let genre = document.getElementById('actGenre').value.trim();
  let notes = document.getElementById('actNotes').value.trim();
  let color = document.getElementById('actColor').value;
  if(!name || !start || isNaN(duration)) { alert('Bitte Name, Startzeit und Länge angeben.'); return; }
  let startMins = timeToMinutes(start);
  let roundedStart = roundTo30Min(startMins);
  let roundedDuration = roundTo30Min(duration);
  if(roundedDuration < 30) roundedDuration = 30;
  if(editingActId) {
    let act = state.acts.find(a=>a.id==editingActId);
    if(act) { act.name=name; act.start=minutesToTime(roundedStart); act.duration=roundedDuration; act.stage=stage; act.day=day; act.genre=genre; act.notes=notes; act.color=color; }
  } else {
    state.acts.push({ id: Date.now().toString(), stage, day, name, start: minutesToTime(roundedStart), duration: roundedDuration, genre, notes, color });
  }
  syncAfterChange();
  closeModal(); 
  renderTimetable();
}

function deleteCurrentAct() {
  if(!confirm('Act löschen?')) return;
  state.acts = state.acts.filter(a=>a.id!=editingActId);
  syncAfterChange();
  closeModal(); 
  renderTimetable();
}

function onTimeRangeChange() {
  syncAfterChange();
  renderTimetable();
}

// --- Import/Export (unverändert) ------------------------------------
function openImportExport() { document.getElementById('exportData').textContent = JSON.stringify(state, null, 2); document.getElementById('ieModal').classList.remove('hidden'); }
function closeIEModal() { document.getElementById('ieModal').classList.add('hidden'); }
function copyExport() { navigator.clipboard.writeText(document.getElementById('exportData').textContent).then(()=>alert('Kopiert!')); }
function importData() {
  try { let d = JSON.parse(document.getElementById('importData').value); if(!d.stages || !d.days || !d.acts) throw new Error(); state = {...state, ...d}; syncAfterChange(); closeIEModal(); renderStageTabs(); renderTimetable(); alert('Import erfolgreich!'); } catch(e) { alert('Fehler beim Import'); }
}

// --- INIT & Farbsynchronisation ------------------------------------
document.getElementById('actColor').addEventListener('input', (e) => {
  document.getElementById('colorPreview').style.backgroundColor = e.target.value;
});

// Zuerst lokal laden, dann von Cloud überschreiben (falls verfügbar)
loadFromLocal();
// Asynchron Cloud laden (und lokale Daten ersetzen)
loadFromCloud().then(() => {
  // Nach Cloud-Load die UI nochmal aktualisieren (Zeitfelder etc.)
  document.getElementById('timeStart').value = state.timeStart;
  document.getElementById('timeEnd').value = state.timeEnd;
  renderStageTabs();
  renderTimetable();
}).catch(() => {
  // Fallback: lokale Daten verwenden
  document.getElementById('timeStart').value = state.timeStart;
  document.getElementById('timeEnd').value = state.timeEnd;
  renderStageTabs();
  renderTimetable();
});

document.addEventListener('keydown', e => { if(e.key==='Escape') { closeModal(); closeIEModal(); } if(e.key==='n'&&(e.ctrlKey||e.metaKey)) { e.preventDefault(); openAddAct(null); } });