const API_URL = "https://backendia-khz7.onrender.com";

// ── Estado ─────────────────────────────────────────────────────────────
let username        = localStorage.getItem("username");
let activeView      = "personal";   // "personal" | "user:<name>" | "channel:<id>"
let myEventTs       = 0;
let mirrorUser      = null;
let mirrorMsgCount  = 0;
let mirrorPollTimer = null;
let channelPollTs   = {};           // { channel_id: lastTs }
let lastActivityTime = Date.now();
let globalPollTimer = null;

if (!username) {
  username = prompt("Ingresá tu nombre de usuario");
  if (username) localStorage.setItem("username", username);
}
document.getElementById("username").innerText = username;

// ── Init ───────────────────────────────────────────────────────────────
loadPersonalityModal();
loadUsers();
loadChannels();
loadPersonalView();
setInterval(sendHeartbeat, 20000);
setInterval(loadUsers,      5000);
setInterval(loadChannels,   6000);
setInterval(pollMyEvents,   2500);

["mousemove","keydown","click","scroll"].forEach(e =>
  document.addEventListener(e, () => { lastActivityTime = Date.now(); })
);

function isUserActive() { return Date.now() - lastActivityTime < 300000; }

async function sendHeartbeat() {
  if (!username) return;
  fetch(API_URL + "/heartbeat", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ user: username, active: isUserActive() })
  }).catch(() => {});
}

window.addEventListener("beforeunload", () => {
  navigator.sendBeacon(API_URL + "/offline",
    new Blob([JSON.stringify({ user: username })], { type:"application/json" }));
});

// ── Input textarea ─────────────────────────────────────────────────────
const msgInput = document.getElementById("messageInput");
msgInput.addEventListener("input", function() {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
});
msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
});

// ── Envío unificado según vista activa ─────────────────────────────────
async function handleSend() {
  const msg = msgInput.value.trim();
  if (!msg) return;
  msgInput.value = ""; msgInput.style.height = "auto";

  if (activeView === "personal") {
    await sendPersonalMessage(msg);
  } else if (activeView.startsWith("channel:")) {
    await sendChannelMessage(activeView.slice(8), msg);
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── VISTA: CHAT PERSONAL ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════
function switchToPersonal() {
  setActiveNav("nav-personal");
  activeView = "personal";

  setHeader(
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    "Mi chat", "Chat personal con el agente IA", ""
  );

  document.getElementById("messageInput").placeholder = "Escribí un mensaje...";
  loadPersonalView();
}

async function loadPersonalView() {
  try {
    const res  = await fetch(API_URL + "/history/" + username);
    const hist = await res.json();
    const area = document.getElementById("messagesArea");
    area.innerHTML = "";
    hist.forEach(m => {
      appendUserBubble(area, m.message, username);
      appendBotBubble(area, m.reply);
    });
    scrollToBottom(area);
  } catch (_) {}
}

async function sendPersonalMessage(message) {
  const area = document.getElementById("messagesArea");
  appendUserBubble(area, message, username);
  const loader = appendLoader(area);

  try {
    const res  = await fetch(API_URL + "/chat", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ message, user: username, personality: getPersonality() })
    });
    const data = await res.json();
    loader.remove();
    appendBotBubble(area, data.reply);
  } catch (e) {
    loader.remove();
    appendBotBubble(area, "Error al conectar con el servidor.");
  }
}

async function deleteMyChat() {
  if (!confirm("¿Borrar todo tu historial?")) return;
  await fetch(API_URL + "/delete/" + username, { method:"DELETE" });
  if (activeView === "personal") {
    document.getElementById("messagesArea").innerHTML = "";
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── VISTA: CANAL ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════
async function switchToChannel(channelId) {
  setActiveNav("nav-channel-" + channelId);
  activeView = "channel:" + channelId;

  // Cargar info del canal
  let ch;
  try {
    const res = await fetch(API_URL + "/channels/" + channelId);
    ch = await res.json();
  } catch (_) { return; }

  const isOwner = ch.creator === username;
  const deletBtn = isOwner
    ? `<button class="btn-danger-sm" onclick="deleteChannel('${channelId}')" title="Borrar canal">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6"/></svg>
        Borrar canal
       </button>`
    : "";

  setHeader(
    `<span class="channel-hash">#</span>`,
    ch.name,
    `Creado por ${ch.creator}`,
    deletBtn
  );

  document.getElementById("messageInput").placeholder = `Escribir en #${ch.name}...`;

  const area = document.getElementById("messagesArea");
  area.innerHTML = "";
  (ch.messages || []).forEach(m => {
    appendUserBubble(area, m.message, m.actor);
    appendBotBubble(area, m.reply);
  });
  scrollToBottom(area);

  // Iniciar polling del canal
  if (!channelPollTs[channelId]) channelPollTs[channelId] = Date.now() / 1000;
}

async function sendChannelMessage(channelId, message) {
  const area = document.getElementById("messagesArea");
  appendUserBubble(area, message, username);
  const loader = appendLoader(area);

  try {
    const res  = await fetch(API_URL + `/channels/${channelId}/chat`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ message, user: username, personality: getPersonality() })
    });
    const data = await res.json();
    loader.remove();
    appendBotBubble(area, data.reply);
  } catch (e) {
    loader.remove();
    appendBotBubble(area, "Error al enviar.");
  }
}

