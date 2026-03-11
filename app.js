const API_URL = "https://backendia-khz7.onrender.com";

// ── Estado global ──────────────────────────────────────────────────────
let mirrorUser       = null;
let mirrorMsgCount   = 0;
let mirrorPollTimer  = null;
let lastActivityTime = Date.now();
let myEventTs        = 0;       // ts para polling propio de eventos globales

// Salas abiertas: { room_id: { lastEventTs, pollTimer } }
const openRooms = {};

// ── Usuario ────────────────────────────────────────────────────────────
let username = localStorage.getItem("username");
if (!username) {
  username = prompt("Ingresá tu nombre de usuario");
  if (username) localStorage.setItem("username", username);
}
document.getElementById("username").innerText = username;

// ── Init ───────────────────────────────────────────────────────────────
loadUsers();
loadMyHistory();
loadPersonalityModal();
loadRooms();
setInterval(sendHeartbeat,  20000);
setInterval(loadUsers,       5000);
setInterval(loadRooms,       4000);
setInterval(pollMyEvents,    2500);  // escuchar eventos globales (sala creada, etc.)

// ── Actividad ──────────────────────────────────────────────────────────
["mousemove","keydown","click","scroll"].forEach(evt =>
  document.addEventListener(evt, () => { lastActivityTime = Date.now(); })
);

function isUserActive() { return (Date.now() - lastActivityTime) < 300000; }

async function sendHeartbeat() {
  if (!username) return;
  await fetch(API_URL + "/heartbeat", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ user: username, active: isUserActive() })
  }).catch(() => {});
}

window.addEventListener("beforeunload", () => {
  // Salir de todas las salas abiertas
  Object.keys(openRooms).forEach(roomId => {
    navigator.sendBeacon(API_URL + `/rooms/${roomId}/leave`,
      new Blob([JSON.stringify({ user: username })], { type: "application/json" }));
  });
  navigator.sendBeacon(API_URL + "/offline",
    new Blob([JSON.stringify({ user: username })], { type: "application/json" }));
});

// ── Polling: eventos globales (sala creada/destruida) ──────────────────
async function pollMyEvents() {
  if (!username) return;
  try {
    const res    = await fetch(`${API_URL}/events/${username}?since=${myEventTs}`);
    const events = await res.json();
    events.forEach(ev => {
      myEventTs = Math.max(myEventTs, ev.ts);
      if (ev.type === "room_created" && ev.actor !== username) {
        showRoomNotification(ev.room_id, ev.room_name, ev.actor);
      } else if (ev.type === "room_deleted") {
        removeRoomFromSidebar(ev.room_id);
        closeRoomWindow(ev.room_id, true);
      } else if (ev.type === "mirror_update" && ev.actor !== username) {
        handleMirrorUpdate(ev);
      }
    });
  } catch (_) {}
}

// ── Resize textarea ────────────────────────────────────────────────────
const messageInput = document.getElementById("message");
messageInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
  lastActivityTime = Date.now();
});
messageInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ── Enviar mensaje propio ──────────────────────────────────────────────
async function sendMessage() {
  const input   = document.getElementById("message");
  const message = input.value.trim();
  if (!message) return;

  lastActivityTime = Date.now();
  addMessage("user", message);
  input.value = ""; input.style.height = "auto";

  const loader = addLoader(document.getElementById("chat"));

  const res = await fetch(API_URL + "/chat", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      message, user: username,
      personality: document.getElementById("personality").value
    })
  });

  const data = await res.json();
  loader.remove();
  renderBotMessage(data.reply, document.getElementById("chat"));
}

// ── Helpers de renderizado ─────────────────────────────────────────────
function addLoader(container) {
  const d = document.createElement("div");
  d.className = "loader";
  container.appendChild(d);
  container.scrollTop = container.scrollHeight;
  return d;
}

function addMessage(type, text, authorLabel = null, container = null) {
  const chat = container || document.getElementById("chat");
  const wrap = document.createElement("div");
  wrap.className = "msg-wrap " + type;
  if (authorLabel) {
    const label = document.createElement("span");
    label.className = "msg-author"; label.innerText = authorLabel;
    wrap.appendChild(label);
  }
  const div = document.createElement("div");
  div.className = "message " + type; div.innerText = text;
  wrap.appendChild(div);
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
}