async function deleteChannel(channelId) {
  if (!confirm("¿Borrar este canal permanentemente?")) return;
  await fetch(API_URL + "/channels/" + channelId, {
    method:"DELETE", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ user: username })
  });
  switchToPersonal();
  loadChannels();
}

// ── Polling de eventos globales ────────────────────────────────────────
async function pollMyEvents() {
  if (!username) return;
  try {
    const res    = await fetch(`${API_URL}/events/${username}?since=${myEventTs}`);
    const events = await res.json();

    events.forEach(ev => {
      myEventTs = Math.max(myEventTs, ev.ts);

      if (ev.type === "channel_created" && ev.actor !== username) {
        loadChannels();
        showToast(`${ev.actor} creó el canal #${ev.channel_name}`);
      } else if (ev.type === "channel_deleted") {
        loadChannels();
        // Si estábamos en ese canal, volver al personal
        if (activeView === "channel:" + ev.channel_id) {
          switchToPersonal();
          showToast("El canal fue borrado por su creador");
        }
      } else if (ev.type === "channel_message" && ev.actor !== username) {
        // Si estamos viendo ese canal, agregar el mensaje en tiempo real
        if (activeView === "channel:" + ev.channel_id) {
          const area = document.getElementById("messagesArea");
          appendUserBubble(area, ev.message, ev.actor);
          appendBotBubble(area, ev.reply);
        } else {
          // Badge de notificación en el sidebar
          badgeChannel(ev.channel_id);
        }
      } else if (ev.type === "mirror_update") {
        handleMirrorUpdate(ev);
      }
    });
  } catch (_) {}
}

// ══════════════════════════════════════════════════════════════════════
// ── USUARIOS & SIDEBAR ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════
async function loadUsers() {
  try {
    const res   = await fetch(API_URL + "/users");
    const users = await res.json();
    const list  = document.getElementById("usersList");
    if (!list) return;
    list.innerHTML = "";

    const order = { online:0, away:1, offline:2 };
    users.sort((a,b) => order[a.status] - order[b.status]);

    users.forEach(u => {
      if (u.name === username) return;
      const id  = "nav-user-" + u.name;
      const el  = document.createElement("div");
      el.id        = id;
      el.className = "sidebar-item" + (mirrorUser === u.name ? " active" : "");
      el.onclick   = () => loadMirror(u.name);
      el.innerHTML = `
        <span class="status-dot ${u.status}"></span>
        <span class="item-label">${u.name}</span>
        <span class="status-text">${{online:"",away:"ausente",offline:"offline"}[u.status]}</span>
      `;
      list.appendChild(el);
    });
  } catch (_) {}
}

async function loadChannels() {
  try {
    const res      = await fetch(API_URL + "/channels");
    const channels = await res.json();
    const list     = document.getElementById("channelsList");
    const empty    = document.getElementById("channelsEmpty");
    if (!list) return;

    list.innerHTML = "";
    const ids = Object.keys(channels);

    if (empty) empty.style.display = ids.length ? "none" : "block";

    ids.forEach(id => {
      const ch  = channels[id];
      const nav = document.createElement("div");
      nav.id        = "nav-channel-" + id;
      nav.className = "sidebar-item channel-item" + (activeView === "channel:" + id ? " active" : "");
      nav.onclick   = () => switchToChannel(id);
      nav.innerHTML = `
        <span class="channel-hash-sm">#</span>
        <span class="item-label">${ch.name}</span>
        ${ch.creator === username ? `
          <button class="item-action danger" onclick="event.stopPropagation();deleteChannel('${id}')" title="Borrar">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6"/></svg>
          </button>` : ""}
        <span class="channel-badge" id="badge-${id}" style="display:none"></span>
      `;
      list.appendChild(nav);
    });
  } catch (_) {}
}