function renderBotMessage(raw, container) {
  container = container || document.getElementById("chat");
  const div = document.createElement("div");
  div.className = "message bot";
  renderRichInto(div, raw);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function renderRichInto(container, raw) {
  parseRichContent(raw).forEach(part => {
    if (part.type === "text" && part.content.trim()) {
      const p = document.createElement("p");
      p.className = "bot-text"; p.innerText = part.content.trim();
      container.appendChild(p);
    } else if (part.type === "table")    { container.appendChild(renderTable(part.content)); }
    else if (part.type === "widget")     { container.appendChild(renderWidget(part.title, part.content)); }
    else if (part.type === "download")   { container.appendChild(renderDownload(part.filename, part.content)); }
  });
}

function parseRichContent(raw) {
  const parts = [];
  const regex = /<table>([\s\S]*?)<\/table>|<widget title="([^"]*)">([\s\S]*?)<\/widget>|<download filename="([^"]*)">([\s\S]*?)<\/download>/g;
  let lastIndex = 0, match;
  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) parts.push({ type:"text", content: raw.slice(lastIndex, match.index) });
    if      (match[1] !== undefined) parts.push({ type:"table",    content: match[1].trim() });
    else if (match[2] !== undefined) parts.push({ type:"widget",   title: match[2], content: match[3].trim() });
    else if (match[4] !== undefined) parts.push({ type:"download", filename: match[4], content: match[5] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < raw.length) parts.push({ type:"text", content: raw.slice(lastIndex) });
  return parts;
}

function renderTable(raw) {
  const wrapper = document.createElement("div"); wrapper.className = "rich-table-wrap";
  const table   = document.createElement("table"); table.className = "rich-table";
  raw.split("\n").filter(l => l.trim()).forEach((line, i) => {
    const row = document.createElement("tr");
    line.split("|").map(c => c.trim()).forEach(cell => {
      const td = document.createElement(i === 0 ? "th" : "td"); td.innerText = cell;
      row.appendChild(td);
    });
    table.appendChild(row);
  });
  wrapper.appendChild(table); return wrapper;
}

function renderWidget(title, content) {
  const div = document.createElement("div"); div.className = "rich-widget";
  div.innerHTML = `<div class="widget-title">${title}</div><div class="widget-body">${content}</div>`;
  return div;
}

function getMimeType(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  return {txt:"text/plain",csv:"text/csv",md:"text/markdown",json:"application/json",html:"text/html"}[ext] || "text/plain";
}

function renderDownload(filename, content) {
  const div = document.createElement("div"); div.className = "rich-download";
  const ext = filename.split(".").pop().toLowerCase();
  const isBinary = ["docx","xlsx","pptx"].includes(ext);
  const finalFilename = isBinary ? filename.replace(/\.(docx|xlsx|pptx)$/, ".txt") : filename;
  const blob = new Blob([content], { type: getMimeType(finalFilename) });
  const url  = URL.createObjectURL(blob);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS,"svg");
  svg.setAttribute("width","14"); svg.setAttribute("height","14");
  svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("fill","none");
  svg.setAttribute("stroke","currentColor"); svg.setAttribute("stroke-width","2");
  const p1 = document.createElementNS(svgNS,"path"); p1.setAttribute("d","M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");
  const p2 = document.createElementNS(svgNS,"polyline"); p2.setAttribute("points","7,10 12,15 17,10");
  const p3 = document.createElementNS(svgNS,"line"); p3.setAttribute("x1","12"); p3.setAttribute("y1","15"); p3.setAttribute("x2","12"); p3.setAttribute("y2","3");
  svg.appendChild(p1); svg.appendChild(p2); svg.appendChild(p3);

  const link = document.createElement("a");
  link.href = url; link.download = finalFilename; link.className = "download-link"; link.innerText = finalFilename;
  const size = document.createElement("span"); size.className = "download-size"; size.innerText = (blob.size/1024).toFixed(1)+" KB";
  div.appendChild(svg); div.appendChild(link); div.appendChild(size);

  if (isBinary) {
    const warn = document.createElement("div"); warn.className = "download-warning";
    warn.innerText = `⚠️ Guardado como .txt — para un ${ext} real pedile al bot .csv o .html`;
    div.appendChild(warn);
  }
  return div;
}

// ── Usuarios ───────────────────────────────────────────────────────────
async function loadUsers() {
  const res   = await fetch(API_URL + "/users");
  const users = await res.json();

  const list = document.getElementById("usersList");
  list.innerHTML = "";
  const onlineCount = users.filter(u => u.status === "online").length;
  document.getElementById("onlineCount").innerText = onlineCount + " en línea";

  const order = { online:0, away:1, offline:2 };
  users.sort((a,b) => order[a.status] - order[b.status]);

  users.forEach(u => {
    if (u.name === username) return;
    const card = document.createElement("div");
    card.className = "userCard" + (u.name === mirrorUser ? " active" : "");
    card.onclick   = () => loadMirror(u.name);

    const dot = document.createElement("span"); dot.className = `statusDot ${u.status}`;
    const name = document.createElement("span"); name.className = "userName"; name.innerText = u.name;
    const badge = document.createElement("span"); badge.className = `status-badge ${u.status}`;
    badge.innerText = {online:"online",away:"ausente",offline:"offline"}[u.status];

    card.appendChild(dot); card.appendChild(name); card.appendChild(badge);
    list.appendChild(card);
  });
}

// ── Mirror ─────────────────────────────────────────────────────────────
async function loadMirror(user) {
  stopMirrorPolling();
  mirrorUser = user;

  const res     = await fetch(API_URL + "/history/" + user);
  const history = await res.json();

  const mirror = document.getElementById("mirrorChat");
  const empty  = document.getElementById("mirrorEmpty");
  mirror.innerHTML = "";

  if (!history.length) { if (empty) empty.style.display = "flex"; }
  else {
    if (empty) empty.style.display = "none";
    history.forEach(m => {
      const actor = m.actor || user;
      const q = document.createElement("div"); q.className = "mirror-msg-user";
      q.innerText = (actor !== user ? `[${actor}] ` : "") + m.message;
      const a = document.createElement("div"); a.className = "mirror-msg-bot";
      renderRichInto(a, m.reply);
      mirror.appendChild(q); mirror.appendChild(a);
    });
    mirror.scrollTop = mirror.scrollHeight;
  }

  const expandBtn = document.getElementById("mirrorBtnExpand");
  if (expandBtn) expandBtn.style.display = "inline-flex";
  mirrorMsgCount = history.length;
  startMirrorPolling(user);
  loadUsers();
}

function handleMirrorUpdate(ev) {
  if (ev.actor !== mirrorUser) return;
  const mirror = document.getElementById("mirrorChat");
  const empty  = document.getElementById("mirrorEmpty");
  if (!mirror) return;
  if (empty) empty.style.display = "none";
  mirrorMsgCount++;

  const q = document.createElement("div"); q.className = "mirror-msg-user mirror-new";
  q.innerText = ev.message;
  const a = document.createElement("div"); a.className = "mirror-msg-bot mirror-new";
  renderRichInto(a, ev.reply);
  mirror.appendChild(q); mirror.appendChild(a);
  mirror.scrollTop = mirror.scrollHeight;
}

function startMirrorPolling(user) {
  stopMirrorPolling();
  mirrorPollTimer = setInterval(async () => {
    try {
      const res     = await fetch(API_URL + "/history/" + user);
      const history = await res.json();
      if (history.length <= mirrorMsgCount) return;
      const newItems = history.slice(mirrorMsgCount);
      mirrorMsgCount = history.length;
      const mirror = document.getElementById("mirrorChat");
      const empty  = document.getElementById("mirrorEmpty");
      if (empty) empty.style.display = "none";
      newItems.forEach(m => {
        const actor = m.actor || user;
        const q = document.createElement("div"); q.className = "mirror-msg-user mirror-new";
        q.innerText = (actor !== user ? `[${actor}] ` : "") + m.message;
        const a = document.createElement("div"); a.className = "mirror-msg-bot mirror-new";
        renderRichInto(a, m.reply);
        mirror.appendChild(q); mirror.appendChild(a);
      });
      if (mirror) mirror.scrollTop = mirror.scrollHeight;
    } catch (_) {}
  }, 2500);
}

function stopMirrorPolling() {
  if (mirrorPollTimer) { clearInterval(mirrorPollTimer); mirrorPollTimer = null; }
}