function badgeChannel(channelId) {
  const badge = document.getElementById("badge-" + channelId);
  if (!badge) return;
  const count = (parseInt(badge.dataset.count) || 0) + 1;
  badge.dataset.count = count;
  badge.innerText = count > 9 ? "9+" : count;
  badge.style.display = "inline-flex";
}

function clearBadge(channelId) {
  const badge = document.getElementById("badge-" + channelId);
  if (badge) { badge.style.display = "none"; badge.dataset.count = 0; }
}

// ── Activar nav item ───────────────────────────────────────────────────
function setActiveNav(id) {
  document.querySelectorAll(".sidebar-item").forEach(el => el.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");

  // Limpiar badge si aplica
  if (id.startsWith("nav-channel-")) clearBadge(id.slice(12));
}

// ── Header dinámico ────────────────────────────────────────────────────
function setHeader(iconHTML, title, sub, actionsHTML) {
  document.getElementById("headerIcon").innerHTML  = iconHTML;
  document.getElementById("headerTitle").innerText = title;
  document.getElementById("headerSub").innerText   = sub;
  document.getElementById("headerActions").innerHTML = actionsHTML;
}

// ══════════════════════════════════════════════════════════════════════
// ── MIRROR ────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════
async function loadMirror(user) {
  stopMirrorPolling();
  mirrorUser = user;

  setActiveNav("nav-user-" + user);

  try {
    const res  = await fetch(API_URL + "/history/" + user);
    const hist = await res.json();
    const mirror = document.getElementById("mirrorChat");
    const empty  = document.getElementById("mirrorEmpty");
    if (!mirror) return;

    mirror.innerHTML = "";
    if (hist.length) {
      if (empty) empty.style.display = "none";
      hist.forEach(m => {
        const q = document.createElement("div");
        q.className = "mirror-msg-user";
        q.innerText = m.message;
        const a = document.createElement("div");
        a.className = "mirror-msg-bot";
        renderRichInto(a, m.reply);
        mirror.appendChild(q);
        mirror.appendChild(a);
      });
      mirror.scrollTop = mirror.scrollHeight;
    } else {
      if (empty) empty.style.display = "flex";
    }

    const expandBtn = document.getElementById("mirrorBtnExpand");
    if (expandBtn) expandBtn.style.display = "inline-flex";
    mirrorMsgCount = hist.length;
    startMirrorPolling(user);
  } catch (_) {}
}

function handleMirrorUpdate(ev) {
  if (ev.actor !== mirrorUser) return;
  const mirror = document.getElementById("mirrorChat");
  const empty  = document.getElementById("mirrorEmpty");
  if (!mirror) return;
  if (empty) empty.style.display = "none";
  mirrorMsgCount++;
  const q = document.createElement("div");
  q.className = "mirror-msg-user mirror-new"; q.innerText = ev.message;
  const a = document.createElement("div");
  a.className = "mirror-msg-bot mirror-new";
  renderRichInto(a, ev.reply);
  mirror.appendChild(q); mirror.appendChild(a);
  mirror.scrollTop = mirror.scrollHeight;
}

function startMirrorPolling(user) {
  stopMirrorPolling();
  mirrorPollTimer = setInterval(async () => {
    try {
      const res  = await fetch(API_URL + "/history/" + user);
      const hist = await res.json();
      if (hist.length <= mirrorMsgCount) return;
      const newItems = hist.slice(mirrorMsgCount);
      mirrorMsgCount = hist.length;
      const mirror = document.getElementById("mirrorChat");
      const empty  = document.getElementById("mirrorEmpty");
      if (!mirror) return;
      if (empty) empty.style.display = "none";
      newItems.forEach(m => {
        const q = document.createElement("div"); q.className = "mirror-msg-user mirror-new"; q.innerText = m.message;
        const a = document.createElement("div"); a.className = "mirror-msg-bot mirror-new"; renderRichInto(a, m.reply);
        mirror.appendChild(q); mirror.appendChild(a);
      });
      mirror.scrollTop = mirror.scrollHeight;
    } catch (_) {}
  }, 2500);
}

function stopMirrorPolling() {
  if (mirrorPollTimer) { clearInterval(mirrorPollTimer); mirrorPollTimer = null; }
}

// ── Vista expandida del espejo ─────────────────────────────────────────
function openExpandedView() {
  if (!mirrorUser) return;
  const existing = document.getElementById("expandedOverlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "expandedOverlay"; overlay.className = "expanded-overlay";
  overlay.onclick = e => { if (e.target === overlay) closeExpandedView(); };
  overlay.innerHTML = `
    <div class="expanded-panel">
      <div class="expanded-header">
        <div>
          <div class="panel-label">VISTA EXTENDIDA · ${mirrorUser.toUpperCase()}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-icon-sm" onclick="refreshExpandedView()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button class="btn-ghost-sm" onclick="closeExpandedView()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="expanded-messages" id="expandedMessages"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  refreshExpandedView();
  overlay._poll = setInterval(refreshExpandedView, 3000);
  requestAnimationFrame(() => overlay.classList.add("open"));
}

async function refreshExpandedView() {
  try {
    const res  = await fetch(API_URL + "/history/" + mirrorUser);
    const hist = await res.json();
    const container = document.getElementById("expandedMessages");
    if (!container) return;
    container.innerHTML = "";
    hist.forEach(m => {
      const u = document.createElement("div"); u.className = "expanded-bubble user"; u.innerText = m.message;
      const b = document.createElement("div"); b.className = "expanded-bubble bot"; renderRichInto(b, m.reply);
      container.appendChild(u); container.appendChild(b);
    });
    container.scrollTop = container.scrollHeight;
  } catch (_) {}
}

function closeExpandedView() {
  const el = document.getElementById("expandedOverlay");
  if (!el) return;
  if (el._poll) clearInterval(el._poll);
  el.classList.remove("open");
  setTimeout(() => el.remove(), 200);
}

// ══════════════════════════════════════════════════════════════════════
// ── RENDER ────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════
function appendUserBubble(container, text, actor) {
  const isMe = actor === username;
  const wrap = document.createElement("div");
  wrap.className = "msg-row " + (isMe ? "mine" : "theirs");

  if (!isMe) {
    const label = document.createElement("div");
    label.className = "msg-actor"; label.innerText = actor;
    wrap.appendChild(label);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble user"; bubble.innerText = text;
  wrap.appendChild(bubble);
  container.appendChild(wrap);
  scrollToBottom(container);
}

function appendBotBubble(container, raw) {
  const wrap = document.createElement("div");
  wrap.className = "msg-row bot-row";
  const bubble = document.createElement("div");
  bubble.className = "bubble bot";
  renderRichInto(bubble, raw);
  wrap.appendChild(bubble);
  container.appendChild(wrap);
  scrollToBottom(container);
}

function appendLoader(container) {
  const d = document.createElement("div");
  d.className = "msg-row bot-row";
  d.innerHTML = '<div class="bubble bot loader-bubble"><span class="loader-dot"></span></div>';
  container.appendChild(d);
  scrollToBottom(container);
  return d;
}

function scrollToBottom(el) {
  if (el) el.scrollTop = el.scrollHeight;
}

// Rich content
function renderRichInto(container, raw) {
  parseRichContent(raw).forEach(part => {
    if (part.type === "text" && part.content.trim()) {
      const p = document.createElement("p");
      p.className = "bot-text"; p.innerText = part.content.trim();
      container.appendChild(p);
    } else if (part.type === "table")    container.appendChild(renderTable(part.content));
    else if (part.type === "widget")     container.appendChild(renderWidget(part.title, part.content));
    else if (part.type === "download")   container.appendChild(renderDownload(part.filename, part.content));
  });
}

function parseRichContent(raw) {
  const parts = [], regex = /<table>([\s\S]*?)<\/table>|<widget title="([^"]*)">([\s\S]*?)<\/widget>|<download filename="([^"]*)">([\s\S]*?)<\/download>/g;
  let last = 0, m;
  while ((m = regex.exec(raw)) !== null) {
    if (m.index > last) parts.push({ type:"text", content: raw.slice(last, m.index) });
    if      (m[1] !== undefined) parts.push({ type:"table",    content: m[1].trim() });
    else if (m[2] !== undefined) parts.push({ type:"widget",   title: m[2], content: m[3].trim() });
    else if (m[4] !== undefined) parts.push({ type:"download", filename: m[4], content: m[5] });
    last = regex.lastIndex;
  }
  if (last < raw.length) parts.push({ type:"text", content: raw.slice(last) });
  return parts;
}

function renderTable(raw) {
  const wrap = document.createElement("div"); wrap.className = "rich-table-wrap";
  const tbl  = document.createElement("table"); tbl.className = "rich-table";
  raw.split("\n").filter(l => l.trim()).forEach((line, i) => {
    const row = document.createElement("tr");
    line.split("|").map(c => c.trim()).forEach(cell => {
      const td = document.createElement(i === 0 ? "th" : "td"); td.innerText = cell; row.appendChild(td);
    });
    tbl.appendChild(row);
  });
  wrap.appendChild(tbl); return wrap;
}

function renderWidget(title, content) {
  const d = document.createElement("div"); d.className = "rich-widget";
  d.innerHTML = `<div class="widget-title">${title}</div><div class="widget-body">${content}</div>`;
  return d;
}

function renderDownload(filename, content) {
  const div = document.createElement("div"); div.className = "rich-download";
  const ext = filename.split(".").pop().toLowerCase();
  const isBinary = ["docx","xlsx","pptx"].includes(ext);
  const fn  = isBinary ? filename.replace(/\.(docx|xlsx|pptx)$/, ".txt") : filename;
  const mime = {txt:"text/plain",csv:"text/csv",md:"text/markdown",json:"application/json",html:"text/html"}[fn.split(".").pop()] || "text/plain";
  const url = URL.createObjectURL(new Blob([content], {type: mime}));
  div.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    <a href="${url}" download="${fn}" class="download-link">${fn}</a>
    <span class="download-size">${(content.length/1024).toFixed(1)} KB</span>
    ${isBinary ? `<span class="download-warning">⚠ Guardado como .txt</span>` : ""}
  `;
  return div;
}

// ── Toast ──────────────────────────────────────────────────────────────
function showToast(text) {
  const t = document.createElement("div");
  t.className = "toast"; t.innerText = text;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 350); }, 4000);
}