// ── Salas ──────────────────────────────────────────────────────────────
async function loadRooms() {
  const res   = await fetch(API_URL + "/rooms");
  const rooms = await res.json();

  const list  = document.getElementById("roomsList");
  const empty = document.getElementById("roomsEmpty");

  // Mantener solo las rooms que no están abiertas como ventanas
  list.innerHTML = "";

  if (!rooms.length) {
    if (empty) empty.style.display = "flex";
    return;
  }
  if (empty) empty.style.display = "none";

  rooms.forEach(room => {
    const card = document.createElement("div");
    card.className = "roomCard" + (openRooms[room.id] ? " active" : "");
    card.onclick   = () => openRoomWindow(room.id);

    const info = document.createElement("div"); info.className = "room-info";
    const name = document.createElement("span"); name.className = "room-name"; name.innerText = room.name;
    const meta = document.createElement("span"); meta.className = "room-meta";
    meta.innerText = `${room.participants.length} participante${room.participants.length !== 1 ? "s" : ""}`;

    const dot = document.createElement("span"); dot.className = "room-live-dot";

    info.appendChild(name); info.appendChild(meta);
    card.appendChild(dot); card.appendChild(info);
    list.appendChild(card);
  });
}

function showRoomNotification(roomId, roomName, creator) {
  // Pequeño toast de aviso
  const toast = document.createElement("div");
  toast.className = "room-toast";
  toast.innerHTML = `<strong>${creator}</strong> creó la sala "<strong>${roomName}</strong>" <button onclick="openRoomWindow('${roomId}');this.closest('.room-toast').remove()">Unirme</button>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 400); }, 6000);
}

function removeRoomFromSidebar(roomId) {
  loadRooms(); // refrescar lista
}

// ── Ventanas de sala ────────────────────────────────────────────────────
async function openRoomWindow(roomId) {
  // Si ya está abierta, enfocarla
  const existing = document.getElementById(`room-win-${roomId}`);
  if (existing) { existing.style.zIndex = getTopZ() + 1; return; }

  // Unirse a la sala
  const res  = await fetch(API_URL + `/rooms/${roomId}/join`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ user: username })
  });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }

  // Crear ventana flotante
  const win = createRoomWindow(roomId, data.name, data.participants, data.history);
  document.getElementById("roomWindows").appendChild(win);

  // Iniciar polling de eventos de la sala
  const state = { lastEventTs: Date.now() / 1000 };
  openRooms[roomId] = state;
  state.pollTimer = setInterval(() => pollRoomEvents(roomId), 2500);

  loadRooms(); // marcar como activa en el sidebar
}

function createRoomWindow(roomId, roomName, participants, history) {
  const win = document.createElement("div");
  win.id        = `room-win-${roomId}`;
  win.className = "room-window";
  win.style.zIndex = getTopZ() + 1;

  // Posición inicial escalonada
  const offset = Object.keys(openRooms).length * 30;
  win.style.right  = (20 + offset) + "px";
  win.style.bottom = (20 + offset) + "px";

  win.innerHTML = `
    <div class="room-win-header" onmousedown="startDragWindow(event, '${roomId}')">
      <div class="room-win-title">
        <span class="room-live-dot"></span>
        <span class="room-win-name">${roomName}</span>
        <span class="room-win-participants" id="room-participants-${roomId}">${participants.join(", ")}</span>
      </div>
      <div class="room-win-actions">
        <button class="btn-expand" onclick="openRoomExpanded('${roomId}')" title="Pantalla extendida">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
        </button>
        <button class="room-win-close" onclick="leaveRoomWindow('${roomId}')">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="room-win-messages" id="room-msgs-${roomId}"></div>
    <div class="room-win-input">
      <textarea id="room-input-${roomId}" placeholder="Escribir en la sala..." rows="1"></textarea>
      <button class="btn-send-shared" onclick="sendRoomMessage('${roomId}')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9"/></svg>
      </button>
    </div>
  `;

  // Cargar historial existente
  const msgs = win.querySelector(`#room-msgs-${roomId}`);
  history.forEach(m => appendRoomMessage(roomId, m.actor, m.message, m.reply, msgs));

  // Textarea auto-resize + enter
  const ta = win.querySelector(`#room-input-${roomId}`);
  ta.addEventListener("input", function() {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 70) + "px";
  });
  ta.addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendRoomMessage(roomId); }
  });

  // Click en la ventana → traer al frente
  win.addEventListener("mousedown", () => { win.style.zIndex = getTopZ() + 1; });

  return win;
}

function appendRoomMessage(roomId, actor, message, reply, container) {
  container = container || document.getElementById(`room-msgs-${roomId}`);
  if (!container) return;
  const isMe = actor === username;

  const wrap = document.createElement("div");
  wrap.className = "shared-msg-wrap " + (isMe ? "mine" : "theirs");

  if (!isMe) {
    const label = document.createElement("span");
    label.className = "shared-msg-author"; label.innerText = actor;
    wrap.appendChild(label);
  }
  const bubble = document.createElement("div");
  bubble.className = "shared-msg-bubble " + (isMe ? "mine" : "theirs");
  bubble.innerText = message;
  wrap.appendChild(bubble);
  container.appendChild(wrap);

  const botWrap = document.createElement("div");
  botWrap.className = "shared-msg-bot-wrap";
  if (reply) renderRichInto(botWrap, reply);
  container.appendChild(botWrap);

  container.scrollTop = container.scrollHeight;
  return botWrap; // para rellenar luego si reply es null
}

function appendRoomEvent(roomId, text) {
  const container = document.getElementById(`room-msgs-${roomId}`);
  if (!container) return;
  const div = document.createElement("div"); div.className = "shared-event";
  div.innerText = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendRoomMessage(roomId) {
  const ta      = document.getElementById(`room-input-${roomId}`);
  const message = ta.value.trim();
  if (!message) return;

  ta.value = ""; ta.style.height = "auto";

  const container = document.getElementById(`room-msgs-${roomId}`);
  const botWrap   = appendRoomMessage(roomId, username, message, null, container);

  const loader = addLoader(container);

  const res = await fetch(API_URL + "/room-chat", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      message, user: username, room_id: roomId,
      personality: document.getElementById("personality").value
    })
  });

  const data = await res.json();
  loader.remove();

  if (botWrap) renderRichInto(botWrap, data.reply);
}

async function pollRoomEvents(roomId) {
  const state = openRooms[roomId];
  if (!state) return;
  try {
    const res    = await fetch(`${API_URL}/events/${username}?since=${state.lastEventTs}`);
    const events = await res.json();
    events.forEach(ev => {
      if (ev.room_id !== roomId) return;
      state.lastEventTs = Math.max(state.lastEventTs, ev.ts);

      if (ev.type === "room_join") {
        appendRoomEvent(roomId, `${ev.actor} se unió`);
        updateRoomParticipants(roomId);
      } else if (ev.type === "room_leave") {
        appendRoomEvent(roomId, `${ev.actor} salió`);
        updateRoomParticipants(roomId);
      } else if (ev.type === "room_message" && ev.actor !== username) {
        appendRoomMessage(roomId, ev.actor, ev.message, ev.reply);
      } else if (ev.type === "room_deleted") {
        appendRoomEvent(roomId, "La sala fue cerrada");
        setTimeout(() => closeRoomWindow(roomId, false), 2000);
      }
    });
  } catch (_) {}
}

async function updateRoomParticipants(roomId) {
  try {
    const res  = await fetch(API_URL + `/rooms/${roomId}`);
    const data = await res.json();
    const el   = document.getElementById(`room-participants-${roomId}`);
    if (el && data.participants) el.innerText = data.participants.join(", ");
  } catch (_) {}
}

async function leaveRoomWindow(roomId) {
  closeRoomWindow(roomId, false);
  await fetch(API_URL + `/rooms/${roomId}/leave`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ user: username })
  });
  loadRooms();
}

function closeRoomWindow(roomId, destroyed) {
  const win = document.getElementById(`room-win-${roomId}`);
  if (win) win.remove();
  if (openRooms[roomId]) {
    clearInterval(openRooms[roomId].pollTimer);
    delete openRooms[roomId];
  }
  if (!destroyed) loadRooms();
}

// ── Crear sala ─────────────────────────────────────────────────────────
function openCreateRoomModal() {
  document.getElementById("createRoomModal").classList.add("open");
  document.getElementById("roomNameInput").focus();
}

function closeCreateRoomModal() {
  document.getElementById("createRoomModal").classList.remove("open");
  document.getElementById("roomNameInput").value = "";
}

async function createRoom() {
  const nameInput = document.getElementById("roomNameInput");
  const name      = nameInput.value.trim() || `Sala de ${username}`;

  const res  = await fetch(API_URL + "/rooms", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ user: username, name })
  });
  const data = await res.json();
  closeCreateRoomModal();
  await loadRooms();
  openRoomWindow(data.room_id);
}