// ── Canales: modal ─────────────────────────────────────────────────────
function openCreateChannelModal() {
  document.getElementById("createChannelModal").classList.add("open");
  document.getElementById("channelNameInput").focus();
}

function closeCreateChannelModal() {
  document.getElementById("createChannelModal").classList.remove("open");
  document.getElementById("channelNameInput").value = "";
}

async function createChannel() {
  const name = document.getElementById("channelNameInput").value.trim();
  if (!name) return;
  const res  = await fetch(API_URL + "/channels", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ user: username, name })
  });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  closeCreateChannelModal();
  await loadChannels();
  switchToChannel(data.id);
}

document.getElementById("createChannelModal").addEventListener("click", function(e) {
  if (e.target === this) closeCreateChannelModal();
});
document.getElementById("channelNameInput")?.addEventListener("keydown", e => {
  if (e.key === "Enter") createChannel();
});

// ── Upload ─────────────────────────────────────────────────────────────
function getPersonality() { return document.getElementById("personality").value; }

async function uploadFile() {
  const fi = document.getElementById("fileUpload");
  if (!fi.files.length) return;
  const fd = new FormData();
  fd.append("file", fi.files[0]);
  fd.append("user", username);
  const res = await fetch(API_URL + "/upload", { method:"POST", body: fd });
  const fn  = document.getElementById("fileName");
  if (res.ok) fn.innerText = "📎 " + fi.files[0].name;
  else { alert("Tipo de archivo no soportado"); fn.innerText = ""; }
}

// ── Personalidad ───────────────────────────────────────────────────────
const PRESET_LABELS = {normal:"Normal",analyst:"Analista",creative:"Creativo",strict:"Estricto",dev:"Dev",coach:"Coach"};

async function loadPersonalityModal() {
  try {
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
  } catch (_) {}
}

function openPersonalityModal()  { document.getElementById("personalityModal").classList.add("open"); loadPersonalityModal(); }
function closePersonalityModal() { document.getElementById("personalityModal").classList.remove("open"); }

async function savePersonality() {
  const custom = document.getElementById("customPersonality").value.trim();
  await fetch(API_URL + "/personality/" + username, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ custom })
  });
  if (custom) document.getElementById("personality").value = "custom";
  closePersonalityModal();
}

async function clearPersonality() {
  document.getElementById("customPersonality").value = "";
  await fetch(API_URL + "/personality/" + username, { method:"DELETE" });
}

document.getElementById("personalityModal").addEventListener("click", function(e) {
  if (e.target === this) closePersonalityModal();
});