document.getElementById("createRoomModal").addEventListener("click", function(e) {
  if (e.target === this) closeCreateRoomModal();
});

document.getElementById("roomNameInput")?.addEventListener("keydown", function(e) {
  if (e.key === "Enter") createRoom();
});

// ── Vista extendida de sala ─────────────────────────────────────────────
async function openRoomExpanded(roomId) {
  const existing = document.getElementById("expandedOverlay");
  if (existing) existing.remove();

  const res  = await fetch(API_URL + `/rooms/${roomId}`);
  const data = await res.json();

  const overlay = document.createElement("div");
  overlay.id = "expandedOverlay"; overlay.className = "expanded-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) closeExpandedView(); };

  overlay.innerHTML = `
    <div class="expanded-panel">
      <div class="expanded-header">
        <div class="expanded-title">
          <span class="panel-label">SALA · ${(data.name || roomId).toUpperCase()}</span>
          <span style="font-size:11px;color:var(--text-muted);margin-top:2px">${(data.participants||[]).join(", ")}</span>
        </div>
        <div class="expanded-actions">
          <button class="btn-icon" onclick="refreshRoomExpanded('${roomId}')" title="Actualizar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button class="btn-ghost" onclick="closeExpandedView()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="expanded-messages" id="expandedMessages"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  populateRoomExpanded(data.messages || []);
  overlay._roomId    = roomId;
  overlay._pollTimer = setInterval(() => refreshRoomExpanded(roomId), 3000);
  requestAnimationFrame(() => overlay.classList.add("open"));
}

function populateRoomExpanded(messages) {
  const container = document.getElementById("expandedMessages");
  if (!container) return;
  container.innerHTML = "";
  if (!messages.length) {
    container.innerHTML = '<div class="expanded-empty">Sin mensajes aún</div>';
    return;
  }
  messages.forEach(m => {
    const isMe = m.actor === username;
    const userDiv = document.createElement("div"); userDiv.className = "expanded-user-msg";
    if (!isMe) {
      const lbl = document.createElement("span"); lbl.className = "expanded-actor"; lbl.innerText = m.actor;
      userDiv.appendChild(lbl);
    }
    const bubble = document.createElement("div"); bubble.className = "expanded-bubble"; bubble.innerText = m.message;
    userDiv.appendChild(bubble);
    const botDiv = document.createElement("div"); botDiv.className = "expanded-bot-msg";
    renderRichInto(botDiv, m.reply);
    container.appendChild(userDiv); container.appendChild(botDiv);
  });
  container.scrollTop = container.scrollHeight;
}

async function refreshRoomExpanded(roomId) {
  try {
    const res  = await fetch(API_URL + `/rooms/${roomId}`);
    const data = await res.json();
    if (data.messages) populateRoomExpanded(data.messages);
  } catch (_) {}
}

// ── Vista extendida del espejo ─────────────────────────────────────────
function openExpandedView(user) {
  const target = user || mirrorUser;
  if (!target) return;

  const existing = document.getElementById("expandedOverlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "expandedOverlay"; overlay.className = "expanded-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) closeExpandedView(); };

  overlay.innerHTML = `
    <div class="expanded-panel">
      <div class="expanded-header">
        <div class="expanded-title">
          <span class="panel-label">VISTA EXTENDIDA · ${target.toUpperCase()}</span>
        </div>
        <div class="expanded-actions">
          <button class="btn-icon" onclick="refreshExpandedMirror('${target}')" title="Actualizar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button class="btn-ghost" onclick="closeExpandedView()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="expanded-messages" id="expandedMessages"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  refreshExpandedMirror(target);
  overlay._pollTimer = setInterval(() => refreshExpandedMirror(target), 3000);
  requestAnimationFrame(() => overlay.classList.add("open"));
}

async function refreshExpandedMirror(user) {
  const res     = await fetch(API_URL + "/history/" + user);
  const history = await res.json();
  const container = document.getElementById("expandedMessages");
  if (!container) return;
  container.innerHTML = "";
  history.forEach(m => {
    const actor = m.actor || user;
    const userDiv = document.createElement("div"); userDiv.className = "expanded-user-msg";
    if (actor !== user) {
      const lbl = document.createElement("span"); lbl.className = "expanded-actor"; lbl.innerText = actor;
      userDiv.appendChild(lbl);
    }
    const bubble = document.createElement("div"); bubble.className = "expanded-bubble"; bubble.innerText = m.message;
    userDiv.appendChild(bubble);
    const botDiv = document.createElement("div"); botDiv.className = "expanded-bot-msg";
    renderRichInto(botDiv, m.reply);
    container.appendChild(userDiv); container.appendChild(botDiv);
  });
  container.scrollTop = container.scrollHeight;
}

function closeExpandedView() {
  const overlay = document.getElementById("expandedOverlay");
  if (!overlay) return;
  if (overlay._pollTimer) clearInterval(overlay._pollTimer);
  overlay.classList.remove("open");
  setTimeout(() => overlay.remove(), 250);
}

// ── Drag ventanas de sala ──────────────────────────────────────────────
function getTopZ() {
  let max = 100;
  document.querySelectorAll(".room-window").forEach(w => {
    const z = parseInt(w.style.zIndex) || 0;
    if (z > max) max = z;
  });
  return max;
}

function startDragWindow(e, roomId) {
  const win  = document.getElementById(`room-win-${roomId}`);
  if (!win) return;
  win.style.zIndex = getTopZ() + 1;

  const startX = e.clientX, startY = e.clientY;
  const startR = parseInt(win.style.right)  || 20;
  const startB = parseInt(win.style.bottom) || 20;

  function onMove(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    win.style.right  = Math.max(0, startR - dx) + "px";
    win.style.bottom = Math.max(0, startB - dy) + "px";
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup",   onUp);
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup",   onUp);
}

// ── Historial propio ───────────────────────────────────────────────────
async function loadMyHistory() {
  if (!username) return;
  try {
    const res     = await fetch(API_URL + "/history/" + username);
    const history = await res.json();
    const chat    = document.getElementById("chat");
    if (!chat) return;
    history.forEach(m => {
      addMessage("user", m.message, null, chat);
      renderBotMessage(m.reply, chat);
    });
  } catch (_) {}
}

async function deleteMyChat() {
  if (!confirm("¿Borrar todo el historial?")) return;
  await fetch(API_URL + "/delete/" + username, { method: "DELETE" });
  document.getElementById("chat").innerHTML = "";
}

// ── Upload ─────────────────────────────────────────────────────────────
async function uploadFile() {
  const fileInput = document.getElementById("fileUpload");
  if (!fileInput.files.length) return;
  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  formData.append("user", username);
  const res = await fetch(API_URL + "/upload", { method: "POST", body: formData });
  if (res.ok) document.getElementById("fileName").innerText = "✓ " + fileInput.files[0].name;
  else alert("Tipo de archivo no soportado");
}

// ── Modal personalidad ─────────────────────────────────────────────────
const PRESET_LABELS = {normal:"Normal",analyst:"Analista",creative:"Creativo",strict:"Estricto",dev:"Dev",coach:"Coach"};

async function loadPersonalityModal() {
  const res  = await fetch(API_URL + "/personality/" + username);
  const data = await res.json();
  document.getElementById("customPersonality").value = data.custom || "";
  const chips = document.getElementById("presetChips");
  chips.innerHTML = "";
  Object.entries(data.presets).forEach(([key, text]) => {
    const chip = document.createElement("button");
    chip.className = "preset-chip"; chip.innerText = PRESET_LABELS[key] || key;
    chip.onclick   = () => { document.getElementById("customPersonality").value = text; };
    chips.appendChild(chip);
  });
}

function openPersonalityModal()  { document.getElementById("personalityModal").classList.add("open"); loadPersonalityModal(); }
function closePersonalityModal() { document.getElementById("personalityModal").classList.remove("open"); }

async function savePersonality() {
  const custom = document.getElementById("customPersonality").value.trim();
  await fetch(API_URL + "/personality/" + username, {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ custom })
  });
  if (custom) document.getElementById("personality").value = "custom";
  closePersonalityModal();
}

async function clearPersonality() {
  document.getElementById("customPersonality").value = "";
  await fetch(API_URL + "/personality/" + username, { method: "DELETE" });
}

document.getElementById("personalityModal").addEventListener("click", function(e) {
  if (e.target === this) closePersonalityModal();
});
